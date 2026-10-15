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

const section = (page: Page, name: string) => page.getByRole('navigation', { name: 'Разделы настроек' }).getByRole('link', { name });

const csrf = (page: Page) => ({ origin: new URL(page.url()).origin, 'x-requested-with': 'fetch' });

/** Запрос к API от имени вошедшего пользователя: кука сессии браузера и заголовки защиты от подделки. */
async function apiPost(page: Page, url: string, data: unknown) {
  const res = await page.request.post(url, { data, headers: csrf(page) });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return res.json();
}

const minuteAgo = () => new Date(Date.now() - 60_000).toISOString();

/**
 * Следит, появлялся ли текст на странице хоть в одной отрисовке (MutationObserver срабатывает до кадра): вспышка
 * «не найдена» или «В архиве» в окне, которое закрывается после своего действия (R5 плана 1.5-4b). Возвращает проверку.
 */
async function watchText(page: Page, text: string): Promise<() => Promise<boolean>> {
  const key = `seen:${text}`;
  await page.evaluate(
    ([t, k]) => {
      const w = window as unknown as Record<string, boolean>;
      w[k] = false;
      new MutationObserver(() => {
        if (document.body.textContent?.includes(t)) w[k] = true;
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    },
    [text, key] as const,
  );
  return () => page.evaluate((k) => (window as unknown as Record<string, boolean>)[k] === true, key);
}

test('счета: «Добавление нового счёта» — валюта, название, стартовый баланс; архив только при нулевом остатке, ошибка — в окне; удаление через подтверждение', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Счета ${Date.now()}`);
  await page.getByRole('banner').getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Настройки компании' }).click();
  await section(page, 'Счета').click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/accounts$`));
  const main = page.getByRole('main');

  await main.getByRole('button', { name: 'Добавить счёт' }).click();
  const dialog = page.getByRole('dialog', { name: 'Добавление нового счёта' });
  // порядок полей как в Finmap: валюта, название, стартовый баланс; затем наши проект и дата открытия
  await expect(dialog.locator('label')).toHaveText(['Валюта', 'Название счёта', 'Стартовый баланс', 'Проект', 'Дата открытия']);
  await expect(dialog.getByLabel('Валюта')).toBeFocused();
  await dialog.getByLabel('Валюта').selectOption('USD');
  await dialog.getByLabel('Название счёта').fill('Сейф');
  await dialog.getByLabel('Стартовый баланс').fill('1 500,505');
  await dialog.getByRole('button', { name: 'Создать счёт' }).click();
  await expect(dialog.getByText('Введите сумму, например 1 500,50')).toBeVisible();
  await expect(dialog.getByLabel('Стартовый баланс')).toHaveAttribute('aria-invalid', 'true');
  await dialog.getByLabel('Стартовый баланс').fill('1 500,50');
  await dialog.getByRole('button', { name: 'Создать счёт' }).click();
  await expect(dialog).toBeHidden();

  const row = main.getByRole('listitem').filter({ hasText: 'Сейф' });
  // серый текст — баланс со знаком валюты впереди
  await expect(row).toContainText(/\$\s1\s500,50/);
  const pencil = row.getByRole('button', { name: 'Изменить Сейф', exact: true });
  const edit = page.getByRole('dialog', { name: 'Счёт', exact: true });
  await pencil.click();
  await edit.getByRole('button', { name: 'В архив' }).click();
  // ошибка — в окне, окно открыто, форму можно поправить (Review Focus 4)
  await expect(edit.getByRole('alert')).toHaveText('Счёт можно перевести в архив только при нулевом балансе');
  // отказ не роняет фокус на body (aria-disabled вместо disabled)
  await expect(edit.getByRole('button', { name: 'В архив' })).toBeFocused();
  await edit.getByLabel('Стартовый баланс').fill('0');
  await edit.getByRole('button', { name: 'Сохранить' }).click();
  await expect(edit).toBeHidden();
  await pencil.click();
  await edit.getByRole('button', { name: 'В архив' }).click();
  await expect(edit).toBeHidden();
  await expect(row).toContainText('в архиве');

  // архивный: вместо формы — пояснение; «Удалить» — через подтверждение
  await pencil.click();
  await expect(edit).toContainText('В архиве. Чтобы изменить, сначала верните из архива.');
  await expect(edit.getByLabel('Название счёта')).toHaveCount(0);
  await edit.getByRole('button', { name: 'Удалить' }).click();
  await page.getByRole('alertdialog', { name: 'Удалить счёт «Сейф»?' }).getByRole('button', { name: 'Удалить' }).click();
  await expect(edit).toBeHidden();
  await expect(main.getByRole('listitem').filter({ hasText: 'Сейф' })).toHaveCount(0);
});

