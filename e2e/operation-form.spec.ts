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
const panel = (page: Page) => page.getByRole('navigation', { name: 'Счета' });
/** Тело следующего запроса создания операции. */
const nextCreate = (page: Page) =>
  page.waitForRequest((r) => r.method() === 'POST' && /\/operations$/.test(new URL(r.url()).pathname));
const form = (page: Page) => page.getByRole('dialog', { name: 'Новая операция' });

/** Открыть форму кнопкой шапки: «Доход», «Расход» или «Перевод». */
async function openForm(page: Page, button: 'Доход' | 'Расход' | 'Перевод') {
  await page.getByRole('banner').getByRole('button', { name: button, exact: true }).click();
  await expect(form(page)).toBeVisible();
  return form(page);
}

/** Выбрать значение в выпадающем списке формы: кнопка «Подпись: …», затем пункт списка (список — в окне формы). */
async function pick(page: Page, label: string, option: string, scope: Locator = form(page)) {
  await scope.getByRole('button', { name: new RegExp(`^${label}:`) }).click();
  await form(page).getByRole('option', { name: option, exact: true }).click();
  await expect(scope.getByRole('button', { name: new RegExp(`^${label}: ${option.replace(/[()]/g, '\\$&')}`) })).toBeVisible();
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
  await expect(dialog.getByRole('radio', { name: 'Доход' })).toBeChecked();
  const amount = dialog.getByRole('textbox', { name: /^Сумма,/ });
  await expect(amount).toBeFocused();
  await pick(page, 'Счёт', 'Касса (KZT)');
  await pick(page, 'Категория', 'Выручка');
  await amount.fill('1 500 + 500');
  await amount.blur();
  await expect(amount).toHaveValue('2000');
  await amount.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(table(page).locator('tbody tr').filter({ hasText: 'Выручка' })).toContainText(/\+2\s000\s₸/);
  await expect(panel(page).getByRole('link', { name: /^Касса/ })).toContainText(/₸\s3\s000$/);

  // расход с комментарием из свёрнутого блока; сумма — невычисленное выражение, «Сохранить» нажимают сразу
  dialog = await openForm(page, 'Расход');
  await pick(page, 'Категория', 'Аренда');
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('100+200');
  await dialog.getByRole('button', { name: 'Проект, теги, комментарий' }).click();
  await dialog.getByLabel('Комментарий').fill('за октябрь');
  // click без ухода фокуса из поля (dispatchEvent): сумма уходит на сервер уже вычисленной
  const rentRequest = nextCreate(page);
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).dispatchEvent('click');
  expect((await rentRequest).postDataJSON().amount).toBe(30000);
  await expect(dialog).toBeHidden();
  const rent = table(page).locator('tbody tr').filter({ hasText: 'Аренда' });
  await expect(rent).toContainText('за октябрь');
  await expect(rent).toContainText(/300\s₸/);

  // перевод в другую валюту: «Сумма зачисления» и вычисленный курс
  dialog = await openForm(page, 'Перевод');
  await expect(dialog.getByRole('textbox', { name: /^Сумма зачисления/ })).toHaveCount(0);
  await pick(page, 'Со счёта', 'Касса (KZT)');
  await pick(page, 'На счёт', 'Валютный (USD)');
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('500');
  await dialog.getByRole('textbox', { name: /^Сумма зачисления/ }).fill('1');
  await expect(dialog.getByText('Курс: 1 USD = 500 KZT')).toBeVisible();
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
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
  const amount = dialog.getByRole('textbox', { name: /^Сумма,/ });
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
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
  // Esc внутри списка с поиском закрывает только список: окно открыто, вопроса нет, фокус на кнопке списка
  await dialog.getByRole('button', { name: /^Категория:/ }).click();
  await expect(dialog.getByRole('listbox', { name: 'Категории' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('listbox', { name: 'Категории' })).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(question).toBeHidden();
  await expect(dialog.getByRole('button', { name: /^Категория:/ })).toBeFocused();

  // «Зарплата» (системная категория): сначала сотрудники, затем остальные
  await pick(page, 'Категория', 'Зарплата');
  await dialog.getByRole('button', { name: /^Контрагент:/ }).click();
  const people = dialog.getByRole('listbox', { name: 'Контрагенты' }).getByRole('option');
  await expect(people).toHaveText(['Без контрагента', 'Айгерим', 'ТОО Ромашка']);
  await expect(dialog.getByRole('listbox', { name: 'Контрагенты' })).toContainText('Сотрудники');
  await page.keyboard.press('Escape');
  await pick(page, 'Категория', 'Аренда');
  await dialog.getByRole('button', { name: /^Контрагент:/ }).click();
  await expect(people).toHaveText(['Без контрагента', 'ТОО Ромашка', 'Айгерим']);
  await page.keyboard.press('Escape');

  // после выбора значения список открывается сразу на нём: aria-activedescendant указывает на выбранный пункт
  await dialog.getByRole('button', { name: 'Категория: Аренда' }).click();
  const search = dialog.getByRole('combobox', { name: 'Категории: поиск' });
  const selected = dialog.getByRole('listbox', { name: 'Категории' }).getByRole('option', { name: 'Аренда', exact: true });
  await expect(selected).toHaveAttribute('aria-selected', 'true');
  const selectedId = (await selected.getAttribute('id'))!;
  await expect(search).toHaveAttribute('aria-activedescendant', selectedId);
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('listbox', { name: 'Категории' })).toBeHidden();
  await expect(dialog).toBeVisible();

  // «Сохранить и создать похожий»: категория и контрагент остаются, сумма и комментарий — нет
  await pick(page, 'Контрагент', 'ТОО Ромашка');
  await amount.fill('100');
  await dialog.getByRole('button', { name: 'Проект, теги, комментарий' }).click();
  await dialog.getByLabel('Комментарий').fill('первый');
  await dialog.getByRole('button', { name: 'Сохранить и создать похожий' }).click();
  await expect(dialog.getByRole('status')).toContainText('Операция сохранена');
  await expect(amount).toHaveValue('');
  await expect(amount).toBeFocused();
  await expect(dialog.getByLabel('Комментарий')).toHaveValue('');
  await expect(dialog.getByRole('button', { name: 'Категория: Аренда' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Контрагент: ТОО Ромашка' })).toBeVisible();
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
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('1000');
  await dialog.getByRole('button', { name: 'Разделить', exact: true }).click();
  const split = dialog.getByRole('region', { name: 'Разбиение' });
  // в первой строке уже стоит вся сумма: смена режима сбрасывает значения — сначала вопрос
  await split.getByRole('radio', { name: 'В процентах' }).click();
  await expect(split.getByRole('group', { name: 'Подтверждение' })).toContainText('Значения строк будут сброшены');
  await split.getByRole('button', { name: 'Оставить как есть' }).click();
  await expect(split.getByRole('radio', { name: 'Суммами' })).toBeChecked();
  await expect(split.getByRole('group', { name: 'Строка 1' }).getByRole('textbox', { name: /^Сумма/ })).toHaveValue('1000');
  await split.getByRole('radio', { name: 'В процентах' }).click();
  await split.getByRole('button', { name: 'Сбросить значения' }).click();
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
  await expect(split.getByRole('group', { name: 'Строка 3' }).getByRole('button', { name: /^Категория:/ })).toBeFocused();
  await split.getByRole('button', { name: 'Убрать строку 3' }).click();
  await expect(split.getByRole('button', { name: 'Убрать строку 2' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(split.getByRole('alert')).toContainText('Распределите всю сумму');
  await expect(dialog).toBeVisible();
  await line2.getByLabel('Доля, %').fill('40');
  await expect(split.getByRole('status').first()).toHaveText('Распределено полностью');
  await expect(line1).toContainText(/= 600\s₸/);
  await expect(line2).toContainText(/= 400\s₸/);
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).toBeHidden();
  const row = table(page).locator('tbody tr').first();
  await expect(row).toContainText('Аренда');
  await expect(row).toContainText('2 проекта');
  await expect(row).toContainText(/1\s000\s₸/);

  // шаблон: категория «Свет» в архиве — отброшена с предупреждением, её строка остаётся с проектом
  dialog = await openForm(page, 'Расход');
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('100');
  await dialog.getByRole('button', { name: 'Разделить', exact: true }).click();
  await split.getByRole('button', { name: 'Применить шаблон' }).click();
  await dialog.getByRole('option', { name: 'Север и Юг' }).click();
  // в первой строке стоит сумма операции: шаблон заменит строки — сначала вопрос
  await split.getByRole('button', { name: 'Сбросить значения' }).click();
  await expect(split).toContainText('Шаблон «Север и Юг»: 1 элемент недоступен');
  await expect(line1.getByRole('button', { name: 'Категория: Аренда' })).toBeVisible();
  await expect(line1.getByRole('button', { name: 'Проект: Север' })).toBeVisible();
  await expect(line1.getByLabel('Доля, %')).toHaveValue('70');
  await expect(line2.getByRole('button', { name: 'Категория: Без категории' })).toBeVisible();
  await expect(line2.getByRole('button', { name: 'Проект: Юг' })).toBeVisible();
  await expect(split.getByRole('status').first()).toHaveText('Распределено полностью');

  // текущее разбиение — новым шаблоном
  await split.getByRole('button', { name: 'Сохранить как шаблон' }).click();
  await split.getByLabel('Название шаблона').fill('Без света');
  await split.getByRole('button', { name: 'Сохранить шаблон' }).click();
  await expect(split).toContainText('Шаблон «Без света» сохранён.');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
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
  await expect(amount).toBeFocused();
  await amount.fill('500');
  await pick(page, 'Счёт', 'Касса (KZT)');
  await pick(page, 'Категория', 'Выручка');
  await dialog.getByRole('button', { name: 'Проект, теги, комментарий' }).click();
  await pick(page, 'Проект', 'Север');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).toBeHidden();

  // расход 300: «Аренда» на два проекта суммами — 100 и 200
  dialog = await openForm(page, 'Расход');
  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('300');
  await dialog.getByRole('button', { name: 'Разделить', exact: true }).click();
  const split = dialog.getByRole('region', { name: 'Разбиение' });
  const line1 = split.getByRole('group', { name: 'Строка 1' });
  const line2 = split.getByRole('group', { name: 'Строка 2' });
  // удалили единственную возможную к удалению строку — фокус на «+ Строка»; добавили — на «Категории» новой строки
  await split.getByRole('button', { name: 'Убрать строку 2' }).click();
  await expect(split.getByRole('button', { name: '+ Строка' })).toBeFocused();
  await split.getByRole('button', { name: '+ Строка' }).click();
  await expect(line2.getByRole('button', { name: /^Категория:/ })).toBeFocused();
  await pick(page, 'Категория', 'Аренда', line1);
  await pick(page, 'Проект', 'Север', line1);
  await line1.getByRole('textbox', { name: /^Сумма/ }).fill('100');
  await pick(page, 'Категория', 'Аренда', line2);
  await pick(page, 'Проект', 'Юг', line2);
  await line2.getByRole('textbox', { name: /^Сумма/ }).fill('200');
  await expect(split.getByRole('status').first()).toHaveText('Распределено полностью');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).toBeHidden();

  // перевод 500 ₸ → 1 $
  dialog = await openForm(page, 'Перевод');
  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('500');
  await pick(page, 'Со счёта', 'Касса (KZT)');
  await pick(page, 'На счёт', 'Валютный (USD)');
  await dialog.getByRole('textbox', { name: /^Сумма зачисления/ }).fill('1');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
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
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('700');
  // «Зарплата» — системная категория: новый контрагент создаётся сотрудником
  await pick(page, 'Категория', 'Зарплата');
  await dialog.getByRole('button', { name: /^Контрагент:/ }).click();
  await dialog.getByRole('combobox', { name: 'Контрагенты: поиск' }).fill('Асель');
  await dialog.getByRole('option', { name: '+ Создать „Асель“' }).click();
  await expect(dialog.getByRole('button', { name: 'Контрагент: Асель' })).toBeVisible();

  // категория: Enter на пункте «+ Создать» тоже создаёт
  await dialog.getByRole('button', { name: /^Категория:/ }).click();
  const search = dialog.getByRole('combobox', { name: 'Категории: поиск' });
  await search.fill('Интернет');
  await search.press('ArrowDown');
  // активный пункт — тот, на который указывает aria-activedescendant поля поиска
  const createId = await dialog.getByRole('option', { name: '+ Создать „Интернет“' }).getAttribute('id');
  await expect(search).toHaveAttribute('aria-activedescendant', createId!);
  await search.press('Enter');
  await expect(dialog.getByRole('button', { name: 'Категория: Интернет' })).toBeVisible();
  // такое название уже есть (без учёта регистра) — «Создать» не предлагается
  await dialog.getByRole('button', { name: /^Категория:/ }).click();
  await search.fill('интернет');
  await expect(dialog.getByRole('option', { name: /Создать/ })).toHaveCount(0);
  await search.press('Escape');

  await dialog.getByRole('button', { name: 'Проект, теги, комментарий' }).click();
  await dialog.getByRole('button', { name: /^Проект:/ }).click();
  await dialog.getByRole('combobox', { name: 'Проекты: поиск' }).fill('Клуб Центр');
  await dialog.getByRole('option', { name: '+ Создать „Клуб Центр“' }).click();
  await expect(dialog.getByRole('button', { name: 'Проект: Клуб Центр' })).toBeVisible();

  await dialog.getByRole('button', { name: 'Добавить тег' }).click();
  await dialog.getByRole('combobox', { name: 'Теги: поиск' }).fill('нал');
  await dialog.getByRole('option', { name: '+ Создать „нал“' }).click();
  await expect(dialog.getByRole('group', { name: 'Теги' })).toContainText('нал');
  // архивный тег не предлагается, а создать такой же нельзя — сообщение сервера
  await dialog.getByRole('button', { name: 'Добавить тег' }).click();
  await dialog.getByRole('combobox', { name: 'Теги: поиск' }).fill('старый');
  await dialog.getByRole('option', { name: '+ Создать „старый“' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Не удалось создать «старый»');

  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
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
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('10');
  await dialog.getByLabel('Дата оплаты').fill('2021-06-15');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
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
