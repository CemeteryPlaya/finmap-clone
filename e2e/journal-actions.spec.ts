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

/** Период — пункт меню у пилюли (§5.1 этапа 1.5). */
async function choosePeriod(page: Page, label: string) {
  await page.getByRole('button', { name: /^Период:/ }).click();
  await page.getByRole('dialog', { name: 'Период', exact: true }).getByRole('button', { name: label, exact: true }).click();
}

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
  const menuButton = page.getByRole('button', { name: 'Быстрые фильтры' });

  // пустое меню «Быстрые фильтры»: пояснение и «Создать новый фильтр» — открывает окно фильтра, после окна фокус на ▾
  await menuButton.click();
  const quick = page.getByRole('dialog', { name: 'Быстрые фильтры' });
  await expect(quick).toContainText('Сохранённых фильтров пока нет');
  await quick.getByRole('button', { name: 'Создать новый фильтр' }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(menuButton).toBeFocused();

  // период «Сегодня» в тулбаре + доходы в окне → «Сохранить фильтр»
  await choosePeriod(page, 'За сегодня');
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
  await expect(page.getByRole('button', { name: /^Период:/ })).toHaveAccessibleName(/^Период: \d{2}\.\d{2}\.\d{4} – \d{2}\.\d{2}\.\d{4}$/);
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

  // категория с клавиатуры: поиск, стрелка, Enter; доход видит только доходные категории
  await row('A').getByRole('button', { name: 'Указать категорию' }).click();
  const search = page.getByRole('combobox', { name: 'Категории: поиск' });
  await expect(search).toBeFocused();
  const categoryOptions = page.getByRole('listbox', { name: 'Категории' }).getByRole('option');
  await expect(categoryOptions).toHaveText(['Инвестиции', 'Возврат займа', 'Получение кредита', 'Бар', 'Игровое время']);
  // список у последней строки не обрезан обёрткой таблицы (overflow-x: auto): он ниже её нижнего края и виден целиком
  const listBox = (await page.getByRole('listbox', { name: 'Категории' }).boundingBox())!;
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
  await expect(row('A').getByRole('button', { name: 'Указать категорию' })).toHaveCount(0);
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

test('массовые действия: категория с итогом и причинами, проект, удаление с подтверждением и «Отменить» — балансы в панели обновляются', async ({ page }) => {
  // часы подменены: тост «Отменить» живёт 10 с только пока тест сам не продвинет время (медленная машина его не сожжёт)
  await page.clock.install();
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
  await expect(kaspiLink).toContainText(/₸\s980$/);

  // выбрать все загруженные → «Категория»: расходы с одной строкой меняются, разбитая и доход пропущены с причинами
  await table(page).getByRole('checkbox', { name: 'Выбрать все загруженные операции' }).check();
  await expect(bar).toContainText('Выбрано: 4');
  await bar.getByRole('button', { name: 'Категория', exact: true }).click();
  await page.getByRole('listbox', { name: 'Категории' }).getByRole('option', { name: 'Расход: Аренда' }).click();
  const summary = page.getByRole('status').filter({ hasText: 'Категория:' });
  await expect(summary).toContainText('Категория: изменено 2, пропущено 2');
  // фокус после выбора — на кнопке списка, а не на body
  await expect(bar.getByRole('button', { name: 'Категория', exact: true })).toBeFocused();
  await expect(summary).toContainText('Разбитая операция — измените её в форме — 1');
  await expect(summary).toContainText('Категория расходов не подходит для дохода — 1');
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

  // отступ ячейки с флажком — тоже флажок: клик по краю ячейки отмечает строку, а не открывает операцию
  await row('B').locator('td').first().click({ position: { x: 2, y: 2 } });
  await expect(row('B').getByRole('checkbox')).toBeChecked();
  await row('B').locator('td').first().click({ position: { x: 2, y: 2 } });
  await expect(row('B').getByRole('checkbox')).not.toBeChecked();

  // смена фильтра снимает выделение: действие не уйдёт на строки, которых уже не видно (Review Focus 4)
  await row('A').getByRole('checkbox').check();
  await expect(bar).toContainText('Выбрано: 1');
  await choosePeriod(page, 'За вчера');
  await expect(bar).toHaveCount(0);
  await choosePeriod(page, 'За все время');
  await expect.poll(() => letters(page)).toBe('DCBA');
  await expect(row('A').getByRole('checkbox')).not.toBeChecked();
  await row('A').getByRole('checkbox').check();
  await row('D').getByRole('checkbox').check();
  await expect(row('A').getByRole('checkbox')).toHaveAccessibleName(/^Выбрать операцию: сегодня \d{2}:\d{2}, \u221210\s₸, операция A$/);
  await expect(row('D').getByRole('checkbox')).toHaveAccessibleName(/, \+40\s₸, операция D$/);
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  // время стоит: react-query и счётчики двигаются только вместе с часами — поэтому проверки подталкивают их на 100 мс
  const lettersTick = async () => {
    await page.clock.runFor(100);
    return letters(page);
  };
  const settled = (check: () => Promise<void>) =>
    expect(async () => {
      await page.clock.runFor(100);
      await check();
    }).toPass();
  await bar.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(bar.getByRole('button', { name: 'Отмена' })).toBeFocused();
  // «Отмена» возвращает фокус на «Удалить», а не на body
  await bar.getByRole('button', { name: 'Отмена' }).click();
  await expect(bar.getByRole('button', { name: 'Удалить', exact: true })).toBeFocused();
  await bar.getByRole('button', { name: 'Удалить', exact: true }).click();
  await bar.getByRole('button', { name: 'Да, удалить' }).click();
  const undo = page.getByRole('button', { name: 'Отменить' });
  await expect(page.getByRole('status').filter({ hasText: 'Удалено 2' })).toBeVisible();
  await expect(undo).toBeFocused();
  // тост уже объявил удаление, и пропусков нет — итог «Удаление: изменено 2…» не повторяет его
  await expect(page.getByRole('status').filter({ hasText: 'Удаление:' })).toHaveCount(0);
  await expect.poll(lettersTick).toBe('CB');
  await settled(() => expect(kaspiLink).toContainText(/₸\s950$/));

  // «Отменить»: первый запрос восстановления сервер отклоняет — ошибка с «Повторить» (операции не потеряны), повтор проходит
  let restoreFailed = false;
  const bulkUrl = `**${base}/operations/bulk`;
  await page.route(bulkUrl, (route) => {
    if (!restoreFailed && (route.request().postDataJSON() as { action: string }).action === 'restore') {
      restoreFailed = true;
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Сбой восстановления' } }) });
    }
    return route.fallback();
  });
  await undo.click();
  const failure = page.getByRole('alert').filter({ hasText: 'Сбой восстановления' });
  await settled(() => expect(failure).toBeVisible());
  await expect(failure).toContainText('Не удалось отменить удаление: Сбой восстановления');
  await expect(undo).toHaveCount(0);
  await expect(failure.getByRole('button', { name: 'Повторить' })).toBeFocused();
  await failure.getByRole('button', { name: 'Повторить' }).click();
  await settled(() => expect(page.getByRole('status').filter({ hasText: 'Отмена удаления:' })).toContainText('Отмена удаления: изменено 2, пропущено 0'));
  await expect(failure).toHaveCount(0);
  await page.unroute(bulkUrl);
  await expect.poll(lettersTick).toBe('DCBA');
  await settled(() => expect(kaspiLink).toContainText(/₸\s980$/));
  await expect(page.getByRole('button', { name: 'Отменить' })).toHaveCount(0);

  // другой фильтр убирает и итог отмены удаления, как итог остальных действий
  await choosePeriod(page, 'За вчера');
  await expect(page.getByRole('status').filter({ hasText: 'Отмена удаления:' })).toHaveCount(0);
  await choosePeriod(page, 'За все время');
  await expect.poll(lettersTick).toBe('DCBA');

  // удалили и сразу перешли в другую компанию: тост остаётся, «Отменить» возвращает операции той компании, где удаляли
  await row('B').getByRole('checkbox').check();
  await bar.getByRole('button', { name: 'Удалить', exact: true }).click();
  await bar.getByRole('button', { name: 'Да, удалить' }).click();
  await expect(undo).toBeFocused();
  await expect.poll(lettersTick).toBe('DCA');
  await page.getByRole('banner').getByRole('button', { name: /Сменить компанию/ }).click();
  await page.getByRole('dialog', { name: 'Компании' }).getByRole('button', { name: new RegExp(`^${otherName}`) }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${other}/log$`));
  await settled(() => expect(page.getByText('Операций пока нет.')).toBeVisible());
  await expect(bar).toHaveCount(0);
  await undo.click();
  await expect(undo).toHaveCount(0);
  // результат виден и здесь, с названием компании, где операции восстановлены
  await settled(() =>
    expect(page.getByRole('status').filter({ hasText: 'Отмена удаления:' })).toContainText(`Компания «${name}»: Отмена удаления: изменено 1, пропущено 0`),
  );
  await page.getByRole('banner').getByRole('button', { name: /Сменить компанию/ }).click();
  await page.getByRole('dialog', { name: 'Компании' }).getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log$`));
  await expect.poll(lettersTick).toBe('DCBA');
  await settled(() => expect(page.getByRole('status').filter({ hasText: 'Отмена удаления:' })).toContainText('Отмена удаления: изменено 1, пропущено 0'));
  await settled(() => expect(kaspiLink).toContainText(/₸\s980$/));

  // тост сам исчезает через 10 секунд
  await row('B').getByRole('checkbox').check();
  await bar.getByRole('button', { name: 'Удалить', exact: true }).click();
  await bar.getByRole('button', { name: 'Да, удалить' }).click();
  await expect(undo).toBeVisible();
  await page.clock.runFor(9_000);
  await expect(undo).toBeVisible();
  await page.clock.runFor(2_000);
  await expect(undo).toHaveCount(0);
});

