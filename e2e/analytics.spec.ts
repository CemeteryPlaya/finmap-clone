import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, user = 'admin', password = 'e2e-password-1') {
  await page.goto('/login');
  await page.getByPlaceholder('Логин').fill(user);
  await page.getByPlaceholder('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('button', { name: 'Настройки', exact: true })).toBeVisible();
}

async function createCompany(page: Page, name: string): Promise<number> {
  await page.goto('/companies/new');
  await page.getByLabel('Название компании').fill(name);
  await page.getByRole('button', { name: 'Создать компанию' }).click();
  await expect(page).toHaveURL(/\/c\/\d+\/log$/);
  return Number(page.url().match(/\/c\/(\d+)\//)![1]);
}

const main = (page: Page) => page.getByRole('main');
const csrf = (page: Page) => ({ origin: new URL(page.url()).origin, 'x-requested-with': 'fetch' });

async function apiPost(page: Page, url: string, data: unknown) {
  const res = await page.request.post(url, { data, headers: csrf(page) });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return res.json();
}

/** Момент n минут назад: операция не в будущем. */
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

/**
 * Компания для «Денег»: «Касса Клуб 1» (тенге, стартовый остаток 100 000 ₸ с 1 января текущего года), категории «Бар» и
 * «Аренда», контрагент «Поставщик А», доход 1 500 ₸ «Бар» и расход 500 ₸ «Аренда» у «Поставщика А».
 */
async function cashflowSetup(page: Page, cid: number) {
  const base = `/api/v1/companies/${cid}`;
  const year = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty', year: 'numeric' }).format(new Date());
  const account = (await apiPost(page, `${base}/accounts`, { name: 'Касса Клуб 1', currency: 'KZT', openedAt: `${year}-01-01`, startingBalance: 10_000_000 })).account.id as number;
  const bar = (await apiPost(page, `${base}/categories`, { kind: 'income', name: 'Бар' })).category.id as number;
  const rent = (await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Аренда' })).category.id as number;
  const supplier = (await apiPost(page, `${base}/counterparties`, { type: 'supplier', name: 'Поставщик А' })).counterparty.id as number;
  const income = (await apiPost(page, `${base}/operations`, { type: 'income', paidAt: minutesAgo(30), accountId: account, amount: 150_000, lines: [{ categoryId: bar, amount: 150_000 }] }))
    .operation.id as number;
  const expense = (
    await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: minutesAgo(20), accountId: account, amount: 50_000, counterpartyId: supplier, lines: [{ categoryId: rent, amount: 50_000 }] })
  ).operation.id as number;
  return { base, account, bar, rent, supplier, income, expense, year };
}

const report = (page: Page) => main(page).getByRole('table', { name: 'Деньги' });
/** Строка таблицы отчёта по названию: строка — точное имя заголовка строки («Бар», не «Закуп бара»), выражение — как есть. */
const reportRow = (page: Page, name: string | RegExp) =>
  report(page)
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', typeof name === 'string' ? { name, exact: true } : { name }) });

test('«Аналитика»: вкладка между «Журналом» и «Складом», карточки отчётов, подсказка «?», «История действий»', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Аналитика ${Date.now()}`);

  const tabs = main(page).getByRole('navigation').first().getByRole('link');
  await expect(tabs).toHaveText(['Журнал', 'Аналитика', 'Склад']);
  await tabs.filter({ hasText: 'Аналитика' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/analytics$`));

  const cards = main(page).getByRole('list', { name: 'Отчёты' }).getByRole('listitem');
  await expect(cards).toHaveCount(6);
  await expect(cards.nth(0)).toContainText('Деньги / Cash flow');
  await expect(cards.nth(0).getByRole('link')).toHaveAttribute('href', `/c/${cid}/analytics/cashflow`);
  await expect(cards.nth(1).getByRole('link')).toHaveAttribute('href', `/c/${cid}/settings/audit`);
  // «План/Факт», «Дебиторка», «Кредиторка», «Баланс» — без ссылки, с подписью
  for (const i of [2, 3, 4, 5]) {
    await expect(cards.nth(i).getByRole('link')).toHaveCount(0);
    await expect(cards.nth(i)).toContainText('Появится с плановыми операциями');
  }
  await expect(cards.nth(5)).toContainText('Баланс');

  // «?» — подсказка поверх карточки; Esc закрывает и возвращает фокус на кнопку
  const help = cards.nth(0).getByRole('button', { name: 'Подсказка: Деньги / Cash flow' });
  await help.click();
  await expect(page.getByRole('dialog', { name: 'Деньги / Cash flow' })).toContainText('по дате платежа');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Деньги / Cash flow' })).toBeHidden();
  await expect(help).toBeFocused();

  await cards.nth(1).getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/audit$`));

  // неизвестный отчёт — обратно к карточкам
  await page.goto(`/c/${cid}/analytics/unknown`);
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/analytics$`));
  await expect(main(page).getByRole('list', { name: 'Отчёты' })).toBeVisible();
});

