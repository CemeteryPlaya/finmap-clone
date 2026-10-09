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

/** Телефон из §10 (сценарий 4): ширина 390 px. */
const PHONE = { width: 390, height: 844 };
const bar = (page: Page) => page.getByRole('group', { name: 'Добавить операцию' });
const newForm = (page: Page) => page.getByRole('dialog', { name: 'Новая операция' });

test('нижняя панель «Доход», «Расход», «Перевод» на телефоне; на компьютере кнопки — в шапке', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Панель ${Date.now()}`);
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await page.reload();
  // компьютер: панели нет, кнопки — в шапке
  await expect(bar(page)).toBeHidden();
  await expect(page.getByRole('banner').getByRole('button', { name: 'Расход', exact: true })).toBeVisible();

  await page.setViewportSize(PHONE);
  await expect(page.getByRole('banner').getByRole('button', { name: 'Расход', exact: true })).toBeHidden();
  await expect(bar(page).getByRole('button')).toHaveText([/Доход/, /Расход/, /Перевод/]);
  // закреплена у нижнего края во всю ширину
  const box = (await bar(page).boundingBox())!;
  expect(Math.round(box.y + box.height)).toBe(PHONE.height);
  expect(Math.round(box.width)).toBe(PHONE.width);

  // кнопка открывает форму своего типа; Esc без изменений закрывает, фокус — снова на кнопке панели
  await bar(page).getByRole('button', { name: 'Перевод', exact: true }).click();
  await expect(newForm(page).getByRole('radio', { name: 'Перевод' })).toBeChecked();
  await expect(newForm(page).getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(newForm(page)).toBeHidden();
  await expect(bar(page).getByRole('button', { name: 'Перевод', exact: true })).toBeFocused();
});

test('счета на телефоне выезжают слева: итог и балансы; Esc, касание фона и «Закрыть» закрывают, фокус возвращается; переход по счёту', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Счета ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 100000 })).account.id;
  await apiPost(page, `${base}/accounts`, { name: 'Сейф', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 20000 });
  await page.setViewportSize(PHONE);
  await page.reload();

  // левой панели на узком экране нет — счета открываются кнопкой в шапке
  await expect(page.getByRole('navigation', { name: 'Счета' })).toBeHidden();
  const open = page.getByRole('banner').getByRole('button', { name: 'Счета', exact: true });
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  await open.click();
  const drawer = page.getByRole('dialog', { name: 'Счета' });
  await expect(drawer).toContainText(/Всего на счетах\s*1\s200,00\s₸/);
  await expect(drawer.getByRole('link', { name: /^Kaspi/ })).toContainText(/1\s000,00\s₸/);
  await expect(drawer.getByRole('link', { name: /^Сейф/ })).toContainText(/200,00\s₸/);
  // у левого края, справа виден затемнённый фон
  await expect.poll(async () => Math.round((await drawer.boundingBox())!.x)).toBe(0);
  expect((await drawer.boundingBox())!.width).toBeLessThan(PHONE.width - 40);
  // фокус не уходит из панели на страницу под ней
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
  }

  // Esc закрывает, фокус — снова на кнопке «Счета»
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(open).toBeFocused();
  // касание затемнённого фона справа от панели закрывает; касание внутри панели — нет
  await open.click();
  await drawer.getByText('Всего на счетах').click();
  await expect(drawer).toBeVisible();
  await page.mouse.click(PHONE.width - 10, PHONE.height / 2);
  await expect(drawer).toBeHidden();
  await expect(open).toBeFocused();
  await open.click();
  await drawer.getByRole('button', { name: 'Закрыть' }).click();
  await expect(drawer).toBeHidden();
  await expect(open).toBeFocused();

  // счёт фильтрует журнал, панель закрывается
  await open.click();
  await drawer.getByRole('link', { name: /^Kaspi/ }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log\\?account=${kaspi}$`));
  await expect(drawer).toBeHidden();

  // страница без компании (новая компания): в шапке телефона — название продукта, а не одна «Выйти»
  await page.goto('/companies/new');
  await expect(page.getByRole('banner')).toContainText('Учёт');
  await page.goto(`/c/${cid}/log`);

  // компьютер: кнопки нет, на месте левая панель
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(open).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Счета' })).toBeVisible();
});

const cards = (page: Page) => page.getByRole('list', { name: 'Операции' });

