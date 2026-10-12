# Этап 1.5, план 1.5-6: «Изменить в перевод» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** последний план этапа 1.5 (§13 спецификации): у существующего дохода или расхода — строка 4 «Изменить в перевод».
- **Сервер (§10.1):** `PATCH …/operations/:id` принимает `type: 'transfer'`; проверки; пересчёт; история с `before.type`/`after.type`.
- **История:** «Тип: Расход → Перевод».
- **Клиент:**
  - `convertToTransferDraft` и список того, что будет убрано;
  - подтверждение `ConfirmDialog` «Отменить | Изменить»;
  - перестройка формы на месте в «Перевод»;
  - у дохода между валютами прежняя сумма становится «Суммой зачисления» (§6.8).
- **Проверки:** e2e расхода и дохода.
- **Сверка и README:** `shots:ux` и итог этапа в README.

**Предусловие:** выполнен план [1.5-5b](2026-10-12-stage1_5-plan5b-phone-journal-forms.md), ветка на 7dea2dc или позже. Ожидаемо на старте:
- `npm test` — 816 пройдено и 1 пропущен;
- `npm run typecheck` — без ошибок;
- `npm run test:e2e` — 136 из 136;
- `shots:ux` — 49 из 49.

**Architecture:**
- **Сервер.** `operationUpdateSchema` получает необязательное `type: z.literal('transfer')`. В `OperationsService.update` смена типа проходит через тот же `check()` (инварианты 3–7). Добавлено:
  - запрет на архивном счёте со своим текстом;
  - правило «у перевода нет даты сделки»;
  - обязательный пересчёт `rate`/`baseAmount`;
  - `type` в `UPDATE`.

  Запись и история — в одном `mutate(...)`, как сейчас. Миграций нет.
- **История.** `diffRows(diff, entity)` у операции пишет тип по-русски. `historyItems` выводит строку «Тип: Расход → Перевод. Изменено: …».
- **Клиент, библиотека.** Чистые функции в `lib/operation-edit.ts` (тесты в node без DOM):
  - `convertToTransferDraft(draft, names)` — черновик перевода, список потерь, `carried`;
  - `convertQuestion(losses)` — текст подтверждения;
  - `pickConvertedFrom(draft, accountId, accounts, carried)` — выбор «Со счёта» у бывшего дохода;
  - `convertBlockedHint(locked, accounts, accountId)` — причина недоступности строки;
  - `patchBody` отправляет `type: 'transfer'`.
- **Клиент, форма.** `OperationForm` показывает заголовок по типу черновика (`onTypeChange`). Строка 4 — `ActionRow` со значком ⇄. Подтверждение — третий `ConfirmDialog` формы. После перестройки фокус ставится на пустой счёт перевода через `data-field`.

**Tech Stack:** как в этапе 1 (Node 24, TypeScript, Fastify 5, zod 4, Drizzle + better-sqlite3, React 19, TanStack Query 5, Tailwind 4, Vitest, Playwright). Новых пакетов нет.

**Spec:** [docs/superpowers/specs/2026-10-10-stage1_5-finmap-ux-design.md](../specs/2026-10-10-stage1_5-finmap-ux-design.md):
- основное: §6.7 (строка 4), §6.8, §10.1, §2.4 (`ConfirmDialog`), §11 (`ConfirmDialog`, `ActionRow`);
- проверки и сверка: §12.1 (новые e2e), §12.2 (`operation-edit`), §12.3;
- §13: строка 1.5-6 и блок «Решения планирования плана 1.5-6».

Снимок Finmap: `docs/research/screens/v2/05-op-edit.png` — строка «Изменить в перевод» со значком ⇄ между «Добавить проект, тег, комментарий, файл» и «Дублировать платеж».

**Ветка:** `stage1/plan1-skeleton`. В `main` не сливаем.

## Решения, принятые при планировании

Записаны в спецификацию (§13, блок «Решения планирования плана 1.5-6», №1–№7) тем же коммитом, что и план.

1. **Порядок проверок на сервере (§10.1).**
   - Сначала 409.
   - Затем архивный счёт при смене типа: 422 `ARCHIVED_REFERENCE` «Операция затрагивает счёт «…» в архиве — тип менять нельзя». Проверка идёт раньше общей проверки суммы, даты и счетов.
   - Затем дата сделки: 400 `VALIDATION` `{ accrualDate: 'У перевода нет даты сделки' }`, только при смене типа.
   - Затем `check()`.

   Остальное:
   - `type: 'transfer'` у перевода — без изменений.
   - Смена типа всегда пересчитывает курс и сумму в базовой валюте.
   - Строки, которых нет в запросе, остаются прежними, поэтому оставшаяся категория даёт `INVARIANT_3`.
2. **История:** «Изменён перевод», затем «Тип: Расход → Перевод. Изменено: Счёт зачисления, Контрагент, Категория и проект». Страница «История действий» называет поля операции по-русски.
3. **`convertToTransferDraft(draft, names)`** вместо `(draft, op)` из §10.1.
   - Работает с текущим черновиком формы: несохранённые правки не теряются.
   - Список потерь — категория, контрагент, разбиение («разбиение на 2 строки»), дата сделки, с кавычками «».
   - Если терять нечего, подтверждения нет.
   - Проект остаётся, если у всех строк он один.
4. **Доход между валютами (§6.8).**
   - Прежняя сумма сразу становится «Суммой зачисления».
   - «Со счёта» в другой валюте очищает несменённую сумму списания; в той же валюте пустая сумма возвращается к прежней (`pickConvertedFrom`).
5. **Строка 4 недоступна с причиной**: счёт в архиве; нет другого активного счёта. В архивной компании строки нет.
6. **Фокус и заголовок.**
   - Esc и «Отменить» в подтверждении возвращают фокус на строку.
   - После перестройки фокус — на пустой счёт перевода, на устройстве с пальцем — на «×».
   - Заголовок окна следует за типом черновика; «Загрузить актуальную» возвращает прежний тип.
7. **Сверка:** `c05-op-edit` теперь со строкой 4; новые `c05c-convert-confirm` и `c05d-converted-transfer` — без пары Finmap. README «Что уже работает» — итог этапа 1.5.

## Global Constraints

- **Принцип (§1):** «расположение и приёмы как в Finmap, внешний вид свой; где наше лучше — оставляем».
- **Мёртвых кнопок нет.** Строка 4 есть только у правки дохода и расхода. Когда действие невозможно, строка недоступна, а причина видна (`aria-disabled` и `aria-describedby`, §11 `ActionRow`).
- **§6.8 — нажатие на строку.** Если что-то будет потеряно, сначала `ConfirmDialog` «Изменить в перевод?»: текст перечисляет потери, кнопки «Отменить | Изменить».
- **§6.8 — после подтверждения** форма на месте перестраивается в раскладку перевода (заголовок «Перевод»):
  - **расход** на счёте A → «Со счёта» = A, «На счёт» пусто;
  - **доход** на счёте A → «На счёт» = A, «Со счёта» пусто. Если валюты окажутся разными, прежняя сумма станет «Суммой зачисления», а «Сумму» списания нужно ввести;
  - **проект** сохраняется, только если у всех строк он один и тот же;
  - теги, комментарий, файлы, дата и время сохраняются.
- **§6.8 — сохранение** только по «Сохранить изменения». «×» с изменениями задаёт обычный вопрос.
- **§10.1 — сервер:**
  - другие значения `type` — 400 `VALIDATION`, поле `type`;
  - явные поля обязательны, сервер ничего не подставляет сам;
  - архив — 422 `ARCHIVED_REFERENCE`;
  - `rate` и `baseAmount` пересчитываются всегда, по стороне списания;
  - id операции, вложения и история сохраняются;
  - история — запись `update`, в `diff` есть смена `type`.
- **Ошибки и запись:**
  - ошибки — `AppError(status, code, message, fields?)`, ответ `{error:{code,message,fields?}}`;
  - запись и её история — в одном `mutate(db, audit, (tx, record) => …)`;
  - миграций БД нет (§10).
- **Окна (§2.4, §11):** `ConfirmDialog` — вложенный `<dialog role="alertdialog">`, кнопки «Отменить | <действие>», фокус по умолчанию на «Отменить». Esc закрывает только подтверждение.
- **Время и деньги:**
  - «сегодня» — в `APP_TIMEZONE` (`Asia/Almaty`);
  - деньги — целые минимальные единицы;
  - на экране — `formatMoney(…, MONEY_SCREEN | MONEY_SCREEN_BEFORE)`;
  - минус — U+2212;
  - текст цвета расхода — только `text-expense-strong`.
- **Терминология:** «Категория», никогда «Статья» (`tests/shared/terminology.test.ts`).
- **Без новых npm-пакетов.**
- **Невидимые символы** (U+2212, U+202F, U+00A0, U+200B) в коде пишутся только экранированием `−` и т. п.
- **Концы строк:** правки «найдите → замените» делайте инструментом правки файлов. Если найденный текст разошёлся с планом пробелами, копируйте его из файла.
- **E2E:**
  - порт 41731 (`E2E_PORT`), APP_TIMEZONE e2e-сервера — `Asia/Almaty`;
  - один пользователь `admin`/`e2e-password-1` и одна база на прогон, поэтому имена уникальны;
  - `name:` в Playwright — подстрока без учёта регистра; для точного совпадения — `exact: true`;
  - данные создаются через `page.request` с `origin` и `x-requested-with: fetch`;
  - общие настройки пользователя восстанавливаются в `try/finally`;
  - без фиксированных пауз;
  - `journal-actions.spec.ts:555` — известный нестабильный тест.
- **Безопасность среды (обязательно):**
  - никогда не запускайте `npm start`, `npm run stop`, `npm run setup`, `npm run service:install`, `npm run service:uninstall`, `schtasks` и `icacls` — ни в каком виде. На порту 3457 работает живое приложение пользователя, на порту 3460 — демо-экземпляр; их не трогайте;
  - e2e идут на порту 41731 со своей временной базой; `npm run shots:ux` — на порту 41741 со своей временной папкой;
  - shell-команды не содержат подстроку «.env».
- **Завершение задачи:**
  - зелёные `npm test` и `npm run typecheck`;
  - задачам с интерфейсом — ещё `npm run test:e2e`; если задача меняет e2e — дважды подряд;
  - коммит с трейлером `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`;
  - в коммит попадает каждый новый файл задачи.

## Review Focus

1. **Доход на валютном счёте, «Со счёта» в тенге.** Сумма списания пустая, прежняя сумма — в «Сумме зачисления», курс считается из двух сумм. Если вернуть счёт в валюте «На счёт», пустая сумма снова прежняя. Сумму, набранную руками, выбор счёта не трогает. Тесты: задача 3 (unit `pickConvertedFrom`, PATCH дохода между валютами), задача 5 (e2e).
2. **Разбитая операция.** В подтверждении — «разбиение на N строки». Проект остаётся, только если он один у всех строк. В PATCH уходит одна строка с проектом или `[]`. Тесты: задача 3 (unit).
3. **Операция на архивном счёте или нет второго активного счёта.** Строка недоступна с причиной, нажатие ничего не делает. Сервер отвечает `ARCHIVED_REFERENCE` «… — тип менять нельзя». Тесты: задача 1 (сервер), задача 3 (unit `convertBlockedHint`), задача 4 (e2e на архивном счёте).
4. **Сохранение после чужой правки (409).** «Загрузить актуальную» возвращает прежний тип, заголовок «Расход» и строку 4; операция не изменена. Тесты: задача 1 (409 при смене типа), задача 5 (e2e).
5. **Что сохраняется и что пересчитывается.**
   - Сохраняются вложения, теги, комментарий, id и история.
   - У обоих счетов пересчитаны балансы, курс и база — по стороне списания.
   - В истории — «Тип: Расход → Перевод».

   Тесты: задача 1 (сервер: вложения, балансы, `rate`, история), задача 2 (unit истории), задача 4 (e2e: баланс в «Моих счетах» и панель истории).

