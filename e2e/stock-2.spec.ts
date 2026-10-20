import { expect, test, type Page } from '@playwright/test';

// «Склад-2»: перемещение, инвентаризация, комплекты, импорт (план 2026-10-18-warehouse-2-3, задача 7)

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
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

async function stockSetup(page: Page, cid: number) {
  const base = `/api/v1/companies/${cid}`;
  const project = (await apiPost(page, `${base}/projects`, { name: 'Клуб 1', templateKey: 'general' })).project.id as number;
  const project2 = (await apiPost(page, `${base}/projects`, { name: 'Клуб 2', templateKey: 'general' })).project.id as number;
  const warehouse = (await apiPost(page, `${base}/stock/warehouses`, { projectId: project, name: 'Бар Клуб 1' })).warehouse.id as number;
  const warehouse2 = (await apiPost(page, `${base}/stock/warehouses`, { projectId: project2, name: 'Бар Клуб 2' })).warehouse.id as number;
  const cola = (await apiPost(page, `${base}/stock/items`, { name: 'Кола 0,5', unit: 'pcs', salePrice: 50_000 })).item.id as number;
  const chips = (await apiPost(page, `${base}/stock/items`, { name: 'Чипсы', unit: 'pcs', salePrice: 70_000 })).item.id as number;
  return { base, warehouse, warehouse2, cola, chips };
}

const balanceRow = (page: Page, name: string) => main(page).getByRole('table', { name: 'Остатки' }).getByRole('row').filter({ hasText: name }).first();

