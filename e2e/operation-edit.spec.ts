import { expect, test, type Locator, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('Логин').fill('admin');
  await page.getByPlaceholder('Пароль').fill('e2e-password-1');
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
/** Окно правки (§6.1 этапа 1.5): заголовок — тип операции. */
const editForm = (page: Page) => page.getByRole('dialog', { name: /^(Доход|Расход|Перевод)$/ });
/** Главная кнопка формы (§6.9 этапа 1.5). */
const submit = (scope: Locator) => scope.getByRole('button', { name: /^(Добавить (доход|расход|перевод)|Сохранить изменения)$/ });

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
  // окно правки называется по типу; счёт расхода — «Со счёта»; кнопка — «Сохранить изменения» (§6.1, §6.2, §6.9)
  await expect(page.getByRole('dialog', { name: 'Расход', exact: true })).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Со счёта', exact: true })).toHaveValue('Касса');
  await expect(submit(dialog)).toHaveText('Сохранить изменения');
  await expect(dialog.getByRole('button', { name: 'Добавить и создать похожий' })).toHaveCount(0);
  await expect(dialog.getByRole('combobox', { name: 'Категория', exact: true })).toHaveValue('Аренда');
  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toHaveValue('300');
  // форма ставит фокус в сумму кадр спустя — дождаться, прежде чем заполнять другие поля
  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
  await dialog.getByLabel('Комментарий').fill('новый');
  const patch = page.waitForRequest((r) => r.method() === 'PATCH');
  await submit(dialog).click();
  expect((await patch).postDataJSON()).toEqual({ version: 1, comment: 'новый' });
  await expect(dialog).toBeHidden();
  await expect(rows(page).first()).toContainText('новый');

  // с клавиатуры: кнопка в ячейке даты, Enter
  const open = table(page).getByRole('button', { name: /^Открыть операцию: \d{1,2} \S+ \d{4}, Сегодня/ });
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
  await editForm(page).getByRole('button', { name: 'Дублировать платёж' }).click();
  dialog = page.getByRole('dialog', { name: 'Новый расход' });
  await expect(dialog.getByRole('status').filter({ hasText: 'Это копия' })).toHaveText('Это копия — проверьте и сохраните');
  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toHaveValue('350');
  await expect(dialog.getByRole('combobox', { name: 'Категория', exact: true })).toHaveValue('Аренда');
  await submit(dialog).click();
  await expect(dialog).toBeHidden();
  await expect(rows(page)).toHaveCount(2);

  // «Удалить платёж» — вложенное окно «Удалить платёж?»: Esc закрывает только его, фокус — на строке (Review Focus 2)
  await rows(page).first().getByText('новый').click();
  dialog = editForm(page);
  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
  const remove = dialog.getByRole('button', { name: 'Удалить платёж' });
  await remove.click();
  const confirm = page.getByRole('alertdialog', { name: 'Удалить платёж?' });
  await expect(confirm.getByRole('button')).toHaveText(['×', 'Отменить', 'Удалить']);
  await expect(confirm.getByRole('button', { name: 'Отменить' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('alertdialog', { name: 'Ваши данные не сохранятся' })).toHaveCount(0);
  await expect(remove).toBeFocused();
  await remove.click();
  await confirm.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(rows(page)).toHaveCount(1);
  // строки, с которой открыли форму, больше нет — фокус на заголовке журнала
  await expect(page.getByRole('heading', { name: 'Журнал' })).toBeFocused();
});

test('«Удалить платёж»: сервер отказал — окно остаётся, сообщение об ошибке, фокус снова на строке «Удалить платёж»', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Отказ удаления ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: todayAgo(1), accountId: cash, amount: 10000, comment: 'приход' });
  await page.reload();
  await page.route(/\/operations\/\d+$/, (route) =>
    route.request().method() === 'DELETE'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Не удалось удалить платёж' } }) })
      : route.fallback(),
  );

  await rows(page).first().getByText('приход').click();
  const dialog = editForm(page);
  const remove = dialog.getByRole('button', { name: 'Удалить платёж' });
  await remove.click();
  await page.getByRole('alertdialog', { name: 'Удалить платёж?' }).getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Не удалось удалить платёж');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(remove).toBeEnabled();
  await expect(remove).toBeFocused();
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
  const account = dialog.getByRole('combobox', { name: 'На счёт', exact: true });
  await expect(account).toHaveValue('Старый (в архиве)');
  await expect(account).toBeDisabled();
  await expect(dialog.getByLabel('Дата поступления денег')).toBeDisabled();
  // «Удалить платёж» видна и в порядке Tab, но неактивна с причиной; нажатие ничего не делает (Review Focus 3)
  const remove = dialog.getByRole('button', { name: 'Удалить платёж' });
  await expect(remove).toHaveAttribute('aria-disabled', 'true');
  await expect(remove).toHaveAccessibleDescription('Удалить нельзя: счёт в архиве («Старый»)');
  await remove.dispatchEvent('click');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  // «Изменить в перевод» — тоже видна, но неактивна с причиной; нажатие форму не перестраивает (Review Focus 3)
  const toTransfer = dialog.getByRole('button', { name: 'Изменить в перевод' });
  await expect(toTransfer).toHaveAttribute('aria-disabled', 'true');
  await expect(toTransfer).toHaveAccessibleDescription('Изменить в перевод нельзя: счёт в архиве («Старый»)');
  await toTransfer.dispatchEvent('click');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Доход', exact: true })).toBeVisible();
  await dialog.getByLabel('Комментарий').fill('приход из кассы');
  await submit(dialog).click();
  await expect(dialog).toBeHidden();
  await expect(rows(page).filter({ hasText: 'приход из кассы' })).toHaveCount(1);
});

