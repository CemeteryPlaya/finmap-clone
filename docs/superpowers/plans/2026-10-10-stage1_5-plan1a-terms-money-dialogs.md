# Этап 1.5, план 1.5-1a: терминология, деньги на экране, окна и подтверждение — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** первая половина плана 1.5-1 из §13 спецификации этапа 1.5:
- «Статья» → «Категория» во всём, что видит человек, и тест терминологии (§2.1);
- суммы на экране: копейки только ненулевые, ₸ перед суммой в левой панели и итогах компаний (§2.2);
- балансы и итоги компаний обновляются при возврате на вкладку браузера (§2.5);
- `Modal` с «×» в шапке и липкой шапкой на телефоне (§2.4, §11);
- `ConfirmDialog` — вложенное окно подтверждения; вопрос о несохранённом в форме операции с флажком «Больше не спрашивать» (§2.4).

Вторая половина — шапка, панели «Компании», «Настройки», «История действий», зона настроек, вкладки и сворачивание — в плане [1.5-1b](2026-10-10-stage1_5-plan1b-shell-settings.md).

**Предусловие:** этап 1 выполнен полностью (планы 1–8b, ветка до d8770a7 включительно): 614 unit-тестов (+1 пропущен на Windows), 58 e2e, typecheck чистый.

**Architecture:**
- **Терминология** меняется разовым скриптом вне репозитория по таблице словоформ (у «статьи» и «категории» один род — согласованные слова не меняются). Тест `tests/shared/terminology.test.ts` сканирует `src/**`, `scripts/**` и `README.md`. Тесты и e2e проходят через тот же скрипт: ожидания меняются вместе с кодом.
- **Деньги:** `formatMoney(minor, currency, opts?)` получает `symbol: 'before' | 'after'` и `trimZeroMinor`. Две готовые константы `MONEY_SCREEN` (после суммы) и `MONEY_SCREEN_BEFORE` (перед суммой) — все экранные вызовы передают одну из них. Поля ввода (`amountInputText`), Excel и курсы не меняются.
- **Обновление при возврате на вкладку:** только `useBalances` и `useCompaniesSummary` получают `refetchOnWindowFocus: true, staleTime: 30_000`; общий умолчательный `refetchOnWindowFocus: false` остаётся, журнал сам не перезапрашивается.
- **Вложенные `<dialog>`:** React доставляет события `close` и `cancel` вложенного окна обработчикам родительского `<dialog>` (они не всплывают в DOM, но React собирает обработчики по дереву компонентов). Поэтому `Modal` и `Drawer` реагируют только на свои события (`e.target === e.currentTarget`), а `cycleTab` не считает элементы вложенного окна своими. `ConfirmDialog` останавливает всплытие клавиш и своих событий.
- **Начальный фокус окна не на «×»:** «×» — первая кнопка в DOM (после заголовка), и `showModal()` поставил бы фокус на неё. `Modal` после `showModal()` переносит фокус с «×» на первый доступный элемент содержимого, а если его нет (форма ещё грузится) — на само окно. Так поведение `AmountField` (фокус в сумму, если он «ничей») остаётся прежним.

**Tech Stack:** как в этапе 1: Node 24, TypeScript, Fastify 5, React 19, react-router 8, TanStack Query 5, Tailwind 4, Vitest, Playwright. Новых пакетов нет.

**Spec:** [docs/superpowers/specs/2026-10-10-stage1_5-finmap-ux-design.md](../specs/2026-10-10-stage1_5-finmap-ux-design.md) — §2.1, §2.2, §2.4, §2.5, §9 (поправки к этапу 1), §11 (`Modal`, `ConfirmDialog`), §12, §13 (план 1.5-1, блок «Решения планирования плана 1.5-1»).

**Ветка:** `stage1/plan1-skeleton`. В `main` не сливаем.

## Решения, принятые при планировании

Записаны в спецификацию (§13, блок «Решения планирования плана 1.5-1») тем же коммитом, что и план.

1. **План 1.5-1 разбит на 1.5-1a и 1.5-1b.** 1.5-1a — терминология, деньги, обновление балансов, окна; 1.5-1b — каркас и зона настроек. Каждый даёт работающую программу.
2. **Проверка терминологии ловит и «статье»** (дательный и предложный падеж). В регулярном выражении §2.1 этой формы нет, а в коде она встречается 6 раз. Выражение теста: `[Сс]тат(ья|ьи|ью|ье|ьёй|ьей|ей|ьям|ьями|ьях)` с границами слов в Юникоде.
3. **Обновление при возврате на вкладку сделано в 1.5-1a**, а не в 1.5-1b: это часть «денег на экране».
4. **«×» во всех окнах `Modal`** (сейчас это форма операции и «Фильтр»). «Отмена» убирается из подвала формы операции; в окне «Фильтр» «Отмена» остаётся до плана 1.5-2 (§5.6).
5. **`ConfirmDialog` в этом плане используется только для вопроса о несохранённом.** Остальные подтверждения переходят позже, как разрешает §13:
   - «Удалить платёж» и подтверждение в «Разделить» — план 1.5-3 (строки-действия §6.7). До него удаление подтверждается строкой в подвале, как сейчас;
   - удаление в окнах настроек — план 1.5-4 (`SettingsList`);
   - «Изменить в перевод» — план 1.5-6.
6. **Возврат вопроса о несохранённом** («Спрашивать перед закрытием формы…») появляется в плане 1.5-1b на странице «Настройки журнала» (минимальная версия). Между 1.5-1a и 1.5-1b настройку можно вернуть только запросом `PUT /api/v1/preferences/operationForm.skipCloseConfirm` со значением `false`. Планы выполняются подряд, поэтому так и задумано.
7. **Вопрос о несохранённом без изменений не задаётся** (наше, решение 6 владельца). Флажок «Больше не спрашивать» сохраняется только по кнопке «Закрыть». «Отменить» и Esc флажок не сохраняют.
8. **Фокус после «Отменить» в вопросе** возвращается на элемент, с которого спросили: «×» или поле, где нажали Esc. Если элемента уже нет — в поле суммы.

## Global Constraints

- **Принцип (§1):** «расположение и приёмы как в Finmap, внешний вид свой; где наше лучше — оставляем». Мёртвых кнопок нет.
- **Терминология (§2.1):** «Статья» → «Категория» во всех падежах и числах — интерфейс, сообщения сервера, заголовок Excel, вывод скриптов, README, комментарии. **Не меняются:** идентификаторы в коде (`category*`), таблицы БД, параметры адреса (`category`, `noCategory`), коды ошибок. Спецификация этапа 1 не переписывается.
- **Деньги (§2.2):** «Копейки показываются, только если они не нулевые: «1 500 ₸», но «1 500,50 ₸». Правило действует для каждой суммы отдельно, столбец не выравнивается.» ₸ перед суммой: «Всего на счетах», балансы в левой панели, итоги в панели «Компании», карточки «Мои компании», панель «История действий»; формат «₸ 114 997», отрицательная — «−₸ 1 378». ₸ после суммы: журнал, карточки телефона, итог выделения, подсказки разбиения, форма. Не меняются поля ввода (`amountInputText`), Excel, курсы. Минус — U+2212, разряды — U+202F.
- **Обновление (§2.5):** «При возврате на вкладку браузера (`refetchOnWindowFocus: true`, `staleTime` 30 с) обновляются только недорогие запросы: `['accounts', cid, 'balances']` и `['companies', 'summary']`. Журнал сам не перезапрашивается.»
- **Окна (§2.4, §11):** «×» справа в шапке (`aria-label="Закрыть"`) вызывает `onCancel`, если он задан, иначе закрывает окно; на телефоне шапка липкая (`sticky top-0`). «×» стоит в DOM после заголовка, начальный фокус не на ней. Esc при заданном `onCancel` вызывает его; Esc, уже обработанный вложенным списком (`defaultPrevented`), окно не трогает. Tab по кругу (`cycleTab`).
- **`ConfirmDialog` (§2.4, §11):** вложенный `<dialog role="alertdialog">` через `showModal()` с `aria-labelledby` и `aria-describedby`; кнопки «Отменить» (слева, фокус по умолчанию) и действие справа. Esc = «Отменить»: закрывается только подтверждение, событие не всплывает к форме. Пока идёт запрос действия, обе кнопки недоступны, Esc игнорируется.
- **Вопрос о несохранённом (§2.4):** заголовок «Ваши данные не сохранятся», текст «Закрыть окно? Введённые данные будут потеряны.», флажок «Больше не спрашивать», кнопки «Отменить | Закрыть». Только при изменениях. Флажок → настройка `operationForm.skipCloseConfirm = true`; значение неизвестного вида = `false`.
- **Доступность планов 5–7 сохраняется:** Popover (R2 плана 5b), `Drawer` (Tab по кругу, Esc, «✕», фон закрывают, фокус возвращается), `cycleTab` пропускает недоступные элементы, невыбранные радиокнопки и `tabindex="-1"`.
- **Без новых npm-пакетов.**
- **Невидимые символы** (U+2212, U+202F, U+00A0, U+200B) в коде — только экранированием `\u2212` и т. п. Инструмент записи может превратить экранирование в сам символ: после записи файла выполните проверку из шага задачи.
- **Концы строк:** рабочая копия в CRLF (`core.autocrlf=true`). Правки «найдите → замените» — инструментом правки файлов.
- **E2E:** порт 41731 (`E2E_PORT`), один пользователь `admin`/`e2e-password-1` и одна база на прогон; левая панель `<nav aria-label="Счета">` есть на каждой странице компании — не ищите элементы без области; `name:` в Playwright — подстрока без учёта регистра; данные — через `page.request` с `origin` и `x-requested-with: fetch`; общую настройку пользователя, которую тест меняет, тест возвращает в `finally`; без фиксированных пауз.
- **Безопасность среды (обязательно):**
  - никогда не запускайте `npm start`, `npm run stop`, `npm run setup`, `npm run service:install`, `npm run service:uninstall`, `schtasks` и `icacls` — ни в каком виде и ни с какими настройками: на этой машине на порту 3457 работает живое приложение пользователя с его `data/`;
  - на порту 3460 работает демо-экземпляр — не останавливайте его и не трогайте его процессы;
  - e2e идут на порту 41731 со своей временной базой (`e2e/server.ts`);
  - shell-команды не содержат подстроку «.env»; собирать её из частей запрещено.
