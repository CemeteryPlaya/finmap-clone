import { expect, test, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('Логин').fill('admin');
  await page.getByPlaceholder('Пароль').fill('e2e-password-1');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible();
}

async function createCompany(page: Page, name: string): Promise<number> {
  await page.goto('/companies/new');
  await page.getByLabel('Название компании').fill(name);
  await page.getByRole('button', { name: 'Создать компанию' }).click();
  await expect(page).toHaveURL(/\/c\/\d+\/log$/);
  return Number(page.url().match(/\/c\/(\d+)\//)![1]);
}

const csrf = (page: Page) => ({ origin: new URL(page.url()).origin, 'x-requested-with': 'fetch' });

/** Запрос к API от имени вошедшего пользователя: кука сессии браузера и заголовки защиты от подделки. */
async function apiPost(page: Page, url: string, data: unknown) {
  const res = await page.request.post(url, { data, headers: csrf(page) });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return res.json();
}

/** Начало сегодняшнего дня по Алматы — APP_TIMEZONE e2e-сервера (с 01.03.2024 — UTC+5). */
function startOfTodayAlmaty(): number {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date());
  return Date.parse(`${day}T00:00:00+05:00`);
}

/**
 * Момент «сегодня по Алматы»: чем больше n (0 < n < 1000), тем раньше, но всегда сегодня и не в будущем
 * (инвариант 6) — проверки «сегодня» и периода не падают сразу после полуночи.
 */
const todayAgo = (n: number) => {
  const start = startOfTodayAlmaty();
  return new Date(start + (Date.now() - start) * (1 - n / 1000)).toISOString();
};

/** Вчера в полдень по Алматы. */
const yesterdayNoon = () => new Date(startOfTodayAlmaty() - 12 * 3600_000).toISOString();

const table = (page: Page) => page.getByRole('table', { name: 'Операции' });
const bodyRows = (page: Page) => table(page).locator('tbody tr');
const panel = (page: Page) => page.getByRole('navigation', { name: 'Счета' });
/** Буквы операций в порядке строк журнала: у каждой операции комментарий «операция X». */
const letters = async (page: Page) => (await bodyRows(page).allInnerTexts()).map((t) => /операция ([A-Z])/.exec(t)?.[1] ?? '?').join('');

test('сохранённые фильтры: сохранить из окна «Фильтр», применить, переименовать, удалить; предупреждение о недоступных условиях', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Сохранённые ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  const shift = (await apiPost(page, `${base}/tags`, { name: 'Смена' })).tag.id;
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: todayAgo(3), accountId: kaspi, amount: 100, tagIds: [shift], comment: 'операция A' });
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(2), accountId: kaspi, amount: 200, comment: 'операция B' });
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: todayAgo(1), accountId: kaspi, amount: 300, comment: 'операция C' });
  await page.reload();
  await expect.poll(() => letters(page)).toBe('CBA');

  const filterButton = page.getByRole('button', { name: /^Фильтр/ });
  const dialog = page.getByRole('dialog', { name: 'Фильтр', exact: true });
  const menuButton = page.getByRole('button', { name: 'Сохранённые фильтры' });

  // период «Сегодня» в тулбаре + доходы в окне → «Сохранить фильтр»
  await page.getByLabel('Период').selectOption({ label: 'Сегодня' });
  await filterButton.click();
  await dialog.getByRole('checkbox', { name: 'Доход' }).check();
  await dialog.getByRole('button', { name: 'Сохранить фильтр' }).click();
  await dialog.getByLabel('Название фильтра').fill('   ');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog.getByLabel('Название фильтра')).toHaveAttribute('aria-invalid', 'true');
  await dialog.getByLabel('Название фильтра').fill('Доходы за день');
  await dialog.getByLabel('Название фильтра').press('Enter');
  await expect(dialog).toBeHidden();
  await expect.poll(() => letters(page)).toBe('CA');

  // применить после сброса: период сохранён датами — «Произвольно»
  await page.getByRole('button', { name: 'Сбросить фильтр' }).click();
  await expect.poll(() => letters(page)).toBe('CBA');
  await menuButton.click();
  await page.getByRole('button', { name: 'Применить фильтр «Доходы за день»' }).click();
  await expect(menuButton).toBeFocused();
  await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}&type=income$/);
  await expect(page.getByLabel('Период')).toHaveValue('custom');
  await expect.poll(() => letters(page)).toBe('CA');

  // переименовать
  await menuButton.click();
  await page.getByRole('button', { name: 'Переименовать фильтр «Доходы за день»' }).click();
  await page.getByLabel('Новое название фильтра «Доходы за день»').fill('Доходы');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  // поле названия исчезло — фокус на переименованном фильтре
  await expect(page.getByRole('button', { name: 'Применить фильтр «Доходы»' })).toBeFocused();
  await page.keyboard.press('Escape');

  // фильтр по тегу; тег уходит в архив — при применении предупреждение, условие отброшено (инвариант 10)
  await page.getByRole('button', { name: 'Сбросить фильтр' }).click();
  await filterButton.click();
  await dialog.getByRole('checkbox', { name: 'Смена' }).check();
  await dialog.getByRole('button', { name: 'Сохранить фильтр' }).click();
  await dialog.getByLabel('Название фильтра').fill('Смены');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(() => letters(page)).toBe('A');
  await apiPost(page, `${base}/tags/${shift}/archive`, {});
  await page.getByRole('button', { name: 'Сбросить фильтр' }).click();
  await page.reload();
  await menuButton.click();
  const shifts = page.getByRole('button', { name: /^Применить фильтр «Смены»/ });
  await expect(shifts).toHaveAccessibleName('Применить фильтр «Смены», 1 условие недоступно');
  await expect(shifts).toContainText('(1 условие недоступно)');
  await shifts.click();
  await expect(page.getByRole('status').filter({ hasText: 'Фильтр «Смены»' })).toHaveText(/1 условие недоступно \(удалены или в архиве\) — они не применены/);
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log$`));
  await expect.poll(() => letters(page)).toBe('CBA');

  // удалить — с подтверждением
  await menuButton.click();
  await page.getByRole('button', { name: 'Удалить фильтр «Смены»' }).click();
  await expect(page.getByRole('button', { name: 'Отмена' })).toBeFocused();
  await page.getByRole('button', { name: 'Да, удалить' }).click();
  // пункт исчез — меню закрыто, фокус на его кнопке
  await expect(menuButton).toBeFocused();
  await menuButton.click();
  await expect(shifts).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Применить фильтр «Доходы»' })).toBeVisible();
});

test('ошибка журнала, затем новый поиск: тулбар остаётся на месте, поле поиска не теряет фокус', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Сбой ${Date.now()}`);
  const kaspi = (await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `/api/v1/companies/${cid}/operations`, { type: 'income', paidAt: todayAgo(2), accountId: kaspi, amount: 100, comment: 'операция A' });
  await apiPost(page, `/api/v1/companies/${cid}/operations`, { type: 'income', paidAt: todayAgo(1), accountId: kaspi, amount: 200, comment: 'операция B' });

  // журнал отвечает ошибкой (400 — без повторов запроса): ошибка под тулбаром
  const journalUrl = /\/api\/v1\/companies\/\d+\/operations\?/;
  await page.route(journalUrl, (route) =>
    route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 'VALIDATION', message: 'Сбой журнала для теста' } }) }),
  );
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Сбой журнала для теста');
  await page.unroute(journalUrl);

  // поиск уходит в адрес — у нового запроса ещё нет ни данных, ни ошибки; тулбар не пропадает, ввод продолжается
  const search = page.getByLabel('Поиск');
  await search.fill('опер');
  await expect(page).toHaveURL(/q=/);
  await expect(search).toBeFocused();
  await search.pressSequentially('ация A');
  await expect(search).toHaveValue('операция A');
  await expect.poll(() => letters(page)).toBe('A');
  await expect(search).toBeFocused();
});