test('«Изменить в перевод»: расход с категорией, контрагентом и датой сделки — подтверждение со списком, форма перевода, в PATCH — смена типа и явные поля', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО В перевод ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 100000 })).account.id;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  const rent = (await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Аренда' })).category.id;
  const alina = (await apiPost(page, `${base}/counterparties`, { type: 'supplier', name: 'Алина' })).counterparty.id;
  const club = (await apiPost(page, `${base}/projects`, { name: 'Клуб 1', templateKey: 'general', templateParams: {} })).project.id;
  await apiPost(page, `${base}/operations`, {
    type: 'expense',
    paidAt: todayAgo(1),
    accrualDate: '2026-09-01',
    accountId: cash,
    amount: 30000,
    counterpartyId: alina,
    comment: 'в Kaspi',
    lines: [{ categoryId: rent, projectId: club, amount: 30000 }],
  });
  await page.reload();

  await rows(page).first().getByText('в Kaspi').click();
  const dialog = page.getByRole('dialog', { name: 'Расход', exact: true });
  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
  // строка 4 — между «Добавить проект, тег, комментарий, файл» и «Дублировать платёж», как на снимке Finmap 05 (§6.7)
  await expect(dialog.getByRole('button', { name: /^(Добавить проект, тег, комментарий, файл|Изменить в перевод|Дублировать платёж|Удалить платёж)$/ })).toHaveText([
    'Добавить проект, тег, комментарий, файл',
    'Изменить в перевод',
    'Дублировать платёж',
    'Удалить платёж',
  ]);
  const convert = dialog.getByRole('button', { name: 'Изменить в перевод' });
  await convert.click();
  // подтверждение перечисляет, что будет убрано; «Отменить | Изменить», фокус на «Отменить» (§6.8, §11)
  const confirm = page.getByRole('alertdialog', { name: 'Изменить в перевод?' });
  await expect(confirm).toHaveAccessibleDescription('Будут убраны: категория «Аренда», контрагент «Алина», дата сделки.');
  await expect(confirm.getByRole('button')).toHaveText(['×', 'Отменить', 'Изменить']);
  await expect(confirm.getByRole('button', { name: 'Отменить' })).toBeFocused();
  // Esc закрывает только подтверждение: форма — по-прежнему расход, фокус на строке
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('alertdialog', { name: 'Ваши данные не сохранятся' })).toHaveCount(0);
  await expect(convert).toBeFocused();
  // «Отменить» — так же (R2): расход не изменился, фокус снова на строке
  await convert.click();
  await confirm.getByRole('button', { name: 'Отменить' }).click();
  await expect(confirm).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Категория', exact: true })).toHaveValue('Аренда');
  await expect(convert).toBeFocused();

  await convert.click();
  await confirm.getByRole('button', { name: 'Изменить', exact: true }).click();
  // форма на месте стала переводом: «Со счёта» — прежний счёт, «На счёт» пусто и в фокусе; проект и комментарий остались
  const transfer = page.getByRole('dialog', { name: 'Перевод', exact: true });
  await expect(transfer).toBeVisible();
  const to = transfer.getByRole('combobox', { name: 'На счёт', exact: true });
  await expect(to).toBeFocused();
  await expect(to).toHaveValue('');
  await expect(transfer.getByRole('combobox', { name: 'Со счёта', exact: true })).toHaveValue('Касса');
  await expect(transfer.getByRole('textbox', { name: /^Сумма,/ })).toHaveValue('300');
  await expect(transfer.getByRole('combobox', { name: 'Проект', exact: true })).toHaveValue('Клуб 1');
  await expect(transfer.getByLabel('Комментарий')).toHaveValue('в Kaspi');
  await expect(transfer.getByRole('combobox', { name: 'Категория', exact: true })).toHaveCount(0);
  await expect(transfer.getByRole('button', { name: 'Дата сделки отличается' })).toHaveCount(0);
  await expect(transfer.getByRole('button', { name: 'Изменить в перевод' })).toHaveCount(0);
  await expect(submit(transfer)).toHaveText('Сохранить изменения');

  // «×» с изменениями — обычный вопрос; «Отменить» оставляет форму
  await transfer.getByRole('button', { name: 'Закрыть', exact: true }).click();
  const ask = page.getByRole('alertdialog', { name: 'Ваши данные не сохранятся' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Отменить' }).click();
  await expect(transfer).toBeVisible();

  await to.click();
  await transfer.getByRole('option', { name: 'Kaspi', exact: true }).click();
  const patch = page.waitForRequest((r) => r.method() === 'PATCH');
  await submit(transfer).click();
  expect((await patch).postDataJSON()).toEqual({
    version: 1,
    type: 'transfer',
    accrualDate: null,
    toAccountId: kaspi,
    counterpartyId: null,
    lines: [{ categoryId: null, projectId: club, amount: 30000 }],
  });
  await expect(transfer).toBeHidden();
  await expect(rows(page).first()).toContainText('Касса → Kaspi');
  // балансы обоих счетов (Review Focus 5): «Касса» — 1000 минус 300, «Kaspi» — 300
  const panel = page.getByRole('navigation', { name: 'Счета' });
  await expect(panel.getByRole('link', { name: /^Касса/ })).toContainText(/₸\s700$/);
  await expect(panel.getByRole('link', { name: /^Kaspi/ })).toContainText(/₸\s300$/);
  // история: «Изменён перевод», «Тип: Расход → Перевод» (§10.1 п. 7)
  await page.getByRole('banner').getByRole('button', { name: 'История действий' }).click();
  const items = page.getByRole('dialog', { name: 'История действий' }).getByRole('list', { name: 'Последние действия' }).getByRole('listitem');
  await expect(items.first()).toContainText('Изменён перевод');
  await expect(items.first()).toContainText('Тип: Расход → Перевод');
});

