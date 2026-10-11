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

const table = (page: Page) => page.getByRole('table', { name: 'Операции' });
/** Сегодня по Алматы (APP_TIMEZONE e2e-сервера), `YYYY-MM-DD`. */
const almatyToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date());
const shiftDay = (iso: string, days: number) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
/** `YYYY-MM-DD` → «ДД.ММ.ГГГГ». */
const ru = (iso: string) => iso.split('-').reverse().join('.');
const MONTHS_GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/**
 * Выбрать день в календаре открытой панели поля даты (§6.5 этапа 1.5): фокус — на сегодняшнем дне; Shift+PageUp и PageUp
 * ведут к нужному месяцу, затем день — мышью по имени ячейки «15 июня 2021».
 */
async function pickDay(page: Page, panel: Locator, iso: string) {
  const [ty, tm] = almatyToday().split('-').map(Number) as [number, number];
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  let months = (ty - y) * 12 + (tm - m);
  // клавиши — сетке: фокус уже на активном дне (Popover ставит его на data-autofocus)
  await expect(panel.locator('[role="gridcell"][tabindex="0"]')).toBeFocused();
  for (; months >= 12; months -= 12) await page.keyboard.press('Shift+PageUp');
  for (; months > 0; months -= 1) await page.keyboard.press('PageUp');
  await panel.getByRole('gridcell', { name: `${d} ${MONTHS_GENITIVE[m - 1]} ${y}`, exact: true }).click();
}
const panel = (page: Page) => page.getByRole('navigation', { name: 'Счета' });
/** Тело следующего запроса создания операции. */
const nextCreate = (page: Page) =>
  page.waitForRequest((r) => r.method() === 'POST' && /\/operations$/.test(new URL(r.url()).pathname));
/** Окно новой операции (§6.1 этапа 1.5): своё на тип. */
const form = (page: Page) => page.getByRole('dialog', { name: /^Новый (доход|расход|перевод)$/ });
const TITLES = { Доход: 'Новый доход', Расход: 'Новый расход', Перевод: 'Новый перевод' } as const;
/** Главная кнопка формы (§6.9 этапа 1.5). */
const submit = (scope: Locator) => scope.getByRole('button', { name: /^(Добавить (доход|расход|перевод)|Сохранить изменения)$/ });

