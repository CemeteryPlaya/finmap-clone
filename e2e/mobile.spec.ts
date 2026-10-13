import { expect, test, type Locator, type Page } from '@playwright/test';
import { excelSerial, finmapLikeRow, finmapLikeXlsx } from '../tests/helpers/finmap-like';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('Логин').fill('admin');
  await page.getByPlaceholder('Пароль').fill('e2e-password-1');
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

/** Запрос к API от имени вошедшего пользователя: кука сессии браузера и заголовки защиты от подделки. */
async function apiPost(page: Page, url: string, data: unknown) {
  const res = await page.request.post(url, { data, headers: csrf(page) });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return res.json();
}

/** Телефон из §10 (сценарий 4): ширина 390 px. */
const PHONE = { width: 390, height: 844 };
const bar = (page: Page) => page.getByRole('group', { name: 'Добавить операцию' });
const newForm = (page: Page) => page.getByRole('dialog', { name: /^Новый (доход|расход|перевод)$/ });
/** «12 окт. 2026» — дата карточки журнала (§8.4), как formatDateShortRu. */
const SHORT_MONTHS = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];
const shortDate = (iso: string) => `${Number(iso.slice(8, 10))} ${SHORT_MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
/** Сегодня по Алматы — APP_TIMEZONE e2e-сервера. */
const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date());

test('шапка телефона (§8.1–8.2): ☰ «Счета» слева, компания ▾ по центру, шестерёнка справа; «+ \u2212 ⇄» второй строкой — только значки; на компьютере те же кнопки с подписями по центру шапки', async ({ page }) => {
  await login(page);
  const name = `ТОО Шапка с очень длинным названием компании ${Date.now()}`;
  const cid = await createCompany(page, name);
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await page.reload();
  const banner = page.getByRole('banner');
  const menu = banner.getByRole('button', { name: 'Счета', exact: true });
  const company = banner.getByRole('button', { name: `Сменить компанию: ${name}`, exact: true });
  const gear = banner.getByRole('button', { name: 'Настройки', exact: true });
  const income = bar(page).getByRole('button', { name: 'Доход', exact: true });
  const middle = (b: { y: number; height: number }) => b.y + b.height / 2;

  // компьютер: ☰ нет; кнопки с подписями — по центру шапки, в одной строке с блоком компании
  await expect(menu).toBeHidden();
  await expect(bar(page).getByRole('button')).toHaveText([/\+\s*Доход/, /\u2212\s*Расход/, /⇄\s*Перевод/], { useInnerText: true });
  expect(Math.abs(middle((await income.boundingBox())!) - middle((await company.boundingBox())!))).toBeLessThan(12);

  await page.setViewportSize(PHONE);
  // телефон: ☰ у левого края, шестерёнка у правого, компания между ними — в одной строке; цели касания 44 px
  const m = (await menu.boundingBox())!;
  const c = (await company.boundingBox())!;
  const g = (await gear.boundingBox())!;
  expect(m.x).toBeLessThan(24);
  expect(g.x + g.width).toBeGreaterThan(PHONE.width - 24);
  expect(c.x).toBeGreaterThanOrEqual(m.x + m.width);
  expect(c.x + c.width).toBeLessThanOrEqual(g.x);
  expect(Math.abs(middle(c) - middle(m))).toBeLessThan(8);
  expect(Math.abs(middle(g) - middle(m))).toBeLessThan(8);
  for (const b of [m, g]) {
    expect(b.width).toBeGreaterThanOrEqual(44);
    expect(b.height).toBeGreaterThanOrEqual(44);
  }
  // название — со стрелкой ▾, без подписи «Сменить компанию»; длинное обрезается, страница вбок не едет (Review Focus 1)
  await expect(company).toContainText('▾', { useInnerText: true });
  await expect(company).not.toContainText('Сменить компанию', { useInnerText: true });
  await expectNoSideScroll(page, 'шапка телефона');
  // «+ \u2212 ⇄» — в шапке второй строкой во всю ширину, только значки; имена и подсказки — «Доход», «Расход», «Перевод»
  await expect(banner.getByRole('group', { name: 'Добавить операцию' })).toBeVisible();
  const row = (await bar(page).boundingBox())!;
  expect(row.y).toBeGreaterThanOrEqual(m.y + m.height);
  expect(row.width).toBeGreaterThan(PHONE.width - 40);
  await expect(bar(page).getByRole('button')).toHaveText(['+', '\u2212', '⇄'], { useInnerText: true });
  for (const label of ['Доход', 'Расход', 'Перевод']) {
    const button = bar(page).getByRole('button', { name: label, exact: true });
    await expect(button).toHaveAttribute('title', label);
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }

  // кнопка открывает форму своего типа; Esc без изменений закрывает, фокус — снова на кнопке
  await bar(page).getByRole('button', { name: 'Перевод', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Новый перевод', exact: true })).toBeVisible();
  await expect(newForm(page).getByRole('combobox', { name: 'Со счёта', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(newForm(page)).toBeHidden();
  await expect(bar(page).getByRole('button', { name: 'Перевод', exact: true })).toBeFocused();

  // ☰ — панель счетов, «Закрыть» — в её левом углу (§8.1, снимок Finmap m01)
  await menu.click();
  const drawer = page.getByRole('dialog', { name: 'Счета', exact: true });
  const close = (await drawer.getByRole('button', { name: 'Закрыть' }).boundingBox())!;
  const title = (await drawer.getByRole('heading', { name: 'Счета', exact: true }).boundingBox())!;
  expect(close.x + close.width).toBeLessThanOrEqual(title.x);
  expect(close.width).toBeGreaterThanOrEqual(44);
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(menu).toBeFocused();
  // название ▾ — панель «Компании»; шестерёнка — панель «Настройки» с «Выйти»
  await company.click();
  await expect(page.getByRole('dialog', { name: 'Компании' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(company).toBeFocused();
  await gear.click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Выйти' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(gear).toBeFocused();
});

test('счета на телефоне выезжают слева: итог и балансы; Esc, касание фона и «Закрыть» закрывают, фокус возвращается; переход по счёту', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Счета ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 100000 })).account.id;
  await apiPost(page, `${base}/accounts`, { name: 'Сейф', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 20000 });
  await page.setViewportSize(PHONE);
  await page.reload();

  // левой панели на узком экране нет — счета открываются кнопкой в шапке
  await expect(page.getByRole('navigation', { name: 'Счета' })).toBeHidden();
  const open = page.getByRole('banner').getByRole('button', { name: 'Счета', exact: true });
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  await open.click();
  const drawer = page.getByRole('dialog', { name: 'Счета' });
  await expect(drawer).toContainText(/Всего на счетах\s*₸\s1\s200(?![\s\d])/);
  await expect(drawer.getByRole('link', { name: /^Kaspi/ })).toContainText(/₸\s1\s000$/);
  await expect(drawer.getByRole('link', { name: /^Сейф/ })).toContainText(/₸\s200$/);
  // у левого края, справа виден затемнённый фон
  await expect.poll(async () => Math.round((await drawer.boundingBox())!.x)).toBe(0);
  expect((await drawer.boundingBox())!.width).toBeLessThan(PHONE.width - 40);
  // фокус не уходит из панели на страницу под ней
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
  }

  // Esc закрывает, фокус — снова на кнопке «Счета»
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(open).toBeFocused();
  // касание затемнённого фона справа от панели закрывает; касание внутри панели — нет
  await open.click();
  await drawer.getByText('Всего на счетах').click();
  await expect(drawer).toBeVisible();
  await page.mouse.click(PHONE.width - 10, PHONE.height / 2);
  await expect(drawer).toBeHidden();
  await expect(open).toBeFocused();
  await open.click();
  await drawer.getByRole('button', { name: 'Закрыть' }).click();
  await expect(drawer).toBeHidden();
  await expect(open).toBeFocused();

  // счёт фильтрует журнал, панель закрывается
  await open.click();
  await drawer.getByRole('link', { name: /^Kaspi/ }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log\\?account=${kaspi}$`));
  await expect(drawer).toBeHidden();
  // переход из панели — фокус на заголовок страницы (§11 этапа 1.5)
  await expect(page.getByRole('heading', { level: 1, name: 'Журнал' })).toBeFocused();
  // «Добавить счёт» в панели — окно поверх панели; Esc закрывает только окно (§7.6)
  await open.click();
  const addButton = drawer.getByRole('button', { name: 'Добавить счёт' });
  await addButton.click();
  const addDialog = page.getByRole('dialog', { name: 'Добавление нового счёта' });
  await expect(addDialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(addDialog).toBeHidden();
  await expect(drawer).toBeVisible();
  await expect(addButton).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();

  // страница без компании (новая компания): в шапке телефона — название продукта и шестерёнка «Настройки», без имени и «Выйти»
  await page.goto('/companies/new');
  await expect(page.getByRole('banner')).toContainText('Учёт');
  await page.goto(`/c/${cid}/log`);

  // компьютер: кнопки нет, на месте левая панель
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(open).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Счета' })).toBeVisible();
});

const cards = (page: Page) => page.getByRole('list', { name: 'Операции' });

