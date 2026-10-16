import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, user = 'admin', password = 'e2e-password-1') {
  await page.goto('/login');
  await page.getByPlaceholder('Логин').fill(user);
  await page.getByPlaceholder('Пароль').fill(password);
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

const main = (page: Page) => page.getByRole('main');

test('«Аналитика»: вкладка между «Журналом» и «Складом», карточки отчётов, подсказка «?», «История действий»', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Аналитика ${Date.now()}`);

  const tabs = main(page).getByRole('navigation').first().getByRole('link');
  await expect(tabs).toHaveText(['Журнал', 'Аналитика', 'Склад']);
  await tabs.filter({ hasText: 'Аналитика' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/analytics$`));

  const cards = main(page).getByRole('list', { name: 'Отчёты' }).getByRole('listitem');
  await expect(cards).toHaveCount(6);
  await expect(cards.nth(0)).toContainText('Деньги / Cash flow');
  await expect(cards.nth(0).getByRole('link')).toHaveAttribute('href', `/c/${cid}/analytics/cashflow`);
  await expect(cards.nth(1).getByRole('link')).toHaveAttribute('href', `/c/${cid}/settings/audit`);
  // «План/Факт», «Дебиторка», «Кредиторка», «Баланс» — без ссылки, с подписью
  for (const i of [2, 3, 4, 5]) {
    await expect(cards.nth(i).getByRole('link')).toHaveCount(0);
    await expect(cards.nth(i)).toContainText('Появится с плановыми операциями');
  }
  await expect(cards.nth(5)).toContainText('Баланс');

  // «?» — подсказка поверх карточки; Esc закрывает и возвращает фокус на кнопку
  const help = cards.nth(0).getByRole('button', { name: 'Подсказка: Деньги / Cash flow' });
  await help.click();
  await expect(page.getByRole('dialog', { name: 'Деньги / Cash flow' })).toContainText('по дате платежа');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Деньги / Cash flow' })).toBeHidden();
  await expect(help).toBeFocused();

  await cards.nth(1).getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/audit$`));

  // неизвестный отчёт — обратно к карточкам
  await page.goto(`/c/${cid}/analytics/unknown`);
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/analytics$`));
  await expect(main(page).getByRole('list', { name: 'Отчёты' })).toBeVisible();
});

test('телефон: «Ещё» → «Аналитика», карточки в одну колонку, заголовок получает фокус', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Аналитика телефон ${Date.now()}`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/c/${cid}/log`);
  await page.getByRole('navigation', { name: 'Разделы', exact: true }).getByRole('button', { name: 'Ещё', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Ещё', exact: true });
  await expect(menu.getByRole('link').first()).toHaveText('Аналитика');
  await menu.getByRole('link', { name: 'Аналитика' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/analytics$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Аналитика' })).toBeFocused();
  const cards = main(page).getByRole('list', { name: 'Отчёты' }).getByRole('listitem');
  const first = (await cards.nth(0).boundingBox())!;
  const second = (await cards.nth(1).boundingBox())!;
  expect(second.y).toBeGreaterThan(first.y + first.height - 1);
  expect(Math.round(second.x)).toBe(Math.round(first.x));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
