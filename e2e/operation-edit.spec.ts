import { expect, test, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('Логин').fill('admin');
  await page.getByPlaceholder('Пароль').fill('e2e-password-1');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible();
}

async function createCompany(page: Page, name: string): Promise<number> {
  await page.goto('/companies/new');
  await page.getByLabel('Название компании').fill(name);
  await page.getByRole('button', { name: 'Создать компанию' }).click();
  await expect(page).toHaveURL(/\/c\/\d+\/log$/);
  return Number(page.url().match(/\/c\/(\d+)\//)![1]);
}

const csrf = (page: Page) => ({ origin: new URL(page.url()).origin, 'x-requested-with': 'fetch' });

/** Запрос к API от имени вошедшего пользователя: кука сессии браузера и заголовки защиты от подделки. */
async function apiPost(page: Page, url: string, data: unknown) {
  const res = await page.request.post(url, { data, headers: csrf(page) });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return res.json();
}

/** Начало сегодняшнего дня по Алматы — APP_TIMEZONE e2e-сервера (с 01.03.2024 — UTC+5). */
function startOfTodayAlmaty(): number {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date());
  return Date.parse(`${day}T00:00:00+05:00`);
}

/**
 * Момент «сегодня по Алматы»: чем больше n (0 < n < 1000), тем раньше, но всегда сегодня и не в будущем
 * (инвариант 6) — проверка «сегодня» не падает сразу после полуночи.
 */
const todayAgo = (n: number) => {
  const start = startOfTodayAlmaty();
  return new Date(start + (Date.now() - start) * (1 - n / 1000)).toISOString();
};
const table = (page: Page) => page.getByRole('table', { name: 'Операции' });
const rows = (page: Page) => table(page).locator('tbody tr');
const editForm = (page: Page) => page.getByRole('dialog', { name: 'Изменить операцию' });

test('правка из журнала: клик по строке и с клавиатуры, в PATCH — только изменённое; «Дублировать», «Удалить»', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Правка ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  const rent = (await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Аренда' })).category.id;
  await apiPost(page, `${base}/operations`, {
    type: 'expense',
    paidAt: todayAgo(1),
    accountId: cash,
    amount: 30000,
    comment: 'старый',
    lines: [{ categoryId: rent, projectId: null, amount: 30000 }],
  });
  await page.reload();

  // клик по строке (по комментарию) открывает форму; блок с комментарием раскрыт
  await rows(page).first().getByText('старый').click();
  let dialog = editForm(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radio')).toHaveCount(0); // тип не меняется
  await expect(dialog.getByRole('button', { name: 'Счёт: Касса (KZT)' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Категория: Аренда' })).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toHaveValue('300');
  // форма ставит фокус в сумму кадр спустя — дождаться, прежде чем заполнять другие поля
  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
  await dialog.getByLabel('Комментарий').fill('новый');
  const patch = page.waitForRequest((r) => r.method() === 'PATCH');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  expect((await patch).postDataJSON()).toEqual({ version: 1, comment: 'новый' });
  await expect(dialog).toBeHidden();
  await expect(rows(page).first()).toContainText('новый');

  // с клавиатуры: кнопка в ячейке даты, Enter
  const open = table(page).getByRole('button', { name: /^Открыть операцию: сегодня/ });
  await open.focus();
  await page.keyboard.press('Enter');
  dialog = editForm(page);
  const amount = dialog.getByRole('textbox', { name: /^Сумма,/ });
  await expect(amount).toBeFocused();
  await amount.fill('300+50');
  await amount.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(rows(page).first()).toContainText(/350\s₸/);
  await expect(open).toBeFocused();

  // «Дублировать»: новая операция с теми же значениями; закрыть без сохранения — с вопросом
  await open.click();
  await editForm(page).getByRole('button', { name: 'Дублировать' }).click();
  dialog = page.getByRole('dialog', { name: 'Новая операция' });
  await expect(dialog.getByRole('status')).toHaveText('Это копия — проверьте и сохраните');
  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toHaveValue('350');
  await expect(dialog.getByRole('button', { name: 'Категория: Аренда' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(rows(page)).toHaveCount(2);

  // «Удалить» с подтверждением; Esc отменяет только подтверждение
  await rows(page).first().getByText('новый').click();
  dialog = editForm(page);
  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
  const remove = dialog.getByRole('button', { name: 'Удалить', exact: true });
  await remove.click();
  await expect(dialog.getByRole('button', { name: 'Не удалять' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('button', { name: 'Да, удалить' })).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(remove).toBeFocused();
  await remove.click();
  await dialog.getByRole('button', { name: 'Да, удалить' }).click();
  await expect(dialog).toBeHidden();
  await expect(rows(page)).toHaveCount(1);
  // строки, с которой открыли форму, больше нет — фокус на заголовке журнала
  await expect(page.getByRole('heading', { name: 'Журнал' })).toBeFocused();
});

test('операция на архивном счёте: сумма, дата и счёт заблокированы с подсказкой, «Удалить» недоступна, комментарий меняется', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Архив ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const old = (await apiPost(page, `${base}/accounts`, { name: 'Старый', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: todayAgo(2), accountId: old, amount: 10000, comment: 'приход' });
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(1), accountId: old, amount: 10000, comment: 'расход' });
  await apiPost(page, `${base}/accounts/${old}/archive`, {});
  await page.reload();

  await rows(page).filter({ hasText: 'приход' }).getByText('приход').click();
  const dialog = editForm(page);
  const amount = dialog.getByRole('textbox', { name: /^Сумма,/ });
  await expect(amount).toBeDisabled();
  await expect(amount).toHaveAccessibleDescription('счёт в архиве');
  await expect(dialog.getByRole('button', { name: 'Счёт: Старый (KZT) (в архиве)' })).toBeDisabled();
  await expect(dialog.getByLabel('Дата оплаты')).toBeDisabled();
  const remove = dialog.getByRole('button', { name: 'Удалить', exact: true });
  await expect(remove).toBeDisabled();
  await expect(remove).toHaveAccessibleDescription('Удалить нельзя: счёт в архиве («Старый»)');
  await dialog.getByLabel('Комментарий').fill('приход из кассы');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(rows(page).filter({ hasText: 'приход из кассы' })).toHaveCount(1);
});

// Правка операции на ширине 390 px (сценарий 4 §10) — в e2e/mobile.spec.ts (план 7).

test('перевод KZT → USD: новая сумма списания сохраняется вместе с прежней суммой зачисления', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Перевод правка ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 1000000 })).account.id;
  const usd = (await apiPost(page, `${base}/accounts`, { name: 'Валютный', currency: 'USD', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `${base}/fixed-rates`, { currency: 'USD', rate: '500', validFrom: '2020-01-01' });
  await apiPost(page, `${base}/operations`, { type: 'transfer', paidAt: todayAgo(1), accountId: cash, amount: 5000000, toAccountId: usd, toAmount: 10000 });
  await page.reload();

  await table(page).getByRole('button', { name: /^Открыть операцию/ }).click();
  const dialog = editForm(page);
  const amount = dialog.getByRole('textbox', { name: /^Сумма,/ });
  await expect(amount).toBeFocused();
  await expect(amount).toHaveValue('50000');
  await expect(dialog.getByRole('textbox', { name: /^Сумма зачисления/ })).toHaveValue('100');
  await amount.fill('500');
  await expect(dialog.getByText('Курс: 1 USD = 5 KZT')).toBeVisible();
  const patch = page.waitForRequest((r) => r.method() === 'PATCH');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  expect((await patch).postDataJSON()).toEqual({ version: 1, amount: 50000, toAmount: 10000 });
  await expect(dialog).toBeHidden();
  const row = table(page).locator('tbody tr').first();
  await expect(row).toContainText(/500\s₸/);
  await expect(row).toContainText(/100\s\$/);
  await expect(page.getByRole('navigation', { name: 'Счета' }).getByRole('link', { name: /^Касса/ })).toContainText(/₸\s9\s500$/);
});

test('фокус и закрытие формы: «×» → «Отменить» возвращает фокус на «×»; пока сохранение идёт, Esc и «×» окно не закрывают', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Фокус ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await page.reload();

  await page.getByRole('banner').getByRole('button', { name: 'Расход', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Новая операция' });
  const amount = dialog.getByRole('textbox', { name: /^Сумма,/ });
  await expect(amount).toBeFocused();
  await amount.fill('100');

  // «×» спрашивает о несохранённом; «Отменить» возвращает фокус на «×»
  const close = dialog.getByRole('button', { name: 'Закрыть', exact: true });
  await close.click();
  await page.getByRole('alertdialog', { name: 'Ваши данные не сохранятся' }).getByRole('button', { name: 'Отменить' }).click();
  await expect(close).toBeFocused();

  // ответ сервера задержан: пока запрос идёт, окно не закрывается ни по Esc, ни по «Отмена»
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/v1/companies/*/operations', async (route) => {
    if (route.request().method() === 'POST') await gate;
    await route.continue();
  });
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await close.click();
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('alertdialog', { name: 'Ваши данные не сохранятся' })).toHaveCount(0);
  release();
  await expect(dialog).toBeHidden();
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await expect(rows(page)).toHaveCount(1);
});

test('409: операцию изменили в другом окне — «Загрузить актуальную» и повтор; удалили — «Закрыть»', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Конфликт ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  const id = (await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(2), accountId: cash, amount: 10000, comment: 'первая' })).operation.id;
  const other = (await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(1), accountId: cash, amount: 5000, comment: 'вторая' })).operation.id;
  await page.reload();

  await rows(page).filter({ hasText: 'первая' }).getByText('первая').click();
  let dialog = editForm(page);
  const amount = dialog.getByRole('textbox', { name: /^Сумма,/ });
  await expect(amount).toHaveValue('100');
  await expect(amount).toBeFocused();
  // другой пользователь меняет комментарий (версия 1 → 2)
  const res = await page.request.patch(`${base}/operations/${id}`, { data: { version: 1, comment: 'чужая правка' }, headers: csrf(page) });
  expect(res.status()).toBe(200);
  await amount.fill('150');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Операция изменена другим пользователем');
  // поля были недоступны во время запроса — фокус переходит на действие в сообщении
  await expect(dialog.getByRole('button', { name: 'Загрузить актуальную' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Загрузить актуальную' }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByLabel('Комментарий')).toHaveValue('чужая правка');
  await expect(amount).toHaveValue('100');
  await expect(amount).toBeFocused();
  await amount.fill('150');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).toBeHidden();
  const edited = rows(page).filter({ hasText: 'чужая правка' });
  await expect(edited).toContainText(/150\s₸/);

  // операцию удалили, пока форма открыта
  await rows(page).filter({ hasText: 'вторая' }).getByText('вторая').click();
  dialog = editForm(page);
  // форма ставит фокус в сумму кадр спустя — дождаться, прежде чем заполнять комментарий
  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
  expect((await page.request.delete(`${base}/operations/${other}`, { headers: csrf(page) })).status()).toBe(200);
  await dialog.getByLabel('Комментарий').fill('поздно');
  await expect(dialog.getByLabel('Комментарий')).toHaveValue('поздно');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Операция удалена другим пользователем');
  await dialog.getByRole('alert').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(rows(page).filter({ hasText: 'вторая' })).toHaveCount(0);
  // строки, с которой открыли форму, больше нет — фокус на заголовке «Журнал»
  await expect(page.getByRole('heading', { name: 'Журнал' })).toBeFocused();
});

test('409: «Дублировать» убирает сообщение о конфликте; удалили при «Загрузить актуальную» — «Закрыть» ведёт фокус на «Журнал»', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Конфликт 2 ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  const first = (await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(2), accountId: cash, amount: 10000, comment: 'первая' })).operation.id;
  const second = (await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(1), accountId: cash, amount: 5000, comment: 'вторая' })).operation.id;
  await page.reload();

  // после 409 «Дублировать» открывает копию без старого сообщения
  await rows(page).filter({ hasText: 'первая' }).getByText('первая').click();
  let dialog = editForm(page);
  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
  expect((await page.request.patch(`${base}/operations/${first}`, { data: { version: 1, comment: 'чужая правка' }, headers: csrf(page) })).status()).toBe(200);
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('150');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Операция изменена другим пользователем');
  await dialog.getByRole('button', { name: 'Дублировать' }).click();
  const copy = page.getByRole('dialog', { name: 'Новая операция' });
  await expect(copy).toBeVisible();
  await expect(copy.getByRole('alert')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('alertdialog', { name: 'Ваши данные не сохранятся' }).getByRole('button', { name: 'Закрыть' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // изменили, затем удалили: «Загрузить актуальную» находит удаление — «Закрыть» возвращает фокус на заголовок
  await rows(page).filter({ hasText: 'вторая' }).getByText('вторая').click();
  dialog = editForm(page);
  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
  expect((await page.request.patch(`${base}/operations/${second}`, { data: { version: 1, comment: 'чужая правка 2' }, headers: csrf(page) })).status()).toBe(200);
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('70');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Операция изменена другим пользователем');
  expect((await page.request.delete(`${base}/operations/${second}`, { headers: csrf(page) })).status()).toBe(200);
  await dialog.getByRole('button', { name: 'Загрузить актуальную' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Операция удалена другим пользователем');
  await dialog.getByRole('alert').getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Журнал' })).toBeFocused();
});

test('операция только с файлом: блок «Проект, теги, комментарий, файл» раскрыт, файл виден', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Только файл ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  const id = (await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(1), accountId: cash, amount: 7000 })).operation.id;
  const up = await page.request.post(`${base}/operations/${id}/attachments`, {
    data: PNG,
    headers: { ...csrf(page), 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('чек.png') },
  });
  expect(up.status(), await up.text()).toBeLessThan(300);
  await page.reload();

  await rows(page).first().getByText(/70\s₸/).first().click();
  const dialog = editForm(page);
  await expect(dialog.getByRole('button', { name: 'Проект, теги, комментарий, файл' })).toHaveAttribute('aria-expanded', 'true');
  await expect(dialog.getByRole('link', { name: 'чек.png' })).toBeVisible();
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const HTML = Buffer.from('<html><script>alert(1)</script></html>');

test('файлы: выбранный до сохранения загружается после создания; скачивание, ошибки типа и размера, удаление', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Файлы ${Date.now()}`);
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await page.reload();

  // новая операция: файл ждёт сохранения
  await page.getByRole('banner').getByRole('button', { name: 'Расход', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Новая операция' });
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('100');
  await dialog.getByRole('button', { name: 'Проект, теги, комментарий, файл' }).click();
  await dialog.getByLabel('Комментарий').fill('с чеком');
  await dialog.getByLabel('Добавить файл').setInputFiles({ name: 'чек.png', mimeType: 'image/png', buffer: PNG });
  const files = dialog.getByRole('group', { name: 'Файлы' });
  await expect(files).toContainText('чек.png');
  await expect(files).toContainText('загрузится после сохранения');
  // больше 10 МБ — отказ до отправки
  await dialog.getByLabel('Добавить файл').setInputFiles({ name: 'большой.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
  await expect(files.getByRole('alert')).toContainText('«большой.pdf»: Файл больше 10 МБ');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).toBeHidden();

  // в правке: блок раскрыт (есть комментарий), файл в списке и скачивается как файл
  await rows(page).filter({ hasText: 'с чеком' }).getByText('с чеком').click();
  dialog = editForm(page);
  const link = dialog.getByRole('link', { name: 'чек.png' });
  await expect(link).toBeVisible();
  const download = page.waitForEvent('download');
  await link.click();
  expect((await download).suggestedFilename()).toBe('чек.png');

  // HTML под видом картинки сервер не принимает — ошибка у поля
  await dialog.getByLabel('Добавить файл').setInputFiles({ name: 'вирус.png', mimeType: 'image/png', buffer: HTML });
  await expect(dialog.getByRole('group', { name: 'Файлы' }).getByRole('alert')).toContainText('«вирус.png»: Допустимые файлы: PNG, JPG, WEBP, HEIC, PDF, XLSX, CSV');
  // загрузка в существующую операцию — сразу
  await dialog.getByLabel('Добавить файл').setInputFiles({ name: 'выписка.csv', mimeType: 'text/csv', buffer: Buffer.from('a;b\n1;2\n') });
  await expect(dialog.getByRole('link', { name: 'выписка.csv' })).toBeVisible();
  await expect(dialog.getByLabel('Добавить файл')).toBeFocused();

  // мягкое удаление с подтверждением
  const removeCheck = dialog.getByRole('button', { name: 'Удалить файл «чек.png»' });
  const confirm = dialog.getByRole('group', { name: /^Удаление: файл/ });
  // Esc отменяет только подтверждение: форма остаётся, фокус возвращается на «×»
  await removeCheck.click();
  await expect(confirm.getByRole('button', { name: 'Отмена' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Да, удалить' })).toHaveCount(0);
  await expect(removeCheck).toBeFocused();
  // «Отмена» тоже возвращает фокус на «×»
  await removeCheck.click();
  await confirm.getByRole('button', { name: 'Отмена' }).click();
  await expect(removeCheck).toBeFocused();
  await removeCheck.click();
  await dialog.getByRole('button', { name: 'Да, удалить' }).click();
  await expect(dialog.getByRole('link', { name: 'чек.png' })).toHaveCount(0);
  await expect(dialog.getByRole('link', { name: 'выписка.csv' })).toBeVisible();
  // после удаления фокус на «×» соседней строки
  await expect(dialog.getByRole('button', { name: 'Удалить файл «выписка.csv»' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('файл, который сервер не принял после создания: операция сохранена, форма переходит к её правке', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Файл после ${Date.now()}`);
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await page.reload();

  await page.getByRole('banner').getByRole('button', { name: 'Доход', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Новая операция' });
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('50');
  await dialog.getByRole('button', { name: 'Проект, теги, комментарий, файл' }).click();
  await dialog.getByLabel('Добавить файл').setInputFiles({ name: 'плохой.png', mimeType: 'image/png', buffer: HTML });
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  const edit = editForm(page);
  await expect(edit).toBeVisible();
  await expect(edit.getByRole('alert')).toContainText('Операция сохранена, но не загружено: «плохой.png»: Допустимые файлы');
  await expect(rows(page)).toHaveCount(1);
});