test('сценарий 4 §10, ширина 390 px: расход с выражением через кнопки-операторы, журнал карточками, правка операции', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Телефон ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 1000000 });
  await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Аренда' });
  await page.reload();

  // на компьютере ряда операторов нет
  await page.getByRole('banner').getByRole('button', { name: 'Расход', exact: true }).click();
  const dialog = newForm(page);
  await expect(dialog.getByRole('combobox', { name: 'Со счёта', exact: true })).toBeFocused();
  await expect(dialog.getByRole('group', { name: /^Операторы/ })).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await page.setViewportSize(PHONE);
  await bar(page).getByRole('button', { name: 'Расход', exact: true }).click();
  // форма — на весь экран
  const box = (await dialog.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(PHONE.width - 1);
  expect(box.height).toBeGreaterThanOrEqual(PHONE.height - 1);
  const amount = dialog.getByRole('textbox', { name: /^Сумма,/ });
  const account = dialog.getByRole('combobox', { name: 'Со счёта', exact: true });
  await expect(account).toBeFocused();
  await account.click();
  await dialog.getByRole('option', { name: 'Касса', exact: true }).click();
  await expect(amount).toHaveAttribute('inputmode', 'decimal');
  const category = dialog.getByRole('combobox', { name: 'Категория', exact: true });
  await category.click();
  await dialog.getByRole('option', { name: 'Аренда', exact: true }).click();
  await expect(category).toHaveValue('Аренда');
  // выражение набирается цифрами, операторы — кнопками под полем; фокус остаётся в поле
  await amount.click();
  await page.keyboard.type('1000');
  await dialog.getByRole('button', { name: 'Оператор умножение' }).click();
  // ряд операторов — цель касания не меньше 44 px (отложенное 6a №1); рядом — иконка калькулятора
  expect((await dialog.getByRole('button', { name: 'Оператор умножение' }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(dialog.getByRole('button', { name: 'Калькулятор' })).toBeVisible();
  await expect(amount).toBeFocused();
  await page.keyboard.type('3');
  await dialog.getByRole('button', { name: 'Оператор минус' }).click();
  await page.keyboard.type('500');
  await expect(amount).toHaveValue('1000×3\u2212500');
  await amount.blur();
  await expect(amount).toHaveValue('2500');
  // калькулятор на телефоне: панель открывается, показывает выражение, 44 px и целиком в видимой области; Esc закрывает
  await dialog.getByRole('button', { name: 'Калькулятор' }).click();
  const calcPanel = page.getByRole('dialog', { name: 'Калькулятор' });
  await expect(calcPanel).toBeVisible();
  await expect(calcPanel.locator('output')).toHaveText('2500');
  const key = (await calcPanel.getByRole('button', { name: '7', exact: true }).boundingBox())!;
  expect(key.width).toBeGreaterThanOrEqual(44);
  expect(key.height).toBeGreaterThanOrEqual(44);
  const pb = (await calcPanel.boundingBox())!;
  expect(pb.y).toBeGreaterThanOrEqual(0);
  expect(pb.y + pb.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await page.keyboard.press('Escape');
  await expect(calcPanel).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(amount).toHaveValue('2500');
  await dialog.getByRole('button', { name: 'Добавить расход' }).click();
  await expect(dialog).toBeHidden();

  // журнал — карточки: дата, сумма, счёт, категория (§8.4); таблицы и флажков выделения нет
  await expect(page.getByRole('table', { name: 'Операции' })).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  const card = cards(page).getByRole('listitem').first();
  await expect(card).toContainText(/\u22122\s500\s₸/);
  await expect(card).toContainText('Аренда');
  await expect(card).toContainText('Касса');
  await expect(card).toContainText(shortDate(todayIso()));

  // правка: карточка открывает операцию на весь экран; оператор дописывается в конец суммы
  await card.getByRole('button').click();
  const edit = page.getByRole('dialog', { name: 'Расход', exact: true });
  const editAmount = edit.getByRole('textbox', { name: /^Сумма,/ });
  await expect(editAmount).toBeFocused();
  await expect(editAmount).toHaveValue('2500');
  expect((await edit.boundingBox())!.width).toBeGreaterThanOrEqual(PHONE.width - 1);
  await editAmount.click();
  await page.keyboard.press('End');
  await edit.getByRole('button', { name: 'Оператор деление' }).click();
  await page.keyboard.type('2');
  await editAmount.blur();
  await expect(editAmount).toHaveValue('1250');
  await edit.getByRole('button', { name: 'Сохранить изменения' }).click();
  await expect(edit).toBeHidden();
  await expect(cards(page).getByRole('listitem')).toHaveCount(1);
  await expect(card).toContainText(/\u22121\s250\s₸/);
  // фокус вернулся на карточку, с которой открыли форму
  await expect(card.getByRole('button')).toBeFocused();
});

test('журнал карточками догружается при прокрутке; последняя карточка не прячется под нижней панелью вкладок', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Прокрутка ${Date.now()}`);
  const cash = (await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  for (let i = 1; i <= 55; i++) {
    await apiPost(page, `/api/v1/companies/${cid}/operations`, { type: 'income', paidAt: new Date(Date.now() - i * 60_000).toISOString(), accountId: cash, amount: i * 100, comment: `№${i}` });
  }
  await page.setViewportSize(PHONE);
  await page.reload();

  const list = cards(page).getByRole('listitem');
  await expect(list).toHaveCount(50);
  await page.getByRole('button', { name: 'Показать ещё' }).scrollIntoViewIfNeeded();
  await expect(list).toHaveCount(55);
  await expect(page.getByRole('button', { name: 'Показать ещё' })).toHaveCount(0);
  // комментария в карточке нет (§8.4): последняя — самая ранняя операция, 55 ₸
  await expect(list.last()).toContainText(/\+55\s₸/);
  // в самом низу страницы последняя карточка — над закреплённой нижней панелью вкладок
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const last = (await list.last().boundingBox())!;
  const barTop = (await page.getByRole('navigation', { name: 'Разделы', exact: true }).boundingBox())!.y;
  expect(last.y + last.height).toBeLessThanOrEqual(barTop);
});

test('карточка журнала (§8.4): дата слева и сумма справа, контрагент, счёт, категория мелко; у перевода строки категории нет; комментария нет; подсказка «Открыть операцию»', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Карточка ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 1000000 })).account.id;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  const rent = (await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Аренда' })).category.id;
  const supplier = (await apiPost(page, `${base}/counterparties`, { name: 'ТОО Ромашка', type: 'supplier' })).counterparty.id;
  await apiPost(page, `${base}/operations`, {
    type: 'expense',
    paidAt: todayAgo(5),
    accountId: cash,
    amount: 250000,
    counterpartyId: supplier,
    comment: 'за октябрь',
    lines: [{ categoryId: rent, projectId: null, amount: 250000 }],
  });
  await apiPost(page, `${base}/operations`, { type: 'transfer', paidAt: todayAgo(4), accountId: cash, toAccountId: kaspi, amount: 10000 });
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: todayAgo(3), accountId: kaspi, amount: 5000 });
  await page.setViewportSize(PHONE);
  await page.reload();

  const items = cards(page).getByRole('listitem');
  await expect(items).toHaveCount(3);
  const line = (card: Locator, name: string) => card.locator(`[data-card-line="${name}"]`);
  const expense = items.filter({ hasText: 'ТОО Ромашка' });
  await expect(line(expense, 'date')).toHaveText(shortDate(todayIso()));
  await expect(line(expense, 'amount')).toHaveText(/\u22122\s500\s₸/);
  await expect(line(expense, 'counterparty')).toHaveText('ТОО Ромашка');
  await expect(line(expense, 'account')).toHaveText('Касса');
  await expect(line(expense, 'category')).toHaveText('Аренда');
  // сверху вниз: дата, контрагент, счёт, категория; сумма — в строке даты, справа
  const ys: number[] = [];
  for (const name of ['date', 'counterparty', 'account', 'category']) ys.push((await line(expense, name).boundingBox())!.y);
  expect(ys).toEqual([...ys].sort((a, b) => a - b));
  expect(new Set(ys).size).toBe(4);
  const date = (await line(expense, 'date').boundingBox())!;
  const amount = (await line(expense, 'amount').boundingBox())!;
  expect(amount.x).toBeGreaterThan(date.x + date.width);
  expect(Math.abs(amount.y - date.y)).toBeLessThan(8);
  // комментария нет; подсказка кнопки — «Открыть операцию» (отложенное 7 №4)
  await expect(expense).not.toContainText('за октябрь');
  await expect(expense.getByRole('button')).toHaveAttribute('title', 'Открыть операцию');
  // перевод: «Касса → Kaspi», без строк контрагента и категории (Review Focus 4)
  const transfer = items.filter({ hasText: 'Касса → Kaspi' });
  await expect(line(transfer, 'account')).toHaveText('Касса → Kaspi');
  await expect(line(transfer, 'category')).toHaveCount(0);
  await expect(line(transfer, 'counterparty')).toHaveCount(0);
  // доход без категории и контрагента: «Без категории», пустой строки контрагента нет
  const income = items.filter({ hasText: /\+50\s₸/ });
  await expect(line(income, 'category')).toHaveText('Без категории');
  await expect(line(income, 'counterparty')).toHaveCount(0);
});

test('выделение из широкого окна на телефоне снимается: невидимые строки не удалить массовым действием', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Выделение ${Date.now()}`);
  const cash = (await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `/api/v1/companies/${cid}/operations`, { type: 'income', paidAt: new Date(Date.now() - 60_000).toISOString(), accountId: cash, amount: 10000 });
  await page.reload();

  await page.getByRole('checkbox', { name: 'Выбрать все загруженные операции' }).check();
  const bulk = page.getByRole('region', { name: 'Действия с выбранными' });
  await expect(bulk).toContainText('Доход • 1 платёж');
  await page.setViewportSize(PHONE);
  await expect(cards(page).getByRole('listitem')).toHaveCount(1);
  await expect(bulk).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.getByRole('checkbox', { name: 'Выбрать все загруженные операции' })).not.toBeChecked();
  await expect(bulk).toHaveCount(0);
});

test('настройки на телефоне (§8.6): «Настройки» — список разделов отдельным экраном, раздел — с «← Настройки»; окно стало шире — «Контрагенты» и меню слева', async ({ page }) => {
  await login(page);
  const name = `ТОО Настройки ${Date.now()}`;
  const cid = await createCompany(page, name);
  await page.setViewportSize(PHONE);
  await page.goto(`/c/${cid}/settings`);
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Настройки', exact: true })).toBeVisible();
  // в зоне настроек панель счетов не нужна: ☰ в шапке нет
  await expect(page.getByRole('banner').getByRole('button', { name: 'Счета', exact: true })).toHaveCount(0);
  const nav = page.getByRole('navigation', { name: 'Разделы настроек' });
  // те же группы и порядок, что в меню компьютера (§4.2); «← Назад к журналу» на экране нет — в журнал ведёт нижняя панель
  await expect(nav.getByRole('group', { name: 'Мой аккаунт' }).getByRole('link')).toHaveText([/^Профиль/, /^Мои компании/]);
  await expect(nav.getByRole('group', { name, exact: true }).getByRole('link')).toHaveText([
    /^Контрагенты/,
    /^Счета/,
    /^Категории/,
    /^Проекты/,
    /^Теги/,
    /^Пользователи/,
    /^Фиксированные курсы валют/,
    /^Резервное копирование/,
  ]);
  await expect(nav.getByRole('group', { name: 'Визуальные настройки' }).getByRole('link')).toHaveText([/^Настройки журнала/]);
  await expect(nav.getByRole('link', { name: /Назад к журналу/ })).toHaveCount(0);
  for (const link of await nav.getByRole('link').all()) {
    const b = (await link.boundingBox())!;
    expect(b.height, `строка «${await link.textContent()}»`).toBeGreaterThanOrEqual(44);
    expect(b.width).toBeGreaterThan(PHONE.width - 64);
  }
  await expectNoSideScroll(page, 'экран «Настройки»');

  // раздел — на весь экран: меню разделов нет, сверху «← Настройки»; фокус на заголовке раздела
  await nav.getByRole('link', { name: /^Теги/ }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/tags$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Теги' })).toBeFocused();
  await expect(page.getByRole('navigation', { name: 'Разделы настроек' })).toBeHidden();
  const back = page.getByRole('main').getByRole('link', { name: 'Настройки', exact: true });
  expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await back.click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Настройки', exact: true })).toBeFocused();

  // окно стало шире на экране списка — список не нужен: «Контрагенты», меню разделов слева (Review Focus 3)
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/counterparties$`));
  await expect(page.getByRole('navigation', { name: 'Разделы настроек' }).getByRole('link', { name: 'Контрагенты' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('main').getByRole('link', { name: 'Настройки', exact: true })).toBeHidden();
  // на компьютере «Настройки» без раздела — сразу «Контрагенты», как раньше
  await page.goto(`/c/${cid}/settings`);
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/counterparties$`));
});

