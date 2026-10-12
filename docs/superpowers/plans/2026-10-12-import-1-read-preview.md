# Импорт и экспорт, план И-1: импорт — чтение файла и проверка (сервер) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** первый план импорта (§14 спецификации): сервер читает файл Finmap (`.xlsx` или `.csv`) и показывает проверку без записи.
- **Чтение без пакетов:** ZIP с пределами распаковки, безопасный XML, первый лист XLSX, CSV в UTF-8, UTF-16LE и cp1251, тип файла.
- **Разбор строк:** тип, суммы, даты, начисление, справочники, каталог ошибок и предупреждений (§4).
- **Предпросмотр:** миграция `0006`; сопоставление счетов и справочников; суммы и курсы; дубликаты; движение и остатки счетов (§5).
- **HTTP:** `POST …/imports/upload` и `…/imports/preview` с кэшем проверки, `GET /api/v1/imports/template.xlsx`; писатель XLSX — несколько листов и общие строки.

В базу ничего не пишется (кроме самой миграции), исходный файл на диск не попадает. Запись, панель и отмена — планы И-2 и И-3.

**Предусловие:** ветка `stage1/plan1-skeleton` на коммите этого плана (после 8d79361). Ожидаемо на старте:
- `npm test` — 846 пройдено и 1 пропущен;
- `npm run typecheck` — без ошибок;
- `npm run test:e2e` — 142 из 142;
- `shots:ux` — 51 из 51.

**Architecture:**
- **Модуль `src/server/modules/imports/`**, слои снизу вверх, каждый — чистые функции с модульными тестами:
  - `zip.ts` — центральный каталог, только нужные записи, `zlib.inflateRawSync` с `maxOutputLength`, `zlib.crc32`;
  - `xml.ts` — потоковый разбор через `indexOf`, без рекурсии; DOCTYPE и ENTITY — отказ сразу;
  - `xlsx-read.ts` — первый лист по связи, общие строки, типы ячеек → `SheetData`;
  - `csv.ts` и `read-file.ts` — кодировка, разделитель, RFC 4180; тип файла → тот же `SheetData`;
  - `parse-row.ts` — заголовки и строки → `ParsedFile` (строки `ImportRow`, плановые, замечания);
  - `match.ts` — сопоставление справочников по `nameKey` над загруженными справочниками;
  - `preview.ts` — счета, суммы в валютах счетов, дубликаты, движение → `ImportPreview` и `ImportPlan` (план записи для И-2);
  - `cache.ts`, `service.ts`, `routes.ts`, `template.ts` — кэш проверки, HTTP и шаблон.
- **Общее:** `src/shared/finmap-format.ts` (колонки A–P, `headerKey`, `nameKey`, `repairName`, системные названия) и `src/shared/schemas/imports.ts` (`AccountMapping`, тело запроса, тип `ImportPreview`) — их возьмёт клиент в И-2.
- **Ошибки:** файл — 400 `IMPORT_FILE`, код F* в `details.fileCode`; строки и счета — внутри предпросмотра.

**Tech Stack:** Node 24 (`zlib.inflateRawSync`, `zlib.crc32`, `TextDecoder('windows-1251')`, `crypto`), TypeScript, Fastify 5, zod 4, Drizzle 0.45 + better-sqlite3, Vitest. Новых пакетов нет.

**Spec:** [docs/superpowers/specs/2026-10-12-import-export-design.md](../specs/2026-10-12-import-export-design.md):
- основное: §2 (формат), §3 (чтение), §4 (правила колонок и каталог), §5.4–§5.5 (счета, дубликаты), §6.1–§6.3 (миграция, маршруты, кэш), §8.2 (писатель: листы и общие строки), §9 (безопасность), §11.1–§11.2 (тесты);
- §14, план И-1, и блок «Решения планирования плана И-1» (добавлен тем же коммитом, что и план).

Исследование — [docs/research/import-export-finmap.md](../../research/import-export-finmap.md). **Настоящий файл владельца не используется и не упоминается:** все тесты — на синтетических файлах, собранных в коде (`tests/helpers/finmap-like.ts`, `tests/helpers/zip-build.ts`).

**Ветка:** `stage1/plan1-skeleton`. В `main` не сливаем.

## Решения, принятые при планировании

Записаны в спецификацию (§14, блок «Решения планирования плана И-1», №1–№14) тем же коммитом, что и план.

1. **Задачи — 7 вместо 6.**
   - `src/shared/finmap-format.ts` делается в задаче 3 вместе с CSV: разделитель CSV выбирается по числу распознанных заголовков §2.1.
   - Сопоставление справочников вынесено в `modules/imports/match.ts` — чистая функция над загруженными справочниками. Оно идёт задачей 5 вместе с миграцией; предпросмотр — задача 6; маршруты, кэш, писатель и шаблон — задача 7.
   - Новые файлы модуля сверх §3: `read-file.ts` (тип файла), `match.ts`, `template.ts`.
2. **`nameKey` — после `foldCase` (уточнение §4.9).**
   - Ключ: `foldCase(cleanName(s))`, затем строчные латинские двойники `a b c e h k m o p t x y` → `а в с е н к м о р т х у`.
   - Порядок §4.9 («двойники, затем регистр») давал разные ключи у «STEAM» и «Steam», «Kaspi» и «kaspi»: у строчных b, h, k, m, t нет кириллической пары.
   - Ключ зависит только от `foldCase(cleanName(s))`. Поэтому совпадение `tagKey` (уникальный индекс тегов) и `ulower` (проверка имени проекта) влечёт совпадение `nameKey`: новый тег или проект не нарушит уникальность.
   - `headerKey` — тот же ключ без `*` и кавычек. `repairName` — как в §4.9, набор двойников спецификации.
3. **ZIP.**
   - `maxOutputLength` — объявленный размер записи (он уже проверен: не больше предела части), а не сам предел. Бомба обрывается раньше.
   - Ещё F3: повтор имени записи; пустой сегмент пути (`a//b`); данные записи за началом центрального каталога.
   - Тексты: «Файл повреждён или небезопасен: {причина}»; шифрование — «Файл защищён паролем — сохраните его без пароля».
4. **F5 — уже при чтении.** Читатели XLSX и CSV останавливаются на 50 011-й непустой строке: данных не больше 50 000, плюс заголовки и до 9 строк над ними. Точная проверка 50 000 строк данных — после поиска заголовков.
5. **Числа и ячейки.**
   - Число из ячейки XLSX сначала округляется до 15 значащих цифр (точность Excel). Хвосты двоичной дроби (`1317.0000000000002`) не дают ни округления, ни W10.
   - W10 — только когда значимых знаков после запятой больше, чем у валюты. У E — в предпросмотре (валюта счёта), у F — при разборе (валюта компании).
   - Ошибка Excel (`t="e"`) в любой распознанной колонке — R18 (§4.10 «любая»). Текст длиннее 32 767 символов — тоже R18.
6. **Строки.**
   - Плановая строка (дата в будущем) пропускается без других проверок, только с W1.
   - F = 0 — как пустая. Отрицательная F у дохода — R10.
   - Номер строки CSV — номер записи: перевод строки внутри кавычек не сдвигает нумерацию.
   - R11 называет колонку: «дату начисления», «начало периода начисления», «конец периода начисления».
   - Разделитель в текстовой дате — любой одиночный символ, кроме цифры и пробела.
7. **Группы замечаний.**
   - Группа — пара «код + текст»: R17 — одна группа на название, R16 — на валюту и дату.
   - Не больше 100 групп; `errors.total` — число всех ошибок строк.
   - W1 — «…, строки пропущены», число — в `count`. У W8 номеров строк нет.
8. **`ImportPreview` (уточнение §6.3).**
   - `accounts[].mapping = null`, когда подходит несколько счетов (A1); `currency = null`, когда счёт не выбран или валюта неизвестна.
   - Выбран несуществующий счёт — A1 «Выберите счёт для «…»».
   - Валюта нового счёта проверяется по таблице `currencies` (иначе A2).
   - A4 — стартовый баланс вне безопасного целого.
9. **Счета в строках.**
   - Строки счёта с ошибкой в карточке не входят ни в «будет добавлено», ни в движение.
   - Перевод между двумя названиями из файла, сопоставленными одному счёту, — R09.
   - Перевод между двумя небазовыми валютами без курса — R16 по валюте зачисления.
10. **«Будет создано» и план записи.**
    - При ошибках списки могут включать элементы строк с ошибками; при `canImport = true` они точные.
    - Предпросмотр строит и `ImportPlan` — его берёт запись в И-2: строки по `(paidAt, строка)`, новые счета со `startingBalance` и `openedAt`, изменения существующих счетов, новые справочники в порядке создания.
11. **HTTP.**
    - `upload` и `preview` отвечают объектом `ImportPreview` без обёртки (§6.2).
    - Неверный формат токена — 400 `VALIDATION`; неизвестный, чужой или истёкший токен — 410.
    - Пустое тело `upload` — F1; тело не байтами — 400 `VALIDATION` `{ file: 'Нет файла' }`.
    - Имя файла — `cleanName`, до 200 символов, пустое — «Файл». Разбор `X-File-Name` (`headerFileName`) вынесен в `http/params.ts` и общий с вложениями.
12. **Кэш.** При переполнении вытесняется запись с самым давним обращением. Токен — 32 шестнадцатеричных символа.
13. **Писатель и шаблон.**
    - `buildXlsx(sheet | sheets[], { strings })`; общие строки собираются при записи листов. Один лист с inline-строками пишется, как раньше, — выгрузка журнала не меняется.
    - Шаблон «Шаблон импорта.xlsx»:
      - «Шаблон» — заголовки A–P со звёздочками;
      - «Инструкция» — те же заголовки, строки 2–4 — примеры (доход, расход, перевод), ниже — правила в колонке A.
    - Скачивание — по сессии.
14. **`shots:ux`.** Экранов в И-1 нет: последняя задача прогоняет `shots:ux` для проверки (51), `scripts/ux-shots.ts` не меняется.

## Global Constraints

- **Без новых npm-пакетов и сети (§3).** Только встроенные модули Node: `zlib.inflateRawSync(…, { maxOutputLength })`, `zlib.crc32`, `TextDecoder('windows-1251')`, `crypto`. `adm-zip` чужие файлы не читает: он верит размерам из заголовков.
- **Пределы (§2.3, §2.4, §3.1, §3.2, §2.5):**
  - загрузка — 30 МБ (`IMPORT_MAX_BYTES`), больше — 413 `TOO_LARGE` «Файл больше 30 МБ»;
  - распаковка: лист 64 МБ, `sharedStrings.xml` 32 МБ, `workbook.xml` и `.rels` по 1 МБ, всё вместе 100 МБ; не больше 1 000 записей в архиве;
  - XML: глубина 64, атрибутов 64; ячейка до 32 767 символов; общих строк до 1 000 000;
  - CSV: до 64 полей и 1 МБ на строку;
  - не больше 50 000 строк данных.
- **Безопасность (§9):** DOCTYPE и ENTITY — отказ; раскрываются только `&lt; &gt; &amp; &quot; &apos;` и числовые ссылки; на диск ничего не пишется, имена записей с `..`, `\`, `/` в начале и не-ASCII отклоняют весь архив; ZIP64, шифрование, неизвестные методы — F3; CRC-32 и фактический размер сверяются.
- **Ошибки:**
  - `AppError(status, code, message, fields?, details?)`, ответ `{error:{code,message,fields?,details?}}`;
  - ошибка файла — 400 `IMPORT_FILE`, `details.fileCode` = `F1…F8`, тексты §4.10;
  - 410 `IMPORT_EXPIRED`; архивная компания — 422 `ARCHIVED_REFERENCE` до разбора файла (`requireCompany(…, { writable: true })`).
- **Данные:** в И-1 предпросмотр ничего не пишет; единственное изменение базы — миграция `0006` (`npm run db:generate`). Деньги — целые минимальные единицы; даты — `YYYY-MM-DD` и момент по часам `APP_TIMEZONE` (`Asia/Almaty`).
- **Реальные данные** в тестах и репозитории запрещены: только выдуманные названия («Касса-1», «Банк-2», «Сотрудник А»).
- **Терминология:** «Категория», никогда «Статья» (`tests/shared/terminology.test.ts`).
- **Невидимые и двойниковые символы** (U+2212, U+00A0, U+202F, U+200B, латинские двойники кириллицы) в коде — только экранированием `\u2212`, `\u0061` и т. п.
- **Концы строк:** правки «найдите → замените» делайте инструментом правки файлов; если текст разошёлся с планом пробелами, копируйте его из файла.
- **Безопасность среды (обязательно):**
  - никогда не запускайте `npm start`, `npm run stop`, `npm run setup`, `npm run service:install`, `npm run service:uninstall`, `schtasks` и `icacls` — ни в каком виде. На порту 3457 работает живое приложение пользователя, на порту 3460 — демо-экземпляр; их не трогайте;
  - e2e идут на порту 41731 со своей временной базой; `npm run shots:ux` — на порту 41741 со своей временной папкой;
  - shell-команды не содержат подстроку «.env».
- **Завершение задачи:**
  - зелёные `npm test` и `npm run typecheck`;
  - задача 7 (маршруты, обработчик 413, писатель XLSX) — ещё `npm run test:e2e` один раз и `npm run shots:ux`;
  - коммит с трейлером `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`;
  - в коммит попадает каждый новый файл задачи.

## Review Focus

1. **Настоящая выгрузка Finmap.** Заголовки с латинскими двойниками («Дата платежа» с латинской a, «Сумма в валюте компании» с C, y, a, o, «На счет» с H), ячейки `t="str"` и пустые `t="str"` без `<v>`, даты — числа Excel с долей суток, период начисления текстом «01.09.2026 00:00:00». Ожидание: все 16 колонок распознаны, время — до секунды, «Зарплата за сентябрь» получает дату начисления 01.09.2026. Тесты: задача 2 (чтение файла «как у Finmap»), задача 3 (`headerField` всех заголовков-двойников), задача 4 (разбор файла «как у Finmap»).
2. **Операции около полуночи.** 23:30 и 00:30 по Алматы попадают в свои календарные дни; «сегодня» в Алматы — не плановая операция, «завтра» — пропуск с W1. Тест: задача 4.
3. **Хвосты двоичной дроби Excel** (`1317.0000000000002`). Сумма ровно 1 317,00, без W10 и без «лишних знаков». Тесты: задача 4 (`parseCellNumber`), задача 6 (строка файла в предпросмотре).
4. **Враждебный файл через маршрут загрузки:** zip-бомба с ложным размером, XXE, `../` в имени записи, файл больше 30 МБ, запрос без сессии или без `X-Requested-With`. Ожидание: отказ с понятным кодом (F3, 413, 401, 403), ничего не распаковано сверх объявленного, сервер отвечает дальше. Тесты: задачи 1–3 (модульно), задача 7 (через HTTP).
5. **Файл реального объёма — 16 000 строк.** Загрузка и пересчёт предпросмотра без квадратичных проходов; ответ меньше 200 КБ. Тест: задача 7 (бюджет с запасом: 15 с и 5 с; §10 — 3 с и 1 с на эталонной машине).

---

## Карта файлов

```
src/server/modules/imports/errors.ts       # 400 IMPORT_FILE (F1–F8), пределы строк, каталог R/W/A, группы замечаний
src/server/modules/imports/zip.ts          # ZIP: каталог, имена, пределы, inflateRawSync, CRC-32
src/server/modules/imports/xml.ts          # безопасный потоковый XML
src/server/modules/imports/xlsx-read.ts    # первый лист XLSX → SheetData (Cell, SheetRow)
src/server/modules/imports/csv.ts          # CSV: кодировка, разделитель, RFC 4180
src/server/modules/imports/read-file.ts    # тип файла (§3.4), IMPORT_MAX_BYTES
src/server/modules/imports/parse-row.ts    # заголовки, суммы, даты, строки → ParsedFile
src/server/modules/imports/match.ts        # сопоставление справочников (чистая функция)
src/server/modules/imports/preview.ts      # предпросмотр и план записи
src/server/modules/imports/cache.ts        # кэш проверки
src/server/modules/imports/template.ts     # шаблон импорта
src/server/modules/imports/service.ts      # upload, preview, template
src/server/modules/imports/routes.ts       # HTTP
src/shared/finmap-format.ts                # колонки A–P, headerKey, nameKey, repairName, systemKeyOf
src/shared/schemas/imports.ts              # AccountMapping, importRequestSchema, ImportPreview
src/server/db/schema.ts                    # imports, operations.importId
src/server/db/migrations/0006_*.sql, meta/ # npm run db:generate
src/server/http/xlsx.ts                    # buildXlsx: несколько листов, общие строки
src/server/http/params.ts                  # headerFileName (общий с вложениями)
src/server/modules/attachments/routes.ts   # headerFileName из http/params
src/server/errors.ts                       # 413 «Файл больше 30 МБ» у загрузки импорта
src/server/app.ts                          # маршруты импорта
tests/helpers/zip-build.ts, tests/helpers/finmap-like.ts
tests/server/import-zip|import-xml|import-xlsx|import-csv|import-parse-row|import-match|import-preview|import-cache.test.ts
tests/server/schema-0006.test.ts, tests/server/xlsx-writer.test.ts, tests/server/imports-api.test.ts
tests/shared/finmap-format.test.ts
```

---

### Task 1: ZIP — чтение с пределами (§3.1)

**Files:**
- Create: `src/server/modules/imports/errors.ts`, `src/server/modules/imports/zip.ts`, `tests/helpers/zip-build.ts`
- Test: `tests/server/import-zip.test.ts`

**Interfaces:**
- Consumes: `AppError` (`src/server/errors.ts`).
- Produces:
  - `errors.ts`: `type FileErrorCode`; `fileError(code, message): AppError` (400 `IMPORT_FILE`, `details: { fileCode }`); `damaged(reason): AppError` (F3 «Файл повреждён или небезопасен: {причина}»); `IMPORT_MAX_ROWS = 50_000`; `IMPORT_READ_MAX_ROWS = 50_010`; `tooManyRows(): AppError` (F5);
  - `zip.ts`: `interface ZipArchive { names(): string[]; has(name): boolean; read(name, limit): Buffer | null }`; `openZip(data: Buffer, opts?: { maxEntries?; maxTotal? }): ZipArchive`; `isSafeEntryName(name): boolean`; `ZIP_MAX_ENTRIES = 1000`; `ZIP_MAX_TOTAL = 100 МБ`;
  - `tests/helpers/zip-build.ts`: `buildZip(entries: ZipBuildEntry[], opts?: ZipBuildOptions): Buffer` — stored и deflate, с подменой размера, CRC, флагов, метода, локального имени, дескриптором данных, признаками ZIP64 и многотомности.

- [ ] **Step 1: Write the failing test**

Создайте `tests/helpers/zip-build.ts`:

```ts
import zlib from 'node:zlib';

/** Запись тестового архива; поля «подмены» портят архив нарочно (§11.1 спецификации импорта). */
export interface ZipBuildEntry {
  name: string;
  data: Buffer | string;
  /** 0 — stored, 8 — deflate (по умолчанию). */
  method?: 0 | 8;
  /** Код метода в заголовках вместо настоящего (например, 12 — bzip2). */
  methodCode?: number;
  /** Объявленный распакованный размер вместо настоящего. */
  declaredSize?: number;
  /** CRC-32 вместо настоящего. */
  crc?: number;
  /** Флаги общего назначения (бит 0 — шифрование). */
  flags?: number;
  /** Имя в локальном заголовке вместо имени каталога. */
  localName?: string;
  /** Бит 3: размеры и CRC — в дескрипторе после данных, в локальном заголовке нули. */
  descriptor?: boolean;
}

export interface ZipBuildOptions {
  /** Число записей в конце каталога вместо настоящего (0xFFFF — признак ZIP64). */
  totalEntries?: number;
  /** Смещение каталога вместо настоящего (0xFFFFFFFF — признак ZIP64). */
  cdOffset?: number;
  /** Номер диска (не 0 — многотомный архив). */
  disk?: number;
  comment?: string;
}

const u16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};

/** Маленький писатель ZIP для своих, в том числе испорченных, архивов. */
export function buildZip(entries: ZipBuildEntry[], opts: ZipBuildOptions = {}): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = typeof e.data === 'string' ? Buffer.from(e.data, 'utf8') : e.data;
    const method = e.method ?? 8;
    const body = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const crc = e.crc ?? zlib.crc32(raw);
    const size = e.declaredSize ?? raw.length;
    const code = e.methodCode ?? method;
    const flags = (e.flags ?? 0) | (e.descriptor ? 8 : 0);
    const name = Buffer.from(e.name, 'utf8');
    const localName = Buffer.from(e.localName ?? e.name, 'utf8');
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(flags), u16(code), u16(0), u16(0x21),
      u32(e.descriptor ? 0 : crc), u32(e.descriptor ? 0 : body.length), u32(e.descriptor ? 0 : size),
      u16(localName.length), u16(0), localName,
    ]);
    const descriptor = e.descriptor ? Buffer.concat([u32(0x08074b50), u32(crc), u32(body.length), u32(size)]) : Buffer.alloc(0);
    parts.push(local, body, descriptor);
    central.push(
      Buffer.concat([
        u32(0x02014b50), u16(20), u16(20), u16(flags), u16(code), u16(0), u16(0x21),
        u32(crc), u32(body.length), u32(size),
        u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
      ]),
    );
    offset += local.length + body.length + descriptor.length;
  }
  const cd = Buffer.concat(central);
  const comment = Buffer.from(opts.comment ?? '', 'latin1');
  const total = opts.totalEntries ?? entries.length;
  const eocd = Buffer.concat([
    u32(0x06054b50), u16(opts.disk ?? 0), u16(opts.disk ?? 0), u16(total), u16(total),
    u32(cd.length), u32(opts.cdOffset ?? offset), u16(comment.length), comment,
  ]);
  return Buffer.concat([...parts, cd, eocd]);
}
```

Создайте `tests/server/import-zip.test.ts`:

```ts
import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/server/errors';
import { isSafeEntryName, openZip } from '../../src/server/modules/imports/zip';
import { buildZip } from '../helpers/zip-build';

const MB = 1024 * 1024;

/** Ошибка файла импорта: 400 IMPORT_FILE с кодом F* и текстом. */
function fileErr(fn: () => unknown): { fileCode: string; message: string } {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    const err = e as AppError;
    expect(err.status).toBe(400);
    expect(err.code).toBe('IMPORT_FILE');
    return { fileCode: err.details!.fileCode!, message: err.message };
  }
  throw new Error('ожидалась ошибка файла');
}

