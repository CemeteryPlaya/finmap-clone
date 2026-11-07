import { expect, test, type Page } from '@playwright/test';
import { SENET_DEMO } from '../scripts/lib/senet-demo';

// «Аналитика клуба» (план АК-1, задача 10): карточки, «Обзор», «Выручка», настройки, телефон. Поддельный Senet с
// синтетикой клуба (60 дней до последних 30 часов) поднимает e2e/server.ts.

test.describe.configure({ mode: 'serial' });

const DAY = 86_400_000;
const csrf = (page: Page) => ({ origin: new URL(page.url()).origin, 'x-requested-with': 'fetch' });
const api = async (page: Page, method: 'POST' | 'GET', url: string, data?: unknown) => {
  const res = await page.request.fetch(url, { method, data, headers: csrf(page), timeout: 120_000 });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return res.json();
};
const main = (page: Page) => page.getByRole('main');
/** Дата в часах клуба (UTC+5), `ГГГГ-ММ-ДД`. */
const localDay = (ms: number) => new Date(ms + 5 * 3_600_000).toISOString().slice(0, 10);

async function login(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('Логин').fill('admin');
  await page.getByPlaceholder('Пароль').fill('e2e-password-1');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('button', { name: 'Настройки', exact: true })).toBeVisible();
}

let cid = 0;
/** Период «Обзора» на 40 дней: первые 10 — до загрузки, без данных. */
const period = { from: localDay(Date.now() - 39 * DAY), to: localDay(Date.now()) };

