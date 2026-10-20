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

const almatyYear = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty', year: 'numeric' }).format(new Date());

/**
 * Момент n минут назад: операция не в будущем и не в прошлом году. В первые минуты года «n минут назад» — это ещё прошлый
 * год: момент берётся не раньше начала текущего года по Алматы (UTC+5), и отчёт «За текущий год» не зависит от времени запуска (R17).
 */
const minutesAgo = (n: number) => new Date(Math.max(Date.now() - n * 60_000, Date.parse(`${almatyYear()}-01-01T00:00:00+05:00`))).toISOString();

/**
 * Компания для «Денег»: «Касса Клуб 1» (тенге, стартовый остаток 100 000 ₸ с 1 декабря прошлого года), категории «Бар» и
 * «Аренда», контрагент «Поставщик А», доход 1 500 ₸ «Бар» и расход 500 ₸ «Аренда» у «Поставщика А».
 */
async function cashflowSetup(page: Page, cid: number) {
  const base = `/api/v1/companies/${cid}`;
  const year = almatyYear();
  const account = (await apiPost(page, `${base}/accounts`, { name: 'Касса Клуб 1', currency: 'KZT', openedAt: `${Number(year) - 1}-12-01`, startingBalance: 10_000_000 })).account.id as number;
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
  await expect(cards).toHaveCount(10);
  await expect(cards.nth(0)).toContainText('Деньги / Cash flow');
  await expect(cards.nth(0).getByRole('link')).toHaveAttribute('href', `/c/${cid}/analytics/cashflow`);
  await expect(cards.nth(1)).toContainText('Прибыль / P&L');
  await expect(cards.nth(1).getByRole('link')).toHaveAttribute('href', `/c/${cid}/analytics/pnl`);
  await expect(cards.nth(2)).toContainText('Выписка по счету');
  await expect(cards.nth(2).getByRole('link')).toHaveAttribute('href', `/c/${cid}/analytics/statement`);
  await expect(cards.nth(3)).toContainText('Проекты');
  await expect(cards.nth(3).getByRole('link')).toHaveAttribute('href', `/c/${cid}/analytics/projects`);
  await expect(cards.nth(4)).toContainText('Финансовые показатели');
  await expect(cards.nth(4).getByRole('link')).toHaveAttribute('href', `/c/${cid}/analytics/indicators`);
  await expect(cards.nth(5).getByRole('link')).toHaveAttribute('href', `/c/${cid}/settings/audit`);
  // «План/Факт», «Дебиторка», «Кредиторка», «Баланс» — без ссылки, с подписью
  for (const i of [6, 7, 8, 9]) {
    await expect(cards.nth(i).getByRole('link')).toHaveCount(0);
    await expect(cards.nth(i)).toContainText('Появится с плановыми операциями');
  }
  await expect(cards.nth(9)).toContainText('Баланс');
  // неактивная карточка: приглушены рисунок и рамка, подпись и название — нет (контраст AA)
  const dim = cards.nth(6).locator('div.h-full');
  expect(await dim.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  expect(await dim.locator('span').first().evaluate((el) => getComputedStyle(el).opacity)).toBe('0.5');
  expect(await dim.locator('span').nth(2).evaluate((el) => getComputedStyle(el).opacity)).toBe('1');

  // «?» — подсказка поверх карточки; Esc закрывает и возвращает фокус на кнопку
  const help = cards.nth(0).getByRole('button', { name: 'Подсказка: Деньги / Cash flow' });
  await help.click();
  await expect(page.getByRole('dialog', { name: 'Деньги / Cash flow' })).toContainText('по дате платежа');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Деньги / Cash flow' })).toBeHidden();
  await expect(help).toBeFocused();

  await cards.nth(5).getByRole('link').click();
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
  // по умолчанию — вид «график», как у Finmap; таблица — вторая кнопка вида, вид в адресе
  await expect(main(page).getByRole('button', { name: 'График', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await main(page).getByRole('button', { name: 'Таблица', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/analytics/cashflow\\?view=table$`));
  // «Обновить» один на экране (на телефоне свой, см. тест телефона)
  await expect(main(page).getByRole('button', { name: 'Обновить', exact: true })).toHaveCount(1);
  // первая колонка закреплена: сфокусированная ячейка не прячется под ней (scroll-padding равен её ширине)
  expect(await main(page).getByRole('region', { name: 'Деньги: таблица' }).evaluate((el) => getComputedStyle(el).scrollPaddingLeft)).toBe('224px');

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
  // остаток на начало года — стартовые 100 000 (счёт открыт в прошлом году), на конец — 100 000 + 1 500 - 500
  const total = (name: string | RegExp) => reportRow(page, name).getByRole('cell').last();
  await expect(reportRow(page, /^Остаток на начало периода/).getByRole('cell').first()).toHaveText(/^₸\s*100\s*000$/);
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
  // счёт открыт до периода: стартовых остатков внутри периода нет
  await expect(total(/^Стартовые остатки/)).toHaveText(/^₸\s*0$/);
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

  // «Сбросить» — всё по умолчанию, кроме вида; фокус на заголовке
  await main(page).getByRole('button', { name: 'Сбросить' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/analytics/cashflow\\?view=table$`));
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
  await page.goto(`/c/${cid}/analytics/cashflow?view=table`);
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
  // имя кнопки «Открыть операцию» тоже говорит, что это часть операции
  await expect(split.getByRole('button', { name: /^Открыть операцию: .*, часть операции$/ })).toHaveCount(1);
  await expect(ops.locator('tbody tr').filter({ hasText: 'Поставщик А' }).getByRole('button', { name: /^Открыть операцию: / })).not.toHaveAccessibleName(/часть операции/);
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
  // сообщение о скрытых остатках не шире блока таблицы (1024 px), даже если блок прокручен вбок
  await page.setViewportSize({ width: 1024, height: 768 });
  const region = main(page).getByRole('region', { name: 'Деньги: таблица' });
  const hiddenText = report(page).getByText(/^Остатки скрыты/);
  const fits = () =>
    Promise.all([region.evaluate((el) => el.getBoundingClientRect().toJSON()), hiddenText.evaluate((el) => el.getBoundingClientRect().toJSON())]).then(
      ([r, t]) => t.right <= r.right + 0.5 && t.left >= r.left - 0.5,
    );
  expect(await fits()).toBe(true);
  await region.evaluate((el) => el.scrollBy(300, 0));
  await expect.poll(() => region.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  expect(await fits()).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });

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
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/analytics/cashflow\\?view=table$`));
  await expect(filterButton).toHaveText('Фильтр');
});

test('«Деньги»: ячейки — одна точка Tab, стрелки двигают фокус, Enter открывает список (R1); проценты в имени ячейки (R6)', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Клавиши ${Date.now()}`);
  await cashflowSetup(page, cid);
  await page.goto(`/c/${cid}/analytics/cashflow?view=table&pct=1`);
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

test('телефон: «Деньги» — сверху вид, «Фильтры» и «Обновить», окно на весь экран с контролами; таблица прокручивается внутри; операции — карточками', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Деньги телефон ${Date.now()}`);
  await cashflowSetup(page, cid);
  const phone = { width: 390, height: 844 };
  await page.setViewportSize(phone);
  await page.goto(`/c/${cid}/analytics/cashflow?view=table`);
  await expect(reportRow(page, 'Поступления')).toBeVisible();
  await expect(main(page).getByRole('button', { name: /^Период:/ })).toBeHidden();
  await expect(main(page).getByRole('button', { name: /^Разрез:/ })).toBeHidden();
  const filters = main(page).getByRole('button', { name: /^Фильтры/ });
  await expect(filters).toHaveText('Фильтры');
  expect((await filters.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  // «Обновить» остался на телефоне рядом с «Фильтрами» и обновляет отчёт (N1)
  const refresh = main(page).getByRole('button', { name: 'Обновить', exact: true });
  await expect(refresh).toHaveCount(1);
  const [fb, rb] = [(await filters.boundingBox())!, (await refresh.boundingBox())!];
  expect(rb.width).toBeGreaterThanOrEqual(44);
  expect(rb.height).toBeGreaterThanOrEqual(44);
  expect(Math.abs(rb.y + rb.height / 2 - (fb.y + fb.height / 2))).toBeLessThan(2);
  const refetch = page.waitForRequest((req) => /\/analytics\/cashflow\?/.test(req.url()));
  await refresh.click();
  await refetch;
  // «?» на телефоне: кнопка 32 px и невидимая область вокруг неё — нажимаемый размер 44 px
  const help = main(page).getByRole('button', { name: 'Подсказка: Деньги', exact: true });
  expect(await help.evaluate((el) => [getComputedStyle(el, '::after').width, getComputedStyle(el, '::after').height])).toEqual(['44px', '44px']);
  // закреплённая колонка названий уже: scroll-padding по её ширине
  expect(await main(page).getByRole('region', { name: 'Деньги: таблица' }).evaluate((el) => getComputedStyle(el).scrollPaddingLeft)).toBe('144px');

  // страница не уезжает вбок; таблица прокручивается в своём блоке, колонка названий закреплена
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const region = main(page).getByRole('region', { name: 'Деньги: таблица' });
  expect(await region.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  const label = reportRow(page, 'Поступления').getByRole('rowheader');
  const x0 = (await label.boundingBox())!.x;
  await region.evaluate((el) => el.scrollBy(400, 0));
  await expect.poll(() => region.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  expect(Math.round((await label.boundingBox())!.x)).toBe(Math.round(x0));

  // «Фильтры» — окно на весь экран: период, разрез, шаг, проценты, затем поля фильтра
  await filters.click();
  const dialog = page.getByRole('dialog', { name: 'Фильтры', exact: true });
  const box = (await dialog.boundingBox())!;
  expect([Math.round(box.width), Math.round(box.height)]).toEqual([phone.width, phone.height]);
  await expect(dialog.locator('button[aria-haspopup="dialog"]')).toHaveText([
    /^За текущий год/,
    /^По категориям/,
    /^По месяцам/,
    /^Скрыть проценты/,
    /^Категории/,
    /^Контрагенты/,
    /^Проекты/,
    /^Теги/,
    /^Счета/,
  ]);
  await dialog.getByRole('button', { name: 'Разрез: По категориям' }).click();
  await dialog.getByRole('dialog', { name: 'Разрез' }).getByRole('button', { name: 'По контрагентам' }).click();
  await dialog.getByRole('button', { name: 'Проценты: Скрыть проценты' }).click();
  await dialog.getByRole('dialog', { name: 'Проценты' }).getByRole('button', { name: 'Показать проценты' }).click();
  // до «Готово» отчёт прежний
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/analytics/cashflow\\?view=table$`));
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/by=counterparty&pct=1$/);
  await expect(filters).toHaveText('Фильтры · 2');

  // ячейка «Поставщик А» → список карточками, заголовок в фокусе
  await report(page).getByRole('button', { name: /^Поставщик А за весь период: / }).click();
  await expect(main(page).getByRole('heading', { level: 2, name: 'Поставщик А за весь период' })).toBeFocused();
  const cards = main(page).getByRole('list', { name: 'Операции' }).getByRole('listitem');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText(/\u2212500\s₸/);

  // «Сбросить» в окне — все настройки по умолчанию, кроме вида
  await filters.click();
  await dialog.getByRole('button', { name: 'Сбросить' }).click();
  await expect(dialog.getByRole('button', { name: 'Разрез: По категориям' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/analytics/cashflow\\?view=table$`));
  await expect(filters).toHaveText('Фильтры');
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

test('«Деньги»: пока показан прежний отчёт, ячейки не открываются ни щелчком, ни Enter и пробелом (R8)', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Занято ${Date.now()}`);
  await cashflowSetup(page, cid);
  await page.goto(`/c/${cid}/analytics/cashflow?view=table`);
  const incomeCell = report(page).getByRole('button', { name: /^Поступления за весь период: / });
  await expect(incomeCell).toBeVisible();
  const list = main(page).getByRole('heading', { level: 2, name: 'Поступления за весь период' });

  // ответ на новые настройки задерживается: до него на экране прежняя таблица
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/analytics\/cashflow\?/, async (route) => {
    await gate;
    await route.continue();
  });
  await main(page).getByRole('button', { name: 'Шаг: По месяцам' }).click();
  await page.getByRole('dialog', { name: 'Шаг' }).getByRole('button', { name: 'По кварталам' }).click();
  await expect(report(page)).toHaveAttribute('aria-busy', 'true');
  await expect(incomeCell).toHaveAttribute('aria-disabled', 'true');
  await incomeCell.click({ force: true });
  await incomeCell.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  await expect(list).toHaveCount(0);

  // ответ пришёл: список не открылся сам, ячейка снова работает
  release();
  await expect(report(page)).toHaveAttribute('aria-busy', 'false');
  await expect(list).toHaveCount(0);
  await expect(incomeCell).not.toHaveAttribute('aria-disabled', 'true');
  await incomeCell.click();
  await expect(list).toBeFocused();
  // другие настройки закрывают открытый список: он не остаётся под новым отчётом
  await main(page).getByRole('button', { name: 'Разрез: По категориям' }).click();
  await page.getByRole('dialog', { name: 'Разрез' }).getByRole('button', { name: 'По контрагентам' }).click();
  await expect(list).toHaveCount(0);
});