test('стартовый баланс счёта: принимает «-1500», буквы и второй разделитель отбрасываются', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Баланс ${Date.now()}`);
  await page.goto(`/c/${cid}/settings/accounts`);
  await page.getByRole('main').getByRole('button', { name: 'Добавить счёт' }).click();
  const dialog = page.getByRole('dialog', { name: 'Добавление нового счёта' });
  const balance = dialog.getByLabel('Стартовый баланс');
  await balance.fill('-1500');
  await expect(balance).toHaveValue('-1500');
  await balance.fill('abc');
  await expect(balance).toHaveValue('');
  await balance.fill('-12a3,4.5');
  await expect(balance).toHaveValue('-123,45');
  await balance.fill('5-3');
  await expect(balance).toHaveValue('53');
  await dialog.getByLabel('Название счёта').fill('Долговой');
  await balance.fill('-1500');
  await dialog.getByRole('button', { name: 'Создать счёт' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('main').getByRole('listitem').filter({ hasText: 'Долговой' })).toContainText(/\u2212₸\s1\s500/);
});

test('категории: подменю «Системные / Мои», «Добавить категорию», «+» подкатегория, окно «Категория» с «Перенести в…», поиск с родителем, порядок среди системных', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Категории ${Date.now()}`);
  await page.goto(`/c/${cid}/settings/categories`);
  const main = page.getByRole('main');
  const kinds = main.getByRole('navigation', { name: 'Виды категорий' });
  await expect(kinds.getByRole('link')).toHaveText(['Системные категории дохода', 'Системные категории расхода', 'Мои категории дохода', 'Мои категории расхода']);
  await expect(kinds.getByRole('link', { name: 'Мои категории расхода' })).toHaveAttribute('aria-current', 'page');
  const list = main.getByRole('list', { name: 'Мои категории расхода' });
  const created = page.getByRole('dialog', { name: 'Новая категория' });
  const sub = page.getByRole('dialog', { name: 'Новая подкатегория' });
  const edit = page.getByRole('dialog', { name: 'Категория', exact: true });

  // «Добавить категорию» → окно «Новая категория»
  for (const name of ['Реклама', 'Аренда']) {
    await main.getByRole('button', { name: 'Добавить категорию' }).click();
    await created.getByLabel('Название').fill(name);
    await created.getByRole('button', { name: 'Сохранить' }).click();
    await expect(created).toBeHidden();
  }
  // «+» у строки → «Новая подкатегория», родитель указан
  await list.getByRole('button', { name: 'Добавить подкатегорию в Реклама' }).click();
  await expect(sub).toContainText('Родитель: Реклама');
  await sub.getByLabel('Название').fill('Таргет');
  await sub.getByRole('button', { name: 'Сохранить' }).click();
  await expect(sub).toBeHidden();
  await expect(list.getByRole('listitem')).toHaveText([/Реклама/, /Таргет/, /Аренда/]);

  // ✎ — окно «Категория»: имя и «Перенести в…» на верхний уровень
  // у подкатегории ✎ называет и родителя: одноимённые в разных родителях различимы (M6)
  await list.getByRole('button', { name: 'Изменить Таргет в Реклама', exact: true }).click();
  await expect(edit.getByLabel('Перенести в…').locator('option:checked')).toHaveText('Реклама');
  await edit.getByLabel('Название').fill('Таргетинг');
  await edit.getByLabel('Перенести в…').selectOption({ label: 'Верхний уровень' });
  await edit.getByRole('button', { name: 'Сохранить' }).click();
  await expect(edit).toBeHidden();
  await expect(list.getByRole('listitem')).toHaveText([/Реклама/, /Аренда/, /Таргетинг/]);

  // категория с дочерними: переносить некуда (Review Focus 2)
  await list.getByRole('button', { name: 'Добавить подкатегорию в Аренда' }).click();
  await sub.getByLabel('Название').fill('Зал');
  await sub.getByRole('button', { name: 'Сохранить' }).click();
  await expect(sub).toBeHidden();
  await list.getByRole('button', { name: 'Изменить Аренда', exact: true }).click();
  await expect(edit.getByLabel('Перенести в…')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(edit).toBeHidden();

  // поиск: найденная подкатегория — вместе с родителем
  const search = main.getByRole('searchbox', { name: 'Поиск' });
  await search.fill('ЗАЛ');
  await expect(list.getByRole('listitem')).toHaveText([/Аренда/, /Зал/]);
  await search.fill('');

  // порядок своих среди системных: системные остаются на своих местах (Review Focus 1)
  const topExpense = async () => ((await (await page.request.get(`/api/v1/companies/${cid}/categories`)).json()).expense as { name: string }[]).map((c) => c.name);
  const own = ['Реклама', 'Аренда', 'Таргетинг'];
  const before = await topExpense();
  await list.getByRole('button', { name: 'Переместить Таргетинг', exact: true }).focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(list.getByRole('listitem')).toHaveText([/Реклама/, /Таргетинг/, /Аренда/, /Зал/]);
  const order = ['Реклама', 'Таргетинг', 'Аренда'];
  await expect.poll(topExpense).toEqual(before.map((name) => (own.includes(name) ? order[own.indexOf(name)]! : name)));

  // системные: вместо ✎ — «банк» с подсказкой, «+» есть, «Добавить категорию» нет
  await kinds.getByRole('link', { name: 'Системные категории расхода' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/categories\\?tab=system-expense$`));
  const system = main.getByRole('list', { name: 'Системные категории расхода' });
  const salary = system.getByRole('listitem').filter({ hasText: 'Зарплата' });
  await expect(salary.getByRole('img', { name: 'Системная — не переименовывается и не удаляется' })).toBeVisible();
  await expect(salary.getByRole('button', { name: /^Изменить/ })).toHaveCount(0);
  await expect(main.getByRole('button', { name: 'Добавить категорию' })).toHaveCount(0);
  await salary.getByRole('button', { name: 'Добавить подкатегорию в Зарплата' }).click();
  await sub.getByLabel('Название').fill('Администраторы');
  await sub.getByRole('button', { name: 'Сохранить' }).click();
  await expect(sub).toBeHidden();
  await expect(system.getByRole('button', { name: 'Изменить Администраторы в Зарплата', exact: true })).toBeVisible();

  // неверная вкладка в адресе — «Мои категории расхода»
  await page.goto(`/c/${cid}/settings/categories?tab=nope`);
  await expect(kinds.getByRole('link', { name: 'Мои категории расхода' })).toHaveAttribute('aria-current', 'page');
});

test('категории: ↑↓ в окне идут среди видимых своих (системные на местах), фокус на краю, отказ переноса виден в окне', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Категории окно ${Date.now()}`);
  const base = `/api/v1/companies/${cid}/categories`;
  for (const name of ['Альфа', 'Бета']) await apiPost(page, base, { kind: 'expense', name, parentId: null });
  const topExpense = async () => ((await (await page.request.get(base)).json()).expense as { id: number; name: string; systemKey: string | null }[]);
  // свои между системными: Системная1, Альфа, Системная2, Бета, остальные системные
  const all = await topExpense();
  const system = all.filter((c) => c.systemKey !== null);
  const alpha = all.find((c) => c.name === 'Альфа')!;
  const beta = all.find((c) => c.name === 'Бета')!;
  const ids = [system[0]!.id, alpha.id, system[1]!.id, beta.id, ...system.slice(2).map((c) => c.id)];
  await apiPost(page, `${base}/reorder`, { kind: 'expense', parentId: null, ids, moving: null });

  await page.goto(`/c/${cid}/settings/categories`);
  const main = page.getByRole('main');
  const list = main.getByRole('list', { name: 'Мои категории расхода' });
  await expect(list.getByRole('listitem')).toHaveText([/Альфа/, /Бета/]);
  const edit = page.getByRole('dialog', { name: 'Категория', exact: true });
  await list.getByRole('button', { name: 'Изменить Альфа', exact: true }).click();
  const up = edit.getByRole('button', { name: 'Выше: Альфа', exact: true });
  const down = edit.getByRole('button', { name: 'Ниже: Альфа', exact: true });
  await expect(up).toHaveAttribute('aria-disabled', 'true');
  await expect(down).not.toHaveAttribute('aria-disabled', 'true');

  // ↓: Альфа меняется местами с Бета, системные остаются на своих местах
  await down.click();
  await expect.poll(async () => (await topExpense()).map((c) => c.name)).toEqual(ids.map((id) => (id === alpha.id ? 'Бета' : id === beta.id ? 'Альфа' : all.find((c) => c.id === id)!.name)));
  await expect(list.getByRole('listitem')).toHaveText([/Бета/, /Альфа/]);
  // дошли до края: ↓ погас, фокус перешёл на ↑
  await expect(down).toHaveAttribute('aria-disabled', 'true');
  await expect(up).toBeFocused();

  // отказ сервера при переносе: сообщение поля — в окне, окно открыто
  await page.route('**/api/v1/companies/*/categories/reorder', (route) =>
    route.fulfill({ status: 422, json: { error: { code: 'VALIDATION', message: 'Проверьте поля', fields: { parentId: 'Сюда переносить нельзя' } } } }),
  );
  await edit.getByLabel('Перенести в…').selectOption({ label: 'Бета' });
  await edit.getByRole('button', { name: 'Сохранить' }).click();
  await expect(edit.getByRole('alert')).toHaveText('Сюда переносить нельзя');
  await expect(edit).toBeVisible();
});

