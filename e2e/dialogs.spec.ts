import { expect, test, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByPlaceholder('Логин').fill('admin');
  await page.getByPlaceholder('Пароль').fill('e2e-password-1');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('button', { name: 'Настройки', exact: true })).toBeVisible();
}

test('закрытие формы не прокручивает журнал, даже если кнопка, с которой открыли, не держит фокус (Safari, Firefox на Mac)', async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1100, height: 480 });
  const cid = await createCompany(page, `ТОО Прокрутка ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  for (let i = 1; i <= 30; i++) {
    await apiPost(page, `${base}/operations`, { type: 'income', paidAt: minuteAgo(), accountId: cash, amount: 100 + i, comment: `строка ${i}` });
  }
  await page.reload();
  const open = page.getByRole('table', { name: 'Операции' }).getByRole('button', { name: /^Открыть операцию/ });
  await expect(open).toHaveCount(30);

  // положение прокрутки страницы и всех прокручиваемых предков таблицы
  const scrolled = () =>
    page.evaluate(() => {
      let sum = 0;
      for (let el: Element | null = document.querySelector('table'); el; el = el.parentElement) sum += el.scrollTop;
      return sum + window.scrollY;
    });
  await open.last().scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 3000);
  await expect.poll(scrolled).toBeGreaterThan(100);
  const before = await scrolled();

  const form = page.getByRole('dialog', { name: 'Доход', exact: true });
  // обычный возврат: фокус на кнопку строки без прокрутки
  await open.last().click();
  await expect(form).toBeVisible();
  await form.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(form).toBeHidden();
  expect(Math.abs((await scrolled()) - before)).toBeLessThanOrEqual(4);

  // запасной путь по-настоящему: открываем с клавиатуры, перед закрытием убираем фокус с кнопки-открывашки и закрываем «×»
  await open.last().focus();
  await page.keyboard.press('Enter');
  await expect(form).toBeVisible();
  await page.evaluate(() => {
    // открывашку «забыли»: её фокус уже не вернуть, остаётся заголовок страницы
    document.querySelectorAll('table button').forEach((b) => b.setAttribute('disabled', ''));
  });
  await form.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(form).toBeHidden();
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  expect(Math.abs((await scrolled()) - before)).toBeLessThanOrEqual(4);
});

test('телефон: «×» окна и вопроса о несохранённом — цель касания не меньше 44×44 px', async ({ page }) => {
  await login(page);
  await page.setViewportSize(PHONE);
  const cid = await createCompany(page, `ТОО Касание ${Date.now()}`);
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await page.reload();
  await page.getByRole('group', { name: 'Добавить операцию' }).getByRole('button', { name: 'Расход', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Новый расход' });
  const size = async (b: ReturnType<typeof form.getByRole>) => (await b.boundingBox())!;
  const cross = await size(form.getByRole('button', { name: 'Закрыть', exact: true }));
  expect(cross.width).toBeGreaterThanOrEqual(44);
  expect(cross.height).toBeGreaterThanOrEqual(44);
  await form.getByRole('textbox', { name: /^Сумма,/ }).fill('7');
  await form.getByRole('button', { name: 'Закрыть', exact: true }).click();
  const question = page.getByRole('alertdialog', { name: 'Ваши данные не сохранятся' });
  const ask = await size(question.getByRole('button', { name: 'Не закрывать', exact: true }));
  expect(ask.width).toBeGreaterThanOrEqual(44);
  expect(ask.height).toBeGreaterThanOrEqual(44);
  await question.getByRole('button', { name: 'Не закрывать', exact: true }).click();
  await expect(question).toBeHidden();
  await expect(form).toBeVisible();
});


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

test('окно: «×» закрывает форму и «Фильтры»; начальный фокус не на «×»; Shift+Tab доходит до «×» и остаётся в окне; на телефоне «×» видна после прокрутки', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Окна ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: minuteAgo(), accountId: cash, amount: 1000, comment: 'для правки' });
  await page.reload();

  // новая операция: фокус в сумме, «×» — в шапке окна
  const income = page.getByRole('banner').getByRole('button', { name: 'Доход', exact: true });
  await income.click();
  const form = page.getByRole('dialog', { name: /^Новый (доход|расход|перевод)$/ });
  const close = form.getByRole('button', { name: 'Закрыть', exact: true });
  await expect(form.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
  await expect(close).toHaveAttribute('title', 'Закрыть');
  // Shift+Tab с первого элемента содержимого (поле счёта: вкладок типа нет) — на «×»; ещё раз — по кругу, но внутри окна
  await form.getByRole('combobox', { name: 'На счёт', exact: true }).focus();
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
  const edit = page.getByRole('dialog', { name: 'Доход', exact: true });
  await expect(edit.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
  await edit.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(edit).toBeHidden();

  // окно «Фильтры»: «×» закрывает без применения, фокус — на кнопке «Фильтр»
  const filterButton = page.getByRole('button', { name: 'Фильтр', exact: true });
  await filterButton.click();
  const filter = page.getByRole('dialog', { name: 'Фильтры', exact: true });
  await expect(filter).toBeVisible();
  await filter.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(filter).toBeHidden();
  await expect(filterButton).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log$`));

  // телефон: форма на весь экран, шапка с «×» липкая
  await page.setViewportSize(PHONE);
  await page.getByRole('group', { name: 'Добавить операцию' }).getByRole('button', { name: 'Расход', exact: true }).click();
  const phoneForm = page.getByRole('dialog', { name: 'Новый расход' });
  await phoneForm.getByRole('button', { name: 'Добавить проект, тег, комментарий, файл' }).click();
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
  const form = page.getByRole('dialog', { name: 'Новый расход' });
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
    await expect(question.getByRole('button')).toHaveText(['×', 'Отменить', 'Закрыть']);
    // «×» — как «Отменить»: остаться в форме; имя другое, чтобы не путать с кнопкой «Закрыть»
    const cross = question.getByRole('button', { name: 'Не закрывать', exact: true });
    await expect(cross).toHaveAttribute('title', 'Не закрывать');
    await expect(question.getByRole('button', { name: 'Отменить' })).toBeFocused();
    // Tab по кругу внутри вопроса: в форму под ним фокус не уходит
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      expect(await question.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
    // «×» вопроса: вопрос закрывается, форма и введённое остаются, фокус возвращается в сумму
    await cross.click();
    await expect(question).toBeHidden();
    await expect(form).toBeVisible();
    await expect(amount).toBeFocused();
    await expect(amount).toHaveValue('250');
    await amount.press('Escape');
    await expect(question).toBeVisible();
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
    const restore = await page.request.put('/api/v1/preferences/operationForm.skipCloseConfirm', { data: { value: false }, headers: csrf(page) });
    expect(restore.ok(), await restore.text()).toBe(true);
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

test('«Настройки журнала»: «Применить» только при изменениях, сохраняет вместе, частичный сбой понятен, журнал меняется без перезагрузки', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Вид журнала ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: minuteAgo(), accountId: cash, amount: 1000, comment: 'для колонок' });
  const putPref = async (key: string, value: unknown) => {
    const res = await page.request.put(`/api/v1/preferences/${key}`, { data: { value }, headers: csrf(page) });
    expect(res.ok(), await res.text()).toBe(true);
  };
  const before = (await (await page.request.get('/api/v1/preferences')).json()).preferences as Record<string, unknown>;
  const skipUrl = '**/api/v1/preferences/operationForm.skipCloseConfirm';
  try {
    // вопрос выключен «Больше не спрашивать» — его возвращают здесь
    await putPref('operationForm.skipCloseConfirm', true);
    await page.goto(`/c/${cid}/settings/journal`);
    await expect(page.getByRole('heading', { level: 1, name: 'Настройки журнала' })).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Разделы настроек' });
    await expect(nav.getByRole('link', { name: 'Настройки журнала' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('checkbox', { name: 'Дата', exact: true })).toBeDisabled();
    await expect(page.getByRole('checkbox', { name: 'Сумма', exact: true })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Дата сделки', exact: true })).not.toBeChecked();
    const wrap = page.getByRole('checkbox', { name: 'Показывать полностью (до 2 строк)' });
    await expect(wrap).not.toBeChecked();
    const ask = page.getByRole('checkbox', { name: 'Спрашивать перед закрытием формы с несохранёнными данными' });
    const apply = page.getByRole('button', { name: 'Применить' });
    await expect(ask).not.toBeChecked();
    await expect(apply).toBeDisabled();
    await ask.check();
    await expect(apply).toBeEnabled();
    await ask.uncheck();
    await expect(apply).toBeDisabled();

    // сбой второго сохранения: колонки сохранены, вопрос — нет; форма остаётся изменённой
    await page.route(skipUrl, (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Сбой сохранения' } }) }),
    );
    await ask.check();
    await page.getByRole('checkbox', { name: 'Комментарий', exact: true }).uncheck();
    await wrap.check();
    await apply.click();
    await expect(page.getByRole('alert')).toHaveText('Сохранено: колонки, «Показывать полностью». Не сохранено: вопрос о несохранённом — Сбой сохранения');
    await expect(apply).toBeEnabled();
    await expect(apply).toBeFocused();
    await page.unroute(skipUrl);
    await apply.click();
    await expect(page.getByRole('status')).toHaveText('Настройки сохранены');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(apply).toBeDisabled();
    await expect(page.getByRole('status')).toBeFocused();

    // журнал по ссылке, без перезагрузки: колонки «Комментарий» нет; изменённая форма снова спрашивает
    await nav.getByRole('link', { name: /Назад к журналу/ }).click();
    await expect(page.getByRole('table', { name: 'Операции' }).locator('tbody tr')).toHaveCount(1);
    await expect(page.getByRole('columnheader', { name: 'Комментарий' })).toHaveCount(0);
    // «Показывать полностью» — название счёта до двух строк
    await expect(page.getByRole('table', { name: 'Операции' }).locator('[data-column="account"] [title]').first()).toHaveClass(/line-clamp-2/);
    await page.getByRole('banner').getByRole('button', { name: 'Доход', exact: true }).click();
    const amount = page.getByRole('dialog', { name: 'Новый доход' }).getByRole('textbox', { name: /^Сумма,/ });
    await amount.fill('5');
    await amount.press('Escape');
    const question = page.getByRole('alertdialog', { name: 'Ваши данные не сохранятся' });
    await expect(question).toBeVisible();
    await question.getByRole('button', { name: 'Закрыть' }).click();

    // сохранено на сервере
    await page.goto(`/c/${cid}/settings/journal`);
    await expect(ask).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Комментарий', exact: true })).not.toBeChecked();
    await expect(wrap).toBeChecked();
    await expect(apply).toBeDisabled();
  } finally {
    await page.unroute(skipUrl);
    await putPref('operationForm.skipCloseConfirm', before['operationForm.skipCloseConfirm'] ?? null);
    await putPref('journal.columns', before['journal.columns'] ?? null);
    await putPref('journal.wrap', before['journal.wrap'] ?? null);
  }
});