test('перемещение Клуб 1 → Клуб 2: остатки и себестоимость получателя; нехватка — ошибка в форме', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Перемещение ${Date.now()}`);
  const s = await stockSetup(page, cid);
  await apiPost(page, `${s.base}/stock/docs`, { type: 'receipt', at: hoursAgo(5), warehouseId: s.warehouse, lines: [{ itemId: s.cola, qty: 10_000, amount: 100_000 }] });

  await page.goto(`/c/${cid}/stock/docs?warehouse=${s.warehouse}`);
  await main(page).getByRole('button', { name: '+ Перемещение' }).click();
  const form = page.getByRole('dialog', { name: 'Новое перемещение' });
  await expect(form.getByLabel('Откуда')).toHaveValue(String(s.warehouse));
  await form.getByLabel('Куда', { exact: true }).selectOption({ label: 'Бар Клуб 2' });
  const line = form.getByRole('group', { name: 'Строка 1' });
  await line.getByRole('combobox', { name: 'Товар', exact: true }).click();
  await page.getByRole('option', { name: 'Кола 0,5' }).click();
  await line.getByLabel('Количество, шт').fill('4');
  // у перемещения нет цены и суммы
  await expect(line.getByLabel('Сумма, ₸')).toHaveCount(0);
  await form.getByRole('button', { name: 'Добавить перемещение' }).click();
  await expect(form).toBeHidden();
  await expect(main(page).getByRole('table', { name: 'Документы' }).getByRole('row').filter({ hasText: 'М-0001' })).toContainText('Бар Клуб 1 → Бар Клуб 2');

  await page.goto(`/c/${cid}/stock/balance?warehouse=${s.warehouse2}`);
  await expect(balanceRow(page, 'Кола 0,5')).toContainText('4 шт');
  await expect(balanceRow(page, 'Кола 0,5')).toContainText(/400\s*₸/);

  // перемещать больше остатка нельзя: ошибка остаётся в форме
  await page.goto(`/c/${cid}/stock/docs?warehouse=${s.warehouse}`);
  await main(page).getByRole('button', { name: '+ Перемещение' }).click();
  await form.getByLabel('Куда', { exact: true }).selectOption({ label: 'Бар Клуб 2' });
  await line.getByRole('combobox', { name: 'Товар', exact: true }).click();
  await page.getByRole('option', { name: 'Кола 0,5' }).click();
  await line.getByLabel('Количество, шт').fill('20');
  await form.getByRole('button', { name: 'Добавить перемещение' }).click();
  await expect(form.getByRole('alert').filter({ hasText: 'Не хватает «Кола 0,5»' })).toBeVisible();
});

test('инвентаризация: строки склада → факт → черновик → «Провести» → итог и остатки; закрытие с несохранённым спрашивает', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Инвентаризация ${Date.now()}`);
  const s = await stockSetup(page, cid);
  await apiPost(page, `${s.base}/stock/docs`, { type: 'receipt', at: hoursAgo(5), warehouseId: s.warehouse, lines: [{ itemId: s.cola, qty: 3000, amount: 30_000 }] });

  await page.goto(`/c/${cid}/stock/docs?warehouse=${s.warehouse}`);
  await main(page).getByRole('button', { name: '+ Инвентаризация' }).click();
  const start = page.getByRole('dialog', { name: 'Новая инвентаризация' });
  await expect(start.getByLabel(/Заполнить товарами склада/)).toBeChecked();
  await start.getByRole('button', { name: 'Начать инвентаризацию' }).click();
  const dialog = page.getByRole('dialog', { name: 'Инвентаризация И-0001' });
  const table = dialog.getByRole('table', { name: 'Строки инвентаризации' });
  await expect(table.getByRole('row').filter({ hasText: 'Кола 0,5' })).toContainText('3 шт');
  await dialog.getByLabel('Факт: Кола 0,5, шт').fill('1');
  await expect(table.getByRole('row').filter({ hasText: 'Кола 0,5' })).toContainText('\u22122 шт');

  // несохранённое: Esc спрашивает, «Отменить» оставляет окно
  await page.keyboard.press('Escape');
  const leave = page.getByRole('alertdialog', { name: 'Ваши данные не сохранятся' });
  await leave.getByRole('button', { name: 'Отменить' }).click();
  await expect(dialog).toBeVisible();

  // окно игнорирует Esc, пока идёт запрос: сначала дождаться конца сохранения
  const patched = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/stock/docs/'));
  await dialog.getByRole('button', { name: 'Сохранить черновик' }).click();
  await patched;
  await expect(dialog.getByRole('button', { name: 'Сохранить черновик' })).not.toHaveAttribute('aria-disabled', 'true');
  await expect(dialog.getByLabel('Факт: Кола 0,5, шт')).toHaveValue('1');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  const docs = main(page).getByRole('table', { name: 'Документы' });
  await expect(docs.getByRole('row').filter({ hasText: 'И-0001' })).toContainText('Черновик');

  // открыть снова — факт на месте; провести
  await docs.getByRole('button', { name: 'Открыть инвентаризация И-0001' }).click();
  await expect(dialog.getByLabel('Факт: Кола 0,5, шт')).toHaveValue('1');
  await dialog.getByRole('button', { name: 'Провести' }).click();
  await page.getByRole('alertdialog', { name: 'Провести инвентаризацию?' }).getByRole('button', { name: 'Провести' }).click();
  await expect(dialog.getByRole('status')).toContainText(/Недостача на 200\s*₸, излишек на 0\s*₸/);
  await expect(dialog.getByLabel('Факт: Кола 0,5, шт')).toHaveCount(0);
  // кнопки после проведения исчезли, фокус на итоге — Esc закрывает окно
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(docs.getByRole('row').filter({ hasText: 'И-0001' })).toContainText('Проведена');

  await page.goto(`/c/${cid}/stock/balance?warehouse=${s.warehouse}`);
  await expect(balanceRow(page, 'Кола 0,5')).toContainText('1 шт');
});

