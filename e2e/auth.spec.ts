import { expect, test, type Page } from '@playwright/test';

async function createCompany(page: Page, name: string): Promise<number> {
  await page.goto('/companies/new');
  await page.getByLabel('Название компании').fill(name);
  await page.getByRole('button', { name: 'Создать компанию' }).click();
  await expect(page).toHaveURL(/\/c\/\d+\/log$/);
  return Number(page.url().match(/\/c\/(\d+)\//)![1]);
}

test('вход, неверный пароль, выход через панель «Настройки»', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);

  await page.getByPlaceholder('Логин').fill('admin');
  await page.getByPlaceholder('Пароль').fill('wrong-password');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('alert')).toHaveText('Неверный логин или пароль');

  await page.getByPlaceholder('Пароль').fill('e2e-password-1');
  await page.getByRole('button', { name: 'Войти' }).click();
  const gear = page.getByRole('banner').getByRole('button', { name: 'Настройки', exact: true });
  await expect(gear).toBeVisible();
  await expect(gear).toHaveAttribute('title', 'Настройки');
  // имени пользователя и «Выйти» в шапке нет (01-H2)
  await expect(page.getByRole('banner').getByRole('button', { name: 'Выйти' })).toHaveCount(0);
  await expect(page.getByRole('banner')).not.toContainText('Админ');
  await expect(page).toHaveTitle('Учёт');

  await page.reload();
  await expect(gear).toBeVisible(); // сессия переживает перезагрузку

  // панель: имя — заголовок, логин под ним; Esc закрывает, фокус — на шестерёнке
  await gear.click();
  const menu = page.getByRole('dialog', { name: 'Админ' });
  await expect(menu).toContainText('admin');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(gear).toBeFocused();

  await gear.click();
  await menu.getByRole('button', { name: 'Выйти' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});

test('панель «Настройки» на странице компании: группы, переход закрывает панель и ставит фокус на заголовок', async ({ page }) => {
  await page.goto('/login');
  await page.getByPlaceholder('Логин').fill('admin');
  await page.getByPlaceholder('Пароль').fill('e2e-password-1');
  await page.getByRole('button', { name: 'Войти' }).click();
  const gear = page.getByRole('banner').getByRole('button', { name: 'Настройки', exact: true });
  await expect(gear).toBeVisible();
  const name = `ТОО Шестерёнка ${Date.now()}`;
  const cid = await createCompany(page, name);

  await gear.click();
  const menu = page.getByRole('dialog', { name: 'Админ' });
  await expect(menu).toContainText('Мой аккаунт');
  await expect(menu).toContainText(`Моя компания: ${name}`);
  await expect(menu.getByRole('link')).toHaveText([/^Профиль/, /^Мои компании/, /^Пользователи/, /^Настройки компании/]);
  await expect(menu.getByRole('button', { name: 'Выйти' })).toBeVisible();

  await menu.getByRole('link', { name: /^Пользователи/ }).click();
  await expect(menu).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/users$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Пользователи' })).toBeFocused();

  // «Настройки компании» — первый раздел компании
  await gear.click();
  await menu.getByRole('link', { name: /^Настройки компании/ }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/counterparties$`));

  // страница без компании: группы «Моя компания» нет
  await page.goto('/companies/new');
  await gear.click();
  await expect(menu).not.toContainText('Моя компания');
  await expect(menu.getByRole('button', { name: 'Выйти' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('«глазок» показывает и скрывает введённый пароль', async ({ page }) => {
  await page.goto('/login');
  const password = page.getByPlaceholder('Пароль');
  await password.fill('секрет-123');
  await expect(password).toHaveAttribute('type', 'password');

  await page.getByRole('button', { name: 'Показать пароль' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(password).toHaveValue('секрет-123');
  await expect(password).toBeFocused(); // фокус возвращается в поле, можно продолжать ввод

  await page.getByRole('button', { name: 'Скрыть пароль' }).click();
  await expect(password).toHaveAttribute('type', 'password');
});