- **Завершение задачи:** зелёные `npm test`, `npm run typecheck` и `npm run test:e2e`; если задача меняет e2e — `npm run test:e2e` дважды подряд. Коммит с трейлером `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. В коммит попадает каждый новый файл задачи.

## Review Focus

1. **Esc во вложенном подтверждении** закрывает только подтверждение: форма остаётся открытой, фокус возвращается в поле, где нажали Esc; повторный Esc снова задаёт вопрос. Событие `close` подтверждения не закрывает форму. Тест — задача 4 (`e2e/dialogs.spec.ts`).
2. **«Больше не спрашивать» отмечен, но нажата «Отменить»** — настройка не сохраняется, следующий Esc снова спрашивает, флажок снова пуст. Тест — задача 4.
3. **Окно открывается, пока данные грузятся** (правка операции): фокус в сумме, а не на «×»; в форме архивной компании — на «Закрыть» внизу; Shift+Tab с первого элемента ведёт на «×», фокус не уходит из окна. Тест — задача 3.
4. **Отрицательный баланс с копейками в левой панели** — «−₸ 500,50», итог «−₸ 500,50»; ноль — «₸ 0». Тесты — задача 2 (unit `money.test.ts` и e2e `money.spec.ts`).
5. **Другой пользователь внёс операцию, пока вкладка была в фоне** — после возврата на вкладку баланс и итог в левой панели новые, журнал не перезапрашивался. Тест — задача 2.
6. **Слово в редкой форме** («статье», «статьёй») и слова-соседи («остаться», «статус») — проверка терминологии находит первые и не путает вторые. Тест — задача 1.

---

## Карта файлов

```
tests/shared/terminology.test.ts                  # (новый) проверка терминологии §2.1
src/**, scripts/**, README.md, tests/**, e2e/**  # замена «статья» → «категория» скриптом (≈ 40 файлов кода и ≈ 30 файлов тестов)
src/client/lib/journal-format.ts                  # комментарий splitLabel; signedMoney — без нулевых копеек
src/shared/money.ts                               # formatMoney(minor, currency, opts), MONEY_SCREEN, MONEY_SCREEN_BEFORE
src/client/lib/journal-card.ts                    # суммы без нулевых копеек
src/client/components/journal/JournalTable.tsx    # суммы без нулевых копеек
src/client/components/operation/SplitEditor.tsx   # подсказки разбиения без нулевых копеек
src/client/components/AccountsPanel.tsx           # ₸ перед суммой
src/client/components/CompanySwitcher.tsx         # ₸ перед суммой (в 1.5-1b заменяется панелью «Компании»)
src/client/pages/settings/AccountsSettings.tsx    # стартовый остаток через formatMoney
src/client/lib/queries.ts                         # балансы и итоги — обновление при возврате на вкладку
src/client/components/focus-trap.ts               # вложенные окна не участвуют в Tab по кругу; firstTabbable
src/client/components/Modal.tsx                   # «×», липкая шапка, свои события, начальный фокус
src/client/components/Drawer.tsx                  # только свои события close
src/client/components/ConfirmDialog.tsx           # (новый) вложенное подтверждение
src/client/lib/preferences.ts                     # (новый) operationForm.skipCloseConfirm
src/client/components/operation/OperationForm.tsx # вопрос о несохранённом в ConfirmDialog, без «Отмена»
tests/shared/money.test.ts, tests/client/journal.test.ts, tests/client/journal-card.test.ts, tests/client/focus-trap.test.ts
tests/client/preferences.test.ts                  # (новый)
e2e/dialogs.spec.ts                               # (новый) «×», вопрос о несохранённом
e2e/money.spec.ts, journal.spec.ts, journal-actions.spec.ts, operation-form.spec.ts, operation-edit.spec.ts, mobile.spec.ts
```

---

### Task 1: «Статья» → «Категория» и тест терминологии

**Files:**
- Create: `tests/shared/terminology.test.ts`
- Modify (скриптом): все файлы `src/**`, `scripts/**`, `README.md`, `tests/**`, `e2e/**` со словом «статья» в любой форме (кроме `tests/shared/terminology.test.ts`); вручную — `src/client/lib/journal-format.ts` (комментарий)

**Interfaces:**
- Consumes: —
- Produces: текст интерфейса и сообщений с «Категория/Категории/категорию/…»; заголовок колонки журнала `JOURNAL_COLUMNS` `category` — «Категория»; пункт настроек — «Категории»; `splitLabel(n, 'category')` — «2 категории»; `ENTITY_LABELS.category` — «Категория»; заголовок Excel — «Категория». Последующие задачи и план 1.5-1b пишут уже новые слова.

- [ ] **Step 1: Write the failing test**

`tests/shared/terminology.test.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * §2.1 этапа 1.5: в том, что видит человек (и в комментариях — чтобы проверка была простой), слова «статья»
 * нет ни в одной форме. Идентификаторы (`category*`) — английские, их проверка не касается.
 */
const WORD = /(?<![\p{L}\p{N}_])[Сс]тат(?:ья|ьи|ью|ье|ьёй|ьей|ей|ьям|ьями|ьях)(?![\p{L}\p{N}_])/gu;
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.html', '.css', '.md']);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (EXTENSIONS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

function hits(file: string): string[] {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const found: string[] = [];
  lines.forEach((line, i) => {
    for (const m of line.matchAll(WORD)) found.push(`${path.relative(process.cwd(), file)}:${i + 1}: ${m[0]}`);
  });
  return found;
}

