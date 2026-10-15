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

const csrf = (page: Page) => ({ origin: new URL(page.url()).origin, 'x-requested-with': 'fetch' });

async function apiPost(page: Page, url: string, data: unknown) {
  const res = await page.request.post(url, { data, headers: csrf(page) });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return res.json();
}

const main = (page: Page) => page.getByRole('main');

test('склады и группы в настройках, каталог товаров: создание, цена с историей, архив', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Склад ${Date.now()}`);
  await apiPost(page, `/api/v1/companies/${cid}/projects`, { name: 'Клуб 1', templateKey: 'general' });

  // настройки → «Склады»: склад проекта одним нажатием, затем группа товаров
  await page.goto(`/c/${cid}/settings/warehouses`);
  await expect(page.getByRole('heading', { level: 1, name: 'Склады' })).toBeVisible();
  await main(page).getByRole('button', { name: 'Создать склад «Бар Клуб 1»' }).click();
  const warehouses = main(page).getByRole('list', { name: 'Склады' });
  await expect(warehouses.getByRole('listitem').filter({ hasText: 'Бар Клуб 1' })).toContainText('Клуб 1');
  // у проекта не больше одного склада: кнопки больше нет
  await expect(main(page).getByRole('button', { name: /^Создать склад/ })).toHaveCount(0);

  await main(page).getByRole('button', { name: 'Добавить группу' }).click();
  const groupDialog = page.getByRole('dialog', { name: 'Новая группа' });
  await groupDialog.getByLabel('Название группы').fill('Напитки');
  await groupDialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(groupDialog).toBeHidden();
  await expect(main(page).getByRole('list', { name: 'Группы товаров' }).getByRole('listitem').filter({ hasText: 'Напитки' })).toBeVisible();

  // «Склад» в верхнем меню → «Товары»
  await page.goto(`/c/${cid}/log`);
  await main(page).getByRole('link', { name: 'Склад', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/stock/balance$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Склад' })).toBeVisible();
  await main(page).getByRole('link', { name: 'Товары', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/stock/items$`));
  await expect(main(page).getByText('Товаров пока нет.')).toBeVisible();

  // новый товар: поле цены принимает только цифры и один разделитель
  await main(page).getByRole('button', { name: '+ Товар' }).click();
  const dialog = page.getByRole('dialog', { name: 'Новый товар' });
  await dialog.getByLabel('Название товара').fill('Кола 0,5');
  await dialog.getByLabel('Группа').selectOption({ label: 'Напитки' });
  const price = dialog.getByLabel('Цена продажи, ₸');
  await price.fill('abc5,5.5');
  await expect(price).toHaveValue('5,55');
  await price.fill('500');
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(dialog).toBeHidden();
  const table = main(page).getByRole('table', { name: 'Товары' });
  const row = table.getByRole('row').filter({ hasText: 'Кола 0,5' });
  await expect(row).toContainText(/500\s*₸/);
  await expect(table.getByRole('rowgroup', { name: 'Напитки' })).toBeVisible();

  // дробное количество штук в минимальном остатке — понятная ошибка у поля
  await row.getByRole('button', { name: 'Кола 0,5' }).click();
  const editor = page.getByRole('dialog', { name: 'Товар', exact: true });
  await editor.getByLabel(/^Минимальный остаток/).fill('1,5');
  await editor.getByRole('button', { name: 'Сохранить' }).click();
  await expect(editor.getByText('Количество в штуках — целое')).toBeVisible();
  await editor.getByLabel(/^Минимальный остаток/).fill('5');
  await editor.getByRole('button', { name: 'Сохранить' }).click();
  await expect(editor).toBeHidden();
  await expect(row).toContainText('5 шт');

  // «Изменить цену»: новая цена и история
  await row.getByRole('button', { name: 'Кола 0,5' }).click();
  await editor.getByRole('button', { name: 'Изменить цену' }).click();
  const priceDialog = page.getByRole('dialog', { name: 'Цена продажи: Кола 0,5' });
  await priceDialog.getByLabel('Новая цена, ₸').fill('550');
  await priceDialog.getByRole('button', { name: 'Сохранить цену' }).click();
  await expect(priceDialog).toBeHidden();
  await expect(row).toContainText(/550\s*₸/);
  await row.getByRole('button', { name: 'Кола 0,5' }).click();
  await editor.getByRole('button', { name: 'Изменить цену' }).click();
  await expect(priceDialog.getByRole('table', { name: 'История цены' }).getByRole('row')).toHaveCount(1); // та же дата — строка заменена
  await page.keyboard.press('Escape');

  // архив вместо удаления
  await row.getByRole('button', { name: 'Кола 0,5' }).click();
  await editor.getByRole('button', { name: 'В архив' }).click();
  await expect(editor).toBeHidden();
  await expect(row).toContainText('в архиве');
});

