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
  // с клавиатуры: фокус остаётся на ⟳ и пока идёт обновление, и после него (aria-disabled вместо disabled)
  const refreshButton = panel.getByRole('button', { name: 'Обновить' });
  await refreshButton.focus();
  await page.keyboard.press('Enter');
  await expect(refreshButton).toBeFocused();
  await expect(panel.locator('[aria-live="polite"]')).toHaveText('Данные обновлены');
  await expect(refreshButton).toBeFocused();
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
  await expect(panel.locator('[aria-live="polite"]')).toHaveText('Не удалось обновить журнал', { timeout: 10_000 }); // 2 повтора запроса с паузами 1 и 2 с
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
  // на телефоне панель скрыта CSS, и невидимое окно getByRole не находит ещё до того, как приложение заметило
  // смену ширины: ждём, пока окно закроется на самом деле (содержимое окна убрано из DOM). Без этого второе
  // изменение размера могло успеть раньше события matchMedia, и окно оставалось открытым (5 из 30 прогонов)
  await expect(page.getByRole('heading', { name: 'Добавление нового счёта', includeHidden: true })).toHaveCount(0);
  await expect(dialog).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(panel.getByRole('button', { name: 'Добавить счёт' })).toBeVisible();
  await expect(dialog).toHaveCount(0);
});

test('счета двух клубов: панель, окно «Счета» и раздел «Счета» показывают один порядок; двигать можно только внутри клуба; Esc при перетаскивании не закрывает окно', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Два клуба ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const clubA = (await apiPost(page, `${base}/projects`, { name: 'Клуб А', templateKey: 'general', templateParams: {} })).project.id;
  const clubB = (await apiPost(page, `${base}/projects`, { name: 'Клуб Б', templateKey: 'general', templateParams: {} })).project.id;
  // порядок на сервере вперемешку: клубы и «Общие» перемежаются
  for (const [name, projectId] of [['А1', clubA], ['Общий1', undefined], ['Б1', clubB], ['А2', clubA], ['Общий2', undefined]] as const) {
    await apiPost(page, `${base}/accounts`, { name, currency: 'KZT', openedAt: '2020-01-01', ...(projectId ? { projectId } : {}) });
  }
  const serverOrder = async () => ((await (await page.request.get(`${base}/accounts`)).json()).accounts as { name: string }[]).map((a) => a.name);
  expect(await serverOrder()).toEqual(['А1', 'Общий1', 'Б1', 'А2', 'Общий2']);
  await page.reload();

  const panel = page.getByRole('navigation', { name: 'Счета' });
  const panelLinks = panel.getByRole('link');
  // панель: «Общие», затем клубы в порядке проектов
  await expect(panel.getByRole('heading', { level: 3 })).toHaveText(['Общие', 'Клуб А', 'Клуб Б']);
  await expect(panelLinks).toHaveText([/^Общий1/, /^Общий2/, /^А1/, /^А2/, /^Б1/]);

  // окно «Счета» — в том же порядке; у клуба с одним счётом ручки нет
  await panel.getByRole('button', { name: 'Изменить счета' }).click();
  const quick = page.getByRole('dialog', { name: 'Счета', exact: true });
  const list = quick.getByRole('list', { name: 'Список счетов' });
  await expect(list.getByRole('listitem')).toHaveText([/Общий1/, /Общий2/, /А1/, /А2/, /Б1/]);
  await expect(list.getByRole('button', { name: 'Переместить Б1', exact: true })).toHaveCount(0);

  // Alt+↓ на последнем счёте клуба не уходит в другой клуб: ничего не меняется и запрос не уходит
  let reorders = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/accounts/reorder')) reorders++;
  });
  await list.getByRole('button', { name: 'Переместить А2', exact: true }).focus();
  await page.keyboard.press('Alt+ArrowDown');
  await list.getByRole('button', { name: 'Переместить Общий2', exact: true }).focus();
  await page.keyboard.press('Alt+ArrowDown');
  // исключение из «без фиксированных пауз»: отсутствие запроса иначе не доказать, только подождать
  await page.waitForTimeout(300);
  expect(reorders, 'через границу клуба запрос не уходит').toBe(0);
  await expect(list.getByRole('listitem')).toHaveText([/Общий1/, /Общий2/, /А1/, /А2/, /Б1/]);

  // Alt+↑ на А2 — меняются А1 и А2; остальные счета на своих местах в порядке сервера
  await list.getByRole('button', { name: 'Переместить А2', exact: true }).focus();
  const moved = page.waitForResponse((r) => r.url().endsWith('/accounts/reorder'));
  await page.keyboard.press('Alt+ArrowUp');
  await moved;
  await expect(list.getByRole('listitem')).toHaveText([/Общий1/, /Общий2/, /А2/, /А1/, /Б1/]);
  await expect.poll(serverOrder).toEqual(['А2', 'Общий1', 'Б1', 'А1', 'Общий2']);
  await expect(panelLinks).toHaveText([/^Общий1/, /^Общий2/, /^А2/, /^А1/, /^Б1/]);

  // Esc во время перетаскивания отменяет его, а окно остаётся открытым; потом Esc закрывает окно
  const grip = (await list.getByRole('button', { name: 'Переместить Общий2', exact: true }).boundingBox())!;
  const above = (await list.getByRole('listitem').filter({ hasText: 'Общий1' }).boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, above.y + 4, { steps: 8 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(quick).toBeVisible();
  await expect(list.getByRole('listitem')).toHaveText([/Общий1/, /Общий2/, /А2/, /А1/, /Б1/]);
  expect(reorders, 'отменённое перетаскивание порядка не меняет').toBe(1);
  await page.keyboard.press('Escape');
  await expect(quick).toBeHidden();

  // мышью «Общий2» выше «Общий1» — окно и панель снова согласны
  await panel.getByRole('button', { name: 'Изменить счета' }).click();
  const grip2 = (await list.getByRole('button', { name: 'Переместить Общий2', exact: true }).boundingBox())!;
  const above2 = (await list.getByRole('listitem').filter({ hasText: 'Общий1' }).boundingBox())!;
  await page.mouse.move(grip2.x + grip2.width / 2, grip2.y + grip2.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip2.x + grip2.width / 2, above2.y + 4, { steps: 8 });
  await page.mouse.up();
  await expect(list.getByRole('listitem')).toHaveText([/Общий2/, /Общий1/, /А2/, /А1/, /Б1/]);
  await expect.poll(serverOrder).toEqual(['А2', 'Общий2', 'Б1', 'А1', 'Общий1']);
  await page.keyboard.press('Escape');
  await expect(quick).toBeHidden();
  await expect(panelLinks).toHaveText([/^Общий2/, /^Общий1/, /^А2/, /^А1/, /^Б1/]);

  // раздел «Счета»: тот же порядок, клуб в сером тексте; через границу клуба не двигается
  await page.goto(`/c/${cid}/settings/accounts`);
  const settings = page.getByRole('main').getByRole('list', { name: 'Счета' });
  await expect(settings.getByRole('listitem')).toHaveText([/Общий2/, /Общий1/, /А2\s*Клуб А/, /А1\s*Клуб А/, /Б1\s*Клуб Б/]);
  await expect(settings.getByRole('button', { name: 'Переместить Б1', exact: true })).toHaveCount(0);
  const before = reorders;
  await settings.getByRole('button', { name: 'Переместить А1', exact: true }).focus();
  await page.keyboard.press('Alt+ArrowDown');
  await settings.getByRole('button', { name: 'Переместить А2', exact: true }).focus();
  await page.keyboard.press('Alt+ArrowUp');
  // исключение из «без фиксированных пауз»: отсутствие запроса иначе не доказать, только подождать
  await page.waitForTimeout(300);
  expect(reorders, 'на краях клуба запрос не уходит').toBe(before);
  await expect(settings.getByRole('listitem')).toHaveText([/Общий2/, /Общий1/, /А2\s*Клуб А/, /А1\s*Клуб А/, /Б1\s*Клуб Б/]);
});