test('«Изменить в перевод» без потерь — сразу форма перевода; отказ сервера в смене типа виден; «Дублировать платёж» после этого — новый перевод (R2)', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Дубль перевода ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 100000 })).account.id;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(1), accountId: cash, amount: 20000, comment: 'без категории' });
  await page.reload();

  await rows(page).first().getByText('без категории').click();
  const dialog = page.getByRole('dialog', { name: 'Расход', exact: true });
  await dialog.getByRole('button', { name: 'Изменить в перевод' }).click();
  // убирать нечего — подтверждения нет, форма сразу перевод
  const transfer = page.getByRole('dialog', { name: 'Перевод', exact: true });
  await expect(transfer).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  const to = transfer.getByRole('combobox', { name: 'На счёт', exact: true });
  await expect(to).toBeFocused();
  await to.click();
  await transfer.getByRole('option', { name: 'Kaspi', exact: true }).click();

  // сервер отказал в смене типа (ошибка поля type): поля «Тип» в форме нет — причина видна в сообщении формы
  await page.route('**/operations/*', (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'VALIDATION', message: 'Проверьте заполнение полей', fields: { type: 'Тип можно сменить только на «Перевод»' } } }),
        })
      : route.fallback(),
  );
  await submit(transfer).click();
  await expect(transfer.getByRole('alert')).toHaveText('Тип можно сменить только на «Перевод»');
  await expect(transfer).toBeVisible();
  await page.unroute('**/operations/*');

  await transfer.getByRole('button', { name: 'Дублировать платёж' }).click();
  const copy = page.getByRole('dialog', { name: 'Новый перевод', exact: true });
  await expect(copy).toBeVisible();
  await expect(copy.getByRole('combobox', { name: 'Со счёта', exact: true })).toHaveValue('Касса');
  await expect(copy.getByRole('combobox', { name: 'На счёт', exact: true })).toHaveValue('Kaspi');
  await expect(submit(copy)).toHaveText('Добавить перевод');
  const post = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/operations'));
  await submit(copy).click();
  expect((await post).postDataJSON()).toMatchObject({ type: 'transfer', accountId: cash, toAccountId: kaspi, amount: 20000, comment: 'без категории' });
  await expect(copy).toBeHidden();
  // исходный расход не изменился: копия — отдельная операция
  await expect(rows(page).filter({ hasText: 'Касса → Kaspi' })).toHaveCount(1);
  await expect(rows(page).filter({ hasText: 'без категории' })).toHaveCount(2);
});