test('настройки на телефоне: ☰, ✎, «+» и «банк» в списках и ✎ компании — 44×44 px; ссылки подменю и вкладки «Проекты» — не ниже 44 px', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Касание настроек ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  for (const name of ['Альфа', 'Бета']) await apiPost(page, `${base}/tags`, { name });
  for (const name of ['Аренда', 'Связь']) await apiPost(page, `${base}/categories`, { kind: 'expense', name });
  await page.setViewportSize(PHONE);
  const square = async (target: Locator, what: string) => {
    const b = (await target.boundingBox())!;
    expect(b.width, `${what}: ширина`).toBeGreaterThanOrEqual(44);
    expect(b.height, `${what}: высота`).toBeGreaterThanOrEqual(44);
  };
  const tall = async (links: Locator, what: string) => {
    await expect(links.first()).toBeVisible();
    for (const link of await links.all()) expect((await link.boundingBox())!.height, `${what} «${await link.textContent()}»`).toBeGreaterThanOrEqual(44);
  };

  await page.goto(`/c/${cid}/settings/tags`);
  const tags = page.getByRole('main').getByRole('list', { name: 'Теги' });
  await square(tags.getByRole('button', { name: 'Переместить Альфа', exact: true }), '☰ тега');
  await square(tags.getByRole('button', { name: 'Изменить Альфа', exact: true }), '✎ тега');

  await page.goto(`/c/${cid}/settings/categories?tab=my-expense`);
  const mine = page.getByRole('main').getByRole('list', { name: 'Мои категории расхода' });
  await square(mine.getByRole('button', { name: 'Добавить подкатегорию в Аренда', exact: true }), '«+» категории');
  await square(mine.getByRole('button', { name: 'Изменить Аренда', exact: true }), '✎ категории');
  await tall(page.getByRole('navigation', { name: 'Виды категорий' }).getByRole('link'), 'пункт подменю');
  await page.goto(`/c/${cid}/settings/categories?tab=system-expense`);
  await square(page.getByRole('main').getByRole('img', { name: 'Системная — не переименовывается и не удаляется' }).first(), '«банк»');

  await page.goto(`/c/${cid}/settings/counterparties`);
  await tall(page.getByRole('navigation', { name: 'Типы контрагентов' }).getByRole('link'), 'тип контрагентов');
  await page.goto(`/c/${cid}/settings/projects`);
  await tall(page.getByRole('navigation', { name: 'Проекты и шаблоны' }).getByRole('link'), 'вкладка');

  // ✎ компании в панели «Компании»
  await page.getByRole('banner').getByRole('button', { name: /^Сменить компанию/ }).click();
  await square(page.getByRole('dialog', { name: 'Компании' }).getByRole('button', { name: /^Изменить компанию/ }).first(), '✎ компании');
});

/** Начало сегодняшнего дня по Алматы — APP_TIMEZONE e2e-сервера (с 01.03.2024 — UTC+5). */
function startOfTodayAlmaty(): number {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date());
  return Date.parse(`${day}T00:00:00+05:00`);
}

/** Момент «сегодня по Алматы»: чем больше n (0 < n < 1000), тем раньше, но всегда сегодня и не в будущем. */
const todayAgo = (n: number) => {
  const start = startOfTodayAlmaty();
  return new Date(start + (Date.now() - start) * (1 - n / 1000)).toISOString();
};

/** Вчера в полдень по Алматы. */
const yesterdayNoon = () => new Date(startOfTodayAlmaty() - 12 * 3600_000).toISOString();

test('нижняя панель «Разделы» (§8.3): «Журнал» и «Ещё» — «Пользователи», «Настройки», «История действий»; пилюли и значок истории на телефоне скрыты; на компьютере панели нет', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Вкладки ${Date.now()}`);
  const cash = (await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `/api/v1/companies/${cid}/operations`, { type: 'income', paidAt: new Date(Date.now() - 60_000).toISOString(), accountId: cash, amount: 10000 });
  await page.goto(`/c/${cid}/log?period=today`);
  const tabs = page.getByRole('navigation', { name: 'Разделы', exact: true });
  await expect(page.getByRole('table', { name: 'Операции' }).locator('tbody tr')).toHaveCount(1);
  // компьютер: панели нет, вкладка-пилюля «Журнал» — в карточке
  await expect(tabs).toBeHidden();
  await expect(page.getByRole('main').getByRole('link', { name: 'Журнал', exact: true })).toBeVisible();

  await page.setViewportSize(PHONE);
  await expect(tabs).toBeVisible();
  // у нижнего края во всю ширину; пилюля и значок истории в шапке на телефоне скрыты
  const box = (await tabs.boundingBox())!;
  expect(Math.round(box.y + box.height)).toBe(PHONE.height);
  expect(Math.round(box.width)).toBe(PHONE.width);
  await expect(page.getByRole('main').getByRole('link', { name: 'Журнал', exact: true })).toBeHidden();
  await expect(page.getByRole('banner').getByRole('button', { name: 'История действий' })).toBeHidden();
  const journal = tabs.getByRole('link', { name: 'Журнал', exact: true });
  const more = tabs.getByRole('button', { name: 'Ещё', exact: true });
  await expect(journal).toHaveAttribute('aria-current', 'page');
  const currentInk = await journal.evaluate((el) => getComputedStyle(el).color);
  await expect(more).not.toHaveCSS('color', currentInk);
  for (const tab of [journal, more]) expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  // «Ещё» — меню над панелью, внутри экрана; Esc закрывает, фокус — на «Ещё»
  const menu = page.getByRole('dialog', { name: 'Ещё', exact: true });
  await more.click();
  await expect(menu.getByRole('link')).toHaveText(['Пользователи', 'Настройки']);
  await expect(menu.getByRole('button', { name: 'История действий' })).toBeVisible();
  const m = (await menu.boundingBox())!;
  expect(m.y + m.height).toBeLessThanOrEqual(box.y);
  expect(m.x).toBeGreaterThanOrEqual(0);
  expect(m.x + m.width).toBeLessThanOrEqual(PHONE.width);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();

  // «История действий» — та же панель, что у значка в шапке компьютера; закрыли — фокус на «Ещё»
  await more.click();
  await menu.getByRole('button', { name: 'История действий' }).click();
  const history = page.getByRole('dialog', { name: 'История действий' });
  await expect(history.getByRole('list', { name: 'Последние действия' })).toBeVisible();
  await expect(menu).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(history).toBeHidden();
  await expect(more).toBeFocused();

  // «Пользователи» — раздел настроек, фокус на заголовке; панель вкладок — и в зоне настроек
  await more.click();
  await menu.getByRole('link', { name: 'Пользователи' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/users$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Пользователи' })).toBeFocused();
  await expect(tabs).toBeVisible();
  await expect(journal).not.toHaveAttribute('aria-current', 'page');
  // в зоне настроек текущая вкладка — «Ещё» (только внешний вид), «Журнал» приглушён
  await expect(more).toHaveCSS('color', currentInk);
  await expect(journal).not.toHaveCSS('color', currentInk);
  // «Журнал» — обратно в журнал с прежним фильтром (Review Focus 5)
  await journal.click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log\\?period=today$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Журнал' })).toBeFocused();
  // «Настройки» — экран со списком разделов (§8.6)
  await more.click();
  await menu.getByRole('link', { name: 'Настройки' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Настройки', exact: true })).toBeFocused();

  // компьютер: панели нет
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(tabs).toBeHidden();
});

test('история из «Ещё» не замораживает страницу, если окно стало шире телефона', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Ширина ${Date.now()}`);
  await page.setViewportSize(PHONE);
  await page.goto(`/c/${cid}/log`);
  await page.getByRole('navigation', { name: 'Разделы', exact: true }).getByRole('button', { name: 'Ещё', exact: true }).click();
  await page.getByRole('dialog', { name: 'Ещё', exact: true }).getByRole('button', { name: 'История действий' }).click();
  const history = page.getByRole('dialog', { name: 'История действий' });
  await expect(history).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(history).toBeHidden();
  // кнопки «Ещё», с которой открыли, больше не видно — фокус не пропадает в body, а идёт на заголовок страницы
  await expect(page.getByRole('heading', { level: 1, name: 'Журнал' })).toBeFocused();
  // страница отзывается: кнопка шапки открывает панель
  const headerHistory = page.getByRole('banner').getByRole('button', { name: 'История действий' });
  await headerHistory.click();
  await expect(history).toBeVisible();
  // обратно: окно стало уже телефона, значок истории скрыт — после Esc фокус тоже на заголовке
  await page.setViewportSize(PHONE);
  await page.keyboard.press('Escape');
  await expect(history).toBeHidden();
  await expect(page.getByRole('heading', { level: 1, name: 'Журнал' })).toBeFocused();
});