test('сценарий 4 §10, ширина 390 px: расход с выражением через кнопки-операторы, журнал карточками, правка операции', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Телефон ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 1000000 });
  await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Аренда' });
  await page.reload();

  // на компьютере ряда операторов нет
  await page.getByRole('banner').getByRole('button', { name: 'Расход', exact: true }).click();
  const dialog = newForm(page);
  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
  await expect(dialog.getByRole('group', { name: /^Операторы/ })).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await page.setViewportSize(PHONE);
  await bar(page).getByRole('button', { name: 'Расход', exact: true }).click();
  // форма — на весь экран
  const box = (await dialog.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(PHONE.width - 1);
  expect(box.height).toBeGreaterThanOrEqual(PHONE.height - 1);
  const amount = dialog.getByRole('textbox', { name: /^Сумма,/ });
  await expect(amount).toBeFocused();
  await expect(amount).toHaveAttribute('inputmode', 'decimal');
  await dialog.getByRole('button', { name: /^Статья:/ }).click();
  await dialog.getByRole('option', { name: 'Аренда', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Статья: Аренда' })).toBeVisible();
  // выражение набирается цифрами, операторы — кнопками под полем; фокус остаётся в поле
  await amount.click();
  await page.keyboard.type('1000');
  await dialog.getByRole('button', { name: 'Оператор умножение' }).click();
  await expect(amount).toBeFocused();
  await page.keyboard.type('3');
  await dialog.getByRole('button', { name: 'Оператор минус' }).click();
  await page.keyboard.type('500');
  await expect(amount).toHaveValue('1000×3\u2212500');
  await amount.blur();
  await expect(amount).toHaveValue('2500');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).toBeHidden();

  // журнал — карточки: сумма, статья, счёт, дата; таблицы и флажков выделения нет
  await expect(page.getByRole('table', { name: 'Операции' })).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  const card = cards(page).getByRole('listitem').first();
  await expect(card).toContainText(/\u22122\s500,00\s₸/);
  await expect(card).toContainText('Аренда');
  await expect(card).toContainText('Касса');
  await expect(card).toContainText(/сегодня \d\d:\d\d/);

  // правка: карточка открывает операцию на весь экран; оператор дописывается в конец суммы
  await card.getByRole('button').click();
  const edit = page.getByRole('dialog', { name: 'Изменить операцию' });
  const editAmount = edit.getByRole('textbox', { name: /^Сумма,/ });
  await expect(editAmount).toBeFocused();
  await expect(editAmount).toHaveValue('2500');
  expect((await edit.boundingBox())!.width).toBeGreaterThanOrEqual(PHONE.width - 1);
  await editAmount.click();
  await page.keyboard.press('End');
  await edit.getByRole('button', { name: 'Оператор деление' }).click();
  await page.keyboard.type('2');
  await editAmount.blur();
  await expect(editAmount).toHaveValue('1250');
  await edit.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(edit).toBeHidden();
  await expect(cards(page).getByRole('listitem')).toHaveCount(1);
  await expect(card).toContainText(/\u22121\s250,00\s₸/);
  // фокус вернулся на карточку, с которой открыли форму
  await expect(card.getByRole('button')).toBeFocused();
});

test('журнал карточками догружается при прокрутке; последняя карточка не прячется под нижней панелью', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Прокрутка ${Date.now()}`);
  const cash = (await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  for (let i = 1; i <= 55; i++) {
    await apiPost(page, `/api/v1/companies/${cid}/operations`, { type: 'income', paidAt: new Date(Date.now() - i * 60_000).toISOString(), accountId: cash, amount: i * 100, comment: `№${i}` });
  }
  await page.setViewportSize(PHONE);
  await page.reload();

  const list = cards(page).getByRole('listitem');
  await expect(list).toHaveCount(50);
  await page.getByRole('button', { name: 'Показать ещё' }).scrollIntoViewIfNeeded();
  await expect(list).toHaveCount(55);
  await expect(page.getByRole('button', { name: 'Показать ещё' })).toHaveCount(0);
  await expect(list.last()).toContainText('№55');
  // в самом низу страницы последняя карточка — над закреплённой панелью
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const last = (await list.last().boundingBox())!;
  const panelTop = (await bar(page).boundingBox())!.y;
  expect(last.y + last.height).toBeLessThanOrEqual(panelTop);
});

test('выделение из широкого окна на телефоне снимается: невидимые строки не удалить массовым действием', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Выделение ${Date.now()}`);
  const cash = (await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `/api/v1/companies/${cid}/operations`, { type: 'income', paidAt: new Date(Date.now() - 60_000).toISOString(), accountId: cash, amount: 10000 });
  await page.reload();

  await page.getByRole('checkbox', { name: 'Выбрать все загруженные операции' }).check();
  const bulk = page.getByRole('region', { name: 'Действия с выбранными' });
  await expect(bulk).toContainText('Выбрано: 1');
  await page.setViewportSize(PHONE);
  await expect(cards(page).getByRole('listitem')).toHaveCount(1);
  await expect(bulk).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.getByRole('checkbox', { name: 'Выбрать все загруженные операции' })).not.toBeChecked();
  await expect(bulk).toHaveCount(0);
});
