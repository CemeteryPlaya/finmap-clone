# Этап 1.5, план 1.5-4b: экраны настроек — категории, проекты и шаблоны, «Мои компании», сервисные разделы, «Настройки журнала» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** вторая половина плана 1.5-4 из §13 спецификации этапа 1.5:
- «Категории» (§7.2): подменю «Системные / Мои × дохода / расхода», шаблон списка с «+» подкатегорией, окна «Новая категория», «Новая подкатегория», «Категория» с «Перенести в…» и ↑ ↓;
- «Проекты» с вкладкой «Шаблоны разделения» (§7.4): шаблон списка, окно проекта (шаблон, затем параметры), «Создать шаблон» → окно редактора;
- «Мои компании» (§7.4): карточки только для чтения, архивные ниже; `CompanyEditDialog` с «В архив» / «Вернуть из архива» вместо правки в строке (решение 9 плана 1.5-1);
- «Пользователи», «Профиль», «Фиксированные курсы валют», «Резервное копирование» в целевом виде §7.4;
- окончательные «Настройки журнала» (§7.5): вид Finmap, понятная ошибка частичного сохранения (итоги 1.5-1b №5), «Применить» не залипает после сбоя (итоги 1.5-2a №5);
- сверка `npm run shots:ux`: категории.

**Предусловие:** выполнен план [1.5-4a](2026-10-11-stage1_5-plan4a-settings-list-accounts.md): `SettingsList`, `EntityActions`/`ArchivedNote`, `useReorder`/`useEntityActions`, `SettingsSubmenu`, `mergeSubsetOrder`, иконки `GripIcon`, `PlusIcon`, `BankIcon`, `InfoIcon`, токен `expense-strong`, в `e2e/dictionaries.spec.ts` — помощники `apiPost`, `csrf`, `minuteAgo`. Ожидаемо на старте: `npm test` и `npm run test:e2e` зелёные (сверка 1.5-4a — 42 экрана).

**Architecture:**
- **Категории** — чистые функции в новом `src/client/lib/category-tabs.ts`: вкладки, строки вкладки для `SettingsList`, план `POST …/categories/reorder` из новой группы (`mergeSubsetOrder` по полному списку соседей: на верхнем уровне свои и системные — соседи), варианты «Перенести в…» (правила `lib/category-moves.ts`). Страница — на `SettingsSubmenu` + `SettingsList`.
- **Окна разделов** — `Modal` с формой и `EntityActions`, как в 1.5-4a. Проекты и шаблоны — `ProjectForm` и `PresetForm` в окне; «Мои компании» — `CompanyEditDialog`; курсы — свои окна с «Удалить» через `EntityActions`.
- **Профиль** — одна форма с одной «Сохранить»; что отправлять, решает чистая `profilePlan` (новый `lib/profile.ts`).
- **«Настройки журнала»** — правки поверх сохранённого (`lib/journal-view.ts`): «Применить» доступна, пока правки отличаются от сохранённого на сервере; после сбоя настройки перечитываются.
- Сервер не меняется.

**Tech Stack:** как в этапе 1. Новых пакетов нет.

**Spec:** [docs/superpowers/specs/2026-10-10-stage1_5-finmap-ux-design.md](../specs/2026-10-10-stage1_5-finmap-ux-design.md) — §4.2 (подменю `?tab=`), §7.1, §7.2, §7.4, §7.5, §11, §12, §13 (блоки «Решения планирования плана 1.5-1» №5, №7, №9, «… 1.5-2» №8 и «Решения планирования плана 1.5-4»). Аудит: [03-accounts-settings.md](../../research/ux-parity/03-accounts-settings.md) — №5, №7, №16, №17, №22–№26.

**Ветка:** `stage1/plan1-skeleton`. В `main` не сливаем.

## Решения, принятые при планировании

Записаны в спецификацию (§13, блок «Решения планирования плана 1.5-4», №8–№15) тем же коммитом, что и план.

1. **«Категории» (§7.2):** подменю — ссылки `?tab=` (`system-income`, `system-expense`, `my-income`, `my-expense`; неверное — `my-expense`), иконки «банк» и «i». Верхний уровень — полужирно, дочерние — с отступом. «+» «Добавить подкатегорию в {название}» — у строк верхнего уровня, в том числе системных, кроме архивных. У системной вместо ✎ — иконка «банк» (`role="img"`, имя «Системная — не переименовывается и не удаляется»). Порядок — среди соседей уровня; на верхнем уровне свои и системные — соседи, поэтому новый порядок вкладки встаёт в полный порядок уровня (`categoryReorderPlan`), системные не сдвигаются. Окна: «Новая категория» (поле «Название»), «Новая подкатегория» («Название» и строка «Родитель: {название}»), «Категория» («Название», «Перенести в…» — «Верхний уровень» и допустимые родители по правилам `lib/category-moves.ts`; если переносить некуда — поле недоступно; ↑ ↓ — `ReorderButtons`, действуют сразу). «Сохранить» сначала переименовывает, затем переносит — в конец списка нового родителя.
2. **«Проекты» (§7.4):** `<h1>` «Проекты» стоит над вкладками и на вкладке «Шаблоны разделения» тоже (как в Finmap: заголовок раздела один, вкладка показывает, где вы); вкладки и заголовок — `ProjectsHeader`. Окно проекта: «Тип бизнеса», «Название проекта», параметры шаблона; «Переименовано счетов: N» — над списком после закрытия окна. Шаблоны: «Создать шаблон» → окно «Новый шаблон», ✎ → «Шаблон разделения»; список с порядком за ☰, серый текст — доли. `moveWithinGroup` удалён; `ReorderButtons` остался только в окне «Категория».
3. **«Мои компании» (§7.4, решение 9 плана 1.5-1):** карточки `<li>` — аватар с инициалами, «Компания», «Баланс на счетах ₸ …» (итоги `useCompaniesSummary`; у архивной — «—»), «Базовая валюта», ✎ «Изменить компанию «…»». Архивные — отдельным списком «В архиве» ниже. `CompanyEditDialog` получил «В архив» / «Вернуть из архива» (`EntityActions` без «Удалить»: компании не удаляются) и свойство `currentId`; архив открытой компании уводит на стартовый экран — он откроет первую активную. Правки в строке страницы больше нет.
4. **«Пользователи» (§7.4):** шаблон списка без поиска и без порядка; серый текст — логин; пометки «это вы», «отключён» (отключённые — в конце). ✎ → окно «Пользователь»: «Имя» и «Сохранить» (закрывает окно); «Новый пароль для {логин}» и «Сбросить пароль»; «Отключить» / «Включить»; у себя — только имя. Итоги сброса и отключения — в окне (`role="status"`). «Добавить пользователя» → окно «Новый пользователь».
5. **«Профиль» (§7.4):** одна колонка 430 px и одна «Сохранить»: имя сохраняется, если изменилось; пароль — если заполнено любое из трёх полей пароля, тогда нужны все три и совпадение повтора («Пароли не совпадают» — без запроса). Подписи: «Текущий пароль», «Новый пароль», «Повторите пароль». Итог: «Имя сохранено.», «Пароль изменён. Остальные сеансы завершены.».
6. **«Фиксированные курсы валют» (§7.4):** «Добавить свой курс» → окно «Новый фиксированный курс» (Валюта, Курс к {база}, Действует с, Действует по); ✎ «Изменить курс {валюта}» → окно «Фиксированный курс» (курс и даты, валюта не меняется) с «Удалить». Ниже наш блок «Ручные курсы на дату»: «Добавить курс на дату» → окно «Новый курс на дату»; ✎ «Изменить курс {валюта} на {дата}» → окно «Курс на дату» (только курс) с «Удалить». Подзаголовки блоков прежние: «Фиксированные курсы компании», «Ручные курсы на дату».
7. **«Резервное копирование» (§7.4):** карточка-регион «Автоматическая копия»: плашка «Включено» (автокопия у нас включена всегда), «Ежедневно в 04:00 и при запуске, если последней копии больше суток», «Последняя копия», «Папка для копий (BACKUP_COPY_DIR)», ошибка копирования, «Скачать сейчас».
8. **«Настройки журнала» (§7.5):** строки «подпись — флажок справа» с разделителями (снимок Finmap `36`), пояснение под «Показывать полностью», «Применить» на всю ширину. Значения формы — правки поверх сохранённого: настройка без правки следует за сервером; «Применить» доступна, пока правки отличаются от сохранённого; после сбоя настройки перечитываются (итоги 1.5-2a №5). Ошибка: «Не удалось сохранить «{настройка}»: {причина}. Остальное сохранено: «Колонки», «Показывать полностью».» — имена как подписи на странице (итоги 1.5-1b №5; заменяет текст решения 8 плана 1.5-2).

## Global Constraints

- **Принцип (§1):** «расположение и приёмы как в Finmap, внешний вид свой; где наше лучше — оставляем». Оставляем: ручные курсы на дату, история действий по адресу `settings/audit`, резервная копия на весь экземпляр. **Мёртвых кнопок нет.**
- **Шаблон списка (§7.1):** как в плане 1.5-4a — «Добавить …» под заголовком слева, «Поиск» во всю ширину, строки «☰ название, серый текст, ✎», перетаскивание за ☰ и Alt+↑/↓, окно правки с «В архив» / «Вернуть из архива» и «Удалить» через `ConfirmDialog`, архивные в конце с пометкой «в архиве».
- **Категории (§7.2):** слева в карточке подменю — «Системные категории дохода» (`system-income`), «Системные категории расхода» (`system-expense`), «Мои категории дохода» (`my-income`), «Мои категории расхода» (`my-expense`, по умолчанию); у системных пунктов иконка «банк», у своих — «i». «Мои»: «Добавить категорию» → окно «Новая категория» (поле «Название», верхний уровень вида вкладки); строки: ☰, название полужирно, справа «+» (`aria-label="Добавить подкатегорию в {название}"`) и ✎; подкатегории с отступом, у них ☰ и ✎ без «+» (не больше 2 уровней). «Системные»: системные категории с дочерними; вместо ✎ — «банк» с подсказкой «Системная — не переименовывается и не удаляется»; «+» есть; дочерние — обычные строки с ✎; кнопки «Добавить категорию» нет. «+» → окно «Новая подкатегория»: «Название», родитель указан и не меняется. ✎ → окно «Категория»: «Название»; «Перенести в…» — «Верхний уровень» или категория верхнего уровня того же вида, включая системные (правила `lib/category-moves.ts`); ↑ и ↓; «В архив», «Удалить». Поиск показывает найденную подкатегорию вместе с её родителем.
- **Остальные разделы (§7.4):** Проекты — вкладки с подчёркиванием «Проекты | Шаблоны разделения» (`projects`, `projects/split-presets`), «Добавить проект» → окно (шаблон, затем параметры `ProjectForm`), у шаблонов «Создать шаблон» → окно редактора. Мои компании — «Добавить компанию» слева вверху → `/companies/new`; карточки только для чтения: аватар с инициалами, название, «Баланс на счетах ₸ 10 264 810», базовая валюта, ✎ → окно `CompanyForm` с «В архив» / «Вернуть из архива»; архивные — отдельным блоком ниже. Пользователи — «Добавить пользователя» слева вверху; строки: имя, логин серым, ✎ → окно: имя, сброс пароля, отключение; пометка «Общие для всех компаний». Профиль — одна колонка около 430 px: логин (только чтение), «Имя», заголовок «🔒 Изменить пароль», «Текущий пароль», «Новый пароль», «Повторите пароль», «Сохранить». Фиксированные курсы — список фиксированных курсов компании, «Добавить свой курс» → окно (Валюта, Курс, С, По); ниже «Ручные курсы на дату» с «Добавить курс на дату» → окно; переключателя «исторические курсы» нет. Резервное копирование — описание «Копия общая для всех компаний»; карточка «Автоматическая копия»: плашка статуса, «ежедневно в 04:00 и при запуске», дата последней копии, папка `BACKUP_COPY_DIR` и ошибка копирования, «Скачать сейчас»; списка копий нет.
- **«Настройки журнала» (§7.5):** флажки колонок в порядке §5.3, «Дата» и «Сумма» отмечены и недоступны; «Показывать полностью (до 2 строк)» → `journal.wrap`; «Спрашивать перед закрытием формы с несохранёнными данными» — обратный к `operationForm.skipCloseConfirm`; «Применить» сохраняет всё вместе; список в «Ещё» журнала применяется сразу.
- **Окна (§2.4, §11):** `Modal` — «×», Esc, фокус при закрытии на открывшую кнопку или `<h1>`; `ConfirmDialog` — «Отменить | Удалить».
- **Деньги:** на экране — `formatMoney(…, MONEY_SCREEN | MONEY_SCREEN_BEFORE)`. **Цвет:** текст цвета расхода — только `text-expense-strong` (`tests/client/theme.test.ts`).
- **Терминология:** «Категория», никогда «Статья».
- **Без новых npm-пакетов.** Сервер и схема БД не меняются.
- **Невидимые символы** (U+2212, U+202F, U+00A0, U+200B) в коде — только экранированием `\u2212` и т. п.
- **Концы строк:** рабочая копия в CRLF (`core.autocrlf=true`). Правки «найдите → замените» — инструментом правки файлов.
- **E2E:** порт 41731 (`E2E_PORT`), APP_TIMEZONE e2e-сервера — `Asia/Almaty`; один пользователь `admin`/`e2e-password-1` и одна база на прогон (пользователи и ручные курсы общие для всех тестов — имена уникальны); `name:` в Playwright — подстрока без учёта регистра (точное совпадение — `exact: true`); данные — через `page.request` с `origin` и `x-requested-with: fetch`; общие настройки пользователя восстанавливаются в `try/finally`; без фиксированных пауз. `journal-actions.spec.ts:555` — известный нестабильный тест.
- **Безопасность среды (обязательно):**
  - никогда не запускайте `npm start`, `npm run stop`, `npm run setup`, `npm run service:install`, `npm run service:uninstall`, `schtasks` и `icacls` — ни в каком виде: на порту 3457 работает живое приложение пользователя, на порту 3460 — демо-экземпляр, их не трогайте;
  - e2e идут на порту 41731 со своей временной базой; `npm run shots:ux` — на порту 41741 со своей временной папкой;
  - shell-команды не содержат подстроку «.env».
- **Завершение задачи:** зелёные `npm test`, `npm run typecheck` и `npm run test:e2e`; если задача меняет e2e — `npm run test:e2e` дважды подряд. Коммит с трейлером `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. В коммит попадает каждый новый файл задачи.

## Review Focus

1. **Перестановка своих категорий среди системных** (вкладка «Мои категории расхода», на верхнем уровне вперемешку системные): системные остаются на своих местах, переставляются только свои. Тесты — задача 1 (unit `categoryReorderPlan` и e2e: порядок верхнего уровня из API).
2. **«Перенести в…» у категории с дочерними и у подкатегории:** у родителя с дочерними — только «Верхний уровень», поле недоступно; у подкатегории — её родитель, другие допустимые и системные. Тесты — задача 1 (unit `parentOptions` и e2e).
3. **«Настройки журнала» после сбоя и перезапроса:** если сохранённое значение на сервере стало равно форме, «Применить» недоступна; если отличается — доступна; настройка без правки показывает значение с сервера. Тесты — задача 6 (unit `journalViewChanges`, `shownJournalView` и e2e частичного сбоя).
4. **Профиль: заполнена только часть пароля или повтор не совпал** — ошибка у поля, запроса нет; имя без изменений и пустые поля пароля — «Сохранить» недоступна. Тесты — задача 4 (unit `profilePlan`, `profileDirty` и e2e).
5. **Архив открытой компании** (из окна «Компания»): уход на первую активную компанию, архивная — в блоке «В архиве» и возвращается оттуда. Тест — задача 3 (e2e).

---

## Карта файлов

```
src/client/lib/category-tabs.ts                     # (новый) вкладки, строки, план порядка, «Перенести в…»
src/client/lib/profile.ts                           # (новый) profilePlan, profileDirty, profileServerFields
src/client/lib/journal-view.ts                      # (новый) правки поверх сохранённого
src/client/lib/preferences.ts                       # prefsSaveError — новый текст
src/client/lib/order.ts                             # moveWithinGroup удалён
src/client/components/icons.tsx                     # LockIcon
src/client/components/CompanyEditDialog.tsx         # архив, currentId
src/client/components/CompaniesDrawer.tsx           # CompanyAvatar (экспорт), currentId
src/client/components/ProjectForm.tsx               # порядок полей, одна колонка
src/client/pages/settings/CategoriesSettings.tsx    # подменю и шаблон списка
src/client/pages/settings/ProjectsTabs.tsx          # ProjectsHeader
src/client/pages/settings/ProjectsSettings.tsx      # шаблон списка, окно проекта
src/client/pages/settings/SplitPresetsSettings.tsx  # шаблон списка, окно шаблона
src/client/pages/settings/CompaniesSettings.tsx     # карточки
src/client/pages/settings/UsersSettings.tsx         # шаблон списка, окна
src/client/pages/settings/ProfileSettings.tsx       # одна колонка
src/client/pages/settings/RatesSettings.tsx         # окна курсов
src/client/pages/settings/BackupSettings.tsx        # карточка «Автоматическая копия»
src/client/pages/settings/JournalViewSettings.tsx   # окончательный вид
scripts/ux-shots.ts                                 # сценарии категорий
tests/client/category-tabs.test.ts (новый), profile.test.ts (новый), journal-view.test.ts (новый), preferences.test.ts, order.test.ts
e2e/dictionaries.spec.ts, companies.spec.ts, money.spec.ts, mobile.spec.ts, service-screens.spec.ts, dialogs.spec.ts
```

---

### Task 1: «Категории» — подменю, «+» подкатегория, окно «Категория»

**Files:**
- Create: `src/client/lib/category-tabs.ts`, `tests/client/category-tabs.test.ts`
- Modify: `src/client/pages/settings/CategoriesSettings.tsx` (полная замена)
- Test: `e2e/dictionaries.spec.ts`

**Interfaces:**
- Consumes: `SettingsList`, `SettingsSubmenu`, `EntityActions`, `ArchivedNote`, `useEntityActions`, `mergeSubsetOrder`, `PlusIcon`, `BankIcon` (план 1.5-4a); `moveError`, `planMove`, `planShift`, `MovePlan` (`lib/category-moves.ts`); `ReorderButtons`.
- Produces: `type CategoryTab`; `CATEGORY_TABS: readonly CategoryTabInfo[]` (`{ tab, label, kind, system }`); `categoryTab(param: string | null): CategoryTab`; `categoryTabInfo(tab): CategoryTabInfo`; `interface CategoryRow extends SettingsRow { node: CategoryNode; system: boolean; topLevel: boolean }`; `categoryRows(tree: CategoryTree, tab: CategoryTab): CategoryRow[]`; `categoryReorderPlan(tree: CategoryTree, tab: CategoryTab, group: readonly number[]): MovePlan | null`; `parentOptions(level: readonly CategoryNode[], node: CategoryNode): { value: string; label: string }[]`.

- [ ] **Step 1: Write the failing unit test**

Создайте `tests/client/category-tabs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CATEGORY_TABS, categoryReorderPlan, categoryRows, categoryTab, parentOptions } from '../../src/client/lib/category-tabs';
import type { CategoryNode, CategoryTree } from '../../src/client/lib/queries';

