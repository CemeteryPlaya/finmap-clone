# Этап 1.5, план 1.5-1b: каркас — шапка, панели, зона настроек, сворачивание, визуальная сверка — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** вторая половина плана 1.5-1 из §13 спецификации этапа 1.5:
- зона настроек: `SettingsLayout`, группированная вертикальная навигация, адреса и перенаправления, «← Назад к журналу» (§4); первая версия «Настроек журнала» с возвратом вопроса о несохранённом (§7.5, решение 6 плана 1.5-1a);
- шапка (§3.1): блок компании, иконки «История действий» и «Настройки», без имени пользователя и «Выйти»;
- панели «Компании» (§3.2), «Настройки» (§3.3), «История действий» (§3.4);
- одна вкладка «Журнал», `<h1>` журнала только для программ чтения, круглая кнопка сворачивания на границе панели, общая для панели счетов и навигации настроек (§3.5–3.6);
- скрипт визуальной сверки `npm run shots:ux` (§12.3) и README «Что уже работает».

**Предусловие:** выполнен план [1.5-1a](2026-10-10-stage1_5-plan1a-terms-money-dialogs.md): «Категория» вместо «Статья», `formatMoney(…, MONEY_SCREEN | MONEY_SCREEN_BEFORE)`, `Modal` с «×» и защитой от событий вложенных окон, `Drawer` реагирует только на свой `close`, `focus-trap` без элементов вложенных окон, `ConfirmDialog`, `lib/preferences.ts` (`SKIP_CLOSE_CONFIRM_PREF`, `skipCloseConfirm`), `e2e/dialogs.spec.ts`. Ожидаемо: 622 unit-теста (+1 пропущен), 62 e2e.

**Architecture:**
- **Зона настроек — вложенный маршрут** `c/:companyId/settings` с элементом `SettingsLayout`. `CompanyLayout` по `useMatch('/c/:companyId/settings/*')` рисует вместо панели счетов и карточки с вкладками сам `<Outlet>`; `SettingsLayout` рисует слева `SettingsNav` и справа белую карточку (`mainCardClass`). На телефоне та же навигация — строкой над разделом (список разделов отдельным экраном — план 1.5-5). Перенаправления — компонент `SettingsRedirect` с абсолютным адресом.
- **Разделы и порядок** — чистые данные `settingsGroups(companyName)` (`lib/settings-sections.ts`) с тестом. Адрес «Назад к журналу» — чистая функция `journalBackHref` (`lib/last-journal.ts`): журнал записывает свою строку запроса в `sessionStorage` (`fc.lastJournal.<cid>`), принимается только строка вида `?…` без `#`.
- **Панели** — `Drawer` (план 7) с двумя новыми необязательными свойствами: `subtitle` (логин под именем пользователя) и `afterClose` (после перехода по ссылке фокус ставит не на кнопку, а на `<h1>` новой страницы — `focusHeadingSoon()`). Окно правки компании открывается поверх панели «Компании»: это вложенный `<dialog>`, а защита от его событий уже есть в `Drawer` (план 1.5-1a).
- **История действий** читает существующий `GET /companies/:cid/audit?entity=operation&limit=20`. Чтобы писать «Изменён расход» и «Удалён перевод», сервер добавляет в историю правки, удаления и восстановления операции её тип (а удалению и восстановлению — сумму и счёт). Новых маршрутов нет. Текст записи — чистая функция `historyItems` (`lib/history.ts`).
- **Сворачивание** — хук `useSidebarCollapsed()` (`lib/sidebar.ts`): одна настройка `sidebar.collapsed`, оптимистично в кэше, сохранение в фоне.
- **Визуальная сверка** — `scripts/ux-shots.ts`: свой сервер на временной папке и порту 41741, демо-набор с фиксированной датой, Chromium с часами на 10.10.2026 15:58 (Алматы), снимки по списку сценариев и `index.html` «Finmap | наш».

**Tech Stack:** как в этапе 1. Новых пакетов нет.

**Spec:** [docs/superpowers/specs/2026-10-10-stage1_5-finmap-ux-design.md](../specs/2026-10-10-stage1_5-finmap-ux-design.md) — §1, §2.2, §3, §4, §7.5, §10.2, §11, §12.1, §12.3, §13 (план 1.5-1, блок «Решения планирования плана 1.5-1»).

**Ветка:** `stage1/plan1-skeleton`. В `main` не сливаем.

## Решения, принятые при планировании

Записаны в спецификацию (§13, блок «Решения планирования плана 1.5-1») тем же коммитом, что и план.

1. **Заголовок раздела — `<h1>` самой страницы**, `SettingsLayout` свой заголовок не рисует: страницы уже держат кнопки рядом с заголовком, а фокус после перехода из панели ставится на `<h1>`. Заголовки приведены к названиям навигации: «Мои компании», «Фиксированные курсы валют», «Резервное копирование».
2. **`settings` без раздела и неизвестные адреса** перенаправляют на `counterparties` и на телефоне. Список разделов отдельным экраном появится в плане 1.5-5 (§8.6). На телефоне до него навигация — строкой ссылок над разделом.
3. **Вкладки «Проекты | Шаблоны разделения»** в разделе «Проекты» появляются уже здесь, в простом виде: пункта «Шаблоны разделения» в навигации больше нет, и без вкладок раздел был бы недоступен. Оформление по §7.4 — план 1.5-4.
4. **«Настройки журнала» — первая версия здесь** (флажки колонок и «Спрашивать перед закрытием формы с несохранёнными данными», кнопка «Применить»). Иначе «Больше не спрашивать» из плана 1.5-1a нельзя было бы отменить. «Дата сделки» и «Показывать полностью» добавит план 1.5-2, окончательный вид — план 1.5-4.
5. **История операции для панели истории.** В записи правки появляется `type`, в записях удаления и восстановления — `type`, `amount`, `accountId`, `paidAt`. У старых записей без типа текст «Изменена операция», «Восстановлена операция». Запись открывает операцию в форме, если последнее действие с ней в ленте — не удаление.
6. **Окно ✎ в панели «Компании»** — «Компания»: название и базовая валюта, «Сохранить» и «Отмена». «В архив» и «Вернуть из архива» в нём появятся с карточками «Мои компании» в плане 1.5-4, пока они остаются на странице «Мои компании».
7. **Доступное имя блока компании** — «Сменить компанию: {название}», как у прежнего переключателя (видимый текст — название и «Сменить компанию»).
8. **Фокус после перехода из панели** — на `<h1>` новой страницы: если у заголовка нет `tabindex`, ставится `tabindex="-1"`. Ждём заголовок до 2 с (страница может показывать «Загрузка…»). Если перехода не было (текущая компания, Esc, «✕»), фокус возвращается на кнопку, открывшую панель.
9. **Подписи кнопки сворачивания в зоне настроек** — «Свернуть меню настроек» и «Развернуть меню настроек». У панели счетов подписи прежние.
10. **Скрипт визуальной сверки снимает только экраны, которые уже есть.** Для снимков Finmap без сценария в `index.html` пишется «нет сценария». Следующие планы добавляют сценарии в тот же список `SCENARIOS`. Скрипт не запускается на портах 3457, 3460 и 41731.

## Global Constraints

- **Принцип (§1):** «расположение и приёмы как в Finmap, внешний вид свой; где наше лучше — оставляем». **Мёртвых кнопок нет:** элемент Finmap, за которым у нас ничего нет, не показывается ни заглушкой, ни неактивным.
- **Шапка (§3.1):** слева блок компании (аватар с инициалами, название полужирным, мелкая подпись «Сменить компанию»; одна кнопка `aria-haspopup="dialog"`); название продукта в шапке не выводится — только в `document.title`; на страницах без компании вместо блока — `APP_NAME`. Центр — «+ Доход», «− Расход», «⇄ Перевод» одинаковой ширины, `px-8 py-2.5 text-base`, тёмный полупрозрачный фон и цветной текст; у архивной компании кнопок нет. Справа — иконка «История действий», затем шестерёнка «Настройки»; только иконки, у каждой `aria-label` и `title`. Имени пользователя и «Выйти» в шапке нет.
- **Панель «Компании» (§3.2):** заголовок «Компании»; «Поиск» (`matchesQuery`) — только если компаний больше пяти; группа «Мои компании»: аватар, название, итог «₸ 10 264 810» (`useCompaniesSummary`), ✎ — окно поверх панели; у текущей ✓ и `aria-current="true"`; нажатие на строку — тот же раздел другой компании (`switchCompanyPath`) и закрытие панели; внизу «Добавить компанию» на всю ширину → `/companies/new`, под ней «Все компании, в том числе архивные» → `settings/companies`.
- **Панель «Настройки» (§3.3):** шапка — имя пользователя (заголовок окна) и под ним логин; «Мой аккаунт»: Профиль → `settings/profile`, Мои компании → `settings/companies`; «Моя компания: {название}»: Пользователи → `settings/users`, Настройки компании → `settings/counterparties`; разделитель, «Выйти» красным последним, без подтверждения (`POST /auth/logout`, очистка кэша, `/login`). Пункты — ссылки со стрелкой «›», переход закрывает панель; на странице без компании группы «Моя компания» нет.
- **Панель «История действий» (§3.4):** последние 20 записей `GET /companies/:cid/audit?entity=operation&limit=20`; строка 1 — «Добавлен доход», «Изменён расход», «Удалён перевод», «Восстановлен доход»; строка 2 — сумма цветом типа с ₸ впереди и счёт, у правки — изменённые поля через `diffRows`; строка 3 серым — пользователь и «04.10.2026, 10:32:15»; нажатие открывает операцию (`useOpenOperationForm`), если она не удалена; внизу «Подробнее» → `settings/audit`; вкладок нет.
- **Вкладки (§3.5):** одна вкладка-пилюля «Журнал»; «Настроек» среди вкладок нет; `<h1>` журнала — `sr-only`, фокус после тостов по-прежнему на него.
- **Сворачивание (§3.6):** круглая кнопка с рамкой на правой границе панели на уровне вкладок (`absolute -right-4`), «‹» или «›»; свёрнутая панель — узкая полоса с той же кнопкой; `sidebar.collapsed` общая для панели счетов и навигации настроек; сохранение и `aria-label` панели счетов — как сейчас.
- **Зона настроек (§4):** маршрут `c/:companyId/settings` с дочерними; без панели счетов и вкладок; слева `SettingsNav` и сверху «← Назад к журналу» (последний адрес журнала компании, `sessionStorage` `fc.lastJournal.<cid>`, иначе `/c/:cid/log`); справа белая карточка; страницы не рисуют `<SettingsNav>` сами. Группы и порядок: — Профиль `profile`, Мои компании `companies`; **{НАЗВАНИЕ КОМПАНИИ}** Контрагенты `counterparties`, Счета `accounts`, Категории `categories`, Проекты `projects` (вкладка «Шаблоны разделения» — `projects/split-presets`), Теги `tags`, Пользователи `users`, Фиксированные курсы валют `rates`, Резервное копирование `backup`; **Визуальные настройки** Настройки журнала `journal`. На страницах «Пользователи», «Резервное копирование» и у ручных курсов — серая строка «Общие для всех компаний». «История действий» (`audit`) в навигацию не входит, адрес сохраняется. Все существующие адреса сохраняются; `settings` → `counterparties`; `settings/split-presets` → `settings/projects/split-presets`.
- **Доступность (§11):** `Drawer` без изменений поведения: Tab по кругу; Esc, «✕» и касание фона закрывают; фокус возвращается на кнопку; ссылка внутри закрывает панель и переводит фокус на `h1` новой страницы. Иконки шапки — `button` с `aria-label`, `title` и видимой рамкой фокуса. Вложенный `<dialog>` поверх панели: Esc закрывает только его.
- **Визуальная сверка (§12.3):** `scripts/ux-shots.ts`, `npm run shots:ux -- [папка]`, в CI не входит; свой сервер на временной папке данных, миграции, пользователь, `seed:demo` с фиксированной датой; Chromium, `locale: 'ru-RU'`, `timezoneId: 'Asia/Almaty'`, часы на 10.10.2026 15:58; 1440×900 и 390×844; имена файлов — парные к снимкам Finmap; по умолчанию `docs/research/screens/v2/parity/` (папка в `.gitignore` через `docs/research/screens/`) и `index.html` «Finmap | наш».
- **Без новых npm-пакетов.**
- **Невидимые символы** (U+2212, U+202F, U+00A0, U+200B) в коде — только экранированием `−` и т. п.; после записи файла проверьте, что экранирование не превратилось в символ.
- **Концы строк:** рабочая копия в CRLF (`core.autocrlf=true`). Правки «найдите → замените» — инструментом правки файлов.
- **E2E:** порт 41731 (`E2E_PORT`), один пользователь `admin`/`e2e-password-1` и одна база на прогон; левая панель `<nav aria-label="Счета">` есть на каждой странице журнала — не ищите элементы без области; `name:` в Playwright — подстрока без учёта регистра (для строк компаний — регулярное выражение с `^`); на страницах настроек e2e ищут `listitem`, `status`, `region` без области — в навигации и шапке этих ролей нет; данные — через `page.request` с `origin` и `x-requested-with: fetch`; общую настройку пользователя тест возвращает в `finally`; без фиксированных пауз.
- **Безопасность среды (обязательно):**
  - никогда не запускайте `npm start`, `npm run stop`, `npm run setup`, `npm run service:install`, `npm run service:uninstall`, `schtasks` и `icacls` — ни в каком виде и ни с какими настройками: на этой машине на порту 3457 работает живое приложение пользователя с его `data/`;
  - на порту 3460 работает демо-экземпляр — не останавливайте его и не трогайте его процессы;
  - e2e идут на порту 41731 со своей временной базой (`e2e/server.ts`); `npm run shots:ux` — на порту 41741 со своей временной папкой, файл настроек и `data/` не читает;
  - shell-команды не содержат подстроку «.env»; собирать её из частей запрещено.
- **Завершение задачи:** зелёные `npm test`, `npm run typecheck` и `npm run test:e2e`; если задача меняет e2e — `npm run test:e2e` дважды подряд. Коммит с трейлером `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. В коммит попадает каждый новый файл задачи.

## Review Focus

1. **Смена компании из панели внутри настроек:** другая компания — тот же раздел у неё и фокус на её `<h1>`; текущая — остаёмся на месте, фокус на кнопке компании; последняя компания запоминается. Тест — задача 4.
2. **«← Назад к журналу»** возвращает журнал с тем же фильтром; без сохранённого адреса — просто журнал; мусор в `sessionStorage` (`//evil.example`, `https://…`, `?a#b`) не уводит со страницы журнала. Тесты — задача 1 (unit и e2e).
3. **Старые адреса и закладки:** `/settings`, `/settings/split-presets`, неизвестный раздел — перенаправляются, а не дают пустой экран. Тест — задача 1.
4. **Окно поверх панели:** Esc в окне «Компания» закрывает только его, панель «Компании» остаётся, фокус — на ✎; после сохранения новое название видно в панели и в шапке. Тест — задача 4.
5. **История после удаления:** запись об операции, которую потом удалили, не открывает форму; старые записи без типа подписаны «операция»; неизвестный счёт — без суммы. Тесты — задача 5.
6. **Свернули меню настроек — в журнале панель счетов тоже свёрнута** и наоборот; настройка переживает перезагрузку и возвращается в `finally`. Тест — задача 6.

---

## Карта файлов

```
src/client/lib/settings-sections.ts          # (новый) группы и порядок разделов, раздел по умолчанию, «Общие для всех компаний»
src/client/lib/last-journal.ts               # (новый) fc.lastJournal.<cid>, journalBackHref
src/client/pages/settings/SettingsLayout.tsx # (новый) SettingsLayout, SettingsRedirect
src/client/pages/settings/SettingsNav.tsx    # группированная навигация, «← Назад к журналу»; сворачивание (задача 6)
src/client/pages/settings/ProjectsTabs.tsx   # (новый) «Проекты | Шаблоны разделения»
src/client/pages/settings/JournalViewSettings.tsx  # (новый) «Настройки журнала», первая версия
src/client/pages/settings/*.tsx              # без <SettingsNav>; заголовки; «Общие для всех компаний»
src/client/router.tsx                        # вложенные маршруты настроек и перенаправления
src/client/pages/CompanyLayout.tsx           # зона настроек без панели и вкладок; шапка; одна вкладка
src/client/pages/JournalPage.tsx             # запоминает адрес журнала; h1 sr-only
src/client/pages/NewCompanyPage.tsx          # шапка без компании
src/client/components/ui.ts                  # mainCardClass, headerIconClass
src/client/components/AppHeader.tsx          # блок слева, кнопки по центру, иконки справа
src/client/components/icons.tsx              # (новый) шестерёнка, часы со стрелкой
src/client/components/SettingsMenuDrawer.tsx # (новый) шестерёнка и панель «Настройки» с «Выйти»
src/client/components/Drawer.tsx             # subtitle, afterClose
src/client/lib/focus-heading.ts              # (новый) focusHeadingSoon
src/client/components/CompaniesDrawer.tsx    # (новый) блок компании и панель «Компании»
src/client/components/CompanyEditDialog.tsx  # (новый) окно «Компания»
src/client/lib/company-block.ts              # (новый) инициалы, поиск, порог поиска
src/client/components/CompanySwitcher.tsx    # (удаляется)
src/client/components/HistoryDrawer.tsx      # (новый) иконка и панель «История действий»
src/client/lib/history.ts                    # (новый) текст записей истории
src/client/lib/queries.ts                    # useOperationHistory
src/shared/dates.ts                          # formatDateTimeSec
src/server/modules/operations/service.ts     # тип (и сумма со счётом) в истории правки, удаления, восстановления
src/client/lib/sidebar.ts                    # (новый) useSidebarCollapsed
src/client/components/CollapseButton.tsx     # (новый) круглая кнопка на границе панели
src/client/components/AccountsPanel.tsx      # сворачивание через общий хук и новую кнопку
src/client/components/operation/OperationFormHost.tsx  # вид кнопок «+ Доход», «− Расход», «⇄ Перевод» в шапке
scripts/ux-shots.ts                          # (новый) визуальная сверка
package.json                                 # shots:ux
README.md                                    # «Что уже работает», «Разработка»
tests/client/settings-sections.test.ts, last-journal.test.ts, company-block.test.ts, history.test.ts  # (новые)
tests/server/operations-audit.test.ts        # (новый)
tests/shared/dates.test.ts                   # formatDateTimeSec
e2e/*.spec.ts                                # см. задачи
```