---

## Карта файлов

```
src/shared/schemas/operations.ts                      # operationUpdateSchema.type
src/server/modules/operations/service.ts              # OperationPatch.type, update(): смена типа
src/client/lib/audit-format.ts                        # OPERATION_TYPE_LABELS, diffRows(diff, entity)
src/client/lib/history.ts                             # «Тип: Расход → Перевод. Изменено: …»
src/client/pages/settings/AuditSettings.tsx           # поля операции по-русски
src/client/lib/operation-edit.ts                      # convertToTransferDraft, convertQuestion, pickConvertedFrom, convertBlockedHint, patchBody.type
src/client/components/icons.tsx                       # TransferIcon
src/client/components/operation/OperationForm.tsx     # строка 4, подтверждение, перестройка, заголовок, фокус, сумма зачисления
scripts/ux-shots.ts                                   # c05 со строкой 4, c05c, c05d
README.md                                             # «Что уже работает» — итог этапа 1.5
tests/server/operations-update.test.ts
tests/client/audit-format.test.ts, tests/client/history.test.ts, tests/client/operation-edit.test.ts
e2e/operation-edit.spec.ts, e2e/mobile.spec.ts
```

---

### Task 1: Сервер — `PATCH` с `type: 'transfer'` (§10.1)

**Files:**
- Modify: `src/shared/schemas/operations.ts`, `src/server/modules/operations/service.ts`
- Test: `tests/server/operations-update.test.ts`

**Interfaces:**
- Consumes: `opsWorld()` (`tests/helpers/ops.ts`), `ORIGIN_HEADERS` (`tests/helpers/test-app.ts`), `check()`, `archivedAccountOf()`, `changedFields()`, `mutate()` — всё уже есть.
- Produces:
  - `operationUpdateSchema` — поле `type?: 'transfer'`;
  - `interface OperationPatch { …; type?: 'transfer' }` (сервер);
  - ответ `PATCH` — операция с `type: 'transfer'`;
  - запись истории `update` с `diff.before.type`/`diff.after.type`.

- [ ] **Step 1: Write the failing tests**

В `tests/server/operations-update.test.ts` замените строку импорта

```ts
import { opsWorld, type OpsWorld } from '../helpers/ops';
```

на

```ts
import { opsWorld, type OpsWorld } from '../helpers/ops';
import { ORIGIN_HEADERS } from '../helpers/test-app';
```

и допишите в конец файла:

```ts
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
/** Отказ с текстами у полей: статус, код и поля ответа. */
const refused = (res: LightMyRequestResponse, status: number, code: string, fields: Record<string, string>) => {
  expect(res.statusCode, res.body).toBe(status);
  expect(res.json().error).toMatchObject({ code, fields });
};

describe('«Изменить в перевод»: PATCH с type: transfer (§10.1 этапа 1.5)', () => {
  const addKaspi = async () => (await w.post(accountsUrl(), { name: 'Kaspi', currency: 'KZT', openedAt: '2026-10-01' })).account.id as number;
  const balances = async () => {
    const list = (await w.h.req('GET', `/api/v1/companies/${w.cid}/balances`)).json().accounts as { accountId: number; balance: number }[];
    return Object.fromEntries(list.map((a) => [a.accountId, a.balance]));
  };

  it('расход → перевод в одной валюте: счёт зачисления и сумма зачисления; проект строки, теги, комментарий, id и вложения остаются; балансы обоих счетов (Review Focus 5)', async () => {
    w = await opsWorld();
    const kaspi = await addKaspi();
    const op = await create({
      type: 'expense',
      paidAt: '2026-10-05T10:00:00Z',
      accountId: w.kzt,
      amount: 5000,
      counterpartyId: w.counterparty,
      comment: 'в Kaspi',
      tagIds: [w.tag],
      lines: [{ categoryId: w.expense, projectId: w.project, amount: 5000 }],
    });
    const upload = await w.h.t.app.inject({
      method: 'POST',
      url: `${w.ops}/${op.id}/attachments`,
      headers: { ...ORIGIN_HEADERS, cookie: w.h.cookie, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('чек.png') },
      payload: PNG,
    });
    expect(upload.statusCode).toBe(201);
    expect(await balances()).toMatchObject({ [w.kzt]: -5000, [kaspi]: 0 });

    const res = await patch(op.id, { version: 1, type: 'transfer', toAccountId: kaspi, counterpartyId: null, lines: [{ categoryId: null, projectId: w.project, amount: 5000 }] });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().operation).toMatchObject({
      id: op.id,
      type: 'transfer',
      version: 2,
      accountId: w.kzt,
      amount: 5000,
      toAccountId: kaspi,
      toAmount: 5000,
      counterpartyId: null,
      comment: 'в Kaspi',
      tagIds: [w.tag],
      rate: '1',
      baseAmount: 5000,
      lines: [{ categoryId: null, projectId: w.project, amount: 5000, baseAmount: 5000 }],
    });
    expect((await w.h.req('GET', `${w.ops}/${op.id}/attachments`)).json().attachments).toHaveLength(1);
    expect(await balances()).toMatchObject({ [w.kzt]: -5000, [kaspi]: 5000 });
  });

  it('доход → перевод: прежний счёт — счёт зачисления; в одной валюте и между валютами; курс и база — по стороне списания', async () => {
    w = await opsWorld();
    const kaspi = await addKaspi();
    const same = await create({ type: 'income', paidAt: '2026-10-05T10:00:00Z', accountId: kaspi, amount: 7000, lines: [{ categoryId: w.income, amount: 7000 }] });
    const r1 = await patch(same.id, { version: 1, type: 'transfer', accountId: w.kzt, toAccountId: kaspi, lines: [] });
    expect(r1.statusCode, r1.body).toBe(200);
    expect(r1.json().operation).toMatchObject({ type: 'transfer', accountId: w.kzt, toAccountId: kaspi, amount: 7000, toAmount: 7000, lines: [] });

    const fx = await create({ type: 'income', paidAt: '2026-10-05T10:00:00Z', accountId: w.usd, amount: 100, lines: [{ categoryId: w.income, amount: 100 }] });
    expect(fx).toMatchObject({ rate: '475.12', baseAmount: 47512 });
    const r2 = await patch(fx.id, { version: 1, type: 'transfer', accountId: w.kzt, amount: 47512, toAccountId: w.usd, toAmount: 100, lines: [] });
    expect(r2.statusCode, r2.body).toBe(200);
    expect(r2.json().operation).toMatchObject({ type: 'transfer', accountId: w.kzt, amount: 47512, toAccountId: w.usd, toAmount: 100, rate: '1', baseAmount: 47512, lines: [] });
    expect(await balances()).toMatchObject({ [w.kzt]: -54512, [kaspi]: 7000, [w.usd]: 100 });
  });

  it('отказы: без счёта зачисления, с контрагентом, с категорией, с датой сделки, между валютами без суммы зачисления, тип не «Перевод» — операция не меняется', async () => {
    w = await opsWorld();
    const kaspi = await addKaspi();
    const op = await create({
      type: 'expense',
      paidAt: '2026-10-05T10:00:00Z',
      accrualDate: '2026-09-01',
      accountId: w.kzt,
      amount: 5000,
      counterpartyId: w.counterparty,
      lines: [{ categoryId: w.expense, amount: 5000 }],
    });
    const full: Record<string, unknown> = { version: 1, type: 'transfer', toAccountId: kaspi, counterpartyId: null, accrualDate: null, lines: [] };
    const without = (key: string) => Object.fromEntries(Object.entries(full).filter(([k]) => k !== key));
    refused(await patch(op.id, without('toAccountId')), 400, 'VALIDATION', { toAccountId: 'Выберите счёт зачисления' });
    refused(await patch(op.id, without('counterpartyId')), 400, 'VALIDATION', { counterpartyId: 'У перевода нет контрагента' });
    refused(await patch(op.id, without('lines')), 422, 'INVARIANT_3', { lines: 'У перевода нет категории' });
    refused(await patch(op.id, without('accrualDate')), 400, 'VALIDATION', { accrualDate: 'У перевода нет даты сделки' });
    refused(await patch(op.id, { ...full, type: 'income' }), 400, 'VALIDATION', { type: 'Тип можно сменить только на «Перевод»' });
    expect((await w.h.req('GET', `${w.ops}/${op.id}`)).json().operation).toMatchObject({ type: 'expense', version: 1, counterpartyId: w.counterparty, accrualDate: '2026-09-01' });
    expect(w.h.auditCount('operation', 'update')).toBe(0);

    const fx = await create({ type: 'income', paidAt: '2026-10-05T10:00:00Z', accountId: w.usd, amount: 100 });
    refused(await patch(fx.id, { version: 1, type: 'transfer', accountId: w.kzt, toAccountId: w.usd, lines: [] }), 400, 'VALIDATION', { toAmount: 'Укажите сумму зачисления' });
  });

  it('операция на архивном счёте: тип менять нельзя — ARCHIVED_REFERENCE со своим текстом (Review Focus 3)', async () => {
    w = await opsWorld();
    const safe = (await w.post(accountsUrl(), { name: 'Сейф', currency: 'KZT', openedAt: '2026-10-01' })).account.id;
    await create({ type: 'income', paidAt: '2026-10-02T10:00:00Z', accountId: safe, amount: 100 });
    const exp = await create({ type: 'expense', paidAt: '2026-10-03T10:00:00Z', accountId: safe, amount: 100 }); // баланс снова 0
    await w.post(`${accountsUrl()}/${safe}/archive`, {});
    expect(fail(await patch(exp.id, { version: 1, type: 'transfer', toAccountId: w.kzt, lines: [] }), 422, 'ARCHIVED_REFERENCE').message).toBe(
      'Операция затрагивает счёт «Сейф» в архиве — тип менять нельзя',
    );
  });

  it('версия: устаревшая — 409; уже перевод: type: transfer ничего не меняет; история — before.type / after.type (Review Focus 4)', async () => {
    w = await opsWorld();
    const kaspi = await addKaspi();
    const op = await create({ type: 'expense', paidAt: '2026-10-05T10:00:00Z', accountId: w.kzt, amount: 5000, counterpartyId: w.counterparty });
    expect((await patch(op.id, { version: 1, comment: 'раньше' })).statusCode).toBe(200);
    const body = { type: 'transfer', toAccountId: kaspi, counterpartyId: null, lines: [] };
    expect(fail(await patch(op.id, { version: 1, ...body }), 409, 'VERSION_CONFLICT').message).toBe('Операция изменена другим пользователем');
    expect((await patch(op.id, { version: 2, ...body })).statusCode).toBe(200);
    const same = await patch(op.id, { version: 3, type: 'transfer' });
    expect(same.json().operation).toMatchObject({ type: 'transfer', version: 3 });
    expect(w.h.auditCount('operation', 'update')).toBe(2);

    const [last] = (await w.h.req('GET', `/api/v1/companies/${w.cid}/audit?entity=operation&limit=20`)).json().entries as { action: string; diff: Record<string, unknown> }[];
    expect(last!.action).toBe('update');
    expect(last!.diff).toMatchObject({
      type: 'transfer',
      before: { type: 'expense', toAccountId: null, toAmount: null, counterpartyId: w.counterparty },
      after: { type: 'transfer', toAccountId: kaspi, toAmount: 5000, counterpartyId: null, lines: [] },
      recalculated: { rate: ['1', '1'], baseAmount: [5000, 5000] },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/operations-update.test.ts`