const n = (id: number, parentId: number | null, extra: Partial<CategoryNode> = {}, children: CategoryNode[] = []): CategoryNode => ({
  id,
  companyId: 1,
  kind: 'expense',
  parentId,
  name: `c${id}`,
  systemKey: null,
  effectiveSystemKey: null,
  templateRef: null,
  orderIndex: 0,
  archivedAt: null,
  children,
  ...extra,
});

// расходы: 1 — системная (дочерняя 11), 2 — своя (21, 22 в архиве), 3 — своя, 4 — системная
const tree: CategoryTree = {
  income: [n(30, null, { kind: 'income', systemKey: 'investment' }), n(31, null, { kind: 'income' })],
  expense: [n(1, null, { systemKey: 'salary' }, [n(11, 1)]), n(2, null, {}, [n(21, 2), n(22, 2, { archivedAt: 'x' })]), n(3, null), n(4, null, { systemKey: 'tax' })],
};

describe('вкладки «Категорий» (§7.2 этапа 1.5)', () => {
  it('порядок и подписи как в Finmap', () => {
    expect(CATEGORY_TABS.map((t) => [t.tab, t.label])).toEqual([
      ['system-income', 'Системные категории дохода'],
      ['system-expense', 'Системные категории расхода'],
      ['my-income', 'Мои категории дохода'],
      ['my-expense', 'Мои категории расхода'],
    ]);
  });

  it('параметр адреса: известный — он, иначе «Мои категории расхода»', () => {
    expect(categoryTab('system-income')).toBe('system-income');
    expect(categoryTab(null)).toBe('my-expense');
    expect(categoryTab('nope')).toBe('my-expense');
  });
});

describe('categoryRows — строки вкладки', () => {
  it('«Мои»: свои категории верхнего уровня вида, под каждой — её дочерние', () => {
    expect(categoryRows(tree, 'my-expense').map((r) => [r.id, r.parentId, r.topLevel, r.system, r.archived])).toEqual([
      [2, null, true, false, false],
      [21, 2, false, false, false],
      [22, 2, false, false, true],
      [3, null, true, false, false],
    ]);
    expect(categoryRows(tree, 'my-income').map((r) => r.id)).toEqual([31]);
  });

  it('«Системные»: системные с дочерними; дочерние — обычные строки', () => {
    expect(categoryRows(tree, 'system-expense').map((r) => [r.id, r.system])).toEqual([
      [1, true],
      [11, false],
      [4, true],
    ]);
  });
});

describe('categoryReorderPlan — порядок вкладки в полном порядке уровня (Review Focus 1)', () => {
  it('свои на верхнем уровне меняются местами, системные остаются на своих местах', () => {
    expect(categoryReorderPlan(tree, 'my-expense', [3, 2])).toEqual({ kind: 'expense', parentId: null, ids: [1, 3, 2, 4], moving: null });
  });

  it('системная между своими остаётся на своём месте', () => {
    const mixed: CategoryTree = { income: [], expense: [n(2, null), n(1, null, { systemKey: 'salary' }), n(3, null)] };
    expect(categoryReorderPlan(mixed, 'my-expense', [3, 2])).toEqual({ kind: 'expense', parentId: null, ids: [3, 1, 2], moving: null });
  });

  it('дочерние — порядок детей родителя', () => {
    expect(categoryReorderPlan(tree, 'my-expense', [22, 21])).toEqual({ kind: 'expense', parentId: 2, ids: [22, 21], moving: null });
  });

  it('пустая группа и неизвестный id — null', () => {
    expect(categoryReorderPlan(tree, 'my-expense', [])).toBeNull();
    expect(categoryReorderPlan(tree, 'my-expense', [99])).toBeNull();
  });
});

describe('parentOptions — «Перенести в…» (Review Focus 2)', () => {
  const level = tree.expense;

  it('лист верхнего уровня: «Верхний уровень» и все допустимые родители, включая системные', () => {
    expect(parentOptions(level, level[2]!).map((o) => o.value)).toEqual(['top', '1', '2', '4']);
    expect(parentOptions(level, level[2]!)[0]).toEqual({ value: 'top', label: 'Верхний уровень' });
  });

  it('категория с дочерними — только «Верхний уровень»', () => {
    expect(parentOptions(level, level[1]!).map((o) => o.value)).toEqual(['top']);
  });

  it('подкатегория: её родитель и другие допустимые', () => {
    expect(parentOptions(level, level[1]!.children[0]!).map((o) => o.value)).toEqual(['top', '1', '2', '3', '4']);
  });
});
```

Run: `npx vitest run tests/client/category-tabs.test.ts` → FAIL (модуля нет).

- [ ] **Step 2: `lib/category-tabs.ts`**

Создайте `src/client/lib/category-tabs.ts`:

```ts
import { moveError, type MovePlan } from './category-moves';
import { mergeSubsetOrder } from './order';
import type { CategoryNode, CategoryTree } from './queries';
import type { SettingsRow } from './settings-list';

/** Пункт подменю «Категорий» (§7.2 этапа 1.5), `?tab=` адреса. */
export type CategoryTab = 'system-income' | 'system-expense' | 'my-income' | 'my-expense';

export interface CategoryTabInfo {
  tab: CategoryTab;
  label: string;
  kind: 'income' | 'expense';
  /** Системные категории (иконка «банк»), иначе свои. */
  system: boolean;
}

export const CATEGORY_TABS: readonly CategoryTabInfo[] = [
  { tab: 'system-income', label: 'Системные категории дохода', kind: 'income', system: true },
  { tab: 'system-expense', label: 'Системные категории расхода', kind: 'expense', system: true },
  { tab: 'my-income', label: 'Мои категории дохода', kind: 'income', system: false },
  { tab: 'my-expense', label: 'Мои категории расхода', kind: 'expense', system: false },
];

export const DEFAULT_CATEGORY_TAB: CategoryTab = 'my-expense';

/** `?tab=` адреса: известный пункт — он, иначе «Мои категории расхода» (§4.2). */
export function categoryTab(param: string | null): CategoryTab {
  return CATEGORY_TABS.find((t) => t.tab === param)?.tab ?? DEFAULT_CATEGORY_TAB;
}

export function categoryTabInfo(tab: CategoryTab): CategoryTabInfo {
  return CATEGORY_TABS.find((t) => t.tab === tab) ?? CATEGORY_TABS[CATEGORY_TABS.length - 1]!;
}

/** Строка списка категорий: сама категория, системная ли она, верхний ли уровень. */
export interface CategoryRow extends SettingsRow {
  node: CategoryNode;
  system: boolean;
  topLevel: boolean;
}

/** Строки вкладки: категории верхнего уровня вида — системные или свои, под каждой её дочерние (§7.2). */
export function categoryRows(tree: CategoryTree, tab: CategoryTab): CategoryRow[] {
  const info = categoryTabInfo(tab);
  return tree[info.kind]
    .filter((n) => (n.systemKey !== null) === info.system)
    .flatMap((n) => [
      { id: n.id, name: n.name, archived: n.archivedAt !== null, parentId: null, node: n, system: n.systemKey !== null, topLevel: true },
      ...n.children.map((c) => ({
        id: c.id,
        name: c.name,
        archived: c.archivedAt !== null,
        parentId: n.id,
        node: c,
        system: c.systemKey !== null,
        topLevel: false,
      })),
    ]);
}

/**
 * Тело POST /categories/reorder для новой группы вкладки (соседи одного уровня в новом порядке). На верхнем
 * уровне свои и системные — соседи: группа встаёт в полный список уровня на свои места, остальные не сдвигаются.
 */
export function categoryReorderPlan(tree: CategoryTree, tab: CategoryTab, group: readonly number[]): MovePlan | null {
  const { kind } = categoryTabInfo(tab);
  const level = tree[kind];
  const first = group[0];
  if (first === undefined) return null;
  if (level.some((n) => n.id === first)) {
    return { kind, parentId: null, ids: mergeSubsetOrder(level.map((n) => n.id), group), moving: null };
  }
  const parent = level.find((n) => n.children.some((c) => c.id === first));
  if (!parent) return null;
  return { kind, parentId: parent.id, ids: mergeSubsetOrder(parent.children.map((c) => c.id), group), moving: null };
}

/** «Перенести в…»: «Верхний уровень», текущий родитель и категории верхнего уровня, куда можно перенести (§7). */
export function parentOptions(level: readonly CategoryNode[], node: CategoryNode): { value: string; label: string }[] {
  return [
    { value: 'top', label: 'Верхний уровень' },
    ...level
      .filter((p) => p.id === node.parentId || (p.id !== node.id && moveError(level, node, p.id) === null))
      .map((p) => ({ value: String(p.id), label: p.name })),
  ];
}
```

Run: `npx vitest run tests/client/category-tabs.test.ts` → PASS.

- [ ] **Step 3: Write the failing e2e test**

В `e2e/dictionaries.spec.ts` тест «категории: вложение, «Перенести в…», переименование, перетаскивание; системные не переименовываются» замените целиком на:

```ts
test('категории: подменю «Системные / Мои», «Добавить категорию», «+» подкатегория, окно «Категория» с «Перенести в…», поиск с родителем, порядок среди системных', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Категории ${Date.now()}`);
  await page.goto(`/c/${cid}/settings/categories`);
  const main = page.getByRole('main');
  const kinds = main.getByRole('navigation', { name: 'Виды категорий' });
  await expect(kinds.getByRole('link')).toHaveText(['Системные категории дохода', 'Системные категории расхода', 'Мои категории дохода', 'Мои категории расхода']);
  await expect(kinds.getByRole('link', { name: 'Мои категории расхода' })).toHaveAttribute('aria-current', 'page');
  const list = main.getByRole('list', { name: 'Мои категории расхода' });
  const created = page.getByRole('dialog', { name: 'Новая категория' });
  const sub = page.getByRole('dialog', { name: 'Новая подкатегория' });
  const edit = page.getByRole('dialog', { name: 'Категория', exact: true });

  // «Добавить категорию» → окно «Новая категория»
  for (const name of ['Реклама', 'Аренда']) {
    await main.getByRole('button', { name: 'Добавить категорию' }).click();
    await created.getByLabel('Название').fill(name);
    await created.getByRole('button', { name: 'Сохранить' }).click();
    await expect(created).toBeHidden();
  }
  // «+» у строки → «Новая подкатегория», родитель указан
  await list.getByRole('button', { name: 'Добавить подкатегорию в Реклама' }).click();
  await expect(sub).toContainText('Родитель: Реклама');
  await sub.getByLabel('Название').fill('Таргет');
  await sub.getByRole('button', { name: 'Сохранить' }).click();
  await expect(sub).toBeHidden();
  await expect(list.getByRole('listitem')).toHaveText([/Реклама/, /Таргет/, /Аренда/]);

  // ✎ — окно «Категория»: имя и «Перенести в…» на верхний уровень
  await list.getByRole('button', { name: 'Изменить Таргет', exact: true }).click();
  await expect(edit.getByLabel('Перенести в…').locator('option:checked')).toHaveText('Реклама');
  await edit.getByLabel('Название').fill('Таргетинг');
  await edit.getByLabel('Перенести в…').selectOption({ label: 'Верхний уровень' });
  await edit.getByRole('button', { name: 'Сохранить' }).click();
  await expect(edit).toBeHidden();
  await expect(list.getByRole('listitem')).toHaveText([/Реклама/, /Аренда/, /Таргетинг/]);

  // категория с дочерними: переносить некуда (Review Focus 2)
  await list.getByRole('button', { name: 'Добавить подкатегорию в Аренда' }).click();
  await sub.getByLabel('Название').fill('Зал');
  await sub.getByRole('button', { name: 'Сохранить' }).click();
  await expect(sub).toBeHidden();
  await list.getByRole('button', { name: 'Изменить Аренда', exact: true }).click();
  await expect(edit.getByLabel('Перенести в…')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(edit).toBeHidden();

  // поиск: найденная подкатегория — вместе с родителем
  const search = main.getByRole('searchbox', { name: 'Поиск' });
  await search.fill('ЗАЛ');
  await expect(list.getByRole('listitem')).toHaveText([/Аренда/, /Зал/]);
  await search.fill('');

  // порядок своих среди системных: системные остаются на своих местах (Review Focus 1)
  const topExpense = async () => ((await (await page.request.get(`/api/v1/companies/${cid}/categories`)).json()).expense as { name: string }[]).map((c) => c.name);
  const own = ['Реклама', 'Аренда', 'Таргетинг'];
  const before = await topExpense();
  await list.getByRole('button', { name: 'Переместить Таргетинг', exact: true }).focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(list.getByRole('listitem')).toHaveText([/Реклама/, /Таргетинг/, /Аренда/, /Зал/]);
  const order = ['Реклама', 'Таргетинг', 'Аренда'];
  await expect.poll(topExpense).toEqual(before.map((name) => (own.includes(name) ? order[own.indexOf(name)]! : name)));

  // системные: вместо ✎ — «банк» с подсказкой, «+» есть, «Добавить категорию» нет
  await kinds.getByRole('link', { name: 'Системные категории расхода' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/categories\\?tab=system-expense$`));
  const system = main.getByRole('list', { name: 'Системные категории расхода' });
  const salary = system.getByRole('listitem').filter({ hasText: 'Зарплата' });
  await expect(salary.getByRole('img', { name: 'Системная — не переименовывается и не удаляется' })).toBeVisible();
  await expect(salary.getByRole('button', { name: /^Изменить/ })).toHaveCount(0);
  await expect(main.getByRole('button', { name: 'Добавить категорию' })).toHaveCount(0);
  await salary.getByRole('button', { name: 'Добавить подкатегорию в Зарплата' }).click();
  await sub.getByLabel('Название').fill('Администраторы');
  await sub.getByRole('button', { name: 'Сохранить' }).click();
  await expect(sub).toBeHidden();
  await expect(system.getByRole('button', { name: 'Изменить Администраторы', exact: true })).toBeVisible();

  // неверная вкладка в адресе — «Мои категории расхода»
  await page.goto(`/c/${cid}/settings/categories?tab=nope`);
  await expect(kinds.getByRole('link', { name: 'Мои категории расхода' })).toHaveAttribute('aria-current', 'page');
});
```

Run: `npx playwright test e2e/dictionaries.spec.ts -g "категории"` → FAIL.

- [ ] **Step 4: `CategoriesSettings`**

Замените содержимое `src/client/pages/settings/CategoriesSettings.tsx` целиком:

```tsx
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useOutletContext, useSearchParams } from 'react-router';
import { ArchivedNote, EntityActions } from '../../components/EntityActions';
import { Field } from '../../components/Field';
import { BankIcon, PlusIcon } from '../../components/icons';
import { Modal } from '../../components/Modal';
import { Pending, StaleNotice } from '../../components/QueryState';
import { ReorderButtons } from '../../components/ReorderButtons';
import { SettingsList } from '../../components/SettingsList';
import { SettingsSubmenu } from '../../components/SettingsSubmenu';
import { alertClass, btnPrimary, btnSecondary, inputClass, noticeClass } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { CATEGORY_TABS, categoryReorderPlan, categoryRows, categoryTab, categoryTabInfo, parentOptions } from '../../lib/category-tabs';
import { planMove, planShift, type MovePlan } from '../../lib/category-moves';
import { queryClient } from '../../lib/query';
import { useCategories, type CategoryNode, type CategoryTree } from '../../lib/queries';
import { useEntityActions } from '../../lib/settings-mutations';
import type { CompanyOutletContext } from '../CompanyLayout';

const SYSTEM_HINT = 'Системная — не переименовывается и не удаляется';
const plusClass =
  'grid h-9 w-9 shrink-0 place-items-center rounded-full text-income-strong hover:bg-income-soft focus-visible:outline-2 focus-visible:outline-focus';

/** Окно категории: создание (на верхнем уровне или в родителе) или правка. */
type CategoryDialog = { mode: 'new'; parent: CategoryNode | null } | { mode: 'edit'; node: CategoryNode };

const dialogTitle = (d: CategoryDialog) => (d.mode === 'edit' ? 'Категория' : d.parent ? 'Новая подкатегория' : 'Новая категория');

/**
 * «Категории» (§7.2 этапа 1.5): подменю «Системные / Мои × дохода / расхода» (`?tab=`), справа — шаблон списка:
 * верхний уровень полужирно, подкатегории с отступом, «+» — подкатегория, ✎ — окно «Категория»; у системных
 * вместо ✎ — «банк». Порядок — за ☰ среди соседей уровня (системные соседи не сдвигаются).
 */