test('без складов экран «Склад» подсказывает, где его создать', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Без склада ${Date.now()}`);
  await page.goto(`/c/${cid}/stock`);
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/stock/balance$`));
  await expect(main(page).getByText('Складов пока нет.')).toBeVisible();
  await main(page).getByRole('link', { name: 'Создайте склад в настройках' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/warehouses$`));
});

/** Склад клуба с двумя товарами и поставщиком; документы — через API. */
async function stockSetup(page: Page, cid: number) {
  const base = `/api/v1/companies/${cid}`;
  const project = (await apiPost(page, `${base}/projects`, { name: 'Клуб 1', templateKey: 'general' })).project.id as number;
  const project2 = (await apiPost(page, `${base}/projects`, { name: 'Клуб 2', templateKey: 'general' })).project.id as number;
  const warehouse = (await apiPost(page, `${base}/stock/warehouses`, { projectId: project, name: 'Бар Клуб 1' })).warehouse.id as number;
  const warehouse2 = (await apiPost(page, `${base}/stock/warehouses`, { projectId: project2, name: 'Бар Клуб 2' })).warehouse.id as number;
  const cola = (await apiPost(page, `${base}/stock/items`, { name: 'Кола 0,5', unit: 'pcs', salePrice: 50_000 })).item.id as number;
  const chips = (await apiPost(page, `${base}/stock/items`, { name: 'Чипсы', unit: 'pcs', salePrice: 70_000, minQty: 5000 })).item.id as number;
  const supplier = (await apiPost(page, `${base}/counterparties`, { type: 'supplier', name: 'Поставщик А' })).counterparty.id as number;
  return { base, project, project2, warehouse, warehouse2, cola, chips, supplier };
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

test('«Остатки»: остаток, себестоимость, наценка, партии, «Мало» и «Нет партии»; склад выбирается и хранится в адресе', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Остатки ${Date.now()}`);
  const s = await stockSetup(page, cid);
  const docs = `${s.base}/stock/docs`;
  await apiPost(page, docs, {
    type: 'receipt',
    at: hoursAgo(5),
    warehouseId: s.warehouse,
    counterpartyId: s.supplier,
    lines: [
      { itemId: s.cola, qty: 10_000, amount: 100_000 },
      { itemId: s.chips, qty: 3000, amount: 21_000 },
    ],
  });
  await apiPost(page, docs, { type: 'sale', at: hoursAgo(3), warehouseId: s.warehouse, lines: [{ itemId: s.cola, qty: 4000, amount: 200_000 }] });
  await apiPost(page, docs, { type: 'sale', at: hoursAgo(2), warehouseId: s.warehouse, lines: [{ itemId: s.chips, qty: 5000, amount: 350_000 }] });

  await page.goto(`/c/${cid}/stock`);
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/stock/balance$`));
  const table = main(page).getByRole('table', { name: 'Остатки' });
  const cola = table.getByRole('row').filter({ hasText: 'Кола 0,5' }).first();
  await expect(cola).toContainText('6 шт');
  await expect(cola).toContainText(/600\s*₸/); // себестоимость остатка: 6 по 100
  await expect(cola).toContainText(/\+400 %/); // (500 \u2212 100) / 100
  const chips = table.getByRole('row').filter({ hasText: 'Чипсы' }).first();
  await expect(chips).toContainText('\u22122 шт');
  await expect(chips).toContainText('Мало');
  await expect(chips).toContainText('Нет партии: 2 шт с ');
  await expect(chips).toContainText('Поставьте поступление датой не позже продажи или заведите начальные остатки');
  await expect(main(page).getByText(/Стоимость склада:/)).toContainText(/₸\s*600/);

  // партии раскрываются: дата, документ, поставщик, остаток, цена закупки
  await table.getByRole('button', { name: 'Партии: Кола 0,5' }).click();
  const batches = main(page).getByRole('table', { name: 'Партии: Кола 0,5' });
  await expect(batches.getByRole('row').nth(1)).toContainText('П-0001');
  await expect(batches.getByRole('row').nth(1)).toContainText('Поставщик А');
  await expect(batches.getByRole('row').nth(1)).toContainText('6 шт из 10 шт');
  await expect(batches.getByRole('row').nth(1)).toContainText(/100\s*₸/);
  await table.getByRole('button', { name: 'Партии: Кола 0,5' }).click();
  await expect(batches).toHaveCount(0);

  // товары без остатка скрыты, пока не включён флажок
  await main(page).getByRole('searchbox', { name: 'Поиск товара' }).fill('кола');
  await expect(table.getByRole('row').filter({ hasText: 'Чипсы' })).toHaveCount(0);
  await main(page).getByRole('searchbox', { name: 'Поиск товара' }).fill('');

  // другой склад — пустые остатки, склад в адресе
  await main(page).getByLabel('Склад', { exact: true }).selectOption({ label: 'Бар Клуб 2' });
  await expect(page).toHaveURL(new RegExp(`/stock/balance\\?warehouse=${s.warehouse2}$`));
  // на втором складе колы нет, а у «Чипсов» остаток 0 ниже минимального — «Мало»
  await expect(table.getByRole('row').filter({ hasText: 'Кола 0,5' })).toHaveCount(0);
  await expect(table.getByRole('row').filter({ hasText: 'Чипсы' })).toContainText('Мало');
  await expect(table.getByRole('row').filter({ hasText: 'Чипсы' })).not.toContainText('Нет партии');
  await main(page).getByRole('link', { name: 'Товары' }).click();
  await expect(page).toHaveURL(new RegExp(`/stock/items\\?warehouse=${s.warehouse2}$`));
});