test('«Деньги»: id из адреса, которых нет в справочниках, убираются с короткой пометкой, без тупиковой ошибки (R14)', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Ссылка ${Date.now()}`);
  const s = await cashflowSetup(page, cid);
  await page.goto(`/c/${cid}/analytics/cashflow?view=table&account=${s.account}&account=999999&category=888888&pct=1`);
  const notice = main(page).getByRole('status').filter({ hasText: 'Из ссылки убраны' });
  await expect(notice).toHaveText('Из ссылки убраны фильтры, которых больше нет: счета, категории');
  await expect(reportRow(page, 'Поступления')).toBeVisible();
  await expect(main(page).getByRole('alert')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/analytics/cashflow\\?view=table&pct=1&account=${s.account}$`));
  await expect(main(page).getByRole('button', { name: /^Фильтр/ })).toHaveText('Фильтр · 1');

  // адрес только с неизвестным счётом — обычный отчёт без фильтра
  await page.goto(`/c/${cid}/analytics/cashflow?view=table&account=999999`);
  await expect(notice).toHaveText('Из ссылки убраны фильтры, которых больше нет: счета');
  await expect(reportRow(page, 'Поступления')).toBeVisible();
  await expect(main(page).getByRole('alert')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/analytics/cashflow\\?view=table$`));
  await expect(main(page).getByRole('button', { name: /^Фильтр/ })).toHaveText('Фильтр');
  // следующее действие убирает пометку
  await main(page).getByRole('button', { name: 'Проценты: Скрыть проценты' }).click();
  await page.getByRole('dialog', { name: 'Проценты' }).getByRole('button', { name: 'Показать проценты' }).click();
  await expect(notice).toHaveCount(0);
});

test('«Деньги»: область для программ чтения есть уже до загрузки справочников (R12)', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Статус ${Date.now()}`);
  await cashflowSetup(page, cid);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(new RegExp(`/api/v1/companies/${cid}/accounts$`), async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto(`/c/${cid}/analytics/cashflow?view=table`);
  await expect(main(page).getByText('Загрузка…')).toBeVisible();
  await expect(main(page).locator('p.sr-only[role="status"][aria-live="polite"]')).toHaveCount(1);
  release();
  await expect(reportRow(page, 'Поступления')).toBeVisible();
  await expect(main(page).locator('p.sr-only[role="status"][aria-live="polite"]')).toHaveText('Отчёт обновлён: За текущий год, по месяцам');
});

