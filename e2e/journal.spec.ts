import { expect, test, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('Логин').fill('admin');
  await page.getByPlaceholder('Пароль').fill('e2e-password-1');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible();
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

/** Начало сегодняшнего дня по Алматы — APP_TIMEZONE e2e-сервера (с 01.03.2024 — UTC+5). */
function startOfTodayAlmaty(): number {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date());
  return Date.parse(`${day}T00:00:00+05:00`);
}

/**
 * Момент «сегодня по Алматы»: чем больше n (0 < n < 1000), тем раньше, но всегда сегодня и не в будущем
 * (инвариант 6) — проверки «сегодня» и периода не падают сразу после полуночи.
 */
const todayAgo = (n: number) => {
  const start = startOfTodayAlmaty();
  return new Date(start + (Date.now() - start) * (1 - n / 1000)).toISOString();
};

/** Вчера в полдень по Алматы. */
const yesterdayNoon = () => new Date(startOfTodayAlmaty() - 12 * 3600_000).toISOString();

const table = (page: Page) => page.getByRole('table', { name: 'Операции' });
const bodyRows = (page: Page) => table(page).locator('tbody tr');
const panel = (page: Page) => page.getByRole('navigation', { name: 'Счета' });

test('сценарий 3 §10: доход, расход на два проекта, перевод KZT → USD — балансы в панели и остатки в журнале', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Сценарий ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const north = (await apiPost(page, `${base}/projects`, { name: 'Клуб Север', templateKey: 'general' })).project.id;
  const south = (await apiPost(page, `${base}/projects`, { name: 'Клуб Юг', templateKey: 'general' })).project.id;
  const revenue = (await apiPost(page, `${base}/categories`, { kind: 'income', name: 'Выручка' })).category.id;
  const rent = (await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Аренда' })).category.id;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 100000 })).account.id;
  const usd = (await apiPost(page, `${base}/accounts`, { name: 'Валютный', currency: 'USD', openedAt: '2020-01-01' })).account.id;
  // курс компании, чтобы доллары вошли в «Всего на счетах» (ручной курс общий для всех e2e — его не трогаем)
  await apiPost(page, `${base}/fixed-rates`, { currency: 'USD', rate: '500', validFrom: '2020-01-01' });

  await apiPost(page, `${base}/operations`, {
    type: 'income',
    paidAt: todayAgo(3),
    accountId: cash,
    amount: 50000,
    lines: [{ categoryId: revenue, projectId: north, amount: 50000 }],
  });
  await apiPost(page, `${base}/operations`, {
    type: 'expense',
    paidAt: todayAgo(2),
    accountId: cash,
    amount: 30000,
    lines: [
      { categoryId: rent, projectId: north, amount: 10000 },
      { categoryId: rent, projectId: south, amount: 20000 },
    ],
  });
  await apiPost(page, `${base}/operations`, { type: 'transfer', paidAt: todayAgo(1), accountId: cash, amount: 50000, toAccountId: usd, toAmount: 100 });

  await page.reload();
  // левая панель: 1000 + 500 - 300 - 500 = 700 ₸; $1 по курсу 500 — итог 1200 ₸
  await expect(panel(page).getByRole('link', { name: /^Касса/ })).toContainText(/700,00\s₸/);
  await expect(panel(page).getByRole('link', { name: /^Валютный/ })).toContainText(/1,00\s\$/);
  await expect(panel(page)).toContainText(/Всего на счетах\s*1\s200,00\s₸/);

  // журнал: новые сверху, у каждой строки — остаток после операции по своему счёту
  await expect(bodyRows(page)).toHaveCount(3);
  const [transfer, expense, income] = [bodyRows(page).nth(0), bodyRows(page).nth(1), bodyRows(page).nth(2)];
  await expect(transfer).toContainText(/500,00\s₸/);
  await expect(transfer).toContainText(/→ 1,00\s\$/);
  await expect(transfer).toContainText(/Касса\s*остаток 700,00\s₸/);
  await expect(transfer).toContainText(/Валютный\s*остаток 1,00\s\$/);
  await expect(expense).toContainText(/\u2212300,00\s₸/);
  await expect(expense).toContainText(/остаток 1\s200,00\s₸/);
  await expect(expense).toContainText('Аренда');
  await expect(expense).toContainText('2 проекта');
  await expect(income).toContainText(/\+500,00\s₸/);
  await expect(income).toContainText(/остаток 1\s500,00\s₸/);
  await expect(income).toContainText('Выручка');
  await expect(income).toContainText('Клуб Север');
  await expect(income.locator('time')).toContainText('сегодня');

  // подсказка разбиения — при наведении и при фокусе с клавиатуры
  await expense.getByText('2 проекта').hover();
  await expect(page.getByRole('tooltip')).toContainText(/Аренда · Клуб Юг — 200,00\s₸/);
  await expense.getByText('2 проекта').focus();
  await expect(expense.getByText('2 проекта')).toHaveAccessibleDescription(/Аренда · Клуб Север — 100,00\s₸/);
  await expect(page.getByRole('tooltip')).toBeVisible();
  // Esc прячет подсказку, фокус остаётся (WCAG 1.4.13)
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(expense.getByText('2 проекта')).toBeFocused();
});

