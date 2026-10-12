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

async function addUser(page: Page, cid: number, login: string, name: string, password: string) {
  await page.goto(`/c/${cid}/settings/users`);
  await page.getByRole('button', { name: 'Добавить пользователя' }).click();
  const dialog = page.getByRole('dialog', { name: 'Новый пользователь' });
  await dialog.getByLabel('Логин', { exact: true }).fill(login);
  await dialog.getByLabel('Имя', { exact: true }).fill(name);
  await dialog.getByLabel('Пароль', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Создать пользователя' }).click();
  // окно закрылось — пользователь создан (а не «Логин уже занят»)
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('listitem').filter({ hasText: login })).toBeVisible();
}

/** Уникальный логин на запуск: тесты можно повторять на том же сервере (--repeat-each). */
const uniqueLogin = (prefix: string) =>
  `${prefix}${String(Date.now() % 1_000_000).padStart(6, '0')}${String(Math.floor(Math.random() * 100)).padStart(2, '0')}`; // одна длина — нет совпадений по префиксу

const csrf = (page: Page) => ({ origin: new URL(page.url()).origin, 'x-requested-with': 'fetch' });

async function apiPost(page: Page, url: string, data: unknown) {
  const res = await page.request.post(url, { data, headers: csrf(page) });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return res.json();
}

const minuteAgo = () => new Date(Date.now() - 60_000).toISOString();

const section = (page: Page, name: string) => page.getByRole('navigation', { name: 'Разделы настроек' }).getByRole('link', { name });

