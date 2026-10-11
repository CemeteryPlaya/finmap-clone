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

test('счета: создание в USD, архив только при нулевом остатке, удаление', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Счета ${Date.now()}`);
  await page.getByRole('banner').getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Настройки компании' }).click();
  await section(page, 'Счета').click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/accounts$`));

  await page.getByRole('button', { name: 'Добавить счёт' }).click();
  await page.getByLabel('Название счёта').fill('Сейф');
  await page.getByLabel('Валюта').selectOption('USD');
  await page.getByLabel('Остаток на дату открытия').fill('1 500,505');
  await page.getByRole('button', { name: 'Создать счёт' }).click();
  await expect(page.getByText('Введите сумму, например 1 500,50')).toBeVisible();
  await expect(page.getByLabel('Остаток на дату открытия')).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Остаток на дату открытия').fill('1 500,50');
  await page.getByRole('button', { name: 'Создать счёт' }).click();

  const row = page.getByRole('listitem').filter({ hasText: 'Сейф' });
  await expect(row).toContainText(/1\s500,50\s\$/);
  await row.getByRole('button', { name: 'В архив' }).click();
  await expect(page.getByRole('alert')).toHaveText('Счёт можно перевести в архив только при нулевом балансе');

  await row.getByRole('button', { name: 'Изменить' }).click();
  await page.getByLabel('Остаток на дату открытия').fill('0');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await row.getByRole('button', { name: 'В архив' }).click();
  await expect(row).toContainText('В архиве');

  await row.getByRole('button', { name: 'Удалить' }).click();
  await row.getByRole('button', { name: 'Да, удалить' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Сейф' })).toHaveCount(0);
});

