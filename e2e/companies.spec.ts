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
  await page.getByLabel('Базовая валюта').selectOption('KZT');
  await page.getByRole('button', { name: 'Создать компанию' }).click();
  await expect(page).toHaveURL(/\/c\/\d+\/log$/);
  return Number(page.url().match(/\/c\/(\d+)\//)![1]);
}

test('компании: создание, переключение', async ({ page }) => {
  await login(page);
  const suffix = Date.now();
  const first = `ТОО Ромашка ${suffix}`;
  const second = `ИП Лютик ${suffix}`;

  const firstId = await createCompany(page, first);
  await expect(page.getByRole('heading', { name: 'Журнал' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сменить компанию' })).toContainText(first);

  const secondId = await createCompany(page, second);
  expect(secondId).not.toBe(firstId);
  await expect(page.getByRole('button', { name: 'Сменить компанию' })).toContainText(second);

  await page.getByRole('button', { name: 'Сменить компанию' }).click();
  await page.getByRole('menuitem', { name: first }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${firstId}/log$`));
  await expect(page.getByRole('button', { name: 'Сменить компанию' })).toContainText(first);

  await page.goto('/c/999999/log');
  await expect(page).not.toHaveURL(/\/c\/999999\//); // неизвестная компания → редирект…
  await expect(page).toHaveURL(/\/c\/\d+\/log$/); // …на первую активную
});
