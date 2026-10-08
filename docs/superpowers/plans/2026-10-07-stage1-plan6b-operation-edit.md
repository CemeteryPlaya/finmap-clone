# Этап 1, план 6b: форма операции — правка из журнала, конфликт версии, «Указать курс», файлы — план реализации (переписан от фактического кода 6a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** вторая половина шага 6 §11 спецификации — форма операции в режиме правки и действия при ошибках (§7 «Форма операции»):
- клик по строке журнала открывает операцию в форме; с клавиатуры — кнопка в ячейке даты (Tab, Enter);
- правка отправляет в `PATCH` только изменённые поля (итоги плана 4a, п. 1); «Удалить» с подтверждением, «Дублировать»;
- операция на архивном счёте: сумма, дата оплаты и счета недоступны с подсказкой «счёт в архиве», «Удалить» недоступна (инвариант 7);
- 409: «Операция изменена другим пользователем» и «Загрузить актуальную»;
- `RATE_UNAVAILABLE`: текст ошибки, «Указать курс на {D}» (небольшая форма ручного курса прямо в окне) и «Повторить»;
- файлы: выбранный до создания операции файл загружается сразу после неё; в правке — список, скачивание, мягкое удаление, ошибки сервера у поля;
- после каждого изменения — сброс журнала, счетов и компаний; после изменения файлов — их списка и журнала.

**Предусловие:** выполнен план 6a (HEAD cb2358a) — форма новой операции (`OperationForm`, `OperationFormHost` с ключом формы из счётчика, `useOpenOperationForm`), `operation-form.ts`, `split.ts`, `AmountField` (свойства `autoFocus` — фокус кадр спустя, только если он «ничей», — и `refocusSignal`), `ComboSelect`, `e2e/operation-form.spec.ts`. В форме поля недоступны во время запроса (`<fieldset disabled={pending}>`), шаблоны разделения форму не блокируют (`presets.data ?? []`). Планы 5b и 5c — `JournalTable` со свойством `onOpenOperation`, `JournalPage` с `HEADING_ID`, `invalidateOperations`.

**Как применять:** план меняет существующие файлы только правками «найдите → замените» по фактическому коду; каждый фрагмент «найдите» встречается в файле ровно один раз в момент применения. Новые файлы даны целиком. После каждой правки формы — проверка, что исправления плана 6a на месте.

**Architecture:**
- **Правка — тот же компонент формы.** `OperationFormRequest` получает вариант `{ kind: 'edit'; id }`; форма загружает операцию (`GET …/operations/:id`, без кэша — версия нужна свежая) и держит её в состоянии: «Дублировать» и «Сохранить и создать похожий» переводят форму к новой операции, «Загрузить актуальную» — к свежей версии. Заголовок окна — «Изменить операцию» или «Новая операция».
- **Чистые функции правки** — `src/client/lib/operation-edit.ts` с unit-тестами: операция → черновик (`draftFromOperation`), изменённые поля (`patchBody` поверх `buildBody` плана 6a), копия без архивных ссылок (`duplicateDraft`), архивный счёт операции (`archivedAccountOf`).
- **Какого курса нет — сообщает сервер.** Ошибка `RATE_UNAVAILABLE` получает поле `details: { currency, date }` (у `AppError` — необязательный пятый аргумент, в ответе — рядом с `fields`); клиентский `ApiError` его читает. Так форма знает, на какую валюту и дату предлагать ручной курс, — например, базовую валюту компании, а не валюту счёта.
- **Файлы** — через существующий API плана 4b: тело `application/octet-stream`, имя — в `X-File-Name`; у `api()` появляется вариант `file`. Скачивание — обычная ссылка (GET без побочных эффектов, ответ всегда «как файл»).

**Tech Stack:** как в плане 6a. Новых пакетов нет.

**Spec:** [docs/superpowers/specs/2026-10-05-stage1-foundation-core-design.md](../specs/2026-10-05-stage1-foundation-core-design.md) — §4.3 (п. 6: `RATE_UNAVAILABLE` и «Указать курс на {D}»), §4.5 (`attachments`), §4.6 (инвариант 7), §6.2 (ошибки; решение 2026-10-07 о `details`), §7 (Журнал: клик по строке открывает форму; Форма операции: ошибки, режим редактирования; решения 2026-10-07), §8 («Загрузки»), §10 (E2E, сценарий 4: правка операции на 390 px), §11 шаг 6.

**Ветка:** `stage1/plan1-skeleton`. В `main` не сливаем до завершения всех работ.

## Решения, принятые при планировании

Записаны в спецификацию (§6.2 и §7, блоки «Решения планирования от 2026-10-07 (планы 6a и 6b)»); решение 8 добавлено туда тем же коммитом, что и эта редакция плана.

1. **Открытие с клавиатуры.** В ячейке даты строки журнала — кнопка «Открыть операцию: <день> <время>, <сумма>» (видимый текст — дата и время). Клик по любому месту строки, кроме кнопок и полей, тоже открывает форму (план 5b). После закрытия фокус возвращается на кнопку строки.
2. **PATCH — только изменённое:** дата оплаты — если сменился день (время суток остаётся прежним, но не позже «сейчас»); `toAccountId` и `toAmount` — только непустые и только у перевода; строки — если отличаются статья, проект или сумма хотя бы одной; теги — без учёта порядка. У перевода между валютами при смене суммы или счетов сумма зачисления уходит всегда: без неё сервер сбрасывает её и отвечает 400 «Укажите сумму зачисления». Ничего не изменилось — запроса нет, окно закрывается.
3. **Тип существующей операции не меняется** (схема правки плана 4a): переключателя типа в правке нет.
4. **«Дублировать»** — новая операция с текущими значениями формы и датой оплаты «сегодня»; архивные счета, статьи, проекты, контрагент и теги не переносятся (их нельзя выбрать заново). Файлы не копируются. Закрыть копию без сохранения — с вопросом. «Сохранить и создать похожий» после правки тоже не переносит архивные ссылки (`withoutArchived`).
5. **«Удалить»** — подтверждение в окне («Удалить операцию?», фокус на «Не удалять»). Esc при открытом подтверждении отменяет только его, фокус возвращается на «Удалить». После удаления строки, с которой открыли форму, больше нет — фокус уходит на заголовок «Журнал» (`focusAfterDelete` в запросе формы). Операцию на архивном счёте удалить нельзя: кнопка недоступна, рядом — «Удалить нельзя: счёт в архиве («…»)».
6. **409:** изменили — «Операция изменена другим пользователем» и «Загрузить актуальную» (форма показывает свежую версию, свои изменения пользователь вносит заново); удалили — «Операция удалена другим пользователем» и «Закрыть». В обоих случаях журнал, счета и компании перечитываются.
7. **`RATE_UNAVAILABLE` → `details: { currency, date }`** у ошибки (и у `GET /rates`). «Указать курс на ДД.ММ.ГГГГ» открывает поле «Курс X к тенге на ДД.ММ.ГГГГ» и создаёт ручной курс только на эту дату (`POST /rates/manual`); «Повторить» сохраняет операцию тем же способом, что и в первый раз («Сохранить» или «Сохранить и создать похожий»).
8. **Фокус и закрытие формы** (замечания финального ревью 6a):
   - после «Отмена» → «Продолжить» фокус возвращается туда, где был; если это была исчезнувшая кнопка «Отмена» — в поле суммы;
   - после ошибки сохранения (поля были недоступны, фокус потерян) фокус — на первое поле с ошибкой, иначе на действие в сообщении («Загрузить актуальную», «Указать курс на …»), иначе в поле суммы;
   - пока запрос идёт, Esc и «Отмена» форму не закрывают: запрос всё равно сохранил бы операцию, а повторный ввод дал бы дубль.
   При открытии правки фокус ставит в сумму `AmountField` плана 6a: окно открывается с «Загрузка…», поле суммы появляется позже, и фокус ещё «ничей».
9. **Файлы:** до 10 МБ проверяется в браузере (без отправки), тип — сервером по содержимому; ошибки — у поля, с именем файла. Выбранные до создания операции файлы загружаются сразу после неё; если какой-то файл сервер не принял, операция остаётся сохранённой, форма переходит к её правке с сообщением «Операция сохранена, но не загружено: «имя»: причина». Удаление — с подтверждением, мягкое (§4.5). Блок «Проект, теги, комментарий, файл».

## Global Constraints

- **Режим редактирования (§7):** «есть «Удалить» и «Дублировать». Если операция затрагивает архивный счёт, поля суммы, даты оплаты и счетов заблокированы, кнопка «Удалить» неактивна; у них подсказка «счёт в архиве». Дату сделки, категорию, проект, контрагента, теги, комментарий и файлы можно менять.»
- **Ошибки (§7):** «показываются у полей. На 409 выводится «Операция изменена другим пользователем» и кнопка «Загрузить актуальную». На `RATE_UNAVAILABLE` — текст ошибки и действия «Указать курс на {D}» (небольшая форма прямо в модалке, создаёт ручной курс) и «Повторить».» §4.3 п. 6: ручной курс — к KZT и только на эту дату.
- **Журнал (§7):** «Клик по строке открывает форму»; клик по «N статей» тоже (план 5b, решение 11).
- **API (планы 4a, 4b):** `GET /api/v1/companies/:cid/operations/:id` → `{ operation }` (операция со строками и тегами, `version`, `deletedAt`); `PATCH …/:id` — `{ version, …изменённые поля }`, `toAccountId`/`toAmount` без `null`; 409 `VERSION_CONFLICT` «Операция изменена другим пользователем» или «Операция удалена — обновите страницу»; `DELETE …/:id` — мягкое удаление, на архивном счёте — 422 `ARCHIVED_REFERENCE`; `POST /api/v1/rates/manual` — `{ date, currency, rate }`; вложения — `POST …/operations/:id/attachments` (байты, `Content-Type: application/octet-stream`, `X-File-Name` — URI-кодированное имя) → 201 `{ attachment }`, `GET …/operations/:id/attachments` → `{ attachments }`, `GET/DELETE /api/v1/companies/:cid/attachments/:id`.
- **Загрузки (§8):** «максимум 10 МБ. Тип проверяется по содержимому файла… Разрешены png, jpg, webp, heic, pdf, xlsx, csv.»
- **Сброс кэшей:** после изменения операции — `invalidateOperations(cid)` (`['journal', cid]`, `['accounts', cid]`, `['companies']`); после ручного курса — `['rates-manual']`, `['accounts', cid]`, `['companies']`; после изменения файлов — `['attachments', cid, opId]` и `['journal', cid]`.
- **Доступность:** ошибки и конфликт — `role="alert"`; подсказка «счёт в архиве» связана с полем (`aria-describedby`); подтверждение удаления ставит фокус на безопасную кнопку.
- **Без новых npm-пакетов.**
- **E2E:** операции «сегодня» — через `todayAgo(n)` (момент сегодняшнего дня по Алматы, не в будущем), чтобы проверки «сегодня» не падали после полуночи; поле суммы получает фокус кадр спустя после открытия формы — дождитесь `toBeFocused()`, прежде чем заполнять другие поля; левая панель `<nav aria-label="Счета">` есть на каждой странице компании — строки ищите в `getByRole('table', { name: 'Операции' })`, поля — в окне `getByRole('dialog', { name: 'Изменить операцию' })`; `name:` — подстрока без учёта регистра (`'Удалить'` найдёт и «Удалить файл …» — `exact: true`); ручной курс общий для всех компаний — в e2e только валюта и дата, которых нет в других тестах; данные — через `page.request` с `origin` и `x-requested-with: fetch`; без фиксированных пауз.
- **Невидимые символы** (U+2212, U+202F, U+00A0, U+200B) в коде — только экранированием `\uXXXX`; после записи файлов с такими строками — проверка из шага задачи.
- **Концы строк:** рабочая копия в CRLF. Правки «найдите → замените» — инструментом правки файлов.
- **Безопасность хуков среды:** shell-команды не содержат подстроку «.env»; собирать её из частей запрещено.
- **Завершение задачи:** зелёные `npm test`, `npm run typecheck` и `npm run test:e2e`; коммит с трейлером `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Правка суммы перевода:** в одной валюте новая сумма уходит без прежней суммы зачисления (иначе `INVARIANT_4`) и без `null` в полях перевода (иначе 400); между валютами — вместе с суммой зачисления (иначе сервер её сбросит и ответит 400); без изменений запроса нет. Тесты — задача 1 (`patchBody` и e2e правки перевода KZT → USD).
2. **Операцию изменили или удалили в другом окне, пока открыта форма:** понятное сообщение, «Загрузить актуальную» показывает чужую правку, повтор проходит; удалённая — «Закрыть», строка из журнала уходит. Тест — задача 2.
3. **Операция на архивном счёте:** сумма, дата и счёт недоступны с подсказкой, «Удалить» недоступна с объяснением, а комментарий сохраняется. Тест — задача 1 (e2e).
4. **Нет курса базовой валюты компании** (база USD, счёт в тенге): «Указать курс» предлагает курс USD, а не тенге (курс тенге к тенге создать нельзя). Тест — задача 3 (`tests/server/rate-unavailable.test.ts`).
5. **Сервер не принял файл, выбранный до создания операции:** операция не теряется и не создаётся второй раз при повторном «Сохранить» — форма переходит к её правке и объясняет, какой файл и почему не загружен. Тест — задача 4 (e2e).

---

## Карта файлов

```
src/server/errors.ts                          # AppError.details — данные для действия в интерфейсе
src/server/modules/rates/{service,routes}.ts  # RATE_UNAVAILABLE с details { currency, date }
src/client/lib/api.ts                         # ApiError.details; загрузка файла телом
src/client/lib/operation-edit.ts              # (новый) операция → черновик, изменённые поля, копия, архивный счёт
src/client/lib/attachments.ts                 # (новый) вложения: список, загрузка, удаление, размер
src/client/components/operation/OperationForm.tsx      # режим правки, 409, курс, файлы
src/client/components/operation/OperationFormHost.tsx  # запрос { kind: 'edit', id }
src/client/components/operation/RateFix.tsx            # (новый) «Указать курс на {D}» и «Повторить»
src/client/components/operation/AttachmentsField.tsx   # (новый) файлы операции
src/client/components/journal/JournalTable.tsx         # кнопка «Открыть операцию» в ячейке даты
src/client/pages/JournalPage.tsx                       # клик по строке открывает форму
tests/server/rate-unavailable.test.ts         # (новый)
tests/client/{operation-edit,attachments}.test.ts      # (новые)
e2e/operation-edit.spec.ts                    # (новый)
e2e/operation-form.spec.ts                    # + «Указать курс»
README.md
```

---
### Task 1: Правка операции из журнала — только изменённые поля, «Дублировать», «Удалить», блокировки архивного счёта

**Files:**
- Create: `src/client/lib/operation-edit.ts`, `tests/client/operation-edit.test.ts`, `e2e/operation-edit.spec.ts`
- Modify: `src/client/components/operation/OperationForm.tsx`, `src/client/components/operation/OperationFormHost.tsx`, `src/client/components/journal/JournalTable.tsx`, `src/client/pages/JournalPage.tsx`

**Interfaces:**
- Consumes: план 6a — `OperationDraft`, `OperationBody`, `buildBody`, `DraftContext`, `emptyDraft`, `similarDraft`, `newLine`, `OperationForm`, `useOpenOperationForm`; `amountInputText`, `dayOf` (`journal-format.ts`); `JournalTable.onOpenOperation` (план 5b), `signedMoney`, `dayLabel`, `timeLabel`; `invalidateOperations`; `useQuery`.
- Produces:
  - фокус формы: `closeAsked` (возврат фокуса после вопроса), `errorFocus` (после ошибки сохранения), отказ закрыть форму по Esc и «Отмена» при `pending`;
  - `operation-edit.ts`: `interface OperationRecord { id; type; paidAt; accrualDate; accountId; amount; toAccountId; toAmount; counterpartyId; comment; version; deletedAt; lines: { categoryId; projectId; amount }[]; tagIds }`, `draftFromOperation(op, accounts, timeZone): OperationDraft`, `type OperationPatch`, `patchBody(op, body, timeZone): OperationPatch | null`, `interface Available { accounts; categories; projects; counterparties; tags: ReadonlySet<number> }`, `withoutArchived(draft, available)`, `duplicateDraft(draft, available, today)`, `archivedAccountOf(op, accounts)`;
  - `OperationFormRequest = { kind: 'create'; type } | { kind: 'edit'; id: number; focusAfterDelete?: () => HTMLElement | null }`; окно правки — «Изменить операцию»; кнопки «Дублировать», «Удалить» → «Да, удалить» / «Не удалять»; подсказка `LOCKED_HINT = 'счёт в архиве'`;
  - `JournalTable`: при `onOpenOperation` в ячейке даты — кнопка «Открыть операцию: …»; `JournalPage` передаёт `onOpenOperation` → `openForm({ kind: 'edit', id, focusAfterDelete: () => document.getElementById(HEADING_ID) })`.

- [ ] **Step 1: Write the failing tests**

`tests/client/operation-edit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { archivedAccountOf, draftFromOperation, duplicateDraft, patchBody, withoutArchived, type OperationRecord } from '../../src/client/lib/operation-edit';
import { buildBody, type DraftContext, type OperationDraft } from '../../src/client/lib/operation-form';