test('категории: вложение, «Перенести в…», переименование, перетаскивание; системные не переименовываются', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Категории ${Date.now()}`);
  await page.goto(`/c/${cid}/settings/categories`);
  const expense = page.getByRole('region', { name: 'Расходы' });
  const item = (name: string) => expense.getByRole('listitem', { name, exact: true });

  await expense.getByLabel('Новая категория расходов').fill('Реклама');
  await expense.getByRole('button', { name: 'Добавить' }).click();
  await expect(item('Реклама')).toBeVisible();
  await expense.getByLabel('Новая категория расходов').fill('Таргет');
  await expense.getByLabel('Родитель').selectOption({ label: 'Реклама' });
  await expense.getByRole('button', { name: 'Добавить' }).click();
  await expect(item('Реклама').getByRole('listitem', { name: 'Таргет', exact: true })).toBeVisible();

  // системная «Зарплата»: значок есть, переименовать нельзя
  await expect(item('Зарплата')).toContainText('системная');
  await expect(item('Зарплата').getByRole('button', { name: 'Переименовать' })).toHaveCount(0);

  // «Таргет» — на верхний уровень через «Перенести в…»
  await expense.getByLabel('Перенести «Таргет»').selectOption('top');
  await expect(item('Реклама').getByRole('listitem', { name: 'Таргет', exact: true })).toHaveCount(0);
  await expect(item('Таргет')).toBeVisible();

  await item('Таргет').getByRole('button', { name: 'Переименовать' }).click();
  await expense.getByLabel('Новое название категории «Таргет»').fill('Таргетинг');
  await expense.getByRole('button', { name: 'Сохранить' }).click();
  await expect(item('Таргетинг')).toBeVisible();

  // перетаскивание: «Таргетинг» встаёт перед «Зарплатой»
  // тянем за ручку ⠿ (левый верхний угол строки): в центре строки может оказаться выпадающий список «Перенести в…»
  await item('Таргетинг').locator(':scope > div').dragTo(item('Зарплата').locator(':scope > div'), { sourcePosition: { x: 16, y: 20 } });
  await expect
    .poll(async () => {
      const tree = (await (await page.request.get(`/api/v1/companies/${cid}/categories`)).json()) as { expense: { name: string }[] };
      const names = tree.expense.map((n) => n.name);
      return names.indexOf('Таргетинг') === names.indexOf('Зарплата') - 1;
    })
    .toBe(true);
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
    await main.getByRole('button', { name: 'Добавить сотрудника' }).click();
    await expect(staffDialog.getByRole('radio')).toHaveCount(0);
    await staffDialog.getByLabel('Название').fill(name);
    await staffDialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(staffDialog).toBeHidden();
  }
  const staff = main.getByRole('list', { name: 'Сотрудники' });
  await expect(staff.getByRole('listitem')).toHaveText([/Пётр Админов/, /Анна Кассир/]);
  await expect(types.getByRole('link', { name: /^Сотрудники/ })).toContainText('2');

  // порядок — в своей вкладке; «Мои» в общем порядке остаются на месте (Review Focus 1)
  const all = async () =>
    ((await (await page.request.get(`/api/v1/companies/${cid}/counterparties`)).json()).counterparties as { name: string; type: string }[]).map((c) => `${c.type}:${c.name}`);
  await staff.getByRole('button', { name: 'Переместить Анна Кассир', exact: true }).focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(staff.getByRole('listitem')).toHaveText([/Анна Кассир/, /Пётр Админов/]);
  await expect.poll(all).toEqual(['supplier:ИП Иванов', 'employee:Анна Кассир', 'employee:Пётр Админов']);

  // поиск без учёта регистра и «ё»
  await main.getByRole('searchbox', { name: 'Поиск' }).fill('петр');
  await expect(staff.getByRole('listitem')).toHaveText([/Пётр Админов/]);

  // ✎ в «Моих» — окно «Контрагент», тип меняется; поиск — и по комментарию
  await types.getByRole('link', { name: /^Мои контрагенты/ }).click();
  await main.getByRole('searchbox', { name: 'Поиск' }).fill('ЗАЛА');
  await expect(my.getByRole('listitem')).toHaveText([/ИП Иванов/]);
  await my.getByRole('button', { name: 'Изменить ИП Иванов', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Контрагент', exact: true });
  await edit.getByRole('radio', { name: 'Клиент' }).check();
  await edit.getByRole('button', { name: 'Сохранить' }).click();
  await expect(edit).toBeHidden();
  await expect(my.getByRole('listitem')).toHaveText([/ИП Иванов\s*Клиент · аренда зала/]);

  // неверный тип в адресе — «Мои контрагенты»
  await page.goto(`/c/${cid}/settings/counterparties?type=nope`);
  await expect(types.getByRole('link', { name: /^Мои контрагенты/ })).toHaveAttribute('aria-current', 'page');
});

test('шаблон разделения: сохранить можно только при 100%', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Разделение ${Date.now()}`);
  await page.goto(`/c/${cid}/settings/projects`);
  for (const name of ['Клуб 1', 'Клуб 2']) {
    await page.getByRole('button', { name: 'Добавить проект' }).click();
    await page.getByLabel('Название проекта').fill(name);
    await page.getByLabel('Тип бизнеса').selectOption('general');
    await page.getByRole('button', { name: 'Создать проект' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: name })).toBeVisible();
  }

  await section(page, 'Проекты').click();
  await page.getByRole('navigation', { name: 'Проекты и шаблоны' }).getByRole('link', { name: 'Шаблоны разделения' }).click();
  await expect(page).toHaveURL(/\/settings\/projects\/split-presets$/);
  await page.getByRole('button', { name: 'Добавить шаблон' }).click();
  await page.getByLabel('Название шаблона').fill('Аренда пополам');
  await page.getByLabel('Проект, строка 1').selectOption({ label: 'Клуб 1' });
  await page.getByLabel('Доля %, строка 1').fill('50');
  await page.getByLabel('Проект, строка 2').selectOption({ label: 'Клуб 2' });
  await page.getByLabel('Доля %, строка 2').fill('40');
  await expect(page.getByRole('status').filter({ hasText: 'Распределено' })).toHaveText('Распределено 90% из 100% · осталось 10%');
  await expect(page.getByRole('button', { name: 'Сохранить шаблон' })).toBeDisabled();
  await page.getByLabel('Доля %, строка 2').fill('50');
  await page.getByRole('button', { name: 'Сохранить шаблон' }).click();

  const row = page.getByRole('listitem').filter({ hasText: 'Аренда пополам' });
  await expect(row).toContainText('Клуб 1 — 50%');
  await expect(row).toContainText('Клуб 2 — 50%');
});

