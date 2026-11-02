import { expect, test, type Page } from '@playwright/test';
import { SENET_DEMO, seedSenetBooks } from '../scripts/lib/senet-demo';

// Senet: подключение, клуб, забор, автопроводка, очередь, «Сверка Senet», удаление, баннер, телефон
// (план 2026-11-02-senet-autopost, задача 16). Поддельный Senet поднимает e2e/server.ts.

test.describe.configure({ mode: 'serial' });

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
const api = async (page: Page, method: 'POST' | 'PATCH' | 'GET', url: string, data?: unknown) => {
  const res = await page.request.fetch(url, { method, data, headers: csrf(page) });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return res.json();
};
const main = (page: Page) => page.getByRole('main');

test('Senet: от подключения до сверки', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, 'ТОО «Senet e2e»');
  const books = await seedSenetBooks(page, cid);
  const s = `/api/v1/companies/${cid}/senet`;

  // подключение — через окно: «Сохранить» только после «Проверить»
  await page.goto(`/c/${cid}/settings/integrations`);
  await main(page).getByRole('button', { name: '+ Подключить Senet' }).click();
  const dialog = page.getByRole('dialog', { name: 'Подключить Senet' });
  await dialog.getByLabel('Адрес организации').fill(`https://${SENET_DEMO.org}.admin-v2.enes.tech/`);
  await expect(dialog.getByText(`https://${SENET_DEMO.org}.app.enes.tech`)).toBeVisible();
  await dialog.getByLabel('Логин пользователя Senet').fill(SENET_DEMO.username);
  await dialog.getByLabel('Пароль', { exact: true }).fill(SENET_DEMO.password);
  await expect(dialog.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Проверить' }).click();
  await expect(dialog.getByRole('status')).toContainText('Клуб «Клуб 1»: смен за сутки');
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(dialog).toBeHidden();
  await expect(main(page).getByText('Подключено, данных ещё не забирали')).toBeVisible();

  // клуб и связи — через форму
  await main(page).getByRole('button', { name: 'Изменить' }).click();
  const office = page.getByRole('dialog', { name: 'Клуб Senet' });
  await office.getByLabel('Забирать и проводить смены клуба').check();
  await office.getByLabel('Проект').selectOption({ label: 'Клуб Senet' });
  await expect(office.getByLabel('Счёт кассы')).toHaveValue(String(books.cash));
  await expect(office.getByLabel('Счёт Kaspi')).toHaveValue(String(books.kaspi));
  await office.getByLabel('Категория дохода смены').selectOption({ label: 'За смену клуба' });
  const from = new Date(Date.now() - 48 * 3_600_000 + 5 * 3_600_000).toISOString().slice(0, 16);
  await office.getByLabel('Загружать с даты').fill(from);
  await office.getByLabel('Постоянная разница кассы, ₸').fill('-8000');
  await office.getByRole('button', { name: 'Сохранить' }).click();
  await expect(office).toBeHidden();
  await expect(main(page).getByText('забирается')).toBeVisible();

  // правила — через API (экран правил проверяют снимки), забор — кнопкой
  await api(page, 'POST', `${s}/rules`, { type: 'salary_word', pattern: '', categoryId: books.salary });
  await api(page, 'POST', `${s}/rules`, { type: 'lunch', pattern: '', categoryId: books.lunch });
  await api(page, 'POST', `${s}/rules`, { type: 'employee_alias', pattern: 'op1', counterpartyId: books.operator });
  await main(page).getByRole('button', { name: 'Обновить сейчас' }).click();
  await expect(main(page).getByRole('status').filter({ hasText: 'Загружено 1 из 1 отрезков' })).toBeVisible();

  // журнал: операции смен проведены
  await page.goto(`/c/${cid}/log`);
  await expect(page.getByRole('table', { name: 'Операции' }).getByText('Оператор 1')).toBeVisible();

  // «Сверка Senet»: две смены, касса сходится; «Разобрать (1)»
  await page.getByRole('link', { name: 'Сверка Senet' }).click();
  await expect(main(page).locator('tbody tr[data-shift]')).toHaveCount(2);
  // A сходится; у B касса расходится на непроведённую выемку «что-то» — она в очереди
  const table = main(page).getByRole('table');
  await expect(table.getByText('Сходится', { exact: true })).toHaveCount(1);
  await expect(table.getByText('Касса расходится', { exact: true })).toHaveCount(1);
  await main(page).getByRole('link', { name: 'Разобрать (1)' }).click();
  await expect(main(page).getByText('«что-то»', { exact: true })).toBeVisible();
  await main(page).getByLabel('Категория').selectOption({ label: 'Прочие расходы клуба' });
  await main(page).getByLabel('Запомнить для «что-то»').check();
  await main(page).getByRole('button', { name: 'Провести' }).click();
  await expect(main(page).getByText('Разбирать нечего — все выемки проведены.')).toBeVisible();

  // ручная операция в кассе ломает остаток: «К первому расхождению» раскрывает смену
  await api(page, 'POST', `/api/v1/companies/${cid}/operations`, {
    type: 'expense',
    paidAt: new Date(Date.now() - 12 * 3_600_000).toISOString(),
    accountId: books.cash,
    amount: 100_000,
    lines: [{ categoryId: books.other, amount: 100_000 }],
  });
  await main(page).getByRole('link', { name: /^Смены/ }).click();
  await main(page).getByRole('button', { name: 'К первому расхождению' }).click();
  await expect(main(page).locator('tbody tr[aria-expanded="true"]')).toHaveCount(1);

  // удаление операции Senet с «Не проводить повторно»: следующий забор её не возвращает
  await page.goto(`/c/${cid}/log`);
  await page.getByRole('table', { name: 'Операции' }).getByText('Оператор 1').click();
  const form = page.getByRole('dialog', { name: 'Расход' });
  await form.getByRole('button', { name: 'Удалить платёж' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Удалить платёж?' });
  await confirm.getByLabel('Не проводить повторно из Senet').check();
  await confirm.getByRole('button', { name: 'Удалить' }).click();
  await expect(page.getByRole('table', { name: 'Операции' }).getByText('Оператор 1')).toHaveCount(0);
  const conns = await api(page, 'GET', `${s}/connections`);
  await api(page, 'POST', `${s}/connections/${conns.connections[0].id}/sync`, {});
  await page.reload();
  await expect(page.getByRole('table', { name: 'Операции' }).getByText('Оператор 1')).toHaveCount(0);

  // неверные данные входа → баннер над журналом
  await api(page, 'PATCH', `${s}/connections/${conns.connections[0].id}`, { credentials: { authMethod: 'password', username: SENET_DEMO.username, password: 'неверный' } });
  await page.request.post(`${s}/connections/${conns.connections[0].id}/sync`, { data: {}, headers: csrf(page) });
  await page.reload();
  await expect(main(page).getByRole('alert').filter({ hasText: 'Обновите доступ к Senet — забор остановлен' })).toBeVisible();

  // телефон: «Ещё» → «Сверка Senet», смены карточками
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name: 'Ещё' }).click();
  await page.getByRole('link', { name: 'Сверка Senet' }).click();
  await expect(main(page).locator('li[data-shift]')).toHaveCount(2);
});