Expected: FAIL. Новые тесты, кроме части отказов, падают: `type` схема сейчас отбрасывает, операция остаётся расходом, а `PATCH` с `toAccountId` у расхода даёт «Счёт зачисления — только у перевода». Прежние тесты файла проходят.

- [ ] **Step 3: Schema**

В `src/shared/schemas/operations.ts` замените

```ts
export const operationUpdateSchema = z.object({
  /** Версия, которую видел клиент (оптимистичная блокировка). */
  version: z.number().int().min(1),
  paidAt: paidAt.optional(),
```

на

```ts
export const operationUpdateSchema = z.object({
  /** Версия, которую видел клиент (оптимистичная блокировка). */
  version: z.number().int().min(1),
  /** «Изменить в перевод» (§10.1 этапа 1.5): тип меняется только на перевод; у перевода `type: 'transfer'` ничего не меняет. */
  type: z.literal('transfer', { message: 'Тип можно сменить только на «Перевод»' }).optional(),
  paidAt: paidAt.optional(),
```

- [ ] **Step 4: Service**

В `src/server/modules/operations/service.ts`:

1. Замените

```ts
export interface OperationPatch extends Partial<Omit<OperationInput, 'type'>> {
  /** Версия, которую видел клиент. */
  version: number;
}
```

на

```ts
export interface OperationPatch extends Partial<Omit<OperationInput, 'type'>> {
  /** Версия, которую видел клиент. */
  version: number;
  /** «Изменить в перевод» (§10.1 этапа 1.5): у дохода и расхода — смена типа; у перевода ничего не меняет. */
  type?: 'transfer';
}
```

2. Замените

```ts
      const prev = draftOf(current);
      const next: OperationInput = { ...prev, lines: prev.lines, tagIds: prev.tagIds };
```

на

```ts
      const prev = draftOf(current);
      // «Изменить в перевод» (§10.1 этапа 1.5): схема пропускает только 'transfer', значит исходный тип — доход или расход.
      // Сервер ничего не подставляет сам: счёт зачисления, сброс контрагента, строки и дату сделки клиент присылает явно
      const typeChange = patch.type !== undefined && patch.type !== current.type;
      const next: OperationInput = { ...prev, lines: prev.lines, tagIds: prev.tagIds };
```

(цикл ниже уже переносит `type` из запроса в `next`, как любое поле).

3. Замените

```ts
      const locked = archivedAccountOf(current);
      if (locked && MONEY_FIELDS.some((f) => JSON.stringify(next[f] ?? null) !== JSON.stringify(prev[f] ?? null))) {
        throw archivedRef(`Операция затрагивает счёт «${locked.name}» в архиве — сумму, дату и счета менять нельзя`);
      }

      const c = check(companyId, next, prev);
      const changes = changedFields(prev, c.draft);
      if (!changes) return current;
      const recalc = MONEY_FIELDS.some((f) => f in changes.after);
```

на

```ts
      const locked = archivedAccountOf(current);
      if (locked && typeChange) throw archivedRef(`Операция затрагивает счёт «${locked.name}» в архиве — тип менять нельзя`);
      if (locked && MONEY_FIELDS.some((f) => JSON.stringify(next[f] ?? null) !== JSON.stringify(prev[f] ?? null))) {
        throw archivedRef(`Операция затрагивает счёт «${locked.name}» в архиве — сумму, дату и счета менять нельзя`);
      }
      // у перевода нет даты сделки; только при смене типа — создание и правку прежних переводов правило не трогает
      if (typeChange && next.accrualDate !== null) throw invalid({ accrualDate: 'У перевода нет даты сделки' });

      const c = check(companyId, next, prev);
      const changes = changedFields(prev, c.draft);
      if (!changes) return current;
      // смена типа пересчитывает курс и сумму в базовой валюте всегда — по стороне списания (§10.1 п. 5)
      const recalc = typeChange || MONEY_FIELDS.some((f) => f in changes.after);
```

4. В `mutate` правки замените

```ts
          .set({
            paidAt: draft.paidAt,
            accrualDate: draft.accrualDate,
```

на

```ts
          .set({
            type: draft.type,
            paidAt: draft.paidAt,
            accrualDate: draft.accrualDate,
```

