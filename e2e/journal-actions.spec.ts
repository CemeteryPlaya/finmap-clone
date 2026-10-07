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
/** Буквы операций в порядке строк журнала: у каждой операции комментарий «операция X». */
const letters = async (page: Page) => (await bodyRows(page).allInnerTexts()).map((t) => /операция ([A-Z])/.exec(t)?.[1] ?? '?').join('');

test('сохранённые фильтры: сохранить из окна «Фильтр», применить, переименовать, удалить; предупреждение о недоступных условиях', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Сохранённые ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  const shift = (await apiPost(page, `${base}/tags`, { name: 'Смена' })).tag.id;
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: todayAgo(3), accountId: kaspi, amount: 100, tagIds: [shift], comment: 'операция A' });
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(2), accountId: kaspi, amount: 200, comment: 'операция B' });
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: todayAgo(1), accountId: kaspi, amount: 300, comment: 'операция C' });
  await page.reload();
  await expect.poll(() => letters(page)).toBe('CBA');

  const filterButton = page.getByRole('button', { name: /^Фильтр/ });
  const dialog = page.getByRole('dialog', { name: 'Фильтр', exact: true });
  const menuButton = page.getByRole('button', { name: 'Сохранённые фильтры' });

  // период «Сегодня» в тулбаре + доходы в окне → «Сохранить фильтр»
  await page.getByLabel('Период').selectOption({ label: 'Сегодня' });
  await filterButton.click();
  await dialog.getByRole('checkbox', { name: 'Доход' }).check();
  await dialog.getByRole('button', { name: 'Сохранить фильтр' }).click();
  await dialog.getByLabel('Название фильтра').fill('   ');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog.getByLabel('Название фильтра')).toHaveAttribute('aria-invalid', 'true');
  await dialog.getByLabel('Название фильтра').fill('Доходы за день');
  await dialog.getByLabel('Название фильтра').press('Enter');
  await expect(dialog).toBeHidden();
  await expect.poll(() => letters(page)).toBe('CA');

  // применить после сброса: период сохранён датами — «Произвольно»
  await page.getByRole('button', { name: 'Сбросить фильтр' }).click();
  await expect.poll(() => letters(page)).toBe('CBA');
  await menuButton.click();
  await page.getByRole('button', { name: 'Применить фильтр «Доходы за день»' }).click();
  await expect(menuButton).toBeFocused();
  await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}&type=income$/);
  await expect(page.getByLabel('Период')).toHaveValue('custom');
  await expect.poll(() => letters(page)).toBe('CA');

  // переименовать
  await menuButton.click();
  await page.getByRole('button', { name: 'Переименовать фильтр «Доходы за день»' }).click();
  await page.getByLabel('Новое название фильтра «Доходы за день»').fill('Доходы');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  // поле названия исчезло — фокус на переименованном фильтре
  await expect(page.getByRole('button', { name: 'Применить фильтр «Доходы»' })).toBeFocused();
  await page.keyboard.press('Escape');

  // фильтр по тегу; тег уходит в архив — при применении предупреждение, условие отброшено (инвариант 10)
  await page.getByRole('button', { name: 'Сбросить фильтр' }).click();
  await filterButton.click();
  await dialog.getByRole('checkbox', { name: 'Смена' }).check();
  await dialog.getByRole('button', { name: 'Сохранить фильтр' }).click();
  await dialog.getByLabel('Название фильтра').fill('Смены');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(() => letters(page)).toBe('A');
  await apiPost(page, `${base}/tags/${shift}/archive`, {});
  await page.getByRole('button', { name: 'Сбросить фильтр' }).click();
  await page.reload();
  await menuButton.click();
  const shifts = page.getByRole('button', { name: /^Применить фильтр «Смены»/ });
  await expect(shifts).toHaveAccessibleName('Применить фильтр «Смены», 1 условие недоступно');
  await expect(shifts).toContainText('(1 условие недоступно)');
  await shifts.click();
  await expect(page.getByRole('status').filter({ hasText: 'Фильтр «Смены»' })).toHaveText(/1 условие недоступно \(удалены или в архиве\) — они не применены/);
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log$`));
  await expect.poll(() => letters(page)).toBe('CBA');

  // удалить — с подтверждением
  await menuButton.click();
  await page.getByRole('button', { name: 'Удалить фильтр «Смены»' }).click();
  await expect(page.getByRole('button', { name: 'Отмена' })).toBeFocused();
  await page.getByRole('button', { name: 'Да, удалить' }).click();
  // пункт исчез — меню закрыто, фокус на его кнопке
  await expect(menuButton).toBeFocused();
  await menuButton.click();
  await expect(shifts).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Применить фильтр «Доходы»' })).toBeVisible();
});

test('ошибка журнала, затем новый поиск: тулбар остаётся на месте, поле поиска не теряет фокус', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Сбой ${Date.now()}`);
  const kaspi = (await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `/api/v1/companies/${cid}/operations`, { type: 'income', paidAt: todayAgo(2), accountId: kaspi, amount: 100, comment: 'операция A' });
  await apiPost(page, `/api/v1/companies/${cid}/operations`, { type: 'income', paidAt: todayAgo(1), accountId: kaspi, amount: 200, comment: 'операция B' });

  // журнал отвечает ошибкой (400 — без повторов запроса): ошибка под тулбаром
  const journalUrl = /\/api\/v1\/companies\/\d+\/operations\?/;
  await page.route(journalUrl, (route) =>
    route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 'VALIDATION', message: 'Сбой журнала для теста' } }) }),
  );
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Сбой журнала для теста');
  await page.unroute(journalUrl);

  // поиск уходит в адрес — у нового запроса ещё нет ни данных, ни ошибки; тулбар не пропадает, ввод продолжается
  const search = page.getByLabel('Поиск');
  await search.fill('опер');
  await expect(page).toHaveURL(/q=/);
  await expect(search).toBeFocused();
  await search.pressSequentially('ация A');
  await expect(search).toHaveValue('операция A');
  await expect.poll(() => letters(page)).toBe('A');
  await expect(search).toBeFocused();
});