test('«Изменить в перевод»: доход на долларовом счёте без категории — сразу форма перевода; «Со счёта» в тенге очищает сумму, прежняя сумма — «Сумма зачисления»', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Доход в перевод ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 10000000 })).account.id;
  const usd = (await apiPost(page, `${base}/accounts`, { name: 'Валютный', currency: 'USD', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `${base}/fixed-rates`, { currency: 'USD', rate: '500', validFrom: '2020-01-01' });
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: todayAgo(1), accountId: usd, amount: 10000, comment: 'обмен' });
  await page.reload();

  await rows(page).first().getByText('обмен').click();
  const dialog = page.getByRole('dialog', { name: 'Доход', exact: true });
  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
  await dialog.getByRole('button', { name: 'Изменить в перевод' }).click();
  // терять нечего — подтверждения нет; прежний счёт — «На счёт», фокус на пустом «Со счёта» (§6.8)
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  const transfer = page.getByRole('dialog', { name: 'Перевод', exact: true });
  const from = transfer.getByRole('combobox', { name: 'Со счёта', exact: true });
  await expect(from).toBeFocused();
  await expect(from).toHaveValue('');
  await expect(transfer.getByRole('combobox', { name: 'На счёт', exact: true })).toHaveValue('Валютный');
  // «Со счёта» в тенге: сумму списания нужно ввести, прежние $100 — «Сумма зачисления» (Review Focus 1)
  await from.click();
  await transfer.getByRole('option', { name: 'Касса', exact: true }).click();
  const amount = transfer.getByRole('textbox', { name: /^Сумма,/ });
  await expect(amount).toHaveValue('');
  await expect(transfer.getByRole('textbox', { name: /^Сумма зачисления/ })).toHaveValue('100');
  await amount.fill('50000');
  await expect(transfer.getByText('Курс: 1 USD = 500 KZT')).toBeVisible();
  const patch = page.waitForRequest((r) => r.method() === 'PATCH');
  await submit(transfer).click();
  expect((await patch).postDataJSON()).toEqual({ version: 1, type: 'transfer', accountId: cash, amount: 5000000, toAccountId: usd, toAmount: 10000, lines: [] });
  await expect(transfer).toBeHidden();
  const row = rows(page).first();
  await expect(row).toContainText('Касса → Валютный');
  await expect(row).toContainText(/100\s\$/);
  await expect(page.getByRole('navigation', { name: 'Счета' }).getByRole('link', { name: /^Касса/ })).toContainText(/₸\s50\s000$/);
});