describe('терминология (§2.1 этапа 1.5)', () => {
  it('в src, scripts и README нет слова «статья» ни в одной форме', () => {
    const files = [...walk(path.resolve('src')), ...walk(path.resolve('scripts')), path.resolve('README.md')];
    expect(files.length).toBeGreaterThan(50);
    expect(files.flatMap(hits)).toEqual([]);
  });

  it('проверка находит все формы и не путает слова-соседи', () => {
    // слова собраны из частей: файл теста не должен сам попасть под замену скриптом
    const stem = ['С', 'тат'].join('');
    for (const ending of ['ья', 'ьи', 'ью', 'ье', 'ьёй', 'ьей', 'ей', 'ьям', 'ьями', 'ьях']) {
      for (const word of [stem + ending, stem.toLowerCase() + ending]) expect(`«${word}»`.match(WORD), word).not.toBeNull();
    }
    for (const word of ['остаться', 'достаться', 'статус', 'статистика', 'постатейно', 'состатья']) {
      expect(word.match(WORD), word).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/terminology.test.ts`
Expected: FAIL — первый тест перечисляет около 170 мест вида `src\client\pages\settings\SettingsNav.tsx:7: Статьи`; второй проходит.

- [ ] **Step 3: Create the one-off rename script outside the repository**

Скрипт разовый и в репозиторий не попадает (иначе его же слова нарушили бы проверку `scripts/**`). Создайте файл `rename-terms.mjs` в своей временной папке (scratchpad агента; если её нет — `%TEMP%`), например `C:\Users\<вы>\AppData\Local\Temp\rename-terms.mjs`:

```js
// Разовая замена «статья» → «категория» (§2.1 этапа 1.5) во всех формах, с сохранением заглавной буквы.
// Запуск из корня репозитория: node <путь>/rename-terms.mjs src scripts README.md tests e2e
import fs from 'node:fs';
import path from 'node:path';

const WORDS = {
  'статья': 'категория',
  'статьи': 'категории',
  'статью': 'категорию',
  'статье': 'категории',
  'статьей': 'категорией',
  'статьёй': 'категорией',
  'статей': 'категорий',
  'статьям': 'категориям',
  'статьями': 'категориями',
  'статьях': 'категориях',
};
const RE = /(?<![\p{L}\p{N}_])[Сс]тат(?:ья|ьи|ью|ье|ьёй|ьей|ей|ьям|ьями|ьях)(?![\p{L}\p{N}_])/gu;
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.html', '.css', '.md']);
const SKIP = new Set(['node_modules', 'dist']);

function files(p) {
  const st = fs.statSync(p);
  if (!st.isDirectory()) return [p];
  return fs.readdirSync(p).filter((n) => !SKIP.has(n)).flatMap((n) => files(path.join(p, n)));
}

let total = 0;
for (const root of process.argv.slice(2)) {
  for (const file of files(root)) {
    if (!EXTENSIONS.has(path.extname(file))) continue;
    if (path.basename(file) === 'terminology.test.ts') continue;
    const text = fs.readFileSync(file, 'utf8');
    let n = 0;
    const next = text.replace(RE, (w) => {
      n++;
      const r = WORDS[w.toLowerCase()];
      return w[0] === 'С' ? r[0].toUpperCase() + r.slice(1) : r;
    });
    if (n > 0) {
      fs.writeFileSync(file, next, 'utf8');
      console.log(`${file}: ${n}`);
      total += n;
    }
  }
}
console.log(`Всего замен: ${total}`);
```

Скрипт читает и пишет файлы как есть: концы строк CRLF и BOM (его в этих файлах нет) не меняются.

- [ ] **Step 4: Run the script**

Run (из `D:\finmap-clone`): `node "<путь к rename-terms.mjs>" src scripts README.md tests e2e`
Expected: список файлов с числом замен и строка `Всего замен: 325` (около того: при подготовке плана в `src`, `scripts`, `README.md`, `tests` и `e2e` было 325 вхождений).

Проверка, что заменено только нужное: `git diff --stat` — меняются только `.ts`, `.tsx` и `README.md`; в `git diff` нет изменений идентификаторов (поиск по диффу `-.*category` и `+.*category` даёт одинаковые строки).

- [ ] **Step 5: Fix the comment the script made awkward**

В `src/client/lib/journal-format.ts` комментарий над `splitLabel` после замены читается так: «/** «2 категории», «5 проектов» — подпись разбитой операции (§7; «N категорий» спецификации — категории, как везде в интерфейсе). */». Замените его на:

```ts
/** «2 категории», «5 проектов» — подпись разбитой операции (§5.2 этапа 1.5). */
```

- [ ] **Step 6: Run the terminology test and the whole unit suite**

Run: `npx vitest run tests/shared/terminology.test.ts`
Expected: PASS (2 теста).

Run: `npm test`
Expected: PASS — 616 тестов (614 + 2 новых), 1 пропущен. Сообщения сервера и заголовок Excel поменялись вместе с ожиданиями в тестах.

Run: `npm run typecheck`
Expected: без ошибок.

- [ ] **Step 7: Run e2e twice**

Run: `npm run test:e2e` — затем ещё раз `npm run test:e2e`
Expected: 58 passed оба раза. Если какой-то тест падает на тексте («Без категории», «Категория:», «Категории: поиск»), значит, скрипт не прошёл по файлу теста: проверьте, что он запускался с аргументом `e2e`.

- [ ] **Step 8: Commit**

```bash
git add -A src scripts README.md tests e2e
git commit -m "feat: «Статья» → «Категория» во всём интерфейсе, сообщениях и выгрузке; тест терминологии

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Деньги на экране и обновление балансов при возврате на вкладку

**Files:**
- Modify: `src/shared/money.ts`, `tests/shared/money.test.ts`
- Modify: `src/client/lib/journal-format.ts`, `src/client/lib/journal-card.ts`, `src/client/components/journal/JournalTable.tsx`, `src/client/components/operation/SplitEditor.tsx`, `src/client/components/AccountsPanel.tsx`, `src/client/components/CompanySwitcher.tsx`, `src/client/pages/settings/AccountsSettings.tsx`, `src/client/lib/queries.ts`
- Modify (тесты): `tests/client/journal.test.ts`, `tests/client/journal-card.test.ts`, `e2e/money.spec.ts`, `e2e/journal.spec.ts`, `e2e/journal-actions.spec.ts`, `e2e/operation-form.spec.ts`, `e2e/operation-edit.spec.ts`, `e2e/mobile.spec.ts`

**Interfaces:**
- Consumes: `formatAmount(minor, minorUnits)`, `getCurrency(code)`.
- Produces (`src/shared/money.ts`):
  - `export interface MoneyFormat { symbol?: 'before' | 'after'; trimZeroMinor?: boolean }`;
  - `formatMoney(minor: number, currency: string, opts?: MoneyFormat): string` — без `opts` вывод прежний («1 500,00 ₸»);
  - `MONEY_SCREEN: MoneyFormat` = `{ trimZeroMinor: true }` — журнал, карточки, форма, подсказки;
  - `MONEY_SCREEN_BEFORE: MoneyFormat` = `{ symbol: 'before', trimZeroMinor: true }` — левая панель, итоги компаний, история действий (план 1.5-1b).
- Produces (`src/client/lib/queries.ts`): `useBalances` и `useCompaniesSummary` с `refetchOnWindowFocus: true`, `staleTime: 30_000`.

- [ ] **Step 1: Write the failing tests**

В `tests/shared/money.test.ts` замените блок `describe('formatMoney', …)` целиком:

```ts
describe('formatMoney', () => {
  it('без настроек — как раньше: копейки всегда, символ после суммы через неразрывный пробел', () => {
    expect(formatMoney(150050, 'KZT')).toBe('1\u202F500,50\u00A0₸');
    expect(formatMoney(-500, 'USD')).toBe('\u22125,00\u00A0$');
    expect(formatMoney(1000, 'JPY')).toBe('1\u202F000\u00A0¥');
  });

  it('trimZeroMinor: нулевые копейки не показываются, ненулевые — полностью (каждая сумма отдельно)', () => {
    expect(formatMoney(150000, 'KZT', MONEY_SCREEN)).toBe('1\u202F500\u00A0₸');
    expect(formatMoney(150050, 'KZT', MONEY_SCREEN)).toBe('1\u202F500,50\u00A0₸');
    expect(formatMoney(150005, 'KZT', MONEY_SCREEN)).toBe('1\u202F500,05\u00A0₸');
    expect(formatMoney(0, 'KZT', MONEY_SCREEN)).toBe('0\u00A0₸');
    expect(formatMoney(-500, 'USD', MONEY_SCREEN)).toBe('\u22125\u00A0$');
    expect(formatMoney(-550, 'USD', MONEY_SCREEN)).toBe('\u22125,50\u00A0$');
  });

  it('валюты без дробной части и с тремя знаками', () => {
    expect(formatMoney(1000, 'JPY', MONEY_SCREEN)).toBe('1\u202F000\u00A0¥');
    expect(formatMoney(12000, 'KWD', MONEY_SCREEN)).toBe('12\u00A0KD');
    expect(formatMoney(12500, 'KWD', MONEY_SCREEN)).toBe('12,500\u00A0KD');
  });

  it('символ перед суммой: «₸ 114 997», отрицательная — «−₸ 1 378»', () => {
    expect(formatMoney(11499700, 'KZT', MONEY_SCREEN_BEFORE)).toBe('₸\u00A0114\u202F997');
    expect(formatMoney(-137800, 'KZT', MONEY_SCREEN_BEFORE)).toBe('\u2212₸\u00A01\u202F378');
    expect(formatMoney(-50050, 'KZT', MONEY_SCREEN_BEFORE)).toBe('\u2212₸\u00A0500,50');
    expect(formatMoney(0, 'KZT', MONEY_SCREEN_BEFORE)).toBe('₸\u00A00');
    expect(formatMoney(-500, 'USD', { symbol: 'before' })).toBe('\u2212$\u00A05,00');
  });
});
```

И строку импорта в начале файла:

```ts
import { allocate, formatAmount, formatMoney, MONEY_SCREEN, MONEY_SCREEN_BEFORE, parseAmount } from '../../src/shared/money';
```

В `tests/client/journal.test.ts` в тесте «сумма со знаком по типу и текст поля суммы» замените две строки:

```ts
    expect(signedMoney('income', 150050, 'KZT')).toBe('+1\u202F500,50\u00A0₸');
    expect(signedMoney('expense', 500, 'USD')).toBe('\u22125\u00A0$');
```

(первая не меняется — копейки ненулевые; вторая — без «,00»).

В `tests/client/journal-card.test.ts` замените ожидания сумм (после задачи 1 «2 статьи» там уже «2 категории»):

```ts
      amount: '\u22122 500 ₸',
```
(в первом тесте вместо `amount: '\u22122 500,00 ₸',`)

```ts
    expect(plain(journalCardText(split, lookups, ctx))).toMatchObject({ title: '2 категории', amount: '+2 500 ₸', date: 'вчера 08:00', details: null });
```

```ts
      amount: '500 ₸',
      extra: '→ 1 $',
```

```ts
    expect(plain(journalCardText(usd, lookups, ctx))).toMatchObject({ title: '…', account: 'Валютный', amount: '\u22121 $', extra: '500 ₸', details: '…' });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/shared/money.test.ts tests/client/journal.test.ts tests/client/journal-card.test.ts`
Expected: FAIL — `MONEY_SCREEN` не экспортируется; суммы с «,00».

- [ ] **Step 3: Implement formatMoney options**

В `src/shared/money.ts` замените функцию `formatMoney` с её комментарием:

```ts
/** Как показывать сумму на экране (§2.2 этапа 1.5). */
export interface MoneyFormat {
  /** Символ валюты перед суммой («₸ 114 997») или после («114 997 ₸», по умолчанию). */
  symbol?: 'before' | 'after';
  /** Нулевые копейки не показывать: «1 500 ₸», но «1 500,50 ₸». */
  trimZeroMinor?: boolean;
}

/** Журнал, карточки, форма, подсказки разбиения: символ после суммы, без нулевых копеек. */
export const MONEY_SCREEN: MoneyFormat = { trimZeroMinor: true };
/** Левая панель, итоги компаний, история действий: «₸ 114 997», «−₸ 1 378». */
export const MONEY_SCREEN_BEFORE: MoneyFormat = { symbol: 'before', trimZeroMinor: true };

/**
 * Сумма с символом валюты: «1 500,50 ₸» — неразрывный пробел не даёт символу уехать на другую строку.
 * Минус (U+2212) всегда в самом начале: «−1 378 ₸», «−₸ 1 378». Поля ввода и Excel эту функцию не используют.
 */
export function formatMoney(minor: number, currency: string, opts: MoneyFormat = {}): string {
  const c = getCurrency(currency);
  let amount = formatAmount(Math.abs(minor), c.minorUnits);
  if (opts.trimZeroMinor && c.minorUnits > 0 && Math.abs(minor) % 10 ** c.minorUnits === 0) {
    amount = amount.slice(0, -(c.minorUnits + 1));
  }
  const sign = minor < 0 ? '\u2212' : '';
  return opts.symbol === 'before' ? `${sign}${c.symbol}\u00A0${amount}` : `${sign}${amount}\u00A0${c.symbol}`;
}
```

- [ ] **Step 4: Use the screen formats on every screen**

`src/client/lib/journal-format.ts`: импорт `import { formatAmount, formatMoney, MONEY_SCREEN } from '../../shared/money';`; функцию `signedMoney` замените:

```ts
/** Сумма со знаком по типу: доход «+1 500 ₸», расход «−1 500,50 ₸», перевод без знака; нулевые копейки не показываются. */
export function signedMoney(type: OperationType, minor: number, currency: string): string {
  const sign = type === 'income' ? '+' : type === 'expense' ? '\u2212' : '';
  return `${sign}${formatMoney(minor, currency, MONEY_SCREEN)}`;
}
```

`src/client/lib/journal-card.ts`: импорт `import { formatMoney, MONEY_SCREEN } from '../../shared/money';`; две строки:

```ts
    extra = `→ ${formatMoney(item.toAmount, toAccount.currency, MONEY_SCREEN)}`;
```
```ts
    extra = formatMoney(item.baseAmount, ctx.baseCurrency, MONEY_SCREEN);
```

`src/client/components/journal/JournalTable.tsx`: импорт `import { formatMoney, MONEY_SCREEN } from '../../../shared/money';`; во всех пяти вызовах `formatMoney(…)` добавьте третий аргумент `MONEY_SCREEN`:

```ts
    return `${category} · ${project} — ${formatMoney(l.amount, currency, MONEY_SCREEN)}`;
```
```tsx
        <span className={`block text-xs tabular-nums ${balance < 0 ? 'text-expense' : 'text-muted'}`}>остаток {formatMoney(balance, account.currency, MONEY_SCREEN)}</span>
```
```tsx
                    <span className="block text-xs text-transfer">→ {formatMoney(item.toAmount, toAccount.currency, MONEY_SCREEN)}</span>
```
```tsx
                  {currency !== props.baseCurrency && <span className="block text-xs text-muted">{formatMoney(item.baseAmount, props.baseCurrency, MONEY_SCREEN)}</span>}
                  {share !== null && <span className="block text-xs text-muted">доля проекта: {formatMoney(share, currency, MONEY_SCREEN)}</span>}
```

`src/client/components/operation/SplitEditor.tsx`: импорт `import { formatMoney, MONEY_SCREEN } from '../../../shared/money';`; три вызова:

```ts
            ? `Не распределено: ${formatMoney(result.left, props.currency, MONEY_SCREEN)}`
            : `Распределено больше суммы на ${formatMoney(-result.left, props.currency, MONEY_SCREEN)}`
```
```tsx
              hint={result.amounts[i] != null ? `= ${formatMoney(result.amounts[i]!, props.currency, MONEY_SCREEN)}` : undefined}
```

`src/client/components/AccountsPanel.tsx`: импорт `import { formatMoney, MONEY_SCREEN_BEFORE } from '../../shared/money';`; итог и баланс:

```tsx
        <p className="truncate text-xl font-bold tabular-nums">{total ? formatMoney(total.amount, total.currency, MONEY_SCREEN_BEFORE) : balances.error ? '—' : '…'}</p>
```
```tsx
                  {balance === undefined ? '…' : formatMoney(balance, a.currency, MONEY_SCREEN_BEFORE)}
```

`src/client/components/CompanySwitcher.tsx`: импорт `import { formatMoney, MONEY_SCREEN_BEFORE } from '../../shared/money';`; строка итога:

```tsx
                    {formatMoney(t.amount, t.currency, MONEY_SCREEN_BEFORE)}
```

`src/client/pages/settings/AccountsSettings.tsx`: импорт `import { formatAmount } from '../../../shared/money';` замените на `import { formatMoney, MONEY_SCREEN } from '../../../shared/money';`; строку остатка:

```tsx
                          Остаток на {formatDateRu(a.openedAt)}: {formatMoney(a.startingBalance, a.currency, MONEY_SCREEN)}
```

Если после этого `cur` (строка `const cur = getCurrency(a.currency);`) больше нигде в этой функции не используется, удалите эту строку и импорт `getCurrency` — `npm run typecheck` в шаге 7 покажет, если что-то осталось.

Проверка: `grep -rn "formatMoney(" src/client` — у каждого вызова третий аргумент `MONEY_SCREEN` или `MONEY_SCREEN_BEFORE`.

- [ ] **Step 5: Refetch balances and the summary on window focus**

В `src/client/lib/queries.ts` над `useBalances` добавьте:

```ts
/**
 * Недорогие запросы обновляются при возврате на вкладку браузера (§2.5 этапа 1.5), не чаще раза в 30 с.
 * Журнал сам не перезапрашивается (общая настройка refetchOnWindowFocus: false): бесконечная прокрутка
 * перезапросила бы все загруженные страницы — его обновляет кнопка ⟳.
 */
const REFRESH_ON_FOCUS = { refetchOnWindowFocus: true, staleTime: 30_000 } as const;
```

и добавьте `...REFRESH_ON_FOCUS,` в оба запроса:

```ts
export function useBalances(companyId: number) {
  return useQuery<Balances, ApiError>({
    queryKey: ['accounts', companyId, 'balances'],
    queryFn: () => api<Balances>(`/companies/${companyId}/balances`),
    ...REFRESH_ON_FOCUS,
  });
}
```

```ts
export function useCompaniesSummary(enabled: boolean) {
  return useQuery<CompanySummary[], ApiError>({
    queryKey: ['companies', 'summary'],
    queryFn: async () => (await api<{ companies: CompanySummary[] }>('/companies/summary')).companies,
    enabled,
    ...REFRESH_ON_FOCUS,
  });
}
```

`invalidateQueries` после изменений по-прежнему перезапрашивает их сразу: помеченный устаревшим запрос не ждёт 30 с.

- [ ] **Step 6: Run unit tests**

Run: `npx vitest run tests/shared/money.test.ts tests/client/journal.test.ts tests/client/journal-card.test.ts`
Expected: PASS.

- [ ] **Step 7: Update e2e expectations**

Ниже — полные строки «было → стало» (номера строк — для поиска; после задачи 1 они не сдвинулись). В Playwright `toContainText` сравнивает текст с пробелами, нормализованными в обычный пробел, поэтому `\s` в выражениях совпадает с U+00A0 и U+202F. Суммы в левой панели и в переключателе — с ₸ впереди, в журнале — с ₸ после, без «,00».

`e2e/money.spec.ts`:
- 40: `await expect(panel).toContainText(/Всего на счетах\s*1\s500,00\s₸/);` → `await expect(panel).toContainText(/Всего на счетах\s*₸\s1\s500(?![\s\d])/);`
- 41: `…{ name: /^Kaspi/ })).toContainText(/1\s300,00\s₸/);` → `…{ name: /^Kaspi/ })).toContainText(/₸\s1\s300$/);`
- 42: `…{ name: /^Сейф/ })).toContainText(/200,00\s₸/);` → `…{ name: /^Сейф/ })).toContainText(/₸\s200$/);`
- 50: `await expect(page.getByRole('menuitem', { name })).toContainText(/1\s500,00\s₸/);` → `await expect(page.getByRole('menuitem', { name })).toContainText(/₸\s1\s500$/);`
- 90: `/Всего на счетах\s*0,00\s₸/` → `/Всего на счетах\s*₸\s0(?![\s\d])/`
- 91: `…{ name: /^Евро-счёт/ })).toContainText(/10,00\s€/);` → `…{ name: /^Евро-счёт/ })).toContainText(/€\s10$/);`
- 108: `/Всего на счетах\s*5\s000,00\s₸/` → `/Всего на счетах\s*₸\s5\s000(?![\s\d])/`
- 114: `/Всего на счетах\s*5\s100,00\s₸/` → `/Всего на счетах\s*₸\s5\s100(?![\s\d])/`
- 184 и 190: `/Всего на счетах\s*1\s000,00\s₸/` → `/Всего на счетах\s*₸\s1\s000(?![\s\d])/` (обе строки)

`e2e/journal.spec.ts`:
- 84: `toContainText(/700,00\s₸/);` (ссылка «Касса» в панели) → `toContainText(/₸\s700$/);`
- 85: `toContainText(/1,00\s\$/);` (ссылка «Валютный» в панели) → `toContainText(/\$\s1$/);`
- 86: `/Всего на счетах\s*1\s200,00\s₸/` → `/Всего на счетах\s*₸\s1\s200(?![\s\d])/`
- 91: `await expect(transfer).toContainText(/500,00\s₸/);` → `await expect(transfer).toContainText(/500\s₸/);`
- 92: `/→ 1,00\s\$/` → `/→ 1\s\$/`
- 93: `/Касса\s*остаток 700,00\s₸/` → `/Касса\s*остаток 700\s₸/`
- 94: `/Валютный\s*остаток 1,00\s\$/` → `/Валютный\s*остаток 1\s\$/`
- 95: `/\u2212300,00\s₸/` → `/\u2212300\s₸/`
- 96: `/остаток 1\s200,00\s₸/` → `/остаток 1\s200\s₸/`
- 99: `/\+500,00\s₸/` → `/\+500\s₸/`
- 100: `/остаток 1\s500,00\s₸/` → `/остаток 1\s500\s₸/`
- 107: `/Аренда · Клуб Юг — 200,00\s₸/` → `/Аренда · Клуб Юг — 200\s₸/`
- 109: `/Аренда · Клуб Север — 100,00\s₸/` → `/Аренда · Клуб Север — 100\s₸/`
- 138: `/\u221299,00\s₸/` → `/\u221299\s₸/`
- 143: `// по дате новые сверху: последняя внесённая — 55,00 ₸` → `// по дате новые сверху: последняя внесённая — 55 ₸`
- 144 и 150: `/\+55,00\s₸/` → `/\+55\s₸/`
- 153 и 156: `/\+1,00\s₸/` → `/\+1\s₸/`
- 174: `bodyRows(page).filter({ hasText: /\u22122,00\s\$/ })).toContainText(/1\s000,00\s₸/);` → `bodyRows(page).filter({ hasText: /\u22122\s\$/ })).toContainText(/1\s000\s₸/);`

