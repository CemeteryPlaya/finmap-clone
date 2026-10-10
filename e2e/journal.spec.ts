import { expect, test, type Page } from '@playwright/test';

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
  await expect(panel(page).getByRole('link', { name: /^Касса/ })).toContainText(/₸\s700$/);
  await expect(panel(page).getByRole('link', { name: /^Валютный/ })).toContainText(/\$\s1$/);
  await expect(panel(page)).toContainText(/Всего на счетах\s*₸\s1\s200(?![\s\d])/);

  // журнал: новые сверху, у каждой строки — остаток после операции по своему счёту
  await expect(bodyRows(page)).toHaveCount(3);
  const [transfer, expense, income] = [bodyRows(page).nth(0), bodyRows(page).nth(1), bodyRows(page).nth(2)];
  await expect(transfer).toContainText(/500\s₸/);
  await expect(transfer).toContainText(/→ 1\s\$/);
  await expect(transfer).toContainText(/Касса\s*остаток 700\s₸/);
  await expect(transfer).toContainText(/Валютный\s*остаток 1\s\$/);
  await expect(expense).toContainText(/\u2212300\s₸/);
  await expect(expense).toContainText(/остаток 1\s200\s₸/);
  await expect(expense).toContainText('Аренда');
  await expect(expense).toContainText('2 проекта');
  await expect(income).toContainText(/\+500\s₸/);
  await expect(income).toContainText(/остаток 1\s500\s₸/);
  await expect(income).toContainText('Выручка');
  await expect(income).toContainText('Клуб Север');
  await expect(income.locator('time')).toContainText('сегодня');

  // подсказка разбиения — при наведении и при фокусе с клавиатуры
  await expense.getByText('2 проекта').hover();
  await expect(page.getByRole('tooltip')).toContainText(/Аренда · Клуб Юг — 200\s₸/);
  await expense.getByText('2 проекта').focus();
  await expect(expense.getByText('2 проекта')).toHaveAccessibleDescription(/Аренда · Клуб Север — 100\s₸/);
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
  await expect(bodyRows(page).first()).toContainText(/\u221299\s₸/);

  await panel(page).getByRole('link', { name: /^Kaspi/ }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log\\?account=${kaspi}$`));
  await expect(bodyRows(page)).toHaveCount(50);
  // по дате новые сверху: последняя внесённая — 55 ₸
  await expect(bodyRows(page).first()).toContainText(/\+55\s₸/);

  // сортировка по сумме: по возрастанию, затем по убыванию; фильтр по счёту сохраняется, адрес — тоже
  const amountHeader = table(page).getByRole('columnheader', { name: /Сумма/ });
  await amountHeader.getByRole('button').click();
  await expect(amountHeader).toHaveAttribute('aria-sort', 'descending');
  await expect(bodyRows(page).first()).toContainText(/\+55\s₸/);
  await amountHeader.getByRole('button').click();
  await expect(amountHeader).toHaveAttribute('aria-sort', 'ascending');
  await expect(bodyRows(page).first()).toContainText(/\+1\s₸/);
  await expect(page).toHaveURL(new RegExp(`account=${kaspi}&sort=amount&order=asc$`));
  await page.reload();
  await expect(bodyRows(page).first()).toContainText(/\+1\s₸/);
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
  await expect(bodyRows(page).filter({ hasText: /\u22122\s\$/ })).toContainText(/1\s000\s₸/);

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

  // период — меню у пилюли (§5.1 этапа 1.5): пункты Finmap «За …», наши «За сегодня» и «За вчера»
  const periodButton = page.getByRole('button', { name: /^Период:/ });
  const periodMenu = page.getByRole('dialog', { name: 'Период', exact: true });
  const choosePeriod = async (label: string) => {
    await periodButton.click();
    await periodMenu.getByRole('button', { name: label, exact: true }).click();
    await expect(periodMenu).toBeHidden();
    await expect(periodButton).toBeFocused();
  };
  await expect(periodButton).toHaveAccessibleName('Период: За все время');
  await periodButton.click();
  await expect(periodMenu.getByRole('button')).toHaveText([
    'За текущий год',
    'За предыдущий год',
    'За текущую неделю',
    'За прошлую неделю',
    'За текущий месяц',
    'За прошлый месяц',
    /^За все время/,
    'За сегодня',
    'За вчера',
    'Выбрать даты',
  ]);
  await expect(periodMenu.getByRole('button', { name: 'За все время', exact: true })).toHaveAttribute('aria-current', 'true');
  await expect(periodMenu.getByRole('button', { name: 'За текущий год', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(periodMenu).toBeHidden();
  await expect(periodButton).toBeFocused();

  // поиск, набранный прямо перед сменой периода, не затирает период (Review Focus 1 плана 5b)
  await page.getByLabel('Поиск').fill('аренда');
  await choosePeriod('За вчера');
  await expect(page).toHaveURL(/period=yesterday&q=%D0%B0%D1%80%D0%B5%D0%BD%D0%B4%D0%B0$/);
  await expect(bodyRows(page)).toHaveCount(1);
  await page.getByLabel('Поиск').fill('');
  await expect(page).toHaveURL(/period=yesterday$/);

  // период — по календарной дате в APP_TIMEZONE
  await expect(bodyRows(page)).toHaveCount(1);
  await expect(bodyRows(page).first()).toContainText('Аренда за октябрь');
  await expect(bodyRows(page).first().locator('time')).toContainText('вчера');
  await expect(periodButton).toHaveAccessibleName('Период: За вчера');
  await choosePeriod('За сегодня');
  await expect(bodyRows(page)).toHaveCount(2);
  // «За предыдущий год» — новый пункт; операций за прошлый год нет
  await choosePeriod('За предыдущий год');
  await expect(page).toHaveURL(/period=lastYear$/);
  await expect(page.getByText('По этому фильтру операций нет.')).toBeVisible();
  await choosePeriod('За сегодня');
  await expect(bodyRows(page)).toHaveCount(2);

  // «Выбрать даты» начинается с границ выбранного периода; день выбирается в календаре с клавиатуры
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date());
  const yesterday = yesterdayNoon().slice(0, 10);
  const ru = (d: string) => d.split('-').reverse().join('.');
  await periodButton.click();
  await periodMenu.getByRole('button', { name: 'Выбрать даты' }).click();
  const fromButton = periodMenu.getByRole('button', { name: /^С:/ });
  await expect(fromButton).toBeFocused();
  await expect(fromButton).toHaveAccessibleName(`С: ${ru(today)}`);
  await expect(periodMenu.getByRole('button', { name: /^По:/ })).toHaveAccessibleName(`По: ${ru(today)}`);
  await fromButton.click();
  const calendar = page.getByRole('dialog', { name: 'С: календарь' });
  await expect(calendar.getByRole('grid')).toBeVisible();
  const activeDay = calendar.locator('[role="gridcell"][tabindex="0"]');
  await expect(activeDay).toBeFocused();
  await expect(activeDay).toHaveAttribute('aria-selected', 'true');
  // Esc в календаре закрывает только его: меню периода остаётся, фокус — на поле «С» (Review Focus 6)
  await page.keyboard.press('Escape');
  await expect(calendar).toBeHidden();
  await expect(periodMenu).toBeVisible();
  await expect(fromButton).toBeFocused();
  // Tab с последнего элемента календаря (активный день) закрывает тоже только календарь: края Tab меню периода
  // считаются по его собственным элементам, без элементов вложенной панели
  await fromButton.click();
  await expect(activeDay).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(calendar).toBeHidden();
  await expect(periodMenu).toBeVisible();
  await expect(fromButton).toBeFocused();
  await fromButton.click();
  await expect(activeDay).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await expect(calendar).toBeHidden();
  await expect(fromButton).toHaveAccessibleName(`С: ${ru(yesterday)}`);
  await expect(fromButton).toBeFocused();
  await periodMenu.getByRole('button', { name: 'Применить' }).click();
  await expect(page).toHaveURL(new RegExp(`from=${yesterday}&to=${today}$`));
  await expect(periodButton).toHaveAccessibleName(`Период: ${ru(yesterday)} – ${ru(today)}`);
  await expect(bodyRows(page)).toHaveCount(3);
  await choosePeriod('За все время');
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log$`));
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