test('клик по счёту в левой панели фильтрует журнал; бесконечная прокрутка; сортировка по сумме', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Прокрутка ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Наличные', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  for (let i = 1; i <= 55; i++) {
    await apiPost(page, `${base}/operations`, { type: 'income', paidAt: todayAgo(200 - i), accountId: kaspi, amount: i * 100 });
  }
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(1), accountId: cash, amount: 9900 });

  await page.reload();
  // первая страница — 50 операций; прокрутка вниз догружает остальные
  await expect(bodyRows(page)).toHaveCount(50);
  await page.getByRole('button', { name: 'Показать ещё' }).scrollIntoViewIfNeeded();
  await expect(bodyRows(page)).toHaveCount(56);
  await expect(page.getByRole('button', { name: 'Показать ещё' })).toHaveCount(0);

  await panel(page).getByRole('link', { name: /^Наличные/ }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log\\?account=${cash}$`));
  await expect(bodyRows(page)).toHaveCount(1);
  await expect(bodyRows(page).first()).toContainText(/\u221299,00\s₸/);

  await panel(page).getByRole('link', { name: /^Kaspi/ }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log\\?account=${kaspi}$`));
  await expect(bodyRows(page)).toHaveCount(50);
  // по дате новые сверху: последняя внесённая — 55,00 ₸
  await expect(bodyRows(page).first()).toContainText(/\+55,00\s₸/);

  // сортировка по сумме: по возрастанию, затем по убыванию; фильтр по счёту сохраняется, адрес — тоже
  const amountHeader = table(page).getByRole('columnheader', { name: /Сумма/ });
  await amountHeader.getByRole('button').click();
  await expect(amountHeader).toHaveAttribute('aria-sort', 'descending');
  await expect(bodyRows(page).first()).toContainText(/\+55,00\s₸/);
  await amountHeader.getByRole('button').click();
  await expect(amountHeader).toHaveAttribute('aria-sort', 'ascending');
  await expect(bodyRows(page).first()).toContainText(/\+1,00\s₸/);
  await expect(page).toHaveURL(new RegExp(`account=${kaspi}&sort=amount&order=asc$`));
  await page.reload();
  await expect(bodyRows(page).first()).toContainText(/\+1,00\s₸/);
  await expect(table(page).getByRole('columnheader', { name: /Дата/ })).not.toHaveAttribute('aria-sort', /.+/);
});

