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
  // обе панели в разметке, неактивная — hidden: aria-controls каждой вкладки указывает на существующую панель
  for (const [tab, selected] of [[log, true], [imports, false]] as const) {
    const controls = await tab.getAttribute('aria-controls');
    const tabpanel = history(page).locator(`[id="${controls}"]`);
    await expect(tabpanel).toHaveCount(1);
    await expect(tabpanel).toHaveAttribute('role', 'tabpanel');
    await expect(tabpanel).toHaveAttribute('aria-labelledby', (await tab.getAttribute('id'))!);
    if (selected) await expect(tabpanel).not.toHaveAttribute('hidden');
    else await expect(tabpanel).toHaveAttribute('hidden', '');
  }

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

const panel = (page: Page) => page.getByRole('dialog', { name: 'Импорт из Excel' });
const confirmDialog = (page: Page) => page.getByRole('alertdialog', { name: 'Отменить импорт?' });
/** Кнопка «Отменить» записи импорта: доступное имя называет файл и момент импорта. */
const undoButton = (page: Page, file: string) =>
  history(page).getByRole('button', { name: new RegExp(`^Отменить импорт «${file}» от \\d{2}\\.\\d{2}\\.\\d{4}, \\d{2}:\\d{2}$`) });

/**
 * Следит за живыми областями панели «История действий»: каждый новый текст `role=status` и `role=alert` — вместе с тем,
 * открыто ли в этот момент подтверждение (модальный `<dialog>` делает остальную страницу инертной, R11).
 */
