import { expect, test, type Page } from '@playwright/test';
import { excelSerial as at, finmapLikeRow as fr, finmapLikeXlsx, type FinmapLikeValue } from '../tests/helpers/finmap-like';

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

async function apiPost(page: Page, url: string, data: unknown) {
  const res = await page.request.post(url, { data, headers: csrf(page) });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return res.json();
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const panel = (page: Page) => page.getByRole('dialog', { name: 'Импорт из Excel' });
/** Выбор файла: скрытое поле панели (кнопка «Выберите файл» открывает его окно выбора). */
const chooseFile = (page: Page, rows: FinmapLikeValue[][], name = 'выгрузка.xlsx') =>
  panel(page).locator('[data-import-file]').setInputFiles({ name, mimeType: XLSX_MIME, buffer: finmapLikeXlsx(rows) });

/** Синтетический файл: доход на существующую «Кассу», перевод на новый «Банк-2», расход с новыми категорией и контрагентом. */
const ROWS = [
  fr({ paidAt: at('2025-03-15', '10:00:00'), amount: 1500, to: 'Касса', category: 'Бар' }),
  fr({ paidAt: at('2025-03-16', '11:00:00'), amount: 500, from: 'Касса', to: 'Банк-2' }),
  fr({ paidAt: at('2025-03-17', '12:00:00'), amount: 200, from: 'Банк-2', category: 'Связь', counterparty: 'Поставщик Б' }),
];

async function companyWithCash(page: Page, title: string): Promise<number> {
  await login(page);
  const cid = await createCompany(page, `ТОО ${title} ${Date.now()}`);
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await page.reload();
  return cid;
}

/** Переход в другую компанию внутри приложения (панель «Компании»): запись в истории браузера без перезагрузки. */
async function switchCompany(page: Page, name: string, cid: number) {
  await page.getByRole('banner').getByRole('button', { name: /Сменить компанию/ }).click();
  await page.getByRole('dialog', { name: 'Компании' }).getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log$`));
}

/** Компании А (с «Кассой») и Б; открыт журнал А, перед ним в истории — журнал Б. */
async function twoCompanies(page: Page, title: string) {
  await login(page);
  const stamp = Date.now();
  const aName = `ТОО ${title} А ${stamp}`;
  const bName = `ТОО ${title} Б ${stamp}`;
  const a = await createCompany(page, aName);
  await apiPost(page, `/api/v1/companies/${a}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  const b = await createCompany(page, bName);
  await switchCompany(page, aName, a);
  return { a, aName, b, bName };
}

test('«Импортировать» — последняя кнопка тулбара, открывает панель «Импорт из Excel»; «Скачать шаблон» скачивает .xlsx; файл больше 30 МБ отклоняется до загрузки', async ({ page }) => {
  await companyWithCash(page, 'Импорт панель');
  const open = page.getByRole('main').getByRole('button', { name: 'Импортировать' });
  await expect(open).toHaveAttribute('aria-haspopup', 'dialog');
  await open.click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByText('Перетяните сюда файл (до 30 МБ)')).toBeVisible();
  // ограничения файла — в описании кнопки «Выберите файл» (§5.8)
  await expect(panel(page).getByRole('button', { name: 'Выберите файл' })).toHaveAccessibleDescription(
    'Формат — как выгрузка Finmap «Excel» или шаблон: .xlsx или .csv. Импортируется первый лист',
  );
  // кнопка «Импортировать» в подвале есть, но недоступна: файла ещё нет
  const go = panel(page).getByRole('button', { name: 'Импортировать' });
  await expect(go).toHaveAttribute('aria-disabled', 'true');
  await expect(go).toHaveAccessibleDescription('Выберите файл');

  const download = page.waitForEvent('download');
  await panel(page).getByRole('link', { name: 'Скачать шаблон' }).click();
  expect((await download).suggestedFilename()).toBe('Шаблон импорта.xlsx');

  // больше 30 МБ — отказ в браузере, без запроса
  let uploads = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/imports/upload')) uploads++;
  });
  await panel(page)
    .locator('[data-import-file]')
    .setInputFiles({ name: 'большой.xlsx', mimeType: XLSX_MIME, buffer: Buffer.alloc(30 * 1024 * 1024 + 1) });
  await expect(panel(page).getByRole('alert')).toHaveText('Файл больше 30 МБ');
  expect(uploads).toBe(0);

  // Esc закрывает панель, фокус возвращается на «Импортировать»
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
  await expect(open).toBeFocused();
});

