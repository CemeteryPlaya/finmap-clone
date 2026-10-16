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

test('«Деньги»: ячейка → операции под таблицей, разбитая операция частью; правка операции пересчитывает отчёт; фильтр скрывает остатки', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Ячейки ${Date.now()}`);
  const s = await cashflowSetup(page, cid);
  const supply = (await apiPost(page, `${s.base}/categories`, { kind: 'expense', name: 'Закуп бара' })).category.id as number;
  // разбитый расход: 300 ₸ «Аренда» и 200 ₸ «Закуп бара»
  await apiPost(page, `${s.base}/operations`, {
    type: 'expense',
    paidAt: minutesAgo(10),
    accountId: s.account,
    amount: 50_000,
    comment: 'Разбитый расход',
    lines: [
      { categoryId: s.rent, amount: 30_000 },
      { categoryId: supply, amount: 20_000 },
    ],
  });
  await page.goto(`/c/${cid}/analytics/cashflow`);
  const total = (name: string) => reportRow(page, name).getByRole('cell').last();
  await expect(total('Аренда')).toHaveText(/^₸\s*800$/);

  // ячейка «Итого» строки «Аренда» → блок «Аренда за весь период»: фокус на заголовке, разбитая операция — частью
  const rentCell = report(page).getByRole('button', { name: /^Аренда за весь период: / });
  await rentCell.click();
  const heading = main(page).getByRole('heading', { level: 2, name: 'Аренда за весь период' });
  await expect(heading).toBeFocused();
  const ops = main(page).getByRole('table', { name: 'Операции' });
  await expect(ops.locator('tbody tr')).toHaveCount(2);
  const split = ops.locator('tbody tr').filter({ hasText: 'Разбитый расход' });
  await expect(split.locator('[data-column="amount"]')).toContainText(/\u2212300\s₸/);
  await expect(split.locator('[data-column="amount"]')).toContainText('часть операции');
  const whole = ops.locator('tbody tr').filter({ hasText: 'Поставщик А' });
  await expect(whole.locator('[data-column="amount"]')).not.toContainText('часть операции');
  // «×» закрывает блок, фокус — обратно в ячейку
  await main(page).getByRole('button', { name: 'Закрыть список операций' }).click();
  await expect(heading).toBeHidden();
  await expect(rentCell).toBeFocused();

  // ячейка «Бар» за текущий месяц → операция → правка суммы → отчёт и список пересчитаны
  await report(page).getByRole('button', { name: /^Бар за [а-я]+ \d{4}: ₸/ }).filter({ hasText: /1\s500/ }).click();
  await expect(main(page).getByRole('heading', { level: 2, name: /^Бар за [а-я]+ \d{4}$/ })).toBeFocused();
  await ops.getByRole('button', { name: /^Открыть операцию/ }).click();
  const form = page.getByRole('dialog', { name: 'Доход', exact: true });
  const amount = form.getByRole('textbox', { name: /^Сумма,/ });
  await amount.fill('2000');
  await amount.press('Enter');
  await expect(form).toBeHidden();
  await expect(total('Бар')).toHaveText(/^₸\s*2\s*000$/);
  await expect(ops.locator('tbody tr').first().locator('[data-column="amount"]')).toContainText(/\+2\s000\s₸/);

  // фильтр по категории: остатки скрыты строкой-пояснением, у «Фильтра» счётчик и точка, список закрыт
  const filterButton = main(page).getByRole('button', { name: /^Фильтр/ });
  const dialog = page.getByRole('dialog', { name: 'Фильтры', exact: true });
  const field = (label: string) => dialog.getByRole('button', { name: new RegExp(`^${label}`) });
  await filterButton.click();
  await expect(dialog.locator('button[aria-haspopup="dialog"]')).toHaveText([/^Категории/, /^Контрагенты/, /^Проекты/, /^Теги/, /^Счета/]);
  await expect(field('Категории')).toHaveAccessibleName('Категории: Все категории');
  await field('Категории').click();
  const panel = dialog.getByRole('dialog', { name: 'Категории', exact: true });
  // типов операций в отчёте нет — только категории
  await expect(panel.getByRole('group', { name: 'Тип' })).toHaveCount(0);
  await panel.getByRole('checkbox', { name: 'Аренда', exact: true }).check();
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`category=${s.rent}`));
  await expect(filterButton).toHaveText('Фильтр · 1');
  await expect(report(page).getByRole('row').filter({ hasText: /^Остатки скрыты: при фильтре по категориям/ })).toBeVisible();
  await expect(reportRow(page, /^Остаток на начало периода/)).toHaveCount(0);
  await expect(total('Аренда')).toHaveText(/^₸\s*800$/);
  await expect(heading).toBeHidden();

  // фильтр по счёту остатки сохраняет; «Сбросить» в окне очищает условия
  await filterButton.click();
  await field('Категории').click();
  await panel.getByRole('checkbox', { name: 'Аренда', exact: true }).uncheck();
  await page.keyboard.press('Escape');
  await field('Счета').click();
  await dialog.getByRole('dialog', { name: 'Счета', exact: true }).getByRole('checkbox', { name: 'Касса Клуб 1' }).check();
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await expect(page).toHaveURL(new RegExp(`account=${s.account}$`));
  await expect(reportRow(page, /^Остаток на начало периода/)).toHaveCount(1);
  await filterButton.click();
  await dialog.getByRole('button', { name: 'Сбросить' }).click();
  await expect(field('Счета')).toHaveAccessibleName('Счета: Все счета');
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/analytics/cashflow$`));
  await expect(filterButton).toHaveText('Фильтр');
});

test('«Деньги»: ячейки — одна точка Tab, стрелки двигают фокус, Enter открывает список (R1); проценты в имени ячейки (R6)', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Клавиши ${Date.now()}`);
  await cashflowSetup(page, cid);
  await page.goto(`/c/${cid}/analytics/cashflow?pct=1`);
  const cells = report(page).locator('button[data-cell]');
  await expect(cells.first()).toBeVisible();
  // ровно одна ячейка в порядке Tab — первая; остальные -1
  await expect(report(page).locator('button[data-cell][tabindex="0"]')).toHaveCount(1);
  await expect(cells.first()).toHaveAttribute('tabindex', '0');
  await expect(cells.nth(1)).toHaveAttribute('tabindex', '-1');
  // проценты читаются вместе с суммой
  await expect(report(page).getByRole('button', { name: /^Поступления за весь период: .+, 100,00/ })).toBeVisible();

  // Tab с «?» предыдущей строки попадает в таблицу на первую ячейку («Чистый денежный поток», январь)
  await report(page).getByRole('button', { name: 'Подсказка: Неоперационные изменения остатка' }).focus();
  await page.keyboard.press('Tab');
  const net = (col: string) => report(page).getByRole('button', { name: new RegExp(`^Чистый денежный поток за ${col}`) });
  await expect(net('январь')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(net('февраль')).toBeFocused();
  await expect(net('февраль')).toHaveAttribute('tabindex', '0');
  await expect(net('январь')).toHaveAttribute('tabindex', '-1');
  await page.keyboard.press('ArrowDown');
  const income = report(page).getByRole('button', { name: /^Поступления за февраль/ });
  await expect(income).toBeFocused();
  await page.keyboard.press('End');
  await expect(report(page).getByRole('button', { name: /^Поступления за весь период/ })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(report(page).getByRole('button', { name: /^Поступления за январь/ })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(income).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(main(page).getByRole('heading', { level: 2, name: /^Поступления за февраль \d{4}$/ })).toBeFocused();
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
