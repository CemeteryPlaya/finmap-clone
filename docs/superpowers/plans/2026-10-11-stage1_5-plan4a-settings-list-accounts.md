# Этап 1.5, план 1.5-4a: экраны настроек — шаблон списка, теги, контрагенты, счета и «Мои счета» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** первая половина плана 1.5-4 из §13 спецификации этапа 1.5:
- цвет текста расхода `expense-strong` во всём приложении (итоги 1.5-3b №1) и настоящие группы в навигации настроек и панели «Настройки» (итоги 1.5-1b №1);
- общий шаблон списка `SettingsList` (§7.1): «Добавить …» под заголовком, «Поиск» во всю ширину, строки «☰ название, серый текст, ✎», перетаскивание за ☰ мышью и касанием, Alt+↑/↓ с объявлением; окно правки с «В архив» / «Вернуть из архива» и «Удалить» через `ConfirmDialog` (решение 4 плана 1.5-1);
- «Теги» и «Контрагенты» с подменю типов (§7.3) на этом шаблоне;
- «Счета» на шаблоне, окно «Добавление нового счёта» с порядком полей Finmap (§7.4);
- «Мои счета» в левой панели: «+ ✎ ⟳», окно «Счета» (`AccountsQuickEdit`), заголовки групп `h3`, без «+ счёт» (§7.6; отложенное 4b №1);
- сверка `npm run shots:ux`: «Добавление нового счёта» из панели, окно «Счета», «Мои контрагенты».

**Предусловие:** выполнен план [1.5-3c](2026-10-11-stage1_5-plan3c-datetime-calculator.md), ветка на 08720e1 или позже. Ожидаемо на старте: `npm test` — 731 тест (+1 пропущен), `npm run test:e2e` — 98.

**Architecture:**
- **Чистая логика списка** — `src/client/lib/settings-list.ts`: что показать (архивные в конце уровня, поиск с родителем найденной подкатегории), группа перестановки (соседи одного уровня без архивных), сдвиг Alt+↑/↓, место вставки при перетаскивании, текст объявления. `src/client/lib/order.ts`: `mergeSubsetOrder` (новый порядок видимой части — на места этих строк в полном порядке сервера), `sortByIds` (оптимистичный порядок в кэше).
- **`SettingsList`** (`components/SettingsList.tsx`) — разметка списка и перетаскивание на событиях указателя (pointer events + `setPointerCapture`): мышь и касание одним кодом. Сервер не меняется: порядок уходит в существующие `POST …/reorder`.
- **Окно правки** — обычный `Modal`; под формой — `EntityActions` (`components/EntityActions.tsx`): «В архив» / «Вернуть из архива», «Удалить» с `ConfirmDialog`. Запросы — хуки `useEntityActions` и `useReorder` (`lib/settings-mutations.ts`).
- **Счёт** — `AccountEditor` (`components/AccountEditor.tsx`): одно содержимое окна для раздела «Счета», «+» левой панели и окна «Счета» (`components/AccountsQuickEdit.tsx`).

**Tech Stack:** как в этапе 1. Новых пакетов нет.

**Spec:** [docs/superpowers/specs/2026-10-10-stage1_5-finmap-ux-design.md](../specs/2026-10-10-stage1_5-finmap-ux-design.md) — §2.4, §2.5, §7.1, §7.3, §7.4 («Счета», «Теги»), §7.6, §11 (`SettingsList`, «+ ✎ ⟳»), §12, §13 (блоки «Решения планирования плана 1.5-1» №4, №5, №7, №9 и «Решения планирования плана 1.5-4»). Аудит: [03-accounts-settings.md](../../research/ux-parity/03-accounts-settings.md) — №8, №9, №11–№15, №22.

**Ветка:** `stage1/plan1-skeleton`. В `main` не сливаем.

## Решения, принятые при планировании

Записаны в спецификацию (§13, блок «Решения планирования плана 1.5-4») тем же коммитом, что и план.

1. **`SettingsList` (§7.1):** строка — `<li>`; ☰ — кнопка «Переместить {название}» с подсказкой про Alt+↑/↓ в `aria-describedby`; ✎ — «Изменить {название}». Перетаскивание — на событиях указателя с захватом за ☰ (`touch-action: none`), без HTML5 drag-and-drop: на касании его нет. Строка двигается только среди соседей своего уровня; архивные не двигаются; при непустом поиске ручек нет (на их месте — бледная иконка). Новый порядок видимой части встаёт в полный порядок сервера на места этих строк (`mergeSubsetOrder`): строки другой вкладки и архивные не сдвигаются. Порядок применяется сразу (оптимистично); если сервер отказал, возвращается прежний, над списком — ошибка. Итог объявляется в живой области: «„Касса“ — место 2 из 3». После Alt+↑/↓ фокус остаётся на ручке той же строки.
2. **Окно правки (§7.1):** «В архив» / «Вернуть из архива» и «Удалить» — отдельным рядом под формой (`EntityActions`). «Удалить» спрашивает `ConfirmDialog` «Удалить {что}?» с текстом «Это нельзя отменить.» и кнопками «Отменить | Удалить». После архива, возврата и удаления окно закрывается; ошибка остаётся в окне, оно не закрывается. Архивный элемент в окне не правится: вместо формы — «В архиве. Чтобы изменить, сначала верните из архива.». Создание — в таком же окне без ряда действий.
3. **Группы навигации (итоги 1.5-1b №1):** группы `SettingsNav` и панели «Настройки» — `role="group"` с `aria-labelledby` на подзаголовок; группа аккаунта без видимого подзаголовка называется «Мой аккаунт» (`ACCOUNT_GROUP_LABEL`). Списки `ul` там не используются: роль `listitem` ищут e2e разделов.
4. **Цвет расхода (итоги 1.5-3b №1):** токен `expense-strong` = #b83a26 — 5,7:1 на белом, 4,8:1 на `expense-soft`, 5,0:1 на `field`. Им пишется любой текст цвета расхода: суммы, «Удалить платёж», `btnDanger`, ошибки, отрицательные остатки. `text-expense` для текста больше нет (тест `tests/client/theme.test.ts`); фоны `bg-expense`, `bg-expense-soft` и `expense-on-dark` не меняются.
5. **«Контрагенты» (§7.3):** подменю — ссылки `?type=` с `aria-current="page"`; у типов системных категорий иконка «банк», у «Моих контрагентов» — «i»; счётчик — число контрагентов типа, включая архивных. Окна: «Новый инвестор / кредитор / заёмщик / сотрудник / владелец / тип налога / контрагент», при правке — «Инвестор», …, «Контрагент». Тип выбирается только в «Моих» (переключатель «Клиент / Поставщик», по умолчанию «Клиент»). Серый текст строки — тип (только в «Моих») и комментарий; поиск — по названию и комментарию. Создание закрывает окно.
6. **«Счета» (§7.4):** список без групп по клубам (группы остаются в левой панели); серый текст — «{Клуб} · ₸ 114 997» (текущий баланс), у общего счёта — только баланс. Поля окна: «Валюта», «Название счёта», «Стартовый баланс» (подсказка «Остаток на дату открытия счёта»), «Проект», «Дата открытия»; начальный фокус — на «Валюте» (первое поле, как в Finmap). Кнопка создания — «Создать счёт».
7. **«Мои счета» (§7.6):** заголовок `h2` «Мои счета» и справа «+» «Добавить счёт», ✎ «Изменить счета», ⟳ «Обновить»; у архивной компании — только ⟳. ⟳ — `refreshOperations`; итог в живой области: «Данные обновлены», сбой виден: «Не удалось обновить журнал». Окно «Счета» — список без поиска; ✎ и «Добавить счёт» переключают окно на форму с «← Назад»; после сохранения, архива и удаления — снова список, фокус на ✎ этого счёта или на «Добавить счёт». Ссылка «+ счёт» убрана; e2e «зоны настроек» больше не проверяет фокус после неё (поведение удалено).

## Global Constraints

- **Принцип (§1):** «расположение и приёмы как в Finmap, внешний вид свой; где наше лучше — оставляем». Оставляем: счета в панели сгруппированы по клубам, красный отрицательный остаток, клик по счёту фильтрует журнал. **Мёртвых кнопок нет:** элемента без действия не показываем — ни заглушкой, ни неактивным.
- **Шаблон списка (§7.1):** порядок на странице — заголовок раздела; под ним слева главная кнопка «Добавить …»; поле «Поиск» на всю ширину (`matchesQuery`); список. Строка: ручка ☰, название, серый вторичный текст, справа ✎ (`aria-label="Изменить {название}"`); без рамки, разделитель снизу, подсветка при наведении; иконки видны всегда. Перетаскивание за ☰ — мышью и касанием; с клавиатуры — Alt+↑ и Alt+↓ на ручке, подсказка через `aria-describedby`, итог объявляется в живой области; порядок — в существующий `POST …/reorder`; при непустом поиске перетаскивание отключено. ✎ открывает окно правки: поля формы; внизу «В архив» или «Вернуть из архива» и «Удалить» (через `ConfirmDialog`); «Сохранить» и «Отмена». Создание — в таком же окне. Архивные — в конце списка, приглушённые, с пометкой «в архиве». `ReorderButtons` на строках и встроенные формы `editingId` убираются.
- **Контрагенты (§7.3):** подменю слева в порядке Finmap: Инвесторы, Кредиторы, Заёмщики, Сотрудники, Владельцы, Типы налогов, Мои контрагенты (по умолчанию; `client` + `supplier`); кнопки «Добавить инвестора», «Добавить кредитора», «Добавить заёмщика», «Добавить сотрудника», «Добавить владельца», «Добавить тип налога», «Добавить контрагента». В «Моих» тип («Клиент» или «Поставщик») — серым в строке, в окне — переключатель, по умолчанию «Клиент». Окно: «Название», «Комментарий»; у «Моих» — ещё «Тип». Вкладки «Все» нет. Адрес: `?type=investor|creditor|borrower|employee|owner|tax|my`, неверное значение — `my`.
- **Счета (§7.4):** `SettingsList`, «Добавить счёт» → окно «Добавление нового счёта»; порядок полей `AccountForm`: Валюта, Название, Стартовый баланс, затем Проект и Дата открытия; вторичный текст «{Клуб} · ₸ 114 997»; правка, архив и блокировки — по правилам этапа 1 (валюта при операциях, архив только при нулевом балансе, удаление без операций).
- **«Мои счета» (§7.6):** «Всего на счетах» крупно (`text-2xl`), предупреждение «курс X недоступен» — как сейчас; строка «Мои счета» и справа «+» (окно «Добавление нового счёта» прямо над журналом), «✎» (окно «Счета»: «Добавить счёт», список ☰ имя ✎; ✎ переключает это же окно на `AccountForm` с «← Назад»), «⟳» (§2.5: `refreshOperations`). Счета сгруппированы по клубам; если группа одна, её заголовок не показывается; заголовки групп — `h3`. Баланс «₸ 114 997», отрицательный — красным. Нижней «+ счёт» нет.
- **Окна (§2.4, §11):** `Modal` — «×», Esc, фокус при закрытии на открывшую кнопку, а если её нет — на `<h1>`. `ConfirmDialog` — «Отменить | Удалить», фокус на «Отменить», Esc закрывает только его.
- **Деньги:** на экране — `formatMoney(…, MONEY_SCREEN | MONEY_SCREEN_BEFORE)`; поля ввода — как сейчас.
- **Терминология:** «Категория», никогда «Статья».
- **Без новых npm-пакетов.** Сервер и схема БД не меняются.
- **Невидимые символы** (U+2212, U+202F, U+00A0, U+200B) в коде — только экранированием `\u2212` и т. п.; после записи файла проверьте, что экранирование не превратилось в символ.
- **Концы строк:** рабочая копия в CRLF (`core.autocrlf=true`). Правки «найдите → замените» — инструментом правки файлов; массовая замена в задаче 1 — скриптом `node`, который сохраняет концы строк.
- **E2E:** порт 41731 (`E2E_PORT`), APP_TIMEZONE e2e-сервера — `Asia/Almaty`; один пользователь `admin`/`e2e-password-1` и одна база на прогон; `name:` в Playwright — подстрока без учёта регистра (точное совпадение — `exact: true`); данные — через `page.request` с `origin` и `x-requested-with: fetch`; общие настройки пользователя восстанавливаются в `try/finally` точно к прежнему значению; без фиксированных пауз. `journal-actions.spec.ts:555` — известный нестабильный тест: при падении только его перезапустите прогон.
- **Безопасность среды (обязательно):**
  - никогда не запускайте `npm start`, `npm run stop`, `npm run setup`, `npm run service:install`, `npm run service:uninstall`, `schtasks` и `icacls` — ни в каком виде: на порту 3457 работает живое приложение пользователя, на порту 3460 — демо-экземпляр, их не трогайте;
  - e2e идут на порту 41731 со своей временной базой; `npm run shots:ux` — на порту 41741 со своей временной папкой;
  - shell-команды не содержат подстроку «.env».
- **Завершение задачи:** зелёные `npm test`, `npm run typecheck` и `npm run test:e2e`; если задача меняет e2e — `npm run test:e2e` дважды подряд. Коммит с трейлером `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. В коммит попадает каждый новый файл задачи.

## Review Focus

1. **Перестановка в части списка** (вкладка «Сотрудники» среди всех контрагентов; архивный тег между активными): строки, которых не видно, сохраняют свои места в общем порядке сервера, двигается только видимая группа. Тесты — задача 2 (unit `mergeSubsetOrder`) и задача 4 (e2e: порядок всех контрагентов из API после Alt+↑ в «Сотрудниках»).
2. **Сервер отклонил новый порядок** (409 «Список изменился — обновите страницу и повторите»): список возвращается к прежнему порядку, над ним — ошибка. Тест — задача 3 (e2e с подменённым ответом).
3. **«Удалить» не прошло** (тег стоит на операции): подтверждение закрывается, окно правки остаётся с ошибкой, фокус — на «Удалить». Тест — задача 3 (e2e).
4. **«В архив» счёта с ненулевым балансом:** ошибка в окне, окно открыто, форму можно поправить и сохранить. Тест — задача 5 (e2e).
5. **Края перестановки:** Alt+↑ на первой строке и Alt+↓ на последней ничего не меняют; у архивной строки и при непустом поиске ручек нет; одна строка в группе не перетаскивается. Тесты — задача 2 (unit `shiftInGroup`, `moveGroup`) и задача 3 (e2e).

---

## Карта файлов

```
src/client/styles.css                               # --color-expense-strong
src/client/**/*.ts, *.tsx                           # text-expense → text-expense-strong (скрипт)
src/client/lib/settings-sections.ts                 # ACCOUNT_GROUP_LABEL
src/client/pages/settings/SettingsNav.tsx           # группы role="group"
src/client/components/SettingsMenuDrawer.tsx        # группы role="group"
src/client/lib/order.ts                             # mergeSubsetOrder, sortByIds
src/client/lib/settings-list.ts                     # (новый) SettingsRow, visibleRows, moveGroup, shiftInGroup, dropIndexAt, dropInGroup, movedText
src/client/lib/settings-mutations.ts                # (новый) useReorder, useEntityActions
src/client/lib/counterparty-tabs.ts                 # (новый) вкладки контрагентов
src/client/lib/accounts-panel.ts                    # accountSecondary, showGroupTitles
src/client/components/icons.tsx                     # GripIcon, PlusIcon, BankIcon, InfoIcon
src/client/components/SettingsList.tsx              # (новый)
src/client/components/EntityActions.tsx             # (новый) EntityActions, ArchivedNote
src/client/components/SettingsSubmenu.tsx           # (новый)
src/client/components/AccountForm.tsx               # порядок полей, одна колонка
src/client/components/AccountEditor.tsx             # (новый)
src/client/components/AccountsQuickEdit.tsx         # (новый)
src/client/components/AccountsPanel.tsx             # «Мои счета» + ✎ ⟳, h3, окна
src/client/pages/settings/TagsSettings.tsx          # на шаблоне списка
src/client/pages/settings/CounterpartiesSettings.tsx# подменю типов
src/client/pages/settings/AccountsSettings.tsx      # на шаблоне списка
scripts/ux-shots.ts                                 # c21, c22, c28c
tests/client/theme.test.ts (новый), settings-list.test.ts (новый), counterparty-tabs.test.ts (новый), order.test.ts, accounts-panel.test.ts, settings-sections.test.ts
e2e/auth.spec.ts, dictionaries.spec.ts, service-screens.spec.ts, money.spec.ts, mobile.spec.ts, accounts-panel.spec.ts (новый)
```

---

### Task 1: Цвет текста расхода `expense-strong` и группы в навигации настроек

**Files:**
- Create: `tests/client/theme.test.ts`
- Modify: `src/client/styles.css`, все `src/client/**/*.ts(x)` с `text-expense` (скрипт), `src/client/components/ui.ts` (комментарий), `src/client/lib/settings-sections.ts`, `src/client/pages/settings/SettingsNav.tsx`, `src/client/components/SettingsMenuDrawer.tsx`
- Test: `tests/client/theme.test.ts`, `tests/client/settings-sections.test.ts`, `e2e/auth.spec.ts`, `e2e/dictionaries.spec.ts`

**Interfaces:**
- Consumes: `settingsGroups` (`lib/settings-sections.ts`).
- Produces: класс `text-expense-strong` (токен `--color-expense-strong: #b83a26`) — его используют все следующие задачи для текста ошибок и кнопки «Удалить»; `ACCOUNT_GROUP_LABEL = 'Мой аккаунт'` (`lib/settings-sections.ts`).

- [ ] **Step 1: Write the failing tests**

