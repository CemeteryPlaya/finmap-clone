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

async function apiPost(page: Page, url: string, data: unknown) {
  const res = await page.request.post(url, { data, headers: csrf(page) });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return res.json();
}

const minuteAgo = () => new Date(Date.now() - 60_000).toISOString();

test('«Мои счета»: «+» — окно «Добавление нового счёта» над журналом; ✎ — окно «Счета» с правкой и порядком; ⟳ обновляет', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Мои счета ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 100000 });
  await page.reload();
  const panel = page.getByRole('navigation', { name: 'Счета' });
  await expect(panel.getByRole('heading', { level: 2, name: 'Мои счета' })).toBeVisible();
  // одна группа — без заголовка группы; ссылки «+ счёт» больше нет
  await expect(panel.getByRole('heading', { level: 3 })).toHaveCount(0);
  await expect(panel.getByRole('link', { name: '+ счёт' })).toHaveCount(0);

  // «+» — окно прямо над журналом, адрес не меняется, фокус возвращается на «+»
  const add = panel.getByRole('button', { name: 'Добавить счёт' });
  await add.click();
  const dialog = page.getByRole('dialog', { name: 'Добавление нового счёта' });
  await expect(dialog.getByLabel('Валюта')).toBeFocused();
  await dialog.getByLabel('Название счёта').fill('Kaspi');
  await dialog.getByRole('button', { name: 'Создать счёт' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log$`));
  await expect(add).toBeFocused();
  await expect(panel.getByRole('link', { name: /^Kaspi/ })).toContainText(/₸\s0$/);

  // ✎ — окно «Счета»: «Добавить счёт» и список ☰ имя ✎
  await panel.getByRole('button', { name: 'Изменить счета' }).click();
  const quick = page.getByRole('dialog', { name: 'Счета', exact: true });
  const list = quick.getByRole('list', { name: 'Список счетов' });
  await expect(list.getByRole('listitem')).toHaveText([/Касса/, /Kaspi/]);
  await expect(quick.getByRole('button', { name: 'Добавить счёт' })).toBeFocused();
  // ✎ переключает это же окно на форму счёта
  await list.getByRole('button', { name: 'Изменить Kaspi', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Счёт', exact: true });
  await expect(edit.getByLabel('Валюта')).toBeFocused();
  await edit.getByLabel('Название счёта').fill('Kaspi Gold');
  await edit.getByRole('button', { name: 'Сохранить' }).click();
  await expect(list.getByRole('listitem')).toHaveText([/Касса/, /Kaspi Gold/]);
  await expect(list.getByRole('button', { name: 'Изменить Kaspi Gold', exact: true })).toBeFocused();
  // «← Назад» — снова список, фокус на ✎ того же счёта
  await list.getByRole('button', { name: 'Изменить Касса', exact: true }).click();
  await edit.getByRole('button', { name: 'Назад' }).click();
  await expect(list.getByRole('button', { name: 'Изменить Касса', exact: true })).toBeFocused();
  // порядок: Alt+↓ на ручке «Кассы» — и в окне, и в панели
  await list.getByRole('button', { name: 'Переместить Касса', exact: true }).focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(list.getByRole('listitem')).toHaveText([/Kaspi Gold/, /Касса/]);
  await page.keyboard.press('Escape');
  await expect(quick).toBeHidden();
  await expect(panel.getByRole('button', { name: 'Изменить счета' })).toBeFocused();
  await expect(panel.getByRole('link')).toHaveText([/^Kaspi Gold/, /^Касса/]);

  // ⟳ — журнал, счета и балансы перечитываются (§2.5)
  const kaspi = ((await (await page.request.get(`${base}/accounts`)).json()).accounts as { id: number; name: string }[]).find((a) => a.name === 'Kaspi Gold')!.id;
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: minuteAgo(), accountId: kaspi, amount: 5000 });
  // до ⟳ журнал ещё не знает об операции (R4)
  const rows = page.getByRole('table', { name: 'Операции' }).locator('tbody tr');
  await expect(rows).toHaveCount(0);
  await panel.getByRole('button', { name: 'Обновить' }).click();
  await expect(panel.locator('[aria-live="polite"]')).toHaveText('Данные обновлены');
  await expect(panel.getByRole('link', { name: /^Kaspi Gold/ })).toContainText(/₸\s50$/);
  await expect(rows).toHaveCount(1);
});

test('«Мои счета»: группы по клубам — заголовки h3; у архивной компании только ⟳', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Группы счетов ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const club = (await apiPost(page, `${base}/projects`, { name: 'Клуб на Абая', templateKey: 'general', templateParams: {} })).project.id;
  const safe = (await apiPost(page, `${base}/accounts`, { name: 'Сейф', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  const abay = (await apiPost(page, `${base}/accounts`, { name: 'Касса Абая', currency: 'KZT', openedAt: '2020-01-01', projectId: club })).account.id;
  await page.reload();
  const panel = page.getByRole('navigation', { name: 'Счета' });
  await expect(panel.getByRole('heading', { level: 3 })).toHaveText(['Общие', 'Клуб на Абая']);

  // компанию можно архивировать, только когда все её счета в архиве
  await apiPost(page, `${base}/accounts/${safe}/archive`, {});
  await apiPost(page, `${base}/accounts/${abay}/archive`, {});
  await apiPost(page, `${base}/archive`, {});
  await page.goto(`/c/${cid}/log`);
  await expect(panel.getByRole('heading', { level: 2, name: 'Мои счета' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Добавить счёт' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Изменить счета' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Обновить' })).toBeVisible();
});