/** Открыть форму кнопкой шапки: «Доход», «Расход» или «Перевод». */
async function openForm(page: Page, button: 'Доход' | 'Расход' | 'Перевод') {
  await page.getByRole('banner').getByRole('button', { name: button, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: TITLES[button], exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Поле со списком (§6.6 этапа 1.5): `input role="combobox"`, имя — подпись поля. */
const field = (scope: Locator, label: string) => scope.getByRole('combobox', { name: label, exact: true });

/** Выбрать значение в поле со списком: нажатие открывает список (он рисуется в окне формы), затем пункт. */
async function pick(page: Page, label: string, option: string, scope: Locator = form(page)) {
  await field(scope, label).click();
  await form(page).getByRole('option', { name: option, exact: true }).click();
  await expect(field(scope, label)).toHaveValue(option);
}

test('доход, расход и перевод KZT → USD через форму: выражение в сумме, курс перевода, балансы и журнал', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Форма ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 100000 });
  await apiPost(page, `${base}/accounts`, { name: 'Валютный', currency: 'USD', openedAt: '2020-01-01' });
  await apiPost(page, `${base}/categories`, { kind: 'income', name: 'Выручка' });
  await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Аренда' });
  // курс компании: доллары входят в «Всего на счетах»
  await apiPost(page, `${base}/fixed-rates`, { currency: 'USD', rate: '500', validFrom: '2020-01-01' });
  await page.reload();

  // доход: выражение вычисляется при уходе из поля, Enter в поле суммы сохраняет
  let dialog = await openForm(page, 'Доход');
  // отдельное окно на тип: вкладок нет, окно не шире 480 px, кнопка — «Добавить доход» (§6.1, §6.9)
  await expect(dialog.getByRole('radio')).toHaveCount(0);
  expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(480);
  await expect(submit(dialog)).toHaveText('Добавить доход');
  const amount = dialog.getByRole('textbox', { name: /^Сумма,/ });
  // счёт ещё не выбирался — поле пустое, фокус на нём (§6.2)
  await expect(field(dialog, 'На счёт')).toHaveValue('');
  await expect(field(dialog, 'На счёт')).toBeFocused();
  // пока счёт не выбран, «Валюта» — базовая валюта компании (как в Finmap), а сумма не уже остальных полей
  await expect(dialog.getByText('KZT (₸)')).toBeVisible();
  const category = (await field(dialog, 'Категория').boundingBox())!;
  const amountBox = (await dialog.getByRole('textbox', { name: /^Сумма,/ }).boundingBox())!;
  const badge = (await dialog.getByText('Валюта', { exact: true }).locator('..').boundingBox())!;
  expect(Math.round(badge.x + badge.width)).toBe(Math.round(category.x + category.width));
  expect(amountBox.width).toBeLessThan(category.width);
  await pick(page, 'На счёт', 'Касса');
  await pick(page, 'Категория', 'Выручка');
  // «Валюта» — значок валюты счёта рядом с суммой (§6.2)
  await expect(dialog.getByText('KZT (₸)')).toBeVisible();
  // «Дата сделки отличается» — строка-действие: открывает поле «Дата сделки», «✕» возвращает строку (§6.7)
  const accrualRow = dialog.getByRole('button', { name: 'Дата сделки отличается' });
  await expect(accrualRow).toHaveAccessibleDescription('Дата начисления для отчёта о прибылях и убытках');
  await accrualRow.click();
  await expect(dialog.getByRole('button', { name: /^Дата сделки:/ })).toBeFocused();
  await dialog.getByRole('button', { name: 'Убрать дату сделки' }).click();
  await expect(accrualRow).toBeFocused();
  await amount.fill('1 500 + 500');
  await amount.blur();
  await expect(amount).toHaveValue('2000');
  await amount.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(table(page).locator('tbody tr').filter({ hasText: 'Выручка' })).toContainText(/\+2\s000\s₸/);
  await expect(panel(page).getByRole('link', { name: /^Касса/ })).toContainText(/₸\s3\s000$/);

  // расход с комментарием из свёрнутого блока; сумма — невычисленное выражение, «Сохранить» нажимают сразу
  dialog = await openForm(page, 'Расход');
  await pick(page, 'Со счёта', 'Касса');
  await pick(page, 'Категория', 'Аренда');
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('100+200');
  await dialog.getByRole('button', { name: 'Добавить проект, тег, комментарий, файл' }).click();
  await dialog.getByLabel('Комментарий').fill('за октябрь');
  // click без ухода фокуса из поля (dispatchEvent): сумма уходит на сервер уже вычисленной
  const rentRequest = nextCreate(page);
  await submit(dialog).dispatchEvent('click');
  expect((await rentRequest).postDataJSON().amount).toBe(30000);
  await expect(dialog).toBeHidden();
  const rent = table(page).locator('tbody tr').filter({ hasText: 'Аренда' });
  await expect(rent).toContainText('за октябрь');
  await expect(rent).toContainText(/300\s₸/);

  // перевод в другую валюту: «Сумма зачисления» и вычисленный курс
  dialog = await openForm(page, 'Перевод');
  // у перевода дата — первой, затем «Со счёта», «На счёт», сумма; значка «Валюта» нет (§6.2)
  const top = async (l: Locator) => (await l.boundingBox())!.y;
  expect(await top(dialog.getByLabel('Дата перевода денег'))).toBeLessThan(await top(field(dialog, 'Со счёта')));
  expect(await top(field(dialog, 'Со счёта'))).toBeLessThan(await top(field(dialog, 'На счёт')));
  expect(await top(field(dialog, 'На счёт'))).toBeLessThan(await top(dialog.getByRole('textbox', { name: /^Сумма,/ })));
  await expect(dialog.getByText('Валюта', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('textbox', { name: /^Сумма зачисления/ })).toHaveCount(0);
  await pick(page, 'Со счёта', 'Касса');
  await pick(page, 'На счёт', 'Валютный');
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('500');
  await dialog.getByRole('textbox', { name: /^Сумма зачисления/ }).fill('1');
  await expect(dialog.getByText('Курс: 1 USD = 500 KZT')).toBeVisible();
  await submit(dialog).click();
  await expect(dialog).toBeHidden();
  await expect(panel(page).getByRole('link', { name: /^Касса/ })).toContainText(/₸\s2\s200$/);
  await expect(panel(page).getByRole('link', { name: /^Валютный/ })).toContainText(/\$\s1$/);
  await expect(panel(page)).toContainText(/Всего на счетах\s*₸\s2\s700(?![\s\d])/);
});

test('ошибки у полей, Esc с вопросом о несохранённом, «Сохранить и создать похожий», контрагенты под категорию «Зарплата»', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Похожий ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Аренда' });
  await apiPost(page, `${base}/counterparties`, { type: 'supplier', name: 'ТОО Ромашка' });
  await apiPost(page, `${base}/counterparties`, { type: 'employee', name: 'Айгерим' });
  await page.reload();

  // пустая сумма и деление на ноль — ошибки у поля, окно остаётся открытым
  const dialog = await openForm(page, 'Расход');
  await pick(page, 'Со счёта', 'Касса');
  const amount = dialog.getByRole('textbox', { name: /^Сумма,/ });
  await submit(dialog).click();
  await expect(amount).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog).toContainText('Введите сумму');
  await amount.fill('5/0');
  await amount.blur();
  await expect(dialog).toContainText('Деление на ноль');

  // Esc при несохранённых изменениях — окно «Ваши данные не сохранятся» поверх формы; Esc закрывает только его
  await amount.fill('10');
  await amount.press('Escape');
  const question = page.getByRole('alertdialog', { name: 'Ваши данные не сохранятся' });
  await expect(question).toBeVisible();
  await expect(question.getByRole('button', { name: 'Отменить' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(question).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(amount).toBeFocused();
  // Esc при открытом списке закрывает только список: окно открыто, вопроса нет, фокус остаётся в поле (Review Focus 3)
  const category = field(dialog, 'Категория');
  await category.click();
  await expect(dialog.getByRole('listbox', { name: 'Категории' })).toBeVisible();
  // пустое открытое поле: подпись остаётся крупной (Finmap 09), поднимается, когда есть значение
  const categoryBox = category.locator('xpath=..');
  await expect(categoryBox).not.toHaveAttribute('data-filled', /.*/);
  // нажатие внутри открытого поля его не закрывает; нажатие вне поля и списка (на заголовок окна) — закрывает
  await category.click();
  await expect(dialog.getByRole('listbox', { name: 'Категории' })).toBeVisible();
  await dialog.getByRole('heading').click();
  await expect(dialog.getByRole('listbox', { name: 'Категории' })).toBeHidden();
  await category.click();
  await expect(dialog.getByRole('listbox', { name: 'Категории' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('listbox', { name: 'Категории' })).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(question).toBeHidden();
  await expect(category).toBeFocused();
  // печать в поле открывает список и фильтрует его; «+ Создать „…“» — после найденного; Enter выбирает найденное (Review Focus 2)
  await category.fill('АРЕН');
  await expect(dialog.getByRole('listbox', { name: 'Категории' }).getByRole('option')).toHaveText(['Аренда', '+ Создать категорию „АРЕН“']);
  await category.press('Enter');
  await expect(category).toHaveValue('Аренда');
  await expect(categoryBox).toHaveAttribute('data-filled', '');
  await expect(dialog.getByRole('listbox', { name: 'Категории' })).toBeHidden();
  // печать поверх выбранного: ищется набранное; Esc возвращает прежнее значение (Review Focus 1)
  await category.fill('интернет');
  await expect(dialog.getByRole('listbox', { name: 'Категории' }).getByRole('option')).toHaveText(['+ Создать категорию „интернет“']);
  await category.press('Escape');
  await expect(category).toHaveValue('Аренда');
  await expect(dialog).toBeVisible();

  // «Зарплата» (системная категория): поле контрагента — «Сотрудник» (§6.4), сначала сотрудники, затем остальные
  await pick(page, 'Категория', 'Зарплата');
  await field(dialog, 'Сотрудник').click();
  const people = dialog.getByRole('listbox', { name: 'Контрагенты' }).getByRole('option');
  await expect(people).toHaveText(['+ Создать контрагента', 'Без контрагента', 'Айгерим', 'ТОО Ромашка']);
  await expect(dialog.getByRole('listbox', { name: 'Контрагенты' })).toContainText('Сотрудники');
  await page.keyboard.press('Escape');
  // обычная категория — «Мой контрагент»
  await pick(page, 'Категория', 'Аренда');
  await field(dialog, 'Мой контрагент').click();
  await expect(people).toHaveText(['+ Создать контрагента', 'Без контрагента', 'ТОО Ромашка', 'Айгерим']);
  await page.keyboard.press('Escape');

  // после выбора значения список открывается на нём: aria-activedescendant поля указывает на выбранный пункт
  await category.click();
  const selected = dialog.getByRole('listbox', { name: 'Категории' }).getByRole('option', { name: 'Аренда', exact: true });
  await expect(selected).toHaveAttribute('aria-selected', 'true');
  await expect(category).toHaveAttribute('aria-activedescendant', (await selected.getAttribute('id'))!);
  // Tab закрывает список без смены значения
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('listbox', { name: 'Категории' })).toBeHidden();
  await expect(category).toHaveValue('Аренда');
  await expect(dialog).toBeVisible();

  // ↓ открывает закрытое поле; набранное и не выбранное возвращается при уходе по Tab и по нажатию вне поля
  await category.focus();
  await category.press('ArrowDown');
  await expect(dialog.getByRole('listbox', { name: 'Категории' })).toBeVisible();
  await category.press('Escape');
  await category.fill('ин');
  await expect(dialog.getByRole('listbox', { name: 'Категории' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('listbox', { name: 'Категории' })).toBeHidden();
  await expect(category).toHaveValue('Аренда');
  await category.fill('ин');
  await dialog.getByRole('heading').click();
  await expect(dialog.getByRole('listbox', { name: 'Категории' })).toBeHidden();
  await expect(category).toHaveValue('Аренда');
  // печать в закрытом поле со значением: запрос — только напечатанное, без прежнего названия
  await category.focus();
  await category.pressSequentially('интернет');
  await expect(dialog.getByRole('listbox', { name: 'Категории' }).getByRole('option')).toHaveText(['+ Создать категорию „интернет“']);
  await category.press('Escape');
  await expect(category).toHaveValue('Аренда');

  // «Сохранить и создать похожий»: категория и контрагент остаются, сумма и комментарий — нет
  await pick(page, 'Мой контрагент', 'ТОО Ромашка');
  await amount.fill('100');
  await dialog.getByRole('button', { name: 'Добавить проект, тег, комментарий, файл' }).click();
  await dialog.getByLabel('Комментарий').fill('первый');
  await dialog.getByRole('button', { name: 'Добавить и создать похожий' }).click();
  await expect(dialog.getByRole('status').filter({ hasText: 'Операция сохранена' })).toContainText('Операция сохранена');
  await expect(amount).toHaveValue('');
  await expect(amount).toBeFocused();
  await expect(dialog.getByLabel('Комментарий')).toHaveValue('');
  await expect(category).toHaveValue('Аренда');
  await expect(field(dialog, 'Мой контрагент')).toHaveValue('ТОО Ромашка');
  // Enter в поле суммы с невычисленным выражением: сохраняется результат, а не текст
  await amount.fill('150+50');
  const similarRequest = nextCreate(page);
  await amount.press('Enter');
  expect((await similarRequest).postDataJSON().amount).toBe(20000);
  await expect(dialog).toBeHidden();
  const rows = table(page).locator('tbody tr').filter({ hasText: 'ТОО Ромашка' });
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: 'первый' })).toContainText(/100\s₸/);
  await expect(rows.filter({ hasNotText: 'первый' })).toContainText(/200\s₸/);

  // без изменений Esc закрывает сразу; фокус возвращается на кнопку шапки
  await openForm(page, 'Доход');
  await page.keyboard.press('Escape');
  await expect(form(page)).toBeHidden();
  await expect(page.getByRole('banner').getByRole('button', { name: 'Доход', exact: true })).toBeFocused();
});

// Сценарий 4 §10 на ширине 390 px (создание с нижней панели и правка из карточки) — в e2e/mobile.spec.ts (план 7).

test('«Разделить» в процентах на два проекта; шаблон разделения: применить с недоступной категорией, сохранить текущее', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Разбиение ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  const north = (await apiPost(page, `${base}/projects`, { name: 'Север', templateKey: 'general' })).project.id;
  const south = (await apiPost(page, `${base}/projects`, { name: 'Юг', templateKey: 'general' })).project.id;
  const rent = (await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Аренда' })).category.id;
  const light = (await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Свет' })).category.id;
  await apiPost(page, `${base}/split-presets`, {
    name: 'Север и Юг',
    lines: [
      { categoryId: rent, projectId: north, bp: 7000 },
      { categoryId: light, projectId: south, bp: 3000 },
    ],
  });
  await apiPost(page, `${base}/categories/${light}/archive`, {});
  await page.reload();

  // проценты: остаток виден, сохранить можно только при 0
  let dialog = await openForm(page, 'Расход');
  await pick(page, 'Со счёта', 'Касса');
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('1000');
  await dialog.getByRole('button', { name: 'Разделить платёж' }).click();
  const split = dialog.getByRole('region', { name: 'Разбиение' });
  // в первой строке уже стоит вся сумма: смена способа сбрасывает значения — сначала вопрос (вложенное окно)
  await split.getByRole('radio', { name: 'В процентах' }).click();
  const reset = page.getByRole('alertdialog', { name: 'Сменить способ деления?' });
  await expect(reset).toHaveAccessibleDescription('Значения строк будут сброшены.');
  // Esc закрывает только вопрос: окно открыто, вопроса о несохранённом нет (Review Focus 2, отложенное 6a №2)
  await page.keyboard.press('Escape');
  await expect(reset).toBeHidden();
  await expect(page.getByRole('alertdialog', { name: 'Ваши данные не сохранятся' })).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await split.getByRole('radio', { name: 'В процентах' }).click();
  await reset.getByRole('button', { name: 'Отменить' }).click();
  await expect(split.getByRole('radio', { name: 'Суммами' })).toBeChecked();
  await expect(split.getByRole('group', { name: 'Строка 1' }).getByRole('textbox', { name: /^Сумма/ })).toHaveValue('1000');
  await split.getByRole('radio', { name: 'В процентах' }).click();
  await reset.getByRole('button', { name: 'Сбросить значения' }).click();
  await expect(split.getByRole('radio', { name: 'В процентах' })).toBeChecked();
  const line1 = split.getByRole('group', { name: 'Строка 1' });
  const line2 = split.getByRole('group', { name: 'Строка 2' });
  await pick(page, 'Категория', 'Аренда', line1);
  await pick(page, 'Проект', 'Север', line1);
  await line1.getByLabel('Доля, %').fill('60');
  await pick(page, 'Категория', 'Аренда', line2);
  await pick(page, 'Проект', 'Юг', line2);
  await line2.getByLabel('Доля, %').fill('30');
  await expect(split.getByRole('status').first()).toHaveText('Не распределено: 10 %');
  // фокус в списке строк: новая строка — на её «Категории», удаление — на «Убрать» предыдущей строки
  await split.getByRole('button', { name: '+ Строка' }).click();
  await expect(field(split.getByRole('group', { name: 'Строка 3' }), 'Категория')).toBeFocused();
  await split.getByRole('button', { name: 'Убрать строку 3' }).click();
  await expect(split.getByRole('button', { name: 'Убрать строку 2' })).toBeFocused();
  await submit(dialog).click();
  await expect(split.getByRole('alert')).toContainText('Распределите всю сумму');
  await expect(dialog).toBeVisible();
  await line2.getByLabel('Доля, %').fill('40');
  await expect(split.getByRole('status').first()).toHaveText('Распределено полностью');
  await expect(line1).toContainText(/= 600\s₸/);
  await expect(line2).toContainText(/= 400\s₸/);
  await submit(dialog).click();
  await expect(dialog).toBeHidden();
  const row = table(page).locator('tbody tr').first();
  await expect(row).toContainText('Аренда');
  await expect(row).toContainText('2 проекта');
  await expect(row).toContainText(/1\s000\s₸/);

  // шаблон: категория «Свет» в архиве — отброшена с предупреждением, её строка остаётся с проектом
  dialog = await openForm(page, 'Расход');
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('100');
  await dialog.getByRole('button', { name: 'Разделить платёж' }).click();
  await split.getByRole('button', { name: 'Применить шаблон' }).click();
  await dialog.getByRole('option', { name: 'Север и Юг' }).click();
  // в первой строке стоит сумма операции: шаблон заменит строки — сначала вопрос
  await page.getByRole('alertdialog', { name: 'Применить шаблон «Север и Юг»?' }).getByRole('button', { name: 'Применить' }).click();
  // после вопроса фокус возвращается на кнопку «Применить шаблон»
  await expect(split.getByRole('button', { name: 'Применить шаблон' })).toBeFocused();
  // строка 2 стала «Отменить разделение»
  await expect(dialog.getByRole('button', { name: 'Отменить разделение' })).toBeVisible();
  await expect(split).toContainText('Шаблон «Север и Юг»: 1 элемент недоступен');
  await expect(field(line1, 'Категория')).toHaveValue('Аренда');
  await expect(field(line1, 'Проект')).toHaveValue('Север');
  await expect(line1.getByLabel('Доля, %')).toHaveValue('70');
  await expect(field(line2, 'Категория')).toHaveValue('');
  await expect(field(line2, 'Проект')).toHaveValue('Юг');
  await expect(split.getByRole('status').first()).toHaveText('Распределено полностью');

  // текущее разбиение — новым шаблоном
  await split.getByRole('button', { name: 'Сохранить как шаблон' }).click();
  await split.getByLabel('Название шаблона').fill('Без света');
  await split.getByRole('button', { name: 'Сохранить шаблон' }).click();
  await expect(split).toContainText('Шаблон «Без света» сохранён.');
  await submit(dialog).click();
  await expect(dialog).toBeHidden();
  const presets = (await (await page.request.get(`${base}/split-presets`)).json()).splitPresets as { name: string; lines: unknown[] }[];
  expect(presets.find((p) => p.name === 'Без света')!.lines).toEqual([
    { categoryId: rent, projectId: north, bp: 7000 },
    { categoryId: null, projectId: south, bp: 3000 },
  ]);
});

test('сценарий 3 §10 через форму: доход, расход на два проекта, перевод KZT → USD — балансы в панели и остатки в журнале', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Сценарий формы ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 100000 });
  await apiPost(page, `${base}/accounts`, { name: 'Валютный', currency: 'USD', openedAt: '2020-01-01' });
  await apiPost(page, `${base}/projects`, { name: 'Север', templateKey: 'general' });
  await apiPost(page, `${base}/projects`, { name: 'Юг', templateKey: 'general' });
  await apiPost(page, `${base}/categories`, { kind: 'income', name: 'Выручка' });
  await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Аренда' });
  // курс компании: доллары входят в «Всего на счетах»
  await apiPost(page, `${base}/fixed-rates`, { currency: 'USD', rate: '500', validFrom: '2020-01-01' });
  await page.reload();

  // доход 500 на проект «Север»
  let dialog = await openForm(page, 'Доход');
  const amount = dialog.getByRole('textbox', { name: /^Сумма,/ });
  await expect(field(dialog, 'На счёт')).toBeFocused();
  await amount.fill('500');
  await pick(page, 'На счёт', 'Касса');
  await pick(page, 'Категория', 'Выручка');
  await dialog.getByRole('button', { name: 'Добавить проект, тег, комментарий, файл' }).click();
  await pick(page, 'Проект', 'Север');
  await submit(dialog).click();
  await expect(dialog).toBeHidden();

  // расход 300: «Аренда» на два проекта суммами — 100 и 200
  dialog = await openForm(page, 'Расход');
  await expect(field(dialog, 'Со счёта')).toBeFocused();
  await pick(page, 'Со счёта', 'Касса');
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('300');
  await dialog.getByRole('button', { name: 'Разделить платёж' }).click();
  const split = dialog.getByRole('region', { name: 'Разбиение' });
  const line1 = split.getByRole('group', { name: 'Строка 1' });
  const line2 = split.getByRole('group', { name: 'Строка 2' });
  // удалили единственную возможную к удалению строку — фокус на «+ Строка»; добавили — на «Категории» новой строки
  await split.getByRole('button', { name: 'Убрать строку 2' }).click();
  await expect(split.getByRole('button', { name: '+ Строка' })).toBeFocused();
  await split.getByRole('button', { name: '+ Строка' }).click();
  await expect(field(line2, 'Категория')).toBeFocused();
  await pick(page, 'Категория', 'Аренда', line1);
  await pick(page, 'Проект', 'Север', line1);
  await line1.getByRole('textbox', { name: /^Сумма/ }).fill('100');
  await pick(page, 'Категория', 'Аренда', line2);
  await pick(page, 'Проект', 'Юг', line2);
  await line2.getByRole('textbox', { name: /^Сумма/ }).fill('200');
  await expect(split.getByRole('status').first()).toHaveText('Распределено полностью');
  await submit(dialog).click();
  await expect(dialog).toBeHidden();

  // перевод 500 ₸ → 1 $
  dialog = await openForm(page, 'Перевод');
  await expect(field(dialog, 'Со счёта')).toBeFocused();
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('500');
  await pick(page, 'Со счёта', 'Касса');
  await pick(page, 'На счёт', 'Валютный');
  await dialog.getByRole('textbox', { name: /^Сумма зачисления/ }).fill('1');
  await submit(dialog).click();
  await expect(dialog).toBeHidden();

  // левая панель: 1 000 + 500 - 300 - 500 = 700 ₸ и 1 $ (= 500 ₸ по курсу компании)
  await expect(panel(page).getByRole('link', { name: /^Касса/ })).toContainText(/₸\s700$/);
  await expect(panel(page).getByRole('link', { name: /^Валютный/ })).toContainText(/\$\s1$/);
  await expect(panel(page)).toContainText(/Всего на счетах\s*₸\s1\s200(?![\s\d])/);

  // журнал: остатки после каждой операции; у расхода — «2 проекта», у перевода — остатки обоих счетов
  const rows = table(page).locator('tbody tr');
  await expect(rows).toHaveCount(3);
  // «Счёт/остаток» (§5.2 этапа 1.5): остаток без слова «остаток», у перевода — оба
  const accountCell = (row: Locator) => row.locator('[data-column="account"]');
  await expect(accountCell(rows.filter({ hasText: 'Выручка' }))).toContainText(/1\s500\s₸/);
  const rent = rows.filter({ hasText: 'Аренда' });
  await expect(rent).toContainText('2 проекта');
  await expect(accountCell(rent)).toContainText(/1\s200\s₸/);
  const transfer = rows.filter({ hasText: 'Валютный' });
  await expect(accountCell(transfer)).toContainText(/700\s₸\s*→\s*1\s\$/);
});