`e2e/journal-actions.spec.ts`:
- 287, 379, 410: `/980,00\s₸/` → `/₸\s980$/` (ссылка «Kaspi» в панели)
- 356: `/950,00\s₸/` → `/₸\s950$/`
- 330: `/^Выбрать операцию: сегодня \d{2}:\d{2}, \u221210,00\s₸, операция A$/` → `/^Выбрать операцию: сегодня \d{2}:\d{2}, \u221210\s₸, операция A$/`
- 331: `/, \+40,00\s₸, операция D$/` → `/, \+40\s₸, операция D$/`

`e2e/mobile.spec.ts`:
- 74: `/Всего на счетах\s*1\s200,00\s₸/` → `/Всего на счетах\s*₸\s1\s200(?![\s\d])/`
- 75: `…{ name: /^Kaspi/ })).toContainText(/1\s000,00\s₸/);` → `…{ name: /^Kaspi/ })).toContainText(/₸\s1\s000$/);`
- 76: `…{ name: /^Сейф/ })).toContainText(/200,00\s₸/);` → `…{ name: /^Сейф/ })).toContainText(/₸\s200$/);`
- 167: `/\u22122\s500,00\s₸/` → `/\u22122\s500\s₸/`
- 188: `/\u22121\s250,00\s₸/` → `/\u22121\s250\s₸/`