test('переименование проекта переименовывает его счета; ↑/↓ меняют порядок счетов', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Переименование ${Date.now()}`);
  await page.goto(`/c/${cid}/settings/projects`);
  await page.getByRole('button', { name: 'Добавить проект' }).click();
  await page.getByLabel('Название проекта').fill('Клуб А');
  await page.getByLabel('Тип бизнеса').selectOption('computer-club');
  await page.getByLabel('Количество ПК').fill('1e3');
  await page.getByRole('button', { name: 'Создать проект' }).click();
  await expect(page.getByText('Введите целое число')).toBeVisible();
  await page.getByLabel('Количество ПК').fill('10');
  await page.getByRole('button', { name: 'Создать проект' }).click();

  await page.getByRole('listitem').filter({ hasText: 'Клуб А' }).getByRole('button', { name: 'Изменить' }).click();
  await page.getByLabel('Название проекта').fill('Клуб Б');
  await expect(page.getByLabel('Переименовать счета')).toBeChecked();
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('status')).toHaveText('Переименовано счетов: 2');

  await section(page, 'Счета').click();
  const group = page.getByRole('region', { name: 'Клуб Б' });
  await expect(group.getByRole('listitem')).toHaveCount(2);
  await expect(group.getByRole('listitem').first()).toContainText('Касса Клуб Б');
  await group.getByRole('button', { name: 'Ниже: Касса Клуб Б' }).click();
  await expect(group.getByRole('listitem').first()).toContainText('Kaspi Клуб Б');
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
  await expect(page.getByRole('heading', { level: 1, name: 'Шаблоны разделения' })).toBeVisible();
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
  // то же для «+ счёт» в левой панели: она заменяется меню настроек
  await page.getByRole('navigation', { name: 'Счета' }).getByRole('link', { name: '+ счёт' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/accounts$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Счета' })).toBeFocused();
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
  // Alt+↑ на первой строке ничего не меняет (Review Focus 5)
  const sent = reorders;
  await page.keyboard.press('Alt+ArrowUp');
  await expect(list.getByRole('listitem')).toHaveText([/Альфа/, /Бета/, /Гамма/]);
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

  // первый запрос сервер выполняет сразу, но ответ приходит через 0,5 с; второй доходит до сервера только через 1,5 с.
  // Пока второй в пути, ответ первого не должен затирать порядок, уже показанный после второго
  let calls = 0;
  await page.route('**/api/v1/companies/*/tags/reorder', async (route) => {
    if (++calls === 1) {
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({ response });
    } else {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    }
  });
  const alpha = list.getByRole('button', { name: 'Переместить Альфа', exact: true });
  await alpha.focus();
  await page.keyboard.press('Alt+ArrowDown');
  await page.keyboard.press('Alt+ArrowDown');
  await expect(list.getByRole('listitem')).toHaveText([/Бета/, /Гамма/, /Альфа/]);
  // на сервере пока промежуточный порядок; ответ первого приходит — экран не откатывается к нему
  for (let k = 0; k < 8; k++) {
    await page.waitForTimeout(100);
    expect(await list.getByRole('listitem').allInnerTexts(), 'экран не откатился к промежуточному порядку').toEqual(['Бета', 'Гамма', 'Альфа']);
  }
  // второй дошёл — итог на экране и на сервере один
  await expect(list.getByRole('listitem')).toHaveText([/Бета/, /Гамма/, /Альфа/]);
  await expect.poll(order).toEqual(['Бета', 'Гамма', 'Альфа']);
  await expect(alpha).toBeFocused();
});