test('файл → проверка: итог, «Касса» сопоставлена, новый «Банк-2» с «Текущим остатком»; «Импортировать» → «Импорт завершён», журнал и левая панель обновились', async ({ page }) => {
  const cid = await companyWithCash(page, 'Импорт запись');
  await page.getByRole('main').getByRole('button', { name: 'Импортировать' }).click();
  await chooseFile(page, ROWS);

  const p = panel(page);
  await expect(p.getByRole('heading', { level: 3, name: 'Проверка файла' })).toBeFocused();
  await expect(p.getByText(/^В файле 3 операции: доходов 1, расходов 1, переводов 1\. Период: 15\.03\.2025 – 17\.03\.2025$/)).toBeVisible();
  await expect(p.getByText('Будет добавлено: 3')).toBeVisible();
  await expect(p.getByRole('status')).toHaveText('Проверка завершена: ошибок нет, можно импортировать');
  // строка файла: имя и «Выбрать другой файл»
  await expect(p.getByText('выгрузка.xlsx')).toBeVisible();
  await expect(p.getByRole('button', { name: 'Выбрать другой файл' })).toBeVisible();

  const cash = p.getByRole('article', { name: 'Касса' });
  await expect(cash.getByRole('combobox', { name: 'Счёт для «Касса»' })).toHaveValue('Касса');
  await expect(cash.getByText(/^Операций: 2 · движение: \+1\s000\s₸$/)).toBeVisible();
  await expect(cash.getByText(/^Текущий остаток: ₸\s0$/)).toBeVisible();
  await expect(cash.getByText('Дата открытия будет перенесена')).toHaveCount(0);

  const bank = p.getByRole('article', { name: 'Банк-2' });
  await expect(bank.getByRole('combobox', { name: 'Счёт для «Банк-2»' })).toHaveValue('Создать новый счёт');
  await expect(bank.getByLabel('Название')).toHaveValue('Банк-2');
  await expect(bank.getByRole('radiogroup', { name: 'Указать остаток' }).getByRole('radio', { name: 'Текущий остаток' })).toBeChecked();
  await expect(bank.getByText(/^Остаток после импорта: ₸\s300$/)).toBeVisible();
  // «Текущий остаток» 1 000 → «Стартовый баланс: ₸ 700»; пока идёт пересчёт, «Импортировать» недоступна
  const recheck = page.waitForResponse((r) => r.url().endsWith('/imports/preview'));
  await bank.getByLabel('Текущий остаток, ₸').fill('1 000');
  await expect(bank.getByText(/^Стартовый баланс: ₸\s700$/)).toBeVisible();
  await recheck;
  const go = p.getByRole('button', { name: 'Импортировать' });
  await expect(go).not.toHaveAttribute('aria-disabled', 'true');

  // «Будет создано»: группы свёрнуты, кнопки с числом
  const categories = p.getByRole('button', { name: 'Категории: 2' });
  await expect(categories).toHaveAttribute('aria-expanded', 'false');
  await categories.click();
  await expect(p.getByText('Бар', { exact: true })).toBeVisible();
  await expect(p.getByRole('button', { name: 'Контрагенты: 1' })).toBeVisible();

  await go.click();
  await expect(p.getByRole('heading', { level: 3, name: 'Импорт завершён' })).toBeFocused();
  const done = 'Добавлено 3 операции. Создано: 1 счёт, 2 категории, 1 контрагент. Пропущено дубликатов: 0';
  // итог виден под заголовком и объявлен в живой области (§5.8)
  await expect(p.getByRole('paragraph').filter({ hasText: done })).toBeVisible();
  await expect(p.getByRole('status')).toHaveText(done);
  await p.getByRole('button', { name: 'Готово' }).click();
  await expect(p).toBeHidden();
  await expect(page.getByRole('main').getByRole('button', { name: 'Импортировать' })).toBeFocused();

  // журнал и левая панель — без перезагрузки страницы
  await expect(page.getByRole('table', { name: 'Операции' }).locator('tbody tr')).toHaveCount(3);
  const accounts = page.getByRole('navigation', { name: 'Счета' });
  await expect(accounts.getByRole('link', { name: /^Банк-2/ })).toContainText(/₸\s1\s000$/);
  await expect(accounts.getByRole('link', { name: /^Касса/ })).toContainText(/₸\s1\s000$/);
  // повторный файл: всё — дубликаты, импортировать нечего
  await page.getByRole('main').getByRole('button', { name: 'Импортировать' }).click();
  await chooseFile(page, ROWS);
  await expect(p.getByText(/^Дубликаты: 3 — уже есть в компании, будут пропущены/)).toBeVisible();
  await expect(p.getByRole('button', { name: 'Импортировать' })).toHaveAccessibleDescription('Нечего импортировать: все строки — дубликаты');
  expect(cid).toBeGreaterThan(0);
});

