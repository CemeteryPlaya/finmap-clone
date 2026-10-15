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

test('документы: поступление → продажа → остаток и себестоимость; правка закупки предупреждает; списание без остатка — ошибка; удаление продажи', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Документы ${Date.now()}`);
  const s = await stockSetup(page, cid);
  await page.goto(`/c/${cid}/stock/docs?warehouse=${s.warehouse}`);
  await expect(main(page).getByText('Документов пока нет.')).toBeVisible();

  const pick = async (scope: ReturnType<Page['locator']>, name: string, option: string) => {
    await scope.getByRole('combobox', { name, exact: true }).click();
    await page.getByRole('option', { name: option }).click();
  };

  // поступление: две строки, цена и сумма связаны
  await main(page).getByRole('button', { name: '+ Поступление' }).click();
  const receipt = page.getByRole('dialog', { name: 'Новое поступление' });
  await expect(receipt.getByLabel('Склад', { exact: true })).toHaveValue(String(s.warehouse));
  await pick(receipt, 'Поставщик', 'Поставщик А');
  const line1 = receipt.getByRole('group', { name: 'Строка 1' });
  await pick(line1, 'Товар', 'Кола 0,5');
  await line1.getByLabel('Количество, шт').fill('10');
  await line1.getByLabel('Сумма, ₸').fill('1000');
  await expect(line1.getByLabel('Цена, ₸')).toHaveValue('100');
  await receipt.getByRole('button', { name: '+ Добавить строку' }).click();
  const line2 = receipt.getByRole('group', { name: 'Строка 2' });
  await pick(line2, 'Товар', 'Чипсы');
  await line2.getByLabel('Количество, шт').fill('3');
  await line2.getByLabel('Цена, ₸').fill('70');
  await expect(line2.getByLabel('Сумма, ₸')).toHaveValue('210');
  await expect(receipt.locator('p', { hasText: 'Итого:' })).toContainText(/1\s*210\s*₸/);
  await receipt.getByRole('button', { name: 'Добавить поступление' }).click();
  await expect(receipt).toBeHidden();
  const table = main(page).getByRole('table', { name: 'Документы' });
  await expect(table.getByRole('row').filter({ hasText: 'П-0001' })).toContainText(/1\s*210\s*₸/);

  // продажа: цена по умолчанию — цена продажи товара
  await main(page).getByRole('button', { name: '+ Продажа' }).click();
  const sale = page.getByRole('dialog', { name: 'Новая продажа' });
  const saleLine = sale.getByRole('group', { name: 'Строка 1' });
  await pick(saleLine, 'Товар', 'Кола 0,5');
  await expect(saleLine.getByLabel('Цена, ₸')).toHaveValue('500');
  await saleLine.getByLabel('Количество, шт').fill('4');
  await expect(saleLine.getByLabel('Сумма, ₸')).toHaveValue('2000');
  await sale.getByRole('button', { name: 'Добавить продажу' }).click();
  await expect(sale).toBeHidden();
  await expect(table.getByRole('row').filter({ hasText: 'Р-0001' })).toContainText(/2\s*000\s*₸/);

  // «Остатки»: 6 по 100 ₸
  await main(page).getByRole('link', { name: 'Остатки', exact: true }).click();
  const balance = main(page).getByRole('table', { name: 'Остатки' });
  await expect(balance.getByRole('row').filter({ hasText: 'Кола 0,5' }).first()).toContainText('6 шт');
  await expect(balance.getByRole('row').filter({ hasText: 'Кола 0,5' }).first()).toContainText(/600\s*₸/);

  // правка закупки пересчитывает проданное: окно предупреждает
  await main(page).getByRole('link', { name: 'Документы', exact: true }).click();
  await table.getByRole('button', { name: /^Открыть поступление/ }).click();
  const edit = page.getByRole('dialog', { name: 'Поступление П-0001' });
  await edit.getByRole('group', { name: 'Строка 1' }).getByLabel('Сумма, ₸').fill('2000');
  await edit.getByRole('button', { name: 'Сохранить изменения' }).click();
  const ask = page.getByRole('alertdialog', { name: 'Изменится себестоимость' });
  await expect(ask).toContainText('Изменится себестоимость 1 продажи после');
  await ask.getByRole('button', { name: 'Сохранить' }).click();
  await expect(edit).toBeHidden();
  await main(page).getByRole('link', { name: 'Остатки', exact: true }).click();
  await expect(balance.getByRole('row').filter({ hasText: 'Кола 0,5' }).first()).toContainText(/1\s*200\s*₸/); // 6 по 200

  // ручное списание больше остатка — ошибка с названием и остатком, документ не создаётся
  await main(page).getByRole('link', { name: 'Документы', exact: true }).click();
  await main(page).getByRole('button', { name: '+ Списание' }).click();
  const writeoff = page.getByRole('dialog', { name: 'Новое списание' });
  const woLine = writeoff.getByRole('group', { name: 'Строка 1' });
  await pick(woLine, 'Товар', 'Кола 0,5');
  await woLine.getByLabel('Количество, шт').fill('100');
  await writeoff.getByRole('button', { name: 'Добавить списание' }).click();
  await expect(writeoff.getByRole('alert')).toContainText('Не хватает «Кола 0,5»: на складе 6 шт на');
  await woLine.getByLabel('Количество, шт').fill('2');
  await writeoff.getByLabel('Причина списания').selectOption({ label: 'Испорчено' });
  await writeoff.getByRole('button', { name: 'Добавить списание' }).click();
  await expect(writeoff).toBeHidden();
  await expect(table.getByRole('row').filter({ hasText: 'С-0001' })).toContainText('Испорчено');

  // удаление продажи возвращает товар на склад
  await table.getByRole('button', { name: /^Открыть продажа/ }).click();
  const saleEdit = page.getByRole('dialog', { name: 'Продажа Р-0001' });
  await saleEdit.getByRole('button', { name: 'Удалить документ' }).click();
  await page.getByRole('alertdialog', { name: 'Удалить документ?' }).getByRole('button', { name: 'Удалить' }).click();
  await expect(saleEdit).toBeHidden();
  await expect(table.getByRole('row').filter({ hasText: 'Р-0001' })).toHaveCount(0);
  await main(page).getByRole('link', { name: 'Остатки', exact: true }).click();
  await expect(balance.getByRole('row').filter({ hasText: 'Кола 0,5' }).first()).toContainText('8 шт'); // 10 \u2212 2 списанных
});

test('левая панель: группа «Склад» со стоимостью складов не входит в «Всего на счетах»; строка ведёт в «Остатки» склада; на телефоне — в выезжающей панели', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Панель ${Date.now()}`);
  const cash = (await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `/api/v1/companies/${cid}/operations`, { type: 'income', paidAt: new Date(Date.now() - 60_000).toISOString(), accountId: cash, amount: 10_000 });
  const s = await stockSetup(page, cid);
  await apiPost(page, `${s.base}/stock/docs`, { type: 'receipt', at: hoursAgo(5), warehouseId: s.warehouse, lines: [{ itemId: s.cola, qty: 10_000, amount: 100_000 }] });
  await apiPost(page, `${s.base}/stock/docs`, { type: 'receipt', at: hoursAgo(5), warehouseId: s.warehouse2, lines: [{ itemId: s.chips, qty: 3000, amount: 21_000 }] });

  await page.goto(`/c/${cid}/log`);
  const panel = page.getByRole('navigation', { name: 'Счета' });
  // «Всего на счетах» — только деньги на счетах: 100 ₸; склад (1 210 ₸) в него не входит
  await expect(panel).toContainText(/Всего на счетах\s*₸\s*100(?!\s*\d)/);
  const group = panel.getByRole('group', { name: 'Склад' });
  await expect(group.getByRole('link', { name: /Бар Клуб 1/ })).toContainText(/₸\s*1\s*000/);
  await expect(group.getByRole('link', { name: /Бар Клуб 2/ })).toContainText(/₸\s*210/);
  await expect(group).toContainText(/Склад:\s*₸\s*1\s*210/);

  // продажа уменьшает стоимость склада: панель обновляется после перезагрузки данных
  await apiPost(page, `${s.base}/stock/docs`, { type: 'sale', at: hoursAgo(1), warehouseId: s.warehouse, lines: [{ itemId: s.cola, qty: 4000, amount: 200_000 }] });
  await page.reload();
  await expect(panel.getByRole('group', { name: 'Склад' })).toContainText(/Склад:\s*₸\s*810/);
  await expect(panel).toContainText(/Всего на счетах\s*₸\s*100(?!\s*\d)/);

  // склад нельзя выбрать в форме операции: среди счетов его нет
  await page.getByRole('banner').getByRole('button', { name: 'Расход', exact: true }).click();
  await page.getByRole('dialog', { name: 'Новый расход' }).getByRole('combobox', { name: 'Со счёта', exact: true }).click();
  await expect(page.getByRole('option', { name: /Бар Клуб/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // строка склада открывает «Остатки» этого склада
  await panel.getByRole('group', { name: 'Склад' }).getByRole('link', { name: /Бар Клуб 2/ }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/stock/balance\\?warehouse=${s.warehouse2}$`));
  await expect(main(page).getByLabel('Склад', { exact: true })).toHaveValue(String(s.warehouse2));

  // телефон: та же группа в выезжающей панели «Счета»; переход закрывает панель
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('banner').getByRole('button', { name: 'Счета', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Счета' });
  await expect(drawer.getByRole('group', { name: 'Склад' }).getByRole('link', { name: /Бар Клуб 1/ })).toBeVisible();
  await drawer.getByRole('group', { name: 'Склад' }).getByRole('link', { name: /Бар Клуб 1/ }).click();
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/stock/balance\\?warehouse=${s.warehouse}$`));
});

