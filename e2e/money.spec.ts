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

/** Запрос к API от имени вошедшего пользователя: кука сессии браузера и заголовки защиты от подделки. */
async function apiPost(page: Page, url: string, data: unknown) {
  const res = await page.request.post(url, { data, headers: { origin: new URL(page.url()).origin, 'x-requested-with': 'fetch' } });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return res.json();
}

const minuteAgo = () => new Date(Date.now() - 60_000).toISOString();

test('левая панель: балансы и итог, переход в журнал, свёрнутая панель остаётся свёрнутой; итоги в переключателе', async ({ page }) => {
  await login(page);
  const name = `ТОО Панель ${Date.now()}`;
  const cid = await createCompany(page, name);
  const base = `/api/v1/companies/${cid}`;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 100000 })).account.id;
  const safe = (await apiPost(page, `${base}/accounts`, { name: 'Сейф', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: minuteAgo(), accountId: kaspi, amount: 50000 });
  await apiPost(page, `${base}/operations`, { type: 'transfer', paidAt: minuteAgo(), accountId: kaspi, toAccountId: safe, amount: 20000 });

  await page.reload();
  const panel = page.getByRole('navigation', { name: 'Счета' });
  await expect(panel).toContainText(/Всего на счетах\s*₸\s1\s500(?![\s\d])/);
  await expect(panel.getByRole('link', { name: /^Kaspi/ })).toContainText(/₸\s1\s300$/);
  await expect(panel.getByRole('link', { name: /^Сейф/ })).toContainText(/₸\s200$/);
  await expect(panel).toContainText('Общие');

  await panel.getByRole('link', { name: /^Kaspi/ }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log\\?account=${kaspi}$`));

  // панель «Компании»: у компании — её итог, ₸ впереди
  await page.getByRole('banner').getByRole('button', { name: /Сменить компанию/ }).click();
  const companies = page.getByRole('dialog', { name: 'Компании' });
  await expect(companies.getByRole('button', { name: new RegExp(`^${name}`) })).toContainText(/₸\s1\s500/);
  await page.keyboard.press('Escape');

  // настройка общая для пользователя admin и остальных e2e: что бы ни случилось, она должна остаться «развёрнуто»
  try {
    // свернуть — и после перезагрузки панель свёрнута (Review Focus 5)
    const saved = page.waitForResponse((r) => r.url().endsWith('/api/v1/preferences/sidebar.collapsed') && r.request().method() === 'PUT');
    await panel.getByRole('button', { name: 'Свернуть панель счетов' }).click();
    await saved;
    // фокус остался на той же кнопке (теперь это «Развернуть»)
    await expect(panel.getByRole('button', { name: 'Развернуть панель счетов' })).toBeFocused();
    await expect(panel.getByRole('link', { name: /^Kaspi/ })).toHaveCount(0);
    await page.reload();
    await expect(panel.getByRole('button', { name: 'Развернуть панель счетов' })).toBeVisible();
    await expect(panel.getByRole('link', { name: /^Kaspi/ })).toHaveCount(0);

    // развернуть обратно
    const restored = page.waitForResponse((r) => r.url().endsWith('/api/v1/preferences/sidebar.collapsed') && r.request().method() === 'PUT');
    await panel.getByRole('button', { name: 'Развернуть панель счетов' }).click();
    await restored;
    await expect(panel.getByRole('button', { name: 'Свернуть панель счетов' })).toBeFocused();
    await expect(panel.getByRole('link', { name: /^Kaspi/ })).toBeVisible();
  } finally {
    await page.request.put('/api/v1/preferences/sidebar.collapsed', {
      data: { value: false },
      headers: { origin: new URL(page.url()).origin, 'x-requested-with': 'fetch' },
    });
  }
});

const section = (page: Page, name: string) => page.getByRole('navigation', { name: 'Разделы настроек' }).getByRole('link', { name });

test('курсы: валюта без курса — предупреждение; фиксированный курс включает её в итог; ручные курсы на дату', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Курсы ${Date.now()}`);
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Евро-счёт', currency: 'EUR', openedAt: '2020-01-01', startingBalance: 1000 });
  await page.reload();
  const panel = page.getByRole('navigation', { name: 'Счета' });
  // Review Focus 1: валюта без курса не входит в итог, под итогом — предупреждение
  await expect(panel).toContainText('курс EUR недоступен');
  await expect(panel).toContainText(/Всего на счетах\s*₸\s0(?![\s\d])/);
  await expect(panel.getByRole('link', { name: /^Евро-счёт/ })).toContainText(/€\s10$/);

  await page.getByRole('banner').getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Настройки компании' }).click();
  await section(page, 'Фиксированные курсы валют').click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/rates$`));

  // фиксированный курс компании
  const fixed = page.getByRole('region', { name: 'Фиксированные курсы компании' });
  const fixedForm = fixed.getByRole('form', { name: 'Новый фиксированный курс' });
  await fixedForm.getByLabel('Валюта').selectOption('EUR');
  await fixedForm.getByLabel('Курс к KZT').fill('500');
  await fixedForm.getByLabel('Действует с').fill('2020-01-01');
  await fixedForm.getByRole('button', { name: 'Добавить курс' }).click();
  const fixedRow = fixed.getByRole('listitem').filter({ hasText: 'EUR' });
  await expect(fixedRow).toContainText('1 EUR = 500 KZT');
  await expect(fixedRow).toContainText('с 01.01.2020, бессрочно');
  // итог — в левой панели журнала: «← Назад к журналу», проверка, и обратно к курсам
  const back = page.getByRole('navigation', { name: 'Разделы настроек' }).getByRole('link', { name: /Назад к журналу/ });
  await back.click();
  await expect(panel).not.toContainText('недоступен');
  await expect(panel).toContainText(/Всего на счетах\s*₸\s5\s000(?![\s\d])/);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/rates$`));

  await fixedRow.getByRole('button', { name: 'Изменить' }).click();
  await fixedRow.getByLabel('Курс 1 EUR').fill('510');
  await fixedRow.getByRole('button', { name: 'Сохранить' }).click();
  await expect(fixedRow).toContainText('1 EUR = 510 KZT');
  await back.click();
  await expect(panel).toContainText(/Всего на счетах\s*₸\s5\s100(?![\s\d])/);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/rates$`));

  // ручной курс на дату: добавить, изменить, удалить
  const manual = page.getByRole('region', { name: 'Ручные курсы на дату' });
  const manualForm = manual.getByRole('form', { name: 'Новый курс на дату' });
  await manualForm.getByLabel('Дата').fill('2020-03-15');
  await manualForm.getByLabel('Валюта').selectOption('GBP');
  await manualForm.getByLabel('Курс к тенге').fill('520,5');
  await manualForm.getByRole('button', { name: 'Добавить курс' }).click();
  const manualRow = manual.getByRole('listitem').filter({ hasText: '15.03.2020' });
  await expect(manualRow).toContainText('GBP');
  await expect(manualRow).toContainText('520,5');

  await manualRow.getByRole('button', { name: 'Изменить' }).click();
  await manualRow.getByLabel('Курс к тенге').fill('521');
  await manualRow.getByRole('button', { name: 'Сохранить' }).click();
  await expect(manualRow).toContainText('1 GBP = 521 KZT');

  await manualRow.getByRole('button', { name: 'Удалить' }).click();
  await manualRow.getByRole('button', { name: 'Да, удалить' }).click();
  await expect(manual.getByRole('listitem').filter({ hasText: '15.03.2020' })).toHaveCount(0);

  // ошибка поля из сервера: неверный курс
  await manualForm.getByLabel('Дата').fill('2020-03-16');
  await manualForm.getByLabel('Курс к тенге').fill('abc');
  await manualForm.getByRole('button', { name: 'Добавить курс' }).click();
  await expect(manualForm.getByLabel('Курс к тенге')).toHaveAttribute('aria-invalid', 'true');
});

test('валюта счёта с операциями и базовая валюта компании с операциями заблокированы', async ({ page }) => {
  await login(page);
  const stamp = Date.now();
  const freeName = `ТОО Без операций ${stamp}`;
  await createCompany(page, freeName);
  const name = `ТОО Валюта ${stamp}`;
  const cid = await createCompany(page, name);
  const base = `/api/v1/companies/${cid}`;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `${base}/accounts`, { name: 'Пустой', currency: 'KZT', openedAt: '2020-01-01' });
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: minuteAgo(), accountId: kaspi, amount: 100 });

  await page.goto(`/c/${cid}/settings/accounts`);
  // в режиме правки название — значение поля, а не текст строки: строку формы ищем по полю
  const editRow = (accountName: string) => page.getByRole('listitem').filter({ has: page.locator(`input[value="${accountName}"]`) });
  await page.getByRole('listitem').filter({ hasText: 'Kaspi' }).getByRole('button', { name: 'Изменить' }).click();
  const row = editRow('Kaspi');
  await expect(row.getByLabel('Валюта')).toBeDisabled();
  await expect(row).toContainText('По счёту есть операции — валюту изменить нельзя');
  await row.getByRole('button', { name: 'Отмена' }).click();
  await page.getByRole('listitem').filter({ hasText: 'Пустой' }).getByRole('button', { name: 'Изменить' }).click();
  const empty = editRow('Пустой');
  await expect(empty.getByLabel('Валюта')).toBeEnabled();
  await empty.getByRole('button', { name: 'Отмена' }).click();

  await page.goto(`/c/${cid}/settings/companies`);
  const locked = page.getByRole('listitem').filter({ has: page.locator(`input[value="${name}"]`) });
  await expect(locked.getByLabel('Базовая валюта')).toBeDisabled();
  await expect(locked).toContainText('В компании есть операции или фиксированные курсы — базовую валюту изменить нельзя');
  const free = page.getByRole('listitem').filter({ has: page.locator(`input[value="${freeName}"]`) });
  await expect(free.getByLabel('Базовая валюта')).toBeEnabled();
});

test('смена базовой валюты обновляет итог в левой панели', async ({ page }) => {
  await login(page);
  const name = `ТОО Смена валюты ${Date.now()}`;
  const cid = await createCompany(page, name);
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 100000 });

  await page.reload();
  const panel = page.getByRole('navigation', { name: 'Счета' });
  await expect(panel).toContainText(/Всего на счетах\s*₸\s1\s000(?![\s\d])/);
  await page.goto(`/c/${cid}/settings/companies`);
  const row = page.getByRole('listitem').filter({ has: page.locator(`input[value="${name}"]`) });
  await row.getByLabel('Базовая валюта').selectOption('USD');
  await row.getByRole('button', { name: 'Сохранить' }).click();
  await expect(row.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  // курса USD в свежей базе нет: итог в тенге больше не показывается
  await page.getByRole('navigation', { name: 'Разделы настроек' }).getByRole('link', { name: /Назад к журналу/ }).click();
  await expect(panel).toContainText('курс USD недоступен');
  await expect(panel).not.toContainText(/Всего на счетах\s*₸\s1\s000(?![\s\d])/);
});

test('отрицательный баланс с копейками в панели: «\u2212₸ 500,50»; копейки показываются, только если не нулевые', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Минус ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: minuteAgo(), accountId: kaspi, amount: 50050 });
  await page.reload();
  const panel = page.getByRole('navigation', { name: 'Счета' });
  await expect(panel.getByRole('link', { name: /^Kaspi/ })).toContainText(/\u2212₸\s500,50$/);
  await expect(panel).toContainText(/Всего на счетах\s*\u2212₸\s500,50(?![\s\d])/);
  // в журнале — ₸ после суммы, копейки ненулевые — видны
  await expect(page.getByRole('table', { name: 'Операции' }).locator('tbody tr').first()).toContainText(/\u2212500,50\s₸/);
});

test('баланс и итог в левой панели обновляются при возврате на вкладку, журнал сам не перезапрашивается (§2.5)', async ({ page }) => {
  // часы подменены: «прошло 30 с» — без настоящего ожидания
  await page.clock.install();
  await login(page);
  const cid = await createCompany(page, `ТОО Фокус ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 100000 })).account.id;
  await page.reload();
  const panel = page.getByRole('navigation', { name: 'Счета' });
  await expect(panel).toContainText(/Всего на счетах\s*₸\s1\s000(?![\s\d])/);

  // другой пользователь внёс доход, пока вкладка была в фоне
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: minuteAgo(), accountId: kaspi, amount: 50000 });
  await page.clock.fastForward(31_000);
  const journalRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/operations?')) journalRequests.push(r.url());
  });
  // возврат на вкладку: TanStack Query слушает visibilitychange
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange', { bubbles: true })));
  await expect(panel).toContainText(/Всего на счетах\s*₸\s1\s500(?![\s\d])/);
  await expect(panel.getByRole('link', { name: /^Kaspi/ })).toContainText(/₸\s1\s500$/);
  expect(journalRequests).toEqual([]);
});