test('пользователи: окно «Пользователь» — сброс пароля и отключение сразу завершают чужой сеанс; себя отключить нельзя', async ({ page, browser }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Люди ${Date.now()}`);
  const user = uniqueLogin('kassir');
  await addUser(page, cid, user, 'Кассир', 'kassir-pass-1');
  const list = page.getByRole('main').getByRole('list', { name: 'Пользователи' });
  const row = list.getByRole('listitem').filter({ hasText: user });
  const dialog = page.getByRole('dialog', { name: 'Пользователь', exact: true });
  await expect(row).toContainText('Кассир');

  // у себя — только имя
  await list.getByRole('listitem').filter({ hasText: 'это вы' }).getByRole('button', { name: /^Изменить/ }).click();
  await expect(dialog.getByLabel('Имя', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Отключить' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Сбросить пароль' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  const ctx = await browser.newContext();
  const kassir = await ctx.newPage();
  await login(kassir, user, 'kassir-pass-1');

  await row.getByRole('button', { name: /^Изменить/ }).click();
  const password = dialog.getByLabel(`Новый пароль для ${user}`);
  const reset = dialog.getByRole('button', { name: 'Сбросить пароль' });
  await password.fill('kassir-pass-2');
  await reset.click();
  await expect(dialog.getByRole('status')).toHaveText('Пароль сброшен, сеансы пользователя завершены');
  // поле пусто — кнопка недоступна (aria-disabled), но фокус остался на ней, а не упал на body (R4)
  await expect(reset).toHaveAttribute('aria-disabled', 'true');
  await expect(reset).toBeFocused();
  // правка — прежнее сообщение уходит
  await password.fill('x');
  await expect(dialog.getByRole('status')).toHaveText('');
  await password.fill('');
  await kassir.reload();
  await expect(kassir).toHaveURL(/\/login$/);
  await login(kassir, user, 'kassir-pass-2');

  // «Отключить» спрашивает: случайное нажатие не выбивает кассира посреди смены (M12)
  const disable = dialog.getByRole('button', { name: 'Отключить' });
  const confirm = page.getByRole('alertdialog', { name: 'Отключить Кассир?' });
  await disable.click();
  await expect(confirm).toContainText('Его сеансы сразу завершатся.');
  await confirm.getByRole('button', { name: 'Отменить' }).click();
  await expect(confirm).toBeHidden();
  await expect(disable).toBeFocused();
  await expect(row).not.toContainText('отключён');

  await disable.click();
  await confirm.getByRole('button', { name: 'Отключить' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Пользователь отключён, его сеансы завершены');
  const enable = dialog.getByRole('button', { name: 'Включить' });
  await expect(enable).toBeVisible();
  // та же кнопка, теперь «Включить»: фокус на ней (R4)
  await expect(enable).toBeFocused();
  await expect(row).toContainText('отключён');
  await kassir.reload();
  await expect(kassir).toHaveURL(/\/login$/);

  await enable.click();
  await expect(dialog.getByRole('status')).toHaveText('Пользователь включён');
  await expect(disable).toBeFocused();
  await expect(row).not.toContainText('отключён');
  await ctx.close();
});

test('пользователи: одноимённые различимы по ✎ — «Изменить {имя} ({логин})» (R2)', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Тёзки ${Date.now()}`);
  const first = uniqueLogin('tezka');
  const second = uniqueLogin('tezkb');
  await addUser(page, cid, first, 'Тёзка', 'tezka-pass-01');
  await addUser(page, cid, second, 'Тёзка', 'tezkb-pass-01');
  const list = page.getByRole('main').getByRole('list', { name: 'Пользователи' });
  await expect(list.getByRole('button', { name: `Изменить Тёзка (${first})`, exact: true })).toHaveCount(1);
  await expect(list.getByRole('button', { name: `Изменить Тёзка (${second})`, exact: true })).toHaveCount(1);
  await list.getByRole('button', { name: `Изменить Тёзка (${second})`, exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Пользователь', exact: true })).toContainText(`Логин: ${second}`);
});

test('профиль: смена пароля оставляет текущий сеанс и завершает остальные', async ({ page, browser }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Профиль ${Date.now()}`);
  const user = uniqueLogin('profiler');
  await addUser(page, cid, user, 'Профилёр', 'profiler-pass-1');

  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  await login(a, user, 'profiler-pass-1');
  const ctxB = await browser.newContext();
  const b = await ctxB.newPage();
  await login(b, user, 'profiler-pass-1');

  // профиль — в панели «Настройки» (шестерёнка): в её шапке имя пользователя
  await a.getByRole('banner').getByRole('button', { name: 'Настройки', exact: true }).click();
  await a.getByRole('dialog', { name: 'Профилёр' }).getByRole('link', { name: 'Профиль' }).click();
  await expect(a.getByRole('heading', { name: 'Профиль' })).toBeVisible();
  // одна колонка и одна «Сохранить» (§7.4)
  await expect(a.getByRole('heading', { level: 2, name: 'Изменить пароль' })).toBeVisible();
  // повтор не совпал — ошибка у поля, без запроса (Review Focus 4)
  await a.getByLabel('Текущий пароль').fill('profiler-pass-1');
  await a.getByLabel('Новый пароль', { exact: true }).fill('profiler-pass-2');
  await a.getByLabel('Повторите пароль').fill('profiler-pass-3');
  await a.getByRole('button', { name: 'Сохранить' }).click();
  await expect(a.getByText('Пароли не совпадают')).toBeVisible();
  await expect(a.getByLabel('Повторите пароль')).toHaveAttribute('aria-invalid', 'true');

  await a.getByLabel('Текущий пароль').fill('wrong-password-0');
  await a.getByLabel('Повторите пароль').fill('profiler-pass-2');
  // исправляемое поле больше не показывает прежнюю ошибку (M13)
  await expect(a.getByText('Пароли не совпадают')).toHaveCount(0);
  await expect(a.getByLabel('Повторите пароль')).not.toHaveAttribute('aria-invalid', 'true');
  // имя и пароль вместе, пароль отклонён: имя сохранено, ошибка — у поля текущего пароля
  await a.getByLabel('Имя', { exact: true }).fill('Профилёр 2');
  await a.getByRole('button', { name: 'Сохранить' }).click();
  await expect(a.getByText('Неверный текущий пароль')).toBeVisible();
  await expect(a.getByLabel('Текущий пароль')).toHaveAttribute('aria-invalid', 'true');
  await expect(a.getByRole('status')).toHaveText('Имя сохранено.');
  await expect
    .poll(async () => ((await (await a.request.get('/api/v1/auth/me')).json()) as { user: { name: string } }).user.name)
    .toBe('Профилёр 2');
  await expect(a.getByLabel('Новый пароль', { exact: true })).toHaveValue('profiler-pass-2');

  await a.getByLabel('Текущий пароль').fill('profiler-pass-1');
  const save = a.getByRole('button', { name: 'Сохранить' });
  await save.click();
  await expect(a.getByRole('status')).toHaveText('Пароль изменён. Остальные сеансы завершены.');
  await expect(a.getByLabel('Текущий пароль')).toHaveValue('');
  // сохранять нечего: кнопка недоступна (aria-disabled), фокус остался на ней (R4)
  await expect(save).toHaveAttribute('aria-disabled', 'true');
  await expect(save).toBeFocused();
  await a.reload();
  await expect(a.getByRole('heading', { name: 'Профиль' })).toBeVisible();
  await b.reload();
  await expect(b).toHaveURL(/\/login$/);
  await ctxA.close();
  await ctxB.close();
});

test('история: события компании с именем пользователя, фильтр, подробности; системная лента', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО История ${Date.now()}`);
  await page.goto(`/c/${cid}/settings/tags`);
  await page.getByRole('button', { name: 'Добавить тег' }).click();
  const created = page.getByRole('dialog', { name: 'Новый тег' });
  await created.getByLabel('Название тега').fill('Аренда');
  await created.getByRole('button', { name: 'Сохранить' }).click();
  await expect(created).toBeHidden();
  await page.getByRole('button', { name: 'Изменить Аренда', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Тег', exact: true });
  await edit.getByLabel('Название тега').fill('Аренда зала');
  await edit.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Аренда зала' })).toBeVisible();

  await page.getByRole('banner').getByRole('button', { name: 'История действий' }).click();
  await page.getByRole('dialog', { name: 'История действий' }).getByRole('link', { name: 'Подробнее' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/audit$`));
  const first = page.getByRole('listitem').first();
  await expect(first).toContainText('Админ');
  await expect(first).toContainText('Изменение');
  await expect(first).toContainText('Тег');
  await first.getByText('Подробности').click();
  await expect(first.getByRole('table')).toContainText('Аренда зала');

  await page.getByLabel('Что изменилось').selectOption('company');
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('listitem').first()).toContainText('Компания');

  await page.getByRole('button', { name: 'Система' }).click();
  await expect(page.getByRole('listitem').first()).toContainText('Пользователь');
});

test('резервная копия: последняя копия и «Скачать сейчас»', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Бэкап ${Date.now()}`);
  await page.goto(`/c/${cid}/settings/backup`);
  const auto = page.getByRole('region', { name: 'Автоматическая копия' });
  await expect(auto).toContainText('Включено');
  await expect(auto).toContainText('Ежедневно в 04:00 и при запуске');
  await expect(page.getByRole('main')).toContainText('Копия общая для всех компаний');
  await expect(page.getByText('Последняя копия')).toBeVisible();
  await expect(page.getByText('Ещё не было')).toHaveCount(0); // стартовый бэкап e2e-сервера
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать сейчас' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^backup-\d{8}-\d{6}\.zip$/);
});

const companyRow = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

test('панель «Компании»: текущая компания не уводит из настроек, другая — тот же раздел и фокус на заголовке; последняя компания запоминается', async ({ page }) => {
  await login(page);
  const stamp = Date.now();
  const alpha = `ТОО Альфа ${stamp}`;
  const beta = `ТОО Бета ${stamp}`;
  const alphaId = await createCompany(page, alpha);
  const betaId = await createCompany(page, beta);

  await page.goto(`/c/${betaId}/settings/accounts`);
  const block = page.getByRole('banner').getByRole('button', { name: /Сменить компанию/ });
  await expect(block).toHaveAccessibleName(`Сменить компанию: ${beta}`);
  await expect(block).toHaveAttribute('aria-haspopup', 'dialog');

  // текущая компания — остаёмся в настройках, фокус на кнопке компании
  await block.click();
  const drawer = page.getByRole('dialog', { name: 'Компании' });
  await drawer.getByRole('button', { name: companyRow(beta) }).click();
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/c/${betaId}/settings/accounts$`));
  await expect(block).toBeFocused();

  // клавиатура: Enter открывает панель, Enter на «Альфе» — тот же раздел у неё, фокус на заголовке раздела
  await block.press('Enter');
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: companyRow(alpha) }).focus();
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/v1/preferences/lastCompanyId') && r.request().method() === 'PUT');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/c/${alphaId}/settings/accounts$`));
  await saved;
  await expect(page.getByRole('heading', { level: 1, name: 'Счета' })).toBeFocused();

  // Esc закрывает панель и возвращает фокус
  await block.click();
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(block).toBeFocused();

  // стартовый экран открывает последнюю компанию
  await page.goto('/');
  await expect(page).toHaveURL(new RegExp(`/c/${alphaId}/log$`));
});

test('панель «История действий»: последние действия с операциями, открытие операции, «Подробнее»', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Лента ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  const income = (await apiPost(page, `${base}/operations`, { type: 'income', paidAt: minuteAgo(), accountId: cash, amount: 131700, comment: 'выручка' })).operation;
  const expense = (await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: minuteAgo(), accountId: cash, amount: 50000 })).operation;
  expect((await page.request.patch(`${base}/operations/${income.id}`, { data: { version: 1, comment: 'выручка за смену' }, headers: csrf(page) })).status()).toBe(200);
  expect((await page.request.delete(`${base}/operations/${expense.id}`, { headers: csrf(page) })).status()).toBe(200);
  await page.reload();

  const open = page.getByRole('banner').getByRole('button', { name: 'История действий' });
  await expect(open).toHaveAttribute('title', 'История действий');
  await open.click();
  const drawer = page.getByRole('dialog', { name: 'История действий' });
  const items = drawer.getByRole('list', { name: 'Последние действия' }).getByRole('listitem');
  await expect(items).toHaveCount(4);
  await expect(items.nth(0)).toContainText('Удалён расход');
  await expect(items.nth(0)).toContainText(/₸\s500/);
  await expect(items.nth(0)).toContainText('Касса');
  await expect(items.nth(0)).toContainText(/Админ · \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}:\d{2}/);
  await expect(items.nth(1)).toContainText('Изменён доход');
  await expect(items.nth(1)).toContainText('Изменено: Комментарий');
  await expect(items.nth(2)).toContainText('Добавлен расход');
  await expect(items.nth(3)).toContainText('Добавлен доход');
  await expect(items.nth(3)).toContainText(/₸\s1\s317/);
  // удалённый расход не открыть ни из записи об удалении, ни из записи о добавлении
  await expect(items.nth(0).getByRole('button')).toHaveCount(0);
  await expect(items.nth(2).getByRole('button')).toHaveCount(0);

  // запись о доходе открывает его в форме, панель закрывается
  await items.nth(1).getByRole('button').click();
  await expect(drawer).toBeHidden();
  const form = page.getByRole('dialog', { name: 'Доход', exact: true });
  await expect(form.getByLabel('Комментарий')).toHaveValue('выручка за смену');
  await page.keyboard.press('Escape');
  await expect(form).toBeHidden();
  // форма открылась уже после закрытия панели: фокус вернулся на кнопку «История действий»
  await expect(open).toBeFocused();

  // «Подробнее» — полная лента в настройках, фокус на её заголовке
  await open.click();
  await drawer.getByRole('link', { name: 'Подробнее' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/audit$`));
  await expect(page.getByRole('heading', { level: 1, name: 'История действий' })).toBeFocused();
});

test('резервная копия: папка не задана, ошибка копирования и сбой скачивания видны на карточке', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Бэкап2 ${Date.now()}`);
  const status = { last: { file: 'backup-20260101-000000.zip', createdAt: '2026-01-01T00:00:00.000Z', size: 2048 }, copyDir: null as string | null, lastCopyError: null as string | null };
  await page.route('**/api/v1/backup/status', (route) => route.fulfill({ json: status }));
  await page.route('**/api/v1/backup/download', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Не удалось подготовить архив' } }) }));

  await page.goto(`/c/${cid}/settings/backup`);
  const auto = page.getByRole('region', { name: 'Автоматическая копия' });
  await expect(auto).toContainText('Не задана — копии хранятся только в data/backups');
  await expect(auto.getByRole('alert')).toHaveCount(0);

  status.copyDir = 'E:\\copies';
  status.lastCopyError = 'Нет доступа к папке E:\\copies';
  await page.reload();
  await expect(auto).toContainText('E:\\copies');
  await expect(auto.getByRole('alert')).toHaveText('Нет доступа к папке E:\\copies');
  await expect(auto).toContainText('Включено');

  await auto.getByRole('button', { name: 'Скачать сейчас' }).click();
  await expect(auto.getByRole('alert').filter({ hasText: 'Не удалось подготовить архив' })).toBeVisible();
});