test('оплата закупки: из расхода журнала, «Оплатить» у поступления, лишняя сумма — ошибка, удаление расхода снимает оплату; продажа → доход журнала', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Оплата ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Закупки' });
  const s = await stockSetup(page, cid);
  const docs = `${s.base}/stock/docs`;
  await apiPost(page, docs, { type: 'receipt', at: hoursAgo(5), warehouseId: s.warehouse, counterpartyId: s.supplier, lines: [{ itemId: s.cola, qty: 10_000, amount: 100_000 }] });
  await apiPost(page, docs, { type: 'receipt', at: hoursAgo(4), warehouseId: s.warehouse, counterpartyId: s.supplier, lines: [{ itemId: s.chips, qty: 2000, amount: 50_000 }] });

  // расход поставщику: «Оплата закупки» появляется, когда у него есть долги
  await page.goto(`/c/${cid}/log`);
  const banner = page.getByRole('banner');
  await banner.getByRole('button', { name: 'Расход', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Новый расход' });
  await form.getByRole('combobox', { name: 'Со счёта', exact: true }).click();
  await page.getByRole('option', { name: /Касса/ }).click();
  await expect(form.getByRole('group', { name: 'Оплата закупки' })).toHaveCount(0);
  await form.getByRole('combobox', { name: /^(Мой контрагент|Поставщик)/ }).click();
  await page.getByRole('option', { name: 'Поставщик А' }).click();
  const payments = form.getByRole('group', { name: 'Оплата закупки' });
  await expect(payments.getByRole('checkbox')).toHaveCount(2);
  await payments.getByRole('checkbox', { name: /^П-0001/ }).check();
  // сумма расхода была пуста — подставилась долгом документа
  await expect(form.getByRole('textbox', { name: /^Сумма,/ })).toHaveValue('1000');
  await expect(payments.getByLabel('Оплата по П-0001')).toHaveValue('1000');
  await payments.getByLabel('Оплата по П-0001').fill('400');
  await expect(payments).toContainText(/Распределено\s*400\s*₸ из 1\s*000\s*₸/);
  await form.getByRole('button', { name: 'Добавить расход' }).click();
  await expect(form).toBeHidden();

  // документы: оплачено 400 из 1 000; в окне поступления — «Оплатить»
  await page.goto(`/c/${cid}/stock/docs`);
  const table = main(page).getByRole('table', { name: 'Документы' });
  await expect(table.getByRole('row').filter({ hasText: 'П-0001' })).toContainText(/Оплачено\s*400\s*₸ из 1\s*000\s*₸/);
  await expect(table.getByRole('row').filter({ hasText: 'П-0002' })).toContainText(/Долг\s*500\s*₸/);
  await table.getByRole('button', { name: 'Открыть поступление П-0001' }).click();
  const receipt = page.getByRole('dialog', { name: 'Поступление П-0001' });
  await expect(receipt.getByRole('region', { name: 'Оплата' })).toContainText(/Оплачено\s*400\s*₸ из 1\s*000\s*₸\. Долг\s*600\s*₸/);
  // несохранённые правки документа: «Оплатить» недоступна, причина видна и связана с кнопкой (R6)
  await receipt.getByRole('textbox', { name: 'Комментарий' }).fill('правка');
  await expect(receipt.getByRole('button', { name: 'Оплатить' })).toHaveAccessibleDescription('Сначала сохраните изменения документа');
  await expect(receipt.getByText('Сначала сохраните изменения документа', { exact: true })).toBeVisible();
  await receipt.getByRole('textbox', { name: 'Комментарий' }).fill('');
  await receipt.getByRole('button', { name: 'Оплатить' }).click();
  const expense = page.getByRole('dialog', { name: 'Новый расход' });
  await expect(expense.getByRole('textbox', { name: /^Сумма,/ })).toHaveValue('600');
  await expect(expense.getByRole('group', { name: 'Оплата закупки' }).getByLabel('Оплата по П-0001')).toHaveValue('600');
  await expense.getByRole('combobox', { name: 'Со счёта', exact: true }).click();
  await page.getByRole('option', { name: /Касса/ }).click();
  await expense.getByRole('button', { name: 'Добавить расход' }).click();
  await expect(expense).toBeHidden();
  await page.goto(`/c/${cid}/stock/docs`);
  await expect(table.getByRole('row').filter({ hasText: 'П-0001' })).toContainText('Оплачено');
  await expect(table.getByRole('row').filter({ hasText: 'П-0001' })).not.toContainText('Долг');

  // оплат больше суммы расхода: ошибка у поля, расход не создаётся
  await banner.getByRole('button', { name: 'Расход', exact: true }).click();
  const second = page.getByRole('dialog', { name: 'Новый расход' });
  await second.getByRole('combobox', { name: 'Со счёта', exact: true }).click();
  await page.getByRole('option', { name: /Касса/ }).click();
  await second.getByRole('textbox', { name: /^Сумма,/ }).fill('100');
  await second.getByRole('combobox', { name: /^(Мой контрагент|Поставщик)/ }).click();
  await page.getByRole('option', { name: 'Поставщик А' }).click();
  const pay2 = second.getByRole('group', { name: 'Оплата закупки' });
  await expect(pay2.getByRole('checkbox')).toHaveCount(1); // П-0001 оплачено полностью
  await pay2.getByRole('checkbox', { name: /^П-0002/ }).check();
  await expect(pay2.getByLabel('Оплата по П-0002')).toHaveValue('100'); // не больше суммы расхода
  await pay2.getByLabel('Оплата по П-0002').fill('200');
  await second.getByRole('button', { name: 'Добавить расход' }).click();
  await expect(pay2.getByRole('alert')).toHaveText('Оплаты закупок больше суммы расхода');
  await page.keyboard.press('Escape');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Закрыть' }).click();

  // удаление расхода снимает его оплату (каскад)
  const ops = (await (await page.request.get(`${base}/operations`)).json()) as { items: { id: number; counterpartyId: number | null }[] };
  for (const op of ops.items.filter((o) => o.counterpartyId === s.supplier)) {
    const res = await page.request.delete(`${base}/operations/${op.id}`, { headers: csrf(page) });
    expect(res.status()).toBe(200);
  }
  await page.goto(`/c/${cid}/stock/docs`);
  await expect(table.getByRole('row').filter({ hasText: 'П-0001' })).toContainText(/Долг\s*1\s*000\s*₸/);

  // продажа → доход журнала (магазин): категория «Продажа товаров» создаётся прямо в окне
  await apiPost(page, docs, { type: 'sale', at: hoursAgo(1), warehouseId: s.warehouse, lines: [{ itemId: s.cola, qty: 2000, amount: 100_000 }] });
  await page.reload();
  await table.getByRole('button', { name: 'Открыть продажа Р-0001' }).click();
  const sale = page.getByRole('dialog', { name: 'Продажа Р-0001' });
  await sale.getByRole('button', { name: 'Провести в журнал' }).click();
  const post = page.getByRole('dialog', { name: 'Провести в журнал' });
  await post.getByRole('button', { name: 'Создать категорию «Продажа товаров»' }).click();
  await expect(post.getByLabel('Категория дохода')).toHaveText(/Продажа товаров/);
  await post.getByRole('button', { name: 'Провести' }).click();
  await expect(post).toBeHidden();
  await expect(sale.getByRole('region', { name: 'Журнал' })).toContainText(/Проведена в журнал: доход 1\s*000\s*₸/);
  await expect(sale.getByRole('button', { name: 'Провести в журнал' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(table.getByRole('row').filter({ hasText: 'Р-0001' })).toContainText('В журнале');
  const income = (await (await page.request.get(`${base}/operations`)).json()) as { items: { type: string; comment: string | null; amount: number }[] };
  expect(income.items.filter((o) => o.type === 'income')).toMatchObject([{ comment: 'Продажа Р-0001', amount: 100_000 }]);
});

test('форма документа: подсказка про единицу товара; фокус при добавлении и удалении строки', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Строки ${Date.now()}`);
  const s = await stockSetup(page, cid);
  await page.goto(`/c/${cid}/stock/docs?warehouse=${s.warehouse}`);
  await main(page).getByRole('button', { name: '+ Поступление' }).click();
  const form = page.getByRole('dialog', { name: 'Новое поступление' });
  await expect(form.getByText('Единица — шт; другие единицы задайте в «Товарах» заранее')).toBeVisible();

  await form.getByRole('button', { name: '+ Добавить строку' }).click();
  await expect(form.getByRole('group', { name: 'Строка 2' }).getByRole('combobox', { name: 'Товар', exact: true })).toBeFocused();
  await form.getByRole('button', { name: '+ Добавить строку' }).click();
  // убрать строку 2: фокус на «Товар» следующей строки (теперь она вторая)
  await form.getByRole('button', { name: 'Убрать строку 2' }).click();
  await expect(form.getByRole('group', { name: 'Строка 2' }).getByRole('combobox', { name: 'Товар', exact: true })).toBeFocused();
  // убрать последнюю: фокус на «+ Добавить строку»
  await form.getByRole('button', { name: 'Убрать строку 2' }).click();
  await expect(form.getByRole('button', { name: '+ Добавить строку' })).toBeFocused();
});