const TZ = 'Asia/Almaty';
const NOW = new Date('2026-10-07T05:30:00.000Z'); // 10:30 по Алматы
const ARCH = '2026-10-01T00:00:00.000Z';
const accounts = new Map([
  [1, { id: 1, name: 'Касса', currency: 'KZT', archivedAt: null }],
  [2, { id: 2, name: 'Kaspi', currency: 'KZT', archivedAt: null }],
  [3, { id: 3, name: 'Доллары', currency: 'USD', archivedAt: null }],
  [4, { id: 4, name: 'Старый', currency: 'KZT', archivedAt: ARCH }],
]);

const op = (patch: Partial<OperationRecord> = {}): OperationRecord => ({
  id: 9,
  type: 'expense',
  paidAt: '2026-10-05T13:15:00.000Z', // 05.10, 18:15 по Алматы
  accrualDate: null,
  accountId: 1,
  amount: 150050,
  toAccountId: null,
  toAmount: null,
  counterpartyId: 5,
  comment: 'аренда',
  version: 3,
  deletedAt: null,
  lines: [{ categoryId: 7, projectId: 8, amount: 150050 }],
  tagIds: [2, 1],
  ...patch,
});

/** Правка в форме → тело PATCH: как это делает форма (время суток — прежнее). */
const patchFor = (o: OperationRecord, edit: (d: OperationDraft) => OperationDraft) => {
  const ctx: DraftContext = { accounts, today: '2026-10-07', timeZone: TZ, now: NOW, timeOfDayFrom: new Date(o.paidAt) };
  const r = buildBody(edit(draftFromOperation(o, accounts, TZ)), ctx);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return patchBody(o, r.body, TZ);
};

describe('draftFromOperation', () => {
  it('доход или расход с одной строкой: суммы текстом с запятой, дата оплаты по Алматы, без разбиения', () => {
    expect(draftFromOperation(op({ accrualDate: '2026-09-30' }), accounts, TZ)).toMatchObject({
      type: 'expense',
      accountId: 1,
      amount: '1500,5',
      paidDate: '2026-10-05',
      accrualOn: true,
      accrualDate: '2026-09-30',
      categoryId: 7,
      projectId: 8,
      counterpartyId: 5,
      tagIds: [2, 1],
      comment: 'аренда',
      split: null,
    });
  });

  it('несколько строк — разбиение в суммах; перевод между валютами — сумма зачисления и проект строки', () => {
    const d = draftFromOperation(
      op({ amount: 1000, lines: [{ categoryId: 7, projectId: 8, amount: 600 }, { categoryId: 7, projectId: null, amount: 400 }] }),
      accounts,
      TZ,
    );
    expect(d.categoryId).toBeNull();
    expect(d.split).toMatchObject({ mode: 'amount', lines: [{ categoryId: 7, projectId: 8, value: '6' }, { categoryId: 7, projectId: null, value: '4' }] });
    const t = draftFromOperation(op({ type: 'transfer', toAccountId: 3, toAmount: 1000, counterpartyId: null, lines: [{ categoryId: null, projectId: 8, amount: 150050 }] }), accounts, TZ);
    expect(t).toMatchObject({ toAccountId: 3, toAmount: '10', projectId: 8, split: null });
    expect(draftFromOperation(op({ type: 'transfer', toAccountId: 2, toAmount: 150050, lines: [] }), accounts, TZ).toAmount).toBe('');
  });
});

describe('patchBody — в PATCH только изменённые поля (итоги 4a, п. 1)', () => {
  it('ничего не изменено — запроса нет', () => {
    expect(patchFor(op(), (d) => d)).toBeNull();
    expect(patchFor(op({ type: 'transfer', toAccountId: 3, toAmount: 1000, counterpartyId: null, comment: null, lines: [] }), (d) => d)).toBeNull();
  });

  it('комментарий — только он и версия', () => {
    expect(patchFor(op(), (d) => ({ ...d, comment: 'новый' }))).toEqual({ version: 3, comment: 'новый' });
  });

  it('сумма: строка следует за суммой; другой день — та же минута суток', () => {
    expect(patchFor(op(), (d) => ({ ...d, amount: '2000', paidDate: '2026-10-04' }))).toEqual({
      version: 3,
      amount: 200000,
      paidAt: '2026-10-04T13:15:00.000Z',
      lines: [{ categoryId: 7, projectId: 8, amount: 200000 }],
    });
  });

  it('теги — без учёта порядка; новая статья — новые строки', () => {
    expect(patchFor(op(), (d) => ({ ...d, tagIds: [1, 2] }))).toBeNull();
    expect(patchFor(op(), (d) => ({ ...d, categoryId: 70 }))).toEqual({ version: 3, lines: [{ categoryId: 70, projectId: 8, amount: 150050 }] });
  });

  it('перевод в одной валюте: новая сумма без суммы зачисления и без null в полях перевода (иначе INVARIANT_4 или 400)', () => {
    const t = op({ type: 'transfer', toAccountId: 2, toAmount: 150050, counterpartyId: null, comment: null, lines: [] });
    expect(patchFor(t, (d) => ({ ...d, amount: '100' }))).toEqual({ version: 3, amount: 10000 });
  });

  it('перевод между валютами: меняется только сумма зачисления', () => {
    const t = op({ type: 'transfer', toAccountId: 3, toAmount: 1000, counterpartyId: null, comment: null, lines: [] });
    expect(patchFor(t, (d) => ({ ...d, toAmount: '11' }))).toEqual({ version: 3, toAmount: 1100 });
  });

  it('перевод KZT → USD: новая сумма списания — вместе с суммой зачисления (иначе сервер её сбросит и ответит 400)', () => {
    const t = op({ type: 'transfer', amount: 5000000, toAccountId: 3, toAmount: 10000, counterpartyId: null, comment: null, lines: [] });
    expect(patchFor(t, (d) => ({ ...d, amount: '500' }))).toEqual({ version: 3, amount: 50000, toAmount: 10000 });
    expect(patchFor(t, (d) => ({ ...d, accountId: 2 }))).toEqual({ version: 3, accountId: 2, toAmount: 10000 });
  });
});