`e2e/operation-edit.spec.ts`:
- 89: `/350,00\s₸/` → `/350\s₸/`
- 173: `/500,00\s₸/` → `/500\s₸/`
- 174: `/100,00\s\$/` → `/100\s\$/`
- 175: `toContainText(/9\s500,00\s₸/);` (ссылка «Касса» в панели) → `toContainText(/₸\s9\s500$/);`
- 246: `/150,00\s₸/` → `/150\s₸/`
- 319: `await rows(page).first().getByText(/70,00/).first().click();` → `await rows(page).first().getByText(/70\s₸/).first().click();`

`e2e/operation-form.spec.ts`:
- 73: `/\+2\s000,00\s₸/` → `/\+2\s000\s₸/`
- 74: `…{ name: /^Касса/ })).toContainText(/3\s000,00\s₸/);` → `…{ name: /^Касса/ })).toContainText(/₸\s3\s000$/);`
- 89: `/300,00\s₸/` → `/300\s₸/`
- 101: `…{ name: /^Касса/ })).toContainText(/2\s200,00\s₸/);` → `…{ name: /^Касса/ })).toContainText(/₸\s2\s200$/);`
- 102 и 351: `…{ name: /^Валютный/ })).toContainText(/1,00\s\$/);` → `…{ name: /^Валютный/ })).toContainText(/\$\s1$/);`
- 103: `/Всего на счетах\s*2\s700,00\s₸/` → `/Всего на счетах\s*₸\s2\s700(?![\s\d])/`
- 187: `toContainText(/100,00/);` → `toContainText(/100\s₸/);`
- 188: `toContainText(/200,00/);` → `toContainText(/200\s₸/);`
- 251: `/= 600,00\s₸/` → `/= 600\s₸/`
- 252: `/= 400,00\s₸/` → `/= 400\s₸/`
- 258: `/1\s000,00\s₸/` → `/1\s000\s₸/`
- 350: `…{ name: /^Касса/ })).toContainText(/700,00\s₸/);` → `…{ name: /^Касса/ })).toContainText(/₸\s700$/);`
- 352: `/Всего на счетах\s*1\s200,00\s₸/` → `/Всего на счетах\s*₸\s1\s200(?![\s\d])/`
- 357: `/остаток 1\s500,00\s₸/` → `/остаток 1\s500\s₸/`
- 360: `/остаток 1\s200,00\s₸/` → `/остаток 1\s200\s₸/`
- 362: `/остаток 700,00\s₸/` → `/остаток 700\s₸/`
- 363: `/остаток 1,00\s\$/` → `/остаток 1\s\$/`
- 465: `/5\s605,00\s₸/` → `/5\s605\s₸/`

Проверка: `grep -rn ",00" e2e` — совпадений нет (кроме строк, где «,00» стоит в тексте ввода, например `fill('1 500,505')` — их не трогаем; `,00` там нет).

- [ ] **Step 8: Write the new e2e tests (negative balance, refetch on focus)**

В конец `e2e/money.spec.ts` добавьте:

```ts
test('отрицательный баланс с копейками в панели: «−₸ 500,50»; копейки показываются, только если не нулевые', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Минус ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: minuteAgo(), accountId: kaspi, amount: 50050 });
  await page.reload();
  const panel = page.getByRole('navigation', { name: 'Счета' });
  await expect(panel.getByRole('link', { name: /^Kaspi/ })).toContainText(/\u2212₸\s500,50$/);
  await expect(panel).toContainText(/Всего на счетах\s*\u2212₸\s500,50(?![\s\d])/);
  // в журнале — ₸ после суммы, копейки ненулевые — видны
  await expect(page.getByRole('table', { name: 'Операции' }).locator('tbody tr').first()).toContainText(/\u2212500,50\s₸/);
});

test('баланс и итог в левой панели обновляются при возврате на вкладку, журнал сам не перезапрашивается (§2.5)', async ({ page }) => {
  // часы подменены: «прошло 30 с» — без настоящего ожидания
  await page.clock.install();
  await login(page);
  const cid = await createCompany(page, `ТОО Фокус ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 100000 })).account.id;
  await page.reload();
  const panel = page.getByRole('navigation', { name: 'Счета' });
  await expect(panel).toContainText(/Всего на счетах\s*₸\s1\s000(?![\s\d])/);

  // другой пользователь внёс доход, пока вкладка была в фоне
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: minuteAgo(), accountId: kaspi, amount: 50000 });
  await page.clock.fastForward(31_000);
  const journalRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/operations?')) journalRequests.push(r.url());
  });
  // возврат на вкладку: TanStack Query слушает visibilitychange
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange', { bubbles: true })));
  await expect(panel).toContainText(/Всего на счетах\s*₸\s1\s500(?![\s\d])/);
  await expect(panel.getByRole('link', { name: /^Kaspi/ })).toContainText(/₸\s1\s500$/);
  expect(journalRequests).toEqual([]);
});
```

- [ ] **Step 9: Run all checks; e2e twice**

Run: `npm test` → PASS, 619 тестов (616 + 3: в `describe('formatMoney')` теперь 4 теста вместо одного), 1 пропущен.
Run: `npm run typecheck` → без ошибок.
Run: `npm run test:e2e` дважды → 60 passed оба раза.

- [ ] **Step 10: Commit**

```bash
git add src/shared/money.ts src/client tests e2e
git commit -m "feat: суммы на экране без нулевых копеек, ₸ перед суммой в панели; балансы обновляются при возврате на вкладку

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `Modal` с «×» и липкой шапкой; вложенные окна в `focus-trap`, `Modal` и `Drawer`

**Files:**
- Modify: `src/client/components/focus-trap.ts`, `tests/client/focus-trap.test.ts`
- Modify: `src/client/components/Modal.tsx`, `src/client/components/Drawer.tsx`
- Create: `e2e/dialogs.spec.ts`
- Modify: `e2e/mobile.spec.ts`, `e2e/operation-edit.spec.ts` (кнопка «Закрыть» внизу формы теперь не единственная с этим именем)

**Interfaces:**
- Consumes: —
- Produces:
  - `TabCandidate.nested?: boolean` — элемент лежит во вложенном `<dialog>`, Tab по кругу родительского окна его пропускает;
  - `firstTabbable(container: HTMLElement): HTMLElement | null` (`focus-trap.ts`);
  - `cycleTab(e, root)` — как раньше, но без элементов вложенных окон;
  - `Modal` — те же props (`open`, `title`, `onClose`, `onCancel?`, `children`, `className?`); в шапке кнопка «×» (`aria-label="Закрыть"`, `title="Закрыть"`); на телефоне шапка `sticky top-0`; `onClose`/`onCancel` вложенных окон его не трогают;
  - `Drawer` — те же props; `onClose` вложенных окон его не закрывает.

- [ ] **Step 1: Write the failing unit test**

В `tests/client/focus-trap.test.ts` добавьте в `describe` тест:

```ts
  it('пропускает элементы вложенного окна (подтверждение поверх формы, окно поверх панели)', () => {
    const list = [el('a'), el('b', { nested: true }), el('c'), el('d', { nested: true })];
    expect(ids(tabbable(list))).toEqual(['a', 'c']);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/client/focus-trap.test.ts`
Expected: FAIL — `nested` не учитывается (получено `['a','b','c','d']`); typecheck подсказал бы, что поля `nested` нет в `TabCandidate`.

- [ ] **Step 3: Implement nested-dialog exclusion and firstTabbable**

В `src/client/components/focus-trap.ts`:

В интерфейс `TabCandidate` добавьте поле:

```ts
  /** Лежит во вложенном `<dialog>` (подтверждение поверх формы): у родительского окна Tab на него не попадает. */
  nested?: boolean;
```

В `tabbable` замените строку фильтра:

```ts
  const live = candidates.filter((c) => !c.disabled && !c.hidden && !c.nested && !(c.tabIndex !== undefined && c.tabIndex < 0));
```

Функцию `describe` замените:

```ts
function describe(el: HTMLElement, owner: Element | null): TabCandidate & { el: HTMLElement } {
  const radio = el instanceof HTMLInputElement && el.type === 'radio' ? el : null;
  return {
    el,
    disabled: el.matches(':disabled'),
    hidden: el.getClientRects().length === 0 || !!el.closest('[inert], [hidden]'),
    nested: el.closest('dialog') !== owner,
    radioGroup: radio && radio.name ? `${radio.form ? [...document.forms].indexOf(radio.form) : -1}:${radio.name}` : undefined,
    checked: radio?.checked,
    tabIndex: el.tabIndex,
  };
}

/** Доступные для Tab элементы внутри container, без элементов вложенных окон. */
function tabbableIn(container: HTMLElement): HTMLElement[] {
  const owner = container.closest('dialog');
  return tabbable(Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE), (el) => describe(el, owner))).map((c) => c.el);
}

/** Первый элемент, на который попадёт Tab внутри container (без вложенных окон), или null. */
export function firstTabbable(container: HTMLElement): HTMLElement | null {
  return tabbableIn(container)[0] ?? null;
}
```

В `cycleTab` замените строку получения элементов:

```ts
  const items = tabbableIn(root);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/client/focus-trap.test.ts`
Expected: PASS (7 тестов).

- [ ] **Step 5: Rewrite Modal**

`src/client/components/Modal.tsx` — замените файл целиком:

```tsx
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cycleTab, firstTabbable } from './focus-trap';
import { btnIcon } from './ui';

/**
 * Модальное окно на `<dialog>`: открывается через showModal() — браузер держит фокус внутри окна,
 * делает остальную страницу недоступной и закрывает окно по Esc. При закрытии фокус возвращается
 * на элемент, с которого окно открыли. Содержимое монтируется заново при каждом открытии.
 * С `onCancel` окно по Esc и «×» само не закрывается: решает владелец (например, спрашивает про несохранённые изменения).
 *
 * Шапка: заголовок и «×» справа (§2.4 этапа 1.5); на телефоне шапка липкая — «×» видна при прокрутке.
 * Вложенные окна (подтверждение поверх формы) — свои `<dialog>`: их события close и cancel React доставляет
 * и сюда, поэтому окно реагирует только на свои (target === currentTarget).
 */
export function Modal(props: {
  open: boolean;
  title: string;
  onClose: () => void;
  onCancel?: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (props.open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      // «×» — первая кнопка окна, и showModal() ставит фокус на неё. Начальный фокус — по правилам окна:
      // первый элемент содержимого, а пока содержимое грузится — само окно (поле суммы заберёт его кадр спустя)
      if (document.activeElement === closeRef.current) {
        const first = contentRef.current ? firstTabbable(contentRef.current) : null;
        (first ?? dialog).focus();
      }
    } else if (!props.open && dialog.open) {
      dialog.close();
    }
  }, [props.open]);

  const cancel = () => {
    if (props.onCancel) props.onCancel();
    else ref.current?.close();
  };

  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        // Tab по кругу внутри окна: фокус не уходит в адресную строку браузера
        cycleTab(e, ref.current);
        // Esc, который не обработали внутри (список с поиском закрывается сам и отменяет событие)
        if (e.key !== 'Escape' || !props.onCancel || e.defaultPrevented) return;
        e.preventDefault();
        props.onCancel();
      }}
      onCancel={(e) => {
        if (e.target !== e.currentTarget || !props.onCancel) return;
        e.preventDefault();
        props.onCancel();
      }}
      onClose={(e) => {
        if (e.target !== e.currentTarget) return;
        props.onClose();
        opener.current?.focus();
      }}
      className={`m-auto max-h-[90dvh] w-[calc(100%-2rem)] rounded-3xl bg-card p-0 text-ink shadow-2xl outline-none backdrop:bg-black/40 ${props.className ?? 'max-w-2xl'}`}
    >
      {props.open && (
        <>
          <div className="flex items-start justify-between gap-3 bg-card px-6 pt-6 pb-4 max-md:sticky max-md:top-0 max-md:z-10">
            <h2 id={titleId} className="text-xl font-bold">
              {props.title}
            </h2>
            <button ref={closeRef} type="button" aria-label="Закрыть" title="Закрыть" onClick={cancel} className={`${btnIcon} shrink-0`}>
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <div ref={contentRef} className="px-6 pb-6">
            {props.children}
          </div>
        </>
      )}
    </dialog>
  );
}
```

- [ ] **Step 6: Drawer reacts only to its own close event**

В `src/client/components/Drawer.tsx` замените обработчик `onClose`:

```tsx
      onClose={(e) => {
        // close вложенного окна (окно компании поверх панели «Компании») React доставляет и сюда
        if (e.target !== e.currentTarget) return;
        props.onClose();
        opener.current?.focus();
      }}
```

- [ ] **Step 7: Make the footer «Закрыть» locators unambiguous**

В форме теперь две кнопки с именем «Закрыть»: «×» в шапке и «Закрыть» внизу (только просмотр) или в сообщении «Операция удалена другим пользователем». Ищите нижнюю внутри формы.