test('контрагенты: подменю типов в порядке Finmap, «Мои контрагенты» по умолчанию, окно с типом, поиск, порядок в своей вкладке', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Контрагенты ${Date.now()}`);
  await page.goto(`/c/${cid}/settings/counterparties`);
  const main = page.getByRole('main');
  const types = main.getByRole('navigation', { name: 'Типы контрагентов' });
  await expect(types.getByRole('link')).toHaveText([/^Инвесторы/, /^Кредиторы/, /^Заёмщики/, /^Сотрудники/, /^Владельцы/, /^Типы налогов/, /^Мои контрагенты/]);
  await expect(types.getByRole('link', { name: /^Мои контрагенты/ })).toHaveAttribute('aria-current', 'page');

  // «Мои»: тип — переключателем в окне, по умолчанию «Клиент»
  await main.getByRole('button', { name: 'Добавить контрагента' }).click();
  const created = page.getByRole('dialog', { name: 'Новый контрагент' });
  await expect(created.getByRole('radio', { name: 'Клиент' })).toBeChecked();
  await created.getByLabel('Название').fill('ИП Иванов');
  await created.getByLabel('Комментарий').fill('аренда зала');
  await created.getByRole('radio', { name: 'Поставщик' }).check();
  await created.getByRole('button', { name: 'Сохранить' }).click();
  await expect(created).toBeHidden();
  const my = main.getByRole('list', { name: 'Мои контрагенты' });
  await expect(my.getByRole('listitem')).toHaveText([/ИП Иванов\s*Поставщик · аренда зала/]);

  // «Сотрудники»: своя кнопка и заголовок окна, тип — по вкладке
  await types.getByRole('link', { name: /^Сотрудники/ }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/counterparties\\?type=employee$`));
  const staffDialog = page.getByRole('dialog', { name: 'Новый сотрудник' });
  for (const name of ['Пётр Админов', 'Анна Кассир']) {
    // между сотрудниками в общем порядке стоит клиент: «остальные остаются на месте» проверяется не только на краю
    if (name === 'Анна Кассир') await apiPost(page, `/api/v1/companies/${cid}/counterparties`, { type: 'client', name: 'ИП Сидоров', comment: '' });
    await main.getByRole('button', { name: 'Добавить сотрудника' }).click();
    await expect(staffDialog.getByRole('radio')).toHaveCount(0);
    await staffDialog.getByLabel('Название').fill(name);
    await staffDialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(staffDialog).toBeHidden();
  }
  const staff = main.getByRole('list', { name: 'Сотрудники' });
  await expect(staff.getByRole('listitem')).toHaveText([/Пётр Админов/, /Анна Кассир/]);
  await expect(types.getByRole('link', { name: /^Сотрудники/ })).toContainText('2');
  // имя ссылки со счётчиком читается раздельно (не «Сотрудники2»)
  await expect(types.getByRole('link', { name: /^Сотрудники\s?,\s?2$/ })).toBeVisible();

  // порядок — в своей вкладке; «Мои» в общем порядке остаются на месте (Review Focus 1)
  const all = async () =>
    ((await (await page.request.get(`/api/v1/companies/${cid}/counterparties`)).json()).counterparties as { name: string; type: string }[]).map((c) => `${c.type}:${c.name}`);
  await staff.getByRole('button', { name: 'Переместить Анна Кассир', exact: true }).focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(staff.getByRole('listitem')).toHaveText([/Анна Кассир/, /Пётр Админов/]);
  await expect.poll(all).toEqual(['supplier:ИП Иванов', 'employee:Анна Кассир', 'client:ИП Сидоров', 'employee:Пётр Админов']);

  // поиск без учёта регистра и «ё»
  await main.getByRole('searchbox', { name: 'Поиск' }).fill('петр');
  await expect(staff.getByRole('listitem')).toHaveText([/Пётр Админов/]);

  // ✎ в «Моих» — окно «Контрагент», тип меняется; поиск — и по комментарию
  await types.getByRole('link', { name: /^Мои контрагенты/ }).click();
  // список вкладки монтируется заново (key={tab}) с пустым поиском: ввод до смены вкладки попал бы в поле
  // «Сотрудников» и пропал (сбой в полном прогоне финальной волны 1.5-4b)
  await expect(my).toBeVisible();
  await main.getByRole('searchbox', { name: 'Поиск' }).fill('ЗАЛА');
  await expect(my.getByRole('listitem')).toHaveText([/ИП Иванов/]);
  await my.getByRole('button', { name: 'Изменить ИП Иванов', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Контрагент', exact: true });
  await edit.getByRole('radio', { name: 'Клиент' }).check();
  await edit.getByRole('button', { name: 'Сохранить' }).click();
  await expect(edit).toBeHidden();
  await expect(my.getByRole('listitem')).toHaveText([/ИП Иванов\s*Клиент · аренда зала/]);

  // «Типы налогов»: своя кнопка и окно, тип — по вкладке
  await types.getByRole('link', { name: /^Типы налогов/ }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/counterparties\\?type=tax$`));
  await main.getByRole('button', { name: 'Добавить тип налога' }).click();
  const taxDialog = page.getByRole('dialog', { name: 'Новый тип налога' });
  await expect(taxDialog.getByRole('radio')).toHaveCount(0);
  await taxDialog.getByLabel('Название').fill('НДС');
  await taxDialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(taxDialog).toBeHidden();
  await expect(main.getByRole('list', { name: 'Типы налогов' }).getByRole('listitem')).toHaveText([/НДС/]);
  await expect.poll(all).toContain('tax:НДС');

  // неверный тип в адресе — «Мои контрагенты»
  await page.goto(`/c/${cid}/settings/counterparties?type=nope`);
  await expect(types.getByRole('link', { name: /^Мои контрагенты/ })).toHaveAttribute('aria-current', 'page');
});

test('шаблоны разделения — вкладка «Проектов»: «Создать шаблон» в окне, сохранить можно только при 100%; ✎ и удаление', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Разделение ${Date.now()}`);
  for (const name of ['Клуб 1', 'Клуб 2']) await apiPost(page, `/api/v1/companies/${cid}/projects`, { name, templateKey: 'general' });
  await page.goto(`/c/${cid}/settings/projects`);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: 'Проекты' })).toBeVisible();
  const tabs = main.getByRole('navigation', { name: 'Проекты и шаблоны' });
  await tabs.getByRole('link', { name: 'Шаблоны разделения' }).click();
  await expect(page).toHaveURL(/\/settings\/projects\/split-presets$/);
  await expect(tabs.getByRole('link', { name: 'Шаблоны разделения' })).toHaveAttribute('aria-current', 'page');
  // заголовок раздела один и тот же, вкладка показывает, где вы (как в Finmap)
  await expect(main.getByRole('heading', { level: 1, name: 'Проекты' })).toBeVisible();

  await main.getByRole('button', { name: 'Создать шаблон' }).click();
  const dialog = page.getByRole('dialog', { name: 'Новый шаблон' });
  await dialog.getByLabel('Название шаблона').fill('Аренда пополам');
  await dialog.getByLabel('Проект, строка 1').selectOption({ label: 'Клуб 1' });
  await dialog.getByLabel('Доля %, строка 1').fill('50');
  await dialog.getByLabel('Проект, строка 2').selectOption({ label: 'Клуб 2' });
  await dialog.getByLabel('Доля %, строка 2').fill('40');
  await expect(dialog.getByRole('status').filter({ hasText: 'Распределено' })).toHaveText('Распределено 90% из 100% · осталось 10%');
  await expect(dialog.getByRole('button', { name: 'Сохранить шаблон' })).toBeDisabled();
  await dialog.getByLabel('Доля %, строка 2').fill('50');
  await dialog.getByRole('button', { name: 'Сохранить шаблон' }).click();
  await expect(dialog).toBeHidden();

  const row = main.getByRole('listitem').filter({ hasText: 'Аренда пополам' });
  await expect(row).toContainText('Клуб 1 — 50%');
  await expect(row).toContainText('Клуб 2 — 50%');

  // ✎ — окно «Шаблон разделения» с долями; «Удалить» через подтверждение
  await row.getByRole('button', { name: 'Изменить Аренда пополам', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Шаблон разделения', exact: true });
  await expect(edit.getByLabel('Доля %, строка 2')).toHaveValue('50');
  await edit.getByRole('button', { name: 'Удалить', exact: true }).click();
  await page.getByRole('alertdialog', { name: 'Удалить шаблон «Аренда пополам»?' }).getByRole('button', { name: 'Удалить' }).click();
  await expect(edit).toBeHidden();
  await expect(main.getByRole('listitem').filter({ hasText: 'Аренда пополам' })).toHaveCount(0);
});