describe('duplicateDraft, archivedAccountOf', () => {
  it('копия — на сегодня, без архивных ссылок', () => {
    const d = draftFromOperation(op({ accountId: 4, tagIds: [1, 2], counterpartyId: 5 }), accounts, TZ);
    const available = { accounts: new Set([1, 2, 3]), categories: new Set([7]), projects: new Set<number>(), counterparties: new Set<number>(), tags: new Set([1]) };
    expect(duplicateDraft(d, available, '2026-10-07')).toMatchObject({
      paidDate: '2026-10-07',
      accountId: null,
      categoryId: 7,
      projectId: null,
      counterpartyId: null,
      tagIds: [1],
      amount: '1500,5',
      comment: 'аренда',
    });
  });

  it('без архивных ссылок — для «Сохранить и создать похожий» после правки; дата остаётся', () => {
    const d = draftFromOperation(op({ accountId: 4 }), accounts, TZ);
    const available = { accounts: new Set([1]), categories: new Set<number>(), projects: new Set([8]), counterparties: new Set([5]), tags: new Set([1, 2]) };
    expect(withoutArchived(d, available)).toMatchObject({ accountId: null, categoryId: null, projectId: 8, counterpartyId: 5, paidDate: '2026-10-05' });
  });

  it('архивный счёт операции — любой из двух у перевода', () => {
    expect(archivedAccountOf(op(), accounts)).toBeNull();
    expect(archivedAccountOf(op({ accountId: 4 }), accounts)?.name).toBe('Старый');
    expect(archivedAccountOf(op({ type: 'transfer', toAccountId: 4 }), accounts)?.name).toBe('Старый');
  });
});
```

`e2e/operation-edit.spec.ts`:

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

/** Запрос к API от имени вошедшего пользователя: кука сессии браузера и заголовки защиты от подделки. */
async function apiPost(page: Page, url: string, data: unknown) {
  const res = await page.request.post(url, { data, headers: csrf(page) });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return res.json();
}

/** Начало сегодняшнего дня по Алматы — APP_TIMEZONE e2e-сервера (с 01.03.2024 — UTC+5). */
function startOfTodayAlmaty(): number {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date());
  return Date.parse(`${day}T00:00:00+05:00`);
}

/**
 * Момент «сегодня по Алматы»: чем больше n (0 < n < 1000), тем раньше, но всегда сегодня и не в будущем
 * (инвариант 6) — проверка «сегодня» не падает сразу после полуночи.
 */
const todayAgo = (n: number) => {
  const start = startOfTodayAlmaty();
  return new Date(start + (Date.now() - start) * (1 - n / 1000)).toISOString();
};
const table = (page: Page) => page.getByRole('table', { name: 'Операции' });
const rows = (page: Page) => table(page).locator('tbody tr');
const editForm = (page: Page) => page.getByRole('dialog', { name: 'Изменить операцию' });

test('правка из журнала: клик по строке и с клавиатуры, в PATCH — только изменённое; «Дублировать», «Удалить»', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Правка ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  const rent = (await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Аренда' })).category.id;
  await apiPost(page, `${base}/operations`, {
    type: 'expense',
    paidAt: todayAgo(1),
    accountId: cash,
    amount: 30000,
    comment: 'старый',
    lines: [{ categoryId: rent, projectId: null, amount: 30000 }],
  });
  await page.reload();

  // клик по строке (по комментарию) открывает форму; блок с комментарием раскрыт
  await rows(page).first().getByText('старый').click();
  let dialog = editForm(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radio')).toHaveCount(0); // тип не меняется
  await expect(dialog.getByRole('button', { name: 'Счёт: Касса (KZT)' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Статья: Аренда' })).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toHaveValue('300');
  // форма ставит фокус в сумму кадр спустя — дождаться, прежде чем заполнять другие поля
  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
  await dialog.getByLabel('Комментарий').fill('новый');
  const patch = page.waitForRequest((r) => r.method() === 'PATCH');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  expect((await patch).postDataJSON()).toEqual({ version: 1, comment: 'новый' });
  await expect(dialog).toBeHidden();
  await expect(rows(page).first()).toContainText('новый');

  // с клавиатуры: кнопка в ячейке даты, Enter
  const open = table(page).getByRole('button', { name: /^Открыть операцию: сегодня/ });
  await open.focus();
  await page.keyboard.press('Enter');
  dialog = editForm(page);
  const amount = dialog.getByRole('textbox', { name: /^Сумма,/ });
  await expect(amount).toBeFocused();
  await amount.fill('300+50');
  await amount.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(rows(page).first()).toContainText(/350,00\s₸/);
  await expect(open).toBeFocused();

  // «Дублировать»: новая операция с теми же значениями; закрыть без сохранения — с вопросом
  await open.click();
  await editForm(page).getByRole('button', { name: 'Дублировать' }).click();
  dialog = page.getByRole('dialog', { name: 'Новая операция' });
  await expect(dialog.getByRole('status')).toHaveText('Это копия — проверьте и сохраните');
  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toHaveValue('350');
  await expect(dialog.getByRole('button', { name: 'Статья: Аренда' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(rows(page)).toHaveCount(2);

  // «Удалить» с подтверждением; Esc отменяет только подтверждение
  await rows(page).first().getByText('новый').click();
  dialog = editForm(page);
  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
  const remove = dialog.getByRole('button', { name: 'Удалить', exact: true });
  await remove.click();
  await expect(dialog.getByRole('button', { name: 'Не удалять' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('button', { name: 'Да, удалить' })).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(remove).toBeFocused();
  await remove.click();
  await dialog.getByRole('button', { name: 'Да, удалить' }).click();
  await expect(dialog).toBeHidden();
  await expect(rows(page)).toHaveCount(1);
  // строки, с которой открыли форму, больше нет — фокус на заголовке журнала
  await expect(page.getByRole('heading', { name: 'Журнал' })).toBeFocused();
});

test('операция на архивном счёте: сумма, дата и счёт заблокированы с подсказкой, «Удалить» недоступна, комментарий меняется', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Архив ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const old = (await apiPost(page, `${base}/accounts`, { name: 'Старый', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: todayAgo(2), accountId: old, amount: 10000, comment: 'приход' });
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(1), accountId: old, amount: 10000, comment: 'расход' });
  await apiPost(page, `${base}/accounts/${old}/archive`, {});
  await page.reload();

  await rows(page).filter({ hasText: 'приход' }).getByText('приход').click();
  const dialog = editForm(page);
  const amount = dialog.getByRole('textbox', { name: /^Сумма,/ });
  await expect(amount).toBeDisabled();
  await expect(amount).toHaveAccessibleDescription('счёт в архиве');
  await expect(dialog.getByRole('button', { name: 'Счёт: Старый (KZT) (в архиве)' })).toBeDisabled();
  await expect(dialog.getByLabel('Дата оплаты')).toBeDisabled();
  const remove = dialog.getByRole('button', { name: 'Удалить', exact: true });
  await expect(remove).toBeDisabled();
  await expect(remove).toHaveAccessibleDescription('Удалить нельзя: счёт в архиве («Старый»)');
  await dialog.getByLabel('Комментарий').fill('приход из кассы');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(rows(page).filter({ hasText: 'приход из кассы' })).toHaveCount(1);
});

test('ширина 390 px: правка операции — форма на весь экран, сумма через кнопки-операторы (§10, сценарий 4)', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Телефон правка ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(1), accountId: cash, amount: 10000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();

  await table(page).getByRole('button', { name: /^Открыть операцию/ }).click();
  const dialog = editForm(page);
  const box = (await dialog.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(389);
  const amount = dialog.getByRole('textbox', { name: /^Сумма,/ });
  await expect(amount).toBeFocused();
  await amount.click();
  await page.keyboard.press('End');
  await dialog.getByRole('button', { name: 'Оператор умножение' }).click();
  await page.keyboard.type('2');
  await amount.blur();
  await expect(amount).toHaveValue('200');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(rows(page).first()).toContainText(/200,00\s₸/);
});

test('перевод KZT → USD: новая сумма списания сохраняется вместе с прежней суммой зачисления', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Перевод правка ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 1000000 })).account.id;
  const usd = (await apiPost(page, `${base}/accounts`, { name: 'Валютный', currency: 'USD', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `${base}/fixed-rates`, { currency: 'USD', rate: '500', validFrom: '2020-01-01' });
  await apiPost(page, `${base}/operations`, { type: 'transfer', paidAt: todayAgo(1), accountId: cash, amount: 5000000, toAccountId: usd, toAmount: 10000 });
  await page.reload();

  await table(page).getByRole('button', { name: /^Открыть операцию/ }).click();
  const dialog = editForm(page);
  const amount = dialog.getByRole('textbox', { name: /^Сумма,/ });
  await expect(amount).toBeFocused();
  await expect(amount).toHaveValue('50000');
  await expect(dialog.getByRole('textbox', { name: /^Сумма зачисления/ })).toHaveValue('100');
  await amount.fill('500');
  await expect(dialog.getByText('Курс: 1 USD = 5 KZT')).toBeVisible();
  const patch = page.waitForRequest((r) => r.method() === 'PATCH');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  expect((await patch).postDataJSON()).toEqual({ version: 1, amount: 50000, toAmount: 10000 });
  await expect(dialog).toBeHidden();
  const row = table(page).locator('tbody tr').first();
  await expect(row).toContainText(/500,00\s₸/);
  await expect(row).toContainText(/100,00\s\$/);
  await expect(page.getByRole('navigation', { name: 'Счета' }).getByRole('link', { name: /^Касса/ })).toContainText(/9\s500,00\s₸/);
});

test('фокус и закрытие формы: после «Отмена» → «Продолжить» фокус в сумме; пока сохранение идёт, Esc и «Отмена» окно не закрывают', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Фокус ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await page.reload();

  await page.getByRole('banner').getByRole('button', { name: 'Расход', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Новая операция' });
  const amount = dialog.getByRole('textbox', { name: /^Сумма,/ });
  await expect(amount).toBeFocused();
  await amount.fill('100');

  // кнопка «Отмена», с которой спросили, исчезает вместе с вопросом — фокус возвращается в сумму
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  await dialog.getByRole('button', { name: 'Продолжить' }).click();
  await expect(amount).toBeFocused();

  // ответ сервера задержан: пока запрос идёт, окно не закрывается ни по Esc, ни по «Отмена»
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/v1/companies/*/operations', async (route) => {
    if (route.request().method() === 'POST') await gate;
    await route.continue();
  });
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('group', { name: 'Несохранённые изменения' })).toHaveCount(0);
  release();
  await expect(dialog).toBeHidden();
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await expect(rows(page)).toHaveCount(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/client/operation-edit.test.ts`
Expected: FAIL — модуля `operation-edit` нет.

Run: `npx playwright test e2e/operation-edit.spec.ts`
Expected: FAIL — клик по строке не открывает форму.

- [ ] **Step 3: Implement**

`src/client/lib/operation-edit.ts`:

```ts
import { getCurrency } from '../../shared/currencies';
import { amountInputText, dayOf } from './journal-format';
import type { OperationBody, OperationDraft } from './operation-form';
import { newLine } from './split';

/** Операция из `GET /companies/:cid/operations/:id` (план 4a): строка операции, строки разбиения и теги. */
export interface OperationRecord {
  id: number;
  type: OperationDraft['type'];
  paidAt: string;
  accrualDate: string | null;
  accountId: number;
  amount: number;
  toAccountId: number | null;
  toAmount: number | null;
  counterpartyId: number | null;
  comment: string | null;
  version: number;
  deletedAt: string | null;
  lines: { categoryId: number | null; projectId: number | null; amount: number }[];
  tagIds: number[];
}

type AccountLike = { id: number; currency: string; archivedAt: string | null };

const minorOf = (accounts: ReadonlyMap<number, AccountLike>, id: number | null) =>
  getCurrency(id === null ? 'KZT' : (accounts.get(id)?.currency ?? 'KZT')).minorUnits;

/**
 * Операция → черновик формы. Больше одной строки у дохода или расхода — разбиение в суммах;
 * у перевода строка только с проектом. Сумма зачисления — только у перевода между валютами.
 */
export function draftFromOperation(op: OperationRecord, accounts: ReadonlyMap<number, AccountLike>, timeZone: string): OperationDraft {
  const minor = minorOf(accounts, op.accountId);
  const from = accounts.get(op.accountId)?.currency;
  const to = op.toAccountId === null ? undefined : accounts.get(op.toAccountId)?.currency;
  const single = op.lines.length === 1 ? op.lines[0]! : null;
  const split = op.type !== 'transfer' && op.lines.length > 1;
  const paidDate = dayOf(op.paidAt, timeZone);
  return {
    type: op.type,
    accountId: op.accountId,
    amount: amountInputText(op.amount, minor),
    toAccountId: op.toAccountId,
    toAmount: op.toAmount !== null && to !== undefined && to !== from ? amountInputText(op.toAmount, minorOf(accounts, op.toAccountId)) : '',
    paidDate,
    accrualOn: op.accrualDate !== null,
    accrualDate: op.accrualDate ?? paidDate,
    categoryId: single?.categoryId ?? null,
    projectId: single?.projectId ?? null,
    counterpartyId: op.counterpartyId,
    tagIds: [...op.tagIds],
    comment: op.comment ?? '',
    split: split
      ? { mode: 'amount', lines: op.lines.map((l) => newLine({ categoryId: l.categoryId, projectId: l.projectId, value: amountInputText(l.amount, minor) })) }
      : null,
  };
}

/** Тело PATCH: изменённые поля и версия. */
export type OperationPatch = Partial<Omit<OperationBody, 'type'>> & { version: number };

const sameLines = (a: OperationRecord['lines'], b: OperationBody['lines']) =>
  a.length === b.length && a.every((l, i) => l.categoryId === b[i]!.categoryId && l.projectId === b[i]!.projectId && l.amount === b[i]!.amount);
const sameIds = (a: readonly number[], b: readonly number[]) => JSON.stringify([...a].sort((x, y) => x - y)) === JSON.stringify([...b].sort((x, y) => x - y));

/**
 * Изменённые поля для PATCH (итоги плана 4a, п. 1): `null` в `toAccountId`/`toAmount` схема правки не принимает,
 * а прежняя сумма зачисления вместе с новой суммой у перевода в одной валюте дала бы INVARIANT_4.
 * Дата оплаты отправляется, только если сменился день (время суток прежнее). У перевода между валютами сервер
 * сбрасывает сумму зачисления при смене суммы или счетов, если её нет в запросе, — поэтому тогда она уходит всегда.
 * null — менять нечего.
 */
export function patchBody(op: OperationRecord, body: OperationBody, timeZone: string): OperationPatch | null {
  const patch: OperationPatch = { version: op.version };
  if (dayOf(body.paidAt, timeZone) !== dayOf(op.paidAt, timeZone)) patch.paidAt = body.paidAt;
  if (body.accrualDate !== op.accrualDate) patch.accrualDate = body.accrualDate;
  if (body.accountId !== op.accountId) patch.accountId = body.accountId;
  if (body.amount !== op.amount) patch.amount = body.amount;
  if (body.toAccountId !== null && body.toAccountId !== op.toAccountId) patch.toAccountId = body.toAccountId;
  if (body.toAmount !== null && (body.toAmount !== op.toAmount || 'amount' in patch || 'accountId' in patch || 'toAccountId' in patch)) {
    patch.toAmount = body.toAmount;
  }
  if (body.counterpartyId !== op.counterpartyId) patch.counterpartyId = body.counterpartyId;
  if (body.comment !== op.comment) patch.comment = body.comment;
  if (!sameLines(op.lines, body.lines)) patch.lines = body.lines;
  if (!sameIds(op.tagIds, body.tagIds)) patch.tagIds = body.tagIds;
  return Object.keys(patch).length > 1 ? patch : null;
}

/** Неархивные элементы справочников: копия операции может ссылаться только на них (инвариант 7). */
export interface Available {
  accounts: ReadonlySet<number>;
  categories: ReadonlySet<number>;
  projects: ReadonlySet<number>;
  counterparties: ReadonlySet<number>;
  tags: ReadonlySet<number>;
}

/**
 * Черновик без архивных ссылок: новая операция не может выбрать архивный счёт, статью, проект, контрагента
 * или тег (инвариант 7) — их место остаётся пустым. Для «Дублировать» и «Сохранить и создать похожий» после правки.
 */
export function withoutArchived(draft: OperationDraft, available: Available): OperationDraft {
  const keep = (set: ReadonlySet<number>, id: number | null) => (id !== null && set.has(id) ? id : null);
  return {
    ...draft,
    accountId: keep(available.accounts, draft.accountId),
    toAccountId: keep(available.accounts, draft.toAccountId),
    categoryId: keep(available.categories, draft.categoryId),
    projectId: keep(available.projects, draft.projectId),
    counterpartyId: keep(available.counterparties, draft.counterpartyId),
    tagIds: draft.tagIds.filter((id) => available.tags.has(id)),
    split: draft.split && {
      ...draft.split,
      lines: draft.split.lines.map((l) => newLine({ categoryId: keep(available.categories, l.categoryId), projectId: keep(available.projects, l.projectId), value: l.value })),
    },
  };
}

/** «Дублировать» (§7): новая операция с теми же значениями, без архивных ссылок и с датой оплаты «сегодня». */
export function duplicateDraft(draft: OperationDraft, available: Available, today: string): OperationDraft {
  return { ...withoutArchived(draft, available), paidDate: today };
}

/** Архивный счёт, который затрагивает операция: сумму, дату оплаты и счета менять нельзя, удалить нельзя (инвариант 7). */
export function archivedAccountOf(op: Pick<OperationRecord, 'accountId' | 'toAccountId'>, accounts: ReadonlyMap<number, AccountLike & { name: string }>) {
  return [op.accountId, op.toAccountId].map((id) => (id === null ? undefined : accounts.get(id))).find((a) => a?.archivedAt) ?? null;
}
```

