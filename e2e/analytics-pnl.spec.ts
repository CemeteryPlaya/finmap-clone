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

/** Подсказка над «Прибылью» скрывается настройкой пользователя: тесты возвращают её на место (общий пользователь admin). */
const BANNER_PREF = 'analytics.pnlBannerHidden';
const showBanner = async (page: Page) => {
  const res = await page.request.put(`/api/v1/preferences/${BANNER_PREF}`, { data: { value: false }, headers: csrf(page) });
  expect(res.ok(), await res.text()).toBe(true);
};

/**
 * Компания для «Прибыли»: «Касса Клуб 1», склад «Бар Клуб 1» проекта «Клуб 1». Поступление 10 колы за 1 000 ₸; расход
 * 1 200 ₸ «Поставщику А» (900 ₸ «Закуп бара» и 300 ₸ «Аренда») оплатил 1 000 ₸ этого поступления; продажа 4 колы
 * (себестоимость 400 ₸); продажа чипсов без поступления («Нет партии»); доход 2 000 ₸ «Бар».
 */
async function pnlSetup(page: Page, cid: number) {
  const base = `/api/v1/companies/${cid}`;
  const year = almatyYear();
  const account = (await apiPost(page, `${base}/accounts`, { name: 'Касса Клуб 1', currency: 'KZT', openedAt: `${Number(year) - 1}-12-01`, startingBalance: 0 })).account.id as number;
  const bar = (await apiPost(page, `${base}/categories`, { kind: 'income', name: 'Бар' })).category.id as number;
  const supply = (await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Закуп бара' })).category.id as number;
  const rent = (await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Аренда' })).category.id as number;
  const project = (await apiPost(page, `${base}/projects`, { name: 'Клуб 1', templateKey: 'general' })).project.id as number;
  const supplier = (await apiPost(page, `${base}/counterparties`, { type: 'supplier', name: 'Поставщик А' })).counterparty.id as number;
  const warehouse = (await apiPost(page, `${base}/stock/warehouses`, { projectId: project, name: 'Бар Клуб 1' })).warehouse.id as number;
  const cola = (await apiPost(page, `${base}/stock/items`, { name: 'Кола 0,5', unit: 'pcs', salePrice: 50_000 })).item.id as number;
  const chips = (await apiPost(page, `${base}/stock/items`, { name: 'Чипсы', unit: 'pcs', salePrice: 70_000 })).item.id as number;
  const receipt = (
    await apiPost(page, `${base}/stock/docs`, { type: 'receipt', at: minutesAgo(60), warehouseId: warehouse, counterpartyId: supplier, lines: [{ itemId: cola, qty: 10_000, amount: 100_000 }] })
  ).doc.id as number;
  await apiPost(page, `${base}/operations`, {
    type: 'expense',
    paidAt: minutesAgo(50),
    accountId: account,
    amount: 120_000,
    counterpartyId: supplier,
    comment: 'Закуп колы',
    lines: [
      { categoryId: supply, amount: 90_000 },
      { categoryId: rent, amount: 30_000 },
    ],
    stockPayments: [{ docId: receipt, amount: 100_000 }],
  });
  await apiPost(page, `${base}/stock/docs`, { type: 'sale', at: minutesAgo(40), warehouseId: warehouse, lines: [{ itemId: cola, qty: 4000, amount: 200_000 }] });
  await apiPost(page, `${base}/stock/docs`, { type: 'sale', at: minutesAgo(30), warehouseId: warehouse, lines: [{ itemId: chips, qty: 1000, amount: 70_000 }] });
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: minutesAgo(20), accountId: account, amount: 200_000, lines: [{ categoryId: bar, amount: 200_000 }] });
  return { base, account };
}

const report = (page: Page) => main(page).getByRole('table', { name: 'Прибыль' });
const reportRow = (page: Page, name: string | RegExp) =>
  report(page)
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', typeof name === 'string' ? { name, exact: true } : { name }) });
const total = (page: Page, name: string | RegExp) => reportRow(page, name).getByRole('cell').last();