test('«Указать»: список с поиском и клавиатурой, значение сохраняется сразу; конфликт версии — откат и сообщение', async ({ page }) => {
  // высокое окно: под последней строкой таблицы хватает места, и список открывается вниз — за край обёртки таблицы
  await page.setViewportSize({ width: 1280, height: 1000 });
  await login(page);
  const cid = await createCompany(page, `ТОО Указать ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Наличные', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `${base}/categories`, { kind: 'income', name: 'Бар' });
  await apiPost(page, `${base}/categories`, { kind: 'income', name: 'Игровое время' });
  await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Барная стойка' }); // расходная — доходу не предлагается
  const club = (await apiPost(page, `${base}/projects`, { name: 'Клуб 1', templateKey: 'general' })).project.id;
  await apiPost(page, `${base}/counterparties`, { name: 'ИП Клиент', type: 'client' });
  const income = (await apiPost(page, `${base}/operations`, { type: 'income', paidAt: todayAgo(3), accountId: kaspi, amount: 100, comment: 'операция A' })).operation;
  await apiPost(page, `${base}/operations`, {
    type: 'expense',
    paidAt: todayAgo(2),
    accountId: kaspi,
    amount: 300,
    comment: 'операция B',
    lines: [
      { projectId: club, amount: 100 },
      { amount: 200 },
    ],
  });
  await apiPost(page, `${base}/operations`, { type: 'transfer', paidAt: todayAgo(1), accountId: kaspi, toAccountId: cash, amount: 50, comment: 'операция C' });
  await page.reload();
  await expect.poll(() => letters(page)).toBe('CBA');
  const row = (letter: string) => bodyRows(page).filter({ hasText: `операция ${letter}` });

  // где есть «Указать»: доход — все три поля; разбитая операция — нигде; перевод — только проект
  await expect(row('A').getByRole('button', { name: /^Указать/ })).toHaveCount(3);
  await expect(row('B').getByRole('button', { name: /^Указать/ })).toHaveCount(0);
  await expect(row('C').getByRole('button', { name: /^Указать/ })).toHaveCount(1);
  await expect(row('C').getByRole('button', { name: 'Указать проект' })).toBeVisible();

  // статья с клавиатуры: поиск, стрелка, Enter; доход видит только доходные статьи
  await row('A').getByRole('button', { name: 'Указать статью' }).click();
  const search = page.getByRole('combobox', { name: 'Статьи: поиск' });
  await expect(search).toBeFocused();
  const categoryOptions = page.getByRole('listbox', { name: 'Статьи' }).getByRole('option');
  await expect(categoryOptions).toHaveText(['Инвестиции', 'Возврат займа', 'Получение кредита', 'Бар', 'Игровое время']);
  // список у последней строки не обрезан обёрткой таблицы (overflow-x: auto): он ниже её нижнего края и виден целиком
  const listBox = (await page.getByRole('listbox', { name: 'Статьи' }).boundingBox())!;
  const wrapperBox = (await table(page).locator('xpath=..').boundingBox())!;
  expect(listBox.y + listBox.height).toBeGreaterThan(wrapperBox.y + wrapperBox.height);
  await expect(categoryOptions.last()).toBeInViewport();
  const lastOptionHit = await categoryOptions
    .last()
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === el;
    });
  expect(lastOptionHit).toBe(true);
  await search.fill('БАР');
  await expect(categoryOptions).toHaveText(['Бар']);
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(row('A')).toContainText('Бар');
  await expect(row('A').getByRole('button', { name: 'Указать статью' })).toHaveCount(0);
  // кнопки больше нет — фокус на строке операции, а не на body
  await expect(row('A')).toBeFocused();

  // Esc закрывает список, фокус — на кнопке
  await row('A').getByRole('button', { name: 'Указать проект' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox', { name: 'Проекты' })).toHaveCount(0);
  await expect(row('A').getByRole('button', { name: 'Указать проект' })).toBeFocused();

  // проект переводу без строк — мышью
  await row('C').getByRole('button', { name: 'Указать проект' }).click();
  // журнал перечитывается после сохранения — дождёмся его, чтобы правка «в другом окне» ниже пришла позже
  const reloaded = page.waitForResponse((r) => r.url().includes(`/companies/${cid}/operations?`) && r.request().method() === 'GET');
  await page.getByRole('listbox', { name: 'Проекты' }).getByRole('option', { name: 'Клуб 1' }).click();
  await expect(row('C')).toContainText('Клуб 1');
  await reloaded;

  // конфликт: операцию изменили в другом окне — значение откатывается, сообщение о конфликте, журнал обновлён
  const patched = await page.request.patch(`${base}/operations/${income.id}`, { data: { version: 2, comment: 'операция A изменена' }, headers: csrf(page) });
  expect(patched.status(), await patched.text()).toBe(200);
  await row('A').getByRole('button', { name: 'Указать контрагента' }).click();
  await page.getByRole('listbox', { name: 'Контрагенты' }).getByRole('option', { name: 'ИП Клиент' }).click();
  await expect(page.getByRole('alert')).toContainText('Операция изменена другим пользователем. Журнал обновлён — проверьте и повторите.');
  await expect(row('A')).toContainText('операция A изменена');
  await expect(row('A').getByRole('button', { name: 'Указать контрагента' })).toBeVisible();
  // повтор с новой версией проходит; после перезагрузки значения на месте
  await row('A').getByRole('button', { name: 'Указать контрагента' }).click();
  await page.getByRole('listbox', { name: 'Контрагенты' }).getByRole('option', { name: 'ИП Клиент' }).click();
  await expect(row('A')).toContainText('ИП Клиент');
  await page.reload();
  await expect(row('A')).toContainText('ИП Клиент');
  await expect(row('A')).toContainText('Бар');
  await expect(row('C')).toContainText('Клуб 1');
});

test('массовые действия: статья с итогом и причинами, проект, удаление с подтверждением и «Отменить» — балансы в панели обновляются', async ({ page }) => {
  await login(page);
  const name = `ТОО Массовые ${Date.now()}`;
  const cid = await createCompany(page, name);
  const base = `/api/v1/companies/${cid}`;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 100000 })).account.id;
  await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Аренда' });
  const otherName = `ТОО Соседняя ${Date.now()}`;
  const other = (await apiPost(page, '/api/v1/companies', { name: otherName })).company.id;
  const club = (await apiPost(page, `${base}/projects`, { name: 'Клуб 1', templateKey: 'general' })).project.id;
  const club2 = (await apiPost(page, `${base}/projects`, { name: 'Клуб 2', templateKey: 'general' })).project.id;
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(5), accountId: kaspi, amount: 1000, comment: 'операция A' });
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(4), accountId: kaspi, amount: 2000, comment: 'операция B' });
  await apiPost(page, `${base}/operations`, {
    type: 'expense',
    paidAt: todayAgo(3),
    accountId: kaspi,
    amount: 3000,
    comment: 'операция C',
    lines: [
      { projectId: club, amount: 1000 },
      { projectId: club2, amount: 2000 },
    ],
  });
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: todayAgo(2), accountId: kaspi, amount: 4000, comment: 'операция D' });
  await page.reload();
  await expect.poll(() => letters(page)).toBe('DCBA');
  const row = (letter: string) => bodyRows(page).filter({ hasText: `операция ${letter}` });
  const bar = page.getByRole('region', { name: 'Действия с выбранными' });
  const kaspiLink = panel(page).getByRole('link', { name: /^Kaspi/ });
  // 1000 - 10 - 20 - 30 + 40 = 980 ₸
  await expect(kaspiLink).toContainText(/980,00\s₸/);

  // выбрать все загруженные → «Статья»: расходы с одной строкой меняются, разбитая и доход пропущены с причинами
  await table(page).getByRole('checkbox', { name: 'Выбрать все загруженные операции' }).check();
  await expect(bar).toContainText('Выбрано: 4');
  await bar.getByRole('button', { name: 'Статья', exact: true }).click();
  await page.getByRole('listbox', { name: 'Статьи' }).getByRole('option', { name: 'Расход: Аренда' }).click();
  const summary = page.getByRole('status').filter({ hasText: 'Статья:' });
  await expect(summary).toContainText('Статья: изменено 2, пропущено 2');
  // фокус после выбора — на кнопке списка, а не на body
  await expect(bar.getByRole('button', { name: 'Статья', exact: true })).toBeFocused();
  await expect(summary).toContainText('Разбитая операция — измените её в форме — 1');
  await expect(summary).toContainText('Статья расходов не подходит для дохода — 1');
  await expect(row('A')).toContainText('Аренда');
  await expect(row('B')).toContainText('Аренда');
  await expect(row('D')).not.toContainText('Аренда');
  // выделение остаётся — можно назначить ещё и проект
  await expect(bar).toContainText('Выбрано: 4');
  await bar.getByRole('button', { name: 'Проект', exact: true }).click();
  await page.getByRole('listbox', { name: 'Проекты' }).getByRole('option', { name: 'Клуб 2' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Проект:' })).toContainText('Проект: изменено 3, пропущено 1');
  await expect(row('D')).toContainText('Клуб 2');

  // удалить две операции: подтверждение, тост с фокусом на «Отменить», балансы пересчитаны
  await bar.getByRole('button', { name: 'Снять выделение' }).click();
  await expect(bar).toHaveCount(0);

  // смена фильтра снимает выделение: действие не уйдёт на строки, которых уже не видно (Review Focus 4)
  await row('A').getByRole('checkbox').check();
  await expect(bar).toContainText('Выбрано: 1');
  await page.getByLabel('Период').selectOption({ label: 'Вчера' });
  await expect(bar).toHaveCount(0);
  await page.getByLabel('Период').selectOption({ label: 'Всё время' });
  await expect.poll(() => letters(page)).toBe('DCBA');
  await expect(row('A').getByRole('checkbox')).not.toBeChecked();
  await row('A').getByRole('checkbox').check();
  await row('D').getByRole('checkbox').check();
  await expect(row('A').getByRole('checkbox')).toHaveAccessibleName(/^Выбрать операцию: сегодня \d{2}:\d{2}, \u221210,00\s₸$/);
  await bar.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(bar.getByRole('button', { name: 'Отмена' })).toBeFocused();
  await bar.getByRole('button', { name: 'Да, удалить' }).click();
  const undo = page.getByRole('button', { name: 'Отменить' });
  await expect(page.getByRole('status').filter({ hasText: 'Удалено 2' })).toBeVisible();
  await expect(undo).toBeFocused();
  await expect.poll(() => letters(page)).toBe('CB');
  await expect(kaspiLink).toContainText(/950,00\s₸/);

  // «Отменить» возвращает именно эти операции
  await undo.click();
  await expect(page.getByRole('status').filter({ hasText: 'Отмена удаления:' })).toContainText('Отмена удаления: изменено 2, пропущено 0');
  await expect.poll(() => letters(page)).toBe('DCBA');
  await expect(kaspiLink).toContainText(/980,00\s₸/);
  await expect(page.getByRole('button', { name: 'Отменить' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Журнал' })).toBeFocused();

  // удалили и сразу перешли в другую компанию: тост остаётся, «Отменить» возвращает операции той компании, где удаляли
  await row('B').getByRole('checkbox').check();
  await bar.getByRole('button', { name: 'Удалить', exact: true }).click();
  await bar.getByRole('button', { name: 'Да, удалить' }).click();
  await expect(undo).toBeFocused();
  await expect.poll(() => letters(page)).toBe('DCA');
  await page.getByRole('button', { name: /Сменить компанию/ }).click();
  await page.getByRole('menuitem', { name: otherName }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${other}/log$`));
  await expect(page.getByText('Операций пока нет.')).toBeVisible();
  await expect(bar).toHaveCount(0);
  await undo.click();
  await expect(undo).toHaveCount(0);
  await page.getByRole('button', { name: /Сменить компанию/ }).click();
  await page.getByRole('menuitem', { name }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log$`));
  await expect.poll(() => letters(page)).toBe('DCBA');
  await expect(page.getByRole('status').filter({ hasText: 'Отмена удаления:' })).toContainText('Отмена удаления: изменено 1, пропущено 0');
  await expect(kaspiLink).toContainText(/980,00\s₸/);
});
