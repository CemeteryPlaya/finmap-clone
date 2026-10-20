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
  const account = (row: Locator) => row.locator('[data-column="account"]');
  await expect(table(page).getByRole('columnheader', { name: 'Счёт/остаток', exact: true })).toBeVisible();
  await expect(transfer).toContainText(/500\s₸/);
  await expect(transfer).toContainText(/→ 1\s\$/);
  // «Счёт/остаток» (§5.2 этапа 1.5): у перевода оба счёта и оба остатка, слова «остаток» нет
  await expect(account(transfer)).toContainText('Касса → Валютный');
  await expect(account(transfer)).toContainText(/700\s₸\s*→\s*1\s\$/);
  await expect(expense).toContainText(/\u2212300\s₸/);
  await expect(account(expense)).toContainText(/1\s200\s₸/);
  await expect(expense).toContainText('Аренда');
  await expect(expense).toContainText('2 проекта');
  await expect(income).toContainText(/\+500\s₸/);
  await expect(account(income)).toContainText(/1\s500\s₸/);
  await expect(income).toContainText('Выручка');
  await expect(income).toContainText('Клуб Север');
  // в заголовке «Счёт/остаток» слово есть — проверяем только строки
  await expect(table(page).locator('tbody')).not.toContainText('остаток');
  // дата в две строки: «4 окт. 2026», ниже «Сегодня 10:32»
  await expect(income.locator('time')).toHaveText(/^\d{1,2} [а-я]+\.? \d{4}Сегодня \d{2}:\d{2}$/);
  // строки одной высоты (§5.2)
  const heights = await bodyRows(page).evaluateAll((rows) => rows.map((r) => Math.round(r.getBoundingClientRect().height)));
  // у последней строки нет нижней границы — допуск 1 px
  expect(Math.max(...heights) - Math.min(...heights), heights.join()).toBeLessThanOrEqual(1);

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

  // счёт в фильтре подсвечен; повторное нажатие снимает фильтр по нему, сортировка остаётся
  const kaspiLink = panel(page).getByRole('link', { name: /^Kaspi/ });
  await expect(kaspiLink).toHaveAttribute('aria-current', 'true');
  await expect(panel(page).getByRole('link', { name: /^Наличные/ })).not.toHaveAttribute('aria-current', /.*/);
  await kaspiLink.click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log\\?sort=amount&order=asc$`));
  await expect(kaspiLink).not.toHaveAttribute('aria-current', /.*/);
  await expect(bodyRows(page)).toHaveCount(50);
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
  // лупа справа от поля применяет запрос сразу
  await page.getByLabel('Поиск').fill('ёлка в');
  await page.getByRole('button', { name: 'Найти' }).click();
  await expect(page).toHaveURL(/q=%D1%91%D0%BB%D0%BA%D0%B0\+%D0%B2$/);
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
  // фокус при открытии — на текущем пункте (замечание 6)
  await expect(periodMenu.getByRole('button', { name: 'За все время', exact: true })).toBeFocused();
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
  await expect(bodyRows(page).first().locator('time')).toContainText(/Вчера \d{2}:\d{2}/);
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

  // сумма от/до — в меню «Ещё», в базовой валюте компании (по сумме в тенге)
  const more = page.getByRole('button', { name: 'Ещё', exact: true });
  const moreMenu = page.getByRole('dialog', { name: 'Ещё', exact: true });
  await more.click();
  await expect(moreMenu.getByLabel('Сумма от')).toBeFocused();
  await moreMenu.getByLabel('Сумма от').fill('1 000');
  await moreMenu.getByLabel('Сумма от').press('Enter');
  await expect(bodyRows(page)).toHaveCount(2);
  await expect(moreMenu.getByLabel('Сумма от')).toHaveValue('1000');
  await moreMenu.getByLabel('Сумма до').fill('1200,5');
  await moreMenu.getByLabel('Сумма до').blur();
  await expect(bodyRows(page)).toHaveCount(1);
  await expect(page).toHaveURL(/min=100000&max=120050$/);
  // буквы не вводятся вовсе; остаётся одинокий разделитель — не число
  await moreMenu.getByLabel('Сумма до').fill('abc');
  await expect(moreMenu.getByLabel('Сумма до')).toHaveValue('');
  await moreMenu.getByLabel('Сумма до').fill(',');
  await moreMenu.getByLabel('Сумма до').blur();
  await expect(moreMenu.getByLabel('Сумма до')).toHaveAttribute('aria-invalid', 'true');
  await expect(moreMenu.getByLabel('Сумма до')).toHaveAccessibleDescription('Введите сумму');
  await expect(bodyRows(page)).toHaveCount(1);

  // выгрузка — по текущему фильтру: «Экспорт» раскрывает «Экспортировать в» с пунктом «Excel» — ссылкой на книгу Finmap
  await moreMenu.getByRole('button', { name: 'Экспорт', exact: true }).click();
  const href = await moreMenu.getByRole('link', { name: 'Excel', exact: true }).getAttribute('href');
  expect(href).toContain(`/api/v1/companies/${cid}/operations/export.xlsx?`);
  expect(href).toContain('amountMin=100000&amountMax=120050');
  expect(href).toContain('format=finmap');
  const xlsx = await page.request.get(href!);
  expect(xlsx.status()).toBe(200);
  expect(xlsx.headers()['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

  // набранная без Enter сумма применяется и тогда, когда меню закрыли щелчком мимо (Review Focus 3)
  await moreMenu.getByLabel('Сумма до').fill('2000');
  await panel(page).getByText('Всего на счетах').click();
  await expect(moreMenu).toBeHidden();
  await expect(page).toHaveURL(/min=100000&max=200000$/);
  await expect(bodyRows(page)).toHaveCount(2);

  // заданная сумма видна у закрытой кнопки: «Ещё · N» по числу границ, в имени — тоже (H2 финала 1.5-2a)
  const moreWithAmount = page.getByRole('button', { name: /^Ещё · 2/ });
  await expect(moreWithAmount).toHaveText('Ещё · 2 ▾');
  await expect(moreWithAmount).toHaveAccessibleName('Ещё · 2, задана сумма');
  // Esc отменяет набранную, но не применённую сумму; щелчок мимо и Tab — применяют (замечание 3)
  await moreWithAmount.click();
  await moreMenu.getByLabel('Сумма до').fill('3000');
  await page.keyboard.press('Escape');
  await expect(moreMenu).toBeHidden();
  await expect(moreWithAmount).toBeFocused();
  await expect(page).toHaveURL(/min=100000&max=200000$/);
  await moreWithAmount.click();
  await expect(moreMenu.getByLabel('Сумма до')).toHaveValue('2000');
  await page.keyboard.press('Escape');
  // стрелка ▾ перевёрнута только у открытой панели
  const caret = moreWithAmount.locator('span[aria-hidden="true"]');
  await expect(caret).toHaveCSS('rotate', 'none');
  await moreWithAmount.click();
  await expect(caret).toHaveCSS('rotate', '180deg');
  await page.keyboard.press('Escape');

  // «Сбросить фильтр» — ✕ рядом с «Фильтр»
  await page.getByRole('button', { name: 'Сбросить фильтр' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log$`));
  await expect(bodyRows(page)).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Сбросить фильтр' })).toHaveCount(0);
  await more.click();
  await expect(moreMenu.getByLabel('Сумма от')).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();

  // адрес, исправленный руками: мусор отбрасывается, журнал открывается (Review Focus 2)
  await page.goto(`/c/${cid}/log?account=abc&type=bogus&from=2026-13-01&min=-5&sort=name`);
  await expect(bodyRows(page)).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Сбросить фильтр' })).toHaveCount(0);
});

