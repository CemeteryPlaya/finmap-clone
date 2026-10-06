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

  // «Отмена» на экране новой компании возвращает в журнал первой активной
  await page.goto('/companies/new');
  await page.getByRole('link', { name: 'Отмена' }).click();
  await expect(page).toHaveURL(/\/c\/\d+\/log$/);

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

test('проекты по шаблонам: клуб и общий', async ({ page }) => {
  await login(page);
  const companyName = `ТОО Клубы ${Date.now()}`;
  const cid = await createCompany(page, companyName);

  await page.getByRole('link', { name: 'Настройки' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/projects$`));

  await page.getByRole('button', { name: 'Добавить проект' }).click();
  await page.getByLabel('Название проекта').fill('Клуб на Ленина');
  await page.getByLabel('Тип бизнеса').selectOption('computer-club');
  await page.getByLabel('Количество ПК').fill('0');
  await page.getByRole('button', { name: 'Создать проект' }).click();
  await expect(page.getByText('Не меньше 1')).toBeVisible(); // клиентская проверка той же схемой
  await page.getByLabel('Количество ПК').fill('30');
  await page.getByRole('button', { name: 'Создать проект' }).click();

  const row = page.getByRole('listitem').filter({ hasText: 'Клуб на Ленина' });
  await expect(row).toContainText('Компьютерный клуб');
  await expect(row).toContainText('Количество ПК: 30');

  const tree = await (await page.request.get(`/api/v1/companies/${cid}/categories`)).json();
  const salary = tree.expense.find((c: { systemKey: string | null }) => c.systemKey === 'salary');
  expect(salary.children.map((c: { name: string }) => c.name)).toEqual(['Администраторы', 'Премии']);
  const accounts = (await (await page.request.get(`/api/v1/companies/${cid}/accounts`)).json()).accounts;
  expect(accounts.map((a: { name: string }) => a.name)).toEqual(['Касса Клуб на Ленина', 'Kaspi Клуб на Ленина']);

  await page.getByRole('button', { name: 'Добавить проект' }).click();
  await page.getByLabel('Название проекта').fill('Офис');
  await page.getByLabel('Тип бизнеса').selectOption('general');
  await expect(page.getByLabel('Количество ПК')).toHaveCount(0);
  await page.getByRole('button', { name: 'Создать проект' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Офис' })).toContainText('Общий');
  const after = (await (await page.request.get(`/api/v1/companies/${cid}/accounts`)).json()).accounts;
  expect(after).toHaveLength(2);

  // переименование компании на экране «Компании»
  await page.getByRole('link', { name: 'Компании' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/companies$`));
  const renamed = `ТОО Клубы переим ${Date.now()}`;
  const companyRow = page.getByRole('listitem').filter({ has: page.locator(`input[value="${companyName}"]`) });
  await companyRow.getByLabel('Название').fill(renamed);
  // локаторы Playwright разрешаются заново при каждом действии, а React обновил атрибут value —
  // строку ищем уже по новому имени
  const renamedRow = page.getByRole('listitem').filter({ has: page.locator(`input[value="${renamed}"]`) });
  await renamedRow.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('button', { name: 'Сменить компанию' })).toContainText(renamed);
});

test('истёкшая сессия уводит на вход', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Сессия ${Date.now()}`);
  // левая панель счетов грузит данные сразу после входа в компанию: дожидаемся её, иначе 401 придёт раньше клика
  await page.waitForLoadState('networkidle');
  await page.context().clearCookies();
  await page.getByRole('link', { name: 'Настройки' }).click();
  // экран настроек монтируется и перезапрашивает данные → 401 → уход на вход
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible();
  expect(cid).toBeGreaterThan(0);
});
