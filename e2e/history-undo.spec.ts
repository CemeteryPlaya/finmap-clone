import { expect, test, type Page } from '@playwright/test';

/** «Отмена» в «Истории действий» журнала (спецификация 2026-10-19, часть 2; план 2026-10-20, задача 3). */

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

async function apiPatch(page: Page, url: string, data: unknown) {
  const res = await page.request.patch(url, { data, headers: csrf(page) });
  expect(res.status(), await res.text()).toBe(200);
  return res.json();
}

const minuteAgo = () => new Date(Date.now() - 60_000).toISOString();
const table = (page: Page) => page.getByRole('table', { name: 'Операции' });
const drawer = (page: Page) => page.getByRole('dialog', { name: 'История действий' });
const items = (page: Page) => drawer(page).getByRole('list', { name: 'Последние действия' }).getByRole('listitem');
const confirm = (page: Page) => page.getByRole('alertdialog', { name: 'Отменить действия?' });

/** Компания с «Кассой» и расходом «Клуб 1» на 10 000 ₸; возвращает адрес операций и операцию. */
async function setup(page: Page, name: string) {
  await login(page);
  const cid = await createCompany(page, `${name} ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  const op = (await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: minuteAgo(), accountId: cash, amount: 1_000_000, comment: 'Клуб 1' })).operation;
  return { ops: `${base}/operations`, op };
}

async function openHistory(page: Page) {
  await page.reload();
  await page.getByRole('banner').getByRole('button', { name: 'История действий' }).click();
  await expect(items(page).first()).toBeVisible();
}

test('отмена правки из «Истории действий»: окно со списком, сумма возвращается, запись «Отменено» и запись «Отмена»', async ({ page }) => {
  const { ops, op } = await setup(page, 'ТОО Отмена правки');
  await apiPatch(page, `${ops}/${op.id}`, { version: 1, amount: 1_500_000 });
  await openHistory(page);

  await expect(items(page).nth(0)).toContainText('Изменён расход');
  await items(page).nth(0).getByRole('button', { name: /^Отмена: Изменён расход, / }).click();
  const dialog = confirm(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Отменится 1 действие. Операция вернётся в состояние до него.');
  const list = dialog.getByRole('list', { name: 'Что отменится' }).getByRole('listitem');
  await expect(list).toHaveCount(1);
  await expect(list.first()).toHaveText(/^Изменён расход · \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}:\d{2} · Админ$/);
  await dialog.getByRole('button', { name: 'Отменить действия' }).click();
  await expect(dialog).toBeHidden();
  await expect(drawer(page).getByRole('status')).toHaveText('Отменено 1 действие');
  // кнопки «Отмена» у записи больше нет — фокус на вкладке «Журнал», как у отмены импорта
  await expect(drawer(page).getByRole('tab', { name: 'Журнал' })).toBeFocused();

  // сверху — запись «Отмена»; отменённая правка — с пометкой и без кнопки
  await expect(items(page).nth(0)).toContainText('Отмена');
  await expect(items(page).nth(0)).toContainText('Отменено: изменён расход');
  await expect(items(page).nth(1)).toContainText('Изменён расход');
  await expect(items(page).nth(1)).toContainText('Отменено');
  await expect(items(page).nth(1).getByRole('button', { name: /^Отмена:/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(drawer(page)).toBeHidden();
  await expect(table(page).locator('tbody tr').filter({ hasText: 'Клуб 1' })).toContainText(/10\s000/);
});

test('отмена удаления возвращает операцию в журнал; на телефоне кнопка «Отмена» не меньше 44 px', async ({ page }) => {
  const { ops, op } = await setup(page, 'ТОО Отмена удаления');
  expect((await page.request.delete(`${ops}/${op.id}`, { headers: csrf(page) })).status()).toBe(200);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  // журнал на телефоне — карточки: дата, сумма расхода «10 000 ₸», счёт «Касса»
  const card = page.getByRole('button', { name: /10\s000\s₸\sКасса/ });
  await expect(page.getByRole('navigation', { name: 'Разделы', exact: true })).toBeVisible();
  await expect(card).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Разделы', exact: true }).getByRole('button', { name: 'Ещё', exact: true }).click();
  await page.getByRole('dialog', { name: 'Ещё', exact: true }).getByRole('button', { name: 'История действий' }).click();

  const undo = items(page).nth(0).getByRole('button', { name: /^Отмена: Удалён расход, / });
  await expect(undo).toBeVisible();
  expect((await undo.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  // у добавления удалённой операции «Отмены» нет: сначала отменяется удаление
  await expect(items(page).nth(1).getByRole('button', { name: /^Отмена:/ })).toHaveCount(0);
  await undo.click();
  await confirm(page).getByRole('button', { name: 'Отменить действия' }).click();
  await expect(confirm(page)).toBeHidden();
  // сверху — запись «Отмена», затем отменённое удаление; добавление снова можно отменить
  await expect(items(page).nth(0)).toContainText('Отменено: удалён расход');
  await expect(items(page).nth(2).getByRole('button', { name: /^Отмена: Добавлен расход, / })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toBeVisible();
  expect((await (await page.request.get(`${ops}/${op.id}`)).json()).operation.deletedAt).toBeNull();
});

test('каскад: окно перечисляет все действия; «Закрыть» ничего не меняет, «Отменить действия» — возвращает исходное', async ({ page }) => {
  const { ops, op } = await setup(page, 'ТОО Каскад');
  await apiPatch(page, `${ops}/${op.id}`, { version: 1, amount: 1_500_000 });
  await apiPatch(page, `${ops}/${op.id}`, { version: 2, comment: 'Клуб 2' });
  await openHistory(page);

  await items(page).nth(1).getByRole('button', { name: /^Отмена: Изменён расход, / }).click();
  const dialog = confirm(page);
  await expect(dialog).toContainText('Отменятся 2 действия. Операция вернётся в состояние до них.');
  await expect(dialog.getByRole('list', { name: 'Что отменится' }).getByRole('listitem')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Закрыть' }).click();
  await expect(dialog).toBeHidden();
  expect((await (await page.request.get(`${ops}/${op.id}`)).json()).operation).toMatchObject({ amount: 1_500_000, comment: 'Клуб 2' });

  await items(page).nth(1).getByRole('button', { name: /^Отмена: Изменён расход, / }).click();
  await confirm(page).getByRole('button', { name: 'Отменить действия' }).click();
  await expect(drawer(page).getByRole('status')).toHaveText('Отменено 2 действия');
  expect((await (await page.request.get(`${ops}/${op.id}`)).json()).operation).toMatchObject({ amount: 1_000_000, comment: 'Клуб 1' });
});

test('отменено в другом окне: «Отменить действия» — ошибка после закрытия окна, кнопки нет, фокус на вкладке «Журнал»', async ({ page }) => {
  const { ops, op } = await setup(page, 'ТОО Отмена гонка');
  await apiPatch(page, `${ops}/${op.id}`, { version: 1, amount: 1_500_000 });
  await openHistory(page);

  await items(page).nth(0).getByRole('button', { name: /^Отмена: Изменён расход, / }).click();
  const dialog = confirm(page);
  await expect(dialog).toBeVisible();
  // пока окно открыто, ту же правку отменяет «другой сотрудник»
  const audit = ops.replace(/\/operations$/, '/audit');
  const entry = (await (await page.request.get(`${audit}?entity=operation`)).json()).entries.find((e: { action: string }) => e.action === 'update');
  expect((await page.request.post(`${audit}/${entry.id}/undo`, { data: { ids: [entry.id] }, headers: csrf(page) })).status()).toBe(200);

  await dialog.getByRole('button', { name: 'Отменить действия' }).click();
  await expect(dialog).toBeHidden();
  await expect(drawer(page).getByRole('alert')).toHaveText('Действие уже отменено');
  await expect(drawer(page).getByRole('tab', { name: 'Журнал' })).toBeFocused();
  await expect(drawer(page).getByRole('button', { name: /^Отмена: Изменён расход, / })).toHaveCount(0);
});