test('меню «Ещё»: закрывается при расширении окна (поворот телефона), касанием мимо и уходом Tab за последний пункт', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Меню Ещё ${Date.now()}`);
  await page.setViewportSize(PHONE);
  await page.goto(`/c/${cid}/log`);
  const more = page.getByRole('navigation', { name: 'Разделы', exact: true }).getByRole('button', { name: 'Ещё', exact: true });
  const menu = page.getByRole('dialog', { name: 'Ещё', exact: true });

  // касание мимо меню закрывает его
  await more.click();
  await expect(menu).toBeVisible();
  await page.mouse.click(PHONE.width / 2, 200);
  await expect(menu).toHaveCount(0);

  // Tab за последним пунктом закрывает меню, фокус — на «Ещё»
  await more.click();
  await expect(menu.getByRole('link', { name: 'Пользователи' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(menu.getByRole('link', { name: 'Настройки' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(menu.getByRole('button', { name: 'История действий' })).toBeFocused();
  await page.keyboard.press('Tab');
  // последний пункт — «Импорт из Excel» (§5.1 спецификации импорта)
  await expect(menu.getByRole('button', { name: 'Импорт из Excel' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();

  // окно стало шире (телефон повернули): панель вкладок скрыта, открытое меню не остаётся висеть в углу
  await more.click();
  await expect(menu).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(menu).toHaveCount(0);
});

test('фильтр на телефоне в один шаг (§8.5): поиск, ⟳, воронка со счётчиком и ▾ в одной строке; окно «Фильтры» на весь экран — «Период» первым, «Ещё условия», «Готово» применяет всё вместе', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Фильтры ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 1000000 })).account.id;
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: todayAgo(3), accountId: cash, amount: 50000, comment: 'выручка' });
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(2), accountId: cash, amount: 30000, comment: 'аренда' });
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: yesterdayNoon(), accountId: cash, amount: 10000, comment: 'вчерашний' });
  await page.setViewportSize(PHONE);
  await page.reload();

  const list = cards(page).getByRole('listitem');
  await expect(list).toHaveCount(3);
  // строка над списком: поиск, ⟳, воронка и ▾; панели «Период и условия», пилюли периода и «Ещё» журнала нет
  const main = page.getByRole('main');
  const search = page.getByRole('searchbox', { name: 'Поиск' });
  const refresh = main.getByRole('button', { name: 'Обновить' });
  const funnel = main.getByRole('button', { name: /^Фильтр( · \d+)?$/ });
  const quick = main.getByRole('button', { name: 'Быстрые фильтры' });
  await expect(search).toHaveAttribute('placeholder', 'Поиск');
  await expect(page.getByRole('button', { name: /^Период и условия/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Период:/ })).toHaveCount(0);
  await expect(main.getByRole('button', { name: 'Ещё', exact: true })).toHaveCount(0);
  const boxes: { x: number; y: number; width: number; height: number }[] = [];
  for (const target of [search, refresh, funnel, quick]) boxes.push((await target.boundingBox())!);
  const centre = (b: { y: number; height: number }) => b.y + b.height / 2;
  for (let i = 1; i < boxes.length; i++) {
    expect(Math.abs(centre(boxes[i]!) - centre(boxes[0]!)), 'одна строка').toBeLessThan(10);
    expect(boxes[i]!.x).toBeGreaterThan(boxes[i - 1]!.x);
    expect(boxes[i]!.height, 'цель касания').toBeGreaterThanOrEqual(44);
  }
  // ⟳, воронка и ▾ — 44×44 и по ширине (решение R4); поле поиска по ширине гибкое
  for (const b of boxes.slice(1)) expect(b.width, 'цель касания, ширина').toBeGreaterThanOrEqual(44);
  expect(boxes[3]!.x + boxes[3]!.width).toBeLessThanOrEqual(PHONE.width);
  await expectNoSideScroll(page, 'строка поиска');
  // 320×640 (решение R2 плана 1.5-5b): поиск, ⟳ и воронка — внутри экрана (воронка может перенестись строкой ниже), журнал не прокручивается вбок
  await page.setViewportSize({ width: 320, height: 640 });
  await expect(list).toHaveCount(3);
  for (const target of [search, refresh, funnel, quick]) {
    const b = (await target.boundingBox())!;
    expect(b.x, 'внутри экрана 320 px').toBeGreaterThanOrEqual(0);
    expect(b.x + b.width, 'внутри экрана 320 px').toBeLessThanOrEqual(320);
  }
  // воронка и ▾ при переносе остаются на одной строке (решение R5)
  const f320 = (await funnel.boundingBox())!;
  const q320 = (await quick.boundingBox())!;
  expect(Math.abs(f320.y + f320.height / 2 - (q320.y + q320.height / 2)), 'воронка и ▾ на одной строке, 320 px').toBeLessThan(10);
  await expectNoSideScroll(page, 'журнал, 320 px');
  await page.setViewportSize(PHONE);

  // ⟳ перечитывает журнал: операция, добавленная в обход экрана, появляется; итог — в живой области
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(1), accountId: cash, amount: 5000 });
  await refresh.click();
  await expect(list).toHaveCount(4);
  await expect(page.getByText('Журнал обновлён')).toBeAttached();

  // воронка сразу открывает окно «Фильтры» на весь экран; «Период» — первым полем
  await expect(funnel).toHaveAccessibleName('Фильтр');
  await funnel.click();
  const dialog = page.getByRole('dialog', { name: 'Фильтры', exact: true });
  const d = (await dialog.boundingBox())!;
  expect(d.width).toBeGreaterThanOrEqual(PHONE.width - 1);
  expect(d.height).toBeGreaterThanOrEqual(PHONE.height - 1);
  const period = dialog.getByRole('button', { name: /^Период:/ });
  const types = dialog.getByRole('button', { name: /^Типы платежей и категории/ });
  expect((await period.boundingBox())!.y).toBeLessThan((await types.boundingBox())!.y);
  await expect(period).toHaveAccessibleName('Период: За все время');
  // смена периода — только в черновике: «×» закрывает без изменений (Review Focus 1)
  const periodMenu = page.getByRole('dialog', { name: 'Период', exact: true });
  await period.click();
  await periodMenu.getByRole('button', { name: 'За вчера', exact: true }).click();
  await expect(period).toHaveAccessibleName('Период: За вчера');
  await expect(list).toHaveCount(4);
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(funnel).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log$`));

  // «Готово» применяет вместе период, условия окна, сумму и сортировку
  await funnel.click();
  await expect(period).toHaveAccessibleName('Период: За все время');
  await period.click();
  await periodMenu.getByRole('button', { name: 'За сегодня', exact: true }).click();
  await types.click();
  await dialog.getByRole('checkbox', { name: 'Расход', exact: true }).check();
  await page.keyboard.press('Escape');
  const more = dialog.getByRole('button', { name: 'Ещё условия' });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  await dialog.getByLabel('Сумма от').fill('60');
  await dialog.getByLabel('Сумма от').press('Enter');
  await dialog.getByLabel('Сортировка').selectOption({ label: 'Сначала крупные' });
  // выгрузка — по черновику окна
  await expect(dialog.getByRole('link', { name: 'Выгрузить в Excel' })).toHaveAttribute(
    'href',
    /\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}&amountMin=6000&types=expense&sort=amount&order=desc$/,
  );
  await expect(list).toHaveCount(4);
  // низкий экран: содержимое окна не помещается, нижняя панель должна быть прижата к низу
  await page.setViewportSize({ width: PHONE.width, height: 480 });
  // «Сохранить фильтр»: поле названия (в фокусе) видно и не закрыто нижней панелью с «Готово»
  const done = dialog.getByRole('button', { name: 'Готово' });
  const saveToggle = dialog.getByRole('button', { name: 'Сохранить фильтр' });
  await saveToggle.click();
  const nameInput = dialog.getByLabel('Название фильтра');
  await expect(nameInput).toBeFocused();
  await expect(nameInput).toBeInViewport();
  const nameBox = (await nameInput.boundingBox())!;
  const saveBox = (await dialog.getByRole('button', { name: 'Сохранить', exact: true }).boundingBox())!;
  const footerTop = (await done.boundingBox())!.y;
  expect(nameBox.y + nameBox.height, 'поле названия выше нижней панели').toBeLessThanOrEqual(footerTop);
  expect(saveBox.y + saveBox.height, '«Сохранить» выше нижней панели').toBeLessThanOrEqual(footerTop);
  await saveToggle.click();
  await expect(nameInput).toBeHidden();
  // «Готово» — на всю ширину окна (с полями) и у нижней кромки, пока открыт «Ещё условия»
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  const doneBox = (await done.boundingBox())!;
  const dialogBox = (await dialog.boundingBox())!;
  expect(doneBox.width, '«Готово» на всю ширину окна').toBeGreaterThanOrEqual(dialogBox.width - 56);
  // панель из двух строк: «Готово» сверху, под ней «Очистить» и «Сохранить фильтр» — вся панель у нижней кромки
  const dialogBottom = dialogBox.y + dialogBox.height;
  const toggleBox = (await saveToggle.boundingBox())!;
  expect(toggleBox.y + toggleBox.height, 'нижняя строка панели у кромки окна (до 36 px: поля панели и нижний отступ окна)').toBeGreaterThanOrEqual(dialogBottom - 40);
  expect(toggleBox.y + toggleBox.height).toBeLessThanOrEqual(dialogBottom);
  expect(doneBox.y + doneBox.height, '«Готово» над нижней строкой, но у кромки').toBeGreaterThanOrEqual(dialogBottom - 130);
  expect(doneBox.y + doneBox.height).toBeLessThanOrEqual(toggleBox.y);
  await page.setViewportSize(PHONE);
  // «Готово» применяет всё одним запросом журнала (Review Focus 1)
  let journalRequests = 0;
  const countJournal = (r: { method(): string; url(): string }) => {
    if (r.method() === 'GET' && new RegExp(`/api/v1/companies/${cid}/operations\\?`).test(r.url())) journalRequests += 1;
  };
  page.on('request', countJournal);
  await done.click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log\\?period=today&min=6000&type=expense&sort=amount$`));
  await expect.poll(() => journalRequests, { message: 'запрос журнала после «Готово»' }).toBe(1);
  await expect(list).toHaveCount(1);
  expect(journalRequests, 'ровно один запрос журнала на «Готово»').toBe(1);
  page.off('request', countJournal);
  await expect(list.first()).toContainText(/\u2212300\s₸/);
  // на воронке — период, сумма «от» и тип
  await expect(funnel).toHaveAccessibleName('Фильтр · 3');

  // окно открывается с применённым; «Ещё условия» уже открыт — задана сумма
  await funnel.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await expect(dialog.getByLabel('Сумма от')).toHaveValue('60');
  // «Очистить» снимает период, условия и сумму; сортировка остаётся
  await dialog.getByRole('button', { name: 'Очистить' }).click();
  await expect(period).toHaveAccessibleName('Период: За все время');
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log\\?sort=amount$`));
  await expect(list).toHaveCount(4);
  await expect(funnel).toHaveAccessibleName('Фильтр');

  // «Быстрые фильтры» — рядом с воронкой; Esc закрывает только список
  await quick.click();
  const saved = page.getByRole('dialog', { name: 'Быстрые фильтры' });
  await expect(saved).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(saved).toBeHidden();
  await expect(quick).toBeFocused();

  // поиск — без окна
  await search.fill('вчерашн');
  await expect(list).toHaveCount(1);
  await search.fill('');
  await expect(list).toHaveCount(4);

  // окно открыто, а окно браузера стало шире (поворот телефона): набранный период не теряется (Review Focus 2)
  await funnel.click();
  await period.click();
  await periodMenu.getByRole('button', { name: 'За вчера', exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 720 });
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await expect(page).toHaveURL(/period=yesterday/);
  await expect(page.getByRole('table', { name: 'Операции' }).locator('tbody tr')).toHaveCount(1);
});