test('архивная компания: вкладка «Аналитика», «Деньги» загружаются только для чтения; на телефоне «Ещё» → «Аналитика» (R11)', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Архив аналитика ${Date.now()}`);
  const s = await cashflowSetup(page, cid);
  // счёт в архив — только с нулевым балансом: стартовый остаток убираем, расход добирает 1 500 ₸ дохода до нуля
  const patched = await page.request.patch(`/api/v1/companies/${cid}/accounts/${s.account}`, { data: { startingBalance: 0 }, headers: csrf(page) });
  expect(patched.ok(), await patched.text()).toBe(true);
  await apiPost(page, `${s.base}/operations`, { type: 'expense', paidAt: minutesAgo(5), accountId: s.account, amount: 100_000, lines: [{ categoryId: s.rent, amount: 100_000 }] });
  await apiPost(page, `/api/v1/companies/${cid}/accounts/${s.account}/archive`, {});
  await apiPost(page, `/api/v1/companies/${cid}/archive`, {});

  await page.goto(`/c/${cid}/log`);
  const tabs = main(page).getByRole('navigation').first().getByRole('link');
  await expect(tabs).toHaveText(['Журнал', 'Аналитика', 'Склад']);
  await tabs.filter({ hasText: 'Аналитика' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/analytics$`));
  await main(page).getByRole('link', { name: /^Деньги \/ Cash flow/ }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/analytics/cashflow$`));
  await main(page).getByRole('button', { name: 'Таблица', exact: true }).click();
  const total = (name: string) => reportRow(page, name).getByRole('cell').last();
  await expect(total('Поступления')).toHaveText(/^₸\s*1\s*500$/);
  await expect(total('Чистый денежный поток')).toHaveText(/^₸\s*0$/);
  // список операций ячейки открывается; отчёт только читается — ни одного запроса на запись
  const writes: string[] = [];
  page.on('request', (req) => {
    if (req.method() !== 'GET') writes.push(`${req.method()} ${req.url()}`);
  });
  await report(page).getByRole('button', { name: /^Бар за весь период: / }).click();
  await expect(main(page).getByRole('heading', { level: 2, name: 'Бар за весь период' })).toBeFocused();
  await expect(main(page).getByRole('table', { name: 'Операции' }).locator('tbody tr')).toHaveCount(1);
  await main(page).getByRole('button', { name: 'Обновить', exact: true }).click();
  await expect(total('Поступления')).toHaveText(/^₸\s*1\s*500$/);
  expect(writes).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/c/${cid}/log`);
  await page.getByRole('navigation', { name: 'Разделы', exact: true }).getByRole('button', { name: 'Ещё', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Ещё', exact: true });
  await expect(menu.getByRole('link').first()).toHaveText('Аналитика');
  await menu.getByRole('link', { name: 'Аналитика' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/analytics$`));
});

test('«Деньги»: вид «график» — столбцы с линией, кольца, стеки; колонка с клавиатуры, подсказка и операции колонки в две колонки', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО График ${Date.now()}`);
  const s = await cashflowSetup(page, cid);
  // R8: в две колонки списки операций встают от 2xl (1536 px)
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/c/${cid}/analytics/cashflow`);
  // рисунки — role="img" с итогом в имени; легенда под графиком
  await expect(main(page).getByRole('img', { name: /^Деньги\. Поступления: ₸\s1\s500; Списания: ₸\s500; Сальдо: ₸\s1\s000$/ })).toBeVisible();
  await expect(main(page).getByRole('list', { name: 'Легенда: Деньги' }).getByRole('listitem')).toHaveText(['Поступления', 'Списания', 'Сальдо']);
  await expect(main(page).getByRole('img', { name: /^Поступления: ₸\s1\s500\. Бар ₸\s1\s500 \(100,00\s%\)$/ })).toBeVisible();
  await expect(main(page).getByRole('img', { name: /^Списания: ₸\s500\. Аренда ₸\s500 \(100,00\s%\)$/ })).toBeVisible();
  await expect(main(page).getByRole('img', { name: /^Поступления по категориям: Бар ₸\s1\s500$/ })).toBeVisible();
  await expect(main(page).getByRole('list', { name: 'Легенда: Списания по категориям' }).getByRole('listitem')).toHaveText(['Аренда']);
  // проценты — только в таблице
  await expect(main(page).getByRole('button', { name: /^Проценты:/ })).toHaveCount(0);

  // операции периода — под графиками в две колонки: «Поступления» и «Списания»
  const opsHeading = main(page).getByRole('heading', { level: 2, name: 'Операции за весь период' });
  await expect(opsHeading).toBeVisible();
  const list = (name: string) => main(page).locator('section[data-report-operations]').filter({ has: page.getByRole('heading', { level: 3, name, exact: true }) });
  await expect(list('Поступления').getByRole('table', { name: 'Операции' }).locator('tbody tr')).toHaveCount(1);
  await expect(list('Списания').getByRole('table', { name: 'Операции' }).locator('tbody tr')).toContainText('Поставщик А');
  const [left, right] = [(await list('Поступления').boundingBox())!, (await list('Списания').boundingBox())!];
  expect(Math.abs(left.y - right.y)).toBeLessThan(2);
  expect(right.x).toBeGreaterThan(left.x + left.width - 1);

  // колонки — одна точка Tab; стрелки двигают фокус, подсказка видна; Enter выбирает колонку
  const columns = main(page).getByRole('group', { name: 'Деньги: колонки' });
  await expect(columns.locator('button[tabindex="0"]')).toHaveCount(1);
  const current = columns.getByRole('button', { name: /^[А-Я][а-я]+ \d{4}: Поступления ₸\s1\s500, Списания ₸\s500, Сальдо ₸\s1\s000$/ });
  await current.focus();
  const tip = main(page).locator('[aria-hidden="true"]').filter({ hasText: 'Сальдо' }).filter({ hasText: /₸\s1\s000/ });
  await expect(tip).toBeVisible();
  // Escape прячет подсказку, не сдвигая фокус (WCAG 1.4.13); стрелка возвращает её
  await page.keyboard.press('Escape');
  await expect(tip).toHaveCount(0);
  await expect(current).toBeFocused();
  const month = ((await current.getAttribute('aria-label')) ?? '').split(':')[0]!;
  if (!month.startsWith('Январь')) {
    await page.keyboard.press('ArrowLeft');
    // предыдущий месяц без операций
    await expect(columns.locator('button:focus')).toHaveAttribute('aria-label', /: Поступления ₸\s0, /);
    await page.keyboard.press('ArrowRight');
  }
  await expect(current).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(current).toHaveAttribute('aria-pressed', 'true');
  await expect(current).toBeFocused();
  const monthTitle = `Операции за ${month[0]!.toLowerCase()}${month.slice(1)}`;
  await expect(main(page).getByRole('heading', { level: 2, name: monthTitle })).toBeVisible();
  await expect(list('Поступления').getByRole('table', { name: 'Операции' }).locator('tbody tr')).toHaveCount(1);
  // тот же месяц выбран и в стеках; «Весь период» снимает выбор, фокус — на заголовок списка
  await expect(main(page).getByRole('group', { name: 'Поступления по категориям: колонки' }).getByRole('button', { pressed: true })).toHaveCount(1);
  await main(page).getByRole('button', { name: 'Весь период' }).click();
  await expect(opsHeading).toBeFocused();
  await expect(current).toHaveAttribute('aria-pressed', 'false');

  // после щелчка мышью (колонка в фокусе) подсказки других колонок следуют за мышью, а не залипают на выбранной
  const monthButtons = columns.getByRole('button');
  await monthButtons.nth(0).click();
  const second = ((await monthButtons.nth(1).getAttribute('aria-label')) ?? '').split(':')[0]!;
  await monthButtons.nth(1).hover();
  await expect(main(page).locator('[aria-hidden="true"]').filter({ hasText: 'Сальдо' }).locator('p').first()).toContainText(second);

  // пустой период — «Нет операций за период», без списков
  await page.goto(`/c/${cid}/analytics/cashflow?from=${Number(s.year) - 1}-01-01&to=${Number(s.year) - 1}-01-31`);
  await expect(main(page).getByText('Нет операций за период')).toBeVisible();
  await expect(main(page).locator('section[data-report-operations]')).toHaveCount(0);

  // вид в адресе: таблица и обратно; перезагрузка сохраняет вид
  await main(page).getByRole('button', { name: 'Таблица', exact: true }).click();
  await expect(page).toHaveURL(/\?view=table&from=/);
  await page.reload();
  await expect(report(page)).toBeVisible();
  await main(page).getByRole('button', { name: 'График', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/analytics/cashflow\\?from=`));

  // телефон: вид и «Фильтры» сверху, кнопки вида 44 px, страница не уезжает вбок
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/c/${cid}/analytics/cashflow`);
  await expect(main(page).getByRole('img', { name: /^Деньги\. / })).toBeVisible();
  const chartButton = main(page).getByRole('button', { name: 'График', exact: true });
  expect((await chartButton.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('«Деньги» и «Прибыль»: «Excel» скачивает текущую таблицу отчёта с именем «{Компания} - {Отчёт} - ДД-ММ-ГГГГ ЧЧ-ММ.xlsx»', async ({ page }) => {
  await login(page);
  const name = `ТОО Excel ${Date.now()}`;
  const cid = await createCompany(page, name);
  await cashflowSetup(page, cid);
  await page.goto(`/c/${cid}/analytics/cashflow?view=table&pct=1`);
  const excel = main(page).getByRole('link', { name: 'Скачать Excel', exact: true });
  await expect(excel).toHaveAttribute('href', new RegExp(`^/api/v1/companies/${cid}/analytics/cashflow\\.xlsx\\?from=.+&pct=true$`));
  const file = page.waitForEvent('download');
  await excel.click();
  const download = await file;
  expect(download.suggestedFilename()).toMatch(new RegExp(`^${name} - Деньги - \\d{2}-\\d{2}-\\d{4} \\d{2}-\\d{2}\\.xlsx$`));
  // ссылка без побочных эффектов: страница та же, отчёт на месте
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/analytics/cashflow\\?view=table&pct=1$`));
  await expect(report(page)).toBeVisible();

  // в виде «график» процентов нет и в файле; «Прибыль» — своё имя
  await page.goto(`/c/${cid}/analytics/pnl`);
  await expect(excel).toHaveAttribute('href', new RegExp(`^/api/v1/companies/${cid}/analytics/pnl\\.xlsx\\?from=[^&]+&to=[^&]+&step=month&by=category$`));
  const pnlFile = page.waitForEvent('download');
  await excel.click();
  expect((await pnlFile).suggestedFilename()).toMatch(new RegExp(`^${name} - Прибыль - `));
});

