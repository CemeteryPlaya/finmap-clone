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

async function apiPost(page: Page, url: string, data: unknown) {
  const res = await page.request.post(url, { data, headers: csrf(page) });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return res.json();
}

const minuteAgo = () => new Date(Date.now() - 60_000).toISOString();
const PHONE = { width: 390, height: 844 };

test('окно: «×» закрывает форму и «Фильтр»; начальный фокус не на «×»; Shift+Tab доходит до «×» и остаётся в окне; на телефоне «×» видна после прокрутки', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Окна ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: minuteAgo(), accountId: cash, amount: 1000, comment: 'для правки' });
  await page.reload();

  // новая операция: фокус в сумме, «×» — в шапке окна
  const income = page.getByRole('banner').getByRole('button', { name: 'Доход', exact: true });
  await income.click();
  const form = page.getByRole('dialog', { name: 'Новая операция' });
  const close = form.getByRole('button', { name: 'Закрыть', exact: true });
  await expect(form.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
  await expect(close).toHaveAttribute('title', 'Закрыть');
  // Shift+Tab с первого элемента содержимого — на «×»; ещё раз — по кругу, но внутри окна
  await form.getByRole('radio', { name: 'Доход' }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  expect(await form.evaluate((d) => document.activeElement?.closest('dialog') === d)).toBe(true);
  // без изменений «×» закрывает сразу, фокус — на кнопке шапки
  await close.click();
  await expect(form).toBeHidden();
  await expect(income).toBeFocused();

  // повторное открытие в той же странице: данные в кэше, содержимое монтируется вместе с окном — фокус снова в сумме
  for (const label of ['Расход', 'Доход', 'Перевод'] as const) {
    await page.getByRole('banner').getByRole('button', { name: label, exact: true }).click();
    await expect(form.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(form).toBeHidden();
  }

  // правка: окно открывается, пока операция грузится — фокус всё равно в сумме, а не на «×»
  await page.getByRole('table', { name: 'Операции' }).getByRole('button', { name: /^Открыть операцию/ }).click();
  const edit = page.getByRole('dialog', { name: 'Изменить операцию' });
  await expect(edit.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
  await edit.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(edit).toBeHidden();

  // «Фильтр»: «×» закрывает без применения, фокус — на кнопке «Фильтр»
  const filterButton = page.getByRole('button', { name: 'Фильтр', exact: true });
  await filterButton.click();
  const filter = page.getByRole('dialog', { name: 'Фильтр', exact: true });
  await expect(filter).toBeVisible();
  await filter.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(filter).toBeHidden();
  await expect(filterButton).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log$`));

  // телефон: форма на весь экран, шапка с «×» липкая
  await page.setViewportSize(PHONE);
  await page.getByRole('group', { name: 'Добавить операцию' }).getByRole('button', { name: 'Расход', exact: true }).click();
  const phoneForm = page.getByRole('dialog', { name: 'Новая операция' });
  await phoneForm.getByRole('button', { name: /^Проект, теги, комментарий/ }).click();
  await expect(phoneForm.getByLabel('Комментарий')).toBeVisible();
  await phoneForm.evaluate((d) => (d.scrollTop = d.scrollHeight));
  await expect.poll(() => phoneForm.evaluate((d) => d.scrollTop)).toBeGreaterThan(0);
  await expect(phoneForm.getByRole('button', { name: 'Закрыть', exact: true })).toBeInViewport();
  await phoneForm.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(phoneForm).toBeHidden();
});

test('вопрос о несохранённом: вложенное окно, Esc закрывает только его, фокус возвращается; «Больше не спрашивать» сохраняется только по «Закрыть»', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Вопрос ${Date.now()}`);
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await page.reload();
  const expense = page.getByRole('banner').getByRole('button', { name: 'Расход', exact: true });
  const form = page.getByRole('dialog', { name: 'Новая операция' });
  const amount = form.getByRole('textbox', { name: /^Сумма,/ });
  const question = page.getByRole('alertdialog', { name: 'Ваши данные не сохранятся' });
  const dontAsk = question.getByRole('checkbox', { name: 'Больше не спрашивать' });

  // настройка общая для пользователя admin и остальных e2e: что бы ни случилось, вопрос снова включён
  try {
    await expense.click();
    await expect(amount).toBeFocused();
    await amount.fill('250');

    // Esc в поле суммы — вопрос поверх формы: текст, флажок, «Отменить | Закрыть», фокус на «Отменить»
    await amount.press('Escape');
    await expect(question).toBeVisible();
    await expect(question).toHaveAccessibleDescription('Закрыть окно? Введённые данные будут потеряны.');
    await expect(question.getByRole('button')).toHaveText(['Отменить', 'Закрыть']);
    await expect(question.getByRole('button', { name: 'Отменить' })).toBeFocused();
    // Tab по кругу внутри вопроса: в форму под ним фокус не уходит
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      expect(await question.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
    // Esc закрывает только вопрос: форма открыта, фокус — в сумме, где нажали Esc
    await page.keyboard.press('Escape');
    await expect(question).toBeHidden();
    await expect(form).toBeVisible();
    await expect(amount).toBeFocused();
    await expect(amount).toHaveValue('250');

    // флажок отмечен, но «Отменить» — настройка не сохраняется, при следующем вопросе флажок снова пуст
    await amount.press('Escape');
    await dontAsk.check();
    await question.getByRole('button', { name: 'Отменить' }).click();
    await expect(question).toBeHidden();
    await amount.press('Escape');
    await expect(question).toBeVisible();
    await expect(dontAsk).not.toBeChecked();

    // флажок и «Закрыть» — форма закрывается, настройка сохранена, фокус — на кнопке шапки
    await dontAsk.check();
    const saved = page.waitForResponse((r) => r.url().endsWith('/api/v1/preferences/operationForm.skipCloseConfirm') && r.request().method() === 'PUT');
    await question.getByRole('button', { name: 'Закрыть' }).click();
    expect((await saved).request().postDataJSON()).toEqual({ value: true });
    await expect(form).toBeHidden();
    await expect(expense).toBeFocused();

    // теперь изменённая форма закрывается сразу — и по Esc, и по «×»
    await expense.click();
    await amount.fill('300');
    await amount.press('Escape');
    await expect(form).toBeHidden();
    await expect(question).toHaveCount(0);
    await expense.click();
    await amount.fill('300');
    await form.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(form).toBeHidden();
  } finally {
    await page.request.put('/api/v1/preferences/operationForm.skipCloseConfirm', { data: { value: false }, headers: csrf(page) });
  }

  // после возврата настройки (новая загрузка страницы) вопрос снова задаётся
  await page.reload();
  await expense.click();
  await amount.fill('5');
  await amount.press('Escape');
  await expect(question).toBeVisible();
  await question.getByRole('button', { name: 'Закрыть' }).click();
  await expect(form).toBeHidden();
});