/**
 * Ни страница, ни открытые окна (`dialog[open]` — форма, «Фильтры», выезжающие панели лежат в верхнем слое,
 * ширину страницы они не меняют) не шире своей видимой области: ничего не прокручивается вбок.
 */
/** Намеренная отрицательная проверка: за 300 мс не должно уйти ни одного изменяющего запроса (ожидание обязано истечь). */
async function expectNoWriteRequest(page: Page) {
  await expect(page.waitForRequest((r) => r.method() !== 'GET', { timeout: 300 })).rejects.toThrow();
}

async function expectNoSideScroll(page: Page, where: string) {
  const boxes = await page.evaluate(() =>
    [document.documentElement, ...Array.from(document.querySelectorAll<HTMLElement>('dialog[open]'))].map((el) => ({
      what: el === document.documentElement ? 'страница' : `окно «${el.querySelector('h2')?.textContent ?? ''}»`,
      scroll: el.scrollWidth,
      client: el.clientWidth,
    })),
  );
  for (const b of boxes) expect(b.scroll, `${where}, ${b.what}: ширина содержимого ${b.scroll} px при ${b.client} px`).toBeLessThanOrEqual(b.client);
}

const SETTINGS = ['projects', 'accounts', 'categories', 'counterparties', 'tags', 'split-presets', 'rates', 'companies', 'users', 'profile', 'audit', 'backup'];

test('ширина 390 px: журнал, все разделы настроек, история с подробностями и форма не прокручиваются вбок', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await login(page);
  const cid = await createCompany(page, `ТОО Очень длинное название компании для проверки ширины ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса основная наличные', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 12345678 })).account.id;
  const rent = (await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Аренда помещения под компьютерный клуб' })).category.id;
  await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Оборудование_для_компьютерного_клуба_без_пробелов' });
  await apiPost(page, `${base}/counterparties`, { type: 'supplier', name: 'ТОО Очень длинное название поставщика оборудования' });
  await apiPost(page, `${base}/tags`, { name: 'длинный-тег-для-проверки-ширины' });
  await apiPost(page, `${base}/split-presets`, { name: 'Аренда целиком', lines: [{ categoryId: rent, projectId: null, bp: 10000 }] });
  await apiPost(page, `${base}/operations`, {
    type: 'expense',
    paidAt: todayAgo(2),
    accountId: cash,
    amount: 1234567,
    comment: 'Очень длинный комментарий к операции, чтобы проверить перенос строк в карточке журнала',
    lines: [{ categoryId: rent, projectId: null, amount: 1234567 }],
  });
  // в истории — значение без пробелов: «Было / Стало» не должны растягивать экран
  const renamed = await page.request.patch(`${base}/accounts/${cash}`, {
    data: { name: 'Касса_без_пробелов_с_очень_длинным_названием_для_проверки_ширины' },
    headers: csrf(page),
  });
  expect(renamed.status()).toBe(200);

  await page.goto(`/c/${cid}/log`);
  await expect(cards(page).getByRole('listitem')).toHaveCount(1);
  await expectNoSideScroll(page, 'журнал');

  for (const section of SETTINGS) {
    await page.goto(`/c/${cid}/settings/${section}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('main').getByText('Загрузка…')).toHaveCount(0);
    await expectNoSideScroll(page, section);
  }

  // история: подробности изменения с длинным значением
  await page.goto(`/c/${cid}/settings/audit`);
  const details = page.getByText('Подробности');
  await expect(details.first()).toBeVisible();
  for (const summary of await details.all()) await summary.click();
  await expect(page.getByRole('main')).toContainText('Касса_без_пробелов');
  await expectNoSideScroll(page, 'история с подробностями');

  // шаблон разделения в правке: строка — карточкой, у категории вся ширина
  await page.goto(`/c/${cid}/settings/split-presets`);
  await page.getByRole('button', { name: 'Изменить Аренда целиком', exact: true }).click();
  const category = page.getByRole('combobox', { name: 'Категория, строка 1' });
  await expect(category).toBeVisible();
  expect((await category.boundingBox())!.width).toBeGreaterThan(250);
  await expectNoSideScroll(page, 'шаблон разделения');

  // форма операции на весь экран с раскрытым блоком «Проект, теги, комментарий»
  await page.goto(`/c/${cid}/log`);
  await bar(page).getByRole('button', { name: 'Расход', exact: true }).click();
  await newForm(page).getByRole('button', { name: 'Добавить проект, тег, комментарий, файл' }).click();
  await expect(newForm(page).getByLabel('Комментарий')).toBeVisible();
  // длинное название счёта «Касса_без_пробелов_…»: поле со списком не растягивает форму
  await newForm(page).getByRole('combobox', { name: 'Со счёта', exact: true }).click();
  await newForm(page).getByRole('option', { name: /^Касса_без_пробелов/ }).click();
  await expect(newForm(page).getByRole('combobox', { name: 'Со счёта', exact: true })).toHaveValue(/^Касса_без_пробелов/);
  await expectNoSideScroll(page, 'форма операции');
  const close = newForm(page).getByRole('button', { name: 'Закрыть', exact: true });
  expect((await close.boundingBox())!.x + (await close.boundingBox())!.width).toBeLessThanOrEqual(PHONE.width);
  await page.keyboard.press('Escape');
  await page.getByRole('alertdialog', { name: 'Ваши данные не сохранятся' }).getByRole('button', { name: 'Закрыть' }).click();
  await expect(newForm(page)).toBeHidden();

  // окно «Фильтры» (воронка, §8.5): длинное название категории переносится, панель поля не шире экрана
  await page.getByRole('main').getByRole('button', { name: 'Фильтр', exact: true }).click();
  const filter = page.getByRole('dialog', { name: 'Фильтры', exact: true });
  // длинное название — в списке поля «Типы платежей и категории»: переносится, панель не шире экрана
  await filter.getByRole('button', { name: /^Типы платежей и категории/ }).click();
  await expect(filter.getByRole('checkbox', { name: 'Оборудование_для_компьютерного_клуба_без_пробелов' })).toBeVisible();
  await expectNoSideScroll(page, 'окно «Фильтры»');
  const rights = await filter.locator('fieldset').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right));
  expect(Math.max(...rights)).toBeLessThanOrEqual(PHONE.width);
  // Tab и Shift+Tab ходят по кругу внутри окна: фокус не уходит на панель под ним и в адресную строку
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press(key);
      expect(await filter.evaluate((d) => d.contains(document.activeElement)), `${key} №${i + 1}`).toBe(true);
    }
  }
});

test('форма «Новый расход»: Tab и Shift+Tab ходят по кругу, фокус не покидает окно', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await login(page);
  const cid = await createCompany(page, `ТОО Tab ${Date.now()}`);
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await page.goto(`/c/${cid}/log`);
  await bar(page).getByRole('button', { name: 'Расход', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Новый расход', exact: true })).toBeVisible();
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press(key);
      const inForm = await newForm(page).evaluate((d) => document.activeElement?.closest('dialog') === d);
      expect(inForm, `${key} №${i + 1}`).toBe(true);
    }
  }
});

test('архивная компания: форма операции только для просмотра, кнопок «Доход», «Расход», «Перевод» нет — на компьютере и на телефоне', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Архивная ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 30000 })).account.id;
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: new Date(Date.now() - 60_000).toISOString(), accountId: cash, amount: 30000, comment: 'до архива' });
  // в архив компанию переводят после её счетов (баланс нулевой)
  await apiPost(page, `${base}/accounts/${cash}/archive`, {});
  await apiPost(page, `${base}/archive`, {});
  await page.reload();

  // компьютер: кнопок новых операций в шапке нет, операция открывается только для просмотра
  await expect(page.getByRole('banner').getByRole('button', { name: 'Расход', exact: true })).toHaveCount(0);
  await page.getByRole('table', { name: 'Операции' }).getByRole('button', { name: /^Открыть операцию/ }).click();
  const view = page.getByRole('dialog', { name: 'Расход', exact: true });
  await expect(view).toContainText('Компания в архиве — изменения недоступны');
  await expect(view.getByRole('textbox', { name: /^Сумма,/ })).toHaveValue('300');
  await expect(view.getByRole('textbox', { name: /^Сумма,/ })).toBeDisabled();
  await expect(view.getByLabel('Комментарий')).toHaveValue('до архива');
  await expect(view.getByLabel('Комментарий')).toBeDisabled();
  for (const name of ['Сохранить изменения', 'Добавить и создать похожий', 'Изменить в перевод', 'Дублировать платёж', 'Удалить платёж']) {
    await expect(view.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await expect(view.getByLabel('Добавить файл')).toHaveCount(0);
  // калькулятора в поле суммы нет (форма только для просмотра)
  await expect(view.getByRole('button', { name: 'Калькулятор' })).toHaveCount(0);
  // R3: поле суммы недоступно — фокус сразу на «×», а не на самом окне; другой кнопки закрытия в форме нет
  await expect(view.getByRole('button', { name: 'Закрыть', exact: true })).toHaveCount(1);
  await expect(view.getByRole('button', { name: 'Закрыть', exact: true })).toBeFocused();
  // отправка формы ничего не меняет: окно остаётся, запросов на изменение нет
  const writes: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET') writes.push(`${r.method()} ${r.url()}`);
  });
  // Enter на «×» нажимает её саму, поэтому отправку формы (то, что делает Enter в поле) вызываем напрямую
  await view.getByRole('form', { name: 'Операция' }).evaluate((f) => (f as HTMLFormElement).requestSubmit());
  await expectNoWriteRequest(page);
  await expect(view).toBeVisible();
  expect(writes).toEqual([]);
  // R2: Tab и Shift+Tab по кругу — фокус не выходит из окна
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press(key);
      const inForm = await view.evaluate((d) => document.activeElement?.closest('dialog') === d);
      expect(inForm, `${key} №${i + 1}`).toBe(true);
    }
  }
  await view.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(view).toBeHidden();

  // телефон: кнопок операций в шапке нет, карточка открывает ту же форму для просмотра; Esc закрывает без вопросов
  await page.setViewportSize(PHONE);
  await expect(bar(page)).toHaveCount(0);
  // нижняя панель вкладок у архивной компании есть: навигация не меняет данных
  await expect(page.getByRole('navigation', { name: 'Разделы', exact: true })).toBeVisible();
  await cards(page).getByRole('button').first().click();
  await expect(view).toContainText('Компания в архиве — изменения недоступны');
  await expect(view.getByRole('button', { name: 'Сохранить изменения' })).toHaveCount(0);
  await expect(view.getByRole('button', { name: 'Закрыть', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(view).toBeHidden();
});

test('список поля над экранной клавиатурой телефона: место считается по видимой области (visualViewport)', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Клавиатура ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 1000000 });
  for (let i = 1; i <= 18; i++) await apiPost(page, `${base}/categories`, { kind: 'expense', name: `Категория ${String(i).padStart(2, '0')}` });
  await page.setViewportSize(PHONE);
  await page.reload();
  await bar(page).getByRole('button', { name: 'Расход', exact: true }).click();
  const dialog = newForm(page);
  const category = dialog.getByRole('combobox', { name: 'Категория', exact: true });
  await category.click();
  const list = dialog.getByRole('listbox', { name: 'Категории' }).locator('..');
  await expect(list).toBeVisible();
  // без клавиатуры список занимает почти весь экран
  const before = (await list.boundingBox())!;
  expect(before.y + before.height).toBeGreaterThan(560);
  // Playwright не умеет показывать экранную клавиатуру: подменяем видимую область (над клавиатурой остаётся 500 px) и сообщаем об изменении
  await page.evaluate(() => {
    const fake = Object.assign(new EventTarget(), { width: 390, height: 500, offsetTop: 0, offsetLeft: 0, scale: 1, pageTop: 0, pageLeft: 0 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: fake });
    window.dispatchEvent(new Event('resize'));
  });
  await expect(async () => {
    const box = (await list.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(500);
    expect(box.y).toBeGreaterThanOrEqual(0);
  }).toPass();
  // список прокручивается внутри себя: последняя категория достижима
  await dialog.getByRole('option', { name: 'Категория 18', exact: true }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole('option', { name: 'Категория 18', exact: true })).toBeVisible();
});

