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

const section = (page: Page, name: string) => page.getByRole('navigation', { name: 'Разделы настроек' }).getByRole('link', { name });

test('счета: создание в USD, архив только при нулевом остатке, удаление', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Счета ${Date.now()}`);
  await page.getByRole('link', { name: 'Настройки' }).click();
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

test('контрагенты по вкладкам и поиск; тег с именем архивного предлагает вернуть его', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Контрагенты ${Date.now()}`);
  await page.goto(`/c/${cid}/settings/counterparties`);

  await page.getByLabel('Тип', { exact: true }).selectOption('supplier');
  await page.getByLabel('Название контрагента').fill('ИП Иванов');
  await page.getByLabel('Комментарий').fill('аренда зала');
  await page.getByRole('button', { name: 'Добавить' }).click();
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByRole('listitem')).toHaveCount(1);
  await page.getByLabel('Тип', { exact: true }).selectOption('employee');
  await page.getByLabel('Название контрагента').fill('Пётр Админов');
  await page.getByRole('button', { name: 'Добавить' }).click();
  await expect(panel.getByRole('listitem')).toHaveCount(2);

  await page.getByRole('tab', { name: /Поставщики/ }).click();
  await expect(panel.getByRole('listitem')).toHaveCount(1);
  await expect(panel).toContainText('ИП Иванов');
  await page.getByRole('tab', { name: /Все/ }).click();
  await page.getByLabel('Поиск').fill('петр'); // регистр и «ё» не важны
  await expect(panel.getByRole('listitem')).toHaveCount(1);
  await expect(panel).toContainText('Пётр Админов');

  await section(page, 'Теги').click();
  await page.getByLabel('Новый тег').fill('Ёлка');
  await page.getByRole('button', { name: 'Добавить' }).click();
  const tag = page.getByRole('listitem').filter({ hasText: 'Ёлка' });
  await tag.getByRole('button', { name: 'В архив' }).click();
  await expect(tag).toContainText('В архиве');

  await page.getByLabel('Новый тег').fill('елка');
  await page.getByRole('button', { name: 'Добавить' }).click();
  const offer = page.getByRole('alert').filter({ hasText: 'есть в архиве' });
  await expect(offer).toContainText('Тег «Ёлка» есть в архиве');
  await offer.getByRole('button', { name: 'Вернуть из архива' }).click();
  await expect(offer).toHaveCount(0);
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(tag.getByRole('button', { name: 'В архив' })).toBeVisible();
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
  ]);
  await expect(nav).toContainText(name);
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
  // у другой компании журнал запомнился без фильтра
  await page.goto(`/c/${other}/settings/tags`);
  await nav.getByRole('link', { name: /Назад к журналу/ }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${other}/log$`));
});