test('файл с ошибками: список ошибок, «Импортировать» недоступна с причиной; ошибка файла — сообщение и «Выбрать другой файл»', async ({ page }) => {
  await companyWithCash(page, 'Импорт ошибки');
  await page.getByRole('main').getByRole('button', { name: 'Импортировать' }).click();
  await chooseFile(page, [...ROWS, fr({ paidAt: 'вчера', amount: 1, to: 'Касса' }), fr({ paidAt: at('2025-03-18'), amount: null, to: 'Касса' })]);
  const p = panel(page);
  const alert = p.getByRole('alert').filter({ hasText: 'Найдено ошибок' });
  await expect(alert).toContainText('Найдено ошибок: 2. Исправьте файл и загрузите его снова');
  await expect(alert.getByRole('listitem')).toHaveText(['Не удалось прочитать дату платежа «вчера» — строка 5', 'Нет суммы — строка 6']);
  await expect(p.getByRole('status')).toHaveText('Найдено ошибок: 2');
  const go = p.getByRole('button', { name: 'Импортировать' });
  await expect(go).toHaveAttribute('aria-disabled', 'true');
  await expect(go).toHaveAccessibleDescription('Исправьте ошибки в файле и загрузите его снова');
  let commits = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/imports$/.test(r.url())) commits++;
  });
  // aria-disabled остаётся в порядке Tab: Enter ничего не отправляет
  await go.focus();
  await page.keyboard.press('Enter');
  await expect(go).toBeFocused();
  expect(commits).toBe(0);

  // не XLSX и не CSV — ошибка файла F2 под строкой файла
  await p.locator('[data-import-file]').setInputFiles({ name: 'отчёт.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
  await expect(p.getByRole('alert').filter({ hasText: 'Нужен файл' })).toHaveText('Нужен файл .xlsx или .csv');
  await expect(go).toHaveAccessibleDescription('Выберите другой файл');
});