test('список поля следит за видимой областью (visualViewport) только пока открыт: подписка при открытии, пересчёт по её событию, отписка при закрытии', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Видимая область ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 1000000 });
  for (let i = 1; i <= 18; i++) await apiPost(page, `${base}/categories`, { kind: 'expense', name: `Категория ${String(i).padStart(2, '0')}` });
  await page.setViewportSize(PHONE);
  await page.reload();
  // подменная видимая область — до открытия списка, со счётчиком подписок (итоги 1.5-3a №1)
  await page.evaluate(() => {
    const fake = Object.assign(new EventTarget(), { width: 390, height: 844, offsetTop: 0, offsetLeft: 0, scale: 1, pageTop: 0, pageLeft: 0 });
    const w = window as unknown as { __vvListeners: number };
    w.__vvListeners = 0;
    const add = fake.addEventListener.bind(fake);
    const remove = fake.removeEventListener.bind(fake);
    fake.addEventListener = (...args: Parameters<EventTarget['addEventListener']>) => {
      w.__vvListeners++;
      add(...args);
    };
    fake.removeEventListener = (...args: Parameters<EventTarget['removeEventListener']>) => {
      w.__vvListeners--;
      remove(...args);
    };
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: fake });
  });
  const listeners = () => page.evaluate(() => (window as unknown as { __vvListeners: number }).__vvListeners);

  await bar(page).getByRole('button', { name: 'Расход', exact: true }).click();
  const dialog = newForm(page);
  const category = dialog.getByRole('combobox', { name: 'Категория', exact: true });
  await expect(category).toBeVisible();
  expect(await listeners(), 'пока списка нет, подписок нет').toBe(0);
  await category.click();
  const listbox = dialog.getByRole('listbox', { name: 'Категории' });
  const panel = listbox.locator('..');
  await expect(listbox).toBeVisible();
  await expect.poll(listeners).toBeGreaterThan(0);
  // клавиатура поднялась: над ней 500 px; событие — только у visualViewport, размер окна не менялся
  await page.evaluate(() => {
    const v = window.visualViewport as unknown as EventTarget & { height: number };
    v.height = 500;
    v.dispatchEvent(new Event('resize'));
  });
  await expect(async () => {
    const box = (await panel.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(500);
    expect(box.y).toBeGreaterThanOrEqual(0);
  }).toPass();
  // список закрыт — подписок на видимую область не осталось
  await page.keyboard.press('Escape');
  await expect(listbox).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect.poll(listeners).toBe(0);
});

test('формы на 390 px (§8.7): доход, расход, перевод — на весь экран без прокрутки вбок, ряд операторов и калькулятор, главная кнопка во всю ширину, «×» в липкой шапке; «Указать», выделения и колонок на телефоне нет', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Формы 390 ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 1000000 })).account.id;
  await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' });
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(2), accountId: cash, amount: 30000 });
  await page.setViewportSize(PHONE);
  await page.reload();
  await expect(cards(page).getByRole('listitem')).toHaveCount(1);
  // «Указать», выделение и колонки на телефоне не показываются
  await expect(page.getByRole('button', { name: /Указать/ })).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Колонки' })).toHaveCount(0);

  for (const [label, title, submit] of [
    ['Доход', 'Новый доход', 'Добавить доход'],
    ['Расход', 'Новый расход', 'Добавить расход'],
    ['Перевод', 'Новый перевод', 'Добавить перевод'],
  ] as const) {
    await bar(page).getByRole('button', { name: label, exact: true }).click();
    const form = page.getByRole('dialog', { name: title, exact: true });
    const box = (await form.boundingBox())!;
    expect(box.width, title).toBeGreaterThanOrEqual(PHONE.width - 1);
    expect(box.height, title).toBeGreaterThanOrEqual(PHONE.height - 1);
    // ряд операторов под суммой — вместе с иконкой калькулятора (§8.7)
    await expect(form.getByRole('group', { name: /^Операторы/ }).first()).toBeVisible();
    await expect(form.getByRole('button', { name: 'Калькулятор' }).first()).toBeVisible();
    await expectNoSideScroll(page, title);
    // главная кнопка — внизу формы во всю ширину; «×» в липкой шапке видна и после прокрутки
    const main = form.getByRole('button', { name: submit, exact: true });
    await main.scrollIntoViewIfNeeded();
    const b = (await main.boundingBox())!;
    expect(b.width, `${title}: ширина главной кнопки`).toBeGreaterThan(PHONE.width - 64);
    expect(b.height).toBeGreaterThanOrEqual(44);
    await expect(form.getByRole('button', { name: 'Закрыть', exact: true })).toBeInViewport();
    await form.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(form).toBeHidden();
  }
});

test.describe('касание (pointer: coarse), ширина 390 px', () => {
  test.use({ hasTouch: true });

  test('форма операции открывается без фокуса в поле: экранная клавиатура не поднимается, фокус на «×»', async ({ page }) => {
    await login(page);
    const cid = await createCompany(page, `ТОО Без клавиатуры ${Date.now()}`);
    await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
    await page.reload();
    await page.setViewportSize(PHONE);
    expect(await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches)).toBe(true);

    await bar(page).getByRole('button', { name: 'Расход', exact: true }).click();
    const dialog = newForm(page);
    await expect(dialog.getByRole('combobox', { name: 'Со счёта', exact: true })).toBeVisible();
    // автофокус срабатывает кадр спустя — дать ему шанс, затем проверить, что ни поле, ни сумма фокус не получили
    await page.waitForTimeout(300);
    await expect(dialog.getByRole('button', { name: 'Закрыть', exact: true })).toBeFocused();
    await expect(dialog.getByRole('combobox', { name: 'Со счёта', exact: true })).not.toBeFocused();
  });

  test('после «Добавить и создать похожий» и «Дублировать платёж» фокус — на «×», а не в сумме: экранная клавиатура сама не поднимается', async ({ page }) => {
    await login(page);
    const cid = await createCompany(page, `ТОО Похожий касанием ${Date.now()}`);
    await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 1000000 });
    await page.reload();
    await page.setViewportSize(PHONE);
    await bar(page).getByRole('button', { name: 'Расход', exact: true }).tap();
    const form = newForm(page);
    const amount = form.getByRole('textbox', { name: /^Сумма,/ });
    await form.getByRole('combobox', { name: 'Со счёта', exact: true }).tap();
    await form.getByRole('option', { name: 'Касса', exact: true }).tap();
    await amount.tap();
    await amount.fill('150');
    await form.getByRole('button', { name: 'Добавить и создать похожий' }).tap();
    await expect(form.getByText('Операция сохранена — можно ввести похожую')).toBeVisible();
    // на касании фокус после «создать похожий» уходит на «×», а не в сумму — клавиатура не поднимается
    await expect(form.getByRole('button', { name: 'Закрыть', exact: true })).toBeFocused();
    await expect(amount).not.toBeFocused();
    await form.getByRole('button', { name: 'Закрыть', exact: true }).tap();
    await expect(form).toBeHidden();

    // «Дублировать платёж» в открытой операции: копия, фокус — на «×»
    await cards(page).getByRole('button').first().tap();
    const edit = page.getByRole('dialog', { name: 'Расход', exact: true });
    await edit.getByRole('button', { name: 'Дублировать платёж' }).tap();
    const copy = page.getByRole('dialog', { name: 'Новый расход', exact: true });
    await expect(copy.getByText('Это копия — проверьте и сохраните')).toBeVisible();
    await expect(copy.getByRole('button', { name: 'Закрыть', exact: true })).toBeFocused();
    await expect(copy.getByRole('textbox', { name: /^Сумма,/ })).not.toBeFocused();
  });

  test('после «Изменить в перевод» фокус — на «×», а не на пустом «На счёт»: экранная клавиатура сама не поднимается', async ({ page }) => {
    await login(page);
    const cid = await createCompany(page, `ТОО В перевод касанием ${Date.now()}`);
    const base = `/api/v1/companies/${cid}`;
    const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 100000 })).account.id;
    await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' });
    const rent = (await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Аренда' })).category.id;
    await apiPost(page, `${base}/operations`, {
      type: 'expense',
      paidAt: new Date(Date.now() - 60_000).toISOString(),
      accountId: cash,
      amount: 30000,
      lines: [{ categoryId: rent, projectId: null, amount: 30000 }],
    });
    await page.reload();
    await page.setViewportSize(PHONE);

    await cards(page).getByRole('button').first().tap();
    const edit = page.getByRole('dialog', { name: 'Расход', exact: true });
    await edit.getByRole('button', { name: 'Изменить в перевод' }).tap();
    await page.getByRole('alertdialog', { name: 'Изменить в перевод?' }).getByRole('button', { name: 'Изменить', exact: true }).tap();
    const transfer = page.getByRole('dialog', { name: 'Перевод', exact: true });
    await expect(transfer.getByRole('combobox', { name: 'На счёт', exact: true })).toHaveValue('');
    await expect(transfer.getByRole('button', { name: 'Закрыть', exact: true })).toBeFocused();
    await expect(transfer.getByRole('combobox', { name: 'На счёт', exact: true })).not.toBeFocused();
  });
});