(запись истории не меняется: `diff: { type: draft.type, ...changes, … }` уже несёт `before.type`/`after.type`, потому что `changedFields` сравнивает и `type`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/server/operations-update.test.ts tests/server/operations-audit.test.ts tests/server/operations-bulk.test.ts` → PASS.

- [ ] **Step 6: Full check and commit**

Run: `npm test` → PASS (на 5 тестов больше, чем на старте). Run: `npm run typecheck` → без ошибок.

```bash
git add src/shared/schemas/operations.ts src/server/modules/operations/service.ts tests/server/operations-update.test.ts
git commit -m "feat: сервер — «Изменить в перевод»: PATCH с type: transfer, запрет на архивном счёте, без даты сделки, пересчёт и история

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: История — «Тип: Расход → Перевод»

**Files:**
- Modify: `src/client/lib/audit-format.ts`, `src/client/lib/history.ts`, `src/client/pages/settings/AuditSettings.tsx`
- Test: `tests/client/audit-format.test.ts`, `tests/client/history.test.ts`

**Interfaces:**
- Consumes: запись правки из задачи 1 — `diff: { type, before: { type: 'expense', … }, after: { type: 'transfer', … } }`.
- Produces:
  - `OPERATION_TYPE_LABELS: Record<string, string>` (`audit-format.ts`);
  - `diffRows(diff: Record<string, unknown> | null, entity?: string): DiffRow[] | null`;
  - `HistoryItem.changes` — «Тип: Расход → Перевод. Изменено: …».

- [ ] **Step 1: Write the failing tests**

В `tests/client/audit-format.test.ts` после теста `'diffRows: «было → стало» по полям before/after; иначе null'` вставьте:

```ts
  it('diffRows операции: тип по-русски — «Расход → Перевод» (§10.1 этапа 1.5); у других сущностей type как есть', () => {
    const diff = { type: 'transfer', before: { type: 'expense', counterpartyId: 5 }, after: { type: 'transfer', counterpartyId: null } };
    expect(diffRows(diff, 'operation')).toEqual([
      { field: 'type', before: 'Расход', after: 'Перевод' },
      { field: 'counterpartyId', before: '5', after: 'null' },
    ]);
    expect(diffRows({ before: { type: 'client' }, after: { type: 'supplier' } }, 'counterparty')).toEqual([{ field: 'type', before: 'client', after: 'supplier' }]);
    expect(diffRows(diff)).toEqual([
      { field: 'type', before: 'expense', after: 'transfer' },
      { field: 'counterpartyId', before: '5', after: 'null' },
    ]);
  });
```

В `tests/client/history.test.ts` после теста `'правка: изменённые поля по-русски, без суммы'` вставьте:

```ts
  it('смена типа (§6.8, §10.1): «Изменён перевод», «Тип: Расход → Перевод», затем остальные поля', () => {
    const [item] = historyItems(
      [
        entry({
          action: 'update',
          diff: { type: 'transfer', before: { type: 'expense', toAccountId: null, counterpartyId: 5 }, after: { type: 'transfer', toAccountId: 2, counterpartyId: null } },
        }),
      ],
      ctx,
    );
    expect(item).toMatchObject({ title: 'Изменён перевод', type: 'transfer', amount: null, changes: 'Тип: Расход → Перевод. Изменено: Счёт зачисления, Контрагент' });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/client/audit-format.test.ts tests/client/history.test.ts`
Expected: FAIL — `diffRows` пишет `expense`/`transfer`, в истории «Изменено: Тип, Счёт зачисления, Контрагент».

- [ ] **Step 3: Implement**

В `src/client/lib/audit-format.ts` замените

```ts
/** Строки «поле: было → стало» для diff вида { before, after }; null — показать JSON как есть. */
export function diffRows(diff: Record<string, unknown> | null): DiffRow[] | null {
  if (!diff) return null;
  const { before, after } = diff;
  if (typeof before !== 'object' || before === null || typeof after !== 'object' || after === null) return null;
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const fields = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  return fields.map((field) => ({ field, before: show(b[field]), after: show(a[field]) }));
}
```

на

```ts
/** Типы операции по-русски — для «Тип: Расход → Перевод» (§10.1 этапа 1.5). */
export const OPERATION_TYPE_LABELS: Record<string, string> = { income: 'Доход', expense: 'Расход', transfer: 'Перевод' };

/**
 * Строки «поле: было → стало» для diff вида { before, after }; null — показать JSON как есть. У операции (`entity`)
 * тип показывается по-русски — «Расход → Перевод» (§10.1 этапа 1.5); у других сущностей поле type — как есть.
 */
export function diffRows(diff: Record<string, unknown> | null, entity?: string): DiffRow[] | null {
  if (!diff) return null;
  const { before, after } = diff;
  if (typeof before !== 'object' || before === null || typeof after !== 'object' || after === null) return null;
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const value = (field: string, v: unknown) => (entity === 'operation' && field === 'type' && typeof v === 'string' && OPERATION_TYPE_LABELS[v]) || show(v);
  const fields = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  return fields.map((field) => ({ field, before: value(field, b[field]), after: value(field, a[field]) }));
}
```

В `src/client/lib/history.ts`:

1. Замените `import { ACTION_LABELS, diffRows } from './audit-format';` на `import { ACTION_LABELS, diffRows, type DiffRow } from './audit-format';`.
2. Перед `export interface HistoryItem {` вставьте:

```ts
/**
 * Вторая строка записи правки: смена типа отдельно — «Тип: Расход → Перевод» (§10.1 этапа 1.5), затем остальные поля
 * по-русски — «Изменено: Счёт зачисления, Контрагент». null — показывать нечего.
 */
function changesText(rows: readonly DiffRow[]): string | null {
  const typeRow = rows.find((r) => r.field === 'type');
  const others = rows.filter((r) => r.field !== 'type');
  const parts = [
    ...(typeRow ? [`Тип: ${typeRow.before} → ${typeRow.after}`] : []),
    ...(others.length > 0 ? [`Изменено: ${others.map((r) => OPERATION_FIELD_LABELS[r.field] ?? r.field).join(', ')}`] : []),
  ];
  return parts.length > 0 ? parts.join('. ') : null;
}

```

3. Замените

```ts
    const rows = e.action === 'update' ? diffRows(e.diff) : null;
    const changes = rows && rows.length > 0 ? `Изменено: ${rows.map((r) => OPERATION_FIELD_LABELS[r.field] ?? r.field).join(', ')}` : null;
```

на

```ts
    const rows = e.action === 'update' ? diffRows(e.diff, 'operation') : null;
    const changes = rows ? changesText(rows) : null;
```

В `src/client/pages/settings/AuditSettings.tsx`:

1. После строки `import { ACTION_LABELS, COMPANY_ENTITIES, diffRows, ENTITY_LABELS, pageDiff, SYSTEM_ENTITIES } from '../../lib/audit-format';` вставьте `import { OPERATION_FIELD_LABELS } from '../../lib/history';`.
2. Замените `  const rows = diffRows(diff);` на `  const rows = diffRows(diff, e.entity);`.
3. Замените `                    <td className="pr-3 align-top">{r.field}</td>` на

```tsx
                    {/* поля операции — по-русски, как в панели истории («Тип», «Счёт зачисления») */}
                    <td className="pr-3 align-top">{e.entity === 'operation' ? (OPERATION_FIELD_LABELS[r.field] ?? r.field) : r.field}</td>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/client/audit-format.test.ts tests/client/history.test.ts` → PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` → PASS (на 2 теста больше). Run: `npm run typecheck`. Run: `npm run test:e2e` → все проходят (136); в `e2e/service-screens.spec.ts` запись «Изменено: Комментарий» в панели истории не изменилась.

```bash
git add src/client/lib/audit-format.ts src/client/lib/history.ts src/client/pages/settings/AuditSettings.tsx tests/client/audit-format.test.ts tests/client/history.test.ts
git commit -m "feat: история — смена типа операции «Тип: Расход → Перевод» в панели и на странице, поля операции по-русски

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `convertToTransferDraft`, список потерь, сумма зачисления, `patchBody` с типом

**Files:**
- Modify: `src/client/lib/operation-edit.ts`
- Test: `tests/client/operation-edit.test.ts`

**Interfaces:**
- Consumes: `OperationDraft`, `buildBody` (`lib/operation-form.ts`), `pluralRu` (`lib/journal-format.ts`), `draftFromOperation`, `patchBody`.
- Produces (все — `src/client/lib/operation-edit.ts`):
  - `interface ConvertNames { category: (id: number) => string | undefined; counterparty: (id: number) => string | undefined }`;
  - `interface ConvertResult { draft: OperationDraft; losses: string[]; carried: string | null }`;
  - `convertToTransferDraft(draft: OperationDraft, names: ConvertNames): ConvertResult`;
  - `convertQuestion(losses: readonly string[]): string` — «Будут убраны: …»;
  - `pickConvertedFrom(draft: OperationDraft, accountId: number | null, accounts: ReadonlyMap<number, { currency: string }>, carried: string): OperationDraft`;
  - `convertBlockedHint(locked: { name: string } | null, accounts: readonly { id: number; archivedAt: string | null }[], accountId: number | null): string | undefined`;
  - `type OperationPatch = Partial<Omit<OperationBody, 'type'>> & { version: number; type?: 'transfer' }`; `patchBody` кладёт `type: 'transfer'`, когда тело — перевод, а операция — нет.

- [ ] **Step 1: Write the failing tests**

В `tests/client/operation-edit.test.ts` замените строку импорта

```ts
import { archivedAccountOf, draftFromOperation, duplicateDraft, patchBody, withoutArchived, type OperationRecord } from '../../src/client/lib/operation-edit';
```

на

```ts
import {
  archivedAccountOf,
  convertBlockedHint,
  convertQuestion,
  convertToTransferDraft,
  draftFromOperation,
  duplicateDraft,
  patchBody,
  pickConvertedFrom,
  withoutArchived,
  type ConvertNames,
  type OperationRecord,
} from '../../src/client/lib/operation-edit';
```

и допишите в конец файла:

```ts
const names: ConvertNames = {
  category: (id) => (id === 7 ? 'Зарплата' : id === 6 ? 'Бар' : undefined),
  counterparty: (id) => (id === 5 ? 'Алина' : undefined),
};
/** Доход на долларовом счёте 3 без категории и контрагента: $100. */
const usdIncome = () => op({ type: 'income', accountId: 3, amount: 10000, counterpartyId: null, lines: [{ categoryId: null, projectId: null, amount: 10000 }] });

describe('«Изменить в перевод» (§6.8, §10.1 этапа 1.5)', () => {
  it('расход: «Со счёта» — прежний счёт, «На счёт» пусто; убраны категория, контрагент, дата сделки; проект, теги, комментарий, дата и время остаются', () => {
    const d = draftFromOperation(op({ accrualDate: '2026-09-30' }), accounts, TZ);
    const r = convertToTransferDraft(d, names);
    expect(r.losses).toEqual(['категория «Зарплата»', 'контрагент «Алина»', 'дата сделки']);
    expect(convertQuestion(r.losses)).toBe('Будут убраны: категория «Зарплата», контрагент «Алина», дата сделки.');
    expect(r.carried).toBeNull();
    expect(r.draft).toEqual({ ...d, type: 'transfer', accountId: 1, toAccountId: null, toAmount: '', categoryId: null, projectId: 8, counterpartyId: null, accrualOn: false, split: null });
  });

  it('доход: прежний счёт — «На счёт», «Со счёта» пусто; прежняя сумма — и сумма, и «Сумма зачисления»; терять нечего — список пуст', () => {
    const r = convertToTransferDraft(draftFromOperation(usdIncome(), accounts, TZ), names);
    expect(r.losses).toEqual([]);
    expect(r.carried).toBe('100');
    expect(r.draft).toMatchObject({ type: 'transfer', accountId: null, toAccountId: 3, amount: '100', toAmount: '100', projectId: null, tagIds: [2, 1], comment: 'аренда', paidDate: '2026-10-05', paidTime: '18:15' });
  });

  it('разбиение: «разбиение на 2 строки» вместо категорий; проект остаётся, только если он один у всех строк (Review Focus 2)', () => {
    const lines = [
      { categoryId: 7, projectId: 8, amount: 100000 },
      { categoryId: 6, projectId: 8, amount: 50050 },
    ];
    const same = convertToTransferDraft(draftFromOperation(op({ lines }), accounts, TZ), names);
    expect(same.losses).toEqual(['контрагент «Алина»', 'разбиение на 2 строки']);
    expect(same.draft).toMatchObject({ projectId: 8, categoryId: null, split: null });
    const mixed = convertToTransferDraft(draftFromOperation(op({ counterpartyId: null, lines: [lines[0]!, { ...lines[1]!, projectId: null }] }), accounts, TZ), names);
    expect(mixed.losses).toEqual(['разбиение на 2 строки']);
    expect(mixed.draft.projectId).toBeNull();
    // название не найдено — только слово; уже перевод — без изменений
    expect(convertToTransferDraft(draftFromOperation(op({ counterpartyId: 99, lines: [{ categoryId: 98, projectId: null, amount: 150050 }] }), accounts, TZ), names).losses).toEqual(['категория', 'контрагент']);
    const t = draftFromOperation(op({ type: 'transfer', toAccountId: 2, toAmount: 150050, counterpartyId: null, lines: [] }), accounts, TZ);
    expect(convertToTransferDraft(t, names)).toEqual({ draft: t, losses: [], carried: null });
  });

  it('доход: «Со счёта» в другой валюте очищает сумму списания, в той же — возвращает прежнюю; набранную руками не трогает (Review Focus 1)', () => {
    const usd = convertToTransferDraft(draftFromOperation(usdIncome(), accounts, TZ), names);
    expect(pickConvertedFrom(usd.draft, 1, accounts, usd.carried!)).toMatchObject({ accountId: 1, amount: '', toAmount: '100' });

    const kzt = convertToTransferDraft(draftFromOperation(op({ type: 'income', counterpartyId: null }), accounts, TZ), names);
    expect(kzt.draft).toMatchObject({ accountId: null, toAccountId: 1, amount: '1500,5', toAmount: '1500,5' });
    expect(pickConvertedFrom(kzt.draft, 2, accounts, kzt.carried!)).toMatchObject({ accountId: 2, amount: '1500,5' });
    const toUsd = pickConvertedFrom(kzt.draft, 3, accounts, kzt.carried!);
    expect(toUsd).toMatchObject({ accountId: 3, amount: '', toAmount: '1500,5' });
    expect(pickConvertedFrom(toUsd, 2, accounts, kzt.carried!).amount).toBe('1500,5');
    expect(pickConvertedFrom({ ...toUsd, amount: '3' }, 2, accounts, kzt.carried!).amount).toBe('3');
    expect(pickConvertedFrom({ ...kzt.draft, amount: '3' }, 3, accounts, kzt.carried!).amount).toBe('3');
  });

  it('строка недоступна: счёт операции в архиве; нет другого активного счёта (Review Focus 3)', () => {
    const list = [...accounts.values()];
    expect(convertBlockedHint(null, list, 1)).toBeUndefined();
    expect(convertBlockedHint({ name: 'Старый' }, list, 4)).toBe('Изменить в перевод нельзя: счёт в архиве («Старый»)');
    expect(convertBlockedHint(null, list.filter((a) => a.id === 1 || a.id === 4), 1)).toBe('Изменить в перевод нельзя: нет другого счёта');
  });

  it('PATCH расхода: type, счёт зачисления и явные поля — контрагент null, строка без категории с проектом; дата сделки null, если была', () => {
    const toKaspi = (d: OperationDraft) => ({ ...convertToTransferDraft(d, names).draft, toAccountId: 2 });
    expect(patchFor(op(), toKaspi)).toEqual({ version: 3, type: 'transfer', toAccountId: 2, counterpartyId: null, lines: [{ categoryId: null, projectId: 8, amount: 150050 }] });
    expect(patchFor(op({ accrualDate: '2026-09-30' }), toKaspi)).toMatchObject({ type: 'transfer', accrualDate: null });
  });

  it('PATCH дохода между валютами: счёт и сумма списания, прежний счёт и сумма — зачисление, строк нет (Review Focus 1)', () => {
    const income = op({ type: 'income', accountId: 3, amount: 10000, counterpartyId: null, lines: [{ categoryId: 7, projectId: null, amount: 10000 }] });
    const body = patchFor(income, (d) => {
      const r = convertToTransferDraft(d, names);
      return { ...pickConvertedFrom(r.draft, 1, accounts, r.carried!), amount: '47512' };
    });
    expect(body).toEqual({ version: 3, type: 'transfer', accountId: 1, amount: 4751200, toAccountId: 3, toAmount: 10000, lines: [] });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/client/operation-edit.test.ts`
Expected: FAIL — `convertToTransferDraft`, `convertQuestion`, `pickConvertedFrom`, `convertBlockedHint` не экспортируются.

- [ ] **Step 3: Implement**

В `src/client/lib/operation-edit.ts`:

1. Замените `import { amountInputText, dayOf } from './journal-format';` на `import { amountInputText, dayOf, pluralRu } from './journal-format';`.
2. Замените

```ts
/** Тело PATCH: изменённые поля и версия. */
export type OperationPatch = Partial<Omit<OperationBody, 'type'>> & { version: number };
```

на

```ts
/** Тело PATCH: изменённые поля и версия; `type: 'transfer'` — «Изменить в перевод» (§10.1 этапа 1.5). */
export type OperationPatch = Partial<Omit<OperationBody, 'type'>> & { version: number; type?: 'transfer' };
```

3. Замените

```ts
  const patch: OperationPatch = { version: op.version };
  const minute = (iso: string) => `${dayOf(iso, timeZone)} ${timeOfDay(iso, timeZone)}`;
```

на

```ts
  const patch: OperationPatch = { version: op.version };
  // «Изменить в перевод» (§10.1): смена типа; явные поля перевода (счёт зачисления, контрагент null, строки, дата сделки null)
  // уходят ниже как обычные различия с операцией
  if (body.type === 'transfer' && op.type !== 'transfer') patch.type = 'transfer';
  const minute = (iso: string) => `${dayOf(iso, timeZone)} ${timeOfDay(iso, timeZone)}`;
```

4. Допишите в конец файла:

```ts
/** Названия для списка потерь «Изменить в перевод» (§6.8 этапа 1.5): категория и контрагент по id; не найдено — undefined. */
export interface ConvertNames {
  category: (id: number) => string | undefined;
  counterparty: (id: number) => string | undefined;
}

export interface ConvertResult {
  /** Черновик перевода: тип, счета, проект; теги, комментарий, дата и время — прежние. */
  draft: OperationDraft;
  /** Что будет убрано, по порядку: категория, контрагент, разбиение, дата сделки. Пусто — подтверждение не нужно. */
  losses: string[];
  /** Доход: прежняя сумма (текст поля) — «Сумма зачисления» на прежнем счёте (см. pickConvertedFrom); у расхода — null. */
  carried: string | null;
}

const named = (what: string, name: string | undefined) => (name ? `${what} «${name}»` : what);

/**
 * «Изменить в перевод» (§6.8 этапа 1.5): черновик дохода или расхода → черновик перевода на месте. Расход на счёте A —
 * «Со счёта» = A, «На счёт» пусто; доход на счёте A — «На счёт» = A, «Со счёта» пусто, прежняя сумма — и сумма, и
 * «Сумма зачисления» (её место решает выбор «Со счёта», pickConvertedFrom). Проект остаётся, только если он один у всех
 * строк. Категория, контрагент, разбиение и дата сделки убираются — они и есть список потерь для подтверждения.
 * Работает с текущим черновиком: несохранённые правки формы переходят в перевод. Перевод возвращается как есть.
 */
export function convertToTransferDraft(draft: OperationDraft, names: ConvertNames): ConvertResult {
  if (draft.type === 'transfer') return { draft, losses: [], carried: null };
  const losses: string[] = [];
  if (!draft.split && draft.categoryId !== null) losses.push(named('категория', names.category(draft.categoryId)));
  if (draft.counterpartyId !== null) losses.push(named('контрагент', names.counterparty(draft.counterpartyId)));
  if (draft.split) {
    const n = draft.split.lines.length;
    losses.push(`разбиение на ${n} ${pluralRu(n, 'строку', 'строки', 'строк')}`);
  }
  if (draft.accrualOn) losses.push('дата сделки');
  const projects = draft.split ? [...new Set(draft.split.lines.map((l) => l.projectId))] : [draft.projectId];
  const income = draft.type === 'income';
  return {
    draft: {
      ...draft,
      type: 'transfer',
      accountId: income ? null : draft.accountId,
      toAccountId: income ? draft.accountId : null,
      toAmount: income ? draft.amount : '',
      categoryId: null,
      projectId: projects.length === 1 ? projects[0]! : null,
      counterpartyId: null,
      accrualOn: false,
      split: null,
    },
    losses,
    carried: income ? draft.amount : null,
  };
}

/** Текст подтверждения «Изменить в перевод?»: «Будут убраны: категория «Аренда», контрагент «Алина», дата сделки.» */
export function convertQuestion(losses: readonly string[]): string {
  return `Будут убраны: ${losses.join(', ')}.`;
}

/**
 * Выбор «Со счёта» у дохода, изменённого в перевод (§6.8 этапа 1.5): прежняя сумма `carried` — сумма зачисления. Счёт в
 * другой валюте, чем «На счёт», очищает сумму списания, если её не меняли («Сумму» нужно ввести); в той же валюте пустая
 * сумма снова становится прежней. Набранную руками сумму выбор счёта не трогает.
 */
export function pickConvertedFrom(draft: OperationDraft, accountId: number | null, accounts: ReadonlyMap<number, { currency: string }>, carried: string): OperationDraft {
  const next = { ...draft, accountId };
  const from = accountId === null ? undefined : accounts.get(accountId)?.currency;
  const to = draft.toAccountId === null ? undefined : accounts.get(draft.toAccountId)?.currency;
  if (from === undefined || to === undefined) return next;
  if (from !== to) return draft.amount === carried ? { ...next, amount: '' } : next;
  return draft.amount === '' ? { ...next, amount: carried } : next;
}

/**
 * Причина, по которой строка «Изменить в перевод» недоступна (§6.7 строка 4, §11 этапа 1.5): операция на архивном счёте
 * (инвариант 7) или в компании нет другого активного счёта — перевод некуда направить. undefined — доступна.
 */
export function convertBlockedHint(
  locked: { name: string } | null,
  accounts: readonly { id: number; archivedAt: string | null }[],
  accountId: number | null,
): string | undefined {
  if (locked) return `Изменить в перевод нельзя: счёт в архиве («${locked.name}»)`;
  if (!accounts.some((a) => !a.archivedAt && a.id !== accountId)) return 'Изменить в перевод нельзя: нет другого счёта';
  return undefined;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/client/operation-edit.test.ts tests/client/operation-form.test.ts` → PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` → PASS (на 7 тестов больше, чем после задачи 2). Run: `npm run typecheck` → без ошибок.

```bash
git add src/client/lib/operation-edit.ts tests/client/operation-edit.test.ts
git commit -m "feat: «Изменить в перевод» — черновик перевода и список потерь, сумма зачисления у дохода, причина недоступности, тип в PATCH

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Форма — строка 4, подтверждение, перестройка в «Перевод»

**Files:**
- Modify: `src/client/components/icons.tsx`, `src/client/components/operation/OperationForm.tsx`
- Test: `e2e/operation-edit.spec.ts`, `e2e/mobile.spec.ts`

**Interfaces:**
- Consumes:
  - из задачи 3 — `convertToTransferDraft`, `convertQuestion`, `convertBlockedHint`, `ConvertNames`, `patchBody` с `type`;
  - из задачи 1 — сервер принимает смену типа;
  - из задачи 2 — «Тип: Расход → Перевод» в панели истории;
  - уже есть: `findCategory` (`lib/operation-options.ts`), `isCoarsePointer`, `refocusTarget` (`components/focus-trap.ts`), `ConfirmDialog`, `ActionRow`.
- Produces:
  - `TransferIcon()` (`icons.tsx`);
  - свойство `onTypeChange: (type: OperationType) => void` у `OperationEditor`;
  - у полей счёта обёртка `data-field="accountId" | "toAccountId"`;
  - состояние `convertLosses`, `convertFocus` и функция `convert()` в `OperationEditor` — задача 5 дополняет `convert()`.

- [ ] **Step 1: Write the failing e2e tests**

В `e2e/operation-edit.spec.ts`:

1. В тесте `'операция на архивном счёте: сумма, дата и счёт заблокированы с подсказкой, «Удалить» недоступна, комментарий меняется'` замените

```ts
  await remove.dispatchEvent('click');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await dialog.getByLabel('Комментарий').fill('приход из кассы');
```

на

```ts
  await remove.dispatchEvent('click');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  // «Изменить в перевод» — тоже видна, но неактивна с причиной; нажатие форму не перестраивает (Review Focus 3)
  const toTransfer = dialog.getByRole('button', { name: 'Изменить в перевод' });
  await expect(toTransfer).toHaveAttribute('aria-disabled', 'true');
  await expect(toTransfer).toHaveAccessibleDescription('Изменить в перевод нельзя: счёт в архиве («Старый»)');
  await toTransfer.dispatchEvent('click');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Доход', exact: true })).toBeVisible();
  await dialog.getByLabel('Комментарий').fill('приход из кассы');
```

2. Сразу после этого теста (перед комментарием `// Правка операции на ширине 390 px …`) вставьте новый тест:

```ts
test('«Изменить в перевод»: расход с категорией, контрагентом и датой сделки — подтверждение со списком, форма перевода, в PATCH — смена типа и явные поля', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО В перевод ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 100000 })).account.id;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  const rent = (await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Аренда' })).category.id;
  const alina = (await apiPost(page, `${base}/counterparties`, { type: 'supplier', name: 'Алина' })).counterparty.id;
  const club = (await apiPost(page, `${base}/projects`, { name: 'Клуб 1', templateKey: 'general', templateParams: {} })).project.id;
  await apiPost(page, `${base}/operations`, {
    type: 'expense',
    paidAt: todayAgo(1),
    accrualDate: '2026-09-01',
    accountId: cash,
    amount: 30000,
    counterpartyId: alina,
    comment: 'в Kaspi',
    lines: [{ categoryId: rent, projectId: club, amount: 30000 }],
  });
  await page.reload();

  await rows(page).first().getByText('в Kaspi').click();
  const dialog = page.getByRole('dialog', { name: 'Расход', exact: true });
  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
  // строка 4 — между «Добавить проект, тег, комментарий, файл» и «Дублировать платёж», как на снимке Finmap 05 (§6.7)
  await expect(dialog.getByRole('button', { name: /^(Добавить проект, тег, комментарий, файл|Изменить в перевод|Дублировать платёж|Удалить платёж)$/ })).toHaveText([
    'Добавить проект, тег, комментарий, файл',
    'Изменить в перевод',
    'Дублировать платёж',
    'Удалить платёж',
  ]);
  const convert = dialog.getByRole('button', { name: 'Изменить в перевод' });
  await convert.click();
  // подтверждение перечисляет, что будет убрано; «Отменить | Изменить», фокус на «Отменить» (§6.8, §11)
  const confirm = page.getByRole('alertdialog', { name: 'Изменить в перевод?' });
  await expect(confirm).toHaveAccessibleDescription('Будут убраны: категория «Аренда», контрагент «Алина», дата сделки.');
  await expect(confirm.getByRole('button')).toHaveText(['×', 'Отменить', 'Изменить']);
  await expect(confirm.getByRole('button', { name: 'Отменить' })).toBeFocused();
  // Esc закрывает только подтверждение: форма — по-прежнему расход, фокус на строке
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('alertdialog', { name: 'Ваши данные не сохранятся' })).toHaveCount(0);
  await expect(convert).toBeFocused();

  await convert.click();
  await confirm.getByRole('button', { name: 'Изменить', exact: true }).click();
  // форма на месте стала переводом: «Со счёта» — прежний счёт, «На счёт» пусто и в фокусе; проект и комментарий остались
  const transfer = page.getByRole('dialog', { name: 'Перевод', exact: true });
  await expect(transfer).toBeVisible();
  const to = transfer.getByRole('combobox', { name: 'На счёт', exact: true });
  await expect(to).toBeFocused();
  await expect(to).toHaveValue('');
  await expect(transfer.getByRole('combobox', { name: 'Со счёта', exact: true })).toHaveValue('Касса');
  await expect(transfer.getByRole('textbox', { name: /^Сумма,/ })).toHaveValue('300');
  await expect(transfer.getByRole('combobox', { name: 'Проект', exact: true })).toHaveValue('Клуб 1');
  await expect(transfer.getByLabel('Комментарий')).toHaveValue('в Kaspi');
  await expect(transfer.getByRole('combobox', { name: 'Категория', exact: true })).toHaveCount(0);
  await expect(transfer.getByRole('button', { name: 'Дата сделки отличается' })).toHaveCount(0);
  await expect(transfer.getByRole('button', { name: 'Изменить в перевод' })).toHaveCount(0);
  await expect(submit(transfer)).toHaveText('Сохранить изменения');

  // «×» с изменениями — обычный вопрос; «Отменить» оставляет форму
  await transfer.getByRole('button', { name: 'Закрыть', exact: true }).click();
  const ask = page.getByRole('alertdialog', { name: 'Ваши данные не сохранятся' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Отменить' }).click();
  await expect(transfer).toBeVisible();

  await to.click();
  await transfer.getByRole('option', { name: 'Kaspi', exact: true }).click();
  const patch = page.waitForRequest((r) => r.method() === 'PATCH');
  await submit(transfer).click();
  expect((await patch).postDataJSON()).toEqual({
    version: 1,
    type: 'transfer',
    accrualDate: null,
    toAccountId: kaspi,
    counterpartyId: null,
    lines: [{ categoryId: null, projectId: club, amount: 30000 }],
  });
  await expect(transfer).toBeHidden();
  await expect(rows(page).first()).toContainText('Касса → Kaspi');
  // балансы обоих счетов (Review Focus 5): «Касса» — 1000 − 300, «Kaspi» — 300
  const panel = page.getByRole('navigation', { name: 'Счета' });
  await expect(panel.getByRole('link', { name: /^Касса/ })).toContainText(/₸\s700$/);
  await expect(panel.getByRole('link', { name: /^Kaspi/ })).toContainText(/₸\s300$/);
  // история: «Изменён перевод», «Тип: Расход → Перевод» (§10.1 п. 7)
  await page.getByRole('banner').getByRole('button', { name: 'История действий' }).click();
  const items = page.getByRole('dialog', { name: 'История действий' }).getByRole('list', { name: 'Последние действия' }).getByRole('listitem');
  await expect(items.first()).toContainText('Изменён перевод');
  await expect(items.first()).toContainText('Тип: Расход → Перевод');
});
```

В `e2e/mobile.spec.ts`, в тесте `'архивная компания: форма операции только для просмотра, …'`, замените

```ts
  for (const name of ['Сохранить изменения', 'Добавить и создать похожий', 'Дублировать платёж', 'Удалить платёж']) {
```

на

```ts
  for (const name of ['Сохранить изменения', 'Добавить и создать похожий', 'Изменить в перевод', 'Дублировать платёж', 'Удалить платёж']) {
```

- [ ] **Step 2: Run e2e to verify they fail**

Run: `npx playwright test e2e/operation-edit.spec.ts -g "архивном счёте|Изменить в перевод"`
Expected: FAIL — кнопки «Изменить в перевод» нет.

- [ ] **Step 3: Icon**

В `src/client/components/icons.tsx` после функции `CopyIcon` вставьте:

```tsx
/** ⇄ — строка «Изменить в перевод» (§6.7 строка 4 этапа 1.5, снимок Finmap 05). */
export function TransferIcon() {
  return (
    <Svg>
      <polyline points="17 3 21 7 17 11" />
      <line x1="21" y1="7" x2="7" y2="7" />
      <polyline points="7 13 3 17 7 21" />
      <line x1="3" y1="17" x2="17" y2="17" />
    </Svg>
  );
}
```

- [ ] **Step 4: Form — imports, title by draft type**

В `src/client/components/operation/OperationForm.tsx`:

1. Замените

```ts
import { archivedAccountOf, draftFromOperation, duplicateDraft, patchBody, type Available, type OperationRecord } from '../../lib/operation-edit';
```

на

```ts
import {
  archivedAccountOf,
  convertBlockedHint,
  convertQuestion,
  convertToTransferDraft,
  draftFromOperation,
  duplicateDraft,
  patchBody,
  type Available,
  type ConvertNames,
  type OperationRecord,
} from '../../lib/operation-edit';
```

2. Замените

```ts
import { accountOptions, categoryOptions, counterpartyLabel, counterpartyOptions, preferredCounterpartyType, projectOptions, salaryCategory, tagOptions } from '../../lib/operation-options';
```

на

```ts
import {
  accountOptions,
  categoryOptions,
  counterpartyLabel,
  counterpartyOptions,
  findCategory,
  preferredCounterpartyType,
  projectOptions,
  salaryCategory,
  tagOptions,
} from '../../lib/operation-options';
```

3. Замените `import { Field } from '../Field';` на

```ts
import { Field } from '../Field';
import { isCoarsePointer, refocusTarget } from '../focus-trap';
```

4. Замените `import { CalendarIcon, ChevronIcon, CopyIcon, SplitIcon, TrashIcon } from '../icons';` на `import { CalendarIcon, ChevronIcon, CopyIcon, SplitIcon, TransferIcon, TrashIcon } from '../icons';`.

5. В `OperationForm` замените

```ts
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(props.request.kind === 'edit');
```

на

```ts
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(props.request.kind === 'edit');
  /** Тип черновика формы: «Изменить в перевод» делает его переводом до сохранения (§6.8 этапа 1.5); null — форма ещё не открыта. */
  const [draftType, setDraftType] = useState<OperationType | null>(null);
```

6. Замените

```ts
  const type = props.request.kind === 'create' ? props.request.type : operation.data?.type;
```

на

```ts
  const type = props.request.kind === 'create' ? props.request.type : operation.data?.type;
  // заголовок — по типу черновика: после «Изменить в перевод» — «Перевод» (§6.8 этапа 1.5)
  const shownType = draftType ?? type;
```

7. Замените `      title={type ? operationTitle(type, editing) : 'Операция'}` на `      title={shownType ? operationTitle(shownType, editing) : 'Операция'}`.

8. Замените

```tsx
          onEditingChange={setEditing}
```

на

```tsx
          onEditingChange={setEditing}
          onTypeChange={setDraftType}
```

9. В типе свойств `OperationEditor` замените

```ts
  /** Форма перешла от правки к новой операции («Дублировать платёж»). */
  onEditingChange: (editing: boolean) => void;
```

на

```ts
  /** Форма перешла от правки к новой операции («Дублировать платёж»). */
  onEditingChange: (editing: boolean) => void;
  /** Тип черновика сменился («Изменить в перевод», «Загрузить актуальную»): заголовок окна следует за ним. */
  onTypeChange: (type: OperationType) => void;
```

- [ ] **Step 5: Form — state, effects, convert**

1. Замените

```ts
  const [confirmDelete, setConfirmDelete] = useState(false);
```

на

```ts
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** «Изменить в перевод» (§6.8 этапа 1.5): подтверждение со списком того, что будет убрано; null — закрыто. */
  const [convertLosses, setConvertLosses] = useState<string[] | null>(null);
  /** Сигнал: форма стала переводом — фокус на пустой счёт перевода. */
  const [convertFocus, setConvertFocus] = useState(0);
```

2. Замените

```ts
  useEffect(() => {
    if (!accrualFocus) return;
```

на

```ts
  // заголовок окна — по типу черновика (§6.8 этапа 1.5): перевод после «Изменить в перевод», прежний тип после «Загрузить актуальную»
  useEffect(() => p.onTypeChange(draft.type), [draft.type]);

  // после «Изменить в перевод» строки больше нет: фокус — на пустой счёт перевода («На счёт» у расхода, «Со счёта» у
  // дохода); на устройстве с пальцем — на «×», чтобы не поднимать клавиатуру (refocusTarget, план 1.5-5b).
  // Сигнал приходит дважды при подтверждении (после перестройки и при закрытии ConfirmDialog) — повтор безвреден
  useEffect(() => {
    if (!convertFocus) return;
    if (refocusTarget(isCoarsePointer()) === 'close') {
      closeButton()?.focus({ preventScroll: true });
      return;
    }
    const key = draft.accountId === null ? 'accountId' : 'toAccountId';
    formRef.current?.querySelector<HTMLInputElement>(`[data-field="${key}"] input`)?.focus();
  }, [convertFocus]);

  useEffect(() => {
    if (!accrualFocus) return;
```

3. Замените

```ts
  /** «Разделить платёж» / «Отменить разделение» (§6.7, строка 2): разбиение — на месте категории. */
```

на

```ts
  /** Названия для списка потерь «Изменить в перевод»: категория (в том числе дочерняя) и контрагент. */
  const convertNames: ConvertNames = {
    category: (id) => findCategory(p.data.categories, id)?.name,
    counterparty: (id) => p.data.counterparties.find((c) => c.id === id)?.name,
  };

  /** «Изменить в перевод» (§6.8): форма на месте становится переводом; на сервер уходит только по «Сохранить изменения». */
  const convert = () => {
    const r = convertToTransferDraft(draft, convertNames);
    setDraft(r.draft);
    setConvertLosses(null);
    // проект перевода — в блоке строки 3: раскрыть, если проект остался (у разбиения он был в строках)
    if (r.draft.projectId !== null) setMore(true);
    setErrors({});
    setFormError(null);
    setStatus(null);
    setMissingRate(null);
    setConvertFocus((n) => n + 1);
  };

  /** Строка «Изменить в перевод»: если что-то будет убрано — сначала подтверждение, иначе сразу (§6.8). */
  const askConvert = () => {
    const { losses } = convertToTransferDraft(draft, convertNames);
    if (losses.length > 0) setConvertLosses(losses);
    else convert();
  };

  /** «Разделить платёж» / «Отменить разделение» (§6.7, строка 2): разбиение — на месте категории. */
```

- [ ] **Step 6: Form — account fields, row 4, confirmation**

1. Замените

```tsx
  const accountField = (label: string, key: 'accountId' | 'toAccountId') => (
    <ComboSelect
      label={label}
      listLabel="Счета"
      value={draft[key]}
      options={accountOptions(p.data.accounts, draft[key])}
      emptyLabel={null}
      onChange={(id) => set({ [key]: id }, key)}
      error={errors[key]}
      disabled={!!locked}
      hint={lockHint}
      autoFocus={focusField === key}
    />
  );
```

на

```tsx
  // data-field — куда поставить фокус после «Изменить в перевод» (пустой счёт перевода); contents — сетка формы не меняется
  const accountField = (label: string, key: 'accountId' | 'toAccountId') => (
    <div data-field={key} className="contents">
      <ComboSelect
        label={label}
        listLabel="Счета"
        value={draft[key]}
        options={accountOptions(p.data.accounts, draft[key])}
        emptyLabel={null}
        onChange={(id) => set({ [key]: id }, key)}
        error={errors[key]}
        disabled={!!locked}
        hint={lockHint}
        autoFocus={focusField === key}
      />
    </div>
  );
```

2. Замените

```ts
   * проект, тег, комментарий, файл» (его блок — сразу под ней), 5 «Дублировать платёж», 6 «Удалить платёж». У перевода —
   * 3, 5, 6. Строка 4 «Изменить в перевод» появится в плане 1.5-6: до тех пор её нет совсем (мёртвых кнопок нет).
   */
```

на

```ts
   * проект, тег, комментарий, файл» (его блок — сразу под ней), 4 «Изменить в перевод» (правка дохода и расхода, §6.8),
   * 5 «Дублировать платёж», 6 «Удалить платёж». У перевода — 3, 5, 6.
   */
```

3. Замените

```tsx
      {op && <ActionRow icon={<CopyIcon />} label="Дублировать платёж" onClick={duplicate} />}
```

на

```tsx
      {op && !transfer && (
        <ActionRow
          icon={<TransferIcon />}
          label="Изменить в перевод"
          onClick={askConvert}
          disabledHint={convertBlockedHint(locked, p.data.accounts, draft.accountId)}
        />
      )}
      {op && <ActionRow icon={<CopyIcon />} label="Дублировать платёж" onClick={duplicate} />}
```

4. Замените

```tsx
        onConfirm={() => void remove()}
        onFocusLost={() => setRefocusAmount((n) => n + 1)}
      />
    </>
```

на

```tsx
        onConfirm={() => void remove()}
        onFocusLost={() => setRefocusAmount((n) => n + 1)}
      />
      <ConfirmDialog
        open={convertLosses !== null}
        title="Изменить в перевод?"
        text={convertQuestion(convertLosses ?? [])}
        confirmLabel="Изменить"
        onCancel={() => setConvertLosses(null)}
        onConfirm={convert}
        // строки «Изменить в перевод» после перестройки нет — фокус на пустой счёт перевода
        onFocusLost={() => setConvertFocus((n) => n + 1)}
      />
    </>
```

- [ ] **Step 7: Run e2e to verify they pass**

Run: `npx playwright test e2e/operation-edit.spec.ts e2e/mobile.spec.ts` → PASS.

- [ ] **Step 8: Full check and commit**

Run: `npm test` → PASS. Run: `npm run typecheck` → без ошибок. Run: `npm run test:e2e` дважды подряд → все проходят оба раза (137).

```bash
git add src/client/components/icons.tsx src/client/components/operation/OperationForm.tsx e2e/operation-edit.spec.ts e2e/mobile.spec.ts
git commit -m "feat: форма — строка «Изменить в перевод»: подтверждение со списком потерь, перестройка в «Перевод» на месте, фокус на пустой счёт

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Доход между валютами и 409 после перестройки

**Files:**
- Modify: `src/client/components/operation/OperationForm.tsx`
- Test: `e2e/operation-edit.spec.ts`

**Interfaces:**
- Consumes:
  - `pickConvertedFrom`, `ConvertResult.carried` (задача 3);
  - `convert()`, обёртка `data-field`, `onTypeChange` (задача 4);
  - `reload()` и `duplicate()` формы — уже есть.
- Produces: состояние `carried: string | null` в `OperationEditor`. Выбор «Со счёта» у бывшего дохода проходит через `pickConvertedFrom`.

- [ ] **Step 1: Write the failing e2e tests**

В `e2e/operation-edit.spec.ts` сразу после теста `'«Изменить в перевод»: расход с категорией, …'` (задача 4) вставьте:

```ts
test('«Изменить в перевод»: доход на долларовом счёте без категории — сразу форма перевода; «Со счёта» в тенге очищает сумму, прежняя сумма — «Сумма зачисления»', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Доход в перевод ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 10000000 })).account.id;
  const usd = (await apiPost(page, `${base}/accounts`, { name: 'Валютный', currency: 'USD', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `${base}/fixed-rates`, { currency: 'USD', rate: '500', validFrom: '2020-01-01' });
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: todayAgo(1), accountId: usd, amount: 10000, comment: 'обмен' });
  await page.reload();

  await rows(page).first().getByText('обмен').click();
  const dialog = page.getByRole('dialog', { name: 'Доход', exact: true });
  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
  await dialog.getByRole('button', { name: 'Изменить в перевод' }).click();
  // терять нечего — подтверждения нет; прежний счёт — «На счёт», фокус на пустом «Со счёта» (§6.8)
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  const transfer = page.getByRole('dialog', { name: 'Перевод', exact: true });
  const from = transfer.getByRole('combobox', { name: 'Со счёта', exact: true });
  await expect(from).toBeFocused();
  await expect(from).toHaveValue('');
  await expect(transfer.getByRole('combobox', { name: 'На счёт', exact: true })).toHaveValue('Валютный');
  // «Со счёта» в тенге: сумму списания нужно ввести, прежние $100 — «Сумма зачисления» (Review Focus 1)
  await from.click();
  await transfer.getByRole('option', { name: 'Касса', exact: true }).click();
  const amount = transfer.getByRole('textbox', { name: /^Сумма,/ });
  await expect(amount).toHaveValue('');
  await expect(transfer.getByRole('textbox', { name: /^Сумма зачисления/ })).toHaveValue('100');
  await amount.fill('50000');
  await expect(transfer.getByText('Курс: 1 USD = 500 KZT')).toBeVisible();
  const patch = page.waitForRequest((r) => r.method() === 'PATCH');
  await submit(transfer).click();
  expect((await patch).postDataJSON()).toEqual({ version: 1, type: 'transfer', accountId: cash, amount: 5000000, toAccountId: usd, toAmount: 10000, lines: [] });
  await expect(transfer).toBeHidden();
  const row = rows(page).first();
  await expect(row).toContainText('Касса → Валютный');
  await expect(row).toContainText(/100\s\$/);
  await expect(page.getByRole('navigation', { name: 'Счета' }).getByRole('link', { name: /^Касса/ })).toContainText(/₸\s50\s000$/);
});

