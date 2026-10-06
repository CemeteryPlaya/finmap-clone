import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, user = 'admin', password = 'e2e-password-1') {
  await page.goto('/login');
  await page.getByPlaceholder('Логин').fill(user);
  await page.getByPlaceholder('Пароль').fill(password);
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

async function addUser(page: Page, cid: number, login: string, name: string, password: string) {
  await page.goto(`/c/${cid}/settings/users`);
  await page.getByRole('button', { name: 'Добавить пользователя' }).click();
  await page.getByLabel('Логин', { exact: true }).fill(login);
  await page.getByLabel('Имя', { exact: true }).fill(name);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Создать пользователя' }).click();
  // форма закрылась — пользователь создан (а не «Логин уже занят»)
  await expect(page.getByRole('button', { name: 'Создать пользователя' })).toHaveCount(0);
  await expect(page.getByRole('listitem').filter({ hasText: login })).toBeVisible();
}

/** Уникальный логин на запуск: тесты можно повторять на том же сервере (--repeat-each). */
const uniqueLogin = (prefix: string) =>
  `${prefix}${String(Date.now() % 1_000_000).padStart(6, '0')}${String(Math.floor(Math.random() * 100)).padStart(2, '0')}`; // одна длина — нет совпадений по префиксу

const section = (page: Page, name: string) => page.getByRole('navigation', { name: 'Разделы настроек' }).getByRole('link', { name });

test('пользователи: сброс пароля и отключение сразу завершают чужой сеанс; себя отключить нельзя', async ({ page, browser }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Люди ${Date.now()}`);
  const user = uniqueLogin('kassir');
  await addUser(page, cid, user, 'Кассир', 'kassir-pass-1');
  const row = page.getByRole('listitem').filter({ hasText: user });
  const meRow = page.getByRole('listitem').filter({ hasText: 'это вы' });
  await expect(meRow.getByRole('button', { name: 'Отключить' })).toHaveCount(0);

  const ctx = await browser.newContext();
  const kassir = await ctx.newPage();
  await login(kassir, user, 'kassir-pass-1');

  await row.getByRole('button', { name: 'Сбросить пароль' }).click();
  await row.getByLabel(`Новый пароль для ${user}`).fill('kassir-pass-2');
  await row.getByRole('button', { name: 'Сбросить пароль' }).click();
  await expect(row.getByRole('status')).toHaveText('Пароль сброшен, сеансы пользователя завершены');
  await kassir.reload();
  await expect(kassir).toHaveURL(/\/login$/);
  await login(kassir, user, 'kassir-pass-2');

  await row.getByRole('button', { name: 'Отключить' }).click();
  await expect(row).toContainText('отключён');
  await kassir.reload();
  await expect(kassir).toHaveURL(/\/login$/);
  await ctx.close();
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

  await a.getByRole('link', { name: 'Профилёр' }).click(); // имя в шапке ведёт в профиль
  await expect(a.getByRole('heading', { name: 'Профиль' })).toBeVisible();
  await a.getByLabel('Текущий пароль').fill('wrong-password-0');
  await a.getByLabel('Новый пароль', { exact: true }).fill('profiler-pass-2');
  await a.getByLabel('Повторите новый пароль').fill('profiler-pass-2');
  await a.getByRole('button', { name: 'Сменить пароль' }).click();
  await expect(a.getByText('Неверный текущий пароль')).toBeVisible();
  await expect(a.getByLabel('Текущий пароль')).toHaveAttribute('aria-invalid', 'true');

  await a.getByLabel('Текущий пароль').fill('profiler-pass-1');
  await a.getByRole('button', { name: 'Сменить пароль' }).click();
  await expect(a.getByRole('status')).toHaveText('Пароль изменён. Остальные сеансы завершены.');
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
  await page.getByLabel('Новый тег').fill('Аренда');
  await page.getByRole('button', { name: 'Добавить' }).click();
  await page.getByRole('listitem').filter({ hasText: 'Аренда' }).getByRole('button', { name: 'Переименовать' }).click();
  await page.getByLabel('Новое название тега «Аренда»').fill('Аренда зала');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Аренда зала' })).toBeVisible();

  await section(page, 'История действий').click();
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
  await expect(page.getByText('Последняя копия')).toBeVisible();
  await expect(page.getByText('Ещё не было')).toHaveCount(0); // стартовый бэкап e2e-сервера
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать сейчас' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^backup-\d{8}-\d{6}\.zip$/);
});

test('переключатель: клавиатура, текущая компания не уводит из настроек, последняя компания запоминается', async ({ page }) => {
  await login(page);
  const stamp = Date.now();
  const alpha = `ТОО Альфа ${stamp}`;
  const beta = `ТОО Бета ${stamp}`;
  const alphaId = await createCompany(page, alpha);
  const betaId = await createCompany(page, beta);

  await page.goto(`/c/${betaId}/settings/accounts`);
  const switcher = page.getByRole('button', { name: /Сменить компанию/ });
  await expect(switcher).toHaveAccessibleName(`Сменить компанию: ${beta}`);

  // выбор текущей компании — остаёмся в настройках, фокус на кнопке
  await switcher.click();
  await page.getByRole('menuitem', { name: beta }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${betaId}/settings/accounts$`));
  await expect(switcher).toBeFocused();

  // клавиатура: стрелка открывает меню на текущей, ↑ — к «Альфе», Enter — тот же раздел у неё
  await switcher.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: beta })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('menuitem', { name: alpha })).toBeFocused();
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/v1/preferences/lastCompanyId') && r.request().method() === 'PUT');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/c/${alphaId}/settings/accounts$`));
  await saved;

  // Esc закрывает меню и возвращает фокус
  await switcher.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(switcher).toBeFocused();

  // стартовый экран открывает последнюю компанию
  await page.goto('/');
  await expect(page).toHaveURL(new RegExp(`/c/${alphaId}/log$`));
});
