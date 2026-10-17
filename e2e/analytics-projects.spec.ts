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
 * Компания для «Проектов»: «Клуб 1» со складом «Бар Клуб 1», «Клуб 2», «Клуб 3» (в архиве). Доходы «Бар»: 2 000 ₸ «Клуб 1»,
 * 300 ₸ «Клуб 3», 700 ₸ без проекта; расход «Аренда» 500 ₸ «Клуб 2»; расход 1 200 ₸ без проекта (900 ₸ «Закуп бара» и 300 ₸
 * «Аренда») оплатил 1 000 ₸ поступления колы; продажа 4 колы — себестоимость 400 ₸ «Клуба 1».
 */
async function projectsSetup(page: Page, cid: number) {
  const base = `/api/v1/companies/${cid}`;
  const year = almatyYear();
  const account = (await apiPost(page, `${base}/accounts`, { name: 'Касса Клуб 1', currency: 'KZT', openedAt: `${Number(year) - 1}-12-01`, startingBalance: 0 })).account.id as number;
  const bar = (await apiPost(page, `${base}/categories`, { kind: 'income', name: 'Бар' })).category.id as number;
  const rent = (await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Аренда' })).category.id as number;
  const supply = (await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Закуп бара' })).category.id as number;
  const project = async (name: string) => (await apiPost(page, `${base}/projects`, { name, templateKey: 'general' })).project.id as number;
  const club1 = await project('Клуб 1');
  const club2 = await project('Клуб 2');
  const club3 = await project('Клуб 3');
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
  await op({ type: 'expense', paidAt: minutesAgo(50), amount: 50_000, lines: [{ categoryId: rent, projectId: club2, amount: 50_000 }] });
  await op({ type: 'income', paidAt: minutesAgo(40), amount: 30_000, lines: [{ categoryId: bar, projectId: club3, amount: 30_000 }] });
  await op({ type: 'income', paidAt: minutesAgo(30), amount: 70_000, lines: [{ categoryId: bar, amount: 70_000 }] });
  await apiPost(page, `${base}/projects/${club3}/archive`, {});
  return { base, club1, club3 };
}

const table = (page: Page) => main(page).getByRole('table', { name: 'Проекты' });
const row = (page: Page, name: string) => table(page).getByRole('row').filter({ has: page.getByRole('rowheader', { name, exact: true }) });
/**
 * Ячейки строки после названия: «Доходы», «Расходы», «Прибыль», «Доход / Расход, %», «Рентабельность, %» (пробелы — обычные).
 * Читаются повтором (expect.poll): пока грузится отчёт с новыми настройками, на экране остаётся прежний.
 */
const values = async (page: Page, name: string) => (await row(page, name).getByRole('cell').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());

test('«Проекты»: карточка, таблица по правилам «Прибыли» со складом, «—», «Без проекта» и «Всего»; итоги равны «Прибыли»; статус, режим, склад, операции ячейки, Excel', async ({ page }) => {
  await login(page);
  const name = `ТОО Проекты ${Date.now()}`;
  const cid = await createCompany(page, name);
  await projectsSetup(page, cid);

  await page.goto(`/c/${cid}/analytics`);
  const card = main(page).getByRole('list', { name: 'Отчёты' }).getByRole('listitem').nth(3);
  await expect(card).toContainText('Проекты');
  await card.getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/analytics/projects$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Проекты' })).toBeVisible();

  await expect(table(page).getByRole('columnheader')).toHaveText(['Проект', 'Доходы', 'Расходы', 'Прибыль', 'Доход / Расход, %', 'Рентабельность, %']);
  await expect(table(page).getByRole('rowheader')).toHaveText(['Клуб 1', 'Клуб 2', 'Архивные проекты (вместе)', 'Без проекта', 'Всего']);
  // «Клуб 1» — себестоимость склада 400 ₸; без проекта — 1 200 ₸ без оплаты закупки 1 000 ₸; при нуле делителя — «—»
  await expect.poll(() => values(page, 'Клуб 1')).toEqual(['₸ 2 000', '₸ 400', '₸ 1 600', '500,00', '80']);
  await expect.poll(() => values(page, 'Клуб 2')).toEqual(['₸ 0', '₸ 500', '\u2212₸ 500', '0,00', '—']);
  await expect.poll(() => values(page, 'Архивные проекты (вместе)')).toEqual(['₸ 300', '₸ 0', '₸ 300', '—', '100']);
  await expect.poll(() => values(page, 'Без проекта')).toEqual(['₸ 700', '₸ 200', '₸ 500', '350,00', '71']);
  await expect.poll(() => values(page, 'Всего')).toEqual(['₸ 3 000', '₸ 1 100', '₸ 1 900', '272,73', '63']);

  // «Доходы» «Клуба 1» → список операций, фокус на заголовке; «×» возвращает фокус в ячейку
  const incomeCell = table(page).getByRole('button', { name: /^Доходы: Клуб 1: / });
  await incomeCell.click();
  const heading = main(page).getByRole('heading', { level: 2, name: 'Доходы: Клуб 1' });
  await expect(heading).toBeFocused();
  const ops = main(page).getByRole('table', { name: 'Операции' });
  await expect(ops.locator('tbody tr')).toHaveCount(1);
  await expect(ops.locator('tbody tr')).toContainText('Смена Клуб 1');
  await main(page).getByRole('button', { name: 'Закрыть список операций' }).click();
  await expect(heading).toBeHidden();
  await expect(incomeCell).toBeFocused();
  // щелчок по строке — все операции проекта; склада в списке нет — подпись
  await row(page, 'Клуб 1').getByRole('cell').nth(2).click();
  await expect(main(page).getByRole('heading', { level: 2, name: 'Операции: Клуб 1' })).toBeFocused();
  await expect(main(page).getByText('Себестоимость и списания склада в список операций не входят')).toBeVisible();
  // «Без проекта»: расход, оплативший закупку, — частью
  await table(page).getByRole('button', { name: /^Расходы: Без проекта: / }).click();
  await expect(ops.locator('tbody tr')).toHaveCount(1);
  await expect(ops.locator('[data-column="amount"]')).toContainText(/\u2212200\s₸/);
  await expect(ops.locator('[data-column="amount"]')).toContainText('часть операции');

  // итоги равны «Прибыли» за тот же период со складом
  await page.goto(`/c/${cid}/analytics/pnl?view=table`);
  const pnl = main(page).getByRole('table', { name: 'Прибыль' });
  const pnlTotal = (label: string) => pnl.getByRole('row').filter({ has: page.getByRole('rowheader', { name: label, exact: true }) }).getByRole('cell').last();
  await expect(pnlTotal('Доходы')).toHaveText(/^₸\s3\s000$/);
  await expect(pnlTotal('Расходы')).toHaveText(/^₸\s1\s100$/);
  await expect(pnlTotal('Прибыль')).toHaveText(/^₸\s1\s900$/);

  // статус и режим — в адресе, с точками и «Сбросить»; «Всего» не меняется
  await page.goto(`/c/${cid}/analytics/projects`);
  await main(page).getByRole('button', { name: 'Проекты: Активные проекты' }).click();
  await page.getByRole('dialog', { name: 'Проекты' }).getByRole('button', { name: 'Архивные проекты' }).click();
  await expect(page).toHaveURL(/\?status=archived$/);
  await expect(table(page).getByRole('rowheader')).toHaveText(['Клуб 3 (архив)', 'Активные проекты (вместе)', 'Без проекта', 'Всего']);
  await main(page).getByRole('button', { name: 'Режим: Только проекты' }).click();
  await page.getByRole('dialog', { name: 'Режим' }).getByRole('button', { name: 'Проекты с категориями' }).click();
  await expect(page).toHaveURL(/\?status=archived&mode=categories$/);
  await expect(table(page).getByRole('rowheader')).toHaveText([
    'Клуб 3 (архив)',
    'Бар',
    'Активные проекты (вместе)',
    'Бар',
    'Аренда',
    'Себестоимость проданных товаров',
    'Без проекта',
    'Бар',
    'Аренда',
    'Закуп бара',
    'Всего',
  ]);
  await expect.poll(() => values(page, 'Всего')).toEqual(['₸ 3 000', '₸ 1 100', '₸ 1 900', '272,73', '63']);
  await expect(main(page).locator('[data-changed]')).toHaveCount(2);
  await main(page).getByRole('button', { name: 'Сбросить' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/analytics/projects$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Проекты' })).toBeFocused();

  // склад выключен: оплата закупки — обычный расход, себестоимости нет
  await main(page).getByRole('button', { name: 'Склад: по себестоимости' }).click();
  await page.getByRole('dialog', { name: 'Склад' }).getByRole('button', { name: 'Без учёта склада' }).click();
  await expect(page).toHaveURL(/\?stock=0$/);
  await expect.poll(() => values(page, 'Клуб 1')).toEqual(['₸ 2 000', '₸ 0', '₸ 2 000', '—', '100']);
  await expect.poll(() => values(page, 'Без проекта')).toEqual(['₸ 700', '₸ 1 200', '\u2212₸ 500', '58,33', '\u221271']);

  // фильтр без поля «Проекты»: проекты — строки отчёта
  await main(page).getByRole('button', { name: /^Фильтр/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Фильтры', exact: true });
  await expect(dialog.locator('button[aria-haspopup="dialog"]')).toHaveText([/^Категории/, /^Контрагенты/, /^Теги/, /^Счета/]);
  await page.keyboard.press('Escape');

  const file = page.waitForEvent('download');
  await main(page).getByRole('link', { name: 'Скачать Excel' }).click();
  expect((await file).suggestedFilename()).toMatch(new RegExp(`^${name} - Проекты - \\d{2}-\\d{2}-\\d{4} \\d{2}-\\d{2}\\.xlsx$`));
});

test('«Проекты»: телефон — контролы в окне «Фильтры», таблица прокручивается внутри, без прокрутки страницы вбок', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Проекты телефон ${Date.now()}`);
  await projectsSetup(page, cid);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/c/${cid}/analytics/projects`);
  await expect(table(page).getByRole('rowheader', { name: 'Всего', exact: true })).toBeVisible();
  const filters = main(page).getByRole('button', { name: /^Фильтры/ });
  await filters.click();
  const dialog = page.getByRole('dialog', { name: 'Фильтры', exact: true });
  await expect(dialog.locator('button[aria-haspopup="dialog"]')).toHaveText([
    /^За текущий год/,
    /^Активные проекты/,
    /^Только проекты/,
    /^Учитывать склад по себестоимости/,
    /^Категории/,
    /^Контрагенты/,
    /^Теги/,
    /^Счета/,
  ]);
  await dialog.getByRole('button', { name: 'Режим: Только проекты' }).click();
  await dialog.getByRole('dialog', { name: 'Режим' }).getByRole('button', { name: 'Проекты с категориями' }).click();
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await expect(page).toHaveURL(/\?mode=categories$/);
  await expect(filters).toHaveText('Фильтры · 1');
  await expect(table(page).getByRole('rowheader', { name: 'Себестоимость проданных товаров', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const region = main(page).getByRole('region', { name: 'Проекты: таблица' });
  expect(await region.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
});

test('«Проекты»: строки склада не кликабельны и пропускаются стрелками; стрелки, Home и End двигают фокус по ячейкам таблицы', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Проекты клавиши ${Date.now()}`);
  await projectsSetup(page, cid);
  await page.goto(`/c/${cid}/analytics/projects?mode=categories`);
  await expect(table(page).getByRole('rowheader', { name: 'Всего', exact: true })).toBeVisible();

  // строка склада: заголовок без кнопки, суммы без кнопок, щелчок списка операций не открывает
  const stock = row(page, 'Себестоимость проданных товаров').first();
  await expect(stock).toBeVisible();
  await expect(stock.getByRole('button')).toHaveCount(0);
  await stock.getByRole('cell').first().click();
  await expect(main(page).getByRole('heading', { level: 2 })).toHaveCount(0);

  // стрелка вниз от категории проекта: следующая ячейка того же столбца - не строка склада
  const barIncome = row(page, 'Бар').first().getByRole('button').nth(1);
  await barIncome.focus();
  await page.keyboard.press('ArrowDown');
  const rowOf = () => page.evaluate(() => (document.activeElement?.closest('tr') as HTMLElement | null)?.dataset.row ?? '');
  const below = await rowOf();
  expect(below).not.toBe('');
  expect(below).not.toContain(':stock:');
  await page.keyboard.press('ArrowUp');
  await expect(barIncome).toBeFocused();
  // вправо - «Расходы», Home - первая ячейка строки (название), End - последняя («Расходы»)
  await page.keyboard.press('ArrowRight');
  await expect(row(page, 'Бар').first().getByRole('button').nth(2)).toBeFocused();
  await page.keyboard.press('Home');
  await expect(row(page, 'Бар').first().getByRole('button').nth(0)).toBeFocused();
  await page.keyboard.press('End');
  await expect(row(page, 'Бар').first().getByRole('button').nth(2)).toBeFocused();
  // Enter на ячейке открывает список операций
  await page.keyboard.press('Enter');
  await expect(main(page).getByRole('heading', { level: 2 })).toBeFocused();
});

test('«Проекты»: панель в самом длинном состоянии на 1440 px умещается в одну строку (без коротких подписей статуса и режима)', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Проекты панель ${Date.now()}`);
  await projectsSetup(page, cid);
  await page.setViewportSize({ width: 1440, height: 900 });
  // статус «Архивные проекты», режим «Проекты с категориями», склад выключен, свой период - самые длинные подписи
  await page.goto(`/c/${cid}/analytics/projects?status=archived&mode=categories&stock=0&period=lastYear`);
  await expect(table(page).getByRole('rowheader', { name: 'Всего', exact: true })).toBeVisible();
  const tops = await main(page).locator('div.sticky.top-0').first().locator('button, a').evaluateAll((els) =>
    els.filter((e) => e.getBoundingClientRect().width > 0).map((e) => Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2)),
  );
  expect(tops.length).toBeGreaterThan(4);
  // центры по вертикали совпадают (перенос на вторую строку сдвинул бы их на высоту кнопки)
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(6);
});