test('Esc во время записи панель не закрывает, «Назад» в браузере — тоже; 410 «Проверка устарела» — файл проверяется заново, после повторного нажатия импорт проходит', async ({ page }) => {
  const cid = await companyWithCash(page, 'Импорт занята');
  // в журнал — из настроек, переходом внутри приложения: «Назад» в браузере вернёт в настройки
  await page.goto(`/c/${cid}/settings/tags`);
  await page.getByRole('link', { name: /Назад к журналу/ }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log`));
  await page.getByRole('main').getByRole('button', { name: 'Импортировать' }).click();
  await chooseFile(page, ROWS);
  const p = panel(page);
  await expect(p.getByRole('heading', { level: 3, name: 'Проверка файла' })).toBeFocused();

  // первый POST …/imports — 410 (кэш вытеснен): панель сама загружает файл заново и просит нажать ещё раз
  let first = true;
  await page.route(/\/imports$/, async (route) => {
    if (route.request().method() !== 'POST' || !first) return route.fallback();
    first = false;
    await route.fulfill({ status: 410, json: { error: { code: 'IMPORT_EXPIRED', message: 'Проверка устарела — загрузите файл заново' } } });
  });
  const reupload = page.waitForResponse((r) => r.url().endsWith('/imports/upload'));
  await p.getByRole('button', { name: 'Импортировать' }).click();
  await reupload;
  await expect(p.getByRole('alert').filter({ hasText: 'Проверка устарела' })).toHaveText(
    'Проверка устарела — файл проверен заново. Проверьте итог и нажмите «Импортировать» ещё раз',
  );
  await expect(p.getByRole('heading', { level: 3, name: 'Проверка файла' })).toBeFocused();

  // запись задержана: панель занята — Esc, «Закрыть» и нажатие на затемнённый фон её не закрывают
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route(/\/imports$/, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await gate;
    await route.fallback();
  });
  const go = p.getByRole('button', { name: /^Импорт/ });
  await go.click();
  await expect(go).toHaveText('Импортируем…');
  await expect(go).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');
  const closeButton = p.getByRole('button', { name: 'Закрыть' });
  await expect(closeButton).toHaveAttribute('aria-disabled', 'true');
  await closeButton.focus();
  await page.keyboard.press('Enter');
  // щелчок мышью по недоступной (aria-disabled) кнопке — тоже ничего
  await closeButton.click({ force: true });
  // фон — слева от панели (панель у правого края)
  await page.mouse.click(10, 300);
  await expect(p).toBeVisible();
  // «Назад» в браузере уводит с журнала, но панель живёт в раскладке компании — запись видна до конца
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/tags$`));
  await expect(p).toBeVisible();
  release();
  await expect(p.getByRole('heading', { level: 3, name: 'Импорт завершён' })).toBeFocused();
});

test('выбор счёта переживает «Выбрать другой файл»; данные изменились после проверки — 409, свежий итог и сообщение, повторное «Импортировать» проходит', async ({ page }) => {
  const cid = await companyWithCash(page, 'Импорт изменения');
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Сейф', currency: 'KZT', openedAt: '2020-01-01' });
  await page.reload();
  await page.getByRole('main').getByRole('button', { name: 'Импортировать' }).click();
  await chooseFile(page, ROWS);
  const p = panel(page);
  // «Банк-2» → существующий «Сейф»
  const bankAccount = p.getByRole('article', { name: 'Банк-2' }).getByRole('combobox', { name: 'Счёт для «Банк-2»' });
  await bankAccount.click();
  const chosen = page.waitForResponse((r) => r.url().endsWith('/imports/preview'));
  await page.getByRole('option', { name: 'Сейф' }).click();
  await chosen;
  await expect(bankAccount).toHaveValue('Сейф');
  await expect(p.getByRole('article', { name: 'Банк-2' }).getByText(/^Текущий остаток: ₸\s0$/)).toBeVisible();

  // другой файл с тем же счётом: выбор «Сейф» применён сразу, без нового выбора
  await chooseFile(page, [fr({ paidAt: at('2025-03-18', '09:00:00'), amount: 300, from: 'Банк-2', category: 'Связь' })], 'исправленный.xlsx');
  await expect(p.getByText('исправленный.xlsx')).toBeVisible();
  await expect(p.getByRole('article', { name: 'Банк-2' }).getByRole('combobox', { name: 'Счёт для «Банк-2»' })).toHaveValue('Сейф');
  await expect(p.getByRole('button', { name: 'Категории: 1' })).toBeVisible();

  // другой пользователь создал категорию «Связь»: запись видит другой итог — 409 и свежий предпросмотр
  await apiPost(page, `/api/v1/companies/${cid}/categories`, { kind: 'expense', name: 'Связь' });
  const go = p.getByRole('button', { name: 'Импортировать' });
  await go.click();
  await expect(p.getByRole('alert').filter({ hasText: 'изменились' })).toHaveText(
    'Данные компании изменились после проверки — посмотрите обновлённый итог и нажмите «Импортировать» ещё раз',
  );
  await expect(p.getByRole('button', { name: /^Категории:/ })).toHaveCount(0);
  // выбор человека в карточке остался
  await expect(p.getByRole('article', { name: 'Банк-2' }).getByRole('combobox', { name: 'Счёт для «Банк-2»' })).toHaveValue('Сейф');
  await go.click();
  await expect(p.getByRole('heading', { level: 3, name: 'Импорт завершён' })).toBeFocused();
  await expect(p.getByRole('status')).toHaveText('Добавлено 1 операция. Пропущено дубликатов: 0');
});