test('«Деньги»: таблица по месяцам, разрез, шаг, проценты; настройки в адресе переживают перезагрузку; «Сбросить»', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Деньги ${Date.now()}`);
  const s = await cashflowSetup(page, cid);
  await page.goto(`/c/${cid}/analytics`);
  await main(page).getByRole('link', { name: /^Деньги \/ Cash flow/ }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/analytics/cashflow$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Деньги' })).toBeVisible();
  await expect(main(page).getByText('Отчёт о движении денежных средств (cash flow)')).toBeVisible();

  // новый ответ объявляется вежливым статусом (R5)
  await expect(main(page).getByRole('status').filter({ hasText: 'Отчёт обновлён' })).toHaveText('Отчёт обновлён: За текущий год, по месяцам');

  // по умолчанию — текущий год по месяцам: «Название», 12 месяцев, «Итого»
  const headers = report(page).getByRole('columnheader');
  await expect(headers).toHaveCount(14);
  await expect(headers.nth(1)).toHaveText(`Январь ${s.year}`);
  await expect(headers.nth(13)).toHaveText('Итого');
  const rowNames = report(page).getByRole('rowheader');
  await expect(rowNames.nth(0)).toHaveText(/^Остаток на начало периода/);
  await expect(rowNames.nth(1)).toHaveText(/^Остаток на конец периода/);
  await expect(rowNames.nth(2)).toHaveText(/^Неоперационные изменения остатка/);
  await expect(rowNames.nth(3)).toHaveText('Чистый денежный поток');
  await expect(rowNames.nth(4)).toHaveText('Поступления');
  // остаток на начало года — 0, на конец — стартовые 100 000 + 1 500 - 500
  const total = (name: string | RegExp) => reportRow(page, name).getByRole('cell').last();
  await expect(reportRow(page, /^Остаток на начало периода/).getByRole('cell').first()).toHaveText(/^₸\s*0$/);
  await expect(total(/^Остаток на конец периода/)).toHaveText(/^₸\s*101\s*000$/);
  await expect(total('Чистый денежный поток')).toHaveText(/^₸\s*1\s*000$/);
  await expect(total('Бар')).toHaveText(/^₸\s*1\s*500$/);
  await expect(total('Аренда')).toHaveText(/^₸\s*500$/);
  // неоперационные изменения — раскрываются; у подстрок «?»
  const nonop = report(page).getByRole('button', { name: 'Неоперационные изменения остатка', exact: true });
  await expect(nonop).toHaveAttribute('aria-expanded', 'false');
  await nonop.click();
  await expect(nonop).toHaveAttribute('aria-expanded', 'true');
  // у подстрок с «?» имя заголовка строки — название и подсказка
  await expect(total(/^Стартовые остатки/)).toHaveText(/^₸\s*100\s*000$/);
  await report(page).getByRole('button', { name: 'Подсказка: Курсовая разница' }).click();
  await expect(page.getByRole('dialog', { name: 'Курсовая разница' })).toContainText('Переоценка');
  await page.keyboard.press('Escape');

  // разрез: точка у изменённого контрола, «Сбросить», разрез в адресе
  const controls = main(page).locator('[data-changed]');
  await expect(controls).toHaveCount(0);
  await expect(main(page).getByRole('button', { name: 'Сбросить' })).toHaveCount(0);
  await main(page).getByRole('button', { name: 'Разрез: По категориям' }).click();
  await page.getByRole('dialog', { name: 'Разрез' }).getByRole('button', { name: 'По контрагентам' }).click();
  await expect(page).toHaveURL(/by=counterparty/);
  await expect(controls).toHaveCount(1);
  await expect(total('Поставщик А')).toHaveText(/^₸\s*500$/);
  await expect(total('Без контрагента')).toHaveText(/^₸\s*1\s*500$/);

  // шаг «По дням» на годе недоступен — с подсказкой; «По кварталам» — четыре колонки
  await main(page).getByRole('button', { name: 'Шаг: По месяцам' }).click();
  const steps = page.getByRole('dialog', { name: 'Шаг' });
  const day = steps.getByRole('button', { name: /^По дням/ });
  await expect(day).toHaveAttribute('aria-disabled', 'true');
  await expect(day).toContainText('Слишком много колонок — выберите больший шаг или короче период');
  // нажатие на недоступный пункт ничего не меняет (Playwright считает aria-disabled недоступным — щелчок без проверки)
  await day.click({ force: true });
  await expect(steps).toBeVisible();
  await steps.getByRole('button', { name: 'По кварталам' }).click();
  await expect(headers).toHaveCount(6);
  await expect(headers.nth(4)).toHaveText(`IV кв. ${s.year}`);

  // проценты: доля строки в группе, у группы — 100 %
  await main(page).getByRole('button', { name: 'Проценты: Скрыть проценты' }).click();
  await page.getByRole('dialog', { name: 'Проценты' }).getByRole('button', { name: 'Показать проценты' }).click();
  await expect(total('Поступления')).toContainText('(100,00\u00A0%)');
  await expect(total('Без контрагента')).toContainText('(100,00\u00A0%)');
  await expect(total(/^Остаток на конец периода/)).not.toContainText('%');

  // ссылка и перезагрузка сохраняют отчёт (улучшение против Finmap)
  await page.reload();
  await expect(main(page).getByRole('button', { name: 'Разрез: По контрагентам' })).toBeVisible();
  await expect(main(page).getByRole('button', { name: 'Шаг: По кварталам' })).toBeVisible();
  await expect(headers).toHaveCount(6);
  await expect(total('Поступления')).toContainText('(100,00\u00A0%)');
  await expect(controls).toHaveCount(3);

  // «Сбросить» — всё по умолчанию, фокус на заголовке
  await main(page).getByRole('button', { name: 'Сбросить' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/analytics/cashflow$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Деньги' })).toBeFocused();
  await expect(controls).toHaveCount(0);
  await expect(headers).toHaveCount(14);

  // период: «За прошлый месяц» — изменённый контрол; «Назад к отчётам» — к карточкам
  await main(page).getByRole('button', { name: /^Период: За текущий год/ }).click();
  const periods = page.getByRole('dialog', { name: 'Период' });
  await expect(periods.getByRole('button')).toHaveText([/За текущий год/, 'За предыдущий год', 'За текущую неделю', 'За прошлую неделю', 'За текущий месяц', 'За прошлый месяц', 'Выбрать даты']);
  await periods.getByRole('button', { name: 'За текущую неделю' }).click();
  await expect(page).toHaveURL(/period=week/);
  await expect(main(page).getByRole('button', { name: 'Шаг: По месяцам' })).toBeVisible();
  await expect(controls).toHaveCount(1);
  await main(page).getByRole('link', { name: 'Назад к отчётам' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/analytics$`));
});

test('телефон: «Ещё» → «Аналитика», карточки в одну колонку, заголовок получает фокус', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Аналитика телефон ${Date.now()}`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/c/${cid}/log`);
  await page.getByRole('navigation', { name: 'Разделы', exact: true }).getByRole('button', { name: 'Ещё', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Ещё', exact: true });
  await expect(menu.getByRole('link').first()).toHaveText('Аналитика');
  await menu.getByRole('link', { name: 'Аналитика' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/analytics$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Аналитика' })).toBeFocused();
  const cards = main(page).getByRole('list', { name: 'Отчёты' }).getByRole('listitem');
  const first = (await cards.nth(0).boundingBox())!;
  const second = (await cards.nth(1).boundingBox())!;
  expect(second.y).toBeGreaterThan(first.y + first.height - 1);
  expect(Math.round(second.x)).toBe(Math.round(first.x));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