test('«Изменить в перевод» и 409: операцию изменили в другом окне — «Загрузить актуальную» возвращает расход, строку 4 и заголовок', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Перевод 409 ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 100000 })).account.id;
  await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' });
  const op = (await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(1), accountId: cash, amount: 10000, comment: 'старое' })).operation;
  await page.reload();

  await rows(page).first().getByText('старое').click();
  const dialog = page.getByRole('dialog', { name: 'Расход', exact: true });
  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
  await dialog.getByRole('button', { name: 'Изменить в перевод' }).click();
  const transfer = page.getByRole('dialog', { name: 'Перевод', exact: true });
  const to = transfer.getByRole('combobox', { name: 'На счёт', exact: true });
  await expect(to).toBeFocused();
  await to.click();
  await transfer.getByRole('option', { name: 'Kaspi', exact: true }).click();
  // другой пользователь успел поменять комментарий
  const other = await page.request.patch(`${base}/operations/${op.id}`, { data: { version: 1, comment: 'другое окно' }, headers: csrf(page) });
  expect(other.status()).toBe(200);
  await submit(transfer).click();
  await expect(transfer.getByRole('alert').filter({ hasText: 'Операция изменена другим пользователем' })).toBeVisible();
  await transfer.getByRole('button', { name: 'Загрузить актуальную' }).click();
  // форма снова — расход с актуальными данными; строка «Изменить в перевод» на месте (Review Focus 4)
  const back = page.getByRole('dialog', { name: 'Расход', exact: true });
  await expect(back).toBeVisible();
  await expect(back.getByRole('status').filter({ hasText: 'Загружена актуальная' })).toHaveText('Загружена актуальная версия — внесите изменения заново');
  await expect(back.getByLabel('Комментарий')).toHaveValue('другое окно');
  await expect(back.getByRole('combobox', { name: 'Со счёта', exact: true })).toHaveValue('Касса');
  await expect(back.getByRole('button', { name: 'Изменить в перевод' })).toBeVisible();
  await back.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(back).toBeHidden();
  await expect(rows(page).first()).not.toContainText('→');
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
  await submit(dialog).click();
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
  const dialog = page.getByRole('dialog', { name: 'Новый расход' });
  const amount = dialog.getByRole('textbox', { name: /^Сумма,/ });
  const account = dialog.getByRole('combobox', { name: 'Со счёта', exact: true });
  await expect(account).toBeFocused();
  await account.click();
  await dialog.getByRole('option', { name: 'Касса', exact: true }).click();
  await amount.fill('100');

  // «×» спрашивает о несохранённом; «Отменить» возвращает фокус на «×»
  const close = dialog.getByRole('button', { name: 'Закрыть', exact: true });
  await close.click();
  await page.getByRole('alertdialog', { name: 'Ваши данные не сохранятся' }).getByRole('button', { name: 'Отменить' }).click();
  await expect(close).toBeFocused();

  // ответ сервера задержан: пока запрос идёт, окно не закрывается ни по Esc, ни по «×»
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/v1/companies/*/operations', async (route) => {
    if (route.request().method() === 'POST') await gate;
    await route.continue();
  });
  await submit(dialog).click();
  await expect(submit(dialog)).toBeDisabled();
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
  await submit(dialog).click();
  await expect(dialog.getByRole('alert')).toContainText('Операция изменена другим пользователем');
  // поля были недоступны во время запроса — фокус переходит на действие в сообщении
  await expect(dialog.getByRole('button', { name: 'Загрузить актуальную' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Загрузить актуальную' }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByLabel('Комментарий')).toHaveValue('чужая правка');
  await expect(amount).toHaveValue('100');
  await expect(amount).toBeFocused();
  await amount.fill('150');
  await submit(dialog).click();
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
  await submit(dialog).click();
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
  await submit(dialog).click();
  await expect(dialog.getByRole('alert')).toContainText('Операция изменена другим пользователем');
  await dialog.getByRole('button', { name: 'Дублировать платёж' }).click();
  const copy = page.getByRole('dialog', { name: 'Новый расход' });
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
  await submit(dialog).click();
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
  await expect(dialog.getByRole('button', { name: 'Добавить проект, тег, комментарий, файл' })).toHaveAttribute('aria-expanded', 'true');
  await expect(dialog.getByRole('link', { name: 'чек.png' })).toBeVisible();
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const HTML = Buffer.from('<html><script>alert(1)</script></html>');

test('файлы: выбранный до сохранения загружается после создания; скачивание, ошибки типа и размера, удаление', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Файлы ${Date.now()}`);
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await page.reload();

  // загрузок на сервер до сохранения операции быть не должно (сброс текста и отклонённых файлов ничего не отправляет)
  let uploads = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/attachments$/.test(new URL(r.url()).pathname)) uploads += 1;
  });
  // новая операция: файл ждёт сохранения
  await page.getByRole('banner').getByRole('button', { name: 'Расход', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Новый расход' });
  await dialog.getByRole('combobox', { name: 'Со счёта', exact: true }).click();
  await dialog.getByRole('option', { name: 'Касса', exact: true }).click();
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('100');
  await dialog.getByRole('button', { name: 'Добавить проект, тег, комментарий, файл' }).click();
  await dialog.getByLabel('Комментарий').fill('с чеком');
  await dialog.getByLabel('Добавить файл').setInputFiles({ name: 'чек.png', mimeType: 'image/png', buffer: PNG });
  const files = dialog.getByRole('group', { name: 'Файлы' });
  await expect(files).toContainText('чек.png');
  await expect(files).toContainText('загрузится после сохранения');
  // перетаскивание в зону «Перетяните сюда файл (до 10 МБ) или выберите файл» (§6.7): файл ждёт сохранения
  const zone = dialog.locator('[data-drop-zone]');
  await expect(zone).toContainText('Перетяните сюда файл (до 10 МБ) или выберите файл');
  const dropped = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['a;b\n1;2\n'], 'перетащен.csv', { type: 'text/csv' }));
    return dt;
  });
  // над зоной она подсвечена; уход и сброс снимают подсветку
  await zone.dispatchEvent('dragover', { dataTransfer: dropped });
  await expect(zone).toHaveClass(/bg-income-soft/);
  await zone.dispatchEvent('dragleave', { dataTransfer: dropped });
  await expect(zone).not.toHaveClass(/bg-income-soft/);
  await zone.dispatchEvent('dragover', { dataTransfer: dropped });
  await expect(zone).toHaveClass(/bg-income-soft/);
  await zone.dispatchEvent('drop', { dataTransfer: dropped });
  await expect(zone).not.toHaveClass(/bg-income-soft/);
  await expect(files).toContainText('перетащен.csv');
  // перетаскивание текста — не файл: ничего не добавляется (Review Focus 5)
  const text = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'просто текст');
    return dt;
  });
  const fileButtons = files.getByRole('button', { name: /^(Убрать|Удалить) файл/ });
  await expect(fileButtons).toHaveCount(2);
  await zone.dispatchEvent('dragover', { dataTransfer: text });
  await expect(zone).not.toHaveClass(/bg-income-soft/);
  await zone.dispatchEvent('drop', { dataTransfer: text });
  await expect(fileButtons).toHaveCount(2);
  expect(uploads).toBe(0);
  // файл неподходящего типа и больше 10 МБ при сбросе отклоняются так же, как в окне выбора файла
  const bad = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'скрипт.exe', { type: 'application/x-msdownload' }));
    dt.items.add(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'огромный.pdf', { type: 'application/pdf' }));
    return dt;
  });
  await zone.dispatchEvent('drop', { dataTransfer: bad });
  await expect(files.getByRole('alert')).toContainText('«скрипт.exe»: Допустимые файлы: PNG, JPG, WEBP, HEIC, PDF, XLSX, CSV');
  await expect(files.getByRole('alert')).toContainText('«огромный.pdf»: Файл больше 10 МБ');
  await expect(fileButtons).toHaveCount(2);
  // больше 10 МБ — отказ до отправки
  await dialog.getByLabel('Добавить файл').setInputFiles({ name: 'большой.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
  await expect(files.getByRole('alert')).toContainText('«большой.pdf»: Файл больше 10 МБ');
  await submit(dialog).click();
  await expect(dialog).toBeHidden();

  // в правке: блок раскрыт (есть комментарий), файл в списке и скачивается как файл
  await rows(page).filter({ hasText: 'с чеком' }).getByText('с чеком').click();
  dialog = editForm(page);
  const link = dialog.getByRole('link', { name: 'чек.png' });
  await expect(link).toBeVisible();
  // перетащенный до сохранения файл тоже загрузился
  await expect(dialog.getByRole('link', { name: 'перетащен.csv' })).toBeVisible();
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
  await expect(dialog.getByRole('button', { name: 'Удалить файл «перетащен.csv»' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('файл, брошенный на форму при свёрнутом блоке: блок раскрывается, файл добавляется; вне формы страница остаётся', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Сброс на форму ${Date.now()}`);
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await page.reload();

  await page.getByRole('banner').getByRole('button', { name: 'Расход', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Новый расход' });
  const more = dialog.getByRole('button', { name: 'Добавить проект, тег, комментарий, файл' });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  const dropped = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['a;b\n1;2\n'], 'брошен.csv', { type: 'text/csv' }));
    return dt;
  });
  await dialog.getByRole('form', { name: 'Операция' }).dispatchEvent('drop', { dataTransfer: dropped });
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await expect(dialog.getByRole('group', { name: 'Файлы' })).toContainText('брошен.csv');
  // файл, брошенный мимо формы, не открывается браузером: событие отменено
  const prevented = await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'мимо.csv', { type: 'text/csv' }));
    const ev = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  expect(prevented).toBe(true);
  await expect(dialog).toBeVisible();
});

test('файл, который сервер не принял после создания: операция сохранена, форма переходит к её правке', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Файл после ${Date.now()}`);
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await page.reload();

  await page.getByRole('banner').getByRole('button', { name: 'Доход', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Новый доход' });
  await dialog.getByRole('combobox', { name: 'На счёт', exact: true }).click();
  await dialog.getByRole('option', { name: 'Касса', exact: true }).click();
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('50');
  await dialog.getByRole('button', { name: 'Добавить проект, тег, комментарий, файл' }).click();
  await dialog.getByLabel('Добавить файл').setInputFiles({ name: 'плохой.png', mimeType: 'image/png', buffer: HTML });
  await submit(dialog).click();
  const edit = editForm(page);
  await expect(edit).toBeVisible();
  await expect(edit.getByRole('alert')).toContainText('Операция сохранена, но не загружено: «плохой.png»: Допустимые файлы');
  await expect(rows(page)).toHaveCount(1);
});

test('правка времени оплаты (§2.3): поле показывает время операции; без смены времени секунды не трогаются; время руками — ЧЧ:ММ:00', async ({ page }) => {
  // в первые минуты суток время операции и «00:00» могут совпасть до минуты — PATCH был бы пустым
  const almatyHm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Almaty', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  test.skip(almatyHm < '00:03', 'в первые минуты суток «00:00» совпадает со временем операции');
  await login(page);
  const cid = await createCompany(page, `ТОО Время правка ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  const paidAt = todayAgo(100);
  const id = (await apiPost(page, `${base}/operations`, { type: 'expense', paidAt, accountId: cash, amount: 10000, comment: 'время' })).operation.id;
  await page.reload();
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date());
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Almaty', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(paidAt));

  await rows(page).first().getByText('время').click();
  const dialog = editForm(page);
  const when = dialog.getByRole('button', { name: /^Указать дату списания:/ });
  await expect(when).toHaveAccessibleName(`Указать дату списания: Сегодня, ${day.split('-').reverse().join('.')}, ${hm}`);
  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
  // правка без смены даты и времени — paidAt не уходит: секунды операции сохраняются (Review Focus 1)
  await dialog.getByLabel('Комментарий').fill('время 2');
  let patch = page.waitForRequest((r) => r.method() === 'PATCH');
  await submit(dialog).click();
  expect((await patch).postDataJSON()).toEqual({ version: 1, comment: 'время 2' });
  await expect(dialog).toBeHidden();

  // время руками — ЧЧ:ММ:00 (00:00 сегодня всегда не позже «сейчас»)
  await rows(page).first().getByText('время 2').click();
  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
  await when.click();
  const panel = page.getByRole('dialog', { name: 'Указать дату списания: календарь' });
  await panel.getByLabel('Время').fill('00:00');
  await panel.getByLabel('Время').press('Enter');
  await expect(panel).toBeHidden();
  const midnight = new Date(`${day}T00:00:00+05:00`).toISOString();
  patch = page.waitForRequest((r) => r.method() === 'PATCH');
  await submit(dialog).click();
  expect((await patch).postDataJSON()).toEqual({ version: 2, paidAt: midnight });
  await expect(dialog).toBeHidden();
  const saved = (await (await page.request.get(`${base}/operations/${id}`)).json()).operation as { paidAt: string };
  expect(saved.paidAt).toBe(midnight);
});

/** «ЧЧ:ММ» сейчас по Алматы. */
const almatyHm = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Almaty', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
const almatyDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date());
const shiftDay = (iso: string, days: number) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
const ruDay = (iso: string) => iso.split('-').reverse().join('.');
const GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const cellName = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return `${d} ${GENITIVE[m - 1]} ${y}`;
};