test('«Ещё»: суммы, ⟳, колонки и выгрузка в одной панели; Tab и Esc как у всех панелей; выбор колонок сохраняется в настройках пользователя', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Колонки ${Date.now()}`);
  const kaspi = (await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `/api/v1/companies/${cid}/operations`, { type: 'income', paidAt: todayAgo(1), accountId: kaspi, amount: 100, accrualDate: '2026-09-01', comment: 'Видимый комментарий' });
  // системная категория «Инвестиции» — с бейджем «системная» (§5.2)
  const tree = (await (await page.request.get(`/api/v1/companies/${cid}/categories`)).json()) as { income: { id: number; systemKey: string | null }[] };
  const investment = tree.income.find((c) => c.systemKey === 'investment')!.id;
  await apiPost(page, `/api/v1/companies/${cid}/operations`, { type: 'income', paidAt: todayAgo(2), accountId: kaspi, amount: 200, lines: [{ categoryId: investment, amount: 200 }], comment: 'вклад' });
  const longComment = 'Длинный комментарий для проверки переноса строк в журнале. '.repeat(8).trim();
  await apiPost(page, `/api/v1/companies/${cid}/operations`, { type: 'income', paidAt: todayAgo(3), accountId: kaspi, amount: 300, comment: longComment });
  await page.reload();
  const header = (name: string) => table(page).getByRole('columnheader', { name, exact: true });
  await expect(header('Комментарий')).toBeVisible();
  // «Счёт/остаток»; «Дата сделки» без настройки выключена (§5.3, Review Focus 5)
  await expect(header('Счёт/остаток')).toBeVisible();
  await expect(header('Дата сделки')).toHaveCount(0);
  // бейдж «системная» — у системной категории
  const investmentCategory = bodyRows(page).filter({ hasText: 'вклад' }).locator('[data-column="category"]');
  await expect(investmentCategory).toContainText('Инвестиции');
  await expect(investmentCategory).toContainText('системная');
  // стрелка сортировки — только у активной колонки; «↕» у «Суммы» скрыта до наведения
  await expect(table(page).getByRole('columnheader', { name: /Дата/ }).first().locator('[aria-hidden="true"]')).toHaveText('↓');
  await expect(table(page).getByRole('columnheader', { name: /Сумма/ }).locator('[aria-hidden="true"]')).toHaveCSS('opacity', '0');
  const more = page.getByRole('button', { name: 'Ещё', exact: true });
  const menu = page.getByRole('dialog', { name: 'Ещё', exact: true });
  const before = (await (await page.request.get('/api/v1/preferences')).json()).preferences as Record<string, unknown>;

  // настройка общая для пользователя admin и остальных e2e: в конце — прежнее значение
  try {
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    // фокус — на первом поле панели
    const amountFrom = menu.getByLabel('Сумма от');
    await expect(amountFrom).toBeFocused();
    // панель — в портале, но порядок Tab не рвётся: Shift+Tab с первого поля ведёт на кнопку, Tab с кнопки — обратно в панель
    await page.keyboard.press('Shift+Tab');
    await expect(more).toBeFocused();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Tab');
    await expect(amountFrom).toBeFocused();
    // Esc с кнопки (фокус вернулся на неё Shift+Tab) тоже закрывает панель, фокус остаётся на кнопке
    await page.keyboard.press('Shift+Tab');
    await expect(more).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeHidden();
    await expect(more).toBeFocused();

    // ▥ «Колонки» раскрывает список в той же панели; дату и сумму не скрыть
    await more.click();
    const columns = menu.getByRole('button', { name: 'Колонки', exact: true });
    await expect(columns).toHaveAttribute('aria-expanded', 'false');
    await columns.click();
    await expect(columns).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.getByRole('checkbox', { name: 'Дата', exact: true })).toBeDisabled();
    await expect(menu.getByRole('checkbox', { name: 'Сумма', exact: true })).toBeDisabled();
    // «Дата сделки» включается здесь же и встаёт третьей колонкой
    const accrualSaved = page.waitForResponse((r) => r.url().endsWith('/api/v1/preferences/journal.columns') && r.request().method() === 'PUT');
    await menu.getByRole('checkbox', { name: 'Дата сделки' }).check();
    await accrualSaved;
    await expect(table(page).getByRole('columnheader').nth(3)).toHaveText('Дата сделки');
    await expect(bodyRows(page).filter({ hasText: 'Видимый комментарий' }).locator('[data-column="accrualDate"]')).toHaveText('1 сент. 2026');
    // «Показывать полностью»: длинный текст — до двух строк вместо одной (§5.2). Проверяем высоту, а не только класс:
    // класс без действующего display: -webkit-box ничего не обрезает
    const comment = bodyRows(page).filter({ hasText: 'Длинный комментарий' }).locator('[data-column="comment"] [title]');
    const lineHeight = await comment.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
    expect((await comment.boundingBox())!.height).toBeLessThanOrEqual(lineHeight + 1);
    const wrapSaved = page.waitForResponse((r) => r.url().endsWith('/api/v1/preferences/journal.wrap') && r.request().method() === 'PUT');
    await menu.getByRole('checkbox', { name: 'Показывать полностью' }).check();
    await wrapSaved;
    await expect.poll(async () => (await comment.boundingBox())!.height).toBeGreaterThan(lineHeight * 1.5);
    expect((await comment.boundingBox())!.height).toBeLessThanOrEqual(lineHeight * 2 + 1);
    // display: Chromium новых версий отдаёт -webkit-box с line-clamp как flow-root, поэтому смотрим на действие обрезки
    await expect(comment).toHaveCSS('display', /^(-webkit-box|flow-root)$/);
    await expect(comment).toHaveCSS('overflow', 'hidden');
    expect(await comment.evaluate((el) => getComputedStyle(el).webkitLineClamp)).toBe('2');
    expect(await comment.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    // строки по-прежнему одной высоты (у последней нет нижней границы — допуск 1 px)
    const heights = await bodyRows(page).evaluateAll((rows) => rows.map((r) => Math.round(r.getBoundingClientRect().height)));
    expect(Math.max(...heights) - Math.min(...heights), heights.join()).toBeLessThanOrEqual(1);
    const saved = page.waitForResponse((r) => r.url().endsWith('/api/v1/preferences/journal.columns') && r.request().method() === 'PUT');
    await menu.getByRole('checkbox', { name: 'Комментарий', exact: true }).uncheck();
    await saved;
    await expect(header('Комментарий')).toHaveCount(0);
    await expect(table(page)).not.toContainText('Видимый комментарий');
    // Esc закрывает панель и возвращает фокус на кнопку
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(more).toBeFocused();

    // Tab за последним элементом панели (ссылка «Настройки журнала») закрывает её и возвращает фокус на кнопку
    await more.click();
    await columns.click();
    await menu.getByRole('link', { name: 'Настройки журнала' }).focus();
    await page.keyboard.press('Tab');
    await expect(menu).toBeHidden();
    await expect(more).toBeFocused();

    // фокус, ушедший за пределы кнопки и панели, закрывает панель
    await more.click();
    await expect(menu).toBeVisible();
    await page.getByRole('heading', { name: 'Журнал' }).focus();
    await expect(menu).toBeHidden();

    // «Настройки журнала» — страница настроек, фокус на её заголовке; выбор колонок уже там
    await more.click();
    await columns.click();
    await menu.getByRole('link', { name: 'Настройки журнала' }).click();
    await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/journal$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Настройки журнала' })).toBeFocused();
    await expect(page.getByRole('checkbox', { name: 'Комментарий', exact: true })).not.toBeChecked();

    await page.goto(`/c/${cid}/log`);
    await expect(header('Счёт/остаток')).toBeVisible();
    await expect(header('Дата сделки')).toBeVisible();
    await expect(header('Комментарий')).toHaveCount(0);
  } finally {
    await page.request.put('/api/v1/preferences/journal.columns', { data: { value: before['journal.columns'] ?? null }, headers: csrf(page) });
    await page.request.put('/api/v1/preferences/journal.wrap', { data: { value: before['journal.wrap'] ?? null }, headers: csrf(page) });
  }
  await page.reload();
  await expect(header('Комментарий')).toBeVisible();
  await expect(bodyRows(page).first().locator('[data-column="account"] [title]')).toHaveClass(/truncate/);
});

test('«Ещё» → ⟳ «Обновить»: операция с другого компьютера появляется, загруженные страницы и прокрутка сохраняются, балансы обновляются (§2.5)', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Обновить ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  for (let i = 1; i <= 55; i++) {
    await apiPost(page, `${base}/operations`, { type: 'income', paidAt: todayAgo(200 - i), accountId: kaspi, amount: 100, comment: `строка ${i}` });
  }
  await page.reload();
  await expect(bodyRows(page)).toHaveCount(50);
  await page.getByRole('button', { name: 'Показать ещё' }).scrollIntoViewIfNeeded();
  await expect(bodyRows(page)).toHaveCount(55);
  const kaspiLink = panel(page).getByRole('link', { name: /^Kaspi/ });
  await expect(kaspiLink).toContainText(/₸\s55$/);

  // операцию внесли «с другого компьютера»: журнал сам не перезапрашивается
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: todayAgo(1), accountId: kaspi, amount: 4500, comment: 'с другого компьютера' });
  await page.evaluate(() => window.scrollTo(0, 0));
  const more = page.getByRole('button', { name: 'Ещё', exact: true });
  const menu = page.getByRole('dialog', { name: 'Ещё', exact: true });
  await more.click();
  await expect(menu).toBeVisible();
  await expect(bodyRows(page)).toHaveCount(55);
  // страницу прокрутили вниз при открытом меню; ⟳ нажимаем без прокрутки к нему (dispatchEvent не прокручивает)
  await page.evaluate(() => window.scrollTo(0, 900));
  const y = await page.evaluate(() => window.scrollY);
  expect(y).toBeGreaterThan(0);
  await menu.getByRole('button', { name: 'Обновить' }).dispatchEvent('click');
  await expect(menu.getByRole('status')).toHaveText('Журнал обновлён');
  // обе загруженные страницы перечитаны: 55 + 1, новая — сверху (Review Focus 4)
  await expect(bodyRows(page)).toHaveCount(56);
  await expect(bodyRows(page).first()).toContainText('с другого компьютера');
  // прокрутка не сброшена к началу; браузер может сдвинуть её на строку, чтобы видимое не уехало (scroll anchoring)
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - y)).toBeLessThanOrEqual(100);
  await expect(kaspiLink).toContainText(/₸\s100$/);
});

test('окно «Фильтры»: мультивыборы в порядке Finmap, «Готово» применяет, Esc и «×» закрывают без изменений; счёт из левой панели отмечен; недоступный id снимается', async ({ page }) => {
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
  const dialog = page.getByRole('dialog', { name: 'Фильтры', exact: true });
  const field = (label: string) => dialog.getByRole('button', { name: new RegExp(`^${label}`) });
  const panelOf = (label: string) => dialog.getByRole('dialog', { name: label, exact: true });
  const done = async () => {
    await dialog.getByRole('button', { name: 'Готово' }).click();
    await expect(dialog).toBeHidden();
  };

  // поля в порядке Finmap; «Отмены» нет — закрывает «×»
  await filterButton.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('button[aria-haspopup="dialog"]')).toHaveText([/^Типы платежей и категории/, /^Контрагенты/, /^Проекты/, /^Теги/, /^Счета/]);
  await expect(dialog.getByRole('button', { name: 'Отмена' })).toHaveCount(0);
  await expect(field('Проекты')).toHaveAccessibleName('Проекты: Все проекты');

  // тип и родительская категория (включает дочернюю) — в одном поле; счётчик в подписи
  await field('Типы платежей и категории').click();
  const types = panelOf('Типы платежей и категории');
  await expect(types.getByRole('group', { name: 'Тип' })).toBeVisible();
  await types.getByRole('checkbox', { name: 'Расход', exact: true }).check();
  await types.getByRole('checkbox', { name: 'Помещение', exact: true }).check();
  await expect(field('Типы платежей и категории')).toHaveAccessibleName('Типы платежей и категории (2): Расход, Помещение');
  // Esc закрывает только список, окно остаётся
  await page.keyboard.press('Escape');
  await expect(types).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(field('Типы платежей и категории')).toBeFocused();
  await done();
  await expect(filterButton).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`type=expense&category=${room}$`));
  await expect(filterButton).toHaveText('Фильтр · 2');
  await expect.poll(comments).toBe('A');

  // «Без категории» — вместе с выбранной категорией через ИЛИ
  await filterButton.click();
  await field('Типы платежей и категории').click();
  await expect(types.getByRole('checkbox', { name: 'Расход', exact: true })).toBeChecked();
  await types.getByRole('checkbox', { name: 'Без категории' }).check();
  await page.keyboard.press('Escape');
  await done();
  await expect.poll(comments).toBe('BA');

  // Esc закрывает без изменений; «×» — тоже
  await filterButton.click();
  await field('Типы платежей и категории').click();
  await types.getByRole('checkbox', { name: 'Перевод', exact: true }).check();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(filterButton).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`type=expense&category=${room}&noCategory=1$`));
  await filterButton.click();
  await field('Типы платежей и категории').click();
  await types.getByRole('checkbox', { name: 'Перевод', exact: true }).check();
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`type=expense&category=${room}&noCategory=1$`));

  // «Очистить», поиск контрагента («Без контрагента» — первым пунктом), тег, «Без проекта»
  await filterButton.click();
  await dialog.getByRole('button', { name: 'Очистить' }).click();
  await field('Контрагенты').click();
  const counterparties = panelOf('Контрагенты');
  await expect(counterparties.getByRole('checkbox').first()).toHaveAccessibleName('Без контрагента');
  await counterparties.getByLabel('Контрагенты: поиск').fill('постав');
  await expect(counterparties.getByRole('checkbox', { name: 'ТОО Арендодатель' })).toHaveCount(0);
  await counterparties.getByLabel('Контрагенты: поиск').press('Enter'); // Enter в поиске не применяет фильтр
  await expect(dialog).toBeVisible();
  await counterparties.getByRole('checkbox', { name: 'ИП Поставщик' }).check();
  await page.keyboard.press('Escape');
  await done();
  await expect(page).toHaveURL(new RegExp(`counterparty=${supplier}$`));
  await expect.poll(comments).toBe('A');
  await filterButton.click();
  await dialog.getByRole('button', { name: 'Очистить' }).click();
  await field('Теги').click();
  await panelOf('Теги').getByRole('checkbox', { name: 'Смена' }).check();
  await page.keyboard.press('Escape');
  await done();
  await expect.poll(comments).toBe('C');
  await filterButton.click();
  await dialog.getByRole('button', { name: 'Очистить' }).click();
  await field('Проекты').click();
  const projects = panelOf('Проекты');
  await expect(projects.getByRole('checkbox').first()).toHaveAccessibleName('Без проекта');
  await projects.getByRole('checkbox', { name: 'Без проекта' }).check();
  await page.keyboard.press('Escape');
  await done();
  await expect.poll(comments).toBe('DCB');

  // счёт из левой панели — отмечен в окне, его можно снять
  await panel(page).getByRole('link', { name: /^Наличные/ }).click();
  await expect.poll(comments).toBe('DB');
  await expect(filterButton).toHaveText('Фильтр · 1');
  await filterButton.click();
  await expect(field('Счета')).toHaveAccessibleName('Счета (1): Наличные');
  await field('Счета').click();
  await expect(panelOf('Счета').getByRole('checkbox', { name: 'Наличные' })).toBeChecked();
  await panelOf('Счета').getByRole('checkbox', { name: 'Наличные' }).uncheck();
  await page.keyboard.press('Escape');
  await done();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log$`));
  await expect(bodyRows(page)).toHaveCount(4);

  // id из адреса, которого нет в справочниках, — «Недоступный элемент»: отмечен, его можно снять (5b №5, Review Focus 5)
  await page.goto(`/c/${cid}/log?project=999999`);
  await expect(page.getByText('По этому фильтру операций нет.')).toBeVisible();
  await filterButton.click();
  await expect(field('Проекты')).toHaveAccessibleName('Проекты (1): Недоступный элемент');
  await field('Проекты').click();
  await expect(projects.getByRole('checkbox', { name: 'Недоступный элемент' })).toBeChecked();
  // пункт исчезает из списка сразу после снятия, поэтому click, а не uncheck (тот ждёт нового состояния у уже убранного флажка)
  await projects.getByRole('checkbox', { name: 'Недоступный элемент' }).click();
  await expect(projects.getByRole('checkbox', { name: 'Недоступный элемент' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await done();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log$`));
  await expect(bodyRows(page)).toHaveCount(4);
});

test('«Готово» в окне «Фильтры» не затирает поиск, дошедший до адреса, пока окно было открыто', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Поиск и фильтр ${Date.now()}`);
  const kaspi = (await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `/api/v1/companies/${cid}/operations`, { type: 'income', paidAt: todayAgo(1), accountId: kaspi, amount: 100, comment: 'аренда зала' });
  await page.reload();
  await expect(bodyRows(page)).toHaveCount(1);

  const search = page.getByRole('searchbox', { name: 'Поиск' });
  const dialog = page.getByRole('dialog', { name: 'Фильтры', exact: true });
  // окно открывается раньше, чем истекает пауза поиска (300 мс): запрос доходит до адреса при открытом окне
  await search.fill('аренда');
  await page.getByRole('button', { name: /^Фильтр/ }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /^Типы платежей и категории/ }).click();
  await dialog.getByRole('checkbox', { name: 'Доход', exact: true }).check();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/q=/);
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/q=/);
  await expect(page).toHaveURL(/type=income/);
  await expect(search).toHaveValue('аренда');
});