test('та же операция появилась после проверки: 422 — «Нечего импортировать», свежий итог с дубликатами', async ({ page }) => {
  const cid = await companyWithCash(page, 'Импорт нечего');
  await page.getByRole('main').getByRole('button', { name: 'Импортировать' }).click();
  await chooseFile(page, [fr({ paidAt: at('2025-04-01', '10:00:00'), amount: 700, to: 'Касса' })]);
  const p = panel(page);
  await expect(p.getByRole('heading', { level: 3, name: 'Проверка файла' })).toBeFocused();
  await expect(p.getByText('Будет добавлено: 1')).toBeVisible();

  // другой пользователь внёс ту же операцию вручную (10:00 по Алматы, UTC+5): строка файла стала дубликатом
  const { accounts } = (await (await page.request.get(`/api/v1/companies/${cid}/accounts`, { headers: csrf(page) })).json()) as {
    accounts: { id: number; name: string }[];
  };
  const cash = accounts.find((a) => a.name === 'Касса')!.id;
  await apiPost(page, `/api/v1/companies/${cid}/operations`, { type: 'income', paidAt: '2025-04-01T05:00:00.000Z', accountId: cash, amount: 70000 });

  const go = p.getByRole('button', { name: 'Импортировать' });
  await go.click();
  await expect(p.getByRole('alert').filter({ hasText: 'Нечего импортировать' })).toHaveText('Нечего импортировать: все операции из файла уже есть в компании');
  await expect(p.getByText(/^Дубликаты: 1 — уже есть в компании, будут пропущены/)).toBeVisible();
  await expect(go).toHaveAttribute('aria-disabled', 'true');
  await expect(go).toHaveAccessibleDescription('Нечего импортировать: все строки — дубликаты');
});

test('«Создать новый счёт» недоступен, если в компании уже есть активный счёт с таким названием', async ({ page }) => {
  const cid = await companyWithCash(page, 'Импорт тот же счёт');
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Сейф', currency: 'KZT', openedAt: '2020-01-01' });
  await page.reload();
  await page.getByRole('main').getByRole('button', { name: 'Импортировать' }).click();
  await chooseFile(page, [fr({ paidAt: at('2025-04-01', '10:00:00'), amount: 700, to: 'Касса', category: 'Бар' })]);
  const p = panel(page);
  const cash = p.getByRole('combobox', { name: 'Счёт для «Касса»' });
  await expect(cash).toHaveValue('Касса');
  // выбран другой счёт — подсказка, почему нельзя создать новый «Касса»
  await cash.click();
  const chosen = page.waitForResponse((r) => r.url().endsWith('/imports/preview'));
  await page.getByRole('option', { name: 'Сейф' }).click();
  await chosen;
  await expect(cash).toHaveValue('Сейф');
  await expect(cash).toHaveAccessibleDescription('Счёт с таким названием уже есть — выберите его');
  await cash.click();
  // причина — и в имени недоступного пункта (её слышно в списке)
  const create = page.getByRole('option', { name: 'Создать новый счёт — счёт «Касса» уже есть' });
  await expect(create).toHaveAttribute('aria-disabled', 'true');
  await create.click({ force: true });
  // пункт не выбрался: список открыт, пункт на месте; после Esc значение прежнее
  await expect(create).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(create).toBeHidden();
  await expect(cash).toHaveValue('Сейф');
  await expect(p.getByLabel('Название')).toHaveCount(0);
  // свой счёт снова выбирается, подсказка уходит
  await cash.click();
  await page.getByRole('option', { name: 'Касса', exact: true }).click();
  await expect(cash).toHaveValue('Касса');
  await expect(cash).toHaveAccessibleDescription('');
});