test('«Изменить в перевод» и 409: операцию изменили в другом окне — «Загрузить актуальную» возвращает расход, строку 4 и заголовок', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Перевод 409 ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 100000 })).account.id;
  await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01' });
  const op = (await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(1), accountId: cash, amount: 10000, comment: 'старое' })).operation;
  await page.reload();

  await rows(page).first().getByText('старое').click();
  const dialog = page.getByRole('dialog', { name: 'Расход', exact: true });
  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
  await dialog.getByRole('button', { name: 'Изменить в перевод' }).click();
  const transfer = page.getByRole('dialog', { name: 'Перевод', exact: true });
  const to = transfer.getByRole('combobox', { name: 'На счёт', exact: true });
  await expect(to).toBeFocused();
  await to.click();
  await transfer.getByRole('option', { name: 'Kaspi', exact: true }).click();
  // другой пользователь успел поменять комментарий
  const other = await page.request.patch(`${base}/operations/${op.id}`, { data: { version: 1, comment: 'другое окно' }, headers: csrf(page) });
  expect(other.status()).toBe(200);
  await submit(transfer).click();
  await expect(transfer.getByRole('alert').filter({ hasText: 'Операция изменена другим пользователем' })).toBeVisible();
  await transfer.getByRole('button', { name: 'Загрузить актуальную' }).click();
  // форма снова — расход с актуальными данными; строка «Изменить в перевод» на месте (Review Focus 4)
  const back = page.getByRole('dialog', { name: 'Расход', exact: true });
  await expect(back).toBeVisible();
  await expect(back.getByRole('status').filter({ hasText: 'Загружена актуальная' })).toHaveText('Загружена актуальная версия — внесите изменения заново');
  await expect(back.getByLabel('Комментарий')).toHaveValue('другое окно');
  await expect(back.getByRole('combobox', { name: 'Со счёта', exact: true })).toHaveValue('Касса');
  await expect(back.getByRole('button', { name: 'Изменить в перевод' })).toBeVisible();
  await back.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(back).toBeHidden();
  await expect(rows(page).first()).not.toContainText('→');
});
```

- [ ] **Step 2: Run e2e to verify the income test fails**

Run: `npx playwright test e2e/operation-edit.spec.ts -g "Изменить в перевод"`
Expected:
- тест дохода падает на `await expect(amount).toHaveValue('')` — сумма остаётся «100»;
- тест 409 проходит: заголовок и строку уже возвращает `onTypeChange` из задачи 4, тест закрепляет это поведение;
- тест расхода проходит.

- [ ] **Step 3: Implement**

В `src/client/components/operation/OperationForm.tsx`:

1. В импорте из `'../../lib/operation-edit'` замените

```ts
  patchBody,
  type Available,