test('переименование проекта переименовывает его счета; Alt+↓ меняет порядок счетов', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Переименование ${Date.now()}`);
  await page.goto(`/c/${cid}/settings/projects`);
  await page.getByRole('button', { name: 'Добавить проект' }).click();
  const created = page.getByRole('dialog', { name: 'Новый проект' });
  // окно проекта: сначала шаблон (на нём начальный фокус), затем название и параметры (§7.4)
  await expect(created.getByLabel('Тип бизнеса')).toBeFocused();
  await created.getByLabel('Тип бизнеса').selectOption('computer-club');
  await expect(created.locator('label')).toHaveText(['Тип бизнеса', 'Название проекта', 'Количество ПК', 'Количество консолей']);
  await created.getByLabel('Название проекта').fill('Клуб А');
  await created.getByLabel('Количество ПК').fill('1e3');
  await created.getByRole('button', { name: 'Создать проект' }).click();
  await expect(created.getByText('Введите целое число')).toBeVisible();
  await created.getByLabel('Количество ПК').fill('10');
  await created.getByRole('button', { name: 'Создать проект' }).click();
  await expect(created).toBeHidden();

  await page.getByRole('button', { name: 'Изменить Клуб А', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Проект', exact: true });
  await edit.getByLabel('Название проекта').fill('Клуб Б');
  await expect(edit.getByLabel('Переименовать счета')).toBeChecked();
  await edit.getByRole('button', { name: 'Сохранить' }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByRole('main').getByRole('status')).toHaveText('Переименовано счетов: 2');

  await section(page, 'Счета').click();
  const accounts = page.getByRole('main').getByRole('list', { name: 'Счета' });
  // без групп по клубам: клуб — в сером тексте строки (§7.4)
  await expect(accounts.getByRole('listitem')).toHaveText([/Касса Клуб Б\s*Клуб Б/, /Kaspi Клуб Б\s*Клуб Б/]);
  await accounts.getByRole('button', { name: 'Переместить Касса Клуб Б', exact: true }).focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(accounts.getByRole('listitem').first()).toContainText('Kaspi Клуб Б');
  await expect
    .poll(async () => ((await (await page.request.get(`/api/v1/companies/${cid}/accounts`)).json()).accounts as { name: string }[]).map((a) => a.name))
    .toEqual(['Kaspi Клуб Б', 'Касса Клуб Б']);
});

test('проекты и шаблоны разделения: Alt+↓ на ☰ меняет порядок на сервере; архивный проект — в конце без ☰', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Порядок проектов ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const ids: number[] = [];
  for (const name of ['Клуб 1', 'Клуб 2', 'Клуб 3']) ids.push((await apiPost(page, `${base}/projects`, { name, templateKey: 'general' })).project.id);
  for (const name of ['Шаблон 1', 'Шаблон 2']) {
    await apiPost(page, `${base}/split-presets`, {
      name,
      lines: [
        { categoryId: null, projectId: ids[0], bp: 5000 },
        { categoryId: null, projectId: ids[1], bp: 5000 },
      ],
    });
  }
  await apiPost(page, `${base}/projects/${ids[2]}/archive`, {});
  const main = page.getByRole('main');
  const names = async (path: string) => {
    const body = (await (await page.request.get(`${base}/${path}`)).json()) as Record<string, { name: string }[]>;
    return Object.values(body)[0]!.map((x) => x.name);
  };

  await page.goto(`/c/${cid}/settings/projects`);
  const projects = main.getByRole('list', { name: 'Проекты' });
  await expect(projects.getByRole('listitem')).toHaveCount(3);
  // архивный — последний и без ☰
  await expect(projects.getByRole('listitem').last()).toContainText('Клуб 3');
  await expect(projects.getByRole('button', { name: 'Переместить Клуб 3', exact: true })).toHaveCount(0);
  await projects.getByRole('button', { name: 'Переместить Клуб 1', exact: true }).focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(projects.getByRole('listitem').first()).toContainText('Клуб 2');
  await expect.poll(() => names('projects')).toEqual(['Клуб 2', 'Клуб 1', 'Клуб 3']);

  await page.goto(`/c/${cid}/settings/projects/split-presets`);
  const presets = main.getByRole('list', { name: 'Шаблоны разделения' });
  await expect(presets.getByRole('listitem')).toHaveCount(2);
  await presets.getByRole('button', { name: 'Переместить Шаблон 1', exact: true }).focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(presets.getByRole('listitem').first()).toContainText('Шаблон 2');
  await expect.poll(() => names('split-presets')).toEqual(['Шаблон 2', 'Шаблон 1']);
});

test('архивная компания: на «Проектах», «Шаблонах разделения» и «Категориях» нет «Добавить», «+», ☰ и ✎', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Архив проектов ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const ids: number[] = [];
  for (const name of ['Клуб 1', 'Клуб 2']) ids.push((await apiPost(page, `${base}/projects`, { name, templateKey: 'general' })).project.id);
  await apiPost(page, `${base}/split-presets`, {
    name: 'Пополам',
    lines: [
      { categoryId: null, projectId: ids[0], bp: 5000 },
      { categoryId: null, projectId: ids[1], bp: 5000 },
    ],
  });
  const rent = (await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Аренда', parentId: null })).category.id;
  for (const name of ['Зал', 'Склад']) await apiPost(page, `${base}/categories`, { kind: 'expense', name, parentId: rent });
  await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Реклама', parentId: null });
  const main = page.getByRole('main');
  // у активной компании управление есть — иначе проверка ниже ничего не доказывает
  await page.goto(`/c/${cid}/settings/projects`);
  await expect(main.getByRole('button', { name: 'Добавить проект' })).toBeVisible();
  await expect(main.getByRole('button', { name: /^Переместить/ })).toHaveCount(2);
  await page.goto(`/c/${cid}/settings/categories`);
  await expect(main.getByRole('button', { name: 'Добавить категорию' })).toBeVisible();
  await expect(main.getByRole('button', { name: /^Добавить подкатегорию/ })).toHaveCount(2);
  await expect(main.getByRole('button', { name: /^Переместить/ })).toHaveCount(4);
  await apiPost(page, `${base}/archive`, {});

  for (const [path, heading, add] of [
    ['projects', 'Проекты', 'Добавить проект'],
    ['projects/split-presets', 'Проекты', 'Создать шаблон'],
    ['categories', 'Категории', 'Добавить категорию'],
  ] as const) {
    await page.goto(`/c/${cid}/settings/${path}`);
    await expect(main.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expect(main.getByText('Компания в архиве — изменения недоступны.')).toBeVisible();
    await expect(main.getByRole('listitem').first()).toBeVisible();
    await expect(main.getByRole('button', { name: add })).toHaveCount(0);
    await expect(main.getByRole('button', { name: /^Добавить подкатегорию/ })).toHaveCount(0);
    await expect(main.getByRole('button', { name: /^Переместить/ })).toHaveCount(0);
    await expect(main.getByRole('button', { name: /^Изменить/ })).toHaveCount(0);
  }

  // системные: «банк» на месте, «+» и ✎ нет
  await page.goto(`/c/${cid}/settings/categories?tab=system-expense`);
  const salary = main.getByRole('list', { name: 'Системные категории расхода' }).getByRole('listitem').filter({ hasText: 'Зарплата' });
  await expect(salary.getByRole('img', { name: 'Системная — не переименовывается и не удаляется' })).toBeVisible();
  await expect(main.getByRole('button', { name: /^Добавить подкатегорию/ })).toHaveCount(0);
  await expect(main.getByRole('button', { name: /^Изменить/ })).toHaveCount(0);
});

test('окно «Категория»: архив (строка приглушена, без «+»), «В архиве» и возврат, отказ удаления, удаление через подтверждение; одноимённые подкатегории различимы', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Архив категорий ${Date.now()}`);
  const base = `/api/v1/companies/${cid}/categories`;
  await apiPost(page, base, { kind: 'expense', name: 'Склад', parentId: null });
  const rent = (await apiPost(page, base, { kind: 'expense', name: 'Аренда', parentId: null })).category.id;
  const ads = (await apiPost(page, base, { kind: 'expense', name: 'Реклама', parentId: null })).category.id;
  const hall = (await apiPost(page, base, { kind: 'expense', name: 'Зал', parentId: rent })).category.id;
  await apiPost(page, base, { kind: 'expense', name: 'Сцена', parentId: rent });
  await apiPost(page, base, { kind: 'expense', name: 'Зал', parentId: ads });
  await page.goto(`/c/${cid}/settings/categories`);
  const main = page.getByRole('main');
  const list = main.getByRole('list', { name: 'Мои категории расхода' });
  const edit = page.getByRole('dialog', { name: 'Категория', exact: true });
  const confirm = page.getByRole('alertdialog', { name: /^Удалить/ });

  // одноимённые подкатегории: ✎ и ☰ называют родителя (M6)
  await expect(list.getByRole('button', { name: 'Изменить Зал в Аренда', exact: true })).toHaveCount(1);
  await expect(list.getByRole('button', { name: 'Изменить Зал в Реклама', exact: true })).toHaveCount(1);
  await expect(list.getByRole('button', { name: 'Переместить Зал в Аренда', exact: true })).toHaveCount(1);

  // удалить категорию с дочерними нельзя: ошибка в окне, окно открыто, фокус на «Удалить»
  await list.getByRole('button', { name: 'Изменить Аренда', exact: true }).click();
  await edit.getByRole('button', { name: 'Удалить' }).click();
  await expect(confirm).toHaveAccessibleName('Удалить категорию «Аренда»?');
  await confirm.getByRole('button', { name: 'Удалить' }).click();
  await expect(confirm).toBeHidden();
  await expect(edit.getByRole('alert')).toHaveText('Сначала удалите или перенесите дочерние категории');
  await expect(edit.getByRole('button', { name: 'Удалить' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(edit).toBeHidden();

  // «В архив» из окна: окно закрылось, строка ушла в конец, приглушена, без «+» и ☰
  await expect(list.getByRole('listitem').first()).toContainText('Склад');
  await list.getByRole('button', { name: 'Изменить Склад', exact: true }).click();
  const archivedNoteFlashed = await watchText(page, 'В архиве. Чтобы изменить');
  await edit.getByRole('button', { name: 'В архив' }).click();
  await expect(edit).toBeHidden();
  expect(await archivedNoteFlashed(), 'окно закрывается без кадра «В архиве» вместо формы').toBe(false);
  const archived = list.getByRole('listitem').last();
  await expect(archived).toContainText('Склад');
  await expect(archived).toContainText('в архиве');
  await expect(archived.getByRole('button', { name: 'Добавить подкатегорию в Склад' })).toHaveCount(0);
  await expect(archived.getByRole('button', { name: 'Переместить Склад', exact: true })).toHaveCount(0);
  await expect(list.getByRole('button', { name: 'Добавить подкатегорию в Реклама' })).toBeVisible();

  // снова ✎: пояснение вместо формы, «Вернуть из архива»
  await list.getByRole('button', { name: 'Изменить Склад', exact: true }).click();
  await expect(edit.getByText('В архиве. Чтобы изменить, сначала верните из архива.')).toBeVisible();
  await expect(edit.getByLabel('Название')).toHaveCount(0);
  await edit.getByRole('button', { name: 'Вернуть из архива' }).click();
  await expect(edit).toBeHidden();
  await expect(list.getByRole('button', { name: 'Добавить подкатегорию в Склад' })).toBeVisible();

  // удаление через подтверждение: строки больше нет, «не найдена» не мелькает
  await list.getByRole('button', { name: 'Изменить Склад', exact: true }).click();
  await edit.getByRole('button', { name: 'Удалить' }).click();
  await expect(confirm).toHaveAccessibleName('Удалить категорию «Склад»?');
  const notFoundFlashed = await watchText(page, 'Категория не найдена');
  await confirm.getByRole('button', { name: 'Удалить' }).click();
  await expect(edit).toBeHidden();
  expect(await notFoundFlashed(), 'окно закрывается без кадра «не найдена»').toBe(false);
  await expect(list.getByRole('button', { name: 'Изменить Склад', exact: true })).toHaveCount(0);
  await expect(list.getByRole('listitem')).toHaveText([/Аренда/, /Зал/, /Сцена/, /Реклама/, /Зал/]);

  // удалили в другом месте, пока окно открыто: после перечитывания дерева окно говорит «не найдена»
  await list.getByRole('button', { name: 'Изменить Зал в Аренда', exact: true }).click();
  const removed = await page.request.delete(`${base}/${hall}`, { headers: csrf(page) });
  expect(removed.status()).toBe(204);
  // ↓ — запрос с устаревшим порядком: сервер отказывает, дерево перечитывается
  await edit.getByRole('button', { name: 'Ниже: Зал', exact: true }).click();
  await expect(edit).toContainText('Категория не найдена — возможно, её удалили.');
  await expect(edit.getByLabel('Название')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(list.getByRole('listitem')).toHaveText([/Аренда/, /Сцена/, /Реклама/, /Зал/]);
});

test('окно проекта: ошибка сервера — в окне, оно остаётся; архив из окна — «В архиве» без формы, «Вернуть из архива»', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Окно проекта ${Date.now()}`);
  await apiPost(page, `/api/v1/companies/${cid}/projects`, { name: 'Клуб', templateKey: 'general' });
  await page.goto(`/c/${cid}/settings/projects`);
  const main = page.getByRole('main');

  await main.getByRole('button', { name: 'Добавить проект' }).click();
  const created = page.getByRole('dialog', { name: 'Новый проект' });
  await created.getByLabel('Тип бизнеса').selectOption('general');
  await created.getByLabel('Название проекта').fill('Клуб');
  await created.getByRole('button', { name: 'Создать проект' }).click();
  await expect(created.getByText('Проект с таким названием уже есть')).toBeVisible();
  await expect(created).toBeVisible();
  await created.getByRole('button', { name: 'Отмена' }).click();
  await expect(created).toBeHidden();

  await main.getByRole('button', { name: 'Изменить Клуб', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Проект', exact: true });
  await edit.getByRole('button', { name: 'В архив' }).click();
  await expect(edit).toBeHidden();

  await main.getByRole('button', { name: 'Изменить Клуб', exact: true }).click();
  await expect(edit.getByText('В архиве. Чтобы изменить, сначала верните из архива.')).toBeVisible();
  await expect(edit.getByLabel('Название проекта')).toHaveCount(0);
  await edit.getByRole('button', { name: 'Вернуть из архива' }).click();
  await expect(edit).toBeHidden();

  await main.getByRole('button', { name: 'Изменить Клуб', exact: true }).click();
  await expect(edit.getByLabel('Название проекта')).toHaveValue('Клуб');
});

test('зона настроек: разделы по группам, без панели счетов и вкладок; адреса и перенаправления; «← Назад к журналу» с фильтром', async ({ page }) => {
  await login(page);
  const name = `ТОО Зона ${Date.now()}`;
  const cid = await createCompany(page, name);
  const other = await createCompany(page, `ТОО Зона 2 ${Date.now()}`);

  // журнал с фильтром → настройки без раздела → контрагенты
  await page.goto(`/c/${cid}/log?period=month`);
  await expect(page.getByRole('heading', { name: 'Журнал' })).toBeAttached();
  await page.goto(`/c/${cid}/settings`);
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/counterparties$`));
  await expect(page.getByRole('navigation', { name: 'Счета' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Журнал', exact: true })).toHaveCount(0);

  const nav = page.getByRole('navigation', { name: 'Разделы настроек' });
  await expect(nav.getByRole('link')).toHaveText([
    /Назад к журналу/,
    'Профиль',
    'Мои компании',
    'Контрагенты',
    'Счета',
    'Категории',
    'Проекты',
    'Теги',
    'Склады',
    'Пользователи',
    'Фиксированные курсы валют',
    'Резервное копирование',
    'Настройки журнала',
  ]);
  await expect(nav).toContainText(name);
  await expect(nav).toContainText('Визуальные настройки');
  // группы навигации — с именами (итоги 1.5-1b №1)
  await expect(nav.getByRole('group', { name: 'Мой аккаунт' }).getByRole('link')).toHaveText(['Профиль', 'Мои компании']);
  await expect(nav.getByRole('group', { name }).getByRole('link')).toHaveText([
    'Контрагенты',
    'Счета',
    'Категории',
    'Проекты',
    'Теги',
    'Склады',
    'Пользователи',
    'Фиксированные курсы валют',
    'Резервное копирование',
  ]);
  await expect(nav.getByRole('group', { name: 'Визуальные настройки' }).getByRole('link')).toHaveText(['Настройки журнала']);
  await expect(nav.getByRole('link', { name: 'Контрагенты' })).toHaveAttribute('aria-current', 'page');

  // общий для экземпляра раздел — серая строка
  await nav.getByRole('link', { name: 'Пользователи' }).click();
  await expect(page.getByRole('main')).toContainText('Общие для всех компаний');

  // старый адрес шаблонов разделения — вкладка раздела «Проекты»
  await page.goto(`/c/${cid}/settings/split-presets`);
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/projects/split-presets$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Проекты' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Проекты и шаблоны' }).getByRole('link', { name: 'Шаблоны разделения' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Проекты' })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('navigation', { name: 'Проекты и шаблоны' }).getByRole('link', { name: 'Проекты' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/projects$`));
  // история действий — по прежнему адресу, но не в навигации
  await page.goto(`/c/${cid}/settings/audit`);
  await expect(page.getByRole('heading', { level: 1, name: 'История действий' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'История действий' })).toHaveCount(0);
  // неизвестный раздел
  await page.goto(`/c/${cid}/settings/nope`);
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/counterparties$`));

  // «← Назад к журналу» — тот же фильтр
  await nav.getByRole('link', { name: /Назад к журналу/ }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log\\?period=month$`));
  // ссылка исчезла вместе с меню настроек — фокус на заголовке журнала
  await expect(page.getByRole('heading', { level: 1, name: 'Журнал' })).toBeFocused();
  // у другой компании журнал запомнился без фильтра
  await page.goto(`/c/${other}/settings/tags`);
  await nav.getByRole('link', { name: /Назад к журналу/ }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${other}/log$`));
});

test('шаблон списка на «Тегах»: добавить, ✎, архив и возврат, удалить через подтверждение, поиск; имя архивного тега предлагает вернуть его', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Теги ${Date.now()}`);
  await page.goto(`/c/${cid}/settings/tags`);
  const main = page.getByRole('main');
  const list = main.getByRole('list', { name: 'Теги' });
  const row = (name: string) => list.getByRole('listitem').filter({ hasText: name });
  const add = main.getByRole('button', { name: 'Добавить тег' });
  const dialog = page.getByRole('dialog', { name: 'Новый тег' });
  const edit = page.getByRole('dialog', { name: 'Тег', exact: true });

  // «Добавить тег» → окно «Новый тег», фокус в поле
  for (const name of ['Ёлка', 'Аренда', 'Бар']) {
    await add.click();
    await expect(dialog.getByLabel('Название тега')).toBeFocused();
    await dialog.getByLabel('Название тега').fill(name);
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(dialog).toBeHidden();
    if (name === 'Ёлка') {
      // единственная активная строка: двигать нечего — ни ручки, ни Alt+↑/↓ (Review Focus 5)
      await expect(list.getByRole('listitem')).toHaveText([/Ёлка/]);
      await expect(list.getByRole('button', { name: /^Переместить/ })).toHaveCount(0);
    }
  }
  await expect(list.getByRole('listitem')).toHaveText([/Ёлка/, /Аренда/, /Бар/]);

  // ✎ — окно «Тег»: переименование, фокус возвращается на ✎
  await list.getByRole('button', { name: 'Изменить Аренда', exact: true }).click();
  await edit.getByLabel('Название тега').fill('Аренда зала');
  await edit.getByRole('button', { name: 'Сохранить' }).click();
  await expect(edit).toBeHidden();
  await expect(list.getByRole('button', { name: 'Изменить Аренда зала', exact: true })).toBeFocused();

  // «В архив» в окне: строка уходит в конец с пометкой «в архиве», ручки у неё нет
  await list.getByRole('button', { name: 'Изменить Ёлка', exact: true }).click();
  await edit.getByRole('button', { name: 'В архив' }).click();
  await expect(edit).toBeHidden();
  await expect(list.getByRole('listitem')).toHaveText([/Аренда зала/, /Бар/, /Ёлка.*в архиве/]);
  await expect(row('Ёлка').getByRole('button', { name: /^Переместить/ })).toHaveCount(0);
  // окно архивного: пояснение вместо формы
  await list.getByRole('button', { name: 'Изменить Ёлка', exact: true }).click();
  await expect(edit).toContainText('В архиве. Чтобы изменить, сначала верните из архива.');
  await expect(edit.getByLabel('Название тега')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(edit).toBeHidden();

  // имя архивного тега при создании — предложение вернуть его
  await add.click();
  await dialog.getByLabel('Название тега').fill('елка');
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  const offer = dialog.getByRole('alert').filter({ hasText: 'есть в архиве' });
  await expect(offer).toContainText('Тег «Ёлка» есть в архиве');
  await offer.getByRole('button', { name: 'Вернуть из архива' }).click();
  await expect(dialog).toBeHidden();
  await expect(row('Ёлка')).not.toContainText('в архиве');

  // «Удалить» — подтверждение «Отменить | Удалить»
  await list.getByRole('button', { name: 'Изменить Бар', exact: true }).click();
  await edit.getByRole('button', { name: 'Удалить' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Удалить тег «Бар»?' });
  await expect(confirm).toContainText('Это нельзя отменить.');
  await expect(confirm.getByRole('button', { name: 'Отменить' })).toBeFocused();
  await confirm.getByRole('button', { name: 'Отменить' }).click();
  await expect(confirm).toBeHidden();
  await expect(edit).toBeVisible();
  await edit.getByRole('button', { name: 'Удалить' }).click();
  await confirm.getByRole('button', { name: 'Удалить' }).click();
  await expect(edit).toBeHidden();
  await expect(row('Бар')).toHaveCount(0);
  await expect(main.getByRole('heading', { level: 1, name: 'Теги' })).toBeFocused();

  // поиск без учёта регистра и «ё»
  const search = main.getByRole('searchbox', { name: 'Поиск' });
  await search.fill('ЕЛ');
  await expect(list.getByRole('listitem')).toHaveText([/Ёлка/]);
  await search.fill('нет такого');
  await expect(main).toContainText('Ничего не найдено.');
});

test('шаблон списка: порядок за ☰ мышью и Alt+↑/↓ с объявлением; отказ сервера; «Удалить» не прошло — ошибка в окне', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Порядок тегов ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const tagIds: number[] = [];
  for (const name of ['Альфа', 'Бета', 'Гамма']) tagIds.push((await apiPost(page, `${base}/tags`, { name })).tag.id);
  await page.goto(`/c/${cid}/settings/tags`);
  const main = page.getByRole('main');
  const list = main.getByRole('list', { name: 'Теги' });
  const order = async () => ((await (await page.request.get(`${base}/tags`)).json()).tags as { name: string }[]).map((t) => t.name);
  let reorders = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/tags/reorder')) reorders++;
  });

  // клавиатура: Alt+↓ на ручке — строка ниже, фокус на ручке, новое место объявлено
  const alpha = list.getByRole('button', { name: 'Переместить Альфа', exact: true });
  await expect(alpha).toHaveAccessibleDescription(/Alt/);
  await alpha.focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(list.getByRole('listitem')).toHaveText([/Бета/, /Альфа/, /Гамма/]);
  await expect(alpha).toBeFocused();
  await expect(main).toContainText('«Альфа» — место 2 из 3');
  await expect.poll(order).toEqual(['Бета', 'Альфа', 'Гамма']);
  await page.keyboard.press('Alt+ArrowUp');
  await expect.poll(order).toEqual(['Альфа', 'Бета', 'Гамма']);
  // сервер мог ответить раньше, чем список отрисовал новый порядок: ждём отрисовку, иначе Alt+↑ ниже двигал бы
  // «Альфу» со второго места прежней отрисовки (лишний запрос; сбой в полном прогоне финальной волны 1.5-4b)
  await expect(list.getByRole('listitem')).toHaveText([/Альфа/, /Бета/, /Гамма/]);
  // Alt+↑ на первой строке ничего не меняет (Review Focus 5)
  const sent = reorders;
  await page.keyboard.press('Alt+ArrowUp');
  await expect(list.getByRole('listitem')).toHaveText([/Альфа/, /Бета/, /Гамма/]);
  // исключение из «без фиксированных пауз»: отсутствие запроса иначе не доказать, только подождать
  await page.waitForTimeout(300);
  expect(reorders, 'запрос на сервер не уходит').toBe(sent);
  expect(await order()).toEqual(['Альфа', 'Бета', 'Гамма']);

  // мышь: «Гамма» за ☰ — выше «Альфы»
  const grip = (await list.getByRole('button', { name: 'Переместить Гамма', exact: true }).boundingBox())!;
  const target = (await list.getByRole('listitem').filter({ hasText: 'Альфа' }).boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, target.y + 4, { steps: 8 });
  await page.mouse.up();
  await expect(list.getByRole('listitem')).toHaveText([/Гамма/, /Альфа/, /Бета/]);
  await expect.poll(order).toEqual(['Гамма', 'Альфа', 'Бета']);
  // после броска фокус остаётся на ручке
  await expect(list.getByRole('button', { name: 'Переместить Гамма', exact: true })).toBeFocused();

  // сервер отклонил порядок — список возвращается, над ним ошибка (Review Focus 2)
  // ответ придержан: порядок на экране уже новый, потом сервер отказывает — откат и ошибка над списком
  const reorderUrl = '**/api/v1/companies/*/tags/reorder';
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(reorderUrl, async (route) => {
    await gate;
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'VERSION_CONFLICT', message: 'Список изменился — обновите страницу и повторите' } }),
    });
  });
  try {
    await list.getByRole('button', { name: 'Переместить Гамма', exact: true }).focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect(list.getByRole('listitem')).toHaveText([/Альфа/, /Гамма/, /Бета/]);
    await expect(main.getByRole('alert')).toHaveCount(0);
    release();
    await expect(main.getByRole('alert')).toHaveText('Список изменился — обновите страницу и повторите');
    await expect(list.getByRole('listitem')).toHaveText([/Гамма/, /Альфа/, /Бета/]);
    // после отката фокус остаётся на ручке
    await expect(list.getByRole('button', { name: 'Переместить Гамма', exact: true })).toBeFocused();
  } finally {
    release();
    await page.unroute(reorderUrl);
  }

  // при поиске ручек нет (Review Focus 5)
  await main.getByRole('searchbox', { name: 'Поиск' }).fill('а');
  await expect(list.getByRole('button', { name: /^Переместить/ })).toHaveCount(0);
  await main.getByRole('searchbox', { name: 'Поиск' }).fill('');

  // тег на операции не удаляется: подтверждение закрылось, ошибка — в окне, фокус на «Удалить» (Review Focus 3)
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: minuteAgo(), accountId: cash, amount: 100, tagIds: [tagIds[0]] });
  await list.getByRole('button', { name: 'Изменить Альфа', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Тег', exact: true });
  await edit.getByRole('button', { name: 'Удалить' }).click();
  await page.getByRole('alertdialog', { name: 'Удалить тег «Альфа»?' }).getByRole('button', { name: 'Удалить' }).click();
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await expect(edit.getByRole('alert')).toHaveText('Тег стоит на операциях — его можно только перевести в архив');
  await expect(edit.getByRole('button', { name: 'Удалить' })).toBeFocused();
});