export function CategoriesSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const categories = useCategories(company.id);
  const [params] = useSearchParams();
  const tab = categoryTab(params.get('tab'));
  const info = categoryTabInfo(tab);
  const [dialog, setDialog] = useState<CategoryDialog | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const readOnly = company.archivedAt !== null;
  const reorder = useMutation<unknown, ApiError, MovePlan>({
    mutationFn: (plan) => api(`/companies/${company.id}/categories/reorder`, { method: 'POST', body: plan }),
    onMutate: () => setListError(null),
    onError: (e) => setListError(e.message),
    // и после ошибки (например, 409 «список изменился») — свежее дерево
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['categories', company.id] }),
  });

  if (!categories.data) return <Pending queries={[categories]} />;
  const tree = categories.data;

  return (
    <section>
      <StaleNotice queries={[categories]} />
      <h1 className="mb-4 text-2xl font-bold">Категории</h1>
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      {listError && (
        <p role="alert" className={alertClass}>
          {listError}
        </p>
      )}
      <div className="grid gap-6 md:grid-cols-[16rem_minmax(0,1fr)]">
        <SettingsSubmenu
          label="Виды категорий"
          param="tab"
          current={tab}
          items={CATEGORY_TABS.map((t) => ({ key: t.tab, label: t.label, icon: t.system ? ('bank' as const) : ('info' as const) }))}
        />
        <div className="min-w-0">
          <SettingsList
            key={tab}
            label={info.label}
            rows={categoryRows(tree, tab)}
            addLabel={readOnly || info.system ? null : 'Добавить категорию'}
            onAdd={() => setDialog({ mode: 'new', parent: null })}
            onReorder={
              readOnly
                ? undefined
                : (group) => {
                    const plan = categoryReorderPlan(tree, tab, group);
                    if (plan) reorder.mutate(plan);
                  }
            }
            onEdit={readOnly ? undefined : (row) => setDialog({ mode: 'edit', node: row.node })}
            canEdit={(row) => !row.system}
            strong={(row) => row.topLevel}
            actions={(row) => (
              <>
                {row.topLevel && !row.archived && !readOnly && (
                  <button
                    type="button"
                    aria-label={`Добавить подкатегорию в ${row.name}`}
                    title="Добавить подкатегорию"
                    onClick={() => setDialog({ mode: 'new', parent: row.node })}
                    className={plusClass}
                  >
                    <PlusIcon />
                  </button>
                )}
                {row.system && (
                  <span role="img" aria-label={SYSTEM_HINT} title={SYSTEM_HINT} className="grid h-9 w-9 shrink-0 place-items-center text-muted">
                    <BankIcon />
                  </span>
                )}
              </>
            )}
            empty={info.system ? 'Системных категорий этого вида нет.' : 'Своих категорий пока нет.'}
          />
        </div>
      </div>
      <Modal open={dialog !== null} title={dialog ? dialogTitle(dialog) : ''} onClose={() => setDialog(null)} className="max-w-lg">
        {dialog && (
          <CategoryEditor
            key={dialog.mode === 'edit' ? dialog.node.id : `new-${dialog.parent?.id ?? 'top'}`}
            companyId={company.id}
            kind={info.kind}
            tree={tree}
            dialog={dialog}
            onDone={() => setDialog(null)}
          />
        )}
      </Modal>
    </section>
  );
}