test('«Деньги»: на 1440 px «Обновить» в одной строке с кнопкой периода, вид рядом с заголовком (R7)', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Панель ${Date.now()}`);
  await cashflowSetup(page, cid);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/c/${cid}/analytics/cashflow`);
  const periodButton = main(page).getByRole('button', { name: /^Период:/ });
  const refresh = main(page).getByRole('button', { name: 'Обновить', exact: true });
  await expect(periodButton).toBeVisible();
  const [pb, rb] = [(await periodButton.boundingBox())!, (await refresh.boundingBox())!];
  expect(Math.abs(rb.y + rb.height / 2 - (pb.y + pb.height / 2))).toBeLessThan(2);
  // переключатель вида — рядом с заголовком, а не в панели контролов
  const heading = page.getByRole('heading', { level: 1, name: 'Деньги' });
  const view = main(page).getByRole('group', { name: 'Вид отчёта' });
  const [hb, vb] = [(await heading.boundingBox())!, (await view.boundingBox())!];
  expect(Math.abs(vb.y + vb.height / 2 - (hb.y + hb.height / 2))).toBeLessThan(12);
});

test('«Прибыль»: на 1440 px худший случай — таблица, проценты, склад, «Сбросить», «Excel» — панель в одну строку (R10)', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Панель худший ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  // склад есть → в панели появляется переключатель склада
  const project = (await apiPost(page, `${base}/projects`, { name: 'Клуб 1', templateKey: 'general' })).project.id as number;
  await apiPost(page, `${base}/stock/warehouses`, { projectId: project, name: 'Бар Клуб 1' });
  await page.setViewportSize({ width: 1440, height: 900 });
  const bar = main(page);
  // склад «по себестоимости» (по умолчанию) — самая длинная подпись панели; «закупки» — с точкой «изменено»
  for (const stock of ['', '&stock=0']) {
    await page.goto(`/c/${cid}/analytics/pnl?view=table&pct=1${stock}`);
    const periodButton = bar.getByRole('button', { name: /^Период:/ });
    await expect(periodButton).toBeVisible();
    const controls = [
      periodButton,
      bar.getByRole('button', { name: /^Разрез:/ }),
      bar.getByRole('button', { name: /^Шаг:/ }),
      bar.getByRole('button', { name: /^Фильтр/ }),
      bar.getByRole('button', { name: /^Проценты:/ }),
      bar.getByRole('button', { name: /^Склад:/ }),
      bar.getByRole('button', { name: 'Сбросить' }),
      bar.getByRole('link', { name: 'Скачать Excel', exact: true }),
      bar.getByRole('button', { name: 'Обновить', exact: true }),
      bar.getByRole('button', { name: /^Подсказка:/ }),
    ];
    const pb = (await periodButton.boundingBox())!;
    for (const control of controls) {
      await expect(control).toBeVisible();
      const b = (await control.boundingBox())!;
      expect(Math.abs(b.y + b.height / 2 - (pb.y + pb.height / 2)), `${stock}: ${JSON.stringify(b)}`).toBeLessThan(2);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('«Деньги»: pct=1 в виде «график» не даёт «Сбросить» и число на телефоне; пока грузится новый отчёт, колонки графика не выбираются', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Проценты график ${Date.now()}`);
  await cashflowSetup(page, cid);
  await page.goto(`/c/${cid}/analytics/cashflow?pct=1`);
  await expect(main(page).getByRole('img', { name: /^Деньги\. / })).toBeVisible();
  await expect(main(page).getByRole('button', { name: 'Сбросить' })).toHaveCount(0);
  // в таблице те же проценты — изменённый контрол
  await main(page).getByRole('button', { name: 'Таблица', exact: true }).click();
  await expect(main(page).getByRole('button', { name: 'Сбросить' })).toBeVisible();
  await main(page).getByRole('button', { name: 'График', exact: true }).click();
  await expect(main(page).getByRole('button', { name: 'Сбросить' })).toHaveCount(0);

  // ответ на новые настройки задерживается: колонки с aria-disabled и не выбираются
  const columns = main(page).getByRole('group', { name: 'Деньги: колонки' });
  const column = columns.locator('button[tabindex="0"]');
  await expect(column).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/analytics\/cashflow\?/, async (route) => {
    await gate;
    await route.continue();
  });
  await main(page).getByRole('button', { name: 'Шаг: По месяцам' }).click();
  await page.getByRole('dialog', { name: 'Шаг' }).getByRole('button', { name: 'По кварталам' }).click();
  await expect(column).toHaveAttribute('aria-disabled', 'true');
  await column.click({ force: true });
  await expect(column).toHaveAttribute('aria-pressed', 'false');
  release();
  await expect(main(page).getByRole('group', { name: 'Деньги: колонки' }).locator('button[aria-disabled="true"]')).toHaveCount(0);

  // телефон: число — только изменённый шаг (1), pct=1 в графике не считается
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(main(page).getByRole('button', { name: /^Фильтры/ })).toHaveText('Фильтры · 1');
});

test('«Деньги»: нажатие на категорию оставляет только её; повторное, «×» и «Назад» снимают; сегмент стека; таблица и подкатегории (план 2026-10-20)', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Категория ${Date.now()}`);
  const s = await cashflowSetup(page, cid);
  // вторая операция «Аренды» и «Зарплата → Администраторы» (системная «Зарплата» есть у каждой компании)
  await apiPost(page, `${s.base}/operations`, { type: 'expense', paidAt: minutesAgo(15), accountId: s.account, amount: 50_000, lines: [{ categoryId: s.rent, amount: 50_000 }] });
  const tree = (await (await page.request.get(`${s.base}/categories`)).json()) as { expense: { id: number; name: string }[] };
  const salary = tree.expense.find((c) => c.name === 'Зарплата')!.id;
  const admins = (await apiPost(page, `${s.base}/categories`, { kind: 'expense', name: 'Администраторы', parentId: salary })).category.id as number;
  await apiPost(page, `${s.base}/operations`, { type: 'expense', paidAt: minutesAgo(10), accountId: s.account, amount: 30_000, lines: [{ categoryId: admins, amount: 30_000 }] });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/c/${cid}/analytics/cashflow`);
  const legend = main(page).getByRole('list', { name: 'Легенда: Списания', exact: true });
  const chip = main(page).getByText(/^Категория:/);
  await expect(legend.getByRole('listitem')).toHaveCount(2);

  // строка легенды кольца с клавиатуры: в адресе cat, плашка, в кольце и в списке операций — только «Аренда»;
  // кнопка не исчезает, пока грузится новый отчёт, — фокус остаётся на ней
  await legend.getByRole('button', { name: 'Аренда' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`[?&]cat=${s.rent}$`));
  await expect(chip).toHaveText('Категория: Аренда');
  await expect(legend.getByRole('listitem')).toHaveText([/^Аренда/]);
  await expect(legend.getByRole('button', { name: 'Аренда' })).toHaveAttribute('aria-pressed', 'true');
  await expect(legend.getByRole('button', { name: 'Аренда' })).toBeFocused();
  const list = (name: string) => main(page).locator('section[data-report-operations]').filter({ has: page.getByRole('heading', { level: 3, name, exact: true }) });
  await expect(list('Списания').getByRole('table', { name: 'Операции' }).locator('tbody tr')).toHaveCount(2);
  // повторное нажатие снимает выбор
  await legend.getByRole('button', { name: 'Аренда' }).click();
  await expect(page).not.toHaveURL(/cat=/);
  await expect(chip).toHaveCount(0);
  // «Назад» в браузере снимает выбор, «Вперёд» возвращает
  await legend.getByRole('button', { name: 'Аренда' }).click();
  await expect(chip).toBeVisible();
  await page.goBack();
  await expect(chip).toHaveCount(0);
  await page.goForward();
  await expect(chip).toHaveText('Категория: Аренда');
  // «×» плашки снимает выбор
  await main(page).getByRole('button', { name: 'Снять выбор категории' }).click();
  await expect(chip).toHaveCount(0);

  // сегмент стека — щелчком мышью; колонка вне сегментов и Enter — выбор колонки, а не категории (R4, R18)
  const segment = main(page).locator(`[data-segment="expense:category:${salary}"]`).first();
  // координаты щелчка — в окне: стек ниже первого экрана
  await segment.scrollIntoViewIfNeeded();
  const box = (await segment.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(chip).toHaveText('Категория: Зарплата');
  await main(page).getByRole('button', { name: 'Снять выбор категории' }).click();
  await expect(chip).toHaveCount(0);
  const columns = main(page).getByRole('group', { name: 'Списания по категориям: колонки' });
  // колонка того же месяца, что сегмент
  const index = await columns.getByRole('button').evaluateAll((els, x) => els.findIndex((el) => el.getBoundingClientRect().left <= x && x <= el.getBoundingClientRect().right), box.x + box.width / 2);
  const column = columns.getByRole('button').nth(index);
  await column.scrollIntoViewIfNeeded();
  const top = (await column.boundingBox())!;
  await page.mouse.click(top.x + 4, top.y + 4);
  await expect(column).toHaveAttribute('aria-pressed', 'true');
  await expect(chip).toHaveCount(0);
  // Enter на колонке — всегда колонка (R18): выбор снимается, категория не выбирается
  await column.focus();
  await page.keyboard.press('Enter');
  await expect(column).toHaveAttribute('aria-pressed', 'false');
  await expect(chip).toHaveCount(0);

  // таблица: шеврон раскрывает подкатегории, не выбирая; название выбирает категорию
  await page.goto(`/c/${cid}/analytics/cashflow?view=table`);
  const expand = report(page).getByRole('button', { name: 'Подкатегории «Зарплата»' });
  await expand.click();
  await expect(expand).toHaveAttribute('aria-expanded', 'true');
  await expect(page).not.toHaveURL(/cat=/);
  await expect(reportRow(page, 'Администраторы')).toHaveCount(1);
  await report(page).getByRole('button', { name: 'Зарплата', exact: true }).click();
  await expect(chip).toHaveText('Категория: Зарплата');
  await expect(reportRow(page, 'Аренда')).toHaveCount(0);
  // график по выбранной «Зарплате» — её подкатегории (решение 11)
  await page.goto(`/c/${cid}/analytics/cashflow?cat=${salary}`);
  await expect(legend.getByRole('listitem')).toHaveText([/^Администраторы/]);
});