test('тулбар: поиск с паузой, период, сумма от/до в базовой валюте, выгрузка по фильтру, сброс; фильтр переживает перезагрузку', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Тулбар ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  const dollars = (await apiPost(page, `${base}/accounts`, { name: 'Доллары', currency: 'USD', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `${base}/fixed-rates`, { currency: 'USD', rate: '500', validFrom: '2020-01-01' });
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: todayAgo(5), accountId: kaspi, amount: 150000, comment: 'Ёлка в зале' });
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: yesterdayNoon(), accountId: kaspi, amount: 30000, comment: 'Аренда за октябрь' });
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(3), accountId: dollars, amount: 200 });

  await page.reload();
  await expect(bodyRows(page)).toHaveCount(3);
  // валюта счёта не базовая — под суммой сумма в тенге: $2 × 500 = 1000 ₸
  await expect(bodyRows(page).filter({ hasText: /\u22122,00\s\$/ })).toContainText(/1\s000,00\s₸/);

  // поиск — без учёта регистра и «ё», запрос уходит после паузы и попадает в адрес
  await page.getByLabel('Поиск').fill('ЕЛКА');
  await expect(page).toHaveURL(/q=%D0%95%D0%9B%D0%9A%D0%90$/);
  await expect(bodyRows(page)).toHaveCount(1);
  await expect(bodyRows(page).first()).toContainText('Ёлка в зале');
  await page.reload();
  await expect(page.getByLabel('Поиск')).toHaveValue('ЕЛКА');
  await expect(bodyRows(page)).toHaveCount(1);
  await page.getByLabel('Поиск').fill('');
  await expect(bodyRows(page)).toHaveCount(3);

  // поиск, набранный прямо перед сменой периода, не затирает период (Review Focus 1)
  await page.getByLabel('Поиск').fill('аренда');
  await page.getByLabel('Период').selectOption({ label: 'Вчера' });
  await expect(page).toHaveURL(/period=yesterday&q=%D0%B0%D1%80%D0%B5%D0%BD%D0%B4%D0%B0$/);
  await expect(bodyRows(page)).toHaveCount(1);
  await page.getByLabel('Поиск').fill('');
  await expect(page).toHaveURL(/period=yesterday$/);

  // период — по календарной дате в APP_TIMEZONE
  await page.getByLabel('Период').selectOption({ label: 'Вчера' });
  await expect(page).toHaveURL(/period=yesterday$/);
  await expect(bodyRows(page)).toHaveCount(1);
  await expect(bodyRows(page).first()).toContainText('Аренда за октябрь');
  await expect(bodyRows(page).first().locator('time')).toContainText('вчера');
  await page.getByLabel('Период').selectOption({ label: 'Сегодня' });
  await expect(bodyRows(page)).toHaveCount(2);
  // «Произвольно» начинается с границ выбранного периода
  await page.getByLabel('Период').selectOption({ label: 'Произвольно' });
  const from = await page.getByLabel('С', { exact: true }).inputValue();
  expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByLabel('По', { exact: true })).toHaveValue(from);
  await expect(bodyRows(page)).toHaveCount(2);
  // дата границы применяется по Enter или уходу из поля, а не на каждую набранную цифру
  const yesterday = yesterdayNoon().slice(0, 10);
  await page.getByLabel('С', { exact: true }).fill(yesterday);
  await page.getByLabel('С', { exact: true }).press('Enter');
  await expect(page).toHaveURL(new RegExp(`from=${yesterday}&to=${from}$`));
  await expect(bodyRows(page)).toHaveCount(3);
  await page.getByLabel('Период').selectOption({ label: 'Всё время' });
  await expect(bodyRows(page)).toHaveCount(3);

  // сумма от/до — в базовой валюте компании (по сумме в тенге)
  await page.getByLabel('Сумма от, ₸').fill('1 000');
  await page.getByLabel('Сумма от, ₸').press('Enter');
  await expect(bodyRows(page)).toHaveCount(2);
  await expect(page.getByLabel('Сумма от, ₸')).toHaveValue('1000');
  await page.getByLabel('Сумма до, ₸').fill('1200,5');
  await page.getByLabel('Сумма до, ₸').blur();
  await expect(bodyRows(page)).toHaveCount(1);
  await expect(page).toHaveURL(/min=100000&max=120050$/);
  await page.getByLabel('Сумма до, ₸').fill('abc');
  await page.getByLabel('Сумма до, ₸').blur();
  await expect(page.getByLabel('Сумма до, ₸')).toHaveAttribute('aria-invalid', 'true');
  await expect(bodyRows(page)).toHaveCount(1);

  // выгрузка — по текущему фильтру; ссылка отдаёт книгу Excel
  const href = await page.getByRole('link', { name: 'Выгрузить в Excel' }).getAttribute('href');
  expect(href).toContain(`/api/v1/companies/${cid}/operations/export.xlsx?`);
  expect(href).toContain('amountMin=100000&amountMax=120050');
  const xlsx = await page.request.get(href!);
  expect(xlsx.status()).toBe(200);
  expect(xlsx.headers()['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

  await page.getByRole('button', { name: 'Сбросить фильтр' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log$`));
  await expect(bodyRows(page)).toHaveCount(3);
  await expect(page.getByLabel('Сумма от, ₸')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Сбросить фильтр' })).toHaveCount(0);

  // адрес, исправленный руками: мусор отбрасывается, журнал открывается (Review Focus 2)
  await page.goto(`/c/${cid}/log?account=abc&type=bogus&from=2026-13-01&min=-5&sort=name`);
  await expect(bodyRows(page)).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Сбросить фильтр' })).toHaveCount(0);
});