test('«+ Создать „…“» прямо из формы: контрагент с типом под категорию, категория, проект, тег; тег из архива — ошибка', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Создать ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  const old = (await apiPost(page, `${base}/tags`, { name: 'старый' })).tag.id;
  await apiPost(page, `${base}/tags/${old}/archive`, {});
  await page.reload();

  const dialog = await openForm(page, 'Расход');
  await pick(page, 'Со счёта', 'Касса');
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('700');
  // «Зарплата» — системная категория: новый контрагент создаётся сотрудником
  await pick(page, 'Категория', 'Зарплата');
  const person = field(dialog, 'Сотрудник');
  await person.fill('Асель');
  await dialog.getByRole('option', { name: '+ Создать контрагента „Асель“' }).click();
  await expect(person).toHaveValue('Асель');

  // категория: Enter на пункте «+ Создать» тоже создаёт
  const category = field(dialog, 'Категория');
  await category.fill('Интернет');
  await category.press('ArrowDown');
  // активный пункт — тот, на который указывает aria-activedescendant поля
  const createId = await dialog.getByRole('option', { name: '+ Создать категорию „Интернет“' }).getAttribute('id');
  await expect(category).toHaveAttribute('aria-activedescendant', createId!);
  await category.press('Enter');
  await expect(category).toHaveValue('Интернет');
  // Tab в поле выделяет название целиком: символ, совпавший с первой буквой названия, не теряется — список отфильтрован по «И»
  await page.keyboard.press('Shift+Tab');
  await expect(category).not.toBeFocused();
  await page.keyboard.press('Tab');
  await expect(category).toBeFocused();
  await page.keyboard.type('И');
  await expect(category).toHaveValue('И');
  await expect(dialog.getByRole('option', { name: /^Интернет/ })).toBeVisible();
  await category.press('Escape');
  await expect(category).toHaveValue('Интернет');
  // такое название уже есть (без учёта регистра) — «Создать» не предлагается
  // (замена всего названия: открываем список — запрос тогда весь набранный текст, а не разница с «Интернет»)
  await category.click();
  await category.fill('интернет');
  await expect(dialog.getByRole('option', { name: /Создать/ })).toHaveCount(0);
  await category.press('Escape');

  await dialog.getByRole('button', { name: 'Добавить проект, тег, комментарий, файл' }).click();
  const project = field(dialog, 'Проект');
  await project.fill('Клуб Центр');
  await dialog.getByRole('option', { name: '+ Создать проект „Клуб Центр“' }).click();
  await expect(project).toHaveValue('Клуб Центр');

  // теги — поле с плашками внутри (§6.7): печать ищет, «+ Создать тег „…“» создаёт и добавляет плашку
  const tags = field(dialog, 'Теги');
  await tags.fill('нал');
  await dialog.getByRole('option', { name: '+ Создать тег „нал“' }).click();
  await expect(dialog.getByRole('button', { name: 'Убрать тег «нал»' })).toBeVisible();
  await expect(tags).toBeFocused();
  // Backspace в пустом поле убирает последнюю плашку; выбор из списка возвращает её
  await tags.press('Backspace');
  await expect(dialog.getByRole('button', { name: 'Убрать тег «нал»' })).toHaveCount(0);
  await tags.click();
  await dialog.getByRole('option', { name: 'нал', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Убрать тег «нал»' })).toBeVisible();
  // архивный тег не предлагается, а создать такой же нельзя — сообщение сервера
  await tags.fill('старый');
  await dialog.getByRole('option', { name: '+ Создать тег „старый“' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Не удалось создать «старый»');
  // набранное название остаётся в поле, чтобы его поправить
  await expect(tags).toHaveValue('старый');
  await expect(tags).toBeFocused();
  // добавление объявляется скрытой областью; после «×» фокус на «×» соседней плашки, у последней — в поле
  await tags.fill('вторая');
  await dialog.getByRole('option', { name: '+ Создать тег „вторая“' }).click();
  await expect(dialog.getByRole('status').filter({ hasText: 'Тег вторая добавлен' })).toHaveCount(1);
  await expect(dialog.getByRole('list', { name: 'Выбранные теги' }).getByRole('listitem')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Убрать тег «нал»' }).click();
  await expect(dialog.getByRole('button', { name: 'Убрать тег «вторая»' })).toBeFocused();
  await expect(dialog.getByRole('status').filter({ hasText: 'Тег нал убран' })).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Убрать тег «вторая»' }).click();
  await expect(tags).toBeFocused();

  await submit(dialog).click();
  await expect(dialog).toBeHidden();
  const row = table(page).locator('tbody tr').first();
  await expect(row).toContainText('Интернет');
  await expect(row).toContainText('Асель');
  await expect(row).toContainText('Клуб Центр');
  const people = (await (await page.request.get(`${base}/counterparties`)).json()).counterparties as { name: string; type: string }[];
  expect(people.find((c) => c.name === 'Асель')!.type).toBe('employee');
});

test('нет курса на дату: «Указать курс на {D}» создаёт ручной курс прямо в форме, «Повторить» сохраняет операцию', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Курс ${Date.now()}`);
  // CHF и 2021 год — только в этом тесте: ручной курс общий для всех компаний
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Франки', currency: 'CHF', openedAt: '2020-01-01' });
  await page.reload();

  const dialog = await openForm(page, 'Расход');
  await pick(page, 'Со счёта', 'Франки');
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('10');
  // дата — в календаре поля «Указать дату списания» (§6.5); «Готово» закрывает панель, время остаётся «живым»
  await dialog.getByRole('button', { name: /^Указать дату списания:/ }).click();
  const calendar = page.getByRole('dialog', { name: 'Указать дату списания: календарь' });
  await pickDay(page, calendar, '2021-06-15');
  await calendar.getByRole('button', { name: 'Готово' }).click();
  await expect(dialog.getByRole('button', { name: /^Указать дату списания:/ })).toHaveAccessibleName(/^Указать дату списания: Вторник, 15\.06\.2021, \d{2}:\d{2}$/);
  await submit(dialog).click();
  const alert = dialog.getByRole('alert').filter({ hasText: 'Нет курса CHF на 15.06.2021' });
  await expect(alert).toBeVisible();
  await expect(alert.getByRole('button', { name: 'Указать курс на 15.06.2021' })).toBeFocused();
  await alert.getByRole('button', { name: 'Указать курс на 15.06.2021' }).click();
  await alert.getByRole('button', { name: 'Не указывать' }).click();
  await expect(alert.getByRole('button', { name: 'Указать курс на 15.06.2021' })).toBeFocused();
  // Esc в мини-форме закрывает только её, а не всю форму; фокус — на «Указать курс…»
  await alert.getByRole('button', { name: 'Указать курс на 15.06.2021' }).click();
  await expect(alert.getByLabel('Курс CHF к тенге на 15.06.2021')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('alertdialog', { name: 'Ваши данные не сохранятся' })).toHaveCount(0);
  await expect(alert.getByLabel('Курс CHF к тенге на 15.06.2021')).toHaveCount(0);
  await expect(alert.getByRole('button', { name: 'Указать курс на 15.06.2021' })).toBeFocused();
  await alert.getByRole('button', { name: 'Указать курс на 15.06.2021' }).click();
  const rate = alert.getByLabel('Курс CHF к тенге на 15.06.2021');
  await expect(rate).toBeFocused();
  await rate.fill('abc');
  await alert.getByRole('button', { name: 'Сохранить курс' }).click();
  await expect(rate).toHaveAttribute('aria-invalid', 'true');
  await rate.fill('560,5');
  await rate.press('Enter');
  await expect(alert).toContainText('Курс CHF на 15.06.2021 сохранён');
  await expect(alert.getByRole('button', { name: 'Повторить' })).toBeFocused();
  await expect(dialog).toBeVisible();
  await alert.getByRole('button', { name: 'Повторить' }).click();
  await expect(dialog).toBeHidden();
  const row = table(page).locator('tbody tr').filter({ hasText: '15 июн. 2021' });
  await expect(row).toContainText(/5\s605\s₸/);
});

test('сбой «+ Создать» в форме: сообщение и набранное название остаётся в поле с открытым списком', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Сбой ${Date.now()}`);
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await page.reload();
  const dialog = await openForm(page, 'Расход');
  await page.route('**/api/v1/companies/*/categories', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'CONFLICT', message: 'Конфликт', fields: { name: 'Категория с таким названием уже есть' } } }) });
  });
  const category = field(dialog, 'Категория');
  await category.fill('Новая категория');
  await dialog.getByRole('option', { name: '+ Создать категорию „Новая категория“' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Не удалось создать «Новая категория»: Категория с таким названием уже есть');
  await expect(category).toHaveValue('Новая категория');
  await expect(category).toBeFocused();
  await expect(dialog.getByRole('listbox', { name: 'Категории' })).toBeVisible();
});