test('«Прибыль»: карточка, баннер, график и таблица; склад по себестоимости, «Нет партии», операции с датой сделки; переключатель склада', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Прибыль ${Date.now()}`);
  await pnlSetup(page, cid);
  await showBanner(page);
  try {
    await page.goto(`/c/${cid}/analytics`);
    const cards = main(page).getByRole('list', { name: 'Отчёты' }).getByRole('listitem');
    await expect(cards.nth(1)).toContainText('Прибыль / P&L');
    await cards.nth(1).getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`/c/${cid}/analytics/pnl$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Прибыль' })).toBeVisible();

    // закрываемый баннер (§5.1)
    const banner = main(page).getByRole('region', { name: 'Бывает, деньги есть — а прибыли нет' });
    await expect(banner).toContainText('укажите в ней «Дату сделки»');
    await expect(banner).toContainText('Это управленческая прибыль, не бухгалтерский отчёт.');

    // график: доходы, расходы со складом, прибыль; «Нет партии» — предупреждение со ссылкой в «Остатки»
    await expect(main(page).getByRole('img', { name: /^Прибыль\. Доходы: ₸\s2\s000; Расходы: ₸\s600; Прибыль: ₸\s1\s400$/ })).toBeVisible();
    await expect(main(page).getByRole('list', { name: 'Легенда: Прибыль' }).getByRole('listitem')).toHaveText(['Доходы', 'Расходы', 'Прибыль']);
    const warning = main(page).getByText('У 1 продажи себестоимость не определена — прибыль завышена');
    await expect(warning).toBeVisible();
    await expect(main(page).getByRole('link', { name: 'Склад → Остатки' })).toHaveAttribute('href', `/c/${cid}/stock/balance`);

    // операции под графиками (R5, R8): подпись порядка одна, «Движение денег» — вторая строка под «Датой сделки»
    await expect(main(page).getByText('Новые сверху по дате платежа')).toHaveCount(1);
    // склад в списки не входит (R14): подпись одна под списками графика
    const stockNote = main(page).getByText('Себестоимость и списания склада в список операций не входят');
    await expect(stockNote).toHaveCount(1);
    const chartOps = main(page).getByRole('table', { name: 'Операции' });
    await expect(chartOps).toHaveCount(2);
    await expect(chartOps.first().getByRole('columnheader')).toHaveText(['Дата сделки', 'Сумма', 'Контрагент', 'Категория', 'Комментарий']);
    await expect(chartOps.first().locator('tbody tr').first()).toContainText('оплата');
    // доступное имя кнопки открытия содержит обе даты (I-2)
    await expect(chartOps.first().getByRole('button', { name: /^Открыть операцию: дата сделки .+, движение денег .+, / }).first()).toBeVisible();

    // таблица: «Прибыль», «Доходы», «Расходы»; оплата закупки делится по строкам расхода; себестоимость FIFO
    await main(page).getByRole('button', { name: 'Таблица', exact: true }).click();
    const names = report(page).getByRole('rowheader');
    await expect(names.nth(0)).toHaveText('Прибыль');
    await expect(names.nth(1)).toHaveText('Доходы');
    await expect(total(page, 'Прибыль')).toHaveText(/^₸\s*1\s*400$/);
    await expect(total(page, 'Закуп бара')).toHaveText(/^₸\s*150$/);
    await expect(total(page, 'Аренда')).toHaveText(/^₸\s*50$/);
    await expect(total(page, /^Себестоимость проданных товаров/)).toHaveText(/^₸\s*400$/);
    await expect(total(page, /^Списания товаров/)).toHaveText(/^₸\s*0$/);
    // системные инвестиции и дивиденды в «Прибыль» не входят даже нулём
    await expect(reportRow(page, 'Инвестиции')).toHaveCount(0);
    await expect(reportRow(page, 'Дивиденды')).toHaveCount(0);

    // ячейка → операции с «Датой сделки» и «Движением денег»; часть расхода без оплаты закупки
    await report(page).getByRole('button', { name: /^Закуп бара за весь период: / }).click();
    await expect(main(page).getByRole('heading', { level: 2, name: 'Закуп бара за весь период' })).toBeFocused();
    const ops = main(page).getByRole('table', { name: 'Операции' });
    await expect(ops.getByRole('columnheader')).toHaveText(['Дата сделки', 'Сумма', 'Движение денег', 'Счёт/остаток', 'Контрагент', 'Категория', 'Проект', 'Комментарий']);
    // порядок списка — по дате платежа (R5)
    await expect(main(page).getByText('Новые сверху по дате платежа')).toBeVisible();
    const row = ops.locator('tbody tr').filter({ hasText: 'Закуп колы' });
    await expect(row.locator('[data-column="amount"]')).toContainText(/\u2212150\s₸/);
    await expect(row.locator('[data-column="amount"]')).toContainText('часть операции');
    await expect(row.locator('[data-column="accrualDate"]')).not.toBeEmpty();
    // у категории склад не сидит - подписи нет; у «Расходов» - есть (R14)
    await expect(stockNote).toHaveCount(0);
    await report(page).getByRole('button', { name: /^Расходы за весь период: / }).click();
    await expect(main(page).getByRole('heading', { level: 2, name: 'Расходы за весь период' })).toBeFocused();
    await expect(stockNote).toBeVisible();

    // склад выключен: оплата закупки — обычный расход, строк склада и предупреждения нет; точка и «Сбросить»
    await main(page).getByRole('button', { name: 'Склад: по себестоимости' }).click();
    await page.getByRole('dialog', { name: 'Склад' }).getByRole('button', { name: 'Без учёта склада' }).click();
    await expect(page).toHaveURL(/stock=0/);
    await expect(main(page).getByRole('button', { name: 'Склад: закупки' })).toBeVisible();
    await expect(total(page, 'Закуп бара')).toHaveText(/^₸\s*900$/);
    await expect(total(page, 'Прибыль')).toHaveText(/^₸\s*800$/);
    await expect(reportRow(page, /^Себестоимость проданных товаров/)).toHaveCount(0);
    await expect(warning).toBeHidden();
    await expect(stockNote).toHaveCount(0);
    await expect(main(page).locator('[data-changed]')).toHaveCount(1);
    await main(page).getByRole('button', { name: 'Сбросить' }).click();
    await expect(page).toHaveURL(new RegExp(`/c/${cid}/analytics/pnl\\?view=table$`));
    await expect(total(page, 'Закуп бара')).toHaveText(/^₸\s*150$/);

    // «Деньги» переключатель не меняет никогда
    await page.goto(`/c/${cid}/analytics/cashflow?view=table&stock=0`);
    await expect(main(page).getByRole('table', { name: 'Деньги' }).getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Закуп бара', exact: true }) }).getByRole('cell').last()).toHaveText(/^₸\s*900$/);
    await expect(main(page).getByRole('button', { name: /^Склад:/ })).toHaveCount(0);

    // баннер закрывается, фокус — на заголовок; после перезагрузки остаётся закрытым
    await page.goto(`/c/${cid}/analytics/pnl`);
    const saved = page.waitForResponse((r) => r.url().endsWith('/preferences/analytics.pnlBannerHidden') && r.request().method() === 'PUT');
    await banner.getByRole('button', { name: 'Скрыть подсказку' }).click();
    expect((await saved).ok()).toBe(true);
    await expect(banner).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: 'Прибыль' })).toBeFocused();
    await page.reload();
    await expect(main(page).getByRole('img', { name: /^Прибыль\. / })).toBeVisible();
    await expect(banner).toHaveCount(0);
  } finally {
    await showBanner(page);
  }
});

