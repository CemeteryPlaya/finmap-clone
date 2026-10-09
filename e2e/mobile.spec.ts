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

/** Телефон из §10 (сценарий 4): ширина 390 px. */
const PHONE = { width: 390, height: 844 };
const bar = (page: Page) => page.getByRole('group', { name: 'Добавить операцию' });
const newForm = (page: Page) => page.getByRole('dialog', { name: 'Новая операция' });

test('нижняя панель «Доход», «Расход», «Перевод» на телефоне; на компьютере кнопки — в шапке', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Панель ${Date.now()}`);
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await page.reload();
  // компьютер: панели нет, кнопки — в шапке
  await expect(bar(page)).toBeHidden();
  await expect(page.getByRole('banner').getByRole('button', { name: 'Расход', exact: true })).toBeVisible();

  await page.setViewportSize(PHONE);
  await expect(page.getByRole('banner').getByRole('button', { name: 'Расход', exact: true })).toBeHidden();
  await expect(bar(page).getByRole('button')).toHaveText([/Доход/, /Расход/, /Перевод/]);
  // закреплена у нижнего края во всю ширину
  const box = (await bar(page).boundingBox())!;
  expect(Math.round(box.y + box.height)).toBe(PHONE.height);
  expect(Math.round(box.width)).toBe(PHONE.width);

  // кнопка открывает форму своего типа; Esc без изменений закрывает, фокус — снова на кнопке панели
  await bar(page).getByRole('button', { name: 'Перевод', exact: true }).click();
  await expect(newForm(page).getByRole('radio', { name: 'Перевод' })).toBeChecked();
  await expect(newForm(page).getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(newForm(page)).toBeHidden();
  await expect(bar(page).getByRole('button', { name: 'Перевод', exact: true })).toBeFocused();
});