test('последний счёт и фокус при открытии: пустой счёт — фокус на нём; после сохранения счёт запомнен для типа; архивный — пусто', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Последний счёт ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  // стартовый остаток 100 ₸ = расход ниже: в архив счёт уходит только с нулевым балансом (accounts/service.ts, 422)
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 10000 })).account.id;
  await page.reload();

  // счёт не выбирался — поле пустое, как в Finmap, и фокус на нём
  let dialog = await openForm(page, 'Расход');
  await expect(field(dialog, 'Со счёта')).toHaveValue('');
  await expect(field(dialog, 'Со счёта')).toBeFocused();
  await pick(page, 'Со счёта', 'Kaspi');
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('100');
  await submit(dialog).click();
  await expect(dialog).toBeHidden();

  // тот же тип — запомненный счёт; данные в кэше, окно сфокусировало счёт, а фокус всё равно в сумме (Review Focus 1)
  dialog = await openForm(page, 'Расход');
  await expect(field(dialog, 'Со счёта')).toHaveValue('Kaspi');
  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  // у дохода — свой счёт, он ещё не выбирался
  dialog = await openForm(page, 'Доход');
  await expect(field(dialog, 'На счёт')).toHaveValue('');
  await expect(field(dialog, 'На счёт')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // запомненный счёт ушёл в архив (баланс: 100 ₸ стартовых минус расход 100 ₸ = 0) — поле снова пустое (Review Focus 4)
  await apiPost(page, `${base}/accounts/${kaspi}/archive`, {});
  await page.reload();
  dialog = await openForm(page, 'Расход');
  await expect(field(dialog, 'Со счёта')).toHaveValue('');
  await expect(field(dialog, 'Со счёта')).toBeFocused();
});