```

на

```ts
  patchBody,
  pickConvertedFrom,
  type Available,
```

2. Замените

```ts
  /** Сигнал: форма стала переводом — фокус на пустой счёт перевода. */
  const [convertFocus, setConvertFocus] = useState(0);
```

на

```ts
  /** Сигнал: форма стала переводом — фокус на пустой счёт перевода. */
  const [convertFocus, setConvertFocus] = useState(0);
  /**
   * Доход, изменённый в перевод (§6.8): прежняя сумма — «Сумма зачисления»; выбор «Со счёта» в другой валюте очищает
   * сумму списания (pickConvertedFrom). null — правило не действует (расход, «Загрузить актуальную», «Дублировать»).
   */
  const [carried, setCarried] = useState<string | null>(null);
```

3. В `convert` замените

```ts
    setDraft(r.draft);
    setConvertLosses(null);
```

на

```ts
    setDraft(r.draft);
    setCarried(r.carried);
    setConvertLosses(null);
```

4. В `accountField` замените

```tsx
        onChange={(id) => set({ [key]: id }, key)}
```

на

```tsx
        // доход, изменённый в перевод: «Со счёта» в другой валюте очищает сумму списания (§6.8, pickConvertedFrom)
        onChange={(id) =>
          key === 'accountId' && carried !== null ? set(pickConvertedFrom(draft, id, accounts, carried), 'accountId', 'amount', 'toAmount') : set({ [key]: id }, key)
        }