Создайте `tests/client/theme.test.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = fs.readFileSync('src/client/styles.css', 'utf8');

function color(name: string): string {
  const m = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, 'i'));
  if (!m) throw new Error(`Нет цвета --color-${name}`);
  return m[1]!;
}

/** Относительная яркость и контраст по WCAG 2.x. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? sources(p) : /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe('цвета текста — контраст не меньше 4,5:1 (§11 этапа 1.5)', () => {
  it('expense-strong — на белом, на expense-soft и на field (итоги 1.5-3b №1)', () => {
    for (const bg of ['card', 'expense-soft', 'field']) expect(contrast(color('expense-strong'), color(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it('income-strong — на белом и на income-soft', () => {
    for (const bg of ['card', 'income-soft']) expect(contrast(color('income-strong'), color(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it('expense для мелкого текста не годится, поэтому текст расхода — только expense-strong', () => {
    expect(contrast(color('expense'), color('card'))).toBeLessThan(4.5);
    const offenders = sources('src/client').flatMap((file) =>
      fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, i) => (/\btext-expense(?![-\w])/.test(line) ? [`${file}:${i + 1}`] : [])),
    );
    expect(offenders).toEqual([]);
  });
});
```

В `tests/client/settings-sections.test.ts` в импорт из `'../../src/client/lib/settings-sections'` добавьте `ACCOUNT_GROUP_LABEL`, а в конец блока `describe('навигация зоны настроек (§4.2 этапа 1.5)', …)` (перед его закрывающей `});`) добавьте:

```ts
  it('группа аккаунта без подзаголовка называется «Мой аккаунт» — как в панели «Настройки» (итоги 1.5-1b №1)', () => {
    expect(ACCOUNT_GROUP_LABEL).toBe('Мой аккаунт');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/client/theme.test.ts tests/client/settings-sections.test.ts`
Expected: FAIL — «Нет цвета --color-expense-strong», список файлов с `text-expense`, `ACCOUNT_GROUP_LABEL` не определён.

- [ ] **Step 3: Add the token and replace the class everywhere**

В `src/client/styles.css` после строки `  --color-expense-soft: #fde7e2;` вставьте:

```css
  --color-expense-strong: #b83a26; /* любой текст цвета расхода: 5,7:1 на белом, 4,8:1 на expense-soft, 5,0:1 на field (итоги 1.5-3b №1) */
```

Замените класс во всех исходниках клиента (скрипт сохраняет концы строк и печатает изменённые файлы):

```bash
node -e 'const fs=require("fs"),path=require("path");const walk=(d)=>fs.readdirSync(d,{withFileTypes:true}).flatMap((e)=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);for(const f of walk("src/client").filter((f)=>/\.tsx?$/.test(f))){const s=fs.readFileSync(f,"utf8");const t=s.replace(/\btext-expense(?![-\w])/g,"text-expense-strong");if(t!==s){fs.writeFileSync(f,t);console.log(f);}}'
```

Expected: около 30 файлов, среди них `components/ui.ts`, `components/operation/ActionRow.tsx`, `components/journal/JournalTable.tsx`, `components/journal/JournalCards.tsx`, `components/HistoryDrawer.tsx`, `components/AccountsPanel.tsx`, `components/Field.tsx`. `bg-expense`, `bg-expense-soft`, `text-expense-on-dark` скрипт не трогает.

В `src/client/components/ui.ts` над строкой `export const btnDanger = …` добавьте комментарий:

```ts
/** Разрушительное действие: текст expense-strong на expense-soft — 4,8:1 (итоги 1.5-3b №1). */
```

- [ ] **Step 4: Group label constant**

В `src/client/lib/settings-sections.ts` после `export const SHARED_NOTE = 'Общие для всех компаний';` добавьте:

```ts
/** Имя группы аккаунта (Профиль, Мои компании): видимого подзаголовка у неё нет, а группе нужно имя (итоги 1.5-1b №1). */
export const ACCOUNT_GROUP_LABEL = 'Мой аккаунт';
```

Run: `npx vitest run tests/client/theme.test.ts tests/client/settings-sections.test.ts` → PASS.

- [ ] **Step 5: Real groups in `SettingsNav`**

В `src/client/pages/settings/SettingsNav.tsx`:
- первую строку `import { Link, NavLink } from 'react-router';` замените на две:

```tsx
import { useId } from 'react';
import { Link, NavLink } from 'react-router';
```

- импорт `import { settingsGroups } from '../../lib/settings-sections';` замените на:

```tsx
import { ACCOUNT_GROUP_LABEL, settingsGroups } from '../../lib/settings-sections';
```

- функцию `SettingsNavBody` целиком замените на:

```tsx
function SettingsNavBody(props: { companyId: number; companyName: string; back: string; sidebar: boolean }) {
  const id = useId();
  return (
    <>
      <BackLink to={props.back} />
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
            <div className={props.sidebar ? 'grid gap-0.5' : 'flex flex-wrap gap-1'}>
              {g.items.map((s) => (
                <NavLink key={s.path} to={`/c/${props.companyId}/settings/${s.path}`} className={props.sidebar ? sidebarLink : inlineLink}>
                  {s.label}
                </NavLink>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}
```

- [ ] **Step 6: Real groups in the «Настройки» drawer**

В `src/client/components/SettingsMenuDrawer.tsx`:
- строку `import { useRef, useState, type MouseEvent, type ReactNode } from 'react';` замените на:

```tsx
import { useId, useRef, useState, type MouseEvent, type ReactNode } from 'react';
```

- после строки `import { queryClient, useMe } from '../lib/query';` добавьте:

```tsx
import { ACCOUNT_GROUP_LABEL } from '../lib/settings-sections';
```

- функцию `Group` замените на:

```tsx
function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  // группа ссылок с именем-подзаголовком (итоги 1.5-1b №1)
  return (
    <div role="group" aria-labelledby={id} className="mb-4">
      <p id={id} className="mb-1 truncate px-3 text-xs font-semibold uppercase tracking-wide text-muted">
        {title}
      </p>
      {children}
    </div>
  );
}
```

- `<Group title="Мой аккаунт">` замените на `<Group title={ACCOUNT_GROUP_LABEL}>`.

- [ ] **Step 7: E2E — groups are announced**

В `e2e/auth.spec.ts` в тесте «панель «Настройки» на странице компании…» после строки

```ts
  await expect(menu.getByRole('link')).toHaveText([/^Профиль/, /^Мои компании/, /^Пользователи/, /^Настройки компании/]);
```

добавьте:

```ts
  // группы — настоящие группы с подписью (итоги 1.5-1b №1)
  await expect(menu.getByRole('group', { name: 'Мой аккаунт' }).getByRole('link')).toHaveText([/^Профиль/, /^Мои компании/]);
  await expect(menu.getByRole('group', { name: `Моя компания: ${name}` }).getByRole('link')).toHaveText([/^Пользователи/, /^Настройки компании/]);
```

В `e2e/dictionaries.spec.ts` в тесте «зона настроек: …» после строки `  await expect(nav).toContainText('Визуальные настройки');` добавьте:

```ts
  // группы навигации — с именами (итоги 1.5-1b №1)
  await expect(nav.getByRole('group', { name: 'Мой аккаунт' }).getByRole('link')).toHaveText(['Профиль', 'Мои компании']);
  await expect(nav.getByRole('group', { name }).getByRole('link')).toHaveText([
    'Контрагенты',
    'Счета',
    'Категории',
    'Проекты',
    'Теги',
    'Пользователи',
    'Фиксированные курсы валют',
    'Резервное копирование',
  ]);
  await expect(nav.getByRole('group', { name: 'Визуальные настройки' }).getByRole('link')).toHaveText(['Настройки журнала']);
```

- [ ] **Step 8: Full check and commit**

Run: `npm test` → PASS. Run: `npm run typecheck`. Run: `npm run test:e2e` дважды → все проходят оба раза.

```bash
git add src/client tests/client/theme.test.ts tests/client/settings-sections.test.ts e2e/auth.spec.ts e2e/dictionaries.spec.ts
git commit -m "feat: цвет текста расхода expense-strong во всём приложении; группы навигации настроек с именами

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Логика шаблона списка — что показать и как переставить

**Files:**
- Create: `src/client/lib/settings-list.ts`, `tests/client/settings-list.test.ts`
- Modify: `src/client/lib/order.ts`, `tests/client/order.test.ts`

**Interfaces:**
- Consumes: `matchesQuery` (`shared/search.ts`).
- Produces:
  - `interface SettingsRow { id: number; name: string; secondary?: string; note?: string; searchText?: string; archived: boolean; parentId?: number | null }`;
  - `visibleRows<T extends SettingsRow>(rows: readonly T[], query: string): T[]`;
  - `moveGroup(shown: readonly SettingsRow[], id: number): number[]`;
  - `shiftInGroup(group: readonly number[], id: number, delta: -1 | 1): number[] | null`;
  - `dropIndexAt(midpoints: readonly number[], y: number): number`;
  - `dropInGroup(group: readonly number[], id: number, index: number): number[] | null`;
  - `movedText(name: string, group: readonly number[], id: number): string`;
  - `mergeSubsetOrder(full: readonly number[], subset: readonly number[]): number[]`, `sortByIds<T extends { id: number }>(list: readonly T[], ids: readonly number[]): T[]` (`lib/order.ts`).

- [ ] **Step 1: Write the failing tests**

В `tests/client/order.test.ts` импорт замените на `import { mergeSubsetOrder, moveWithinGroup, sortByIds } from '../../src/client/lib/order';` и добавьте в конец файла:

```ts
describe('mergeSubsetOrder — порядок видимой части в полном списке (§7.1 этапа 1.5, Review Focus 1)', () => {
  it('строки подмножества встают на свои прежние места в новом порядке, остальные не двигаются', () => {
    expect(mergeSubsetOrder([1, 2, 3, 4, 5], [4, 2])).toEqual([1, 4, 3, 2, 5]);
    // архивный 3 между активными остаётся на месте
    expect(mergeSubsetOrder([1, 3, 2, 4], [4, 2, 1])).toEqual([4, 3, 2, 1]);
  });

  it('тот же порядок — тот же список; чужие id подмножества пропускаются', () => {
    expect(mergeSubsetOrder([1, 2, 3], [1, 2, 3])).toEqual([1, 2, 3]);
    expect(mergeSubsetOrder([1, 2, 3], [9, 3, 1])).toEqual([3, 2, 1]);
  });
});

describe('sortByIds — оптимистичный порядок в кэше', () => {
  it('по списку id; не названные — в конце в прежнем порядке', () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    expect(sortByIds(rows, [3, 1]).map((r) => r.id)).toEqual([3, 1, 2, 4]);
    expect(sortByIds(rows, [4, 3, 2, 1]).map((r) => r.id)).toEqual([4, 3, 2, 1]);
  });
});
```

Создайте `tests/client/settings-list.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { dropIndexAt, dropInGroup, moveGroup, movedText, shiftInGroup, visibleRows, type SettingsRow } from '../../src/client/lib/settings-list';

const row = (id: number, name: string, extra: Partial<SettingsRow> = {}): SettingsRow => ({ id, name, archived: false, ...extra });
const ids = (rows: SettingsRow[]) => rows.map((r) => r.id);

describe('visibleRows — что показывает список (§7.1, §7.2 этапа 1.5)', () => {
  it('архивные — в конце своего уровня, порядок внутри сохраняется', () => {
    const rows = [row(1, 'А', { archived: true }), row(2, 'Б'), row(3, 'В'), row(4, 'Г', { archived: true })];
    expect(ids(visibleRows(rows, ''))).toEqual([2, 3, 1, 4]);
  });

  it('подкатегории — сразу под родителем, архивные — в конце среди своих', () => {
    const rows = [
      row(1, 'Реклама'),
      row(2, 'Аренда'),
      row(10, 'Таргет', { parentId: 1, archived: true }),
      row(11, 'Баннеры', { parentId: 1 }),
      row(20, 'Зал', { parentId: 2 }),
    ];
    expect(ids(visibleRows(rows, ''))).toEqual([1, 11, 10, 2, 20]);
  });

  it('поиск без учёта регистра и «ё», по названию и по searchText; пробелы — пустой запрос', () => {
    const rows = [row(1, 'Ёлка'), row(2, 'ИП Иванов', { searchText: 'аренда зала' }), row(3, 'Бар')];
    expect(ids(visibleRows(rows, 'ЕЛК'))).toEqual([1]);
    expect(ids(visibleRows(rows, 'зала'))).toEqual([2]);
    expect(ids(visibleRows(rows, '  '))).toEqual([1, 2, 3]);
  });

  it('найденная подкатегория — вместе с родителем; у найденного родителя ненайденные дочерние скрыты', () => {
    const rows = [row(1, 'Реклама'), row(10, 'Таргет', { parentId: 1 }), row(11, 'Баннеры', { parentId: 1 }), row(2, 'Аренда')];
    expect(ids(visibleRows(rows, 'тарг'))).toEqual([1, 10]);
    expect(ids(visibleRows(rows, 'рекл'))).toEqual([1]);
  });

  it('подкатегория, чьего родителя нет в списке, — на верхнем уровне', () => {
    expect(ids(visibleRows([row(10, 'Таргет', { parentId: 99 }), row(1, 'Бар')], ''))).toEqual([10, 1]);
  });
});

describe('moveGroup — соседи одного уровня без архивных (Review Focus 5)', () => {
  const shown = visibleRows(
    [row(1, 'А'), row(10, 'А1', { parentId: 1 }), row(11, 'А2', { parentId: 1 }), row(2, 'Б'), row(3, 'В', { archived: true })],
    '',
  );

  it('верхний уровень и дочерние одного родителя — разные группы', () => {
    expect(moveGroup(shown, 2)).toEqual([1, 2]);
    expect(moveGroup(shown, 11)).toEqual([10, 11]);
  });

  it('архивная и неизвестная строка не двигаются', () => {
    expect(moveGroup(shown, 3)).toEqual([]);
    expect(moveGroup(shown, 99)).toEqual([]);
  });
});

describe('shiftInGroup — Alt+↑ / Alt+↓', () => {
  it('сдвиг на одно место', () => {
    expect(shiftInGroup([1, 2, 3], 2, -1)).toEqual([2, 1, 3]);
    expect(shiftInGroup([1, 2, 3], 2, 1)).toEqual([1, 3, 2]);
  });

  it('на краю группы и не из группы — null (Review Focus 5)', () => {
    expect(shiftInGroup([1, 2, 3], 1, -1)).toBeNull();
    expect(shiftInGroup([1, 2, 3], 3, 1)).toBeNull();
    expect(shiftInGroup([1, 2, 3], 9, 1)).toBeNull();
  });
});

describe('перетаскивание за ☰', () => {
  it('dropIndexAt — сколько середин строк выше указателя', () => {
    expect(dropIndexAt([100, 140, 180], 90)).toBe(0);
    expect(dropIndexAt([100, 140, 180], 120)).toBe(1);
    expect(dropIndexAt([100, 140, 180], 500)).toBe(3);
    expect(dropIndexAt([], 10)).toBe(0);
  });

  it('dropInGroup — новый порядок; то же место и строка не из группы — null', () => {
    expect(dropInGroup([1, 2, 3], 3, 0)).toEqual([3, 1, 2]);
    expect(dropInGroup([1, 2, 3], 1, 2)).toEqual([2, 3, 1]);
    expect(dropInGroup([1, 2, 3], 1, 99)).toEqual([2, 3, 1]);
    expect(dropInGroup([1, 2, 3], 2, 1)).toBeNull();
    expect(dropInGroup([1, 2, 3], 9, 0)).toBeNull();
  });
});