test('подготовка: компания, клуб на 40 ПК, демо-Senet, «Загрузить за период» на 30 дней', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  await page.goto('/companies/new');
  await page.getByLabel('Название компании').fill('ТОО «Клуб e2e»');
  await page.getByRole('button', { name: 'Создать компанию' }).click();
  await expect(page).toHaveURL(/\/c\/\d+\/log$/);
  cid = Number(page.url().match(/\/c\/(\d+)\//)![1]);
  const c = `/api/v1/companies/${cid}`;
  const project = (await api(page, 'POST', `${c}/projects`, { name: 'Клуб 1', templateKey: 'computer-club', templateParams: { pcCount: 40 } })).project.id as number;
  const conn = (await api(page, 'POST', `${c}/senet/connections`, { name: 'Клубы', org: SENET_DEMO.org, authMethod: 'password', username: SENET_DEMO.username, password: SENET_DEMO.password })).connection.id as number;
  await api(page, 'POST', `${c}/senet/connections/${conn}/offices`, { senetOfficeId: 1, cashDeskId: 1, enabled: false, projectId: project });
  const run = await api(page, 'POST', `${c}/senet/connections/${conn}/sync`, { from: new Date(Date.now() - 30 * DAY).toISOString(), to: new Date().toISOString() });
  expect(run.runs[0].result).toBe('ok');
});

test('главная «Аналитики»: группа «Компьютерный клуб» с карточками', async ({ page }) => {
  await login(page);
  await page.goto(`/c/${cid}/analytics`);
  await expect(main(page).getByRole('heading', { name: 'Компьютерный клуб' })).toBeVisible();
  await expect(main(page).getByRole('link', { name: /Обзор клуба/ })).toBeVisible();
  await expect(main(page).getByRole('link', { name: /Выручка клуба/ })).toBeVisible();
  await expect(main(page).getByRole('link', { name: /^Загрузка/ })).toBeVisible();
  await expect(main(page).getByRole('link', { name: /^Гости/ })).toBeVisible();
  await expect(main(page).getByRole('link', { name: /^Бар/ })).toBeVisible();
});

test('«Обзор клуба»: плитки, дни без данных, плитка ведёт в «Выручку» с тем же периодом', async ({ page }) => {
  await login(page);
  await page.goto(`/c/${cid}/analytics/club?from=${period.from}&to=${period.to}`);
  await expect(main(page).getByRole('heading', { name: 'Обзор клуба', level: 1 })).toBeVisible();
  await expect(main(page).getByRole('note')).toContainText('нет данных Senet');
  const tiles = main(page).getByRole('list', { name: 'Плитки' });
  await expect(tiles.getByRole('link', { name: /Выручка\s*[\d\s]+₸/ })).toBeVisible();
  await expect(tiles.getByRole('link', { name: /Выручка на ПК в день\s*[\d\s]+₸/ })).toBeVisible();
  await expect(tiles.getByRole('link', { name: /Доля бара\s*[\d,]+\s%/ })).toBeVisible();
  await expect(tiles.getByRole('link', { name: /Загрузка ПК\s*[\d,]+\s%/ })).toBeVisible();
  await expect(tiles.getByRole('link', { name: /^Гостей\s*[\d\s]+/ })).toHaveAttribute('href', new RegExp(`/analytics/club/guests\\?from=${period.from}&to=${period.to}`));
  await expect(tiles.getByRole('link', { name: /^Маржа бара\s*[\d,]+\s%/ })).toHaveAttribute('href', new RegExp(`/analytics/club/bar\\?from=${period.from}&to=${period.to}`));
  await expect(main(page).getByRole('heading', { name: 'Лучшие и худшие дни' })).toBeVisible();
  const peak = main(page).getByRole('heading', { name: 'Часы пик' }).locator('xpath=..');
  await expect(peak.getByRole('listitem')).toHaveCount(3);
  await expect(peak.getByRole('listitem').first()).toHaveText(/^(Пн|Вт|Ср|Чт|Пт|Сб|Вс) \d\d:00–\d\d:00 — \d+(,\d)?\s%$/);
  await expect(peak.getByRole('link', { name: 'Загрузка' })).toHaveAttribute('href', new RegExp(`/analytics/club/load\\?from=${period.from}&to=${period.to}`));
  await expect(main(page).getByRole('img', { name: /^Выручка и загрузка по дням/ })).toBeVisible();
  await tiles.getByRole('link', { name: /^Выручка\s*[\d\s]+₸/ }).click();
  await expect(page).toHaveURL(new RegExp(`/analytics/club/revenue\\?from=${period.from}&to=${period.to}`));
});

test('«Выручка клуба»: строки, «По часам» 7×24, строки Senet под ячейкой, Excel', async ({ page }) => {
  await login(page);
  await page.goto(`/c/${cid}/analytics/club/revenue?view=table&from=${period.from}&to=${period.to}&step=week`);
  const table = main(page).getByRole('table', { name: 'Выручка клуба' });
  for (const label of ['Абонементы', 'Аренда ПК', 'Часы', 'Бар', 'Выручка', 'Справочно: пополнения балансов', 'Справочно: деньги в кассу']) {
    await expect(table.getByRole('rowheader', { name: label, exact: true })).toBeVisible();
  }
  // у «разницы» в подписи — ещё кнопка подсказки
  await expect(table.getByRole('rowheader', { name: /^Справочно: разница/ })).toBeVisible();
  // итог «Аренды ПК» — сеансы гостей с маской телефона
  await table.locator('tr[data-row="rent"] td').last().getByRole('button').click();
  const rows = main(page).getByRole('region', { name: /Аренда ПК за период/ });
  await expect(rows.getByText(/\+7 \*\*\* \*\* \d\d/).first()).toBeVisible();
  await expect(rows.getByText(/guest\d{3}/).first()).toBeVisible();

  const download = page.waitForEvent('download');
  await main(page).getByRole('link', { name: 'Скачать Excel' }).last().click();
  expect((await download).suggestedFilename()).toMatch(/Выручка клуба.*\.xlsx$/);

  await page.goto(`/c/${cid}/analytics/club/revenue?view=hours&from=${period.from}&to=${period.to}`);
  const map = main(page).getByRole('table', { name: /средняя выручка часа/ });
  await expect(map.locator('tbody tr')).toHaveCount(7);
  await expect(map.locator('tbody tr').first().locator('td')).toHaveCount(24);
});

test('«Загрузка»: карта по умолчанию, места, сеансы часа, таблица зон, часы простоя', async ({ page }) => {
  await login(page);
  await page.goto(`/c/${cid}/analytics/club/load?from=${period.from}&to=${period.to}`);
  await expect(main(page).getByRole('heading', { name: 'Загрузка', level: 1 })).toBeVisible();
  await expect(main(page).getByText('В расчёте: 40 ПК (Общий зал 30, VIP 10)')).toBeVisible();
  const map = main(page).getByRole('table', { name: /средняя загрузка часа/ });
  await expect(map.locator('tbody tr')).toHaveCount(7);
  await expect(map.getByRole('button', { name: /\d+(,\d)?\s%$/ }).first()).toBeVisible();
  await map.getByRole('button', { name: /^(Пт|Сб), 20:00–21:00/ }).first().click();
  const rows = main(page).getByRole('region', { name: /^Сеансы: (Пт|Сб), 20:00–21:00/ });
  await expect(rows.getByText(/\+7 \*\*\* \*\* \d\d/).first()).toBeVisible();
  await expect(main(page).getByRole('heading', { name: 'Часы простоя' })).toBeVisible();
  await expect(main(page).getByRole('heading', { name: 'Часы простоя' }).locator('xpath=..').getByRole('listitem')).toHaveCount(5);
  await page.goto(`/c/${cid}/analytics/club/load?view=table&from=${period.from}&to=${period.to}`);
  const zones = main(page).getByRole('table', { name: 'Загрузка: зоны' });
  for (const z of ['Общий зал', 'VIP', 'Все зоны']) await expect(zones.getByRole('rowheader', { name: z, exact: true })).toBeVisible();
});

test('«Гости»: плитки, ряд, когорты, постоянные гости, карточка — «Разделить», «Это один гость», «Снять»; Excel', async ({ page }) => {
  await login(page);
  await page.goto(`/c/${cid}/analytics/club/guests?from=${period.from}&to=${period.to}`);
  await expect(main(page).getByRole('heading', { name: 'Гости', level: 1 })).toBeVisible();
  const tiles = main(page).getByRole('list', { name: 'Плитки' });
  for (const t of ['Уникальных гостей', 'Новых', 'Вернувшихся', 'Одноразовых чеков', 'Посещений всего', 'Визитов на гостя', 'Часов на гостя', 'Потратил на гостя', 'Пополнений на гостя']) await expect(tiles.getByText(t, { exact: true })).toBeVisible();
  await expect(main(page).getByRole('img', { name: /^Новые и вернувшиеся гости/ })).toBeVisible();
  await expect(main(page).getByRole('img', { name: /^Посещения/ })).toBeVisible();
  await expect(main(page).getByText(/Общие логины: \d+ сеанс/)).toBeVisible();
  await expect(main(page).getByRole('heading', { name: 'Когорты' })).toBeVisible();
  await expect(main(page).getByRole('heading', { name: 'Возраст' })).toBeVisible();

  await page.goto(`/c/${cid}/analytics/club/guests?view=table&from=${period.from}&to=${period.to}`);
  const table = main(page).getByRole('table', { name: 'Гости: постоянные гости' });
  await table.getByRole('button', { name: 'Визитов' }).click();
  await expect(table.getByRole('columnheader', { name: /Визитов/ })).toHaveAttribute('aria-sort', 'descending');
  // гости 1–10 входят и под вторым логином guestNNNm с тем же телефоном — одна строка
  const pairRow = table.getByRole('button', { name: /^guest0(0\d|10), guest0(0\d|10)m$/ }).first();
  const [one, two] = (await pairRow.innerText()).split(', ') as [string, string];
  await pairRow.click();
  const card = main(page).getByRole('region', { name: 'Карточка гостя' });
  await expect(card.getByRole('heading', { name: `${one}, ${two}` })).toBeVisible();
  await card.getByRole('listitem').filter({ hasText: two }).getByRole('button', { name: 'Разделить' }).click();
  await expect(card.getByText(`Вынут: ${two}`)).toBeVisible();
  await expect(card.getByRole('heading', { name: one, exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Снять' }).click();
  await expect(card.getByRole('heading', { name: `${one}, ${two}` })).toBeVisible();

  await card.getByLabel('Это один гость').fill('guest1');
  const found = card.getByRole('list', { name: 'Найденные гости' });
  await found.getByRole('button', { name: 'Объединить' }).first().click();
  await expect(card.getByText(/^Объединены: /)).toBeVisible();
  await card.getByRole('button', { name: 'Снять' }).click();
  await expect(card.getByText(/^Объединены: /)).toHaveCount(0);

  const download = page.waitForEvent('download');
  await main(page).getByRole('link', { name: 'Скачать Excel' }).last().click();
  expect((await download).suggestedFilename()).toMatch(/Гости.*\.xlsx$/);
});

test('«Бар»: плитки, график, таблица товаров, продажи товара, категории, закупки; Excel', async ({ page }) => {
  await login(page);
  await page.goto(`/c/${cid}/analytics/club/bar?from=${period.from}&to=${period.to}`);
  await expect(main(page).getByRole('heading', { name: 'Бар', level: 1 })).toBeVisible();
  const tiles = main(page).getByRole('list', { name: 'Плитки' });
  for (const t of ['Выручка бара', 'Себестоимость', 'Прибыль бара', 'Маржа бара']) await expect(tiles.getByText(t, { exact: true })).toBeVisible();
  await expect(main(page).getByRole('img', { name: /^Выручка и прибыль бара/ })).toBeVisible();
  await expect(main(page).getByRole('heading', { name: 'Закупки' })).toBeVisible();

  await page.goto(`/c/${cid}/analytics/club/bar?view=table&from=${period.from}&to=${period.to}`);
  const table = main(page).getByRole('table', { name: 'Бар: товары' });
  await expect(table.locator('tbody tr')).toHaveCount(5);
  await expect(table.locator('tbody tr').filter({ hasText: 'Сэндвич' })).toContainText('нет цены прихода');
  await expect(main(page).getByText('без себестоимости: 1 товар', { exact: true })).toBeVisible();
  const first = await table.locator('tbody tr').first().innerText();
  await table.getByRole('button', { name: 'Маржа' }).click();
  await expect(table.getByRole('columnheader', { name: /Маржа/ })).toHaveAttribute('aria-sort', 'descending');
  expect(await table.locator('tbody tr').first().innerText()).not.toBe(first);
  await table.getByRole('button', { name: 'Кола 0,5', exact: true }).click();
  const rows = main(page).getByRole('region', { name: /^Продажи: Кола 0,5/ });
  await expect(rows.getByText('Кола 0,5').first()).toBeVisible();

  const download = page.waitForEvent('download');
  await main(page).getByRole('link', { name: 'Скачать Excel' }).last().click();
  expect((await download).suggestedFilename()).toMatch(/Бар.*\.xlsx$/);

  await page.goto(`/c/${cid}/analytics/club/bar?view=table&by=categories&from=${period.from}&to=${period.to}`);
  const cats = main(page).getByRole('table', { name: 'Бар: категории' });
  for (const c of ['Напитки', 'Еда']) await expect(cats.getByRole('rowheader', { name: c, exact: true })).toBeVisible();
});

test('«Настройки → Аналитика»: скрытая «Выручка клуба» пропадает с главной, но открывается по адресу; «Вернуть как было»', async ({ page }) => {
  await login(page);
  await page.goto(`/c/${cid}/settings/analytics`);
  const cards = main(page).getByRole('list', { name: 'Карточки: Компьютерный клуб' });
  await cards.getByRole('checkbox', { name: 'Выручка клуба' }).uncheck();
  await expect(cards.getByRole('checkbox', { name: 'Выручка клуба' })).not.toBeChecked();
  await page.goto(`/c/${cid}/analytics`);
  await expect(main(page).getByRole('link', { name: /Обзор клуба/ })).toBeVisible();
  await expect(main(page).getByRole('link', { name: /Выручка клуба/ })).toHaveCount(0);
  await page.goto(`/c/${cid}/analytics/club/revenue`);
  await expect(main(page).getByRole('heading', { name: 'Выручка клуба', level: 1 })).toBeVisible();
  await page.goto(`/c/${cid}/settings/analytics`);
  await main(page).getByRole('button', { name: 'Вернуть как было' }).first().click();
  await expect(cards.getByRole('checkbox', { name: 'Выручка клуба' })).toBeChecked();
  await page.goto(`/c/${cid}/analytics`);
  await expect(main(page).getByRole('link', { name: /Выручка клуба/ })).toBeVisible();
});

test('«Изменить» клуба: своё число ПК зоны — на «Загрузке» подсказка о расхождении с проектом', async ({ page }) => {
  await login(page);
  await page.goto(`/c/${cid}/settings/integrations`);
  await main(page).getByRole('button', { name: 'Изменить' }).click();
  const office = page.getByRole('dialog', { name: 'Клуб Senet' });
  const vip = office.getByRole('textbox', { name: 'VIP: своё число ПК' });
  await expect(vip).toHaveAttribute('placeholder', '10');
  await vip.fill('0');
  await expect(office.getByText('От 1 до 1000')).toBeVisible();
  await expect(office.getByRole('button', { name: 'Сохранить зоны' })).toBeDisabled();
  await vip.fill('12');
  await office.getByRole('button', { name: 'Сохранить зоны' }).click();
  await expect(office.getByRole('status').filter({ hasText: 'Зоны сохранены' })).toBeVisible();
  await page.goto(`/c/${cid}/analytics/club/load?from=${period.from}&to=${period.to}`);
  await expect(main(page).getByText('В расчёте: 40 ПК (Общий зал 30, VIP 12)')).toBeVisible();
  await expect(main(page).getByText('По данным Senet в зонах 42 ПК, в проекте — 40. Проверьте «Количество ПК» или зоны')).toBeVisible();
});

test('телефон: «Обзор» — плитки в 2 колонки, контролы в окне «Фильтры»', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto(`/c/${cid}/analytics/club?from=${period.from}&to=${period.to}`);
  const tiles = main(page).getByRole('list', { name: 'Плитки' }).locator('li > *');
  await expect(tiles.first()).toBeVisible();
  const [a, b, c] = await Promise.all([0, 1, 2].map(async (i) => (await tiles.nth(i).boundingBox())!));
  expect(b!.y).toBe(a!.y);
  expect(c!.y).toBeGreaterThan(a!.y);
  expect(c!.x).toBe(a!.x);
  await main(page).getByRole('button', { name: /^Фильтры/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Фильтры' });
  await expect(dialog.getByRole('button', { name: /Период/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Шаг/ })).toHaveCount(0);
});