---

### Task 1: Зона настроек — раскладка, навигация, адреса, «← Назад к журналу»

**Files:**
- Create: `src/client/lib/settings-sections.ts`, `src/client/lib/last-journal.ts`, `src/client/pages/settings/SettingsLayout.tsx`, `src/client/pages/settings/ProjectsTabs.tsx`, `tests/client/settings-sections.test.ts`, `tests/client/last-journal.test.ts`
- Modify: `src/client/pages/settings/SettingsNav.tsx` (целиком), `src/client/router.tsx`, `src/client/pages/CompanyLayout.tsx`, `src/client/components/ui.ts`, `src/client/pages/JournalPage.tsx`
- Modify (страницы): `AccountsSettings.tsx`, `AuditSettings.tsx`, `BackupSettings.tsx`, `CategoriesSettings.tsx`, `CompaniesSettings.tsx`, `CounterpartiesSettings.tsx`, `ProfileSettings.tsx`, `ProjectsSettings.tsx`, `RatesSettings.tsx`, `SplitPresetsSettings.tsx`, `TagsSettings.tsx`, `UsersSettings.tsx` в `src/client/pages/settings/`
- Modify (тесты): `e2e/dictionaries.spec.ts`, `e2e/companies.spec.ts`, `e2e/money.spec.ts`, `e2e/service-screens.spec.ts`

**Interfaces:**
- Consumes: `CompanyOutletContext` (`pages/CompanyLayout.tsx`), `Company` (`lib/queries.ts`).
- Produces:
  - `SettingsSection { path; label }`, `SettingsGroup { key: 'account' | 'company' | 'view'; title: string | null; items }`, `settingsGroups(companyName: string): SettingsGroup[]`, `DEFAULT_SETTINGS_SECTION = 'counterparties'`, `SHARED_NOTE = 'Общие для всех компаний'` (`lib/settings-sections.ts`);
  - `lastJournalKey(cid): string`, `journalBackHref(cid, saved: string | null): string`, `rememberJournal(cid, search): void`, `readLastJournal(cid): string | null` (`lib/last-journal.ts`);
  - `SettingsNav({ company, variant: 'sidebar' | 'inline' })` — `<nav aria-label="Разделы настроек">`;
  - `SettingsLayout()`, `SettingsRedirect({ section })` (`pages/settings/SettingsLayout.tsx`);
  - `ProjectsTabs({ companyId })` — `<nav aria-label="Проекты и шаблоны">`;
  - `mainCardClass` (`components/ui.ts`).

- [ ] **Step 1: Write the failing unit tests**

`tests/client/settings-sections.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS_SECTION, settingsGroups, SHARED_NOTE } from '../../src/client/lib/settings-sections';

describe('навигация зоны настроек (§4.2 этапа 1.5)', () => {
  it('группы и порядок как в Finmap; вторая группа подписана названием компании', () => {
    const groups = settingsGroups('ТОО «Демо Клубы»');
    expect(groups.map((g) => [g.key, g.title, g.items.map((i) => i.path)])).toEqual([
      ['account', null, ['profile', 'companies']],
      ['company', 'ТОО «Демо Клубы»', ['counterparties', 'accounts', 'categories', 'projects', 'tags', 'users', 'rates', 'backup']],
    ]);
    expect(groups.flatMap((g) => g.items.map((i) => i.label))).toEqual([
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
  });

  it('«История действий» и «Шаблоны разделения» — не пункты навигации; раздел по умолчанию — контрагенты', () => {
    const paths = settingsGroups('X').flatMap((g) => g.items.map((i) => i.path));
    expect(paths).not.toContain('audit');
    expect(paths).not.toContain('split-presets');
    expect(DEFAULT_SETTINGS_SECTION).toBe('counterparties');
    expect(SHARED_NOTE).toBe('Общие для всех компаний');
  });
});
```

`tests/client/last-journal.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { journalBackHref, lastJournalKey } from '../../src/client/lib/last-journal';

describe('«← Назад к журналу» (§4.1 этапа 1.5)', () => {
  it('ключ sessionStorage — на компанию', () => {
    expect(lastJournalKey(5)).toBe('fc.lastJournal.5');
  });

  it('сохранённая строка запроса журнала возвращается целиком', () => {
    expect(journalBackHref(5, '?period=month&account=3')).toBe('/c/5/log?period=month&account=3');
    expect(journalBackHref(5, '?q=%D0%B0%D1%80%D0%B5%D0%BD%D0%B4%D0%B0')).toBe('/c/5/log?q=%D0%B0%D1%80%D0%B5%D0%BD%D0%B4%D0%B0');
  });

  it('нет сохранённого адреса, пустой или чужой вид — просто журнал компании', () => {
    for (const saved of [null, '', '?', '//evil.example', 'https://evil.example/?x=1', '/c/7/log?x=1', '?a=1#frag', 'period=month']) {
      expect(journalBackHref(5, saved), String(saved)).toBe('/c/5/log');
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/client/settings-sections.test.ts tests/client/last-journal.test.ts`
Expected: FAIL — модулей нет.

- [ ] **Step 3: Implement the pure modules**

`src/client/lib/settings-sections.ts`:

```ts
/** Раздел зоны настроек: адрес `settings/<path>` и подпись в навигации (§4.2 этапа 1.5). */
export interface SettingsSection {
  path: string;
  label: string;
}

export interface SettingsGroup {
  key: 'account' | 'company' | 'view';
  /** Подзаголовок группы; у группы аккаунта его нет. */
  title: string | null;
  items: readonly SettingsSection[];
}

/** Раздел, куда ведут «Настройки» без раздела и неизвестные адреса (§4.2). */
export const DEFAULT_SETTINGS_SECTION = 'counterparties';

/** Серая строка на страницах разделов, общих для экземпляра: пользователи, резервное копирование, ручные курсы (§4.2). */
export const SHARED_NOTE = 'Общие для всех компаний';

/**
 * Навигация зоны настроек в порядке Finmap (03-№3); вторая группа подписана названием компании.
 * «История действий» сюда не входит — к ней ведёт «Подробнее» из панели истории (§3.4).
 */
export function settingsGroups(companyName: string): SettingsGroup[] {
  return [
    {
      key: 'account',
      title: null,
      items: [
        { path: 'profile', label: 'Профиль' },
        { path: 'companies', label: 'Мои компании' },
      ],
    },
    {
      key: 'company',
      title: companyName,
      items: [
        { path: 'counterparties', label: 'Контрагенты' },
        { path: 'accounts', label: 'Счета' },
        { path: 'categories', label: 'Категории' },
        { path: 'projects', label: 'Проекты' },
        { path: 'tags', label: 'Теги' },
        { path: 'users', label: 'Пользователи' },
        { path: 'rates', label: 'Фиксированные курсы валют' },
        { path: 'backup', label: 'Резервное копирование' },
      ],
    },
  ];
}
```

`src/client/lib/last-journal.ts`:

```ts
/** Последний адрес журнала компании в этой вкладке браузера — для «← Назад к журналу» (§4.1 этапа 1.5). */
export const lastJournalKey = (companyId: number): string => `fc.lastJournal.${companyId}`;

/**
 * Ссылка «← Назад к журналу»: журнал компании с сохранённой строкой запроса (фильтр, период, поиск).
 * Принимается только строка вида `?…` без `#`: адрес всегда остаётся журналом этой компании.
 */