test('окно «Счета»: архив и удаление счёта возвращают в список; фокус — на ✎ счёта или на «Добавить счёт»', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Окно счетов ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await apiPost(page, `${base}/accounts`, { name: 'Временный', currency: 'KZT', openedAt: '2020-01-01' });
  await page.reload();
  const panel = page.getByRole('navigation', { name: 'Счета' });
  await panel.getByRole('button', { name: 'Изменить счета' }).click();
  const quick = page.getByRole('dialog', { name: 'Счета', exact: true });
  const list = quick.getByRole('list', { name: 'Список счетов' });
  const edit = page.getByRole('dialog', { name: 'Счёт', exact: true });

  // «В архив»: список с пометкой, фокус на ✎ этого счёта; в панели счёта больше нет
  await list.getByRole('button', { name: 'Изменить Временный', exact: true }).click();
  await edit.getByRole('button', { name: 'В архив' }).click();
  await expect(list.getByRole('listitem')).toHaveText([/Касса/, /Временный.*в архиве/]);
  await expect(list.getByRole('button', { name: 'Изменить Временный', exact: true })).toBeFocused();
  await expect(panel.getByRole('link')).toHaveText([/^Касса/]);

  // «Удалить»: подтверждение, потом список без счёта, фокус на «Добавить счёт»
  await list.getByRole('button', { name: 'Изменить Временный', exact: true }).click();
  await edit.getByRole('button', { name: 'Удалить' }).click();
  await page.getByRole('alertdialog', { name: 'Удалить счёт «Временный»?' }).getByRole('button', { name: 'Удалить' }).click();
  await expect(list.getByRole('listitem')).toHaveText([/Касса/]);
  await expect(quick.getByRole('button', { name: 'Добавить счёт' })).toBeFocused();
});

test('окно «Счета» без своей прокрутки: ☰ у нижнего края экрана не прокручивает страницу под окном; строка встаёт на место', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Край окна ${Date.now()}`);
  for (const name of ['Касса', 'Kaspi']) await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name, currency: 'KZT', openedAt: '2020-01-01' });
  await page.reload();
  await page.getByRole('navigation', { name: 'Счета' }).getByRole('button', { name: 'Изменить счета' }).click();
  const quick = page.getByRole('dialog', { name: 'Счета', exact: true });
  const list = quick.getByRole('list', { name: 'Список счетов' });
  await expect(list.getByRole('listitem')).toHaveText([/Касса/, /Kaspi/]);
  // страница под окном длиннее экрана: прокрутка у края, доставшаяся странице, была бы видна; у окна своей прокрутки нет
  await page.evaluate(() => {
    document.body.style.minHeight = '3000px';
  });
  expect(await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 1000)).toBe(true);
  expect(await quick.evaluate((d) => d.scrollHeight <= d.clientHeight)).toBe(true);

  const grip = (await list.getByRole('button', { name: 'Переместить Касса', exact: true }).boundingBox())!;
  const height = page.viewportSize()!.height;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, height - 5, { steps: 8 });
  // исключение из «без фиксированных пауз»: отсутствие прокрутки иначе не доказать, только подождать
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.scrollY), 'страница под окном не едет').toBe(0);
  await page.mouse.up();
  await expect(list.getByRole('listitem')).toHaveText([/Kaspi/, /Касса/]);
});