test('«Указать»: два выбора подряд в одной строке — без ложного конфликта версии; строка ушла из фильтра — фокус на соседней или на заголовке', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await login(page);
  const cid = await createCompany(page, `ТОО Подряд ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Аренда' });
  await apiPost(page, `${base}/counterparties`, { name: 'ИП Клиент', type: 'client' });
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(3), accountId: kaspi, amount: 100, comment: 'операция A' });
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(2), accountId: kaspi, amount: 200, comment: 'операция B' });
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(1), accountId: kaspi, amount: 300, comment: 'операция C' });
  await page.reload();
  await expect.poll(() => letters(page)).toBe('CBA');
  const row = (letter: string) => bodyRows(page).filter({ hasText: `операция ${letter}` });

  // ответ PATCH задержан: второй выбор уходит, пока первый ещё в пути, — с версией из ответа первого, а не со старой
  const patches: number[] = [];
  const patchUrl = new RegExp(`/api/v1/companies/${cid}/operations/\\d+$`);
  await page.route(patchUrl, async (route) => {
    if (route.request().method() === 'PATCH') {
      patches.push((route.request().postDataJSON() as { version: number }).version);
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    await route.continue().catch(() => undefined);
  });
  await row('A').getByRole('button', { name: 'Указать контрагента' }).click();
  await page.getByRole('listbox', { name: 'Контрагенты' }).getByRole('option', { name: 'ИП Клиент' }).click();
  await row('A').getByRole('button', { name: 'Указать категорию' }).click();
  await page.getByRole('listbox', { name: 'Категории' }).getByRole('option', { name: 'Аренда' }).click();
  await expect(row('A')).toContainText('ИП Клиент');
  await expect(row('A')).toContainText('Аренда');
  await expect.poll(() => patches).toEqual([1, 2]);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.unroute(patchUrl);
  await page.reload();
  await expect(row('A')).toContainText('ИП Клиент');
  await expect(row('A')).toContainText('Аренда');
  await expect(page.getByRole('alert')).toHaveCount(0);

  // «Без категории»: назначенная строка уходит из выборки — фокус на строку, занявшую её место, а когда её нет — на заголовок
  await page.goto(`/c/${cid}/log?noCategory=1`);
  await expect.poll(() => letters(page)).toBe('CB');
  await row('C').getByRole('button', { name: 'Указать категорию' }).click();
  await page.getByRole('listbox', { name: 'Категории' }).getByRole('option', { name: 'Аренда' }).click();
  await expect.poll(() => letters(page)).toBe('B');
  await expect(row('B')).toBeFocused();
  await row('B').getByRole('button', { name: 'Указать категорию' }).click();
  await page.getByRole('listbox', { name: 'Категории' }).getByRole('option', { name: 'Аренда' }).click();
  await expect(page.getByText('По этому фильтру операций нет.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Журнал' })).toBeFocused();
});

test('архивная компания: журнал только для чтения — без «Указать», флажков и «Сохранить фильтр», одно уведомление', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Архивная ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(1), accountId: kaspi, amount: 100, comment: 'операция A' });
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: todayAgo(2), accountId: kaspi, amount: 100, comment: 'операция B' });
  await apiPost(page, `${base}/accounts/${kaspi}/archive`, {});
  await apiPost(page, `${base}/archive`, {});
  await page.reload();
  await expect.poll(() => letters(page)).toBe('AB');
  await expect(page.getByText('Компания в архиве — изменения недоступны')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Указать/ })).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  // «Быстрые фильтры» архивной компании: сохранять нечего — ни «Создать новый фильтр», ни подсказки про «Сохранить фильтр»
  await page.getByRole('button', { name: 'Быстрые фильтры' }).click();
  const quick = page.getByRole('dialog', { name: 'Быстрые фильтры' });
  await expect(quick).toContainText('Сохранённых фильтров нет.');
  await expect(quick.getByRole('button', { name: 'Создать новый фильтр' })).toHaveCount(0);
  await expect(quick).not.toContainText('Сохранить фильтр');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Фильтр/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Фильтр', exact: true });
  await expect(dialog.getByRole('button', { name: 'Готово' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Сохранить фильтр' })).toHaveCount(0);
});

test('сохранённые фильтры: повреждённый не применяется, но переименовывается и удаляется; «Отмена» сбрасывает название; Enter не сохраняет дважды', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Повреждён ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' });
  const listUrl = `**${base}/saved-filters`;
  await page.route(listUrl, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            savedFilters: [
              { id: 901, companyId: cid, name: 'Старый', filter: {}, unavailable: 0, invalid: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
            ],
          }),
        })
      : route.fallback(),
  );
  await page.reload();
  const menuButton = page.getByRole('button', { name: 'Быстрые фильтры' });
  await menuButton.click();
  const apply = page.getByRole('button', { name: /^Применить фильтр «Старый»/ });
  await expect(apply).toBeDisabled();
  await expect(apply).toContainText('(повреждён)');
  await expect(apply).toHaveAttribute('title', 'Фильтр повреждён: переименуйте или удалите его — условия не применяются');
  await expect(page.getByRole('button', { name: 'Переименовать фильтр «Старый»' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Удалить фильтр «Старый»' })).toBeEnabled();

  // «Отмена» в переименовании не оставляет правку: при повторном открытии — прежнее название
  await page.getByRole('button', { name: 'Переименовать фильтр «Старый»' }).click();
  const rename = page.getByLabel('Новое название фильтра «Старый»');
  await rename.fill('Что-то другое');
  await page.getByRole('button', { name: 'Отмена' }).click();
  await page.getByRole('button', { name: 'Переименовать фильтр «Старый»' }).click();
  await expect(rename).toHaveValue('Старый');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.unroute(listUrl);

  // Enter в поле названия, пока запрос в пути, не отправляет второй
  let posts = 0;
  await page.route(listUrl, async (route) => {
    if (route.request().method() === 'POST') {
      posts += 1;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await route.fallback();
  });
  await page.getByRole('button', { name: /^Фильтр/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Фильтр', exact: true });
  await dialog.getByRole('checkbox', { name: 'Доход' }).check();
  await dialog.getByRole('button', { name: 'Сохранить фильтр' }).click();
  const name = dialog.getByLabel('Название фильтра');
  await name.fill('Доходы');
  await name.press('Enter');
  await name.press('Enter');
  await expect(dialog).toBeHidden();
  expect(posts).toBe(1);
});

test('удаление без тоста «Отменить»: после ошибки фокус на «Удалить», после пустого итога — на итоге', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Без тоста ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  const op = (await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(1), accountId: kaspi, amount: 100, comment: 'операция A' })).operation;
  await page.reload();
  await expect.poll(() => letters(page)).toBe('A');
  const bar = page.getByRole('region', { name: 'Действия с выбранными' });
  const bulkUrl = `**${base}/operations/bulk`;
  const answers = [
    { status: 500, body: { error: { code: 'INTERNAL', message: 'Сбой удаления' } } },
    { status: 200, body: { changed: [], skipped: [{ id: op.id, reason: 'Операция уже удалена' }] } },
  ];
  await page.route(bulkUrl, (route) => {
    const answer = answers.shift();
    return answer ? route.fulfill({ status: answer.status, contentType: 'application/json', body: JSON.stringify(answer.body) }) : route.fallback();
  });
  await bodyRows(page).first().getByRole('checkbox').check();

  // ошибка: полоса остаётся, фокус возвращается на «Удалить»
  await bar.getByRole('button', { name: 'Удалить', exact: true }).click();
  await bar.getByRole('button', { name: 'Да, удалить' }).click();
  await expect(page.getByRole('alert')).toContainText('Сбой удаления');
  await expect(bar.getByRole('button', { name: 'Удалить', exact: true })).toBeFocused();

  // ничего не удалено: полоса исчезла вместе с выделением, итог с причиной получает фокус
  await bar.getByRole('button', { name: 'Удалить', exact: true }).click();
  await bar.getByRole('button', { name: 'Да, удалить' }).click();
  const summary = page.getByRole('status').filter({ hasText: 'Удаление:' });
  await expect(summary).toContainText('Удаление: изменено 0, пропущено 1');
  await expect(summary).toContainText('Операция уже удалена — 1');
  await expect(bar).toHaveCount(0);
  await expect(summary).toBeFocused();
});