function CategoryEditor(props: { companyId: number; kind: 'income' | 'expense'; tree: CategoryTree; dialog: CategoryDialog; onDone: () => void }) {
  const { dialog, onDone } = props;
  const base = `/companies/${props.companyId}/categories`;
  const level = props.tree[props.kind];
  const editing = dialog.mode === 'edit' ? dialog.node : null;
  const parent = dialog.mode === 'new' ? dialog.parent : null;
  // свежий узел из дерева: после ↑ ↓ дерево перечитано
  const node = editing ? (level.flatMap((n) => [n, ...n.children]).find((n) => n.id === editing.id) ?? editing) : null;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['categories', props.companyId] });
  const [name, setName] = useState(node?.name ?? '');
  const [parentValue, setParentValue] = useState(node?.parentId == null ? 'top' : String(node.parentId));
  const options = node ? parentOptions(level, node) : [];
  const save = useMutation<void, ApiError>({
    mutationFn: async () => {
      if (!node) {
        await api(base, { method: 'POST', body: { kind: props.kind, name, parentId: parent?.id ?? null } });
        return;
      }
      if (name.trim() !== node.name) await api(`${base}/${node.id}`, { method: 'PATCH', body: { name } });
      const target = parentValue === 'top' ? null : Number(parentValue);
      if (target !== node.parentId) {
        const plan = planMove(level, node.id, { parentId: target, beforeId: null });
        if (typeof plan === 'string') throw new ApiError(400, 'VALIDATION', plan);
        await api(`${base}/reorder`, { method: 'POST', body: plan });
      }
    },
    onSuccess: async () => {
      await refresh();
      onDone();
    },
    // переименование могло пройти, а перенос — нет: дерево перечитываем в любом случае
    onError: () => void refresh(),
  });
  const shift = useMutation<unknown, ApiError, MovePlan>({
    mutationFn: (plan) => api(`${base}/reorder`, { method: 'POST', body: plan }),
    onSettled: () => refresh(),
  });
  const actions = useEntityActions(node ? `${base}/${node.id}` : base, refresh, onDone);
  const fields = save.error?.fields ?? {};
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const up = node ? planShift(level, node.id, -1) : null;
  const down = node ? planShift(level, node.id, 1) : null;

  return (
    <>
      {node?.archivedAt ? (
        <ArchivedNote />
      ) : (
        <form noValidate onSubmit={submit} className="grid gap-4">
          {parent && <p className="text-sm text-muted">Родитель: {parent.name}</p>}
          <Field label="Название" error={fields.name}>
            {(c) => <input {...c} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />}
          </Field>
          {node && (
            <Field label="Перенести в…" hint={options.length <= 1 ? 'Переносить некуда: у категории есть дочерние' : undefined}>
              {(c) => (
                <select {...c} value={parentValue} disabled={options.length <= 1} onChange={(e) => setParentValue(e.target.value)} className={inputClass}>
                  {options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          {node && (
            <div className="flex items-center gap-2 text-sm text-muted">
              <span>Порядок:</span>
              <ReorderButtons label={node.name} disabled={shift.isPending} onUp={up ? () => shift.mutate(up) : null} onDown={down ? () => shift.mutate(down) : null} />
            </div>
          )}
          {(save.error && !save.error.fields) || shift.error ? (
            <p role="alert" className={`${alertClass} mb-0`}>
              {save.error && !save.error.fields ? save.error.message : shift.error?.message}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={save.isPending || !name.trim()} className={btnPrimary}>
              Сохранить
            </button>
            <button type="button" onClick={onDone} className={btnSecondary}>
              Отмена
            </button>
          </div>
        </form>
      )}
      {node && (
        <EntityActions
          archived={node.archivedAt !== null}
          onArchiveToggle={() => actions.toggleArchive(node.archivedAt !== null)}
          what={`категорию «${node.name}»`}
          onDelete={actions.remove}
          pending={actions.pending}
          error={actions.error}
        />
      )}
    </>
  );
}
```

- [ ] **Step 5: Run the test**

Run: `npx playwright test e2e/dictionaries.spec.ts -g "категории"` → PASS.

- [ ] **Step 6: Full check and commit**

Run: `npm test` → PASS. Run: `npm run typecheck`. Run: `npm run test:e2e` дважды → все проходят оба раза.

```bash
git add src/client/lib/category-tabs.ts tests/client/category-tabs.test.ts src/client/pages/settings/CategoriesSettings.tsx e2e/dictionaries.spec.ts
git commit -m "feat: «Категории» — подменю «Системные / Мои», «+» подкатегория, окно «Категория» с «Перенести в…», поиск с родителем

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: «Проекты» и «Шаблоны разделения» — шаблон списка и окна

**Files:**
- Modify: `src/client/pages/settings/ProjectsTabs.tsx` (полная замена), `src/client/pages/settings/ProjectsSettings.tsx` (полная замена), `src/client/pages/settings/SplitPresetsSettings.tsx`, `src/client/components/ProjectForm.tsx`, `src/client/lib/order.ts`, `tests/client/order.test.ts`
- Test: `e2e/dictionaries.spec.ts`, `e2e/mobile.spec.ts`

**Interfaces:**
- Consumes: `SettingsList`, `EntityActions`, `ArchivedNote`, `useReorder`, `useEntityActions`, `mergeSubsetOrder` (план 1.5-4a).
- Produces: `ProjectsHeader({ companyId }: { companyId: number })` — `<h1>` «Проекты» и вкладки «Проекты | Шаблоны разделения» (`nav aria-label="Проекты и шаблоны"`); `ProjectForm` — прежние свойства, поля в порядке «Тип бизнеса», «Название проекта», параметры. `moveWithinGroup` удалён.

- [ ] **Step 1: Write the failing e2e tests**

В `e2e/dictionaries.spec.ts` тест «шаблон разделения: сохранить можно только при 100%» замените целиком на:

```ts
test('шаблоны разделения — вкладка «Проектов»: «Создать шаблон» в окне, сохранить можно только при 100%; ✎ и удаление', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Разделение ${Date.now()}`);
  for (const name of ['Клуб 1', 'Клуб 2']) await apiPost(page, `/api/v1/companies/${cid}/projects`, { name, templateKey: 'general' });
  await page.goto(`/c/${cid}/settings/projects`);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: 'Проекты' })).toBeVisible();
  const tabs = main.getByRole('navigation', { name: 'Проекты и шаблоны' });
  await tabs.getByRole('link', { name: 'Шаблоны разделения' }).click();
  await expect(page).toHaveURL(/\/settings\/projects\/split-presets$/);
  await expect(tabs.getByRole('link', { name: 'Шаблоны разделения' })).toHaveAttribute('aria-current', 'page');
  // заголовок раздела один и тот же, вкладка показывает, где вы (как в Finmap)
  await expect(main.getByRole('heading', { level: 1, name: 'Проекты' })).toBeVisible();

  await main.getByRole('button', { name: 'Создать шаблон' }).click();
  const dialog = page.getByRole('dialog', { name: 'Новый шаблон' });
  await dialog.getByLabel('Название шаблона').fill('Аренда пополам');
  await dialog.getByLabel('Проект, строка 1').selectOption({ label: 'Клуб 1' });
  await dialog.getByLabel('Доля %, строка 1').fill('50');
  await dialog.getByLabel('Проект, строка 2').selectOption({ label: 'Клуб 2' });
  await dialog.getByLabel('Доля %, строка 2').fill('40');
  await expect(dialog.getByRole('status').filter({ hasText: 'Распределено' })).toHaveText('Распределено 90% из 100% · осталось 10%');
  await expect(dialog.getByRole('button', { name: 'Сохранить шаблон' })).toBeDisabled();
  await dialog.getByLabel('Доля %, строка 2').fill('50');
  await dialog.getByRole('button', { name: 'Сохранить шаблон' }).click();
  await expect(dialog).toBeHidden();

  const row = main.getByRole('listitem').filter({ hasText: 'Аренда пополам' });
  await expect(row).toContainText('Клуб 1 — 50%');
  await expect(row).toContainText('Клуб 2 — 50%');

  // ✎ — окно «Шаблон разделения» с долями; «Удалить» через подтверждение
  await row.getByRole('button', { name: 'Изменить Аренда пополам', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Шаблон разделения', exact: true });
  await expect(edit.getByLabel('Доля %, строка 2')).toHaveValue('50');
  await edit.getByRole('button', { name: 'Удалить', exact: true }).click();
  await page.getByRole('alertdialog', { name: 'Удалить шаблон «Аренда пополам»?' }).getByRole('button', { name: 'Удалить' }).click();
  await expect(edit).toBeHidden();
  await expect(main.getByRole('listitem').filter({ hasText: 'Аренда пополам' })).toHaveCount(0);
});
```

В тесте «переименование проекта переименовывает его счета; Alt+↓ меняет порядок счетов» строки от `  await page.goto(\`/c/${cid}/settings/projects\`);` до `  await expect(page.getByRole('status')).toHaveText('Переименовано счетов: 2');` включительно:

```ts
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
```

замените на:

```ts
  await page.goto(`/c/${cid}/settings/projects`);
  await page.getByRole('button', { name: 'Добавить проект' }).click();
  const created = page.getByRole('dialog', { name: 'Новый проект' });
  // окно проекта: сначала шаблон (на нём начальный фокус), затем название и параметры (§7.4)
  await expect(created.getByLabel('Тип бизнеса')).toBeFocused();
  await created.getByLabel('Тип бизнеса').selectOption('computer-club');
  await expect(created.locator('label')).toHaveText(['Тип бизнеса', 'Название проекта', 'Количество ПК', 'Количество консолей']);
  await created.getByLabel('Название проекта').fill('Клуб А');
  await created.getByLabel('Количество ПК').fill('1e3');
  await created.getByRole('button', { name: 'Создать проект' }).click();
  await expect(created.getByText('Введите целое число')).toBeVisible();
  await created.getByLabel('Количество ПК').fill('10');
  await created.getByRole('button', { name: 'Создать проект' }).click();
  await expect(created).toBeHidden();

  await page.getByRole('button', { name: 'Изменить Клуб А', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Проект', exact: true });
  await edit.getByLabel('Название проекта').fill('Клуб Б');
  await expect(edit.getByLabel('Переименовать счета')).toBeChecked();
  await edit.getByRole('button', { name: 'Сохранить' }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByRole('main').getByRole('status')).toHaveText('Переименовано счетов: 2');
```

В тесте «зона настроек: …» строку

```ts
  await expect(page.getByRole('heading', { level: 1, name: 'Шаблоны разделения' })).toBeVisible();
```

замените на:

```ts
  await expect(page.getByRole('heading', { level: 1, name: 'Проекты' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Проекты и шаблоны' }).getByRole('link', { name: 'Шаблоны разделения' })).toHaveAttribute('aria-current', 'page');
```

В `e2e/mobile.spec.ts` в тесте «ширина 390 px: …» строку

```ts
  await page.getByRole('button', { name: 'Изменить', exact: true }).click();
```

замените на (правка шаблона — окно на телефоне):

```ts
  await page.getByRole('button', { name: 'Изменить Аренда целиком', exact: true }).click();
```

Run: `npx playwright test e2e/dictionaries.spec.ts -g "шаблоны разделения|переименование проекта"` → FAIL.

- [ ] **Step 2: `ProjectsHeader`**

Замените содержимое `src/client/pages/settings/ProjectsTabs.tsx` целиком:

```tsx
import { NavLink } from 'react-router';

const tab = ({ isActive }: { isActive: boolean }) =>
  `-mb-px border-b-2 px-1 pb-2 text-sm font-semibold ${isActive ? 'border-income-strong text-income-strong' : 'border-transparent text-muted hover:text-ink'}`;

/**
 * Шапка раздела «Проекты» (§4.2, §7.4 этапа 1.5): заголовок «Проекты» и вкладки с подчёркиванием «Проекты | Шаблоны
 * разделения» — как в Finmap, заголовок один на обеих вкладках, текущая вкладка — `aria-current="page"`.
 */
export function ProjectsHeader({ companyId }: { companyId: number }) {
  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">Проекты</h1>
      <nav aria-label="Проекты и шаблоны" className="mb-6 flex gap-6 border-b border-field">
        <NavLink end to={`/c/${companyId}/settings/projects`} className={tab}>
          Проекты
        </NavLink>
        <NavLink to={`/c/${companyId}/settings/projects/split-presets`} className={tab}>
          Шаблоны разделения
        </NavLink>
      </nav>
    </>
  );
}
```

- [ ] **Step 3: `ProjectForm` — template first, one column**

В `src/client/components/ProjectForm.tsx` замените блок от `    <form onSubmit={onSubmit} noValidate className="space-y-4 rounded-2xl bg-canvas p-4">` до закрывающего `      </Field>` поля «Тип бизнеса» включительно:

```tsx
    <form onSubmit={onSubmit} noValidate className="space-y-4 rounded-2xl bg-canvas p-4">
      <Field label="Название проекта" error={fields.name}>
        {(c) => <input {...c} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Клуб на Ленина" className={inputClass} />}
      </Field>
      <Field label="Тип бизнеса" error={fields.templateKey}>
        {(c) => (
          <select
            {...c}
            value={templateKey}
            disabled={props.mode === 'edit'}
            onChange={(e) => {
              setTemplateKey(e.target.value);
              setInputs({});
              setClientFields({});
            }}
            className={inputClass}
          >
            {props.templates.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            ))}
          </select>
        )}
      </Field>
```

на (окно ставит фокус на первое поле — «Тип бизнеса»; в окне правки он недоступен, и фокус встаёт на название):

```tsx
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <Field label="Тип бизнеса" error={fields.templateKey}>
        {(c) => (
          <select
            {...c}
            value={templateKey}
            disabled={props.mode === 'edit'}
            onChange={(e) => {
              setTemplateKey(e.target.value);
              setInputs({});
              setClientFields({});
            }}
            className={inputClass}
          >
            {props.templates.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Название проекта" error={fields.name}>
        {(c) => <input {...c} value={name} onChange={(e) => setName(e.target.value)} placeholder="Клуб на Ленина" className={inputClass} />}
      </Field>
```

В том же файле строку `        <p role="alert" className="rounded-xl bg-expense-soft px-4 py-3 text-sm text-expense-strong">` оставьте как есть (её заменил скрипт плана 1.5-4a), а строку `      <div className="flex gap-2">` над кнопками замените на `      <div className="flex flex-wrap gap-2">`.

- [ ] **Step 4: `ProjectsSettings`**

Замените содержимое `src/client/pages/settings/ProjectsSettings.tsx` целиком:

```tsx
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { ArchivedNote, EntityActions } from '../../components/EntityActions';
import { Modal } from '../../components/Modal';
import { ProjectForm, type ProjectFormValues } from '../../components/ProjectForm';
import { Pending, StaleNotice } from '../../components/QueryState';
import { SettingsList } from '../../components/SettingsList';
import { alertClass, noticeClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { mergeSubsetOrder } from '../../lib/order';
import { queryClient } from '../../lib/query';
import { useProjects, useTemplates, type Project, type TemplateInfo } from '../../lib/queries';
import { useEntityActions, useReorder } from '../../lib/settings-mutations';
import type { CompanyOutletContext } from '../CompanyLayout';
import { ProjectsHeader } from './ProjectsTabs';

/** Серый текст строки: тип бизнеса и параметры шаблона. */
function projectSummary(p: Project, t: TemplateInfo | undefined): string {
  const params = (t?.paramsUi ?? []).map((u) => `${u.label}: ${String(p.templateParams[u.key] ?? '—')}`).join(', ');
  return [t?.name ?? p.templateKey, params].filter((s) => s !== '').join(' · ');
}

/** «Проекты» на шаблоне списка (§7.4 этапа 1.5): «Добавить проект» и ✎ — окно проекта (шаблон, затем параметры). */
export function ProjectsSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const projects = useProjects(company.id);
  const templates = useTemplates();
  const [editing, setEditing] = useState<Project | 'new' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const readOnly = company.archivedAt !== null;
  const reorder = useReorder<Project>(['projects', company.id], `/companies/${company.id}/projects/reorder`, setListError);

  if (!projects.data || !templates.data) return <Pending queries={[projects, templates]} />;
  const list = projects.data;
  const templateList = templates.data;
  const open = (next: Project | 'new') => {
    setNotice(null);
    setEditing(next);
  };

  return (
    <section>
      <ProjectsHeader companyId={company.id} />
      <StaleNotice queries={[projects, templates]} />
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      {notice && (
        <p role="status" className={noticeClass}>
          {notice}
        </p>
      )}
      {listError && (
        <p role="alert" className={alertClass}>
          {listError}
        </p>
      )}
      <SettingsList
        label="Проекты"
        rows={list.map((p) => ({
          id: p.id,
          name: p.name,
          secondary: projectSummary(
            p,
            templateList.find((t) => t.key === p.templateKey),
          ),
          archived: p.archivedAt !== null,
        }))}
        addLabel={readOnly ? null : 'Добавить проект'}
        onAdd={() => open('new')}
        onReorder={
          readOnly
            ? undefined
            : (group) =>
                reorder.mutate(
                  mergeSubsetOrder(
                    list.map((p) => p.id),
                    group,
                  ),
                )
        }
        onEdit={
          readOnly
            ? undefined
            : (row) => {
                const project = list.find((p) => p.id === row.id);
                if (project) open(project);
              }
        }
        empty="Проектов пока нет. Проект — это клуб, магазин или офис внутри компании."
      />
      <Modal open={editing !== null} title={editing === 'new' ? 'Новый проект' : 'Проект'} onClose={() => setEditing(null)} className="max-w-lg">
        {editing !== null && (
          <ProjectEditor
            key={editing === 'new' ? 'new' : editing.id}
            companyId={company.id}
            templates={templateList}
            project={editing === 'new' ? null : editing}
            onRenamed={(count) => setNotice(`Переименовано счетов: ${count}`)}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
    </section>
  );
}

function ProjectEditor(props: { companyId: number; templates: TemplateInfo[]; project: Project | null; onRenamed: (count: number) => void; onDone: () => void }) {
  const { project, onDone } = props;
  const base = `/companies/${props.companyId}/projects`;
  // шаблон создаёт счета и категории проекта
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['projects', props.companyId] }),
      queryClient.invalidateQueries({ queryKey: ['accounts', props.companyId] }),
      queryClient.invalidateQueries({ queryKey: ['categories', props.companyId] }),
    ]);
  const create = useMutation<unknown, ApiError, ProjectFormValues>({
    mutationFn: (v) => api(base, { method: 'POST', body: { name: v.name, templateKey: v.templateKey, templateParams: v.templateParams } }),
    onSuccess: async () => {
      await refresh();
      onDone();
    },
  });
  const update = useMutation<{ renamedAccounts: number }, ApiError, ProjectFormValues>({
    mutationFn: (v) =>
      api(`${base}/${project!.id}`, {
        method: 'PATCH',
        body: { name: v.name, templateParams: v.templateParams, ...(v.renameAccounts !== undefined ? { renameAccounts: v.renameAccounts } : {}) },
      }),
    onSuccess: async (res) => {
      await refresh();
      if (res.renamedAccounts > 0) props.onRenamed(res.renamedAccounts);
      onDone();
    },
  });
  const actions = useEntityActions(project ? `${base}/${project.id}` : base, refresh, onDone);
  const error = project ? update.error : create.error;

  return (
    <>
      {project?.archivedAt ? (
        <ArchivedNote />
      ) : (
        <ProjectForm
          templates={props.templates}
          mode={project ? 'edit' : 'create'}
          initial={project ? { name: project.name, templateKey: project.templateKey, templateParams: project.templateParams } : undefined}
          pending={create.isPending || update.isPending}
          serverFields={error?.fields}
          serverError={error && !error.fields ? error.message : undefined}
          onSubmit={(v) => (project ? update.mutate(v) : create.mutate(v))}
          onCancel={onDone}
        />
      )}
      {project && (
        <EntityActions
          archived={project.archivedAt !== null}
          onArchiveToggle={() => actions.toggleArchive(project.archivedAt !== null)}
          what={`проект «${project.name}»`}
          onDelete={actions.remove}
          pending={actions.pending}
          error={actions.error}
        />
      )}
    </>
  );
}
```

- [ ] **Step 5: `SplitPresetsSettings`**

В `src/client/pages/settings/SplitPresetsSettings.tsx`:
- блок импортов (строки 1–14) замените на:

```tsx
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useOutletContext } from 'react-router';
import { formatBp, parsePercentToBp } from '../../../shared/percent';
import { SPLIT_TOTAL_BP } from '../../../shared/schemas/split-presets';
import { ArchivedNote, EntityActions } from '../../components/EntityActions';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { Pending, StaleNotice } from '../../components/QueryState';
import { SettingsList } from '../../components/SettingsList';
import { alertClass, btnIcon, btnPrimary, btnSecondary, btnSmall, inputClass, noticeClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { mergeSubsetOrder } from '../../lib/order';
import { queryClient } from '../../lib/query';
import { useCategories, useProjects, useSplitPresets, type CategoryNode, type CategoryTree, type Project, type SplitLine, type SplitPreset } from '../../lib/queries';
import { useEntityActions, useReorder } from '../../lib/settings-mutations';
import type { CompanyOutletContext } from '../CompanyLayout';
import { ProjectsHeader } from './ProjectsTabs';
```

- в `PresetForm` строку `    <form onSubmit={submit} noValidate className="space-y-4 rounded-2xl bg-canvas p-4">` замените на `    <form onSubmit={submit} noValidate className="space-y-4">` (форма теперь в окне);
- в `PresetForm` строку `      <div className="flex gap-2">` над кнопками «Сохранить шаблон» / «Отмена» замените на `      <div className="flex flex-wrap gap-2">`;
- строку `type Action = { path: string; method: 'POST' | 'DELETE' };` удалите;
- функцию `SplitPresetsSettings` (от `export function SplitPresetsSettings() {` до конца файла) замените на:

```tsx
/**
 * «Шаблоны разделения» — вкладка раздела «Проекты» (§7.4 этапа 1.5): шаблон списка, «Создать шаблон» и ✎ —
 * окно редактора; серый текст строки — доли шаблона.
 */
export function SplitPresetsSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const presets = useSplitPresets(company.id);
  const categories = useCategories(company.id);
  const projects = useProjects(company.id);
  const [editing, setEditing] = useState<SplitPreset | 'new' | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const readOnly = company.archivedAt !== null;
  const reorder = useReorder<SplitPreset>(['split-presets', company.id], `/companies/${company.id}/split-presets/reorder`, setListError);

  if (!presets.data || !categories.data || !projects.data) return <Pending queries={[presets, categories, projects]} />;
  const list = presets.data;
  const tree = categories.data;
  const projectList = projects.data;
  const categoryLabel = new Map([...flatten(tree.income), ...flatten(tree.expense)].map((o) => [o.id, o.label]));
  const projectName = new Map(projectList.map((p) => [p.id, p.name]));
  const summary = (p: SplitPreset) =>
    p.lines
      .map((l) => {
        const parts = [
          l.categoryId === null ? null : (categoryLabel.get(l.categoryId) ?? '(удалено)'),
          l.projectId === null ? null : (projectName.get(l.projectId) ?? '(удалено)'),
        ].filter(Boolean);
        return `${parts.join(' · ')} — ${formatBp(l.bp)}%`;
      })
      .join('; ');

  return (
    <section>
      <ProjectsHeader companyId={company.id} />
      <StaleNotice queries={[presets, categories, projects]} />
      <p className="mb-4 text-sm text-muted">Шаблон делит сумму операции между категориями и проектами в заданных долях; сумма долей — ровно 100%.</p>
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      {listError && (
        <p role="alert" className={alertClass}>
          {listError}
        </p>
      )}
      <SettingsList
        label="Шаблоны разделения"
        rows={list.map((p) => ({ id: p.id, name: p.name, secondary: summary(p), archived: p.archivedAt !== null }))}
        addLabel={readOnly ? null : 'Создать шаблон'}
        onAdd={() => setEditing('new')}
        onReorder={
          readOnly
            ? undefined
            : (group) =>
                reorder.mutate(
                  mergeSubsetOrder(
                    list.map((p) => p.id),
                    group,
                  ),
                )
        }
        onEdit={readOnly ? undefined : (row) => setEditing(list.find((p) => p.id === row.id) ?? null)}
        empty="Шаблонов пока нет."
      />
      <Modal open={editing !== null} title={editing === 'new' ? 'Новый шаблон' : 'Шаблон разделения'} onClose={() => setEditing(null)} className="max-w-2xl">
        {editing !== null && (
          <PresetEditor
            key={editing === 'new' ? 'new' : editing.id}
            companyId={company.id}
            preset={editing === 'new' ? null : editing}
            tree={tree}
            projects={projectList}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
    </section>
  );
}

function PresetEditor(props: { companyId: number; preset: SplitPreset | null; tree: CategoryTree; projects: Project[]; onDone: () => void }) {
  const { preset, onDone } = props;
  const base = `/companies/${props.companyId}/split-presets`;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['split-presets', props.companyId] });
  const save = useMutation<unknown, ApiError, { name: string; lines: SplitLine[] }>({
    mutationFn: (body) => (preset ? api(`${base}/${preset.id}`, { method: 'PATCH', body }) : api(base, { method: 'POST', body })),
    onSuccess: async () => {
      await refresh();
      onDone();
    },
  });
  const actions = useEntityActions(preset ? `${base}/${preset.id}` : base, refresh, onDone);

  return (
    <>
      {preset?.archivedAt ? (
        <ArchivedNote />
      ) : (
        <PresetForm
          initial={preset ? toDraft(preset, props.tree) : { name: '', kind: 'expense', lines: [emptyLine(), emptyLine()] }}
          tree={props.tree}
          projects={props.projects}
          submitLabel="Сохранить шаблон"
          pending={save.isPending}
          serverFields={save.error?.fields}
          serverError={save.error && !save.error.fields ? save.error.message : undefined}
          onSubmit={(body) => save.mutate(body)}
          onCancel={onDone}
        />
      )}
      {preset && (
        <EntityActions
          archived={preset.archivedAt !== null}
          onArchiveToggle={() => actions.toggleArchive(preset.archivedAt !== null)}
          what={`шаблон «${preset.name}»`}
          onDelete={actions.remove}
          pending={actions.pending}
          error={actions.error}
        />
      )}
    </>
  );
}
```

- [ ] **Step 6: Remove `moveWithinGroup`**

Последним пользователем был старый раздел «Проекты». В `src/client/lib/order.ts` удалите функцию `moveWithinGroup` вместе с её комментарием. В `tests/client/order.test.ts` импорт замените на `import { mergeSubsetOrder, sortByIds } from '../../src/client/lib/order';` и удалите блок `describe('moveWithinGroup', …)` целиком (поведение удалено вместе с функцией).

Run: `grep -rn "moveWithinGroup\|ProjectsTabs\b" src tests` → только имя файла `ProjectsTabs.tsx` в путях импорта `./ProjectsTabs`, `moveWithinGroup` — нигде.

- [ ] **Step 7: Run the tests**

Run: `npx playwright test e2e/dictionaries.spec.ts e2e/companies.spec.ts e2e/mobile.spec.ts` → PASS.

- [ ] **Step 8: Full check and commit**

Run: `npm test` → PASS. Run: `npm run typecheck`. Run: `npm run test:e2e` дважды → все проходят оба раза.

```bash
git add src/client/pages/settings/ProjectsTabs.tsx src/client/pages/settings/ProjectsSettings.tsx src/client/pages/settings/SplitPresetsSettings.tsx src/client/components/ProjectForm.tsx src/client/lib/order.ts tests/client/order.test.ts e2e/dictionaries.spec.ts e2e/mobile.spec.ts
git commit -m "feat: «Проекты» и «Шаблоны разделения» — заголовок и вкладки как в Finmap, шаблон списка, окна проекта и шаблона

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: «Мои компании» — карточки и «В архив» в окне «Компания»

**Files:**
- Modify: `src/client/components/CompanyEditDialog.tsx` (полная замена), `src/client/components/CompaniesDrawer.tsx`, `src/client/pages/settings/CompaniesSettings.tsx` (полная замена)
- Test: `e2e/companies.spec.ts`, `e2e/money.spec.ts`

**Interfaces:**
- Consumes: `EntityActions`, `useEntityActions` (план 1.5-4a); `useCompanies`, `useCompaniesSummary`; `companyInitials`.
- Produces: `CompanyEditDialog({ company, currentId, onClose }: { company: Company | null; currentId: number; onClose: () => void })`; `CompanyAvatar({ name, className }: { name: string; className: string })` — экспорт из `CompaniesDrawer.tsx`.

- [ ] **Step 1: Write the failing e2e tests**

В `e2e/companies.spec.ts` в тесте «проекты по шаблонам: клуб и общий» замените конец теста от строки `  // переименование компании на экране «Компании»` до закрывающей `});`:

```ts
  // переименование компании на экране «Мои компании»: карточка только для чтения, ✎ — окно «Компания»
  await page.getByRole('navigation', { name: 'Разделы настроек' }).getByRole('link', { name: 'Мои компании' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/companies$`));
  const renamed = `ТОО Клубы переим ${Date.now()}`;
  await page.getByRole('button', { name: `Изменить компанию «${companyName}»` }).click();
  const dialog = page.getByRole('dialog', { name: 'Компания', exact: true });
  await dialog.getByLabel('Название компании').fill(renamed);
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('main').getByRole('listitem').filter({ hasText: renamed })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сменить компанию' })).toContainText(renamed);
});
```

и добавьте в конец файла:

```ts
test('«Мои компании»: карточки с балансом и валютой; ✎ — «В архив» и «Вернуть из архива»; архив открытой уводит к другой', async ({ page }) => {
  await login(page);
  const stamp = Date.now();
  const keep = `ТОО Остаётся ${stamp}`;
  const gone = `ТОО Уходит ${stamp}`;
  const keepId = await createCompany(page, keep);
  const goneId = await createCompany(page, gone);
  const headers = { origin: new URL(page.url()).origin, 'x-requested-with': 'fetch' };
  const res = await page.request.post(`/api/v1/companies/${keepId}/accounts`, {
    data: { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 1026481000 },
    headers,
  });
  expect(res.status()).toBe(201);

  await page.goto(`/c/${keepId}/settings/companies`);
  const main = page.getByRole('main');
  await expect(main.getByRole('link', { name: 'Добавить компанию' })).toHaveAttribute('href', '/companies/new');
  const active = main.getByRole('list', { name: 'Компании', exact: true });
  const card = active.getByRole('listitem').filter({ hasText: keep });
  await expect(card).toContainText(/Баланс на счетах\s*₸\s10\s264\s810/);
  await expect(card).toContainText('KZT');

  // ✎ другой компании → «В архив»: карточка уходит в блок «В архиве»
  const dialog = page.getByRole('dialog', { name: 'Компания', exact: true });
  await active.getByRole('button', { name: `Изменить компанию «${gone}»` }).click();
  await dialog.getByRole('button', { name: 'В архив' }).click();
  await expect(dialog).toBeHidden();
  const archived = main.getByRole('list', { name: 'Компании в архиве' });
  await expect(archived.getByRole('listitem').filter({ hasText: gone })).toBeVisible();
  // архивная: поля только для чтения, «Вернуть из архива»
  await archived.getByRole('button', { name: `Изменить компанию «${gone}»` }).click();
  await expect(dialog.getByLabel('Название компании')).toBeDisabled();
  await dialog.getByRole('button', { name: 'Вернуть из архива' }).click();
  await expect(dialog).toBeHidden();
  await expect(active.getByRole('listitem').filter({ hasText: gone })).toBeVisible();

  // архив открытой компании из панели «Компании» — переход к первой активной (Review Focus 5)
  await page.goto(`/c/${goneId}/log`);
  await page.getByRole('banner').getByRole('button', { name: /Сменить компанию/ }).click();
  await page.getByRole('dialog', { name: 'Компании' }).getByRole('button', { name: `Изменить компанию «${gone}»` }).click();
  await dialog.getByRole('button', { name: 'В архив' }).click();
  await expect(page).toHaveURL(/\/c\/\d+\/log$/);
  await expect(page).not.toHaveURL(new RegExp(`/c/${goneId}/`));
});
```

В `e2e/money.spec.ts` в тесте «валюта счёта с операциями и базовая валюта компании с операциями заблокированы» замените конец теста

```ts
  await page.goto(`/c/${cid}/settings/companies`);
  const locked = page.getByRole('listitem').filter({ has: page.locator(`input[value="${name}"]`) });
  await expect(locked.getByLabel('Базовая валюта')).toBeDisabled();
  await expect(locked).toContainText('В компании есть операции или фиксированные курсы — базовую валюту изменить нельзя');
  const free = page.getByRole('listitem').filter({ has: page.locator(`input[value="${freeName}"]`) });
  await expect(free.getByLabel('Базовая валюта')).toBeEnabled();
});
```

на:

```ts
  await page.goto(`/c/${cid}/settings/companies`);
  const company = page.getByRole('dialog', { name: 'Компания', exact: true });
  await page.getByRole('button', { name: `Изменить компанию «${name}»` }).click();
  await expect(company.getByLabel('Базовая валюта')).toBeDisabled();
  await expect(company).toContainText('В компании есть операции или фиксированные курсы — базовую валюту изменить нельзя');
  await company.getByRole('button', { name: 'Отмена' }).click();
  await expect(company).toBeHidden();
  await page.getByRole('button', { name: `Изменить компанию «${freeName}»` }).click();
  await expect(company.getByLabel('Базовая валюта')).toBeEnabled();
  await company.getByRole('button', { name: 'Отмена' }).click();
});
```

В тесте «смена базовой валюты обновляет итог в левой панели» строки

```ts
  await page.goto(`/c/${cid}/settings/companies`);
  const row = page.getByRole('listitem').filter({ has: page.locator(`input[value="${name}"]`) });
  await row.getByLabel('Базовая валюта').selectOption('USD');
  await row.getByRole('button', { name: 'Сохранить' }).click();
  await expect(row.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
```

замените на:

```ts
  await page.goto(`/c/${cid}/settings/companies`);
  const card = page.getByRole('main').getByRole('listitem').filter({ hasText: name });
  await card.getByRole('button', { name: `Изменить компанию «${name}»` }).click();
  const dialog = page.getByRole('dialog', { name: 'Компания', exact: true });
  await dialog.getByLabel('Базовая валюта').selectOption('USD');
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(dialog).toBeHidden();
  await expect(card).toContainText('USD');
```

Run: `npx playwright test e2e/companies.spec.ts e2e/money.spec.ts` → FAIL.

- [ ] **Step 2: `CompanyAvatar` export and `currentId` in the drawer**

В `src/client/components/CompaniesDrawer.tsx`:
- строку `function Avatar({ name, className }: { name: string; className: string }) {` замените на `export function CompanyAvatar({ name, className }: { name: string; className: string }) {`;
- оба вхождения `<Avatar ` замените на `<CompanyAvatar ` (в `CompanyBlockButton` и в `CompaniesList`);
- строку `      <CompanyEditDialog company={editing} onClose={() => setEditing(null)} />` замените на `      <CompanyEditDialog company={editing} currentId={props.current.id} onClose={() => setEditing(null)} />`;
- в строке `          }} ` (после `onClick` ссылки «Добавить компанию») уберите пробел в конце (итоги 1.5-1b №4).

- [ ] **Step 3: `CompanyEditDialog` with archive**

Замените содержимое `src/client/components/CompanyEditDialog.tsx` целиком:

```tsx
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { CURRENCIES } from '../../shared/currencies';
import { api, type ApiError } from '../lib/api';
import { queryClient } from '../lib/query';
import type { Company } from '../lib/queries';
import { useEntityActions } from '../lib/settings-mutations';
import { EntityActions } from './EntityActions';
import { Field } from './Field';
import { Modal } from './Modal';
import { alertClass, btnPrimary, btnSecondary, inputClass } from './ui';

/**
 * Окно «Компания» (✎ в панели «Компании» и на странице «Мои компании», §3.2, §7.4 этапа 1.5): название и базовая
 * валюта, ниже «В архив» / «Вернуть из архива» (решение 9 плана 1.5-1; компании не удаляются). Архивная — только
 * для чтения. Архив открытой компании (currentId) уводит на стартовый экран — он откроет первую активную.
 * Открыто, пока задана company.
 */
export function CompanyEditDialog({ company, currentId, onClose }: { company: Company | null; currentId: number; onClose: () => void }) {
  return (
    <Modal open={company !== null} title="Компания" onClose={onClose} className="max-w-md">
      {company && <CompanyEditForm key={company.id} company={company} currentId={currentId} onDone={onClose} />}
    </Modal>
  );
}

function CompanyEditForm({ company, currentId, onDone }: { company: Company; currentId: number; onDone: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState(company.name);
  const [baseCurrency, setBaseCurrency] = useState(company.baseCurrency);
  const readOnly = company.archivedAt !== null;
  // ['companies'] обновляет и итоги компаний (['companies', 'summary']); валюта меняет итог в левой панели
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['companies'] }),
      queryClient.invalidateQueries({ queryKey: ['accounts', company.id, 'balances'] }),
    ]);
  // только изменённые поля: смена валюты может быть запрещена (есть операции), переименование — нет
  const changes = {
    ...(name.trim() !== company.name ? { name: name.trim() } : {}),
    ...(baseCurrency !== company.baseCurrency ? { baseCurrency } : {}),
  };
  const save = useMutation<unknown, ApiError>({
    mutationFn: () => api(`/companies/${company.id}`, { method: 'PATCH', body: changes }),
    onSuccess: async () => {
      await refresh();
      onDone();
    },
  });
  const actions = useEntityActions(`/companies/${company.id}`, refresh, () => {
    onDone();
    if (!readOnly && company.id === currentId) navigate('/', { replace: true });
  });
  const fields = save.error?.fields ?? {};

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (Object.keys(changes).length === 0) return onDone();
    save.mutate();
  };

  return (
    <>
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
      <EntityActions
        archived={readOnly}
        onArchiveToggle={() => actions.toggleArchive(readOnly)}
        what={`компанию «${company.name}»`}
        pending={actions.pending}
        error={actions.error}
      />
    </>
  );
}
```

- [ ] **Step 4: `CompaniesSettings` — read-only cards**

Замените содержимое `src/client/pages/settings/CompaniesSettings.tsx` целиком:

```tsx
import { useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import { formatMoney, MONEY_SCREEN_BEFORE } from '../../../shared/money';
import { CompanyAvatar } from '../../components/CompaniesDrawer';
import { CompanyEditDialog } from '../../components/CompanyEditDialog';
import { PencilIcon } from '../../components/icons';
import { Pending, StaleNotice } from '../../components/QueryState';
import { btnPrimary } from '../../components/ui';
import { useCompanies, useCompaniesSummary, type Company, type CompanyTotal } from '../../lib/queries';
import type { CompanyOutletContext } from '../CompanyLayout';

/**
 * «Мои компании» (§7.4 этапа 1.5): «Добавить компанию» слева вверху; карточки только для чтения — аватар, название,
 * «Баланс на счетах», базовая валюта и ✎ (окно «Компания» с «В архив» / «Вернуть из архива»). Архивные — ниже.
 */
export function CompaniesSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const companies = useCompanies();
  const summary = useCompaniesSummary(true);
  const [editing, setEditing] = useState<Company | null>(null);

  if (!companies.data) return <Pending queries={[companies]} />;
  const totals = new Map((summary.data ?? []).map((s) => [s.id, s.total]));
  const active = companies.data.filter((c) => !c.archivedAt);
  const archived = companies.data.filter((c) => c.archivedAt);
  const card = (c: Company) => <CompanyCard key={c.id} company={c} total={totals.get(c.id)} onEdit={() => setEditing(c)} />;

  return (
    <section>
      <StaleNotice queries={[companies]} />
      <h1 className="mb-4 text-2xl font-bold">Мои компании</h1>
      <Link to="/companies/new" className={`${btnPrimary} mb-6 inline-block`}>
        Добавить компанию
      </Link>
      <ul aria-label="Компании" className="grid gap-3">
        {active.map(card)}
      </ul>
      {archived.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 text-lg font-semibold">В архиве</h2>
          <ul aria-label="Компании в архиве" className="grid gap-3">
            {archived.map(card)}
          </ul>
        </>
      )}
      <CompanyEditDialog company={editing} currentId={company.id} onClose={() => setEditing(null)} />
    </section>
  );
}