test.describe('касание (pointer: coarse), панели календаря на телефоне 390×844', () => {
  test.use({ hasTouch: true });

  test('панель даты: фокус на дне, не в поле «Время»; ячейки не меньше 44 px, заголовок месяца в одну строку, панель внутри экрана — и у «Даты сделки», и у меню периода', async ({
    page,
  }) => {
    await login(page);
    const cid = await createCompany(page, `ТОО Календарь касание ${Date.now()}`);
    await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
    await page.reload();
    await page.setViewportSize(PHONE);
    expect(await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches)).toBe(true);

    /** Панель календаря: ячейки ≥ 44 px, заголовок одной строкой, панель целиком в видимой области. */
    const expectComfortable = async (panel: Locator) => {
      await expect(panel).toBeVisible();
      // ширина колонок таблицы неравная: проверяем самую узкую ячейку
      const cells = await panel.getByRole('gridcell').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ w: r.width, h: r.height })));
      expect(Math.min(...cells.map((c) => c.w)), 'ширина самой узкой ячейки дня').toBeGreaterThanOrEqual(44);
      expect(Math.min(...cells.map((c) => c.h)), 'высота ячейки дня').toBeGreaterThanOrEqual(44);
      const title = (await panel.locator('p[aria-live="polite"]').first().boundingBox())!;
      expect(title.height, 'заголовок месяца в одну строку').toBeLessThan(26);
      const box = (await panel.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(PHONE.height);
    };

    await bar(page).getByRole('button', { name: 'Расход', exact: true }).click();
    const dialog = newForm(page);
    await dialog.getByRole('button', { name: /^Указать дату списания:/ }).click();
    const panel = page.getByRole('dialog', { name: 'Указать дату списания: календарь' });
    // клавиатура не выезжает: фокус на дне календаря, а не в поле «Время»
    await expect(panel.locator('[role="gridcell"][tabindex="0"]')).toBeFocused();
    await expect(panel.getByLabel('Время')).not.toBeFocused();
    await expectComfortable(panel);
    // «Время» и «Готово» — тоже цели касания не меньше 44 px
    const done = (await panel.getByRole('button', { name: 'Готово' }).boundingBox())!;
    expect(done.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();

    // «Дата сделки» — тот же календарь в панели поля даты
    await dialog.getByRole('button', { name: 'Дата сделки отличается' }).click();
    await dialog.getByRole('button', { name: /^Дата сделки:/ }).click();
    const deal = page.getByRole('dialog', { name: 'Дата сделки: календарь' });
    await expectComfortable(deal);
    await page.keyboard.press('Escape');
    await expect(deal).toBeHidden();
    // дата сделки включена — форма «грязная»: закрытие спрашивает
    await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await page.getByRole('alertdialog', { name: 'Ваши данные не сохранятся' }).getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(dialog).toBeHidden();

    // период журнала: первое поле окна «Фильтры» (§8.5), меню внутри окна, ширина та же, что у остальных календарей
    await page.getByRole('main').getByRole('button', { name: 'Фильтр', exact: true }).click();
    const filters = page.getByRole('dialog', { name: 'Фильтры', exact: true });
    await filters.getByRole('button', { name: /^Период:/ }).click();
    const period = page.getByRole('dialog', { name: 'Период', exact: true });
    await expect(period).toBeVisible();
    const box = (await period.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
    expect(box.y + box.height).toBeLessThanOrEqual(PHONE.height);
  });

  test('«Выбрать даты» в окне «Фильтры»: вложенные календари «С» и «По» открываются касанием и помещаются на экране; Esc закрывает только календарь; «Применить» и «Готово» задают период', async ({ page }) => {
    await login(page);
    const cid = await createCompany(page, `ТОО Даты касанием ${Date.now()}`);
    const base = `/api/v1/companies/${cid}`;
    const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 1000000 })).account.id;
    await apiPost(page, `${base}/operations`, { type: 'income', paidAt: todayAgo(2), accountId: cash, amount: 50000 });
    await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: yesterdayNoon(), accountId: cash, amount: 10000 });
    await page.reload();
    await page.setViewportSize(PHONE);
    const list = cards(page).getByRole('listitem');
    await expect(list).toHaveCount(2);
    const yesterday = yesterdayNoon().slice(0, 10);
    const ru = (d: string) => d.split('-').reverse().join('.');
    const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    /** Имя ячейки дня в календаре: «11 октября 2026». */
    const dayName = (d: string) => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

    await page.getByRole('main').getByRole('button', { name: 'Фильтр', exact: true }).tap();
    const dialog = page.getByRole('dialog', { name: 'Фильтры', exact: true });
    const period = dialog.getByRole('button', { name: /^Период:/ });
    const periodMenu = page.getByRole('dialog', { name: 'Период', exact: true });
    // «За вчера», затем «Выбрать даты»: поля начинаются с границ выбранного периода — календари откроются на месяце вчерашнего дня
    await period.tap();
    await periodMenu.getByRole('button', { name: 'За вчера', exact: true }).tap();
    await period.tap();
    await periodMenu.getByRole('button', { name: 'Выбрать даты' }).tap();
    const from = periodMenu.getByRole('button', { name: /^С:/ });
    const to = periodMenu.getByRole('button', { name: /^По:/ });
    await expect(from).toHaveAccessibleName(`С: ${ru(yesterday)}`);
    await from.tap();
    const fromCalendar = page.getByRole('dialog', { name: 'С: календарь' });
    await expect(fromCalendar.getByRole('grid')).toBeVisible();
    const box = (await fromCalendar.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(PHONE.height);
    await fromCalendar.getByRole('gridcell', { name: dayName(yesterday) }).tap();
    await expect(fromCalendar).toBeHidden();
    await expect(periodMenu).toBeVisible();
    await expect(from).toHaveAccessibleName(`С: ${ru(yesterday)}`);
    // Esc в календаре «По» закрывает только его: меню периода и окно «Фильтры» остаются (Review Focus 3)
    await to.tap();
    const toCalendar = page.getByRole('dialog', { name: 'По: календарь' });
    await expect(toCalendar.getByRole('grid')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(toCalendar).toBeHidden();
    await expect(periodMenu).toBeVisible();
    await expect(dialog).toBeVisible();
    await to.tap();
    await toCalendar.getByRole('gridcell', { name: dayName(yesterday) }).tap();
    await periodMenu.getByRole('button', { name: 'Применить' }).tap();
    await expect(period).toHaveAccessibleName(`Период: ${ru(yesterday)}`);
    await dialog.getByRole('button', { name: 'Готово' }).tap();
    await expect(page).toHaveURL(new RegExp(`/c/${cid}/log\\?from=${yesterday}&to=${yesterday}$`));
    await expect(list).toHaveCount(1);
  });
});

test.describe('касание: перетаскивание в списках настроек, 390×844', () => {
  test.use({ hasTouch: true });

  test('теги: ☰ пальцем переставляет строку; у нижнего края экрана список едет сам и строка встаёт под пальцем ниже', async ({ page }) => {
    await login(page);
    const cid = await createCompany(page, `ТОО Касание тегов ${Date.now()}`);
    const base = `/api/v1/companies/${cid}`;
    for (let i = 1; i <= 30; i++) await apiPost(page, `${base}/tags`, { name: `Тег ${String(i).padStart(2, '0')}` });
    await page.setViewportSize(PHONE);
    await page.goto(`/c/${cid}/settings/tags`);
    const list = page.getByRole('main').getByRole('list', { name: 'Теги' });
    await expect(list.getByRole('listitem')).toHaveCount(30);
    const order = async () => ((await (await page.request.get(`${base}/tags`)).json()).tags as { name: string }[]).map((t) => t.name);
    // Playwright умеет только «тап»; протяжку пальцем шлём протоколом Chromium — touch-события дают pointer-события с pointerType «touch»
    const cdp = await page.context().newCDPSession(page);
    const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) => {
      await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    };
    const centre = async (target: Locator) => {
      const b = (await target.boundingBox())!;
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    };
    const grip = (name: string) => list.getByRole('button', { name: `Переместить ${name}`, exact: true });

    // короткая протяжка вдали от края: «Тег 03» — на место «Тег 01»
    const from = await centre(grip('Тег 03'));
    const top = (await list.getByRole('listitem').first().boundingBox())!.y + 4;
    await touch('touchStart', from.x, from.y);
    for (let i = 1; i <= 6; i++) await touch('touchMove', from.x, from.y + ((top - from.y) * i) / 6);
    await touch('touchEnd');
    await expect(list.getByRole('listitem').first()).toContainText('Тег 03');
    await expect.poll(async () => (await order())[0]).toBe('Тег 03');
    // пока палец тянул ручку вдали от края, страница не прокручивалась
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    // палец у нижнего края, над панелью вкладок: список едет сам; отпущенная строка встаёт далеко внизу (Review Focus 4)
    const bar = (await page.getByRole('navigation', { name: 'Разделы', exact: true }).boundingBox())!;
    const start = await centre(grip('Тег 03'));
    await touch('touchStart', start.x, start.y);
    await touch('touchMove', start.x, start.y + 20);
    await touch('touchMove', start.x, bar.y - 10);
    await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 5000 }).toBeGreaterThan(400);
    await touch('touchEnd');
    await expect.poll(async () => (await order()).indexOf('Тег 03'), { timeout: 5000 }).toBeGreaterThan(9);
    // после броска фокус — на ручке строки
    await expect(grip('Тег 03')).toBeFocused();
  });
});

test('название по центру шапки телефона и в журнале, и в настройках, и на странице без компании; 320 px: длинное название обрезается', async ({ page }) => {
  await login(page);
  const name = `ТОО Очень длинное название компании для проверки обрезки ${Date.now()}`;
  const cid = await createCompany(page, name);
  const banner = page.getByRole('banner');
  const company = banner.getByRole('button', { name: `Сменить компанию: ${name}`, exact: true });
  const gear = banner.getByRole('button', { name: 'Настройки', exact: true });
  const centre = async (target: Locator) => {
    const b = (await target.boundingBox())!;
    return b.x + b.width / 2;
  };

  await page.setViewportSize(PHONE);
  // журнал (есть ☰) и настройки (☰ нет): название стоит на оси экрана, не прыгает вбок при переходе
  expect(Math.abs((await centre(company)) - PHONE.width / 2), 'журнал').toBeLessThan(2);
  await page.goto(`/c/${cid}/settings`);
  await expect(banner.getByRole('button', { name: 'Счета', exact: true })).toHaveCount(0);
  expect(Math.abs((await centre(company)) - PHONE.width / 2), 'настройки').toBeLessThan(2);
  // страница без компании: название продукта тоже по центру
  await page.goto('/companies/new');
  await expect(page.getByRole('heading', { level: 1, name: 'Новая компания' })).toBeVisible();
  const product = banner.locator('span.truncate');
  expect(Math.abs((await centre(product)) - PHONE.width / 2), 'без компании').toBeLessThan(2);

  // 320 px: название обрезано многоточием, между ☰ и шестерёнкой, страница вбок не едет
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(`/c/${cid}/log`);
  const menu = banner.getByRole('button', { name: 'Счета', exact: true });
  const m = (await menu.boundingBox())!;
  const c = (await company.boundingBox())!;
  const g = (await gear.boundingBox())!;
  expect(c.x).toBeGreaterThanOrEqual(m.x + m.width);
  expect(c.x + c.width).toBeLessThanOrEqual(g.x);
  expect(g.x + g.width).toBeLessThanOrEqual(320);
  expect(Math.abs((await centre(company)) - 160)).toBeLessThan(2);
  expect(await company.evaluate((el) => Array.from(el.querySelectorAll<HTMLElement>('*')).some((n) => n.scrollWidth > n.clientWidth))).toBe(true);
  // шапка целиком в экране; остальной журнал на 320 px (панель фильтров — план 1.5-5b) здесь не проверяем
  expect(await banner.evaluate((h) => Array.from(h.querySelectorAll('*')).every((e) => e.getBoundingClientRect().right <= 320 + 0.5))).toBe(true);
});

