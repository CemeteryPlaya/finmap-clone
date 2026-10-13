import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { sheetRows } from '../tests/helpers/xlsx-rows';

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

/** Колонки Finmap в порядке по умолчанию (§8.3): названия чипов и заголовков окна. */
const DEFAULT_LABELS = [
  'Дата платежа',
  'Дата начисления',
  'Период начисления (дата "с")',
  'Период начисления (дата "по")',
  'Сумма в валюте счета',
  'Сумма в валюте компании',
  'Со счета',
  'На счет',
  'Категория',
  'Подкатегория',
  'Контрагент',
  'Проект',
  'Теги',
  'Комментарий',
];

/** Компания с «Кассой» и четырьмя операциями в прошлом (инвариант 6: не в будущем): доход, разбитый на две категории доходов, и три расхода. */
async function companyWithOperations(page: Page): Promise<number> {
  await login(page);
  const cid = await createCompany(page, `ТОО Экспорт ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id as number;
  const bar = (await apiPost(page, `${base}/categories`, { kind: 'income', name: 'Бар' })).category.id as number;
  const kitchen = (await apiPost(page, `${base}/categories`, { kind: 'income', name: 'Кухня' })).category.id as number;
  const rent = (await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Аренда' })).category.id as number;
  await apiPost(page, `${base}/operations`, {
    type: 'income',
    accountId: cash,
    amount: 150050,
    paidAt: '2025-03-15T10:00:00Z',
    comment: 'доход',
    lines: [
      { categoryId: bar, projectId: null, amount: 100000 },
      { categoryId: kitchen, projectId: null, amount: 50050 },
    ],
  });
  for (const [i, day] of ['16', '17', '18'].entries()) {
    await apiPost(page, `${base}/operations`, {
      type: 'expense',
      accountId: cash,
      amount: 1000 * (i + 1),
      paidAt: `2025-03-${day}T10:00:00Z`,
      comment: `расход ${i + 1}`,
      lines: [{ categoryId: rent, projectId: null, amount: 1000 * (i + 1) }],
    });
  }
  await page.reload();
  await expect(page.getByRole('table', { name: 'Операции' }).locator('tbody tr')).toHaveCount(4);
  return cid;
}

/** «Ещё» → «Экспорт»: панель с раскрытым разделом «Экспортировать в». */
async function openExportMenu(page: Page) {
  const more = page.getByRole('button', { name: 'Ещё', exact: true });
  await more.click();
  const menu = page.getByRole('dialog', { name: 'Ещё', exact: true });
  const toggle = menu.getByRole('button', { name: 'Экспорт', exact: true });
  await toggle.click();
  return { more, menu, toggle, group: menu.getByRole('group', { name: 'Экспортировать в' }) };
}

const builder = (page: Page) => page.getByRole('dialog', { name: 'Собрать Excel', exact: true });
const headers = (page: Page) => builder(page).getByRole('table', { name: 'Превью файла' }).locator('[data-column-label]');

test('«Ещё» → «Экспорт» → «Экспортировать в» → «Excel»: файл в формате Finmap — имя, заголовки, разбитая операция строками', async ({ page }) => {
  await companyWithOperations(page);
  const { more, menu, toggle, group } = await openExportMenu(page);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(group.getByRole('link', { name: 'Excel', exact: true })).toBeVisible();
  await expect(group.getByRole('button', { name: 'Собрать Excel', exact: true })).toBeVisible();
  // раздел сворачивается тем же значком
  await toggle.click();
  await expect(group).toBeHidden();
  await toggle.click();

  const [download] = await Promise.all([page.waitForEvent('download'), group.getByRole('link', { name: 'Excel', exact: true }).click()]);
  // «{Компания} - Журнал - ДД-ММ-ГГГГ ЧЧ-ММ.xlsx» по часам Алматы
  expect(download.suggestedFilename()).toMatch(/^ТОО Экспорт \d+ - Журнал - \d{2}-\d{2}-\d{4} \d{2}-\d{2}\.xlsx$/);
  const rows = sheetRows(fs.readFileSync(await download.path()));
  expect(rows[0]![0]).toBe('Дата платежа*');
  expect(rows[0]![4]).toBe('Сумма в валюте счета*');
  expect(rows[0]).toHaveLength(16);
  // 3 расхода и доход из двух строк: заголовок + 5 строк; категории доходов — строками
  expect(rows).toHaveLength(6);
  expect(rows.slice(1).map((r) => [r[4], r[6], r[7], r[8], r[15]])).toEqual([
    ['30.00', 'Касса', '', 'Аренда', 'расход 3'],
    ['20.00', 'Касса', '', 'Аренда', 'расход 2'],
    ['10.00', 'Касса', '', 'Аренда', 'расход 1'],
    ['1000.00', '', 'Касса', 'Бар', 'доход'],
    ['500.50', '', 'Касса', 'Кухня', 'доход'],
  ]);
  // панель закрылась после выбора пункта, фокус — на «Ещё»
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();
});

test('«Собрать Excel»: превью, чипы, «Отмена» не меняет набор, «Собрать файл» скачивает и запоминает набор', async ({ page }) => {
  await companyWithOperations(page);
  const prefsResponse = () => page.waitForResponse((r) => r.url().endsWith('/api/v1/preferences/export.columns') && r.request().method() === 'PUT');
  try {
    let { more, menu, group } = await openExportMenu(page);
    await group.getByRole('button', { name: 'Собрать Excel', exact: true }).click();
    // панель закрылась, окно открыто; превью — первые 3 операции в колонках по умолчанию
    await expect(menu).toBeHidden();
    await expect(builder(page)).toBeVisible();
    await expect(headers(page)).toHaveText(DEFAULT_LABELS);
    const preview = builder(page).getByRole('table', { name: 'Превью файла' });
    await expect(preview.locator('tbody tr')).toHaveCount(3);
    await expect(preview.locator('tbody tr').first()).toContainText('Аренда');
    await expect(builder(page).getByText('В файле — все операции по фильтру журнала и строка «Итого».')).toBeVisible();

    // чипы по группам: выключить «Подкатегория» (колонка уходит), включить «Тип» (колонка — в конец)
    const subcategory = builder(page).getByRole('group', { name: 'Категории' }).getByRole('button', { name: 'Подкатегория', exact: true });
    const type = builder(page).getByRole('group', { name: 'Операция' }).getByRole('button', { name: 'Тип', exact: true });
    await expect(subcategory).toHaveAttribute('aria-pressed', 'true');
    await expect(type).toHaveAttribute('aria-pressed', 'false');
    await subcategory.click();
    await type.click();
    await expect(subcategory).toHaveAttribute('aria-pressed', 'false');
    await expect(type).toHaveAttribute('aria-pressed', 'true');
    const chosen = [...DEFAULT_LABELS.filter((l) => l !== 'Подкатегория'), 'Тип'];
    await expect(headers(page)).toHaveText(chosen);
    await expect(builder(page).getByRole('group', { name: 'Остатки и валюты' }).getByRole('button')).toHaveCount(5);

    // «Отмена» закрывает, не сохраняя набор: в следующий раз — по умолчанию; фокус — на «Ещё»
    await builder(page).getByRole('button', { name: 'Отмена', exact: true }).click();
    await expect(builder(page)).toBeHidden();
    await expect(more).toBeFocused();
    ({ more, menu, group } = await openExportMenu(page));
    await group.getByRole('button', { name: 'Собрать Excel', exact: true }).click();
    await expect(headers(page)).toHaveText(DEFAULT_LABELS);
    await builder(page).getByRole('group', { name: 'Категории' }).getByRole('button', { name: 'Подкатегория', exact: true }).click();
    await builder(page).getByRole('group', { name: 'Операция' }).getByRole('button', { name: 'Тип', exact: true }).click();

    // «Собрать файл» — скачивание в выбранных колонках, «Итого» внизу; окно закрывается, набор запоминается
    const saved = prefsResponse();
    const [download] = await Promise.all([page.waitForEvent('download'), builder(page).getByRole('link', { name: 'Собрать файл' }).click()]);
    expect((await saved).ok()).toBe(true);
    expect(download.suggestedFilename()).toMatch(/ - Журнал - \d{2}-\d{2}-\d{4} \d{2}-\d{2}\.xlsx$/);
    const rows = sheetRows(fs.readFileSync(await download.path()));
    expect(rows[0]).toEqual(chosen);
    expect(rows).toHaveLength(1 + 4 + 1); // заголовок, 4 операции (одна строка на операцию), «Итого»
    const sum = chosen.indexOf('Сумма в валюте компании');
    expect(rows.at(-1)![sum]).toBe('1440.50'); // 1500,50 - 10,00 - 20,00 - 30,00
    await expect(builder(page)).toBeHidden();

    // повторное открытие восстанавливает набор и порядок
    ({ more, menu, group } = await openExportMenu(page));
    await group.getByRole('button', { name: 'Собрать Excel', exact: true }).click();
    await expect(headers(page)).toHaveText(chosen);
    await expect(builder(page).getByRole('group', { name: 'Категории' }).getByRole('button', { name: 'Подкатегория', exact: true })).toHaveAttribute('aria-pressed', 'false');

    // без колонок «Собрать файл» недоступна, причина — в описании; щелчок не скачивает
    const pressed = builder(page).locator('button[aria-pressed="true"]');
    while ((await pressed.count()) > 0) await pressed.first().click();
    const link = builder(page).getByRole('link', { name: 'Собрать файл' });
    await expect(link).toHaveAttribute('aria-disabled', 'true');
    await expect(link).toHaveAccessibleDescription('Выберите хотя бы одну колонку.');
    // aria-disabled — не disabled: щелчок возможен (force), но ничего не скачивает и окно остаётся
    await link.click({ force: true });
    await expect(builder(page)).toBeVisible();
    // Esc закрывает окно и возвращает фокус на «Ещё»
    await page.keyboard.press('Escape');
    await expect(builder(page)).toBeHidden();
    await expect(more).toBeFocused();
  } finally {
    // настройка пользователя общая для всех тестов: возвращаем «по умолчанию»
    const res = await page.request.put('/api/v1/preferences/export.columns', { data: { value: null }, headers: csrf(page) });
    expect(res.ok()).toBe(true);
  }
});