describe('movedText — объявление нового места', () => {
  it('«Касса» — место 2 из 3', () => {
    expect(movedText('Касса', [5, 7, 9], 7)).toBe('«Касса» — место 2 из 3');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/client/order.test.ts tests/client/settings-list.test.ts`
Expected: FAIL — `mergeSubsetOrder`, `sortByIds` не экспортированы, модуля `settings-list` нет.

- [ ] **Step 3: `lib/order.ts`**

Добавьте в конец `src/client/lib/order.ts`:

```ts
/**
 * Полный порядок после перестановки видимой части (§7.1 этапа 1.5): строки subset занимают в full свои прежние
 * места, но в новом порядке; остальные (другая вкладка, архивные) не двигаются. id не из full пропускаются.
 */
export function mergeSubsetOrder(full: readonly number[], subset: readonly number[]): number[] {
  const known = new Set(full);
  const queue = subset.filter((id) => known.has(id));
  const moving = new Set(queue);
  return full.map((id) => (moving.has(id) ? queue.shift()! : id));
}

/** Список в порядке ids (оптимистичный порядок в кэше); не названные — в конце в прежнем порядке. */
export function sortByIds<T extends { id: number }>(list: readonly T[], ids: readonly number[]): T[] {
  const pos = new Map(ids.map((id, i) => [id, i]));
  const at = (id: number) => pos.get(id) ?? ids.length;
  return [...list].sort((a, b) => at(a.id) - at(b.id));
}
```

- [ ] **Step 4: `lib/settings-list.ts`**

Создайте `src/client/lib/settings-list.ts`:

```ts
import { matchesQuery } from '../../shared/search';

/** Строка списка зоны настроек (§7.1 этапа 1.5). */
export interface SettingsRow {
  id: number;
  name: string;
  /** Серый текст в строке: тип и комментарий контрагента, клуб и баланс счёта. */
  secondary?: string;
  /** Пометка вместо «в архиве» («отключён»). */
  note?: string;
  /** Что ещё ищет «Поиск», кроме названия (комментарий контрагента). */
  searchText?: string;
  /** В архиве: в конце своего уровня, приглушена, не перетаскивается. */
  archived: boolean;
  /** Родитель подкатегории (§7.2): строка — с отступом сразу под ним. Нет — верхний уровень. */
  parentId?: number | null;
}

const parentOf = (r: SettingsRow): number | null => r.parentId ?? null;

const matches = (r: SettingsRow, query: string) => matchesQuery(r.searchText ? `${r.name} ${r.searchText}` : r.name, query);

const activeFirst = <T extends SettingsRow>(rows: readonly T[]): T[] => [...rows.filter((r) => !r.archived), ...rows.filter((r) => r.archived)];

/**
 * Строки в порядке показа: верхний уровень, под каждой строкой — её дочерние; архивные — в конце своего уровня.
 * С запросом — найденные (без учёта регистра и «ё») и родители найденных подкатегорий (§7.2).
 */
export function visibleRows<T extends SettingsRow>(rows: readonly T[], query: string): T[] {
  const present = new Set(rows.map((r) => r.id));
  const isTop = (r: T) => {
    const p = parentOf(r);
    return p === null || !present.has(p);
  };
  const q = query.trim();
  const out: T[] = [];
  for (const top of activeFirst(rows.filter(isTop))) {
    const children = activeFirst(rows.filter((r) => !isTop(r) && parentOf(r) === top.id)).filter((c) => q === '' || matches(c, q));
    if (q !== '' && !matches(top, q) && children.length === 0) continue;
    out.push(top, ...children);
  }
  return out;
}

/** Кого можно переставлять вместе со строкой id: соседи её уровня без архивных, в порядке показа. Архивная — []. */
export function moveGroup(shown: readonly SettingsRow[], id: number): number[] {
  const present = new Set(shown.map((r) => r.id));
  const level = (r: SettingsRow) => {
    const p = parentOf(r);
    return p !== null && present.has(p) ? p : null;
  };
  const target = shown.find((r) => r.id === id);
  if (!target || target.archived) return [];
  const lv = level(target);
  return shown.filter((r) => !r.archived && level(r) === lv).map((r) => r.id);
}

/** Alt+↑ / Alt+↓: новый порядок группы; на краю и не из группы — null. */
export function shiftInGroup(group: readonly number[], id: number, delta: -1 | 1): number[] | null {
  const i = group.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= group.length) return null;
  const next = [...group];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/** Куда встанет перетаскиваемая строка: midpoints — середины остальных строк группы сверху вниз. */
export function dropIndexAt(midpoints: readonly number[], y: number): number {
  return midpoints.filter((m) => m < y).length;
}

/** Строку id отпустили на место index среди остальных строк группы: новый порядок; то же место — null. */
export function dropInGroup(group: readonly number[], id: number, index: number): number[] | null {
  if (!group.includes(id)) return null;
  const others = group.filter((x) => x !== id);
  const at = Math.max(0, Math.min(index, others.length));
  const next = [...others.slice(0, at), id, ...others.slice(at)];
  return next.every((x, i) => x === group[i]) ? null : next;
}

/** Объявление после перестановки: «Касса» — место 2 из 3. */
export function movedText(name: string, group: readonly number[], id: number): string {
  return `«${name}» — место ${group.indexOf(id) + 1} из ${group.length}`;
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/client/order.test.ts tests/client/settings-list.test.ts` → PASS.

- [ ] **Step 6: Full check and commit**

Run: `npm test` → PASS. Run: `npm run typecheck`.

```bash
git add src/client/lib/order.ts src/client/lib/settings-list.ts tests/client/order.test.ts tests/client/settings-list.test.ts
git commit -m "feat: логика шаблона списка настроек — архивные в конце, поиск с родителем, перестановка в группе

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `SettingsList`, окно правки с `EntityActions` и «Теги» на шаблоне

**Files:**
- Create: `src/client/components/SettingsList.tsx`, `src/client/components/EntityActions.tsx`, `src/client/lib/settings-mutations.ts`
- Modify: `src/client/components/icons.tsx`, `src/client/pages/settings/TagsSettings.tsx` (полная замена)
- Test: `e2e/dictionaries.spec.ts`, `e2e/service-screens.spec.ts`

**Interfaces:**
- Consumes: `SettingsRow`, `visibleRows`, `moveGroup`, `shiftInGroup`, `dropIndexAt`, `dropInGroup`, `movedText` (задача 2); `mergeSubsetOrder`, `sortByIds` (задача 2); `ConfirmDialog`, `Modal`, `Field`.
- Produces:
  - `SettingsList<T extends SettingsRow>(props: { label: string; rows: readonly T[]; addLabel: string | null; onAdd?: () => void; search?: boolean; onReorder?: (group: number[], movedId: number) => void; onEdit?: (row: T) => void; canEdit?: (row: T) => boolean; actions?: (row: T) => ReactNode; strong?: (row: T) => boolean; empty: string })` — кнопка «Добавить» помечена `data-settings-add`, ✎ — `data-edit-id={id}`;
  - `EntityActions(props: { archived?: boolean; onArchiveToggle?: () => void; what: string; onDelete?: () => Promise<boolean>; pending: boolean; error: string | null })`, `ArchivedNote()`;
  - `useReorder<T extends { id: number }>(queryKey: QueryKey, path: string, onError: (message: string | null) => void)` — мутация с аргументом `number[]` (полный порядок);
  - `useEntityActions(path: string, refresh: () => Promise<unknown>, onDone: () => void): { pending: boolean; error: string | null; toggleArchive: (archived: boolean) => void; remove: () => Promise<boolean> }`;
  - `GripIcon` (`icons.tsx`).

- [ ] **Step 1: Write the failing e2e tests**

В `e2e/dictionaries.spec.ts` после строки `const section = (page: Page, name: string) => …;` добавьте:

```ts
const csrf = (page: Page) => ({ origin: new URL(page.url()).origin, 'x-requested-with': 'fetch' });

/** Запрос к API от имени вошедшего пользователя: кука сессии браузера и заголовки защиты от подделки. */
async function apiPost(page: Page, url: string, data: unknown) {
  const res = await page.request.post(url, { data, headers: csrf(page) });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return res.json();
}

const minuteAgo = () => new Date(Date.now() - 60_000).toISOString();
```

В тесте «контрагенты по вкладкам и поиск; тег с именем архивного предлагает вернуть его» название замените на `'контрагенты по вкладкам и поиск'`, а весь хвост теста от строки `  await section(page, 'Теги').click();` до закрывающей `});` теста (часть про теги переезжает в новые тесты) замените на одну строку `});`. Удаляемый хвост:

```ts
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
```

Добавьте в конец `e2e/dictionaries.spec.ts` два теста:

```ts
test('шаблон списка на «Тегах»: добавить, ✎, архив и возврат, удалить через подтверждение, поиск; имя архивного тега предлагает вернуть его', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Теги ${Date.now()}`);
  await page.goto(`/c/${cid}/settings/tags`);
  const main = page.getByRole('main');
  const list = main.getByRole('list', { name: 'Теги' });
  const row = (name: string) => list.getByRole('listitem').filter({ hasText: name });
  const add = main.getByRole('button', { name: 'Добавить тег' });
  const dialog = page.getByRole('dialog', { name: 'Новый тег' });
  const edit = page.getByRole('dialog', { name: 'Тег', exact: true });

  // «Добавить тег» → окно «Новый тег», фокус в поле
  for (const name of ['Ёлка', 'Аренда', 'Бар']) {
    await add.click();
    await expect(dialog.getByLabel('Название тега')).toBeFocused();
    await dialog.getByLabel('Название тега').fill(name);
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(dialog).toBeHidden();
  }
  await expect(list.getByRole('listitem')).toHaveText([/Ёлка/, /Аренда/, /Бар/]);

  // ✎ — окно «Тег»: переименование, фокус возвращается на ✎
  await list.getByRole('button', { name: 'Изменить Аренда', exact: true }).click();
  await edit.getByLabel('Название тега').fill('Аренда зала');
  await edit.getByRole('button', { name: 'Сохранить' }).click();
  await expect(edit).toBeHidden();
  await expect(list.getByRole('button', { name: 'Изменить Аренда зала', exact: true })).toBeFocused();

  // «В архив» в окне: строка уходит в конец с пометкой «в архиве», ручки у неё нет
  await list.getByRole('button', { name: 'Изменить Ёлка', exact: true }).click();
  await edit.getByRole('button', { name: 'В архив' }).click();
  await expect(edit).toBeHidden();
  await expect(list.getByRole('listitem')).toHaveText([/Аренда зала/, /Бар/, /Ёлка.*в архиве/]);
  await expect(row('Ёлка').getByRole('button', { name: /^Переместить/ })).toHaveCount(0);
  // окно архивного: пояснение вместо формы
  await list.getByRole('button', { name: 'Изменить Ёлка', exact: true }).click();
  await expect(edit).toContainText('В архиве. Чтобы изменить, сначала верните из архива.');
  await expect(edit.getByLabel('Название тега')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(edit).toBeHidden();

  // имя архивного тега при создании — предложение вернуть его
  await add.click();
  await dialog.getByLabel('Название тега').fill('елка');
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  const offer = dialog.getByRole('alert').filter({ hasText: 'есть в архиве' });
  await expect(offer).toContainText('Тег «Ёлка» есть в архиве');
  await offer.getByRole('button', { name: 'Вернуть из архива' }).click();
  await expect(dialog).toBeHidden();
  await expect(row('Ёлка')).not.toContainText('в архиве');

  // «Удалить» — подтверждение «Отменить | Удалить»
  await list.getByRole('button', { name: 'Изменить Бар', exact: true }).click();
  await edit.getByRole('button', { name: 'Удалить' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Удалить тег «Бар»?' });
  await expect(confirm).toContainText('Это нельзя отменить.');
  await expect(confirm.getByRole('button', { name: 'Отменить' })).toBeFocused();
  await confirm.getByRole('button', { name: 'Отменить' }).click();
  await expect(confirm).toBeHidden();
  await expect(edit).toBeVisible();
  await edit.getByRole('button', { name: 'Удалить' }).click();
  await confirm.getByRole('button', { name: 'Удалить' }).click();
  await expect(edit).toBeHidden();
  await expect(row('Бар')).toHaveCount(0);
  await expect(main.getByRole('heading', { level: 1, name: 'Теги' })).toBeFocused();

  // поиск без учёта регистра и «ё»
  const search = main.getByRole('searchbox', { name: 'Поиск' });
  await search.fill('ЕЛ');
  await expect(list.getByRole('listitem')).toHaveText([/Ёлка/]);
  await search.fill('нет такого');
  await expect(main).toContainText('Ничего не найдено.');
});

test('шаблон списка: порядок за ☰ мышью и Alt+↑/↓ с объявлением; отказ сервера; «Удалить» не прошло — ошибка в окне', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Порядок тегов ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const tagIds: number[] = [];
  for (const name of ['Альфа', 'Бета', 'Гамма']) tagIds.push((await apiPost(page, `${base}/tags`, { name })).tag.id);
  await page.goto(`/c/${cid}/settings/tags`);
  const main = page.getByRole('main');
  const list = main.getByRole('list', { name: 'Теги' });
  const order = async () => ((await (await page.request.get(`${base}/tags`)).json()).tags as { name: string }[]).map((t) => t.name);

  // клавиатура: Alt+↓ на ручке — строка ниже, фокус на ручке, новое место объявлено
  const alpha = list.getByRole('button', { name: 'Переместить Альфа', exact: true });
  await expect(alpha).toHaveAccessibleDescription(/Alt/);
  await alpha.focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(list.getByRole('listitem')).toHaveText([/Бета/, /Альфа/, /Гамма/]);
  await expect(alpha).toBeFocused();
  await expect(main).toContainText('«Альфа» — место 2 из 3');
  await expect.poll(order).toEqual(['Бета', 'Альфа', 'Гамма']);
  await page.keyboard.press('Alt+ArrowUp');
  await expect.poll(order).toEqual(['Альфа', 'Бета', 'Гамма']);
  // Alt+↑ на первой строке ничего не меняет (Review Focus 5)
  await page.keyboard.press('Alt+ArrowUp');
  await expect(list.getByRole('listitem')).toHaveText([/Альфа/, /Бета/, /Гамма/]);

  // мышь: «Гамма» за ☰ — выше «Альфы»
  const grip = (await list.getByRole('button', { name: 'Переместить Гамма', exact: true }).boundingBox())!;
  const target = (await list.getByRole('listitem').filter({ hasText: 'Альфа' }).boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, target.y + 4, { steps: 8 });
  await page.mouse.up();
  await expect(list.getByRole('listitem')).toHaveText([/Гамма/, /Альфа/, /Бета/]);
  await expect.poll(order).toEqual(['Гамма', 'Альфа', 'Бета']);

  // сервер отклонил порядок — список возвращается, над ним ошибка (Review Focus 2)
  const reorderUrl = '**/api/v1/companies/*/tags/reorder';
  await page.route(reorderUrl, (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'VERSION_CONFLICT', message: 'Список изменился — обновите страницу и повторите' } }),
    }),
  );
  try {
    await list.getByRole('button', { name: 'Переместить Гамма', exact: true }).focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect(main.getByRole('alert')).toHaveText('Список изменился — обновите страницу и повторите');
    await expect(list.getByRole('listitem')).toHaveText([/Гамма/, /Альфа/, /Бета/]);
  } finally {
    await page.unroute(reorderUrl);
  }

  // при поиске ручек нет (Review Focus 5)
  await main.getByRole('searchbox', { name: 'Поиск' }).fill('а');
  await expect(list.getByRole('button', { name: /^Переместить/ })).toHaveCount(0);
  await main.getByRole('searchbox', { name: 'Поиск' }).fill('');

  // тег на операции не удаляется: подтверждение закрылось, ошибка — в окне, фокус на «Удалить» (Review Focus 3)
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: minuteAgo(), accountId: cash, amount: 100, tagIds: [tagIds[0]] });
  await list.getByRole('button', { name: 'Изменить Альфа', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Тег', exact: true });
  await edit.getByRole('button', { name: 'Удалить' }).click();
  await page.getByRole('alertdialog', { name: 'Удалить тег «Альфа»?' }).getByRole('button', { name: 'Удалить' }).click();
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await expect(edit.getByRole('alert')).toHaveText('Тег стоит на операциях — его можно только перевести в архив');
  await expect(edit.getByRole('button', { name: 'Удалить' })).toBeFocused();
});
```

В `e2e/service-screens.spec.ts` в тесте «история: события компании…» замените строки

```ts
  await page.goto(`/c/${cid}/settings/tags`);
  await page.getByLabel('Новый тег').fill('Аренда');
  await page.getByRole('button', { name: 'Добавить' }).click();
  await page.getByRole('listitem').filter({ hasText: 'Аренда' }).getByRole('button', { name: 'Переименовать' }).click();
  await page.getByLabel('Новое название тега «Аренда»').fill('Аренда зала');
  await page.getByRole('button', { name: 'Сохранить' }).click();
