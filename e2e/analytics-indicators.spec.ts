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

const main = (page: Page) => page.getByRole('main');
const csrf = (page: Page) => ({ origin: new URL(page.url()).origin, 'x-requested-with': 'fetch' });

async function apiPost(page: Page, url: string, data: unknown) {
  const res = await page.request.post(url, { data, headers: csrf(page) });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return res.json();
}

const almatyYear = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty', year: 'numeric' }).format(new Date());
/** Момент n минут назад, но не раньше начала текущего года по Алматы: отчёт «За текущий год» не зависит от времени запуска. */
const minutesAgo = (n: number) => new Date(Math.max(Date.now() - n * 60_000, Date.parse(`${almatyYear()}-01-01T00:00:00+05:00`))).toISOString();

/**
 * Компания (синтетика, ₸): «Клуб 1» со складом «Бар Клуб 1». Доходы «Бар» 2 000 и 700; расход «Аренда» 500; расход 1 200
 * (900 «Закуп бара» и 300 «Аренда») оплатил 1 000 поступления колы; продажа 4 колы — себестоимость 400.
 */
async function setup(page: Page, cid: number) {
  const base = `/api/v1/companies/${cid}`;
  const year = almatyYear();
  const account = (await apiPost(page, `${base}/accounts`, { name: 'Касса Клуб 1', currency: 'KZT', openedAt: `${Number(year) - 1}-12-01`, startingBalance: 0 })).account.id as number;
  const bar = (await apiPost(page, `${base}/categories`, { kind: 'income', name: 'Бар' })).category.id as number;
  const rent = (await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Аренда' })).category.id as number;
  const supply = (await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Закуп бара' })).category.id as number;
  const club1 = (await apiPost(page, `${base}/projects`, { name: 'Клуб 1', templateKey: 'general' })).project.id as number;
  const supplier = (await apiPost(page, `${base}/counterparties`, { type: 'supplier', name: 'Поставщик А' })).counterparty.id as number;
  const warehouse = (await apiPost(page, `${base}/stock/warehouses`, { projectId: club1, name: 'Бар Клуб 1' })).warehouse.id as number;
  const cola = (await apiPost(page, `${base}/stock/items`, { name: 'Кола 0,5', unit: 'pcs', salePrice: 50_000 })).item.id as number;
  const receipt = (
    await apiPost(page, `${base}/stock/docs`, { type: 'receipt', at: minutesAgo(90), warehouseId: warehouse, counterpartyId: supplier, lines: [{ itemId: cola, qty: 10_000, amount: 100_000 }] })
  ).doc.id as number;
  const op = (body: Record<string, unknown>) => apiPost(page, `${base}/operations`, { accountId: account, ...body });
  await op({
    type: 'expense',
    paidAt: minutesAgo(80),
    amount: 120_000,
    counterpartyId: supplier,
    comment: 'Закуп колы',
    lines: [
      { categoryId: supply, amount: 90_000 },
      { categoryId: rent, amount: 30_000 },
    ],
    stockPayments: [{ docId: receipt, amount: 100_000 }],
  });
  await apiPost(page, `${base}/stock/docs`, { type: 'sale', at: minutesAgo(70), warehouseId: warehouse, lines: [{ itemId: cola, qty: 4000, amount: 200_000 }] });
  await op({ type: 'income', paidAt: minutesAgo(60), amount: 200_000, comment: 'Смена Клуб 1', lines: [{ categoryId: bar, projectId: club1, amount: 200_000 }] });
  await op({ type: 'expense', paidAt: minutesAgo(50), amount: 50_000, lines: [{ categoryId: rent, projectId: club1, amount: 50_000 }] });
  await op({ type: 'income', paidAt: minutesAgo(40), amount: 70_000, lines: [{ categoryId: bar, amount: 70_000 }] });
}

const table = (page: Page) => main(page).getByRole('table', { name: 'Финансовые показатели' });
/** «Итого» строки показателя (пробелы — обычные). */
const total = async (page: Page, id: string) => (await table(page).locator(`[data-row="${id}"] td`).last().innerText()).replace(/\s+/g, ' ').trim();

test('«Финансовые показатели»: карточка, умолчания, окно «Редактировать показатель», операции значения, «История», «Вернуть по умолчанию»', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Показатели ${Date.now()}`);
  await setup(page, cid);
  await page.goto(`/c/${cid}/analytics`);
  await main(page).getByRole('link', { name: /Финансовые показатели/ }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/analytics/indicators$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Финансовые показатели' })).toBeVisible();
  await expect(table(page).getByRole('rowheader')).toHaveText(['Валовая прибыль', 'Маржинальный доход', 'EBITDA', 'Процент маржи']);
  // умолчания: «Себестоимость» — только склад (400), «Операционные» — все расходы без оплаты закупки и склад
  await expect.poll(() => total(page, 'gross')).toBe('₸ 2 300');
  expect(await total(page, 'ebitda')).toBe('₸ 1 600');
  expect(await total(page, 'margin')).toBe('59%');
  await expect(main(page).getByRole('list', { name: 'Формулы показателей' }).getByRole('listitem')).toHaveCount(4);

  // окно: «Закуп бара» в «Себестоимости», склад выключен — себестоимость 900 (оплата закупки — обычный расход)
  await table(page).getByRole('button', { name: 'Валовая прибыль', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Редактировать показатель' });
  await expect(dialog.getByRole('group', { name: 'Выручка' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Категории расхода: Категорий нет' }).click();
  await page.getByRole('checkbox', { name: 'Закуп бара' }).check();
  await page.keyboard.press('Escape');
  await dialog.getByRole('checkbox', { name: 'Себестоимость склада (FIFO)' }).uncheck();
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => total(page, 'gross')).toBe('₸ 1 800');

  // значение — операции показателя за весь период: доходы «Бара» и расход «Закуп колы»
  await table(page).locator('[data-row="gross"] td').last().getByRole('button').click();
  const list = main(page).getByRole('region', { name: /Валовая прибыль за весь период/ });
  await expect(list.getByText('Закуп колы')).toBeVisible();
  await expect(list.getByText('Смена Клуб 1')).toBeVisible();

  // «История»: запись изменения части
  await main(page).getByRole('button', { name: 'История', exact: true }).click();
  const history = main(page).getByRole('table', { name: 'История изменений показателей' });
  await expect(history.getByRole('row').nth(1)).toContainText('Изменение');
  await expect(history.getByRole('row').nth(1)).toContainText('Себестоимость проданных товаров (COGS)');
  await expect(history.getByRole('row').nth(1)).toContainText('Закуп бара');

  // «Вернуть по умолчанию» — снова только склад
  await main(page).getByRole('button', { name: 'Финансовые показатели', exact: true }).click();
  await table(page).getByRole('button', { name: 'Валовая прибыль', exact: true }).click();
  await dialog.getByRole('button', { name: 'Вернуть по умолчанию' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => total(page, 'gross')).toBe('₸ 2 300');
  await main(page).getByRole('button', { name: 'История', exact: true }).click();
  await expect(history.getByRole('row').nth(1)).toContainText('Возврат по умолчанию');
});

test('«Финансовые показатели»: телефон — контролы в панели, таблица прокручивается внутри, страница не уезжает вбок', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Показатели телефон ${Date.now()}`);
  await setup(page, cid);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/c/${cid}/analytics/indicators?step=quarter`);
  await expect.poll(() => total(page, 'margin')).toBe('59%');
  await expect(main(page).getByRole('button', { name: /^Шаг: По кварталам/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const region = main(page).getByRole('region', { name: 'Финансовые показатели: таблица' });
  expect(await region.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
});
