import { expect, test, type Page } from '@playwright/test';

// «Склад-3»: вкладка «Аналитика» склада и «Динамика цен» (план 2026-10-18-warehouse-2-3, задача 10)

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

const csrf = (page: Page) => ({ origin: new URL(page.url()).origin, 'x-requested-with': 'fetch' });

async function apiPost(page: Page, url: string, data: unknown) {
  const res = await page.request.post(url, { data, headers: csrf(page) });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return res.json();
}

const main = (page: Page) => page.getByRole('main');
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const isoDay = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);

/** Склады двух клубов; кола: две закупки (100 и 120 ₸ за штуку), продажа 12 шт по 600 ₸; цена продажи 500 ₸ задолго до закупок. */
async function seed(page: Page, cid: number) {
  const base = `/api/v1/companies/${cid}`;
  const project = (await apiPost(page, `${base}/projects`, { name: 'Клуб 1', templateKey: 'general' })).project.id as number;
  const project2 = (await apiPost(page, `${base}/projects`, { name: 'Клуб 2', templateKey: 'general' })).project.id as number;
  const warehouse = (await apiPost(page, `${base}/stock/warehouses`, { projectId: project, name: 'Бар Клуб 1' })).warehouse.id as number;
  const warehouse2 = (await apiPost(page, `${base}/stock/warehouses`, { projectId: project2, name: 'Бар Клуб 2' })).warehouse.id as number;
  const cola = (await apiPost(page, `${base}/stock/items`, { name: 'Кола 0,5', unit: 'pcs' })).item.id as number;
  await apiPost(page, `${base}/stock/items/${cola}/price`, { price: 50_000, validFrom: isoDay(40) });
  const docs = `${base}/stock/docs`;
  await apiPost(page, docs, { type: 'receipt', at: daysAgo(20), warehouseId: warehouse, lines: [{ itemId: cola, qty: 10_000, amount: 100_000 }] });
  await apiPost(page, docs, { type: 'receipt', at: daysAgo(10), warehouseId: warehouse, lines: [{ itemId: cola, qty: 5000, amount: 60_000 }] });
  await apiPost(page, docs, { type: 'sale', at: daysAgo(5), warehouseId: warehouse, lines: [{ itemId: cola, qty: 12_000, amount: 720_000 }] });
  await apiPost(page, docs, { type: 'receipt', at: daysAgo(3), warehouseId: warehouse2, lines: [{ itemId: cola, qty: 1000, amount: 9000 }] });
  return { warehouse, warehouse2, cola };
}

/** Период «Выбрать даты» адресом: последние 60 дней — все документы сценария внутри. */
const period = () => `from=${isoDay(60)}&to=${isoDay(0)}`;

test('«Аналитика» склада: строки, итоги и строка «Закуплено…»; смена склада и периода меняет цифры и адрес', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Аналитика склада ${Date.now()}`);
  const s = await seed(page, cid);
  await page.goto(`/c/${cid}/stock/analytics?warehouse=${s.warehouse}&period=custom&${period()}`);
  const table = main(page).getByRole('table', { name: 'Аналитика по товарам' });
  const row = table.getByRole('row').filter({ hasText: 'Кола 0,5' }).first();
  await expect(row).toContainText(/7\s*200\s*₸/);
  await expect(row).toContainText(/5\s*960\s*₸/); // прибыль: 7 200 \u2212 (1 000 + 240)
  await expect(row).toContainText('82,8');
  await expect(main(page).getByRole('region', { name: 'Итоги' })).toContainText(/Закуплено за период 1\s*600\s*₸, стоимость склада изменилась на \+360\s*₸/);

  // «Все склады»: закупка Клуба 2 входит в «Закуплено»
  await main(page).getByLabel('Склад', { exact: true }).selectOption({ label: 'Все склады' });
  await expect(page).toHaveURL(/warehouse=all/);
  await expect(main(page).getByRole('region', { name: 'Итоги' })).toContainText(/Закуплено за период 1\s*690\s*₸/);

  // период без документов — пусто
  await page.goto(`/c/${cid}/stock/analytics?warehouse=all&period=custom&from=2020-01-01&to=2020-01-31`);
  await expect(main(page).getByText('За период по складу не было движения.')).toBeVisible();
});

test('«Динамика цен»: график, подсказка «Закупка выросла…», маржа по датам', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Динамика цен ${Date.now()}`);
  const s = await seed(page, cid);
  await page.goto(`/c/${cid}/stock/analytics?warehouse=${s.warehouse}&period=custom&${period()}`);
  await main(page).getByRole('button', { name: 'Динамика цен: Кола 0,5' }).click();
  const dialog = page.getByRole('dialog', { name: 'Динамика цен: Кола 0,5' });
  await expect(dialog.getByRole('status')).toContainText(/Закупка выросла на 20% с .+, маржа упала до 76%/);
  await expect(dialog.getByRole('img', { name: /Цены «Кола 0,5»/ })).toBeVisible();
  const margins = dialog.getByRole('table', { name: 'Закупки и маржа' });
  // заголовок, смена цены (40 дней назад — внутри периода) и две закупки
  await expect(margins.getByRole('row')).toHaveCount(4);
  await expect(margins.getByRole('row').filter({ hasText: 'смена цены' })).toHaveCount(1);
  await expect(margins).toContainText('76');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('Excel аналитики склада отдаёт файл', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Excel склада ${Date.now()}`);
  const s = await seed(page, cid);
  await page.goto(`/c/${cid}/stock/analytics?warehouse=${s.warehouse}&period=custom&${period()}`);
  const href = await main(page).getByRole('link', { name: 'Скачать Excel' }).getAttribute('href');
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('spreadsheetml');
});

test('телефон: «Аналитика» склада без горизонтальной прокрутки, таблица прокручивается внутри', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Телефон аналитика склада ${Date.now()}`);
  const s = await seed(page, cid);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/c/${cid}/stock/analytics?warehouse=${s.warehouse}&period=custom&${period()}`);
  const table = main(page).getByRole('table', { name: 'Аналитика по товарам' });
  await expect(table.getByRole('row').filter({ hasText: 'Кола 0,5' }).first()).toBeVisible();
  await expect(table.getByRole('columnheader', { name: 'Себестоимость' })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