test('«Прибыль»: на 1440 px при переключателе склада «Обновить» в одной строке с кнопкой периода (R7)', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Прибыль панель ${Date.now()}`);
  await pnlSetup(page, cid);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/c/${cid}/analytics/pnl?view=table`);
  await expect(report(page)).toBeVisible();
  const stock = main(page).getByRole('button', { name: 'Склад: по себестоимости' });
  await expect(stock).toBeVisible();
  const periodButton = main(page).getByRole('button', { name: /^Период:/ });
  const refresh = main(page).getByRole('button', { name: 'Обновить', exact: true });
  const [pb, rb] = [(await periodButton.boundingBox())!, (await refresh.boundingBox())!];
  expect(Math.abs(rb.y + rb.height / 2 - (pb.y + pb.height / 2))).toBeLessThan(2);
});

test('«Прибыль»: телефон — склад в окне «Фильтры», тип даты «По дате сделки»; компания без склада — без переключателя', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Прибыль телефон ${Date.now()}`);
  await pnlSetup(page, cid);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/c/${cid}/analytics/pnl`);
  await expect(main(page).getByRole('img', { name: /^Прибыль\. / })).toBeVisible();
  const filters = main(page).getByRole('button', { name: /^Фильтры/ });
  await filters.click();
  const dialog = page.getByRole('dialog', { name: 'Фильтры', exact: true });
  // в виде «график» процентов нет; склад — после шага
  await expect(dialog.locator('button[aria-haspopup="dialog"]')).toHaveText([
    /^За текущий год/,
    /^По категориям/,
    /^По месяцам/,
    /^Учитывать склад по себестоимости/,
    /^Категории/,
    /^Контрагенты/,
    /^Проекты/,
    /^Теги/,
    /^Счета/,
  ]);
  await dialog.getByRole('button', { name: /^Период:/ }).click();
  await expect(dialog.getByRole('dialog', { name: 'Период' })).toContainText('По дате сделки');
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: 'Склад: Учитывать склад по себестоимости' }).click();
  await dialog.getByRole('dialog', { name: 'Склад' }).getByRole('button', { name: 'Без учёта склада' }).click();
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await expect(page).toHaveURL(/\?stock=0$/);
  await expect(filters).toHaveText('Фильтры · 1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // компания без склада: переключателя нет, склад не учитывается
  await page.setViewportSize({ width: 1280, height: 720 });
  const other = await createCompany(page, `ТОО Без склада ${Date.now()}`);
  await page.goto(`/c/${other}/analytics/pnl?view=table`);
  await expect(report(page)).toBeVisible();
  await expect(main(page).getByRole('button', { name: /^Склад:/ })).toHaveCount(0);
  await expect(reportRow(page, /^Себестоимость проданных товаров/)).toHaveCount(0);
});

test('«Прибыль»: на 1600 px вторая строка даты сделки не заходит в колонку «Сумма» (I-1)', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Прибыль даты ${Date.now()}`);
  await pnlSetup(page, cid);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/c/${cid}/analytics/pnl`);
  const tables = main(page).getByRole('table', { name: 'Операции' });
  await expect(tables).toHaveCount(2);
  const rows = tables.first().locator('tbody tr');
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const dateCell = rows.nth(i).locator('td').first();
    const amountCell = rows.nth(i).locator('[data-column="amount"]');
    // правый край содержимого даты (scrollWidth) не больше левого края суммы
    const [box, amountBox] = [(await dateCell.boundingBox())!, (await amountCell.boundingBox())!];
    const contentRight = await dateCell.evaluate((el) => Math.max(...Array.from(el.querySelectorAll('*')).map((n) => n.getBoundingClientRect().right), el.getBoundingClientRect().left));
    expect(contentRight).toBeLessThanOrEqual(amountBox.x + 0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(amountBox.x + 0.5);
  }
});