```

5. В `reload` замените

```ts
      setOp(fresh);
      setDraft(next);
      setInitial(next);
      setConflict(null);
```

на

```ts
      setOp(fresh);
      setDraft(next);
      setInitial(next);
      setCarried(null);
      setConflict(null);
```

6. В `duplicate` замените

```ts
    const copy = duplicateDraft(draft, available(), today);
    setOp(null);
```

на

```ts
    const copy = duplicateDraft(draft, available(), today);
    setOp(null);
    setCarried(null);
```

- [ ] **Step 4: Run e2e to verify they pass**

Run: `npx playwright test e2e/operation-edit.spec.ts` → PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` → PASS. Run: `npm run typecheck`. Run: `npm run test:e2e` дважды подряд → все проходят оба раза (139).

```bash
git add src/client/components/operation/OperationForm.tsx e2e/operation-edit.spec.ts
git commit -m "feat: «Изменить в перевод» у дохода — прежняя сумма становится суммой зачисления, «Со счёта» в другой валюте очищает сумму списания; e2e 409

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Визуальная сверка и итог этапа 1.5 в README

**Files:**
- Modify: `scripts/ux-shots.ts`, `README.md`

**Interfaces:**
- Consumes: строка 4 и подтверждение (задача 4); сценарий `c05-op-edit.png` и помощник `table(p)` в `scripts/ux-shots.ts`.
- Produces:
  - снимки `c05c-convert-confirm.png` и `c05d-converted-transfer.png`;
  - `c05-op-edit.png` со строкой 4;
  - README «Что уже работает» с итогом этапа 1.5.

- [ ] **Step 1: Add the scenarios**

В `scripts/ux-shots.ts`:

1. Перед строкой `/** Экраны, которые уже есть. Следующие планы этапа 1.5 добавляют сюда свои. */` вставьте:

```ts
/**
 * Расход с категорией (в ячейке категории нет «Указать»): «Изменить в перевод» спросит, что будет убрано (§6.8 этапа 1.5).
 * Возвращает окно «Расход» с суммой на месте.
 */
