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
  await expect(page.getByRole('heading', { name: 'Журнал' })).toBeVisible();
  await expect(page.getByText('Админ')).toBeVisible();
  await expect(page).toHaveTitle('Учёт');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Журнал' })).toBeVisible(); // сессия переживает перезагрузку

  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});