test('архивная компания на телефоне: шапка без кнопок операций и ☰ в настройках, название по центру; экран «Настройки» при свёрнутой панели счетов', async ({ page }) => {
  await login(page);
  const name = `ТОО Архив шапка с очень длинным названием ${Date.now()}`;
  const cid = await createCompany(page, name);
  await apiPost(page, `/api/v1/companies/${cid}/archive`, {});
  const origin = new URL(page.url()).origin;
  const setCollapsed = (value: boolean) =>
    page.request.put('/api/v1/preferences/sidebar.collapsed', { data: { value }, headers: { origin, 'x-requested-with': 'fetch' } });
  expect((await setCollapsed(true)).ok()).toBe(true);
  try {
    await page.setViewportSize({ width: 320, height: 640 });
    const banner = page.getByRole('banner');
    const company = banner.getByRole('button', { name: `Сменить компанию: ${name}`, exact: true });
    for (const path of ['log', 'settings']) {
      await page.goto(`/c/${cid}/${path}`);
      await expect(company).toBeVisible();
      await expect(bar(page)).toHaveCount(0);
      const c = (await company.boundingBox())!;
      expect(Math.abs(c.x + c.width / 2 - 160), path).toBeLessThan(2);
      expect(await banner.evaluate((h) => Array.from(h.querySelectorAll('*')).every((e) => e.getBoundingClientRect().right <= 320 + 0.5)), `${path}: шапка в экране`).toBe(true);
    }
    await expectNoSideScroll(page, 'экран «Настройки», архивная компания, 320 px');
    // экран «Настройки»: список разделов на месте, ☰ нет, панель вкладок видна, вбок не едет
    await expect(page.getByRole('heading', { level: 1, name: 'Настройки', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Разделы настроек' }).getByRole('link', { name: /^Контрагенты/ })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Разделы', exact: true })).toBeVisible();
    await expect(banner.getByRole('button', { name: 'Счета', exact: true })).toHaveCount(0);
  } finally {
    expect((await setCollapsed(false)).ok()).toBe(true);
  }
});

test('компьютер 1280 px: ручки и кнопки ✎ в списках настроек остаются 36×36; у ✎ компании виден фокус с клавиатуры (и на телефоне)', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Размеры ${Date.now()}`);
  for (const name of ['Альфа', 'Бета']) await apiPost(page, `/api/v1/companies/${cid}/tags`, { name });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/c/${cid}/settings/tags`);
  const tags = page.getByRole('main').getByRole('list', { name: 'Теги' });
  for (const label of ['Переместить Альфа', 'Изменить Альфа']) {
    const b = (await tags.getByRole('button', { name: label, exact: true }).boundingBox())!;
    expect([b.width, b.height], label).toEqual([36, 36]);
  }

  // ✎ компании: Tab с клавиатуры — виден контур фокуса
  for (const size of [{ width: 1280, height: 720 }, PHONE]) {
    await page.setViewportSize(size);
    await page.getByRole('banner').getByRole('button', { name: /^Сменить компанию/ }).click();
    const panel = page.getByRole('dialog', { name: 'Компании' });
    const edit = panel.getByRole('button', { name: /^Изменить компанию/ }).first();
    for (let i = 0; i < 10 && !(await edit.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
    await expect(edit).toBeFocused();
    await expect(edit).not.toHaveCSS('outline-style', 'none');
    await expect(edit).toHaveCSS('outline-width', '2px');
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  }
});

test('окно «Счета» на телефоне: верхняя зона прокрутки при перетаскивании — под прилипшей шапкой окна', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Верхняя зона ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  for (let i = 1; i <= 24; i++) await apiPost(page, `${base}/accounts`, { name: `Счёт ${String(i).padStart(2, '0')}`, currency: 'KZT', openedAt: '2020-01-01' });
  await page.setViewportSize(PHONE);
  await page.goto(`/c/${cid}/log`);
  await page.getByRole('banner').getByRole('button', { name: 'Счета', exact: true }).click();
  await page.getByRole('dialog', { name: 'Счета', exact: true }).getByRole('button', { name: 'Изменить счета' }).click();
  const quick = page.getByRole('dialog', { name: 'Счета', exact: true }).last();
  const list = quick.getByRole('list', { name: 'Список счетов' });
  await expect(list.getByRole('listitem')).toHaveCount(24);
  const area = await list.evaluateHandle((el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const o = getComputedStyle(p).overflowY;
      if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
    }
    throw new Error('нет прокручиваемого предка');
  });
  await area.evaluate((p) => ((p as HTMLElement).scrollTop = (p as HTMLElement).scrollHeight));
  const startTop = await area.evaluate((p) => (p as HTMLElement).scrollTop);
  expect(startTop).toBeGreaterThan(200);
  const headerBottom = await quick.locator('[data-modal-header]').evaluate((h) => h.getBoundingClientRect().bottom);

  const grip = (await list.getByRole('button', { name: 'Переместить Счёт 24', exact: true }).boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  // палец сразу под шапкой окна: верхняя зона начинается под ней, список едет вверх
  await page.mouse.move(grip.x + grip.width / 2, headerBottom + 12, { steps: 8 });
  await expect.poll(() => area.evaluate((p) => (p as HTMLElement).scrollTop), { timeout: 5000 }).toBeLessThan(startTop - 100);
  await page.keyboard.press('Escape');
  await page.mouse.up();
});

test('«Ещё» → «Импорт из Excel» (§5.1, §5.7 спецификации импорта): панель на весь экран, «Выберите файл» во всю ширину, суммы с цифровой клавиатурой, без прокрутки вбок; закрыли — фокус на «Ещё»; в архивной компании пункта нет', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await login(page);
  const cid = (await apiPost(page, '/api/v1/companies', { name: `ТОО Импорт телефон ${Date.now()}` })).company.id as number;
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await page.goto(`/c/${cid}/log`);
  const tabs = page.getByRole('navigation', { name: 'Разделы', exact: true });
  const more = tabs.getByRole('button', { name: 'Ещё', exact: true });
  const menu = page.getByRole('dialog', { name: 'Ещё', exact: true });
  // на телефоне в тулбаре журнала кнопки нет — вход через «Ещё»
  await expect(page.getByRole('main').getByRole('button', { name: 'Импортировать' })).toHaveCount(0);
  await more.click();
  await menu.getByRole('button', { name: 'Импорт из Excel' }).click();
  const panel = page.getByRole('dialog', { name: 'Импорт из Excel' });
  await expect(panel).toBeVisible();
  // панель выезжает справа (200 мс): ждём, пока встанет на место
  await expect.poll(async () => Math.round((await panel.boundingBox())!.x)).toBe(0);
  expect(Math.round((await panel.boundingBox())!.width)).toBe(PHONE.width);
  const pick = (await panel.getByRole('button', { name: 'Выберите файл' }).boundingBox())!;
  expect(pick.height).toBeGreaterThanOrEqual(44);
  // во всю ширину зоны файла (отступы панели и зоны — по 16 px)
  expect(pick.width).toBeGreaterThan(PHONE.width - 80);

  await panel.locator('[data-import-file]').setInputFiles({
    name: 'выгрузка.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: finmapLikeXlsx([
      finmapLikeRow({ paidAt: excelSerial('2025-03-15', '10:00:00'), amount: 1500, to: 'Касса', category: 'Бар' }),
      finmapLikeRow({ paidAt: excelSerial('2025-03-16', '11:00:00'), amount: 500, from: 'Касса', to: 'Банк с очень длинным названием для проверки ширины', comment: 'x' }),
    ]),
  });
  await expect(panel.getByRole('heading', { level: 3, name: 'Проверка файла' })).toBeFocused();
  const bank = panel.getByRole('article', { name: /^Банк с очень длинным/ });
  await expect(bank.getByLabel('Текущий остаток, ₸')).toHaveAttribute('inputmode', 'decimal');
  // «Импортировать» — в закреплённом низу панели, внутри экрана
  const go = (await panel.getByRole('button', { name: 'Импортировать' }).boundingBox())!;
  expect(go.y + go.height).toBeLessThanOrEqual(PHONE.height);
  expect(go.width).toBeGreaterThan(PHONE.width - 64);
  await expectNoSideScroll(page, 'панель импорта');
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(more).toBeFocused();

  // архивная компания: пункта «Импорт из Excel» нет
  const archived = (await apiPost(page, '/api/v1/companies', { name: `ТОО Импорт архив ${Date.now()}` })).company.id as number;
  await apiPost(page, `/api/v1/companies/${archived}/archive`, {});
  await page.goto(`/c/${archived}/log`);
  await more.click();
  await expect(menu.getByRole('button', { name: 'История действий' })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Импорт из Excel' })).toHaveCount(0);
});

test('панель импорта, открытая из «Ещё», переживает смену ширины окна (поворот телефона) и закрывается как обычно', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await login(page);
  const cid = (await apiPost(page, '/api/v1/companies', { name: `ТОО Импорт поворот ${Date.now()}` })).company.id as number;
  await page.goto(`/c/${cid}/log`);
  await page.getByRole('navigation', { name: 'Разделы', exact: true }).getByRole('button', { name: 'Ещё', exact: true }).click();
  await page.getByRole('dialog', { name: 'Ещё', exact: true }).getByRole('button', { name: 'Импорт из Excel' }).click();
  const panel = page.getByRole('dialog', { name: 'Импорт из Excel' });
  await expect(panel).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(panel).toBeVisible();
  await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(480);
  await page.setViewportSize(PHONE);
  await expect(panel).toBeVisible();
  await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(PHONE.width);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});
