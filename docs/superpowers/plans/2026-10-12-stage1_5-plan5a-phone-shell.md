# Этап 1.5, план 1.5-5a: телефон — шапка, кнопки «+ − ⇄», настройки на телефоне, нижняя панель вкладок, перетаскивание касанием — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** первая половина плана 1.5-5 «Телефон» из §13 спецификации этапа 1.5:
- шапка телефона: ☰ «Счета», название компании ▾ по центру, шестерёнка (§8.1);
- кнопки «+ − ⇄» сразу под шапкой, нижняя панель кнопок убрана (§8.2);
- настройки на телефоне: экран «Настройки» со списком разделов, «← Настройки» над разделом (§8.6, решение 7 плана 1.5-1);
- цели касания 44 px в списках настроек, подменю и вкладках (итоги 1.5-4a «Проверить на телефоне», 1.5-4b №4);
- нижняя панель вкладок `MobileTabBar` с «Журнал» и «Ещё» (§8.3);
- перетаскивание касанием с прокруткой у края экрана и e2e касанием (итоги 1.5-4a);
- сверка `npm run shots:ux` и список «Проверить на телефоне».

**Предусловие:** выполнен план 1.5-4b (HEAD — `ded1c24` или новее). Ожидаемо на старте: vitest 803 + 1 пропущен, `npm run typecheck` чистый, e2e 120/120, `shots:ux` 46/46.

**Architecture:**
- **Шапка** — одна сетка на обе ширины (`AppHeader`): на телефоне `grid-cols-[auto_minmax(0,1fr)_auto]` и кнопки операций второй строкой, на компьютере прежние три колонки. Кнопки операций — одна разметка (`NewOperationButtons`, группа «Добавить операцию»), вид меняется классами `max-md:`.
- **Настройки на телефоне** — индексный маршрут `settings` рисует `SettingsIndex`: на телефоне список разделов (`SettingsNav variant="list"`), на компьютере — перенаправление на «Контрагенты». Над разделом на телефоне — ссылка «← Настройки».
- **Нижняя панель** — новый `MobileTabBar` в `CompanyLayout`; «Ещё» — `Popover` (он сам открывается вверх, если внизу нет места); «История действий» — `HistoryPanel`, вынесенная из `HistoryButton`.
- **Перетаскивание у края** — чистая `edgeScrollStep` в `lib/settings-list.ts` и цикл кадров в `SettingsList`, пока строку тянут.
- Сервер не меняется.

**Tech Stack:** как в этапе 1. Новых пакетов нет.

**Spec:** [docs/superpowers/specs/2026-10-10-stage1_5-finmap-ux-design.md](../specs/2026-10-10-stage1_5-finmap-ux-design.md) — §8.1, §8.2, §8.3, §8.6, §11 (`MobileTabBar`, иконки шапки), §12.1 (`e2e/mobile.spec.ts`), §13 (блоки «Решения планирования плана 1.5-1» №7 и «Решения планирования плана 1.5-5» №1–№6, №10). Аудит: [04-mobile.md](../../research/ux-parity/04-mobile.md) — №1, №2, №3, №8, №11. Снимки Finmap: `docs/research/screens/v2/m01-log.png`, `m02-log-closed-panel.png`, `m03-more.png`.

**Ветка:** `stage1/plan1-skeleton`. В `main` не сливаем.

## Решения, принятые при планировании

Записаны в спецификацию (§13, блок «Решения планирования плана 1.5-5», №1–№6 и №10) тем же коммитом, что и план.

1. **Кнопки операций (§8.2):** одна разметка — группа «Добавить операцию» в шапке. На компьютере по центру «+ Доход», «− Расход», «⇄ Перевод»; на телефоне второй строкой во всю ширину, только значки, 44 px. Имя — `aria-label`, подсказка — `title`. Нижней панели кнопок и свойства `placement` больше нет.
2. **Шапка телефона (§8.1):** ☰ «Счета» 44 px слева, название компании ▾ по центру (без аватара и подписи «Сменить компанию»; доступное имя прежнее), шестерёнка справа. Значок истории на телефоне скрыт с появлением нижней панели (задача 3). У выезжающей панели «Счета» «Закрыть» в левом углу (`Drawer closeAt="left"`); «Закрыть» всех панелей на телефоне 44 px. В зоне настроек ☰ нет.
3. **Нижняя панель (§8.3):** на всех страницах компании, и у архивной. «Журнал» в журнале — текущий адрес, в настройках — последний адрес журнала с фильтром. «Ещё» — «Пользователи», «Настройки», «История действий». Переход — фокус на `<h1>`; закрытие истории — фокус на «Ещё». Пилюли-вкладки на телефоне скрыты.
4. **Настройки на телефоне (§8.6):** экран «Настройки» — группы разделов строками 48 px со стрелкой «›», без «← Назад к журналу»; над разделом — «← Настройки». На компьютере `settings` → `counterparties`, как раньше.
5. **Цели касания:** ☰, ✎, «+», «банк», ✎ компании — 44×44 на телефоне; подменю и вкладки «Проекты» — высотой не меньше 44 px; у ✎ компании видимая рамка фокуса.
6. **Прокрутка у края при перетаскивании:** зона 56 px, до 18 px за кадр; область — ближайший предок с прокруткой, иначе страница без нижней панели; в окне без прокрутки страница под ним не едет.

## Global Constraints

- **Принцип (§1):** «расположение и приёмы как в Finmap, внешний вид свой; где наше лучше — оставляем». **Мёртвых кнопок нет:** «Аналитики», «AI советника», «Поддержки» в нижней панели нет совсем, неактивными тоже.
- **Телефон (§8):** ширина меньше 768 px (`MOBILE_QUERY = '(width < 48rem)'`, варианты Tailwind `max-md:` и `md:`); проверка на 390×844.
- **Шапка (§8.1):** `grid-cols-[auto_1fr_auto]`; слева ☰ «Счета» (доступное имя «Счета» сохраняется), по центру название компании ▾ (панель «Компании»), справа шестерёнка (панель «Настройки» с «Выйти»).
- **Кнопки операций (§8.2):** сразу под шапкой в тёмной зоне, ряд `grid-cols-3`, только значки «+», «−», «⇄» с `aria-label` «Доход», «Расход», «Перевод» и `title`; у архивной компании ряда нет.
- **`MobileTabBar` (§8.3, §11):** закреплена внизу, `md:hidden`, учитывает safe-area, `<nav aria-label="Разделы">`, ссылки с `aria-current="page"`; «Ещё» — кнопка с `aria-haspopup`, меню на `Popover`: «Пользователи» (`settings/users`), «Настройки» (`settings`), «История действий» (панель §3.4).
- **Настройки на телефоне (§8.6):** `settings` — список разделов (группы §4.2) отдельным экраном с заголовком «Настройки»; раздел — на весь экран, сверху «← Настройки»; левой панели счетов в зоне настроек нет.
- **Доступность (§11):** иконки шапки и кнопки «+ − ⇄» — `button` с `aria-label`, `title` и видимой рамкой фокуса; `Drawer` — Tab по кругу, Esc, «Закрыть» и касание фона закрывают, фокус — на открывшую кнопку; ссылка внутри панели или меню ставит фокус на `<h1>` новой страницы (`focusHeadingSoon`). Цели касания на телефоне — не меньше 44×44 px.
- **Цвет:** текст цвета расхода — только `text-expense-strong` (`tests/client/theme.test.ts`).
- **Терминология:** «Категория», никогда «Статья».
- **Без новых npm-пакетов.** Сервер и схема БД не меняются.
- **Невидимые символы** (U+2212, U+202F, U+00A0, U+200B) в коде — только экранированием `\u2212` и т. п.
- **Концы строк:** правки «найдите → замените» — инструментом правки файлов; копируйте найденный текст из файла, а не из плана, если они разошлись пробелами.
- **E2E:** порт 41731 (`E2E_PORT`), APP_TIMEZONE e2e-сервера — `Asia/Almaty`; один пользователь `admin`/`e2e-password-1` и одна база на прогон (имена уникальны); `name:` в Playwright — подстрока без учёта регистра (точное совпадение — `exact: true`); данные — через `page.request` с `origin` и `x-requested-with: fetch`; общие настройки пользователя восстанавливаются в `try/finally`; без фиксированных пауз. `journal-actions.spec.ts:555` — известный нестабильный тест.
- **Безопасность среды (обязательно):**
  - никогда не запускайте `npm start`, `npm run stop`, `npm run setup`, `npm run service:install`, `npm run service:uninstall`, `schtasks` и `icacls` — ни в каком виде: на порту 3457 работает живое приложение пользователя, на порту 3460 — демо-экземпляр, их не трогайте;
  - e2e идут на порту 41731 со своей временной базой; `npm run shots:ux` — на порту 41741 со своей временной папкой;
  - shell-команды не содержат подстроку «.env».