test('комплект «Чипсы + кола»: создание в «Товарах», продажа списывает составляющие', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Комплект ${Date.now()}`);
  const s = await stockSetup(page, cid);
  await apiPost(page, `${s.base}/stock/docs`, {
    type: 'receipt',
    at: hoursAgo(5),
    warehouseId: s.warehouse,
    lines: [
      { itemId: s.cola, qty: 10_000, amount: 100_000 },
      { itemId: s.chips, qty: 10_000, amount: 50_000 },
    ],
  });

  await page.goto(`/c/${cid}/stock/items`);
  await main(page).getByRole('button', { name: '+ Товар' }).click();
  const dialog = page.getByRole('dialog', { name: 'Новый товар' });
  await dialog.getByLabel('Название товара').fill('Чипсы + кола');
  await dialog.getByLabel(/^Комплект/).check();
  await dialog.getByRole('group', { name: 'Составляющая 1' }).getByLabel('Товар').selectOption({ label: 'Чипсы' });
  await dialog.getByRole('button', { name: '+ Составляющая' }).click();
  await dialog.getByRole('group', { name: 'Составляющая 2' }).getByLabel('Товар').selectOption({ label: 'Кола 0,5' });
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(dialog).toBeHidden();
  const row = main(page).getByRole('table', { name: 'Товары' }).getByRole('row').filter({ hasText: 'Чипсы + кола' });
  await expect(row).toContainText('комплект');

  // продажа двух комплектов: по два чипсов и колы со склада
  const combo = (await (await page.request.get(`${s.base}/stock/items`)).json()).items.find((i: { name: string }) => i.name === 'Чипсы + кола').id as number;
  await apiPost(page, `${s.base}/stock/docs`, { type: 'sale', at: hoursAgo(1), warehouseId: s.warehouse, lines: [{ itemId: combo, qty: 2000, amount: 300_000 }] });
  await page.goto(`/c/${cid}/stock/balance?warehouse=${s.warehouse}`);
  await expect(balanceRow(page, 'Кола 0,5')).toContainText('8 шт');
  await expect(balanceRow(page, 'Чипсы')).toContainText('8 шт');
  await expect(main(page).getByRole('table', { name: 'Остатки' }).getByRole('row').filter({ hasText: 'Чипсы + кола' })).toHaveCount(0);
});

test('импорт каталога: ошибка строки — «Загрузить» недоступна; исправленный файл — «Будет создано» и товар в каталоге', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Импорт склада ${Date.now()}`);
  await stockSetup(page, cid);
  await page.goto(`/c/${cid}/stock/items`);
  await main(page).getByRole('button', { name: 'Импорт из Excel' }).click();
  const dialog = page.getByRole('dialog', { name: 'Импорт товаров из Excel' });
  // явная кнопка «Выбрать файл» и имя файла рядом (план 2026-10-20, задача 7); само поле скрыто
  const files = dialog.getByRole('group', { name: 'Файл' });
  await expect(files.getByRole('button', { name: 'Выбрать файл' })).toBeVisible();
  await expect(files).toContainText('Файл не выбран');
  await dialog.locator('[data-stock-import-file]').setInputFiles({ name: 'каталог.csv', mimeType: 'text/csv', buffer: Buffer.from('Название;Единица\nВода;ящ\n', 'utf8') });
  await expect(files).toContainText('каталог.csv');
  await dialog.getByRole('button', { name: 'Проверить' }).click();
  await expect(dialog.getByRole('list', { name: 'Ошибки файла' })).toContainText('Строка 2, «Единица»: Неизвестная единица «ящ»');
  await expect(dialog.getByRole('button', { name: 'Загрузить' })).toHaveAttribute('aria-disabled', 'true');

  await dialog.locator('[data-stock-import-file]').setInputFiles({ name: 'каталог.csv', mimeType: 'text/csv', buffer: Buffer.from('Название;Единица;Цена продажи\nВода;шт;300\nКола 0,5;шт;500\n', 'utf8') });
  await dialog.getByRole('button', { name: 'Проверить' }).click();
  const check = dialog.getByRole('region', { name: 'Проверка файла' });
  await expect(check).toContainText('Товаров будет создано: 1 — Вода');
  await expect(check).toContainText('Уже есть в каталоге (пропуск): 1');
  await dialog.getByRole('button', { name: 'Загрузить' }).click();
  await expect(dialog.getByRole('status')).toContainText('Товаров создано: 1');
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await expect(main(page).getByRole('table', { name: 'Товары' }).getByRole('row').filter({ hasText: 'Вода' })).toContainText(/300\s*₸/);
});