test('шаблон списка: две быстрые перестановки подряд при медленном сервере — на экране и на сервере итоговый порядок', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Быстрый порядок ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  for (const name of ['Альфа', 'Бета', 'Гамма']) await apiPost(page, `${base}/tags`, { name });
  await page.goto(`/c/${cid}/settings/tags`);
  const list = page.getByRole('main').getByRole('list', { name: 'Теги' });
  const order = async () => ((await (await page.request.get(`${base}/tags`)).json()).tags as { name: string }[]).map((t) => t.name);
  await expect(list.getByRole('listitem')).toHaveText([/Альфа/, /Бета/, /Гамма/]);

  // запросы доходят до сервера по очереди (второй — после того, как сервер ответил на первый: иначе на разных
  // соединениях второй мог бы обогнать первый и сервер закончил бы на промежуточном порядке), но ответы браузеру
  // заперты: открываем их сами, а не по таймеру
  const gate = () => {
    let open!: () => void;
    const promise = new Promise<void>((resolve) => (open = resolve));
    return { promise, open };
  };
  const gates = [gate(), gate()];
  const fetched = [gate(), gate()];
  let calls = 0;
  let refetches = 0;
  page.on('request', (r) => {
    if (r.method() === 'GET' && new URL(r.url()).pathname === `${base}/tags`) refetches++;
  });
  await page.route('**/api/v1/companies/*/tags/reorder', async (route) => {
    const n = calls++;
    if (n > 0) await fetched[n - 1]!.promise;
    const response = await route.fetch();
    fetched[n]!.open();
    await gates[n]!.promise;
    await route.fulfill({ response });
  });

  const alpha = list.getByRole('button', { name: 'Переместить Альфа', exact: true });
  await alpha.focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(list.getByRole('listitem')).toHaveText([/Бета/, /Альфа/, /Гамма/]);
  await page.keyboard.press('Alt+ArrowDown');
  await expect(list.getByRole('listitem')).toHaveText([/Бета/, /Гамма/, /Альфа/]);
  await expect.poll(() => calls).toBe(2);

  // ответ первого пришёл, второй ещё в пути: экран не откатывается и список не перечитывается
  const refetchesBefore = refetches;
  const firstDone = page.waitForResponse((r) => r.url().endsWith('/tags/reorder'));
  gates[0]!.open();
  await firstDone;
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(refetches, 'пока второй запрос в пути, список не перечитывается').toBe(refetchesBefore);
  await expect(list.getByRole('listitem')).toHaveText([/Бета/, /Гамма/, /Альфа/]);

  // второй дошёл — итог на экране и на сервере один
  gates[1]!.open();
  await expect.poll(order).toEqual(['Бета', 'Гамма', 'Альфа']);
  await expect(list.getByRole('listitem')).toHaveText([/Бета/, /Гамма/, /Альфа/]);
  await expect(alpha).toBeFocused();
});