function CompanyCard({ company, total, onEdit }: { company: Company; total: CompanyTotal | undefined; onEdit: () => void }) {
  return (
    <li className={`flex flex-wrap items-center gap-4 rounded-2xl bg-field/60 px-5 py-4 ${company.archivedAt ? 'opacity-70' : ''}`}>
      <CompanyAvatar name={company.name} className="grid h-10 w-10 text-sm" />
      <dl className="grid min-w-0 flex-1 gap-x-8 gap-y-2 sm:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-xs text-muted">Компания</dt>
          <dd className="truncate font-semibold">{company.name}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Баланс на счетах</dt>
          <dd className="font-semibold tabular-nums">
            {total ? formatMoney(total.amount, total.currency, MONEY_SCREEN_BEFORE) : '—'}
            {total && total.unavailable.length > 0 && <span className="ml-1 text-xs font-normal text-muted">без {total.unavailable.join(', ')}</span>}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Базовая валюта</dt>
          <dd className="font-semibold">{company.baseCurrency}</dd>
        </div>
      </dl>
      <button
        type="button"
        aria-label={`Изменить компанию «${company.name}»`}
        title="Изменить"
        onClick={onEdit}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-card hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
      >
        <PencilIcon />
      </button>
    </li>
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `npx playwright test e2e/companies.spec.ts e2e/money.spec.ts e2e/service-screens.spec.ts` → PASS.

- [ ] **Step 6: Full check and commit**

Run: `npm test` → PASS. Run: `npm run typecheck`. Run: `npm run test:e2e` дважды → все проходят оба раза.

```bash
git add src/client/components/CompanyEditDialog.tsx src/client/components/CompaniesDrawer.tsx src/client/pages/settings/CompaniesSettings.tsx e2e/companies.spec.ts e2e/money.spec.ts
git commit -m "feat: «Мои компании» — карточки с балансом и валютой, архивные ниже; «В архив» и «Вернуть из архива» в окне «Компания»

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: «Пользователи» и «Профиль»

**Files:**
- Create: `src/client/lib/profile.ts`, `tests/client/profile.test.ts`
- Modify: `src/client/pages/settings/UsersSettings.tsx` (полная замена), `src/client/pages/settings/ProfileSettings.tsx` (полная замена), `src/client/components/icons.tsx`
- Test: `e2e/service-screens.spec.ts`

**Interfaces:**
- Consumes: `SettingsList` (план 1.5-4a), `useUsers`, `useMe`, `SHARED_NOTE`.
- Produces: `interface ProfileDraft { name: string; current: string; next: string; again: string }`; `type ProfileFields = Partial<Record<'name' | 'current' | 'next' | 'again', string>>`; `profileDirty(draft: ProfileDraft, savedName: string): boolean`; `profilePlan(draft: ProfileDraft, savedName: string): ProfilePlan`; `profileServerFields(fields: Record<string, string>): ProfileFields`; `LockIcon`.

- [ ] **Step 1: Write the failing unit test**

Создайте `tests/client/profile.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { profileDirty, profilePlan, profileServerFields } from '../../src/client/lib/profile';

const draft = (patch: Partial<{ name: string; current: string; next: string; again: string }> = {}) => ({
  name: 'Админ',
  current: '',
  next: '',
  again: '',
  ...patch,
});

describe('«Профиль»: одна «Сохранить» для имени и пароля (§7.4 этапа 1.5)', () => {
  it('только имя', () => {
    expect(profilePlan(draft({ name: ' Админ 2 ' }), 'Админ')).toEqual({ ok: true, name: 'Админ 2', password: null });
  });

  it('только пароль — имя не уходит', () => {
    expect(profilePlan(draft({ current: 'old-pass-1', next: 'new-pass-12', again: 'new-pass-12' }), 'Админ')).toEqual({
      ok: true,
      name: null,
      password: { currentPassword: 'old-pass-1', newPassword: 'new-pass-12' },
    });
  });

  it('часть пароля или повтор не совпал — ошибки у полей, запроса нет (Review Focus 4)', () => {
    expect(profilePlan(draft({ next: 'new-pass-12', again: 'new-pass-12' }), 'Админ')).toEqual({ ok: false, fields: { current: 'Введите текущий пароль' } });
    expect(profilePlan(draft({ current: 'old-pass-1' }), 'Админ')).toEqual({ ok: false, fields: { next: 'Введите новый пароль' } });
    expect(profilePlan(draft({ current: 'old-pass-1', next: 'new-pass-12', again: 'new-pass-13' }), 'Админ')).toEqual({
      ok: false,
      fields: { again: 'Пароли не совпадают' },
    });
    expect(profilePlan(draft({ name: '  ' }), 'Админ')).toEqual({ ok: false, fields: { name: 'Введите имя' } });
  });

  it('нечего сохранять — «Сохранить» недоступна', () => {
    expect(profileDirty(draft(), 'Админ')).toBe(false);
    expect(profileDirty(draft({ name: 'Админ ' }), 'Админ')).toBe(false);
    expect(profileDirty(draft({ name: 'Админ 2' }), 'Админ')).toBe(true);
    expect(profileDirty(draft({ again: 'x' }), 'Админ')).toBe(true);
  });

  it('ошибки сервера — у своих полей', () => {
    expect(profileServerFields({ currentPassword: 'Неверный текущий пароль', newPassword: 'Не короче 10 символов', name: 'Слишком длинное' })).toEqual({
      current: 'Неверный текущий пароль',
      next: 'Не короче 10 символов',
      name: 'Слишком длинное',
    });
    expect(profileServerFields({})).toEqual({});
  });
});
```

Run: `npx vitest run tests/client/profile.test.ts` → FAIL (модуля нет).

- [ ] **Step 2: `lib/profile.ts`**

Создайте `src/client/lib/profile.ts`:

```ts
/** Черновик страницы «Профиль» (§7.4 этапа 1.5): имя и три поля пароля. */
export interface ProfileDraft {
  name: string;
  current: string;
  next: string;
  again: string;
}

export type ProfileField = 'name' | 'current' | 'next' | 'again';
export type ProfileFields = Partial<Record<ProfileField, string>>;

/** Что отправить по «Сохранить»: имя (если изменилось) и пароль (если начат) — или ошибки полей без запроса. */
export type ProfilePlan =
  | { ok: false; fields: ProfileFields }
  | { ok: true; name: string | null; password: { currentPassword: string; newPassword: string } | null };

const passwordStarted = (d: ProfileDraft) => d.current !== '' || d.next !== '' || d.again !== '';

/** Есть что сохранять: другое имя или начат пароль. */
export function profileDirty(draft: ProfileDraft, savedName: string): boolean {
  return draft.name.trim() !== savedName || passwordStarted(draft);
}

export function profilePlan(draft: ProfileDraft, savedName: string): ProfilePlan {
  const name = draft.name.trim();
  const fields: ProfileFields = {};
  if (!name) fields.name = 'Введите имя';
  const password = passwordStarted(draft);
  if (password) {
    if (!draft.current) fields.current = 'Введите текущий пароль';
    if (!draft.next) fields.next = 'Введите новый пароль';
    else if (draft.next !== draft.again) fields.again = 'Пароли не совпадают';
  }
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return {
    ok: true,
    name: name !== savedName ? name : null,
    password: password ? { currentPassword: draft.current, newPassword: draft.next } : null,
  };
}

/** Ошибки сервера (`name`, `currentPassword`, `newPassword`) — у полей страницы. */
export function profileServerFields(fields: Record<string, string>): ProfileFields {
  return {
    ...(fields.currentPassword ? { current: fields.currentPassword } : {}),
    ...(fields.newPassword ? { next: fields.newPassword } : {}),
    ...(fields.name ? { name: fields.name } : {}),
  };
}
```

Run: `npx vitest run tests/client/profile.test.ts` → PASS.

- [ ] **Step 3: Write the failing e2e tests**

В `e2e/service-screens.spec.ts` функцию `addUser` замените на:

```ts
async function addUser(page: Page, cid: number, login: string, name: string, password: string) {
  await page.goto(`/c/${cid}/settings/users`);
  await page.getByRole('button', { name: 'Добавить пользователя' }).click();
  const dialog = page.getByRole('dialog', { name: 'Новый пользователь' });
  await dialog.getByLabel('Логин', { exact: true }).fill(login);
  await dialog.getByLabel('Имя', { exact: true }).fill(name);
  await dialog.getByLabel('Пароль', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Создать пользователя' }).click();
  // окно закрылось — пользователь создан (а не «Логин уже занят»)
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('listitem').filter({ hasText: login })).toBeVisible();
}
```

Тест «пользователи: сброс пароля и отключение сразу завершают чужой сеанс; себя отключить нельзя» замените целиком на:

```ts
test('пользователи: окно «Пользователь» — сброс пароля и отключение сразу завершают чужой сеанс; себя отключить нельзя', async ({ page, browser }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Люди ${Date.now()}`);
  const user = uniqueLogin('kassir');
  await addUser(page, cid, user, 'Кассир', 'kassir-pass-1');
  const list = page.getByRole('main').getByRole('list', { name: 'Пользователи' });
  const row = list.getByRole('listitem').filter({ hasText: user });
  const dialog = page.getByRole('dialog', { name: 'Пользователь', exact: true });
  await expect(row).toContainText('Кассир');

  // у себя — только имя
  await list.getByRole('listitem').filter({ hasText: 'это вы' }).getByRole('button', { name: /^Изменить/ }).click();
  await expect(dialog.getByLabel('Имя', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Отключить' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Сбросить пароль' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  const ctx = await browser.newContext();
  const kassir = await ctx.newPage();
  await login(kassir, user, 'kassir-pass-1');

  await row.getByRole('button', { name: /^Изменить/ }).click();
  await dialog.getByLabel(`Новый пароль для ${user}`).fill('kassir-pass-2');
  await dialog.getByRole('button', { name: 'Сбросить пароль' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Пароль сброшен, сеансы пользователя завершены');
  await kassir.reload();
  await expect(kassir).toHaveURL(/\/login$/);
  await login(kassir, user, 'kassir-pass-2');

  await dialog.getByRole('button', { name: 'Отключить' }).click();
  await expect(dialog.getByRole('status')).toHaveText('Пользователь отключён, его сеансы завершены');
  await expect(dialog.getByRole('button', { name: 'Включить' })).toBeVisible();
  await expect(row).toContainText('отключён');
  await kassir.reload();
  await expect(kassir).toHaveURL(/\/login$/);
  await ctx.close();
});
```

В тесте «профиль: смена пароля оставляет текущий сеанс и завершает остальные» строки от `  await a.getByLabel('Текущий пароль').fill('wrong-password-0');` до `  await expect(a.getByRole('status')).toHaveText('Пароль изменён. Остальные сеансы завершены.');` включительно замените на:

```ts
  // одна колонка и одна «Сохранить» (§7.4)
  await expect(a.getByRole('heading', { level: 2, name: 'Изменить пароль' })).toBeVisible();
  // повтор не совпал — ошибка у поля, без запроса (Review Focus 4)
  await a.getByLabel('Текущий пароль').fill('profiler-pass-1');
  await a.getByLabel('Новый пароль', { exact: true }).fill('profiler-pass-2');
  await a.getByLabel('Повторите пароль').fill('profiler-pass-3');
  await a.getByRole('button', { name: 'Сохранить' }).click();
  await expect(a.getByText('Пароли не совпадают')).toBeVisible();
  await expect(a.getByLabel('Повторите пароль')).toHaveAttribute('aria-invalid', 'true');

  await a.getByLabel('Текущий пароль').fill('wrong-password-0');
  await a.getByLabel('Повторите пароль').fill('profiler-pass-2');
  await a.getByRole('button', { name: 'Сохранить' }).click();
  await expect(a.getByText('Неверный текущий пароль')).toBeVisible();
  await expect(a.getByLabel('Текущий пароль')).toHaveAttribute('aria-invalid', 'true');

  await a.getByLabel('Текущий пароль').fill('profiler-pass-1');
  await a.getByRole('button', { name: 'Сохранить' }).click();
  await expect(a.getByRole('status')).toHaveText('Пароль изменён. Остальные сеансы завершены.');
  await expect(a.getByLabel('Текущий пароль')).toHaveValue('');
  await expect(a.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
```

Run: `npx playwright test e2e/service-screens.spec.ts` → FAIL.

- [ ] **Step 4: `LockIcon`**

В конец `src/client/components/icons.tsx` добавьте:

```tsx
/** Замок — заголовок «Изменить пароль» в «Профиле» (§7.4 этапа 1.5). */
export function LockIcon() {
  return (
    <Svg>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </Svg>
  );
}
```

- [ ] **Step 5: `UsersSettings`**

Замените содержимое `src/client/pages/settings/UsersSettings.tsx` целиком:

```tsx
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { Pending, StaleNotice } from '../../components/QueryState';
import { SettingsList } from '../../components/SettingsList';
import { alertClass, btnDanger, btnPrimary, btnSecondary, inputClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { queryClient, useMe } from '../../lib/query';
import { useUsers, type AppUser } from '../../lib/queries';
import { SHARED_NOTE } from '../../lib/settings-sections';

const invalidateUsers = () =>
  Promise.all([queryClient.invalidateQueries({ queryKey: ['users'] }), queryClient.invalidateQueries({ queryKey: ['me'] })]);

/** Пометка в строке: «это вы», «отключён». */
const userNote = (u: AppUser, meId: number) =>
  [u.id === meId ? 'это вы' : null, u.disabledAt ? 'отключён' : null].filter((s): s is string => s !== null).join(', ') || undefined;

/**
 * «Пользователи» (§7.4 этапа 1.5): «Добавить пользователя» слева вверху, строки «имя, логин серым, ✎»;
 * ✎ — окно «Пользователь»: имя, сброс пароля, отключение (у себя — только имя). Общие для всех компаний.
 */
export function UsersSettings() {
  const users = useUsers();
  const me = useMe();
  const [editing, setEditing] = useState<AppUser | 'new' | null>(null);
  if (!users.data || !me.data) return <Pending queries={[users, me]} />;
  const meId = me.data.user.id;
  const list = users.data;
  const current = editing === null || editing === 'new' ? null : (list.find((u) => u.id === editing.id) ?? editing);

  return (
    <section>
      <StaleNotice queries={[users]} />
      <h1 className="mb-2 text-2xl font-bold">Пользователи</h1>
      <p className="mb-1 text-sm font-medium text-muted">{SHARED_NOTE}</p>
      <p className="mb-4 text-sm text-muted">Все пользователи видят все компании. Сброс пароля и отключение сразу завершают сеансы пользователя.</p>
      <SettingsList
        label="Пользователи"
        rows={list.map((u) => ({ id: u.id, name: u.name, secondary: u.login, note: userNote(u, meId), archived: u.disabledAt !== null }))}
        search={false}
        addLabel="Добавить пользователя"
        onAdd={() => setEditing('new')}
        onEdit={(row) => setEditing(list.find((u) => u.id === row.id) ?? null)}
        empty="Пользователей нет."
      />
      <Modal open={editing !== null} title={editing === 'new' ? 'Новый пользователь' : 'Пользователь'} onClose={() => setEditing(null)} className="max-w-lg">
        {editing === 'new' && <NewUserForm onDone={() => setEditing(null)} />}
        {current && <UserEditor key={current.id} user={current} isMe={current.id === meId} onDone={() => setEditing(null)} />}
      </Modal>
    </section>
  );
}

function NewUserForm({ onDone }: { onDone: () => void }) {
  const [login, setLogin] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const create = useMutation<unknown, ApiError>({
    mutationFn: () => api('/users', { method: 'POST', body: { login, name, password } }),
    onSuccess: async () => {
      await invalidateUsers();
      onDone();
    },
  });
  const fields = create.error?.fields ?? {};
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
      className="grid gap-4"
    >
      <Field label="Логин" error={fields.login} hint="Латиница, цифры, точка, дефис">
        {(c) => <input {...c} autoComplete="off" value={login} onChange={(e) => setLogin(e.target.value)} className={inputClass} />}
      </Field>
      <Field label="Имя" error={fields.name}>
        {(c) => <input {...c} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />}
      </Field>
      <Field label="Пароль" error={fields.password} hint="Не короче 10 символов">
        {(c) => <input {...c} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />}
      </Field>
      {create.error && !create.error.fields && (
        <p role="alert" className={`${alertClass} mb-0`}>
          {create.error.message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={create.isPending || !login.trim() || !password} className={btnPrimary}>
          Создать пользователя
        </button>
        <button type="button" onClick={onDone} className={btnSecondary}>
          Отмена
        </button>
      </div>
    </form>
  );
}

function UserEditor({ user, isMe, onDone }: { user: AppUser; isMe: boolean; onDone: () => void }) {
  const [name, setName] = useState(user.name);
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const patch = useMutation<unknown, ApiError, { name?: string; password?: string; disabled?: boolean }>({
    mutationFn: (body) => api(`/users/${user.id}`, { method: 'PATCH', body }),
    onSuccess: async (_data, body) => {
      await invalidateUsers();
      if (body.name !== undefined) return onDone();
      setPassword('');
      if (body.password !== undefined) setNotice('Пароль сброшен, сеансы пользователя завершены');
      else setNotice(body.disabled ? 'Пользователь отключён, его сеансы завершены' : 'Пользователь включён');
    },
  });
  const fields = patch.error?.fields ?? {};
  const run = (body: { name?: string; password?: string; disabled?: boolean }) => {
    setNotice(null);
    patch.mutate(body);
  };

  return (
    <div className="grid gap-6">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          run({ name });
        }}
        className="grid gap-4"
      >
        <p className="text-sm text-muted">Логин: {user.login}</p>
        <Field label="Имя" error={fields.name}>
          {(c) => <input {...c} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />}
        </Field>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={patch.isPending || !name.trim() || name.trim() === user.name} className={btnPrimary}>
            Сохранить
          </button>
          <button type="button" onClick={onDone} className={btnSecondary}>
            Отмена
          </button>
        </div>
      </form>
      {!isMe && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            run({ password });
          }}
          className="grid gap-3 border-t border-field pt-4"
        >
          <Field label={`Новый пароль для ${user.login}`} error={fields.password} hint="Не короче 10 символов. Сеансы пользователя будут завершены.">
            {(c) => <input {...c} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />}
          </Field>
          <div>
            <button type="submit" disabled={patch.isPending || !password} className={btnSecondary}>
              Сбросить пароль
            </button>
          </div>
        </form>
      )}
      {!isMe && (
        <div className="border-t border-field pt-4">
          <button type="button" disabled={patch.isPending} onClick={() => run({ disabled: !user.disabledAt })} className={user.disabledAt ? btnSecondary : btnDanger}>
            {user.disabledAt ? 'Включить' : 'Отключить'}
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className="text-sm text-muted">
          {notice}
        </p>
      )}
      {patch.error && !patch.error.fields && (
        <p role="alert" className={`${alertClass} mb-0`}>
          {patch.error.message}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 6: `ProfileSettings`**

Замените содержимое `src/client/pages/settings/ProfileSettings.tsx` целиком:

```tsx
import { useState, type FormEvent } from 'react';
import { Field } from '../../components/Field';
import { LockIcon } from '../../components/icons';
import { Pending } from '../../components/QueryState';
import { alertClass, btnPrimary, inputClass } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { profileDirty, profilePlan, profileServerFields, type ProfileDraft, type ProfileFields } from '../../lib/profile';
import { queryClient, useMe, type Me } from '../../lib/query';

/**
 * «Профиль» (§7.4 этапа 1.5): одна колонка около 430 px — логин, «Имя», «🔒 Изменить пароль» и три поля пароля,
 * одна «Сохранить». Что отправлять, решает `profilePlan`: имя — если изменилось, пароль — если начат.
 */
export function ProfileSettings() {
  const me = useMe();
  if (!me.data) return <Pending queries={[me]} />;
  return (
    <section className="max-w-[430px]">
      <h1 className="mb-6 text-2xl font-bold">Профиль</h1>
      <ProfileForm key={me.data.user.id} user={me.data.user} />
    </section>
  );
}

function ProfileForm({ user }: { user: Me['user'] }) {
  const [draft, setDraft] = useState<ProfileDraft>({ name: user.name, current: '', next: '', again: '' });
  const [fields, setFields] = useState<ProfileFields>({});
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const change = (patch: Partial<ProfileDraft>) => {
    setStatus(null);
    setDraft((d) => ({ ...d, ...patch }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus(null);
    setError(null);
    const plan = profilePlan(draft, user.name);
    if (!plan.ok) {
      setFields(plan.fields);
      return;
    }
    setFields({});
    setPending(true);
    const done: string[] = [];
    try {
      if (plan.name !== null) {
        await api(`/users/${user.id}`, { method: 'PATCH', body: { name: plan.name } });
        await Promise.all([queryClient.invalidateQueries({ queryKey: ['me'] }), queryClient.invalidateQueries({ queryKey: ['users'] })]);
        done.push('Имя сохранено.');
      }
      if (plan.password) {
        await api('/auth/password', { method: 'POST', body: plan.password });
        setDraft((d) => ({ ...d, current: '', next: '', again: '' }));
        done.push('Пароль изменён. Остальные сеансы завершены.');
      }
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(profileServerFields(err.fields));
      else setError(err instanceof ApiError ? err.message : 'Ошибка сервера');
    } finally {
      setPending(false);
      setStatus(done.length > 0 ? done.join(' ') : null);
    }
  };

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="grid gap-4">
      <p className="text-sm text-muted">Логин: {user.login}</p>
      <Field label="Имя" error={fields.name}>
        {(c) => <input {...c} value={draft.name} onChange={(e) => change({ name: e.target.value })} className={inputClass} />}
      </Field>
      <h2 className="mt-2 flex items-center gap-2 text-lg font-semibold">
        <LockIcon />
        Изменить пароль
      </h2>
      <Field label="Текущий пароль" error={fields.current}>
        {(c) => <input {...c} type="password" autoComplete="current-password" value={draft.current} onChange={(e) => change({ current: e.target.value })} className={inputClass} />}
      </Field>
      <Field label="Новый пароль" hint="Не короче 10 символов" error={fields.next}>
        {(c) => <input {...c} type="password" autoComplete="new-password" value={draft.next} onChange={(e) => change({ next: e.target.value })} className={inputClass} />}
      </Field>
      <Field label="Повторите пароль" error={fields.again}>
        {(c) => <input {...c} type="password" autoComplete="new-password" value={draft.again} onChange={(e) => change({ again: e.target.value })} className={inputClass} />}
      </Field>
      {status && (
        <p role="status" className="text-sm text-income-strong">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className={`${alertClass} mb-0`}>
          {error}
        </p>
      )}
      <button type="submit" disabled={pending || !profileDirty(draft, user.name)} className={btnPrimary}>
        Сохранить
      </button>
    </form>
  );
}
```

- [ ] **Step 7: Run the tests**

Run: `npx playwright test e2e/service-screens.spec.ts e2e/money.spec.ts` → PASS (тест свёрнутой панели в `money.spec.ts` открывает «Профиль» из панели «Настройки»).

- [ ] **Step 8: Full check and commit**

Run: `npm test` → PASS. Run: `npm run typecheck`. Run: `npm run test:e2e` дважды → все проходят оба раза.

```bash
git add src/client/lib/profile.ts tests/client/profile.test.ts src/client/components/icons.tsx src/client/pages/settings/UsersSettings.tsx src/client/pages/settings/ProfileSettings.tsx e2e/service-screens.spec.ts
git commit -m "feat: «Пользователи» на шаблоне списка с окном пользователя; «Профиль» в одну колонку с одной «Сохранить»

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: «Фиксированные курсы валют» и «Резервное копирование»

**Files:**
- Modify: `src/client/pages/settings/RatesSettings.tsx` (полная замена), `src/client/pages/settings/BackupSettings.tsx` (полная замена)
- Test: `e2e/money.spec.ts`, `e2e/service-screens.spec.ts`

**Interfaces:**
- Consumes: `EntityActions`, `useEntityActions` (план 1.5-4a); `useFixedRates`, `useManualRates`, `useBackupStatus`, `useMeta`.
- Produces: окна «Новый фиксированный курс», «Фиксированный курс», «Новый курс на дату», «Курс на дату»; регион «Автоматическая копия».

- [ ] **Step 1: Write the failing e2e tests**

В `e2e/money.spec.ts` в тесте «курсы: валюта без курса — предупреждение; фиксированный курс включает её в итог; ручные курсы на дату» замените часть от строки `  // фиксированный курс компании` до конца теста (закрывающая `});`) на:

```ts
  // фиксированный курс компании — в окне «Добавить свой курс»
  const fixed = page.getByRole('region', { name: 'Фиксированные курсы компании' });
  await fixed.getByRole('button', { name: 'Добавить свой курс' }).click();
  const fixedNew = page.getByRole('dialog', { name: 'Новый фиксированный курс' });
  await fixedNew.getByLabel('Валюта').selectOption('EUR');
  await fixedNew.getByLabel('Курс к KZT').fill('500');
  await fixedNew.getByLabel('Действует с').fill('2020-01-01');
  await fixedNew.getByRole('button', { name: 'Сохранить' }).click();
  await expect(fixedNew).toBeHidden();
  const fixedRow = fixed.getByRole('listitem').filter({ hasText: 'EUR' });
  await expect(fixedRow).toContainText('1 EUR = 500 KZT');
  await expect(fixedRow).toContainText('с 01.01.2020, бессрочно');
  // итог — в левой панели журнала: «← Назад к журналу», проверка, и обратно к курсам
  const back = page.getByRole('navigation', { name: 'Разделы настроек' }).getByRole('link', { name: /Назад к журналу/ });
  await back.click();
  await expect(panel).not.toContainText('недоступен');
  await expect(panel).toContainText(/Всего на счетах\s*₸\s5\s000(?![\s\d])/);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/rates$`));

  // ✎ — окно «Фиксированный курс»: валюта не меняется
  await fixedRow.getByRole('button', { name: 'Изменить курс EUR' }).click();
  const fixedEdit = page.getByRole('dialog', { name: 'Фиксированный курс', exact: true });
  await expect(fixedEdit).toContainText('Валюта: EUR');
  await fixedEdit.getByLabel('Курс 1 EUR').fill('510');
  await fixedEdit.getByRole('button', { name: 'Сохранить' }).click();
  await expect(fixedEdit).toBeHidden();
  await expect(fixedRow).toContainText('1 EUR = 510 KZT');
  await back.click();
  await expect(panel).toContainText(/Всего на счетах\s*₸\s5\s100(?![\s\d])/);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/rates$`));

  // ручной курс на дату: добавить, изменить, удалить через подтверждение
  const manual = page.getByRole('region', { name: 'Ручные курсы на дату' });
  const manualNew = page.getByRole('dialog', { name: 'Новый курс на дату' });
  await manual.getByRole('button', { name: 'Добавить курс на дату' }).click();
  await manualNew.getByLabel('Дата').fill('2020-03-15');
  await manualNew.getByLabel('Валюта').selectOption('GBP');
  await manualNew.getByLabel('Курс к тенге').fill('520,5');
  await manualNew.getByRole('button', { name: 'Сохранить' }).click();
  await expect(manualNew).toBeHidden();
  const manualRow = manual.getByRole('listitem').filter({ hasText: '15.03.2020' });
  await expect(manualRow).toContainText('GBP');
  await expect(manualRow).toContainText('520,5');

  const manualEdit = page.getByRole('dialog', { name: 'Курс на дату', exact: true });
  await manualRow.getByRole('button', { name: 'Изменить курс GBP на 15.03.2020' }).click();
  await manualEdit.getByLabel('Курс к тенге').fill('521');
  await manualEdit.getByRole('button', { name: 'Сохранить' }).click();
  await expect(manualEdit).toBeHidden();
  await expect(manualRow).toContainText('1 GBP = 521 KZT');

  await manualRow.getByRole('button', { name: 'Изменить курс GBP на 15.03.2020' }).click();
  await manualEdit.getByRole('button', { name: 'Удалить' }).click();
  await page.getByRole('alertdialog', { name: 'Удалить курс GBP на 15.03.2020?' }).getByRole('button', { name: 'Удалить' }).click();
  await expect(manualEdit).toBeHidden();
  await expect(manual.getByRole('listitem').filter({ hasText: '15.03.2020' })).toHaveCount(0);

  // ошибка поля из сервера: неверный курс — у поля, окно открыто
  await manual.getByRole('button', { name: 'Добавить курс на дату' }).click();
  await manualNew.getByLabel('Дата').fill('2020-03-16');
  await manualNew.getByLabel('Курс к тенге').fill('abc');
  await manualNew.getByRole('button', { name: 'Сохранить' }).click();
  await expect(manualNew.getByLabel('Курс к тенге')).toHaveAttribute('aria-invalid', 'true');
});
```

В `e2e/service-screens.spec.ts` в тесте «резервная копия: последняя копия и «Скачать сейчас»» после строки `  await page.goto(\`/c/${cid}/settings/backup\`);` добавьте:

```ts
  const auto = page.getByRole('region', { name: 'Автоматическая копия' });
  await expect(auto).toContainText('Включено');
  await expect(auto).toContainText('Ежедневно в 04:00 и при запуске');
  await expect(page.getByRole('main')).toContainText('Копия общая для всех компаний');
```

Run: `npx playwright test e2e/money.spec.ts -g "курсы" e2e/service-screens.spec.ts -g "резервная"` → FAIL.

- [ ] **Step 2: `RatesSettings`**

Замените содержимое `src/client/pages/settings/RatesSettings.tsx` целиком:

```tsx
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useOutletContext } from 'react-router';
import { CURRENCIES } from '../../../shared/currencies';
import { formatDateRu } from '../../../shared/dates';
import { EntityActions } from '../../components/EntityActions';
import { Field } from '../../components/Field';
import { PencilIcon } from '../../components/icons';
import { Modal } from '../../components/Modal';
import { Pending, StaleNotice } from '../../components/QueryState';
import { alertClass, btnPrimary, btnSecondary, inputClass, noticeClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { useFixedRates, useManualRates, type FixedRate, type ManualRate } from '../../lib/queries';
import { SHARED_NOTE } from '../../lib/settings-sections';
import { useEntityActions } from '../../lib/settings-mutations';
import type { CompanyOutletContext } from '../CompanyLayout';

/** Курс для показа — с десятичной запятой, как его вводят. */
const showRate = (rate: string) => rate.replace('.', ',');

/** Курсы меняют «Всего на счетах» и блокировку валют: обновляем балансы всех компаний и список компаний со сводкой. */
const refreshTotals = () =>
  Promise.all([
    queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'accounts' && q.queryKey[2] === 'balances' }),
    queryClient.invalidateQueries({ queryKey: ['companies'] }),
  ]);

const MANUAL_PAGE = 100;
const rowClass = 'flex min-h-14 items-center gap-2 border-b border-field py-2 pr-1 hover:bg-field/60';
const pencilClass =
  'grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-card hover:text-ink focus-visible:outline-2 focus-visible:outline-focus';

/**
 * «Фиксированные курсы валют» (§7.4 этапа 1.5): список фиксированных курсов компании и «Добавить свой курс» →
 * окно; ниже наш блок «Ручные курсы на дату» с «Добавить курс на дату» → окно. Правка и «Удалить» — по ✎ в окне.
 */
export function RatesSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  return (
    <section>
      <h1 className="mb-4 text-2xl font-bold">Фиксированные курсы валют</h1>
      <FixedRatesSection key={company.id} companyId={company.id} baseCurrency={company.baseCurrency} readOnly={company.archivedAt !== null} />
      <ManualRatesSection />
    </section>
  );
}

function FixedRatesSection({ companyId, baseCurrency, readOnly }: { companyId: number; baseCurrency: string; readOnly: boolean }) {
  const rates = useFixedRates(companyId);
  const [editing, setEditing] = useState<FixedRate | 'new' | null>(null);
  return (
    <section aria-labelledby="fixed-rates-title" className="mb-10">
      <h2 id="fixed-rates-title" className="mb-1 text-xl font-bold">
        Фиксированные курсы компании
      </h2>
      <p className="mb-4 text-sm text-muted">Курс валюты к {baseCurrency} на период. Пока он действует, курс на дату для этой компании не используется.</p>
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      {!readOnly && (
        <button type="button" onClick={() => setEditing('new')} className={`${btnPrimary} mb-4`}>
          Добавить свой курс
        </button>
      )}
      {!rates.data ? (
        <Pending queries={[rates]} />
      ) : (
        <>
          <StaleNotice queries={[rates]} />
          {rates.data.length === 0 ? (
            <p className="text-muted">Фиксированных курсов нет.</p>
          ) : (
            <ul aria-label="Фиксированные курсы">
              {rates.data.map((r) => (
                <li key={r.id} className={rowClass}>
                  <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold">
                      1 {r.currency} = {showRate(r.rate)} {baseCurrency}
                    </span>
                    <span className="text-sm text-muted">
                      {r.validTo ? `с ${formatDateRu(r.validFrom)} по ${formatDateRu(r.validTo)}` : `с ${formatDateRu(r.validFrom)}, бессрочно`}
                    </span>
                  </span>
                  {!readOnly && (
                    <button type="button" aria-label={`Изменить курс ${r.currency}`} title="Изменить" onClick={() => setEditing(r)} className={pencilClass}>
                      <PencilIcon />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <Modal open={editing !== null} title={editing === 'new' ? 'Новый фиксированный курс' : 'Фиксированный курс'} onClose={() => setEditing(null)} className="max-w-lg">
        {editing !== null && (
          <FixedRateEditor
            key={editing === 'new' ? 'new' : editing.id}
            companyId={companyId}
            baseCurrency={baseCurrency}
            rate={editing === 'new' ? null : editing}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
    </section>
  );
}

function FixedRateEditor(props: { companyId: number; baseCurrency: string; rate: FixedRate | null; onDone: () => void }) {
  const { rate, onDone } = props;
  const base = `/companies/${props.companyId}/fixed-rates`;
  const choices = CURRENCIES.filter((c) => c.code !== props.baseCurrency);
  const [currency, setCurrency] = useState(rate?.currency ?? (props.baseCurrency === 'USD' ? 'EUR' : 'USD'));
  const [value, setValue] = useState(rate ? showRate(rate.rate) : '');
  const [validFrom, setValidFrom] = useState(rate?.validFrom ?? '');
  const [validTo, setValidTo] = useState(rate?.validTo ?? '');
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['fixed-rates', props.companyId] }), refreshTotals()]);
  const save = useMutation<unknown, ApiError>({
    mutationFn: () =>
      rate
        ? api(`${base}/${rate.id}`, { method: 'PATCH', body: { rate: value, validFrom, validTo: validTo || null } })
        : api(base, { method: 'POST', body: { currency, rate: value, validFrom, validTo: validTo || null } }),
    onSuccess: async () => {
      await refresh();
      onDone();
    },
  });
  const actions = useEntityActions(rate ? `${base}/${rate.id}` : base, refresh, onDone);
  const fields = save.error?.fields ?? {};
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <>
      <form noValidate onSubmit={submit} className="grid gap-4">
        {rate ? (
          <p className="text-sm text-muted">Валюта: {rate.currency}</p>
        ) : (
          <Field label="Валюта" error={fields.currency}>
            {(c) => (
              <select {...c} value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass}>
                {choices.map((x) => (
                  <option key={x.code} value={x.code}>
                    {x.code} — {x.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        <Field label={rate ? `Курс 1 ${rate.currency}` : `Курс к ${props.baseCurrency}`} error={fields.rate}>
          {(c) => <input {...c} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className={inputClass} />}
        </Field>
        <Field label="Действует с" error={fields.validFrom}>
          {(c) => <input {...c} type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className={inputClass} />}
        </Field>
        <Field label="Действует по" hint="Пусто — бессрочно" error={fields.validTo}>
          {(c) => <input {...c} type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} className={inputClass} />}
        </Field>
        {save.error && !save.error.fields && (
          <p role="alert" className={`${alertClass} mb-0`}>
            {save.error.message}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={save.isPending} className={btnPrimary}>
            Сохранить
          </button>
          <button type="button" onClick={onDone} className={btnSecondary}>
            Отмена
          </button>
        </div>
      </form>
      {rate && <EntityActions what={`фиксированный курс ${rate.currency}`} onDelete={actions.remove} pending={actions.pending} error={actions.error} />}
    </>
  );
}

function ManualRatesSection() {
  const rates = useManualRates();
  const [chosenFilter, setFilter] = useState('');
  const [shown, setShown] = useState(MANUAL_PAGE);
  const [editing, setEditing] = useState<ManualRate | 'new' | null>(null);
  // удалили последний курс отфильтрованной валюты — фильтр сбрасывается сам
  const filter = rates.data?.some((r) => r.currency === chosenFilter) ? chosenFilter : '';
  // новые даты сверху; при равной дате — по коду валюты
  const list = [...(rates.data ?? [])]
    .filter((r) => !filter || r.currency === filter)
    .sort((a, b) => b.date.localeCompare(a.date) || a.currency.localeCompare(b.currency));

  return (
    <section aria-labelledby="manual-rates-title">
      <h2 id="manual-rates-title" className="mb-1 text-xl font-bold">
        Ручные курсы на дату
      </h2>
      <p className="mb-1 text-sm font-medium text-muted">{SHARED_NOTE}</p>
      <p className="mb-4 text-sm text-muted">
        Курс к тенге на дату — общий для всех компаний. Если на дату курса нет, берётся ближайший предыдущий, не старше 7 дней. Курсы, загруженные автоматически (например, демо-набором), здесь не показываются; на такую дату ручной курс добавить нельзя.
      </p>
      <button type="button" onClick={() => setEditing('new')} className={`${btnPrimary} mb-4`}>
        Добавить курс на дату
      </button>
      {!rates.data ? (
        <Pending queries={[rates]} />
      ) : (
        <>
          <StaleNotice queries={[rates]} />
          <Field label="Показать валюту" className="mb-3 w-56">
            {(c) => (
              <select
                {...c}
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setShown(MANUAL_PAGE);
                }}
                className={inputClass}
              >
                <option value="">Все валюты</option>
                {[...new Set(rates.data.map((r) => r.currency))].sort().map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {list.length === 0 ? (
            <p className="text-muted">Курсов нет.</p>
          ) : (
            <ul aria-label="Ручные курсы">
              {list.slice(0, shown).map((r) => (
                <li key={r.id} className={rowClass}>
                  <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                    <span className="text-muted">{formatDateRu(r.date)}</span>
                    <span className="font-semibold">
                      1 {r.currency} = {showRate(r.rateToKzt)} KZT
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label={`Изменить курс ${r.currency} на ${formatDateRu(r.date)}`}
                    title="Изменить"
                    onClick={() => setEditing(r)}
                    className={pencilClass}
                  >
                    <PencilIcon />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {list.length > shown && (
            <button type="button" onClick={() => setShown(shown + MANUAL_PAGE)} className={`${btnSecondary} mt-3`}>
              Показать ещё ({list.length - shown})
            </button>
          )}
        </>
      )}
      <Modal open={editing !== null} title={editing === 'new' ? 'Новый курс на дату' : 'Курс на дату'} onClose={() => setEditing(null)} className="max-w-lg">
        {editing !== null && <ManualRateEditor key={editing === 'new' ? 'new' : editing.id} rate={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      </Modal>
    </section>
  );
}

function ManualRateEditor({ rate, onDone }: { rate: ManualRate | null; onDone: () => void }) {
  const choices = CURRENCIES.filter((c) => c.code !== 'KZT');
  const [date, setDate] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [value, setValue] = useState(rate ? showRate(rate.rateToKzt) : '');
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['rates-manual'] }), refreshTotals()]);
  const save = useMutation<unknown, ApiError>({
    mutationFn: () =>
      rate ? api(`/rates/manual/${rate.id}`, { method: 'PATCH', body: { rate: value } }) : api('/rates/manual', { method: 'POST', body: { date, currency, rate: value } }),
    onSuccess: async () => {
      await refresh();
      onDone();
    },
  });
  const actions = useEntityActions(rate ? `/rates/manual/${rate.id}` : '/rates/manual', refresh, onDone);
  const fields = save.error?.fields ?? {};
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <>
      <form noValidate onSubmit={submit} className="grid gap-4">
        {rate ? (
          <p className="text-sm text-muted">
            {formatDateRu(rate.date)}, {rate.currency}
          </p>
        ) : (
          <>
            <Field label="Дата" error={fields.date}>
              {(c) => <input {...c} type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />}
            </Field>
            <Field label="Валюта" error={fields.currency}>
              {(c) => (
                <select {...c} value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass}>
                  {choices.map((x) => (
                    <option key={x.code} value={x.code}>
                      {x.code} — {x.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </>
        )}
        <Field label="Курс к тенге" error={fields.rate}>
          {(c) => <input {...c} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className={inputClass} />}
        </Field>
        {save.error && !save.error.fields && (
          <p role="alert" className={`${alertClass} mb-0`}>
            {save.error.message}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={save.isPending} className={btnPrimary}>
            Сохранить
          </button>
          <button type="button" onClick={onDone} className={btnSecondary}>
            Отмена
          </button>
        </div>
      </form>
      {rate && <EntityActions what={`курс ${rate.currency} на ${formatDateRu(rate.date)}`} onDelete={actions.remove} pending={actions.pending} error={actions.error} />}
    </>
  );
}
```

- [ ] **Step 3: `BackupSettings`**

Замените содержимое `src/client/pages/settings/BackupSettings.tsx` целиком:

```tsx
import { useMutation } from '@tanstack/react-query';
import { useId } from 'react';
import { formatDateTime } from '../../../shared/dates';
import { Pending, StaleNotice } from '../../components/QueryState';
import { alertClass, btnPrimary } from '../../components/ui';
import { downloadFile, saveBlob, type ApiError } from '../../lib/api';
import { formatBytes } from '../../lib/audit-format';
import { queryClient, useMeta } from '../../lib/query';
import { useBackupStatus } from '../../lib/queries';
import { SHARED_NOTE } from '../../lib/settings-sections';

/**
 * «Резервное копирование» (§7.4 этапа 1.5): копия общая для всех компаний; карточка «Автоматическая копия» —
 * плашка «Включено», расписание, последняя копия, папка `BACKUP_COPY_DIR` и её ошибка, «Скачать сейчас».
 * Списка копий нет: нового серверного маршрута для него не делаем.
 */
export function BackupSettings() {
  const status = useBackupStatus();
  const meta = useMeta();
  const titleId = useId();
  const download = useMutation<void, ApiError>({
    mutationFn: async () => {
      const { blob, filename } = await downloadFile('/backup/download');
      saveBlob(blob, filename);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['backup-status'] }),
  });

  if (!status.data || !meta.data) return <Pending queries={[status, meta]} />;
  const s = status.data;

  return (
    <section>
      <StaleNotice queries={[status]} />
      <h1 className="mb-2 text-2xl font-bold">Резервное копирование</h1>
      <p className="mb-1 text-sm font-medium text-muted">{SHARED_NOTE}</p>
      <p className="mb-6 max-w-2xl text-sm text-muted">Копия общая для всех компаний: архив содержит базу и вложения всех компаний.</p>
      <section aria-labelledby={titleId} className="max-w-2xl rounded-2xl bg-field/60 p-5">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 id={titleId} className="text-lg font-semibold">
            Автоматическая копия
          </h2>
          <span className="rounded-full bg-income-soft px-2.5 py-0.5 text-xs font-semibold text-income-strong">Включено</span>
        </div>
        <p className="mb-4 text-sm">Ежедневно в 04:00 и при запуске, если последней копии больше суток.</p>
        <dl className="mb-4 grid gap-x-6 gap-y-2 text-sm md:grid-cols-[16rem_1fr]">
          {/* последний архив любого вида: ежедневный, стартовый, перед миграцией */}
          <dt className="text-muted">Последняя копия</dt>
          <dd>{s.last ? `${formatDateTime(s.last.createdAt, meta.data.timezone)} · ${formatBytes(s.last.size)}` : 'Ещё не было'}</dd>
          <dt className="text-muted">Папка для копий (BACKUP_COPY_DIR)</dt>
          <dd className="break-all">{s.copyDir ?? 'Не задана — копии хранятся только в data/backups'}</dd>
        </dl>
        {s.lastCopyError && (
          <p role="alert" className={alertClass}>
            Не удалось скопировать архив в BACKUP_COPY_DIR: {s.lastCopyError}
          </p>
        )}
        {download.error && (
          <p role="alert" className={alertClass}>
            {download.error.message}
          </p>
        )}
        <button type="button" onClick={() => download.mutate()} disabled={download.isPending} className={btnPrimary}>
          {download.isPending ? 'Готовим архив…' : 'Скачать сейчас'}
        </button>
      </section>
    </section>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npx playwright test e2e/money.spec.ts e2e/service-screens.spec.ts e2e/mobile.spec.ts` → PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` → PASS. Run: `npm run typecheck`. Run: `npm run test:e2e` дважды → все проходят оба раза.

```bash
git add src/client/pages/settings/RatesSettings.tsx src/client/pages/settings/BackupSettings.tsx e2e/money.spec.ts e2e/service-screens.spec.ts
git commit -m "feat: курсы — «Добавить свой курс» и «Добавить курс на дату» в окнах с правкой и удалением; карточка «Автоматическая копия»

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: «Настройки журнала» — окончательный вид, понятная ошибка, «Применить» без залипания

**Files:**
- Create: `src/client/lib/journal-view.ts`, `tests/client/journal-view.test.ts`
- Modify: `src/client/lib/preferences.ts`, `tests/client/preferences.test.ts`, `src/client/pages/settings/JournalViewSettings.tsx` (полная замена)
- Test: `e2e/dialogs.spec.ts`

**Interfaces:**
- Consumes: `JOURNAL_COLUMNS`, `JOURNAL_COLUMNS_PREF`, `visibleColumns`, `toggleColumn` (`lib/journal-columns.ts`); `JOURNAL_WRAP_PREF`, `journalWrap`, `SKIP_CLOSE_CONFIRM_PREF`, `skipCloseConfirm` (`lib/preferences.ts`); `savePreference`, `usePreferences`.
- Produces: `interface JournalView { columns: JournalColumnId[]; wrap: boolean; ask: boolean }`; `type JournalViewKey`; `JOURNAL_VIEW_NAMES: Record<JournalViewKey, string>`; `savedJournalView(prefs): JournalView`; `shownJournalView(saved, edits): JournalView`; `journalViewChanges(saved, edits): JournalViewKey[]`; `journalViewPref(view, key): { pref: string; value: unknown }`; новый текст `prefsSaveError(saved: readonly string[], failed: string, reason: string): string`.

- [ ] **Step 1: Write the failing unit tests**

Создайте `tests/client/journal-view.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { journalViewChanges, journalViewPref, savedJournalView, shownJournalView, type JournalView } from '../../src/client/lib/journal-view';

const saved: JournalView = { columns: ['date', 'amount', 'account'], wrap: false, ask: true };

describe('«Настройки журнала»: правки поверх сохранённого (§7.5 этапа 1.5)', () => {
  it('сохранённое — из настроек пользователя; без настроек — по умолчанию', () => {
    expect(savedJournalView({ 'journal.wrap': true, 'operationForm.skipCloseConfirm': true })).toMatchObject({ wrap: true, ask: false });
    expect(savedJournalView(undefined)).toMatchObject({ wrap: false, ask: true });
  });

  it('правка, равная сохранённому, — не изменение', () => {
    expect(journalViewChanges(saved, {})).toEqual([]);
    expect(journalViewChanges(saved, { wrap: false })).toEqual([]);
    expect(journalViewChanges(saved, { columns: ['date', 'amount', 'account'] })).toEqual([]);
  });

  it('изменения — по порядку: колонки, «Показывать полностью», вопрос', () => {
    expect(journalViewChanges(saved, { ask: false, wrap: true, columns: ['date', 'amount'] })).toEqual(['columns', 'wrap', 'ask']);
  });

  it('после сбоя и перезапроса: сервер уже равен правке — «Применить» недоступна (Review Focus 3, итоги 1.5-2a №5)', () => {
    const refetched: JournalView = { ...saved, ask: false };
    expect(journalViewChanges(refetched, { ask: false })).toEqual([]);
  });

  it('настройка без правки следует за сервером; с правкой — показывает правку', () => {
    const refetched: JournalView = { ...saved, wrap: true };
    expect(shownJournalView(refetched, { ask: false })).toEqual({ columns: saved.columns, wrap: true, ask: false });
    expect(journalViewChanges(refetched, { ask: false })).toEqual(['ask']);
  });

  it('значения для PUT /preferences: вопрос — обратный к operationForm.skipCloseConfirm', () => {
    const view: JournalView = { columns: ['date'], wrap: true, ask: false };
    expect(journalViewPref(view, 'columns')).toEqual({ pref: 'journal.columns', value: ['date'] });
    expect(journalViewPref(view, 'wrap')).toEqual({ pref: 'journal.wrap', value: true });
    expect(journalViewPref(view, 'ask')).toEqual({ pref: 'operationForm.skipCloseConfirm', value: true });
  });
});
```

В `tests/client/preferences.test.ts` блок `describe('ошибка «Применить» в «Настройках журнала» (§7.5 этапа 1.5)', …)` замените целиком на:

```ts
describe('ошибка «Применить» в «Настройках журнала» (§7.5 этапа 1.5, итоги 1.5-1b №5)', () => {
  it('сначала что не сохранилось и почему, затем что уже сохранено; имена — как подписи на странице', () => {
    expect(prefsSaveError([], 'Колонки', 'Сбой')).toBe('Не удалось сохранить «Колонки»: Сбой.');
    expect(prefsSaveError(['Колонки'], 'Спрашивать перед закрытием формы', 'Сбой сохранения.')).toBe(
      'Не удалось сохранить «Спрашивать перед закрытием формы»: Сбой сохранения. Остальное сохранено: «Колонки».',
    );
    expect(prefsSaveError(['Колонки', 'Показывать полностью'], 'Спрашивать перед закрытием формы', 'Нет связи с сервером')).toBe(
      'Не удалось сохранить «Спрашивать перед закрытием формы»: Нет связи с сервером. Остальное сохранено: «Колонки», «Показывать полностью».',
    );
  });
});
```

Run: `npx vitest run tests/client/journal-view.test.ts tests/client/preferences.test.ts` → FAIL.

- [ ] **Step 2: `prefsSaveError` — new wording**

В `src/client/lib/preferences.ts` функцию `prefsSaveError` вместе с её комментарием замените на:

```ts
/**
 * Текст ошибки «Применить» в «Настройках журнала» (§7.5 этапа 1.5, итоги 1.5-1b №5): настройки сохраняются по
 * очереди, на первой ошибке — стоп. Сначала — какая не сохранилась и почему, затем — что уже сохранено.
 * Имена — подписи на странице: «Колонки», «Показывать полностью», «Спрашивать перед закрытием формы».
 */
export function prefsSaveError(saved: readonly string[], failed: string, reason: string): string {
  const why = reason.trim().replace(/[.!]+$/, '');
  const head = `Не удалось сохранить «${failed}»: ${why}.`;
  return saved.length > 0 ? `${head} Остальное сохранено: ${saved.map((s) => `«${s}»`).join(', ')}.` : head;
}
```

- [ ] **Step 3: `lib/journal-view.ts`**

Создайте `src/client/lib/journal-view.ts`:

```ts
import { JOURNAL_COLUMNS_PREF, visibleColumns, type JournalColumnId } from './journal-columns';
import { JOURNAL_WRAP_PREF, journalWrap, SKIP_CLOSE_CONFIRM_PREF, skipCloseConfirm } from './preferences';

/** Что настраивает страница «Настройки журнала» (§7.5 этапа 1.5). */
export interface JournalView {
  columns: JournalColumnId[];
  wrap: boolean;
  /** «Спрашивать перед закрытием формы…» — обратное к operationForm.skipCloseConfirm. */
  ask: boolean;
}

export type JournalViewKey = keyof JournalView;

/** Порядок сохранения — порядок на странице. */
const KEYS: readonly JournalViewKey[] = ['columns', 'wrap', 'ask'];

/** Имена настроек в сообщении об ошибке — как подписи на странице. */
export const JOURNAL_VIEW_NAMES: Record<JournalViewKey, string> = {
  columns: 'Колонки',
  wrap: 'Показывать полностью',
  ask: 'Спрашивать перед закрытием формы',
};

/** Сохранённое на сервере (кэш настроек пользователя); значения неизвестного вида — по умолчанию. */
export function savedJournalView(prefs: Record<string, unknown> | undefined): JournalView {
  return { columns: visibleColumns(prefs?.[JOURNAL_COLUMNS_PREF]), wrap: journalWrap(prefs), ask: !skipCloseConfirm(prefs) };
}

const same = (key: JournalViewKey, a: JournalView, b: JournalView) => (key === 'columns' ? a.columns.join() === b.columns.join() : a[key] === b[key]);

/** Что показывает страница: правки поверх сохранённого; настройка без правки следует за сервером. */
export function shownJournalView(saved: JournalView, edits: Partial<JournalView>): JournalView {
  return { ...saved, ...edits };
}

/**
 * Что сохранит «Применить», по порядку: правки, отличные от сохранённого. Пусто — «Применить» недоступна; считается
 * от сохранённого на сервере, поэтому после сбоя и перезапроса не залипает (итоги 1.5-2a №5).
 */
export function journalViewChanges(saved: JournalView, edits: Partial<JournalView>): JournalViewKey[] {
  const shown = shownJournalView(saved, edits);
  return KEYS.filter((key) => edits[key] !== undefined && !same(key, shown, saved));
}

/** Ключ и значение PUT /preferences/:key для настройки. */
export function journalViewPref(view: JournalView, key: JournalViewKey): { pref: string; value: unknown } {
  if (key === 'columns') return { pref: JOURNAL_COLUMNS_PREF, value: view.columns };
  if (key === 'wrap') return { pref: JOURNAL_WRAP_PREF, value: view.wrap };
  return { pref: SKIP_CLOSE_CONFIRM_PREF, value: !view.ask };
}
```

Run: `npx vitest run tests/client/journal-view.test.ts tests/client/preferences.test.ts` → PASS.

- [ ] **Step 4: Update the e2e test**

В `e2e/dialogs.spec.ts` в тесте ««Настройки журнала»: «Применить» только при изменениях…» строку

```ts
    await expect(page.getByRole('alert')).toHaveText('Сохранено: колонки, «Показывать полностью». Не сохранено: вопрос о несохранённом — Сбой сохранения');
```

замените на:

```ts
    await expect(page.getByRole('alert')).toHaveText(
      'Не удалось сохранить «Спрашивать перед закрытием формы»: Сбой сохранения. Остальное сохранено: «Колонки», «Показывать полностью».',
    );
    // сохранённое уже не правка: после перезапроса изменённым остаётся только вопрос (итоги 1.5-2a №5)
    await expect(page.getByRole('checkbox', { name: 'Комментарий', exact: true })).not.toBeChecked();
    // вопрос всё ещё отличается от сервера — «Применить» не залипает (Review Focus 3)
    await expect(apply).toBeEnabled();
```

Run: `npx playwright test e2e/dialogs.spec.ts -g "Настройки журнала"` → FAIL (старый текст ошибки).

- [ ] **Step 5: `JournalViewSettings`**

Замените содержимое `src/client/pages/settings/JournalViewSettings.tsx` целиком:

```tsx
import { useEffect, useId, useRef, useState } from 'react';
import { Pending } from '../../components/QueryState';
import { alertClass, btnPrimary } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { JOURNAL_COLUMNS, toggleColumn } from '../../lib/journal-columns';
import { JOURNAL_VIEW_NAMES, journalViewChanges, journalViewPref, savedJournalView, shownJournalView, type JournalView, type JournalViewKey } from '../../lib/journal-view';
import { prefsSaveError } from '../../lib/preferences';
import { queryClient } from '../../lib/query';
import { savePreference, usePreferences } from '../../lib/queries';

const rowClass = 'flex items-center justify-between gap-4 border-b border-field py-3 text-sm';

/**
 * «Настройки журнала» (§7.5 этапа 1.5), окончательный вид как в Finmap (`36`): флажки колонок, «Показывать полностью
 * (до 2 строк)», «Спрашивать перед закрытием формы…» — строками «подпись — флажок», «Применить» сохраняет всё вместе.
 * Список в «Ещё» журнала применяется сразу.
 */
export function JournalViewSettings() {
  const prefs = usePreferences();
  if (!prefs.data) return <Pending queries={[prefs]} />;
  return <JournalViewForm saved={savedJournalView(prefs.data)} />;
}

function JournalViewForm({ saved }: { saved: JournalView }) {
  // только правки: настройка без правки следует за сохранённым (другая вкладка, перезапрос после сбоя)
  const [edits, setEdits] = useState<Partial<JournalView>>({});
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef<'status' | 'button' | null>(null);
  const wrapHelpId = useId();
  const view = shownJournalView(saved, edits);
  const changes = journalViewChanges(saved, edits);

  // кнопка и поля отключены на время сохранения: фокус возвращается сюда, когда оно закончилось
  useEffect(() => {
    if (pending || !refocus.current) return;
    (refocus.current === 'status' ? statusRef.current : buttonRef.current)?.focus({ preventScroll: true });
    refocus.current = null;
  }, [pending]);

  const edit = (patch: Partial<JournalView>) => {
    setStatus(null);
    setError(null);
    setEdits((e) => ({ ...e, ...patch }));
  };

  const apply = async () => {
    setPending(true);
    setStatus(null);
    setError(null);
    const done: JournalViewKey[] = [];
    let ok = true;
    try {
      // по очереди и только изменённое: неизменённая настройка не затирает более новое значение из другой вкладки
      for (const key of changes) {
        const { pref, value } = journalViewPref(view, key);
        try {
          await savePreference(pref, value);
          done.push(key);
        } catch (e) {
          ok = false;
          setError(
            prefsSaveError(
              done.map((k) => JOURNAL_VIEW_NAMES[k]),
              JOURNAL_VIEW_NAMES[key],
              e instanceof ApiError ? e.message : 'Ошибка сервера',
            ),
          );
          break;
        }
      }
      if (ok) setStatus('Настройки сохранены');
      // после сбоя — правда с сервера: «Применить» считается от неё и не залипает (итоги 1.5-2a №5)
      else await queryClient.invalidateQueries({ queryKey: ['preferences'] });
    } finally {
      // сохранённое — уже не правка: savePreference положил значение в кэш настроек
      setEdits((e) => {
        const next = { ...e };
        for (const key of done) delete next[key];
        return next;
      });
      refocus.current = ok ? 'status' : 'button';
      setPending(false);
    }
  };

  return (
    <section className="max-w-md">
      <h1 className="mb-6 text-2xl font-bold">Настройки журнала</h1>
      <fieldset disabled={pending}>
        <legend className="sr-only">Колонки</legend>
        {JOURNAL_COLUMNS.map((c) => (
          <label key={c.id} className={rowClass}>
            <span>{c.label}</span>
            <input
              type="checkbox"
              checked={c.fixed || view.columns.includes(c.id)}
              disabled={c.fixed}
              onChange={() => edit({ columns: toggleColumn(view.columns, c.id) })}
            />
          </label>
        ))}
      </fieldset>
      <fieldset disabled={pending} className="mt-4">
        <legend className="sr-only">Строки</legend>
        <div className="border-b border-field py-3">
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>Показывать полностью (до 2 строк)</span>
            <input type="checkbox" aria-describedby={wrapHelpId} checked={view.wrap} onChange={(e) => edit({ wrap: e.target.checked })} />
          </label>
          <p id={wrapHelpId} className="mt-1 pr-8 text-xs text-muted">
            Счёт, контрагент, категория и проект — до 2 строк. На экран поместится меньше операций.
          </p>
        </div>
      </fieldset>
      <fieldset disabled={pending} className="mt-4">
        <legend className="sr-only">Форма операции</legend>
        <label className={rowClass}>
          <span>Спрашивать перед закрытием формы с несохранёнными данными</span>
          <input type="checkbox" checked={view.ask} onChange={(e) => edit({ ask: e.target.checked })} />
        </label>
      </fieldset>
      {error && (
        <p role="alert" className={`${alertClass} mt-4`}>
          {error}
        </p>
      )}
      <p ref={statusRef} tabIndex={-1} role="status" className={status ? 'mt-4 text-sm text-income-strong outline-none' : 'sr-only'}>
        {status}
      </p>
      <button ref={buttonRef} type="button" disabled={pending || changes.length === 0} onClick={() => void apply()} className={`${btnPrimary} mt-6 w-full`}>
        Применить
      </button>
    </section>
  );
}
```

- [ ] **Step 6: Run the tests**

Run: `npx playwright test e2e/dialogs.spec.ts e2e/journal.spec.ts` → PASS.

- [ ] **Step 7: Full check and commit**

Run: `npm test` → PASS. Run: `npm run typecheck`. Run: `npm run test:e2e` дважды → все проходят оба раза.

```bash
git add src/client/lib/journal-view.ts tests/client/journal-view.test.ts src/client/lib/preferences.ts tests/client/preferences.test.ts src/client/pages/settings/JournalViewSettings.tsx e2e/dialogs.spec.ts
git commit -m "feat: «Настройки журнала» как в Finmap; понятная ошибка частичного сохранения; «Применить» считается от сохранённого и не залипает после сбоя

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Визуальная сверка — категории и итоговый прогон экранов настроек

**Files:**
- Modify: `scripts/ux-shots.ts`

**Interfaces:**
- Consumes: «Категории» (задача 1); остальные разделы снимаются существующими сценариями `c26`, `c27`, `c31`, `c33`–`c36`.
- Produces: снимки `c30-settings-categories-full.png`, `c31-cat-my-expense.png`, `c31b-cat-row-hover.png`, `c31c-cat-add.png`; итог сверки плана 1.5-4 в отчёте задачи.

- [ ] **Step 1: Add the scenarios**

В `scripts/ux-shots.ts` в `SCENARIOS` после строки сценария `c30-settings-Категории.png` вставьте:

```ts
  { ours: 'c30-settings-categories-full.png', finmap: '30-settings-categories-full.png', path: 'settings/categories?tab=system-expense' },
  { ours: 'c31-cat-my-expense.png', finmap: '31-cat-my-expense.png', path: 'settings/categories?tab=my-expense' },
  {
    ours: 'c31b-cat-row-hover.png',
    finmap: '31b-cat-row-hover.png',
    path: 'settings/categories?tab=my-expense',
    // наведение только подсвечивает строку: «+» и ✎ видны всегда (03-№22)
    act: (p) => p.getByRole('main').getByRole('list', { name: 'Мои категории расхода' }).getByRole('listitem').nth(1).hover(),
  },
  {
    ours: 'c31c-cat-add.png',
    finmap: '31c-cat-add.png',
    path: 'settings/categories?tab=my-expense',
    act: async (p) => {
      await p.getByRole('main').getByRole('button', { name: 'Добавить категорию' }).click();
      await p.getByRole('dialog', { name: 'Новая категория' }).waitFor();
    },
  },
```

Run: `npm run typecheck` → без ошибок.

- [ ] **Step 2: Run the visual check**

Run: `npm run shots:ux`
Expected: `Готово: …\parity\index.html — снято 46 из 46.` Упавший сценарий — исправьте его локатор и запустите ещё раз.

- [ ] **Step 3: Compare and write the parity note into the task report**

Пары `docs/research/screens/v2/<Finmap>` ↔ `docs/research/screens/v2/parity/<наш>`: `26-company-settings` ↔ `c26-company-settings` (профиль), `27-settings-Мои_компании` ↔ `c27-settings-Мои_компании`, `30-settings-Категории` ↔ `c30-settings-Категории`, `30-settings-categories-full` ↔ `c30-settings-categories-full`, `31-cat-my-expense` ↔ `c31-cat-my-expense`, `31b-cat-row-hover` ↔ `c31b-cat-row-hover`, `31c-cat-add` ↔ `c31c-cat-add`, `31-settings-Проекты` ↔ `c31-settings-Проекты`, `33-settings-Пользователи` ↔ `c33-settings-Пользователи`, `34-settings-rates` ↔ `c34-settings-rates`, `35-settings-backup` ↔ `c35-settings-backup`, `36-settings-log-view` ↔ `c36-settings-log-view`.

В отчёт задачи (не в файл) — таблица по этим экранам: «совпадает / отличается намеренно (почему) / отличается (что исправить, в каком плане)». Ожидаемо:
- **совпадают:** подменю «Системные / Мои × дохода / расхода» с иконками «банк» и «i», «Добавить категорию» над поиском, строки «☰ название полужирно, «+», ✎», подсветка строки при наведении, окно «Новая категория» с одним полем; заголовок «Проекты» и вкладки с подчёркиванием; карточки «Мои компании» с «Баланс на счетах»; «Добавить пользователя» слева вверху; «Добавить свой курс»; «Настройки журнала» строками «подпись — флажок» и «Применить» на всю ширину;
- **отличаются намеренно:** нет «Сотрудников» и «Тарифа» в карточке компании, должностей, «Безопасности», «Применять исторические курсы», «Истории резервных копий» (вне рамок или без сервера); наш блок «Ручные курсы на дату»; пункт «Спрашивать перед закрытием формы»; «Профиль» с именем вместо почты и телефона; цвета и шрифт;
- **отличается, план 1.5-5:** раскладка настроек на телефоне (список разделов отдельным экраном, §8.6).

Контролёр переносит таблицу в файл итогов плана.

- [ ] **Step 4: Final checks**

Run: `npm test` → PASS. Run: `npm run typecheck`. Run: `npm run test:e2e` → все проходят. Проверьте, что встроенных форм и старых кнопок в настройках не осталось: `grep -rn "editingId\|ConfirmDelete" src/client/pages/settings` → пусто.

- [ ] **Step 5: Commit**

```bash
git add scripts/ux-shots.ts
git commit -m "feat: сверка с Finmap — «Категории»: системные и мои, наведение на строку, окно «Новая категория»

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## После плана

- Итоги, отложенные замечания и итог визуальной сверки — `docs/superpowers/followups/2026-10-11-stage1_5-plan4b-followups.md` (пишет контролёр).
- План 1.5-4 закрыт целиком: §7.1–§7.6. Закрыты отложенные: 1.5-1b №5 (текст ошибки «Настроек журнала»), 1.5-2a №5 («Применить» после сбоя), 1.5-1b №4 (лишний пробел в `CompaniesDrawer.tsx`).
- Следующий план — 1.5-5 «Телефон» (§8): шапка, кнопки наверху, `MobileTabBar`, карточка журнала, фильтр в один шаг, список разделов настроек отдельным экраном.
- Замечания для итогов (followups):
  - `ConfirmDelete` остаётся только у файлов формы операции — кандидат на `ConfirmDialog` вне этого этапа;
  - окно «Категория» переносит в конец списка нового родителя; точное место — перетаскиванием в списке;
  - у архивной компании «Мои компании» показывают «—» вместо баланса: сводка `/companies/summary` считает только активные.