test('панель привязана к компании, где её открыли: «Назад» в другую компанию закрывает её и сбрасывает файл, к импорту другой компании запросов нет', async ({ page }) => {
  const { a, aName, b } = await twoCompanies(page, 'Импорт смена');
  const toB: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes(`/companies/${b}/imports`)) toB.push(r.url());
  });
  await page.getByRole('main').getByRole('button', { name: 'Импортировать' }).click();
  const p = panel(page);
  // название компании — под заголовком панели
  await expect(p.getByText(aName)).toBeVisible();
  await chooseFile(page, ROWS);
  await expect(p.getByRole('heading', { level: 3, name: 'Проверка файла' })).toBeFocused();

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/c/${b}/log$`));
  await expect(p).toBeHidden();
  // в Б панель открывается с чистого листа: без файла и прежнего выбора
  await page.getByRole('main').getByRole('button', { name: 'Импортировать' }).click();
  await expect(p.getByRole('button', { name: 'Выберите файл' })).toBeVisible();
  await expect(p.getByRole('heading', { level: 3, name: 'Проверка файла' })).toHaveCount(0);
  await expect(p.getByText(aName)).toHaveCount(0);
  expect(toB).toEqual([]);
  expect(a).not.toBe(b);
});

test('запись идёт, а «Назад» уводит в другую компанию: панель остаётся с компанией, где её открыли, до «Готово»', async ({ page }) => {
  const { a, aName, b } = await twoCompanies(page, 'Импорт смена запись');
  const toB: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes(`/companies/${b}/imports`)) toB.push(r.url());
  });
  await page.getByRole('main').getByRole('button', { name: 'Импортировать' }).click();
  await chooseFile(page, ROWS);
  const p = panel(page);
  await expect(p.getByRole('heading', { level: 3, name: 'Проверка файла' })).toBeFocused();

  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let committedTo = '';
  await page.route(/\/imports$/, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    committedTo = route.request().url();
    await gate;
    await route.fallback();
  });
  await p.getByRole('button', { name: 'Импортировать' }).click();
  await expect(p.getByRole('button', { name: 'Импортируем…' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/c/${b}/log$`));
  await expect(p).toBeVisible();
  await expect(p.getByText(aName)).toBeVisible();
  release();
  await expect(p.getByRole('heading', { level: 3, name: 'Импорт завершён' })).toBeFocused();
  expect(committedTo).toMatch(new RegExp(`/companies/${a}/imports$`));
  await p.getByRole('button', { name: 'Готово' }).click();
  await expect(p).toBeHidden();
  expect(toB).toEqual([]);
});