`e2e/mobile.spec.ts`, строки 487, 506, 515 — `view.getByRole('button', { name: 'Закрыть', exact: true })` замените на:

```ts
view.getByRole('form', { name: 'Операция' }).getByRole('button', { name: 'Закрыть', exact: true })
```

(в строке 487 — внутри `expect(…).toBeFocused()`, в 506 — перед `.click()`, в 515 — внутри `expect(…).toBeFocused()`).

`e2e/operation-edit.spec.ts`, строки 258 и 301 — `await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();` замените на:

```ts
  await dialog.getByRole('alert').getByRole('button', { name: 'Закрыть', exact: true }).click();
```

- [ ] **Step 8: Write the e2e test for «×»**

Создайте `e2e/dialogs.spec.ts`:

```ts
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
```

Если на 390 × 844 форма помещается без прокрутки, `expect.poll(…scrollTop).toBeGreaterThan(0)` упадёт. Тогда перед прокруткой добавьте в поле «Комментарий» пятнадцать строк: `await phoneForm.getByLabel('Комментарий').fill('строка\n'.repeat(15));` и `await phoneForm.getByLabel('Комментарий').evaluate((t) => ((t as HTMLTextAreaElement).rows = 15));`. Признак готовности — `scrollTop > 0`.

- [ ] **Step 9: Run all checks; e2e twice**

Run: `npm test` → PASS, 620 тестов. Run: `npm run typecheck` → без ошибок.
Run: `npx playwright test e2e/dialogs.spec.ts` → 1 passed.
Run: `npm run test:e2e` дважды → 61 passed оба раза. Особое внимание — `operation-form.spec.ts`, `operation-edit.spec.ts` и `mobile.spec.ts`: в них проверяется фокус в сумме при открытии и фокус на «Закрыть» в форме архивной компании.

- [ ] **Step 10: Commit**

```bash
git add src/client/components/focus-trap.ts src/client/components/Modal.tsx src/client/components/Drawer.tsx tests/client/focus-trap.test.ts e2e/dialogs.spec.ts e2e/mobile.spec.ts e2e/operation-edit.spec.ts
git commit -m "feat: «×» и липкая шапка у окон; вложенные окна не закрывают родительское и не участвуют в его Tab по кругу

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `ConfirmDialog` и вопрос о несохранённом в форме операции с «Больше не спрашивать»

**Files:**
- Create: `src/client/components/ConfirmDialog.tsx`, `src/client/lib/preferences.ts`, `tests/client/preferences.test.ts`
- Modify: `src/client/components/operation/OperationForm.tsx`
- Modify (тесты): `e2e/dialogs.spec.ts`, `e2e/operation-form.spec.ts`, `e2e/operation-edit.spec.ts`, `e2e/mobile.spec.ts`

**Interfaces:**
- Consumes: `cycleTab` (`focus-trap.ts`), `Modal` (задача 3), `usePreferences`, `savePreference(key, value): Promise<void>` (`lib/queries.ts`).
- Produces:
  - `ConfirmDialog(props: ConfirmDialogProps)` (`components/ConfirmDialog.tsx`), где
    ```ts
    interface ConfirmDialogProps {
      open: boolean;
      title: string;
      text: string;
      confirmLabel: string;
      danger?: boolean;
      checkbox?: { label: string; checked: boolean; onChange: (checked: boolean) => void };
      pending?: boolean;
      onConfirm: () => void;
      onCancel: () => void;
      onFocusLost?: () => void;
    }
    ```
    Подтверждение рисуется внутри родительского окна (вложенный `<dialog>`), закрывается владельцем через `open={false}`.
  - `SKIP_CLOSE_CONFIRM_PREF = 'operationForm.skipCloseConfirm'`, `skipCloseConfirm(prefs: Record<string, unknown> | undefined): boolean` (`lib/preferences.ts`). План 1.5-1b (страница «Настройки журнала») использует их же.

- [ ] **Step 1: Write the failing unit test**

`tests/client/preferences.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SKIP_CLOSE_CONFIRM_PREF, skipCloseConfirm } from '../../src/client/lib/preferences';

