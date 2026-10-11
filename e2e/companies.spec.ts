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
  await page.getByLabel('Базовая валюта').selectOption('KZT');
  await page.getByRole('button', { name: 'Создать компанию' }).click();
  await expect(page).toHaveURL(/\/c\/\d+\/log$/);
  return Number(page.url().match(/\/c\/(\d+)\//)![1]);
}

/** Шестерёнка в шапке → «Настройки компании» (§3.3 этапа 1.5). */
async function openCompanySettings(page: Page) {
  await page.getByRole('banner').getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Настройки компании' }).click();
}

/** Строка компании в панели «Компании»: имя кнопки начинается с названия (у ✎ — «Изменить компанию «…»»). */
const companyRow = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

test('компании: создание, панель «Компании» — переключение, поиск, ✎ поверх панели, «Добавить компанию»', async ({ page }) => {
  await login(page);
  const suffix = Date.now();
  const first = `ТОО Ромашка ${suffix}`;
  const second = `ИП Лютик ${suffix}`;

  // поиск в панели появляется, когда компаний больше пяти: в начале прогона их может быть меньше
  const headers = { origin: new URL(page.url()).origin, 'x-requested-with': 'fetch' };
  for (let i = 1; i <= 4; i++) {
    expect((await page.request.post('/api/v1/companies', { data: { name: `ТОО Наполнение ${suffix} ${i}` }, headers })).status()).toBe(201);
  }

  const firstId = await createCompany(page, first);
  await expect(page.getByRole('heading', { name: 'Журнал' })).toBeAttached();
  const block = page.getByRole('banner').getByRole('button', { name: /Сменить компанию/ });
  await expect(block).toContainText(first);
  await expect(block).toContainText('Сменить компанию');

  // «Отмена» на экране новой компании возвращает в журнал первой активной
  await page.goto('/companies/new');
  await page.getByRole('link', { name: 'Отмена' }).click();
  await expect(page).toHaveURL(/\/c\/\d+\/log$/);

  const secondId = await createCompany(page, second);
  expect(secondId).not.toBe(firstId);
  await expect(block).toContainText(second);

  // панель: текущая отмечена; в общей базе e2e компаний больше пяти — есть поиск
  await block.click();
  const drawer = page.getByRole('dialog', { name: 'Компании' });
  await expect(drawer.getByRole('button', { name: companyRow(second) })).toHaveAttribute('aria-current', 'true');
  await drawer.getByRole('searchbox', { name: 'Поиск' }).fill(String(suffix));
  await expect(drawer.getByRole('button', { name: new RegExp(`^(ТОО Ромашка|ИП Лютик) ${suffix}`) })).toHaveCount(2);
  await drawer.getByRole('button', { name: companyRow(first) }).click();
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/c/${firstId}/log$`));
  await expect(block).toContainText(first);
  await expect(page.getByRole('heading', { name: 'Журнал' })).toBeFocused();

  // ✎ — окно «Компания» поверх панели; Esc закрывает только окно, фокус — на ✎
  await block.click();
  const pencil = drawer.getByRole('button', { name: `Изменить компанию «${first}»` });
  await pencil.click();
  const edit = page.getByRole('dialog', { name: 'Компания', exact: true });
  await expect(edit.getByLabel('Название компании')).toHaveValue(first);
  await page.keyboard.press('Escape');
  await expect(edit).toBeHidden();
  await expect(drawer).toBeVisible();
  await expect(pencil).toBeFocused();
  // переименование: новое название — в панели и в шапке
  await pencil.click();
  const renamed = `ТОО Ромашка переим ${suffix}`;
  await edit.getByLabel('Название компании').fill(renamed);
  await edit.getByRole('button', { name: 'Сохранить' }).click();
  await expect(edit).toBeHidden();
  await expect(drawer.getByRole('button', { name: companyRow(renamed) })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(block).toContainText(renamed);

  // «Все компании, в том числе архивные» и «Добавить компанию»
  await block.click();
  await drawer.getByRole('link', { name: 'Все компании, в том числе архивные' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${firstId}/settings/companies$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Мои компании' })).toBeFocused();
  await block.click();
  await drawer.getByRole('link', { name: 'Добавить компанию' }).click();
  await expect(page).toHaveURL(/\/companies\/new$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Новая компания' })).toBeFocused();

  await page.goto('/c/999999/log');
  await expect(page).not.toHaveURL(/\/c\/999999\//); // неизвестная компания → редирект…
  await expect(page).toHaveURL(/\/c\/\d+\/log$/); // …на первую активную
});

test('проекты по шаблонам: клуб и общий', async ({ page }) => {
  await login(page);
  const companyName = `ТОО Клубы ${Date.now()}`;
  const cid = await createCompany(page, companyName);

  await openCompanySettings(page);
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/counterparties$`));
  await page.getByRole('navigation', { name: 'Разделы настроек' }).getByRole('link', { name: 'Проекты' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/projects$`));

  await page.getByRole('button', { name: 'Добавить проект' }).click();
  await page.getByLabel('Название проекта').fill('Клуб на Ленина');
  await page.getByLabel('Тип бизнеса').selectOption('computer-club');
  await page.getByLabel('Количество ПК').fill('0');
  await page.getByRole('button', { name: 'Создать проект' }).click();
  await expect(page.getByText('Не меньше 1')).toBeVisible(); // клиентская проверка той же схемой
  await page.getByLabel('Количество ПК').fill('30');
  // ответ сервера отделяет потерянное нажатие от медленного сервера
  const created = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/v1/companies/${cid}/projects`);
  await page.getByRole('button', { name: 'Создать проект' }).click();
  expect((await created).status()).toBe(201);

  const row = page.getByRole('listitem').filter({ hasText: 'Клуб на Ленина' });
  await expect(row).toBeVisible({ timeout: 10_000 });
  await expect(row).toContainText('Компьютерный клуб');
  await expect(row).toContainText('Количество ПК: 30');

  const tree = await (await page.request.get(`/api/v1/companies/${cid}/categories`)).json();
  const salary = tree.expense.find((c: { systemKey: string | null }) => c.systemKey === 'salary');
  expect(salary.children.map((c: { name: string }) => c.name)).toEqual(['Администраторы', 'Премии']);
  const accounts = (await (await page.request.get(`/api/v1/companies/${cid}/accounts`)).json()).accounts;
  expect(accounts.map((a: { name: string }) => a.name)).toEqual(['Касса Клуб на Ленина', 'Kaspi Клуб на Ленина']);

  await page.getByRole('button', { name: 'Добавить проект' }).click();
  await page.getByLabel('Название проекта').fill('Офис');
  await page.getByLabel('Тип бизнеса').selectOption('general');
  await expect(page.getByLabel('Количество ПК')).toHaveCount(0);
  await page.getByRole('button', { name: 'Создать проект' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Офис' })).toContainText('Общий');
  const after = (await (await page.request.get(`/api/v1/companies/${cid}/accounts`)).json()).accounts;
  expect(after).toHaveLength(2);

  // переименование компании на экране «Компании»
  await page.getByRole('navigation', { name: 'Разделы настроек' }).getByRole('link', { name: 'Мои компании' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/companies$`));
  const renamed = `ТОО Клубы переим ${Date.now()}`;
  const companyRow = page.getByRole('listitem').filter({ has: page.locator(`input[value="${companyName}"]`) });
  await companyRow.getByLabel('Название').fill(renamed);
  // локаторы Playwright разрешаются заново при каждом действии, а React обновил атрибут value —
  // строку ищем уже по новому имени
  const renamedRow = page.getByRole('listitem').filter({ has: page.locator(`input[value="${renamed}"]`) });
  await renamedRow.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('button', { name: 'Сменить компанию' })).toContainText(renamed);
});

test('истёкшая сессия уводит на вход', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Сессия ${Date.now()}`);
  // левая панель счетов грузит данные сразу после входа в компанию: дожидаемся её, иначе 401 придёт раньше клика
  await page.waitForLoadState('networkidle');
  await page.context().clearCookies();
  await openCompanySettings(page);
  // экран настроек монтируется и перезапрашивает данные → 401 → уход на вход
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible();
  expect(cid).toBeGreaterThan(0);
});