test('запись в прежнюю компанию не прошла (409), когда адрес уже другой: только сообщение и «Закрыть», без предпросмотра и запросов', async ({ page }) => {
  const { a, aName, b } = await twoCompanies(page, 'Импорт смена ошибка');
  const imports: string[] = [];
  page.on('request', (r) => {
    if (/\/companies\/\d+\/imports/.test(r.url())) imports.push(r.url());
  });
  await page.getByRole('main').getByRole('button', { name: 'Импортировать' }).click();
  const uploaded = page.waitForResponse((r) => r.url().endsWith('/imports/upload'));
  await chooseFile(page, ROWS);
  const preview: unknown = await (await uploaded).json();
  const p = panel(page);
  await expect(p.getByRole('heading', { level: 3, name: 'Проверка файла' })).toBeFocused();

  // запись задержана и отвечает 409 со свежим предпросмотром — уже после «Назад» в компанию Б
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const changed = 'Данные компании изменились после проверки — посмотрите обновлённый итог и нажмите «Импортировать» ещё раз';
  await page.route(/\/imports$/, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await gate;
    await route.fulfill({ status: 409, json: { error: { code: 'IMPORT_CHANGED', message: changed, details: { preview } } } });
  });
  await p.getByRole('button', { name: 'Импортировать' }).click();
  await expect(p.getByRole('button', { name: 'Импортируем…' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/c/${b}/log$`));
  await expect(p.getByText(aName)).toBeVisible();
  const before = imports.length;
  release();

  const alert = p.getByRole('alert').filter({ hasText: 'не выполнен' });
  await expect(alert).toHaveText(`Импорт в «${aName}» не выполнен: ${changed}`);
  await expect(alert).toBeFocused();
  await expect(p.getByRole('button', { name: /^Импорт/ })).toHaveCount(0);
  await expect(p.getByRole('heading', { level: 3, name: 'Проверка файла' })).toHaveCount(0);
  await expect(p.getByRole('button', { name: 'Выберите файл' })).toHaveCount(0);
  // «Закрыть» в подвале (вторая — ✕ в заголовке)
  await p.getByRole('button', { name: 'Закрыть' }).last().click();
  await expect(p).toBeHidden();
  // запись ушла в А; после ответа 409 — ни повторной загрузки, ни пересчёта: ни к А, ни к Б
  expect(imports[before - 1]).toMatch(new RegExp(`/companies/${a}/imports$`));
  expect(imports.slice(before)).toEqual([]);
  expect(imports.filter((u) => u.includes(`/companies/${b}/`))).toEqual([]);
});

test('во время записи карточки счетов недоступны; после записи — «Импорт завершён», без пересчёта и новой загрузки', async ({ page }) => {
  await companyWithCash(page, 'Импорт карточки');
  await page.getByRole('main').getByRole('button', { name: 'Импортировать' }).click();
  await chooseFile(page, ROWS);
  const p = panel(page);
  await expect(p.getByRole('heading', { level: 3, name: 'Проверка файла' })).toBeFocused();

  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route(/\/imports$/, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await gate;
    await route.fallback();
  });
  const later: string[] = [];
  page.on('request', (r) => {
    if (/\/imports\/(upload|preview)$/.test(r.url())) later.push(r.url());
  });
  await p.getByRole('button', { name: 'Импортировать' }).click();
  await expect(p.getByRole('button', { name: 'Импортируем…' })).toBeVisible();
  const bank = p.getByRole('article', { name: 'Банк-2' });
  await expect(p.getByRole('combobox', { name: 'Счёт для «Касса»' })).toBeDisabled();
  await expect(bank.getByRole('combobox', { name: 'Счёт для «Банк-2»' })).toBeDisabled();
  await expect(bank.getByLabel('Название')).toBeDisabled();
  await expect(bank.getByLabel('Текущий остаток, ₸')).toBeDisabled();
  await expect(bank.getByRole('radio', { name: 'Стартовый баланс' })).toBeDisabled();

  release();
  const done = p.getByRole('heading', { level: 3, name: 'Импорт завершён' });
  await expect(done).toBeFocused();
  // дольше паузы пересчёта (300 мс): итог остаётся, запросов проверки нет
  await page.waitForTimeout(700);
  await expect(done).toBeVisible();
  expect(later).toEqual([]);
});

test('архивная компания: кнопки «Импортировать» нет', async ({ page }) => {
  await login(page);
  // в архив — только компания без активных счетов
  const cid = await createCompany(page, `ТОО Импорт архив ${Date.now()}`);
  await apiPost(page, `/api/v1/companies/${cid}/archive`, {});
  await page.reload();
  await expect(page.getByText('Компания в архиве — изменения недоступны.')).toBeVisible();
  await expect(page.getByRole('main').getByRole('button', { name: 'Импортировать' })).toHaveCount(0);
});