describe('настройка «Больше не спрашивать» (§2.4, §10.2 этапа 1.5)', () => {
  it('ключ настройки пользователя', () => {
    expect(SKIP_CLOSE_CONFIRM_PREF).toBe('operationForm.skipCloseConfirm');
  });

  it('только true выключает вопрос; значения другого вида — значение по умолчанию (спрашивать)', () => {
    expect(skipCloseConfirm({ [SKIP_CLOSE_CONFIRM_PREF]: true })).toBe(true);
    for (const v of [false, 'true', 1, null, {}, []]) expect(skipCloseConfirm({ [SKIP_CLOSE_CONFIRM_PREF]: v }), String(v)).toBe(false);
    expect(skipCloseConfirm({})).toBe(false);
    expect(skipCloseConfirm(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/client/preferences.test.ts`
Expected: FAIL — модуль `../../src/client/lib/preferences` не найден.

- [ ] **Step 3: Implement preferences helper**

`src/client/lib/preferences.ts`:

```ts
/** «Больше не спрашивать» в вопросе о несохранённом (§2.4, §10.2 этапа 1.5): настройка пользователя. */
export const SKIP_CLOSE_CONFIRM_PREF = 'operationForm.skipCloseConfirm';

/** Не спрашивать при закрытии изменённой формы операции. Значение неизвестного вида — по умолчанию (спрашивать). */
export function skipCloseConfirm(prefs: Record<string, unknown> | undefined): boolean {
  return prefs?.[SKIP_CLOSE_CONFIRM_PREF] === true;
}
```

Run: `npx vitest run tests/client/preferences.test.ts` → PASS.

- [ ] **Step 4: Create ConfirmDialog**

`src/client/components/ConfirmDialog.tsx`:

```tsx
import { useEffect, useId, useRef } from 'react';
import { cycleTab } from './focus-trap';
import { btnDanger, btnSecondary } from './ui';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  text: string;
  /** Кнопка действия справа: «Закрыть», «Удалить», «Изменить». */
  confirmLabel: string;
  /** Действие разрушительное: красная кнопка. */
  danger?: boolean;
  /** Флажок под текстом (только в вопросе о несохранённом — «Больше не спрашивать»). */
  checkbox?: { label: string; checked: boolean; onChange: (checked: boolean) => void };
  /** Идёт запрос действия: обе кнопки недоступны, Esc не закрывает. */
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Элемент, с которого открыли подтверждение, исчез: куда вернуть фокус (например, в поле суммы). */
  onFocusLost?: () => void;
}

/**
 * Вложенное окно подтверждения (§2.4, §11 этапа 1.5): `<dialog role="alertdialog">` через showModal() поверх
 * родительского окна. Кнопки в порядке Finmap: слева «Отменить» (фокус по умолчанию), справа действие.
 * Esc = «Отменить»: закрывается только подтверждение — клавиши и события close/cancel дальше не идут
 * (React доставил бы их обработчикам родительского `<dialog>`). Открыто, пока владелец держит `open`.
 * После закрытия фокус возвращается на элемент, с которого открыли, а если его уже нет — `onFocusLost`.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const titleId = useId();
  const textId = useId();
  const checkId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (props.open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      cancelRef.current?.focus();
    } else if (!props.open && dialog.open) {
      dialog.close();
    }
  }, [props.open]);

  const cancel = () => {
    if (!latest.current.pending) latest.current.onCancel();
  };

  return (
    <dialog
      ref={ref}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={textId}
      onKeyDown={(e) => {
        cycleTab(e, ref.current);
        if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
        // ни Tab по кругу, ни Esc родительского окна не должны видеть клавиши подтверждения
        e.stopPropagation();
      }}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        cancel();
      }}
      onClose={(e) => {
        e.stopPropagation();
        if (e.target !== e.currentTarget) return;
        const back = opener.current;
        opener.current = null;
        if (back?.isConnected) back.focus();
        else latest.current.onFocusLost?.();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-3xl bg-card p-6 text-ink shadow-2xl backdrop:bg-black/40"
    >
      {props.open && (
        <>
          <h2 id={titleId} className="mb-3 text-xl font-bold">
            {props.title}
          </h2>
          <p id={textId} className="mb-4 text-sm text-muted">
            {props.text}
          </p>
          {props.checkbox && (
            <label htmlFor={checkId} className="mb-5 flex items-center gap-2 text-sm">
              <input
                id={checkId}
                type="checkbox"
                checked={props.checkbox.checked}
                disabled={props.pending}
                onChange={(e) => props.checkbox!.onChange(e.target.checked)}
              />
              {props.checkbox.label}
            </label>
          )}
          <div className="grid grid-cols-2 gap-3">
            <button ref={cancelRef} type="button" disabled={props.pending} onClick={cancel} className={btnSecondary}>
              Отменить
            </button>
            <button type="button" disabled={props.pending} onClick={() => props.onConfirm()} className={props.danger ? btnDanger : btnSecondary}>
              {props.confirmLabel}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
```

- [ ] **Step 5: Use ConfirmDialog in OperationForm**

В `src/client/components/operation/OperationForm.tsx`:

1. Импорты: в блок импорта из `'../../lib/queries'` добавьте `savePreference` и `usePreferences` (рядом с `useAccounts`); добавьте строки

```ts
import { SKIP_CLOSE_CONFIRM_PREF, skipCloseConfirm } from '../../lib/preferences';
import { ConfirmDialog } from '../ConfirmDialog';
```

2. В `OperationEditor` удалите строки:

```ts
  /** Вопрос о несохранённом: фокус на «Продолжить», после ответа — туда, где был. */
  const continueRef = useRef<HTMLButtonElement>(null);
  const focusBefore = useRef<HTMLElement | null>(null);
  const closeAsked = useRef(false);
```

и весь эффект, начинающийся с `useEffect(() => {` и `if (confirmClose) {` и заканчивающийся `}, [confirmClose]);` (он ставил фокус на «Продолжить» и возвращал его обратно; теперь это делает `ConfirmDialog`).

3. Сразу после строки `const [confirmClose, setConfirmClose] = useState(false);` добавьте:

```ts
  /** «Больше не спрашивать» (§2.4 этапа 1.5): настройка пользователя; флажок в вопросе — до нажатия «Закрыть». */
  const prefs = usePreferences();
  const skipAsk = skipCloseConfirm(prefs.data);
  const [dontAsk, setDontAsk] = useState(false);
```

4. Обработчик Esc и «×» (`p.cancelRef.current = () => { … };`) замените вместе с комментарием над ним:

```ts
  // Esc и «×»: пока идёт запрос — ничего (окно закрылось бы, а операция всё равно сохранится); открыто подтверждение
  // удаления — закрыть его; есть несохранённые изменения и вопрос не выключен — спросить (вложенное окно, его Esc
  // сюда не доходит); иначе закрыть
  p.cancelRef.current = () => {
    if (pending) return;
    if (confirmDelete) setConfirmDelete(false);
    else if (dirty && !skipAsk) {
      setDontAsk(false);
      setConfirmClose(true);
    } else p.close();
  };
```

5. В подвале формы удалите ветку вопроса — блок от `) : confirmClose ? (` до закрывающего её `</div>` включительно:

```tsx
      ) : confirmClose ? (
        <div role="group" aria-label="Несохранённые изменения" className="flex flex-wrap items-center gap-2 text-sm">
          <span>Есть несохранённые изменения. Закрыть без сохранения?</span>
          <button type="button" onClick={p.close} className={btnSecondary}>
            Закрыть без сохранения
          </button>
          <button type="button" ref={continueRef} onClick={() => setConfirmClose(false)} className={btnPrimary}>
            Продолжить
          </button>
        </div>
```

(после удаления за веткой `confirmDelete && op ? (…)` сразу идёт `) : readOnly ? (`).

6. Там же удалите кнопку «Отмена» с комментарием над ней — её роль берёт «×» (§2.4):

```tsx
          {/* пока запрос идёт, «Отмена» и Esc окно не закрывают: операция всё равно сохранилась бы */}
          <button type="button" onClick={() => p.cancelRef.current()} className={btnSecondary}>
            Отмена
          </button>
```

7. Оберните возвращаемую форму во фрагмент и добавьте подтверждение после `</form>`. Начало `return (` формы:

```tsx
  return (
    <>
    <form ref={formRef} onSubmit={onSubmit} noValidate aria-label="Операция" className="grid grid-cols-[minmax(0,1fr)] gap-4">
```

конец (вместо `    </form>\n  );`):

```tsx
    </form>
    <ConfirmDialog
      open={confirmClose}
      title="Ваши данные не сохранятся"
      text="Закрыть окно? Введённые данные будут потеряны."
      confirmLabel="Закрыть"
      checkbox={{ label: 'Больше не спрашивать', checked: dontAsk, onChange: setDontAsk }}
      onCancel={() => setConfirmClose(false)}
      onConfirm={() => {
        // сбой сохранения настройки не мешает закрыть окно: в следующий раз просто спросят снова
        if (dontAsk) savePreference(SKIP_CLOSE_CONFIRM_PREF, true).catch(() => undefined);
        p.close();
      }}
      // «×» или поле, с которого спросили, исчезли — фокус в поле суммы
      onFocusLost={() => setRefocusAmount((n) => n + 1)}
    />
    </>
  );
```

Проверка: `grep -n "continueRef\|closeAsked\|focusBefore\|Несохранённые изменения\|Продолжить" src/client/components/operation/OperationForm.tsx` — пусто. `btnPrimary` и `btnSecondary` по-прежнему используются (кнопки «Сохранить», «Дублировать», «Закрыть»).

- [ ] **Step 6: Update existing e2e for the new question**

`e2e/operation-form.spec.ts`, строки 126–134 (после задачи 1 — те же номера; от комментария «Esc при несохранённых изменениях спрашивает…» до `await expect(dialog).toBeVisible();` включительно) замените:

```ts
  // Esc при несохранённых изменениях — окно «Ваши данные не сохранятся» поверх формы; Esc закрывает только его
  await amount.fill('10');
  await amount.press('Escape');
  const question = page.getByRole('alertdialog', { name: 'Ваши данные не сохранятся' });
  await expect(question).toBeVisible();
  await expect(question.getByRole('button', { name: 'Отменить' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(question).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(amount).toBeFocused();
```

Строку 448 `await expect(dialog.getByRole('group', { name: 'Несохранённые изменения' })).toHaveCount(0);` замените на:

```ts
  await expect(page.getByRole('alertdialog', { name: 'Ваши данные не сохранятся' })).toHaveCount(0);
```

`e2e/operation-edit.spec.ts`, тест на строке 178 — замените заголовок, строки 191–194 (от комментария «кнопка «Отмена», с которой спросили…» до `await expect(amount).toBeFocused();` включительно) и строки 205–208:

```ts
test('фокус и закрытие формы: «×» → «Отменить» возвращает фокус на «×»; пока сохранение идёт, Esc и «×» окно не закрывают', async ({ page }) => {
```

```ts
  // «×» спрашивает о несохранённом; «Отменить» возвращает фокус на «×»
  const close = dialog.getByRole('button', { name: 'Закрыть', exact: true });
  await close.click();
  await page.getByRole('alertdialog', { name: 'Ваши данные не сохранятся' }).getByRole('button', { name: 'Отменить' }).click();
  await expect(close).toBeFocused();
```

```ts
  await page.keyboard.press('Escape');
  await close.click();
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('alertdialog', { name: 'Ваши данные не сохранятся' })).toHaveCount(0);
```

Строки 286–287:

```ts
  await page.keyboard.press('Escape');
  await page.getByRole('alertdialog', { name: 'Ваши данные не сохранятся' }).getByRole('button', { name: 'Закрыть' }).click();
```

`e2e/mobile.spec.ts`, строки 423–424 («Отмена» больше нет — проверяем, что «×» на экране):

```ts
  const close = newForm(page).getByRole('button', { name: 'Закрыть', exact: true });
  expect((await close.boundingBox())!.x + (await close.boundingBox())!.width).toBeLessThanOrEqual(PHONE.width);
```

Проверка: `grep -rn "Несохранённые изменения\|Продолжить\|Закрыть без сохранения" e2e` — пусто; `grep -rn "name: 'Отмена'" e2e/operation-form.spec.ts e2e/operation-edit.spec.ts` — пусто.

- [ ] **Step 7: Write the e2e test for the question and «Больше не спрашивать»**

В конец `e2e/dialogs.spec.ts` добавьте:

```ts
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
```

- [ ] **Step 8: Run all checks; e2e twice**

Run: `npm test` → PASS, 622 теста (+2 в `preferences.test.ts`). Run: `npm run typecheck` → без ошибок.
Run: `npx playwright test e2e/dialogs.spec.ts e2e/operation-form.spec.ts e2e/operation-edit.spec.ts --repeat-each=3` → все passed.
Run: `npm run test:e2e` дважды → 62 passed оба раза.

- [ ] **Step 9: Commit**

```bash
git add src/client/components/ConfirmDialog.tsx src/client/lib/preferences.ts src/client/components/operation/OperationForm.tsx tests/client/preferences.test.ts e2e/dialogs.spec.ts e2e/operation-form.spec.ts e2e/operation-edit.spec.ts e2e/mobile.spec.ts
git commit -m "feat: вопрос о несохранённом — вложенное окно «Ваши данные не сохранятся» с «Больше не спрашивать»; без «Отмена» в форме

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## После плана

- Итоги и отложенные замечания — `docs/superpowers/followups/2026-10-10-stage1_5-plan1a-followups.md` (пишет контролёр).
- Визуальная сверка (§12.3) — после плана 1.5-1b: скрипт `npm run shots:ux` появляется в его задаче 7.
- README «Что уже работает» обновляется в плане 1.5-1b (задача 7); замена терминологии в README уже сделана задачей 1.