export function journalBackHref(companyId: number, saved: string | null): string {
  const search = saved !== null && saved.length > 1 && /^\?[^#]*$/.test(saved) ? saved : '';
  return `/c/${companyId}/log${search}`;
}

/** Журнал запоминает свою строку запроса; недоступное хранилище (приватный режим) — просто без памяти. */
export function rememberJournal(companyId: number, search: string): void {
  try {
    sessionStorage.setItem(lastJournalKey(companyId), search);
  } catch {
    // без памяти «Назад к журналу» ведёт в журнал без фильтра
  }
}

export function readLastJournal(companyId: number): string | null {
  try {
    return sessionStorage.getItem(lastJournalKey(companyId));
  } catch {
    return null;
  }
}
```

Run: `npx vitest run tests/client/settings-sections.test.ts tests/client/last-journal.test.ts` → PASS.

- [ ] **Step 4: Layout pieces — mainCardClass, SettingsNav, SettingsLayout, ProjectsTabs**

В `src/client/components/ui.ts` добавьте в конец:

```ts
/**
 * Белая карточка содержимого страницы компании (журнал, раздел настроек). На телефоне снизу — место под панель
 * «Доход», «Расход», «Перевод»; длинные слова без пробелов переносятся, выпадающие списки не шире своего блока.
 */
export const mainCardClass =
  'min-h-[calc(100dvh-5rem)] min-w-0 flex-1 rounded-t-3xl bg-card p-4 pb-[calc(6rem+env(safe-area-inset-bottom))] max-md:[overflow-wrap:anywhere] max-md:[&_select]:max-w-full md:p-8';
```

`src/client/pages/settings/SettingsNav.tsx` — замените файл целиком:

```tsx
import { Link, NavLink } from 'react-router';
import { journalBackHref, readLastJournal } from '../../lib/last-journal';
import type { Company } from '../../lib/queries';
import { settingsGroups } from '../../lib/settings-sections';

const sidebarLink = ({ isActive }: { isActive: boolean }) =>
  `block truncate rounded-xl px-3 py-2 text-sm ${isActive ? 'bg-field font-semibold text-ink' : 'text-muted hover:bg-field hover:text-ink'}`;
const inlineLink = ({ isActive }: { isActive: boolean }) =>
  `rounded-xl px-3 py-1.5 text-sm ${isActive ? 'bg-field font-semibold text-ink' : 'text-muted hover:text-ink'}`;

/**
 * Навигация зоны настроек (§4.1–4.2 этапа 1.5): «← Назад к журналу» и разделы по группам.
 * `sidebar` — слева вместо панели счетов (компьютер); `inline` — строкой над разделом на телефоне
 * (список разделов отдельным экраном — план 1.5-5). Без ролей listitem, status, alert, region: их ищут e2e экранов настроек.
 */
export function SettingsNav({ company, variant }: { company: Company; variant: 'sidebar' | 'inline' }) {
  const back = journalBackHref(company.id, readLastJournal(company.id));
  const sidebar = variant === 'sidebar';
  return (
    <nav aria-label="Разделы настроек" className={sidebar ? 'hidden w-64 shrink-0 self-start rounded-3xl bg-card p-4 md:block' : 'mb-6 md:hidden'}>
      <SettingsNavBody companyId={company.id} companyName={company.name} back={back} sidebar={sidebar} />
    </nav>
  );
}

function SettingsNavBody(props: { companyId: number; companyName: string; back: string; sidebar: boolean }) {
  return (
    <>
      <Link to={props.back} className="mb-3 inline-flex items-center gap-2 rounded-xl bg-field px-4 py-2 text-sm font-medium text-ink hover:brightness-95">
        <span aria-hidden="true">←</span> Назад к журналу
      </Link>
      {settingsGroups(props.companyName).map((g) => (
        <div key={g.key} className={g.title ? 'mt-3 border-t border-field pt-3' : ''}>
          {g.title && <p className="mb-1 truncate px-3 text-xs font-semibold uppercase tracking-wide text-muted">{g.title}</p>}
          <div className={props.sidebar ? 'grid gap-0.5' : 'flex flex-wrap gap-1'}>
            {g.items.map((s) => (
              <NavLink key={s.path} to={`/c/${props.companyId}/settings/${s.path}`} className={props.sidebar ? sidebarLink : inlineLink}>
                {s.label}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
```

`src/client/pages/settings/SettingsLayout.tsx`:

```tsx
import { Navigate, Outlet, useOutletContext, useParams } from 'react-router';
import { mainCardClass } from '../../components/ui';
import type { CompanyOutletContext } from '../CompanyLayout';
import { SettingsNav } from './SettingsNav';

/**
 * Зона настроек (§4.1 этапа 1.5): слева вместо панели счетов — навигация разделов, справа — белая карточка
 * с разделом. Заголовок раздела — `<h1>` самой страницы. На телефоне навигация — строкой над разделом.
 */
export function SettingsLayout() {
  const context = useOutletContext<CompanyOutletContext>();
  return (
    <>
      <SettingsNav company={context.company} variant="sidebar" />
      <main className={mainCardClass}>
        <SettingsNav company={context.company} variant="inline" />
        <Outlet context={context} />
      </main>
    </>
  );
}

/** Перенаправление внутри настроек компании: старые адреса и закладки (§4.2). */
export function SettingsRedirect({ section }: { section: string }) {
  const { companyId } = useParams();
  return <Navigate to={`/c/${companyId}/settings/${section}`} replace />;
}
```

`src/client/pages/settings/ProjectsTabs.tsx`:

```tsx
import { NavLink } from 'react-router';

const tab = ({ isActive }: { isActive: boolean }) =>
  `-mb-px border-b-2 px-1 pb-2 text-sm font-semibold ${isActive ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'}`;

/** Вкладки раздела «Проекты» (§4.2, §7.4 этапа 1.5): проекты и шаблоны разделения. */
export function ProjectsTabs({ companyId }: { companyId: number }) {
  return (
    <nav aria-label="Проекты и шаблоны" className="mb-6 flex gap-6 border-b border-field">
      <NavLink end to={`/c/${companyId}/settings/projects`} className={tab}>
        Проекты
      </NavLink>
      <NavLink to={`/c/${companyId}/settings/projects/split-presets`} className={tab}>
        Шаблоны разделения
      </NavLink>
    </nav>
  );
}
```

- [ ] **Step 5: Routes**

В `src/client/router.tsx` добавьте импорт:

```ts
import { SettingsLayout, SettingsRedirect } from './pages/settings/SettingsLayout';
```

и замените в детях `c/:companyId` все строки от `{ path: 'settings', element: <Navigate to="projects" replace /> },` до `{ path: 'settings/backup', element: <BackupSettings /> },` включительно на:

```tsx
          {
            path: 'settings',
            element: <SettingsLayout />,
            children: [
              { index: true, element: <SettingsRedirect section="counterparties" /> },
              { path: 'profile', element: <ProfileSettings /> },
              { path: 'companies', element: <CompaniesSettings /> },
              { path: 'counterparties', element: <CounterpartiesSettings /> },
              { path: 'accounts', element: <AccountsSettings /> },
              { path: 'categories', element: <CategoriesSettings /> },
              { path: 'projects', element: <ProjectsSettings /> },
              { path: 'projects/split-presets', element: <SplitPresetsSettings /> },
              { path: 'split-presets', element: <SettingsRedirect section="projects/split-presets" /> },
              { path: 'tags', element: <TagsSettings /> },
              { path: 'users', element: <UsersSettings /> },
              { path: 'rates', element: <RatesSettings /> },
              { path: 'backup', element: <BackupSettings /> },
              { path: 'audit', element: <AuditSettings /> },
              { path: '*', element: <SettingsRedirect section="counterparties" /> },
            ],
          },
```

- [ ] **Step 6: CompanyLayout — no accounts panel and tabs in the settings zone**

В `src/client/pages/CompanyLayout.tsx`:
- импорт роутера: `import { Navigate, NavLink, Outlet, useMatch, useParams } from 'react-router';`;
- импорт: `import { mainCardClass } from '../components/ui';`;
- после `const { companyId } = useParams();` добавьте строку:

```ts
  // зона настроек (§4.1 этапа 1.5): слева навигация разделов вместо панели счетов, вкладок нет
  const inSettings = useMatch('/c/:companyId/settings/*') !== null;
```

- блок `<div className="flex items-start gap-4 md:mx-4">…</div>` замените:

```tsx
        <div className="flex items-start gap-4 md:mx-4">
          {inSettings ? (
            <Outlet context={{ company } satisfies CompanyOutletContext} />
          ) : (
            <>
              <AccountsPanel company={company} />
              <main className={mainCardClass}>
                <nav className="mb-6 flex gap-2">
                  <NavLink to={`/c/${company.id}/log`} className={tab}>
                    Журнал
                  </NavLink>
                  <NavLink to={`/c/${company.id}/settings`} className={tab}>
                    Настройки
                  </NavLink>
                </nav>
                <Outlet context={{ company } satisfies CompanyOutletContext} />
              </main>
            </>
          )}
        </div>
```

(вкладку «Настройки» убирает задача 3 вместе с появлением шестерёнки.)

- [ ] **Step 7: Journal remembers its address**

В `src/client/pages/JournalPage.tsx`:
- `import { useOutletContext, useSearchParams } from 'react-router';` → `import { useLocation, useOutletContext, useSearchParams } from 'react-router';`;
- импорт `import { rememberJournal } from '../lib/last-journal';`;
- сразу после строки `const [params, setParams] = useSearchParams();` добавьте:

```ts
  // «← Назад к журналу» в настройках возвращает сюда с тем же фильтром (§4.1 этапа 1.5)
  const location = useLocation();
  useEffect(() => rememberJournal(company.id, location.search), [company.id, location.search]);
```

- [ ] **Step 8: Settings pages stop drawing the navigation**

Во всех 12 файлах `src/client/pages/settings/` (`AccountsSettings`, `AuditSettings`, `BackupSettings`, `CategoriesSettings`, `CompaniesSettings`, `CounterpartiesSettings`, `ProfileSettings`, `ProjectsSettings`, `RatesSettings`, `SplitPresetsSettings`, `TagsSettings`, `UsersSettings`) удалите строку импорта

```ts
import { SettingsNav } from './SettingsNav';
```

и строку разметки

```tsx
      <SettingsNav companyId={company.id} />
```

Кроме двух файлов, где её место занимают вкладки:
- `ProjectsSettings.tsx` и `SplitPresetsSettings.tsx`: импорт `import { ProjectsTabs } from './ProjectsTabs';`, а строку разметки замените на `      <ProjectsTabs companyId={company.id} />`.

Заголовки и серая строка:
- `CompaniesSettings.tsx`: `<h1 className="text-2xl font-bold">Компании</h1>` → `<h1 className="text-2xl font-bold">Мои компании</h1>`.
- `RatesSettings.tsx`: `<h1 className="mb-4 text-2xl font-bold">Курсы валют</h1>` → `<h1 className="mb-4 text-2xl font-bold">Фиксированные курсы валют</h1>`; импорт `import { SHARED_NOTE } from '../../lib/settings-sections';`; сразу после закрывающего `</h2>` заголовка «Ручные курсы на дату» (`id="manual-rates-title"`) вставьте `      <p className="mb-1 text-sm font-medium text-muted">{SHARED_NOTE}</p>`.
- `BackupSettings.tsx`: `<h1 className="mb-2 text-2xl font-bold">Резервная копия</h1>` → `<h1 className="mb-2 text-2xl font-bold">Резервное копирование</h1>`; импорт `SHARED_NOTE` (как выше); сразу после `<h1>` — `      <p className="mb-1 text-sm font-medium text-muted">{SHARED_NOTE}</p>`.
- `UsersSettings.tsx`: импорт `SHARED_NOTE`; перед строкой `<p className="mb-4 text-sm text-muted">Все пользователи видят все компании. …` вставьте `      <p className="mb-1 text-sm font-medium text-muted">{SHARED_NOTE}</p>`.

Проверка: `grep -rn "SettingsNav" src/client/pages/settings` — только `SettingsNav.tsx` и `SettingsLayout.tsx`. Переменная `company` в некоторых страницах может стать неиспользуемой — это не ошибка (в `tsconfig` нет `noUnusedLocals`), оставьте как есть.

- [ ] **Step 9: Update e2e for the new zone**

`e2e/companies.spec.ts`, строки 54–55:

```ts
  await page.getByRole('link', { name: 'Настройки' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/counterparties$`));
  await page.getByRole('navigation', { name: 'Разделы настроек' }).getByRole('link', { name: 'Проекты' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/projects$`));
```

строка 86 `await page.getByRole('link', { name: 'Компании' }).click();` →

```ts
  await page.getByRole('navigation', { name: 'Разделы настроек' }).getByRole('link', { name: 'Мои компании' }).click();
```

`e2e/dictionaries.spec.ts`, строка 148 `await section(page, 'Шаблоны разделения').click();` →

```ts
  await section(page, 'Проекты').click();
  await page.getByRole('navigation', { name: 'Проекты и шаблоны' }).getByRole('link', { name: 'Шаблоны разделения' }).click();
  await expect(page).toHaveURL(/\/settings\/projects\/split-presets$/);
```

`e2e/service-screens.spec.ts`, строка 109 `await section(page, 'История действий').click();` →

```ts
  await page.goto(`/c/${cid}/settings/audit`);
```

`e2e/money.spec.ts` — левой панели в зоне настроек больше нет:
- строка 94 `await section(page, 'Курсы').click();` → `await section(page, 'Фиксированные курсы валют').click();`;
- строки 107–108 (после задачи 2 плана 1.5-1a):

```ts
  await expect(panel).not.toContainText('недоступен');
  await expect(panel).toContainText(/Всего на счетах\s*₸\s5\s000(?![\s\d])/);
```

замените на

```ts
  // итог — в левой панели журнала: «← Назад к журналу», проверка, и обратно к курсам
  const back = page.getByRole('navigation', { name: 'Разделы настроек' }).getByRole('link', { name: /Назад к журналу/ });
  await back.click();
  await expect(panel).not.toContainText('недоступен');
  await expect(panel).toContainText(/Всего на счетах\s*₸\s5\s000(?![\s\d])/);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/rates$`));
```

- строку 114 `await expect(panel).toContainText(/Всего на счетах\s*₸\s5\s100(?![\s\d])/);` замените на

```ts
  await back.click();
  await expect(panel).toContainText(/Всего на счетах\s*₸\s5\s100(?![\s\d])/);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/rates$`));
```

- тест «смена базовой валюты обновляет итог в левой панели» замените целиком:

```ts
test('смена базовой валюты обновляет итог в левой панели', async ({ page }) => {
  await login(page);
  const name = `ТОО Смена валюты ${Date.now()}`;
  const cid = await createCompany(page, name);
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 100000 });

  await page.reload();
  const panel = page.getByRole('navigation', { name: 'Счета' });
  await expect(panel).toContainText(/Всего на счетах\s*₸\s1\s000(?![\s\d])/);
  await page.goto(`/c/${cid}/settings/companies`);
  const row = page.getByRole('listitem').filter({ has: page.locator(`input[value="${name}"]`) });
  await row.getByLabel('Базовая валюта').selectOption('USD');
  await row.getByRole('button', { name: 'Сохранить' }).click();
  await expect(row.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  // курса USD в свежей базе нет: итог в тенге больше не показывается
  await page.getByRole('navigation', { name: 'Разделы настроек' }).getByRole('link', { name: /Назад к журналу/ }).click();
  await expect(panel).toContainText('курс USD недоступен');
  await expect(panel).not.toContainText(/Всего на счетах\s*₸\s1\s000(?![\s\d])/);
});
```

- [ ] **Step 10: Write the e2e test for the zone**

В конец `e2e/dictionaries.spec.ts` добавьте:

```ts
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
```

- [ ] **Step 11: Run all checks; e2e twice**

Run: `npm test` → PASS, 627 тестов (622 + 5). Run: `npm run typecheck` → без ошибок.
Run: `npm run test:e2e` дважды → 63 passed оба раза. Тест `mobile.spec.ts` «ширина 390 px» проходит все разделы настроек: навигация строкой над разделом не должна давать прокрутку вбок.

- [ ] **Step 12: Commit**

```bash
git add src/client tests/client/settings-sections.test.ts tests/client/last-journal.test.ts e2e
git commit -m "feat: зона настроек — группированная навигация, адреса и перенаправления, «← Назад к журналу»

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: «Настройки журнала» — первая версия (колонки и вопрос о несохранённом)

**Files:**
- Create: `src/client/pages/settings/JournalViewSettings.tsx`
- Modify: `src/client/lib/settings-sections.ts`, `tests/client/settings-sections.test.ts`, `src/client/router.tsx`, `e2e/dialogs.spec.ts`, `e2e/dictionaries.spec.ts`

**Interfaces:**
- Consumes: `JOURNAL_COLUMNS`, `JOURNAL_COLUMNS_PREF`, `visibleColumns`, `toggleColumn`, `JournalColumnId` (`lib/journal-columns.ts`); `SKIP_CLOSE_CONFIRM_PREF`, `skipCloseConfirm` (`lib/preferences.ts`, план 1.5-1a); `savePreference`, `usePreferences` (`lib/queries.ts`).
- Produces: маршрут `settings/journal` → `JournalViewSettings`; третья группа навигации `{ key: 'view', title: 'Визуальные настройки', items: [{ path: 'journal', label: 'Настройки журнала' }] }`.

- [ ] **Step 1: Update the failing unit test**

В `tests/client/settings-sections.test.ts` в первом тесте замените ожидание групп и подписей:

```ts
    expect(groups.map((g) => [g.key, g.title, g.items.map((i) => i.path)])).toEqual([
      ['account', null, ['profile', 'companies']],
      ['company', 'ТОО «Демо Клубы»', ['counterparties', 'accounts', 'categories', 'projects', 'tags', 'users', 'rates', 'backup']],
      ['view', 'Визуальные настройки', ['journal']],
    ]);
    expect(groups.flatMap((g) => g.items.map((i) => i.label))).toEqual([
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
```

Run: `npx vitest run tests/client/settings-sections.test.ts` → FAIL (групп две).

- [ ] **Step 2: Add the group and the route**

В `src/client/lib/settings-sections.ts` в массив `settingsGroups` после группы `company` добавьте:

```ts
    {
      key: 'view',
      title: 'Визуальные настройки',
      items: [{ path: 'journal', label: 'Настройки журнала' }],
    },
```

В `src/client/router.tsx`: импорт `import { JournalViewSettings } from './pages/settings/JournalViewSettings';` и в детях `settings` после `{ path: 'backup', … }` строка:

```tsx
              { path: 'journal', element: <JournalViewSettings /> },
```

- [ ] **Step 3: Create the page**

`src/client/pages/settings/JournalViewSettings.tsx`:

```tsx
import { useState } from 'react';
import { Pending } from '../../components/QueryState';
import { alertClass, btnPrimary } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { JOURNAL_COLUMNS, JOURNAL_COLUMNS_PREF, toggleColumn, visibleColumns, type JournalColumnId } from '../../lib/journal-columns';
import { SKIP_CLOSE_CONFIRM_PREF, skipCloseConfirm } from '../../lib/preferences';
import { savePreference, usePreferences } from '../../lib/queries';

/**
 * «Настройки журнала» (§7.5 этапа 1.5), первая версия плана 1.5-1b: видимые колонки журнала и вопрос
 * о несохранённом в форме операции. «Применить» сохраняет всё вместе. «Дата сделки» и «Показывать полностью»
 * добавит план 1.5-2; список колонок в журнале по-прежнему применяется сразу.
 */
export function JournalViewSettings() {
  const prefs = usePreferences();
  if (!prefs.data) return <Pending queries={[prefs]} />;
  return <JournalViewForm prefs={prefs.data} />;
}

function JournalViewForm({ prefs }: { prefs: Record<string, unknown> }) {
  const [columns, setColumns] = useState<JournalColumnId[]>(() => visibleColumns(prefs[JOURNAL_COLUMNS_PREF]));
  const [ask, setAsk] = useState(() => !skipCloseConfirm(prefs));
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = async () => {
    setPending(true);
    setStatus(null);
    setError(null);
    try {
      await savePreference(JOURNAL_COLUMNS_PREF, columns);
      await savePreference(SKIP_CLOSE_CONFIRM_PREF, !ask);
      setStatus('Настройки сохранены');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Ошибка сервера');
    } finally {
      setPending(false);
    }
  };

  return (
    <section>
      <h1 className="mb-6 text-2xl font-bold">Настройки журнала</h1>
      <fieldset disabled={pending} className="mb-6">
        <legend className="mb-2 font-semibold">Колонки</legend>
        <div className="grid gap-2">
          {JOURNAL_COLUMNS.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={c.fixed || columns.includes(c.id)}
                disabled={c.fixed}
                onChange={() => {
                  setStatus(null);
                  setColumns((v) => toggleColumn(v, c.id));
                }}
              />
              {c.label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset disabled={pending} className="mb-6">
        <legend className="mb-2 font-semibold">Форма операции</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={ask}
            onChange={(e) => {
              setStatus(null);
              setAsk(e.target.checked);
            }}
          />
          Спрашивать перед закрытием формы с несохранёнными данными
        </label>
      </fieldset>
      {error && (
        <p role="alert" className={alertClass}>
          {error}
        </p>
      )}
      <p role="status" className={status ? 'mb-4 text-sm text-income' : 'sr-only'}>
        {status}
      </p>
      <button type="button" disabled={pending} onClick={() => void apply()} className={btnPrimary}>
        Применить
      </button>
    </section>
  );
}
```

- [ ] **Step 4: Run unit tests**

Run: `npx vitest run tests/client/settings-sections.test.ts` → PASS.

- [ ] **Step 5: Update e2e**

В тесте «зона настроек…» (`e2e/dictionaries.spec.ts`, задача 1) в списке ссылок навигации после `'Резервное копирование',` добавьте `'Настройки журнала',`, а после `await expect(nav).toContainText(name);` строку:

```ts
  await expect(nav).toContainText('Визуальные настройки');
```

В конец `e2e/dialogs.spec.ts` добавьте:

```ts
test('«Настройки журнала»: колонки и «Спрашивать перед закрытием формы» применяются вместе по «Применить»', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Вид журнала ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: minuteAgo(), accountId: cash, amount: 1000, comment: 'для колонок' });
  const before = (await (await page.request.get('/api/v1/preferences')).json()).preferences as Record<string, unknown>;
  // вопрос выключен «Больше не спрашивать» — его возвращают здесь
  await page.request.put('/api/v1/preferences/operationForm.skipCloseConfirm', { data: { value: true }, headers: csrf(page) });
  try {
    await page.goto(`/c/${cid}/settings/journal`);
    await expect(page.getByRole('heading', { level: 1, name: 'Настройки журнала' })).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Разделы настроек' });
    await expect(nav.getByRole('link', { name: 'Настройки журнала' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('checkbox', { name: 'Дата', exact: true })).toBeDisabled();
    await expect(page.getByRole('checkbox', { name: 'Сумма', exact: true })).toBeChecked();
    const ask = page.getByRole('checkbox', { name: 'Спрашивать перед закрытием формы с несохранёнными данными' });
    await expect(ask).not.toBeChecked();
    await ask.check();
    await page.getByRole('checkbox', { name: 'Комментарий', exact: true }).uncheck();
    await page.getByRole('button', { name: 'Применить' }).click();
    await expect(page.getByRole('status')).toHaveText('Настройки сохранены');
    await page.reload();
    await expect(ask).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Комментарий', exact: true })).not.toBeChecked();

    // журнал: колонки «Комментарий» нет; изменённая форма снова спрашивает
    await nav.getByRole('link', { name: /Назад к журналу/ }).click();
    await expect(page.getByRole('table', { name: 'Операции' }).locator('tbody tr')).toHaveCount(1);
    await expect(page.getByRole('columnheader', { name: 'Комментарий' })).toHaveCount(0);
    await page.getByRole('banner').getByRole('button', { name: 'Доход', exact: true }).click();
    const amount = page.getByRole('dialog', { name: 'Новая операция' }).getByRole('textbox', { name: /^Сумма,/ });
    await amount.fill('5');
    await amount.press('Escape');
    const question = page.getByRole('alertdialog', { name: 'Ваши данные не сохранятся' });
    await expect(question).toBeVisible();
    await question.getByRole('button', { name: 'Закрыть' }).click();
  } finally {
    await page.request.put('/api/v1/preferences/operationForm.skipCloseConfirm', { data: { value: false }, headers: csrf(page) });
    await page.request.put('/api/v1/preferences/journal.columns', { data: { value: before['journal.columns'] ?? null }, headers: csrf(page) });
  }
});
```

- [ ] **Step 6: Run all checks; e2e twice**

Run: `npm test` → PASS, 627. Run: `npm run typecheck` → без ошибок.
Run: `npm run test:e2e` дважды → 64 passed оба раза.

- [ ] **Step 7: Commit**

```bash
git add src/client/pages/settings/JournalViewSettings.tsx src/client/lib/settings-sections.ts src/client/router.tsx tests/client/settings-sections.test.ts e2e/dialogs.spec.ts e2e/dictionaries.spec.ts
git commit -m "feat: «Настройки журнала» — колонки и возврат вопроса о несохранённом

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Шапка и панель «Настройки» с «Выйти»

**Files:**
- Create: `src/client/components/icons.tsx`, `src/client/components/SettingsMenuDrawer.tsx`, `src/client/lib/focus-heading.ts`
- Modify: `src/client/components/AppHeader.tsx` (целиком), `src/client/components/Drawer.tsx`, `src/client/components/ui.ts`, `src/client/pages/CompanyLayout.tsx`, `src/client/pages/NewCompanyPage.tsx`, `src/client/components/operation/OperationFormHost.tsx`
- Modify (тесты): `e2e/auth.spec.ts`, помощник `login` во всех `e2e/*.spec.ts`, `e2e/companies.spec.ts`, `e2e/dictionaries.spec.ts`, `e2e/money.spec.ts`, `e2e/service-screens.spec.ts`

**Interfaces:**
- Consumes: `Drawer`, `useMe`, `useMeta`, `queryClient` (`lib/query.ts`), `api`, `pickStartCompany` (`lib/company-path.ts`).
- Produces:
  - `Drawer` props: `subtitle?: ReactNode` (строка под заголовком), `afterClose?: () => boolean` (вызывается после закрытия; `true` — фокус уже поставлен, на кнопку открытия не возвращать);
  - `focusHeadingSoon(): void` (`lib/focus-heading.ts`);
  - `GearIcon()` (`components/icons.tsx`);
  - `headerIconClass` (`components/ui.ts`);
  - `SettingsMenuButton({ companyId: number | null; companyName: string | null })` — шестерёнка `aria-label="Настройки"` и панель с заголовком — именем пользователя;
  - `AppHeader({ left?, actions?, tools?, menu: { companyId: number | null; companyName: string | null } })`.

- [ ] **Step 1: Drawer — subtitle and afterClose; focusHeadingSoon**

`src/client/lib/focus-heading.ts`:

```ts
/**
 * После перехода по ссылке из выезжающей панели (§11 этапа 1.5): фокус — на заголовок `<h1>` новой страницы,
 * как только он появится (страница может сначала показывать «Загрузка…»), но не дольше 2 с. Заголовку без
 * `tabindex` ставится `tabindex="-1"`: так он принимает фокус, но не попадает в порядок Tab.
 */
export function focusHeadingSoon(): void {
  const started = performance.now();
  const tick = () => {
    const heading = document.querySelector<HTMLElement>('main h1');
    if (heading) {
      if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
      heading.focus();
      return;
    }
    if (performance.now() - started < 2000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
```

В `src/client/components/Drawer.tsx`:
- импорт `import { useEffect, useId, useRef, type ReactNode } from 'react';` — без изменений;
- сигнатуру замените:

```tsx
export function Drawer(props: {
  open: boolean;
  title: string;
  /** Строка под заголовком (логин под именем пользователя). */
  subtitle?: ReactNode;
  side: 'left' | 'right';
  onClose: () => void;
  /** После закрытия: true — фокус уже поставлен (переход по ссылке), на кнопку открытия не возвращать. */
  afterClose?: () => boolean;
  children: ReactNode;
}) {
```

- обработчик `onClose` (после плана 1.5-1a в нём уже есть проверка `e.target`):

```tsx
      onClose={(e) => {
        // close вложенного окна (окно компании поверх панели «Компании») React доставляет и сюда
        if (e.target !== e.currentTarget) return;
        props.onClose();
        if (!props.afterClose?.()) opener.current?.focus();
      }}
```

- заголовок панели — блок `<h2 …>{props.title}</h2>` замените:

```tsx
            <div className="min-w-0">
              <h2 id={titleId} className="truncate text-xl font-bold">
                {props.title}
              </h2>
              {props.subtitle && <p className="truncate text-sm text-muted">{props.subtitle}</p>}
            </div>
```

- [ ] **Step 2: Icons, header class, SettingsMenuDrawer**

`src/client/components/icons.tsx`:

```tsx
/** Иконки шапки (§3.1 этапа 1.5): только рисунок, имя кнопке даёт `aria-label`. */
export function GearIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
```

В `src/client/components/ui.ts` добавьте:

```ts
/** Круглая кнопка-иконка в тёмной шапке (история действий, настройки) с видимой рамкой фокуса. */
export const headerIconClass =
  'grid h-10 w-10 shrink-0 place-items-center rounded-full bg-chrome-2 text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
```

`src/client/components/SettingsMenuDrawer.tsx`:

```tsx
import { useMutation } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../lib/api';
import { focusHeadingSoon } from '../lib/focus-heading';
import { queryClient, useMe } from '../lib/query';
import { Drawer } from './Drawer';
import { GearIcon } from './icons';
import { headerIconClass } from './ui';

const itemClass = 'flex items-center justify-between gap-3 rounded-xl px-3 py-3 text-sm hover:bg-field';

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-4">
      <p className="mb-1 truncate px-3 text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
      {children}
    </div>
  );
}

/**
 * Шестерёнка в шапке и правая панель «Настройки» (§3.3 этапа 1.5): в шапке панели — имя и логин пользователя;
 * «Мой аккаунт» и «Моя компания: …» — ссылки в зону настроек; «Выйти» красным последним, без подтверждения.
 * companyId — компания для ссылок (на странице без компании — последняя открытая; нет компаний — ссылок нет);
 * companyName — только на странице компании (группа «Моя компания»).
 */
export function SettingsMenuButton({ companyId, companyName }: { companyId: number | null; companyName: string | null }) {
  const [open, setOpen] = useState(false);
  const navigated = useRef(false);
  const me = useMe();
  const navigate = useNavigate();
  const logout = useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      queryClient.clear();
      navigate('/login', { replace: true });
    },
  });
  const go = () => {
    navigated.current = true;
    setOpen(false);
  };
  const item = (to: string, label: string) => (
    <Link to={to} onClick={go} className={itemClass}>
      <span>{label}</span>
      <span aria-hidden="true" className="text-muted">
        ›
      </span>
    </Link>
  );

  return (
    <>
      <button type="button" aria-label="Настройки" title="Настройки" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} className={headerIconClass}>
        <GearIcon />
      </button>
      <Drawer
        open={open}
        side="right"
        title={me.data?.user.name ?? 'Настройки'}
        subtitle={me.data?.user.login}
        onClose={() => setOpen(false)}
        afterClose={() => {
          if (!navigated.current) return false;
          navigated.current = false;
          focusHeadingSoon();
          return true;
        }}
      >
        {companyId !== null && (
          <Group title="Мой аккаунт">
            {item(`/c/${companyId}/settings/profile`, 'Профиль')}
            {item(`/c/${companyId}/settings/companies`, 'Мои компании')}
          </Group>
        )}
        {companyId !== null && companyName !== null && (
          <Group title={`Моя компания: ${companyName}`}>
            {item(`/c/${companyId}/settings/users`, 'Пользователи')}
            {item(`/c/${companyId}/settings/counterparties`, 'Настройки компании')}
          </Group>
        )}
        <div className="border-t border-field pt-3">
          <button
            type="button"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
            className="w-full rounded-xl px-3 py-3 text-left text-sm font-semibold text-expense hover:bg-field disabled:opacity-50"
          >
            Выйти
          </button>
        </div>
      </Drawer>
    </>
  );
}
```

- [ ] **Step 3: AppHeader, header buttons, layouts**

`src/client/components/AppHeader.tsx` — замените файл целиком:

```tsx
import { useEffect, type ReactNode } from 'react';
import { useMeta } from '../lib/query';
import { SettingsMenuButton } from './SettingsMenuDrawer';

/**
 * Шапка (§3.1 этапа 1.5). Слева — блок компании (на телефоне перед ним «Счета»); на страницах без компании —
 * название продукта. По центру — «+ Доход», «− Расход», «⇄ Перевод» (только компьютер). Справа — иконки:
 * «История действий» (tools) и шестерёнка «Настройки». Имени пользователя и «Выйти» в шапке нет — они в панели
 * «Настройки». Название продукта всегда в document.title. В PWA на iPhone шапка начинается ниже выреза экрана.
 */
export function AppHeader(props: {
  left?: ReactNode;
  actions?: ReactNode;
  tools?: ReactNode;
  menu: { companyId: number | null; companyName: string | null };
}) {
  const meta = useMeta();

  useEffect(() => {
    if (meta.data) document.title = meta.data.appName;
  }, [meta.data]);

  return (
    <header className="flex items-center gap-3 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white md:grid md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-4 md:px-6 md:pb-4 md:pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-3">
        {props.left ?? <span className="truncate text-lg font-bold">{meta.data?.appName}</span>}
      </div>
      {props.actions ?? <span aria-hidden="true" className="hidden md:block" />}
      <div className="flex shrink-0 items-center justify-end gap-2">
        {props.tools}
        <SettingsMenuButton companyId={props.menu.companyId} companyName={props.menu.companyName} />
      </div>
    </header>
  );
}
```

`src/client/components/operation/OperationFormHost.tsx` — массив `BUTTONS` и функцию `NewOperationButtons` замените:

```tsx
const BUTTONS: { type: OperationType; symbol: string; label: string; bottom: string; header: string }[] = [
  { type: 'income', symbol: '+', label: 'Доход', bottom: 'bg-income text-white', header: 'bg-income/20 text-income' },
  { type: 'expense', symbol: '−', label: 'Расход', bottom: 'bg-expense text-white', header: 'bg-expense/20 text-expense' },
  { type: 'transfer', symbol: '⇄', label: 'Перевод', bottom: 'bg-chrome-2 text-white', header: 'bg-white/10 text-white' },
];

/**
 * Кнопки «+ Доход», «− Расход», «⇄ Перевод» (§3.1 этапа 1.5; у минуса — знак U+2212). `header` — по центру шапки,
 * одинаковой ширины, тёмный полупрозрачный фон и цветной текст, только на компьютере; `bottom` — на телефоне
 * (меньше 768 px) панель, закреплённая у нижнего края экрана (§7 «Мобильная версия»; план 1.5-5 перенесёт её наверх).
 */
export function NewOperationButtons({ placement = 'header' }: { placement?: 'header' | 'bottom' }) {
  const open = useOpenOperationForm();
  const buttons = BUTTONS.map((b) => (
    <button
      key={b.type}
      type="button"
      aria-haspopup="dialog"
      onClick={() => open({ kind: 'create', type: b.type })}
      className={
        placement === 'header'
          ? `rounded-xl px-8 py-2.5 text-base font-semibold whitespace-nowrap hover:brightness-125 ${b.header}`
          : `rounded-xl px-2 py-3 text-base font-semibold hover:brightness-110 ${b.bottom}`
      }
    >
      <span aria-hidden="true">{b.symbol}</span> {b.label}
    </button>
  ));
  if (placement === 'header') return <div className="hidden grid-cols-3 gap-3 md:grid">{buttons}</div>;
  return (
    <div
      role="group"
      aria-label="Добавить операцию"
      // над «домашней» полосой iPhone и с учётом выреза в горизонтальном положении
      className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 gap-2 bg-chrome pt-2 pr-[max(1rem,env(safe-area-inset-right))] pb-[max(0.5rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] shadow-[0_-4px_16px_rgb(0_0_0/0.15)] md:hidden"
    >
      {buttons}
    </div>
  );
}
```

`src/client/pages/CompanyLayout.tsx`:
- вызов `<AppHeader …/>` замените:

```tsx
        <AppHeader
          left={
            <>
              <AccountsDrawerButton company={company} />
              <CompanySwitcher current={company} companies={companies.data} />
            </>
          }
          // архивная компания — только чтение: новых операций нет ни в шапке, ни в нижней панели
          actions={company.archivedAt ? undefined : <NewOperationButtons />}
          menu={{ companyId: company.id, companyName: company.name }}
        />
```

- во вкладках удалите ссылку «Настройки» (остаётся одна вкладка «Журнал»):

```tsx
                  <NavLink to={`/c/${company.id}/settings`} className={tab}>
                    Настройки
                  </NavLink>
```

`src/client/pages/NewCompanyPage.tsx`:
- импорты: `import { pickStartCompany } from '../lib/company-path';` и `import { useCompanies, usePreferences } from '../lib/queries';` (вместо `import { useCompanies } from '../lib/queries';`);
- после `const companies = useCompanies();` добавьте `const prefs = usePreferences();`;
- первый `<AppHeader />` (загрузка) → `<AppHeader menu={{ companyId: null, companyName: null }} />`;
- второй `<AppHeader />` →

```tsx
      {/* ссылки «Мой аккаунт» в панели «Настройки» — от последней открытой компании; группы «Моя компания» нет */}
      <AppHeader menu={{ companyId: pickStartCompany(all, prefs.data?.lastCompanyId)?.id ?? null, companyName: null }} />
```

Проверка: `grep -rn "profileHref\|Выйти" src/client` — «Выйти» только в `SettingsMenuDrawer.tsx`.

- [ ] **Step 4: Update e2e — login helpers and paths to settings**

Во всех файлах `e2e/*.spec.ts`, где есть помощник `login` (`companies`, `dictionaries`, `dialogs`, `journal-actions`, `journal`, `mobile`, `money`, `operation-edit`, `operation-form`, `service-screens`), строку

```ts
  await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible();
```

замените на

```ts
  await expect(page.getByRole('button', { name: 'Настройки', exact: true })).toBeVisible();
```

Проверка: `grep -rn "name: 'Выйти'" e2e` — только в `auth.spec.ts` (ниже он переписан).

Вкладки «Настройки» больше нет — в настройки через шестерёнку:
- `e2e/companies.spec.ts`: после функции `createCompany` добавьте помощник

```ts
/** Шестерёнка в шапке → «Настройки компании» (§3.3 этапа 1.5). */
async function openCompanySettings(page: Page) {
  await page.getByRole('banner').getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Настройки компании' }).click();
}
```

и обе строки `await page.getByRole('link', { name: 'Настройки' }).click();` (в тестах «проекты по шаблонам» и «истёкшая сессия») замените на `await openCompanySettings(page);`.
- `e2e/dictionaries.spec.ts`, строка 24, и `e2e/money.spec.ts`, строка 93: `await page.getByRole('link', { name: 'Настройки' }).click();` замените на

```ts
  await page.getByRole('banner').getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Настройки компании' }).click();
```

- `e2e/service-screens.spec.ts`, строка 78 `await a.getByRole('link', { name: 'Профилёр' }).click(); // имя в шапке ведёт в профиль` →

```ts
  // профиль — в панели «Настройки» (шестерёнка): в её шапке имя пользователя
  await a.getByRole('banner').getByRole('button', { name: 'Настройки', exact: true }).click();
  await a.getByRole('dialog', { name: 'Профилёр' }).getByRole('link', { name: 'Профиль' }).click();
```

- [ ] **Step 5: Rewrite auth.spec**

`e2e/auth.spec.ts` — замените первый тест и добавьте второй (тест «глазок» не меняется):

```ts
import { expect, test, type Page } from '@playwright/test';

async function createCompany(page: Page, name: string): Promise<number> {
  await page.goto('/companies/new');
  await page.getByLabel('Название компании').fill(name);
  await page.getByRole('button', { name: 'Создать компанию' }).click();
  await expect(page).toHaveURL(/\/c\/\d+\/log$/);
  return Number(page.url().match(/\/c\/(\d+)\//)![1]);
}

test('вход, неверный пароль, выход через панель «Настройки»', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);

  await page.getByPlaceholder('Логин').fill('admin');
  await page.getByPlaceholder('Пароль').fill('wrong-password');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('alert')).toHaveText('Неверный логин или пароль');

  await page.getByPlaceholder('Пароль').fill('e2e-password-1');
  await page.getByRole('button', { name: 'Войти' }).click();
  const gear = page.getByRole('banner').getByRole('button', { name: 'Настройки', exact: true });
  await expect(gear).toBeVisible();
  await expect(gear).toHaveAttribute('title', 'Настройки');
  // имени пользователя и «Выйти» в шапке нет (01-H2)
  await expect(page.getByRole('banner').getByRole('button', { name: 'Выйти' })).toHaveCount(0);
  await expect(page.getByRole('banner')).not.toContainText('Админ');
  await expect(page).toHaveTitle('Учёт');

  await page.reload();
  await expect(gear).toBeVisible(); // сессия переживает перезагрузку

  // панель: имя — заголовок, логин под ним; Esc закрывает, фокус — на шестерёнке
  await gear.click();
  const menu = page.getByRole('dialog', { name: 'Админ' });
  await expect(menu).toContainText('admin');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(gear).toBeFocused();

  await gear.click();
  await menu.getByRole('button', { name: 'Выйти' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});

test('панель «Настройки» на странице компании: группы, переход закрывает панель и ставит фокус на заголовок', async ({ page }) => {
  await page.goto('/login');
  await page.getByPlaceholder('Логин').fill('admin');
  await page.getByPlaceholder('Пароль').fill('e2e-password-1');
  await page.getByRole('button', { name: 'Войти' }).click();
  const gear = page.getByRole('banner').getByRole('button', { name: 'Настройки', exact: true });
  await expect(gear).toBeVisible();
  const name = `ТОО Шестерёнка ${Date.now()}`;
  const cid = await createCompany(page, name);

  await gear.click();
  const menu = page.getByRole('dialog', { name: 'Админ' });
  await expect(menu).toContainText('Мой аккаунт');
  await expect(menu).toContainText(`Моя компания: ${name}`);
  await expect(menu.getByRole('link')).toHaveText([/^Профиль/, /^Мои компании/, /^Пользователи/, /^Настройки компании/]);
  await expect(menu.getByRole('button', { name: 'Выйти' })).toBeVisible();

  await menu.getByRole('link', { name: /^Пользователи/ }).click();
  await expect(menu).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/users$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Пользователи' })).toBeFocused();

  // «Настройки компании» — первый раздел компании
  await gear.click();
  await menu.getByRole('link', { name: /^Настройки компании/ }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/counterparties$`));

  // страница без компании: группы «Моя компания» нет
  await page.goto('/companies/new');
  await gear.click();
  await expect(menu).not.toContainText('Моя компания');
  await expect(menu.getByRole('button', { name: 'Выйти' })).toBeVisible();
  await page.keyboard.press('Escape');
});
```

(тест «глазок» оставьте после этих двух без изменений.)

- [ ] **Step 6: Run all checks; e2e twice**

Run: `npm test` → PASS, 627. Run: `npm run typecheck` → без ошибок.
Run: `npm run test:e2e` дважды → 65 passed оба раза.

- [ ] **Step 7: Commit**

```bash
git add src/client e2e
git commit -m "feat: шапка с иконкой-шестерёнкой; панель «Настройки» с профилем, компанией и «Выйти»; одна вкладка «Журнал»

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Блок компании и панель «Компании» с окном «Компания»

**Files:**
- Create: `src/client/lib/company-block.ts`, `tests/client/company-block.test.ts`, `src/client/components/CompaniesDrawer.tsx`, `src/client/components/CompanyEditDialog.tsx`
- Delete: `src/client/components/CompanySwitcher.tsx`
- Modify: `src/client/pages/CompanyLayout.tsx`
- Modify (тесты): `e2e/companies.spec.ts`, `e2e/service-screens.spec.ts`, `e2e/money.spec.ts`, `e2e/journal-actions.spec.ts`

**Interfaces:**
- Consumes: `Drawer` (`subtitle`, `afterClose` — задача 3), `focusHeadingSoon`, `Modal`, `Field`, `useCompaniesSummary(enabled)`, `switchCompanyPath(pathname, cid)`, `matchesQuery(text, query)` (`shared/search.ts`), `formatMoney`, `MONEY_SCREEN_BEFORE`.
- Produces:
  - `SEARCH_FROM = 5`, `companyInitials(name: string): string`, `filterCompanies<T extends { name: string }>(companies: readonly T[], query: string): T[]` (`lib/company-block.ts`);
  - `CompanyBlockButton({ current: Company; companies: Company[] })` — кнопка с `aria-label="Сменить компанию: {название}"` и панель «Компании» (`components/CompaniesDrawer.tsx`);
  - `CompanyEditDialog({ company: Company | null; onClose: () => void })` — окно «Компания» (`components/CompanyEditDialog.tsx`).

- [ ] **Step 1: Write the failing unit test**

`tests/client/company-block.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { companyInitials, filterCompanies, SEARCH_FROM } from '../../src/client/lib/company-block';

describe('блок компании и панель «Компании» (§3.1–3.2 этапа 1.5)', () => {
  it('инициалы — первые буквы двух первых слов без формы собственности и кавычек', () => {
    expect(companyInitials('ТОО «Демо Клубы»')).toBe('ДК');
    expect(companyInitials('ИП Лютик 123')).toBe('Л1');
    expect(companyInitials('Unity Cyber Club')).toBe('UC');
    expect(companyInitials('Demo Ltd')).toBe('D');
    expect(companyInitials('ТОО')).toBe('Т');
    expect(companyInitials('  ')).toBe('?');
    expect(companyInitials('ёлка')).toBe('Ё');
  });

  it('поиск без учёта регистра и «ё»; пустой запрос — все; порог появления поля', () => {
    const list = [{ name: 'ТОО Ёлка' }, { name: 'ИП Берёза' }, { name: 'Клуб Север' }];
    expect(filterCompanies(list, 'елк').map((c) => c.name)).toEqual(['ТОО Ёлка']);
    expect(filterCompanies(list, 'БЕРЕЗ').map((c) => c.name)).toEqual(['ИП Берёза']);
    expect(filterCompanies(list, '  ')).toEqual(list);
    expect(filterCompanies(list, 'нет такой')).toEqual([]);
    expect(SEARCH_FROM).toBe(5);
  });
});
```

Run: `npx vitest run tests/client/company-block.test.ts` → FAIL (модуля нет).

- [ ] **Step 2: Implement company-block**

`src/client/lib/company-block.ts`:

```ts
import { matchesQuery } from '../../shared/search';

/** Поле «Поиск» в панели «Компании» — только если компаний больше пяти (§3.2 этапа 1.5). */
export const SEARCH_FROM = 5;

/** Формы собственности: в инициалы не идут. */
const LEGAL_FORMS = new Set(['тоо', 'ип', 'ао', 'оао', 'зао', 'ооо', 'llp', 'llc', 'ltd', 'inc']);

/** Инициалы для аватара: первые буквы двух первых слов без формы собственности и кавычек: «ТОО «Демо Клубы»» → «ДК». */
export function companyInitials(name: string): string {
  const words = name.replace(/[«»"'“”„()]/g, ' ').split(/\s+/).filter(Boolean);
  const meaningful = words.filter((w) => !LEGAL_FORMS.has(w.toLowerCase().replace(/\./g, '')));
  const source = meaningful.length > 0 ? meaningful : words;
  const letters = source
    .slice(0, 2)
    .map((w) => [...w][0]!.toUpperCase())
    .join('');
  return letters || '?';
}

/** Компании под запрос (без учёта регистра и «ё»); пустой запрос — все. */
export function filterCompanies<T extends { name: string }>(companies: readonly T[], query: string): T[] {
  return query.trim() === '' ? [...companies] : companies.filter((c) => matchesQuery(c.name, query));
}
```

Run: `npx vitest run tests/client/company-block.test.ts` → PASS.

- [ ] **Step 3: CompanyEditDialog**

`src/client/components/CompanyEditDialog.tsx`:

```tsx
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { CURRENCIES } from '../../shared/currencies';
import { api, type ApiError } from '../lib/api';
import { queryClient } from '../lib/query';
import type { Company } from '../lib/queries';
import { Field } from './Field';
import { Modal } from './Modal';
import { alertClass, btnPrimary, btnSecondary, inputClass } from './ui';

/**
 * Окно «Компания» (✎ в панели «Компании», §3.2 этапа 1.5): название и базовая валюта. Открыто, пока задана
 * company. «В архив» и «Вернуть из архива» появятся здесь в плане 1.5-4, пока — на странице «Мои компании».
 */
export function CompanyEditDialog({ company, onClose }: { company: Company | null; onClose: () => void }) {
  return (
    <Modal open={company !== null} title="Компания" onClose={onClose} className="max-w-md">
      {company && <CompanyEditForm key={company.id} company={company} onDone={onClose} />}
    </Modal>
  );
}

function CompanyEditForm({ company, onDone }: { company: Company; onDone: () => void }) {
  const [name, setName] = useState(company.name);
  const [baseCurrency, setBaseCurrency] = useState(company.baseCurrency);
  const readOnly = company.archivedAt !== null;
  // только изменённые поля: смена валюты может быть запрещена (есть операции), переименование — нет
  const changes = {
    ...(name.trim() !== company.name ? { name } : {}),
    ...(baseCurrency !== company.baseCurrency ? { baseCurrency } : {}),
  };
  const save = useMutation<unknown, ApiError>({
    mutationFn: () => api(`/companies/${company.id}`, { method: 'PATCH', body: changes }),
    onSuccess: async () => {
      // ['companies'] обновляет и итоги компаний (['companies', 'summary']); валюта меняет итог в левой панели
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['companies'] }),
        queryClient.invalidateQueries({ queryKey: ['accounts', company.id, 'balances'] }),
      ]);
      onDone();
    },
  });
  const fields = save.error?.fields ?? {};

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (Object.keys(changes).length === 0) return onDone();
    save.mutate();
  };

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <Field label="Название компании" error={fields.name}>
        {(c) => <input {...c} value={name} disabled={readOnly || save.isPending} onChange={(e) => setName(e.target.value)} className={inputClass} />}
      </Field>
      <Field
        label="Базовая валюта"
        error={fields.baseCurrency}
        hint={company.currencyLocked ? 'В компании есть операции или фиксированные курсы — базовую валюту изменить нельзя' : undefined}
      >
        {(c) => (
          <select
            {...c}
            value={baseCurrency}
            disabled={readOnly || company.currencyLocked || save.isPending}
            onChange={(e) => setBaseCurrency(e.target.value)}
            className={inputClass}
          >
            {CURRENCIES.map((x) => (
              <option key={x.code} value={x.code}>
                {x.code} — {x.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      {save.error && !save.error.fields && (
        <p role="alert" className={`${alertClass} mb-0`}>
          {save.error.message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!readOnly && (
          <button type="submit" disabled={save.isPending || !name.trim()} className={btnPrimary}>
            Сохранить
          </button>
        )}
        <button type="button" onClick={onDone} className={btnSecondary}>
          Отмена
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: CompaniesDrawer**

`src/client/components/CompaniesDrawer.tsx`:

```tsx
import { useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { formatMoney, MONEY_SCREEN_BEFORE } from '../../shared/money';
import { companyInitials, filterCompanies, SEARCH_FROM } from '../lib/company-block';
import { switchCompanyPath } from '../lib/company-path';
import { focusHeadingSoon } from '../lib/focus-heading';
import { useCompaniesSummary, type Company } from '../lib/queries';
import { CompanyEditDialog } from './CompanyEditDialog';
import { Drawer } from './Drawer';
import { btnPrimary, inputClass } from './ui';

/** Квадратный аватар с инициалами (свой цвет бренда, §1). display задаёт вызывающий: grid или hidden md:grid. */
function Avatar({ name, className }: { name: string; className: string }) {
  return (
    <span aria-hidden="true" className={`shrink-0 place-items-center rounded-xl bg-income-soft font-bold text-income ${className}`}>
      {companyInitials(name)}
    </span>
  );
}

/**
 * Блок компании в шапке (§3.1 этапа 1.5): аватар, название и «Сменить компанию» — одна кнопка, открывает левую
 * панель «Компании» (§3.2). Доступное имя — «Сменить компанию: {название}».
 */
export function CompanyBlockButton({ current, companies }: { current: Company; companies: Company[] }) {
  const [open, setOpen] = useState(false);
  const navigated = useRef(false);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Сменить компанию: ${current.name}`}
        onClick={() => setOpen(true)}
        className="flex min-w-0 max-w-xs items-center gap-3 rounded-xl px-2 py-1 text-left hover:bg-white/10"
      >
        <Avatar name={current.name} className="hidden h-10 w-10 text-sm md:grid" />
        <span className="min-w-0">
          <span className="block truncate font-semibold">{current.name}</span>
          <span className="block truncate text-xs text-white/60">Сменить компанию</span>
        </span>
      </button>
      <Drawer
        open={open}
        title="Компании"
        side="left"
        onClose={() => setOpen(false)}
        afterClose={() => {
          if (!navigated.current) return false;
          navigated.current = false;
          focusHeadingSoon();
          return true;
        }}
      >
        <CompaniesList
          current={current}
          companies={companies}
          onDone={(withNavigation) => {
            navigated.current = withNavigation;
            setOpen(false);
          }}
        />
      </Drawer>
    </>
  );
}

function CompaniesList(props: { current: Company; companies: Company[]; onDone: (withNavigation: boolean) => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Company | null>(null);
  // итоги — при открытии панели (она монтирует список заново): свежие, без запросов на каждой странице
  const summary = useCompaniesSummary(true);
  const totals = new Map((summary.data ?? []).map((s) => [s.id, s.total]));
  const active = props.companies.filter((c) => !c.archivedAt);
  const shown = filterCompanies(active, query);

  const choose = (c: Company) => {
    // текущая компания — остаёмся там же (в том числе в настройках); другая — тот же раздел у неё
    if (c.id === props.current.id) return props.onDone(false);
    props.onDone(true);
    navigate(switchCompanyPath(location.pathname, c.id));
  };

  return (
    <div className="flex min-h-full flex-col">
      {active.length > SEARCH_FROM && (
        <input type="search" aria-label="Поиск" placeholder="Поиск" value={query} onChange={(e) => setQuery(e.target.value)} className={`${inputClass} mb-4`} />
      )}
      <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted">Мои компании</p>
      <div className="flex-1">
        {shown.map((c) => {
          const t = totals.get(c.id);
          const isCurrent = c.id === props.current.id;
          return (
            <div key={c.id} className={`mb-1 flex items-center gap-1 rounded-xl ${isCurrent ? 'bg-field' : 'hover:bg-field'}`}>
              <button
                type="button"
                aria-current={isCurrent ? 'true' : undefined}
                onClick={() => choose(c)}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 text-left"
              >
                <Avatar name={c.name} className="grid h-10 w-10 text-sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">
                    {c.name}
                    {isCurrent && (
                      <span aria-hidden="true" className="ml-1 text-income">
                        ✓
                      </span>
                    )}
                  </span>
                  {t && (
                    <span className="block truncate text-xs tabular-nums text-muted">
                      {formatMoney(t.amount, t.currency, MONEY_SCREEN_BEFORE)}
                      {t.unavailable.length > 0 && ` · без ${t.unavailable.join(', ')}`}
                    </span>
                  )}
                </span>
              </button>
              <button
                type="button"
                aria-label={`Изменить компанию «${c.name}»`}
                title="Изменить"
                onClick={() => setEditing(c)}
                className="mr-1 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-card hover:text-ink"
              >
                <span aria-hidden="true">✎</span>
              </button>
            </div>
          );
        })}
        {shown.length === 0 && <p className="px-1 text-sm text-muted">Ничего не найдено.</p>}
      </div>
      <div className="mt-4 grid gap-3 border-t border-field pt-4">
        <Link to="/companies/new" onClick={() => props.onDone(true)} className={`${btnPrimary} block text-center`}>
          Добавить компанию
        </Link>
        <Link to={`/c/${props.current.id}/settings/companies`} onClick={() => props.onDone(true)} className="text-center text-sm font-semibold text-muted underline hover:text-ink">
          Все компании, в том числе архивные
        </Link>
      </div>
      {/* окно поверх панели — вложенный <dialog>: его Esc и close панель не закрывают (Drawer проверяет target) */}
      <CompanyEditDialog company={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
```

- [ ] **Step 5: Use it in CompanyLayout; delete CompanySwitcher**

В `src/client/pages/CompanyLayout.tsx` импорт `import { CompanySwitcher } from '../components/CompanySwitcher';` замените на `import { CompanyBlockButton } from '../components/CompaniesDrawer';`, а в `left` шапки `<CompanySwitcher current={company} companies={companies.data} />` — на `<CompanyBlockButton current={company} companies={companies.data} />`.

Run: `git rm src/client/components/CompanySwitcher.tsx`
Проверка: `grep -rn "CompanySwitcher" src` — пусто.

- [ ] **Step 6: Update e2e**

`e2e/companies.spec.ts` — тест «компании: создание, переключение» замените целиком:

```ts
/** Строка компании в панели «Компании»: имя кнопки начинается с названия (у ✎ — «Изменить компанию «…»»). */
const companyRow = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

test('компании: создание, панель «Компании» — переключение, поиск, ✎ поверх панели, «Добавить компанию»', async ({ page }) => {
  await login(page);
  const suffix = Date.now();
  const first = `ТОО Ромашка ${suffix}`;
  const second = `ИП Лютик ${suffix}`;

  // поиск в панели появляется, когда компаний больше пяти: в начале прогона их может быть меньше
  const headers = { origin: new URL(page.url()).origin, 'x-requested-with': 'fetch' };
  for (let i = 1; i <= 4; i++) {
    expect((await page.request.post('/api/v1/companies', { data: { name: `ТОО Наполнение ${suffix} ${i}` }, headers })).status()).toBe(201);
  }

  const firstId = await createCompany(page, first);
  await expect(page.getByRole('heading', { name: 'Журнал' })).toBeAttached();
  const block = page.getByRole('banner').getByRole('button', { name: /Сменить компанию/ });
  await expect(block).toContainText(first);
  await expect(block).toContainText('Сменить компанию');

  // «Отмена» на экране новой компании возвращает в журнал первой активной
  await page.goto('/companies/new');
  await page.getByRole('link', { name: 'Отмена' }).click();
  await expect(page).toHaveURL(/\/c\/\d+\/log$/);

  const secondId = await createCompany(page, second);
  expect(secondId).not.toBe(firstId);
  await expect(block).toContainText(second);

  // панель: текущая отмечена; в общей базе e2e компаний больше пяти — есть поиск
  await block.click();
  const drawer = page.getByRole('dialog', { name: 'Компании' });
  await expect(drawer.getByRole('button', { name: companyRow(second) })).toHaveAttribute('aria-current', 'true');
  await drawer.getByRole('searchbox', { name: 'Поиск' }).fill(String(suffix));
  await expect(drawer.getByRole('button', { name: new RegExp(`^(ТОО Ромашка|ИП Лютик) ${suffix}`) })).toHaveCount(2);
  await drawer.getByRole('button', { name: companyRow(first) }).click();
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/c/${firstId}/log$`));
  await expect(block).toContainText(first);
  await expect(page.getByRole('heading', { name: 'Журнал' })).toBeFocused();

  // ✎ — окно «Компания» поверх панели; Esc закрывает только окно, фокус — на ✎
  await block.click();
  const pencil = drawer.getByRole('button', { name: `Изменить компанию «${first}»` });
  await pencil.click();
  const edit = page.getByRole('dialog', { name: 'Компания', exact: true });
  await expect(edit.getByLabel('Название компании')).toHaveValue(first);
  await page.keyboard.press('Escape');
  await expect(edit).toBeHidden();
  await expect(drawer).toBeVisible();
  await expect(pencil).toBeFocused();
  // переименование: новое название — в панели и в шапке
  await pencil.click();
  const renamed = `ТОО Ромашка переим ${suffix}`;
  await edit.getByLabel('Название компании').fill(renamed);
  await edit.getByRole('button', { name: 'Сохранить' }).click();
  await expect(edit).toBeHidden();
  await expect(drawer.getByRole('button', { name: companyRow(renamed) })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(block).toContainText(renamed);

  // «Все компании, в том числе архивные» и «Добавить компанию»
  await block.click();
  await drawer.getByRole('link', { name: 'Все компании, в том числе архивные' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${firstId}/settings/companies$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Мои компании' })).toBeFocused();
  await block.click();
  await drawer.getByRole('link', { name: 'Добавить компанию' }).click();
  await expect(page).toHaveURL(/\/companies\/new$/);

  await page.goto('/c/999999/log');
  await expect(page).not.toHaveURL(/\/c\/999999\//); // неизвестная компания → редирект…
  await expect(page).toHaveURL(/\/c\/\d+\/log$/); // …на первую активную
});
```

В тесте «проекты по шаблонам…» той же спеки последняя строка `await expect(page.getByRole('button', { name: 'Сменить компанию' })).toContainText(renamed);` не меняется (имя кнопки по-прежнему содержит «Сменить компанию»).

`e2e/service-screens.spec.ts` — тест «переключатель: клавиатура, …» замените целиком:

```ts
const companyRow = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

test('панель «Компании»: текущая компания не уводит из настроек, другая — тот же раздел и фокус на заголовке; последняя компания запоминается', async ({ page }) => {
  await login(page);
  const stamp = Date.now();
  const alpha = `ТОО Альфа ${stamp}`;
  const beta = `ТОО Бета ${stamp}`;
  const alphaId = await createCompany(page, alpha);
  const betaId = await createCompany(page, beta);

  await page.goto(`/c/${betaId}/settings/accounts`);
  const block = page.getByRole('banner').getByRole('button', { name: /Сменить компанию/ });
  await expect(block).toHaveAccessibleName(`Сменить компанию: ${beta}`);
  await expect(block).toHaveAttribute('aria-haspopup', 'dialog');

  // текущая компания — остаёмся в настройках, фокус на кнопке компании
  await block.click();
  const drawer = page.getByRole('dialog', { name: 'Компании' });
  await drawer.getByRole('button', { name: companyRow(beta) }).click();
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/c/${betaId}/settings/accounts$`));
  await expect(block).toBeFocused();

  // клавиатура: Enter открывает панель, Enter на «Альфе» — тот же раздел у неё, фокус на заголовке раздела
  await block.press('Enter');
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: companyRow(alpha) }).focus();
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/v1/preferences/lastCompanyId') && r.request().method() === 'PUT');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/c/${alphaId}/settings/accounts$`));
  await saved;
  await expect(page.getByRole('heading', { level: 1, name: 'Счета' })).toBeFocused();

  // Esc закрывает панель и возвращает фокус
  await block.click();
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(block).toBeFocused();

  // стартовый экран открывает последнюю компанию
  await page.goto('/');
  await expect(page).toHaveURL(new RegExp(`/c/${alphaId}/log$`));
});
```

`e2e/money.spec.ts`, строки 48–51 (переключатель с итогом):

```ts
  // панель «Компании»: у компании — её итог, ₸ впереди
  await page.getByRole('banner').getByRole('button', { name: /Сменить компанию/ }).click();
  const companies = page.getByRole('dialog', { name: 'Компании' });
  await expect(companies.getByRole('button', { name: new RegExp(`^${name}`) })).toContainText(/₸\s1\s500/);
  await page.keyboard.press('Escape');
```

`e2e/journal-actions.spec.ts`, строки 394–395 и 405–406:

```ts
  await page.getByRole('banner').getByRole('button', { name: /Сменить компанию/ }).click();
  await page.getByRole('dialog', { name: 'Компании' }).getByRole('button', { name: new RegExp(`^${otherName}`) }).click();
```

```ts
  await page.getByRole('banner').getByRole('button', { name: /Сменить компанию/ }).click();
  await page.getByRole('dialog', { name: 'Компании' }).getByRole('button', { name: new RegExp(`^${name}`) }).click();
```

Проверка: `grep -rn "menuitem" e2e` — пусто.

- [ ] **Step 7: Run all checks; e2e twice**

Run: `npm test` → PASS, 629 (627 + 2). Run: `npm run typecheck` → без ошибок.
Run: `npm run test:e2e` дважды → 65 passed оба раза.

- [ ] **Step 8: Commit**

```bash
git add src/client tests/client/company-block.test.ts e2e
git commit -m "feat: блок компании в шапке и панель «Компании» с поиском, итогами, ✎ и «Добавить компанию»

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Панель «История действий»

**Files:**
- Modify: `src/server/modules/operations/service.ts`
- Create: `tests/server/operations-audit.test.ts`
- Modify: `src/shared/dates.ts`, `tests/shared/dates.test.ts`
- Create: `src/client/lib/history.ts`, `tests/client/history.test.ts`, `src/client/components/HistoryDrawer.tsx`
- Modify: `src/client/lib/queries.ts`, `src/client/components/icons.tsx`, `src/client/pages/CompanyLayout.tsx`
- Modify (тесты): `e2e/service-screens.spec.ts`

**Interfaces:**
- Consumes: `diffRows`, `ACTION_LABELS` (`lib/audit-format.ts`), `AuditEntry` (`lib/queries.ts`), `formatMoney`, `MONEY_SCREEN_BEFORE`, `useOpenOperationForm`, `Drawer` (`afterClose`), `focusHeadingSoon`, `headerIconClass`.
- Produces:
  - история операций: правка — `diff.type`; удаление и восстановление — `diff = { type, amount, accountId, paidAt }`;
  - `formatDateTimeSec(iso, timeZone): string` — «04.10.2026, 10:32:15» (`shared/dates.ts`);
  - `HistoryItem`, `OPERATION_FIELD_LABELS`, `historyItems(entries, ctx): HistoryItem[]` (`lib/history.ts`);
  - `useOperationHistory(companyId)` → `AuditEntry[]` (`lib/queries.ts`);
  - `HistoryIcon()` (`components/icons.tsx`), `HistoryButton({ company })` (`components/HistoryDrawer.tsx`).

- [ ] **Step 1: Write the failing server test**

`tests/server/operations-audit.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { opsWorld, type OpsWorld } from '../helpers/ops';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

type Entry = { action: string; entityId: number; diff: Record<string, unknown> | null };
const entries = async (): Promise<Entry[]> => (await w.h.req('GET', `/api/v1/companies/${w.cid}/audit?entity=operation&limit=20`)).json().entries;

describe('история операций для панели «История действий» (§3.4 этапа 1.5)', () => {
  it('правка пишет тип; удаление и восстановление — тип, сумму, счёт и дату', async () => {
    w = await opsWorld();
    const op = (await w.post(w.ops, { type: 'expense', paidAt: '2026-10-05T10:00:00Z', accountId: w.kzt, amount: 131700, lines: [{ categoryId: w.expense, amount: 131700 }] })).operation;
    expect((await w.h.req('PATCH', `${w.ops}/${op.id}`, { version: 1, comment: 'аренда' })).statusCode).toBe(200);
    expect((await w.h.req('DELETE', `${w.ops}/${op.id}`)).statusCode).toBe(200);
    expect((await w.h.req('POST', `${w.ops}/${op.id}/restore`)).statusCode).toBe(200);

    const list = await entries();
    expect(list.map((e) => e.action)).toEqual(['restore', 'delete', 'update', 'create']);
    const [restore, del, update, create] = list;
    expect(create!.diff).toMatchObject({ type: 'expense', amount: 131700, accountId: w.kzt });
    expect(update!.diff).toMatchObject({ type: 'expense', after: { comment: 'аренда' } });
    for (const e of [del!, restore!]) {
      expect(e.diff).toMatchObject({ type: 'expense', amount: 131700, accountId: w.kzt });
      expect(typeof e.diff!.paidAt).toBe('string');
    }
  });
});
```

Run: `npx vitest run tests/server/operations-audit.test.ts`
Expected: FAIL — у `update` нет `type`, у `restore` `diff` равен `null`.

- [ ] **Step 2: Enrich the operation audit diffs**

В `src/server/modules/operations/service.ts`:
- в `update` вызов `record({ … action: 'update', diff: { ...changes, … } })` замените строку `diff`:

```ts
          // тип — для панели «История действий» («Изменён расход», §3.4 этапа 1.5)
          diff: { type: current.type, ...changes, ...(recalc ? { recalculated: { rate: [current.rate, rate], baseAmount: [current.baseAmount, baseAmount] } } : {}) },
```

- в `remove`:

```ts
        record({ companyId, userId, entity: 'operation', entityId: id, action: 'delete', diff: { type: current.type, amount: current.amount, accountId: current.accountId, paidAt: current.paidAt } });
```

- в `restore`:

```ts
        record({ companyId, userId, entity: 'operation', entityId: id, action: 'restore', diff: { type: current.type, amount: current.amount, accountId: current.accountId, paidAt: current.paidAt } });
```

Run: `npx vitest run tests/server/operations-audit.test.ts tests/server/operations-update.test.ts tests/server/operations-bulk.test.ts tests/server/audit-api.test.ts` → PASS.

- [ ] **Step 3: Write the failing client tests**

В `tests/shared/dates.test.ts` добавьте (импорт `formatDateTimeSec` из `../../src/shared/dates` — в существующую строку импорта):

```ts
describe('formatDateTimeSec', () => {
  it('дата и время до секунд в поясе приложения', () => {
    expect(formatDateTimeSec('2026-10-04T05:32:15.000Z', 'Asia/Almaty')).toBe('04.10.2026, 10:32:15');
    expect(formatDateTimeSec('2026-10-04T19:00:01.000Z', 'Asia/Almaty')).toBe('05.10.2026, 00:00:01');
  });
});
```

`tests/client/history.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { historyItems } from '../../src/client/lib/history';
import type { AuditEntry } from '../../src/client/lib/queries';

const accounts = new Map([
  [1, { name: 'Касса', currency: 'KZT' }],
  [2, { name: 'Валютный', currency: 'USD' }],
]);
const ctx = { accounts, timeZone: 'Asia/Almaty' };
const entry = (over: Partial<AuditEntry>): AuditEntry => ({
  id: 1,
  companyId: 1,
  userId: 1,
  userName: 'Админ',
  entity: 'operation',
  entityId: 10,
  action: 'create',
  diff: null,
  at: '2026-10-04T05:32:15.000Z',
  ...over,
});
/** Неразрывные пробелы денег → обычные: так ожидания читаются. */
const plain = (s: string | null) => (s === null ? null : s.replace(/[  ]/g, ' '));

describe('панель «История действий» (§3.4 этапа 1.5)', () => {
  it('добавление: действие и тип, сумма с ₸ впереди, счёт, пользователь и время до секунд', () => {
    const [item] = historyItems([entry({ diff: { type: 'income', amount: 131700, accountId: 1 } })], ctx);
    expect(item).toMatchObject({ title: 'Добавлен доход', type: 'income', account: 'Касса', changes: null, meta: 'Админ · 04.10.2026, 10:32:15', openable: true, operationId: 10 });
    expect(plain(item!.amount)).toBe('₸ 1 317');
  });

  it('правка: изменённые поля по-русски, без суммы', () => {
    const [item] = historyItems(
      [entry({ action: 'update', diff: { type: 'expense', before: { amount: 100, comment: null }, after: { amount: 200, comment: 'x' } } })],
      ctx,
    );
    expect(item).toMatchObject({ title: 'Изменён расход', amount: null, changes: 'Изменено: Сумма, Комментарий' });
  });

  it('удалённую операцию не открыть — ни запись об удалении, ни более ранние; восстановленную — можно', () => {
    const list = historyItems(
      [
        entry({ id: 5, entityId: 20, action: 'delete', diff: { type: 'transfer', amount: 500, accountId: 2 } }),
        entry({ id: 4, entityId: 30, action: 'restore', diff: { type: 'expense', amount: 100, accountId: 1 } }),
        entry({ id: 3, entityId: 30, action: 'delete', diff: { type: 'expense', amount: 100, accountId: 1 } }),
        entry({ id: 2, entityId: 20, action: 'create', diff: { type: 'transfer', amount: 500, accountId: 2 } }),
      ],
      ctx,
    );
    expect(list.map((i) => [i.title, i.openable])).toEqual([
      ['Удалён перевод', false],
      ['Восстановлен расход', true],
      ['Удалён расход', true],
      ['Добавлен перевод', false],
    ]);
    expect(plain(list[0]!.amount)).toBe('$ 5');
  });

  it('старые записи без типа — «операция»; неизвестный счёт — без суммы; без пользователя — «Система»', () => {
    const list = historyItems(
      [entry({ action: 'update', diff: { before: { comment: null }, after: { comment: 'x' } } }), entry({ action: 'restore', diff: null, userName: null }), entry({ diff: { type: 'income', amount: 100, accountId: 99 } })],
      ctx,
    );
    expect(list.map((i) => i.title)).toEqual(['Изменена операция', 'Восстановлена операция', 'Добавлен доход']);
    expect(list[1]!.meta.startsWith('Система · ')).toBe(true);
    expect(list[2]).toMatchObject({ amount: null, account: null });
  });
});
```

Run: `npx vitest run tests/shared/dates.test.ts tests/client/history.test.ts` → FAIL (нет `formatDateTimeSec`, нет модуля).

- [ ] **Step 4: Implement formatDateTimeSec and historyItems**

В `src/shared/dates.ts` после `formatDateTime` добавьте:

```ts
/** Дата и время до секунд в поясе приложения: «04.10.2026, 10:32:15» (панель «История действий», §3.4 этапа 1.5). */
export function formatDateTimeSec(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}
```

`src/client/lib/history.ts`:

```ts
import { formatDateTimeSec } from '../../shared/dates';
import { formatMoney, MONEY_SCREEN_BEFORE } from '../../shared/money';
import { ACTION_LABELS, diffRows } from './audit-format';
import type { AuditEntry } from './queries';

type OperationKind = 'income' | 'expense' | 'transfer';

const NOUNS: Record<OperationKind, string> = { income: 'доход', expense: 'расход', transfer: 'перевод' };
/** Глагол действия: с типом (мужской род) и без типа («операция»). */
const VERBS: Record<string, [string, string]> = {
  create: ['Добавлен', 'Добавлена'],
  update: ['Изменён', 'Изменена'],
  delete: ['Удалён', 'Удалена'],
  restore: ['Восстановлен', 'Восстановлена'],
};

/** Поля операции в записи правки — по-русски. */
export const OPERATION_FIELD_LABELS: Record<string, string> = {
  type: 'Тип',
  paidAt: 'Дата',
  accrualDate: 'Дата сделки',
  accountId: 'Счёт',
  toAccountId: 'Счёт зачисления',
  amount: 'Сумма',
  toAmount: 'Сумма зачисления',
  counterpartyId: 'Контрагент',
  comment: 'Комментарий',
  lines: 'Категория и проект',
  tagIds: 'Теги',
};

export interface HistoryItem {
  /** id записи истории. */
  id: number;
  operationId: number | null;
  /** «Добавлен доход», «Изменён расход», «Удалён перевод», «Восстановлена операция». */
  title: string;
  /** Тип операции — цвет суммы; null у старых записей без типа. */
  type: OperationKind | null;
  /** «₸ 1 317» — у добавления, удаления и восстановления, если счёт известен. */
  amount: string | null;
  account: string | null;
  /** У правки — «Изменено: Сумма, Комментарий». */
  changes: string | null;
  /** «Админ · 04.10.2026, 10:32:15». */
  meta: string;
  /** Открыть в форме можно, если последнее действие с операцией в ленте — не удаление. */
  openable: boolean;
}

const isKind = (v: unknown): v is OperationKind => v === 'income' || v === 'expense' || v === 'transfer';

/**
 * Записи панели «История действий» (§3.4 этапа 1.5). entries — от новых к старым, как отдаёт сервер:
 * первое встреченное действие с операцией — последнее по времени.
 */
export function historyItems(
  entries: readonly AuditEntry[],
  ctx: { accounts: ReadonlyMap<number, { name: string; currency: string }>; timeZone: string },
): HistoryItem[] {
  const latest = new Map<number, string>();
  for (const e of entries) if (e.entityId !== null && !latest.has(e.entityId)) latest.set(e.entityId, e.action);

  return entries.map((e) => {
    const diff = e.diff ?? {};
    const type = isKind(diff.type) ? diff.type : null;
    const verb = VERBS[e.action];
    const title = verb ? (type ? `${verb[0]} ${NOUNS[type]}` : `${verb[1]} операция`) : `${ACTION_LABELS[e.action] ?? e.action}: операция`;
    const account = typeof diff.accountId === 'number' ? ctx.accounts.get(diff.accountId) : undefined;
    const amount = e.action !== 'update' && typeof diff.amount === 'number' && account ? formatMoney(diff.amount, account.currency, MONEY_SCREEN_BEFORE) : null;
    const rows = e.action === 'update' ? diffRows(e.diff) : null;
    const changes = rows && rows.length > 0 ? `Изменено: ${rows.map((r) => OPERATION_FIELD_LABELS[r.field] ?? r.field).join(', ')}` : null;
    return {
      id: e.id,
      operationId: e.entityId,
      title,
      type,
      amount,
      account: account?.name ?? null,
      changes,
      meta: `${e.userName ?? 'Система'} · ${formatDateTimeSec(e.at, ctx.timeZone)}`,
      openable: e.entityId !== null && latest.get(e.entityId) !== 'delete',
    };
  });
}
```

Run: `npx vitest run tests/shared/dates.test.ts tests/client/history.test.ts` → PASS.

- [ ] **Step 5: Query, icon, drawer**

В `src/client/lib/queries.ts` после `useAuditFeed` добавьте:

```ts
/** Последние 20 действий с операциями компании — панель «История действий» (§3.4 этапа 1.5); при каждом открытии свежие. */
export function useOperationHistory(companyId: number) {
  return useQuery<AuditEntry[], ApiError>({
    queryKey: ['audit', companyId, 'operations-recent'],
    queryFn: async () => (await api<AuditPage>(`/companies/${companyId}/audit?entity=operation&limit=20`)).entries,
  });
}
```

В `src/client/components/icons.tsx` добавьте:

```tsx
export function HistoryIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <polyline points="3 3 3 9 9 9" />
      <polyline points="12 7 12 12 15 14" />
    </svg>
  );
}
```

`src/client/components/HistoryDrawer.tsx`:

```tsx
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { focusHeadingSoon } from '../lib/focus-heading';
import { historyItems, type HistoryItem } from '../lib/history';
import { useMeta } from '../lib/query';
import { useAccounts, useOperationHistory, type Company } from '../lib/queries';
import { Drawer } from './Drawer';
import { HistoryIcon } from './icons';
import { useOpenOperationForm } from './operation/OperationFormHost';
import { Pending } from './QueryState';
import { btnPrimary, headerIconClass } from './ui';

const AMOUNT_CLASS: Record<NonNullable<HistoryItem['type']>, string> = { income: 'text-income', expense: 'text-expense', transfer: 'text-transfer' };

/** Иконка «История действий» в шапке и правая панель с последними действиями по операциям (§3.4 этапа 1.5). */
export function HistoryButton({ company }: { company: Company }) {
  const [open, setOpen] = useState(false);
  const navigated = useRef(false);
  return (
    <>
      <button type="button" aria-label="История действий" title="История действий" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} className={headerIconClass}>
        <HistoryIcon />
      </button>
      <Drawer
        open={open}
        side="right"
        title="История действий"
        onClose={() => setOpen(false)}
        afterClose={() => {
          if (!navigated.current) return false;
          navigated.current = false;
          focusHeadingSoon();
          return true;
        }}
      >
        <HistoryList
          company={company}
          onOpenOperation={() => setOpen(false)}
          onMore={() => {
            navigated.current = true;
            setOpen(false);
          }}
        />
      </Drawer>
    </>
  );
}

function HistoryList(props: { company: Company; onOpenOperation: () => void; onMore: () => void }) {
  const feed = useOperationHistory(props.company.id);
  const accounts = useAccounts(props.company.id);
  const meta = useMeta();
  const openForm = useOpenOperationForm();
  const more = (
    <Link to={`/c/${props.company.id}/settings/audit`} onClick={props.onMore} className={`${btnPrimary} mt-4 block text-center`}>
      Подробнее
    </Link>
  );
  if (!feed.data || !accounts.data || !meta.data) {
    return (
      <>
        <Pending queries={[feed, accounts, meta]} />
        {more}
      </>
    );
  }
  const items = historyItems(feed.data, { accounts: new Map(accounts.data.map((a) => [a.id, a])), timeZone: meta.data.timezone });

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1">
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
                      onClick={() => {
                        props.onOpenOperation();
                        openForm({ kind: 'edit', id: it.operationId! });
                      }}
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
      {more}
    </div>
  );
}
```

В `src/client/pages/CompanyLayout.tsx`: импорт `import { HistoryButton } from '../components/HistoryDrawer';` и в `<AppHeader …>` свойство `tools={<HistoryButton company={company} />}` (перед `menu=…`).

- [ ] **Step 6: Update and write e2e**

`e2e/service-screens.spec.ts`:
- после `uniqueLogin` добавьте помощники:

```ts
const csrf = (page: Page) => ({ origin: new URL(page.url()).origin, 'x-requested-with': 'fetch' });

async function apiPost(page: Page, url: string, data: unknown) {
  const res = await page.request.post(url, { data, headers: csrf(page) });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return res.json();
}

const minuteAgo = () => new Date(Date.now() - 60_000).toISOString();
```

- в тесте «история: события компании…» строку `await page.goto(`/c/${cid}/settings/audit`);` (задача 1) замените:

```ts
  await page.getByRole('banner').getByRole('button', { name: 'История действий' }).click();
  await page.getByRole('dialog', { name: 'История действий' }).getByRole('link', { name: 'Подробнее' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/audit$`));
