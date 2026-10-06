import { expect, test } from '@playwright/test';

test('вход, неверный пароль, выход', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);

  await page.getByPlaceholder('Логин').fill('admin');
  await page.getByPlaceholder('Пароль').fill('wrong-password');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('alert')).toHaveText('Неверный логин или пароль');

  await page.getByPlaceholder('Пароль').fill('e2e-password-1');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible();
  await expect(page.getByText('Админ')).toBeVisible();
  await expect(page).toHaveTitle('Учёт');

  await page.reload();
  await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible(); // сессия переживает перезагрузку

  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
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
