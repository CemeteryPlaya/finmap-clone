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

/** Импорт синтетического файла через API: загрузка, пересчёт с сопоставлениями (если заданы) и запись. */
async function apiImport(page: Page, cid: number, rows: FinmapLikeValue[][], name = 'выгрузка.xlsx', accounts?: unknown[]): Promise<number> {
  const up = await page.request.post(`/api/v1/companies/${cid}/imports/upload`, {
    headers: { ...csrf(page), 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name) },
    data: finmapLikeXlsx(rows),
  });
  expect(up.status(), await up.text()).toBe(200);
  let p = (await up.json()) as { token: string; revision: string };
  if (accounts) p = await apiPost(page, `/api/v1/companies/${cid}/imports/preview`, { token: p.token, accounts });
  const done = await apiPost(page, `/api/v1/companies/${cid}/imports`, { token: p.token, accounts: accounts ?? [], revision: p.revision });
  return done.import.id as number;
}

/** Компания с «Кассой» (открыта 01.01.2020); открыт её журнал. */
async function companyWithCash(page: Page, title: string): Promise<number> {
  await login(page);
  const cid = await createCompany(page, `ТОО ${title} ${Date.now()}`);
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await page.reload();
  return cid;
}

/** Доход и расход на «Кассу», перевод на новый «Банк-2», расход с новыми категорией и контрагентом. */
const ROWS = [
  fr({ paidAt: at('2025-03-15', '10:00:00'), amount: 1500, to: 'Касса', category: 'Бар' }),
  fr({ paidAt: at('2025-03-16', '11:00:00'), amount: 500, from: 'Касса', to: 'Банк-2' }),
  fr({ paidAt: at('2025-03-17', '12:00:00'), amount: 200, from: 'Банк-2', category: 'Связь', counterparty: 'Поставщик Б' }),
];

const history = (page: Page) => page.getByRole('dialog', { name: 'История действий' });
const openHistory = async (page: Page) => {
  await page.getByRole('banner').getByRole('button', { name: 'История действий' }).click();
  await expect(history(page)).toBeVisible();
};

test('«История действий»: вкладки «Журнал | Импорты» — стрелки переключают и переводят фокус; запись импорта; при новом открытии — «Журнал»', async ({ page }) => {
  const cid = await companyWithCash(page, 'История импортов');
  await apiImport(page, cid, ROWS, 'март.xlsx');
  await openHistory(page);
  const tabs = history(page).getByRole('tablist', { name: 'Разделы истории' });
  const log = tabs.getByRole('tab', { name: 'Журнал' });
  const imports = tabs.getByRole('tab', { name: 'Импорты' });
  await expect(log).toHaveAttribute('aria-selected', 'true');
  await expect(imports).toHaveAttribute('aria-selected', 'false');
  // в порядке Tab — только выбранная вкладка
  await expect(log).toHaveAttribute('tabindex', '0');
  await expect(imports).toHaveAttribute('tabindex', '-1');
  await expect(history(page).getByRole('tabpanel', { name: 'Журнал' })).toBeVisible();

  await log.focus();
  await page.keyboard.press('ArrowRight');
  await expect(imports).toBeFocused();
  await expect(imports).toHaveAttribute('aria-selected', 'true');
  const panel = history(page).getByRole('tabpanel', { name: 'Импорты' });
  const item = panel.getByRole('list', { name: 'Импорты' }).getByRole('listitem');
  await expect(item).toHaveCount(1);
  await expect(item.getByText('март.xlsx', { exact: true })).toHaveAttribute('title', 'март.xlsx');
  await expect(item).toContainText('Добавлено 3 операции · пропущено дубликатов 0');
  await expect(item.getByText(/^Админ · \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}:\d{2}$/)).toBeVisible();
  // по кругу: → с последней — на первую, ← с первой — на последнюю
  await page.keyboard.press('ArrowRight');
  await expect(log).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(imports).toBeFocused();
  await page.keyboard.press('Home');
  await expect(log).toBeFocused();
  await expect(log).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(imports).toHaveAttribute('aria-selected', 'true');

  // закрыть и открыть снова — «Журнал»
  await page.keyboard.press('Escape');
  await expect(history(page)).toBeHidden();
  await openHistory(page);
  await expect(history(page).getByRole('tab', { name: 'Журнал' })).toHaveAttribute('aria-selected', 'true');
});

test('«Импорты»: пусто — «Импортов пока не было.»; больше 20 — «Показать ещё» догружает остальные', async ({ page }) => {
  const cid = await companyWithCash(page, 'Много импортов');
  await openHistory(page);
  await history(page).getByRole('tab', { name: 'Импорты' }).click();
  await expect(history(page).getByText('Импортов пока не было.')).toBeVisible();
  await page.keyboard.press('Escape');

  // 21 импорт по одной операции: суммы разные — не дубликаты
  for (let i = 1; i <= 21; i++) await apiImport(page, cid, [fr({ paidAt: at('2025-03-15', '10:00:00'), amount: i, to: 'Касса' })], `файл ${i}.xlsx`);
  await openHistory(page);
  await history(page).getByRole('tab', { name: 'Импорты' }).click();
  const items = history(page).getByRole('list', { name: 'Импорты' }).getByRole('listitem');
  await expect(items).toHaveCount(20);
  await expect(items.first()).toContainText('файл 21.xlsx');
  await history(page).getByRole('button', { name: 'Показать ещё' }).click();
  await expect(items).toHaveCount(21);
  await expect(items.last()).toContainText('файл 1.xlsx');
  // кнопка исчезла — фокус не потерян, а перешёл на первую догруженную запись
  await expect(items.nth(20)).toBeFocused();
  await expect(history(page).getByRole('button', { name: 'Показать ещё' })).toHaveCount(0);
});