describe('ZIP: чтение (§3.1 спецификации импорта)', () => {
  it('stored и deflate; имена в порядке каталога; нет записи — null', () => {
    const zip = openZip(buildZip([{ name: 'a.txt', data: 'привет', method: 0 }, { name: 'xl/b.xml', data: '<b/>'.repeat(1000) }]));
    expect(zip.names()).toEqual(['a.txt', 'xl/b.xml']);
    expect(zip.has('xl/b.xml')).toBe(true);
    expect(zip.read('a.txt', MB)!.toString('utf8')).toBe('привет');
    expect(zip.read('xl/b.xml', MB)!.toString('utf8')).toBe('<b/>'.repeat(1000));
    expect(zip.read('нет', MB)).toBeNull();
  });

  it('дескриптор данных (бит 3): размеры берутся из каталога; пустая запись; книга, собранная AdmZip', () => {
    const zip = openZip(buildZip([{ name: 'd.xml', data: 'данные', descriptor: true }, { name: 'empty', data: '' }]));
    expect(zip.read('d.xml', MB)!.toString('utf8')).toBe('данные');
    expect(zip.read('empty', MB)!.length).toBe(0);
    const adm = new AdmZip();
    adm.addFile('xl/workbook.xml', Buffer.from('<workbook/>'));
    expect(openZip(adm.toBuffer()).read('xl/workbook.xml', MB)!.toString()).toBe('<workbook/>');
  });

  it('CRC не совпал, фактический размер не равен объявленному — F3', () => {
    expect(fileErr(() => openZip(buildZip([{ name: 'a', data: 'abc', crc: 1 }])).read('a', MB)).message).toBe(
      'Файл повреждён или небезопасен: контрольная сумма «a» не совпала',
    );
    expect(fileErr(() => openZip(buildZip([{ name: 'a', data: 'abc', declaredSize: 10 }])).read('a', MB)).message).toBe(
      'Файл повреждён или небезопасен: размер «a» не совпадает с объявленным',
    );
    expect(fileErr(() => openZip(buildZip([{ name: 'a', data: 'abc', method: 0, declaredSize: 2 }])).read('a', MB)).fileCode).toBe('F3');
  });

  it('шифрование, неизвестный метод, ZIP64, многотомный архив — F3', () => {
    expect(fileErr(() => openZip(buildZip([{ name: 'a', data: 'x', flags: 1 }])).read('a', MB))).toEqual({
      fileCode: 'F3',
      message: 'Файл защищён паролем — сохраните его без пароля',
    });
    expect(fileErr(() => openZip(buildZip([{ name: 'a', data: 'x', method: 0, methodCode: 12 }])).read('a', MB)).message).toContain(
      'неизвестный способ сжатия',
    );
    expect(fileErr(() => openZip(buildZip([{ name: 'a', data: 'x' }], { totalEntries: 0xffff }))).message).toBe(
      'Файл повреждён или небезопасен: файл слишком велик (ZIP64)',
    );
    expect(fileErr(() => openZip(buildZip([{ name: 'a', data: 'x' }], { cdOffset: 0xffffffff }))).message).toContain('ZIP64');
    expect(fileErr(() => openZip(buildZip([{ name: 'a', data: 'x' }], { disk: 1 }))).message).toContain('многотомный');
  });

  it('больше 1 000 записей — F3 до чтения каталога; 1 000 — можно', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `f${i}`, data: '', method: 0 as const }));
    expect(openZip(buildZip(many(1000))).names()).toHaveLength(1000);
    expect(fileErr(() => openZip(buildZip(many(1001)))).message).toBe('Файл повреждён или небезопасен: больше 1000 записей в архиве');
  });

  it('имена ../x, /x, a\\b, ./x, a//b, не-ASCII и NUL — F3 всего архива (zip-slip, Review Focus)', () => {
    for (const name of ['../x', 'xl/../../x', '/x', 'a\\b', './x', 'a//b', 'имя', 'a\u0000b', 'x'.repeat(256)]) {
      expect(isSafeEntryName(name), name).toBe(false);
      expect(fileErr(() => openZip(buildZip([{ name, data: 'x' }]))).message, name).toBe(
        'Файл повреждён или небезопасен: недопустимое имя записи в архиве',
      );
    }
    for (const name of ['xl/workbook.xml', 'xl/', '[Content_Types].xml', 'a b.xml']) expect(isSafeEntryName(name), name).toBe(true);
  });

  it('повтор имени и имя локального заголовка, отличное от каталога, — F3', () => {
    expect(fileErr(() => openZip(buildZip([{ name: 'a', data: '1' }, { name: 'a', data: '2' }]))).message).toContain('встречается дважды');
    expect(fileErr(() => openZip(buildZip([{ name: 'a', data: '1', localName: 'b' }])).read('a', MB)).message).toContain('не совпадает с каталогом');
  });

  it('объявленный размер больше предела — F3 без распаковки', () => {
    const zip = openZip(buildZip([{ name: 'big', data: Buffer.alloc(2 * MB) }]));
    expect(fileErr(() => zip.read('big', MB)).message).toBe('Файл повреждён или небезопасен: часть «big» больше предела распаковки');
  });

  it('zip-бомба: 2 МБ нулей, объявлено 1 МБ при пределе 1 МБ — распаковка прерывается (Review Focus)', () => {
    const zip = openZip(buildZip([{ name: 'bomb', data: Buffer.alloc(2 * MB), declaredSize: MB }]));
    expect(fileErr(() => zip.read('bomb', MB)).message).toBe('Файл повреждён или небезопасен: часть «bomb» распаковывается больше объявленного размера');
  });

  it('предел распаковки всего архива: сумма частей больше maxTotal — F3', () => {
    const zip = openZip(buildZip([{ name: 'a', data: Buffer.alloc(600) }, { name: 'b', data: Buffer.alloc(600) }]), { maxTotal: 1000 });
    expect(zip.read('a', MB)!.length).toBe(600);
    expect(fileErr(() => zip.read('b', MB)).message).toBe('Файл повреждён или небезопасен: распакованный файл больше предела');
  });

  it('обрезанный архив, мусор, данные за пределами — F3', () => {
    const good = buildZip([{ name: 'a', data: 'abc'.repeat(100) }]);
    expect(fileErr(() => openZip(good.subarray(0, good.length - 30))).message).toBe('Файл повреждён или небезопасен: не найден конец архива');
    expect(fileErr(() => openZip(Buffer.from('не архив'))).fileCode).toBe('F3');
    expect(fileErr(() => openZip(Buffer.alloc(0))).fileCode).toBe('F3');
    // каталог (47 байт) и конец (22 байта) на месте, а из данных записи вырезана часть: смещения указывают не туда
    const cut = Buffer.concat([good.subarray(0, 35), good.subarray(good.length - 22 - 47)]);
    expect(fileErr(() => openZip(cut).read('a', MB)).fileCode).toBe('F3');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/import-zip.test.ts`
Expected: FAIL — модуль `src/server/modules/imports/zip` не найден.

- [ ] **Step 3: Write minimal implementation**

Создайте `src/server/modules/imports/errors.ts` (каталог ошибок строк задача 4 допишет в конец):

```ts
import { AppError } from '../../errors';

/** Ошибки файла (§4.10 спецификации импорта): предпросмотра нет, панель показывает сообщение. */
export type FileErrorCode = 'F1' | 'F2' | 'F3' | 'F5' | 'F6' | 'F7' | 'F8';

/** 400 IMPORT_FILE; код F* — в `details.fileCode`. */
export function fileError(code: FileErrorCode, message: string): AppError {
  return new AppError(400, 'IMPORT_FILE', message, undefined, { fileCode: code });
}

/** F3: файл повреждён или небезопасен (ZIP, XML, пределы распаковки). */
export function damaged(reason: string): AppError {
  return fileError('F3', `Файл повреждён или небезопасен: ${reason}`);
}

/** Не больше строк данных в файле (§2.3) — столько же, сколько выгрузка журнала (JOURNAL_EXPORT_MAX). */
export const IMPORT_MAX_ROWS = 50_000;
/** Непустых строк, которые читатель листа ещё принимает: данные, заголовки и до 9 строк над ними (§2.2). */
export const IMPORT_READ_MAX_ROWS = IMPORT_MAX_ROWS + 10;

/** F5: больше 50 000 строк данных. */
export function tooManyRows(): AppError {
  return fileError('F5', 'В файле больше 50 000 строк — разбейте его по годам');
}
```

Создайте `src/server/modules/imports/zip.ts`:

```ts
import zlib from 'node:zlib';
import { damaged, fileError } from './errors';

/**
 * Чтение ZIP чужого файла (§3.1 спецификации импорта) без пакетов: только центральный каталог, только
 * нужные записи, каждая — с пределом распаковки. На диск ничего не пишется: записи ищутся по точному имени.
 */
export interface ZipArchive {
  /** Имена записей в порядке каталога. */
  names(): string[];
  has(name: string): boolean;
  /**
   * Распакованная запись; null — такой записи нет. Объявленный размер больше limit — F3 без распаковки;
   * распаковка прерывается за объявленным размером (zip-бомба); CRC-32 сверяется.
   */
  read(name: string, limit: number): Buffer | null;
}

export interface ZipOptions {
  /** Не больше записей в каталоге (1 000). */
  maxEntries?: number;
  /** Не больше распакованных байтов всего (100 МБ). */
  maxTotal?: number;
}

export const ZIP_MAX_ENTRIES = 1000;
export const ZIP_MAX_TOTAL = 100 * 1024 * 1024;

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
/** 22 байта конца каталога и до 65 535 байт комментария. */
const EOCD_MIN = 22;
const EOCD_SEARCH = EOCD_MIN + 0xffff;

interface Entry {
  name: string;
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

/** Имя записи: печатный ASCII до 255 символов; без `\`, `/` в начале, сегментов `..` и `.` и пустых сегментов (zip-slip). */
export function isSafeEntryName(name: string): boolean {
  if (name.length === 0 || name.length > 255) return false;
  if (!/^[\x20-\x7e]+$/.test(name) || name.includes('\\') || name.startsWith('/')) return false;
  const segments = name.endsWith('/') ? name.slice(0, -1).split('/') : name.split('/');
  return segments.every((s) => s !== '' && s !== '.' && s !== '..');
}

function findEocd(data: Buffer): number {
  const stop = Math.max(0, data.length - EOCD_SEARCH);
  for (let i = data.length - EOCD_MIN; i >= stop; i--) {
    if (data.readUInt32LE(i) === SIG_EOCD) return i;
  }
  return -1;
}

export function openZip(data: Buffer, opts: ZipOptions = {}): ZipArchive {
  const maxEntries = opts.maxEntries ?? ZIP_MAX_ENTRIES;
  const maxTotal = opts.maxTotal ?? ZIP_MAX_TOTAL;
  if (data.length < EOCD_MIN) throw damaged('не найден конец архива');
  const eocd = findEocd(data);
  if (eocd < 0) throw damaged('не найден конец архива');

  const disk = data.readUInt16LE(eocd + 4);
  const cdDisk = data.readUInt16LE(eocd + 6);
  const onDisk = data.readUInt16LE(eocd + 8);
  const total = data.readUInt16LE(eocd + 10);
  const cdSize = data.readUInt32LE(eocd + 12);
  const cdOffset = data.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw damaged('файл слишком велик (ZIP64)');
  if (disk !== 0 || cdDisk !== 0 || onDisk !== total) throw damaged('многотомный архив');
  if (total > maxEntries) throw damaged(`больше ${maxEntries} записей в архиве`);
  if (cdOffset + cdSize > eocd) throw damaged('каталог архива за пределами файла');

  const entries = new Map<string, Entry>();
  let p = cdOffset;
  const cdEnd = cdOffset + cdSize;
  for (let n = 0; n < total; n++) {
    if (p + 46 > cdEnd || data.readUInt32LE(p) !== SIG_CENTRAL) throw damaged('каталог архива повреждён');
    const nameLen = data.readUInt16LE(p + 28);
    const extraLen = data.readUInt16LE(p + 30);
    const commentLen = data.readUInt16LE(p + 32);
    const next = p + 46 + nameLen + extraLen + commentLen;
    if (next > cdEnd) throw damaged('каталог архива повреждён');
    const entry: Entry = {
      name: data.toString('latin1', p + 46, p + 46 + nameLen),
      flags: data.readUInt16LE(p + 8),
      method: data.readUInt16LE(p + 10),
      crc: data.readUInt32LE(p + 16),
      compressedSize: data.readUInt32LE(p + 20),
      size: data.readUInt32LE(p + 24),
      localOffset: data.readUInt32LE(p + 42),
    };
    if (entry.compressedSize === 0xffffffff || entry.size === 0xffffffff || entry.localOffset === 0xffffffff) {
      throw damaged('файл слишком велик (ZIP64)');
    }
    if (!isSafeEntryName(entry.name)) throw damaged('недопустимое имя записи в архиве');
    if (entries.has(entry.name)) throw damaged(`запись «${entry.name}» встречается дважды`);
    entries.set(entry.name, entry);
    p = next;
  }

  let unpacked = 0;

  function read(name: string, limit: number): Buffer | null {
    const e = entries.get(name);
    if (!e) return null;
    if (e.flags & 1) throw fileError('F3', 'Файл защищён паролем — сохраните его без пароля');
    if (e.method !== 0 && e.method !== 8) throw damaged(`неизвестный способ сжатия у «${name}»`);
    if (e.size > limit) throw damaged(`часть «${name}» больше предела распаковки`);
    if (unpacked + e.size > maxTotal) throw damaged('распакованный файл больше предела');

    const lh = e.localOffset;
    if (lh + 30 > cdOffset || data.readUInt32LE(lh) !== SIG_LOCAL) throw damaged(`запись «${name}» повреждена`);
    const nameLen = data.readUInt16LE(lh + 26);
    const extraLen = data.readUInt16LE(lh + 28);
    if (data.toString('latin1', lh + 30, lh + 30 + nameLen) !== name) throw damaged(`имя записи «${name}» не совпадает с каталогом`);
    const start = lh + 30 + nameLen + extraLen;
    if (start + e.compressedSize > cdOffset) throw damaged(`данные «${name}» за пределами файла`);
    const raw = data.subarray(start, start + e.compressedSize);

    let out: Buffer;
    if (e.method === 0) {
      if (e.compressedSize !== e.size) throw damaged(`размер «${name}» не совпадает с объявленным`);
      out = raw;
    } else {
      try {
        // выход за объявленный размер (он уже не больше предела) прерывает распаковку: защита от zip-бомбы
        out = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(1, e.size) });
      } catch (err) {
        if ((err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') throw damaged(`часть «${name}» распаковывается больше объявленного размера`);
        throw damaged(`не удалось распаковать «${name}»`);
      }
      if (out.length !== e.size) throw damaged(`размер «${name}» не совпадает с объявленным`);
    }
    if (zlib.crc32(out) >>> 0 !== e.crc >>> 0) throw damaged(`контрольная сумма «${name}» не совпала`);
    unpacked += out.length;
    return out;
  }

  return {
    names: () => [...entries.keys()],
    has: (name) => entries.has(name),
    read,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/import-zip.test.ts`
Expected: PASS, 11 тестов.

Run: `npm test` и `npm run typecheck`
Expected: 857 пройдено и 1 пропущен; typecheck без ошибок.

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/imports/errors.ts src/server/modules/imports/zip.ts tests/helpers/zip-build.ts tests/server/import-zip.test.ts
git commit -m "feat: импорт — чтение ZIP с пределами распаковки и защитой от zip-бомбы" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Безопасный XML, первый лист XLSX и файл «как у Finmap» (§3.2, §3.3)

**Files:**
- Create: `src/server/modules/imports/xml.ts`, `src/server/modules/imports/xlsx-read.ts`, `tests/helpers/finmap-like.ts`
- Test: `tests/server/import-xml.test.ts`, `tests/server/import-xlsx.test.ts`

**Interfaces:**
- Consumes: `damaged`, `fileError`, `IMPORT_READ_MAX_ROWS`, `tooManyRows` (задача 1); `openZip`, `ZIP_MAX_ENTRIES`, `ZIP_MAX_TOTAL` (задача 1); `buildZip` (задача 1); `buildXlsx` (`src/server/http/xlsx.ts`, как есть).
- Produces:
  - `xml.ts`: `interface XmlHandler { open(name, attrs); text(value); close(name) }`; `scanXml(xml: string, h: XmlHandler, limits?: { maxDepth?; maxAttrs? }): void`; `decodeXmlText(s): string`; `XML_MAX_DEPTH = 64`; `XML_MAX_ATTRS = 64`;
  - `xlsx-read.ts`: `interface Cell { kind: 'number' | 'text' | 'error'; value: string }`; `interface SheetRow { row: number; cells: Map<number, Cell> }`; `interface SheetData { rows: SheetRow[]; date1904: boolean }`; `CELL_TOO_LONG = '#TOO_LONG'`; `CELL_MAX_CHARS = 32_767`; `interface XlsxLimits`; `XLSX_LIMITS`; `columnIndex(ref): number | null`; `resolvePart(target): string`; `readXlsx(data: Buffer, limits?: XlsxLimits): SheetData`;
  - `tests/helpers/finmap-like.ts`: `FINMAP_LIKE_HEADERS`; `type FinmapLikeValue = string | number | null`; `excelSerial(date, time?): number`; `finmapLikeRow({ paidAt, amount, accrual?, periodFrom?, periodTo?, baseAmount?, from?, to?, category?, subcategory?, counterparty?, subcounterparty?, project?, subproject?, tags?, comment? }): FinmapLikeValue[]`; `finmapLikeSample(): FinmapLikeValue[][]`; `finmapLikeSheetXml(rows): string`; `finmapLikeXlsx(rows?, opts?: { headers?; leadRows?; sheetName?; date1904? }): Buffer`.

- [ ] **Step 1: Write the failing tests**

Создайте `tests/helpers/finmap-like.ts` — синтетический файл «как у Finmap». Латинские буквы в заголовках записаны экранированием `\u0061` и т. п.: не «исправляйте» их.

```ts
import { buildZip } from './zip-build';

/**
 * Синтетический файл «как у Finmap» (§11.1 спецификации импорта): лист ExportRU, заголовки с латинскими двойниками,
 * ячейки `t="str"`, пустые `t="str"` без `<v>`, даты — числа Excel с долей суток. Названия выдуманные.
 * Настоящий файл владельца в тестах не используется.
 */

/**
 * Заголовки A–P настоящей выгрузки: в части букв — латиница (экранировано, чтобы правка не «починила» её).
 * Латинские буквы: «Дата платежа» — a; «Сумма в валюте компании» — C, y, a, a, o, a; «На счет» — H; «Категория» — K, o; «Теги» — T.
 */
export const FINMAP_LIKE_HEADERS: readonly string[] = [
  'Дата пл\u0061тежа',
  'Дата начисления',
  'Период начисления (дата "с")',
  'Период начисления (дата "по")',
  'Сумма в валюте счета',
  '\u0043\u0079мм\u0061 в в\u0061люте к\u006Fмп\u0061нии',
  'Со счета',
  '\u0048а счет',
  '\u004Bатег\u006Fрия',
  'Подкатегория',
  'Контрагент',
  'Подконтрагент',
  'Проект',
  'Подпроект',
  '\u0054еги',
  'Комментарий',
];

/** Значение ячейки: строка — `t="str"` с `<v>`, число — число Excel, null — пустая `t="str"` без `<v>`. */
export type FinmapLikeValue = string | number | null;

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/** Дата и время по часам компании → число Excel с долей суток (10 знаков, как в выгрузке). */
export function excelSerial(date: string, time = '00:00:00'): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm, ss] = time.split(':').map(Number) as [number, number, number];
  const days = (Date.UTC(y, m - 1, d) - EXCEL_EPOCH) / 86_400_000;
  return Number((days + (hh * 3600 + mm * 60 + ss) / 86_400).toFixed(10));
}

/** Строка данных A–P по полям; незаданные — пустые ячейки. */
export function finmapLikeRow(v: {
  paidAt: FinmapLikeValue;
  accrual?: FinmapLikeValue;
  periodFrom?: FinmapLikeValue;
  periodTo?: FinmapLikeValue;
  amount: FinmapLikeValue;
  baseAmount?: FinmapLikeValue;
  from?: FinmapLikeValue;
  to?: FinmapLikeValue;
  category?: FinmapLikeValue;
  subcategory?: FinmapLikeValue;
  counterparty?: FinmapLikeValue;
  subcounterparty?: FinmapLikeValue;
  project?: FinmapLikeValue;
  subproject?: FinmapLikeValue;
  tags?: FinmapLikeValue;
  comment?: FinmapLikeValue;
}): FinmapLikeValue[] {
  return [
    v.paidAt,
    v.accrual ?? null,
    v.periodFrom ?? null,
    v.periodTo ?? null,
    v.amount,
    v.baseAmount ?? null,
    v.from ?? null,
    v.to ?? null,
    v.category ?? null,
    v.subcategory ?? null,
    v.counterparty ?? null,
    v.subcounterparty ?? null,
    v.project ?? null,
    v.subproject ?? null,
    v.tags ?? null,
    v.comment ?? null,
  ];
}

/**
 * Пример выгрузки: доход, зарплата с периодом начисления текстом «01.09.2026 00:00:00» – «30.09.2026 23:59:59»,
 * перевод, расход с копейками, тегами и комментарием. Время — по часам компании.
 */
export function finmapLikeSample(): FinmapLikeValue[][] {
  return [
    finmapLikeRow({ paidAt: excelSerial('2026-10-03', '22:07:00'), amount: 10596, baseAmount: 10596, to: 'Касса-1', category: 'Бар' }),
    finmapLikeRow({
      paidAt: excelSerial('2026-10-03', '22:07:30'),
      periodFrom: '01.09.2026 00:00:00',
      periodTo: '30.09.2026 23:59:59',
      amount: 8500,
      baseAmount: 8500,
      from: 'Касса-1',
      category: 'Зарплата',
      subcategory: 'Администраторы',
      counterparty: 'Сотрудник А',
    }),
    finmapLikeRow({ paidAt: excelSerial('2026-10-04', '09:15:00'), amount: 50000, baseAmount: 50000, from: 'Касса-1', to: 'Банк-2' }),
    finmapLikeRow({
      paidAt: excelSerial('2026-10-05', '00:30:00'),
      accrual: excelSerial('2026-10-01'),
      amount: 8200.5,
      baseAmount: 8200.5,
      from: 'Банк-2',
      category: 'Аренда',
      counterparty: 'Поставщик Б',
      tags: 'Смена, Ночь',
      comment: 'Аренда за октябрь',
    }),
  ];
}

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function columnName(i: number): string {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** XML листа: строки по порядку с номера 1, как пишет Finmap. */
export function finmapLikeSheetXml(rows: FinmapLikeValue[][]): string {
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((v, c) => {
          const ref = `${columnName(c)}${r + 1}`;
          if (v === null) return `<c r="${ref}" t="str"/>`;
          if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
          return `<c r="${ref}" t="str"><v>${esc(v)}</v></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheetData>${body}</sheetData></worksheet>`;
}

/**
 * Книга XLSX «как у Finmap»: заголовки (по умолчанию FINMAP_LIKE_HEADERS) и строки данных;
 * leadRows — строки над заголовками (название отчёта и т. п.).
 */
export function finmapLikeXlsx(
  rows: FinmapLikeValue[][] = finmapLikeSample(),
  opts: { headers?: readonly string[]; leadRows?: FinmapLikeValue[][]; sheetName?: string; date1904?: boolean } = {},
): Buffer {
  const all = [...(opts.leadRows ?? []), [...(opts.headers ?? FINMAP_LIKE_HEADERS)], ...rows];
  const pr = opts.date1904 ? '<workbookPr date1904="1"/>' : '';
  return buildZip([
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    },
    { name: '_rels/.rels', data: `<Relationships xmlns="${NS_PKG}"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">${pr}<sheets><sheet name="${esc(opts.sheetName ?? 'ExportRU')}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    { name: 'xl/_rels/workbook.xml.rels', data: `<Relationships xmlns="${NS_PKG}"><Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>` },
    { name: 'xl/worksheets/sheet1.xml', data: finmapLikeSheetXml(all) },
  ]);
}
```

Создайте `tests/server/import-xml.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/server/errors';
import { decodeXmlText, scanXml } from '../../src/server/modules/imports/xml';

/** События разбора одной строкой: «<a x=1>», «текст», «</a>». */
function events(xml: string, limits?: { maxDepth?: number; maxAttrs?: number }): string[] {
  const out: string[] = [];
  scanXml(
    xml,
    {
      open: (name, attrs) => out.push(`<${name}${Object.entries(attrs).map(([k, v]) => ` ${k}=${v}`).join('')}>`),
      text: (v) => out.push(v),
      close: (name) => out.push(`</${name}>`),
    },
    limits,
  );
  return out;
}

function f3(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).details).toEqual({ fileCode: 'F3' });
    return (e as AppError).message;
  }
  throw new Error('ожидалась F3');
}

describe('XML: безопасный разбор (§3.2 спецификации импорта)', () => {
  it('элементы, атрибуты в двойных и одинарных кавычках, «>» внутри значения, самозакрывающиеся, префиксы пространств имён', () => {
    expect(events(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<x:a xmlns:x="u" r:id='rId1' v="a>b"><b/>т<c>к</c></x:a>`)).toEqual([
      '<a xmlns:x=u r:id=rId1 v=a>b>',
      '<b>',
      '</b>',
      'т',
      '<c>',
      'к',
      '</c>',
      '</a>',
    ]);
  });

  it('стандартные и числовые сущности; CDATA как есть; комментарии и инструкции пропускаются; BOM в начале', () => {
    expect(events('\uFEFF<a q="&quot;&#x41;">&lt;&gt;&amp;&quot;&apos;&#1044;&#x1F389;<!-- <b>x</b> --><?pi x?><![CDATA[&lt;<b>]]></a>')).toEqual([
      '<a q="A>',
      '<>&"\'Д\u{1F389}',
      '&lt;<b>',
      '</a>',
    ]);
    expect(decodeXmlText('без ссылок')).toBe('без ссылок');
  });

  it('DOCTYPE, ENTITY (в том числе после BOM и в нижнем регистре) и «billion laughs» отклоняются сразу (Review Focus)', () => {
    const laughs = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]><lolz>&lol2;</lolz>`;
    const xxe = `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>`;
    for (const xml of [laughs, xxe, '\uFEFF<!DOCTYPE a><a/>', '<a><!entity x "y"></a>', '<!doctype a><a/>']) {
      let called = 0;
      expect(f3(() => scanXml(xml, { open: () => called++, text: () => called++, close: () => called++ }))).toBe(
        'Файл повреждён или небезопасен: объявления DOCTYPE и ENTITY запрещены',
      );
      expect(called).toBe(0);
    }
  });

  it('неизвестная сущность, «&» без ссылки, ссылки на 0, суррогат и больше U+10FFFF — F3', () => {
    expect(f3(() => events('<a>&nbsp;</a>'))).toBe('Файл повреждён или небезопасен: неизвестная сущность &nbsp;');
    expect(f3(() => events('<a>a & b</a>'))).toContain('неверная ссылка на символ');
    expect(f3(() => events('<a b="&x;"/>'))).toContain('неизвестная сущность &x;');
    for (const ref of ['&#0;', '&#xD800;', '&#xDFFF;', '&#x110000;', '&#1114112;']) expect(f3(() => decodeXmlText(ref)), ref).toContain('недопустимая ссылка');
  });

  it('глубина 64 — можно, 65 — F3; атрибутов больше 64 — F3', () => {
    const nest = (n: number) => '<a>'.repeat(n) + '</a>'.repeat(n);
    expect(events(nest(64))).toHaveLength(128);
    expect(f3(() => events(nest(65)))).toBe('Файл повреждён или небезопасен: слишком глубокая вложенность XML');
    expect(f3(() => events(`${'<a>'.repeat(64)}<b/>${'</a>'.repeat(64)}`))).toContain('вложенность');
    const attrs = (n: number) => `<a ${Array.from({ length: n }, (_, i) => `x${i}="1"`).join(' ')}/>`;
    expect(events(attrs(64))).toHaveLength(2);
    expect(f3(() => events(attrs(65)))).toContain('слишком много атрибутов');
  });

  it('не UTF-8 в объявлении, несовпадающие и незакрытые теги, оборванный комментарий — F3', () => {
    expect(f3(() => events('<?xml version="1.0" encoding="windows-1251"?><a/>'))).toBe('Файл повреждён или небезопасен: кодировка windows-1251 не поддерживается');
    expect(events('<?xml version="1.0" encoding="utf8"?><a/>')).toEqual(['<a>', '</a>']);
    expect(f3(() => events('<a><b></a></b>'))).toContain('не совпадают');
    expect(f3(() => events('<a><b>'))).toContain('оборван');
    expect(f3(() => events('<a><!-- </a>'))).toContain('оборван');
    expect(f3(() => events('<a x="1></a>'))).toContain('оборван');
  });
});
```

Создайте `tests/server/import-xlsx.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/server/errors';
import { buildXlsx } from '../../src/server/http/xlsx';
import { CELL_TOO_LONG, columnIndex, readXlsx, resolvePart, XLSX_LIMITS, type SheetRow } from '../../src/server/modules/imports/xlsx-read';
import { excelSerial, FINMAP_LIKE_HEADERS, finmapLikeXlsx } from '../helpers/finmap-like';
import { buildZip } from '../helpers/zip-build';

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** Книга из частей: workbook со списком листов, связи, листы, общие строки. */
function book(p: { sheets: [string, string][]; rels?: string; parts: Record<string, string>; pr?: string }): Buffer {
  const workbook = `<workbook ${NS}>${p.pr ?? ''}<sheets>${p.sheets.map(([name, rid], i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="${rid}"/>`).join('')}</sheets></workbook>`;
  const entries = [{ name: 'xl/workbook.xml', data: workbook }, ...Object.entries(p.parts).map(([name, data]) => ({ name, data }))];
  if (p.rels !== undefined) entries.push({ name: 'xl/_rels/workbook.xml.rels', data: p.rels });
  return buildZip(entries);
}
const sheet = (rows: string) => `<worksheet ${NS}><sheetData>${rows}</sheetData></worksheet>`;
/** Строки листа как объект: { номер: { столбец: «вид:значение» } }. */
const flat = (rows: SheetRow[]) =>
  Object.fromEntries(rows.map((r) => [r.row, Object.fromEntries([...r.cells].map(([c, v]) => [c, `${v.kind}:${v.value}`]))]));

function f(code: string, fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).details).toEqual({ fileCode: code });
    return (e as AppError).message;
  }
  throw new Error(`ожидалась ${code}`);
}

describe('XLSX: первый лист (§3.3 спецификации импорта)', () => {
  it('вспомогательные: столбец по ссылке, путь части по связи', () => {
    expect(['A15', 'Z1', 'AA15', 'XFD1', 'a1', 'A'].map(columnIndex)).toEqual([0, 25, 26, 16383, null, null]);
    expect(resolvePart('worksheets/sheet2.xml')).toBe('xl/worksheets/sheet2.xml');
    expect(resolvePart('/xl/worksheets/s.xml')).toBe('xl/worksheets/s.xml');
    expect(resolvePart('../xl/./worksheets/s.xml')).toBe('xl/worksheets/s.xml');
    expect(f('F3', () => resolvePart('../../x.xml'))).toContain('неверная ссылка на лист');
  });

  it('первый лист — первый <sheet> книги по связи, а не по имени файла; без связи — sheet1.xml', () => {
    const data = book({
      sheets: [
        ['Второй', 'rId7'],
        ['Первый', 'rId1'],
      ],
      rels: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId7" Target="/xl/worksheets/sheet9.xml"/></Relationships>`,
      parts: {
        'xl/worksheets/sheet1.xml': sheet('<row r="1"><c r="A1" t="inlineStr"><is><t>не тот</t></is></c></row>'),
        'xl/worksheets/sheet9.xml': sheet('<row r="1"><c r="A1" t="inlineStr"><is><t>тот</t></is></c></row>'),
      },
    });
    expect(flat(readXlsx(data).rows)).toEqual({ 1: { 0: 'text:тот' } });
    const noRels = book({ sheets: [['Л', 'rId3']], parts: { 'xl/worksheets/sheet1.xml': sheet('<row r="2"><c r="B2"><v>1</v></c></row>') } });
    expect(flat(readXlsx(noRels).rows)).toEqual({ 2: { 1: 'number:1' } });
  });

  it('общие строки с <r> склеиваются, фонетика пропускается; индекс вне таблицы — F3', () => {
    const sst = `<sst ${NS}><si><t>Касса</t></si><si><r><t>Ка</t></r><r><rPr><b/></rPr><t xml:space="preserve">сса 2</t></r><rPh><t>カ</t></rPh></si></sst>`;
    const data = (v: string) =>
      book({ sheets: [['Л', 'rId1']], parts: { 'xl/sharedStrings.xml': sst, 'xl/worksheets/sheet1.xml': sheet(`<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>${v}</v></c></row>`) } });
    expect(flat(readXlsx(data('1')).rows)).toEqual({ 1: { 0: 'text:Касса', 1: 'text:Касса 2' } });
    expect(f('F3', () => readXlsx(data('2')))).toBe('Файл повреждён или небезопасен: ссылка на общую строку вне таблицы');
    expect(f('F3', () => readXlsx(data('x')))).toContain('вне таблицы');
  });

  it('типы ячеек: n, inlineStr, str (без <v> — пусто), b, e, d; формула — сохранённое значение; пропуски столбцов, AA, ячейки и строки без r', () => {
    const rows = [
      '<row r="3"><c r="A3"><v>10596</v></c><c r="C3" t="inlineStr"><is><t>текст</t></is></c><c t="str"><v>str</v></c><c r="AA3" t="str"/></row>',
      '<row><c r="A4" t="b"><v>1</v></c><c r="B4" t="b"><v>0</v></c><c r="C4" t="e"><v>#N/A</v></c><c r="D4" t="d"><v>2026-10-05T10:00:00</v></c></row>',
      '<row r="7"><c r="A7"><f>SUM(A1:A2)</f><v>1.2345E+5</v></c><c r="B7" t="str"><f>A1&amp;"x"</f><v>итог</v></c><c r="C7"><v></v></c></row>',
      '<row r="8"><c r="A8" t="str"/><c r="B8"/></row>',
    ];
    expect(flat(readXlsx(book({ sheets: [['Л', 'rId1']], parts: { 'xl/worksheets/sheet1.xml': sheet(rows.join('')) } })).rows)).toEqual({
      3: { 0: 'number:10596', 2: 'text:текст', 3: 'text:str' },
      4: { 0: 'text:TRUE', 1: 'text:FALSE', 2: 'error:#N/A', 3: 'text:2026-10-05T10:00:00' },
      7: { 0: 'number:1.2345E+5', 1: 'text:итог' },
    });
  });

  it('date1904; текст длиннее 32 767 символов — ячейка-ошибка; неизвестный тип — F3', () => {
    const one = (cells: string, pr?: string) => book({ sheets: [['Л', 'rId1']], pr, parts: { 'xl/worksheets/sheet1.xml': sheet(`<row r="1">${cells}</row>`) } });
    expect(readXlsx(one('<c r="A1"><v>1</v></c>', '<workbookPr date1904="1"/>')).date1904).toBe(true);
    expect(readXlsx(one('<c r="A1"><v>1</v></c>', '<workbookPr date1904="0"/>')).date1904).toBe(false);
    const long = `<c r="A1" t="inlineStr"><is><t>${'я'.repeat(32_768)}</t></is></c><c r="B1" t="inlineStr"><is><t>${'я'.repeat(32_767)}</t></is></c>`;
    const r = readXlsx(one(long)).rows[0]!;
    expect(r.cells.get(0)).toEqual({ kind: 'error', value: CELL_TOO_LONG });
    expect(r.cells.get(1)!.value).toHaveLength(32_767);
    expect(f('F3', () => readXlsx(one('<c r="A1" t="zz"><v>1</v></c>')))).toContain('неизвестный тип ячейки');
  });

  it('файл «как у Finmap»: заголовки с латинскими двойниками, t="str", пустые str без <v>, даты — числа с долей суток', () => {
    const data = readXlsx(finmapLikeXlsx());
    expect(data.date1904).toBe(false);
    const [head, income, salary] = data.rows;
    expect(head!.row).toBe(1);
    expect([...head!.cells.values()].map((c) => c.value)).toEqual([...FINMAP_LIKE_HEADERS]);
    expect(head!.cells.get(0)!.value).not.toBe('Дата платежа');
    expect(income!.cells.get(0)).toEqual({ kind: 'number', value: String(excelSerial('2026-10-03', '22:07:00')) });
    expect(income!.cells.get(7)).toEqual({ kind: 'text', value: 'Касса-1' });
    expect(income!.cells.has(6)).toBe(false); // пустая «Со счета» — t="str" без <v>
    expect(salary!.cells.get(2)).toEqual({ kind: 'text', value: '01.09.2026 00:00:00' });
    expect(salary!.cells.get(3)).toEqual({ kind: 'text', value: '30.09.2026 23:59:59' });
  });

  it('наша книга (inline-строки, писатель buildXlsx) читается тем же читателем', () => {
    const data = buildXlsx({ name: 'Лист', columns: [{ header: 'Дата платежа*', width: 10 }], rows: [[{ kind: 'number', value: '1500.50', decimals: 2 }]] });
    expect(flat(readXlsx(data).rows)).toEqual({ 1: { 0: 'text:Дата платежа*' }, 2: { 0: 'number:1500.50' } });
  });

  it('не книга Excel (ZIP без xl/workbook.xml) — F2; нет файла листа — F3; пределы частей и строк передаются параметром', () => {
    expect(f('F2', () => readXlsx(buildZip([{ name: 'word/document.xml', data: '<w/>' }])))).toBe('Нужен файл .xlsx или .csv');
    expect(f('F3', () => readXlsx(book({ sheets: [['Л', 'rId1']], parts: {} })))).toContain('нет файла первого листа');
    expect(f('F3', () => readXlsx(finmapLikeXlsx(), { ...XLSX_LIMITS, sheet: 100 }))).toContain('больше предела распаковки');
    expect(f('F3', () => readXlsx(book({ sheets: [], parts: {} })))).toContain('в книге нет листов');
    // строк больше предела — F5 сразу, лист не дочитывается (в примере 5 непустых строк)
    expect(readXlsx(finmapLikeXlsx(), { ...XLSX_LIMITS, rows: 5 }).rows).toHaveLength(5);
    expect(f('F5', () => readXlsx(finmapLikeXlsx(), { ...XLSX_LIMITS, rows: 4 }))).toBe('В файле больше 50 000 строк — разбейте его по годам');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/import-xml.test.ts tests/server/import-xlsx.test.ts`
Expected: FAIL — модули `imports/xml` и `imports/xlsx-read` не найдены.

- [ ] **Step 3: Write minimal implementation**

Создайте `src/server/modules/imports/xml.ts`:

```ts
import { damaged } from './errors';

/**
 * Безопасный потоковый разбор XML (§3.2 спецификации импорта): один проход через indexOf, без рекурсии и без дерева.
 * DOCTYPE и ENTITY запрещены целиком (XXE и «billion laughs» невозможны): раскрываются только пять стандартных
 * сущностей и числовые ссылки. Имена элементов — без префикса пространства имён; атрибуты — как в файле (`r:id`).
 */
export interface XmlHandler {
  open(name: string, attrs: Record<string, string>): void;
  text(value: string): void;
  close(name: string): void;
}

export interface XmlLimits {
  /** Глубина вложенности (64). */
  maxDepth?: number;
  /** Атрибутов у элемента (64). */
  maxAttrs?: number;
}

export const XML_MAX_DEPTH = 64;
export const XML_MAX_ATTRS = 64;

const NAMED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const ATTR = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Имя без префикса пространства имён: `x:row` → `row`. */
const local = (name: string) => {
  const i = name.indexOf(':');
  return i < 0 ? name : name.slice(i + 1);
};

/** Текст с раскрытыми ссылками: только &lt; &gt; &amp; &quot; &apos; и &#N; / &#xH; (не 0, не суррогат, не больше U+10FFFF). */
export function decodeXmlText(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9A-Fa-f]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{0,30});|&/g, (whole, ref: string | undefined) => {
    if (ref === undefined) throw damaged('неверная ссылка на символ');
    if (ref.startsWith('#')) {
      const code = ref[1] === 'x' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (code === 0 || (code >= 0xd800 && code <= 0xdfff) || code > 0x10ffff) throw damaged(`недопустимая ссылка на символ ${whole}`);
      return String.fromCodePoint(code);
    }
    const named = NAMED[ref];
    if (named === undefined) throw damaged(`неизвестная сущность ${whole}`);
    return named;
  });
}

export function scanXml(xml: string, h: XmlHandler, limits: XmlLimits = {}): void {
  const maxDepth = limits.maxDepth ?? XML_MAX_DEPTH;
  const maxAttrs = limits.maxAttrs ?? XML_MAX_ATTRS;
  // сущности не объявляются и не раскрываются: любой DOCTYPE или ENTITY — отказ сразу, до разбора
  if (/<!\s*(?:doctype|entity)/i.test(xml)) throw damaged('объявления DOCTYPE и ENTITY запрещены');

  const stack: string[] = [];
  const n = xml.length;
  let i = xml.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    const textEnd = lt < 0 ? n : lt;
    if (textEnd > i && stack.length > 0) h.text(decodeXmlText(xml.slice(i, textEnd)));
    if (lt < 0) break;

    if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2);
      if (end < 0) throw damaged('XML оборван');
      if (xml.startsWith('<?xml', lt)) {
        const enc = /encoding\s*=\s*["']([^"']+)["']/.exec(xml.slice(lt, end));
        if (enc && !/^utf-?8$/i.test(enc[1]!)) throw damaged(`кодировка ${enc[1]} не поддерживается`);
      }
      i = end + 2;
      continue;
    }
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      if (end < 0) throw damaged('XML оборван');
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      if (end < 0) throw damaged('XML оборван');
      if (stack.length > 0) h.text(xml.slice(lt + 9, end));
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<!', lt)) throw damaged('объявления <!…> запрещены');

    if (xml.charCodeAt(lt + 1) === 47 /* / */) {
      const end = xml.indexOf('>', lt + 2);
      if (end < 0) throw damaged('XML оборван');
      const name = local(xml.slice(lt + 2, end).trim());
      if (stack.pop() !== name) throw damaged('теги XML не совпадают');
      h.close(name);
      i = end + 1;
      continue;
    }

    // начальный тег: конец — первый «>» вне кавычек
    let j = lt + 1;
    let quote = 0;
    for (; j < n; j++) {
      const c = xml.charCodeAt(j);
      if (quote) {
        if (c === quote) quote = 0;
      } else if (c === 34 || c === 39) quote = c;
      else if (c === 62) break;
    }
    if (j >= n) throw damaged('XML оборван');
    let body = xml.slice(lt + 1, j);
    const selfClosing = body.endsWith('/');
    if (selfClosing) body = body.slice(0, -1);
    const m = /^[^\s/>]+/.exec(body);
    if (!m) throw damaged('неверный тег XML');
    const name = local(m[0]);
    const attrs: Record<string, string> = {};
    let count = 0;
    for (const a of body.slice(m[0].length).matchAll(ATTR)) {
      if (++count > maxAttrs) throw damaged('слишком много атрибутов у элемента');
      attrs[a[1]!] = decodeXmlText(a[2] ?? a[3] ?? '');
    }
    if (!selfClosing) {
      stack.push(name);
      if (stack.length > maxDepth) throw damaged('слишком глубокая вложенность XML');
    } else if (stack.length + 1 > maxDepth) throw damaged('слишком глубокая вложенность XML');
    h.open(name, attrs);
    if (selfClosing) h.close(name);
    i = j + 1;
  }
  if (stack.length > 0) throw damaged('XML оборван');
}
```

Создайте `src/server/modules/imports/xlsx-read.ts`:

```ts
import { damaged, fileError, IMPORT_READ_MAX_ROWS, tooManyRows } from './errors';
import { scanXml } from './xml';
import { openZip, ZIP_MAX_ENTRIES, ZIP_MAX_TOTAL } from './zip';

/**
 * Ячейка листа (§3.3 спецификации импорта): число — текстом, как в `<v>` (в number не превращается, §4.2);
 * error — ошибка Excel (`#N/A`) или слишком длинный текст (CELL_TOO_LONG).
 */
export interface Cell {
  kind: 'number' | 'text' | 'error';
  value: string;
}

/** Строка листа: номер строки Excel и непустые ячейки по номеру столбца с нуля (A — 0, AA — 26). */
export interface SheetRow {
  row: number;
  cells: Map<number, Cell>;
}

export interface SheetData {
  rows: SheetRow[];
  /** `<workbookPr date1904="1">`: к числам-датам прибавляется 1 462 дня. */
  date1904: boolean;
}

/** Значение ячейки длиннее предела Excel — ошибка строки R18. */
export const CELL_TOO_LONG = '#TOO_LONG';
/** Предел Excel на текст ячейки. */
export const CELL_MAX_CHARS = 32_767;

const MB = 1024 * 1024;

export interface XlsxLimits {
  sheet: number;
  sharedStrings: number;
  workbook: number;
  rels: number;
  total: number;
  entries: number;
  sharedCount: number;
  /** Непустых строк листа: больше — F5 сразу, не дочитывая лист. */
  rows: number;
}

/** Пределы распаковки §3.1 и общих строк §3.3. */
export const XLSX_LIMITS: XlsxLimits = {
  sheet: 64 * MB,
  sharedStrings: 32 * MB,
  workbook: MB,
  rels: MB,
  total: ZIP_MAX_TOTAL,
  entries: ZIP_MAX_ENTRIES,
  sharedCount: 1_000_000,
  rows: IMPORT_READ_MAX_ROWS,
};

const MAX_ROW = 1_048_576;
const MAX_COL = 16_384;

/** Буквы столбца ссылки ячейки → номер с нуля: «A15» → 0, «AA15» → 26; null — не ссылка. */
export function columnIndex(ref: string): number | null {
  const m = /^([A-Z]{1,3})[0-9]+$/.exec(ref);
  if (!m) return null;
  let n = 0;
  for (const ch of m[1]!) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Путь части пакета по Target связи относительно `xl/`; `..` выше корня — F3. */
export function resolvePart(target: string): string {
  const parts = target.startsWith('/') ? [] : ['xl'];
  for (const seg of target.replace(/^\/+/, '').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) throw damaged('неверная ссылка на лист');
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

/** Первый лист книги: файл листа по связи первого `<sheet>` и признак date1904. */
function firstSheet(workbook: string, rels: string | null): { path: string; date1904: boolean } {
  // объект, а не let: присваивания внутри обработчиков TypeScript не видит
  const found: { rid: string | null; date1904: boolean; target: string | null } = { rid: null, date1904: false, target: null };
  scanXml(workbook, {
    open(name, attrs) {
      if (name === 'workbookPr') found.date1904 = attrs.date1904 === '1' || attrs.date1904 === 'true';
      if (name === 'sheet' && found.rid === null) {
        const key = Object.keys(attrs).find((k) => k.endsWith(':id'));
        found.rid = key ? attrs[key]! : '';
      }
    },
    text() {},
    close() {},
  });
  if (found.rid === null) throw damaged('в книге нет листов');
  if (rels && found.rid) {
    scanXml(rels, {
      open(name, attrs) {
        if (name === 'Relationship' && attrs.Id === found.rid && found.target === null) found.target = attrs.Target ?? null;
      },
      text() {},
      close() {},
    });
  }
  return { path: found.target ? resolvePart(found.target) : 'xl/worksheets/sheet1.xml', date1904: found.date1904 };
}

/** Общие строки: `<si>` с несколькими `<r><t>` склеивается; фонетика `<rPh>` пропускается. */
function sharedStrings(xml: string, maxCount: number): string[] {
  const out: string[] = [];
  let cur: string | null = null;
  let inT = false;
  let phonetic = 0;
  scanXml(xml, {
    open(name) {
      if (name === 'si') {
        if (out.length >= maxCount) throw damaged('слишком много общих строк');
        cur = '';
      } else if (name === 'rPh') phonetic++;
      else if (name === 't' && cur !== null && phonetic === 0) inT = true;
    },
    text(v) {
      if (inT) cur += v;
    },
    close(name) {
      if (name === 't') inT = false;
      else if (name === 'rPh') phonetic--;
      else if (name === 'si') {
        out.push(cur ?? '');
        cur = null;
      }
    },
  });
  return out;
}

/** Лист → строки ячеек. Пустые ячейки (в том числе `t="str"` без `<v>`, как пишет Finmap) и пустые строки не хранятся. */
function sheetRows(xml: string, shared: string[], maxRows: number): SheetRow[] {
  const rows: SheetRow[] = [];
  let row: SheetRow | null = null;
  let prevRow = 0;
  let col = -1;
  let type = 'n';
  let v: string | null = null;
  let inline: string | null = null;
  let mode: 'v' | 't' | null = null;
  let inIs = false;
  let phonetic = 0;

  const finishCell = () => {
    let cell: Cell | null;
    switch (type) {
      case 'n':
        cell = v === null || v.trim() === '' ? null : { kind: 'number', value: v.trim() };
        break;
      case 's': {
        const idx = v === null ? NaN : Number(v.trim());
        if (!Number.isInteger(idx) || idx < 0 || idx >= shared.length) throw damaged('ссылка на общую строку вне таблицы');
        cell = { kind: 'text', value: shared[idx]! };
        break;
      }
      case 'str':
      case 'd':
        cell = { kind: 'text', value: v ?? '' };
        break;
      case 'inlineStr':
        cell = { kind: 'text', value: inline ?? '' };
        break;
      case 'b':
        cell = v === null ? null : { kind: 'text', value: v.trim() === '1' ? 'TRUE' : 'FALSE' };
        break;
      case 'e':
        cell = { kind: 'error', value: v?.trim() || '#ERROR' };
        break;
      default:
        throw damaged(`неизвестный тип ячейки «${type}»`);
    }
    if (cell && cell.kind === 'text' && cell.value.length > CELL_MAX_CHARS) cell = { kind: 'error', value: CELL_TOO_LONG };
    if (cell && cell.value !== '') row!.cells.set(col, cell);
  };

  scanXml(xml, {
    open(name, attrs) {
      if (name === 'row') {
        const r = attrs.r === undefined ? prevRow + 1 : Number(attrs.r);
        if (!Number.isInteger(r) || r < 1 || r > MAX_ROW) throw damaged('неверный номер строки листа');
        row = { row: r, cells: new Map() };
        prevRow = r;
        col = -1;
      } else if (name === 'c') {
        if (!row) throw damaged('ячейка вне строки');
        if (attrs.r !== undefined) {
          const c = columnIndex(attrs.r);
          if (c === null || c >= MAX_COL) throw damaged('неверная ссылка ячейки');
          col = c;
        } else col++;
        type = attrs.t ?? 'n';
        v = null;
        inline = null;
      } else if (name === 'v' && row) {
        mode = 'v';
        v = '';
      } else if (name === 'is') inIs = true;
      else if (name === 'rPh') phonetic++;
      else if (name === 't' && inIs && phonetic === 0) {
        mode = 't';
        inline ??= '';
      }
    },
    text(value) {
      if (mode === 'v') v += value;
      else if (mode === 't') inline += value;
    },
    close(name) {
      if (name === 'v' || name === 't') mode = null;
      else if (name === 'is') inIs = false;
      else if (name === 'rPh') phonetic--;
      else if (name === 'c' && row) finishCell();
      else if (name === 'row' && row) {
        if (row.cells.size > 0 && rows.push(row) > maxRows) throw tooManyRows();
        row = null;
      }
    },
  });
  return rows;
}

/**
 * Первый лист XLSX (§3.3): первый `<sheet>` книги по связи, общие строки, типы ячеек. Формулы не вычисляются —
 * берётся сохранённый `<v>`; стили не читаются. Нет книги `xl/workbook.xml` — F2 (это не XLSX).
 */
export function readXlsx(data: Buffer, limits: XlsxLimits = XLSX_LIMITS): SheetData {
  const zip = openZip(data, { maxEntries: limits.entries, maxTotal: limits.total });
  const workbook = zip.read('xl/workbook.xml', limits.workbook);
  if (!workbook) throw fileError('F2', 'Нужен файл .xlsx или .csv');
  const rels = zip.read('xl/_rels/workbook.xml.rels', limits.rels);
  const sheet = firstSheet(workbook.toString('utf8'), rels ? rels.toString('utf8') : null);
  const sst = zip.read('xl/sharedStrings.xml', limits.sharedStrings);
  const shared = sst ? sharedStrings(sst.toString('utf8'), limits.sharedCount) : [];
  const sheetXml = zip.read(sheet.path, limits.sheet);
  if (!sheetXml) throw damaged('нет файла первого листа');
  return { rows: sheetRows(sheetXml.toString('utf8'), shared, limits.rows), date1904: sheet.date1904 };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/import-xml.test.ts tests/server/import-xlsx.test.ts`
Expected: PASS, 6 и 8 тестов.

Run: `npm test` и `npm run typecheck`
Expected: 871 пройдено и 1 пропущен; typecheck без ошибок.

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/imports/xml.ts src/server/modules/imports/xlsx-read.ts tests/helpers/finmap-like.ts tests/server/import-xml.test.ts tests/server/import-xlsx.test.ts
git commit -m "feat: импорт — безопасный XML и первый лист XLSX; синтетический файл «как у Finmap»" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Формат Finmap, CSV и тип файла (§2.1, §2.2, §2.5, §3.4, §4.9)

`finmap-format.ts` перенесён сюда из задачи 4 §14: CSV выбирает разделитель по числу распознанных заголовков (решение 1).

**Files:**
- Create: `src/shared/finmap-format.ts`, `src/server/modules/imports/csv.ts`, `src/server/modules/imports/read-file.ts`
- Test: `tests/shared/finmap-format.test.ts`, `tests/server/import-csv.test.ts`

**Interfaces:**
- Consumes: `cleanName` (`src/shared/text.ts`), `foldCase` (`src/shared/search.ts`), `SYSTEM_CATEGORIES`, `CategoryKind`, `SystemKey` (`src/shared/system-categories.ts`); `damaged`, `fileError`, `IMPORT_READ_MAX_ROWS`, `tooManyRows` (задача 1); `SheetData`, `SheetRow`, `readXlsx` (задача 2); `finmapLikeXlsx`, `FINMAP_LIKE_HEADERS`, `buildZip` (задачи 1–2).
- Produces:
  - `finmap-format.ts`: `type FinmapField` (16 полей A–P); `FINMAP_COLUMNS: { field; header }[]`; `columnTitle(field): string`; `nameKey(s): string`; `headerKey(s): string`; `headerField(title): FinmapField | null`; `countKnownHeaders(values): number`; `isHeaderRow(values): boolean`; `repairName(s): string`; `FINMAP_SYSTEM_ALIASES` (пусто); `systemKeyOf(name, kind): SystemKey | null`;
  - `csv.ts`: `type CsvEncoding`; `CSV_MAX_FIELDS = 64`; `CSV_MAX_RECORD`; `decodeCsv(data): { text; encoding }`; `eachCsvRecord(text, delimiter, strict, visit)`; `parseCsv(text, delimiter, limit?, strict?): string[][]`; `chooseDelimiter(text): { delimiter; header }`; `readCsv(data): SheetData`;
  - `read-file.ts`: `IMPORT_MAX_BYTES = 30 МБ`; `type ImportFileKind`; `detectImportFile(data, name): ImportFileKind`; `readImportFile(data, name): SheetData`.

- [ ] **Step 1: Write the failing tests**

Создайте `tests/shared/finmap-format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  columnTitle,
  countKnownHeaders,
  FINMAP_COLUMNS,
  headerField,
  headerKey,
  isHeaderRow,
  nameKey,
  repairName,
  systemKeyOf,
} from '../../src/shared/finmap-format';
import { FINMAP_LIKE_HEADERS } from '../helpers/finmap-like';

describe('формат Finmap: колонки и ключи (§2.1, §2.2, §4.9 спецификации импорта)', () => {
  it('16 колонок A–P в порядке шаблона; звёздочки у обязательных; названия для сообщений без звёздочки', () => {
    expect(FINMAP_COLUMNS).toHaveLength(16);
    expect(FINMAP_COLUMNS.map((c) => c.header).filter((h) => h.endsWith('*'))).toEqual(['Дата платежа*', 'Сумма в валюте счета*', 'Со счета*', 'На счет*']);
    expect(columnTitle('fromAccount')).toBe('Со счета');
    expect(columnTitle('periodFrom')).toBe('Период начисления (дата "с")');
  });

  it('headerKey: латинские двойники, регистр, «ё», звёздочки, кавычки любого вида, невидимые символы и пробелы', () => {
    expect(headerKey('Со счёта*')).toBe(headerKey('со счета'));
    expect(headerKey('\u0043о \u0063ч\u0065т\u0061')).toBe(headerKey('Со счета')); // «Со счета» с латинскими C, c, e, a
    expect(headerKey('Период начисления (дата «с»)')).toBe(headerKey('Период начисления (дата "с")'));
    expect(headerKey('  Дата\u200B  платежа * ')).toBe('дата платежа');
    expect(FINMAP_LIKE_HEADERS.map(headerField)).toEqual(FINMAP_COLUMNS.map((c) => c.field));
    expect(headerField('Сумма')).toBeNull();
  });

  it('строка заголовков: нужны «Дата платежа» и «Сумма в валюте счета»; счёт распознанных колонок', () => {
    expect(isHeaderRow(['Дата платежа*', 'Сумма в валюте счета*'])).toBe(true);
    expect(isHeaderRow(['Дата платежа*', 'Со счета*'])).toBe(false);
    expect(countKnownHeaders([...FINMAP_LIKE_HEADERS])).toBe(16);
    expect(countKnownHeaders(['Теги', 'теги', 'Прочее'])).toBe(1);
  });

  it('nameKey: «Kacca», «КАССА», «касса» совпадают; регистр латиницы не мешает; «Kaspi» и «Каспи» — разные', () => {
    expect(nameKey('Kacca')).toBe(nameKey('касса')); // «Kacca» латиницей
    expect(nameKey('КАССА')).toBe(nameKey('Касса'));
    expect(nameKey('  Касса\u00A0 1 ')).toBe(nameKey('касса 1'));
    expect(nameKey('Ёлка')).toBe(nameKey('елка'));
    expect(nameKey('STEAM')).toBe(nameKey('Steam'));
    expect(nameKey('Kaspi')).toBe(nameKey('kaspi'));
    expect(nameKey('Kaspi')).not.toBe(nameKey('Каспи'));
  });

  it('repairName: в словах с кириллицей двойники — кириллицей; латинские слова не трогаются', () => {
    expect(repairName('\u004B\u0061\u0063с\u0061')).toBe('Касса'); // смесь алфавитов: латинские K, a, c, a
    expect(repairName('Kaspi')).toBe('Kaspi');
    expect(repairName('Steam PC')).toBe('Steam PC');
    expect(repairName('\u004Bасса Kaspi')).toBe('Касса Kaspi');
    expect(repairName('  Зарплата\u200B ')).toBe('Зарплата');
    expect(nameKey(repairName('\u004B\u0061\u0063с\u0061'))).toBe(nameKey('\u004B\u0061\u0063с\u0061'));
  });

  it('системные категории по названию и виду; системное название с чужим видом — не системное', () => {
    expect(systemKeyOf('Зарплата', 'expense')).toBe('salary');
    expect(systemKeyOf('ЗАРПЛАТА', 'expense')).toBe('salary');
    expect(systemKeyOf('Инвестиции', 'income')).toBe('investment');
    expect(systemKeyOf('Зарплата', 'income')).toBeNull();
    expect(systemKeyOf('Аренда', 'expense')).toBeNull();
  });
});
```

Создайте `tests/server/import-csv.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/server/errors';
import { chooseDelimiter, decodeCsv, parseCsv, readCsv } from '../../src/server/modules/imports/csv';
import { detectImportFile, readImportFile } from '../../src/server/modules/imports/read-file';
import type { SheetRow } from '../../src/server/modules/imports/xlsx-read';
import { finmapLikeXlsx } from '../helpers/finmap-like';
import { buildZip } from '../helpers/zip-build';

/** Текст в cp1251 (в Node нет кодировщика): ASCII как есть, А–я → C0–FF, Ё/ё → A8/B8. */
function cp1251(s: string): Buffer {
  return Buffer.from(
    [...s].map((ch) => {
      const c = ch.charCodeAt(0);
      if (c < 0x80) return c;
      if (c >= 0x410 && c <= 0x44f) return c - 0x410 + 0xc0;
      if (ch === 'Ё') return 0xa8;
      if (ch === 'ё') return 0xb8;
      throw new Error(`нет в cp1251: ${ch}`);
    }),
  );
}
const utf16le = (s: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')]);
const values = (rows: SheetRow[]) => rows.map((r) => [r.row, Object.fromEntries([...r.cells].map(([c, v]) => [c, v.value]))]);

function f(code: string, fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).details).toEqual({ fileCode: code });
    return (e as AppError).message;
  }
  throw new Error(`ожидалась ${code}`);
}

const HEAD = 'Дата платежа*;Сумма в валюте счета*;Со счета*;На счет*;Комментарий';

describe('CSV (§2.5 спецификации импорта)', () => {
  it('кавычки по RFC 4180: "" внутри, разделитель и переводы строк внутри кавычек; CRLF; хвост после кавычки', () => {
    expect(parseCsv('a;"b;""c""";"d\r\ne"\r\nx;y\r\n', ';')).toEqual([
      ['a', 'b;"c"', 'd\r\ne'],
      ['x', 'y'],
    ]);
    expect(parseCsv('a,b\n"q"x,\n', ',')).toEqual([
      ['a', 'b'],
      ['qx', ''],
    ]);
    expect(parseCsv('1;2\n3;4\n5;6', ';', 2)).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('разделитель: «;», «,» и табуляция — по числу распознанных заголовков; при равенстве — «;»', () => {
    const fields = ['Дата платежа', 'Сумма в валюте счета', 'На счет', 'Комментарий'];
    expect(chooseDelimiter(`${fields.join(';')}\n1;2;3;4`).delimiter).toBe(';');
    expect(chooseDelimiter(`${fields.join(',')}\n"1,5";2;3;4`).delimiter).toBe(',');
    expect(chooseDelimiter(`${fields.join('\t')}\n1\t2`).delimiter).toBe('\t');
    expect(chooseDelimiter('Дата платежа\n1').delimiter).toBe(';');
    // строка заголовков не первая: над ней — название отчёта
    expect(chooseDelimiter(`Отчёт за год\n\n${fields.join(',')}\n1,2,3,4`)).toEqual({ delimiter: ',', header: true });
  });

  it('кодировки: BOM UTF-8, UTF-16LE с BOM (табуляция), строгий UTF-8, cp1251', () => {
    expect(decodeCsv(Buffer.from(`\uFEFF${HEAD}`, 'utf8'))).toEqual({ text: HEAD, encoding: 'utf-8' });
    expect(decodeCsv(utf16le('а\tб'))).toEqual({ text: 'а\tб', encoding: 'utf-16le' });
    expect(decodeCsv(Buffer.from('Касса', 'utf8')).encoding).toBe('utf-8');
    expect(decodeCsv(cp1251('Касса Ёлка'))).toEqual({ text: 'Касса Ёлка', encoding: 'windows-1251' });
  });

  it('readCsv: номера строк — номера записей; значения — текст; пустые значения и строки не хранятся', () => {
    const csv = `Выгрузка\n${HEAD}\n05.10.2026 10:00;1 500,50;Касса;;"многострочный\nкомментарий"\n;;;;\n45569.43;10;;Банк;`;
    expect(values(readCsv(Buffer.from(csv, 'utf8')).rows)).toEqual([
      [1, { 0: 'Выгрузка' }],
      [2, { 0: 'Дата платежа*', 1: 'Сумма в валюте счета*', 2: 'Со счета*', 3: 'На счет*', 4: 'Комментарий' }],
      [3, { 0: '05.10.2026 10:00', 1: '1 500,50', 2: 'Касса', 4: 'многострочный\nкомментарий' }],
      [5, { 0: '45569.43', 1: '10', 3: 'Банк' }],
    ]);
    expect(readCsv(cp1251(`${HEAD}\n01.10.2026;5;Касса;;`)).rows[1]!.cells.get(2)).toEqual({ kind: 'text', value: 'Касса' });
    expect(readCsv(utf16le(`${HEAD.replaceAll(';', '\t')}\r\n01.10.2026\t5\tКасса`)).rows[1]!.cells.get(2)!.value).toBe('Касса');
  });

  it('незакрытая кавычка — F3; больше 64 полей — F3; cp1251 без заголовков — F8', () => {
    expect(f('F3', () => readCsv(Buffer.from(`${HEAD}\n"оборвано;1`, 'utf8')))).toBe('Файл повреждён или небезопасен: незакрытая кавычка в CSV');
    expect(f('F3', () => readCsv(Buffer.from(`${HEAD}\n${'1;'.repeat(64)}1`, 'utf8')))).toContain('больше 64 полей');
    expect(readCsv(Buffer.from(`${HEAD}\n${'1;'.repeat(63)}1`, 'utf8')).rows[1]!.cells.size).toBe(64);
    expect(f('F8', () => readCsv(cp1251('Дата;Сумма\n1;2')))).toBe('Не удалось прочитать CSV: сохраните его в UTF-8');
  });
});

describe('тип файла (§3.4)', () => {
  it('XLSX, старый .xls, CSV и TXT по имени, пустой файл, прочее', () => {
    expect(detectImportFile(finmapLikeXlsx(), 'файл.xlsx')).toBe('xlsx');
    expect(detectImportFile(finmapLikeXlsx(), 'без расширения')).toBe('xlsx');
    expect(f('F2', () => detectImportFile(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2]), 'старый.xls'))).toBe('Старый формат .xls — сохраните файл как .xlsx');
    expect(detectImportFile(Buffer.from(HEAD), 'выгрузка.CSV')).toBe('csv');
    expect(detectImportFile(Buffer.from(HEAD), 'выгрузка.txt')).toBe('csv');
    expect(detectImportFile(utf16le(HEAD), 'юникод.txt')).toBe('csv');
    expect(f('F2', () => detectImportFile(Buffer.from('a\u0000b'), 'x.csv'))).toBe('Нужен файл .xlsx или .csv');
    expect(f('F2', () => detectImportFile(Buffer.from(HEAD), 'x.pdf'))).toBe('Нужен файл .xlsx или .csv');
    expect(f('F1', () => detectImportFile(Buffer.alloc(0), 'x.csv'))).toBe('Файл пустой');
    // ZIP, но не книга Excel (например, .docx), — F2 от читателя книги
    expect(f('F2', () => readImportFile(buildZip([{ name: 'word/document.xml', data: '<w/>' }]), 'x.xlsx'))).toBe('Нужен файл .xlsx или .csv');
    expect(readImportFile(Buffer.from(`${HEAD}\n1;2;Касса;;`), 'x.csv').rows).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/shared/finmap-format.test.ts tests/server/import-csv.test.ts`
Expected: FAIL — модули `shared/finmap-format`, `imports/csv` и `imports/read-file` не найдены.

- [ ] **Step 3: Write minimal implementation**

Создайте `src/shared/finmap-format.ts`. Ключ `nameKey` строится после `foldCase` и сопоставляет строчные латинские двойники, в том числе `b h k m t` (решение 2):

```ts
import { foldCase } from './search';
import { SYSTEM_CATEGORIES, type CategoryKind, type SystemKey } from './system-categories';
import { cleanName } from './text';

/**
 * Формат файла Finmap (§2 спецификации импорта): колонки A–P шаблона импорта и выгрузки «Excel»,
 * ключи заголовков и названий. Общий для сервера и окна «Собрать Excel».
 */
export type FinmapField =
  | 'paidAt'
  | 'accrualDate'
  | 'periodFrom'
  | 'periodTo'
  | 'amount'
  | 'baseAmount'
  | 'fromAccount'
  | 'toAccount'
  | 'category'
  | 'subcategory'
  | 'counterparty'
  | 'subcounterparty'
  | 'project'
  | 'subproject'
  | 'tags'
  | 'comment';

export interface FinmapColumn {
  field: FinmapField;
  /** Заголовок шаблона Finmap, со звёздочкой у обязательных. */
  header: string;
}

/** Колонки A–P в порядке шаблона (§2.1). */
export const FINMAP_COLUMNS: readonly FinmapColumn[] = [
  { field: 'paidAt', header: 'Дата платежа*' },
  { field: 'accrualDate', header: 'Дата начисления' },
  { field: 'periodFrom', header: 'Период начисления (дата "с")' },
  { field: 'periodTo', header: 'Период начисления (дата "по")' },
  { field: 'amount', header: 'Сумма в валюте счета*' },
  { field: 'baseAmount', header: 'Сумма в валюте компании' },
  { field: 'fromAccount', header: 'Со счета*' },
  { field: 'toAccount', header: 'На счет*' },
  { field: 'category', header: 'Категория' },
  { field: 'subcategory', header: 'Подкатегория' },
  { field: 'counterparty', header: 'Контрагент' },
  { field: 'subcounterparty', header: 'Подконтрагент' },
  { field: 'project', header: 'Проект' },
  { field: 'subproject', header: 'Подпроект' },
  { field: 'tags', header: 'Теги' },
  { field: 'comment', header: 'Комментарий' },
];

/** Название колонки для сообщений: заголовок шаблона без звёздочки («Со счета»). */
export function columnTitle(field: FinmapField): string {
  return FINMAP_COLUMNS.find((c) => c.field === field)!.header.replace('*', '');
}

/** Пары «латинская буква → кириллическая» по порядку символов двух строк одной длины. */
function pairs(latin: string, cyrillic: string): Record<string, string> {
  return Object.fromEntries([...latin].map((ch, i) => [ch, cyrillic[i]!]));
}

/** Латинские двойники кириллицы (§2.2): A B C E H K M O P T X a c e o p x y → А В С Е Н К М О Р Т Х а с е о р х у. */
const TWINS = pairs('ABCEHKMOPTXaceopxy', '\u0410\u0412\u0421\u0415\u041D\u041A\u041C\u041E\u0420\u0422\u0425\u0430\u0441\u0435\u043E\u0440\u0445\u0443');
const TWIN_RE = /[ABCEHKMOPTXaceopxy]/g;
/**
 * Ключ сравнения строится после foldCase, поэтому заглавным двойникам B H K M T нужны и строчные пары
 * (b → в, h → н, k → к, m → м, t → т): иначе «STEAM» и «Steam» дали бы разные ключи.
 */
const KEY_TWINS = pairs('abcehkmoptxy', '\u0430\u0432\u0441\u0435\u043D\u043A\u043C\u043E\u0440\u0442\u0445\u0443');

/**
 * Ключ сравнения названий (§4.9): cleanName, нижний регистр по правилам ru с «ё» → «е», латинские двойники → кириллица.
 * «Kacca», «КАССА» и «касса» совпадают; «Kaspi» и «Каспи» — нет (у s и i пары нет). Зависит только от
 * foldCase(cleanName(s)), поэтому совпадение ключа тега (tagKey) и проекта (ulower) влечёт совпадение nameKey.
 */
export function nameKey(s: string): string {
  return foldCase(cleanName(s)).replace(/[abcehkmoptxy]/g, (ch) => KEY_TWINS[ch]!);
}

/** Ключ заголовка колонки (§2.2): как nameKey, без «*», кавычек любого вида; пробелы схлопнуты. */
export function headerKey(s: string): string {
  return nameKey(cleanName(s).replace(/[*"'«»„“”‘’]/g, ''));
}

const FIELD_BY_KEY = new Map(FINMAP_COLUMNS.map((c) => [headerKey(c.header), c.field]));

/** Колонка по заголовку файла; null — заголовок не распознан. */
export function headerField(title: string): FinmapField | null {
  return FIELD_BY_KEY.get(headerKey(title)) ?? null;
}

/** Сколько разных колонок §2.1 распознано в строке (выбор разделителя CSV). */
export function countKnownHeaders(values: string[]): number {
  return new Set(values.map(headerField).filter((f) => f !== null)).size;
}

/** Строка заголовков: есть «Дата платежа» и «Сумма в валюте счета» (§2.2). */
export function isHeaderRow(values: string[]): boolean {
  const fields = new Set(values.map(headerField));
  return fields.has('paidAt') && fields.has('amount');
}

/**
 * Название, которое создаётся (§4.9): в словах с кириллицей латинские двойники заменяются кириллицей
 * («Kacca» с кириллической «с» → «Касса»); чисто латинские слова («Kaspi», «Steam», «PC») не трогаются.
 */
export function repairName(s: string): string {
  return cleanName(s).replace(/\p{L}+/gu, (word) => (/\p{Script=Cyrillic}/u.test(word) ? word.replace(TWIN_RE, (ch) => TWINS[ch]!) : word));
}

/**
 * Другие написания системных категорий Finmap (§4.5). Пусто, пока сверка §12 шаг 2 не покажет различий;
 * наполнять — только названиями из интерфейса Finmap.
 */
export const FINMAP_SYSTEM_ALIASES: readonly { name: string; kind: CategoryKind; key: SystemKey }[] = [];

/** Системная категория по названию из файла и виду операции; системное название с чужим видом — null. */
export function systemKeyOf(name: string, kind: CategoryKind): SystemKey | null {
  const key = nameKey(name);
  const own = SYSTEM_CATEGORIES.find((c) => c.kind === kind && nameKey(c.name) === key);
  if (own) return own.key;
  return FINMAP_SYSTEM_ALIASES.find((a) => a.kind === kind && nameKey(a.name) === key)?.key ?? null;
}
```

Создайте `src/server/modules/imports/csv.ts`:

```ts
import { countKnownHeaders, isHeaderRow } from '../../../shared/finmap-format';
import { damaged, fileError, IMPORT_READ_MAX_ROWS, tooManyRows } from './errors';
import type { SheetData, SheetRow } from './xlsx-read';

/** CSV (§2.5 спецификации импорта): колонки и строка заголовков — как у XLSX; значения — всегда текст. */
export type CsvEncoding = 'utf-8' | 'utf-16le' | 'windows-1251';

/** Не больше полей в строке и символов в строке (§2.5). */
export const CSV_MAX_FIELDS = 64;
export const CSV_MAX_RECORD = 1024 * 1024;
/** Разделители-кандидаты в порядке предпочтения при равенстве (§2.5). */
const DELIMITERS = [';', '\t', ','] as const;
/** Строка заголовков ищется в первых 10 записях (§2.2). */
const HEADER_SEARCH = 10;

/** Кодировка по BOM, затем строгий UTF-8, иначе cp1251 (русский Excel сохраняет «CSV (разделители — точка с запятой)» в ней). */
export function decodeCsv(data: Buffer): { text: string; encoding: CsvEncoding } {
  if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(data.subarray(3)), encoding: 'utf-8' };
  }
  if (data[0] === 0xff && data[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(data.subarray(2)), encoding: 'utf-16le' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(data), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1251').decode(data), encoding: 'windows-1251' };
  }
}

const QUOTE = 34;
const CR = 13;
const LF = 10;

/**
 * Обход записей CSV по RFC 4180: поле в кавычках, `""` внутри — кавычка, переводы строк внутри кавычек — часть значения.
 * strict — незакрытая кавычка даёт F3 (при подборе разделителя — просто конец обхода). visit вернул false — стоп.
 */
export function eachCsvRecord(text: string, delimiter: string, strict: boolean, visit: (values: string[], index: number) => boolean | void): void {
  const delim = delimiter.charCodeAt(0);
  const n = text.length;
  const isStop = (c: number) => c === delim || c === CR || c === LF;
  let record: string[] = [];
  let count = 0;
  let recordStart = 0;
  let i = 0;
  while (i <= n) {
    let value = '';
    if (text.charCodeAt(i) === QUOTE) {
      let start = i + 1;
      for (;;) {
        const q = text.indexOf('"', start);
        if (q < 0) {
          if (strict) throw damaged('незакрытая кавычка в CSV');
          return;
        }
        if (text.charCodeAt(q + 1) === QUOTE) {
          value += text.slice(start, q + 1);
          start = q + 2;
          continue;
        }
        value += text.slice(start, q);
        i = q + 1;
        break;
      }
    }
    // без кавычек (или хвост после закрывающей кавычки) — до разделителя или конца строки
    let k = i;
    while (k < n && !isStop(text.charCodeAt(k))) k++;
    value += text.slice(i, k);
    i = k;
    record.push(value);
    if (record.length > CSV_MAX_FIELDS) throw damaged(`в строке CSV больше ${CSV_MAX_FIELDS} полей`);
    if (i - recordStart > CSV_MAX_RECORD) throw damaged('строка CSV длиннее 1 МБ');
    if (i >= n) {
      visit(record, count);
      return;
    }
    const c = text.charCodeAt(i);
    if (c === delim) {
      i++;
      continue;
    }
    i += c === CR && text.charCodeAt(i + 1) === LF ? 2 : 1;
    if (visit(record, count++) === false) return;
    record = [];
    recordStart = i;
    if (i >= n) return; // перевод строки в конце файла — не ещё одна запись
  }
}

/** Первые limit записей CSV (без строгой проверки кавычек) — для подбора разделителя и тестов. */
export function parseCsv(text: string, delimiter: string, limit = Infinity, strict = false): string[][] {
  const records: string[][] = [];
  if (limit <= 0) return records;
  eachCsvRecord(text, delimiter, strict, (values) => records.push(values) < limit);
  return records;
}

/** Разделитель, при котором в первых 10 записях распознано больше всего заголовков §2.1 (равенство — «;», TAB, «,»). */
export function chooseDelimiter(text: string): { delimiter: string; header: boolean } {
  let best: { delimiter: string; score: number; header: boolean } = { delimiter: ';', score: -1, header: false };
  for (const delimiter of DELIMITERS) {
    const head = parseCsv(text, delimiter, HEADER_SEARCH);
    const score = Math.max(0, ...head.map(countKnownHeaders));
    if (score > best.score) best = { delimiter, score, header: head.some(isHeaderRow) };
  }
  return { delimiter: best.delimiter, header: best.header };
}

/** CSV → строки ячеек: номер строки — номер записи с 1; пустые значения не хранятся. */
export function readCsv(data: Buffer): SheetData {
  const { text, encoding } = decodeCsv(data);
  const { delimiter, header } = chooseDelimiter(text);
  // cp1251 — догадка: если и в ней заголовков нет, файл в другой кодировке
  if (encoding === 'windows-1251' && !header) throw fileError('F8', 'Не удалось прочитать CSV: сохраните его в UTF-8');
  const rows: SheetRow[] = [];
  eachCsvRecord(text, delimiter, true, (values, index) => {
    const cells = new Map<number, { kind: 'text'; value: string }>();
    values.forEach((value, col) => {
      if (value.trim() !== '') cells.set(col, { kind: 'text', value });
    });
    // строк больше предела — F5 сразу, не дочитывая файл
    if (cells.size > 0 && rows.push({ row: index + 1, cells }) > IMPORT_READ_MAX_ROWS) throw tooManyRows();
  });
  return { rows, date1904: false };
}
```

Создайте `src/server/modules/imports/read-file.ts`:

```ts
import { readCsv } from './csv';
import { fileError } from './errors';
import { readXlsx, type SheetData } from './xlsx-read';

/** Файл импорта больше 30 МБ не принимается (§2.4): 413 TOO_LARGE. */
export const IMPORT_MAX_BYTES = 30 * 1024 * 1024;

export type ImportFileKind = 'xlsx' | 'csv';

const startsWith = (data: Buffer, sig: number[]) => data.length >= sig.length && sig.every((b, i) => data[i] === b);

/**
 * Тип файла (§3.4): ZIP — XLSX (книгу проверяет читатель, иначе F2); OLE (`D0 CF 11 E0`) — старый .xls;
 * .csv или .txt без нулевых байтов (кроме UTF-16LE с BOM) — CSV; иначе F2. Пустой файл — F1.
 */
export function detectImportFile(data: Buffer, name: string): ImportFileKind {
  if (data.length === 0) throw fileError('F1', 'Файл пустой');
  if (startsWith(data, [0x50, 0x4b, 0x03, 0x04])) return 'xlsx';
  if (startsWith(data, [0xd0, 0xcf, 0x11, 0xe0])) throw fileError('F2', 'Старый формат .xls — сохраните файл как .xlsx');
  if (/\.(csv|txt)$/i.test(name.trim()) && (startsWith(data, [0xff, 0xfe]) || !data.includes(0))) return 'csv';
  throw fileError('F2', 'Нужен файл .xlsx или .csv');
}

/** Строки первого листа XLSX или CSV. */
export function readImportFile(data: Buffer, name: string): SheetData {
  return detectImportFile(data, name) === 'xlsx' ? readXlsx(data) : readCsv(data);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/shared/finmap-format.test.ts tests/server/import-csv.test.ts`
Expected: PASS, 6 и 6 тестов.

Run: `npm test` и `npm run typecheck`
Expected: 883 пройдено и 1 пропущен (в том числе `tests/shared/terminology.test.ts`); typecheck без ошибок.

- [ ] **Step 5: Commit**

```bash
git add src/shared/finmap-format.ts src/server/modules/imports/csv.ts src/server/modules/imports/read-file.ts tests/shared/finmap-format.test.ts tests/server/import-csv.test.ts
git commit -m "feat: импорт — формат Finmap (ключи заголовков и названий), CSV и тип файла" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Разбор строк и каталог ошибок (§2.2, §2.3, §4.1–§4.10)

**Files:**
- Modify: `src/server/modules/imports/errors.ts` (дописать в конец)
- Create: `src/server/modules/imports/parse-row.ts`
- Test: `tests/server/import-parse-row.test.ts`

**Interfaces:**
- Consumes: `getCurrency` (`src/shared/currencies.ts`); `isValidDate`, `startOfDayUtc` (`src/shared/dates.ts`); `CATEGORY_NAME_MAX` (`src/shared/schemas/categories.ts`), `COUNTERPARTY_NAME_MAX` (`…/counterparties.ts`), `TAG_NAME_MAX` (`…/tags.ts`); `cleanName`; `columnTitle`, `headerField`, `isHeaderRow`, `nameKey`, `FinmapField` (задача 3); `CELL_TOO_LONG`, `Cell`, `SheetData`, `SheetRow` (задача 2); `fileError`, `IMPORT_MAX_ROWS`, `tooManyRows` (задача 1).
- Produces:
  - `errors.ts` (дописано): `type RowErrorCode` (R01–R18), `type WarningCode` (W1–W10), `type AccountErrorCode` (A1–A5); `interface RowIssue { code; message; row }`; `interface IssueGroup { code; message; count; rows }`; `ISSUE_ROWS_MAX = 20`; `ISSUE_GROUPS_MAX = 100`; `isRowError(i)`; `MESSAGES` (тексты §4.10, у части — функции); `groupIssues(issues): IssueGroup[]`;
  - `parse-row.ts`: `type ImportType`; `interface FileAccount { key; name }`; `interface ImportRow { row; type; paidAt; date; minute; accrualDate; amount: string; baseAmount: number | null; account: FileAccount; toAccount: FileAccount | null; category; subcategory; counterparty; project; tags: string[]; comment }`; `interface ParseContext { timezone; baseCurrency; today; date1904 }`; `interface ParsedFile { headerRow; total; rows: ImportRow[]; future: number[]; issues: RowIssue[] }`; `interface ParsedNumber { negative; value }`; `parseCellNumber(text)`; `parseTextAmount(text)`; `parseAmountCell(cell)`; `decimalToMinor(value, minorUnits): { minor; rounded } | null`; `interface WallTime { date; seconds }`; `fromExcelSerial(serial, date1904)`; `parseWallTime(cell, date1904)`; `wallToIso(w, timeZone)`; `findHeader(rows)`; `type RowResult`; `parseRow(sheetRow, columns, ctx): RowResult`; `parseSheet(sheet, ctx): ParsedFile`.

- [ ] **Step 1: Write the failing test**

Создайте `tests/server/import-parse-row.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/server/errors';
import { groupIssues, type RowIssue } from '../../src/server/modules/imports/errors';
import {
  decimalToMinor,
  findHeader,
  fromExcelSerial,
  parseCellNumber,
  parseSheet,
  parseTextAmount,
  parseWallTime,
  type ParseContext,
} from '../../src/server/modules/imports/parse-row';
import { CELL_TOO_LONG, readXlsx, type Cell, type SheetRow } from '../../src/server/modules/imports/xlsx-read';
import { FINMAP_COLUMNS, type FinmapField } from '../../src/shared/finmap-format';
import { excelSerial, finmapLikeXlsx } from '../helpers/finmap-like';

const CTX: ParseContext = { timezone: 'Asia/Almaty', baseCurrency: 'KZT', today: '2026-10-06', date1904: false };
const COL = Object.fromEntries(FINMAP_COLUMNS.map((c, i) => [c.field, i])) as Record<FinmapField, number>;
const text = (value: string): Cell => ({ kind: 'text', value });
const num = (value: number | string): Cell => ({ kind: 'number', value: String(value) });

/** Строка листа по полям: строка — текст, число — число Excel. */
function row(n: number, v: Partial<Record<FinmapField, string | number | Cell>>): SheetRow {
  const cells = new Map<number, Cell>();
  for (const [f, x] of Object.entries(v)) cells.set(COL[f as FinmapField], typeof x === 'string' ? text(x) : typeof x === 'number' ? num(x) : x);
  return { row: n, cells };
}
const HEADER = row(1, Object.fromEntries(FINMAP_COLUMNS.map((c) => [c.field, c.header])));
/** Разбор строк данных под стандартными заголовками. */
const parse = (...rows: SheetRow[]) => parseSheet({ rows: [HEADER, ...rows], date1904: false }, CTX);
/** Замечания одной строки: «код: текст». */
const issuesOf = (...data: Partial<Record<FinmapField, string | number | Cell>>[]) =>
  parse(...data.map((d, i) => row(i + 2, d))).issues.map((i) => `${i.code}: ${i.message}`);
const BASE = { paidAt: '05.10.2026 10:00', amount: '100' } as const;

function f(code: string, fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).details).toEqual({ fileCode: code });
    return (e as AppError).message;
  }
  throw new Error(`ожидалась ${code}`);
}

describe('суммы (§4.2 спецификации импорта)', () => {
  it('число ячейки — точно, без parseFloat: экспонента, хвосты float до 15 значащих цифр, минус', () => {
    expect(parseCellNumber('10596')).toEqual({ negative: false, value: '10596' });
    expect(parseCellNumber('8200.5')).toEqual({ negative: false, value: '8200.5' });
    expect(parseCellNumber('1.2345E+5')).toEqual({ negative: false, value: '123450' });
    expect(parseCellNumber('1E-3')).toEqual({ negative: false, value: '0.001' });
    expect(parseCellNumber('1317.0000000000002')).toEqual({ negative: false, value: '1317' });
    expect(parseCellNumber('12345678901234567')).toEqual({ negative: false, value: '12345678901234600' });
    expect(parseCellNumber('-8500')).toEqual({ negative: true, value: '8500' });
    expect(parseCellNumber('-0')).toEqual({ negative: false, value: '0' });
    expect(parseCellNumber('abc')).toBeNull();
    expect(parseCellNumber('1E+999')).toBeNull();
  });

  it('текст: пробелы, U+00A0, U+202F и ₸; минус «-» и «\u2212», плюс; точка и запятая вместе; один знак — десятичный', () => {
    expect(parseTextAmount('1 500,50')).toEqual({ negative: false, value: '1500.5' });
    expect(parseTextAmount('1\u00A0500.5\u00A0₸')).toEqual({ negative: false, value: '1500.5' });
    expect(parseTextAmount('1\u202F234\u202F567,89')).toEqual({ negative: false, value: '1234567.89' });
    expect(parseTextAmount('1,234,567.89')).toEqual({ negative: false, value: '1234567.89' });
    expect(parseTextAmount('1.234.567,89')).toEqual({ negative: false, value: '1234567.89' });
    expect(parseTextAmount('\u22121 500 ₸')).toEqual({ negative: true, value: '1500' });
    expect(parseTextAmount('-10')).toEqual({ negative: true, value: '10' });
    expect(parseTextAmount('+10')).toEqual({ negative: false, value: '10' });
    expect(parseTextAmount(',5')).toEqual({ negative: false, value: '0.5' });
    for (const bad of ['1.234.567', '1,2,3', '1.2,3.4', 'abc', '', '-', '1e5', '10 тенге']) expect(parseTextAmount(bad), bad).toBeNull();
  });

  it('минимальные единицы: half-up, признак округления (W10), KZT, JPY, KWD, переполнение', () => {
    expect(decimalToMinor('8200.5', 2)).toEqual({ minor: 820050, rounded: false });
    expect(decimalToMinor('0.125', 2)).toEqual({ minor: 13, rounded: true });
    expect(decimalToMinor('0.124', 2)).toEqual({ minor: 12, rounded: true });
    expect(decimalToMinor('1234.5', 0)).toEqual({ minor: 1235, rounded: true });
    expect(decimalToMinor('1.2345', 3)).toEqual({ minor: 1235, rounded: true });
    expect(decimalToMinor('1.5', 3)).toEqual({ minor: 1500, rounded: false });
    expect(decimalToMinor('90071992547409.91', 2)).toEqual({ minor: Number.MAX_SAFE_INTEGER, rounded: false });
    expect(decimalToMinor('90071992547409.92', 2)).toBeNull();
  });
});

describe('даты (§4.3)', () => {
  it('число Excel: доля суток до секунды, 86 400 секунд — следующие сутки, date1904', () => {
    expect(fromExcelSerial(excelSerial('2026-10-03', '22:07:00'), false)).toEqual({ date: '2026-10-03', seconds: 22 * 3600 + 7 * 60 });
    expect(fromExcelSerial(46298.50001, false)).toEqual({ date: '2026-10-03', seconds: 43201 });
    expect(fromExcelSerial(46298.9999999, false)).toEqual({ date: '2026-10-04', seconds: 0 });
    expect(fromExcelSerial(46300, true)).toEqual({ date: '2030-10-06', seconds: 0 });
    expect(fromExcelSerial(-1, false)).toBeNull();
    expect(fromExcelSerial(3_000_000, false)).toBeNull();
  });

  it('текст: д.м.гггг, дд-мм-гггг, дд/мм/гггг, время через пробел или T, ISO, число текстом; 31.02 и 24:00 — нет', () => {
    const w = (v: string) => parseWallTime(text(v), false);
    expect(w('5.10.2026')).toEqual({ date: '2026-10-05', seconds: 0 });
    expect(w('05-10-2026 9:05')).toEqual({ date: '2026-10-05', seconds: 9 * 3600 + 300 });
    expect(w('05/10/2026T09:05:07')).toEqual({ date: '2026-10-05', seconds: 9 * 3600 + 307 });
    expect(w('01.09.2026 00:00:00')).toEqual({ date: '2026-09-01', seconds: 0 });
    expect(w('30.09.2026 23:59:59')).toEqual({ date: '2026-09-30', seconds: 86_399 });
    expect(w('2026-10-05')).toEqual({ date: '2026-10-05', seconds: 0 });
    expect(w('2026-10-05T10:00:00.000')).toEqual({ date: '2026-10-05', seconds: 36_000 });
    expect(w('46300.5')).toEqual({ date: '2026-10-05', seconds: 43_200 });
    expect(parseWallTime(num('46300.25'), false)).toEqual({ date: '2026-10-05', seconds: 21_600 });
    for (const bad of ['31.02.2026', '05.10.2026 24:00', '05.13.2026', 'вчера', '2026-10-5', '05.10.26']) expect(w(bad), bad).toBeNull();
  });

  it('граница суток в APP_TIMEZONE: 23:30 и 00:30 по Алматы; будущая дата — W1 и строка пропущена; год 1989 — R03', () => {
    const p = parse(
      row(2, { paidAt: '05.10.2026 23:30', amount: 1, fromAccount: 'Касса' }),
      row(3, { paidAt: '06.10.2026 00:30', amount: 1, fromAccount: 'Касса' }),
      row(4, { paidAt: '07.10.2026 00:00', amount: 'не сумма', fromAccount: 'Касса' }),
      row(5, { paidAt: '31.12.1989', amount: 1, fromAccount: 'Касса' }),
    );
    expect(p.rows.map((r) => [r.paidAt, r.date, r.minute])).toEqual([
      ['2026-10-05T18:30:00.000Z', '2026-10-05', '2026-10-05 23:30'],
      ['2026-10-05T19:30:00.000Z', '2026-10-06', '2026-10-06 00:30'],
    ]);
    expect(p.future).toEqual([4]);
    expect(p.issues).toEqual([
      { code: 'W1', message: 'Дата платежа в будущем — плановые операции появятся позже, строки пропущены', row: 4 },
      { code: 'R03', message: 'Дата платежа раньше 1990 года', row: 5 },
    ]);
    expect(p.total).toBe(4);
  });
});

describe('строки (§4.1, §4.3–§4.8)', () => {
  it('файл «как у Finmap»: заголовки с двойниками, доход, зарплата с периодом текстом, перевод, расход с копейками и тегами', () => {
    const p = parseSheet(readXlsx(finmapLikeXlsx()), CTX);
    expect(p.headerRow).toBe(1);
    expect(p.issues).toEqual([]);
    expect(p.rows).toEqual([
      {
        row: 2,
        type: 'income',
        paidAt: '2026-10-03T17:07:00.000Z',
        date: '2026-10-03',
        minute: '2026-10-03 22:07',
        accrualDate: null,
        amount: '10596',
        baseAmount: 1059600,
        account: { key: 'касса-1', name: 'Касса-1' },
        toAccount: null,
        category: 'Бар',
        subcategory: null,
        counterparty: null,
        project: null,
        tags: [],
        comment: null,
      },
      expect.objectContaining({
        row: 3,
        type: 'expense',
        minute: '2026-10-03 22:07',
        accrualDate: '2026-09-01',
        amount: '8500',
        account: { key: 'касса-1', name: 'Касса-1' },
        category: 'Зарплата',
        subcategory: 'Администраторы',
        counterparty: 'Сотрудник А',
      }),
      expect.objectContaining({ row: 4, type: 'transfer', account: { key: 'касса-1', name: 'Касса-1' }, toAccount: { key: 'банк-2', name: 'Банк-2' } }),
      expect.objectContaining({
        row: 5,
        type: 'expense',
        paidAt: '2026-10-04T19:30:00.000Z',
        accrualDate: '2026-10-01',
        amount: '8200.5',
        baseAmount: 820050,
        tags: ['Смена', 'Ночь'],
        comment: 'Аренда за октябрь',
      }),
    ]);
  });

  it('тип по «Со счета» / «На счет»: расход, доход, перевод; пусто — R08; одинаковые по ключу — R09', () => {
    const p = parse(
      row(2, { ...BASE, fromAccount: 'Касса' }),
      row(3, { ...BASE, toAccount: 'Касса' }),
      row(4, { ...BASE, fromAccount: 'Касса', toAccount: 'Банк' }),
      row(5, { ...BASE }),
      row(6, { ...BASE, fromAccount: 'Касса', toAccount: 'КАССА' }),
    );
    expect(p.rows.map((r) => [r.type, r.account.name, r.toAccount?.name ?? null])).toEqual([
      ['expense', 'Касса', null],
      ['income', 'Касса', null],
      ['transfer', 'Касса', 'Банк'],
    ]);
    expect(p.issues.map((i) => [i.code, i.row])).toEqual([
      ['R08', 5],
      ['R09', 6],
    ]);
  });

  it('суммы в строке: пусто R04, не число R05, ноль R06, минус у расхода — модуль, у дохода — R10; F округляется с W10, ноль F — как пусто', () => {
    const p = parse(
      row(2, { paidAt: '05.10.2026', fromAccount: 'Касса' }),
      row(3, { paidAt: '05.10.2026', amount: '12 тыс', fromAccount: 'Касса' }),
      row(4, { paidAt: '05.10.2026', amount: '0,00', fromAccount: 'Касса' }),
      row(5, { paidAt: '05.10.2026', amount: -8500, fromAccount: 'Касса' }),
      row(6, { paidAt: '05.10.2026', amount: '-100', toAccount: 'Касса' }),
      row(7, { paidAt: '05.10.2026', amount: '1', baseAmount: '475,125', fromAccount: 'Касса' }),
      row(8, { paidAt: '05.10.2026', amount: '1', baseAmount: 0, fromAccount: 'Касса' }),
    );
    expect(p.issues.map((i) => `${i.row} ${i.code}: ${i.message}`)).toEqual([
      '2 R04: Нет суммы',
      '3 R05: Не удалось прочитать сумму «12 тыс»',
      '4 R06: Сумма равна нулю',
      '6 R10: Отрицательная сумма у дохода',
      '7 W10: Больше 2 знаков после запятой — сумма округлена',
    ]);
    expect(p.rows.map((r) => [r.row, r.amount, r.baseAmount])).toEqual([
      [5, '8500', null],
      [7, '1', 47513],
      [8, '1', null],
    ]);
  });

  it('дата начисления: B; C — начало периода; B и C — B и W6; D раньше C — R11; неразборчивые — R11; у перевода — W3', () => {
    const p = parse(
      row(2, { ...BASE, fromAccount: 'К', accrualDate: '30.09.2026' }),
      row(3, { ...BASE, fromAccount: 'К', periodFrom: '01.09.2026 00:00:00', periodTo: '30.09.2026 23:59:59' }),
      row(4, { ...BASE, fromAccount: 'К', accrualDate: num(excelSerial('2026-09-15', '12:00:00')), periodFrom: '01.09.2026' }),
      row(5, { ...BASE, fromAccount: 'К', periodFrom: '01.10.2026', periodTo: '30.09.2026' }),
      row(6, { ...BASE, fromAccount: 'К', accrualDate: 'сентябрь' }),
      row(7, { ...BASE, fromAccount: 'К', toAccount: 'Б', periodFrom: '01.09.2026' }),
    );
    expect(p.rows.map((r) => [r.row, r.accrualDate])).toEqual([
      [2, '2026-09-30'],
      [3, '2026-09-01'],
      [4, '2026-09-15'],
      [7, null],
    ]);
    expect(p.issues.map((i) => `${i.row} ${i.code}: ${i.message}`)).toEqual([
      '4 W6: Есть и дата начисления, и период — взята дата начисления',
      '5 R11: Конец периода раньше начала',
      '6 R11: Не удалось прочитать дату начисления «сентябрь»',
      '7 W3: У перевода нет даты начисления — она не перенесена',
    ]);
  });

  it('категория, подконтрагент, проект, теги, комментарий; у перевода категория и контрагент не переносятся (W2), проект — да', () => {
    const p = parse(
      row(2, { ...BASE, fromAccount: 'К', category: ' Зарплата ', subcategory: 'Админ', counterparty: 'Отдел', subcounterparty: 'Сотрудник А', project: 'Клуб', subproject: 'Зал', tags: 'Смена, смена ,, Ночь', comment: '  текст  ' }),
      row(3, { ...BASE, fromAccount: 'К', toAccount: 'Б', category: 'Перевод', counterparty: 'Банк', project: 'Клуб' }),
      row(4, { ...BASE, fromAccount: 'К', subcategory: 'Без родителя' }),
    );
    expect(p.rows[0]).toMatchObject({ category: 'Зарплата', subcategory: 'Админ', counterparty: 'Сотрудник А', project: 'Клуб', tags: ['Смена', 'Ночь'], comment: 'текст' });
    expect(p.rows[1]).toMatchObject({ type: 'transfer', category: null, subcategory: null, counterparty: null, project: 'Клуб' });
    expect(p.issues.map((i) => `${i.row} ${i.code}`)).toEqual(['2 W4', '2 W5', '3 W2', '4 R12']);
  });

  it('пределы: названия (R13), 20 тегов (R14), комментарий 2 000 / 2 001 (R15), ошибка Excel и длинная ячейка (R18)', () => {
    expect(
      issuesOf(
        { ...BASE, fromAccount: 'К', category: 'к'.repeat(101), counterparty: 'к'.repeat(201), project: 'п'.repeat(101), tags: 'т'.repeat(51) },
        { ...BASE, fromAccount: 'К', tags: Array.from({ length: 21 }, (_, i) => `т${i}`).join(',') },
        { ...BASE, fromAccount: 'К', comment: 'к'.repeat(2001) },
        { ...BASE, fromAccount: 'К', amount: { kind: 'error', value: '#N/A' } },
        { ...BASE, fromAccount: 'К', comment: { kind: 'error', value: CELL_TOO_LONG } },
      ),
    ).toEqual([
      'R13: Категория длиннее 100 символов',
      'R13: Контрагент длиннее 200 символов',
      'R13: Проект длиннее 100 символов',
      'R13: Тег длиннее 50 символов',
      'R14: Больше 20 тегов',
      'R15: Комментарий длиннее 2 000 символов',
      'R18: Ошибка Excel #N/A в колонке «Сумма в валюте счета»',
      'R18: Ячейка длиннее 32 767 символов',
    ]);
    expect(issuesOf({ ...BASE, fromAccount: 'К', comment: 'к'.repeat(2000), tags: Array.from({ length: 20 }, (_, i) => `т${i}`).join(',') })).toEqual([]);
  });

  it('дата платежа: пусто — R01, неразборчиво — R02 со значением', () => {
    expect(issuesOf({ amount: 1, fromAccount: 'К' }, { paidAt: '31.02.2026', amount: 1, fromAccount: 'К' })).toEqual([
      'R01: Нет даты платежа',
      'R02: Не удалось прочитать дату платежа «31.02.2026»',
    ]);
  });
});

describe('файл целиком (§2.2, §2.3, §4.10)', () => {
  it('заголовки в любом порядке, строки над ними, незнакомая колонка — W7; пустые строки не считаются', () => {
    const head: SheetRow = { row: 3, cells: new Map([[0, text('Сумма в валюте счета')], [2, text('\u0048а счет')], [3, text('Примечание')], [5, text('Дата платежа')]]) };
    const p = parseSheet(
      {
        date1904: false,
        rows: [
          { row: 1, cells: new Map([[0, text('Выгрузка')]]) },
          head,
          { row: 4, cells: new Map([[0, num(10)], [2, text('Касса')], [5, text('05.10.2026')]]) },
          { row: 5, cells: new Map([[0, text('   ')], [3, text('только неизвестная колонка')]]) },
        ],
      },
      CTX,
    );
    expect(p).toMatchObject({ headerRow: 3, total: 1, rows: [{ row: 4, type: 'income', amount: '10' }] });
    expect(p.issues).toEqual([{ code: 'W7', message: 'Колонка «Примечание» не распознана — пропущена', row: 3 }]);
  });

  it('нет заголовков, нет счёта, повтор колонки — F6; заголовки ниже 10-й строки не ищутся; нет данных — F7; больше 50 000 — F5', () => {
    const F6 = 'Не найдена строка заголовков: нужны колонки «Дата платежа» и «Сумма в валюте счета» и хотя бы одна из «Со счета», «На счет»';
    expect(f('F6', () => findHeader([row(1, { paidAt: 'Дата', amount: 'Сумма' })]))).toBe(F6);
    expect(f('F6', () => findHeader([row(1, { paidAt: 'Дата платежа', amount: 'Сумма в валюте счета' })]))).toBe(F6);
    expect(f('F6', () => findHeader([{ ...HEADER, row: 11 }]))).toBe(F6);
    const twice: SheetRow = { row: 1, cells: new Map([...HEADER.cells, [16, text('Со счёта*')]]) };
    expect(f('F6', () => findHeader([twice]))).toBe('Колонка «Со счета» встречается дважды');
    expect(f('F7', () => parse(row(2, { comment: ' ' })))).toBe('В файле нет операций');
    const many = Array.from({ length: 50_001 }, (_, i) => row(i + 2, { ...BASE, fromAccount: 'К' }));
    expect(f('F5', () => parse(...many))).toBe('В файле больше 50 000 строк — разбейте его по годам');
  });

  it('группы замечаний: код и текст, число и до 20 первых номеров по возрастанию', () => {
    const issues: RowIssue[] = [
      ...Array.from({ length: 25 }, (_, i) => ({ code: 'R04' as const, message: 'Нет суммы', row: 100 - i })),
      { code: 'R17', message: 'Категория «А» в архиве — верните из архива', row: 3 },
      { code: 'R17', message: 'Категория «Б» в архиве — верните из архива', row: 2 },
      { code: 'W8', message: 'Этот файл уже импортирован', row: 0 },
    ];
    const g = groupIssues(issues);
    expect(g.map((x) => [x.code, x.message.slice(0, 15), x.count, x.rows.length])).toEqual([
      ['W8', 'Этот файл уже и', 1, 0],
      ['R17', 'Категория «Б» в', 1, 1],
      ['R17', 'Категория «А» в', 1, 1],
      ['R04', 'Нет суммы', 25, 20],
    ]);
    expect(g[3]!.rows).toEqual(Array.from({ length: 20 }, (_, i) => 76 + i));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/import-parse-row.test.ts`
Expected: FAIL — модуль `imports/parse-row` не найден, `groupIssues` не экспортирован.

- [ ] **Step 3: Write minimal implementation**

Допишите в конец `src/server/modules/imports/errors.ts`:

```ts
/** Ошибки строк R* блокируют импорт; предупреждения W* — нет (§4.10). */
export type RowErrorCode = 'R01' | 'R02' | 'R03' | 'R04' | 'R05' | 'R06' | 'R07' | 'R08' | 'R09' | 'R10' | 'R11' | 'R12' | 'R13' | 'R14' | 'R15' | 'R16' | 'R17' | 'R18';
export type WarningCode = 'W1' | 'W2' | 'W3' | 'W4' | 'W5' | 'W6' | 'W7' | 'W8' | 'W9' | 'W10';
/** Ошибки счетов — в карточке счёта (§5.4). */
export type AccountErrorCode = 'A1' | 'A2' | 'A3' | 'A4' | 'A5';

/** Замечание к строке файла; row — номер строки Excel (у W8 — 0: замечание ко всему файлу). */
export interface RowIssue {
  code: RowErrorCode | WarningCode;
  message: string;
  row: number;
}

/** Группа замечаний в ответе: один код и текст, число строк и до 20 первых номеров (§4.10 «Объём ответа»). */
export interface IssueGroup {
  code: string;
  message: string;
  count: number;
  rows: number[];
}

export const ISSUE_ROWS_MAX = 20;
/** Не больше групп в ответе: тексты с значениями (R02, R16, R17) не раздувают ответ на большом файле. */
export const ISSUE_GROUPS_MAX = 100;

export const isRowError = (i: RowIssue) => i.code.startsWith('R');

/** Значение в тексте сообщения: не длиннее 50 символов. */
const clip = (v: string) => (v.length > 50 ? `${v.slice(0, 50)}…` : v);

/** Тексты ошибок и предупреждений (§4.10). */
export const MESSAGES = {
  R01: 'Нет даты платежа',
  R02: (v: string) => `Не удалось прочитать дату платежа «${clip(v)}»`,
  R03: 'Дата платежа раньше 1990 года',
  R04: 'Нет суммы',
  R05: (v: string) => `Не удалось прочитать сумму «${clip(v)}»`,
  R06: 'Сумма равна нулю',
  R07: 'Слишком большая сумма',
  R08: 'Не указан счёт: заполните «Со счета», «На счет» или обе колонки',
  R09: 'Счета перевода совпадают',
  R10: 'Отрицательная сумма у дохода',
  R11: (what: string, v: string) => `Не удалось прочитать ${what} «${clip(v)}»`,
  R11_PERIOD: 'Конец периода раньше начала',
  R12: 'Подкатегория без категории',
  R13: (what: string, max: number) => `${what} длиннее ${max} символов`,
  R14: 'Больше 20 тегов',
  R15: 'Комментарий длиннее 2 000 символов',
  R16: (currency: string, date: string) =>
    `Нет курса ${currency} на ${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)} — заполните «Сумму в валюте компании» или добавьте курс на дату`,
  R17: (what: string, name: string) => `${what} «${clip(name)}» в архиве — верните из архива`,
  R18_LONG: 'Ячейка длиннее 32 767 символов',
  R18_EXCEL: (v: string, column: string) => `Ошибка Excel ${clip(v)} в колонке «${column}»`,
  W1: 'Дата платежа в будущем — плановые операции появятся позже, строки пропущены',
  W2: 'У перевода нет категории и контрагента — они не перенесены',
  W3: 'У перевода нет даты начисления — она не перенесена',
  W4: 'Подконтрагент стал контрагентом',
  W5: 'Подпроект не переносится',
  W6: 'Есть и дата начисления, и период — взята дата начисления',
  W7: (title: string) => `Колонка «${clip(title)}» не распознана — пропущена`,
  W8: (when: string, user: string) => `Этот файл уже импортирован ${when} (${user}) — совпадение по SHA-256, импорт не отменён`,
  W9: 'У счёта в валюте компании «Сумма в валюте компании» отличается от суммы — взята сумма счёта',
  W10: (digits: number) => `Больше ${digits} знаков после запятой — сумма округлена`,
  A1: (name: string) => `Выберите счёт для «${clip(name)}» — подходит несколько`,
  A1_MISSING: (name: string) => `Выберите счёт для «${clip(name)}»`,
  A2: 'Неизвестная валюта',
  A3: 'Название счёта: от 1 до 120 символов',
  A4: 'Неверная сумма остатка',
  A5: (name: string) => `Счёт «${clip(name)}» в архиве — выберите другой`,
} as const;

/**
 * Замечания по группам «код + текст» в порядке первой строки: число строк и до 20 первых номеров.
 * Групп — не больше ISSUE_GROUPS_MAX.
 */
export function groupIssues(issues: RowIssue[]): IssueGroup[] {
  const groups = new Map<string, IssueGroup>();
  for (const i of [...issues].sort((a, b) => a.row - b.row)) {
    const key = `${i.code}\u0000${i.message}`;
    let g = groups.get(key);
    if (!g) {
      if (groups.size >= ISSUE_GROUPS_MAX) continue;
      g = { code: i.code, message: i.message, count: 0, rows: [] };
      groups.set(key, g);
    }
    g.count++;
    if (i.row > 0 && g.rows.length < ISSUE_ROWS_MAX && !g.rows.includes(i.row)) g.rows.push(i.row);
  }
  return [...groups.values()];
}
```

Создайте `src/server/modules/imports/parse-row.ts`:

```ts
import { getCurrency } from '../../../shared/currencies';
import { isValidDate, startOfDayUtc } from '../../../shared/dates';
import { columnTitle, headerField, isHeaderRow, nameKey, type FinmapField } from '../../../shared/finmap-format';
import { CATEGORY_NAME_MAX } from '../../../shared/schemas/categories';
import { COUNTERPARTY_NAME_MAX } from '../../../shared/schemas/counterparties';
import { TAG_NAME_MAX } from '../../../shared/schemas/tags';
import { cleanName } from '../../../shared/text';
import { fileError, IMPORT_MAX_ROWS, MESSAGES as M, tooManyRows, type RowIssue } from './errors';
import { CELL_TOO_LONG, type Cell, type SheetData, type SheetRow } from './xlsx-read';

/** Разбор строк файла в строки импорта (§4 спецификации импорта): чистые функции, без базы. */

/** Предел названия проекта — как у формы проекта (projectCreateSchema). */
const PROJECT_NAME_MAX = 100;

export type ImportType = 'income' | 'expense' | 'transfer';

/** Счёт из файла: ключ сравнения (nameKey) и название, как в файле (после cleanName). */
export interface FileAccount {
  key: string;
  name: string;
}

export interface ImportRow {
  /** Номер строки Excel (у CSV — номер записи). */
  row: number;
  type: ImportType;
  /** Момент оплаты, ISO UTC: время ячейки — по часам APP_TIMEZONE. */
  paidAt: string;
  /** Календарная дата оплаты в APP_TIMEZONE. */
  date: string;
  /** «ГГГГ-ММ-ДД ЧЧ:ММ» по часам APP_TIMEZONE — часть ключа дубликата (§5.5). */
  minute: string;
  accrualDate: string | null;
  /** «Сумма в валюте счета» без знака, точной десятичной записью («8200.5»); в минимальные единицы — по валюте счёта (§4.2). */
  amount: string;
  /** «Сумма в валюте компании» в минимальных единицах базовой валюты; null — не заполнена. */
  baseAmount: number | null;
  /** Счёт операции: у дохода — «На счет», у расхода и перевода — «Со счета». */
  account: FileAccount;
  /** Счёт зачисления перевода. */
  toAccount: FileAccount | null;
  category: string | null;
  subcategory: string | null;
  counterparty: string | null;
  project: string | null;
  tags: string[];
  comment: string | null;
}

export interface ParseContext {
  timezone: string;
  /** Базовая валюта компании: в ней «Сумма в валюте компании». */
  baseCurrency: string;
  /** Сегодня в APP_TIMEZONE: строки позже — плановые (W1). */
  today: string;
  date1904: boolean;
}

export interface ParsedFile {
  headerRow: number;
  /** Непустые строки данных. */
  total: number;
  /** Строки без ошибок, кроме плановых. */
  rows: ImportRow[];
  /** Номера плановых строк (дата платежа в будущем): пропущены с W1. */
  future: number[];
  /** Ошибки R* и предупреждения W* разбора. */
  issues: RowIssue[];
}

// ——— числа ———

/** Точная десятичная запись без экспоненты и лишних нулей («8200.5», «0»). */
export interface ParsedNumber {
  negative: boolean;
  value: string;
}

/** Цифры digits × 10^-scale → запись; maxSignificant — округлить half-up до стольких значащих цифр. */
function normalize(negative: boolean, digits: string, scale: number, maxSignificant?: number): ParsedNumber {
  let d = digits.replace(/^0+/, '');
  if (d === '') return { negative: false, value: '0' };
  if (maxSignificant !== undefined && d.length > maxSignificant) {
    const drop = d.length - maxSignificant;
    let keep = BigInt(d.slice(0, maxSignificant));
    if (d.charCodeAt(maxSignificant) - 48 >= 5) keep += 1n;
    d = keep.toString();
    scale -= drop;
  }
  let value: string;
  if (scale <= 0) value = d + '0'.repeat(-scale);
  else {
    const padded = d.padStart(scale + 1, '0');
    const int = padded.slice(0, padded.length - scale);
    const frac = padded.slice(padded.length - scale).replace(/0+$/, '');
    value = frac ? `${int}.${frac}` : int;
  }
  return { negative: negative && value !== '0', value };
}

/**
 * Число из ячейки XLSX («10596», «8200.5», «1.2345E+5», «1317.0000000000002»). Excel хранит до 15 значащих цифр —
 * дальше шум двоичной дроби, он отбрасывается округлением до 15 цифр.
 */
export function parseCellNumber(text: string): ParsedNumber | null {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text.trim());
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) return null;
  const exp = m[4] ? Number(m[4]) : 0;
  if (Math.abs(exp) > 400) return null;
  return normalize(m[1] === '-', (m[2] ?? '') + (m[3] ?? ''), (m[3] ?? '').length - exp, 15);
}

/**
 * Сумма текстом (§4.2): пробелы, U+00A0, U+202F и «₸» убираются; минус «-» или «\u2212», плюс допустим;
 * есть и точка, и запятая — последняя из них десятичная, другая — разряды; один знак — десятичный.
 */
export function parseTextAmount(text: string): ParsedNumber | null {
  let s = text.replace(/[\s\u00A0\u202F₸]/g, '');
  let negative = false;
  if (s.startsWith('-') || s.startsWith('\u2212')) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);
  const dot = s.lastIndexOf('.');
  const comma = s.lastIndexOf(',');
  if (dot >= 0 && comma >= 0) {
    const dec = dot > comma ? '.' : ',';
    if (s.indexOf(dec) !== s.lastIndexOf(dec)) return null;
    s = s.split(dec === '.' ? ',' : '.').join('').replace(dec, '.');
  } else if (comma >= 0) {
    if (s.indexOf(',') !== comma) return null;
    s = s.replace(',', '.');
  } else if (dot >= 0 && s.indexOf('.') !== dot) return null;
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[1] === '' && (m[2] ?? '') === '')) return null;
  return normalize(negative, m[1]! + (m[2] ?? ''), (m[2] ?? '').length);
}

/** Сумма ячейки: число — точно, без parseFloat; текст — по правилам §4.2. */
export function parseAmountCell(cell: Cell): ParsedNumber | null {
  return cell.kind === 'number' ? parseCellNumber(cell.value) : parseTextAmount(cell.value);
}

/** Запись → минимальные единицы с half-up; rounded — было больше знаков, чем у валюты (W10); null — не безопасное целое (R07). */
export function decimalToMinor(value: string, minorUnits: number): { minor: number; rounded: boolean } | null {
  const [int = '0', frac = ''] = value.split('.');
  let minor: bigint;
  let rounded = false;
  if (frac.length <= minorUnits) minor = BigInt(int + frac.padEnd(minorUnits, '0'));
  else {
    minor = BigInt(int + frac.slice(0, minorUnits));
    if (frac.charCodeAt(minorUnits) - 48 >= 5) minor += 1n;
    rounded = true;
  }
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return { minor: Number(minor), rounded };
}

// ——— даты ———

/** Дата и секунды суток по часам компании. */
export interface WallTime {
  date: string;
  seconds: number;
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;
/** 31.12.9999 — последняя дата Excel. */
const EXCEL_MAX = 2_958_465;

/**
 * Число Excel → дата и время (§4.3): целая часть — дни от 30.12.1899 (+1 462 при date1904), дробная — доля суток.
 * Время округляется до секунды; 86 400 секунд — следующие сутки.
 */
export function fromExcelSerial(serial: number, date1904: boolean): WallTime | null {
  if (!Number.isFinite(serial) || serial < 0 || serial > EXCEL_MAX) return null;
  let days = Math.floor(serial);
  let seconds = Math.round((serial - days) * 86_400);
  if (seconds >= 86_400) {
    days += 1;
    seconds -= 86_400;
  }
  if (date1904) days += 1462;
  return { date: new Date(EXCEL_EPOCH + days * DAY_MS).toISOString().slice(0, 10), seconds };
}

const DMY = /^(\d{1,2})[^\d\s](\d{1,2})[^\d\s](\d{4})(?:[ T]+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?)?$/;
const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/;
const SERIAL = /^\d+(?:\.\d+)?$/;

function wall(y: string, mo: string, d: string, h = '0', mi = '0', s = '0'): WallTime | null {
  const date = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const [hh, mm, ss] = [Number(h), Number(mi), Number(s)];
  if (!isValidDate(date) || hh > 23 || mm > 59 || ss > 59) return null;
  return { date, seconds: hh * 3600 + mm * 60 + ss };
}

/**
 * Дата ячейки (§4.3): число Excel; текст «д.м.гггг», «дд-мм-гггг», «дд/мм/гггг» (любой одиночный разделитель-не-цифра)
 * с временем «ч:мм» или «чч:мм:сс» через пробел или T; ISO «гггг-мм-дд[ чч:мм[:сс]]»; цифры с точкой — число Excel.
 * Без времени — 00:00:00. null — не разобралось или такой даты нет (31.02).
 */
export function parseWallTime(cell: Cell, date1904: boolean): WallTime | null {
  if (cell.kind === 'number') return fromExcelSerial(Number(cell.value), date1904);
  const t = cell.value.trim();
  let m = DMY.exec(t);
  if (m) return wall(m[3]!, m[2]!, m[1]!, m[4], m[5], m[6]);
  m = ISO.exec(t);
  if (m) return wall(m[1]!, m[2]!, m[3]!, m[4], m[5], m[6]);
  if (SERIAL.test(t)) return fromExcelSerial(Number(t), date1904);
  return null;
}

/** Дата и время по часам timeZone → момент UTC (§4.3: начало суток плюс секунды; в Алматы без летнего времени это точно). */
export function wallToIso(w: WallTime, timeZone: string): string {
  return new Date(Date.parse(startOfDayUtc(w.date, timeZone)) + w.seconds * 1000).toISOString();
}

const pad2 = (n: number) => String(n).padStart(2, '0');

// ——— заголовки и строки ———

/** Строка заголовков (§2.2): первая из строк 1–10 с «Дата платежа» и «Сумма в валюте счета». */
export function findHeader(rows: SheetRow[]): { headerRow: number; columns: Map<FinmapField, number>; issues: RowIssue[] } {
  const head = rows.find((r) => r.row <= 10 && isHeaderRow([...r.cells.values()].map((c) => c.value)));
  if (!head) {
    throw fileError('F6', 'Не найдена строка заголовков: нужны колонки «Дата платежа» и «Сумма в валюте счета» и хотя бы одна из «Со счета», «На счет»');
  }
  const columns = new Map<FinmapField, number>();
  const issues: RowIssue[] = [];
  for (const [col, cell] of [...head.cells].sort((a, b) => a[0] - b[0])) {
    const field = headerField(cell.value);
    if (field === null) {
      issues.push({ code: 'W7', message: M.W7(cleanName(cell.value)), row: head.row });
      continue;
    }
    if (columns.has(field)) throw fileError('F6', `Колонка «${columnTitle(field)}» встречается дважды`);
    columns.set(field, col);
  }
  if (!columns.has('fromAccount') && !columns.has('toAccount')) {
    throw fileError('F6', 'Не найдена строка заголовков: нужны колонки «Дата платежа» и «Сумма в валюте счета» и хотя бы одна из «Со счета», «На счет»');
  }
  return { headerRow: head.row, columns, issues };
}

/** Что колонки называют в R11. */
const R11_WHAT: Partial<Record<FinmapField, string>> = {
  accrualDate: 'дату начисления',
  periodFrom: 'начало периода начисления',
  periodTo: 'конец периода начисления',
};

export type RowResult = { kind: 'row'; row: ImportRow; issues: RowIssue[] } | { kind: 'future'; issues: RowIssue[] } | { kind: 'error'; issues: RowIssue[] };

/** Одна строка данных (§4.1–§4.8). Ошибки R* — строка не импортируется; дата в будущем — строка пропускается с W1. */
export function parseRow(sheetRow: SheetRow, columns: Map<FinmapField, number>, ctx: ParseContext): RowResult {
  const n = sheetRow.row;
  const issues: RowIssue[] = [];
  const err = (code: RowIssue['code'], message: string) => issues.push({ code, message, row: n });
  const cell = (f: FinmapField): Cell | undefined => {
    const col = columns.get(f);
    return col === undefined ? undefined : sheetRow.cells.get(col);
  };
  const raw = (f: FinmapField) => cell(f)?.value.trim() ?? '';
  const name = (f: FinmapField) => cleanName(cell(f)?.value ?? '');

  // R18: ошибка Excel или слишком длинная ячейка в любой распознанной колонке
  for (const [field, col] of columns) {
    const c = sheetRow.cells.get(col);
    if (c?.kind === 'error') err('R18', c.value === CELL_TOO_LONG ? M.R18_LONG : M.R18_EXCEL(c.value, columnTitle(field)));
  }
  if (issues.length) return { kind: 'error', issues };

  // дата платежа: будущая строка — плановая операция Finmap, пропускается без других проверок
  const paidCell = cell('paidAt');
  let paid: WallTime | null = null;
  if (!paidCell || raw('paidAt') === '') err('R01', M.R01);
  else {
    paid = parseWallTime(paidCell, ctx.date1904);
    if (!paid) err('R02', M.R02(raw('paidAt')));
    else if (Number(paid.date.slice(0, 4)) < 1990) err('R03', M.R03);
    else if (paid.date > ctx.today) return { kind: 'future', issues: [{ code: 'W1', message: M.W1, row: n }] };
  }

  // тип по счетам (§4.1)
  const from = name('fromAccount');
  const to = name('toAccount');
  const type: ImportType | null = from && to ? 'transfer' : from ? 'expense' : to ? 'income' : null;
  if (!type) err('R08', M.R08);
  else if (type === 'transfer' && nameKey(from) === nameKey(to)) err('R09', M.R09);

  // сумма (§4.2): точная запись без знака; в минимальные единицы — по валюте счёта, в предпросмотре
  let amount: string | null = null;
  const amountCell = cell('amount');
  if (!amountCell || raw('amount') === '') err('R04', M.R04);
  else {
    const p = parseAmountCell(amountCell);
    if (!p) err('R05', M.R05(raw('amount')));
    else if (p.value === '0') err('R06', M.R06);
    else if (p.negative && type === 'income') err('R10', M.R10);
    else amount = p.value;
  }

  // «Сумма в валюте компании»: в минимальных единицах базовой валюты; ноль — как пусто
  let baseAmount: number | null = null;
  const baseCell = cell('baseAmount');
  if (baseCell && raw('baseAmount') !== '') {
    const p = parseAmountCell(baseCell);
    const units = getCurrency(ctx.baseCurrency).minorUnits;
    if (!p) err('R05', M.R05(raw('baseAmount')));
    else if (p.negative && type === 'income') err('R10', M.R10);
    else if (p.value !== '0') {
      const minor = decimalToMinor(p.value, units);
      if (!minor) err('R07', M.R07);
      else {
        baseAmount = minor.minor;
        if (minor.rounded) issues.push({ code: 'W10', message: M.W10(units), row: n });
      }
    }
  }

  // дата начисления (§4.3): B важнее C; D только проверяется; у перевода не переносится
  let accrualDate: string | null = null;
  const dates: Partial<Record<FinmapField, string>> = {};
  for (const f of ['accrualDate', 'periodFrom', 'periodTo'] as const) {
    const c = cell(f);
    if (!c || raw(f) === '') continue;
    if (type === 'transfer') continue;
    const w = parseWallTime(c, ctx.date1904);
    if (!w) err('R11', M.R11(R11_WHAT[f]!, raw(f)));
    else dates[f] = w.date;
  }
  if (type === 'transfer' && (raw('accrualDate') || raw('periodFrom'))) issues.push({ code: 'W3', message: M.W3, row: n });
  if (dates.periodFrom && dates.periodTo && dates.periodTo < dates.periodFrom) err('R11', M.R11_PERIOD);
  if (dates.accrualDate && dates.periodFrom) issues.push({ code: 'W6', message: M.W6, row: n });
  accrualDate = dates.accrualDate ?? dates.periodFrom ?? null;

  // категория, контрагент (§4.5, §4.6): у перевода не переносятся
  let category: string | null = name('category') || null;
  let subcategory: string | null = name('subcategory') || null;
  let counterparty: string | null = name('subcounterparty') || name('counterparty') || null;
  if (type === 'transfer') {
    if (category || subcategory || counterparty) issues.push({ code: 'W2', message: M.W2, row: n });
    category = subcategory = counterparty = null;
  } else {
    if (subcategory && !category) err('R12', M.R12);
    if (category && category.length > CATEGORY_NAME_MAX) err('R13', M.R13('Категория', CATEGORY_NAME_MAX));
    if (subcategory && subcategory.length > CATEGORY_NAME_MAX) err('R13', M.R13('Подкатегория', CATEGORY_NAME_MAX));
    if (name('subcounterparty')) issues.push({ code: 'W4', message: M.W4, row: n });
    if (counterparty && counterparty.length > COUNTERPARTY_NAME_MAX) err('R13', M.R13('Контрагент', COUNTERPARTY_NAME_MAX));
  }

  // проект (§4.7): подпроект не переносится
  const project = name('project') || null;
  if (project && project.length > PROJECT_NAME_MAX) err('R13', M.R13('Проект', PROJECT_NAME_MAX));
  if (name('subproject')) issues.push({ code: 'W5', message: M.W5, row: n });

  // теги (§4.8): через запятую, без пустых и повторов
  const tags: string[] = [];
  const tagKeys = new Set<string>();
  for (const part of (cell('tags')?.value ?? '').split(',')) {
    const t = cleanName(part);
    if (!t || tagKeys.has(nameKey(t))) continue;
    tagKeys.add(nameKey(t));
    tags.push(t);
  }
  if (tags.length > 20) err('R14', M.R14);
  if (tags.some((t) => t.length > TAG_NAME_MAX)) err('R13', M.R13('Тег', TAG_NAME_MAX));

  // комментарий
  const comment = raw('comment') || null;
  if (comment && comment.length > 2000) err('R15', M.R15);

  if (issues.some((i) => i.code.startsWith('R')) || !type || !paid || amount === null) return { kind: 'error', issues };
  const account = type === 'income' ? { key: nameKey(to), name: to } : { key: nameKey(from), name: from };
  return {
    kind: 'row',
    issues,
    row: {
      row: n,
      type,
      paidAt: wallToIso(paid, ctx.timezone),
      date: paid.date,
      minute: `${paid.date} ${pad2(Math.floor(paid.seconds / 3600))}:${pad2(Math.floor((paid.seconds % 3600) / 60))}`,
      accrualDate,
      amount,
      baseAmount,
      account,
      toAccount: type === 'transfer' ? { key: nameKey(to), name: to } : null,
      category,
      subcategory,
      counterparty,
      project,
      tags,
      comment,
    },
  };
}

/**
 * Лист → строки импорта (§2.3, §4): строка заголовков, пустые строки пропускаются молча и не считаются;
 * больше 50 000 строк данных — F5, ни одной — F7.
 */
export function parseSheet(sheet: SheetData, ctx: ParseContext): ParsedFile {
  const { headerRow, columns, issues } = findHeader(sheet.rows);
  const cols = [...columns.values()];
  const data = sheet.rows.filter((r) => r.row > headerRow && cols.some((c) => (r.cells.get(c)?.value.trim() ?? '') !== ''));
  if (data.length > IMPORT_MAX_ROWS) throw tooManyRows();
  if (data.length === 0) throw fileError('F7', 'В файле нет операций');
  const rows: ImportRow[] = [];
  const future: number[] = [];
  for (const r of data) {
    const res = parseRow(r, columns, ctx);
    issues.push(...res.issues);
    if (res.kind === 'row') rows.push(res.row);
    else if (res.kind === 'future') future.push(r.row);
  }
  return { headerRow, total: data.length, rows, future, issues };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/import-parse-row.test.ts`
Expected: PASS, 16 тестов.

Run: `npm test` и `npm run typecheck`
Expected: 899 пройдено и 1 пропущен; typecheck без ошибок.

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/imports/errors.ts src/server/modules/imports/parse-row.ts tests/server/import-parse-row.test.ts
git commit -m "feat: импорт — разбор строк: тип, суммы, даты, начисление, справочники; каталог ошибок и предупреждений" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Миграция 0006 и сопоставление справочников (§6.1, §4.5–§4.8)

**Files:**
- Modify: `src/server/db/schema.ts`
- Create (генерирует drizzle-kit): `src/server/db/migrations/0006_<имя>.sql`, `src/server/db/migrations/meta/0006_snapshot.json`; Modify: `src/server/db/migrations/meta/_journal.json`
- Create: `src/server/modules/imports/match.ts`
- Test: `tests/server/schema-0006.test.ts`, `tests/server/import-match.test.ts`

**Interfaces:**
- Consumes: `createTestDb` (`tests/helpers/test-db.ts`); `COUNTERPARTY_TYPES` (`src/shared/counterparties.ts`); `systemCategory`, `CategoryKind`, `CounterpartyType`, `SystemKey`; `nameKey`, `repairName`, `systemKeyOf` (задача 3); `MESSAGES`, `RowIssue` (задача 4); `ImportRow` (задача 4); `Executor` (`src/server/db/client.ts`); таблицы `categories`, `counterparties`, `projects`, `tags`.
- Produces:
  - `schema.ts`: таблица `imports` (`id, companyId, userId, fileName, fileSize, fileSha256, status: 'done' | 'undone', counts, created, accountChanges, undoResult, createdAt, undoneAt, undoneBy`, индекс `imports_company_idx (company_id, id)`); `operations.importId` → `imports.id`, индекс `operations_import_idx`;
  - `match.ts`: `type Ref = { id: number } | { key: string }`; `CategoryEntry`, `CounterpartyEntry`, `NamedEntry`, `interface Dictionaries`; `loadDictionaries(ex, companyId): Dictionaries`; `interface PlannedCategory { key; kind; name; parent: Ref | null; parentName; rows }`; `interface PlannedCounterparty { key; name; type; rows }`; `interface PlannedNamed { key; name; rows }`; `interface MatchedRow { category; categorySystemKey; counterparty; project; tags }`; `interface MatchResult { rows: Map<number, MatchedRow>; issues; categories; counterparties; projects; tags }`; `neededCounterpartyType(kind, systemKey)`; `pickCounterpartyType(votes)`; `matchDictionaries(d, rows): MatchResult`.

- [ ] **Step 1: Write the failing tests**

Создайте `tests/server/schema-0006.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db';

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function setup() {
  const t = createTestDb();
  cleanup = t.cleanup;
  const s = t.sqlite;
  s.prepare("INSERT INTO currencies (code,name,symbol,minor_units) VALUES ('KZT','Тенге','₸',2)").run();
  s.prepare("INSERT INTO users (login, name, password_hash, created_at) VALUES ('u','U','h','x')").run();
  s.prepare("INSERT INTO companies (name, base_currency, created_at) VALUES ('ТОО','KZT','x')").run();
  s.prepare("INSERT INTO accounts (company_id, name, currency, starting_balance, opened_at, order_index, created_at) VALUES (1,'К','KZT',0,'2026-10-01',0,'x')").run();
  return s;
}

const insertImport =
  "INSERT INTO imports (company_id, user_id, file_name, file_size, file_sha256, status, counts, created, account_changes, created_at) VALUES (1, 1, 'f.xlsx', 10, 'abc', 'done', '{}', '{}', '[]', 'x')";
const insertOp =
  "INSERT INTO operations (company_id, type, status, paid_at, account_id, amount, rate, base_amount, created_by, created_at, updated_at, version, import_id) VALUES (1,'income','actual','2026-10-06T00:00:00.000Z',1,100,'1',100,1,'x','x',1,?)";

describe('миграция 0006 (§6.1 спецификации импорта)', () => {
  it('таблица imports; operations.import_id — null у обычных операций, ссылка на импорт с внешним ключом и индексом', () => {
    const s = setup();
    const imp = s.prepare(insertImport).run();
    expect(s.prepare(insertOp).run(null).changes).toBe(1);
    expect(s.prepare(insertOp).run(imp.lastInsertRowid).changes).toBe(1);
    expect(() => s.prepare(insertOp).run(999)).toThrow(/FOREIGN KEY/);
    expect((s.prepare('SELECT COUNT(*) n FROM operations WHERE import_id IS NULL').get() as { n: number }).n).toBe(1);
    const indexes = (table: string) => (s.prepare(`PRAGMA index_list('${table}')`).all() as { name: string }[]).map((i) => i.name);
    expect(indexes('operations')).toContain('operations_import_idx');
    expect(indexes('imports')).toContain('imports_company_idx');
    // импорт с операциями нельзя удалить жёстко, пока операции ссылаются на него
    expect(() => s.prepare('DELETE FROM imports WHERE id = ?').run(imp.lastInsertRowid)).toThrow(/FOREIGN KEY/);
  });

  it('импорт ссылается на существующие компанию и пользователя; итог отмены и отмена — необязательны', () => {
    const s = setup();
    expect(() => s.prepare(insertImport.replace('VALUES (1, 1,', 'VALUES (2, 1,')).run()).toThrow(/FOREIGN KEY/);
    const id = s.prepare(insertImport).run().lastInsertRowid;
    expect(s.prepare('SELECT status, undo_result, undone_at, undone_by FROM imports WHERE id = ?').get(id)).toEqual({
      status: 'done',
      undo_result: null,
      undone_at: null,
      undone_by: null,
    });
  });
});
```

Создайте `tests/server/import-match.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { matchDictionaries, neededCounterpartyType, pickCounterpartyType, type Dictionaries } from '../../src/server/modules/imports/match';
import type { ImportRow } from '../../src/server/modules/imports/parse-row';

/** Справочники компании: системные «Зарплата» и «Инвестиции», шаблонные дочерние, архивные. */
const DICTS: Dictionaries = {
  categories: [
    { id: 1, kind: 'expense', parentId: null, name: 'Зарплата', systemKey: 'salary', archivedAt: null },
    { id: 2, kind: 'expense', parentId: 1, name: 'Администраторы', systemKey: null, archivedAt: null },
    { id: 3, kind: 'income', parentId: null, name: 'Инвестиции', systemKey: 'investment', archivedAt: null },
    { id: 4, kind: 'expense', parentId: null, name: 'Аренда', systemKey: null, archivedAt: null },
    { id: 5, kind: 'expense', parentId: null, name: 'аренда', systemKey: null, archivedAt: null },
    { id: 6, kind: 'expense', parentId: null, name: 'Реклама', systemKey: null, archivedAt: '2026-10-01T00:00:00.000Z' },
    { id: 7, kind: 'expense', parentId: 4, name: 'Зал', systemKey: null, archivedAt: null },
    { id: 8, kind: 'expense', parentId: 4, name: 'Склад', systemKey: null, archivedAt: '2026-10-01T00:00:00.000Z' },
    { id: 9, kind: 'income', parentId: null, name: 'Бар', systemKey: null, archivedAt: null },
    { id: 10, kind: 'expense', parentId: 4, name: 'Охрана', systemKey: null, archivedAt: null },
    { id: 11, kind: 'income', parentId: 9, name: 'Охрана', systemKey: null, archivedAt: null },
  ],
  counterparties: [
    { id: 1, type: 'supplier', name: 'ИП Свет', archivedAt: null },
    { id: 2, type: 'client', name: 'ИП Свет', archivedAt: null },
    { id: 3, type: 'employee', name: 'Сотрудник А', archivedAt: null },
    { id: 4, type: 'client', name: 'Старый клиент', archivedAt: '2026-10-01T00:00:00.000Z' },
  ],
  projects: [
    { id: 1, name: 'Клуб 1', archivedAt: null },
    { id: 2, name: 'Клуб 2', archivedAt: '2026-10-01T00:00:00.000Z' },
  ],
  tags: [
    { id: 1, name: 'Смена', archivedAt: null },
    { id: 2, name: 'Старый', archivedAt: '2026-10-01T00:00:00.000Z' },
  ],
};

let n = 1;
/** Строка импорта: расход «Касса» по умолчанию. */
function r(v: Partial<ImportRow>): ImportRow {
  n++;
  return {
    row: n,
    type: 'expense',
    paidAt: '2026-10-05T05:00:00.000Z',
    date: '2026-10-05',
    minute: '2026-10-05 10:00',
    accrualDate: null,
    amount: '100',
    baseAmount: null,
    account: { key: 'касса', name: 'Касса' },
    toAccount: null,
    category: null,
    subcategory: null,
    counterparty: null,
    project: null,
    tags: [],
    comment: null,
    ...v,
  };
}

describe('сопоставление справочников (§4.5–§4.8 спецификации импорта)', () => {
  it('категории: верхний уровень, единственная дочерняя, системная по названию и виду, системное название с чужим видом — новая', () => {
    const rows = [
      r({ category: 'аренда' }), // две «Аренды» верхнего уровня — первая по порядку
      r({ category: 'Администраторы' }), // нет на верхнем уровне, одна дочерняя — она
      r({ category: 'ЗАРПЛАТА' }),
      r({ type: 'income', category: 'Зарплата' }),
      r({ category: 'Охрана' }), // две дочерние (у «Аренды» и у «Бара» другого вида) — у расхода одна
      r({ category: '\u004Bомиссия' }), // новая; латинская K — название чинится
    ];
    const m = matchDictionaries(DICTS, rows);
    expect(rows.map((x) => m.rows.get(x.row)!.category)).toEqual([{ id: 4 }, { id: 2 }, { id: 1 }, { key: 'income|зарплата' }, { id: 10 }, { key: 'expense|комиссия' }]);
    expect(rows.map((x) => m.rows.get(x.row)!.categorySystemKey)).toEqual([null, 'salary', 'salary', null, null, null]);
    expect(m.categories).toEqual([
      { key: 'income|зарплата', kind: 'income', name: 'Зарплата', parent: null, parentName: null, rows: 1 },
      { key: 'expense|комиссия', kind: 'expense', name: 'Комиссия', parent: null, parentName: null, rows: 1 },
    ]);
  });

  it('подкатегория: у существующего родителя — его ребёнок или новый; у нового родителя — новые оба; системный родитель', () => {
    const rows = [
      r({ category: 'Аренда', subcategory: 'зал' }),
      r({ category: 'Аренда', subcategory: 'Офис' }),
      r({ category: 'Зарплата', subcategory: 'Бармены' }),
      r({ category: 'Связь', subcategory: 'Интернет' }),
      r({ category: 'связь', subcategory: 'Телефон' }),
    ];
    const m = matchDictionaries(DICTS, rows);
    expect(rows.map((x) => m.rows.get(x.row)!.category)).toEqual([
      { id: 7 },
      { key: 'expense|id:4|офис' },
      { key: 'expense|id:1|бармены' },
      { key: 'expense|new:expense|связь|интернет' },
      { key: 'expense|new:expense|связь|телефон' },
    ]);
    expect(m.rows.get(rows[2]!.row)!.categorySystemKey).toBe('salary');
    // сначала верхний уровень, затем подкатегории — порядок создания
    expect(m.categories.map((c) => [c.name, c.parentName, c.parent])).toEqual([
      ['Связь', null, null],
      ['Офис', 'Аренда', { id: 4 }],
      ['Бармены', 'Зарплата', { id: 1 }],
      ['Интернет', 'Связь', { key: 'expense|связь' }],
      ['Телефон', 'Связь', { key: 'expense|связь' }],
    ]);
    expect(m.categories[0]!.rows).toBe(2);
  });

  it('архивные: категория, подкатегория, контрагент, проект, тег — R17 один текст на название; строка не сопоставлена', () => {
    const rows = [
      r({ category: 'Реклама' }),
      r({ category: 'Аренда', subcategory: 'Склад' }),
      r({ counterparty: 'Старый клиент' }),
      r({ project: 'клуб 2' }),
      r({ tags: ['Смена', 'старый'] }),
      r({ category: 'Реклама' }),
    ];
    const m = matchDictionaries(DICTS, rows);
    expect(m.issues.map((i) => `${i.row}: ${i.message}`)).toEqual([
      `${rows[0]!.row}: Категория «Реклама» в архиве — верните из архива`,
      `${rows[1]!.row}: Категория «Склад» в архиве — верните из архива`,
      `${rows[2]!.row}: Контрагент «Старый клиент» в архиве — верните из архива`,
      `${rows[3]!.row}: Проект «клуб 2» в архиве — верните из архива`,
      `${rows[4]!.row}: Тег «старый» в архиве — верните из архива`,
      `${rows[5]!.row}: Категория «Реклама» в архиве — верните из архива`,
    ]);
    expect(rows.every((x) => !m.rows.has(x.row))).toBe(true);
    expect(m.categories).toEqual([]);
  });

  it('контрагенты: тип по категории (Зарплата — сотрудник), существующий — сначала с нужным типом, затем любой; новый — самый частый тип', () => {
    const rows = [
      r({ category: 'Администраторы', counterparty: 'Сотрудник Б' }),
      r({ type: 'income', counterparty: 'ип свет' }),
      r({ counterparty: 'ИП Свет' }),
      r({ type: 'income', counterparty: 'Сотрудник А' }),
      r({ type: 'income', counterparty: 'Новый' }),
      r({ type: 'income', counterparty: 'новый' }),
      r({ counterparty: 'Новый' }),
      r({ type: 'income', category: 'Инвестиции', counterparty: 'Ровно' }),
      r({ type: 'income', counterparty: 'Ровно' }),
    ];
    const m = matchDictionaries(DICTS, rows);
    expect(rows.slice(1, 4).map((x) => m.rows.get(x.row)!.counterparty)).toEqual([{ id: 2 }, { id: 1 }, { id: 3 }]);
    expect(m.counterparties).toEqual([
      { key: 'сотрудник б', name: 'Сотрудник Б', type: 'employee', rows: 1 },
      { key: 'новый', name: 'Новый', type: 'client', rows: 3 },
      { key: 'ровно', name: 'Ровно', type: 'investor', rows: 2 },
    ]);
    expect(neededCounterpartyType('expense', 'tax')).toBe('tax');
    expect(neededCounterpartyType('expense', null)).toBe('supplier');
    expect(pickCounterpartyType(new Map([['supplier', 2], ['client', 2]]))).toBe('client');
  });

  it('проекты и теги: по ключу без учёта регистра и двойников; новые — по первому написанию; у перевода — только проект', () => {
    const rows = [
      r({ project: 'КЛУБ 1', tags: ['смена', 'Ночь'] }),
      r({ project: 'Клуб 3', tags: ['ночь'] }),
      r({ type: 'transfer', toAccount: { key: 'банк', name: 'Банк' }, project: 'клуб 3' }),
    ];
    const m = matchDictionaries(DICTS, rows);
    expect(rows.map((x) => [m.rows.get(x.row)!.project, m.rows.get(x.row)!.tags])).toEqual([
      [{ id: 1 }, [{ id: 1 }, { key: 'ночь' }]],
      [{ key: 'клуб 3' }, [{ key: 'ночь' }]],
      [{ key: 'клуб 3' }, []],
    ]);
    expect(m.projects).toEqual([{ key: 'клуб 3', name: 'Клуб 3', rows: 2 }]);
    expect(m.tags).toEqual([{ key: 'ночь', name: 'Ночь', rows: 2 }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/schema-0006.test.ts tests/server/import-match.test.ts`
Expected: FAIL — нет таблицы `imports` («no such table: imports»), модуль `imports/match` не найден.

- [ ] **Step 3: Schema and migration**

В `src/server/db/schema.ts` замените

```ts
export const operations = sqliteTable(
  'operations',
  {
```

на

```ts
/** Импорт файла (§6.1 спецификации импорта): одна запись на импорт; ссылки в JSON — без внешних ключей (инвариант 10). */
export const imports = sqliteTable(
  'imports',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    /** Кто импортировал. */
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    /** Имя файла (cleanName, до 200 символов). */
    fileName: text('file_name').notNull(),
    fileSize: integer('file_size').notNull(),
    /** SHA-256 файла: «этот файл уже импортирован» (W8). */
    fileSha256: text('file_sha256').notNull(),
    status: text('status', { enum: ['done', 'undone'] }).notNull(),
    /** JSON `{ rows, income, expense, transfer, added, duplicates, skippedFuture }`. */
    counts: text('counts').notNull(),
    /** JSON id созданного: `{ accounts, categories, counterparties, projects, tags }`. */
    created: text('created').notNull(),
    /** JSON `[{ accountId, before: { startingBalance, openedAt }, after }]` — существующие счета, изменённые импортом. */
    accountChanges: text('account_changes').notNull(),
    /** JSON итога отмены (§7.3). */
    undoResult: text('undo_result'),
    createdAt: text('created_at').notNull(),
    undoneAt: text('undone_at'),
    undoneBy: integer('undone_by').references(() => users.id),
  },
  (t) => [index('imports_company_idx').on(t.companyId, t.id)],
);

export const operations = sqliteTable(
  'operations',
  {
```

и в той же таблице `operations` замените

```ts
    version: integer('version').notNull(),
    deletedAt: text('deleted_at'),
  },
  (t) => [
    index('operations_company_paid_idx').on(t.companyId, t.paidAt, t.id),
```

на

```ts
    version: integer('version').notNull(),
    deletedAt: text('deleted_at'),
    /** Импорт, которым создана операция (§6.1 спецификации импорта); обычные операции — null. */
    importId: integer('import_id').references(() => imports.id),
  },
  (t) => [
    index('operations_company_paid_idx').on(t.companyId, t.paidAt, t.id),
    index('operations_import_idx').on(t.importId),
```

Run: `npm run db:generate`
Expected: `[✓] Your SQL migration file ➜ src\server\db\migrations\0006_<два слова>.sql`. Имя выдаёт drizzle-kit; появляются `meta/0006_snapshot.json` и запись в `meta/_journal.json`.

Сверьте SQL: файл должен быть ровно таким (порядок строк тот же):

```sql
CREATE TABLE `imports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`file_name` text NOT NULL,
	`file_size` integer NOT NULL,
	`file_sha256` text NOT NULL,
	`status` text NOT NULL,
	`counts` text NOT NULL,
	`created` text NOT NULL,
	`account_changes` text NOT NULL,
	`undo_result` text,
	`created_at` text NOT NULL,
	`undone_at` text,
	`undone_by` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`undone_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `imports_company_idx` ON `imports` (`company_id`,`id`);--> statement-breakpoint
ALTER TABLE `operations` ADD `import_id` integer REFERENCES imports(id);--> statement-breakpoint
CREATE INDEX `operations_import_idx` ON `operations` (`import_id`);
```

Если drizzle-kit пересоздаёт таблицу `operations` (`__new_operations`, `PRAGMA foreign_keys`), остановитесь и сообщите: такая миграция удалила бы каскадом строки операций. Руками миграцию не правьте. На живой базе бэкап перед миграцией делается сам (`migrateWithBackup`).

- [ ] **Step 4: Matching**

Создайте `src/server/modules/imports/match.ts`:

```ts
import { asc, eq } from 'drizzle-orm';
import { COUNTERPARTY_TYPES } from '../../../shared/counterparties';
import { nameKey, repairName, systemKeyOf } from '../../../shared/finmap-format';
import { systemCategory, type CategoryKind, type CounterpartyType, type SystemKey } from '../../../shared/system-categories';
import type { Executor } from '../../db/client';
import { categories, counterparties, projects, tags } from '../../db/schema';
import { MESSAGES as M, type RowIssue } from './errors';
import type { ImportRow } from './parse-row';

/**
 * Сопоставление справочников (§4.5–§4.8 спецификации импорта): чистая функция над загруженными справочниками
 * компании. Совпадение — по nameKey; новый элемент получает название repairName первого появления в файле.
 */

/** Ссылка на элемент: существующий id или новый по ключу (создаётся при записи, план И-2). */
export type Ref = { id: number } | { key: string };

export interface CategoryEntry {
  id: number;
  kind: CategoryKind;
  parentId: number | null;
  name: string;
  systemKey: string | null;
  archivedAt: string | null;
}
export interface CounterpartyEntry {
  id: number;
  type: CounterpartyType;
  name: string;
  archivedAt: string | null;
}
export interface NamedEntry {
  id: number;
  name: string;
  archivedAt: string | null;
}

/** Справочники компании в порядке orderIndex, id (первый по порядку выигрывает при нескольких совпадениях). */
export interface Dictionaries {
  categories: CategoryEntry[];
  counterparties: CounterpartyEntry[];
  projects: NamedEntry[];
  tags: NamedEntry[];
}

export function loadDictionaries(ex: Executor, companyId: number): Dictionaries {
  return {
    categories: ex
      .select({ id: categories.id, kind: categories.kind, parentId: categories.parentId, name: categories.name, systemKey: categories.systemKey, archivedAt: categories.archivedAt })
      .from(categories)
      .where(eq(categories.companyId, companyId))
      .orderBy(asc(categories.orderIndex), asc(categories.id))
      .all(),
    counterparties: ex
      .select({ id: counterparties.id, type: counterparties.type, name: counterparties.name, archivedAt: counterparties.archivedAt })
      .from(counterparties)
      .where(eq(counterparties.companyId, companyId))
      .orderBy(asc(counterparties.orderIndex), asc(counterparties.id))
      .all(),
    projects: ex
      .select({ id: projects.id, name: projects.name, archivedAt: projects.archivedAt })
      .from(projects)
      .where(eq(projects.companyId, companyId))
      .orderBy(asc(projects.orderIndex), asc(projects.id))
      .all(),
    tags: ex
      .select({ id: tags.id, name: tags.name, archivedAt: tags.archivedAt })
      .from(tags)
      .where(eq(tags.companyId, companyId))
      .orderBy(asc(tags.orderIndex), asc(tags.id))
      .all(),
  };
}

/** Новая категория: верхнего уровня (parent null) или подкатегория существующей ({ id }) либо новой ({ key }) категории. */
export interface PlannedCategory {
  key: string;
  kind: CategoryKind;
  name: string;
  parent: Ref | null;
  /** Название родителя — для списка «Будет создано». */
  parentName: string | null;
  rows: number;
}
export interface PlannedCounterparty {
  key: string;
  name: string;
  type: CounterpartyType;
  rows: number;
}
export interface PlannedNamed {
  key: string;
  name: string;
  rows: number;
}

/** Справочники строки после сопоставления. categorySystemKey — эффективный systemKey (у дочерней — родителя). */
export interface MatchedRow {
  category: Ref | null;
  categorySystemKey: SystemKey | null;
  counterparty: Ref | null;
  project: Ref | null;
  tags: Ref[];
}

export interface MatchResult {
  /** По номеру строки файла; строк с R17 нет. */
  rows: Map<number, MatchedRow>;
  /** R17 — один текст на название, со строками. */
  issues: RowIssue[];
  /** Новые категории: сначала верхнего уровня, затем подкатегории — по первому появлению. */
  categories: PlannedCategory[];
  counterparties: PlannedCounterparty[];
  projects: PlannedNamed[];
  tags: PlannedNamed[];
}

/** Тип контрагента, нужный строке (§4.6): по системной категории, иначе доход — клиент, расход — поставщик. */
export function neededCounterpartyType(kind: CategoryKind, systemKey: SystemKey | null): CounterpartyType {
  if (systemKey) return systemCategory(systemKey).counterpartyType;
  return kind === 'income' ? 'client' : 'supplier';
}

/** Тип нового контрагента: самый частый; при равенстве системный важнее client/supplier, дальше — порядок COUNTERPARTY_TYPES. */
export function pickCounterpartyType(votes: Map<CounterpartyType, number>): CounterpartyType {
  const rank = (t: CounterpartyType) => (t === 'client' || t === 'supplier' ? 100 : 0) + COUNTERPARTY_TYPES.indexOf(t);
  return [...votes].sort((a, b) => b[1] - a[1] || rank(a[0]) - rank(b[0]))[0]![0];
}

const refKey = (r: Ref) => ('id' in r ? `id:${r.id}` : `new:${r.key}`);

/** Элементы по ключу названия, в исходном порядке (orderIndex, id). */
function byNameKey<T extends { name: string }>(list: T[], prefix: (x: T) => string = () => ''): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of list) {
    const k = prefix(x) + nameKey(x.name);
    m.set(k, [...(m.get(k) ?? []), x]);
  }
  return m;
}

export function matchDictionaries(d: Dictionaries, rows: ImportRow[]): MatchResult {
  const issues: RowIssue[] = [];
  const out = new Map<number, MatchedRow>();

  // категории: верхний уровень по (вид, ключ), дети по родителю, системные по (вид, systemKey)
  const catById = new Map(d.categories.map((c) => [c.id, c]));
  const topActive = new Map<string, CategoryEntry>();
  const systemTop = new Map<string, CategoryEntry>();
  const childActiveByKey = new Map<string, CategoryEntry[]>();
  /** Ключи архивных категорий: любого уровня и только верхнего. */
  const archivedAny = new Set<string>();
  const archivedTop = new Set<string>();
  for (const c of d.categories) {
    const k = `${c.kind}|${nameKey(c.name)}`;
    if (c.archivedAt) archivedAny.add(k);
    if (c.parentId === null) {
      if (c.archivedAt) archivedTop.add(k);
      if (c.systemKey) systemTop.set(`${c.kind}|${c.systemKey}`, c);
      if (!c.archivedAt && !topActive.has(k)) topActive.set(k, c);
    } else if (!c.archivedAt) childActiveByKey.set(k, [...(childActiveByKey.get(k) ?? []), c]);
  }
  /** Дети по (родитель, ключ). */
  const childrenByKey = byNameKey(
    d.categories.filter((c) => c.parentId !== null),
    (c) => `${c.parentId}|`,
  );
  const cpsByKey = byNameKey(d.counterparties);
  const projectsByKey = byNameKey(d.projects);
  const tagsByKey = byNameKey(d.tags);
  const effectiveSystem = (c: CategoryEntry): SystemKey | null =>
    (c.systemKey ?? (c.parentId !== null ? catById.get(c.parentId)?.systemKey : null) ?? null) as SystemKey | null;

  const newCats = new Map<string, PlannedCategory>();
  const newCps = new Map<string, PlannedCounterparty & { votes: Map<CounterpartyType, number> }>();
  const newProjects = new Map<string, PlannedNamed>();
  const newTags = new Map<string, PlannedNamed>();

  /** Категория верхнего уровня: системная по названию и виду, иначе активная по ключу; 'archived' — есть только архивная. */
  function findTop(kind: CategoryKind, name: string): CategoryEntry | 'archived' | null {
    const sys = systemKeyOf(name, kind);
    const s = sys ? systemTop.get(`${kind}|${sys}`) : undefined;
    if (s) return s.archivedAt ? 'archived' : s;
    const k = `${kind}|${nameKey(name)}`;
    return topActive.get(k) ?? null;
  }

  function newTopCategory(kind: CategoryKind, name: string): { key: string } {
    const key = `${kind}|${nameKey(name)}`;
    const c = newCats.get(key) ?? { key, kind, name: repairName(name), parent: null, parentName: null, rows: 0 };
    c.rows++;
    newCats.set(key, c);
    return { key };
  }

  function newChildCategory(kind: CategoryKind, parent: Ref, parentName: string, name: string): Ref {
    const key = `${kind}|${refKey(parent)}|${nameKey(name)}`;
    const c = newCats.get(key) ?? { key, kind, name: repairName(name), parent, parentName, rows: 0 };
    c.rows++;
    newCats.set(key, c);
    return { key };
  }

  for (const r of rows) {
    const n = r.row;
    let failed = false;
    const archived = (what: string, name: string) => {
      issues.push({ code: 'R17', message: M.R17(what, name), row: n });
      failed = true;
    };
    const kind: CategoryKind = r.type === 'income' ? 'income' : 'expense';

    // категория (§4.5): у перевода категорий нет
    let category: Ref | null = null;
    let categorySystemKey: SystemKey | null = null;
    if (r.type !== 'transfer' && r.category) {
      const top = findTop(kind, r.category);
      const k = `${kind}|${nameKey(r.category)}`;
      if (!r.subcategory) {
        const kids = childActiveByKey.get(k) ?? [];
        if (top && top !== 'archived') {
          category = { id: top.id };
          categorySystemKey = effectiveSystem(top);
        } else if (kids.length === 1) {
          category = { id: kids[0]!.id };
          categorySystemKey = effectiveSystem(kids[0]!);
        } else if (top === 'archived' || (kids.length === 0 && archivedAny.has(k))) archived('Категория', r.category);
        else category = newTopCategory(kind, r.category);
      } else {
        // родитель — только верхнего уровня, иначе было бы три уровня
        if (top === 'archived' || (!top && archivedTop.has(k))) archived('Категория', r.category);
        else if (top) {
          // существующий родитель: ребёнок — среди его детей
          const kids = childrenByKey.get(`${top.id}|${nameKey(r.subcategory)}`) ?? [];
          const active = kids.find((c) => !c.archivedAt);
          if (active) category = { id: active.id };
          else if (kids.length) archived('Категория', r.subcategory);
          else category = newChildCategory(kind, { id: top.id }, top.name, r.subcategory);
          categorySystemKey = effectiveSystem(top);
        } else {
          const parent = newTopCategory(kind, r.category);
          category = newChildCategory(kind, parent, newCats.get(parent.key)!.name, r.subcategory);
        }
      }
    }

    // контрагент (§4.6): тип — по категории; сначала с нужным типом, затем любого типа
    let counterparty: Ref | null = null;
    if (r.counterparty) {
      const need = neededCounterpartyType(kind, categorySystemKey);
      const k = nameKey(r.counterparty);
      const same = cpsByKey.get(k) ?? [];
      const active = same.filter((c) => !c.archivedAt);
      const hit = active.find((c) => c.type === need) ?? active[0];
      if (hit) counterparty = { id: hit.id };
      else if (same.length) archived('Контрагент', r.counterparty);
      else {
        const c = newCps.get(k) ?? { key: k, name: repairName(r.counterparty), type: need, rows: 0, votes: new Map() };
        c.rows++;
        c.votes.set(need, (c.votes.get(need) ?? 0) + 1);
        newCps.set(k, c);
        counterparty = { key: k };
      }
    }

    // проект (§4.7) и теги (§4.8): названия уникальны в компании, архивный — R17
    const named = (existing: Map<string, NamedEntry[]>, fresh: Map<string, PlannedNamed>, what: string, name: string): Ref | null => {
      const k = nameKey(name);
      const same = existing.get(k) ?? [];
      const active = same.find((x) => !x.archivedAt);
      if (active) return { id: active.id };
      if (same.length) {
        archived(what, name);
        return null;
      }
      const x = fresh.get(k) ?? { key: k, name: repairName(name), rows: 0 };
      x.rows++;
      fresh.set(k, x);
      return { key: k };
    };
    const project = r.project ? named(projectsByKey, newProjects, 'Проект', r.project) : null;
    const tagRefs = r.tags.map((t) => named(tagsByKey, newTags, 'Тег', t)).filter((x): x is Ref => x !== null);

    if (!failed) out.set(n, { category, categorySystemKey, counterparty, project, tags: tagRefs });
  }

  const cats = [...newCats.values()];
  return {
    rows: out,
    issues,
    categories: [...cats.filter((c) => c.parent === null), ...cats.filter((c) => c.parent !== null)],
    counterparties: [...newCps.values()].map(({ votes, ...c }) => ({ ...c, type: pickCounterpartyType(votes) })),
    projects: [...newProjects.values()],
    tags: [...newTags.values()],
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/server/schema-0006.test.ts tests/server/import-match.test.ts tests/server/migrate.test.ts tests/server/db.test.ts`
Expected: PASS (2 и 5 новых тестов; прежние тесты миграций проходят).

Run: `npm test` и `npm run typecheck`
Expected: 906 пройдено и 1 пропущен; typecheck без ошибок.

- [ ] **Step 6: Commit**

```bash
git add src/server/db/schema.ts src/server/db/migrations src/server/modules/imports/match.ts tests/server/schema-0006.test.ts tests/server/import-match.test.ts
git commit -m "feat: импорт — миграция 0006 (imports, operations.import_id) и сопоставление справочников" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Предпросмотр — счета, суммы и курсы, дубликаты, движение (§4.2, §5.3–§5.5, §6.3)

**Files:**
- Create: `src/shared/schemas/imports.ts`, `src/server/modules/imports/preview.ts`
- Test: `tests/server/import-preview.test.ts`

**Interfaces:**
- Consumes: `opsWorld` (`tests/helpers/ops.ts`: компания «ТОО», счета «Касса» KZT и «Валютный» USD с 01.10.2026, категории «Бар» и «Аренда», контрагент «ИП Клиент», тег «Смена», курс USD 475.12 на 01.10.2026, «сейчас» — 06.10.2026 12:00 UTC); `createRatesService`, `RatesService`, `rateUnavailable` (код `RATE_UNAVAILABLE`); `createAuditService`; `createLedgerBalances` (`companyBalances`); `requireCompany`; `convertMinor`, `DEC_ONE`, `divDec`, `roundSignificant`, `Dec` (`src/shared/decimal.ts`); `formatDateTime`, `todayInTimezone`, `zoneOffsetMs`; `ACCOUNT_NAME_MAX`; таблицы `accounts`, `currencies`, `imports`, `users`; всё из задач 1–5.
- Produces:
  - `src/shared/schemas/imports.ts`: `accountMappingSchema`, `type AccountMapping`; `importRequestSchema` (`{ token: 32 hex; accounts: AccountMapping[] }`), `type ImportRequest`; `interface ImportIssueGroup`, `ImportPreviewAccount`, `ImportCreateItem`, `ImportPreview`;
  - `preview.ts`: `interface PlannedRow`, `PlannedAccount`, `PlannedAccountChange`, `ImportPlan`, `PreviewSource { token; companyId; file: { name; size; sha256 }; parsed }`, `PreviewDeps { db; rates; timezone; now }`; `CREATE_ITEMS_MAX = 200`; `minuteOf(iso, timeZone)`; `buildPreview(deps, src, requested: AccountMapping[]): { preview: ImportPreview; plan: ImportPlan }`.

- [ ] **Step 1: Write the failing test**

Создайте `tests/server/import-preview.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { createAuditService } from '../../src/server/modules/audit/service';
import { parseSheet } from '../../src/server/modules/imports/parse-row';
import { buildPreview, minuteOf } from '../../src/server/modules/imports/preview';
import { readXlsx } from '../../src/server/modules/imports/xlsx-read';
import { createRatesService } from '../../src/server/modules/rates/service';
import type { AccountMapping } from '../../src/shared/schemas/imports';
import { excelSerial as at, finmapLikeRow as fr, finmapLikeXlsx, type FinmapLikeValue } from '../helpers/finmap-like';
import { opsWorld, type OpsWorld } from '../helpers/ops';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

const NOW = new Date('2026-10-06T12:00:00.000Z'); // 17:00 по Алматы
const CTX = { timezone: 'Asia/Almaty', baseCurrency: 'KZT', today: '2026-10-06', date1904: false };

/** Предпросмотр синтетического файла в компании opsWorld (счета «Касса» KZT и «Валютный» USD, курс USD 475.12 на 01.10.2026). */
function preview(rows: FinmapLikeValue[][], mappings: AccountMapping[] = [], sha256 = 'sha-1') {
  const db = w.h.t.db;
  const parsed = parseSheet(readXlsx(finmapLikeXlsx(rows)), CTX);
  return buildPreview(
    { db, rates: createRatesService({ db, audit: createAuditService(db) }), timezone: 'Asia/Almaty', now: () => NOW },
    { token: 'тест', companyId: w.cid, file: { name: 'выгрузка.xlsx', size: 123, sha256 }, parsed },
    mappings,
  );
}
const one = (sql: string, ...args: unknown[]) => w.h.t.sqlite.prepare(sql).get(...args) as Record<string, number>;
const systemId = (key: string) => one('SELECT id FROM categories WHERE company_id = ? AND system_key = ?', w.cid, key).id!;

describe('предпросмотр: счета, движение, остатки (§5.4 спецификации импорта)', () => {
  it('сопоставление по умолчанию, движение, дата открытия, оба режима остатка и «Остаток после импорта»', async () => {
    w = await opsWorld();
    await w.post(w.ops, { type: 'income', paidAt: '2026-10-05T05:00:00Z', accountId: w.kzt, amount: 20000 }); // остаток «Кассы» 200 ₸
    const rows = [
      fr({ paidAt: at('2026-10-02', '10:00:00'), amount: 10000, to: 'КАССА' }),
      fr({ paidAt: at('2026-09-20', '09:00:00'), amount: 2500, from: 'Касса' }),
      fr({ paidAt: at('2026-10-03', '12:00:00'), amount: 5000, to: 'Банк-2' }),
      fr({ paidAt: at('2026-10-04', '08:30:00'), amount: 1000, from: 'Банк-2', to: '\u004Bасса' }), // латинская K
    ];
    const { preview: p, plan } = preview(rows);
    expect(p.counts).toEqual({ income: 2, expense: 1, transfer: 1, add: 4, duplicates: 0, skippedFuture: 0 });
    expect(p.period).toEqual({ from: '2026-09-20', to: '2026-10-04' });
    expect(p.accounts).toEqual([
      {
        key: 'касса',
        fileName: 'КАССА',
        rows: 3,
        mapping: { key: 'касса', kind: 'existing', accountId: w.kzt },
        currency: 'KZT',
        movement: 1_000_000 - 250_000 + 100_000,
        existing: { balance: 20000, openedAt: '2026-10-01', newOpenedAt: '2026-09-20' },
        archivedHint: false,
        errors: [],
      },
      {
        key: 'банк-2',
        fileName: 'Банк-2',
        rows: 2,
        mapping: { key: 'банк-2', kind: 'new', name: 'Банк-2', currency: 'KZT', balance: null },
        currency: 'KZT',
        movement: 500_000 - 100_000,
        archivedHint: false,
        errors: [],
      },
    ]);
    expect(p.canImport).toBe(true);
    expect(plan.accounts).toEqual([{ key: 'банк-2', name: 'Банк-2', currency: 'KZT', startingBalance: 0, openedAt: '2026-10-03' }]);
    expect(plan.accountChanges).toEqual([{ accountId: w.kzt, before: { startingBalance: 0, openedAt: '2026-10-01' }, after: { startingBalance: 0, openedAt: '2026-09-20' } }]);
    // план: по времени, суммы в минимальных единицах, счета — id или ключ нового
    expect(plan.rows.map((r) => [r.row, r.type, r.account, r.toAccount, r.amount, r.toAmount, r.baseAmount, r.rate])).toEqual([
      [3, 'expense', { id: w.kzt }, null, 250_000, null, 250_000, '1'],
      [2, 'income', { id: w.kzt }, null, 1_000_000, null, 1_000_000, '1'],
      [4, 'income', { key: 'банк-2' }, null, 500_000, null, 500_000, '1'],
      [5, 'transfer', { key: 'банк-2' }, { id: w.kzt }, 100_000, 100_000, 100_000, '1'],
    ]);

    const modes = preview(rows, [
      { key: 'банк-2', kind: 'new', name: ' Банк  2 ', currency: 'USD', balance: { mode: 'current', amount: 1_000_000 } },
      { key: 'касса', kind: 'existing', accountId: w.kzt, targetBalance: 900_000 },
    ]);
    // новый счёт в USD: суммы — по курсу; «Текущий остаток» B → стартовый B - движение
    expect(modes.plan.accounts).toEqual([{ key: 'банк-2', name: 'Банк 2', currency: 'USD', startingBalance: 1_000_000 - 400_000, openedAt: '2026-10-03' }]);
    // перевод USD → KZT: сумма зачисления — в базовой валюте
    expect(modes.plan.rows.find((r) => r.type === 'transfer')).toMatchObject({ amount: 100_000, baseAmount: 47_512_000, toAmount: 47_512_000, rate: '475.12' });
    // «Остаток после импорта» 9 000 ₸: стартовый = цель - (движение имеющихся операций + движение файла)
    expect(modes.plan.accountChanges).toEqual([
      { accountId: w.kzt, before: { startingBalance: 0, openedAt: '2026-10-01' }, after: { startingBalance: 900_000 - (20_000 + 1_000_000 - 250_000 + 47_512_000), openedAt: '2026-09-20' } },
    ]);
    const start = preview(rows, [{ key: 'банк-2', kind: 'new', name: 'Банк-2', currency: 'KZT', balance: { mode: 'start', amount: 50_000 } }]);
    expect(start.plan.accounts[0]!.startingBalance).toBe(50_000);
  });

  it('ошибки счетов: несколько подходящих (A1), выбран несуществующий (A1) или архивный (A5), название (A3), валюта (A2), остаток (A4)', async () => {
    w = await opsWorld();
    await w.post(`/api/v1/companies/${w.cid}/accounts`, { name: 'касса', currency: 'KZT', openedAt: '2026-10-01' });
    const safe = (await w.post(`/api/v1/companies/${w.cid}/accounts`, { name: 'Сейф', currency: 'KZT', openedAt: '2026-10-01' })).account.id as number;
    await w.post(`/api/v1/companies/${w.cid}/accounts/${safe}/archive`, {});
    const rows = [
      fr({ paidAt: at('2026-10-02'), amount: 100, to: 'Касса' }),
      fr({ paidAt: at('2026-10-02'), amount: 100, to: 'Сейф' }),
      fr({ paidAt: at('2026-10-02'), amount: 100, to: 'Банк' }),
    ];
    const a = preview(rows);
    expect(a.preview.accounts.map((x) => [x.key, x.mapping?.kind ?? null, x.archivedHint, x.errors])).toEqual([
      ['касса', null, false, [{ code: 'A1', message: 'Выберите счёт для «Касса» — подходит несколько' }]],
      ['сейф', 'new', true, []],
      ['банк', 'new', false, []],
    ]);
    expect(a.preview.counts.add).toBe(2); // строки счёта без выбора не считаются
    expect(a.preview.canImport).toBe(false);

    const b = preview(rows, [
      { key: 'касса', kind: 'existing', accountId: 999_999 },
      { key: 'сейф', kind: 'existing', accountId: safe },
      { key: 'банк', kind: 'new', name: '\u200B', currency: 'EUR', balance: null },
    ]);
    expect(b.preview.accounts.map((x) => x.errors.map((e) => `${e.code}: ${e.message}`))).toEqual([
      ['A1: Выберите счёт для «Касса»'],
      ['A5: Счёт «Сейф» в архиве — выберите другой'],
      ['A3: Название счёта: от 1 до 120 символов', 'A2: Неизвестная валюта'],
    ]);
    const c = preview(rows, [
      { key: 'касса', kind: 'existing', accountId: w.kzt, targetBalance: -Number.MAX_SAFE_INTEGER },
      { key: 'банк', kind: 'new', name: 'Банк', currency: 'KZT', balance: { mode: 'current', amount: -Number.MAX_SAFE_INTEGER } },
    ]);
    expect(c.preview.accounts.map((x) => x.errors.map((e) => e.code))).toEqual([['A4'], [], ['A4']]);
    expect(c.preview.canImport).toBe(false);
  });
});

describe('предпросмотр: суммы и валюты (§4.2)', () => {
  it('счёт USD без F — курс на дату; с F — F и производный курс; нет курса — R16; перевод KZT → USD; W9 и W10; хвосты float', async () => {
    w = await opsWorld();
    const { preview: p, plan } = preview([
      fr({ paidAt: at('2026-10-05', '10:00:00'), amount: 1, from: 'Валютный' }),
      fr({ paidAt: at('2026-10-05', '11:00:00'), amount: 1, baseAmount: 480, from: 'Валютный' }),
      fr({ paidAt: at('2026-10-05', '12:00:00'), amount: 475.12, from: 'Касса', to: 'Валютный' }),
      fr({ paidAt: at('2026-10-05', '13:00:00'), amount: 100, baseAmount: 101, from: 'Касса' }),
      fr({ paidAt: at('2026-10-05', '14:00:00'), amount: '1,005', from: 'Касса' }),
      fr({ paidAt: at('2026-09-01', '10:00:00'), amount: 1, from: 'Валютный' }),
      // хвост двоичной дроби Excel — не «лишние знаки»: ни округления, ни W10 (Review Focus 3)
      fr({ paidAt: at('2026-10-05', '15:00:00'), amount: 1317.0000000000002, baseAmount: 1317.0000000000002, from: 'Касса' }),
    ]);
    expect(plan.rows.map((r) => [r.row, r.amount, r.baseAmount, r.rate, r.toAmount])).toEqual([
      [2, 100, 47512, '475.12', null],
      [3, 100, 48000, '480', null],
      [4, 47512, 47512, '1', 100],
      [5, 10000, 10000, '1', null],
      [6, 101, 101, '1', null],
      [8, 131700, 131700, '1', null],
    ]);
    expect(p.errors).toEqual({
      total: 1,
      byCode: [{ code: 'R16', message: 'Нет курса USD на 01.09.2026 — заполните «Сумму в валюте компании» или добавьте курс на дату', count: 1, rows: [7] }],
    });
    expect(p.warnings.map((g) => [g.code, g.rows])).toEqual([
      ['W9', [5]],
      ['W10', [6]],
    ]);
    expect(p.canImport).toBe(false);
  });
});

describe('предпросмотр: дубликаты (§5.5)', () => {
  it('ключ с категорией и контрагентом («22:07»), кратность, разбитая операция, перевод; удалённые не считаются; новые счета — не дубликаты', async () => {
    w = await opsWorld();
    const salary = systemId('salary');
    const cp = async (name: string) => (await w.post(`/api/v1/companies/${w.cid}/counterparties`, { type: 'employee', name })).counterparty.id as number;
    const a = await cp('Сотрудник А');
    const b = await cp('Сотрудник Б');
    const bank = (await w.post(`/api/v1/companies/${w.cid}/accounts`, { name: 'Банк', currency: 'KZT', openedAt: '2026-10-01' })).account.id as number;
    // два расхода по 85 ₸ с «Кассы» по «Зарплате» в 22:07 — разным сотрудникам
    for (const counterpartyId of [a, b]) {
      await w.post(w.ops, { type: 'expense', paidAt: '2026-10-03T17:07:00Z', accountId: w.kzt, amount: 8500, counterpartyId, lines: [{ categoryId: salary, amount: 8500 }] });
    }
    await w.post(w.ops, { type: 'income', paidAt: '2026-10-04T05:00:00Z', accountId: w.kzt, amount: 30000, lines: [{ categoryId: w.income, amount: 20000 }, { categoryId: w.income, amount: 10000 }] });
    const gone = (await w.post(w.ops, { type: 'expense', paidAt: '2026-10-04T06:00:00Z', accountId: w.kzt, amount: 777 })).operation.id as number;
    expect((await w.h.req('DELETE', `${w.ops}/${gone}`)).statusCode).toBe(200);
    await w.post(w.ops, { type: 'transfer', paidAt: '2026-10-04T07:00:00Z', accountId: w.kzt, amount: 1000, toAccountId: bank });

    const { preview: p } = preview([
      fr({ paidAt: at('2026-10-03', '22:07:30'), amount: 85, from: 'Касса', category: 'Зарплата', counterparty: 'Сотрудник А' }),
      fr({ paidAt: at('2026-10-03', '22:07:00'), amount: 85, from: 'Касса', category: 'Зарплата', counterparty: 'Сотрудник Б' }),
      fr({ paidAt: at('2026-10-03', '22:07:00'), amount: 85, from: 'Касса', category: 'Зарплата', counterparty: 'Сотрудник А' }),
      fr({ paidAt: at('2026-10-04', '10:00:00'), amount: 200, to: 'Касса', category: 'Бар' }),
      fr({ paidAt: at('2026-10-04', '10:00:00'), amount: 100, to: 'Касса', category: 'Бар' }),
      fr({ paidAt: at('2026-10-04', '11:00:00'), amount: 7.77, from: 'Касса' }),
      fr({ paidAt: at('2026-10-04', '12:00:00'), amount: 10, from: 'Касса', to: 'Банк' }),
      fr({ paidAt: at('2026-10-04', '12:00:00'), amount: 10, from: 'Касса', to: 'Новый банк' }),
    ]);
    expect(p.duplicates).toEqual({ count: 5, rows: [2, 3, 5, 6, 8] });
    expect(p.counts).toMatchObject({ add: 3, duplicates: 5 });
    expect(p.canImport).toBe(true);
    expect(minuteOf('2026-10-03T17:07:59.000Z', 'Asia/Almaty')).toBe('2026-10-03 22:07');
  });

  it('повторный файл: все строки — дубликаты, «Нечего импортировать»; W8 — только у неотменённого импорта с тем же SHA-256', async () => {
    w = await opsWorld();
    await w.post(w.ops, { type: 'income', paidAt: '2026-10-05T05:00:00Z', accountId: w.kzt, amount: 10000 });
    const rows = [fr({ paidAt: at('2026-10-05', '10:00:00'), amount: 100, to: 'Касса' })];
    const ins = w.h.t.sqlite.prepare(
      "INSERT INTO imports (company_id, user_id, file_name, file_size, file_sha256, status, counts, created, account_changes, created_at) VALUES (?, 1, 'f', 1, ?, ?, '{}', '{}', '[]', '2026-10-06T12:00:00.000Z')",
    );
    ins.run(w.cid, 'sha-old', 'undone');
    expect(preview(rows, [], 'sha-old').preview.warnings).toEqual([]);
    ins.run(w.cid, 'sha-old', 'done');
    const { preview: p } = preview(rows, [], 'sha-old');
    expect(p.counts).toMatchObject({ add: 0, duplicates: 1 });
    expect(p.canImport).toBe(false);
    expect(p.warnings).toEqual([
      { code: 'W8', message: 'Этот файл уже импортирован 06.10.2026, 17:00 (Тест) — совпадение по SHA-256, импорт не отменён', count: 1, rows: [] },
    ]);
  });
});

describe('предпросмотр: «Будет создано», ошибки строк (§5.3)', () => {
  it('новые категории с родителем, контрагенты с типом, проекты, теги; ошибки строк блокируют импорт', async () => {
    w = await opsWorld();
    const { preview: p } = preview([
      fr({ paidAt: at('2026-10-05'), amount: 100, from: 'Касса', category: 'Зарплата', subcategory: 'Бармены', counterparty: 'Сотрудник В', project: 'Клуб 3', tags: 'Смена, Ночь' }),
      fr({ paidAt: at('2026-10-05'), amount: 100, to: 'Касса', category: 'Кухня', counterparty: 'Гость' }),
      fr({ paidAt: at('2026-10-05'), amount: 'сто', to: 'Касса' }),
    ]);
    expect(p.create).toEqual({
      categories: {
        total: 2,
        items: [
          { name: 'Кухня', kind: 'income', rows: 1 },
          { name: 'Бармены', kind: 'expense', parent: 'Зарплата', rows: 1 },
        ],
      },
      counterparties: {
        total: 2,
        items: [
          { name: 'Сотрудник В', type: 'employee', rows: 1 },
          { name: 'Гость', type: 'client', rows: 1 },
        ],
      },
      projects: { total: 1, items: [{ name: 'Клуб 3', rows: 1 }] },
      tags: { total: 1, items: [{ name: 'Ночь', rows: 1 }] },
    });
    expect(p.errors).toEqual({ total: 1, byCode: [{ code: 'R05', message: 'Не удалось прочитать сумму «сто»', count: 1, rows: [4] }] });
    expect(p.file).toEqual({ name: 'выгрузка.xlsx', size: 123, rows: 3 });
    expect(p.canImport).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/import-preview.test.ts`
Expected: FAIL — модули `imports/preview` и `shared/schemas/imports` не найдены.

- [ ] **Step 3: Write minimal implementation**

Создайте `src/shared/schemas/imports.ts`:

```ts
import { z } from 'zod';
import type { CategoryKind, CounterpartyType } from '../system-categories';

/** Сумма в минимальных единицах: целое, безопасное (знак любой — остаток бывает отрицательным). */
const minor = z.number().refine(Number.isSafeInteger, 'Сумма — целое число минимальных единиц');
/** Ключ счёта из файла (nameKey названия). */
const key = z.string().min(1).max(40_000);

/**
 * Сопоставление счёта из файла (§6.2 спецификации импорта): существующий счёт (необязательный «Остаток после импорта»)
 * или новый (название, валюта, «Текущий остаток» или «Стартовый баланс»). Суммы — в минимальных единицах валюты счёта.
 */
export const accountMappingSchema = z.discriminatedUnion('kind', [
  z.object({
    key,
    kind: z.literal('existing'),
    accountId: z.number().int().positive(),
    targetBalance: minor.nullable().optional(),
  }),
  z.object({
    key,
    kind: z.literal('new'),
    name: z.string().max(1000),
    currency: z.string().min(1).max(10),
    balance: z.object({ mode: z.enum(['current', 'start']), amount: minor }).nullable(),
  }),
]);
export type AccountMapping = z.infer<typeof accountMappingSchema>;

/** Тело POST …/imports/preview и POST …/imports: токен проверки и сопоставление счетов. */
export const importRequestSchema = z.object({
  token: z.string().regex(/^[0-9a-f]{32}$/, 'Проверка устарела — загрузите файл заново'),
  accounts: z.array(accountMappingSchema).max(1000, 'Слишком много счетов').default([]),
});
export type ImportRequest = z.infer<typeof importRequestSchema>;

/** Группа ошибок или предупреждений: код, текст, число строк и до 20 первых номеров. */
export interface ImportIssueGroup {
  code: string;
  message: string;
  count: number;
  rows: number[];
}

export interface ImportPreviewAccount {
  key: string;
  /** Название из файла. */
  fileName: string;
  /** Добавляемых строк этого счёта. */
  rows: number;
  /** Текущее сопоставление (по умолчанию или из запроса); null — подходит несколько счетов, выбор за человеком (A1). */
  mapping: AccountMapping | null;
  /** Валюта счёта; null — счёт не выбран или валюта неизвестна. */
  currency: string | null;
  /** Движение добавляемых строк в валюте счёта: поступления минус списания. */
  movement: number;
  /** Существующий счёт: текущий остаток, дата открытия и её перенос на первую операцию файла. */
  existing?: { balance: number; openedAt: string; newOpenedAt: string | null };
  /** «Есть счёт «…» в архиве»: с этим ключом есть архивный счёт. */
  archivedHint: boolean;
  errors: { code: string; message: string }[];
}

export interface ImportCreateItem {
  name: string;
  kind?: CategoryKind;
  /** Родитель подкатегории. */
  parent?: string;
  /** Тип нового контрагента. */
  type?: CounterpartyType;
  rows: number;
}

/** Ответ проверки (§6.3): списки урезаны — номера строк до 20, названия до 200. */
export interface ImportPreview {
  token: string;
  file: { name: string; size: number; rows: number };
  counts: { income: number; expense: number; transfer: number; add: number; duplicates: number; skippedFuture: number };
  /** Календарные даты добавляемых строк. */
  period: { from: string; to: string } | null;
  accounts: ImportPreviewAccount[];
  create: Record<'categories' | 'counterparties' | 'projects' | 'tags', { total: number; items: ImportCreateItem[] }>;
  errors: { total: number; byCode: ImportIssueGroup[] };
  warnings: ImportIssueGroup[];
  duplicates: { count: number; rows: number[] };
  canImport: boolean;
}
```

Создайте `src/server/modules/imports/preview.ts`:

```ts
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { getCurrency } from '../../../shared/currencies';
import { formatDateTime, todayInTimezone, zoneOffsetMs } from '../../../shared/dates';
import { convertMinor, DEC_ONE, divDec, roundSignificant, type Dec } from '../../../shared/decimal';
import { nameKey, repairName } from '../../../shared/finmap-format';
import { ACCOUNT_NAME_MAX } from '../../../shared/schemas/accounts';
import type { AccountMapping, ImportCreateItem, ImportPreview, ImportPreviewAccount } from '../../../shared/schemas/imports';
import { cleanName } from '../../../shared/text';
import type { Db } from '../../db/client';
import { accounts, currencies, imports, users } from '../../db/schema';
import { AppError } from '../../errors';
import { createLedgerBalances } from '../balances/service';
import { requireCompany } from '../companies/guard';
import type { RatesService } from '../rates/service';
import { groupIssues, isRowError, ISSUE_ROWS_MAX, MESSAGES as M, type RowIssue } from './errors';
import { loadDictionaries, matchDictionaries, type MatchedRow, type PlannedCategory, type PlannedCounterparty, type PlannedNamed, type Ref } from './match';
import { decimalToMinor, type FileAccount, type ImportRow, type ImportType, type ParsedFile } from './parse-row';

/**
 * Предпросмотр импорта (§5 спецификации импорта): сопоставление счетов и справочников с компанией, суммы в валютах
 * счетов, дубликаты, движение и остатки счетов. Ничего не пишет. План записи (ImportPlan) — для POST …/imports (план И-2).
 */

/** Строка, которая будет добавлена: всё сопоставлено, суммы в минимальных единицах. */
export interface PlannedRow {
  row: number;
  type: ImportType;
  paidAt: string;
  accrualDate: string | null;
  account: Ref;
  toAccount: Ref | null;
  amount: number;
  toAmount: number | null;
  baseAmount: number;
  /** Курс для показа (10 значащих цифр). */
  rate: string;
  category: Ref | null;
  counterparty: Ref | null;
  project: Ref | null;
  tags: Ref[];
  comment: string | null;
}

export interface PlannedAccount {
  key: string;
  name: string;
  currency: string;
  startingBalance: number;
  openedAt: string;
}

/** Существующий счёт, который импорт меняет: перенос openedAt и (или) новый startingBalance. */
export interface PlannedAccountChange {
  accountId: number;
  before: { startingBalance: number; openedAt: string };
  after: { startingBalance: number; openedAt: string };
}

export interface ImportPlan {
  /** Добавляемые строки по (paidAt, номер строки): id растут по времени. */
  rows: PlannedRow[];
  accounts: PlannedAccount[];
  accountChanges: PlannedAccountChange[];
  categories: PlannedCategory[];
  counterparties: PlannedCounterparty[];
  projects: PlannedNamed[];
  tags: PlannedNamed[];
}

export interface PreviewSource {
  token: string;
  companyId: number;
  file: { name: string; size: number; sha256: string };
  parsed: ParsedFile;
}

export interface PreviewDeps {
  db: Db;
  rates: RatesService;
  timezone: string;
  now: () => Date;
}

/** Не больше названий в группе «Будет создано». */
export const CREATE_ITEMS_MAX = 200;

/** Минута момента по часам timeZone: «ГГГГ-ММ-ДД ЧЧ:ММ» (ключ дубликата, §5.5). */
export function minuteOf(iso: string, timeZone: string): string {
  const t = Date.parse(iso);
  const local = new Date(t + zoneOffsetMs(t, timeZone)).toISOString();
  return `${local.slice(0, 10)} ${local.slice(11, 16)}`;
}

/** Ключ дубликата (§5.5): тип, счета, минута, сумма, категория, контрагент. */
function dupKey(type: string, accountId: number, toAccountId: number | null, minute: string, amount: number, categoryId: number | null, counterpartyId: number | null): string {
  return [type, accountId, toAccountId ?? '', minute, amount, categoryId ?? '', counterpartyId ?? ''].join('|');
}

const idOf = (r: Ref | null): number | null => (r && 'id' in r ? r.id : null);

type AccountRow = typeof accounts.$inferSelect;

interface AccountState {
  key: string;
  fileName: string;
  mapping: AccountMapping | null;
  /** Валюта известна — суммы строк считаются. */
  currency: string | null;
  /** Ошибок нет — строки попадают в план. */
  ref: Ref | null;
  existing: AccountRow | null;
  archivedHint: boolean;
  errors: { code: string; message: string }[];
}

interface Resolved {
  src: ImportRow;
  acc: AccountState;
  to: AccountState | null;
  amount: number;
  toAmount: number | null;
  baseAmount: number;
  rate: string;
  m: MatchedRow;
}

export function buildPreview(deps: PreviewDeps, src: PreviewSource, requested: AccountMapping[]): { preview: ImportPreview; plan: ImportPlan } {
  const { db, timezone } = deps;
  const companyId = src.companyId;
  const company = requireCompany(db, companyId);
  const base = company.baseCurrency;
  const baseUnits = getCurrency(base).minorUnits;
  const today = todayInTimezone(timezone, deps.now());
  const issues: RowIssue[] = [...src.parsed.issues];

  // ——— счета из файла (§5.4)
  const companyAccounts = db.select().from(accounts).where(eq(accounts.companyId, companyId)).orderBy(asc(accounts.orderIndex), asc(accounts.id)).all();
  const accountsByKey = new Map<string, AccountRow[]>();
  for (const a of companyAccounts) accountsByKey.set(nameKey(a.name), [...(accountsByKey.get(nameKey(a.name)) ?? []), a]);
  const known = new Set(db.select({ code: currencies.code }).from(currencies).all().map((c) => c.code));
  const balances = new Map(createLedgerBalances(db).companyBalances(companyId).map((b) => [b.accountId, b.balance]));
  const requestedByKey = new Map(requested.map((m) => [m.key, m]));
  const states = new Map<string, AccountState>();

  function stateOf(a: FileAccount): AccountState {
    const found = states.get(a.key);
    if (found) return found;
    const same = accountsByKey.get(a.key) ?? [];
    const active = same.filter((x) => !x.archivedAt);
    const byDefault: AccountMapping | null =
      active.length === 1
        ? { key: a.key, kind: 'existing', accountId: active[0]!.id }
        : active.length === 0
          ? { key: a.key, kind: 'new', name: repairName(a.name), currency: base, balance: null }
          : null;
    const mapping = requestedByKey.get(a.key) ?? byDefault;
    const st: AccountState = { key: a.key, fileName: a.name, mapping, currency: null, ref: null, existing: null, archivedHint: same.some((x) => x.archivedAt !== null), errors: [] };
    if (!mapping) st.errors.push({ code: 'A1', message: M.A1(a.name) });
    else if (mapping.kind === 'existing') {
      const acc = companyAccounts.find((x) => x.id === mapping.accountId);
      if (!acc) st.errors.push({ code: 'A1', message: M.A1_MISSING(a.name) });
      else if (acc.archivedAt) st.errors.push({ code: 'A5', message: M.A5(acc.name) });
      else {
        st.currency = acc.currency;
        st.existing = acc;
        st.ref = { id: acc.id };
      }
    } else {
      const name = cleanName(mapping.name);
      if (!name || name.length > ACCOUNT_NAME_MAX) st.errors.push({ code: 'A3', message: M.A3 });
      if (!known.has(mapping.currency)) st.errors.push({ code: 'A2', message: M.A2 });
      else st.currency = mapping.currency;
      if (st.errors.length === 0) st.ref = { key: a.key };
    }
    states.set(a.key, st);
    return st;
  }

  // ——— справочники (§4.5–§4.8)
  const matched = matchDictionaries(loadDictionaries(db, companyId), src.parsed.rows);
  issues.push(...matched.issues);

  // ——— суммы (§4.2): курс на дату — один запрос на пару (валюта, дата)
  const rateCache = new Map<string, { rate: Dec; display: string } | null>();
  function rateOn(currency: string, date: string): { rate: Dec; display: string } | null {
    const k = `${currency}|${date}`;
    if (!rateCache.has(k)) {
      try {
        rateCache.set(k, deps.rates.resolve(companyId, base, currency, date));
      } catch (e) {
        if (!(e instanceof AppError && e.code === 'RATE_UNAVAILABLE')) throw e;
        rateCache.set(k, null);
      }
    }
    return rateCache.get(k)!;
  }

  const resolved: Resolved[] = [];
  for (const r of src.parsed.rows) {
    const acc = stateOf(r.account);
    const to = r.toAccount ? stateOf(r.toAccount) : null;
    const accCurrency = acc.currency;
    const toCurrency = to?.currency ?? null;
    // счёт не выбран или с ошибкой — ошибка уже в карточке счёта
    if (!accCurrency || (to && !toCurrency)) continue;
    const err = (code: RowIssue['code'], message: string) => issues.push({ code, message, row: r.row });
    if (to && idOf(acc.ref) !== null && idOf(acc.ref) === idOf(to.ref)) {
      err('R09', M.R09);
      continue;
    }
    const units = getCurrency(accCurrency).minorUnits;
    const a = decimalToMinor(r.amount, units);
    if (!a) {
      err('R07', M.R07);
      continue;
    }
    if (a.minor === 0) {
      err('R06', M.R06);
      continue;
    }
    if (a.rounded) issues.push({ code: 'W10', message: M.W10(units), row: r.row });

    let baseAmount: number;
    let rate: string;
    if (accCurrency === base) {
      baseAmount = a.minor;
      rate = '1';
      if (r.baseAmount !== null && r.baseAmount !== a.minor) issues.push({ code: 'W9', message: M.W9, row: r.row });
    } else if (r.baseAmount !== null) {
      // курс для показа — F / E с учётом minorUnits (исключение из §4.3 этапа 1)
      baseAmount = r.baseAmount;
      rate = roundSignificant(divDec(BigInt(r.baseAmount) * 10n ** BigInt(units), BigInt(a.minor) * 10n ** BigInt(baseUnits)));
    } else {
      const x = rateOn(accCurrency, r.date);
      if (!x) {
        err('R16', M.R16(accCurrency, r.date));
        continue;
      }
      baseAmount = convertMinor(a.minor, x.rate, units, baseUnits);
      rate = x.display;
      if (!Number.isSafeInteger(baseAmount)) {
        err('R07', M.R07);
        continue;
      }
    }

    // перевод между валютами: сумма зачисления (§4.2)
    let toAmount: number | null = null;
    if (toCurrency) {
      if (toCurrency === accCurrency) toAmount = a.minor;
      else if (toCurrency === base) toAmount = baseAmount;
      else {
        const y = rateOn(toCurrency, r.date);
        if (!y) {
          err('R16', M.R16(toCurrency, r.date));
          continue;
        }
        toAmount = convertMinor(baseAmount, divDec(DEC_ONE, y.rate), baseUnits, getCurrency(toCurrency).minorUnits);
        if (!Number.isSafeInteger(toAmount) || toAmount <= 0) {
          err('R07', M.R07);
          continue;
        }
      }
    }
    const m = matched.rows.get(r.row);
    if (!m) continue; // R17 — уже в замечаниях
    resolved.push({ src: r, acc, to, amount: a.minor, toAmount, baseAmount, rate, m });
  }

  // ——— дубликаты (§5.5): строки, где всё сопоставлено с существующим, против строк неудалённых операций компании
  const candidates = resolved.filter(
    (x) =>
      idOf(x.acc.ref) !== null &&
      (!x.to || idOf(x.to.ref) !== null) &&
      (!x.m.category || idOf(x.m.category) !== null) &&
      (!x.m.counterparty || idOf(x.m.counterparty) !== null),
  );
  const existingCounts = new Map<string, number>();
  if (candidates.length) {
    const ids = [...new Set(candidates.flatMap((x) => [idOf(x.acc.ref)!, ...(x.to ? [idOf(x.to.ref)!] : [])]))];
    const times = candidates.map((x) => Date.parse(x.src.paidAt));
    const from = new Date(times.reduce((p, t) => Math.min(p, t)) - 60_000).toISOString();
    const until = new Date(times.reduce((p, t) => Math.max(p, t)) + 60_000).toISOString();
    const list = sql.join(
      ids.map((x) => sql`${x}`),
      sql`, `,
    );
    const recs = db.all<{
      id: number;
      type: string;
      accountId: number;
      toAccountId: number | null;
      paidAt: string;
      amount: number;
      counterpartyId: number | null;
      lineAmount: number | null;
      categoryId: number | null;
    }>(sql`
      SELECT o.id AS id, o.type AS type, o.account_id AS accountId, o.to_account_id AS toAccountId, o.paid_at AS paidAt,
             o.amount AS amount, o.counterparty_id AS counterpartyId, l.amount AS lineAmount, l.category_id AS categoryId
        FROM operations o LEFT JOIN operation_lines l ON l.operation_id = o.id
       WHERE o.company_id = ${companyId} AND o.deleted_at IS NULL AND o.status = 'actual'
         AND (o.account_id IN (${list}) OR o.to_account_id IN (${list}))
         AND o.paid_at >= ${from} AND o.paid_at < ${until}`);
    const seenTransfers = new Set<number>();
    for (const r of recs) {
      let k: string;
      if (r.type === 'transfer') {
        // перевод — одна запись, без категории и контрагента
        if (seenTransfers.has(r.id)) continue;
        seenTransfers.add(r.id);
        k = dupKey('transfer', r.accountId, r.toAccountId, minuteOf(r.paidAt, timezone), r.amount, null, null);
      } else {
        // разбитая операция — запись на каждую строку: сумма и категория строки
        k = dupKey(r.type, r.accountId, null, minuteOf(r.paidAt, timezone), r.lineAmount ?? r.amount, r.categoryId, r.counterpartyId);
      }
      existingCounts.set(k, (existingCounts.get(k) ?? 0) + 1);
    }
  }
  // кратность: строки файла по порядку, каждая «забирает» одну запись со своим ключом
  const duplicates: number[] = [];
  for (const x of candidates) {
    const k = dupKey(x.src.type, idOf(x.acc.ref)!, x.to ? idOf(x.to.ref) : null, x.src.minute, x.amount, idOf(x.m.category), idOf(x.m.counterparty));
    const left = existingCounts.get(k) ?? 0;
    if (left > 0) {
      existingCounts.set(k, left - 1);
      duplicates.push(x.src.row);
    }
  }
  const dupSet = new Set(duplicates);
  const added = resolved.filter((x) => !dupSet.has(x.src.row));

  // ——— движение, остатки и дата открытия счетов (§5.4)
  const movement = new Map<string, number>();
  const movementById = new Map<number, number>();
  const rowsOf = new Map<string, number>();
  const earliest = new Map<string, string>();
  const touch = (st: AccountState, delta: number, date: string) => {
    movement.set(st.key, (movement.get(st.key) ?? 0) + delta);
    const id = idOf(st.ref);
    if (id !== null) movementById.set(id, (movementById.get(id) ?? 0) + delta);
    rowsOf.set(st.key, (rowsOf.get(st.key) ?? 0) + 1);
    const e = earliest.get(st.key);
    if (!e || date < e) earliest.set(st.key, date);
  };
  for (const x of added) {
    if (x.src.type === 'income') touch(x.acc, x.amount, x.src.date);
    else touch(x.acc, -x.amount, x.src.date);
    if (x.to) touch(x.to, x.toAmount!, x.src.date);
  }

  const planAccounts: ImportPlan['accounts'] = [];
  const accountChanges: PlannedAccountChange[] = [];
  const cards: ImportPreviewAccount[] = [];
  for (const st of states.values()) {
    const move = movement.get(st.key) ?? 0;
    const first = earliest.get(st.key) ?? null;
    const card: ImportPreviewAccount = {
      key: st.key,
      fileName: st.fileName,
      rows: rowsOf.get(st.key) ?? 0,
      mapping: st.mapping,
      currency: st.currency,
      movement: move,
      archivedHint: st.archivedHint,
      errors: st.errors,
    };
    if (st.existing) {
      const acc = st.existing;
      const balance = balances.get(acc.id) ?? acc.startingBalance;
      const newOpenedAt = first !== null && first < acc.openedAt ? first : null;
      card.existing = { balance, openedAt: acc.openedAt, newOpenedAt };
      const target = st.mapping?.kind === 'existing' ? (st.mapping.targetBalance ?? null) : null;
      // «Остаток после импорта»: стартовый баланс = цель - (движение имеющихся операций + движение файла)
      const startingBalance = target === null ? acc.startingBalance : target - (balance - acc.startingBalance + (movementById.get(acc.id) ?? 0));
      if (!Number.isSafeInteger(startingBalance)) st.errors.push({ code: 'A4', message: M.A4 });
      else if (startingBalance !== acc.startingBalance || newOpenedAt !== null) {
        if (!accountChanges.some((c) => c.accountId === acc.id)) {
          accountChanges.push({
            accountId: acc.id,
            before: { startingBalance: acc.startingBalance, openedAt: acc.openedAt },
            after: { startingBalance, openedAt: newOpenedAt ?? acc.openedAt },
          });
        }
      }
    } else if (st.mapping?.kind === 'new' && st.ref) {
      // «Текущий остаток» B: стартовый = B - движение; «Стартовый баланс» S — как есть; пусто — 0
      const b = st.mapping.balance;
      const startingBalance = b === null ? 0 : b.mode === 'current' ? b.amount - move : b.amount;
      if (!Number.isSafeInteger(startingBalance)) {
        st.errors.push({ code: 'A4', message: M.A4 });
        st.ref = null;
      } else planAccounts.push({ key: st.key, name: cleanName(st.mapping.name), currency: st.currency!, startingBalance, openedAt: first ?? today });
    }
    cards.push(card);
  }

  // ——— W8: этот файл уже импортирован и не отменён
  const prior = db
    .select({ createdAt: imports.createdAt, userName: users.name })
    .from(imports)
    .innerJoin(users, eq(users.id, imports.userId))
    .where(and(eq(imports.companyId, companyId), eq(imports.fileSha256, src.file.sha256), eq(imports.status, 'done')))
    .orderBy(desc(imports.id))
    .get();
  if (prior) issues.push({ code: 'W8', message: M.W8(formatDateTime(prior.createdAt, timezone), prior.userName), row: 0 });

  const rowErrors = issues.filter(isRowError);
  const accountErrors = [...states.values()].reduce((s, st) => s + st.errors.length, 0);
  const planRows: PlannedRow[] = added
    .filter((x) => x.acc.ref && (!x.to || x.to.ref))
    .sort((p, q) => (p.src.paidAt < q.src.paidAt ? -1 : p.src.paidAt > q.src.paidAt ? 1 : p.src.row - q.src.row))
    .map((x) => ({
      row: x.src.row,
      type: x.src.type,
      paidAt: x.src.paidAt,
      // у перевода нет даты начисления (§4.3); парсер её уже не переносит
      accrualDate: x.src.accrualDate,
      account: x.acc.ref!,
      toAccount: x.to ? x.to.ref : null,
      amount: x.amount,
      toAmount: x.toAmount,
      baseAmount: x.baseAmount,
      rate: x.rate,
      category: x.m.category,
      counterparty: x.m.counterparty,
      project: x.m.project,
      tags: x.m.tags,
      comment: x.src.comment,
    }));
  const dates = added.map((x) => x.src.date).sort();
  const items = <T>(list: T[], map: (x: T) => ImportCreateItem) => ({ total: list.length, items: list.slice(0, CREATE_ITEMS_MAX).map(map) });
  const byType = (t: ImportType) => src.parsed.rows.filter((r) => r.type === t).length;

  const preview: ImportPreview = {
    token: src.token,
    file: { name: src.file.name, size: src.file.size, rows: src.parsed.total },
    counts: {
      income: byType('income'),
      expense: byType('expense'),
      transfer: byType('transfer'),
      add: added.length,
      duplicates: duplicates.length,
      skippedFuture: src.parsed.future.length,
    },
    period: dates.length ? { from: dates[0]!, to: dates[dates.length - 1]! } : null,
    accounts: cards,
    // при ошибках списки могут включать элементы строк с ошибками; когда импорт возможен, они точные
    create: {
      categories: items(matched.categories, (c) => ({ name: c.name, kind: c.kind, ...(c.parentName ? { parent: c.parentName } : {}), rows: c.rows })),
      counterparties: items(matched.counterparties, (c) => ({ name: c.name, type: c.type, rows: c.rows })),
      projects: items(matched.projects, (p) => ({ name: p.name, rows: p.rows })),
      tags: items(matched.tags, (t) => ({ name: t.name, rows: t.rows })),
    },
    errors: { total: rowErrors.length, byCode: groupIssues(rowErrors) },
    warnings: groupIssues(issues.filter((i) => !isRowError(i))),
    duplicates: { count: duplicates.length, rows: duplicates.slice(0, ISSUE_ROWS_MAX) },
    canImport: rowErrors.length === 0 && accountErrors === 0 && added.length > 0,
  };
  return {
    preview,
    plan: {
      rows: planRows,
      accounts: planAccounts,
      accountChanges,
      categories: matched.categories,
      counterparties: matched.counterparties,
      projects: matched.projects,
      tags: matched.tags,
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/import-preview.test.ts`
Expected: PASS, 6 тестов.

Run: `npm test` и `npm run typecheck`
Expected: 912 пройдено и 1 пропущен; typecheck без ошибок.

- [ ] **Step 5: Commit**

```bash
git add src/shared/schemas/imports.ts src/server/modules/imports/preview.ts tests/server/import-preview.test.ts
git commit -m "feat: импорт — предпросмотр: счета, суммы и курсы, дубликаты, движение и остатки" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Маршруты, кэш, писатель XLSX и шаблон (§5.2, §6.2, §6.3, §8.2, §9)

**Files:**
- Modify: `src/server/http/xlsx.ts` (целиком), `src/server/http/params.ts`, `src/server/modules/attachments/routes.ts`, `src/server/errors.ts`, `src/server/app.ts`
- Create: `src/server/modules/imports/cache.ts`, `src/server/modules/imports/template.ts`, `src/server/modules/imports/service.ts`, `src/server/modules/imports/routes.ts`
- Test: `tests/server/xlsx-writer.test.ts`, `tests/server/import-cache.test.ts`, `tests/server/imports-api.test.ts`

**Interfaces:**
- Consumes: всё из задач 1–6; `excelDate` (`src/server/modules/operations/journal-export.ts`); `contentDisposition`; `parseId`; `readSessionToken`; `XLSX_MIME`; `seedUser`, `loginAs`, `ORIGIN_HEADERS` (`tests/helpers/test-app.ts`).
- Produces:
  - `xlsx.ts`: `interface XlsxOptions { strings?: 'inline' | 'shared' }`; `buildXlsx(book: XlsxSheet | XlsxSheet[], opts?: XlsxOptions): Buffer` — прежний вызов `buildXlsx(sheet)` даёт тот же файл;
  - `params.ts`: `headerFileName(value: unknown): string`;
  - `cache.ts`: `interface CachedImport { companyId; userId; file; parsed }`; `interface ImportCache { put; get; remove; size }`; `IMPORT_CACHE_TTL_MS`; `IMPORT_CACHE_MAX`; `createImportCache(opts?: { now?; ttlMs?; max? })`;
  - `template.ts`: `TEMPLATE_FILE_NAME = 'Шаблон импорта.xlsx'`; `TEMPLATE_RULES`; `templateSheets(): XlsxSheet[]`; `buildTemplate(): Buffer`;
  - `service.ts`: `interface ImportsService { upload(companyId, userId, { name, data }): ImportPreview; preview(companyId, userId, body: ImportRequest): ImportPreview; template(): { fileName; data } }`; `importExpired()`; `createImportsService({ db, rates, timezone, now?, cache? })`;
  - `routes.ts`: `registerImportsRoutes(app, { imports })`:
    - `POST /api/v1/companies/:cid/imports/upload` (octet-stream, `X-File-Name`, 30 МБ) → 200 `ImportPreview`;
    - `POST /api/v1/companies/:cid/imports/preview` → 200 `ImportPreview`;
    - `GET /api/v1/imports/template.xlsx`.

- [ ] **Step 1: Write the failing tests**

Создайте `tests/server/xlsx-writer.test.ts`:

```ts
import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';
import { buildXlsx, type XlsxSheet } from '../../src/server/http/xlsx';
import { readXlsx } from '../../src/server/modules/imports/xlsx-read';

const part = (zip: AdmZip, name: string) => zip.getEntry(name)!.getData().toString('utf8');

const SHEETS: XlsxSheet[] = [
  {
    name: 'Шаблон',
    columns: [
      { header: 'Дата платежа*', width: 10 },
      { header: 'Комментарий', width: 30 },
    ],
    rows: [
      [{ kind: 'datetime', value: 46300.5 }, { kind: 'text', value: '=SUM(A1)' }],
      [null, { kind: 'text', value: 'Комментарий' }],
    ],
  },
  { name: 'Инструкция', columns: [{ header: 'Правила', width: 80 }], rows: [[{ kind: 'text', value: '1. Импортируется только первый лист' }]] },
];

describe('писатель XLSX: несколько листов и общие строки (§8.2 спецификации импорта)', () => {
  it('листы по порядку: части пакета, связи, типы; общие строки — без повторов, count и uniqueCount', () => {
    const zip = new AdmZip(buildXlsx(SHEETS, { strings: 'shared' }));
    expect(zip.getEntries().map((e) => e.entryName).sort()).toEqual(
      [
        '[Content_Types].xml',
        '_rels/.rels',
        'xl/_rels/workbook.xml.rels',
        'xl/sharedStrings.xml',
        'xl/styles.xml',
        'xl/workbook.xml',
        'xl/worksheets/sheet1.xml',
        'xl/worksheets/sheet2.xml',
      ].sort(),
    );
    expect(part(zip, 'xl/workbook.xml')).toContain('<sheets><sheet name="Шаблон" sheetId="1" r:id="rId1"/><sheet name="Инструкция" sheetId="2" r:id="rId2"/></sheets>');
    const rels = part(zip, 'xl/_rels/workbook.xml.rels');
    expect(rels).toContain('Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"');
    expect(rels).toContain('Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"');
    expect(rels).toContain('Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"');
    const types = part(zip, '[Content_Types].xml');
    expect(types).toContain('<Override PartName="/xl/worksheets/sheet2.xml"');
    expect(types).toContain('<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>');
    // «Комментарий» — заголовок и ячейка: одна общая строка на две ссылки
    expect(part(zip, 'xl/sharedStrings.xml')).toContain('count="6" uniqueCount="5"');
    const sheet1 = part(zip, 'xl/worksheets/sheet1.xml');
    expect(sheet1).toContain('<c r="A1" t="s" s="1"><v>0</v></c><c r="B1" t="s" s="1"><v>1</v></c>');
    expect(sheet1).toContain('<c r="B3" t="s"><v>1</v></c>');
    expect(sheet1).not.toContain('inlineStr');
  });

  it('текст, похожий на формулу, — quotePrefix и в общих строках; формул нет', () => {
    const zip = new AdmZip(buildXlsx(SHEETS, { strings: 'shared' }));
    const sheet1 = part(zip, 'xl/worksheets/sheet1.xml');
    expect(sheet1).toContain('<c r="B2" t="s" s="7"><v>2</v></c>');
    expect(sheet1).not.toContain('<f>');
    expect(part(zip, 'xl/sharedStrings.xml')).toContain('<si><t xml:space="preserve">=SUM(A1)</t></si>');
  });

  it('книга читается нашим читателем: первый лист — первый в книге; inline по умолчанию; пустая книга — ошибка', () => {
    const data = readXlsx(buildXlsx(SHEETS, { strings: 'shared' }));
    expect(data.rows.map((r) => [r.row, [...r.cells.values()].map((c) => c.value)])).toEqual([
      [1, ['Дата платежа*', 'Комментарий']],
      [2, ['46300.5', '=SUM(A1)']],
      [3, ['Комментарий']],
    ]);
    const inline = new AdmZip(buildXlsx(SHEETS));
    expect(inline.getEntry('xl/sharedStrings.xml')).toBeNull();
    expect(part(inline, 'xl/worksheets/sheet2.xml')).toContain('t="inlineStr"');
    expect(() => buildXlsx([])).toThrow('В книге нужен хотя бы один лист');
  });
});
```

Создайте `tests/server/import-cache.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createImportCache, type CachedImport } from '../../src/server/modules/imports/cache';

const item = (companyId: number, userId: number, name = 'f.xlsx'): CachedImport => ({
  companyId,
  userId,
  file: { name, size: 1, sha256: 'x' },
  parsed: { headerRow: 1, total: 0, rows: [], future: [], issues: [] },
});

describe('кэш проверки (§6.3 спецификации импорта)', () => {
  it('токен — 128 бит; файл только своей компании и своего пользователя; remove удаляет', () => {
    const cache = createImportCache();
    const t = cache.put(item(1, 1));
    expect(t).toMatch(/^[0-9a-f]{32}$/);
    expect(cache.put(item(1, 2))).not.toBe(t);
    expect(cache.get(t, 1, 1)!.file.name).toBe('f.xlsx');
    expect(cache.get(t, 2, 1)).toBeNull();
    expect(cache.get(t, 1, 2)).toBeNull();
    expect(cache.get('нет', 1, 1)).toBeNull();
    cache.remove(t);
    expect(cache.get(t, 1, 1)).toBeNull();
  });

  it('срок — 30 минут с последнего обращения', () => {
    let clock = 0;
    const cache = createImportCache({ now: () => clock });
    const t = cache.put(item(1, 1));
    clock = 29 * 60_000;
    expect(cache.get(t, 1, 1)).not.toBeNull(); // обращение продлевает срок
    clock += 30 * 60_000;
    expect(cache.get(t, 1, 1)).not.toBeNull();
    clock += 30 * 60_000 + 1;
    expect(cache.get(t, 1, 1)).toBeNull();
    expect(cache.size()).toBe(0);
  });

  it('новая загрузка того же пользователя в ту же компанию заменяет прежнюю; больше 3 файлов — вытесняется самый давний', () => {
    let clock = 0;
    const cache = createImportCache({ now: () => clock++ });
    const first = cache.put(item(1, 1, 'старый'));
    const again = cache.put(item(1, 1, 'новый'));
    expect(cache.get(first, 1, 1)).toBeNull();
    expect(cache.get(again, 1, 1)!.file.name).toBe('новый');
    const b = cache.put(item(2, 1));
    const c = cache.put(item(3, 1));
    cache.get(again, 1, 1); // «новый» — свежий, самый давний теперь b
    const d = cache.put(item(4, 1));
    expect(cache.size()).toBe(3);
    expect(cache.get(b, 2, 1)).toBeNull();
    expect([again, c, d].map((t, i) => cache.get(t, [1, 3, 4][i]!, 1) !== null)).toEqual([true, true, true]);
  });
});
```

Создайте `tests/server/imports-api.test.ts`:

```ts
import AdmZip from 'adm-zip';
import { afterEach, describe, expect, it } from 'vitest';
import { buildXlsx } from '../../src/server/http/xlsx';
import { parseSheet } from '../../src/server/modules/imports/parse-row';
import { templateSheets } from '../../src/server/modules/imports/template';
import { readXlsx } from '../../src/server/modules/imports/xlsx-read';
import { FINMAP_COLUMNS } from '../../src/shared/finmap-format';
import type { ImportPreview } from '../../src/shared/schemas/imports';
import { excelSerial as at, finmapLikeRow as fr, finmapLikeXlsx } from '../helpers/finmap-like';
import { opsWorld, type OpsWorld } from '../helpers/ops';
import { loginAs, ORIGIN_HEADERS, seedUser } from '../helpers/test-app';
import { buildZip } from '../helpers/zip-build';

let w: OpsWorld;
afterEach(async () => w?.h.t.cleanup());

const MB = 1024 * 1024;
const uploadUrl = (cid = w.cid) => `/api/v1/companies/${cid}/imports/upload`;
const previewUrl = (cid = w.cid) => `/api/v1/companies/${cid}/imports/preview`;

/** Загрузка файла телом запроса, как у вложений: octet-stream и имя в X-File-Name. */
function upload(data: Buffer, name = 'выгрузка.xlsx', cookie: string | null = w.h.cookie, url = uploadUrl()) {
  return w.h.t.app.inject({
    method: 'POST',
    url,
    headers: { ...ORIGIN_HEADERS, ...(cookie ? { cookie } : {}), 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name) },
    payload: data,
  });
}

const SAMPLE = [
  fr({ paidAt: at('2026-10-03', '22:07:00'), amount: 10596, to: 'Касса', category: 'Бар' }),
  fr({ paidAt: at('2026-10-04', '09:15:00'), amount: 500, from: 'Касса', to: 'Банк-2' }),
];

describe('POST …/imports/upload и …/imports/preview (§6.2, §6.3 спецификации импорта)', () => {
  it('загрузка → предпросмотр с токеном; пересчёт по кэшу с другим сопоставлением; ничего не записано', async () => {
    w = await opsWorld();
    const before = w.h.t.sqlite.prepare('SELECT (SELECT COUNT(*) FROM operations) + (SELECT COUNT(*) FROM accounts) + (SELECT COUNT(*) FROM categories) n').get();
    const res = await upload(finmapLikeXlsx(SAMPLE));
    expect(res.statusCode, res.body).toBe(200);
    const p = res.json() as ImportPreview;
    expect(p.token).toMatch(/^[0-9a-f]{32}$/);
    expect(p.file).toEqual({ name: 'выгрузка.xlsx', size: finmapLikeXlsx(SAMPLE).length, rows: 2 });
    expect(p.counts).toMatchObject({ income: 1, transfer: 1, add: 2 });
    expect(p.accounts.map((a) => [a.key, a.mapping?.kind])).toEqual([
      ['касса', 'existing'],
      ['банк-2', 'new'],
    ]);
    expect(p.canImport).toBe(true);

    const again = await w.h.req('POST', previewUrl(), {
      token: p.token,
      accounts: [{ key: 'банк-2', kind: 'new', name: 'Банк 2', currency: 'USD', balance: { mode: 'start', amount: 0 } }],
    });
    expect(again.statusCode, again.body).toBe(200);
    const q = again.json() as ImportPreview;
    expect(q.token).toBe(p.token);
    expect(q.accounts[1]).toMatchObject({ currency: 'USD', mapping: { name: 'Банк 2', currency: 'USD' } });
    expect(w.h.t.sqlite.prepare('SELECT (SELECT COUNT(*) FROM operations) + (SELECT COUNT(*) FROM accounts) + (SELECT COUNT(*) FROM categories) n').get()).toEqual(before);
  });

  it('CSV в UTF-8 с «;»; ошибки файла — 400 IMPORT_FILE с кодом и текстом', async () => {
    w = await opsWorld();
    const csv = Buffer.from('Дата платежа*;Сумма в валюте счета*;На счет*\n05.10.2026 10:00;1 500,50;Касса\n', 'utf8');
    const ok = await upload(csv, 'выгрузка.csv');
    expect(ok.statusCode, ok.body).toBe(200);
    expect((ok.json() as ImportPreview).accounts[0]!.movement).toBe(150050);

    const fileErr = async (data: Buffer, name: string) => {
      const res = await upload(data, name);
      expect(res.statusCode, res.body).toBe(400);
      const e = res.json().error;
      expect(e.code).toBe('IMPORT_FILE');
      return `${e.details.fileCode}: ${e.message}`;
    };
    expect(await fileErr(Buffer.alloc(0), 'пусто.csv')).toBe('F1: Файл пустой');
    expect(await fileErr(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0]), 'старый.xls')).toBe('F2: Старый формат .xls — сохраните файл как .xlsx');
    expect(await fileErr(Buffer.from('%PDF-1.4'), 'отчёт.pdf')).toBe('F2: Нужен файл .xlsx или .csv');
    // zip-бомба: лист объявлен маленьким, распаковывается в 70 МБ — распаковка прервана (Review Focus)
    const bomb = buildZip([
      { name: 'xl/workbook.xml', data: '<workbook xmlns:r="r"><sheets><sheet name="Л" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: 'xl/worksheets/sheet1.xml', data: Buffer.alloc(70 * MB, 0x20), declaredSize: 1000 },
    ]);
    expect(await fileErr(bomb, 'бомба.xlsx')).toBe('F3: Файл повреждён или небезопасен: часть «xl/worksheets/sheet1.xml» распаковывается больше объявленного размера');
    const xxe = buildZip([
      { name: 'xl/workbook.xml', data: '<workbook xmlns:r="r"><sheets><sheet name="Л" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: 'xl/worksheets/sheet1.xml', data: '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>&e;</t></is></c></row></sheetData></worksheet>' },
    ]);
    expect(await fileErr(xxe, 'xxe.xlsx')).toBe('F3: Файл повреждён или небезопасен: объявления DOCTYPE и ENTITY запрещены');
    expect(await fileErr(buildZip([{ name: '../evil.xml', data: 'x' }]), 'slip.xlsx')).toBe('F3: Файл повреждён или небезопасен: недопустимое имя записи в архиве');
    expect(await fileErr(finmapLikeXlsx([], {}), 'пустой.xlsx')).toBe('F7: В файле нет операций');
  });

  it('пределы загрузки: больше 30 МБ — 413 «Файл больше 30 МБ»; без сессии — 401 до чтения тела; без X-Requested-With — 403; не файл — 400', async () => {
    w = await opsWorld();
    const big = await upload(Buffer.concat([finmapLikeXlsx(SAMPLE), Buffer.alloc(30 * MB)]));
    expect(big.statusCode).toBe(413);
    expect(big.json().error).toEqual({ code: 'TOO_LARGE', message: 'Файл больше 30 МБ' });
    expect((await upload(finmapLikeXlsx(SAMPLE), 'x.xlsx', null)).statusCode).toBe(401);
    expect((await upload(finmapLikeXlsx(SAMPLE), 'x.xlsx', 'sid=forged')).statusCode).toBe(401);
    const csrf = await w.h.t.app.inject({
      method: 'POST',
      url: uploadUrl(),
      headers: { origin: 'http://localhost:3000', cookie: w.h.cookie, 'content-type': 'application/octet-stream' },
      payload: finmapLikeXlsx(SAMPLE),
    });
    expect(csrf.statusCode).toBe(403);
    expect((await w.h.req('POST', uploadUrl(), { not: 'a file' })).json().error.fields).toEqual({ file: 'Нет файла' });
    // лимит 30 МБ и парсер байтов — только у загрузки: preview принимает JSON с общим лимитом
    const elsewhere = await w.h.t.app.inject({
      method: 'POST',
      url: previewUrl(),
      headers: { ...ORIGIN_HEADERS, cookie: w.h.cookie, 'content-type': 'application/octet-stream' },
      payload: Buffer.alloc(16),
    });
    expect(elsewhere.statusCode).toBe(415);
  });

  it('токен: неизвестный, чужой компании или чужого пользователя — 410; архивная компания — 422 на обоих маршрутах; чужая — 404', async () => {
    w = await opsWorld();
    const p = (await upload(finmapLikeXlsx(SAMPLE))).json() as ImportPreview;
    const expired = await w.h.req('POST', previewUrl(), { token: '0'.repeat(32), accounts: [] });
    expect(expired.statusCode).toBe(410);
    expect(expired.json().error).toEqual({ code: 'IMPORT_EXPIRED', message: 'Проверка устарела — загрузите файл заново' });
    const other = await w.h.company('Другая');
    expect((await w.h.req('POST', previewUrl(other), { token: p.token, accounts: [] })).statusCode).toBe(410);

    await seedUser(w.h.t, 'second', 'second-password-1');
    const cookie2 = await loginAs(w.h.t, 'second', 'second-password-1');
    const asSecond = await w.h.t.app.inject({ method: 'POST', url: previewUrl(), headers: { ...ORIGIN_HEADERS, cookie: cookie2 }, payload: { token: p.token, accounts: [] } });
    expect(asSecond.statusCode).toBe(410);
    expect((await w.h.req('POST', previewUrl(), { token: p.token, accounts: [] })).statusCode).toBe(200);
    expect((await w.h.req('POST', previewUrl(), { token: 'плохой', accounts: [] })).statusCode).toBe(400);

    expect((await w.h.req('POST', `/api/v1/companies/${other}/archive`, {})).statusCode).toBe(200);
    const archived = await upload(finmapLikeXlsx(SAMPLE), 'x.xlsx', w.h.cookie, uploadUrl(other));
    expect(archived.statusCode).toBe(422);
    expect(archived.json().error.code).toBe('ARCHIVED_REFERENCE');
    expect((await w.h.req('POST', previewUrl(other), { token: p.token, accounts: [] })).json().error.code).toBe('ARCHIVED_REFERENCE');
    expect((await upload(finmapLikeXlsx(SAMPLE), 'x.xlsx', w.h.cookie, uploadUrl(999_999))).statusCode).toBe(404);
  });
});

describe('GET /api/v1/imports/template.xlsx (§5.2)', () => {
  it('шаблон: «Шаблон» — заголовки A–P со звёздочками, общие строки; «Инструкция» — три примера, которые проходят разбор', async () => {
    w = await opsWorld();
    const res = await w.h.req('GET', '/api/v1/imports/template.xlsx');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers['content-disposition']).toContain(encodeURIComponent('Шаблон импорта.xlsx'));
    expect(res.headers['cache-control']).toBe('private, no-store');
    const zip = new AdmZip(res.rawPayload);
    expect(zip.getEntry('xl/sharedStrings.xml')).not.toBeNull();
    expect(zip.getEntry('xl/workbook.xml')!.getData().toString('utf8')).toContain('<sheet name="Шаблон" sheetId="1" r:id="rId1"/><sheet name="Инструкция" sheetId="2" r:id="rId2"/>');
    const first = readXlsx(res.rawPayload);
    expect(first.rows).toHaveLength(1);
    expect([...first.rows[0]!.cells.values()].map((c) => c.value)).toEqual(FINMAP_COLUMNS.map((c) => c.header));

    // примеры «Инструкции» (строки 2–4 под заголовками, правила — ниже) — доход, расход, перевод — проходят разбор без ошибок
    const instruction = readXlsx(buildXlsx(templateSheets()[1]!));
    expect(instruction.rows.length).toBeGreaterThan(10);
    const examples = { ...instruction, rows: instruction.rows.filter((r) => r.row <= 4) };
    const parsed = parseSheet(examples, { timezone: 'Asia/Almaty', baseCurrency: 'KZT', today: '2026-10-12', date1904: false });
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows.map((r) => [r.type, r.amount, r.account.name, r.toAccount?.name ?? null])).toEqual([
      ['income', '15000', 'Касса', null],
      ['expense', '8500.5', 'Касса', null],
      ['transfer', '50000', 'Касса', 'Банк'],
    ]);
    expect((await w.h.t.app.inject({ method: 'GET', url: '/api/v1/imports/template.xlsx' })).statusCode).toBe(401);
  });
});

describe('большой файл (Review Focus 5)', () => {
  it('16 000 строк «как у Finmap»: загрузка и пересчёт без квадратичных проходов; ответ меньше 200 КБ', { timeout: 60_000 }, async () => {
    w = await opsWorld();
    const rows = Array.from({ length: 16_000 }, (_, i) => {
      const day = new Date(Date.UTC(2023, 2, 15) + Math.floor(i / 14) * 86_400_000).toISOString().slice(0, 10);
      const income = i % 3 !== 0;
      return fr({
        paidAt: at(day, `${String(8 + (i % 12)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00`),
        amount: 1000 + (i % 977) + 0.5,
        baseAmount: 1000 + (i % 977) + 0.5,
        ...(income ? { to: i % 2 ? 'Касса-1' : 'Банк-2' } : { from: 'Касса-1' }),
        category: income ? `Доход ${i % 15}` : i % 4 ? 'Зарплата' : `Расход ${i % 22}`,
        counterparty: `Контрагент ${i % 86}`,
        tags: i % 50 ? null : 'Смена',
        comment: i % 7 ? null : `Комментарий ${i}`,
      });
    });
    const t0 = performance.now();
    const res = await upload(finmapLikeXlsx(rows), 'большой.xlsx');
    const t1 = performance.now();
    expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
    const p = res.json() as ImportPreview;
    expect(p.counts).toMatchObject({ add: 16_000, duplicates: 0 });
    expect(p.create.counterparties.total).toBe(86);
    expect(res.body.length).toBeLessThan(200 * 1024);
    const again = await w.h.req('POST', previewUrl(), { token: p.token, accounts: [] });
    const t2 = performance.now();
    expect(again.statusCode).toBe(200);
    // бюджет §10 — 3 с и 1 с на эталонной машине; здесь — с запасом для медленного CI
    expect(t1 - t0).toBeLessThan(15_000);
    expect(t2 - t1).toBeLessThan(5_000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/xlsx-writer.test.ts tests/server/import-cache.test.ts tests/server/imports-api.test.ts`
Expected: FAIL — `buildXlsx([])` и `{ strings: 'shared' }` не поддержаны, модули `imports/cache`, `imports/template` не найдены, маршрутов импорта нет (404).

- [ ] **Step 3: XLSX writer — several sheets and shared strings**

Замените содержимое `src/server/http/xlsx.ts` целиком. Прежние части файла не меняются: стили, `xmlText`, `columnName`, `FORMULA_START`, `numberStyle`. Новое: `XlsxOptions`, `contentTypes`, `workbookRels`, `SharedStrings`, параметр `shared` у `cellXml`/`sheetXml` и `buildXlsx(book, opts)`.

```ts
import AdmZip from 'adm-zip';

/**
 * Ячейка листа:
 * - text — строка (inline или из таблицы общих строк — XlsxOptions.strings; формулой не считается);
 * - number — десятичная запись без экспоненты («-1500.50») и число знаков после запятой для формата;
 * - datetime / date — дата Excel: дни от 30.12.1899, у datetime — с долей суток.
 */
export type XlsxCell =
  | { kind: 'text'; value: string }
  | { kind: 'number'; value: string; decimals: number }
  | { kind: 'datetime'; value: number }
  | { kind: 'date'; value: number }
  | null;

export interface XlsxSheet {
  /** Имя листа: до 31 символа, без []:*?/\. */
  name: string;
  columns: { header: string; width: number }[];
  rows: XlsxCell[][];
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface XlsxOptions {
  /**
   * Тексты: inline (по умолчанию) или таблица общих строк xl/sharedStrings.xml — её понимает любой читатель XLSX
   * (§8.2 спецификации импорта).
   */
  strings?: 'inline' | 'shared';
}

/** Индексы стилей в cellXfs (styles.xml ниже). */
const STYLE = { header: 1, datetime: 2, date: 3, int: 4, dec2: 5, dec3: 6, quoted: 7 } as const;

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
/** Типы частей пакета: книга, листы sheet1..N, стили и (если есть) общие строки. */
function contentTypes(sheets: number, shared: boolean): string {
  const parts = [
    `<Override PartName="/xl/workbook.xml" ContentType="${CT}.sheet.main+xml"/>`,
    ...Array.from({ length: sheets }, (_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${CT}.worksheet+xml"/>`),
    `<Override PartName="/xl/styles.xml" ContentType="${CT}.styles+xml"/>`,
    ...(shared ? [`<Override PartName="/xl/sharedStrings.xml" ContentType="${CT}.sharedStrings+xml"/>`] : []),
  ];
  return `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${parts.join('')}</Types>`;
}
const ROOT_RELS = `<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
/** Связи книги: листы rId1..rIdN, стили rId(N+1), общие строки rId(N+2). */
function workbookRels(sheets: number, shared: boolean): string {
  const rels = [
    ...Array.from({ length: sheets }, (_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`),
    `<Relationship Id="rId${sheets + 1}" Type="${NS_REL}/styles" Target="styles.xml"/>`,
    ...(shared ? [`<Relationship Id="rId${sheets + 2}" Type="${NS_REL}/sharedStrings" Target="sharedStrings.xml"/>`] : []),
  ];
  return `<Relationships xmlns="${NS_PKG_REL}">${rels.join('')}</Relationships>`;
}
// 164 — дата и время, 165 — дата, 166 — три знака после запятой; 3 и 4 — встроенные «# ##0» и «# ##0,00»;
// последний xf — quotePrefix: Excel показывает текст как есть и не превращает его в формулу при правке ячейки
const STYLES = `<styleSheet xmlns="${NS_MAIN}"><numFmts count="3"><numFmt numFmtId="164" formatCode="dd.mm.yyyy hh:mm"/><numFmt numFmtId="165" formatCode="dd.mm.yyyy"/><numFmt numFmtId="166" formatCode="#,##0.000"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" quotePrefix="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/** Символы, недопустимые в XML 1.0: управляющие (кроме табуляции и переводов строки), одиночные суррогаты, U+FFFE и U+FFFF. */
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Текст без символов, недопустимых в XML. */
const clean = (s: string) => s.replace(INVALID_XML, '');

/** Текст для XML: недопустимые символы удаляются, & < > " экранируются, CR — ссылкой (иначе парсер превратит его в LF). */
export function xmlText(s: string): string {
  return clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r/g, '&#13;');
}

/** Номер столбца с нуля → буквы Excel: 0 → A, 25 → Z, 26 → AA. */
export function columnName(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Начало текста, которое Excel и LibreOffice при правке или импорте принимают за формулу. */
const FORMULA_START = /^[=+\-@\t\r]/;

function numberStyle(decimals: number): number {
  if (decimals === 0) return STYLE.int;
  if (decimals === 2) return STYLE.dec2;
  if (decimals === 3) return STYLE.dec3;
  throw new Error(`Неподдерживаемое число знаков после запятой: ${decimals}`);
}

/** Таблица общих строк: индекс по первому появлению; count — число ссылок, uniqueCount — строк. */
class SharedStrings {
  private readonly index = new Map<string, number>();
  readonly list: string[] = [];
  count = 0;

  ref(text: string): number {
    this.count++;
    let i = this.index.get(text);
    if (i === undefined) {
      i = this.list.length;
      this.index.set(text, i);
      this.list.push(text);
    }
    return i;
  }

  xml(): string {
    const items = this.list.map((t) => `<si><t xml:space="preserve">${xmlText(t)}</t></si>`).join('');
    return `<sst xmlns="${NS_MAIN}" count="${this.count}" uniqueCount="${this.list.length}">${items}</sst>`;
  }
}

function cellXml(ref: string, cell: XlsxCell, shared: SharedStrings | null, style?: number): string {
  if (cell === null) return '';
  switch (cell.kind) {
    case 'text': {
      // формул в листе нет (<f> не пишется); текст, похожий на формулу, — со стилем quotePrefix (и в общих строках)
      const s = style ?? (FORMULA_START.test(clean(cell.value)) ? STYLE.quoted : 0);
      const attr = s ? ` s="${s}"` : '';
      if (shared) return `<c r="${ref}" t="s"${attr}><v>${shared.ref(clean(cell.value))}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${attr}><is><t xml:space="preserve">${xmlText(cell.value)}</t></is></c>`;
    }
    case 'number':
      return `<c r="${ref}" s="${numberStyle(cell.decimals)}"><v>${cell.value}</v></c>`;
    case 'datetime':
      return `<c r="${ref}" s="${STYLE.datetime}"><v>${cell.value}</v></c>`;
    case 'date':
      return `<c r="${ref}" s="${STYLE.date}"><v>${cell.value}</v></c>`;
  }
}

function sheetXml(sheet: XlsxSheet, shared: SharedStrings | null): string {
  const cols = sheet.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`).join('');
  const header = `<row r="1">${sheet.columns.map((c, i) => cellXml(`${columnName(i)}1`, { kind: 'text', value: c.header }, shared, STYLE.header)).join('')}</row>`;
  const body = sheet.rows.map((row, r) => `<row r="${r + 2}">${row.map((cell, i) => cellXml(`${columnName(i)}${r + 2}`, cell, shared)).join('')}</row>`);
  // строка заголовков закреплена
  return `<worksheet xmlns="${NS_MAIN}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${header}${body.join('')}</sheetData></worksheet>`;
}

/**
 * Минимальная книга XLSX (ECMA-376): один или несколько листов по порядку; строки — inline или общими строками,
 * числа и даты — с форматом. Первый лист — первый в книге (его импортирует Finmap и наш импорт).
 */
export function buildXlsx(book: XlsxSheet | XlsxSheet[], opts: XlsxOptions = {}): Buffer {
  const sheets = Array.isArray(book) ? book : [book];
  if (sheets.length === 0) throw new Error('В книге нужен хотя бы один лист');
  const shared = opts.strings === 'shared' ? new SharedStrings() : null;
  const zip = new AdmZip();
  const add = (name: string, xml: string) => zip.addFile(name, Buffer.from(HEAD + xml, 'utf8'));
  const list = sheets.map((sh, i) => `<sheet name="${xmlText(sh.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  add('[Content_Types].xml', contentTypes(sheets.length, shared !== null));
  add('_rels/.rels', ROOT_RELS);
  add('xl/workbook.xml', `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><bookViews><workbookView/></bookViews><sheets>${list}</sheets></workbook>`);
  add('xl/_rels/workbook.xml.rels', workbookRels(sheets.length, shared !== null));
  add('xl/styles.xml', STYLES);
  sheets.forEach((sh, i) => add(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sh, shared)));
  // общие строки собираются при записи листов, поэтому их часть — последней
  if (shared) add('xl/sharedStrings.xml', shared.xml());
  return zip.toBuffer();
}
```

Run: `npx vitest run tests/server/xlsx-writer.test.ts tests/server/journal-export.test.ts`
Expected: PASS — новая проверка писателя и прежняя выгрузка журнала (её файл не изменился).

- [ ] **Step 4: Cache, template, service, routes**

Создайте `src/server/modules/imports/cache.ts`:

```ts
import crypto from 'node:crypto';
import type { ParsedFile } from './parse-row';

/**
 * Кэш проверки (§6.3 спецификации импорта): разобранный файл в памяти процесса под случайным токеном (128 бит),
 * привязанным к компании и пользователю. Исходные байты не хранятся и на диск не пишутся.
 */
export interface CachedImport {
  companyId: number;
  userId: number;
  file: { name: string; size: number; sha256: string };
  parsed: ParsedFile;
}

export interface ImportCache {
  /** Новый токен. Прежний файл того же пользователя в той же компании удаляется; сверх предела вытесняется самый давний. */
  put(item: CachedImport): string;
  /** Файл по токену своей компании и своего пользователя; иначе или после срока — null. Обращение продлевает срок. */
  get(token: string, companyId: number, userId: number): CachedImport | null;
  remove(token: string): void;
  size(): number;
}

/** Срок — 30 минут с последнего обращения; не больше 3 файлов на сервер. */
export const IMPORT_CACHE_TTL_MS = 30 * 60_000;
export const IMPORT_CACHE_MAX = 3;

export function createImportCache(opts: { now?: () => number; ttlMs?: number; max?: number } = {}): ImportCache {
  const now = opts.now ?? Date.now;
  const ttl = opts.ttlMs ?? IMPORT_CACHE_TTL_MS;
  const max = opts.max ?? IMPORT_CACHE_MAX;
  const entries = new Map<string, CachedImport & { lastUsed: number }>();

  const sweep = () => {
    const t = now();
    for (const [token, e] of entries) if (t - e.lastUsed > ttl) entries.delete(token);
  };

  return {
    put(item) {
      sweep();
      for (const [token, e] of entries) if (e.companyId === item.companyId && e.userId === item.userId) entries.delete(token);
      while (entries.size >= max) {
        let oldest: string | null = null;
        for (const [token, e] of entries) if (oldest === null || e.lastUsed < entries.get(oldest)!.lastUsed) oldest = token;
        entries.delete(oldest!);
      }
      const token = crypto.randomBytes(16).toString('hex');
      entries.set(token, { ...item, lastUsed: now() });
      return token;
    },
    get(token, companyId, userId) {
      sweep();
      const e = entries.get(token);
      if (!e || e.companyId !== companyId || e.userId !== userId) return null;
      e.lastUsed = now();
      return e;
    },
    remove(token) {
      entries.delete(token);
    },
    size: () => entries.size,
  };
}
```

Создайте `src/server/modules/imports/template.ts`:

```ts
import { FINMAP_COLUMNS, type FinmapField } from '../../../shared/finmap-format';
import { buildXlsx, type XlsxCell, type XlsxSheet } from '../../http/xlsx';
import { excelDate } from '../operations/journal-export';

/** Шаблон импорта (§5.2 спецификации импорта): лист «Шаблон» — заголовки; «Инструкция» — примеры и правила. */
export const TEMPLATE_FILE_NAME = 'Шаблон импорта.xlsx';

/** Ширина колонок A–P. */
const WIDTH: Record<FinmapField, number> = {
  paidAt: 17,
  accrualDate: 16,
  periodFrom: 18,
  periodTo: 18,
  amount: 16,
  baseAmount: 16,
  fromAccount: 18,
  toAccount: 18,
  category: 20,
  subcategory: 20,
  counterparty: 22,
  subcounterparty: 20,
  project: 16,
  subproject: 16,
  tags: 16,
  comment: 30,
};

const COLUMNS = FINMAP_COLUMNS.map((c) => ({ header: c.header, width: WIDTH[c.field] }));

/** Строка A–P по полям; незаданные — пустые. */
function line(v: Partial<Record<FinmapField, XlsxCell>>): XlsxCell[] {
  return FINMAP_COLUMNS.map((c) => v[c.field] ?? null);
}
const text = (value: string): XlsxCell => ({ kind: 'text', value });
const at = (date: string, hours: number): XlsxCell => ({ kind: 'datetime', value: excelDate(date) + hours / 24 });
const money = (value: string): XlsxCell => ({ kind: 'number', value, decimals: 2 });

/** Правила §4 по-русски — под примерами, в колонке A. */
export const TEMPLATE_RULES: readonly string[] = [
  'Строки 2–4 — примеры: доход, расход и перевод. Этот лист не импортируется — заполняйте лист «Шаблон».',
  '1. Импортируется только первый лист. Строка заголовков — первая из строк 1–10, где есть «Дата платежа» и «Сумма в валюте счета».',
  '2. «Со счета» — для расхода, «На счет» — для дохода, обе колонки — перевод. Счёт, которого нет в компании, можно создать при импорте.',
  '3. Дата платежа — дата Excel или текст «дд.мм.гггг чч:мм». Строки с датой в будущем (плановые операции) пропускаются.',
  '4. Сумма в валюте счета — положительное число, копейки через точку или запятую; лишние знаки после запятой округляются.',
  '5. Сумма в валюте компании нужна счетам не в валюте компании; если пусто — берётся курс на дату платежа.',
  '6. Дата начисления или Период начисления (дата "с") — дата сделки; у перевода её нет.',
  '7. Новые категории, подкатегории, контрагенты, проекты и теги создаются автоматически. Теги — через запятую.',
  '8. Комментарий — до 2 000 символов.',
  '9. Если хоть одна строка с ошибкой, импорт не проходит: исправьте файл и загрузите его снова.',
];

/** Листы шаблона: «Шаблон» (только заголовки) и «Инструкция» (три примера и правила). */
export function templateSheets(): XlsxSheet[] {
  return [
    { name: 'Шаблон', columns: COLUMNS, rows: [] },
    {
      name: 'Инструкция',
      columns: COLUMNS,
      rows: [
        line({ paidAt: at('2026-10-05', 10), amount: money('15000.00'), toAccount: text('Касса'), category: text('Выручка'), counterparty: text('Клиент'), comment: text('Пример дохода') }),
        line({
          paidAt: at('2026-10-05', 12.5),
          accrualDate: { kind: 'date', value: excelDate('2026-10-01') },
          amount: money('8500.50'),
          fromAccount: text('Касса'),
          category: text('Зарплата'),
          subcategory: text('Администраторы'),
          counterparty: text('Сотрудник'),
          tags: text('Смена, Ночь'),
        }),
        line({ paidAt: at('2026-10-06', 9), amount: money('50000.00'), fromAccount: text('Касса'), toAccount: text('Банк'), comment: text('Инкассация') }),
        [],
        ...TEMPLATE_RULES.map((rule) => [text(rule)]),
      ],
    },
  ];
}

/** Книга шаблона: тексты — общими строками, как у выгрузки «Excel» (§8.2). */
export function buildTemplate(): Buffer {
  return buildXlsx(templateSheets(), { strings: 'shared' });
}
```

Создайте `src/server/modules/imports/service.ts`:

```ts
import crypto from 'node:crypto';
import { todayInTimezone } from '../../../shared/dates';
import type { ImportPreview, ImportRequest } from '../../../shared/schemas/imports';
import { cleanName } from '../../../shared/text';
import type { Db } from '../../db/client';
import { AppError } from '../../errors';
import { requireCompany } from '../companies/guard';
import type { RatesService } from '../rates/service';
import { createImportCache, type ImportCache } from './cache';
import { parseSheet } from './parse-row';
import { buildPreview } from './preview';
import { IMPORT_MAX_BYTES, readImportFile } from './read-file';
import { buildTemplate, TEMPLATE_FILE_NAME } from './template';

/** Импорт: проверка файла без записи (§5.2, §6.2 спецификации импорта). Запись и отмена — планы И-2 и И-3. */
export interface ImportsService {
  /** Разбор файла, кэш и предпросмотр по сопоставлению счетов по умолчанию. */
  upload(companyId: number, userId: number, file: { name: string; data: Buffer }): ImportPreview;
  /** Предпросмотр по кэшу с сопоставлением счетов из запроса; токена нет — 410 IMPORT_EXPIRED. */
  preview(companyId: number, userId: number, body: ImportRequest): ImportPreview;
  /** Шаблон импорта (§5.2). */
  template(): { fileName: string; data: Buffer };
}

export const importExpired = () => new AppError(410, 'IMPORT_EXPIRED', 'Проверка устарела — загрузите файл заново');

export function createImportsService(d: { db: Db; rates: RatesService; timezone: string; now?: () => Date; cache?: ImportCache }): ImportsService {
  const { db, timezone } = d;
  const now = d.now ?? (() => new Date());
  const cache = d.cache ?? createImportCache({ now: () => now().getTime() });
  const deps = { db, rates: d.rates, timezone, now };

  return {
    upload(companyId, userId, file) {
      // архивная компания — 422 до разбора файла
      const company = requireCompany(db, companyId, { writable: true });
      if (file.data.length > IMPORT_MAX_BYTES) throw new AppError(413, 'TOO_LARGE', 'Файл больше 30 МБ');
      const name = cleanName(file.name).slice(0, 200) || 'Файл';
      const sheet = readImportFile(file.data, name);
      const parsed = parseSheet(sheet, {
        timezone,
        baseCurrency: company.baseCurrency,
        today: todayInTimezone(timezone, now()),
        date1904: sheet.date1904,
      });
      const meta = { name, size: file.data.length, sha256: crypto.createHash('sha256').update(file.data).digest('hex') };
      const token = cache.put({ companyId, userId, file: meta, parsed });
      return buildPreview(deps, { token, companyId, file: meta, parsed }, []).preview;
    },

    preview(companyId, userId, body) {
      requireCompany(db, companyId, { writable: true });
      const entry = cache.get(body.token, companyId, userId);
      if (!entry) throw importExpired();
      return buildPreview(deps, { token: body.token, companyId, file: entry.file, parsed: entry.parsed }, body.accounts).preview;
    },

    template() {
      return { fileName: TEMPLATE_FILE_NAME, data: buildTemplate() };
    },
  };
}
```

Создайте `src/server/modules/imports/routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { importRequestSchema } from '../../../shared/schemas/imports';
import { AppError } from '../../errors';
import { contentDisposition } from '../../http/content-disposition';
import { headerFileName, parseId } from '../../http/params';
import { XLSX_MIME } from '../../http/xlsx';
import { readSessionToken } from '../auth/plugin';
import { IMPORT_MAX_BYTES } from './read-file';
import type { ImportsService } from './service';

type C = { Params: { cid: string } };
const BASE = '/api/v1/companies/:cid/imports';

export function registerImportsRoutes(app: FastifyInstance, deps: { imports: ImportsService }): void {
  const { imports } = deps;

  // отдельная область: парсер байтов и лимит 30 МБ действуют только на загрузку файла (§6.2)
  app.register(async (scope) => {
    scope.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: IMPORT_MAX_BYTES }, (_req, body, done) => done(null, body));
    // без куки сессии тело не читаем: полная проверка сеанса — как у всех маршрутов, в preHandler
    scope.addHook('onRequest', async (req) => {
      if (req.method === 'POST' && !readSessionToken(req)) throw new AppError(401, 'UNAUTHORIZED', 'Требуется вход');
    });

    scope.post<C>(`${BASE}/upload`, { bodyLimit: IMPORT_MAX_BYTES }, async (req) => {
      if (!Buffer.isBuffer(req.body)) throw new AppError(400, 'VALIDATION', 'Проверьте файл', { file: 'Нет файла' });
      return imports.upload(parseId(req.params.cid), req.user!.id, { name: headerFileName(req.headers['x-file-name']), data: req.body });
    });
  });

  app.post<C>(`${BASE}/preview`, async (req) => imports.preview(parseId(req.params.cid), req.user!.id, importRequestSchema.parse(req.body)));

  app.get('/api/v1/imports/template.xlsx', async (_req, reply) => {
    const { fileName, data } = imports.template();
    reply.header('Content-Type', XLSX_MIME);
    reply.header('Content-Disposition', contentDisposition(fileName));
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'private, no-store');
    return reply.send(data);
  });
}
```

- [ ] **Step 5: Wire up: file name header, 413, app**

1. В `src/server/http/params.ts` допишите в конец:

```ts
/** Имя файла из заголовка X-File-Name (URI-кодированное); битая кодировка — пустое имя. */
export function headerFileName(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}
```

2. В `src/server/modules/attachments/routes.ts`:
   - замените `import { parseId } from '../../http/params';` на `import { headerFileName, parseId } from '../../http/params';`;
   - удалите локальную функцию вместе с её комментарием:

```ts
/** Заголовок с URI-кодированным именем файла; битая кодировка — пустое имя (ошибка поля). */
function headerName(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}
```

   - замените `{ name: headerName(req.headers['x-file-name']), data: req.body },` на `{ name: headerFileName(req.headers['x-file-name']), data: req.body },`.

3. В `src/server/errors.ts` замените

```ts
    if (status === 413) {
      // лимит 10 МБ есть только у загрузки вложений; остальным маршрутам — общий лимит тела запроса
      const upload = req.routeOptions.url?.endsWith('/attachments') ?? false;
      return reply.status(413).send({ error: { code: 'TOO_LARGE', message: upload ? 'Файл больше 10 МБ' : 'Слишком большой запрос' } });
    }
```

на

```ts
    if (status === 413) {
      // свои лимиты — у загрузки вложений (10 МБ) и файла импорта (30 МБ); остальным маршрутам — общий лимит тела запроса
      const url = req.routeOptions.url ?? '';
      const message = url.endsWith('/attachments') ? 'Файл больше 10 МБ' : url.endsWith('/imports/upload') ? 'Файл больше 30 МБ' : 'Слишком большой запрос';
      return reply.status(413).send({ error: { code: 'TOO_LARGE', message } });
    }
```

4. В `src/server/app.ts`:
   - после строки `import { registerAttachmentsRoutes } from './modules/attachments/routes';` добавьте

```ts
import { registerImportsRoutes } from './modules/imports/routes';
import { createImportsService } from './modules/imports/service';
```

   - после строки `registerBalancesRoutes(app, { companies, ledger: balances, rates, timezone: config.timezone, now });` добавьте

```ts
  registerImportsRoutes(app, { imports: createImportsService({ db, rates, timezone: config.timezone, now }) });
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/server/xlsx-writer.test.ts tests/server/import-cache.test.ts tests/server/imports-api.test.ts tests/server/attachments.test.ts tests/server/journal-export.test.ts`
Expected: PASS (3, 3, 6 новых тестов; вложения и выгрузка журнала — без изменений).

Run: `npm test` и `npm run typecheck`
Expected: 924 пройдено и 1 пропущен; typecheck без ошибок.

Run: `npm run test:e2e`
Expected: 142 из 142 (интерфейс не менялся; проверка, что сервер с новыми маршрутами и писатель выгрузки работают). Известный нестабильный тест — `journal-actions.spec.ts:555`; если упал только он, перезапустите прогон.

Run: `npm run shots:ux`
Expected: 51 из 51. Экранов в И-1 нет, `scripts/ux-shots.ts` не меняется (решение 14).

- [ ] **Step 7: Commit**

```bash
git add src/server/http/xlsx.ts src/server/http/params.ts src/server/modules/attachments/routes.ts src/server/errors.ts src/server/app.ts src/server/modules/imports/cache.ts src/server/modules/imports/template.ts src/server/modules/imports/service.ts src/server/modules/imports/routes.ts tests/server/xlsx-writer.test.ts tests/server/import-cache.test.ts tests/server/imports-api.test.ts
git commit -m "feat: импорт — загрузка и проверка файла с кэшем, шаблон импорта, писатель XLSX с листами и общими строками" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## После плана

- Итоги и отложенные замечания — `docs/superpowers/followups/2026-10-12-import-1-followups.md` (пишет контролёр). В них:
  - время загрузки и пересчёта 16 000 строк на этой машине — из теста «большой файл» (`npx vitest run tests/server/imports-api.test.ts --reporter=verbose`);
  - раздел «В план И-2» — что запись берёт из `ImportPlan`: строки по `(paidAt, row)`; новые счета со `startingBalance` и `openedAt`; `accountChanges`; новые справочники (верхний уровень раньше подкатегорий, проекты — по шаблону `general`); удаление токена после записи (`cache.remove`).
- Экранов в И-1 нет, поэтому пар для визуальной сверки нет; снимки `c42`, `c42b`, `c42c`, `cm-import` — в плане И-2.
- Следующий шаг — план И-2 «Импорт: запись и панель» (§14).