test('таблица помещается по ширине на 1440 px: все колонки по умолчанию видны без горизонтальной прокрутки, длинный текст обрезан с подсказкой (H1 финала 1.5-2a)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  const cid = await createCompany(page, `ТОО Ширина ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const account = (await apiPost(page, `${base}/accounts`, { name: 'Основной расчётный счёт в банке для клуба на Абая', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 5000000 })).account.id;
  const category = (await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Очень длинное название категории расходов клуба' })).category.id;
  const project = (await apiPost(page, `${base}/projects`, { name: 'Очень длинное название проекта на Абая', templateKey: 'general' })).project.id;
  const counterparty = (await apiPost(page, `${base}/counterparties`, { name: 'ТОО Поставщик с очень длинным названием для проверки', type: 'supplier' })).counterparty.id;
  const comment = 'Длинный комментарий оператора, который должен обрезаться в одну строку и остаться доступным в подсказке. '.repeat(3).trim();
  await apiPost(page, `${base}/operations`, {
    type: 'expense',
    paidAt: todayAgo(1),
    accountId: account,
    counterpartyId: counterparty,
    amount: 123456789,
    lines: [{ categoryId: category, projectId: project, amount: 123456789 }],
    comment,
  });
  await page.reload();
  await expect(bodyRows(page)).toHaveCount(1);

  const header = table(page).getByRole('columnheader', { name: 'Комментарий', exact: true });
  await expect(header).toBeVisible();
  const wrapper = table(page).locator('xpath=..');
  const widths = await wrapper.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  expect(widths.scroll, JSON.stringify(widths)).toBeLessThanOrEqual(widths.client + 1);
  const box = (await header.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(1440);
  // комментарий виден хотя бы частично и обрезан одной строкой с полной подсказкой
  const cell = bodyRows(page).first().locator('[data-column="comment"] [title]');
  await expect(cell).toHaveAttribute('title', comment);
  await expect(cell).toHaveClass(/truncate/);
  expect((await cell.boundingBox())!.width).toBeGreaterThan(60);
  // каждая ячейка обрезает текст у себя, а не раздвигает таблицу
  const fits = await bodyRows(page)
    .first()
    .locator('td[data-column]')
    .evaluateAll((tds) => tds.map((td) => td.scrollWidth <= td.clientWidth + 1));
  expect(fits.every(Boolean), fits.join()).toBe(true);
});

test('⟳ «Обновить»: сбой перечитывания журнала показан в панели «Ещё»', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Сбой обновления ${Date.now()}`);
  const kaspi = (await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `/api/v1/companies/${cid}/operations`, { type: 'income', paidAt: todayAgo(1), accountId: kaspi, amount: 100, comment: 'до сбоя' });
  await page.reload();
  await expect(bodyRows(page)).toHaveCount(1);

  // первый запрос журнала после нажатия ⟳ отвечает ошибкой 400 (её не повторяют), остальные идут как обычно
  let fail = false;
  await page.route(new RegExp(`/api/v1/companies/${cid}/operations\\?`), async (route) => {
    if (fail) {
      fail = false;
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Сбой для проверки' }) });
      return;
    }
    await route.fallback();
  });
  const more = page.getByRole('button', { name: 'Ещё', exact: true });
  const menu = page.getByRole('dialog', { name: 'Ещё', exact: true });
  await more.click();
  fail = true;
  await menu.getByRole('button', { name: 'Обновить' }).click();
  await expect(menu.getByRole('status')).toHaveText('Не удалось обновить журнал');
  await expect(bodyRows(page)).toHaveCount(1);
  // повторное нажатие проходит
  await menu.getByRole('button', { name: 'Обновить' }).click();
  await expect(menu.getByRole('status')).toHaveText('Журнал обновлён');
});

test('самая высокая строка: перевод между валютами с суммой в базовой и «Показывать полностью» на двустрочном счёте — строки одной высоты, содержимое не обрезано', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  const cid = await createCompany(page, `ТОО Высокая строка ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const usd = (await apiPost(page, `${base}/accounts`, { name: 'Валютный счёт основного зала клуба на первом этаже', currency: 'USD', openedAt: '2020-01-01', startingBalance: 1000 })).account.id;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса клуба северного филиала на втором этаже', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `${base}/fixed-rates`, { currency: 'USD', rate: '500', validFrom: '2020-01-01' });
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: todayAgo(3), accountId: cash, amount: 1000, comment: 'обычная' });
  await apiPost(page, `${base}/operations`, { type: 'transfer', paidAt: todayAgo(1), accountId: usd, toAccountId: cash, amount: 100, toAmount: 50000 });
  const before = (await (await page.request.get('/api/v1/preferences')).json()).preferences as Record<string, unknown>;
  try {
    await page.request.put('/api/v1/preferences/journal.wrap', { data: { value: true }, headers: csrf(page) });
    await page.reload();
    await expect(bodyRows(page)).toHaveCount(2);
    const transfer = bodyRows(page).first();
    // в ячейке суммы несколько строк: сумма, «→ в валюте получателя» и сумма в базовой валюте
    await expect(transfer.locator('[data-column="amount"]')).toContainText(/→/);
    const heights = await bodyRows(page).evaluateAll((rows) => rows.map((r) => Math.round(r.getBoundingClientRect().height)));
    expect(Math.max(...heights) - Math.min(...heights), heights.join()).toBeLessThanOrEqual(1);
    // содержимое каждой ячейки умещается в строку
    const overflow = await transfer.evaluate((row) => {
      const r = row.getBoundingClientRect();
      return Array.from(row.querySelectorAll('td > *')).filter((el) => {
        const b = el.getBoundingClientRect();
        return b.height > 0 && (b.top < r.top - 1 || b.bottom > r.bottom + 1);
      }).length;
    });
    expect(overflow).toBe(0);
    // название счёта занимает две строки: перенос действует
    const name = transfer.locator('[data-column="account"] [title]');
    const lineHeight = await name.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
    expect((await name.boundingBox())!.height).toBeGreaterThan(lineHeight * 1.5);
  } finally {
    await page.request.put('/api/v1/preferences/journal.wrap', { data: { value: before['journal.wrap'] ?? null }, headers: csrf(page) });
  }
});

