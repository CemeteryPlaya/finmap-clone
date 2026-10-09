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