test('колонки: выбор сохраняется в настройках пользователя и переживает перезагрузку; дату и сумму не скрыть', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Колонки ${Date.now()}`);
  const kaspi = (await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `/api/v1/companies/${cid}/operations`, { type: 'income', paidAt: todayAgo(1), accountId: kaspi, amount: 100, comment: 'Видимый комментарий' });
  await page.reload();
  const header = (name: string) => table(page).getByRole('columnheader', { name, exact: true });
  await expect(header('Комментарий')).toBeVisible();

  // настройка общая для пользователя admin и остальных e2e: после теста все колонки снова видны
  try {
    const columns = page.getByRole('button', { name: 'Колонки', exact: true });
    await columns.click();
    await expect(columns).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('checkbox', { name: 'Дата' })).toBeDisabled();
    // фокус — на первом доступном флажке
    await expect(page.getByRole('checkbox', { name: 'Счёт' })).toBeFocused();
    // панель — в портале, но порядок Tab не рвётся: Shift+Tab с первого флажка ведёт на кнопку, Tab с кнопки — обратно в панель
    await page.keyboard.press('Shift+Tab');
    await expect(columns).toBeFocused();
    await expect(columns).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('checkbox', { name: 'Счёт' })).toBeFocused();
    // Esc с кнопки (фокус вернулся на неё Shift+Tab) тоже закрывает панель, фокус остаётся на кнопке
    await page.keyboard.press('Shift+Tab');
    await expect(columns).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(columns).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('checkbox', { name: 'Счёт' })).toBeHidden();
    await expect(columns).toBeFocused();
    await columns.click();
    await expect(columns).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('checkbox', { name: 'Счёт' })).toBeFocused();
    const saved = page.waitForResponse((r) => r.url().endsWith('/api/v1/preferences/journal.columns') && r.request().method() === 'PUT');
    await page.getByRole('checkbox', { name: 'Комментарий', exact: true }).uncheck();
    await saved;
    await expect(header('Комментарий')).toHaveCount(0);
    await expect(table(page)).not.toContainText('Видимый комментарий');
    // Esc закрывает панель и возвращает фокус на кнопку
    await page.keyboard.press('Escape');
    await expect(columns).toHaveAttribute('aria-expanded', 'false');
    await expect(columns).toBeFocused();

    // Tab за последним элементом панели закрывает её и возвращает фокус на кнопку
    await columns.click();
    await expect(columns).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('checkbox', { name: 'Комментарий', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(columns).toHaveAttribute('aria-expanded', 'false');
    await expect(columns).toBeFocused();

    // фокус, ушедший за пределы кнопки и панели, закрывает панель
    await columns.click();
    await expect(columns).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('heading', { name: 'Журнал' }).focus();
    await expect(columns).toHaveAttribute('aria-expanded', 'false');

    await page.reload();
    await expect(header('Счёт')).toBeVisible();
    await expect(header('Комментарий')).toHaveCount(0);
  } finally {
    await page.request.put('/api/v1/preferences/journal.columns', { data: { value: null }, headers: csrf(page) });
  }
  await page.reload();
  await expect(header('Комментарий')).toBeVisible();
});

test('модалка «Фильтр»: все условия §6, «Готово» применяет, Esc закрывает без изменений; счёт из левой панели отмечен', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Фильтр ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Наличные', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  const room = (await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Помещение' })).category.id;
  const utilities = (await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Коммуналка', parentId: room })).category.id;
  const club = (await apiPost(page, `${base}/projects`, { name: 'Клуб 1', templateKey: 'general' })).project.id;
  const supplier = (await apiPost(page, `${base}/counterparties`, { name: 'ИП Поставщик', type: 'supplier' })).counterparty.id;
  await apiPost(page, `${base}/counterparties`, { name: 'ТОО Арендодатель', type: 'supplier' });
  const tag = (await apiPost(page, `${base}/tags`, { name: 'Смена' })).tag.id;
  await apiPost(page, `${base}/operations`, {
    type: 'expense',
    paidAt: todayAgo(4),
    accountId: kaspi,
    amount: 100,
    counterpartyId: supplier,
    comment: 'операция A',
    lines: [{ categoryId: utilities, projectId: club, amount: 100 }],
  });
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(3), accountId: cash, amount: 200, comment: 'операция B' });
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: todayAgo(2), accountId: kaspi, amount: 300, tagIds: [tag], comment: 'операция C' });
  await apiPost(page, `${base}/operations`, { type: 'transfer', paidAt: todayAgo(1), accountId: kaspi, toAccountId: cash, amount: 400, comment: 'операция D' });
  const comments = async () => (await table(page).locator('tbody tr').allInnerTexts()).map((t) => /операция ([A-D])/.exec(t)?.[1]).join('');

  await page.reload();
  await expect(bodyRows(page)).toHaveCount(4);
  const filterButton = page.getByRole('button', { name: /^Фильтр/ });
  const dialog = page.getByRole('dialog', { name: 'Фильтр', exact: true });

  // тип и родительская категория (включает дочернюю)
  await filterButton.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('checkbox', { name: 'Расход' }).check();
  await dialog.getByRole('checkbox', { name: 'Помещение' }).check();
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await expect(dialog).toBeHidden();
  await expect(filterButton).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`type=expense&category=${room}$`));
  await expect(filterButton).toHaveText('Фильтр · 2');
  await expect.poll(comments).toBe('A');

  // «Без категории» — вместе с выбранной категорией через ИЛИ
  await filterButton.click();
  await expect(dialog.getByRole('checkbox', { name: 'Расход' })).toBeChecked();
  await dialog.getByRole('checkbox', { name: 'Без категории' }).check();
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await expect.poll(comments).toBe('BA');

  // Esc закрывает без изменений
  await filterButton.click();
  await dialog.getByRole('checkbox', { name: 'Перевод' }).check();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(filterButton).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`type=expense&category=${room}&noCategory=1$`));

  // «Очистить», поиск контрагента, тег, «Без проекта»
  await filterButton.click();
  await dialog.getByRole('button', { name: 'Очистить' }).click();
  await dialog.getByLabel('Найти контрагента').fill('постав');
  await expect(dialog.getByRole('checkbox', { name: 'ТОО Арендодатель' })).toHaveCount(0);
  await dialog.getByLabel('Найти контрагента').press('Enter'); // Enter в поиске не применяет фильтр
  await expect(dialog).toBeVisible();
  await dialog.getByRole('checkbox', { name: 'ИП Поставщик' }).check();
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await expect(page).toHaveURL(new RegExp(`counterparty=${supplier}$`));
  await expect.poll(comments).toBe('A');
  await filterButton.click();
  await dialog.getByRole('button', { name: 'Очистить' }).click();
  await dialog.getByRole('checkbox', { name: 'Смена' }).check();
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await expect.poll(comments).toBe('C');
  await filterButton.click();
  await dialog.getByRole('button', { name: 'Очистить' }).click();
  await dialog.getByRole('checkbox', { name: 'Без проекта' }).check();
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await expect.poll(comments).toBe('DCB');

  // счёт из левой панели — отмечен в модалке, его можно снять
  await panel(page).getByRole('link', { name: /^Наличные/ }).click();
  await expect.poll(comments).toBe('DB');
  await expect(filterButton).toHaveText('Фильтр · 1');
  await filterButton.click();
  await expect(dialog.getByRole('checkbox', { name: 'Наличные' })).toBeChecked();
  await dialog.getByRole('checkbox', { name: 'Наличные' }).uncheck();
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log$`));
  await expect(bodyRows(page)).toHaveCount(4);
});

test('«Готово» в окне «Фильтр» не затирает поиск, дошедший до адреса, пока окно было открыто', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Поиск и фильтр ${Date.now()}`);
  const kaspi = (await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `/api/v1/companies/${cid}/operations`, { type: 'income', paidAt: todayAgo(1), accountId: kaspi, amount: 100, comment: 'аренда зала' });
  await page.reload();
  await expect(bodyRows(page)).toHaveCount(1);

  const search = page.getByRole('searchbox', { name: 'Поиск' });
  const dialog = page.getByRole('dialog', { name: 'Фильтр', exact: true });
  // окно открывается раньше, чем истекает пауза поиска (300 мс): запрос доходит до адреса при открытом окне
  await search.fill('аренда');
  await page.getByRole('button', { name: /^Фильтр/ }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('checkbox', { name: 'Доход' }).check();
  await expect(page).toHaveURL(/q=/);
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/q=/);
  await expect(page).toHaveURL(/type=income/);
  await expect(search).toHaveValue('аренда');
});