test('окно «Фильтры»: щелчок по тексту пункта отмечает его, по заголовку группы и пустому месту — список остаётся открытым', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Текст пункта ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' });
  await apiPost(page, `${base}/tags`, { name: 'Смена' });
  for (let i = 1; i <= 30; i++) await apiPost(page, `${base}/tags`, { name: `Тег ${String(i).padStart(2, '0')}` });
  await page.reload();
  await page.getByRole('button', { name: /^Фильтр/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Фильтры', exact: true });
  const panelOf = (label: string) => dialog.getByRole('dialog', { name: label, exact: true });

  // полоса прокрутки длинного списка: нажатие и перетаскивание не закрывают панель
  await dialog.getByRole('button', { name: /^Теги/ }).click();
  const longTags = panelOf('Теги');
  const scroller = longTags.locator('.overflow-y-auto');
  await expect.poll(() => scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  const sb = (await scroller.boundingBox())!;
  await page.mouse.move(sb.x + sb.width - 4, sb.y + 20);
  await page.mouse.down();
  await page.mouse.move(sb.x + sb.width - 4, sb.y + sb.height - 20, { steps: 5 });
  await page.mouse.up();
  await expect(longTags).toBeVisible();
  await page.keyboard.press('Escape');

  // текст пункта: флажок отмечается, список остаётся
  await dialog.getByRole('button', { name: /^Теги/ }).click();
  const tags = panelOf('Теги');
  await tags.getByText('Смена', { exact: true }).click();
  await expect(tags).toBeVisible();
  await expect(tags.getByRole('checkbox', { name: 'Смена' })).toBeChecked();
  await tags.getByText('Смена', { exact: true }).click();
  await expect(tags.getByRole('checkbox', { name: 'Смена' })).not.toBeChecked();
  await page.keyboard.press('Escape');

  // заголовок группы и пустое место внутри панели
  await dialog.getByRole('button', { name: /^Типы платежей и категории/ }).click();
  const types = panelOf('Типы платежей и категории');
  await types.getByText('Тип', { exact: true }).click();
  await expect(types).toBeVisible();
  const box = (await types.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + 4); // отступ панели над поиском
  await expect(types).toBeVisible();
  await types.getByText('Расход', { exact: true }).click();
  await expect(types.getByRole('checkbox', { name: 'Расход', exact: true })).toBeChecked();
  await expect(types).toBeVisible();
  // щелчок за пределами панели, но внутри окна, по-прежнему закрывает её
  await dialog.getByRole('heading', { name: 'Фильтры' }).click();
  await expect(types).toBeHidden();
});