- **Завершение задачи:** зелёные `npm test`, `npm run typecheck` и `npm run test:e2e`; если задача меняет e2e — `npm run test:e2e` дважды подряд. Коммит с трейлером `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. В коммит попадает каждый новый файл задачи.

## Review Focus

1. **Длинное название компании на 390 px:** ☰ и шестерёнка остаются на краях, название обрезается, страница вбок не прокручивается. Тест — задача 1 (e2e с длинным названием и `expectNoSideScroll`).
2. **Архивная компания на телефоне:** ряда «+ − ⇄» нет, нижняя панель вкладок есть. Тест — задача 3 (строка в e2e архивной компании).
3. **Окно стало шире на экране «Настройки»:** на компьютере списка нет — перенаправление на «Контрагенты», навигация слева. Тест — задача 2 (e2e).
4. **Перетаскивание у края экрана:** список едет сам, строка встаёт под пальцем на новом месте, а не на прежнем; пока тянут вдали от края, страница не прокручивается. Тесты — задача 4 (unit `edgeScrollStep`, e2e касанием).
5. **«Журнал» в нижней панели из зоны настроек:** возвращает в журнал с прежним фильтром, фокус на `<h1>` журнала. Тест — задача 3 (e2e).

---

## Карта файлов

```
src/client/components/AppHeader.tsx                 # сетка телефона: ☰ | компания ▾ | шестерёнка, кнопки второй строкой
src/client/components/operation/OperationFormHost.tsx  # NewOperationButtons — одна разметка, группа «Добавить операцию»
src/client/components/AccountsPanel.tsx             # ☰ «Счета» иконкой, «Закрыть» панели слева
src/client/components/Drawer.tsx                    # closeAt, «Закрыть» 44 px на телефоне
src/client/components/CompaniesDrawer.tsx           # название ▾ на телефоне; ✎ 44 px и рамка фокуса
src/client/components/icons.tsx                     # MenuIcon
src/client/components/ui.ts                         # mainCardClass (отступ снизу), rowIconClass (44 px на телефоне)
src/client/components/HistoryDrawer.tsx             # HistoryPanel (панель отдельно от кнопки)
src/client/components/MobileTabBar.tsx              # (новый) нижняя панель «Журнал» | «Ещё»
src/client/components/SettingsList.tsx              # прокрутка у края при перетаскивании; заглушка ручки 44 px
src/client/components/SettingsSubmenu.tsx           # ссылки подменю 44 px на телефоне
src/client/lib/settings-list.ts                     # edgeScrollStep, EDGE_SCROLL_ZONE, EDGE_SCROLL_MAX
src/client/pages/CompanyLayout.tsx                  # пропсы шапки, без нижней панели кнопок, MobileTabBar, пилюли скрыты на телефоне
src/client/pages/settings/SettingsNav.tsx           # variant 'sidebar' | 'list', SettingsListLink «← Настройки»
src/client/pages/settings/SettingsLayout.tsx        # «← Настройки» над разделом, SettingsIndex
src/client/pages/settings/CategoriesSettings.tsx    # «+» и «банк» 44 px на телефоне
src/client/pages/settings/ProjectsTabs.tsx          # вкладки 44 px на телефоне
src/client/router.tsx                               # индекс настроек — SettingsIndex
scripts/ux-shots.ts                                 # cm03-more, cm07-settings
tests/client/settings-list.test.ts
e2e/mobile.spec.ts
```

---

### Task 1: Шапка телефона и кнопки «+ − ⇄» наверху

**Files:**
- Modify: `src/client/components/AppHeader.tsx` (полная замена), `src/client/components/operation/OperationFormHost.tsx` (от `const BUTTONS` до конца файла), `src/client/components/AccountsPanel.tsx`, `src/client/components/Drawer.tsx`, `src/client/components/CompaniesDrawer.tsx`, `src/client/components/icons.tsx`, `src/client/components/ui.ts`, `src/client/pages/CompanyLayout.tsx`
- Test: `e2e/mobile.spec.ts`

**Interfaces:**
- Consumes: `useOpenOperationForm`, `SettingsMenuButton`, `CompanyAvatar`, `headerIconClass`, `btnClose`.
- Produces: `AppHeader(props: { menuButton?: ReactNode; company?: ReactNode; actions?: ReactNode; tools?: ReactNode; menu: { companyId: number | null; companyName: string | null } })`; `NewOperationButtons()` без свойств (группа `role="group"` «Добавить операцию»); `Drawer` — новое свойство `closeAt?: 'left' | 'right'`; `MenuIcon()`.

- [ ] **Step 1: Write the failing e2e test**

В `e2e/mobile.spec.ts` замените тест `'нижняя панель «Доход», «Расход», «Перевод» на телефоне; на компьютере кнопки — в шапке'` целиком (от строки `test('нижняя панель «Доход»…` до его закрывающей `});`) на:

```ts
test('шапка телефона (§8.1–8.2): ☰ «Счета» слева, компания ▾ по центру, шестерёнка справа; «+ \u2212 ⇄» второй строкой — только значки; на компьютере те же кнопки с подписями по центру шапки', async ({ page }) => {
  await login(page);
  const name = `ТОО Шапка с очень длинным названием компании ${Date.now()}`;
  const cid = await createCompany(page, name);
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await page.reload();
  const banner = page.getByRole('banner');
  const menu = banner.getByRole('button', { name: 'Счета', exact: true });
  const company = banner.getByRole('button', { name: `Сменить компанию: ${name}`, exact: true });
  const gear = banner.getByRole('button', { name: 'Настройки', exact: true });
  const income = bar(page).getByRole('button', { name: 'Доход', exact: true });
  const middle = (b: { y: number; height: number }) => b.y + b.height / 2;

  // компьютер: ☰ нет; кнопки с подписями — по центру шапки, в одной строке с блоком компании
  await expect(menu).toBeHidden();
  await expect(bar(page).getByRole('button')).toHaveText([/\+\s*Доход/, /\u2212\s*Расход/, /⇄\s*Перевод/], { useInnerText: true });
  expect(Math.abs(middle((await income.boundingBox())!) - middle((await company.boundingBox())!))).toBeLessThan(12);

  await page.setViewportSize(PHONE);
  // телефон: ☰ у левого края, шестерёнка у правого, компания между ними — в одной строке; цели касания 44 px
  const m = (await menu.boundingBox())!;
  const c = (await company.boundingBox())!;
  const g = (await gear.boundingBox())!;
  expect(m.x).toBeLessThan(24);
  expect(g.x + g.width).toBeGreaterThan(PHONE.width - 24);
  expect(c.x).toBeGreaterThanOrEqual(m.x + m.width);
  expect(c.x + c.width).toBeLessThanOrEqual(g.x);
  expect(Math.abs(middle(c) - middle(m))).toBeLessThan(8);
  expect(Math.abs(middle(g) - middle(m))).toBeLessThan(8);
  for (const b of [m, g]) {
    expect(b.width).toBeGreaterThanOrEqual(44);
    expect(b.height).toBeGreaterThanOrEqual(44);
  }
  // название — со стрелкой ▾, без подписи «Сменить компанию»; длинное обрезается, страница вбок не едет (Review Focus 1)
  await expect(company).toContainText('▾', { useInnerText: true });
  await expect(company).not.toContainText('Сменить компанию', { useInnerText: true });
  await expectNoSideScroll(page, 'шапка телефона');
  // «+ \u2212 ⇄» — в шапке второй строкой во всю ширину, только значки; имена и подсказки — «Доход», «Расход», «Перевод»
  await expect(banner.getByRole('group', { name: 'Добавить операцию' })).toBeVisible();
  const row = (await bar(page).boundingBox())!;
  expect(row.y).toBeGreaterThanOrEqual(m.y + m.height);
  expect(row.width).toBeGreaterThan(PHONE.width - 40);
  await expect(bar(page).getByRole('button')).toHaveText(['+', '\u2212', '⇄'], { useInnerText: true });
  for (const label of ['Доход', 'Расход', 'Перевод']) {
    const button = bar(page).getByRole('button', { name: label, exact: true });
    await expect(button).toHaveAttribute('title', label);
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }

  // кнопка открывает форму своего типа; Esc без изменений закрывает, фокус — снова на кнопке
  await bar(page).getByRole('button', { name: 'Перевод', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Новый перевод', exact: true })).toBeVisible();
  await expect(newForm(page).getByRole('combobox', { name: 'Со счёта', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(newForm(page)).toBeHidden();
  await expect(bar(page).getByRole('button', { name: 'Перевод', exact: true })).toBeFocused();

  // ☰ — панель счетов, «Закрыть» — в её левом углу (§8.1, снимок Finmap m01)
  await menu.click();
  const drawer = page.getByRole('dialog', { name: 'Счета', exact: true });
  const close = (await drawer.getByRole('button', { name: 'Закрыть' }).boundingBox())!;
  const title = (await drawer.getByRole('heading', { name: 'Счета', exact: true }).boundingBox())!;
  expect(close.x + close.width).toBeLessThanOrEqual(title.x);
  expect(close.width).toBeGreaterThanOrEqual(44);
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(menu).toBeFocused();
  // название ▾ — панель «Компании»; шестерёнка — панель «Настройки» с «Выйти»
  await company.click();
  await expect(page.getByRole('dialog', { name: 'Компании' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(company).toBeFocused();
  await gear.click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Выйти' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(gear).toBeFocused();
});
```

В том же файле в тесте `'журнал карточками догружается при прокрутке; последняя карточка не прячется под нижней панелью'` замените название на `'журнал карточками догружается при прокрутке; последняя карточка видна целиком'`, а строки

```ts
  // в самом низу страницы последняя карточка — над закреплённой панелью
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const last = (await list.last().boundingBox())!;
  const panelTop = (await bar(page).boundingBox())!.y;
  expect(last.y + last.height).toBeLessThanOrEqual(panelTop);
```

на

```ts
  // в самом низу страницы последняя карточка видна целиком: кнопки операций — в шапке, внизу ничего не закреплено
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const last = (await list.last().boundingBox())!;
  expect(last.y + last.height).toBeLessThanOrEqual(PHONE.height);
```

Помощник `bar` (группа «Добавить операцию») остаётся прежним: группа теперь в шапке и на телефоне, и на компьютере.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test e2e/mobile.spec.ts -g "шапка телефона"`
Expected: FAIL — на компьютере группа «Добавить операцию» скрыта (`bar(page).getByRole('button')` не находит кнопок с подписями).

- [ ] **Step 3: `MenuIcon`**

В конец `src/client/components/icons.tsx` добавьте:

```tsx
/** ☰ — «Счета» в шапке телефона (§8.1 этапа 1.5): только рисунок, имя кнопке даёт `aria-label`. */
export function MenuIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  );
}
```

- [ ] **Step 4: `AppHeader` — одна сетка на обе ширины**

Замените `src/client/components/AppHeader.tsx` целиком:

```tsx
import { useEffect, type ReactNode } from 'react';
import { useMeta } from '../lib/query';
import { SettingsMenuButton } from './SettingsMenuDrawer';

/**
 * Шапка (§3.1, §8.1–8.2 этапа 1.5) — одна сетка на обе ширины.
 * Компьютер: слева — блок компании (на страницах без компании — название продукта), по центру — «+ Доход», «\u2212 Расход»,
 * «⇄ Перевод» (actions), справа — иконка «История действий» (tools) и шестерёнка «Настройки».
 * Телефон: ☰ «Счета» слева (menuButton, только на телефоне), название компании ▾ по центру, шестерёнка справа; кнопки
 * операций — второй строкой во всю ширину. Имени пользователя и «Выйти» в шапке нет — они в панели «Настройки».
 * Название продукта всегда в document.title. В PWA на iPhone шапка начинается ниже выреза экрана.
 */