test('контрагенты: «Назад» в браузере при открытом «Новый …» — окно создаёт контрагента типа открытой вкладки', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Назад ${Date.now()}`);
  await page.goto(`/c/${cid}/settings/counterparties`);
  const main = page.getByRole('main');
  const types = main.getByRole('navigation', { name: 'Типы контрагентов' });
  await types.getByRole('link', { name: /^Сотрудники/ }).click();
  await expect(page).toHaveURL(/type=employee$/);
  await main.getByRole('button', { name: 'Добавить сотрудника' }).click();
  await expect(page.getByRole('dialog', { name: 'Новый сотрудник' })).toBeVisible();

  await page.goBack();
  await expect(types.getByRole('link', { name: /^Мои контрагенты/ })).toHaveAttribute('aria-current', 'page');
  // окно переключилось вместе с вкладкой: заголовок и поле «Тип» — как у «Моих контрагентов»
  const created = page.getByRole('dialog', { name: 'Новый контрагент' });
  await expect(created.getByRole('radio', { name: 'Клиент' })).toBeChecked();
  await created.getByLabel('Название').fill('ИП Назад');
  await created.getByRole('button', { name: 'Сохранить' }).click();
  await expect(created).toBeHidden();
  const all = ((await (await page.request.get(`/api/v1/companies/${cid}/counterparties`)).json()).counterparties as { name: string; type: string }[]).map((c) => `${c.type}:${c.name}`);
  expect(all).toEqual(['client:ИП Назад']);
});

test('архивная компания: на «Тегах», «Контрагентах» и «Счетах» нет «Добавить», ☰ и ✎', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Архив разделов ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  for (const name of ['Альфа', 'Бета']) await apiPost(page, `${base}/tags`, { name });
  for (const name of ['Один', 'Два']) await apiPost(page, `${base}/counterparties`, { type: 'client', name, comment: '' });
  const first = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  const second = (await apiPost(page, `${base}/accounts`, { name: 'Сейф', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  // у активной компании управление есть — иначе проверка ниже ничего не доказывает
  await page.goto(`/c/${cid}/settings/tags`);
  await expect(page.getByRole('main').getByRole('button', { name: 'Добавить тег' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('button', { name: /^Переместить/ })).toHaveCount(2);

  await apiPost(page, `${base}/accounts/${first}/archive`, {});
  await apiPost(page, `${base}/accounts/${second}/archive`, {});
  await apiPost(page, `${base}/archive`, {});

  for (const [path, heading, add] of [
    ['tags', 'Теги', 'Добавить тег'],
    ['counterparties', 'Контрагенты', 'Добавить контрагента'],
    ['accounts', 'Счета', 'Добавить счёт'],
  ] as const) {
    await page.goto(`/c/${cid}/settings/${path}`);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expect(main.getByText('Компания в архиве — изменения недоступны.')).toBeVisible();
    await expect(main.getByRole('listitem').first()).toBeVisible();
    await expect(main.getByRole('button', { name: add })).toHaveCount(0);
    await expect(main.getByRole('button', { name: /^Переместить/ })).toHaveCount(0);
    await expect(main.getByRole('button', { name: /^Изменить/ })).toHaveCount(0);
  }
});
