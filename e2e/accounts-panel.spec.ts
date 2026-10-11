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
  // «Добавить счёт» внутри окна «Счета»: форма в этом же окне, после создания — список и фокус на «Добавить счёт»
  await quick.getByRole('button', { name: 'Добавить счёт' }).click();
  const create = page.getByRole('dialog', { name: 'Добавление нового счёта' });
  await create.getByLabel('Название счёта').fill('Halyk');
  await create.getByRole('button', { name: 'Создать счёт' }).click();
  await expect(list.getByRole('listitem')).toHaveText([/Касса/, /Kaspi Gold/, /Halyk/]);
  await expect(quick.getByRole('button', { name: 'Добавить счёт' })).toBeFocused();
  // порядок: Alt+↓ на ручке «Кассы» — и в окне, и в панели; дожидаемся ответа сервера до закрытия окна
  await list.getByRole('button', { name: 'Переместить Касса', exact: true }).focus();
  const reordered = page.waitForResponse((r) => r.url().endsWith('/accounts/reorder'));
  await page.keyboard.press('Alt+ArrowDown');
  await reordered;
  await expect(list.getByRole('listitem')).toHaveText([/Kaspi Gold/, /Касса/, /Halyk/]);
  await page.keyboard.press('Escape');
  await expect(quick).toBeHidden();
  await expect(panel.getByRole('button', { name: 'Изменить счета' })).toBeFocused();
  await expect(panel.getByRole('link')).toHaveText([/^Kaspi Gold/, /^Касса/, /^Halyk/]);

  // ⟳ — журнал, счета и балансы перечитываются (§2.5)
  const kaspi = ((await (await page.request.get(`${base}/accounts`)).json()).accounts as { id: number; name: string }[]).find((a) => a.name === 'Kaspi Gold')!.id;
  // перезагрузка: ни одна запись и ни одно перечитывание не в пути, иначе «₸ 50» мог бы появиться и без ⟳ (R4)
  await page.reload();
  const empty = page.getByText('Операций пока нет.');
  const kaspiLink = panel.getByRole('link', { name: /^Kaspi Gold/ });
  await expect(empty).toBeVisible();
  await expect(kaspiLink).toContainText(/₸\s0$/);
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: minuteAgo(), accountId: kaspi, amount: 5000 });
  // до ⟳ журнал и баланс ещё не знают об операции
  await expect(empty).toBeVisible();
  await expect(kaspiLink).toContainText(/₸\s0$/);
  await panel.getByRole('button', { name: 'Обновить' }).click();
  await expect(panel.locator('[aria-live="polite"]')).toHaveText('Данные обновлены');
  await expect(empty).toBeHidden();
  await expect(page.getByRole('table', { name: 'Операции' }).locator('tbody tr')).toHaveCount(1);
  await expect(kaspiLink).toContainText(/₸\s50$/);
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

test('«Мои счета»: ⟳ при сбое перечитывания журнала говорит «Не удалось обновить журнал»', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Сбой обновления ${Date.now()}`);
  const panel = page.getByRole('navigation', { name: 'Счета' });
  await expect(page.getByText('Операций пока нет.')).toBeVisible();
  const journal = (url: URL) => url.pathname === `/api/v1/companies/${cid}/operations`;
  await page.route(journal, (route) => (route.request().method() === 'GET' ? route.fulfill({ status: 500, json: { error: { code: 'INTERNAL', message: 'сбой' } } }) : route.fallback()));
  await panel.getByRole('button', { name: 'Обновить' }).click();
  await expect(panel.locator('[aria-live="polite"]')).toHaveText('Не удалось обновить журнал');
  // сбой прошёл — следующее ⟳ успешно
  await page.unroute(journal);
  await panel.getByRole('button', { name: 'Обновить' }).click();
  await expect(panel.locator('[aria-live="polite"]')).toHaveText('Данные обновлены');
});

test('«Мои счета»: окно из левой панели закрывается, когда окно браузера становится уже телефона', async ({ page }) => {
  await login(page);
  await createCompany(page, `ТОО Сужение окна ${Date.now()}`);
  const panel = page.getByRole('navigation', { name: 'Счета' });
  await panel.getByRole('button', { name: 'Добавить счёт' }).click();
  const dialog = page.getByRole('dialog', { name: 'Добавление нового счёта' });
  await expect(dialog).toBeVisible();
  await page.setViewportSize({ width: 600, height: 800 });
  await expect(dialog).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(panel.getByRole('button', { name: 'Добавить счёт' })).toBeVisible();
  await expect(dialog).toHaveCount(0);
});