`src/client/components/operation/OperationFormHost.tsx` — правки:

1. Найдите:

```tsx
/** Что открыть в форме операции: новую операцию заданного типа. */
export type OperationFormRequest = { kind: 'create'; type: OperationType };
```

   замените на:

```tsx
/** Что открыть в форме операции: новую операцию заданного типа или существующую по id. */
export type OperationFormRequest =
  | { kind: 'create'; type: OperationType }
  | {
      kind: 'edit';
      id: number;
      /** Куда поставить фокус, если операцию удалили (строки, с которой открыли форму, больше нет). */
      focusAfterDelete?: () => HTMLElement | null;
    };
```

2. Найдите:

```tsx
 * «Перевод» в шапке. Каждое
```

   замените на:

```tsx
 * «Перевод» в шапке и строкой журнала. Каждое
```

`src/client/components/operation/OperationForm.tsx` — правки (к форме плана 6a добавляются загрузка операции, режим правки, «Дублировать», «Удалить», блокировки архивного счёта и три правки фокуса; автофокус суммы, недоступные во время запроса поля и шаблоны разделения без блокировки формы остаются как есть):

1. Найдите:

```tsx
import { useEffect, useId, useRef, useState, type FormEvent, type MutableRefObject } from 'react';
```

   замените на:

```tsx
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FormEvent, type MutableRefObject } from 'react';
```

2. Найдите:

```tsx
import { createFromForm, type CreatableKind } from '../../lib/operation-create';
```

   замените на:

```tsx
import { createFromForm, type CreatableKind } from '../../lib/operation-create';
import { archivedAccountOf, draftFromOperation, duplicateDraft, patchBody, withoutArchived, type Available, type OperationRecord } from '../../lib/operation-edit';
```

3. Найдите:

```tsx
import { alertClass, btnPrimary, btnSecondary, btnSmall, inputClass } from '../ui';
```

   замените на:

```tsx
import { alertClass, btnDanger, btnPrimary, btnSecondary, btnSmall, inputClass } from '../ui';
```

4. Найдите:

```tsx
/** Модалка на десктопе, на телефоне (меньше 768 px) — на весь экран (§7). */
```

   замените на:

```tsx
/** Подсказка у полей, которые нельзя менять: операция затрагивает архивный счёт (инвариант 7, §7). */
const LOCKED_HINT = 'счёт в архиве';

/** Модалка на десктопе, на телефоне (меньше 768 px) — на весь экран (§7). */
```

5. Найдите:

```tsx
export function OperationForm(props: { company: Company; request: OperationFormRequest; onClose: () => void }) {
  const [open, setOpen] = useState(true);
```

   замените на:

```tsx
export function OperationForm(props: { company: Company; request: OperationFormRequest; onClose: () => void }) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(props.request.kind === 'edit');
  const deleted = useRef(false);
  const editId = props.request.kind === 'edit' ? props.request.id : null;
  // операция для правки — всегда свежая с сервера: версия нужна для PATCH
  const operation = useQuery<OperationRecord, ApiError>({
    queryKey: ['operation', props.company.id, editId],
    queryFn: async () => (await api<{ operation: OperationRecord }>(`/companies/${props.company.id}/operations/${editId}`)).operation,
    enabled: editId !== null,
    gcTime: 0,
  });
```

6. Найдите:

```tsx
  const queries = [meta, accounts, categories, projects, counterparties, tags];
```

   замените на:

```tsx
  const queries = [meta, accounts, categories, projects, counterparties, tags, ...(editId !== null ? [operation] : [])];
```

7. Найдите:

```tsx
    <Modal open={open} title="Новая операция" onClose={props.onClose} onCancel={() => cancel.current()} className={MODAL_CLASS}>
      {data && meta.data ? (
        <OperationEditor
          company={props.company}
          data={data}
          timeZone={meta.data.timezone}
          type={props.request.type}
          close={() => setOpen(false)}
```

   замените на:

```tsx
    <Modal
      open={open}
      title={editing ? 'Изменить операцию' : 'Новая операция'}
      onClose={() => {
        props.onClose();
        // после удаления строки, с которой открыли форму, больше нет — фокус туда, куда просил открывший
        const target = deleted.current && props.request.kind === 'edit' ? props.request.focusAfterDelete?.() : null;
        if (target) requestAnimationFrame(() => target.focus());
      }}
      onCancel={() => cancel.current()}
      className={MODAL_CLASS}
    >
      {data && meta.data && (editId === null || operation.data) ? (
        <OperationEditor
          company={props.company}
          data={data}
          timeZone={meta.data.timezone}
          type={props.request.kind === 'create' ? props.request.type : operation.data!.type}
          operation={operation.data ?? null}
          onEditingChange={setEditing}
          onDeleted={() => (deleted.current = true)}
          close={() => setOpen(false)}
```

8. Найдите:

```tsx
  type: OperationType;
  close: () => void;
  /** Что делать по Esc: форма решает сама (несохранённые изменения). */
```

   замените на:

```tsx
  type: OperationType;
  /** Правка существующей операции; null — новая. */
  operation: OperationRecord | null;
  /** Форма перешла от правки к новой операции («Дублировать», «Сохранить и создать похожий»). */
  onEditingChange: (editing: boolean) => void;
  /** Операция удалена: окно закроется, фокус — не на исчезнувшую строку. */
  onDeleted: () => void;
  close: () => void;
  /** Что делать по Esc: форма решает сама (несохранённые изменения). */
```

9. Найдите:

```tsx
  const firstAccount = p.data.accounts.find((a) => !a.archivedAt)?.id ?? null;
  const [initial, setInitial] = useState(() => emptyDraft(p.type, today, firstAccount));
  const [draft, setDraft] = useState(initial);
```

   замените на:

```tsx
  const firstAccount = p.data.accounts.find((a) => !a.archivedAt)?.id ?? null;
  const accounts = new Map(p.data.accounts.map((a) => [a.id, a]));
  const [op, setOp] = useState(p.operation);
  const [initial, setInitial] = useState(() => (op ? draftFromOperation(op, accounts, p.timeZone) : emptyDraft(p.type, today, firstAccount)));
  const [draft, setDraft] = useState(initial);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** После «Не удалять» (или Esc) фокус возвращается на «Удалить». */
  const deleteRef = useRef<HTMLButtonElement>(null);
  const deleteAsked = useRef(false);
```

10. Найдите:

```tsx
  const [more, setMore] = useState(false);
  const [refocusAmount, setRefocusAmount] = useState(0);
```

   замените на:

```tsx
  // блок «Проект, теги, комментарий» раскрыт, если в нём уже что-то есть
  const [more, setMore] = useState(() => initial.projectId !== null || initial.tagIds.length > 0 || initial.comment !== '');
  const [refocusAmount, setRefocusAmount] = useState(0);
  /** Ошибка сохранения: фокус — на первое поле с ошибкой или действие в сообщении (поля были недоступны, фокус потерян). */
  const formRef = useRef<HTMLFormElement>(null);
  const [errorFocus, setErrorFocus] = useState(0);
```

11. Найдите:

```tsx
  const continueRef = useRef<HTMLButtonElement>(null);
  const focusBefore = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (confirmClose) continueRef.current?.focus();
    else focusBefore.current?.focus();
  }, [confirmClose]);

  // Esc: открыт вопрос — продолжить ввод; есть несохранённые изменения — спросить; иначе закрыть
  p.cancelRef.current = () => {
    if (confirmClose) setConfirmClose(false);
    else if (dirty) {
      focusBefore.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setConfirmClose(true);
    } else p.close();
  };

  const accounts = new Map(p.data.accounts.map((a) => [a.id, a]));
  const account = draft.accountId
```

   замените на:

```tsx
  const continueRef = useRef<HTMLButtonElement>(null);
  const focusBefore = useRef<HTMLElement | null>(null);
  const closeAsked = useRef(false);

  useEffect(() => {
    if (confirmClose) {
      continueRef.current?.focus();
      return;
    }
    if (!closeAsked.current) return;
    closeAsked.current = false;
    // «Отмена», с которой спросили, уже исчезла вместе с кнопками — тогда фокус в поле суммы
    if (focusBefore.current?.isConnected) focusBefore.current.focus();
    else setRefocusAmount((n) => n + 1);
  }, [confirmClose]);

  useEffect(() => {
    if (confirmDelete || !deleteAsked.current) return;
    deleteAsked.current = false;
    deleteRef.current?.focus();
  }, [confirmDelete]);

  useEffect(() => {
    if (!errorFocus) return;
    const form = formRef.current;
    const target = form?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? form?.querySelector<HTMLElement>('[role="alert"] button');
    if (target) target.focus();
    else setRefocusAmount((n) => n + 1);
  }, [errorFocus]);

  // Esc: пока идёт запрос — ничего (окно закрылось бы, а операция всё равно сохранится); открыто подтверждение
  // удаления или вопрос — закрыть их; есть несохранённые изменения — спросить; иначе закрыть
  p.cancelRef.current = () => {
    if (pending) return;
    if (confirmDelete) setConfirmDelete(false);
    else if (confirmClose) setConfirmClose(false);
    else if (dirty) {
      focusBefore.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      closeAsked.current = true;
      setConfirmClose(true);
    } else p.close();
  };

  const account = draft.accountId
```

12. Найдите:

```tsx
  const mainCategory = draft.split ? (draft.split.lines[0]?.categoryId ?? null) : draft.categoryId;
```

   замените на:

```tsx
  const mainCategory = draft.split ? (draft.split.lines[0]?.categoryId ?? null) : draft.categoryId;
  // операция на архивном счёте: сумма, дата оплаты и счета заблокированы, удалить нельзя (инвариант 7)
  const locked = op ? archivedAccountOf(op, accounts) : null;
  const lockHint = locked ? LOCKED_HINT : undefined;
```

13. Найдите:

```tsx
    const now = new Date();
    // buildBody вычисляет выражение в сумме само: Enter или «Сохранить» без ухода из поля сохраняют результат
    const r = buildBody(draft, { accounts, today: todayInTimezone(p.timeZone, now), timeZone: p.timeZone, now, timeOfDayFrom: now });
```

   замените на:

```tsx
    const now = new Date();
    // у существующей операции при смене дня сохраняется прежнее время суток
    const timeOfDayFrom = op ? new Date(op.paidAt) : now;
    // buildBody вычисляет выражение в сумме само: Enter или «Сохранить» без ухода из поля сохраняют результат
    const r = buildBody(draft, { accounts, today: todayInTimezone(p.timeZone, now), timeZone: p.timeZone, now, timeOfDayFrom });
```

14. Найдите:

```tsx
      await api(`/companies/${p.company.id}/operations`, { method: 'POST', body: r.body });
      void invalidateOperations(p.company.id);
      if (then === 'close') {
        p.close();
        return;
      }
      const next = similarDraft(draft);
      setDraft(next);
```

   замените на:

```tsx
      if (op) {
        // в PATCH — только изменённые поля (итоги плана 4a, п. 1); без изменений запроса нет
        const patch = patchBody(op, r.body, p.timeZone);
        if (patch) await api(`/companies/${p.company.id}/operations/${op.id}`, { method: 'PATCH', body: patch });
      } else {
        await api(`/companies/${p.company.id}/operations`, { method: 'POST', body: r.body });
      }
      void invalidateOperations(p.company.id);
      if (then === 'close') {
        p.close();
        return;
      }
      // после правки: архивные счёт, статьи и прочее в новую операцию не переносятся (инвариант 7)
      const next = op ? withoutArchived(similarDraft(draft), available()) : similarDraft(draft);
      setOp(null);
      p.onEditingChange(false);
      setDraft(next);
```

15. Найдите:

```tsx
      setFormError(e instanceof ApiError ? e.message : 'Ошибка сервера');
    } finally {
      setPending(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
```

   замените на:

```tsx
      setFormError(e instanceof ApiError ? e.message : 'Ошибка сервера');
      setErrorFocus((n) => n + 1);
    } finally {
      setPending(false);
    }
  };

  /** Неархивные элементы справочников: только их может выбрать новая операция (инвариант 7). */
  const available = (): Available => {
    const ids = <T extends { id: number; archivedAt: string | null }>(xs: readonly T[]) => new Set(xs.filter((x) => !x.archivedAt).map((x) => x.id));
    const categories = new Set(
      [...p.data.categories.income, ...p.data.categories.expense].flatMap((n) =>
        n.archivedAt ? [] : [n.id, ...n.children.filter((c) => !c.archivedAt).map((c) => c.id)],
      ),
    );
    return { accounts: ids(p.data.accounts), categories, projects: ids(p.data.projects), counterparties: ids(p.data.counterparties), tags: ids(p.data.tags) };
  };

  const remove = async () => {
    if (!op) return;
    setPending(true);
    setFormError(null);
    try {
      await api(`/companies/${p.company.id}/operations/${op.id}`, { method: 'DELETE' });
      void invalidateOperations(p.company.id);
      p.onDeleted();
      p.close();
    } catch (e) {
      setConfirmDelete(false);
      setFormError(e instanceof ApiError ? e.message : 'Ошибка сервера');
    } finally {
      setPending(false);
    }
  };

  /** «Дублировать» (§7): новая операция с теми же значениями на сегодня; закрыть её без сохранения — с вопросом. */
  const duplicate = () => {
    const copy = duplicateDraft(draft, available(), today);
    setOp(null);
    p.onEditingChange(false);
    setDraft(copy);
    setInitial(emptyDraft(copy.type, today, firstAccount));
    setErrors({});
    setFormError(null);
    setStatus('Это копия — проверьте и сохраните');
    setRefocusAmount((n) => n + 1);
  };

  const onSubmit = (e: FormEvent) => {
```

16. Найдите:

```tsx
  if (activeAccounts.length === 0) {
```

   замените на:

```tsx
  if (!op && activeAccounts.length === 0) {
```

17. Найдите:

```tsx
      onChange={(id) => set({ [key]: id }, key)}
      error={errors[key]}
    />
  );
```

   замените на:

```tsx
      onChange={(id) => set({ [key]: id }, key)}
      error={errors[key]}
      disabled={!!locked}
      hint={lockHint}
    />
  );
```

18. Найдите:

```tsx
    <form onSubmit={onSubmit} noValidate aria-label="Операция" className="grid gap-4">
      <fieldset disabled={pending}>
        <legend className="sr-only">Тип операции</legend>
```

   замените на:

```tsx
    <form ref={formRef} onSubmit={onSubmit} noValidate aria-label="Операция" className="grid gap-4">
      {/* тип существующей операции не меняется (схема правки) */}
      {!op && (
      <fieldset disabled={pending}>
        <legend className="sr-only">Тип операции</legend>
```

19. Найдите:

```tsx
          ))}
        </div>
      </fieldset>
```

   замените на:

```tsx
          ))}
        </div>
      </fieldset>
      )}
```

20. Найдите:

```tsx
          autoFocus
          refocusSignal={refocusAmount}
        />
```

   замените на:

```tsx
          autoFocus
          refocusSignal={refocusAmount}
          disabled={!!locked}
          hint={lockHint}
        />
```

21. Найдите:

```tsx
            error={errors.toAmount}
            hint={rateHint(draft, currency.code, currency.minorUnits, toCurrency.code, toCurrency.minorUnits)}
```

   замените на:

```tsx
            error={errors.toAmount}
            disabled={!!locked}
            hint={lockHint ?? rateHint(draft, currency.code, currency.minorUnits, toCurrency.code, toCurrency.minorUnits)}
```

22. Найдите:

```tsx
        <Field label={transfer ? 'Дата' : 'Дата оплаты'} error={errors.paidAt}>
          {(c) => (
            <input {...c} type="date" max={today} value={draft.paidDate} onChange={(e) => set({ paidDate: e.target.value }, 'paidAt')} className={inputClass} />
          )}
```

   замените на:

```tsx
        <Field label={transfer ? 'Дата' : 'Дата оплаты'} error={errors.paidAt} hint={lockHint}>
          {(c) => (
            <input
              {...c}
              type="date"
              max={today}
              disabled={!!locked}
              value={draft.paidDate}
              onChange={(e) => set({ paidDate: e.target.value }, 'paidAt')}
              className={inputClass}
            />
          )}
```

23. Найдите:

```tsx
      {confirmClose ? (
```

   замените на:

```tsx
      {confirmDelete && op ? (
        <div role="group" aria-label="Удаление операции" className="flex flex-wrap items-center gap-2 text-sm">
          <span>Удалить операцию?</span>
          <button type="button" disabled={pending} onClick={() => void remove()} className={btnDanger}>
            Да, удалить
          </button>
          <button type="button" autoFocus onClick={() => setConfirmDelete(false)} className={btnSecondary}>
            Не удалять
          </button>
        </div>
      ) : confirmClose ? (
```

24. Найдите:

```tsx
            Сохранить и создать похожий
          </button>
          <button type="button" onClick={() => p.cancelRef.current()} className={btnSecondary}>
            Отмена
          </button>
        </div>
```

   замените на:

```tsx
            Сохранить и создать похожий
          </button>
          {op && (
            <>
              <button type="button" disabled={pending} onClick={duplicate} className={btnSecondary}>
                Дублировать
              </button>
              <button
                type="button"
                ref={deleteRef}
                disabled={pending || !!locked}
                aria-describedby={locked ? 'operation-delete-locked' : undefined}
                onClick={() => {
                  deleteAsked.current = true;
                  setConfirmDelete(true);
                }}
                className={btnDanger}
              >
                Удалить
              </button>
            </>
          )}
          {/* пока запрос идёт, «Отмена» и Esc окно не закрывают: операция всё равно сохранилась бы */}
          <button type="button" onClick={() => p.cancelRef.current()} className={btnSecondary}>
            Отмена
          </button>
          {locked && (
            <span id="operation-delete-locked" className="self-center text-sm text-muted">
              Удалить нельзя: {LOCKED_HINT} («{locked.name}»)
            </span>
          )}
        </div>
```

Проверка, что исправления плана 6a на месте (повторный автофокус суммы, поля недоступны во время запроса, шаблоны разделения не блокируют форму):

```bash
node -e "const s=require('fs').readFileSync('src/client/components/operation/OperationForm.tsx','utf8'); const need=['refocusSignal={refocusAmount}','<fieldset disabled={pending}','presets: presets.data ?? []']; const miss=need.filter((x)=>!s.includes(x)); if (miss.length) { console.error('пропали исправления плана 6a: '+miss.join(', ')); process.exit(1); }"
```


`src/client/components/journal/JournalTable.tsx` — правки (места — из плана 5b):

1. Найдите:

```tsx
              date: (
                <time dateTime={item.paidAt} className="whitespace-nowrap">
                  {dayLabel(dayOf(item.paidAt, props.timeZone), props.today)}
                  <span className="ml-1 text-xs text-muted">{timeLabel(item.paidAt, props.timeZone)}</span>
                </time>
              ),
```

   замените на:

```tsx
              date: props.onOpenOperation ? (
                // с клавиатуры операция открывается кнопкой в ячейке даты (Tab, затем Enter)
                <button
                  type="button"
                  onClick={() => props.onOpenOperation!(item)}
                  aria-label={`Открыть операцию: ${dayLabel(dayOf(item.paidAt, props.timeZone), props.today)} ${timeLabel(item.paidAt, props.timeZone)}, ${signedMoney(item.type, item.amount, currency)}`}
                  className="rounded text-left hover:underline focus-visible:outline-2 focus-visible:outline-focus"
                >
                  <time dateTime={item.paidAt} className="whitespace-nowrap">
                    {dayLabel(dayOf(item.paidAt, props.timeZone), props.today)}
                    <span className="ml-1 text-xs text-muted">{timeLabel(item.paidAt, props.timeZone)}</span>
                  </time>
                </button>
              ) : (
                <time dateTime={item.paidAt} className="whitespace-nowrap">
                  {dayLabel(dayOf(item.paidAt, props.timeZone), props.today)}
                  <span className="ml-1 text-xs text-muted">{timeLabel(item.paidAt, props.timeZone)}</span>
                </time>
              ),
```

2. Найдите:

```tsx
  /**
   * Точка подключения формы операции (шаг 6): клик по строке открывает операцию. Пока не передаётся —
   * строка не реагирует на клик.
   */
```

   замените на:

```tsx
  /**
   * Открыть операцию в форме (шаг 6): клик по строке или кнопка в ячейке даты (с клавиатуры).
   * Не передан — строка не реагирует на клик.
   */
```

`src/client/pages/JournalPage.tsx` — правки (места — из планов 5b и 5c):

1. Найдите:

```tsx
import { LoadMore } from '../components/journal/LoadMore';
```

   замените на:

```tsx
import { LoadMore } from '../components/journal/LoadMore';
import { useOpenOperationForm } from '../components/operation/OperationFormHost';
```

2. Найдите:

```tsx
  const [filterOpen, setFilterOpen] = useState(false);
```

   замените на:

```tsx
  const [filterOpen, setFilterOpen] = useState(false);
  const openForm = useOpenOperationForm();
```

3. Найдите:

```tsx
          busy={journal.isPlaceholderData}
```

   замените на:

```tsx
          busy={journal.isPlaceholderData}
          onOpenOperation={(item) => openForm({ kind: 'edit', id: item.id, focusAfterDelete: () => document.getElementById(HEADING_ID) })}
```

Проверка экранирований:

```bash
node -e "for (const f of process.argv.slice(1)) if (/[\u00a0\u202f\u2212\u200b]/.test(require('fs').readFileSync(f, 'utf8'))) { console.error('невидимый символ вместо экранирования: ' + f); process.exit(1); }" src/client/components/operation/OperationForm.tsx src/client/lib/operation-edit.ts tests/client/operation-edit.test.ts e2e/operation-edit.spec.ts
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/client/operation-edit.test.ts tests/client/operation-form.test.ts`
Expected: PASS.

Run: `npx playwright test e2e/operation-edit.spec.ts e2e/operation-form.spec.ts e2e/journal.spec.ts e2e/journal-actions.spec.ts`
Expected: PASS — журнал и «Указать» не изменились: клик по кнопкам и флажкам в строке форму не открывает.

- [ ] **Step 5: Full check and commit**

Run: `npm test`, `npm run typecheck` и `npm run test:e2e` — зелёные.