```

на:

```ts
  await page.goto(`/c/${cid}/settings/tags`);
  await page.getByRole('button', { name: 'Добавить тег' }).click();
  const created = page.getByRole('dialog', { name: 'Новый тег' });
  await created.getByLabel('Название тега').fill('Аренда');
  await created.getByRole('button', { name: 'Сохранить' }).click();
  await expect(created).toBeHidden();
  await page.getByRole('button', { name: 'Изменить Аренда', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Тег', exact: true });
  await edit.getByLabel('Название тега').fill('Аренда зала');
  await edit.getByRole('button', { name: 'Сохранить' }).click();
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx playwright test e2e/dictionaries.spec.ts -g "шаблон списка"`
Expected: FAIL — нет кнопки «Добавить тег».

- [ ] **Step 3: `GripIcon`**

В конец `src/client/components/icons.tsx` добавьте:

```tsx
/** Ручка перетаскивания строки списка настроек (§7.1 этапа 1.5). */
export function GripIcon() {
  return (
    <Svg>
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </Svg>
  );
}
```

- [ ] **Step 4: `lib/settings-mutations.ts`**

Создайте `src/client/lib/settings-mutations.ts`:

```ts
import { useMutation, type QueryKey } from '@tanstack/react-query';
import { api, type ApiError } from './api';
import { sortByIds } from './order';
import { queryClient } from './query';

/**
 * Новый порядок списка настроек (§7.1 этапа 1.5): POST …/reorder с полным порядком. В кэше порядок меняется
 * сразу; если сервер отказал — прежний порядок и onError(сообщение). onError(null) — перед запросом.
 */
export function useReorder<T extends { id: number }>(queryKey: QueryKey, path: string, onError: (message: string | null) => void) {
  return useMutation<unknown, ApiError, number[], { previous: T[] | undefined }>({
    mutationFn: (ids) => api(path, { method: 'POST', body: { ids } }),
    onMutate: async (ids) => {
      onError(null);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<T[]>(queryKey);
      if (previous) queryClient.setQueryData<T[]>(queryKey, sortByIds(previous, ids));
      return { previous };
    },
    onError: (e, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      onError(e.message);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
}

type EntityAction = { suffix: '' | '/archive' | '/unarchive'; method: 'POST' | 'DELETE' };

/**
 * «В архив» / «Вернуть из архива» / «Удалить» в окне правки (§7.1 этапа 1.5). path — адрес элемента
 * (`/companies/1/tags/5`). Успех — refresh(), затем onDone() (окно закрывается); ошибка — в `error`, окно остаётся.
 */
export function useEntityActions(path: string, refresh: () => Promise<unknown>, onDone: () => void) {
  const action = useMutation<unknown, ApiError, EntityAction>({
    mutationFn: (a) => api(`${path}${a.suffix}`, { method: a.method }),
  });
  const run = async (a: EntityAction): Promise<boolean> => {
    try {
      await action.mutateAsync(a);
    } catch {
      return false;
    }
    await refresh();
    onDone();
    return true;
  };
  return {
    pending: action.isPending,
    error: action.error?.message ?? null,
    toggleArchive: (archived: boolean) => void run({ suffix: archived ? '/unarchive' : '/archive', method: 'POST' }),
    remove: () => run({ suffix: '', method: 'DELETE' }),
  };
}
```

- [ ] **Step 5: `EntityActions`**

Создайте `src/client/components/EntityActions.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { alertClass, btnDanger, btnSecondary } from './ui';

/**
 * Ряд действий под формой окна правки (§7.1 этапа 1.5): «В архив» / «Вернуть из архива» и «Удалить».
 * «Удалить» спрашивает вложенный ConfirmDialog «Удалить {что}?» — «Отменить | Удалить» (решение 4 плана 1.5-1).
 * Удалось — владелец закрывает окно; не удалось — подтверждение закрывается, ошибка видна здесь, фокус на «Удалить»
 * (ставится, когда запрос закончился и кнопка снова доступна: подтверждение может закрыться раньше).
 */
export function EntityActions(props: {
  /** Сейчас в архиве — кнопка «Вернуть из архива». */
  archived?: boolean;
  /** Нет — кнопки архива нет. */
  onArchiveToggle?: () => void;
  /** Что удаляется, для вопроса: «тег «Ёлка»». */
  what: string;
  /** true — удалено. Нет — кнопки «Удалить» нет. */
  onDelete?: () => Promise<boolean>;
  pending: boolean;
  error: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const [refocus, setRefocus] = useState(false);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const remove = props.onDelete;

  // удаление не прошло: фокус на «Удалить», когда подтверждение закрыто и запрос закончился (кнопка снова доступна)
  useEffect(() => {
    if (!refocus || confirming || props.pending) return;
    setRefocus(false);
    deleteRef.current?.focus({ preventScroll: true });
  }, [refocus, confirming, props.pending]);

  return (
    <div className="mt-6 grid gap-3 border-t border-field pt-4">
      {props.error && (
        <p role="alert" className={`${alertClass} mb-0`}>
          {props.error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {props.onArchiveToggle && (
          <button type="button" disabled={props.pending} onClick={props.onArchiveToggle} className={btnSecondary}>
            {props.archived ? 'Вернуть из архива' : 'В архив'}
          </button>
        )}
        {remove && (
          <button ref={deleteRef} type="button" disabled={props.pending} onClick={() => setConfirming(true)} className={btnDanger}>
            Удалить
          </button>
        )}
      </div>
      {remove && (
        <ConfirmDialog
          open={confirming}
          title={`Удалить ${props.what}?`}
          text="Это нельзя отменить."
          confirmLabel="Удалить"
          danger
          pending={props.pending}
          onConfirm={() =>
            void remove().then((ok) => {
              setConfirming(false);
              if (!ok) setRefocus(true);
            })
          }
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

/** Окно архивного элемента: вместо формы — пояснение (правка архивного запрещена правилами этапа 1). */
export function ArchivedNote() {
  return <p className="text-sm text-muted">В архиве. Чтобы изменить, сначала верните из архива.</p>;
}
```

- [ ] **Step 6: `SettingsList`**

Создайте `src/client/components/SettingsList.tsx`:

```tsx
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { dropIndexAt, dropInGroup, moveGroup, movedText, shiftInGroup, visibleRows, type SettingsRow } from '../lib/settings-list';
import { GripIcon, PencilIcon, SearchIcon } from './icons';
import { btnPrimary, inputClass } from './ui';

/** Перетаскивание за ☰: кого тянем, его группа и место вставки среди остальных строк группы. */
interface Drag {
  id: number;
  group: number[];
  index: number;
}

const iconButton =
  'grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-card hover:text-ink focus-visible:outline-2 focus-visible:outline-focus';
const markBefore = 'shadow-[inset_0_2px_0_0_var(--color-focus)]';
const markAfter = 'shadow-[inset_0_-2px_0_0_var(--color-focus)]';

/**
 * Общий шаблон списка зоны настроек (§7.1 этапа 1.5): «Добавить …», «Поиск» во всю ширину, строки «☰ название,
 * серый текст, ✎» без рамки с разделителем снизу. Порядок — перетаскиванием за ☰ (события указателя с захватом:
 * мышь и касание одним кодом) или Alt+↑/↓ на ручке; итог объявляется в живой области. Строка двигается только
 * среди соседей своего уровня; архивные — в конце, приглушены, не двигаются; при поиске ручек нет.
 * Без ролей status, alert, region: ошибки и пометки показывает страница.
 */
export function SettingsList<T extends SettingsRow>(props: {
  /** Доступное имя списка. */
  label: string;
  rows: readonly T[];
  /** Главная кнопка под заголовком; null — без кнопки (компания в архиве, системные категории). */
  addLabel: string | null;
  onAdd?: () => void;
  /** Поле «Поиск» (по умолчанию есть; в окне «Счета» — нет). */
  search?: boolean;
  /** Новый порядок группы (соседи одного уровня без архивных, в порядке показа). Нет — без ☰. */
  onReorder?: (group: number[], movedId: number) => void;
  /** ✎ «Изменить {название}». Нет — без ✎. */
  onEdit?: (row: T) => void;
  /** false — у строки нет ✎ (системная категория). */
  canEdit?: (row: T) => boolean;
  /** Иконки перед ✎ («+» подкатегории, «банк» системной категории). */
  actions?: (row: T) => ReactNode;
  /** Название полужирным (категории верхнего уровня). */
  strong?: (row: T) => boolean;
  /** Текст пустого списка. */
  empty: string;
}) {
  const [query, setQuery] = useState('');
  const [drag, setDrag] = useState<Drag | null>(null);
  const [announce, setAnnounce] = useState('');
  const hintId = useId();
  const rowEls = useRef(new Map<number, HTMLLIElement>());
  const handles = useRef(new Map<number, HTMLButtonElement>());
  /** После Alt+↑/↓: вернуть фокус на ручку строки, пока порядок не станет новым (React мог переставить узел). */
  const refocus = useRef<{ id: number; order: number[] } | null>(null);
  const shown = visibleRows(props.rows, query);
  // при поиске видна только часть списка — порядок не меняют (§7.1)
  const reorderable = props.onReorder !== undefined && query.trim() === '';

  useLayoutEffect(() => {
    const want = refocus.current;
    if (!want) return;
    const handle = handles.current.get(want.id);
    const active = document.activeElement;
    // человек уже ушёл фокусом на другой элемент — не мешаем
    if (active && active !== document.body && active !== handle) {
      refocus.current = null;
      return;
    }
    if (handle && active !== handle) handle.focus({ preventScroll: true });
    if (moveGroup(shown, want.id).join() === want.order.join()) refocus.current = null;
  });

  const commit = (row: T, next: number[], keyboard: boolean) => {
    props.onReorder?.(next, row.id);
    setAnnounce(movedText(row.name, next, row.id));
    if (keyboard) refocus.current = { id: row.id, order: next };
  };

  const onHandleKey = (e: KeyboardEvent<HTMLButtonElement>, row: T) => {
    if (e.key === 'Escape' && drag) {
      e.preventDefault();
      setDrag(null);
      return;
    }
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const next = shiftInGroup(moveGroup(shown, row.id), row.id, e.key === 'ArrowUp' ? -1 : 1);
    if (next) commit(row, next, true);
  };

  const midpoints = (ids: number[]) =>
    ids.map((id) => {
      const r = rowEls.current.get(id)?.getBoundingClientRect();
      return r ? r.top + r.height / 2 : 0;
    });

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>, row: T) => {
    if (e.button !== 0) return;
    const group = moveGroup(shown, row.id);
    if (group.length < 2) return;
    // без выделения текста и «мышиных» событий; дальше указатель привязан к ручке, даже если ушёл со строки
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ id: row.id, group, index: group.indexOf(row.id) });
  };

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    // середины строк — каждый раз заново: страница могла прокрутиться
    const index = dropIndexAt(midpoints(drag.group.filter((id) => id !== drag.id)), e.clientY);
    if (index !== drag.index) setDrag({ ...drag, index });
  };

  const onPointerUp = (row: T) => {
    if (!drag) return;
    const next = dropInGroup(drag.group, drag.id, drag.index);
    setDrag(null);
    if (next) commit(row, next, false);
  };

  // где встанет строка: черта над строкой (или под последней); на прежнем месте — без черты
  let before: number | undefined;
  let after: number | undefined;
  if (drag && dropInGroup(drag.group, drag.id, drag.index) !== null) {
    const others = drag.group.filter((id) => id !== drag.id);
    before = others[drag.index];
    if (drag.index === others.length) after = others[others.length - 1];
  }

  return (
    <div>
      {props.addLabel !== null && props.onAdd && (
        <button type="button" data-settings-add="" onClick={props.onAdd} className={`${btnPrimary} mb-4`}>
          {props.addLabel}
        </button>
      )}
      {props.search !== false && (
        <div className="relative mb-2">
          <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-label">
            <SearchIcon />
          </span>
          <input type="search" aria-label="Поиск" placeholder="Поиск" value={query} onChange={(e) => setQuery(e.target.value)} className={`${inputClass} pl-11`} />
        </div>
      )}
      <p id={hintId} className="sr-only">
        Alt и стрелка вверх или вниз — переместить строку; мышью или пальцем — перетащить за ручку.
      </p>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
      {shown.length === 0 ? (
        <p className="py-4 text-muted">{props.rows.length === 0 ? props.empty : 'Ничего не найдено.'}</p>
      ) : (
        <ul aria-label={props.label}>
          {shown.map((row) => {
            const child = row.parentId != null && shown.some((r) => r.id === row.parentId);
            const movable = reorderable && !row.archived && moveGroup(shown, row.id).length > 1;
            const note = row.note ?? (row.archived ? 'в архиве' : null);
            return (
              <li
                key={row.id}
                ref={(el) => {
                  if (el) rowEls.current.set(row.id, el);
                  else rowEls.current.delete(row.id);
                }}
                className={`flex min-h-14 items-center gap-2 border-b border-field py-2 pr-1 hover:bg-field/60 ${child ? 'pl-9' : 'pl-1'} ${row.archived ? 'opacity-60' : ''} ${drag?.id === row.id ? 'opacity-50' : ''} ${before === row.id ? markBefore : ''} ${after === row.id ? markAfter : ''}`}
              >
                {movable ? (
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) handles.current.set(row.id, el);
                      else handles.current.delete(row.id);
                    }}
                    aria-label={`Переместить ${row.name}`}
                    aria-describedby={hintId}
                    title="Перетащите, чтобы изменить порядок"
                    onPointerDown={(e) => onPointerDown(e, row)}
                    onPointerMove={onPointerMove}
                    onPointerUp={() => onPointerUp(row)}
                    onPointerCancel={() => setDrag(null)}
                    onKeyDown={(e) => onHandleKey(e, row)}
                    className={`${iconButton} cursor-grab touch-none select-none active:cursor-grabbing`}
                  >
                    <GripIcon />
                  </button>
                ) : (
                  props.onReorder && (
                    <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center text-muted opacity-30">
                      <GripIcon />
                    </span>
                  )
                )}
                <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                  <span className={`min-w-0 truncate ${props.strong?.(row) ? 'font-semibold' : ''}`}>{row.name}</span>
                  {row.secondary && <span className="text-sm text-muted">{row.secondary}</span>}
                  {note && <span className="rounded-full bg-field px-2 py-0.5 text-xs text-muted">{note}</span>}
                </span>
                {props.actions?.(row)}
                {props.onEdit && (props.canEdit?.(row) ?? true) && (
                  <button
                    type="button"
                    data-edit-id={row.id}
                    aria-label={`Изменить ${row.name}`}
                    title="Изменить"
                    onClick={() => props.onEdit!(row)}
                    className={iconButton}
                  >
                    <PencilIcon />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 7: «Теги» on the template**

Замените содержимое `src/client/pages/settings/TagsSettings.tsx` целиком:

```tsx
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useOutletContext } from 'react-router';
import { foldCase } from '../../../shared/search';
import { cleanName } from '../../../shared/text';
import { ArchivedNote, EntityActions } from '../../components/EntityActions';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { Pending, StaleNotice } from '../../components/QueryState';
import { SettingsList } from '../../components/SettingsList';
import { alertClass, btnPrimary, btnSecondary, inputClass, noticeClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { mergeSubsetOrder } from '../../lib/order';
import { queryClient } from '../../lib/query';
import { useTags, type Tag } from '../../lib/queries';
import { useEntityActions, useReorder } from '../../lib/settings-mutations';
import type { CompanyOutletContext } from '../CompanyLayout';

/** То же сравнение, что у сервера (name_key): без учёта регистра, «ё» и невидимых символов. */
const sameTag = (a: string, b: string) => foldCase(cleanName(a)) === foldCase(cleanName(b));

/** Окно тега: 'new' — «Новый тег», тег — «Тег», null — закрыто. */
type Editing = Tag | 'new' | null;

/** «Теги» на шаблоне списка (§7.1, §7.4 этапа 1.5): создание и правка — в окне, порядок — за ☰. */
export function TagsSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const tags = useTags(company.id);
  const [editing, setEditing] = useState<Editing>(null);
  const [listError, setListError] = useState<string | null>(null);
  const readOnly = company.archivedAt !== null;
  const reorder = useReorder<Tag>(['tags', company.id], `/companies/${company.id}/tags/reorder`, setListError);

  if (!tags.data) return <Pending queries={[tags]} />;
  const list = tags.data;

  return (
    <section>
      <StaleNotice queries={[tags]} />
      <h1 className="mb-4 text-2xl font-bold">Теги</h1>
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      {listError && (
        <p role="alert" className={alertClass}>
          {listError}
        </p>
      )}
      <SettingsList
        label="Теги"
        rows={list.map((t) => ({ id: t.id, name: t.name, archived: t.archivedAt !== null }))}
        addLabel={readOnly ? null : 'Добавить тег'}
        onAdd={() => setEditing('new')}
        onReorder={
          readOnly
            ? undefined
            : (group) =>
                reorder.mutate(
                  mergeSubsetOrder(
                    list.map((t) => t.id),
                    group,
                  ),
                )
        }
        onEdit={readOnly ? undefined : (row) => setEditing(list.find((t) => t.id === row.id) ?? null)}
        empty="Тегов пока нет. Теги помогают отмечать операции поперёк категорий и проектов."
      />
      <Modal open={editing !== null} title={editing === 'new' ? 'Новый тег' : 'Тег'} onClose={() => setEditing(null)} className="max-w-lg">
        {editing !== null && (
          <TagEditor
            key={editing === 'new' ? 'new' : editing.id}
            companyId={company.id}
            tag={editing === 'new' ? null : editing}
            tags={list}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
    </section>
  );
}

function TagEditor({ companyId, tag, tags, onDone }: { companyId: number; tag: Tag | null; tags: Tag[]; onDone: () => void }) {
  const base = `/companies/${companyId}/tags`;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['tags', companyId] });
  const [name, setName] = useState(tag?.name ?? '');
  const save = useMutation<unknown, ApiError>({
    mutationFn: () => (tag ? api(`${base}/${tag.id}`, { method: 'PATCH', body: { name } }) : api(base, { method: 'POST', body: { name } })),
    onSuccess: async () => {
      await refresh();
      onDone();
    },
  });
  const restore = useMutation<unknown, ApiError, number>({
    mutationFn: (id) => api(`${base}/${id}/unarchive`, { method: 'POST' }),
    onSuccess: async () => {
      await refresh();
      onDone();
    },
  });
  const actions = useEntityActions(tag ? `${base}/${tag.id}` : base, refresh, onDone);
  // имя совпало с архивным тегом — предлагаем вернуть его вместо дубля (§4.4)
  const archivedMatch = save.error?.code === 'ARCHIVED_DUPLICATE' ? tags.find((t) => t.archivedAt && sameTag(t.name, name)) : undefined;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <>
      {tag?.archivedAt ? (
        <ArchivedNote />
      ) : (
        <form noValidate onSubmit={submit} className="grid gap-4">
          <Field label="Название тега" error={archivedMatch ? undefined : save.error?.fields?.name}>
            {(c) => (
              <input
                {...c}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  save.reset();
                }}
                className={inputClass}
              />
            )}
          </Field>
          {save.error && !save.error.fields && (
            <p role="alert" className={`${alertClass} mb-0`}>
              {save.error.message}
            </p>
          )}
          {archivedMatch && (
            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-field px-4 py-3 text-sm">
              <span>Тег «{archivedMatch.name}» есть в архиве.</span>
              <button type="button" disabled={restore.isPending} onClick={() => restore.mutate(archivedMatch.id)} className={btnPrimary}>
                Вернуть из архива
              </button>
            </div>
          )}
          {restore.error && (
            <p role="alert" className={`${alertClass} mb-0`}>
              {restore.error.message}
            </p>
          )}
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
      {tag && (
        <EntityActions
          archived={tag.archivedAt !== null}
          onArchiveToggle={() => actions.toggleArchive(tag.archivedAt !== null)}
          what={`тег «${tag.name}»`}
          onDelete={actions.remove}
          pending={actions.pending}
          error={actions.error}
        />
      )}
    </>
  );
}
```

- [ ] **Step 8: Run the tag tests**

Run: `npx playwright test e2e/dictionaries.spec.ts e2e/service-screens.spec.ts` → PASS. Если перетаскивание мышью не меняет порядок, проверьте, что у ручки есть `touch-none` и что `onPointerMove` считает середины строк заново на каждом движении.

- [ ] **Step 9: Full check and commit**

Run: `npm test` → PASS. Run: `npm run typecheck`. Run: `npm run test:e2e` дважды → все проходят оба раза.

```bash
git add src/client/components/SettingsList.tsx src/client/components/EntityActions.tsx src/client/lib/settings-mutations.ts src/client/components/icons.tsx src/client/pages/settings/TagsSettings.tsx e2e/dictionaries.spec.ts e2e/service-screens.spec.ts
git commit -m "feat: шаблон списка настроек — «Добавить», поиск, ☰ мышью, касанием и Alt+↑/↓, окно правки с архивом и удалением через подтверждение; «Теги» на нём

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: «Контрагенты» — подменю типов в порядке Finmap

**Files:**
- Create: `src/client/lib/counterparty-tabs.ts`, `tests/client/counterparty-tabs.test.ts`, `src/client/components/SettingsSubmenu.tsx`
- Modify: `src/client/components/icons.tsx`, `src/client/pages/settings/CounterpartiesSettings.tsx` (полная замена)
- Test: `e2e/dictionaries.spec.ts`

**Interfaces:**
- Consumes: `SettingsList`, `EntityActions`, `ArchivedNote`, `useReorder`, `useEntityActions` (задача 3); `mergeSubsetOrder` (задача 2); `COUNTERPARTY_TYPE_LABELS`, `COUNTERPARTY_TYPE_SINGULAR` (`shared/counterparties.ts`).
- Produces:
  - `type CounterpartyTab = 'investor' | 'creditor' | 'borrower' | 'employee' | 'owner' | 'tax' | 'my'`; `COUNTERPARTY_TABS: readonly CounterpartyTabInfo[]` (`{ tab, label, add, createTitle, editTitle }`); `counterpartyTab(param: string | null): CounterpartyTab`; `counterpartyTabInfo(tab: CounterpartyTab): CounterpartyTabInfo`; `tabOfType(type: CounterpartyType): CounterpartyTab`;
  - `SettingsSubmenu<K extends string>(props: { label: string; param: string; current: K; items: readonly SubmenuItem<K>[] })`, `SubmenuItem<K> = { key: K; label: string; icon: 'bank' | 'info'; count?: number }` — им же пользуются «Категории» в плане 1.5-4b;
  - `BankIcon`, `InfoIcon` (`icons.tsx`).

- [ ] **Step 1: Write the failing unit test**

Создайте `tests/client/counterparty-tabs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { COUNTERPARTY_TABS, counterpartyTab, counterpartyTabInfo, tabOfType } from '../../src/client/lib/counterparty-tabs';

describe('вкладки контрагентов (§7.3 этапа 1.5)', () => {
  it('порядок и подписи как в Finmap; «Мои контрагенты» — последней', () => {
    expect(COUNTERPARTY_TABS.map((t) => t.label)).toEqual([
      'Инвесторы',
      'Кредиторы',
      'Заёмщики',
      'Сотрудники',
      'Владельцы',
      'Типы налогов',
      'Мои контрагенты',
    ]);
    expect(COUNTERPARTY_TABS.map((t) => t.add)).toEqual([
      'Добавить инвестора',
      'Добавить кредитора',
      'Добавить заёмщика',
      'Добавить сотрудника',
      'Добавить владельца',
      'Добавить тип налога',
      'Добавить контрагента',
    ]);
  });

  it('заголовки окон', () => {
    expect(counterpartyTabInfo('tax')).toMatchObject({ createTitle: 'Новый тип налога', editTitle: 'Тип налога' });
    expect(counterpartyTabInfo('my')).toMatchObject({ createTitle: 'Новый контрагент', editTitle: 'Контрагент' });
  });

  it('параметр адреса: известный тип — он, иначе «Мои контрагенты»', () => {
    expect(counterpartyTab('employee')).toBe('employee');
    expect(counterpartyTab('my')).toBe('my');
    expect(counterpartyTab(null)).toBe('my');
    expect(counterpartyTab('nope')).toBe('my');
    expect(counterpartyTab('client')).toBe('my');
  });

  it('клиенты и поставщики — во вкладке «Мои контрагенты», остальные — в своей', () => {
    expect(tabOfType('client')).toBe('my');
    expect(tabOfType('supplier')).toBe('my');
    expect(tabOfType('owner')).toBe('owner');
    expect(tabOfType('tax')).toBe('tax');
  });
});
```

Run: `npx vitest run tests/client/counterparty-tabs.test.ts` → FAIL (модуля нет).

- [ ] **Step 2: `lib/counterparty-tabs.ts`**

Создайте `src/client/lib/counterparty-tabs.ts`:

```ts
import { COUNTERPARTY_TYPE_LABELS } from '../../shared/counterparties';
import type { CounterpartyType } from '../../shared/system-categories';

/** Пункт подменю «Контрагентов» (§7.3 этапа 1.5): типы системных категорий и «Мои контрагенты» (клиенты и поставщики). */
export type CounterpartyTab = 'investor' | 'creditor' | 'borrower' | 'employee' | 'owner' | 'tax' | 'my';

export interface CounterpartyTabInfo {
  tab: CounterpartyTab;
  label: string;
  /** Главная кнопка над списком. */
  add: string;
  /** Заголовок окна создания. */
  createTitle: string;
  /** Заголовок окна правки. */
  editTitle: string;
}

/** Порядок Finmap (03-№15). */
export const COUNTERPARTY_TABS: readonly CounterpartyTabInfo[] = [
  { tab: 'investor', label: COUNTERPARTY_TYPE_LABELS.investor, add: 'Добавить инвестора', createTitle: 'Новый инвестор', editTitle: 'Инвестор' },
  { tab: 'creditor', label: COUNTERPARTY_TYPE_LABELS.creditor, add: 'Добавить кредитора', createTitle: 'Новый кредитор', editTitle: 'Кредитор' },
  { tab: 'borrower', label: COUNTERPARTY_TYPE_LABELS.borrower, add: 'Добавить заёмщика', createTitle: 'Новый заёмщик', editTitle: 'Заёмщик' },
  { tab: 'employee', label: COUNTERPARTY_TYPE_LABELS.employee, add: 'Добавить сотрудника', createTitle: 'Новый сотрудник', editTitle: 'Сотрудник' },
  { tab: 'owner', label: COUNTERPARTY_TYPE_LABELS.owner, add: 'Добавить владельца', createTitle: 'Новый владелец', editTitle: 'Владелец' },
  { tab: 'tax', label: COUNTERPARTY_TYPE_LABELS.tax, add: 'Добавить тип налога', createTitle: 'Новый тип налога', editTitle: 'Тип налога' },
  { tab: 'my', label: 'Мои контрагенты', add: 'Добавить контрагента', createTitle: 'Новый контрагент', editTitle: 'Контрагент' },
];

/** Вкладка по умолчанию — у клубов самый частый тип. */
export const DEFAULT_COUNTERPARTY_TAB: CounterpartyTab = 'my';

/** `?type=` адреса: известный пункт — он, иначе «Мои контрагенты» (§4.2). */
export function counterpartyTab(param: string | null): CounterpartyTab {
  return COUNTERPARTY_TABS.find((t) => t.tab === param)?.tab ?? DEFAULT_COUNTERPARTY_TAB;
}

export function counterpartyTabInfo(tab: CounterpartyTab): CounterpartyTabInfo {
  return COUNTERPARTY_TABS.find((t) => t.tab === tab) ?? COUNTERPARTY_TABS[COUNTERPARTY_TABS.length - 1]!;
}

/** Вкладка контрагента: клиенты и поставщики — «Мои контрагенты». */
export function tabOfType(type: CounterpartyType): CounterpartyTab {
  return type === 'client' || type === 'supplier' ? 'my' : type;
}
```

Run: `npx vitest run tests/client/counterparty-tabs.test.ts` → PASS.

- [ ] **Step 3: Icons and `SettingsSubmenu`**

В конец `src/client/components/icons.tsx` добавьте:

```tsx
/** «Банк» — системные типы контрагентов и системные категории в подменю (§7.2, §7.3 этапа 1.5). */
export function BankIcon() {
  return (
    <Svg>
      <path d="M3 10 12 4l9 6" />
      <line x1="4" y1="21" x2="20" y2="21" />
      <line x1="6" y1="10" x2="6" y2="18" />
      <line x1="10" y1="10" x2="10" y2="18" />
      <line x1="14" y1="10" x2="14" y2="18" />
      <line x1="18" y1="10" x2="18" y2="18" />
    </Svg>
  );
}

/** «i» — свои пункты подменю. */
export function InfoIcon() {
  return (
    <Svg>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </Svg>
  );
}
```

Создайте `src/client/components/SettingsSubmenu.tsx`:

```tsx
import { Link } from 'react-router';
import { BankIcon, InfoIcon } from './icons';

export interface SubmenuItem<K extends string> {
  key: K;
  label: string;
  /** «банк» — системное, «i» — своё (как в Finmap). */
  icon: 'bank' | 'info';
  /** Счётчик у пункта (наш). */
  count?: number;
}

/**
 * Подменю раздела слева в карточке (§7.2, §7.3 этапа 1.5): вертикальный список ссылок, выбор — параметр адреса
 * (`?type=`, `?tab=`), текущий — `aria-current="page"`. На телефоне — строкой с переносом.
 */
export function SettingsSubmenu<K extends string>(props: { label: string; param: string; current: K; items: readonly SubmenuItem<K>[] }) {
  return (
    <nav aria-label={props.label} className="flex flex-wrap gap-1 self-start md:grid md:gap-0.5 md:border-r md:border-field md:pr-4">
      {props.items.map((item) => {
        const active = item.key === props.current;
        return (
          <Link
            key={item.key}
            to={{ search: `?${props.param}=${item.key}` }}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm ${active ? 'bg-field font-semibold text-ink' : 'text-ink hover:bg-field/60'}`}
          >
            <span className="min-w-0">
              {item.label}
              {item.count !== undefined && <span className="ml-1.5 font-normal text-muted">{item.count}</span>}
            </span>
            <span aria-hidden="true" className="shrink-0 text-muted">
              {item.icon === 'bank' ? <BankIcon /> : <InfoIcon />}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 4: Write the failing e2e test**

В `e2e/dictionaries.spec.ts` тест «контрагенты по вкладкам и поиск» замените целиком на:

```ts
test('контрагенты: подменю типов в порядке Finmap, «Мои контрагенты» по умолчанию, окно с типом, поиск, порядок в своей вкладке', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Контрагенты ${Date.now()}`);
  await page.goto(`/c/${cid}/settings/counterparties`);
  const main = page.getByRole('main');
  const types = main.getByRole('navigation', { name: 'Типы контрагентов' });
  await expect(types.getByRole('link')).toHaveText([/^Инвесторы/, /^Кредиторы/, /^Заёмщики/, /^Сотрудники/, /^Владельцы/, /^Типы налогов/, /^Мои контрагенты/]);
  await expect(types.getByRole('link', { name: /^Мои контрагенты/ })).toHaveAttribute('aria-current', 'page');

  // «Мои»: тип — переключателем в окне, по умолчанию «Клиент»
  await main.getByRole('button', { name: 'Добавить контрагента' }).click();
  const created = page.getByRole('dialog', { name: 'Новый контрагент' });
  await expect(created.getByRole('radio', { name: 'Клиент' })).toBeChecked();
  await created.getByLabel('Название').fill('ИП Иванов');
  await created.getByLabel('Комментарий').fill('аренда зала');
  await created.getByRole('radio', { name: 'Поставщик' }).check();
  await created.getByRole('button', { name: 'Сохранить' }).click();
  await expect(created).toBeHidden();
  const my = main.getByRole('list', { name: 'Мои контрагенты' });
  await expect(my.getByRole('listitem')).toHaveText([/ИП Иванов\s*Поставщик · аренда зала/]);

  // «Сотрудники»: своя кнопка и заголовок окна, тип — по вкладке
  await types.getByRole('link', { name: /^Сотрудники/ }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/counterparties\\?type=employee$`));
  const staffDialog = page.getByRole('dialog', { name: 'Новый сотрудник' });
  for (const name of ['Пётр Админов', 'Анна Кассир']) {
    await main.getByRole('button', { name: 'Добавить сотрудника' }).click();
    await expect(staffDialog.getByRole('radio')).toHaveCount(0);
    await staffDialog.getByLabel('Название').fill(name);
    await staffDialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(staffDialog).toBeHidden();
  }
  const staff = main.getByRole('list', { name: 'Сотрудники' });
  await expect(staff.getByRole('listitem')).toHaveText([/Пётр Админов/, /Анна Кассир/]);
  await expect(types.getByRole('link', { name: /^Сотрудники/ })).toContainText('2');

  // порядок — в своей вкладке; «Мои» в общем порядке остаются на месте (Review Focus 1)
  const all = async () =>
    ((await (await page.request.get(`/api/v1/companies/${cid}/counterparties`)).json()).counterparties as { name: string; type: string }[]).map((c) => `${c.type}:${c.name}`);
  await staff.getByRole('button', { name: 'Переместить Анна Кассир', exact: true }).focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(staff.getByRole('listitem')).toHaveText([/Анна Кассир/, /Пётр Админов/]);
  await expect.poll(all).toEqual(['supplier:ИП Иванов', 'employee:Анна Кассир', 'employee:Пётр Админов']);

  // поиск без учёта регистра и «ё»
  await main.getByRole('searchbox', { name: 'Поиск' }).fill('петр');
  await expect(staff.getByRole('listitem')).toHaveText([/Пётр Админов/]);

  // ✎ в «Моих» — окно «Контрагент», тип меняется; поиск — и по комментарию
  await types.getByRole('link', { name: /^Мои контрагенты/ }).click();
  await main.getByRole('searchbox', { name: 'Поиск' }).fill('ЗАЛА');
  await expect(my.getByRole('listitem')).toHaveText([/ИП Иванов/]);
  await my.getByRole('button', { name: 'Изменить ИП Иванов', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Контрагент', exact: true });
  await edit.getByRole('radio', { name: 'Клиент' }).check();
  await edit.getByRole('button', { name: 'Сохранить' }).click();
  await expect(edit).toBeHidden();
  await expect(my.getByRole('listitem')).toHaveText([/ИП Иванов\s*Клиент · аренда зала/]);

  // неверный тип в адресе — «Мои контрагенты»
  await page.goto(`/c/${cid}/settings/counterparties?type=nope`);
  await expect(types.getByRole('link', { name: /^Мои контрагенты/ })).toHaveAttribute('aria-current', 'page');
});
```

Run: `npx playwright test e2e/dictionaries.spec.ts -g "контрагенты"` → FAIL (нет подменю).

- [ ] **Step 5: `CounterpartiesSettings`**

Замените содержимое `src/client/pages/settings/CounterpartiesSettings.tsx` целиком:

```tsx
import { useMutation } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { useOutletContext, useSearchParams } from 'react-router';
import { COUNTERPARTY_TYPE_SINGULAR } from '../../../shared/counterparties';
import type { CounterpartyType } from '../../../shared/system-categories';
import { ArchivedNote, EntityActions } from '../../components/EntityActions';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { Pending, StaleNotice } from '../../components/QueryState';
import { SettingsList } from '../../components/SettingsList';
import { SettingsSubmenu } from '../../components/SettingsSubmenu';
import { alertClass, btnPrimary, btnSecondary, inputClass, noticeClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { COUNTERPARTY_TABS, counterpartyTab, counterpartyTabInfo, tabOfType, type CounterpartyTab } from '../../lib/counterparty-tabs';
import { mergeSubsetOrder } from '../../lib/order';
import { queryClient } from '../../lib/query';
import { useCounterparties, type Counterparty } from '../../lib/queries';
import { useEntityActions, useReorder } from '../../lib/settings-mutations';
import type { CompanyOutletContext } from '../CompanyLayout';

/** Окно контрагента: 'new' — создание во вкладке, контрагент — правка, null — закрыто. */
type Editing = Counterparty | 'new' | null;

/**
 * «Контрагенты» (§7.3 этапа 1.5): подменю типов слева в порядке Finmap (`?type=`), справа — шаблон списка.
 * «Мои контрагенты» — клиенты и поставщики вместе, тип серым в строке; вкладки «Все» нет.
 */
export function CounterpartiesSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const counterparties = useCounterparties(company.id);
  const [params] = useSearchParams();
  const tab = counterpartyTab(params.get('type'));
  const info = counterpartyTabInfo(tab);
  const [editing, setEditing] = useState<Editing>(null);
  const [listError, setListError] = useState<string | null>(null);
  const readOnly = company.archivedAt !== null;
  const reorder = useReorder<Counterparty>(['counterparties', company.id], `/companies/${company.id}/counterparties/reorder`, setListError);

  if (!counterparties.data) return <Pending queries={[counterparties]} />;
  const all = counterparties.data;
  const inTab = all.filter((c) => tabOfType(c.type) === tab);

  return (
    <section>
      <StaleNotice queries={[counterparties]} />
      <h1 className="mb-4 text-2xl font-bold">Контрагенты</h1>
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      {listError && (
        <p role="alert" className={alertClass}>
          {listError}
        </p>
      )}
      <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
        <SettingsSubmenu
          label="Типы контрагентов"
          param="type"
          current={tab}
          items={COUNTERPARTY_TABS.map((t) => ({
            key: t.tab,
            label: t.label,
            icon: t.tab === 'my' ? ('info' as const) : ('bank' as const),
            count: all.filter((c) => tabOfType(c.type) === t.tab).length,
          }))}
        />
        <div className="min-w-0">
          <SettingsList
            key={tab}
            label={info.label}
            rows={inTab.map((c) => ({
              id: c.id,
              name: c.name,
              secondary: [tab === 'my' ? COUNTERPARTY_TYPE_SINGULAR[c.type] : null, c.comment].filter((s): s is string => !!s).join(' · ') || undefined,
              searchText: c.comment ?? undefined,
              archived: c.archivedAt !== null,
            }))}
            addLabel={readOnly ? null : info.add}
            onAdd={() => setEditing('new')}
            onReorder={
              readOnly
                ? undefined
                : (group) =>
                    reorder.mutate(
                      mergeSubsetOrder(
                        all.map((c) => c.id),
                        group,
                      ),
                    )
            }
            onEdit={readOnly ? undefined : (row) => setEditing(all.find((c) => c.id === row.id) ?? null)}
            empty="Контрагентов этого типа пока нет."
          />
        </div>
      </div>
      <Modal open={editing !== null} title={editing === 'new' ? info.createTitle : info.editTitle} onClose={() => setEditing(null)} className="max-w-lg">
        {editing !== null && (
          <CounterpartyEditor
            key={editing === 'new' ? 'new' : editing.id}
            companyId={company.id}
            tab={tab}
            counterparty={editing === 'new' ? null : editing}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
    </section>
  );
}

function CounterpartyEditor(props: { companyId: number; tab: CounterpartyTab; counterparty: Counterparty | null; onDone: () => void }) {
  const { counterparty, onDone } = props;
  const base = `/companies/${props.companyId}/counterparties`;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['counterparties', props.companyId] });
  const [name, setName] = useState(counterparty?.name ?? '');
  const [comment, setComment] = useState(counterparty?.comment ?? '');
  const [type, setType] = useState<CounterpartyType>(counterparty?.type ?? (props.tab === 'my' ? 'client' : props.tab));
  const radioName = useId();
  const save = useMutation<unknown, ApiError>({
    mutationFn: () => {
      const body = { type, name, comment };
      return counterparty ? api(`${base}/${counterparty.id}`, { method: 'PATCH', body }) : api(base, { method: 'POST', body });
    },
    onSuccess: async () => {
      await refresh();
      onDone();
    },
  });
  const actions = useEntityActions(counterparty ? `${base}/${counterparty.id}` : base, refresh, onDone);
  const fields = save.error?.fields ?? {};
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <>
      {counterparty?.archivedAt ? (
        <ArchivedNote />
      ) : (
        <form noValidate onSubmit={submit} className="grid gap-4">
          {props.tab === 'my' && (
            <fieldset>
              <legend className="mb-1 text-sm text-muted">Тип</legend>
              <div className="flex flex-wrap gap-4">
                {(['client', 'supplier'] as const).map((t) => (
                  <label key={t} className="flex items-center gap-2">
                    <input type="radio" name={radioName} value={t} checked={type === t} onChange={() => setType(t)} />
                    {COUNTERPARTY_TYPE_SINGULAR[t]}
                  </label>
                ))}
              </div>
              {fields.type && <span className="mt-1 block text-sm text-expense-strong">{fields.type}</span>}
            </fieldset>
          )}
          <Field label="Название" error={fields.name}>
            {(c) => <input {...c} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />}
          </Field>
          <Field label="Комментарий" error={fields.comment}>
            {(c) => <input {...c} value={comment} onChange={(e) => setComment(e.target.value)} className={inputClass} />}
          </Field>
          {save.error && !save.error.fields && (
            <p role="alert" className={`${alertClass} mb-0`}>
              {save.error.message}
            </p>
          )}
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
      {counterparty && (
        <EntityActions
          archived={counterparty.archivedAt !== null}
          onArchiveToggle={() => actions.toggleArchive(counterparty.archivedAt !== null)}
          what={`контрагента «${counterparty.name}»`}
          onDelete={actions.remove}
          pending={actions.pending}
          error={actions.error}
        />
      )}
    </>
  );
}
```

- [ ] **Step 6: Run the test**

Run: `npx playwright test e2e/dictionaries.spec.ts -g "контрагенты"` → PASS.

- [ ] **Step 7: Full check and commit**

Run: `npm test` → PASS. Run: `npm run typecheck`. Run: `npm run test:e2e` дважды → все проходят оба раза (ширина 390 px в `mobile.spec.ts` проверяет и этот раздел: подменю переносится строкой).

```bash
git add src/client/lib/counterparty-tabs.ts tests/client/counterparty-tabs.test.ts src/client/components/SettingsSubmenu.tsx src/client/components/icons.tsx src/client/pages/settings/CounterpartiesSettings.tsx e2e/dictionaries.spec.ts
git commit -m "feat: «Контрагенты» — подменю типов в порядке Finmap, «Мои контрагенты» по умолчанию, окно с типом, шаблон списка

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: «Счета» на шаблоне списка и окно «Добавление нового счёта»

**Files:**
- Create: `src/client/components/AccountEditor.tsx`
- Modify: `src/client/components/AccountForm.tsx` (полная замена), `src/client/pages/settings/AccountsSettings.tsx` (полная замена), `src/client/lib/accounts-panel.ts`, `tests/client/accounts-panel.test.ts`
- Test: `e2e/dictionaries.spec.ts`, `e2e/money.spec.ts`

**Interfaces:**
- Consumes: `SettingsList`, `EntityActions`, `ArchivedNote`, `useReorder`, `useEntityActions` (задача 3); `mergeSubsetOrder` (задача 2); `useAccounts`, `useProjects`, `useBalances`.
- Produces:
  - `AccountEditor({ company, account, onDone }: { company: Company; account: Account | null; onDone: () => void })` — содержимое окна: без счёта — создание, со счётом — правка с `EntityActions`; им пользуются «+» и окно «Счета» в задаче 6;
  - `accountSecondary(account: Account, projects: Project[], balance: number | undefined): string` (`lib/accounts-panel.ts`);
  - `AccountForm` — прежние свойства, поля в порядке «Валюта», «Название счёта», «Стартовый баланс», «Проект», «Дата открытия».

- [ ] **Step 1: Write the failing unit test**

В `tests/client/accounts-panel.test.ts` импорт замените на `import { accountSecondary, groupAccounts } from '../../src/client/lib/accounts-panel';` и добавьте в конец файла:

```ts
describe('accountSecondary — серый текст строки раздела «Счета» (§7.4 этапа 1.5)', () => {
  it('«{Клуб} · ₸ 114 997»; у общего счёта — только баланс; баланс ещё не загружен — только клуб', () => {
    const projects = [project(10, 'Клуб 1')];
    expect(accountSecondary(account(1, 10), projects, 11499700)).toBe('Клуб 1 · ₸\u00A0114\u202F997');
    expect(accountSecondary(account(2, null), projects, -50050)).toBe('\u2212₸\u00A0500,50');
    expect(accountSecondary(account(3, 10), projects, undefined)).toBe('Клуб 1');
    expect(accountSecondary(account(4, null), projects, undefined)).toBe('');
  });
});
```

Run: `npx vitest run tests/client/accounts-panel.test.ts` → FAIL (`accountSecondary` не экспортирована).

- [ ] **Step 2: `accountSecondary`**

В `src/client/lib/accounts-panel.ts` первую строку `import type { Account, Project } from './queries';` замените на:

```ts
import { formatMoney, MONEY_SCREEN_BEFORE } from '../../shared/money';
import type { Account, Project } from './queries';
```

и добавьте в конец файла:

```ts
/** Серый текст строки раздела «Счета» (§7.4 этапа 1.5): «{Клуб} · ₸ 114 997»; у общего счёта — только баланс. */
export function accountSecondary(account: Account, projects: Project[], balance: number | undefined): string {
  const club = account.projectId === null ? null : (projects.find((p) => p.id === account.projectId)?.name ?? null);
  const money = balance === undefined ? null : formatMoney(balance, account.currency, MONEY_SCREEN_BEFORE);
  return [club, money].filter((s): s is string => s !== null).join(' · ');
}
```

Run: `npx vitest run tests/client/accounts-panel.test.ts` → PASS.

- [ ] **Step 3: Write the failing e2e tests**

В `e2e/dictionaries.spec.ts` тест «счета: создание в USD, архив только при нулевом остатке, удаление» замените целиком на:

```ts
test('счета: «Добавление нового счёта» — валюта, название, стартовый баланс; архив только при нулевом остатке, ошибка — в окне; удаление через подтверждение', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Счета ${Date.now()}`);
  await page.getByRole('banner').getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Настройки компании' }).click();
  await section(page, 'Счета').click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/accounts$`));
  const main = page.getByRole('main');

  await main.getByRole('button', { name: 'Добавить счёт' }).click();
  const dialog = page.getByRole('dialog', { name: 'Добавление нового счёта' });
  // порядок полей как в Finmap: валюта, название, стартовый баланс; затем наши проект и дата открытия
  await expect(dialog.locator('label')).toHaveText(['Валюта', 'Название счёта', 'Стартовый баланс', 'Проект', 'Дата открытия']);
  await expect(dialog.getByLabel('Валюта')).toBeFocused();
  await dialog.getByLabel('Валюта').selectOption('USD');
  await dialog.getByLabel('Название счёта').fill('Сейф');
  await dialog.getByLabel('Стартовый баланс').fill('1 500,505');
  await dialog.getByRole('button', { name: 'Создать счёт' }).click();
  await expect(dialog.getByText('Введите сумму, например 1 500,50')).toBeVisible();
  await expect(dialog.getByLabel('Стартовый баланс')).toHaveAttribute('aria-invalid', 'true');
  await dialog.getByLabel('Стартовый баланс').fill('1 500,50');
  await dialog.getByRole('button', { name: 'Создать счёт' }).click();
  await expect(dialog).toBeHidden();

  const row = main.getByRole('listitem').filter({ hasText: 'Сейф' });
  // серый текст — баланс со знаком валюты впереди
  await expect(row).toContainText(/\$\s1\s500,50/);
  const pencil = row.getByRole('button', { name: 'Изменить Сейф', exact: true });
  const edit = page.getByRole('dialog', { name: 'Счёт', exact: true });
  await pencil.click();
  await edit.getByRole('button', { name: 'В архив' }).click();
  // ошибка — в окне, окно открыто, форму можно поправить (Review Focus 4)
  await expect(edit.getByRole('alert')).toHaveText('Счёт можно перевести в архив только при нулевом балансе');
  await edit.getByLabel('Стартовый баланс').fill('0');
  await edit.getByRole('button', { name: 'Сохранить' }).click();
  await expect(edit).toBeHidden();
  await pencil.click();
  await edit.getByRole('button', { name: 'В архив' }).click();
  await expect(edit).toBeHidden();
  await expect(row).toContainText('в архиве');

  // архивный: вместо формы — пояснение; «Удалить» — через подтверждение
  await pencil.click();
  await expect(edit).toContainText('В архиве. Чтобы изменить, сначала верните из архива.');
  await expect(edit.getByLabel('Название счёта')).toHaveCount(0);
  await edit.getByRole('button', { name: 'Удалить' }).click();
  await page.getByRole('alertdialog', { name: 'Удалить счёт «Сейф»?' }).getByRole('button', { name: 'Удалить' }).click();
  await expect(edit).toBeHidden();
  await expect(main.getByRole('listitem').filter({ hasText: 'Сейф' })).toHaveCount(0);
});
```

В тесте «переименование проекта переименовывает его счета; ↑/↓ меняют порядок счетов» название замените на `'переименование проекта переименовывает его счета; Alt+↓ меняет порядок счетов'`, а его конец

```ts
  await section(page, 'Счета').click();
  const group = page.getByRole('region', { name: 'Клуб Б' });
  await expect(group.getByRole('listitem')).toHaveCount(2);
  await expect(group.getByRole('listitem').first()).toContainText('Касса Клуб Б');
  await group.getByRole('button', { name: 'Ниже: Касса Клуб Б' }).click();
  await expect(group.getByRole('listitem').first()).toContainText('Kaspi Клуб Б');
});
```

замените на:

```ts
  await section(page, 'Счета').click();
  const accounts = page.getByRole('main').getByRole('list', { name: 'Счета' });
  // без групп по клубам: клуб — в сером тексте строки (§7.4)
  await expect(accounts.getByRole('listitem')).toHaveText([/Касса Клуб Б\s*Клуб Б/, /Kaspi Клуб Б\s*Клуб Б/]);
  await accounts.getByRole('button', { name: 'Переместить Касса Клуб Б', exact: true }).focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(accounts.getByRole('listitem').first()).toContainText('Kaspi Клуб Б');
  await expect
    .poll(async () => ((await (await page.request.get(`/api/v1/companies/${cid}/accounts`)).json()).accounts as { name: string }[]).map((a) => a.name))
    .toEqual(['Kaspi Клуб Б', 'Касса Клуб Б']);
});
```

В `e2e/money.spec.ts` в тесте «валюта счёта с операциями и базовая валюта компании с операциями заблокированы» замените строки от `  await page.goto(\`/c/${cid}/settings/accounts\`);` до `  await empty.getByRole('button', { name: 'Отмена' }).click();` включительно:

```ts
  await page.goto(`/c/${cid}/settings/accounts`);
  // в режиме правки название — значение поля, а не текст строки: строку формы ищем по полю
  const editRow = (accountName: string) => page.getByRole('listitem').filter({ has: page.locator(`input[value="${accountName}"]`) });
  await page.getByRole('listitem').filter({ hasText: 'Kaspi' }).getByRole('button', { name: 'Изменить' }).click();
  const row = editRow('Kaspi');
  await expect(row.getByLabel('Валюта')).toBeDisabled();
  await expect(row).toContainText('По счёту есть операции — валюту изменить нельзя');
  await row.getByRole('button', { name: 'Отмена' }).click();
  await page.getByRole('listitem').filter({ hasText: 'Пустой' }).getByRole('button', { name: 'Изменить' }).click();
  const empty = editRow('Пустой');
  await expect(empty.getByLabel('Валюта')).toBeEnabled();
  await empty.getByRole('button', { name: 'Отмена' }).click();
```

на:

```ts
  await page.goto(`/c/${cid}/settings/accounts`);
  const main = page.getByRole('main');
  const edit = page.getByRole('dialog', { name: 'Счёт', exact: true });
  await main.getByRole('button', { name: 'Изменить Kaspi', exact: true }).click();
  await expect(edit.getByLabel('Валюта')).toBeDisabled();
  await expect(edit).toContainText('По счёту есть операции — валюту изменить нельзя');
  await edit.getByRole('button', { name: 'Отмена' }).click();
  await expect(edit).toBeHidden();
  await main.getByRole('button', { name: 'Изменить Пустой', exact: true }).click();
  await expect(edit.getByLabel('Валюта')).toBeEnabled();
  await edit.getByRole('button', { name: 'Отмена' }).click();
  await expect(edit).toBeHidden();
```

Run: `npx playwright test e2e/dictionaries.spec.ts -g "счета"` → FAIL.

- [ ] **Step 4: `AccountForm` — Finmap field order, one column**

Замените содержимое `src/client/components/AccountForm.tsx` целиком:

```tsx
import { useState, type FormEvent } from 'react';
import { CURRENCIES, getCurrency } from '../../shared/currencies';
import { formatAmount, parseAmount } from '../../shared/money';
import type { Account, Project } from '../lib/queries';
import { Field } from './Field';
import { alertClass, btnPrimary, btnSecondary, inputClass } from './ui';

export interface AccountFormValues {
  name: string;
  currency: string;
  projectId: number | null;
  /** null — дата открытия по умолчанию (сегодня на сервере, в APP_TIMEZONE). */
  openedAt: string | null;
  startingBalance: number;
}

/**
 * Форма счёта в окне (§7.4 этапа 1.5): поля в порядке Finmap — «Валюта», «Название счёта», «Стартовый баланс»,
 * затем наши «Проект» и «Дата открытия»; одна колонка. Начальный фокус ставит окно — на первое поле.
 */
export function AccountForm(props: {
  mode: 'create' | 'edit';
  initial?: Account;
  defaultCurrency: string;
  projects: Project[];
  pending: boolean;
  serverFields?: Record<string, string>;
  serverError?: string;
  onSubmit: (values: AccountFormValues) => void;
  onCancel: () => void;
  /** По счёту есть операции: валюту менять нельзя (§4.4). */
  currencyLocked?: boolean;
}) {
  const init = props.initial;
  const [name, setName] = useState(init?.name ?? '');
  const [currency, setCurrency] = useState(init?.currency ?? props.defaultCurrency);
  const [projectId, setProjectId] = useState(init?.projectId != null ? String(init.projectId) : '');
  const [openedAt, setOpenedAt] = useState(init?.openedAt ?? '');
  const [balance, setBalance] = useState(init ? formatAmount(init.startingBalance, getCurrency(init.currency).minorUnits) : '0');
  const [clientFields, setClientFields] = useState<Record<string, string>>({});
  const fields = { ...props.serverFields, ...clientFields };
  // архивные проекты не предлагаются (инвариант 7), кроме текущего проекта счёта
  const choices = props.projects.filter((p) => !p.archivedAt || p.id === init?.projectId);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const minor = getCurrency(currency).minorUnits;
    const amount = parseAmount(balance, minor);
    const errors: Record<string, string> = {};
    if (!name.trim()) errors.name = 'Введите название';
    if (amount === null) {
      errors.startingBalance = minor > 0 ? `Введите сумму, например 1 500,${'5'.padEnd(minor, '0')}` : 'Введите сумму без дробной части, например 1 500';
    }
    if (props.mode === 'edit' && !openedAt) errors.openedAt = 'Укажите дату открытия';
    setClientFields(errors);
    if (amount === null || Object.keys(errors).length > 0) return;
    props.onSubmit({ name, currency, projectId: projectId ? Number(projectId) : null, openedAt: openedAt || null, startingBalance: amount });
  };

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <Field label="Валюта" error={fields.currency} hint={props.currencyLocked ? 'По счёту есть операции — валюту изменить нельзя' : undefined}>
        {(c) => (
          <select {...c} value={currency} disabled={props.currencyLocked} onChange={(e) => setCurrency(e.target.value)} className={inputClass}>
            {CURRENCIES.map((x) => (
              <option key={x.code} value={x.code}>
                {x.code} — {x.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Название счёта" error={fields.name}>
        {(c) => <input {...c} value={name} onChange={(e) => setName(e.target.value)} placeholder="Kaspi Gold" className={inputClass} />}
      </Field>
      <Field label="Стартовый баланс" hint="Остаток на дату открытия счёта" error={fields.startingBalance}>
        {(c) => <input {...c} inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} className={inputClass} />}
      </Field>
      <Field label="Проект" error={fields.projectId}>
        {(c) => (
          <select {...c} value={projectId} onChange={(e) => setProjectId(e.target.value)} className={inputClass}>
            <option value="">Без проекта (общий счёт)</option>
            {choices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.archivedAt ? ' (в архиве)' : ''}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field
        label="Дата открытия"
        error={fields.openedAt}
        hint={props.mode === 'create' ? 'Пусто — сегодня. Чтобы вносить прошлые операции, поставьте дату раньше.' : undefined}
      >
        {(c) => <input {...c} type="date" value={openedAt} onChange={(e) => setOpenedAt(e.target.value)} className={inputClass} />}
      </Field>
      {props.serverError && (
        <p role="alert" className={`${alertClass} mb-0`}>
          {props.serverError}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={props.pending || !name.trim()} className={btnPrimary}>
          {props.mode === 'create' ? 'Создать счёт' : 'Сохранить'}
        </button>
        <button type="button" onClick={props.onCancel} className={btnSecondary}>
          Отмена
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 5: `AccountEditor`**

Создайте `src/client/components/AccountEditor.tsx`:

```tsx
import { useMutation } from '@tanstack/react-query';
import { api, type ApiError } from '../lib/api';
import { queryClient } from '../lib/query';
import { useProjects, type Account, type Company } from '../lib/queries';
import { useEntityActions } from '../lib/settings-mutations';
import { AccountForm, type AccountFormValues } from './AccountForm';
import { ArchivedNote, EntityActions } from './EntityActions';
import { Pending } from './QueryState';

function toBody(v: AccountFormValues) {
  return {
    name: v.name,
    currency: v.currency,
    projectId: v.projectId,
    startingBalance: v.startingBalance,
    ...(v.openedAt ? { openedAt: v.openedAt } : {}),
  };
}

/**
 * Содержимое окна счёта (§7.4, §7.6 этапа 1.5): без счёта — «Добавление нового счёта», со счётом — правка
 * с «В архив» / «Вернуть из архива» и «Удалить». Одно и то же в разделе «Счета», в «+» левой панели и в окне «Счета».
 * onDone — сохранено, переведено в архив, удалено или «Отмена».
 */
export function AccountEditor({ company, account, onDone }: { company: Company; account: Account | null; onDone: () => void }) {
  const projects = useProjects(company.id);
  const base = `/companies/${company.id}/accounts`;
  // ['accounts', cid] обновляет и балансы (['accounts', cid, 'balances'])
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['accounts', company.id] });
  const save = useMutation<unknown, ApiError, AccountFormValues>({
    mutationFn: (v) => (account ? api(`${base}/${account.id}`, { method: 'PATCH', body: toBody(v) }) : api(base, { method: 'POST', body: toBody(v) })),
    onSuccess: async () => {
      await refresh();
      onDone();
    },
  });
  const actions = useEntityActions(account ? `${base}/${account.id}` : base, refresh, onDone);

  if (!projects.data) return <Pending queries={[projects]} />;
  return (
    <>
      {account?.archivedAt ? (
        <ArchivedNote />
      ) : (
        <AccountForm
          mode={account ? 'edit' : 'create'}
          initial={account ?? undefined}
          currencyLocked={account?.hasOperations}
          defaultCurrency={company.baseCurrency}
          projects={projects.data}
          pending={save.isPending}
          serverFields={save.error?.fields}
          serverError={save.error && !save.error.fields ? save.error.message : undefined}
          onSubmit={(v) => save.mutate(v)}
          onCancel={onDone}
        />
      )}
      {account && (
        <EntityActions
          archived={account.archivedAt !== null}
          onArchiveToggle={() => actions.toggleArchive(account.archivedAt !== null)}
          what={`счёт «${account.name}»`}
          onDelete={actions.remove}
          pending={actions.pending}
          error={actions.error}
        />
      )}
    </>
  );
}
```

- [ ] **Step 6: `AccountsSettings`**

Замените содержимое `src/client/pages/settings/AccountsSettings.tsx` целиком:

```tsx
import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { AccountEditor } from '../../components/AccountEditor';
import { Modal } from '../../components/Modal';
import { Pending, StaleNotice } from '../../components/QueryState';
import { SettingsList } from '../../components/SettingsList';
import { alertClass, noticeClass } from '../../components/ui';
import { accountSecondary } from '../../lib/accounts-panel';
import { mergeSubsetOrder } from '../../lib/order';
import { useAccounts, useBalances, useProjects, type Account } from '../../lib/queries';
import { useReorder } from '../../lib/settings-mutations';
import type { CompanyOutletContext } from '../CompanyLayout';

/**
 * «Счета» на шаблоне списка (§7.4 этапа 1.5): без групп по клубам — клуб и баланс в сером тексте строки
 * (группы остаются в левой панели). «Добавить счёт» и ✎ — окно со счётом (`AccountEditor`).
 */
export function AccountsSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const accounts = useAccounts(company.id);
  const projects = useProjects(company.id);
  const balances = useBalances(company.id);
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const readOnly = company.archivedAt !== null;
  const reorder = useReorder<Account>(['accounts', company.id], `/companies/${company.id}/accounts/reorder`, setListError);

  if (!accounts.data || !projects.data) return <Pending queries={[accounts, projects]} />;
  const list = accounts.data;
  const projectList = projects.data;
  const balanceOf = new Map((balances.data?.accounts ?? []).map((b) => [b.accountId, b.balance]));

  return (
    <section>
      <StaleNotice queries={[accounts, projects]} />
      <h1 className="mb-4 text-2xl font-bold">Счета</h1>
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      {listError && (
        <p role="alert" className={alertClass}>
          {listError}
        </p>
      )}
      <SettingsList
        label="Счета"
        rows={list.map((a) => ({
          id: a.id,
          name: a.name,
          secondary: accountSecondary(a, projectList, balanceOf.get(a.id)) || undefined,
          archived: a.archivedAt !== null,
        }))}
        addLabel={readOnly ? null : 'Добавить счёт'}
        onAdd={() => setEditing('new')}
        onReorder={
          readOnly
            ? undefined
            : (group) =>
                reorder.mutate(
                  mergeSubsetOrder(
                    list.map((a) => a.id),
                    group,
                  ),
                )
        }
        onEdit={readOnly ? undefined : (row) => setEditing(list.find((a) => a.id === row.id) ?? null)}
        empty="Счетов пока нет. Счёт — это касса, карта или банковский счёт."
      />
      <Modal open={editing !== null} title={editing === 'new' ? 'Добавление нового счёта' : 'Счёт'} onClose={() => setEditing(null)} className="max-w-lg">
        {editing !== null && (
          <AccountEditor key={editing === 'new' ? 'new' : editing.id} company={company} account={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
        )}
      </Modal>
    </section>
  );
}
```

- [ ] **Step 7: Run the tests**

Run: `npx playwright test e2e/dictionaries.spec.ts e2e/money.spec.ts` → PASS.

- [ ] **Step 8: Full check and commit**

Run: `npm test` → PASS. Run: `npm run typecheck`. Проверьте невидимые символы: `LC_ALL=C.UTF-8 grep -nP "[\x{200B}\x{00A0}\x{202F}\x{2212}]" tests/client/accounts-panel.test.ts` → пусто. Run: `npm run test:e2e` дважды → все проходят оба раза.

```bash
git add src/client/components/AccountForm.tsx src/client/components/AccountEditor.tsx src/client/pages/settings/AccountsSettings.tsx src/client/lib/accounts-panel.ts tests/client/accounts-panel.test.ts e2e/dictionaries.spec.ts e2e/money.spec.ts
git commit -m "feat: «Счета» на шаблоне списка — клуб и баланс в строке, окно «Добавление нового счёта» с порядком полей Finmap

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: «Мои счета» в левой панели — «+ ✎ ⟳» и окно «Счета»

**Files:**
- Create: `src/client/components/AccountsQuickEdit.tsx`, `e2e/accounts-panel.spec.ts`
- Modify: `src/client/components/AccountsPanel.tsx` (полная замена), `src/client/components/icons.tsx`, `src/client/lib/accounts-panel.ts`, `tests/client/accounts-panel.test.ts`
- Test: `e2e/money.spec.ts`, `e2e/dictionaries.spec.ts`, `e2e/mobile.spec.ts`

**Interfaces:**
- Consumes: `AccountEditor` (задача 5), `SettingsList`, `useReorder` (задача 3), `mergeSubsetOrder` (задача 2), `refreshOperations` (`lib/journal-mutations.ts`), `firstTabbable` (`components/focus-trap.ts`), `groupAccounts`.
- Produces: `AccountsQuickEdit({ company, open, onClose }: { company: Company; open: boolean; onClose: () => void })`; `showGroupTitles(groups: AccountGroup[]): boolean`; `PlusIcon`.

- [ ] **Step 1: Write the failing unit test**

В `tests/client/accounts-panel.test.ts` импорт замените на `import { accountSecondary, groupAccounts, showGroupTitles } from '../../src/client/lib/accounts-panel';` и добавьте в конец файла:

```ts
describe('showGroupTitles — заголовки групп в «Моих счетах» (§7.6 этапа 1.5)', () => {
  it('одна группа — без заголовка, как плоский список Finmap; две и больше — с заголовками', () => {
    expect(showGroupTitles(groupAccounts([account(1, null), account(2, null)], []))).toBe(false);
    expect(showGroupTitles(groupAccounts([account(1, 10)], [project(10, 'Клуб 1')]))).toBe(false);
    expect(showGroupTitles(groupAccounts([account(1, null), account(2, 10)], [project(10, 'Клуб 1')]))).toBe(true);
  });
});
```

Run: `npx vitest run tests/client/accounts-panel.test.ts` → FAIL.

В `src/client/lib/accounts-panel.ts` после функции `groupAccounts` добавьте:

```ts
/** Заголовки групп «Общие» / клубы показываются, только если групп больше одной (§7.6 этапа 1.5). */
export function showGroupTitles(groups: AccountGroup[]): boolean {
  return groups.length > 1;
}
```

Run: `npx vitest run tests/client/accounts-panel.test.ts` → PASS.

- [ ] **Step 2: Write the failing e2e tests**

Создайте `e2e/accounts-panel.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';

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

async function apiPost(page: Page, url: string, data: unknown) {
  const res = await page.request.post(url, { data, headers: csrf(page) });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return res.json();
}

const minuteAgo = () => new Date(Date.now() - 60_000).toISOString();

test('«Мои счета»: «+» — окно «Добавление нового счёта» над журналом; ✎ — окно «Счета» с правкой и порядком; ⟳ обновляет', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Мои счета ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 100000 });
  await page.reload();
  const panel = page.getByRole('navigation', { name: 'Счета' });
  await expect(panel.getByRole('heading', { level: 2, name: 'Мои счета' })).toBeVisible();
  // одна группа — без заголовка группы; ссылки «+ счёт» больше нет
  await expect(panel.getByRole('heading', { level: 3 })).toHaveCount(0);
  await expect(panel.getByRole('link', { name: '+ счёт' })).toHaveCount(0);

  // «+» — окно прямо над журналом, адрес не меняется, фокус возвращается на «+»
  const add = panel.getByRole('button', { name: 'Добавить счёт' });
  await add.click();
  const dialog = page.getByRole('dialog', { name: 'Добавление нового счёта' });
  await expect(dialog.getByLabel('Валюта')).toBeFocused();
  await dialog.getByLabel('Название счёта').fill('Kaspi');
  await dialog.getByRole('button', { name: 'Создать счёт' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log$`));
  await expect(add).toBeFocused();
  await expect(panel.getByRole('link', { name: /^Kaspi/ })).toContainText(/₸\s0$/);

  // ✎ — окно «Счета»: «Добавить счёт» и список ☰ имя ✎
  await panel.getByRole('button', { name: 'Изменить счета' }).click();
  const quick = page.getByRole('dialog', { name: 'Счета', exact: true });
  const list = quick.getByRole('list', { name: 'Список счетов' });
  await expect(list.getByRole('listitem')).toHaveText([/Касса/, /Kaspi/]);
  await expect(quick.getByRole('button', { name: 'Добавить счёт' })).toBeFocused();
  // ✎ переключает это же окно на форму счёта
  await list.getByRole('button', { name: 'Изменить Kaspi', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Счёт', exact: true });
  await expect(edit.getByLabel('Валюта')).toBeFocused();
  await edit.getByLabel('Название счёта').fill('Kaspi Gold');
  await edit.getByRole('button', { name: 'Сохранить' }).click();
  await expect(list.getByRole('listitem')).toHaveText([/Касса/, /Kaspi Gold/]);
  await expect(list.getByRole('button', { name: 'Изменить Kaspi Gold', exact: true })).toBeFocused();
  // «← Назад» — снова список, фокус на ✎ того же счёта
  await list.getByRole('button', { name: 'Изменить Касса', exact: true }).click();
  await edit.getByRole('button', { name: 'Назад' }).click();
  await expect(list.getByRole('button', { name: 'Изменить Касса', exact: true })).toBeFocused();
  // порядок: Alt+↓ на ручке «Кассы» — и в окне, и в панели
  await list.getByRole('button', { name: 'Переместить Касса', exact: true }).focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(list.getByRole('listitem')).toHaveText([/Kaspi Gold/, /Касса/]);
  await page.keyboard.press('Escape');
  await expect(quick).toBeHidden();
  await expect(panel.getByRole('button', { name: 'Изменить счета' })).toBeFocused();
  await expect(panel.getByRole('link')).toHaveText([/^Kaspi Gold/, /^Касса/]);

  // ⟳ — журнал, счета и балансы перечитываются (§2.5)
  const kaspi = ((await (await page.request.get(`${base}/accounts`)).json()).accounts as { id: number; name: string }[]).find((a) => a.name === 'Kaspi Gold')!.id;
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: minuteAgo(), accountId: kaspi, amount: 5000 });
  await panel.getByRole('button', { name: 'Обновить' }).click();
  await expect(panel.locator('[aria-live="polite"]')).toHaveText('Данные обновлены');
  await expect(panel.getByRole('link', { name: /^Kaspi Gold/ })).toContainText(/₸\s50$/);
  await expect(page.getByRole('table', { name: 'Операции' }).locator('tbody tr')).toHaveCount(1);
});

test('«Мои счета»: группы по клубам — заголовки h3; у архивной компании только ⟳', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Группы счетов ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const club = (await apiPost(page, `${base}/projects`, { name: 'Клуб на Абая', templateKey: 'general', templateParams: {} })).project.id;
  await apiPost(page, `${base}/accounts`, { name: 'Сейф', currency: 'KZT', openedAt: '2020-01-01' });
  await apiPost(page, `${base}/accounts`, { name: 'Касса Абая', currency: 'KZT', openedAt: '2020-01-01', projectId: club });
  await page.reload();
  const panel = page.getByRole('navigation', { name: 'Счета' });
  await expect(panel.getByRole('heading', { level: 3 })).toHaveText(['Общие', 'Клуб на Абая']);

  await apiPost(page, `/api/v1/companies/${cid}/archive`, {});
  await page.goto(`/c/${cid}/log`);
  await expect(panel.getByRole('heading', { level: 2, name: 'Мои счета' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Добавить счёт' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Изменить счета' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Обновить' })).toBeVisible();
});
```

В `e2e/money.spec.ts` в тесте «левая панель: балансы и итог…» строку

```ts
  await expect(panel).toContainText('Общие');
```

замените на:

```ts
  // над счетами — «Мои счета»; одна группа — без заголовка «Общие» (§7.6)
  await expect(panel.getByRole('heading', { level: 2, name: 'Мои счета' })).toBeVisible();
  await expect(panel).not.toContainText('Общие');
```

В `e2e/dictionaries.spec.ts` в тесте «зона настроек: …» удалите строки (ссылки «+ счёт» больше нет — поведение удалено, §7.6):

```ts
  // то же для «+ счёт» в левой панели: она заменяется меню настроек
  await page.getByRole('navigation', { name: 'Счета' }).getByRole('link', { name: '+ счёт' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/accounts$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Счета' })).toBeFocused();
```

В `e2e/mobile.spec.ts` в тесте «счета на телефоне выезжают слева…» замените строки

```ts
  // переход из панели — фокус на заголовок страницы; «+ счёт» ведёт в раздел «Счета» (§11 этапа 1.5)
  await expect(page.getByRole('heading', { level: 1, name: 'Журнал' })).toBeFocused();
  await open.click();
  await drawer.getByRole('link', { name: '+ счёт' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/settings/accounts$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Счета' })).toBeFocused();
```

на:

```ts
  // переход из панели — фокус на заголовок страницы (§11 этапа 1.5)
  await expect(page.getByRole('heading', { level: 1, name: 'Журнал' })).toBeFocused();
  // «Добавить счёт» в панели — окно поверх панели; Esc закрывает только окно (§7.6)
  await open.click();
  const addButton = drawer.getByRole('button', { name: 'Добавить счёт' });
  await addButton.click();
  const addDialog = page.getByRole('dialog', { name: 'Добавление нового счёта' });
  await expect(addDialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(addDialog).toBeHidden();
  await expect(drawer).toBeVisible();
  await expect(addButton).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
```

Run: `npx playwright test e2e/accounts-panel.spec.ts` → FAIL.

- [ ] **Step 3: `PlusIcon`**

В конец `src/client/components/icons.tsx` добавьте:

```tsx
/** «+» — «Добавить счёт» в «Моих счетах» (§7.6 этапа 1.5). */
export function PlusIcon() {
  return (
    <Svg>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </Svg>
  );
}
```

- [ ] **Step 4: `AccountsQuickEdit`**

Создайте `src/client/components/AccountsQuickEdit.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { mergeSubsetOrder } from '../lib/order';
import { useAccounts, type Account, type Company } from '../lib/queries';
import { useReorder } from '../lib/settings-mutations';
import { AccountEditor } from './AccountEditor';
import { firstTabbable } from './focus-trap';
import { Modal } from './Modal';
import { Pending } from './QueryState';
import { SettingsList } from './SettingsList';
import { alertClass, btnSmall } from './ui';

type View = { kind: 'list' } | { kind: 'create' } | { kind: 'edit'; id: number };

/**
 * ✎ «Изменить счета» в «Моих счетах» (§7.6 этапа 1.5): окно «Счета» прямо над журналом — «Добавить счёт» и список
 * ☰ имя ✎ (порядок — тот же, что в разделе «Счета»). ✎ и «Добавить счёт» переключают это же окно на форму счёта
 * с «← Назад»; после сохранения, архива или удаления — снова список, фокус на ✎ счёта (или на «Добавить счёт»).
 */
export function AccountsQuickEdit({ company, open, onClose }: { company: Company; open: boolean; onClose: () => void }) {
  const accounts = useAccounts(company.id);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [listError, setListError] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  /** Куда поставить фокус, когда окно снова покажет список. */
  const backTo = useRef<number | 'add' | null>(null);
  const reorder = useReorder<Account>(['accounts', company.id], `/companies/${company.id}/accounts/reorder`, setListError);

  // смена вида внутри открытого окна: фокус — на первое поле формы или обратно в список
  useEffect(() => {
    if (!open) return;
    if (view.kind !== 'list') {
      if (editor.current) firstTabbable(editor.current)?.focus();
      return;
    }
    const target = backTo.current;
    backTo.current = null;
    if (target === null || !body.current) return;
    const pencil = target === 'add' ? null : body.current.querySelector<HTMLElement>(`[data-edit-id="${target}"]`);
    (pencil ?? body.current.querySelector<HTMLElement>('[data-settings-add]'))?.focus();
  }, [view, open]);

  const toList = (focus: number | 'add') => {
    backTo.current = focus;
    setView({ kind: 'list' });
  };
  const close = () => {
    setView({ kind: 'list' });
    setListError(null);
    onClose();
  };
  const list = accounts.data ?? [];
  const account = view.kind === 'edit' ? (list.find((a) => a.id === view.id) ?? null) : null;
  const back: number | 'add' = view.kind === 'edit' ? view.id : 'add';
  const title = view.kind === 'list' ? 'Счета' : view.kind === 'create' ? 'Добавление нового счёта' : 'Счёт';

  return (
    <Modal open={open} title={title} onClose={close} className="max-w-lg">
      <div ref={body}>
        {view.kind === 'list' ? (
          !accounts.data ? (
            <Pending queries={[accounts]} />
          ) : (
            <>
              {listError && (
                <p role="alert" className={alertClass}>
                  {listError}
                </p>
              )}
              <SettingsList
                label="Список счетов"
                rows={list.map((a) => ({ id: a.id, name: a.name, secondary: a.currency, archived: a.archivedAt !== null }))}
                search={false}
                addLabel="Добавить счёт"
                onAdd={() => setView({ kind: 'create' })}
                onReorder={(group) =>
                  reorder.mutate(
                    mergeSubsetOrder(
                      list.map((a) => a.id),
                      group,
                    ),
                  )
                }
                onEdit={(row) => setView({ kind: 'edit', id: row.id })}
                empty="Счетов пока нет."
              />
            </>
          )
        ) : (
          <>
            <button type="button" onClick={() => toList(back)} className={`${btnSmall} mb-4`}>
              <span aria-hidden="true">←</span> Назад
            </button>
            <div ref={editor}>
              {view.kind === 'edit' && !account ? (
                <p className="text-muted">Счёт не найден — возможно, его удалили.</p>
              ) : (
                <AccountEditor key={view.kind === 'edit' ? view.id : 'new'} company={company} account={account} onDone={() => toList(back)} />
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
```

- [ ] **Step 5: `AccountsPanel`**

Замените содержимое `src/client/components/AccountsPanel.tsx` целиком:

```tsx
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Link } from 'react-router';
import { formatMoney, MONEY_SCREEN_BEFORE } from '../../shared/money';
import { groupAccounts, showGroupTitles } from '../lib/accounts-panel';
import { focusHeadingSoon, isPlainLeftClick, pathOf } from '../lib/focus-heading';
import { refreshOperations } from '../lib/journal-mutations';
import { useIsMobile } from '../lib/media';
import { useAccounts, useBalances, useProjects, type Company } from '../lib/queries';
import { useSidebarCollapsed } from '../lib/sidebar';
import { AccountEditor } from './AccountEditor';
import { AccountsQuickEdit } from './AccountsQuickEdit';
import { CollapseButton } from './CollapseButton';
import { Drawer } from './Drawer';
import { PencilIcon, PlusIcon, RefreshIcon } from './icons';
import { Modal } from './Modal';

/** Иконка в строке «Мои счета»; на телефоне цель касания 44 px. */
const headIcon =
  'grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-field hover:text-ink disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-focus max-md:size-11';

/**
 * Содержимое левой панели (§7, §7.6 этапа 1.5): «Всего на счетах» крупно; строка «Мои счета» с «+» (окно
 * «Добавление нового счёта» прямо над журналом), ✎ (окно «Счета») и ⟳ (§2.5); счета по клубам с балансами —
 * заголовки групп `h3`, только если групп больше одной. Без ролей listitem, status, alert, region: их ищут e2e
 * экранов настроек. onNavigate — переход по ссылке счёта (выезжающая панель на телефоне при этом закрывается).
 */
function AccountsSummary({ company, onNavigate }: { company: Company; onNavigate?: (target: string) => void }) {
  const accounts = useAccounts(company.id);
  const projects = useProjects(company.id);
  const balances = useBalances(company.id);
  const [dialog, setDialog] = useState<'add' | 'edit' | null>(null);
  const [refresh, setRefresh] = useState({ pending: false, failed: false, text: '' });
  const balanceOf = new Map((balances.data?.accounts ?? []).map((b) => [b.accountId, b.balance]));
  const groups = groupAccounts(accounts.data ?? [], projects.data ?? []);
  const titles = showGroupTitles(groups);
  const total = balances.data?.total;
  const failed = balances.error ?? accounts.error ?? projects.error;
  const writable = company.archivedAt === null;
  // только обычное нажатие левой кнопкой: Ctrl/Shift/средняя кнопка открывают ссылку отдельно, страница остаётся
  const click = (to: string) => (e: MouseEvent) => {
    if (onNavigate && isPlainLeftClick(e)) onNavigate(pathOf(to));
  };
  const runRefresh = async () => {
    setRefresh({ pending: true, failed: false, text: '' });
    try {
      await refreshOperations(company.id);
      setRefresh({ pending: false, failed: false, text: 'Данные обновлены' });
    } catch {
      setRefresh({ pending: false, failed: true, text: 'Не удалось обновить журнал' });
    }
  };
  const close = () => setDialog(null);

  return (
    <>
      <div className="mb-3 min-w-0">
        <p className="text-xs text-muted">Всего на счетах</p>
        <p className="truncate text-2xl font-bold tabular-nums">{total ? formatMoney(total.amount, total.currency, MONEY_SCREEN_BEFORE) : balances.error ? '—' : '…'}</p>
        {total?.unavailable.map((code) => (
          <p key={code} className="text-xs text-expense-strong">
            курс {code} недоступен
          </p>
        ))}
      </div>
      <div className="mb-2 flex items-center gap-1 border-t border-field pt-3">
        <h2 className="min-w-0 flex-1 truncate px-2 text-sm font-semibold">Мои счета</h2>
        {writable && (
          <button type="button" aria-label="Добавить счёт" title="Добавить счёт" onClick={() => setDialog('add')} className={headIcon}>
            <PlusIcon />
          </button>
        )}
        {writable && (
          <button type="button" aria-label="Изменить счета" title="Изменить счета" onClick={() => setDialog('edit')} className={headIcon}>
            <PencilIcon />
          </button>
        )}
        <button type="button" aria-label="Обновить" title="Обновить" disabled={refresh.pending} onClick={() => void runRefresh()} className={headIcon}>
          <RefreshIcon spinning={refresh.pending} />
        </button>
      </div>
      <p aria-live="polite" className={refresh.failed ? 'mb-2 px-2 text-xs text-expense-strong' : 'sr-only'}>
        {refresh.text}
      </p>
      {failed && (
        <p className="mb-2 text-xs text-expense-strong">
          Не удалось загрузить счета.{' '}
          <button
            type="button"
            className="underline"
            onClick={() => {
              void balances.refetch();
              void accounts.refetch();
              void projects.refetch();
            }}
          >
            Повторить
          </button>
        </p>
      )}
      {groups.map((g) => (
        <div key={g.key} className="mb-3">
          {titles && <h3 className="mb-1 truncate px-2 text-xs font-semibold text-muted">{g.title}</h3>}
          {g.items.map((a) => {
            const balance = balanceOf.get(a.id);
            const to = `/c/${company.id}/log?account=${a.id}`;
            return (
              <Link key={a.id} to={to} onClick={click(to)} className="flex items-baseline justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-field">
                <span className="truncate">{a.name}</span>
                <span className={`shrink-0 tabular-nums ${balance !== undefined && balance < 0 ? 'text-expense-strong' : ''}`}>
                  {balance === undefined ? '…' : formatMoney(balance, a.currency, MONEY_SCREEN_BEFORE)}
                </span>
              </Link>
            );
          })}
        </div>
      ))}
      {accounts.data && groups.length === 0 && <p className="mb-3 px-2 text-sm text-muted">Счетов пока нет.</p>}
      {/* окна — вложенные <dialog>: на телефоне поверх выезжающей панели, её Esc и close они не трогают */}
      <Modal open={dialog === 'add'} title="Добавление нового счёта" onClose={close} className="max-w-lg">
        <AccountEditor company={company} account={null} onDone={close} />
      </Modal>
      <AccountsQuickEdit company={company} open={dialog === 'edit'} onClose={close} />
    </>
  );
}

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

/**
 * Счета на телефоне (§7 «Мобильная версия»): кнопка «Счета» в шапке, «Всего на счетах» и балансы выезжают
 * слева. Переход по счёту (фильтр журнала) закрывает панель, фокус — на `<h1>` страницы (§11 этапа 1.5).
 */
export function AccountsDrawerButton({ company }: { company: Company }) {
  const [open, setOpen] = useState(false);
  const navigated = useRef(false);
  const mobile = useIsMobile();
  // окно стало шире телефона — на месте левая панель, выезжающая не нужна
  useEffect(() => {
    if (!mobile) setOpen(false);
  }, [mobile]);
  return (
    <>
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
        onClose={() => setOpen(false)}
        afterClose={() => {
          const handled = navigated.current;
          navigated.current = false;
          return handled;
        }}
      >
        <AccountsSummary
          company={company}
          onNavigate={(target) => {
            navigated.current = true;
            focusHeadingSoon(target);
            setOpen(false);
          }}
        />
      </Drawer>
    </>
  );
}
```

- [ ] **Step 6: Run the tests**

Run: `npx playwright test e2e/accounts-panel.spec.ts e2e/money.spec.ts e2e/dictionaries.spec.ts e2e/mobile.spec.ts` → PASS.

- [ ] **Step 7: Full check and commit**

Run: `npm test` → PASS (`theme.test.ts` проверяет, что новый код не вернул `text-expense`). Run: `npm run typecheck`. Run: `npm run test:e2e` дважды → все проходят оба раза.

```bash
git add src/client/components/AccountsQuickEdit.tsx src/client/components/AccountsPanel.tsx src/client/components/icons.tsx src/client/lib/accounts-panel.ts tests/client/accounts-panel.test.ts e2e/accounts-panel.spec.ts e2e/money.spec.ts e2e/dictionaries.spec.ts e2e/mobile.spec.ts
git commit -m "feat: «Мои счета» — «+» и окно «Добавление нового счёта» над журналом, ✎ и окно «Счета», ⟳; заголовки групп h3, без «+ счёт»

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Визуальная сверка — «Мои счета», окно «Счета», «Мои контрагенты»

**Files:**
- Modify: `scripts/ux-shots.ts`

**Interfaces:**
- Consumes: «+ ✎» левой панели (задача 6), подменю контрагентов (задача 4).
- Produces: снимки `c21-account-add.png` (теперь из левой панели), `c22-accounts-edit.png`, `c28c-my-counterparties.png`; итог сверки плана 1.5-4a в отчёте задачи.

- [ ] **Step 1: Update the scenarios**

В `scripts/ux-shots.ts` строку сценария

```ts
  { ours: 'c21-account-add.png', finmap: '21-account-add.png', path: 'settings/accounts', act: (p) => p.getByRole('button', { name: 'Добавить счёт' }).click() },
```

замените на:

```ts
  {
    ours: 'c21-account-add.png',
    finmap: '21-account-add.png',
    path: 'log',
    act: async (p) => {
      // «+» в «Моих счетах» — окно прямо над журналом (§7.6); шага выбора банка у нас нет
      await p.getByRole('navigation', { name: 'Счета' }).getByRole('button', { name: 'Добавить счёт' }).click();
      await p.getByRole('dialog', { name: 'Добавление нового счёта' }).waitFor();
    },
  },
  {
    ours: 'c22-accounts-edit.png',
    finmap: '22-accounts-edit.png',
    path: 'log',
    act: async (p) => {
      // ✎ «Изменить счета» — окно «Счета» со списком ☰ имя ✎ (§7.6)
      await p.getByRole('navigation', { name: 'Счета' }).getByRole('button', { name: 'Изменить счета' }).click();
      await p.getByRole('dialog', { name: 'Счета', exact: true }).getByRole('list', { name: 'Список счетов' }).waitFor();
    },
  },
```

и после строки сценария `c28-settings-Контрагенты.png` добавьте:

```ts
  { ours: 'c28c-my-counterparties.png', finmap: '28c-my-counterparties.png', path: 'settings/counterparties?type=my' },
```

Run: `npm run typecheck` → без ошибок.

- [ ] **Step 2: Run the visual check**

Run: `npm run shots:ux`
Expected: `Готово: …\parity\index.html — снято 42 из 42.` Упавший сценарий — исправьте его локатор и запустите ещё раз.

- [ ] **Step 3: Compare and write the parity note into the task report**

Пары `docs/research/screens/v2/<Finmap>` ↔ `docs/research/screens/v2/parity/<наш>`: `01-log` ↔ `c01-log` (левая панель), `21-account-add` ↔ `c21-account-add`, `22-accounts-edit` ↔ `c22-accounts-edit`, `28-settings-Контрагенты` ↔ `c28-settings-Контрагенты`, `28c-my-counterparties` ↔ `c28c-my-counterparties`, `29-settings-Счета` ↔ `c29-settings-Счета`, `32-settings-Теги` ↔ `c32-settings-Теги`.

В отчёт задачи (не в файл) — таблица по этим экранам: «совпадает / отличается намеренно (почему) / отличается (что исправить, в каком плане)». Ожидаемо:
- **совпадают:** «Всего на счетах» крупно, строка «Мои счета» с «+ ✎ ⟳»; окно «Счета» с «Добавить счёт» и строками ☰ имя ✎; подменю контрагентов слева в порядке Finmap с иконками «банк» и «i», кнопка «Добавить …» по типу, поле «Поиск» во всю ширину, строки без рамки;
- **отличаются намеренно:** счета в панели сгруппированы по клубам (если клубов больше одного); счётчики у пунктов подменю; серый текст строк (тип и комментарий контрагента, клуб и баланс счёта); нет шага «выберите способ добавления» (интеграций нет) и «Добавить интеграцию»; нет «Показывать копейки»; цвета и шрифт;
- **отличается, план 1.5-4b:** «Категории», «Проекты» и шаблоны, «Мои компании», пользователи, профиль, курсы, копирование, «Настройки журнала».

Контролёр переносит таблицу в файл итогов плана.

- [ ] **Step 4: Final checks**

Run: `npm test` → PASS. Run: `npm run typecheck`. Run: `npm run test:e2e` → все проходят.

- [ ] **Step 5: Commit**

```bash
git add scripts/ux-shots.ts
git commit -m "feat: сверка с Finmap — «Добавление нового счёта» и окно «Счета» из левой панели, «Мои контрагенты»

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## После плана

- Итоги, отложенные замечания и итог визуальной сверки — `docs/superpowers/followups/2026-10-11-stage1_5-plan4a-followups.md` (пишет контролёр).
- Закрыты отложенные: 1.5-1b №1 (группы навигации), 1.5-3b №1 (контраст красного), 4b №1 этапа 1 (заголовки групп в панели счетов).
- Следующий план — [1.5-4b](2026-10-11-stage1_5-plan4b-categories-service-screens.md): «Категории», «Проекты» и шаблоны разделения, «Мои компании» и `CompanyEditDialog` с архивом, пользователи и профиль, курсы и копирование, окончательные «Настройки журнала».
- Замечания для итогов (followups):
  - перетаскивание не прокручивает страницу у края окна: длинный список переставляется через Alt+↑/↓ или по частям (снимок показан, жест работает в видимой части);
  - `ReorderButtons` и `moveWithinGroup` ещё используются «Категориями» и «Проектами» — уходят в плане 1.5-4b;
  - `ConfirmDelete` остаётся у файлов формы операции (не окно настроек).
