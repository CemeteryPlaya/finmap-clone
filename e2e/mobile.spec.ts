import { expect, test, type Locator, type Page } from '@playwright/test';

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
  await expect(page.getByRole('dialog', { name: 'Новый перевод', exact: true })).toBeVisible();
  await expect(newForm(page).getByRole('combobox', { name: 'Со счёта', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(newForm(page)).toBeHidden();
  await expect(bar(page).getByRole('button', { name: 'Перевод', exact: true })).toBeFocused();
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
  // переход из панели — фокус на заголовок страницы; «+ счёт» ведёт в раздел «Счета» (§11 этапа 1.5)
  await expect(page.getByRole('heading', { level: 1, name: 'Журнал' })).toBeFocused();
  await open.click();
  await drawer.getByRole('link', { name: '+ счёт' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/accounts$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Счета' })).toBeFocused();

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

  // журнал — карточки: сумма, категория, счёт, дата; таблицы и флажков выделения нет
  await expect(page.getByRole('table', { name: 'Операции' })).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  const card = cards(page).getByRole('listitem').first();
  await expect(card).toContainText(/\u22122\s500\s₸/);
  await expect(card).toContainText('Аренда');
  await expect(card).toContainText('Касса');
  await expect(card).toContainText(/сегодня \d\d:\d\d/);

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

test('журнал карточками догружается при прокрутке; последняя карточка не прячется под нижней панелью', async ({ page }) => {
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
  await expect(list.last()).toContainText('№55');
  // в самом низу страницы последняя карточка — над закреплённой панелью
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const last = (await list.last().boundingBox())!;
  const panelTop = (await bar(page).boundingBox())!.y;
  expect(last.y + last.height).toBeLessThanOrEqual(panelTop);
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

test('фильтры на телефоне — в панели справа: период, сумма, сортировка, окно «Фильтры» поверх панели, сброс; поиск на виду', async ({ page }) => {
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
  // на виду — поиск и «Фильтры»; период, суммы и колонки спрятаны
  await expect(page.getByRole('searchbox', { name: 'Поиск' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Период:/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Колонки' })).toHaveCount(0);
  const open = page.getByRole('button', { name: /^Период и условия/ });
  await expect(open).toHaveText('Период и условия');

  await open.click();
  const panel = page.getByRole('dialog', { name: 'Период и условия' });
  // выезжает справа
  await expect.poll(async () => { const b = (await panel.boundingBox())!; return Math.round(b.x + b.width); }).toBe(PHONE.width);
  await expect(panel.getByRole('button', { name: 'Колонки' })).toHaveCount(0);
  // период — то же меню у пилюли, что в широком окне; меню рисуется внутри панели
  const periodMenu = page.getByRole('dialog', { name: 'Период', exact: true });
  await panel.getByRole('button', { name: /^Период:/ }).click();
  await periodMenu.getByRole('button', { name: 'За вчера', exact: true }).click();
  await expect(list).toHaveCount(1);
  await expect(list.first()).toContainText('вчерашний');
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: /^Период:/ }).click();
  await periodMenu.getByRole('button', { name: 'За все время', exact: true }).click();
  await expect(list).toHaveCount(3);

  // сортировка: сначала крупные
  await panel.getByLabel('Сортировка').selectOption({ label: 'Сначала крупные' });
  await expect(page).toHaveURL(/sort=amount/);
  await expect(list.first()).toContainText('выручка');

  // сумма от 200 ₸ — по Enter
  await panel.getByLabel('Сумма от').fill('200');
  await panel.getByLabel('Сумма от').press('Enter');
  await expect(list).toHaveCount(2);

  // окно «Фильтры» открывается поверх панели; «Готово» возвращает в панель
  await panel.getByRole('button', { name: 'Фильтр', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Фильтры', exact: true });
  await dialog.getByRole('button', { name: /^Типы платежей и категории/ }).click();
  await dialog.getByRole('checkbox', { name: 'Расход', exact: true }).check();
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await expect(dialog).toBeHidden();
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Фильтр · 1' })).toBeFocused();
  await expect(list).toHaveCount(1);
  await expect(list.first()).toContainText('аренда');

  // список сохранённых фильтров открывается внутри панели; Esc закрывает только его
  await panel.getByRole('button', { name: 'Быстрые фильтры' }).click();
  const saved = page.getByRole('dialog', { name: 'Быстрые фильтры' });
  await expect(saved).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(saved).toBeHidden();
  await expect(panel).toBeVisible();

  // Esc закрывает панель; на кнопке — число спрятанных условий (сумма от и тип)
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(open).toBeFocused();
  await expect(open).toHaveText('Период и условия · 2');

  // касание фона слева от панели закрывает её; «Сбросить фильтр» в панели снимает всё
  await open.click();
  await page.mouse.click(10, PHONE.height / 2);
  await expect(panel).toBeHidden();
  await open.click();
  await panel.getByRole('button', { name: 'Сбросить фильтр' }).click();
  await expect(list).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(open).toHaveText('Период и условия');

  // поиск — без панели
  await page.getByRole('searchbox', { name: 'Поиск' }).fill('вчерашн');
  await expect(list).toHaveCount(1);

  // телефон повернули или окно стало шире при открытой панели: панель закрывается, тулбар и таблица — на месте
  await open.click();
  await expect(panel).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(panel).toBeHidden();
  await expect(page.getByRole('button', { name: /^Период:/ })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Операции' }).locator('tbody tr')).toHaveCount(1);
  await page.setViewportSize(PHONE);
  await expect(panel).toBeHidden();
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
  await page.getByRole('button', { name: 'Изменить', exact: true }).click();
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

  // окно «Фильтры» поверх панели: длинное название категории переносится, панель поля не шире экрана
  await page.getByRole('button', { name: /^Период и условия/ }).click();
  await page.getByRole('dialog', { name: 'Период и условия' }).getByRole('button', { name: 'Фильтр', exact: true }).click();
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
  for (const name of ['Сохранить изменения', 'Добавить и создать похожий', 'Дублировать платёж', 'Удалить платёж']) {
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

  // телефон: нижней панели нет, карточка открывает ту же форму для просмотра; Esc закрывает без вопросов
  await page.setViewportSize(PHONE);
  await expect(bar(page)).toHaveCount(0);
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

    // период журнала: меню внутри панели «Период и условия», ширина та же, что у остальных календарей
    await page.getByRole('button', { name: /^Период и условия/ }).click();
    const filters = page.getByRole('dialog', { name: 'Период и условия' });
    await filters.getByRole('button', { name: /^Период:/ }).click();
    const period = page.getByRole('dialog', { name: 'Период', exact: true });
    await expect(period).toBeVisible();
    const box = (await period.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
    expect(box.y + box.height).toBeLessThanOrEqual(PHONE.height);
  });
});