test('правка: перенос даты на сегодня при позднем прежнем времени — строка «Время» в панели показывает «сейчас», как и поле', async ({ page }) => {
  test.skip(almatyHm() < '00:03' || almatyHm() >= '23:58', 'у границы суток фиксированное «сейчас» теста уходит в другой день');
  test.skip(almatyDay().endsWith('-01'), 'первого числа вчерашний день — прошлый месяц, вне периода журнала по умолчанию');
  const today = almatyDay();
  const eve = shiftDay(today, -1);
  const fixed = new Date(`${today}T12:34:56+05:00`);
  await page.clock.install({ time: fixed });
  await page.clock.setFixedTime(fixed);
  await login(page);
  const cid = await createCompany(page, `ТОО Время строка ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: `${eve}T18:15:00+05:00`, accountId: cash, amount: 10000, comment: 'вчера вечером' });
  await page.reload();

  await rows(page).first().getByText('вчера вечером').click();
  const dialog = editForm(page);
  const when = dialog.getByRole('button', { name: /^Указать дату списания:/ });
  await expect(when).toHaveAccessibleName(`Указать дату списания: Вчера, ${ruDay(eve)}, 18:15`);
  await when.click();
  const panel = page.getByRole('dialog', { name: 'Указать дату списания: календарь' });
  await expect(panel.getByLabel('Время')).toHaveValue('18:15');
  // сегодня 18:15 ещё не наступило: сохранится «сейчас» — его и поле, и строка «Время»
  await panel.getByRole('gridcell', { name: cellName(today), exact: true }).click();
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel('Время')).toHaveValue('12:34');
  await page.keyboard.press('Escape');
  await expect(when).toHaveAccessibleName(`Указать дату списания: Сегодня, ${ruDay(today)}, 12:34`);
});

test('правка при отстающих часах устройства: собственный день операции остаётся доступным в календаре', async ({ page }) => {
  test.skip(almatyHm() < '00:03' || almatyHm() >= '23:58', 'у границы суток «сегодня» в тесте расходится');
  test.skip(almatyDay().endsWith('-01'), 'первого числа вчерашний день — прошлый месяц, вне периода журнала по умолчанию');
  const today = almatyDay();
  const eve = shiftDay(today, -1);
  await login(page);
  const cid = await createCompany(page, `ТОО Часы отстают ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(100), accountId: cash, amount: 10000, comment: 'сегодняшняя' });
  // часы устройства — вчерашний день: «сегодня» устройства раньше дня операции
  const lagging = new Date(`${eve}T12:00:00+05:00`);
  await page.clock.install({ time: lagging });
  await page.clock.setFixedTime(lagging);
  await page.reload();

  await rows(page).first().getByText('сегодняшняя').click();
  const dialog = editForm(page);
  const when = dialog.getByRole('button', { name: /^Указать дату списания:/ });
  await when.click();
  const panel = page.getByRole('dialog', { name: 'Указать дату списания: календарь' });
  // день операции не заблокирован; завтра относительно часов устройства — тоже нет, послезавтра заблокирован
  await expect(panel.getByRole('gridcell', { name: cellName(today), exact: true })).not.toHaveAttribute('aria-disabled', 'true');
  await expect(panel.getByRole('gridcell', { name: cellName(shiftDay(today, 1)), exact: true })).toHaveAttribute('aria-disabled', 'true');
  // уйти на вчера и вернуться на собственный день можно
  await panel.getByRole('gridcell', { name: cellName(eve), exact: true }).click();
  await panel.getByRole('gridcell', { name: cellName(today), exact: true }).click();
  await expect(panel.getByRole('gridcell', { name: cellName(today), exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('«Зарплата за {месяц}» в правке: «Как дата оплаты» возвращает форму к исходной — вопроса о несохранённом нет', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Зарплата правка ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  const tree = (await (await page.request.get(`${base}/categories`)).json()) as { expense: { id: number; systemKey: string | null }[] };
  const salary = tree.expense.find((c) => c.systemKey === 'salary')!.id;
  await apiPost(page, `${base}/operations`, {
    type: 'expense',
    paidAt: todayAgo(100),
    accountId: cash,
    amount: 10000,
    comment: 'оклад',
    lines: [{ categoryId: salary, projectId: null, amount: 10000 }],
  });
  await page.reload();

  await rows(page).first().getByText('оклад').click();
  const dialog = editForm(page);
  const row = dialog.getByRole('button', { name: /^Зарплата за .+ \(по дате оплаты\)$/ });
  const months = page.getByRole('dialog', { name: 'Месяц начисления' });
  const year = Number(almatyDay().slice(0, 4));
  await row.click();
  await months.getByRole('button', { name: `Январь ${year}`, exact: true }).click();
  await expect(dialog.getByRole('button', { name: /^Зарплата за январь/ })).toBeFocused();
  await dialog.getByRole('button', { name: /^Зарплата за январь/ }).click();
  await months.getByRole('button', { name: 'Как дата оплаты' }).click();
  await expect(row).toBeFocused();
  // форма снова как открыли: Esc закрывает без вопроса
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('alertdialog', { name: 'Ваши данные не сохранятся' })).toHaveCount(0);
});

test('архивная компания: строка «Зарплата за {месяц}» видна, но недоступна', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Зарплата архив ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 10000 })).account.id;
  const tree = (await (await page.request.get(`${base}/categories`)).json()) as { expense: { id: number; systemKey: string | null }[] };
  const salary = tree.expense.find((c) => c.systemKey === 'salary')!.id;
  await apiPost(page, `${base}/operations`, {
    type: 'expense',
    paidAt: todayAgo(100),
    accountId: cash,
    amount: 10000,
    comment: 'оклад',
    lines: [{ categoryId: salary, projectId: null, amount: 10000 }],
  });
  await apiPost(page, `${base}/accounts/${cash}/archive`, {});
  await apiPost(page, `${base}/archive`, {});
  await page.reload();

  await rows(page).first().getByText('оклад').click();
  const view = page.getByRole('dialog', { name: 'Расход', exact: true });
  await expect(view).toContainText('Компания в архиве — изменения недоступны');
  const row = view.getByRole('button', { name: /^Зарплата за .+ \(по дате оплаты\)$/ });
  await expect(row).toBeVisible();
  await expect(row).toBeDisabled();
});

test('правка (R4a): повторное подтверждение собственного времени операции не задаёт время руками — paidAt не уходит', async ({ page }) => {
  test.skip(almatyHm() < '00:03' || almatyHm() >= '23:58', 'у границы суток «сегодня» в тесте расходится');
  await login(page);
  const cid = await createCompany(page, `ТОО R4a правка ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(100), accountId: cash, amount: 10000, comment: 'своё время' });
  await page.reload();

  await rows(page).first().getByText('своё время').click();
  const dialog = editForm(page);
  await dialog.getByRole('button', { name: /^Указать дату списания:/ }).click();
  const panel = page.getByRole('dialog', { name: 'Указать дату списания: календарь' });
  const shown = await panel.getByLabel('Время').inputValue();
  await panel.getByLabel('Время').fill('');
  await panel.getByLabel('Время').fill(shown);
  await panel.getByRole('button', { name: 'Готово' }).click();
  await expect(panel).toBeHidden();
  await dialog.getByLabel('Комментарий').fill('своё время 2');
  const patch = page.waitForRequest((r) => r.method() === 'PATCH');
  await submit(dialog).click();
  expect((await patch).postDataJSON()).toEqual({ version: 1, comment: 'своё время 2' });
});