```

- в конец файла добавьте:

```ts
test('панель «История действий»: последние действия с операциями, открытие операции, «Подробнее»', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Лента ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  const income = (await apiPost(page, `${base}/operations`, { type: 'income', paidAt: minuteAgo(), accountId: cash, amount: 131700, comment: 'выручка' })).operation;
  const expense = (await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: minuteAgo(), accountId: cash, amount: 50000 })).operation;
  expect((await page.request.patch(`${base}/operations/${income.id}`, { data: { version: 1, comment: 'выручка за смену' }, headers: csrf(page) })).status()).toBe(200);
  expect((await page.request.delete(`${base}/operations/${expense.id}`, { headers: csrf(page) })).status()).toBe(200);
  await page.reload();

  const open = page.getByRole('banner').getByRole('button', { name: 'История действий' });
  await expect(open).toHaveAttribute('title', 'История действий');
  await open.click();
  const drawer = page.getByRole('dialog', { name: 'История действий' });
  const items = drawer.getByRole('list', { name: 'Последние действия' }).getByRole('listitem');
  await expect(items).toHaveCount(4);
  await expect(items.nth(0)).toContainText('Удалён расход');
  await expect(items.nth(0)).toContainText(/₸\s500/);
  await expect(items.nth(0)).toContainText('Касса');
  await expect(items.nth(0)).toContainText(/Админ · \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}:\d{2}/);
  await expect(items.nth(1)).toContainText('Изменён доход');
  await expect(items.nth(1)).toContainText('Изменено: Комментарий');
  await expect(items.nth(2)).toContainText('Добавлен расход');
  await expect(items.nth(3)).toContainText('Добавлен доход');
  await expect(items.nth(3)).toContainText(/₸\s1\s317/);
  // удалённый расход не открыть ни из записи об удалении, ни из записи о добавлении
  await expect(items.nth(0).getByRole('button')).toHaveCount(0);
  await expect(items.nth(2).getByRole('button')).toHaveCount(0);

  // запись о доходе открывает его в форме, панель закрывается
  await items.nth(1).getByRole('button').click();
  await expect(drawer).toBeHidden();
  const form = page.getByRole('dialog', { name: 'Изменить операцию' });
  await expect(form.getByLabel('Комментарий')).toHaveValue('выручка за смену');
  await page.keyboard.press('Escape');
  await expect(form).toBeHidden();

  // «Подробнее» — полная лента в настройках, фокус на её заголовке
  await open.click();
  await drawer.getByRole('link', { name: 'Подробнее' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/audit$`));
  await expect(page.getByRole('heading', { level: 1, name: 'История действий' })).toBeFocused();
});
```

- [ ] **Step 7: Run all checks; e2e twice**

Run: `npm test` → PASS, 635 (629 + 1 серверный + 1 даты + 4 истории). Run: `npm run typecheck` → без ошибок.
Run: `npm run test:e2e` дважды → 66 passed оба раза.

- [ ] **Step 8: Commit**

```bash
git add src tests/server/operations-audit.test.ts tests/shared/dates.test.ts tests/client/history.test.ts e2e/service-screens.spec.ts
git commit -m "feat: панель «История действий» в шапке; тип, сумма и счёт в истории правки, удаления и восстановления операции

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Заголовок журнала для программ чтения, кнопка сворачивания на границе, общее сворачивание с меню настроек

**Files:**
- Create: `src/client/lib/sidebar.ts`, `src/client/components/CollapseButton.tsx`
- Modify: `src/client/components/AccountsPanel.tsx`, `src/client/pages/settings/SettingsNav.tsx` (целиком), `src/client/pages/JournalPage.tsx`
- Modify (тесты): `e2e/money.spec.ts`

**Interfaces:**
- Consumes: `usePreferences`, `savePreference`, `queryClient`; `settingsGroups`, `journalBackHref`, `readLastJournal` (задача 1).
- Produces:
  - `SIDEBAR_PREF = 'sidebar.collapsed'`, `useSidebarCollapsed(): { collapsed: boolean; toggle: () => void }` (`lib/sidebar.ts`);
  - `CollapseButton({ collapsed, onToggle, collapseLabel, expandLabel })` (`components/CollapseButton.tsx`);
  - кнопки «Свернуть/Развернуть панель счетов» (панель счетов) и «Свернуть/Развернуть меню настроек» (зона настроек).

- [ ] **Step 1: Write the failing e2e test**

В конец `e2e/money.spec.ts` добавьте:

```ts
test('сворачивание: кнопка на правой границе панели, общая настройка для панели счетов и меню настроек; заголовок «Журнал» — для программ чтения', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Сворачивание ${Date.now()}`);
  // одна вкладка-пилюля «Журнал»; заголовок страницы есть, но виден только программам чтения
  await expect(page.getByRole('main').getByRole('link', { name: 'Журнал', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('main').getByRole('link', { name: 'Настройки', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: 'Журнал' })).toHaveClass(/sr-only/);

  const accounts = page.getByRole('navigation', { name: 'Счета' });
  const collapseAccounts = accounts.getByRole('button', { name: 'Свернуть панель счетов' });
  const navBox = (await accounts.boundingBox())!;
  const buttonBox = (await collapseAccounts.boundingBox())!;
  expect(buttonBox.x + buttonBox.width).toBeGreaterThan(navBox.x + navBox.width);
  await expect(collapseAccounts).toHaveAttribute('title', 'Свернуть панель счетов');

  // настройка общая для пользователя admin и остальных e2e: что бы ни случилось, она должна остаться «развёрнуто»
  try {
    await page.goto(`/c/${cid}/settings/tags`);
    const menu = page.getByRole('navigation', { name: 'Разделы настроек' });
    const saved = page.waitForResponse((r) => r.url().endsWith('/api/v1/preferences/sidebar.collapsed') && r.request().method() === 'PUT');
    await menu.getByRole('button', { name: 'Свернуть меню настроек' }).click();
    expect((await saved).request().postDataJSON()).toEqual({ value: true });
    await expect(menu.getByRole('button', { name: 'Развернуть меню настроек' })).toBeFocused();
    await expect(menu.getByRole('link', { name: 'Теги' })).toHaveCount(0);

    // та же настройка: в журнале свёрнута панель счетов (и после перезагрузки)
    await page.goto(`/c/${cid}/log`);
    await expect(accounts.getByRole('button', { name: 'Развернуть панель счетов' })).toBeVisible();
    const restored = page.waitForResponse((r) => r.url().endsWith('/api/v1/preferences/sidebar.collapsed') && r.request().method() === 'PUT');
    await accounts.getByRole('button', { name: 'Развернуть панель счетов' }).click();
    await restored;
    await expect(accounts.getByRole('button', { name: 'Свернуть панель счетов' })).toBeFocused();
    await page.goto(`/c/${cid}/settings/tags`);
    await expect(menu.getByRole('link', { name: 'Теги' })).toBeVisible();
  } finally {
    await page.request.put('/api/v1/preferences/sidebar.collapsed', {
      data: { value: false },
      headers: { origin: new URL(page.url()).origin, 'x-requested-with': 'fetch' },
    });
  }
});
```

Run: `npx playwright test e2e/money.spec.ts -g "сворачивание"`
Expected: FAIL — у `<h1>` нет `sr-only`, кнопки «Свернуть меню настроек» нет.

- [ ] **Step 2: Shared hook and button**

`src/client/lib/sidebar.ts`:

```ts
import { queryClient } from './query';
import { savePreference, usePreferences } from './queries';

/** Свёрнутая левая панель (§3.6 этапа 1.5): одна настройка для панели счетов и меню настроек. */
export const SIDEBAR_PREF = 'sidebar.collapsed';

/**
 * Состояние левой панели. Выбор виден сразу и в другой панели (кэш настроек меняется до ответа сервера);
 * сохраняется в фоне, сбой сохранения не мешает работе.
 */
export function useSidebarCollapsed(): { collapsed: boolean; toggle: () => void } {
  const prefs = usePreferences();
  const collapsed = prefs.data?.[SIDEBAR_PREF] === true;
  const toggle = () => {
    const next = !collapsed;
    queryClient.setQueryData<Record<string, unknown>>(['preferences'], (old) => ({ ...(old ?? {}), [SIDEBAR_PREF]: next }));
    savePreference(SIDEBAR_PREF, next).catch(() => undefined);
  };
  return { collapsed, toggle };
}
```

`src/client/components/CollapseButton.tsx`:

```tsx
/**
 * Круглая кнопка с рамкой на правой границе левой панели, на уровне вкладок (§3.6 этапа 1.5): «‹» свернуть,
 * «›» развернуть. Одна и та же кнопка в обоих состояниях — фокус не теряется; состояние передаёт подпись.
 * Родитель — `relative`.
 */
export function CollapseButton(props: { collapsed: boolean; onToggle: () => void; collapseLabel: string; expandLabel: string }) {
  const label = props.collapsed ? props.expandLabel : props.collapseLabel;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={props.onToggle}
      className="absolute -right-4 top-8 z-10 grid h-8 w-8 place-items-center rounded-full border border-field bg-card text-ink shadow hover:bg-field"
    >
      <span aria-hidden="true">{props.collapsed ? '›' : '‹'}</span>
    </button>
  );
}
```

- [ ] **Step 3: AccountsPanel uses them**

В `src/client/components/AccountsPanel.tsx`:
- импорты: строку из `'../lib/queries'` замените на `import { useAccounts, useBalances, useProjects, type Company } from '../lib/queries';`; `import { btnIcon, btnSmall } from './ui';` → `import { btnSmall } from './ui';`; добавьте `import { useSidebarCollapsed } from '../lib/sidebar';` и `import { CollapseButton } from './CollapseButton';`;
- удалите строку `const PREF_KEY = 'sidebar.collapsed';`;
- функцию `AccountsPanel` с комментарием над ней замените:

```tsx
/**
 * Левая панель на компьютере (§7): сворачивается круглой кнопкой на правой границе (§3.6 этапа 1.5),
 * состояние — общая с меню настроек настройка пользователя. На узком экране скрыта — там счета выезжают
 * слева по кнопке в шапке (AccountsDrawerButton).
 */
export function AccountsPanel({ company }: { company: Company }) {
  const { collapsed, toggle } = useSidebarCollapsed();
  return (
    <nav aria-label="Счета" className={`relative hidden shrink-0 self-start md:block ${collapsed ? 'h-24 w-3' : 'w-64 rounded-3xl bg-card p-4'}`}>
      <CollapseButton collapsed={collapsed} onToggle={toggle} collapseLabel="Свернуть панель счетов" expandLabel="Развернуть панель счетов" />
      {!collapsed && <AccountsSummary company={company} />}
    </nav>
  );
}
```

`useState` и `useEffect` по-прежнему нужны `AccountsDrawerButton`.

- [ ] **Step 4: SettingsNav collapses too**

`src/client/pages/settings/SettingsNav.tsx` — замените файл целиком (тело навигации — как в задаче 1):

```tsx
import { Link, NavLink } from 'react-router';
import { CollapseButton } from '../../components/CollapseButton';
import { journalBackHref, readLastJournal } from '../../lib/last-journal';
import type { Company } from '../../lib/queries';
import { settingsGroups } from '../../lib/settings-sections';
import { useSidebarCollapsed } from '../../lib/sidebar';

const sidebarLink = ({ isActive }: { isActive: boolean }) =>
  `block truncate rounded-xl px-3 py-2 text-sm ${isActive ? 'bg-field font-semibold text-ink' : 'text-muted hover:bg-field hover:text-ink'}`;
const inlineLink = ({ isActive }: { isActive: boolean }) =>
  `rounded-xl px-3 py-1.5 text-sm ${isActive ? 'bg-field font-semibold text-ink' : 'text-muted hover:text-ink'}`;

/**
 * Навигация зоны настроек (§4.1–4.2 этапа 1.5): «← Назад к журналу» и разделы по группам.
 * `sidebar` — слева вместо панели счетов (компьютер), сворачивается той же настройкой, что панель счетов (§3.6);
 * `inline` — строкой над разделом на телефоне (список разделов отдельным экраном — план 1.5-5).
 * Без ролей listitem, status, alert, region: их ищут e2e экранов настроек.
 */
export function SettingsNav({ company, variant }: { company: Company; variant: 'sidebar' | 'inline' }) {
  const back = journalBackHref(company.id, readLastJournal(company.id));
  const { collapsed, toggle } = useSidebarCollapsed();
  if (variant === 'inline') {
    return (
      <nav aria-label="Разделы настроек" className="mb-6 md:hidden">
        <SettingsNavBody companyId={company.id} companyName={company.name} back={back} sidebar={false} />
      </nav>
    );
  }
  return (
    <nav aria-label="Разделы настроек" className={`relative hidden shrink-0 self-start md:block ${collapsed ? 'h-24 w-3' : 'w-64 rounded-3xl bg-card p-4'}`}>
      <CollapseButton collapsed={collapsed} onToggle={toggle} collapseLabel="Свернуть меню настроек" expandLabel="Развернуть меню настроек" />
      {!collapsed && <SettingsNavBody companyId={company.id} companyName={company.name} back={back} sidebar />}
    </nav>
  );
}

function SettingsNavBody(props: { companyId: number; companyName: string; back: string; sidebar: boolean }) {
  return (
    <>
      <Link to={props.back} className="mb-3 inline-flex items-center gap-2 rounded-xl bg-field px-4 py-2 text-sm font-medium text-ink hover:brightness-95">
        <span aria-hidden="true">←</span> Назад к журналу
      </Link>
      {settingsGroups(props.companyName).map((g) => (
        <div key={g.key} className={g.title ? 'mt-3 border-t border-field pt-3' : ''}>
          {g.title && <p className="mb-1 truncate px-3 text-xs font-semibold uppercase tracking-wide text-muted">{g.title}</p>}
          <div className={props.sidebar ? 'grid gap-0.5' : 'flex flex-wrap gap-1'}>
            {g.items.map((s) => (
              <NavLink key={s.path} to={`/c/${props.companyId}/settings/${s.path}`} className={props.sidebar ? sidebarLink : inlineLink}>
                {s.label}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
```

- [ ] **Step 5: Journal heading only for screen readers**

В `src/client/pages/JournalPage.tsx` заголовок:

```tsx
      <h1 id={HEADING_ID} tabIndex={-1} className="mb-4 text-2xl font-bold outline-none">
        Журнал
      </h1>
```

замените на

```tsx
      {/* заголовок дублировал вкладку «Журнал» (01-M2): виден только программам чтения, фокус после тостов — сюда */}
      <h1 id={HEADING_ID} tabIndex={-1} className="sr-only">
        Журнал
      </h1>
```

- [ ] **Step 6: Run all checks; e2e twice**

Run: `npm test` → PASS, 635. Run: `npm run typecheck` → без ошибок.
Run: `npm run test:e2e` дважды → 67 passed оба раза. Старый тест сворачивания панели счетов (`money.spec.ts`, «левая панель: балансы и итог…») проходит без изменений: кнопка внутри `<nav aria-label="Счета">`, подписи прежние, фокус остаётся на ней.

- [ ] **Step 7: Commit**

```bash
git add src/client e2e/money.spec.ts
git commit -m "feat: круглая кнопка сворачивания на границе панели, общая для счетов и меню настроек; заголовок журнала для программ чтения

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Скрипт визуальной сверки `npm run shots:ux` и README

**Files:**
- Create: `scripts/ux-shots.ts`
- Modify: `package.json`, `README.md`

**Interfaces:**
- Consumes: `loadConfig(env)`, `openDb`, `runMigrations`, `seedCurrencies`, `startServer(config, { logger: false }) → { url, stop() }`, `createAuditService`, `createUsersService`, `seedDemo({ db, timezone, now, operations })`, `chromium` из `@playwright/test`.
- Produces: команда `npm run shots:ux -- [папка]`; снимки `c*.png` / `cm*.png` и `index.html` в папке сверки; список сценариев `SCENARIOS` — его дополняют планы 1.5-2…1.5-6.

- [ ] **Step 1: Write the script**

`scripts/ux-shots.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { loadConfig } from '../src/server/config';
import { openDb } from '../src/server/db/client';
import { runMigrations } from '../src/server/db/migrate';
import { seedCurrencies } from '../src/server/db/seed';
import { startServer } from '../src/server/main';
import { createAuditService } from '../src/server/modules/audit/service';
import { createUsersService } from '../src/server/modules/users/service';
import { seedDemo } from './lib/demo';

// Визуальная сверка с Finmap (§12.3 этапа 1.5): снимки наших экранов под парными к снимкам Finmap именами и
// index.html «Finmap | наш». Инструмент разработчика, в CI не входит.
// npm run shots:ux [-- <папка>]; по умолчанию docs/research/screens/v2/parity/ (в .gitignore вместе с docs/research/screens/).
// Безопасность: свой сервер на временной папке данных и своём порту (SHOTS_PORT, по умолчанию 41741). Файл настроек
// и data/ приложения не читаются; порты живого приложения (3457), демо (3460) и e2e (41731) запрещены.

const PORT = Number(process.env.SHOTS_PORT ?? 41741);
const FORBIDDEN_PORTS = [3457, 3460, 41731];
/** «Сейчас» для демо-набора и браузера: 10.10.2026 15:58 по Алматы. */
const NOW = new Date('2026-10-10T10:58:00.000Z');
const LOGIN = 'shots';
const PASSWORD = 'shots-password-1';
const DEMO_COMPANY = 'ТОО «Демо Клубы»';
const FINMAP_DIR = path.resolve('docs/research/screens/v2');
const outDir = path.resolve(process.argv[2] ?? path.join(FINMAP_DIR, 'parity'));
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

interface Scenario {
  /** Наш снимок в папке сверки. */
  ours: string;
  /** Парный снимок Finmap в docs/research/screens/v2/. */
  finmap: string;
  phone?: boolean;
  /** Страница компании без /c/<id>/: 'log', 'settings/tags'. */
  path: string;
  /** Что сделать перед снимком; ждёт нужный элемент. */
  act?: (page: Page) => Promise<unknown>;
}

const banner = (p: Page) => p.getByRole('banner');
const table = (p: Page) => p.getByRole('table', { name: 'Операции' });
const newForm = (p: Page) => p.getByRole('dialog', { name: 'Новая операция' });

const openForm = (label: 'Доход' | 'Расход' | 'Перевод') => async (p: Page) => {
  await banner(p).getByRole('button', { name: label, exact: true }).click();
  await newForm(p).getByRole('textbox', { name: /^Сумма,/ }).waitFor();
};
const formList = (field: RegExp) => async (p: Page) => {
  await openForm('Доход')(p);
  await newForm(p).getByRole('button', { name: field }).click();
  await p.getByRole('listbox').first().waitFor();
};

/** Экраны, которые уже есть. Следующие планы этапа 1.5 добавляют сюда свои. */
const SCENARIOS: Scenario[] = [
  { ours: 'c01-log.png', finmap: '01-log.png', path: 'log' },
  { ours: 'c02-row-hover.png', finmap: '02-row-hover.png', path: 'log', act: (p) => table(p).locator('tbody tr').nth(1).hover() },
  {
    ours: 'c03-ukazat-popover.png',
    finmap: '03-ukazat-popover.png',
    path: 'log',
    act: async (p) => {
      await table(p).getByRole('button', { name: /Указать/ }).first().click();
      await p.getByRole('listbox').first().waitFor();
    },
  },
  {
    ours: 'c04-bulk-selected.png',
    finmap: '04-bulk-selected.png',
    path: 'log',
    act: async (p) => {
      const boxes = table(p).locator('tbody').getByRole('checkbox');
      await boxes.nth(0).check();
      await boxes.nth(1).check();
    },
  },
  {
    ours: 'c05-op-edit.png',
    finmap: '05-op-edit.png',
    path: 'log',
    act: async (p) => {
      await table(p).getByRole('button', { name: /^Открыть операцию/ }).first().click();
      await p.getByRole('dialog', { name: 'Изменить операцию' }).getByRole('textbox', { name: /^Сумма,/ }).waitFor();
    },
  },
  { ours: 'c06-income.png', finmap: '06-income.png', path: 'log', act: openForm('Доход') },
  {
    ours: 'c07-income-expanded.png',
    finmap: '07-income-expanded.png',
    path: 'log',
    act: async (p) => {
      await openForm('Доход')(p);
      await newForm(p).getByRole('button', { name: /^Проект, теги, комментарий/ }).click();
    },
  },
  { ours: 'c08-income-account-dd.png', finmap: '08-income-account-dd.png', path: 'log', act: formList(/^Счёт:/) },
  { ours: 'c09-income-category-dd.png', finmap: '09-income-category-dd.png', path: 'log', act: formList(/^Категория:/) },
  { ours: 'c10-income-counterparty-dd.png', finmap: '10-income-counterparty-dd.png', path: 'log', act: formList(/^Контрагент:/) },
  {
    ours: 'c14-after-escape.png',
    finmap: '14-after-escape.png',
    path: 'log',
    act: async (p) => {
      await openForm('Доход')(p);
      const amount = newForm(p).getByRole('textbox', { name: /^Сумма,/ });
      await amount.fill('1500');
      await amount.press('Escape');
      await p.getByRole('alertdialog').waitFor();
    },
  },
  { ours: 'c15-expense.png', finmap: '15-expense.png', path: 'log', act: openForm('Расход') },
  { ours: 'c16-transfer.png', finmap: '16-transfer.png', path: 'log', act: openForm('Перевод') },
  {
    ours: 'c18-filter-modal.png',
    finmap: '18-filter-modal.png',
    path: 'log',
    act: async (p) => {
      await p.getByRole('button', { name: 'Фильтр', exact: true }).click();
      await p.getByRole('dialog', { name: 'Фильтр', exact: true }).waitFor();
    },
  },
  { ours: 'c21-account-add.png', finmap: '21-account-add.png', path: 'settings/accounts', act: (p) => p.getByRole('button', { name: 'Добавить счёт' }).click() },
  {
    ours: 'c23-change-company.png',
    finmap: '23-change-company.png',
    path: 'log',
    act: async (p) => {
      await banner(p).getByRole('button', { name: /Сменить компанию/ }).click();
      await p.getByRole('dialog', { name: 'Компании' }).waitFor();
    },
  },
  {
    ours: 'c24-history.png',
    finmap: '24-history.png',
    path: 'log',
    act: async (p) => {
      await banner(p).getByRole('button', { name: 'История действий' }).click();
      await p.getByRole('list', { name: 'Последние действия' }).waitFor();
    },
  },
  {
    ours: 'c25-settings-menu.png',
    finmap: '25-settings-menu.png',
    path: 'log',
    act: async (p) => {
      await banner(p).getByRole('button', { name: 'Настройки', exact: true }).click();
      await p.getByRole('dialog').getByRole('button', { name: 'Выйти' }).waitFor();
    },
  },
  { ours: 'c26-company-settings.png', finmap: '26-company-settings.png', path: 'settings/profile' },
  { ours: 'c27-settings-Мои_компании.png', finmap: '27-settings-Мои_компании.png', path: 'settings/companies' },
  { ours: 'c28-settings-Контрагенты.png', finmap: '28-settings-Контрагенты.png', path: 'settings/counterparties' },
  { ours: 'c29-settings-Счета.png', finmap: '29-settings-Счета.png', path: 'settings/accounts' },
  { ours: 'c30-settings-Категории.png', finmap: '30-settings-Категории.png', path: 'settings/categories' },
  { ours: 'c31-settings-Проекты.png', finmap: '31-settings-Проекты.png', path: 'settings/projects' },
  { ours: 'c32-settings-Теги.png', finmap: '32-settings-Теги.png', path: 'settings/tags' },
  { ours: 'c33-settings-Пользователи.png', finmap: '33-settings-Пользователи.png', path: 'settings/users' },
  { ours: 'c34-settings-rates.png', finmap: '34-settings-rates.png', path: 'settings/rates' },
  { ours: 'c35-settings-backup.png', finmap: '35-settings-backup.png', path: 'settings/backup' },
  { ours: 'c36-settings-log-view.png', finmap: '36-settings-log-view.png', path: 'settings/journal' },
  {
    ours: 'cm01-accounts.png',
    finmap: 'm01-log.png',
    phone: true,
    path: 'log',
    act: async (p) => {
      await banner(p).getByRole('button', { name: 'Счета', exact: true }).click();
      await p.getByRole('dialog', { name: 'Счета' }).waitFor();
    },
  },
  { ours: 'cm02-log.png', finmap: 'm02-log-closed-panel.png', phone: true, path: 'log' },
  {
    ours: 'cm04-op-open.png',
    finmap: 'm04-op-open.png',
    phone: true,
    path: 'log',
    act: async (p) => {
      await p.getByRole('list', { name: 'Операции' }).getByRole('button').first().click();
      await p.getByRole('dialog', { name: 'Изменить операцию' }).getByRole('textbox', { name: /^Сумма,/ }).waitFor();
    },
  },
  {
    ours: 'cm05-income.png',
    finmap: 'm05-income.png',
    phone: true,
    path: 'log',
    act: async (p) => {
      await p.getByRole('group', { name: 'Добавить операцию' }).getByRole('button', { name: 'Доход', exact: true }).click();
      await newForm(p).waitFor();
    },
  },
];

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const relSrc = (file: string) => encodeURI(path.relative(outDir, file).split(path.sep).join('/'));

async function newContext(browser: Browser, base: string, phone: boolean): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: base, viewport: phone ? PHONE : DESKTOP, locale: 'ru-RU', timezoneId: 'Asia/Almaty' });
  await context.clock.setFixedTime(NOW);
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByPlaceholder('Логин').fill(LOGIN);
  await page.getByPlaceholder('Пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.getByRole('button', { name: 'Настройки', exact: true }).waitFor();
  await page.close();
  return context;
}

async function shoot(context: BrowserContext, cid: number, s: Scenario): Promise<void> {
  const page = await context.newPage();
  try {
    await page.goto(`/c/${cid}/${s.path}`);
    if (s.path === 'log') {
      await (s.phone ? page.getByRole('list', { name: 'Операции' }).getByRole('listitem').first() : table(page).locator('tbody tr').first()).waitFor();
    } else {
      await page.getByRole('main').getByRole('heading', { level: 1 }).waitFor();
      await page.getByRole('main').getByText('Загрузка…').waitFor({ state: 'detached' });
    }
    if (s.act) await s.act(page);
    await page.screenshot({ path: path.join(outDir, s.ours), animations: 'disabled' });
  } finally {
    await page.close();
  }
}

if (FORBIDDEN_PORTS.includes(PORT)) fail(`Порт ${PORT} занят живым приложением, демо или e2e — задайте другой SHOTS_PORT.`);
fs.mkdirSync(outDir, { recursive: true });

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-shots-'));
const config = loadConfig({ SESSION_SECRET: 's'.repeat(40), DATA_DIR: dataDir, PORT: String(PORT), RATES_SOURCE: 'fixtures' });
fs.mkdirSync(config.dataDir, { recursive: true });
{
  const { sqlite, db } = openDb(config.dbPath);
  runMigrations(db);
  seedCurrencies(db);
  await createUsersService(db, createAuditService(db)).create({ login: LOGIN, name: 'Владелец', password: PASSWORD }, null);
  seedDemo({ db, timezone: config.timezone, now: NOW, operations: 400 });
  sqlite.close();
}
const server = await startServer(config, { logger: false });
const base = `http://localhost:${PORT}`;
const results = new Map<string, string>();
let failures = 0;
let browser: Browser | null = null;
try {
  browser = await chromium.launch();
  const desktop = await newContext(browser, base, false);
  const phone = await newContext(browser, base, true);
  const companies = (await (await desktop.request.get('/api/v1/companies')).json()).companies as { id: number; name: string }[];
  const cid = companies.find((c) => c.name === DEMO_COMPANY)?.id;
  if (cid === undefined) throw new Error(`В демо-наборе нет компании ${DEMO_COMPANY}`);
  for (const s of SCENARIOS) {
    try {
      await shoot(s.phone ? phone : desktop, cid, s);
      results.set(s.finmap, 'снято');
      console.log(`✓ ${s.ours}`);
    } catch (e) {
      failures++;
      const message = (e as Error).message.split('\n')[0]!;
      results.set(s.finmap, `ошибка: ${message}`);
      console.error(`✗ ${s.ours}: ${message}`);
    }
  }
} finally {
  await browser?.close();
  await server.stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

// index.html: каждый снимок Finmap и наш рядом; сценарии без снимка Finmap — тоже
const finmapFiles = fs.existsSync(FINMAP_DIR)
  ? fs.readdirSync(FINMAP_DIR).filter((f) => f.endsWith('.png') && !f.startsWith('c') && f !== 'tmp.png').sort()
  : [];
const byFinmap = new Map(SCENARIOS.map((s) => [s.finmap, s]));
const rows = [...new Set([...finmapFiles, ...SCENARIOS.map((s) => s.finmap)])].map((finmap) => {
  const s = byFinmap.get(finmap);
  const finmapPath = path.join(FINMAP_DIR, finmap);
  const left = fs.existsSync(finmapPath) ? `<img src="${relSrc(finmapPath)}" alt="">` : '<em>нет снимка Finmap</em>';
  const status = s ? (results.get(finmap) ?? 'не снято') : 'нет сценария';
  const right = s && status === 'снято' ? `<img src="${encodeURI(s.ours)}" alt="">` : `<em>${escapeHtml(status)}</em>`;
  return `<tr><th colspan="2">${escapeHtml(finmap)}${s ? ` ↔ ${escapeHtml(s.ours)}` : ''}</th></tr><tr><td>${left}</td><td>${right}</td></tr>`;
});
fs.writeFileSync(
  path.join(outDir, 'index.html'),
  `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Сверка с Finmap</title>
<style>body{font:14px system-ui,sans-serif;margin:16px}table{border-collapse:collapse;width:100%}th{text-align:left;padding:12px 4px 4px;background:#eef1f4}td{width:50%;vertical-align:top;padding:4px}img{max-width:100%;border:1px solid #ccc}</style>
</head><body><h1>Finmap | наш</h1><p>Снято ${SCENARIOS.length - failures} из ${SCENARIOS.length} сценариев; ${new Date().toISOString()}</p>
<table>${rows.join('\n')}</table></body></html>\n`,
  'utf8',
);
console.log(`Готово: ${outDir}${path.sep}index.html — снято ${SCENARIOS.length - failures} из ${SCENARIOS.length}.`);
// сервер мог оставить таймеры (расписание бэкапов): выходим явно
process.exit(failures > 0 ? 1 : 0);
```

- [ ] **Step 2: npm script**

В `package.json` в `scripts` после `"bench:journal": …` добавьте:

```json
    "shots:ux": "npm run build:client && tsx scripts/ux-shots.ts",
```

- [ ] **Step 3: Typecheck and run the script once**

Run: `npm run typecheck` → без ошибок.
Run: `npm test` → PASS, 635 (тест терминологии сканирует и `scripts/ux-shots.ts`).
Run: `npm run shots:ux`
Expected: строки `✓ c01-log.png` … и итог `Готово: …\parity\index.html — снято 34 из 34.` Сервер скрипта — на порту 41741, база во временной папке, после работы папка удаляется. Если какой-то сценарий упал (`✗ …`), прочитайте сообщение: обычно это локатор, который не нашёл элемент на демо-данных (например, в первых строках журнала нет «Указать»). Исправьте локатор в этом сценарии, а не продукт, и запустите ещё раз. Откройте `docs/research/screens/v2/parity/index.html` и убедитесь, что пары видны рядом. В git папка не попадает (`git status` её не показывает).

- [ ] **Step 4: README**

В `README.md`:
- в разделе «Что уже работает» после блока «Эксплуатация (шаг 8)» и перед строкой «Пока нет (следующие шаги): отчёты.» вставьте:

```markdown
- **Интерфейс как в Finmap (этап 1.5, план 1.5-1):**
  - «Категория» вместо «Статья» везде: в интерфейсе, сообщениях и выгрузке в Excel;
  - суммы без нулевых копеек; в левой панели и итогах компаний ₸ стоит перед суммой; балансы обновляются при возврате на вкладку;
  - окна с «×» в шапке; при закрытии формы с изменениями — окно «Ваши данные не сохранятся» с «Больше не спрашивать» (вернуть вопрос — в «Настройках журнала»);
  - шапка: блок компании с панелью «Компании» (поиск, итоги, ✎, «Добавить компанию»), иконки «История действий» и «Настройки»; «Выйти» — в панели «Настройки»;
  - настройки — отдельная зона с меню разделов по группам и «← Назад к журналу»; левая панель и меню сворачиваются одной кнопкой.
```

- в том же разделе строки

```markdown
  - переключатель компаний, который запоминает последнюю компанию.
```

```markdown
- **Настройки:**
  - Проекты, Счета, Категории (дерево, перетаскивание), Контрагенты, Теги, Шаблоны разделения, Курсы, Компании;
  - Пользователи, Профиль, История действий, Резервная копия.
```

замените на

```markdown
  - панель «Компании», которая запоминает последнюю компанию.
```

```markdown
- **Настройки:**
  - Профиль, Мои компании; Контрагенты, Счета, Категории (дерево, перетаскивание), Проекты с шаблонами разделения, Теги, Пользователи, Фиксированные курсы валют, Резервное копирование; Настройки журнала;
  - полная история действий — по «Подробнее» в панели истории.
```

- в таблицу раздела «Разработка» после строки `npm run bench:journal` добавьте строку:

```markdown
| `npm run shots:ux -- [папка]` | Визуальная сверка с Finmap (§12.3 этапа 1.5): поднимает свой сервер на временной базе с демо-набором (порт `SHOTS_PORT`, по умолчанию 41741), снимает наши экраны на 1440×900 и 390×844 под парными к снимкам Finmap именами и пишет `index.html` «Finmap \| наш». По умолчанию — в `docs/research/screens/v2/parity/` (в git не попадает) |
```

Run: `npx vitest run tests/shared/terminology.test.ts` → PASS (README по-прежнему без «статья»).

- [ ] **Step 5: Final checks**

Run: `npm test` → PASS, 635. Run: `npm run typecheck` → без ошибок. Run: `npm run test:e2e` → 67 passed.

- [ ] **Step 6: Commit**

```bash
git add scripts/ux-shots.ts package.json README.md
git commit -m "feat: npm run shots:ux — визуальная сверка с Finmap; README — итоги плана 1.5-1

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## После плана

- Итоги, отложенные замечания и итог визуальной сверки (что совпало, что отличается намеренно) — `docs/superpowers/followups/2026-10-10-stage1_5-plan1b-followups.md` (пишет контролёр).
- Следующий план — 1.5-2 «Журнал». Он добавляет в `SCENARIOS` скрипта сверки снимки 17, 18b, 19 и колонку «Дата сделки» в «Настройки журнала».