const openCategorizedExpense = async (p: Page) => {
  const row = table(p)
    .locator('tbody tr')
    .filter({ hasText: '−' })
    .filter({ has: p.locator('[data-column="category"]', { hasNotText: 'Указать' }) })
    .first();
  await row.getByRole('button', { name: /^Открыть операцию/ }).click();
  const dialog = p.getByRole('dialog', { name: 'Расход', exact: true });
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).waitFor();
  return dialog;
};

```

2. В сценарии `c05-op-edit.png` замените

```ts
      await dialog.getByRole('button', { name: 'Удалить платёж' }).waitFor();
    },
  },
  { ours: 'c06-income.png', finmap: '06-income.png', path: 'log', act: openForm('Доход') },
```

на

```ts
      await dialog.getByRole('button', { name: 'Изменить в перевод' }).waitFor();
      await dialog.getByRole('button', { name: 'Удалить платёж' }).waitFor();
    },
  },
  {
    ours: 'c05c-convert-confirm.png',
    finmap: '05c-convert-confirm.png',
    path: 'log',
    act: async (p) => {
      // подтверждение «Изменить в перевод?» со списком того, что будет убрано (§6.8); снимка Finmap нет (§14.1)
      const dialog = await openCategorizedExpense(p);
      await dialog.getByRole('button', { name: 'Изменить в перевод' }).click();
      await p.getByRole('alertdialog', { name: 'Изменить в перевод?' }).waitFor();
      await p.mouse.move(0, 0);
    },
  },
  {
    ours: 'c05d-converted-transfer.png',
    finmap: '05d-converted-transfer.png',
    path: 'log',
    act: async (p) => {
      // после «Изменить»: та же операция в раскладке перевода, «На счёт» пусто и в фокусе (§6.8); снимка Finmap нет
      const dialog = await openCategorizedExpense(p);
      await dialog.getByRole('button', { name: 'Изменить в перевод' }).click();
      await p.getByRole('alertdialog', { name: 'Изменить в перевод?' }).getByRole('button', { name: 'Изменить', exact: true }).click();
      await p.getByRole('dialog', { name: 'Перевод', exact: true }).getByRole('combobox', { name: 'На счёт', exact: true }).waitFor();
      await p.mouse.move(0, 0);
    },
  },
  { ours: 'c06-income.png', finmap: '06-income.png', path: 'log', act: openForm('Доход') },
```

Run: `npm run typecheck` → без ошибок.

- [ ] **Step 2: Run the visual check**

Run: `npm run shots:ux`
Expected: `Готово: …\parity\index.html — снято 51 из 51.` Если сценарий упал, исправьте его локатор и запустите ещё раз.

- [ ] **Step 3: Compare and write the parity note into the task report**

Пары `docs/research/screens/v2/<Finmap>` ↔ `docs/research/screens/v2/parity/<наш>`: `05-op-edit` ↔ `c05-op-edit`, `16-transfer` ↔ `c16-transfer` (раскладка перевода, с ней сравнить `c05d-converted-transfer`). `c05c-convert-confirm` и `c05d-converted-transfer` — без пары.

В отчёт задачи (не в файл) — таблица по этим экранам с отметкой для каждого: «совпадает», «отличается намеренно (почему)» или «отличается (что исправить, в каком плане)». Ожидаемо:
- **совпадают:**
  - строки-действия правки расхода в порядке Finmap: «Зарплата за …» / «Дата сделки отличается», «Разделить платёж», «Добавить проект, тег, комментарий, файл», «Изменить в перевод» со значком ⇄, «Дублировать платёж», «Удалить платёж»;
  - раскладка перевода после перестройки — как у «Нового перевода»: дата, «Со счёта», «На счёт», сумма;
- **отличаются намеренно:**
  - подтверждение «Изменить в перевод?» со списком потерь — наше умолчание (§6.8, §14.1: у Finmap не снято);
  - окно перевода называется «Перевод», кнопка — «Сохранить изменения» (правка);
  - нет «Сделать повторяющимся» (этап 3);
  - цвета и шрифт;
- **отличается:** не ожидается; если найдётся — отдельной строкой таблицы с пометкой «в отложенные».

- [ ] **Step 4: README — итог этапа 1.5**

В `README.md`:

1. Замените `Сделаны шаги 1–8 этапа 1 (§11 спецификации):` на `Сделаны шаги 1–8 этапа 1 (§11 спецификации) и этап 1.5 — интерфейс как в Finmap:`.

2. Замените

```
  - контрагента, категорию, проект и тег можно создать прямо из формы; «Сохранить и создать похожий»;
```

на

```
  - контрагента, категорию, проект и тег можно создать прямо из формы; «+ Добавить и создать похожий»;
```

3. Замените блок

```
- **Телефон и PWA (шаг 7):**
  - на экране уже 768 px журнал — карточками (сумма, категория, счёт, дата), касание открывает операцию на весь экран;
  - поиск на виду, период, суммы, сортировка, окно «Фильтр», сохранённые фильтры и выгрузка — в панели «Фильтры» справа;
  - счета и «Всего на счетах» — по кнопке «Счета» в шапке, панель выезжает слева;
  - внизу закреплены кнопки «Доход», «Расход», «Перевод»;
  - массовых действий и «Указать» на телефоне нет — они в таблице на компьютере;
```

на

```
- **Телефон и PWA (шаг 7, этап 1.5):**
  - на экране уже 768 px журнал — карточками (дата и сумма, контрагент, счёт, категория), касание открывает операцию на весь экран;
  - шапка: ☰ «Счета» (панель со счетами и «Всего на счетах» выезжает слева), название компании, шестерёнка; под ней кнопки «+ − ⇄»; внизу вкладки «Журнал | Ещё»;
  - над списком «Поиск | ⟳ | воронка | ▾»: воронка открывает окно «Фильтры» на весь экран — период, условия, сумма, сортировка, выгрузка;
  - настройки — экран со списком разделов, каждый раздел — на весь экран;
  - массовых действий и «Указать» на телефоне нет — они в таблице на компьютере;
```

4. Замените блок

```
- **Интерфейс как в Finmap (этап 1.5, план 1.5-1):**
  - везде «Категория»: в интерфейсе, сообщениях и выгрузке в Excel;
  - суммы без нулевых копеек; в левой панели и итогах компаний ₸ стоит перед суммой; балансы обновляются при возврате на вкладку;
  - окна с «×» в шапке; при закрытии формы с изменениями — окно «Ваши данные не сохранятся» с «Больше не спрашивать» (вернуть вопрос — в «Настройках журнала»);
  - шапка: блок компании с панелью «Компании» (поиск, итоги, ✎, «Добавить компанию»), иконки «История действий» и «Настройки»; «Выйти» — в панели «Настройки»;
  - настройки — отдельная зона с меню разделов по группам и «← Назад к журналу»; левая панель и меню сворачиваются одной кнопкой.
```

на

```
- **Интерфейс как в Finmap (этап 1.5):**
  - везде «Категория»: в интерфейсе, сообщениях и выгрузке в Excel;
  - суммы без нулевых копеек; в левой панели и итогах компаний ₸ стоит перед суммой; балансы обновляются при возврате на вкладку;
  - окна с «×» в шапке; при закрытии формы с изменениями — окно «Ваши данные не сохранятся» с «Больше не спрашивать» (вернуть вопрос — в «Настройках журнала»);
  - шапка: блок компании с панелью «Компании» (поиск, итоги, ✎, «Добавить компанию»), кнопки «+ Доход», «− Расход», «⇄ Перевод», иконки «История действий» и «Настройки»; «Выйти» — в панели «Настройки»;
  - журнал: тулбар в одну строку — меню периода («За предыдущий год», «Выбрать даты»), поиск, «Фильтр | ▾» с быстрыми фильтрами, «Ещё» (сумма, ⟳, колонки, выгрузка); дата в две строки, колонка «Дата сделки», «Показывать полностью»; «Указать» и «Изменить данные» — окнами; итог выделения по типам;
  - форма операции: отдельное окно на тип, поля в порядке Finmap с плавающими подписями, дата и время оплаты с календарём, калькулятор, поиск и «+ Создать» прямо в полях списков, последний выбранный счёт; строки-действия «Дата сделки отличается» (у зарплаты — «Зарплата за {месяц}»), «Разделить платёж», «Добавить проект, тег, комментарий, файл» (файлы можно перетащить), «Изменить в перевод», «Дублировать платёж», «Удалить платёж»;
  - «Изменить в перевод»: доход или расход становится переводом с тем же номером, файлами и историей; что будет убрано (категория, контрагент, разбиение, дата сделки) — в подтверждении; у дохода между валютами прежняя сумма становится суммой зачисления;
  - панель «История действий» по иконке в шапке: последние операции, «Тип: Расход → Перевод» у смены типа, «Подробнее» — полная лента;
  - настройки — отдельная зона с меню разделов по группам и «← Назад к журналу»: списки с поиском и перетаскиванием (мышью, пальцем, Alt+↑/↓), категории и контрагенты с подменю, «Настройки журнала»; «Мои счета» с «+ ✎ ⟳»; левая панель и меню сворачиваются одной кнопкой.
```

- [ ] **Step 5: Final checks**

Run: `npm test` → PASS. Run: `npm run typecheck`. Run: `npm run test:e2e` → все проходят (139).

Терминология README: `grep -n "Статья\|статья\|статьи" README.md` → пусто. Тест `tests/shared/terminology.test.ts` входит в `npm test` и тоже проверяет README.

- [ ] **Step 6: Commit**

```bash
git add scripts/ux-shots.ts README.md
git commit -m "feat: сверка с Finmap — «Изменить в перевод» в правке, подтверждение и форма перевода; README — итог этапа 1.5

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## После плана

- Итоги, отложенные замечания и итог визуальной сверки — `docs/superpowers/followups/2026-10-12-stage1_5-plan6-followups.md` (пишет контролёр).
- План 1.5-6 закрывает этап 1.5 целиком: §6.7 строка 4, §6.8, §10.1, новые e2e §12.1 («Изменить в перевод», расход и доход). README обновлён по §13 («итог этапа»).
- Следующий шаг — этап 2 (отчёты). Вкладка «Аналитика» добавляется второй после «Журнала» (§1, §3.5, §8.3).