export function AppHeader(props: {
  menuButton?: ReactNode;
  company?: ReactNode;
  actions?: ReactNode;
  tools?: ReactNode;
  menu: { companyId: number | null; companyName: string | null };
}) {
  const meta = useMeta();

  useEffect(() => {
    if (meta.data) document.title = meta.data.appName;
  }, [meta.data]);

  return (
    <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-3 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white md:grid-cols-[minmax(12rem,1fr)_auto_auto] md:gap-4 md:px-6 md:pb-4 md:pt-[max(1rem,env(safe-area-inset-top))] lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
      {props.menuButton && <div className="col-start-1 row-start-1 md:hidden">{props.menuButton}</div>}
      <div className="col-start-2 row-start-1 flex min-w-0 items-center justify-center md:col-start-1 md:justify-start">
        {props.company ?? <span className="truncate text-lg font-bold">{meta.data?.appName}</span>}
      </div>
      {props.actions ? (
        // телефон — второй строкой во всю ширину (§8.2); компьютер — средняя колонка
        <div className="col-span-full row-start-2 min-w-0 md:row-start-1 md:[grid-column:2]">{props.actions}</div>
      ) : (
        <span aria-hidden="true" className="hidden md:row-start-1 md:block md:[grid-column:2]" />
      )}
      <div className="col-start-3 row-start-1 flex shrink-0 items-center justify-end gap-2">
        {props.tools}
        <SettingsMenuButton companyId={props.menu.companyId} companyName={props.menu.companyName} />
      </div>
    </header>
  );
}
```

Ряд кнопок задаётся только сокращённым свойством `grid-column` (`col-span-full`, на компьютере `md:[grid-column:2]` — оно и перекрывает): смесь `col-span-*` с `col-start-*` на одном элементе зависит от порядка правил в CSS.

- [ ] **Step 5: `NewOperationButtons` — одна разметка**

В `src/client/components/operation/OperationFormHost.tsx` замените всё от строки `const BUTTONS: { type: OperationType; symbol: string; label: string; bottom: string; header: string }[] = [` до конца файла на:

```tsx
const BUTTONS: { type: OperationType; symbol: string; label: string; className: string }[] = [
  { type: 'income', symbol: '+', label: 'Доход', className: 'bg-income/20 text-income-on-dark' },
  { type: 'expense', symbol: '\u2212', label: 'Расход', className: 'bg-expense/20 text-expense-on-dark' },
  { type: 'transfer', symbol: '⇄', label: 'Перевод', className: 'bg-white/10 text-white' },
];

/**
 * Кнопки новых операций (§3.1, §8.2 этапа 1.5; у минуса — знак U+2212) — одна разметка на обе ширины: группа
 * «Добавить операцию» в шапке. На компьютере — по центру шапки, одинаковой ширины, «+ Доход», «\u2212 Расход», «⇄ Перевод»;
 * на телефоне — второй строкой шапки во всю ширину, только значки, 44 px. Имя кнопки — `aria-label`, подсказка — `title`.
 */
export function NewOperationButtons() {
  const open = useOpenOperationForm();
  return (
    <div role="group" aria-label="Добавить операцию" className="grid grid-cols-3 gap-3 max-md:gap-4">
      {BUTTONS.map((b) => (
        <button
          key={b.type}
          type="button"
          aria-haspopup="dialog"
          aria-label={b.label}
          title={b.label}
          onClick={() => open({ kind: 'create', type: b.type })}
          className={`rounded-xl px-8 py-2.5 text-base font-semibold whitespace-nowrap hover:brightness-125 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus max-md:h-11 max-md:px-2 max-md:py-0 max-md:text-xl ${b.className}`}
        >
          <span aria-hidden="true">{b.symbol}</span>
          <span aria-hidden="true" className="max-md:hidden">
            {' '}
            {b.label}
          </span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: `Drawer` — «Закрыть» слева по желанию и 44 px на телефоне**

В `src/client/components/Drawer.tsx`:

замените строку импорта `import { btnIcon } from './ui';` на `import { btnClose } from './ui';`;

после свойства `footer?: ReactNode;` (с его комментарием) добавьте:

```tsx
  /** «Закрыть» в левом углу (панель «Счета» на телефоне, §8.1 этапа 1.5); по умолчанию — справа. */
  closeAt?: 'left' | 'right';
```

замените блок шапки панели

```tsx
          <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2">
            <div className="min-w-0">
              <h2 id={titleId} className="truncate text-xl font-bold">
                {props.title}
              </h2>
              {props.subtitle && <p className="truncate text-sm text-muted">{props.subtitle}</p>}
            </div>
            <button type="button" aria-label="Закрыть" onClick={() => ref.current?.close()} className={btnIcon}>
              <span aria-hidden="true">✕</span>
            </button>
          </div>
```

на

```tsx
          <div className={`flex items-center gap-3 px-4 pt-4 pb-2 ${props.closeAt === 'left' ? '' : 'justify-between'}`}>
            {props.closeAt === 'left' && closeButton}
            <div className="min-w-0">
              <h2 id={titleId} className="truncate text-xl font-bold">
                {props.title}
              </h2>
              {props.subtitle && <p className="truncate text-sm text-muted">{props.subtitle}</p>}
            </div>
            {props.closeAt !== 'left' && closeButton}
          </div>
```

и перед `return (` компонента (после объявления `side`) добавьте:

```tsx
  // на телефоне цель касания 44 px (btnClose)
  const closeButton = (
    <button type="button" aria-label="Закрыть" onClick={() => ref.current?.close()} className={btnClose}>
      <span aria-hidden="true">✕</span>
    </button>
  );
```

- [ ] **Step 7: ☰ «Счета» иконкой, «Закрыть» панели слева**

В `src/client/components/AccountsPanel.tsx`:

замените `import { PencilIcon, PlusIcon, RefreshIcon } from './icons';` на `import { MenuIcon, PencilIcon, PlusIcon, RefreshIcon } from './icons';`;

замените кнопку в `AccountsDrawerButton`

```tsx
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-xl bg-chrome-2 px-3 py-2 text-sm hover:bg-white/10 md:hidden"
      >
        Счета
      </button>
      <Drawer
        open={open}
        title="Счета"
        side="left"
```

на

```tsx
      <button
        type="button"
        aria-label="Счета"
        title="Счета"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="grid size-11 shrink-0 place-items-center rounded-xl text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus md:hidden"
      >
        <MenuIcon />
      </button>
      <Drawer
        open={open}
        title="Счета"
        side="left"
        closeAt="left"
```

Обновите комментарий над `AccountsDrawerButton`: «Счета на телефоне (§8.1 этапа 1.5): ☰ «Счета» в левом углу шапки, «Всего на счетах» и балансы выезжают слева, «Закрыть» — в левом углу панели. Переход по счёту (фильтр журнала) закрывает панель, фокус — на `<h1>` страницы (§11 этапа 1.5).»

- [ ] **Step 8: Название компании ▾ на телефоне**

В `src/client/components/CompaniesDrawer.tsx` замените кнопку в `CompanyBlockButton`

```tsx
        className="flex min-w-[10rem] max-w-xs items-center gap-3 rounded-xl px-2 py-1 text-left hover:bg-white/10 max-md:min-w-0"
      >
        <CompanyAvatar name={current.name} className="hidden h-10 w-10 text-sm md:grid" />
        <span className="min-w-0">
          <span className="block truncate font-semibold">{current.name}</span>
          <span className="block truncate text-xs text-white/60">Сменить компанию</span>
        </span>
      </button>
```

на

```tsx
        className="flex min-w-[10rem] max-w-xs items-center gap-3 rounded-xl px-2 py-1 text-left hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus max-md:min-h-11 max-md:min-w-0 max-md:max-w-full max-md:gap-1.5"
      >
        <CompanyAvatar name={current.name} className="hidden h-10 w-10 text-sm md:grid" />
        <span className="min-w-0">
          <span className="block truncate font-semibold">{current.name}</span>
          <span className="block truncate text-xs text-white/60 max-md:hidden">Сменить компанию</span>
        </span>
        {/* телефон (§8.1): название по центру шапки со стрелкой ▾, без аватара и подписи */}
        <span aria-hidden="true" className="shrink-0 text-sm md:hidden">
          ▾
        </span>
      </button>
```

- [ ] **Step 9: `CompanyLayout` и отступ карточки**

В `src/client/pages/CompanyLayout.tsx` замените

```tsx
        <AppHeader
          left={
            <>
              <AccountsDrawerButton company={company} />
              <CompanyBlockButton current={company} companies={companies.data} />
            </>
          }
          // архивная компания — только чтение: новых операций нет ни в шапке, ни в нижней панели
          actions={company.archivedAt ? undefined : <NewOperationButtons />}
```

на

```tsx
        <AppHeader
          menuButton={<AccountsDrawerButton company={company} />}
          company={<CompanyBlockButton current={company} companies={companies.data} />}
          // архивная компания — только чтение: кнопок новых операций нет ни на компьютере, ни на телефоне
          actions={company.archivedAt ? undefined : <NewOperationButtons />}
```

и удалите строку `        {!company.archivedAt && <NewOperationButtons placement="bottom" />}`.

В `src/client/components/ui.ts` замените определение `mainCardClass` вместе с комментарием на:

```ts
/**
 * Белая карточка содержимого страницы компании (журнал, раздел настроек). На телефоне снизу — отступ от края экрана и
 * «домашней» полосы iPhone; длинные слова без пробелов переносятся, выпадающие списки не шире своего блока.
 */
export const mainCardClass =
  'min-h-[calc(100dvh-5rem)] min-w-0 flex-1 rounded-t-3xl bg-card p-4 pb-[calc(2rem+env(safe-area-inset-bottom))] max-md:[overflow-wrap:anywhere] max-md:[&_select]:max-w-full md:p-8';
```

Проверьте, что `placement` больше нигде не передаётся: `grep -rn "placement=" src/client` → пусто.

- [ ] **Step 10: Run the tests**

Run: `npx playwright test e2e/mobile.spec.ts e2e/dialogs.spec.ts` → PASS (группа «Добавить операцию» теперь в шапке; тесты, которые нажимали в ней «Расход» на телефоне, работают без правок).

- [ ] **Step 11: Full check and commit**

Run: `npm test` → PASS. Run: `npm run typecheck`. Run: `npm run test:e2e` дважды → все проходят оба раза.

```bash
git add src/client/components/AppHeader.tsx src/client/components/operation/OperationFormHost.tsx src/client/components/AccountsPanel.tsx src/client/components/Drawer.tsx src/client/components/CompaniesDrawer.tsx src/client/components/icons.tsx src/client/components/ui.ts src/client/pages/CompanyLayout.tsx e2e/mobile.spec.ts
git commit -m "feat: телефон — шапка «☰ | компания ▾ | шестерёнка», кнопки «+ − ⇄» значками второй строкой шапки, нижняя панель кнопок убрана; «Закрыть» панели счетов слева

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Настройки на телефоне — экран «Настройки», «← Настройки», цели касания 44 px

**Files:**
- Modify: `src/client/pages/settings/SettingsNav.tsx` (полная замена), `src/client/pages/settings/SettingsLayout.tsx` (полная замена), `src/client/router.tsx`, `src/client/pages/CompanyLayout.tsx`, `src/client/components/ui.ts`, `src/client/components/SettingsList.tsx`, `src/client/components/SettingsSubmenu.tsx`, `src/client/components/CompaniesDrawer.tsx`, `src/client/pages/settings/CategoriesSettings.tsx`, `src/client/pages/settings/ProjectsTabs.tsx`
- Test: `e2e/mobile.spec.ts`

**Interfaces:**
- Consumes: `settingsGroups`, `ACCOUNT_GROUP_LABEL`, `DEFAULT_SETTINGS_SECTION` (`lib/settings-sections.ts`); `useIsMobile`; `focusHeadingSoon`, `isPlainLeftClick`, `pathOf`; `journalBackHref`, `readLastJournal`.
- Produces: `SettingsNav({ company, variant }: { company: Company; variant: 'sidebar' | 'list' })` (варианта `inline` больше нет); `SettingsListLink({ companyId }: { companyId: number })`; `SettingsIndex()` в `SettingsLayout.tsx`; `rowIconClass` — 44 px на телефоне.

- [ ] **Step 1: Write the failing e2e tests**

В `e2e/mobile.spec.ts` после теста `'выделение из широкого окна на телефоне снимается…'` добавьте:

```ts
test('настройки на телефоне (§8.6): «Настройки» — список разделов отдельным экраном, раздел — с «← Настройки»; окно стало шире — «Контрагенты» и меню слева', async ({ page }) => {
  await login(page);
  const name = `ТОО Настройки ${Date.now()}`;
  const cid = await createCompany(page, name);
  await page.setViewportSize(PHONE);
  await page.goto(`/c/${cid}/settings`);
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Настройки', exact: true })).toBeVisible();
  // в зоне настроек панель счетов не нужна: ☰ в шапке нет
  await expect(page.getByRole('banner').getByRole('button', { name: 'Счета', exact: true })).toHaveCount(0);
  const nav = page.getByRole('navigation', { name: 'Разделы настроек' });
  // те же группы и порядок, что в меню компьютера (§4.2); «← Назад к журналу» на экране нет — в журнал ведёт нижняя панель
  await expect(nav.getByRole('group', { name: 'Мой аккаунт' }).getByRole('link')).toHaveText([/^Профиль/, /^Мои компании/]);
  await expect(nav.getByRole('group', { name, exact: true }).getByRole('link')).toHaveText([
    /^Контрагенты/,
    /^Счета/,
    /^Категории/,
    /^Проекты/,
    /^Теги/,
    /^Пользователи/,
    /^Фиксированные курсы валют/,
    /^Резервное копирование/,
  ]);
  await expect(nav.getByRole('group', { name: 'Визуальные настройки' }).getByRole('link')).toHaveText([/^Настройки журнала/]);
  await expect(nav.getByRole('link', { name: /Назад к журналу/ })).toHaveCount(0);
  for (const link of await nav.getByRole('link').all()) {
    const b = (await link.boundingBox())!;
    expect(b.height, `строка «${await link.textContent()}»`).toBeGreaterThanOrEqual(44);
    expect(b.width).toBeGreaterThan(PHONE.width - 64);
  }
  await expectNoSideScroll(page, 'экран «Настройки»');

  // раздел — на весь экран: меню разделов нет, сверху «← Настройки»; фокус на заголовке раздела
  await nav.getByRole('link', { name: /^Теги/ }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/tags$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Теги' })).toBeFocused();
  await expect(page.getByRole('navigation', { name: 'Разделы настроек' })).toBeHidden();
  const back = page.getByRole('main').getByRole('link', { name: 'Настройки', exact: true });
  expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await back.click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Настройки', exact: true })).toBeFocused();

  // окно стало шире на экране списка — список не нужен: «Контрагенты», меню разделов слева (Review Focus 3)
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/counterparties$`));
  await expect(page.getByRole('navigation', { name: 'Разделы настроек' }).getByRole('link', { name: 'Контрагенты' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('main').getByRole('link', { name: 'Настройки', exact: true })).toBeHidden();
  // на компьютере «Настройки» без раздела — сразу «Контрагенты», как раньше
  await page.goto(`/c/${cid}/settings`);
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/counterparties$`));
});

test('настройки на телефоне: ☰, ✎, «+» и «банк» в списках и ✎ компании — 44×44 px; ссылки подменю и вкладки «Проекты» — не ниже 44 px', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Касание настроек ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  for (const name of ['Альфа', 'Бета']) await apiPost(page, `${base}/tags`, { name });
  for (const name of ['Аренда', 'Связь']) await apiPost(page, `${base}/categories`, { kind: 'expense', name });
  await page.setViewportSize(PHONE);
  const square = async (target: Locator, what: string) => {
    const b = (await target.boundingBox())!;
    expect(b.width, `${what}: ширина`).toBeGreaterThanOrEqual(44);
    expect(b.height, `${what}: высота`).toBeGreaterThanOrEqual(44);
  };
  const tall = async (links: Locator, what: string) => {
    await expect(links.first()).toBeVisible();
    for (const link of await links.all()) expect((await link.boundingBox())!.height, `${what} «${await link.textContent()}»`).toBeGreaterThanOrEqual(44);
  };

  await page.goto(`/c/${cid}/settings/tags`);
  const tags = page.getByRole('main').getByRole('list', { name: 'Теги' });
  await square(tags.getByRole('button', { name: 'Переместить Альфа', exact: true }), '☰ тега');
  await square(tags.getByRole('button', { name: 'Изменить Альфа', exact: true }), '✎ тега');

  await page.goto(`/c/${cid}/settings/categories?tab=my-expense`);
  const mine = page.getByRole('main').getByRole('list', { name: 'Мои категории расхода' });
  await square(mine.getByRole('button', { name: 'Добавить подкатегорию в Аренда', exact: true }), '«+» категории');
  await square(mine.getByRole('button', { name: 'Изменить Аренда', exact: true }), '✎ категории');
  await tall(page.getByRole('navigation', { name: 'Виды категорий' }).getByRole('link'), 'пункт подменю');
  await page.goto(`/c/${cid}/settings/categories?tab=system-expense`);
  await square(page.getByRole('main').getByRole('img', { name: 'Системная — не переименовывается и не удаляется' }).first(), '«банк»');

  await page.goto(`/c/${cid}/settings/counterparties`);
  await tall(page.getByRole('navigation', { name: 'Типы контрагентов' }).getByRole('link'), 'тип контрагентов');
  await page.goto(`/c/${cid}/settings/projects`);
  await tall(page.getByRole('navigation', { name: 'Проекты и шаблоны' }).getByRole('link'), 'вкладка');

  // ✎ компании в панели «Компании»
  await page.getByRole('banner').getByRole('button', { name: /^Сменить компанию/ }).click();
  await square(page.getByRole('dialog', { name: 'Компании' }).getByRole('button', { name: /^Изменить компанию/ }).first(), '✎ компании');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test e2e/mobile.spec.ts -g "настройки на телефоне"`
Expected: FAIL — `settings` перенаправляет на `counterparties` (первый тест), ☰ тега — 36 px (второй тест).

- [ ] **Step 3: `SettingsNav` — меню слева и список разделов**

Замените `src/client/pages/settings/SettingsNav.tsx` целиком:

```tsx
import { useId } from 'react';
import { Link, NavLink } from 'react-router';
import { CollapseButton } from '../../components/CollapseButton';
import { focusHeadingSoon, isPlainLeftClick, pathOf } from '../../lib/focus-heading';
import { journalBackHref, readLastJournal } from '../../lib/last-journal';
import type { Company } from '../../lib/queries';
import { ACCOUNT_GROUP_LABEL, settingsGroups } from '../../lib/settings-sections';
import { useSidebarCollapsed } from '../../lib/sidebar';

const sidebarLink = ({ isActive }: { isActive: boolean }) =>
  `block truncate rounded-xl px-3 py-2 text-sm ${isActive ? 'bg-field font-semibold text-ink' : 'text-muted hover:bg-field hover:text-ink'}`;
/** Строка экрана «Настройки» на телефоне (§8.6 этапа 1.5): во всю ширину, 48 px, «›» справа. */
const listLink = 'flex min-h-12 items-center justify-between gap-3 rounded-xl px-3 text-base text-ink hover:bg-field focus-visible:outline-2 focus-visible:outline-focus';

/**
 * Навигация зоны настроек (§4.1–4.2, §8.6 этапа 1.5) — разделы по группам.
 * `sidebar` — слева вместо панели счетов (компьютер), с «← Назад к журналу»; сворачивается той же настройкой, что панель
 * счетов (§3.6). `list` — экран «Настройки» на телефоне: разделы строками во всю ширину; в журнал ведёт вкладка «Журнал»
 * нижней панели. Без ролей listitem, status, alert, region: их ищут e2e экранов настроек.
 */
export function SettingsNav({ company, variant }: { company: Company; variant: 'sidebar' | 'list' }) {
  const { collapsed, toggle } = useSidebarCollapsed();
  if (variant === 'list') {
    return (
      <nav aria-label="Разделы настроек">
        <SettingsGroups companyId={company.id} companyName={company.name} list />
      </nav>
    );
  }
  const back = journalBackHref(company.id, readLastJournal(company.id));
  return (
    <nav aria-label="Разделы настроек" className={`relative hidden shrink-0 self-start md:block ${collapsed ? 'h-36 w-3' : 'w-64 rounded-3xl bg-card p-4'}`}>
      <CollapseButton collapsed={collapsed} onToggle={toggle} collapseLabel="Свернуть меню настроек" expandLabel="Развернуть меню настроек" />
      {collapsed && <BackLink to={back} compact />}
      {!collapsed && (
        <>
          <BackLink to={back} />
          <SettingsGroups companyId={company.id} companyName={company.name} list={false} />
        </>
      )}
    </nav>
  );
}

/**
 * «← Настройки» над разделом на телефоне (§8.6 этапа 1.5): назад к экрану списка разделов, фокус — на его `<h1>`.
 * На компьютере не видна — разделы в меню слева.
 */
export function SettingsListLink({ companyId }: { companyId: number }) {
  const to = `/c/${companyId}/settings`;
  return (
    <Link
      to={to}
      onClick={(e) => {
        if (isPlainLeftClick(e)) focusHeadingSoon(to);
      }}
      className="mb-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-field px-4 text-sm font-medium text-ink hover:brightness-95 md:hidden"
    >
      <span aria-hidden="true">←</span> Настройки
    </Link>
  );
}

/**
 * «← Назад к журналу»: ссылка исчезает вместе с меню настроек, поэтому фокус переносится на h1 журнала.
 * compact — только стрелка в свёрнутой полосе (под кнопкой сворачивания).
 */
function BackLink({ to, compact }: { to: string; compact?: boolean }) {
  const label = 'Назад к журналу';
  return (
    <Link
      to={to}
      onClick={(e) => {
        if (isPlainLeftClick(e)) focusHeadingSoon(pathOf(to));
      }}
      {...(compact ? { 'aria-label': label, title: label } : {})}
      className={
        compact
          ? '-right-4 absolute top-[4.75rem] z-10 grid h-8 w-8 place-items-center rounded-full border border-field bg-card text-ink shadow hover:bg-field'
          : 'mb-3 inline-flex items-center gap-2 rounded-xl bg-field px-4 py-2 text-sm font-medium text-ink hover:brightness-95'
      }
    >
      <span aria-hidden="true">←</span>
      {!compact && ` ${label}`}
    </Link>
  );
}

/** Группы разделов: в меню слева — NavLink с текущим разделом; на экране списка — строки со стрелкой и фокусом на `<h1>` раздела. */
function SettingsGroups(props: { companyId: number; companyName: string; list: boolean }) {
  const id = useId();
  return (
    <>
      {settingsGroups(props.companyName).map((g) => {
        const titleId = `${id}-${g.key}`;
        return (
          // настоящая группа с именем: программа чтения называет её при входе (итоги 1.5-1b №1); не список — listitem ищут e2e разделов
          <div
            key={g.key}
            role="group"
            {...(g.title ? { 'aria-labelledby': titleId } : { 'aria-label': ACCOUNT_GROUP_LABEL })}
            className={g.title ? 'mt-3 border-t border-field pt-3' : ''}
          >
            {g.title && (
              <p id={titleId} className="mb-1 truncate px-3 text-xs font-semibold uppercase tracking-wide text-muted">
                {g.title}
              </p>
            )}
            <div className={props.list ? 'grid' : 'grid gap-0.5'}>
              {g.items.map((s) => {
                const to = `/c/${props.companyId}/settings/${s.path}`;
                return props.list ? (
                  <Link
                    key={s.path}
                    to={to}
                    onClick={(e) => {
                      if (isPlainLeftClick(e)) focusHeadingSoon(pathOf(to));
                    }}
                    className={listLink}
                  >
                    <span className="min-w-0 truncate">{s.label}</span>
                    <span aria-hidden="true" className="shrink-0 text-muted">
                      ›
                    </span>
                  </Link>
                ) : (
                  <NavLink key={s.path} to={to} className={sidebarLink}>
                    {s.label}
                  </NavLink>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}
```

- [ ] **Step 4: `SettingsLayout` и `SettingsIndex`**

Замените `src/client/pages/settings/SettingsLayout.tsx` целиком:

```tsx
import { Navigate, Outlet, useLocation, useMatch, useOutletContext, useParams } from 'react-router';
import { mainCardClass } from '../../components/ui';
import { useIsMobile } from '../../lib/media';
import { DEFAULT_SETTINGS_SECTION } from '../../lib/settings-sections';
import type { CompanyOutletContext } from '../CompanyLayout';
import { SettingsListLink, SettingsNav } from './SettingsNav';

/**
 * Зона настроек (§4.1, §8.6 этапа 1.5): на компьютере слева вместо панели счетов — меню разделов, справа — белая
 * карточка с разделом. На телефоне раздел — на весь экран, над ним «← Настройки» (кроме самого экрана «Настройки»).
 * Заголовок раздела — `<h1>` самой страницы.
 */
export function SettingsLayout() {
  const context = useOutletContext<CompanyOutletContext>();
  const atList = useMatch('/c/:companyId/settings') !== null;
  return (
    <>
      <SettingsNav company={context.company} variant="sidebar" />
      <main className={mainCardClass}>
        {!atList && <SettingsListLink companyId={context.company.id} />}
        <Outlet context={context} />
      </main>
    </>
  );
}

/**
 * «Настройки» без раздела (§4.2, §8.6 этапа 1.5): на телефоне — экран «Настройки» со списком разделов по группам;
 * на компьютере — сразу «Контрагенты» (разделы и так в меню слева). Окно стало шире на этом экране — тоже перенаправление.
 */
export function SettingsIndex() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const mobile = useIsMobile();
  if (!mobile) return <SettingsRedirect section={DEFAULT_SETTINGS_SECTION} />;
  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">Настройки</h1>
      <SettingsNav company={company} variant="list" />
    </>
  );
}

/** Перенаправление внутри настроек компании: старые адреса и закладки (§4.2). */
export function SettingsRedirect({ section }: { section: string }) {
  const { companyId } = useParams();
  const { search, hash } = useLocation();
  return <Navigate to={`/c/${companyId}/settings/${section}${search}${hash}`} replace />;
}
```

В `src/client/router.tsx` замените `import { SettingsLayout, SettingsRedirect } from './pages/settings/SettingsLayout';` на `import { SettingsIndex, SettingsLayout, SettingsRedirect } from './pages/settings/SettingsLayout';` и строку `{ index: true, element: <SettingsRedirect section="counterparties" /> },` на `{ index: true, element: <SettingsIndex /> },`.

В `src/client/pages/CompanyLayout.tsx` замените `          menuButton={<AccountsDrawerButton company={company} />}` на:

```tsx
          // в зоне настроек панель счетов не нужна (§8.6)
          menuButton={inSettings ? undefined : <AccountsDrawerButton company={company} />}
```

- [ ] **Step 5: Цели касания 44 px**

`src/client/components/ui.ts` — замените `rowIconClass` с комментарием на:

```ts
/** Кнопка-иконка строки списка настроек и карточки компании (☰, ✎): 36 px, на телефоне — 44 px (цель касания). */
export const rowIconClass =
  'grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-card hover:text-ink focus-visible:outline-2 focus-visible:outline-focus max-md:size-11';
```

`src/client/components/SettingsList.tsx` — в заглушке ручки замените `className="grid h-9 w-9 shrink-0 place-items-center text-muted opacity-30"` на `className="grid h-9 w-9 shrink-0 place-items-center text-muted opacity-30 max-md:size-11"`.

`src/client/pages/settings/CategoriesSettings.tsx` — в `plusClass` замените `'grid h-9 w-9 shrink-0 place-items-center rounded-full text-income-strong hover:bg-income-soft focus-visible:outline-2 focus-visible:outline-focus'` на `'grid h-9 w-9 shrink-0 place-items-center rounded-full text-income-strong hover:bg-income-soft focus-visible:outline-2 focus-visible:outline-focus max-md:size-11'`; у значка «банк» замените `className="grid h-9 w-9 shrink-0 place-items-center text-muted"` на `className="grid h-9 w-9 shrink-0 place-items-center text-muted max-md:size-11"`.

`src/client/components/SettingsSubmenu.tsx` — в классе ссылки замените `flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm` на `flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm max-md:min-h-11` и в комментарии компонента «На телефоне — строкой с переносом.» на «На телефоне — строкой с переносом, пункты не ниже 44 px.».

`src/client/pages/settings/ProjectsTabs.tsx` — замените

```tsx
  `-mb-px border-b-2 px-1 pb-2 text-sm font-semibold ${isActive ? 'border-income-strong text-income-strong' : 'border-transparent text-muted hover:text-ink'}`;
```

на

```tsx
  `-mb-px border-b-2 px-1 pb-2 text-sm font-semibold max-md:inline-flex max-md:min-h-11 max-md:items-end ${isActive ? 'border-income-strong text-income-strong' : 'border-transparent text-muted hover:text-ink'}`;
```

`src/client/components/CompaniesDrawer.tsx` — у ✎ компании замените `className="mr-1 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-card hover:text-ink"` на `className="mr-1 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-card hover:text-ink focus-visible:outline-2 focus-visible:outline-focus max-md:size-11"` (заодно видимая рамка фокуса — итоги 1.5-4b №4).

- [ ] **Step 6: Run the tests**

Run: `npx playwright test e2e/mobile.spec.ts e2e/dictionaries.spec.ts e2e/companies.spec.ts e2e/money.spec.ts` → PASS.

- [ ] **Step 7: Full check and commit**

Run: `npm test` → PASS. Run: `npm run typecheck`. Run: `npm run test:e2e` дважды → все проходят оба раза.

```bash
git add src/client/pages/settings/SettingsNav.tsx src/client/pages/settings/SettingsLayout.tsx src/client/router.tsx src/client/pages/CompanyLayout.tsx src/client/components/ui.ts src/client/components/SettingsList.tsx src/client/components/SettingsSubmenu.tsx src/client/components/CompaniesDrawer.tsx src/client/pages/settings/CategoriesSettings.tsx src/client/pages/settings/ProjectsTabs.tsx e2e/mobile.spec.ts
git commit -m "feat: настройки на телефоне — экран «Настройки» со списком разделов, «← Настройки» над разделом; ☰, ✎, «+», «банк», подменю и вкладки — 44 px

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Нижняя панель вкладок `MobileTabBar` и «История действий» в «Ещё»

**Files:**
- Create: `src/client/components/MobileTabBar.tsx`
- Modify: `src/client/components/HistoryDrawer.tsx` (полная замена), `src/client/pages/CompanyLayout.tsx`, `src/client/components/ui.ts`
- Test: `e2e/mobile.spec.ts`

**Interfaces:**
- Consumes: `Popover` (сам ставит панель над кнопкой, если внизу нет места — `placeFloating`); `journalBackHref`, `readLastJournal`; `focusHeadingSoon`, `isPlainLeftClick`, `pathOf`; экран «Настройки» (задача 2).
- Produces: `HistoryPanel({ company, open, onClose }: { company: Company; open: boolean; onClose: () => void })`; `HistoryButton({ company })` — прежнее имя, на телефоне скрыт; `MobileTabBar({ company }: { company: Company })` — `<nav aria-label="Разделы" data-tab-bar="">` (атрибут `data-tab-bar` использует задача 4).

- [ ] **Step 1: Write the failing e2e test**

В `e2e/mobile.spec.ts` после теста `'настройки на телефоне: ☰, ✎, «+» и «банк»…'` добавьте:

```ts
test('нижняя панель «Разделы» (§8.3): «Журнал» и «Ещё» — «Пользователи», «Настройки», «История действий»; пилюли и значок истории на телефоне скрыты; на компьютере панели нет', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Вкладки ${Date.now()}`);
  const cash = (await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `/api/v1/companies/${cid}/operations`, { type: 'income', paidAt: new Date(Date.now() - 60_000).toISOString(), accountId: cash, amount: 10000 });
  await page.goto(`/c/${cid}/log?period=today`);
  const tabs = page.getByRole('navigation', { name: 'Разделы', exact: true });
  await expect(page.getByRole('table', { name: 'Операции' }).locator('tbody tr')).toHaveCount(1);
  // компьютер: панели нет, вкладка-пилюля «Журнал» — в карточке
  await expect(tabs).toBeHidden();
  await expect(page.getByRole('main').getByRole('link', { name: 'Журнал', exact: true })).toBeVisible();

  await page.setViewportSize(PHONE);
  await expect(tabs).toBeVisible();
  // у нижнего края во всю ширину; пилюля и значок истории в шапке на телефоне скрыты
  const box = (await tabs.boundingBox())!;
  expect(Math.round(box.y + box.height)).toBe(PHONE.height);
  expect(Math.round(box.width)).toBe(PHONE.width);
  await expect(page.getByRole('main').getByRole('link', { name: 'Журнал', exact: true })).toBeHidden();
  await expect(page.getByRole('banner').getByRole('button', { name: 'История действий' })).toBeHidden();
  const journal = tabs.getByRole('link', { name: 'Журнал', exact: true });
  const more = tabs.getByRole('button', { name: 'Ещё', exact: true });
  await expect(journal).toHaveAttribute('aria-current', 'page');
  for (const tab of [journal, more]) expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  // «Ещё» — меню над панелью, внутри экрана; Esc закрывает, фокус — на «Ещё»
  const menu = page.getByRole('dialog', { name: 'Ещё', exact: true });
  await more.click();
  await expect(menu.getByRole('link')).toHaveText(['Пользователи', 'Настройки']);
  await expect(menu.getByRole('button', { name: 'История действий' })).toBeVisible();
  const m = (await menu.boundingBox())!;
  expect(m.y + m.height).toBeLessThanOrEqual(box.y);
  expect(m.x).toBeGreaterThanOrEqual(0);
  expect(m.x + m.width).toBeLessThanOrEqual(PHONE.width);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();

  // «История действий» — та же панель, что у значка в шапке компьютера; закрыли — фокус на «Ещё»
  await more.click();
  await menu.getByRole('button', { name: 'История действий' }).click();
  const history = page.getByRole('dialog', { name: 'История действий' });
  await expect(history.getByRole('list', { name: 'Последние действия' })).toBeVisible();
  await expect(menu).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(history).toBeHidden();
  await expect(more).toBeFocused();

  // «Пользователи» — раздел настроек, фокус на заголовке; панель вкладок — и в зоне настроек
  await more.click();
  await menu.getByRole('link', { name: 'Пользователи' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/users$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Пользователи' })).toBeFocused();
  await expect(tabs).toBeVisible();
  await expect(journal).not.toHaveAttribute('aria-current', 'page');
  // «Журнал» — обратно в журнал с прежним фильтром (Review Focus 5)
  await journal.click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log\\?period=today$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Журнал' })).toBeFocused();
  // «Настройки» — экран со списком разделов (§8.6)
  await more.click();
  await menu.getByRole('link', { name: 'Настройки' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Настройки', exact: true })).toBeFocused();

  // компьютер: панели нет
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(tabs).toBeHidden();
});
```

В тесте `'журнал карточками догружается при прокрутке; последняя карточка видна целиком'` замените название на `'журнал карточками догружается при прокрутке; последняя карточка не прячется под нижней панелью вкладок'` и строки

```ts
  // в самом низу страницы последняя карточка видна целиком: кнопки операций — в шапке, внизу ничего не закреплено
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const last = (await list.last().boundingBox())!;
  expect(last.y + last.height).toBeLessThanOrEqual(PHONE.height);
```

на

```ts
  // в самом низу страницы последняя карточка — над закреплённой нижней панелью вкладок
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const last = (await list.last().boundingBox())!;
  const barTop = (await page.getByRole('navigation', { name: 'Разделы', exact: true }).boundingBox())!.y;
  expect(last.y + last.height).toBeLessThanOrEqual(barTop);
```

В тесте `'архивная компания: форма операции только для просмотра…'` после строки `  await expect(bar(page)).toHaveCount(0);` добавьте (Review Focus 2):

```ts
  // нижняя панель вкладок у архивной компании есть: навигация не меняет данных
  await expect(page.getByRole('navigation', { name: 'Разделы', exact: true })).toBeVisible();
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test e2e/mobile.spec.ts -g "нижняя панель «Разделы»"`
Expected: FAIL — навигации «Разделы» нет.

- [ ] **Step 3: `HistoryPanel` отдельно от кнопки**

Замените `src/client/components/HistoryDrawer.tsx` целиком:

```tsx
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { focusHeadingSoon, isPlainLeftClick } from '../lib/focus-heading';
import { historyItems, type HistoryItem } from '../lib/history';
import { useMeta } from '../lib/query';
import { useAccounts, useOperationHistory, type Company } from '../lib/queries';
import { Drawer } from './Drawer';
import { HistoryIcon } from './icons';
import { useOpenOperationForm } from './operation/OperationFormHost';
import { Pending } from './QueryState';
import { btnPrimary, headerIconClass } from './ui';

const AMOUNT_CLASS: Record<NonNullable<HistoryItem['type']>, string> = { income: 'text-income', expense: 'text-expense-strong', transfer: 'text-transfer' };

/**
 * Правая панель «История действий» (§3.4 этапа 1.5) — последние действия с операциями. Открывается значком в шапке
 * (компьютер) и пунктом «История действий» в «Ещё» нижней панели (телефон, §8.3). Закрытие — фокус на то, чем открыли.
 */
export function HistoryPanel({ company, open, onClose }: { company: Company; open: boolean; onClose: () => void }) {
  const navigated = useRef(false);
  /** Операция из списка: форма открывается, когда панель уже закрыта, — по закрытии формы фокус вернётся на кнопку открытия. */
  const pendingOperation = useRef<number | null>(null);
  const openForm = useOpenOperationForm();
  return (
    <Drawer
      open={open}
      side="right"
      title="История действий"
      onClose={onClose}
      afterClose={() => {
        const handled = navigated.current;
        navigated.current = false;
        const id = pendingOperation.current;
        pendingOperation.current = null;
        if (id === null) return handled;
        openForm({ kind: 'edit', id });
        return false; // фокус сначала на кнопку открытия: она станет «откуда открыли» для формы
      }}
      footer={
        <Link
          to={`/c/${company.id}/settings/audit`}
          onClick={(e) => {
            if (!isPlainLeftClick(e)) return;
            navigated.current = true;
            focusHeadingSoon(`/c/${company.id}/settings/audit`);
            onClose();
          }}
          className={`${btnPrimary} block text-center`}
        >
          Подробнее
        </Link>
      }
    >
      <HistoryList
        company={company}
        onOpenOperation={(id) => {
          pendingOperation.current = id;
          onClose();
        }}
      />
    </Drawer>
  );
}

/** Значок «История действий» в шапке компьютера (§3.1); на телефоне история — в «Ещё» нижней панели (§8.3). */
export function HistoryButton({ company }: { company: Company }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label="История действий"
        title="История действий"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={`${headerIconClass} max-md:hidden`}
      >
        <HistoryIcon />
      </button>
      <HistoryPanel company={company} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function HistoryList(props: { company: Company; onOpenOperation: (id: number) => void }) {
  const feed = useOperationHistory(props.company.id);
  const accounts = useAccounts(props.company.id);
  const meta = useMeta();
  // прошлые строки при повторном открытии не показываем: «Загрузка…», пока не пришёл свежий ответ
  if (!feed.data || !feed.isFetchedAfterMount || !accounts.data || !meta.data) return <Pending queries={[feed, accounts, meta]} />;
  const items = historyItems(feed.data, { accounts: new Map(accounts.data.map((a) => [a.id, a])), timeZone: meta.data.timezone });

  return (
    <div>
      <div>
        {items.length === 0 ? (
          <p className="text-sm text-muted">Действий с операциями пока нет.</p>
        ) : (
          <ul aria-label="Последние действия" className="divide-y divide-field">
            {items.map((it) => {
              const body = (
                <>
                  <span className="block font-semibold">{it.title}</span>
                  {(it.amount || it.account) && (
                    <span className="block text-sm">
                      {it.amount && <span className={`tabular-nums ${it.type ? AMOUNT_CLASS[it.type] : ''}`}>{it.amount}</span>}
                      {it.amount && it.account && ' · '}
                      {it.account}
                    </span>
                  )}
                  {it.changes && <span className="block text-sm text-muted">{it.changes}</span>}
                  <span className="block text-xs text-muted">{it.meta}</span>
                </>
              );
              return (
                <li key={it.id} className="py-2">
                  {it.openable && it.operationId !== null ? (
                    <button
                      type="button"
                      onClick={() => props.onOpenOperation(it.operationId!)}
                      className="w-full rounded-xl px-2 py-1 text-left hover:bg-field"
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="px-2 py-1">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
```

`HistoryList` перенесён без изменений.

- [ ] **Step 4: `MobileTabBar`**

Создайте `src/client/components/MobileTabBar.tsx`:

```tsx
import { useState, type MouseEvent } from 'react';
import { Link, NavLink, useLocation, useMatch } from 'react-router';
import { focusHeadingSoon, isPlainLeftClick, pathOf } from '../lib/focus-heading';
import { journalBackHref, readLastJournal } from '../lib/last-journal';
import type { Company } from '../lib/queries';
import { HistoryPanel } from './HistoryDrawer';
import { Popover } from './Popover';

/** Вкладка нижней панели: 56 px; текущая (`aria-current="page"`) — тёмным текстом и чертой сверху, как в Finmap. */
const tabClass =
  'relative flex h-14 w-full items-center justify-center text-xs font-semibold text-muted hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus aria-[current=page]:text-ink aria-[current=page]:before:absolute aria-[current=page]:before:top-0 aria-[current=page]:before:h-0.5 aria-[current=page]:before:w-8 aria-[current=page]:before:rounded-full aria-[current=page]:before:bg-ink';
/** Пункт меню «Ещё»: цель касания 48 px. */
const itemClass =
  'flex min-h-12 w-full items-center rounded-xl px-3 text-left text-base font-medium text-ink hover:bg-field focus-visible:outline-2 focus-visible:outline-focus';

/**
 * Нижняя панель вкладок на телефоне (§8.3 этапа 1.5): «Журнал» и «Ещё» — меню вверх с «Пользователи», «Настройки»
 * (экран списка разделов, §8.6) и «История действий» (панель §3.4). «Аналитика» появится на этапе 2 между ними.
 * «Журнал» в самом журнале — текущий адрес; из настроек — последний адрес журнала с фильтром. Переход по ссылке ставит
 * фокус на `<h1>` новой страницы; закрытие истории возвращает фокус на «Ещё». На компьютере панели нет.
 */
export function MobileTabBar({ company }: { company: Company }) {
  const [history, setHistory] = useState(false);
  const location = useLocation();
  const onJournal = useMatch('/c/:companyId/log') !== null;
  // запомненный адрес журнала обновляется после отрисовки страницы — в самом журнале берём текущий
  const journal = onJournal ? `${location.pathname}${location.search}` : journalBackHref(company.id, readLastJournal(company.id));
  const users = `/c/${company.id}/settings/users`;
  const settings = `/c/${company.id}/settings`;
  // обычное нажатие: фокус на <h1> новой страницы, меню закрывается без возврата фокуса на «Ещё»
  const go = (to: string, close?: (returnFocus?: boolean) => void) => (e: MouseEvent) => {
    if (!isPlainLeftClick(e)) return;
    focusHeadingSoon(pathOf(to));
    close?.(false);
  };
  return (
    <nav
      aria-label="Разделы"
      data-tab-bar=""
      className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-2 border-t border-field bg-card pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] text-ink shadow-[0_-4px_16px_rgb(0_0_0/0.08)] md:hidden"
    >
      <NavLink to={journal} onClick={go(journal)} className={tabClass}>
        Журнал
      </NavLink>
      <Popover label="Ещё" align="right" buttonClassName={tabClass} panelClassName="w-60">
        {(close) => (
          <ul className="flex flex-col">
            <li>
              <Link to={users} onClick={go(users, close)} className={itemClass}>
                Пользователи
              </Link>
            </li>
            <li>
              <Link to={settings} onClick={go(settings, close)} className={itemClass}>
                Настройки
              </Link>
            </li>
            <li>
              <button
                type="button"
                onClick={() => {
                  // фокус сначала на «Ещё»: панель истории запомнит его как кнопку открытия
                  close(true);
                  setHistory(true);
                }}
                className={itemClass}
              >
                История действий
              </button>
            </li>
          </ul>
        )}
      </Popover>
      <HistoryPanel company={company} open={history} onClose={() => setHistory(false)} />
    </nav>
  );
}
```

- [ ] **Step 5: `CompanyLayout` — панель, пилюли на телефоне, отступ карточки**

В `src/client/pages/CompanyLayout.tsx`:

добавьте импорт `import { MobileTabBar } from '../components/MobileTabBar';` (после импорта `LoadError`);

замените `<nav className="mb-6 flex gap-2">` на `<nav className="mb-6 flex gap-2 max-md:hidden">` (на телефоне вкладки — в нижней панели, §8.3);

после закрывающего `</div>` блока `<div className="flex items-start gap-4 md:mx-4">…</div>` (перед закрывающим `</div>` обёртки `min-h-dvh`) добавьте `<MobileTabBar company={company} />`.

В `src/client/components/ui.ts` замените определение `mainCardClass` вместе с комментарием на:

```ts
/**
 * Белая карточка содержимого страницы компании (журнал, раздел настроек). На телефоне снизу — место под нижнюю панель
 * вкладок (§8.3) и «домашнюю» полосу iPhone; длинные слова без пробелов переносятся, выпадающие списки не шире своего блока.
 */
export const mainCardClass =
  'min-h-[calc(100dvh-5rem)] min-w-0 flex-1 rounded-t-3xl bg-card p-4 pb-[calc(5rem+env(safe-area-inset-bottom))] max-md:[overflow-wrap:anywhere] max-md:[&_select]:max-w-full md:p-8';
```

- [ ] **Step 6: Run the tests**

Run: `npx playwright test e2e/mobile.spec.ts e2e/service-screens.spec.ts` → PASS.

- [ ] **Step 7: Full check and commit**

Run: `npm test` → PASS. Run: `npm run typecheck`. Run: `npm run test:e2e` дважды → все проходят оба раза.

```bash
git add src/client/components/MobileTabBar.tsx src/client/components/HistoryDrawer.tsx src/client/pages/CompanyLayout.tsx src/client/components/ui.ts e2e/mobile.spec.ts
git commit -m "feat: телефон — нижняя панель вкладок «Журнал | Ещё» (Пользователи, Настройки, История действий); пилюли и значок истории на телефоне скрыты

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Перетаскивание касанием — прокрутка у края экрана и e2e касанием

**Files:**
- Modify: `src/client/lib/settings-list.ts`, `src/client/components/SettingsList.tsx`
- Test: `tests/client/settings-list.test.ts`, `e2e/mobile.spec.ts`

**Interfaces:**
- Consumes: `dropIndexAt`, `dropInGroup` (`lib/settings-list.ts`); `data-tab-bar` нижней панели (задача 3).
- Produces: `EDGE_SCROLL_ZONE = 56`, `EDGE_SCROLL_MAX = 18`; `edgeScrollStep(y: number, top: number, bottom: number): number` — шаг прокрутки за кадр, отрицательный — вверх.

- [ ] **Step 1: Write the failing unit test**

В `tests/client/settings-list.test.ts` замените строку импорта на

```ts
import { dropIndexAt, dropInGroup, EDGE_SCROLL_MAX, EDGE_SCROLL_ZONE, edgeScrollStep, moveGroup, movedText, shiftInGroup, visibleRows, type SettingsRow } from '../../src/client/lib/settings-list';
```

и в конец файла добавьте:

```ts
describe('edgeScrollStep — прокрутка у края, пока строку тянут (итоги 1.5-4a)', () => {
  it('в середине области — 0', () => {
    expect(edgeScrollStep(400, 0, 800)).toBe(0);
  });

  it('у нижнего края — вниз; чем ближе к краю, тем быстрее; за краем — не быстрее предела', () => {
    const near = edgeScrollStep(800 - 50, 0, 800);
    const nearer = edgeScrollStep(800 - 10, 0, 800);
    expect(near).toBeGreaterThan(0);
    expect(nearer).toBeGreaterThan(near);
    expect(edgeScrollStep(830, 0, 800)).toBe(EDGE_SCROLL_MAX);
  });

  it('у верхнего края — вверх (отрицательный шаг); край области — её верх, а не верх окна', () => {
    expect(edgeScrollStep(110, 100, 800)).toBeLessThan(0);
    expect(edgeScrollStep(50, 100, 800)).toBe(-EDGE_SCROLL_MAX);
    expect(edgeScrollStep(110, 0, 800)).toBe(0);
  });

  it('граница зоны ещё не прокручивает', () => {
    expect(edgeScrollStep(EDGE_SCROLL_ZONE, 0, 800)).toBe(0);
    expect(edgeScrollStep(800 - EDGE_SCROLL_ZONE, 0, 800)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/client/settings-list.test.ts`
Expected: FAIL — `edgeScrollStep` не экспортируется.

- [ ] **Step 3: `edgeScrollStep`**

В конец `src/client/lib/settings-list.ts` добавьте:

```ts
/** Зона у края области прокрутки, где перетаскивание строки прокручивает список, px (итоги 1.5-4a). */
export const EDGE_SCROLL_ZONE = 56;
/** Наибольший шаг такой прокрутки за кадр, px. */
export const EDGE_SCROLL_MAX = 18;

/**
 * Шаг прокрутки за кадр, пока строку тянут: указатель (y) ближе EDGE_SCROLL_ZONE к верху или низу видимой области
 * [top, bottom] — прокрутка вверх (отрицательный шаг) или вниз, тем быстрее, чем ближе к краю, но не больше
 * EDGE_SCROLL_MAX; за краем — предел. Иначе 0.
 */
export function edgeScrollStep(y: number, top: number, bottom: number): number {
  const up = top + EDGE_SCROLL_ZONE - y;
  if (up > 0) return -Math.ceil(EDGE_SCROLL_MAX * Math.min(1, up / EDGE_SCROLL_ZONE));
  const down = y - (bottom - EDGE_SCROLL_ZONE);
  if (down > 0) return Math.ceil(EDGE_SCROLL_MAX * Math.min(1, down / EDGE_SCROLL_ZONE));
  return 0;
}
```

Run: `npx vitest run tests/client/settings-list.test.ts` → PASS.

- [ ] **Step 4: Write the failing e2e test**

В конец `e2e/mobile.spec.ts` добавьте:

```ts
test.describe('касание: перетаскивание в списках настроек, 390×844', () => {
  test.use({ hasTouch: true });

  test('теги: ☰ пальцем переставляет строку; у нижнего края экрана список едет сам и строка встаёт под пальцем ниже', async ({ page }) => {
    await login(page);
    const cid = await createCompany(page, `ТОО Касание тегов ${Date.now()}`);
    const base = `/api/v1/companies/${cid}`;
    for (let i = 1; i <= 30; i++) await apiPost(page, `${base}/tags`, { name: `Тег ${String(i).padStart(2, '0')}` });
    await page.setViewportSize(PHONE);
    await page.goto(`/c/${cid}/settings/tags`);
    const list = page.getByRole('main').getByRole('list', { name: 'Теги' });
    await expect(list.getByRole('listitem')).toHaveCount(30);
    const order = async () => ((await (await page.request.get(`${base}/tags`)).json()).tags as { name: string }[]).map((t) => t.name);
    // Playwright умеет только «тап»; протяжку пальцем шлём протоколом Chromium — touch-события дают pointer-события с pointerType «touch»
    const cdp = await page.context().newCDPSession(page);
    const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) => {
      await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    };
    const centre = async (target: Locator) => {
      const b = (await target.boundingBox())!;
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    };
    const grip = (name: string) => list.getByRole('button', { name: `Переместить ${name}`, exact: true });

    // короткая протяжка вдали от края: «Тег 03» — на место «Тег 01»
    const from = await centre(grip('Тег 03'));
    const top = (await list.getByRole('listitem').first().boundingBox())!.y + 4;
    await touch('touchStart', from.x, from.y);
    for (let i = 1; i <= 6; i++) await touch('touchMove', from.x, from.y + ((top - from.y) * i) / 6);
    await touch('touchEnd');
    await expect(list.getByRole('listitem').first()).toContainText('Тег 03');
    await expect.poll(async () => (await order())[0]).toBe('Тег 03');
    // пока палец тянул ручку вдали от края, страница не прокручивалась
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    // палец у нижнего края, над панелью вкладок: список едет сам; отпущенная строка встаёт далеко внизу (Review Focus 4)
    const bar = (await page.getByRole('navigation', { name: 'Разделы', exact: true }).boundingBox())!;
    const start = await centre(grip('Тег 03'));
    await touch('touchStart', start.x, start.y);
    await touch('touchMove', start.x, start.y + 20);
    await touch('touchMove', start.x, bar.y - 10);
    await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 5000 }).toBeGreaterThan(400);
    await touch('touchEnd');
    await expect.poll(async () => (await order()).indexOf('Тег 03'), { timeout: 5000 }).toBeGreaterThan(9);
    // после броска фокус — на ручке строки
    await expect(grip('Тег 03')).toBeFocused();
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx playwright test e2e/mobile.spec.ts -g "перетаскивание в списках настроек"`
Expected: FAIL на ожидании `window.scrollY > 400` — у края список не едет. Первая часть (короткая протяжка) уже проходит: перетаскивание касанием сделано в 1.5-4a.

- [ ] **Step 6: Прокрутка у края в `SettingsList`**

В `src/client/components/SettingsList.tsx`:

замените строку импорта `import { dropIndexAt, dropInGroup, moveGroup, movedText, shiftInGroup, visibleRows, type SettingsRow } from '../lib/settings-list';` на

```tsx
import { dropIndexAt, dropInGroup, edgeScrollStep, moveGroup, movedText, shiftInGroup, visibleRows, type SettingsRow } from '../lib/settings-list';
```

после строки `const markAfter = 'shadow-[inset_0_-2px_0_0_var(--color-focus)]';` добавьте:

```tsx
/**
 * Что прокручивает перетаскивание у края (итоги 1.5-4a): ближайший предок с прокруткой (окно «Счета»); в окне без
 * прокрутки — ничего (страница под окном не должна ехать); иначе страница — без нижней панели вкладок (§8.3),
 * которая закрывает низ экрана на телефоне.
 */
function scrollAreaOf(el: HTMLElement): { top: number; bottom: number; scroll: (dy: number) => void } | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const node = p;
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) {
      const r = node.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, scroll: (dy) => node.scrollBy(0, dy) };
    }
    if (node instanceof HTMLDialogElement) return null;
  }
  const bar = document.querySelector<HTMLElement>('[data-tab-bar]');
  const barTop = bar && bar.getClientRects().length > 0 ? bar.getBoundingClientRect().top : window.innerHeight;
  return { top: 0, bottom: Math.min(window.innerHeight, barTop), scroll: (dy) => window.scrollBy(0, dy) };
}
```

после строки `const lastHandle = useRef<number | null>(null);` добавьте:

```tsx
  /** Где сейчас указатель, пока строку тянут: прокрутка у края идёт и без новых движений пальца. */
  const pointerY = useRef<number | null>(null);
```

в `onPointerDown` после строки `lastHandle.current = row.id;` добавьте `    pointerY.current = e.clientY;`;

замените `onPointerMove`

```tsx
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
```

на

```tsx
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    pointerY.current = e.clientY;
```

после определения `onPointerUp` (перед комментарием `// где встанет строка: …`) добавьте:

```tsx
  // у края области прокрутки список едет сам, пока строку держат (палец может стоять на месте); место вставки —
  // заново после каждого шага прокрутки
  const dragId = drag?.id ?? null;
  useEffect(() => {
    if (dragId === null) return;
    let frame = 0;
    const tick = () => {
      const row = rowEls.current.get(dragId);
      const y = pointerY.current;
      const area = row && y !== null ? scrollAreaOf(row) : null;
      const step = area && y !== null ? edgeScrollStep(y, area.top, area.bottom) : 0;
      if (area && y !== null && step !== 0) {
        area.scroll(step);
        setDrag((d) => {
          if (!d) return d;
          const index = dropIndexAt(midpoints(d.group.filter((id) => id !== d.id)), y);
          return index === d.index ? d : { ...d, index };
        });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragId]);
```

и в комментарии компонента после слов «(события указателя с захватом: мышь и касание одним кодом)» допишите «; у края области прокрутки список едет сам».

Хук стоит до `return` и без условий — порядок хуков не меняется. `midpoints` объявлен выше и читает только ref.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/client/settings-list.test.ts` → PASS. Run: `npx playwright test e2e/mobile.spec.ts -g "перетаскивание в списках настроек" --repeat-each=5` → 5/5 PASS. Run: `npx playwright test e2e/dictionaries.spec.ts e2e/accounts-panel.spec.ts` → PASS (перетаскивание мышью и Esc при перетаскивании в окне «Счета» не изменились).

- [ ] **Step 8: Full check and commit**

Run: `npm test` → PASS. Run: `npm run typecheck`. Run: `npm run test:e2e` дважды → все проходят оба раза.

```bash
git add src/client/lib/settings-list.ts src/client/components/SettingsList.tsx tests/client/settings-list.test.ts e2e/mobile.spec.ts
git commit -m "feat: перетаскивание в списках настроек — у края экрана или окна список едет сам; e2e протяжки пальцем

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Визуальная сверка — шапка, нижняя панель, экран «Настройки»; «Проверить на телефоне»

**Files:**
- Modify: `scripts/ux-shots.ts`

**Interfaces:**
- Consumes: шапка (задача 1), экран «Настройки» (задача 2), `MobileTabBar` (задача 3).
- Produces: снимки `cm03-more.png`, `cm07-settings.png`; обновлённые `cm01-accounts.png`, `cm02-log.png`, `cm04-op-open.png`, `cm05-income.png`; итог сверки и список «Проверить на телефоне» в отчёте задачи.

- [ ] **Step 1: Add the scenarios**

В `scripts/ux-shots.ts` в `SCENARIOS` после строки `  { ours: 'cm02-log.png', finmap: 'm02-log-closed-panel.png', phone: true, path: 'log' },` вставьте:

```ts
  {
    ours: 'cm03-more.png',
    finmap: 'm03-more.png',
    phone: true,
    path: 'log',
    act: async (p) => {
      // «Ещё» нижней панели — меню вверх: Пользователи, Настройки, История действий (§8.3)
      await p.getByRole('navigation', { name: 'Разделы', exact: true }).getByRole('button', { name: 'Ещё', exact: true }).click();
      await p.getByRole('dialog', { name: 'Ещё', exact: true }).waitFor();
    },
  },
```

а в конец `SCENARIOS` (после сценария `cm05-income.png`) добавьте:

```ts
  // экран «Настройки» на телефоне (§8.6); снимка Finmap нет — в index.html слева «нет снимка Finmap»
  { ours: 'cm07-settings.png', finmap: 'm07-settings.png', phone: true, path: 'settings' },
```

Сценарии `cm01` (кнопка «Счета» в шапке — имя прежнее) и `cm05` (группа «Добавить операцию» — теперь в шапке) правок не требуют.

Run: `npm run typecheck` → без ошибок.

- [ ] **Step 2: Run the visual check**

Run: `npm run shots:ux`
Expected: `Готово: …\parity\index.html — снято 48 из 48.` Упавший сценарий — исправьте его локатор и запустите ещё раз.

- [ ] **Step 3: Compare and write the parity note into the task report**

Пары `docs/research/screens/v2/<Finmap>` ↔ `docs/research/screens/v2/parity/<наш>`: `m01-log` ↔ `cm01-accounts`, `m02-log-closed-panel` ↔ `cm02-log`, `m03-more` ↔ `cm03-more`, `m04-op-open` ↔ `cm04-op-open`, `m05-income` ↔ `cm05-income`; `cm07-settings` — без пары.

В отчёт задачи (не в файл) — таблица по этим экранам: «совпадает / отличается намеренно (почему) / отличается (что исправить, в каком плане)». Ожидаемо:
- **совпадают:** ☰ слева, название ▾ по центру, шестерёнка справа; «+ − ⇄» значками под шапкой в тёмной зоне; нижняя панель с «Журнал» и «Ещё», меню «Ещё» вверх справа; «Закрыть» панели счетов в левом углу; «Мои счета» с «+ ✎ ⟳»;
- **отличаются намеренно:** во «Ещё» только наши пункты (нет «Счетов-фактур», «Календаря», «Автоправил», «Маркетплейса»; «История действий» — наша); в нижней панели нет «Аналитики» (этап 2), «AI советника» и «Поддержки» (вне рамок); счета в панели по клубам; форма на весь экран, а не карточкой (решение 9 плана 1.5-5); цвета и шрифт;
- **отличается, план 1.5-5b:** порядок строк карточки, строка поиска с ⟳ и воронкой, окно «Фильтры» (`cm02`, `m06`).

Там же — список **«Проверить на телефоне»** (Playwright этого не воспроизводит; контролёр переносит его в итоги плана):
- iPhone, PWA с главного экрана: шапка ниже выреза, нижняя панель выше «домашней» полосы, в горизонтальном положении ничего не уходит под вырез слева и справа;
- iOS Safari и Android Chrome: «Ещё» открывается вверх и закрывается касанием мимо; касание пункта не «проскакивает» на карточку под меню;
- перетаскивание за ☰ на устройстве: страница не едет, пока палец тянет ручку вдали от края; у края скорость прокрутки удобна; долгое касание ☰ не вызывает меню выделения текста и «лупу» iOS;
- Android: системная «Назад» при открытой панели «Счета», «Компании», «История действий» и меню «Ещё» (отложенное 1.5-1a №3);
- iOS: страница под открытой панелью не прокручивается (отложенное 7 №6).

- [ ] **Step 4: Final checks**

Run: `npm test` → PASS. Run: `npm run typecheck`. Run: `npm run test:e2e` → все проходят. Проверьте, что нижней панели кнопок и строки ссылок над разделом не осталось: `grep -rn "placement=\|variant=\"inline\"" src/client --include=*.tsx` → пусто. Панель «Период и условия» в `JournalToolbar.tsx` пока остаётся — её убирает план 1.5-5b.

- [ ] **Step 5: Commit**

```bash
git add scripts/ux-shots.ts
git commit -m "feat: сверка с Finmap на телефоне — меню «Ещё» нижней панели и экран «Настройки»

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## После плана

- Итоги, отложенные замечания, итог визуальной сверки и список «Проверить на телефоне» — `docs/superpowers/followups/2026-10-12-stage1_5-plan5a-followups.md` (пишет контролёр).
- Закрыты: итоги 1.5-4a «Проверить на телефоне» (☰ и ✎ 44 px, подменю, перетаскивание касанием у края и e2e касанием), итоги 1.5-4b №4 (рамка фокуса ✎ компании), решение 7 плана 1.5-1 (строка ссылок над разделом заменена экраном «Настройки»).
- Следующий план — [1.5-5b](2026-10-12-stage1_5-plan5b-phone-journal-forms.md): фильтр в один шаг, карточка журнала, формы на 390 px.
