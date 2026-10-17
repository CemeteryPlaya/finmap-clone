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
/** Момент n минут назад, но не раньше начала текущего года по Алматы: отчёт «За текущий год» не зависит от времени запуска. */
const minutesAgo = (n: number) => new Date(Math.max(Date.now() - n * 60_000, Date.parse(`${almatyYear()}-01-01T00:00:00+05:00`))).toISOString();

/**
 * Компания для «Выписки»: «Касса Клуб 1» (стартовый остаток 10 000 ₸) и «Kaspi», открыты в декабре прошлого года. До
 * текущего года — доход 5 000 ₸. В текущем году: доход 2 000 ₸ «Бар» («Клуб 1», «Сотрудник А», «Смена 1»), расход 300 ₸
 * «Аренда», перевод 1 000 ₸ на «Kaspi», перевод 400 ₸ с «Kaspi».
 */
async function statementSetup(page: Page, cid: number) {
  const base = `/api/v1/companies/${cid}`;
  const year = Number(almatyYear());
  const account = async (name: string, startingBalance: number) =>
    (await apiPost(page, `${base}/accounts`, { name, currency: 'KZT', openedAt: `${year - 1}-12-01`, startingBalance })).account.id as number;
  const cash = await account('Касса Клуб 1', 1_000_000);
  const kaspi = await account('Kaspi', 0);
  const bar = (await apiPost(page, `${base}/categories`, { kind: 'income', name: 'Бар' })).category.id as number;
  const rent = (await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Аренда' })).category.id as number;
  const project = (await apiPost(page, `${base}/projects`, { name: 'Клуб 1', templateKey: 'general' })).project.id as number;
  const staff = (await apiPost(page, `${base}/counterparties`, { type: 'employee', name: 'Сотрудник А' })).counterparty.id as number;
  const op = (body: Record<string, unknown>) => apiPost(page, `${base}/operations`, body);
  await op({ type: 'income', paidAt: `${year - 1}-12-15T06:00:00.000Z`, accountId: cash, amount: 500_000, lines: [{ categoryId: bar, amount: 500_000 }] });
  await op({
    type: 'income',
    paidAt: minutesAgo(50),
    accountId: cash,
    amount: 200_000,
    counterpartyId: staff,
    comment: 'Смена 1',
    lines: [{ categoryId: bar, projectId: project, amount: 200_000 }],
  });
  await op({ type: 'expense', paidAt: minutesAgo(40), accountId: cash, amount: 30_000, lines: [{ categoryId: rent, amount: 30_000 }] });
  await op({ type: 'transfer', paidAt: minutesAgo(30), accountId: cash, amount: 100_000, toAccountId: kaspi, toAmount: 100_000 });
  await op({ type: 'transfer', paidAt: minutesAgo(20), accountId: kaspi, amount: 40_000, toAccountId: cash, toAmount: 40_000 });
  return { base, cash, kaspi };
}

const summary = (page: Page, key: string) => main(page).locator(`[data-summary="${key}"] dd`);
const cells = (row: ReturnType<Page['locator']>) => ['amount', 'account', 'category'].map((c) => row.locator(`[data-column="${c}"]`));

test('«Выписка по счету»: карточка, сводка сходится с остатками после операций, переводы в обе стороны, правка операции, счёт и период в адресе, архивный счёт, Excel', async ({ page }) => {
  await login(page);
  const name = `ТОО Выписка ${Date.now()}`;
  const cid = await createCompany(page, name);
  const s = await statementSetup(page, cid);

  await page.goto(`/c/${cid}/analytics`);
  const card = main(page).getByRole('list', { name: 'Отчёты' }).getByRole('listitem').nth(2);
  await expect(card).toContainText('Выписка по счету');
  await card.getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/analytics/statement$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Выписка по счету' })).toBeVisible();

  // по умолчанию — первый неархивный счёт; сводка в его валюте: 15 000 + 2 000 - 300 + 400 - 1 000 = 16 100
  const accountMenu = main(page).getByRole('button', { name: /^Счёт: / });
  await expect(accountMenu).toHaveAccessibleName('Счёт: Касса Клуб 1');
  await expect(main(page).locator('[data-summary] dt')).toHaveText(['Остаток на начало', 'Поступлений', 'Списаний', 'Переводов на счёт', 'Переводов со счёта', 'Остаток на конец']);
  await expect(summary(page, 'start')).toHaveText(/^₸\s15\s000$/);
  await expect(summary(page, 'income')).toHaveText(/^₸\s2\s000$/);
  await expect(summary(page, 'expense')).toHaveText(/^₸\s300$/);
  await expect(summary(page, 'transfersIn')).toHaveText(/^₸\s400$/);
  await expect(summary(page, 'transfersOut')).toHaveText(/^₸\s1\s000$/);
  await expect(summary(page, 'end')).toHaveText(/^₸\s16\s100$/);
  // счёт открыт до начала периода (R2): строки «Счёт открыт…» нет
  await expect(main(page).locator('[data-opened-note]')).toHaveCount(0);

  // операции новые сверху; остаток после операции — по этому счёту; у перевода — «Перевод: {другой счёт}»
  const table = main(page).getByRole('table', { name: 'Операции: Касса Клуб 1' });
  await expect(table.getByRole('columnheader')).toHaveText(['Дата и время', 'Сумма', 'Остаток после операции', 'Контрагент', 'Категория', 'Проект', 'Комментарий']);
  const rows = table.locator('tbody tr');
  await expect(rows).toHaveCount(4);
  const expected: [RegExp, RegExp, string][] = [
    [/^⇄\s*Перевод: со счёта Kaspi на счёт Касса Клуб 1,\s*\+400\s₸$/, /^16\s100\s₸$/, 'Перевод: Kaspi'],
    [/\u22121\s000\s₸$/, /^15\s700\s₸$/, 'Перевод: Kaspi'],
    [/^\u2212300\s₸$/, /^16\s700\s₸$/, 'Аренда'],
    [/^\+2\s000\s₸$/, /^17\s000\s₸$/, 'Бар'],
  ];
  for (const [i, [amount, balance, category]] of expected.entries()) {
    const [a, b, c] = cells(rows.nth(i));
    await expect(a!).toHaveText(amount);
    await expect(b!).toHaveText(balance);
    await expect(c!).toHaveText(category);
  }
  await expect(rows.nth(3)).toContainText('Сотрудник А');
  await expect(rows.nth(3)).toContainText('Клуб 1');
  await expect(rows.nth(3)).toContainText('Смена 1');

  // щелчок по операции — её форма; после сохранения сводка и остатки пересчитаны
  await rows.nth(3).getByRole('button', { name: /^Открыть операцию/ }).click();
  const form = page.getByRole('dialog', { name: 'Доход', exact: true });
  const amount = form.getByRole('textbox', { name: /^Сумма,/ });
  await amount.fill('2500');
  await amount.press('Enter');
  await expect(form).toBeHidden();
  await expect(summary(page, 'income')).toHaveText(/^₸\s2\s500$/);
  await expect(summary(page, 'end')).toHaveText(/^₸\s16\s600$/);
  await expect(cells(rows.nth(0))[1]!).toHaveText(/^16\s600\s₸$/);

  // другой счёт: перевод со счёта — минус, на счёт — плюс; счёт — в адресе
  await accountMenu.click();
  await page.getByRole('dialog', { name: 'Счёт' }).getByRole('button', { name: 'Kaspi' }).click();
  await expect(page).toHaveURL(new RegExp(`/analytics/statement\\?account=${s.kaspi}$`));
  const kaspiRows = main(page).getByRole('table', { name: 'Операции: Kaspi' }).locator('tbody tr');
  await expect(kaspiRows).toHaveCount(2);
  await expect(cells(kaspiRows.nth(0))[0]!).toHaveText(/\u2212400\s₸$/);
  await expect(cells(kaspiRows.nth(0))[1]!).toHaveText(/^600\s₸$/);
  await expect(cells(kaspiRows.nth(0))[2]!).toHaveText('Перевод: Касса Клуб 1');
  await expect(cells(kaspiRows.nth(1))[0]!).toHaveText(/\+1\s000\s₸$/);
  await expect(summary(page, 'start')).toHaveText(/^₸\s0$/);
  await expect(summary(page, 'end')).toHaveText(/^₸\s600$/);

  // период без операций: начало = конец, список пуст; тип даты — «По дате платежа»; «Сбросить» оставляет счёт
  const period = main(page).getByRole('button', { name: /^Период:/ });
  await period.click();
  const periodPanel = page.getByRole('dialog', { name: 'Период' });
  await expect(periodPanel).toContainText('По дате платежа');
  await periodPanel.getByRole('button', { name: 'За предыдущий год' }).click();
  await expect(page).toHaveURL(new RegExp(`\\?period=lastYear&account=${s.kaspi}$`));
  await expect(main(page).getByText('Операций за период нет.')).toBeVisible();
  // счёт открыт внутри периода (R2): одна строка под сводкой; в текущем году её не было
  await expect(main(page).locator('[data-opened-note]')).toHaveText(`Счёт открыт 01.12.${Number(almatyYear()) - 1} — стартовый остаток учтён в остатке на начало`);
  await expect(summary(page, 'start')).toHaveText(/^₸\s0$/);
  await expect(summary(page, 'end')).toHaveText(/^₸\s0$/);
  await page.reload();
  await expect(period).toHaveAccessibleName('Период: За предыдущий год');
  await main(page).getByRole('button', { name: 'Сбросить' }).click();
  await expect(page).toHaveURL(new RegExp(`\\?account=${s.kaspi}$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Выписка по счету' })).toBeFocused();
  await expect(summary(page, 'end')).toHaveText(/^₸\s600$/);
  // после «Сбросить» период снова текущий год, счёт открыт раньше: строки про открытие нет
  await expect(main(page).locator('[data-opened-note]')).toHaveCount(0);

  // архивный счёт: в меню его нет; открыт ссылкой — выбран, с пометкой «(архив)»
  const old = (await apiPost(page, `${s.base}/accounts`, { name: 'Старая касса', currency: 'KZT', openedAt: '2025-01-01', startingBalance: 0 })).account.id as number;
  await apiPost(page, `${s.base}/accounts/${old}/archive`, {});
  await page.goto(`/c/${cid}/analytics/statement`);
  await accountMenu.click();
  await expect(page.getByRole('dialog', { name: 'Счёт' }).getByRole('button')).toHaveText([/^Касса Клуб 1/, 'Kaspi']);
  await page.keyboard.press('Escape');
  await page.goto(`/c/${cid}/analytics/statement?account=${old}`);
  await expect(accountMenu).toHaveAccessibleName('Счёт: Старая касса (архив)');
  await expect(summary(page, 'end')).toHaveText(/^₸\s0$/);
  // неизвестный счёт в адресе убирается с пометкой — выписка первого счёта
  await page.goto(`/c/${cid}/analytics/statement?account=999999`);
  await expect(main(page).getByText('Из ссылки убраны фильтры, которых больше нет: счета')).toBeVisible();
  await expect(accountMenu).toHaveAccessibleName('Счёт: Касса Клуб 1');
  await expect(page).toHaveURL(new RegExp(`/analytics/statement$`));

  // Excel — та же выписка
  const file = page.waitForEvent('download');
  await main(page).getByRole('link', { name: 'Скачать Excel' }).click();
  expect((await file).suggestedFilename()).toMatch(new RegExp(`^${name} - Выписка по счету - \\d{2}-\\d{2}-\\d{4} \\d{2}-\\d{2}\\.xlsx$`));
});

test('«Выписка по счету»: телефон — счёт и период в панели, сводка и карточки операций без прокрутки вбок, карточка открывает форму', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Выписка телефон ${Date.now()}`);
  await statementSetup(page, cid);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/c/${cid}/analytics/statement`);
  await expect(main(page).getByRole('button', { name: 'Счёт: Касса Клуб 1' })).toBeVisible();
  await expect(main(page).getByRole('button', { name: 'Период: За текущий год' })).toBeVisible();
  await expect(summary(page, 'end')).toHaveText(/^₸\s16\s100$/);
  const cards = main(page).getByRole('list', { name: 'Операции: Касса Клуб 1' }).getByRole('listitem');
  await expect(cards).toHaveCount(4);
  await expect(cards.nth(0)).toContainText('Перевод: Kaspi');
  await expect(cards.nth(0).locator('[data-card-line="amount"]')).toHaveText(/\+400\s₸$/);
  await expect(cards.nth(0).locator('[data-card-line="account"]')).toHaveText(/^Остаток: 16\s100\s₸$/);
  await expect(cards.nth(1).locator('[data-card-line="amount"]')).toHaveText(/\u22121\s000\s₸$/);
  // цвет суммы - по движению по счёту (R9): на счёт - как доход, со счёта - как расход
  await expect(cards.nth(0).locator('[data-card-line="amount"]')).toHaveClass(/text-income/);
  await expect(cards.nth(1).locator('[data-card-line="amount"]')).toHaveClass(/text-expense-strong/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await cards.nth(3).getByRole('button').click();
  await expect(page.getByRole('dialog', { name: 'Доход', exact: true })).toBeVisible();
});

test('«Выписка по счету»: список подгружается страницами - первая со сводкой, дальше по курсору, без повторов', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Выписка страницы ${Date.now()}`);
  await statementSetup(page, cid);
  // по 3 операции на страницу: у счёта «Касса Клуб 1» их четыре
  await page.route(/\/analytics\/statement(\/operations)?\?/, (route) => {
    const url = new URL(route.request().url());
    url.searchParams.set('limit', '3');
    return route.continue({ url: url.toString() });
  });
  const urls: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (/\/analytics\/statement(\/operations)?$/.test(u.pathname)) urls.push(`${u.pathname.endsWith('/operations') ? 'operations' : 'first'}:${u.searchParams.get('cursor') ? 'cursor' : 'no-cursor'}`);
  });
  await page.goto(`/c/${cid}/analytics/statement`);
  const rows = main(page).getByRole('table', { name: 'Операции: Касса Клуб 1' }).locator('tbody tr');
  await expect(summary(page, 'end')).toHaveText(/^₸\s16\s100$/);
  // низ списка на экране: вторая страница подгружается сама (наблюдатель), «Показать ещё» - запасной путь
  await expect(rows).toHaveCount(4);
  await expect(main(page).getByRole('button', { name: 'Показать ещё' })).toHaveCount(0);
  // последняя строка - самая старая операция: доход 2 000 ₸ «Бар», остаток после неё 17 000 ₸
  await expect(cells(rows.nth(3))[2]!).toHaveText('Бар');
  await expect(cells(rows.nth(3))[1]!).toHaveText(/^17\s000\s₸$/);
  // первая страница - без курсора, следующая - ровно один запрос по курсору (первая может уйти повторно при смене счёта и периода)
  expect(urls.filter((u) => u.startsWith('operations'))).toEqual(['operations:cursor']);
  expect(urls.filter((u) => u.startsWith('first')).every((u) => u === 'first:no-cursor')).toBe(true);
});

test('«Выписка по счету»: не загрузились теги - ошибка с «Повторить» вместо вечной «Загрузки», после повтора выписка открывается (R7)', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Выписка ошибка ${Date.now()}`);
  const s = await statementSetup(page, cid);
  let fail = true;
  await page.route(/\/api\/v1\/companies\/\d+\/tags(\?|$)/, (route) =>
    fail ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Теги недоступны' } }) }) : route.continue(),
  );
  // в адресе есть счёт: без справочника тегов адрес проверить нельзя - раньше здесь оставался скелетон
  await page.goto(`/c/${cid}/analytics/statement?account=${s.cash}`);
  const alert = main(page).getByRole('alert');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('Теги недоступны');
  fail = false;
  await main(page).getByRole('button', { name: 'Повторить' }).click();
  await expect(summary(page, 'end')).toHaveText(/^₸\s16\s100$/);
  await expect(main(page).getByRole('alert')).toHaveCount(0);
});