test('дата и время оплаты: «Сегодня, …, ЧЧ:ММ», свой календарь и строка «Время»; время руками переносится в «похожий»', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Время ${Date.now()}`);
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await page.reload();

  const dialog = await openForm(page, 'Расход');
  await pick(page, 'Со счёта', 'Касса');
  const when = dialog.getByRole('button', { name: /^Указать дату списания:/ });
  // «живое» время: сегодня и «сейчас» (§2.3)
  await expect(when).toHaveAccessibleName(/^Указать дату списания: Сегодня, \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/);

  // вчера, 9:05: день — в календаре (панель не закрывается), время — в строке «Время», «Готово» закрывает
  await when.click();
  const panel = page.getByRole('dialog', { name: 'Указать дату списания: календарь' });
  // клавиши — сетке: фокус на сегодняшнем дне
  await expect(panel.locator('[role="gridcell"][tabindex="0"]')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(panel.locator('[role="gridcell"][tabindex="0"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(panel).toBeVisible();
  await panel.getByLabel('Время').fill('9:05');
  await panel.getByRole('button', { name: 'Готово' }).click();
  await expect(panel).toBeHidden();
  await expect(when).toBeFocused();
  const yesterday = shiftDay(almatyToday(), -1);
  await expect(when).toHaveAccessibleName(`Указать дату списания: Вчера, ${ru(yesterday)}, 09:05`);
  const at = new Date(`${yesterday}T09:05:00+05:00`).toISOString();

  // «+ Добавить и создать похожий»: время, заданное руками, остаётся — выручку за смену вносят двумя операциями
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('100');
  let request = nextCreate(page);
  await dialog.getByRole('button', { name: 'Добавить и создать похожий' }).click();
  expect((await request).postDataJSON().paidAt).toBe(at);
  await expect(dialog.getByRole('status')).toContainText('Операция сохранена');
  await expect(when).toHaveAccessibleName(`Указать дату списания: Вчера, ${ru(yesterday)}, 09:05`);
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('200');
  request = nextCreate(page);
  await submit(dialog).click();
  expect((await request).postDataJSON().paidAt).toBe(at);
  await expect(dialog).toBeHidden();

  // неверное время — ошибка в панели, панель остаётся; Esc закрывает её, время остаётся «живым»
  const again = await openForm(page, 'Расход');
  const againWhen = again.getByRole('button', { name: /^Указать дату списания:/ });
  await againWhen.click();
  await panel.getByLabel('Время').fill('25:00');
  await panel.getByRole('button', { name: 'Готово' }).click();
  await expect(panel).toContainText('Введите время в виде ЧЧ:ММ');
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(again).toBeVisible();
  await expect(againWhen).toHaveAccessibleName(/^Указать дату списания: Сегодня, \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/);
});

test('время позже «сейчас», заданное руками, — ошибка у поля «Это время ещё не наступило»', async ({ page }) => {
  const nowHm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Almaty', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  test.skip(nowHm >= '23:58', 'в последние минуты суток будущего времени «сегодня» уже нет');
  await login(page);
  const cid = await createCompany(page, `ТОО Будущее время ${Date.now()}`);
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await page.reload();

  const dialog = await openForm(page, 'Доход');
  await pick(page, 'На счёт', 'Касса');
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('50');
  const when = dialog.getByRole('button', { name: /^Дата поступления денег:/ });
  await when.click();
  const panel = page.getByRole('dialog', { name: 'Дата поступления денег: календарь' });
  await panel.getByLabel('Время').fill('23:59');
  await panel.getByRole('button', { name: 'Готово' }).click();
  let posts = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/operations$/.test(new URL(r.url()).pathname)) posts += 1;
  });
  await submit(dialog).click();
  await expect(when).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog).toContainText('Это время ещё не наступило');
  await expect(dialog).toBeVisible();
  expect(posts).toBe(0);
});

test('«Зарплата за {месяц}»: месяц оплаты серым; выбор месяца — дата сделки первым числом; несистемная категория — поле «Дата сделки»', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Зарплата за ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 1000000 });
  await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Аренда' });
  await page.reload();
  const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  const CAP = MONTHS.map((m) => m[0]!.toUpperCase() + m.slice(1));
  const [y, m] = almatyToday().split('-').map(Number) as [number, number];
  // прошлый месяц; в январе — декабрь прошлого года (Review Focus 4)
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  const pad = (n: number) => String(n).padStart(2, '0');

  const dialog = await openForm(page, 'Расход');
  await pick(page, 'Со счёта', 'Касса');
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('8000');
  await pick(page, 'Категория', 'Зарплата');
  // без даты сделки — месяц даты оплаты; строки «Дата сделки отличается» нет
  const current = dialog.getByRole('button', { name: `Зарплата за ${MONTHS[m - 1]}`, exact: true });
  await expect(current).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Дата сделки отличается' })).toHaveCount(0);

  // выбор прошлого месяца в панели: год «‹ ›», 12 месяцев
  await current.click();
  const months = page.getByRole('dialog', { name: 'Месяц начисления' });
  if (prev.y !== y) await months.getByRole('button', { name: 'Предыдущий год' }).click();
  await months.getByRole('button', { name: `${CAP[prev.m - 1]} ${prev.y}`, exact: true }).click();
  await expect(months).toBeHidden();
  const label = `Зарплата за ${MONTHS[prev.m - 1]}${prev.y !== y ? ` ${prev.y}` : ''}`;
  await expect(dialog.getByRole('button', { name: label, exact: true })).toBeFocused();

  // «Как дата оплаты» убирает дату сделки; снова прошлый месяц
  await dialog.getByRole('button', { name: label, exact: true }).click();
  await months.getByRole('button', { name: 'Как дата оплаты' }).click();
  await expect(current).toBeVisible();
  await current.click();
  if (prev.y !== y) await months.getByRole('button', { name: 'Предыдущий год' }).click();
  await months.getByRole('button', { name: `${CAP[prev.m - 1]} ${prev.y}`, exact: true }).click();

  // несистемная категория — снова «Дата сделки», дата сделки сохранилась
  await pick(page, 'Категория', 'Аренда');
  await expect(dialog.getByRole('button', { name: /^Дата сделки:/ })).toHaveAccessibleName(`Дата сделки: 01.${pad(prev.m)}.${prev.y}`);
  await pick(page, 'Категория', 'Зарплата');
  await expect(dialog.getByRole('button', { name: label, exact: true })).toBeVisible();
  const request = nextCreate(page);
  await submit(dialog).click();
  expect((await request).postDataJSON().accrualDate).toBe(`${prev.y}-${pad(prev.m)}-01`);
  await expect(dialog).toBeHidden();
});