async function watchLiveRegions(page: Page) {
  await page.evaluate(() => {
    const log: { role: string; text: string; modal: boolean }[] = [];
    (window as unknown as { __live: typeof log }).__live = log;
    const last = new Map<string, string>();
    new MutationObserver(() => {
      const modal = document.querySelector('dialog[role="alertdialog"][open]') !== null;
      for (const role of ['status', 'alert']) {
        const el = document.querySelector(`dialog[open] [role="tabpanel"] [role="${role}"]`);
        const text = el?.textContent ?? '';
        if (text && text !== last.get(role)) log.push({ role, text, modal });
        last.set(role, text);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  });
  return () => page.evaluate(() => (window as unknown as { __live: { role: string; text: string; modal: boolean }[] }).__live);
}

test('«Отменить»: «Импорт завершён» подсказывает, где отменить; «Не отменять | Отменить импорт» → итог в живой области, «Отменён», журнал пуст, «Банк-2» удалён', async ({ page }) => {
  await companyWithCash(page, 'Отмена импорта');
  await page.getByRole('main').getByRole('button', { name: 'Импортировать' }).click();
  await panel(page)
    .locator('[data-import-file]')
    .setInputFiles({ name: 'выгрузка.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: finmapLikeXlsx(ROWS) });
  await expect(panel(page).getByRole('heading', { level: 3, name: 'Проверка файла' })).toBeFocused();
  await panel(page).getByRole('button', { name: 'Импортировать' }).click();
  await expect(panel(page).getByRole('heading', { level: 3, name: 'Импорт завершён' })).toBeFocused();
  await expect(panel(page).getByText('Отменить импорт можно в «Истории действий» → «Импорты»')).toBeVisible();
  await panel(page).getByRole('button', { name: 'Готово' }).click();
  await expect(page.getByRole('table', { name: 'Операции' }).locator('tbody tr')).toHaveCount(3);

  await openHistory(page);
  await history(page).getByRole('tab', { name: 'Импорты' }).click();
  const undo = undoButton(page, 'выгрузка.xlsx');
  await expect(undo).toHaveText('Отменить');
  await undo.click();
  const dialog = confirmDialog(page);
  await expect(dialog).toHaveAccessibleDescription(
    'Будут удалены 3 операции из файла «выгрузка.xlsx», а также созданные импортом счета, категории, контрагенты, проекты и теги, если они больше нигде не используются.',
  );
  // изменённых нет — флажка нет; слева «Не отменять» (фокус), справа «Отменить импорт»
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Не отменять' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(history(page)).toBeVisible();
  await expect(undo).toBeFocused();

  await undo.click();
  const live = await watchLiveRegions(page);
  const done = page.waitForResponse((r) => /\/imports\/\d+\/undo$/.test(r.url()));
  await confirmDialog(page).getByRole('button', { name: 'Отменить импорт' }).click();
  expect((await done).status()).toBe(200);
  const result = 'Импорт отменён: удалено 3 операции, 1 счёт, 2 категории, 1 контрагент.';
  await expect(history(page).getByRole('status')).toHaveText(result);
  // итог появился, когда подтверждение уже закрылось: страница не инертна, программа чтения его объявит
  expect(await live()).toEqual([{ role: 'status', text: result, modal: false }]);
  const item = history(page).getByRole('list', { name: 'Импорты' }).getByRole('listitem');
  await expect(item).toContainText(/Отменён \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2} \(Админ\)/);
  // «Отменить» исчезла вместе с подтверждением — фокус на вкладке «Импорты»
  await expect(undo).toHaveCount(0);
  await expect(history(page).getByRole('tab', { name: 'Импорты' })).toBeFocused();
  // «Журнал» и обратно: вкладка «Импорты» не монтируется заново — итог на месте
  await page.keyboard.press('ArrowLeft');
  await expect(history(page).getByRole('tab', { name: 'Журнал' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(history(page).getByRole('status')).toHaveText(result);
  await expect(history(page).getByRole('tabpanel', { name: 'Импорты' }).locator('p[aria-hidden="true"]', { hasText: result })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByText('Операций пока нет.')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Счета' }).getByRole('link', { name: /^Банк-2/ })).toHaveCount(0);
});

test('изменённая после импорта операция: текст и флажок «Удалить и изменённые (1)»; без флажка она остаётся', async ({ page }) => {
  const cid = await companyWithCash(page, 'Отмена с правкой');
  await apiImport(page, cid, ROWS);
  const journal = await (await page.request.get(`/api/v1/companies/${cid}/operations`)).json();
  const income = (journal.items as { id: number; version: number; type: string }[]).find((o) => o.type === 'income')!;
  const res = await page.request.patch(`/api/v1/companies/${cid}/operations/${income.id}`, { data: { version: income.version, comment: 'сверено' }, headers: csrf(page) });
  expect(res.status(), await res.text()).toBe(200);
  await page.reload();

  await openHistory(page);
  await history(page).getByRole('tab', { name: 'Импорты' }).click();
  await undoButton(page, 'выгрузка.xlsx').click();
  const dialog = confirmDialog(page);
  await expect(dialog).toHaveAccessibleDescription(/^Будут удалены 2 операции из файла «выгрузка\.xlsx».* После импорта изменена 1 операция — она останется\.$/);
  const box = dialog.getByRole('checkbox', { name: 'Удалить и изменённые (1)' });
  await expect(box).not.toBeChecked();
  await box.check();
  await expect(dialog).toHaveAccessibleDescription(/^Будут удалены 3 операции .* — она тоже будет удалена\.$/);
  await box.uncheck();
  await dialog.getByRole('button', { name: 'Отменить импорт' }).click();
  await expect(history(page).getByRole('status')).toHaveText(
    'Импорт отменён: удалено 2 операции, 1 счёт, 1 категория, 1 контрагент. Оставлено: 1 изменённая операция, категория «Бар» (используется).',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('table', { name: 'Операции' }).locator('tbody tr')).toHaveCount(1);
});

test('импорт отменили в другом окне, пока открыто подтверждение: «Импорт уже отменён», запись «Отменён», фокус на вкладке', async ({ page }) => {
  const cid = await companyWithCash(page, 'Отмена дважды');
  const id = await apiImport(page, cid, ROWS);
  await openHistory(page);
  await history(page).getByRole('tab', { name: 'Импорты' }).click();
  await undoButton(page, 'выгрузка.xlsx').click();
  await expect(confirmDialog(page)).toBeVisible();
  await apiPost(page, `/api/v1/companies/${cid}/imports/${id}/undo`, { includeEdited: false, edited: 0 });

  const live = await watchLiveRegions(page);
  await confirmDialog(page).getByRole('button', { name: 'Отменить импорт' }).click();
  await expect(history(page).getByRole('alert')).toHaveText('Импорт уже отменён');
  expect(await live()).toEqual([{ role: 'alert', text: 'Импорт уже отменён', modal: false }]);
  await expect(confirmDialog(page)).toBeHidden();
  await expect(history(page).getByRole('list', { name: 'Импорты' }).getByRole('listitem')).toContainText('Отменён');
  await expect(undoButton(page, 'выгрузка.xlsx')).toHaveCount(0);
  await expect(history(page).getByRole('tab', { name: 'Импорты' })).toBeFocused();
});

test('с флажком изменили ещё операцию, пока открыто подтверждение: 409 «…подтвердите отмену ещё раз», ничего не удалено, фокус на «Отменить»', async ({ page }) => {
  const cid = await companyWithCash(page, 'Отмена гонка правки');
  await apiImport(page, cid, ROWS);
  const journal = await (await page.request.get(`/api/v1/companies/${cid}/operations`)).json();
  const ops = journal.items as { id: number; version: number; type: string }[];
  const edit = async (op: { id: number; version: number }, comment: string) => {
    const res = await page.request.patch(`/api/v1/companies/${cid}/operations/${op.id}`, { data: { version: op.version, comment }, headers: csrf(page) });
    expect(res.status(), await res.text()).toBe(200);
  };
  await edit(ops.find((o) => o.type === 'income')!, 'сверено');
  await page.reload();

  await openHistory(page);
  await history(page).getByRole('tab', { name: 'Импорты' }).click();
  const undo = undoButton(page, 'выгрузка.xlsx');
  await undo.click();
  await confirmDialog(page).getByRole('checkbox', { name: 'Удалить и изменённые (1)' }).check();
  // в другом окне изменили ещё одну операцию импорта
  await edit(ops.find((o) => o.type === 'transfer')!, 'и эту');

  const live = await watchLiveRegions(page);
  await confirmDialog(page).getByRole('button', { name: 'Отменить импорт' }).click();
  const message = 'После открытия подтверждения изменены ещё операции импорта — проверьте и подтвердите отмену ещё раз';
  await expect(history(page).getByRole('alert')).toHaveText(message);
  expect(await live()).toEqual([{ role: 'alert', text: message, modal: false }]);
  await expect(confirmDialog(page)).toBeHidden();
  // импорт не отменён: «Отменить» на месте и с фокусом; новое подтверждение видит обе изменённые
  await expect(undo).toBeFocused();
  await undo.click();
  await expect(confirmDialog(page).getByRole('checkbox', { name: 'Удалить и изменённые (2)' })).toBeVisible();
  await confirmDialog(page).getByRole('button', { name: 'Не отменять' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('table', { name: 'Операции' }).locator('tbody tr')).toHaveCount(3);
});

test('счёт удаляемой операции в архиве: 422 «Счёт «Сейф» в архиве…» в role=alert, фокус на «Отменить»', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Отмена архивный счёт ${Date.now()}`);
  // остаток нового «Сейфа» после импорта — 0: счёт можно перевести в архив, компания — не в архиве
  await apiImport(page, cid, [fr({ paidAt: at('2025-03-15', '10:00:00'), amount: 100, to: 'Сейф' })], 'сейф.xlsx', [
    { key: 'сейф', kind: 'new', name: 'Сейф', currency: 'KZT', balance: { mode: 'current', amount: 0 } },
  ]);
  const accounts = await (await page.request.get(`/api/v1/companies/${cid}/accounts`)).json();
  await apiPost(page, `/api/v1/companies/${cid}/accounts/${accounts.accounts[0].id}/archive`, {});
  await page.reload();

  await openHistory(page);
  await history(page).getByRole('tab', { name: 'Импорты' }).click();
  const undo = undoButton(page, 'сейф.xlsx');
  await undo.click();
  const live = await watchLiveRegions(page);
  await confirmDialog(page).getByRole('button', { name: 'Отменить импорт' }).click();
  const message = 'Счёт «Сейф» в архиве — верните его из архива, чтобы отменить импорт';
  await expect(history(page).getByRole('alert')).toHaveText(message);
  expect(await live()).toEqual([{ role: 'alert', text: message, modal: false }]);
  await expect(confirmDialog(page)).toBeHidden();
  await expect(undo).toBeFocused();
  await expect(history(page).getByRole('list', { name: 'Импорты' }).getByRole('listitem')).not.toContainText('Отменён');
});

test('архивная компания: список импортов есть, кнопки «Отменить» нет', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Отмена архив ${Date.now()}`);
  // остаток нового «Сейфа» после импорта — 0: счёт и компанию можно перевести в архив
  await apiImport(page, cid, [fr({ paidAt: at('2025-03-15', '10:00:00'), amount: 100, to: 'Сейф' })], 'архив.xlsx', [
    { key: 'сейф', kind: 'new', name: 'Сейф', currency: 'KZT', balance: { mode: 'current', amount: 0 } },
  ]);
  const accounts = await (await page.request.get(`/api/v1/companies/${cid}/accounts`)).json();
  await apiPost(page, `/api/v1/companies/${cid}/accounts/${accounts.accounts[0].id}/archive`, {});
  await apiPost(page, `/api/v1/companies/${cid}/archive`, {});
  await page.reload();
  await expect(page.getByText('Компания в архиве — изменения недоступны.')).toBeVisible();

  await openHistory(page);
  await history(page).getByRole('tab', { name: 'Импорты' }).click();
  await expect(history(page).getByRole('list', { name: 'Импорты' }).getByRole('listitem')).toContainText('архив.xlsx');
  await expect(history(page).getByRole('button', { name: /^Отменить/ })).toHaveCount(0);
});

test('телефон: «Ещё» → «История действий» → «Импорты» — вкладки и «Отменить» не меньше 44 px, длинное имя файла не раздвигает панель', async ({ page }) => {
  const cid = await companyWithCash(page, 'Отмена телефон');
  await apiImport(page, cid, ROWS, `${'очень-длинное-имя-выгрузки-'.repeat(4)}.xlsx`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/c/${cid}/log`);
  await page.getByRole('navigation', { name: 'Разделы', exact: true }).getByRole('button', { name: 'Ещё', exact: true }).click();
  await page.getByRole('dialog', { name: 'Ещё', exact: true }).getByRole('button', { name: 'История действий' }).click();
  const tab = history(page).getByRole('tab', { name: 'Импорты' });
  expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await tab.click();
  const undo = history(page).getByRole('button', { name: /^Отменить импорт/ });
  await expect(undo).toBeVisible();
  const b = (await undo.boundingBox())!;
  const d = (await history(page).boundingBox())!;
  expect(b.height).toBeGreaterThanOrEqual(44);
  expect(b.x + b.width).toBeLessThanOrEqual(d.x + d.width);
  expect(d.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