```bash
git add src/client/lib/operation-edit.ts tests/client/operation-edit.test.ts e2e/operation-edit.spec.ts src/client/components/operation/OperationForm.tsx src/client/components/operation/OperationFormHost.tsx src/client/components/journal/JournalTable.tsx src/client/pages/JournalPage.tsx
git commit -m "feat: правка операции из журнала — только изменённые поля, «Дублировать», «Удалить», блокировки архивного счёта

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Конфликт версии — «Загрузить актуальную»

**Files:**
- Modify: `src/client/components/operation/OperationForm.tsx`, `e2e/operation-edit.spec.ts`

**Interfaces:**
- Consumes: задача 1 (`op`, `setOp`, `draftFromOperation`, `submit`); `ApiError.status`; `invalidateOperations`.
- Produces: в форме правки при 409 — `role="alert"` «Операция изменена другим пользователем» с кнопкой «Загрузить актуальную» или «Операция удалена другим пользователем» с кнопкой «Закрыть».

- [ ] **Step 1: Write the failing test**

`e2e/operation-edit.spec.ts` — в конец файла:

```ts
test('409: операцию изменили в другом окне — «Загрузить актуальную» и повтор; удалили — «Закрыть»', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Конфликт ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  const id = (await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(2), accountId: cash, amount: 10000, comment: 'первая' })).operation.id;
  const other = (await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(1), accountId: cash, amount: 5000, comment: 'вторая' })).operation.id;
  await page.reload();

  await rows(page).filter({ hasText: 'первая' }).getByText('первая').click();
  let dialog = editForm(page);
  const amount = dialog.getByRole('textbox', { name: /^Сумма,/ });
  await expect(amount).toHaveValue('100');
  await expect(amount).toBeFocused();
  // другой пользователь меняет комментарий (версия 1 → 2)
  const res = await page.request.patch(`${base}/operations/${id}`, { data: { version: 1, comment: 'чужая правка' }, headers: csrf(page) });
  expect(res.status()).toBe(200);
  await amount.fill('150');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Операция изменена другим пользователем');
  // поля были недоступны во время запроса — фокус переходит на действие в сообщении
  await expect(dialog.getByRole('button', { name: 'Загрузить актуальную' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Загрузить актуальную' }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByLabel('Комментарий')).toHaveValue('чужая правка');
  await expect(amount).toHaveValue('100');
  await expect(amount).toBeFocused();
  await amount.fill('150');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).toBeHidden();
  const edited = rows(page).filter({ hasText: 'чужая правка' });
  await expect(edited).toContainText(/150,00\s₸/);

  // операцию удалили, пока форма открыта
  await rows(page).filter({ hasText: 'вторая' }).getByText('вторая').click();
  dialog = editForm(page);
  // форма ставит фокус в сумму кадр спустя — дождаться, прежде чем заполнять комментарий
  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
  expect((await page.request.delete(`${base}/operations/${other}`, { headers: csrf(page) })).status()).toBe(200);
  await dialog.getByLabel('Комментарий').fill('поздно');
  await expect(dialog.getByLabel('Комментарий')).toHaveValue('поздно');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Операция удалена другим пользователем');
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(rows(page).filter({ hasText: 'вторая' })).toHaveCount(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test e2e/operation-edit.spec.ts -g "409"`
Expected: FAIL — нет кнопки «Загрузить актуальную».

- [ ] **Step 3: Implement**

`src/client/components/operation/OperationForm.tsx` — правки:

1. Найдите:

```tsx
  const deleteAsked = useRef(false);
```

   замените на:

```tsx
  const deleteAsked = useRef(false);
  /** 409 при сохранении правки: операцию изменили или удалили после того, как форму открыли. */
  const [conflict, setConflict] = useState<'changed' | 'deleted' | null>(null);
```

2. Найдите:

```tsx
    } catch (e) {
      setErrors(serverFieldErrors(e instanceof ApiError ? e.fields : undefined));
```

   замените на:

```tsx
    } catch (e) {
      if (op && e instanceof ApiError && e.status === 409) {
        setConflict(e.message.startsWith('Операция удалена') ? 'deleted' : 'changed');
        void invalidateOperations(p.company.id);
        setErrorFocus((n) => n + 1);
        return;
      }
      setErrors(serverFieldErrors(e instanceof ApiError ? e.fields : undefined));
```

3. Найдите:

```tsx
  /** Неархивные элементы справочников: только их может выбрать новая операция (инвариант 7). */
```

   замените на:

```tsx
  /** «Загрузить актуальную» (§7): форма показывает свежую версию, свои изменения пользователь вносит заново. */
  const reload = async () => {
    if (!op) return;
    setPending(true);
    try {
      const fresh = (await api<{ operation: OperationRecord }>(`/companies/${p.company.id}/operations/${op.id}`)).operation;
      if (fresh.deletedAt) {
        setConflict('deleted');
        return;
      }
      const next = draftFromOperation(fresh, accounts, p.timeZone);
      setOp(fresh);
      setDraft(next);
      setInitial(next);
      setConflict(null);
      setErrors({});
      setFormError(null);
      setStatus('Загружена актуальная версия — внесите изменения заново');
      setRefocusAmount((n) => n + 1);
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Ошибка сервера');
    } finally {
      setPending(false);
    }
  };

  /** Неархивные элементы справочников: только их может выбрать новая операция (инвариант 7). */
```

4. Найдите:

```tsx
      {formError && (
```

   замените на:

```tsx
      {conflict && (
        <div role="alert" className={`${alertClass} mb-0 flex flex-wrap items-center justify-between gap-2`}>
          <span>{conflict === 'changed' ? 'Операция изменена другим пользователем' : 'Операция удалена другим пользователем'}</span>
          {conflict === 'changed' ? (
            <button type="button" disabled={pending} onClick={() => void reload()} className="font-semibold underline">
              Загрузить актуальную
            </button>
          ) : (
            <button type="button" onClick={p.close} className="font-semibold underline">
              Закрыть
            </button>
          )}
        </div>
      )}
      {formError && (
```

Проверка, что исправления плана 6a на месте (повторный автофокус суммы, поля недоступны во время запроса, шаблоны разделения не блокируют форму):

```bash
node -e "const s=require('fs').readFileSync('src/client/components/operation/OperationForm.tsx','utf8'); const need=['refocusSignal={refocusAmount}','<fieldset disabled={pending}','presets: presets.data ?? []']; const miss=need.filter((x)=>!s.includes(x)); if (miss.length) { console.error('пропали исправления плана 6a: '+miss.join(', ')); process.exit(1); }"
```


- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test e2e/operation-edit.spec.ts`
Expected: PASS (6 тестов).

Run: `npx playwright test e2e/operation-edit.spec.ts -g "409" --repeat-each=30`
Expected: PASS — тест не зависит от того, когда форма ставит фокус в сумму.

- [ ] **Step 5: Full check and commit**

Run: `npm test`, `npm run typecheck` и `npm run test:e2e` — зелёные.

```bash
git add src/client/components/operation/OperationForm.tsx e2e/operation-edit.spec.ts
git commit -m "feat: конфликт версии в форме операции — «Загрузить актуальную»

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Нет курса на дату — «Указать курс на {D}» и «Повторить»

**Files:**
- Create: `tests/server/rate-unavailable.test.ts`, `src/client/components/operation/RateFix.tsx`
- Modify: `src/server/errors.ts`, `src/server/modules/rates/service.ts`, `src/server/modules/rates/routes.ts`, `src/client/lib/api.ts`, `src/client/components/operation/OperationForm.tsx`, `e2e/operation-form.spec.ts`

**Interfaces:**
- Consumes: `opsWorld` (`tests/helpers/ops.ts`); `RatesService.resolve`, `kztRate`; `POST /api/v1/rates/manual` (план 4a); `formatDateRu`; `Field`; `queryClient`.
- Produces:
  - `AppError(status, code, message, fields?, details?: Record<string, string>)`; ответ ошибки — `{ error: { code, message, fields?, details? } }`;
  - `rateUnavailable(currency, date): AppError` (экспорт `src/server/modules/rates/service.ts`) — 422 `RATE_UNAVAILABLE` «Нет курса X на ДД.ММ.ГГГГ», `details: { currency, date }`;
  - `ApiError.details?: Record<string, string>`;
  - `RateFix({ missing: MissingRate, companyId, pending, onRetry })`, `interface MissingRate { message; currency; date }` — `role="alert"`, кнопки «Указать курс на ДД.ММ.ГГГГ», «Сохранить курс», «Не указывать», «Повторить», поле «Курс X к тенге на ДД.ММ.ГГГГ».

- [ ] **Step 1: Write the failing tests**

`tests/server/rate-unavailable.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { opsWorld, type OpsWorld } from '../helpers/ops';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

describe('RATE_UNAVAILABLE: какой курс нужен — в details (§4.3 п. 6, «Указать курс на {D}»)', () => {
  it('нет курса валюты счёта: details с валютой и датой; после ручного курса на эту дату операция создаётся', async () => {
    w = await opsWorld('2026-10-20T12:00:00.000Z');
    const body = { type: 'expense', paidAt: '2026-10-09T10:00:00Z', accountId: w.usd, amount: 100 };
    const res = await w.h.req('POST', w.ops, body);
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toEqual({ code: 'RATE_UNAVAILABLE', message: 'Нет курса USD на 09.10.2026', details: { currency: 'USD', date: '2026-10-09' } });

    await w.post('/api/v1/rates/manual', { date: '2026-10-09', currency: 'USD', rate: '480' });
    expect((await w.h.req('POST', w.ops, body)).statusCode).toBe(201);
  });

  it('нет курса базовой валюты компании (база USD, счёт в тенге): в details — базовая валюта', async () => {
    w = await opsWorld('2026-10-20T12:00:00.000Z');
    const res = await w.h.req('POST', '/api/v1/companies', { name: 'ТОО Долларовая', baseCurrency: 'USD' });
    const cid = res.json().company.id as number;
    const cash = (await w.post(`/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2026-10-01' })).account.id;
    const err = await w.h.req('POST', `/api/v1/companies/${cid}/operations`, { type: 'income', paidAt: '2026-10-15T10:00:00Z', accountId: cash, amount: 100 });
    expect(err.json().error.details).toEqual({ currency: 'USD', date: '2026-10-15' });
  });

  it('GET /rates без курса — те же details; у остальных ошибок details нет', async () => {
    w = await opsWorld('2026-10-20T12:00:00.000Z');
    const none = await w.h.req('GET', '/api/v1/rates?date=2026-10-15&currency=USD');
    expect(none.json().error.details).toEqual({ currency: 'USD', date: '2026-10-15' });
    const invalid = await w.h.req('POST', w.ops, { type: 'expense', paidAt: '2026-10-09T10:00:00Z', accountId: w.kzt, amount: 0 });
    expect(invalid.json().error).not.toHaveProperty('details');
  });
});
```

`e2e/operation-form.spec.ts` — в конец файла:

```ts
test('нет курса на дату: «Указать курс на {D}» создаёт ручной курс прямо в форме, «Повторить» сохраняет операцию', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Курс ${Date.now()}`);
  // CHF и 2021 год — только в этом тесте: ручной курс общий для всех компаний
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Франки', currency: 'CHF', openedAt: '2020-01-01' });
  await page.reload();

  const dialog = await openForm(page, 'Расход');
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('10');
  await dialog.getByLabel('Дата оплаты').fill('2021-06-15');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  const alert = dialog.getByRole('alert').filter({ hasText: 'Нет курса CHF на 15.06.2021' });
  await expect(alert).toBeVisible();
  await expect(alert.getByRole('button', { name: 'Указать курс на 15.06.2021' })).toBeFocused();
  await alert.getByRole('button', { name: 'Указать курс на 15.06.2021' }).click();
  const rate = alert.getByLabel('Курс CHF к тенге на 15.06.2021');
  await expect(rate).toBeFocused();
  await rate.fill('abc');
  await alert.getByRole('button', { name: 'Сохранить курс' }).click();
  await expect(rate).toHaveAttribute('aria-invalid', 'true');
  await rate.fill('560,5');
  await rate.press('Enter');
  await expect(alert).toContainText('Курс CHF на 15.06.2021 сохранён');
  await expect(dialog).toBeVisible();
  await alert.getByRole('button', { name: 'Повторить' }).click();
  await expect(dialog).toBeHidden();
  const row = table(page).locator('tbody tr').filter({ hasText: '15.06.2021' });
  await expect(row).toContainText(/5\s605,00\s₸/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/rate-unavailable.test.ts`
Expected: FAIL — в ответе нет `details`.

- [ ] **Step 3: Implement**

`src/server/errors.ts` — правки:

1. Найдите:

```ts
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
```

   замените на:

```ts
    message: string,
    public readonly fields?: Record<string, string>,
    /** Данные для действия в интерфейсе (у RATE_UNAVAILABLE — валюта и дата для «Указать курс на {D}»). */
    public readonly details?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
```

2. Найдите:

```ts
        error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) },
```

   замените на:

```ts
        error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}), ...(err.details ? { details: err.details } : {}) },
```

`src/server/modules/rates/service.ts` — правки:

1. Найдите:

```ts
const unavailable = (currency: string, date: string) => new AppError(422, 'RATE_UNAVAILABLE', `Нет курса ${currency} на ${formatDateRu(date)}`);
```

   замените на:

```ts
/** Нет курса: details — какой валюте и на какую дату нужен курс, форма операции предлагает «Указать курс на {D}» (§4.3 п. 6). */
export const rateUnavailable = (currency: string, date: string) =>
  new AppError(422, 'RATE_UNAVAILABLE', `Нет курса ${currency} на ${formatDateRu(date)}`, undefined, { currency, date });
```

2. Найдите:

```ts
      if (!rx) throw unavailable(currency, date);
```

   замените на:

```ts
      if (!rx) throw rateUnavailable(currency, date);
```

3. Найдите:

```ts
      if (!rb) throw unavailable(baseCurrency, date);
```

   замените на:

```ts
      if (!rb) throw rateUnavailable(baseCurrency, date);
```

`src/server/modules/rates/routes.ts` — правки (импорты `formatDateRu` и `AppError` больше не нужны):

1. Найдите:

```ts
import type { FastifyInstance } from 'fastify';
import { formatDateRu } from '../../../shared/dates';
import { decToString } from '../../../shared/decimal';
```

   замените на:

```ts
import type { FastifyInstance } from 'fastify';
import { decToString } from '../../../shared/decimal';
```

2. Найдите:

```ts
import { currencies } from '../../db/schema';
import { AppError } from '../../errors';
import { parseId } from '../../http/params';
```

   замените на:

```ts
import { currencies } from '../../db/schema';
import { parseId } from '../../http/params';
```

3. Найдите:

```ts
import type { RatesService } from './service';
```

   замените на:

```ts
import { rateUnavailable, type RatesService } from './service';
```

4. Найдите:

```ts
    if (!found) throw new AppError(422, 'RATE_UNAVAILABLE', `Нет курса ${q.currency} на ${formatDateRu(q.date)}`);
```

   замените на:

```ts
    if (!found) throw rateUnavailable(q.currency, q.date);
```

`src/client/lib/api.ts` — правки:

1. Найдите:

```ts
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
```

   замените на:

```ts
    message: string,
    public readonly fields?: Record<string, string>,
    /** Данные для действия в интерфейсе (у RATE_UNAVAILABLE — `currency` и `date`). */
    public readonly details?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
```

2. Найдите:

```ts
  const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string; fields?: Record<string, string> } } | null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? 'INTERNAL', data?.error?.message ?? 'Ошибка сервера', data?.error?.fields);
  }
```

   замените на:

```ts
  const data = (await res.json().catch(() => null)) as {
    error?: { code: string; message: string; fields?: Record<string, string>; details?: Record<string, string> };
  } | null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? 'INTERNAL', data?.error?.message ?? 'Ошибка сервера', data?.error?.fields, data?.error?.details);
  }
```

`src/client/components/operation/RateFix.tsx`:

```tsx
import { useState } from 'react';
import { formatDateRu } from '../../../shared/dates';
import { api, ApiError } from '../../lib/api';
import { queryClient } from '../../lib/query';
import { Field } from '../Field';
import { btnSmall, inputClass } from '../ui';

export interface MissingRate {
  message: string;
  currency: string;
  /** `YYYY-MM-DD`. */
  date: string;
}

/**
 * Ошибка RATE_UNAVAILABLE в форме операции (§4.3 п. 6, §7): текст ошибки, «Указать курс на {D}» — небольшая форма,
 * которая создаёт ручной курс к тенге только на эту дату, — и «Повторить» (сохранить операцию ещё раз).
 */
export function RateFix(props: { missing: MissingRate; companyId: number; pending: boolean; onRetry: () => void }) {
  const { currency, date } = props.missing;
  const day = formatDateRu(date);
  const [open, setOpen] = useState(false);
  const [rate, setRate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api('/rates/manual', { method: 'POST', body: { date, currency, rate } });
      setSaved(true);
      setOpen(false);
      // ручной курс меняет итоги «Всего на счетах» и экран «Курсы»
      void queryClient.invalidateQueries({ queryKey: ['rates-manual'] });
      void queryClient.invalidateQueries({ queryKey: ['accounts', props.companyId] });
      void queryClient.invalidateQueries({ queryKey: ['companies'] });
    } catch (e) {
      setError(e instanceof ApiError ? (e.fields?.rate ?? e.fields?.date ?? e.message) : 'Ошибка сервера');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div role="alert" className="grid gap-2 rounded-xl bg-expense-soft px-4 py-3 text-sm text-expense">
      <span>{props.missing.message}</span>
      {saved && (
        <span className="text-ink">
          Курс {currency} на {day} сохранён — нажмите «Повторить».
        </span>
      )}
      {open ? (
        <div role="group" aria-label={`Курс на ${day}`} className="flex flex-wrap items-end gap-2 text-ink">
          <Field label={`Курс ${currency} к тенге на ${day}`} error={error ?? undefined} className="min-w-48 flex-1">
            {(c) => (
              <input
                {...c}
                autoFocus
                inputMode="decimal"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                onKeyDown={(e) => {
                  // Enter здесь сохраняет курс, а не операцию
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void save();
                  }
                }}
                className={inputClass}
              />
            )}
          </Field>
          <button type="button" disabled={saving} onClick={() => void save()} className={btnSmall}>
            Сохранить курс
          </button>
          <button type="button" onClick={() => setOpen(false)} className={btnSmall}>
            Не указывать
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {!saved && (
            <button type="button" onClick={() => setOpen(true)} className={btnSmall}>
              Указать курс на {day}
            </button>
          )}
          <button type="button" disabled={props.pending} onClick={props.onRetry} className={btnSmall}>
            Повторить
          </button>
        </div>
      )}
    </div>
  );
}
```

`src/client/components/operation/OperationForm.tsx` — правки:

1. Найдите:

```tsx
import { SplitEditor } from './SplitEditor';
```

   замените на:

```tsx
import { RateFix, type MissingRate } from './RateFix';
import { SplitEditor } from './SplitEditor';
```

2. Найдите:

```tsx
  const [conflict, setConflict] = useState<'changed' | 'deleted' | null>(null);
```

   замените на:

```tsx
  const [conflict, setConflict] = useState<'changed' | 'deleted' | null>(null);
  /** RATE_UNAVAILABLE: какого курса нет; «Повторить» сохраняет тем же способом (lastThen). */
  const [missingRate, setMissingRate] = useState<MissingRate | null>(null);
  const lastThen = useRef<'close' | 'similar'>('close');
```

3. Найдите:

```tsx
  const submit = async (then: 'close' | 'similar') => {
    if (pending) return;
```

   замените на:

```tsx
  const submit = async (then: 'close' | 'similar') => {
    if (pending) return;
    lastThen.current = then;
    setMissingRate(null);
```

4. Найдите:

```tsx
      if (op && e instanceof ApiError && e.status === 409) {
```

   замените на:

```tsx
      if (e instanceof ApiError && e.code === 'RATE_UNAVAILABLE' && e.details?.currency && e.details.date) {
        setMissingRate({ message: e.message, currency: e.details.currency, date: e.details.date });
        setErrorFocus((x) => x + 1);
        return;
      }
      if (op && e instanceof ApiError && e.status === 409) {
```

5. Найдите:

```tsx
      {conflict && (
```

   замените на:

```tsx
      {missingRate && <RateFix missing={missingRate} companyId={p.company.id} pending={pending} onRetry={() => void submit(lastThen.current)} />}
      {conflict && (
```

Проверка, что исправления плана 6a на месте (повторный автофокус суммы, поля недоступны во время запроса, шаблоны разделения не блокируют форму):

```bash
node -e "const s=require('fs').readFileSync('src/client/components/operation/OperationForm.tsx','utf8'); const need=['refocusSignal={refocusAmount}','<fieldset disabled={pending}','presets: presets.data ?? []']; const miss=need.filter((x)=>!s.includes(x)); if (miss.length) { console.error('пропали исправления плана 6a: '+miss.join(', ')); process.exit(1); }"
```


- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/rate-unavailable.test.ts tests/server/rates-api.test.ts tests/server/rates.test.ts tests/server/operations-create.test.ts`
Expected: PASS.

Run: `npx playwright test e2e/operation-form.spec.ts`
Expected: PASS (7 тестов).

- [ ] **Step 5: Full check and commit**

Run: `npm test`, `npm run typecheck` и `npm run test:e2e` — зелёные.

```bash
git add src/server/errors.ts src/server/modules/rates/service.ts src/server/modules/rates/routes.ts tests/server/rate-unavailable.test.ts src/client/lib/api.ts src/client/components/operation/RateFix.tsx src/client/components/operation/OperationForm.tsx e2e/operation-form.spec.ts
git commit -m "feat: «Указать курс на дату» прямо в форме операции при RATE_UNAVAILABLE

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Файлы операции — загрузка после создания, скачивание, ошибки, удаление

**Files:**
- Create: `src/client/lib/attachments.ts`, `src/client/components/operation/AttachmentsField.tsx`, `tests/client/attachments.test.ts`
- Modify: `src/client/lib/api.ts`, `src/client/components/operation/OperationForm.tsx`, `e2e/operation-edit.spec.ts`, `README.md`

**Interfaces:**
- Consumes: API вложений плана 4b; `ConfirmDelete`; `api`, `ApiError`, `queryClient`; задачи 1–3.
- Produces:
  - `api(path, { method, body?, file?: { data: Blob; name: string } })` — с `file` тело уходит байтами (`application/octet-stream`, `X-File-Name`);
  - `attachments.ts`: `interface Attachment`, `ATTACHMENT_MAX_BYTES`, `ATTACHMENT_ACCEPT`, `attachmentSizeError(size)`, `formatFileSize(bytes)`, `uploadErrorText(e)`, `useAttachments(companyId, operationId | null)` (ключ `['attachments', cid, opId]`), `attachmentUrl(companyId, id)`, `uploadAttachment(companyId, operationId, file)`, `removeAttachment(companyId, operationId, id)`;
  - `AttachmentsField({ companyId, operationId, pending, onPendingChange })` — группа «Файлы», поле «Добавить файл», ссылки на файлы, кнопки «Удалить файл «…»» и «Убрать файл «…»».

- [ ] **Step 1: Write the failing tests**

`tests/client/attachments.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/client/lib/api';
import { ATTACHMENT_MAX_BYTES, attachmentSizeError, attachmentUrl, formatFileSize, uploadErrorText } from '../../src/client/lib/attachments';

describe('вложения в форме операции', () => {
  it('размер проверяется до отправки: пустой и больше 10 МБ (§8)', () => {
    expect(attachmentSizeError(0)).toBe('Файл пустой');
    expect(attachmentSizeError(1)).toBeNull();
    expect(attachmentSizeError(ATTACHMENT_MAX_BYTES)).toBeNull();
    expect(attachmentSizeError(ATTACHMENT_MAX_BYTES + 1)).toBe('Файл больше 10 МБ');
  });

  it('размер файла по-русски, ссылка скачивания', () => {
    expect(formatFileSize(512)).toBe('512 Б');
    expect(formatFileSize(12 * 1024 + 300)).toBe('12 КБ');
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1,5 МБ');
    expect(attachmentUrl(3, 7)).toBe('/api/v1/companies/3/attachments/7');
  });

  it('ошибка загрузки: поле file или name, иначе сообщение сервера', () => {
    expect(uploadErrorText(new ApiError(400, 'VALIDATION', 'Проверьте файл', { file: 'Допустимые файлы: PNG' }))).toBe('Допустимые файлы: PNG');
    expect(uploadErrorText(new ApiError(400, 'VALIDATION', 'Проверьте файл', { name: 'Имя файла: от 1 до 200 символов' }))).toBe('Имя файла: от 1 до 200 символов');
    expect(uploadErrorText(new ApiError(413, 'TOO_LARGE', 'Файл больше 10 МБ'))).toBe('Файл больше 10 МБ');
    expect(uploadErrorText(new Error('x'))).toBe('Ошибка сервера');
  });
});
```

`e2e/operation-edit.spec.ts` — в конец файла:

```ts
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const HTML = Buffer.from('<html><script>alert(1)</script></html>');

test('файлы: выбранный до сохранения загружается после создания; скачивание, ошибки типа и размера, удаление', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Файлы ${Date.now()}`);
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await page.reload();

  // новая операция: файл ждёт сохранения
  await page.getByRole('banner').getByRole('button', { name: 'Расход', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Новая операция' });
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('100');
  await dialog.getByRole('button', { name: 'Проект, теги, комментарий, файл' }).click();
  await dialog.getByLabel('Комментарий').fill('с чеком');
  await dialog.getByLabel('Добавить файл').setInputFiles({ name: 'чек.png', mimeType: 'image/png', buffer: PNG });
  const files = dialog.getByRole('group', { name: 'Файлы' });
  await expect(files).toContainText('чек.png');
  await expect(files).toContainText('загрузится после сохранения');
  // больше 10 МБ — отказ до отправки
  await dialog.getByLabel('Добавить файл').setInputFiles({ name: 'большой.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
  await expect(files.getByRole('alert')).toContainText('«большой.pdf»: Файл больше 10 МБ');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).toBeHidden();

  // в правке: блок раскрыт (есть комментарий), файл в списке и скачивается как файл
  await rows(page).filter({ hasText: 'с чеком' }).getByText('с чеком').click();
  dialog = editForm(page);
  const link = dialog.getByRole('link', { name: 'чек.png' });
  await expect(link).toBeVisible();
  const download = page.waitForEvent('download');
  await link.click();
  expect((await download).suggestedFilename()).toBe('чек.png');

  // HTML под видом картинки сервер не принимает — ошибка у поля
  await dialog.getByLabel('Добавить файл').setInputFiles({ name: 'вирус.png', mimeType: 'image/png', buffer: HTML });
  await expect(dialog.getByRole('group', { name: 'Файлы' }).getByRole('alert')).toContainText('«вирус.png»: Допустимые файлы: PNG, JPG, WEBP, HEIC, PDF, XLSX, CSV');
  // загрузка в существующую операцию — сразу
  await dialog.getByLabel('Добавить файл').setInputFiles({ name: 'выписка.csv', mimeType: 'text/csv', buffer: Buffer.from('a;b\n1;2\n') });
  await expect(dialog.getByRole('link', { name: 'выписка.csv' })).toBeVisible();

  // мягкое удаление с подтверждением
  await dialog.getByRole('button', { name: 'Удалить файл «чек.png»' }).click();
  await dialog.getByRole('button', { name: 'Да, удалить' }).click();
  await expect(dialog.getByRole('link', { name: 'чек.png' })).toHaveCount(0);
  await expect(dialog.getByRole('link', { name: 'выписка.csv' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('файл, который сервер не принял после создания: операция сохранена, форма переходит к её правке', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Файл после ${Date.now()}`);
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await page.reload();

  await page.getByRole('banner').getByRole('button', { name: 'Доход', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Новая операция' });
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).fill('50');
  await dialog.getByRole('button', { name: 'Проект, теги, комментарий, файл' }).click();
  await dialog.getByLabel('Добавить файл').setInputFiles({ name: 'плохой.png', mimeType: 'image/png', buffer: HTML });
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  const edit = editForm(page);
  await expect(edit).toBeVisible();
  await expect(edit.getByRole('alert')).toContainText('Операция сохранена, но не загружено: «плохой.png»: Допустимые файлы');
  await expect(rows(page)).toHaveCount(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/client/attachments.test.ts`
Expected: FAIL — модуля `attachments` нет.

- [ ] **Step 3: Implement**

`src/client/lib/api.ts` — правки:

1. Найдите:

```ts
  opts: { method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown } = {},
): Promise<T> {
```

   замените на:

```ts
  opts: {
    method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    body?: unknown;
    /** Файл вместо JSON: байты телом `application/octet-stream`, имя — в `X-File-Name` (вложения, план 4b). */
    file?: { data: Blob; name: string };
  } = {},
): Promise<T> {
```

2. Найдите:

```ts
        'X-Requested-With': 'fetch',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
```

   замените на:

```ts
        'X-Requested-With': 'fetch',
        ...(opts.file
          ? { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(opts.file.name) }
          : opts.body !== undefined
            ? { 'Content-Type': 'application/json' }
            : {}),
      },
      body: opts.file ? opts.file.data : opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
```

`src/client/lib/attachments.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from './api';
import { queryClient } from './query';

/** Вложение операции (`GET …/operations/:id/attachments`, план 4b). */
export interface Attachment {
  id: number;
  companyId: number;
  operationId: number;
  originalName: string;
  storedName: string;
  mime: string;
  size: number;
  createdAt: string;
  deletedAt: string | null;
}

/** §8: не больше 10 МБ — проверяется до отправки, чтобы не гнать лишние байты. Тип проверяет сервер по содержимому. */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
/** Подсказка выбора файла (§8): png, jpg, webp, heic, pdf, xlsx, csv. */
export const ATTACHMENT_ACCEPT = '.png,.jpg,.jpeg,.webp,.heic,.heif,.pdf,.xlsx,.csv';

/** Ошибка размера до загрузки; null — размер подходит. */
export function attachmentSizeError(size: number): string | null {
  if (size === 0) return 'Файл пустой';
  if (size > ATTACHMENT_MAX_BYTES) return 'Файл больше 10 МБ';
  return null;
}

/** «512 Б», «12 КБ», «1,5 МБ». */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(Math.round((bytes / 1024 / 1024) * 10) / 10).toString().replace('.', ',')} МБ`;
}

/** Текст ошибки загрузки: тип файла и пустой файл — в `fields`, остальное — в сообщении. */
export function uploadErrorText(e: unknown): string {
  if (!(e instanceof ApiError)) return 'Ошибка сервера';
  return e.fields?.file ?? e.fields?.name ?? e.message;
}

/** Вложения операции; null — операции ещё нет (новая). */
export function useAttachments(companyId: number, operationId: number | null) {
  return useQuery<Attachment[], ApiError>({
    queryKey: ['attachments', companyId, operationId],
    queryFn: async () => (await api<{ attachments: Attachment[] }>(`/companies/${companyId}/operations/${operationId}/attachments`)).attachments,
    enabled: operationId !== null,
  });
}

/** Ссылка скачивания: GET без побочных эффектов, ответ всегда «как файл» (план 4b). */
export function attachmentUrl(companyId: number, id: number): string {
  return `/api/v1/companies/${companyId}/attachments/${id}`;
}

/** После изменения вложений: список вложений операции и журнал (число вложений у операции). */
async function invalidateAttachments(companyId: number, operationId: number): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['attachments', companyId, operationId] }),
    queryClient.invalidateQueries({ queryKey: ['journal', companyId] }),
  ]);
}

/** Загрузить файл к операции (тело — байты, имя — в X-File-Name). Ошибка сервера — `ApiError` (у типа файла — `fields.file`). */
export async function uploadAttachment(companyId: number, operationId: number, file: File): Promise<Attachment> {
  try {
    const path = `/companies/${companyId}/operations/${operationId}/attachments`;
    return (await api<{ attachment: Attachment }>(path, { method: 'POST', file: { data: file, name: file.name } })).attachment;
  } finally {
    void invalidateAttachments(companyId, operationId);
  }
}

/** Мягкое удаление вложения (§4.5): файл на диске остаётся. */
export async function removeAttachment(companyId: number, operationId: number, id: number): Promise<void> {
  try {
    await api(`/companies/${companyId}/attachments/${id}`, { method: 'DELETE' });
  } finally {
    void invalidateAttachments(companyId, operationId);
  }
}
```

`src/client/components/operation/AttachmentsField.tsx`:

```tsx
import { useId, useState } from 'react';
import {
  ATTACHMENT_ACCEPT,
  attachmentSizeError,
  attachmentUrl,
  formatFileSize,
  removeAttachment,
  uploadAttachment,
  uploadErrorText,
  useAttachments,
} from '../../lib/attachments';
import { ConfirmDelete } from '../ConfirmDelete';

/**
 * Файлы операции (§7, §8; API — план 4b). У новой операции выбранные файлы ждут сохранения и загружаются сразу
 * после создания; у существующей файл загружается сразу после выбора. Список: скачивание и мягкое удаление.
 */
export function AttachmentsField(props: {
  companyId: number;
  /** null — операции ещё нет: файлы копятся в pending. */
  operationId: number | null;
  pending: File[];
  onPendingChange: (files: File[]) => void;
}) {
  const inputId = useId();
  const attachments = useAttachments(props.companyId, props.operationId);
  const [errors, setErrors] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);

  const choose = async (list: FileList | null) => {
    const files = [...(list ?? [])];
    const problems: string[] = [];
    const ok = files.filter((f) => {
      const error = attachmentSizeError(f.size);
      if (error) problems.push(`«${f.name}»: ${error}`);
      return !error;
    });
    if (props.operationId === null) {
      props.onPendingChange([...props.pending, ...ok]);
    } else {
      setUploading(true);
      for (const f of ok) {
        try {
          await uploadAttachment(props.companyId, props.operationId, f);
        } catch (e) {
          problems.push(`«${f.name}»: ${uploadErrorText(e)}`);
        }
      }
      setUploading(false);
    }
    setErrors(problems);
  };

  const remove = async (id: number) => {
    if (props.operationId === null) return;
    setRemoving(true);
    try {
      await removeAttachment(props.companyId, props.operationId, id);
      setConfirmId(null);
    } catch (e) {
      setErrors([uploadErrorText(e)]);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div role="group" aria-label="Файлы" className="md:col-span-2">
      <span className="mb-1 block text-sm text-muted">Файлы</span>
      <ul className="mb-2 grid gap-1 text-sm">
        {(attachments.data ?? []).map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-2">
            {confirmId === a.id ? (
              <ConfirmDelete what={`файл «${a.originalName}»`} pending={removing} onConfirm={() => void remove(a.id)} onCancel={() => setConfirmId(null)} />
            ) : (
              <>
                <a href={attachmentUrl(props.companyId, a.id)} download className="font-medium text-income underline">
                  {a.originalName}
                </a>
                <span className="text-muted">{formatFileSize(a.size)}</span>
                <button type="button" aria-label={`Удалить файл «${a.originalName}»`} onClick={() => setConfirmId(a.id)} className="text-muted hover:text-expense">
                  ×
                </button>
              </>
            )}
          </li>
        ))}
        {props.pending.map((f, i) => (
          <li key={`${f.name}-${i}`} className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{f.name}</span>
            <span className="text-muted">{formatFileSize(f.size)} · загрузится после сохранения</span>
            <button
              type="button"
              aria-label={`Убрать файл «${f.name}»`}
              onClick={() => props.onPendingChange(props.pending.filter((_, j) => j !== i))}
              className="text-muted hover:text-expense"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      {/* поле выбора скрыто, видна подпись-кнопка; фокус с клавиатуры подсвечивает подпись */}
      <input
        id={inputId}
        type="file"
        multiple
        accept={ATTACHMENT_ACCEPT}
        aria-label="Добавить файл"
        disabled={uploading}
        onChange={(e) => {
          void choose(e.target.files);
          e.target.value = '';
        }}
        className="peer sr-only"
      />
      <label htmlFor={inputId} className="inline-block cursor-pointer rounded-lg bg-field px-3 py-1.5 text-sm font-medium peer-focus-visible:ring-2 peer-focus-visible:ring-focus">
        {uploading ? 'Загрузка…' : '+ Файл'}
      </label>
      <span className="ml-2 text-xs text-muted">PNG, JPG, WEBP, HEIC, PDF, XLSX, CSV до 10 МБ</span>
      {errors.length > 0 && (
        <ul role="alert" className="mt-1 text-sm text-expense">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

`src/client/components/operation/OperationForm.tsx` — правки:

1. Найдите:

```tsx
import { AmountField } from './AmountField';
```

   замените на:

```tsx
import { uploadAttachment, uploadErrorText } from '../../lib/attachments';
import { AmountField } from './AmountField';
import { AttachmentsField } from './AttachmentsField';
```

2. Найдите:

```tsx
  const [refocusAmount, setRefocusAmount] = useState(0);
```

   замените на:

```tsx
  const [refocusAmount, setRefocusAmount] = useState(0);
  /** Файлы, выбранные до создания операции: загружаются сразу после него (§7). */
  const [files, setFiles] = useState<File[]>([]);
```

3. Найдите:

```tsx
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
```

   замените на:

```tsx
  const dirty = files.length > 0 || JSON.stringify(draft) !== JSON.stringify(initial);
```

4. Найдите:

```tsx
      } else {
        await api(`/companies/${p.company.id}/operations`, { method: 'POST', body: r.body });
      }
```

   замените на:

```tsx
      } else {
        const created = (await api<{ operation: OperationRecord }>(`/companies/${p.company.id}/operations`, { method: 'POST', body: r.body })).operation;
        const failed: string[] = [];
        for (const f of files) {
          try {
            await uploadAttachment(p.company.id, created.id, f);
          } catch (e) {
            failed.push(`«${f.name}»: ${uploadErrorText(e)}`);
          }
        }
        setFiles([]);
        if (failed.length > 0) {
          // операция уже есть: форма переходит к её правке, чтобы файл можно было выбрать заново
          void invalidateOperations(p.company.id);
          const saved = draftFromOperation(created, accounts, p.timeZone);
          setOp(created);
          p.onEditingChange(true);
          setDraft(saved);
          setInitial(saved);
          setMore(true);
          setFormError(`Операция сохранена, но не загружено: ${failed.join('; ')}`);
          setErrorFocus((n) => n + 1);
          return;
        }
      }
```

5. Найдите:

```tsx
    setOp(null);
    p.onEditingChange(false);
    setDraft(copy);
```

   замените на:

```tsx
    setOp(null);
    p.onEditingChange(false);
    setFiles([]);
    setDraft(copy);
```

6. Найдите:

```tsx
<span aria-hidden="true">{more ? '▾' : '▸'}</span> Проект, теги, комментарий
```

   замените на:

```tsx
<span aria-hidden="true">{more ? '▾' : '▸'}</span> Проект, теги, комментарий, файл
```

7. Найдите:

```tsx
                <textarea {...c} rows={2} maxLength={COMMENT_MAX} value={draft.comment} onChange={(e) => set({ comment: e.target.value }, 'comment')} className={inputClass} />
              )}
            </Field>
```

   замените на:

```tsx
                <textarea {...c} rows={2} maxLength={COMMENT_MAX} value={draft.comment} onChange={(e) => set({ comment: e.target.value }, 'comment')} className={inputClass} />
              )}
            </Field>
            <AttachmentsField companyId={p.company.id} operationId={op?.id ?? null} pending={files} onPendingChange={setFiles} />
```

Проверка, что исправления плана 6a на месте (повторный автофокус суммы, поля недоступны во время запроса, шаблоны разделения не блокируют форму):

```bash
node -e "const s=require('fs').readFileSync('src/client/components/operation/OperationForm.tsx','utf8'); const need=['refocusSignal={refocusAmount}','<fieldset disabled={pending}','presets: presets.data ?? []']; const miss=need.filter((x)=>!s.includes(x)); if (miss.length) { console.error('пропали исправления плана 6a: '+miss.join(', ')); process.exit(1); }"
```


`README.md` — правки:

1. Найдите:

```md
Сделаны шаги 1–5 этапа 1 (§11 спецификации):
```

   замените на:

```md
Сделаны шаги 1–6 этапа 1 (§11 спецификации):
```

2. Найдите:

```md
  - вложения к операциям (png, jpg, webp, heic, pdf, xlsx, csv до 10 МБ) — пока только через API;
```

   замените на:

```md
  - вложения к операциям (png, jpg, webp, heic, pdf, xlsx, csv до 10 МБ);
```

3. Найдите:

```md
  - контрагента, статью, проект и тег можно создать прямо из формы; «Сохранить и создать похожий».

Пока нет (следующие шаги): правка операции из журнала и вложения в форме, отчёты, мобильная версия и PWA.
```

   замените на:

```md
  - контрагента, статью, проект и тег можно создать прямо из формы; «Сохранить и создать похожий»;
  - клик по строке журнала (или Enter на дате) открывает операцию: правка, «Дублировать», «Удалить»; у операции на архивном счёте сумма, дата и счета заблокированы;
  - если операцию изменил другой пользователь — «Загрузить актуальную»; если нет курса на дату — «Указать курс» прямо в форме;
  - файлы к операции: загрузка, скачивание, удаление.

Пока нет (следующие шаги): отчёты, мобильная версия и PWA.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/client/attachments.test.ts`
Expected: PASS.

Run: `npx playwright test e2e/operation-edit.spec.ts e2e/operation-form.spec.ts`
Expected: PASS (8 + 7 тестов).

- [ ] **Step 5: Full check and commit**

Run: `npm test`, `npm run typecheck` и `npm run test:e2e` — зелёные (два прогона e2e подряд).

```bash
git add src/client/lib/api.ts src/client/lib/attachments.ts src/client/components/operation/AttachmentsField.tsx src/client/components/operation/OperationForm.tsx tests/client/attachments.test.ts e2e/operation-edit.spec.ts README.md
git commit -m "feat: файлы в форме операции — загрузка после создания, скачивание, удаление

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