test('«Скачать шаблон» поступлений: файл со списками проходит проверку импорта', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Шаблон склада ${Date.now()}`);
  const s = await stockSetup(page, cid);
  await page.goto(`/c/${cid}/stock/docs?warehouse=${s.warehouse}`);
  await main(page).getByRole('button', { name: 'Импорт поступлений' }).click();
  const dialog = page.getByRole('dialog', { name: 'Импорт поступлений' });
  const link = dialog.getByRole('link', { name: 'Скачать шаблон' });
  await expect(link).toHaveAttribute('href', `/api/v1/companies/${cid}/stock/import/receipts/template.xlsx`);
  const file = await page.request.get((await link.getAttribute('href'))!);
  expect(file.status()).toBe(200);
  await dialog.locator('[data-stock-import-file]').setInputFiles({
    name: 'Шаблон поступлений.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await file.body(),
  });
  await expect(dialog.getByRole('group', { name: 'Файл' })).toContainText('Шаблон поступлений.xlsx');
  await dialog.getByRole('button', { name: 'Проверить' }).click();
  await expect(dialog.getByRole('region', { name: 'Проверка файла' })).toContainText('Строк в файле: 2');
  await expect(dialog.getByRole('list', { name: 'Ошибки файла' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Загрузить' })).not.toHaveAttribute('aria-disabled', 'true');
});

test('телефон: «+ Инвентаризация» — окно на весь экран, без горизонтальной прокрутки', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Телефон инвентаризация ${Date.now()}`);
  const s = await stockSetup(page, cid);
  await apiPost(page, `${s.base}/stock/docs`, { type: 'receipt', at: hoursAgo(5), warehouseId: s.warehouse, lines: [{ itemId: s.cola, qty: 3000, amount: 30_000 }] });
  const phone = { width: 390, height: 844 };
  await page.setViewportSize(phone);
  await page.goto(`/c/${cid}/stock/docs?warehouse=${s.warehouse}`);
  await main(page).getByRole('button', { name: '+ Инвентаризация' }).click();
  await page.getByRole('dialog', { name: 'Новая инвентаризация' }).getByRole('button', { name: 'Начать инвентаризацию' }).click();
  const dialog = page.getByRole('dialog', { name: 'Инвентаризация И-0001' });
  await expect(dialog.getByLabel('Факт: Кола 0,5, шт')).toBeVisible();
  const box = (await dialog.boundingBox())!;
  expect([Math.round(box.width), Math.round(box.height)]).toEqual([phone.width, phone.height]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('архивная компания: нет «+ Перемещение», «+ Инвентаризация» и импорта', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Архив склад-2 ${Date.now()}`);
  const s = await stockSetup(page, cid);
  await apiPost(page, `/api/v1/companies/${cid}/archive`, {});
  await page.goto(`/c/${cid}/stock/docs?warehouse=${s.warehouse}`);
  await expect(main(page).getByText('Компания в архиве — изменения недоступны.')).toBeVisible();
  for (const name of ['+ Перемещение', '+ Инвентаризация', 'Импорт поступлений']) await expect(main(page).getByRole('button', { name })).toHaveCount(0);
  await main(page).getByRole('link', { name: 'Товары', exact: true }).click();
  // вкладка загрузилась — только тогда отсутствие кнопки что-то значит
  await expect(main(page).getByRole('table', { name: 'Товары' })).toBeVisible();
  await expect(main(page).getByRole('button', { name: 'Импорт из Excel' })).toHaveCount(0);
});
