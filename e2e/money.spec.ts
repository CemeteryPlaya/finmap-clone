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

/** Запрос к API от имени вошедшего пользователя: кука сессии браузера и заголовки защиты от подделки. */
async function apiPost(page: Page, url: string, data: unknown) {
  const res = await page.request.post(url, { data, headers: { origin: new URL(page.url()).origin, 'x-requested-with': 'fetch' } });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return res.json();
}

const minuteAgo = () => new Date(Date.now() - 60_000).toISOString();

test('левая панель: балансы и итог, переход в журнал, свёрнутая панель остаётся свёрнутой; итоги в переключателе', async ({ page }) => {
  await login(page);
  const name = `ТОО Панель ${Date.now()}`;
  const cid = await createCompany(page, name);
  const base = `/api/v1/companies/${cid}`;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 100000 })).account.id;
  const safe = (await apiPost(page, `${base}/accounts`, { name: 'Сейф', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: minuteAgo(), accountId: kaspi, amount: 50000 });
  await apiPost(page, `${base}/operations`, { type: 'transfer', paidAt: minuteAgo(), accountId: kaspi, toAccountId: safe, amount: 20000 });

  await page.reload();
  const panel = page.getByRole('navigation', { name: 'Счета' });
  await expect(panel).toContainText(/Всего на счетах\s*1\s500,00\s₸/);
  await expect(panel.getByRole('link', { name: /^Kaspi/ })).toContainText(/1\s300,00\s₸/);
  await expect(panel.getByRole('link', { name: /^Сейф/ })).toContainText(/200,00\s₸/);
  await expect(panel).toContainText('Общие');

  await panel.getByRole('link', { name: /^Kaspi/ }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log\\?account=${kaspi}$`));

  // переключатель: у компании — её итог
  await page.getByRole('button', { name: /Сменить компанию/ }).click();
  await expect(page.getByRole('menuitem', { name })).toContainText(/1\s500,00\s₸/);
  await page.keyboard.press('Escape');

  // свернуть — и после перезагрузки панель свёрнута (Review Focus 5)
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/v1/preferences/sidebar.collapsed') && r.request().method() === 'PUT');
  await panel.getByRole('button', { name: 'Свернуть панель счетов' }).click();
  await saved;
  await expect(panel.getByRole('link', { name: /^Kaspi/ })).toHaveCount(0);
  await page.reload();
  await expect(panel.getByRole('button', { name: 'Развернуть панель счетов' })).toBeVisible();
  await expect(panel.getByRole('link', { name: /^Kaspi/ })).toHaveCount(0);

  // развернуть обратно: настройка общая для пользователя admin и остальных e2e
  const restored = page.waitForResponse((r) => r.url().endsWith('/api/v1/preferences/sidebar.collapsed') && r.request().method() === 'PUT');
  await panel.getByRole('button', { name: 'Развернуть панель счетов' }).click();
  await restored;
  await expect(panel.getByRole('link', { name: /^Kaspi/ })).toBeVisible();
});
