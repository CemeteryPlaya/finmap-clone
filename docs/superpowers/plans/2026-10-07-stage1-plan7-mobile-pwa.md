# Этап 1, план 7: мобильная версия и PWA — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** шаг 7 §11 спецификации — мобильная версия (§7 «Мобильная версия (ширина меньше 768px)») и PWA:
- журнал на телефоне — список карточек (сумма, статья, счёт, дата), касание открывает операцию в форме на весь экран;
- фильтры журнала — в панели, выезжающей справа; поиск остаётся на виду;
- счета и «Всего на счетах» выезжают слева по кнопке «Счета» в шапке;
- внизу закреплены кнопки «Доход», «Расход», «Перевод»; в шапке они остаются только на компьютере;
- формы на весь экран с рядом операторов калькулятора — это уже сделали планы 6a и 6b, здесь только отступы под вырез экрана;
- разделы настроек, форма операции и окно «Фильтр» на ширине 390 px без прокрутки вбок; Tab не уходит из модальных окон;
- архивная компания — только просмотр: форма операции открывается без возможности сохранить, кнопок новых операций нет;
- PWA: манифест (`start_url: "/"`, название из `APP_NAME`, цвета из токенов), иконки PNG и SVG, `apple-touch-icon`, без service worker и офлайн-режима;
- e2e на 390×844 по сценарию 4 §10: расход с выражением через кнопки-операторы, затем правка операции.

**Предусловие:** выполнены планы 6a и 6b (как они реализованы в ветке, с волнами финальных правок до 2bd49d8 включительно): `OperationFormHost` с `NewOperationButtons`, `OperationForm` (`MODAL_CLASS` — на весь экран ниже 768 px), `AmountField` с группой «Операторы: …», правка из журнала (`openForm({ kind: 'edit', … })`), `AttachmentsField`, `e2e/operation-form.spec.ts` и `e2e/operation-edit.spec.ts` с тестами «ширина 390 px: …»; план 5c — `JournalPage` с `readOnly`, `assignData` через `useMemo`, `BulkBar`, `UndoToast`; `Popover` рисует панель в ближайшем открытом `<dialog>` (план 6a).

**Architecture:**
- **Граница «телефон» одна — 768 px**, как у вариантов Tailwind `md:`/`max-md:`. Оформление — классами; там, где на телефоне другой компонент (карточки вместо таблицы, панель «Фильтры» вместо тулбара), — хук `useIsMobile()` (`src/client/lib/media.ts`, `matchMedia('(width < 48rem)')` через `useSyncExternalStore`).
- **Выезжающие панели** — компонент `Drawer`: `<dialog>` + `showModal()` у левого или правого края. Страница под ним недоступна; Tab и Shift+Tab ходят по кругу внутри панели (`cycleTab` из `focus-trap.ts`, его же получает `Modal`); Esc, «Закрыть» и касание затемнённого фона закрывают; фокус возвращается на кнопку, которой открыли. Выпадающие списки внутри (сохранённые фильтры) уже рисуются в открытом `<dialog>` (план 6a), окно «Фильтр» открывается поверх панели.
- **Карточки журнала:** чистая функция `journalCardText` (`src/client/lib/journal-card.ts`, unit-тесты) и компонент `JournalCards`; `JournalPage` выбирает карточки или таблицу по `useIsMobile()`.
- **PWA на сервере:** манифест зависит от `APP_NAME`, поэтому его отдаёт Fastify (`/pwa/manifest.webmanifest`), а не Vite. PNG-иконки рисуются в памяти при первом запросе собственным кодировщиком PNG на `node:zlib` (пакеты не нужны), SVG — из той же геометрии. Всё под `/pwa/` — маршруты вне `/api`, поэтому без входа и без CSRF; в разработке Vite проксирует `/pwa` на сервер.

**Tech Stack:** как в планах 1–6b: Node 24, Fastify 5, React 19, react-router 8, TanStack Query 5, Tailwind 4, Vitest, Playwright. Новых пакетов нет.

**Spec:** [docs/superpowers/specs/2026-10-05-stage1-foundation-core-design.md](../specs/2026-10-05-stage1-foundation-core-design.md) — §3 (`APP_NAME` — «название в интерфейсе и PWA»), §7 (бренд и токены; «Мобильная версия (ширина меньше 768px)»; «Форма операции (модалка; на телефоне на весь экран)»), §8 (helmet с CSP), §10 (E2E, сценарий 4), §11 шаг 7.

**Ветка:** `stage1/plan1-skeleton`. В `main` не сливаем до завершения всех работ.

## Решения, принятые при планировании

Записаны в спецификацию (§7, блок «Решения планирования от 2026-10-07 (план 7)») тем же коммитом, что и план.

1. **Телефон — ширина меньше 768 px** (`md` у Tailwind, `(width < 48rem)` в `useIsMobile`). Поворот телефона или изменение окна переключает вид сразу; открытые выезжающие панели при этом закрываются.
2. **Карточка журнала:** статья («2 статьи» у разбитой операции, «Без статьи», у перевода — «Перевод»), счёт (у перевода — «Касса → Валютный»), строка «контрагент · комментарий», сумма со знаком, под ней зачисление перевода в другой валюте или сумма в базовой валюте, дата и время («сегодня 10:30»). Карточка — кнопка: касание открывает форму правки, после закрытия фокус возвращается на карточку.
3. **Массовые действия, «Указать» и выбор колонок на телефоне не показываются** — они остаются в таблице на компьютере. Выделение, сделанное в широком окне, при переходе к телефону снимается: невидимые строки нельзя удалить по ошибке.
4. **Фильтры на телефоне:** на виду поиск и кнопка «Фильтры · N»; в панели справа — период, сумма от и до, сортировка списком («Сначала новые», «Сначала старые», «Сначала крупные», «Сначала мелкие» — у карточек нет заголовков колонок), «Фильтр» (окно открывается поверх панели), сохранённые фильтры, выгрузка в Excel, сброс. N — период, каждая граница суммы и условия окна «Фильтр» (по разделу, как у кнопки «Фильтр»); поиск и сортировка не в счёт.
5. **Счета на телефоне:** кнопка «Счета» в шапке, панель слева с «Всего на счетах» и балансами, без сворачивания (свёрнутость — настройка левой панели компьютера). Переход по счёту (фильтр журнала) и «+ счёт» закрывают панель. Шапка телефона — одна строка: «Счета», компания (длинное название обрезается многоточием), «Выйти»; название продукта и имя пользователя — только на компьютере (профиль — в «Настройках»).
6. **Нижняя панель** «Добавить операцию» с кнопками «Доход», «Расход», «Перевод» — на всех страницах компании, только на телефоне; кнопки шапки — только на компьютере. Под панель у содержимого — отступ снизу; тост «Удалено N — Отменить» поднимается над ней.
7. **Выезжающая панель — модальное окно** (`<dialog>`, `showModal()`): Tab и Shift+Tab по кругу внутри (до адресной строки браузера фокус не уходит), Esc, «Закрыть» и касание фона закрывают; касание, начатое внутри панели и отпущенное над фоном, не закрывает. Фокус возвращается на кнопку, которой открыли.
8. **PWA:** `GET /pwa/manifest.webmanifest` (`application/manifest+json`, `no-cache`) — `name` и `short_name` = `APP_NAME`, `start_url` и `scope` = «/», `display: standalone`, `theme_color` и `background_color` — графитовый токен шапки; иконки `/pwa/icon-192.png`, `/pwa/icon-512.png` (`any`), `/pwa/icon-maskable-512.png` (`maskable`), `/pwa/icon.svg`; `/pwa/apple-touch-icon.png` 180×180 — без прозрачности. Рисунок — графитовый фон и три растущих столбика в зелёных цветах бренда. Без входа, кэш иконок — сутки. Service worker не регистрируется, офлайн-режима нет. Цвета для сервера — `src/shared/brand.ts`; тест сверяет их с токенами в `styles.css` и `<meta name="theme-color">`.
9. **Вырез экрана (safe-area):** `viewport-fit=cover` уже стоит; строка состояния iOS в PWA — `black-translucent`; отступы `env(safe-area-inset-*)` у шапки, нижней панели, выезжающих панелей и формы на весь экран.
10. **Ширина 390 px:** в содержимом страницы на телефоне длинные слова без пробелов переносятся (`overflow-wrap: anywhere` у `<main>`); строки шаблона разделения в настройках — карточкой (статья во всю ширину, под ней проект, доля и «×»). Остальные разделы настроек проверены на 390 px — прокрутки вбок нет.
11. **Сетки на телефоне — `grid-cols-[minmax(0,1fr)]`.** Колонка сетки без шаблона растёт по самому широкому элементу: название счёта без пробелов растягивало форму операции до 670 px (кнопки «Отмена» и «÷» уходили за экран), «Перенести в…» — раздел «Статьи», статьи — окно «Фильтр». Поэтому у сеток формы, разбиения, окна «Фильтр» и раздела «Статьи» — `grid-cols-[minmax(0,1fr)]` (`md:grid-cols-2` остаётся), выпадающие списки в содержимом страницы не шире своего блока, подписи статей в окне «Фильтр» переносятся. Проверка ширины в e2e смотрит и на страницу, и на каждое открытое окно (`dialog[open]` в верхнем слое ширину страницы не меняет).
12. **Tab в модальных окнах** (форма операции, «Фильтр», выезжающие панели) ходит по кругу внутри окна — общий `cycleTab`.
13. **Архивная компания — только просмотр** (журнал уже такой, план 5c): операция открывается в форме, поля недоступны, блок «Проект, теги, комментарий, файл» раскрыт, вместо кнопок — «Закрыть» и сообщение «Компания в архиве — изменения недоступны.»; файлы можно скачать, но не добавить и не удалить. Кнопок «Доход», «Расход», «Перевод» нет ни в шапке, ни внизу.
14. **На странице без компании** (новая компания) название продукта в шапке телефона остаётся — скрывается, только когда рядом «Счета» и переключатель компаний. У манифеста есть `id: "/"` — смена названия не создаёт «другое» установленное приложение.
15. **E2E сценария 4 §10** — в `e2e/mobile.spec.ts` (создание с нижней панели и правка из карточки в одном тесте); тесты «ширина 390 px: …» планов 6a и 6b им заменяются — они искали строку таблицы, которой на телефоне больше нет.

## Global Constraints

- **Мобильная версия (§7):** «Журнал выводится списком карточек (сумма, категория, счёт, дата), фильтры открываются в выезжающей панели. Счета и «Всего на счетах» выезжают слева. Внизу закреплены кнопки «Доход», «Расход», «Перевод». Формы открываются на весь экран, у поля суммы есть ряд операторов калькулятора. PWA-манифест (`start_url: "/"`, относительный) и иконки, без офлайн-режима.»
- **Бренд (§7):** «Собственный бренд (`APP_NAME`, своя иконка)… графитовая шапка… зелёный для дохода… Цвета заданы токенами Tailwind в одном месте.» `APP_NAME` (§3) — «название в интерфейсе и PWA».
- **Не входит в этап 1:** офлайн-режим — service worker не регистрируется.
- **Безопасность (§8):** helmet с CSP для SPA не ослабляется: манифест и иконки — с того же сайта (`default-src 'self'`, `img-src 'self'`).
- **Без новых npm-пакетов.** PNG — на `node:zlib` (`deflateSync`, `crc32`).
- **Доступность:** выезжающие панели — `<dialog>` с названием (`aria-labelledby`), фокус внутри, возврат фокуса; кнопки панели и шапки — с текстом; у кнопки, открывающей панель, — `aria-haspopup="dialog"` и `aria-expanded`.
- **E2E:** телефон — `page.setViewportSize({ width: 390, height: 844 })`; левая панель `<nav aria-label="Счета">` на телефоне скрыта, на компьютере есть на каждой странице компании — не ищите элементы без области; `name:` в Playwright — подстрока без учёта регистра (`'Фильтр'` найдёт и «Фильтры», `'Счета'` — используйте `exact: true` или регулярное выражение с `^`); поле суммы получает фокус кадр спустя после открытия формы — дождитесь `toBeFocused()`; данные — через `page.request` с `origin` и `x-requested-with: fetch`; общую настройку пользователя `sidebar.collapsed` тесты этого плана не меняют; без фиксированных пауз.
- **Невидимые символы** (U+2212, U+202F, U+00A0, U+200B) в коде — только экранированием `\u2212` и т. п. Инструмент записи файлов может превратить экранирование в сам символ: после записи файлов с такими строками выполните проверку из шага задачи.
- **Концы строк:** рабочая копия в CRLF (`core.autocrlf=true`). Правки «найдите → замените» — инструментом правки файлов.
- **Безопасность хуков среды:** shell-команды не содержат подстроку «.env»; собирать её из частей запрещено.
- **Завершение задачи:** зелёные `npm test`, `npm run typecheck` и `npm run test:e2e`; коммит с трейлером `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Длинные названия без пробелов на телефоне** (компания, счёт, статья, значение «Было/Стало» в истории): ни страница, ни открытое окно (форма операции, «Фильтр») не прокручиваются вбок, «Отмена» и кнопки операторов на экране. Тест — задача 6 (e2e по журналу, всем разделам настроек, истории с подробностями, форме и окну «Фильтр»).
2. **Фокус в выезжающей панели:** Tab не уходит на страницу под панелью и в адресную строку; касание внутри панели не закрывает её, касание фона закрывает; после Esc, «Закрыть» и касания фона фокус — на кнопке «Счета». Тест — задача 3.
3. **Выделение, сделанное на компьютере, после поворота к телефону:** массовых действий не видно, выделение снято — после возврата к широкому окну флажок пуст и полосы действий нет. Тест — задача 4.
4. **Окно стало шире при открытой панели «Фильтры»:** панель закрывается, тулбар и таблица на месте; при возврате к телефону панель не открывается сама. Тест — задача 5.
5. **Архивная компания:** форма открывается только для просмотра — ни сохранить, ни удалить, ни добавить файл; новых операций не начать ни на компьютере, ни на телефоне. Тест — задача 7.
6. **Браузер запрашивает манифест и иконки без куки сессии:** 200 и верные типы (`application/manifest+json`, `image/png`, `image/svg+xml`), размеры PNG соответствуют манифесту, CSP страницы не запрещает манифест. Тесты — задача 1 (unit и e2e).

---

## Карта файлов

```
src/shared/brand.ts                          # (новый) цвета бренда для PWA = токены styles.css
src/server/pwa/png.ts                        # (новый) кодировщик PNG на node:zlib
src/server/pwa/icons.ts                      # (новый) рисунок иконки: PNG и SVG
src/server/pwa/routes.ts                     # (новый) манифест и иконки под /pwa/
src/server/app.ts                            # регистрация маршрутов PWA
src/client/index.html                        # theme-color, манифест, иконки, строка состояния iOS
vite.config.ts                               # прокси /pwa в разработке
src/client/lib/media.ts                      # (новый) useIsMobile()
src/client/components/Drawer.tsx             # (новый) выезжающая панель
src/client/components/focus-trap.ts          # (новый) cycleTab — Tab по кругу в модальном окне
src/client/components/Modal.tsx              # Tab по кругу
src/client/components/AccountsPanel.tsx      # содержимое панели отдельно, AccountsDrawerButton
src/client/components/AppHeader.tsx          # safe-area, шапка телефона
src/client/components/CompanySwitcher.tsx    # длинное название — многоточие
src/client/components/operation/OperationFormHost.tsx  # NewOperationButtons: шапка и нижняя панель
src/client/components/operation/OperationForm.tsx      # safe-area, сетки minmax(0,1fr), только просмотр в архивной компании
src/client/components/operation/SplitEditor.tsx        # сетки minmax(0,1fr)
src/client/components/operation/AttachmentsField.tsx   # readOnly: без добавления и удаления
src/client/components/journal/FilterDialog.tsx         # сетка и подписи статей без растягивания
src/client/pages/settings/CategoriesSettings.tsx       # сетка и «Перенести в…» без растягивания
src/client/components/journal/UndoToast.tsx  # тост над нижней панелью
src/client/lib/journal-card.ts               # (новый) текст карточки операции
src/client/components/journal/JournalCards.tsx         # (новый) журнал карточками
src/client/lib/journal-filter.ts             # panelConditionCount, SORT_CHOICES
src/client/components/journal/JournalToolbar.tsx       # вид телефона: поиск + панель «Фильтры»
src/client/pages/JournalPage.tsx             # карточки, без выделения и колонок на телефоне
src/client/pages/CompanyLayout.tsx           # кнопка «Счета», нижняя панель, отступы, перенос слов; архив — без кнопок операций
src/client/pages/settings/SplitPresetsSettings.tsx     # строки шаблона карточкой на телефоне
tests/server/pwa.test.ts, tests/shared/brand.test.ts   # (новые)
tests/client/journal-card.test.ts, tests/client/journal-panel.test.ts   # (новые)
e2e/pwa.spec.ts, e2e/mobile.spec.ts          # (новые)
e2e/operation-form.spec.ts, e2e/operation-edit.spec.ts # тесты 390 px заменены сценарием 4 в mobile.spec.ts
README.md
```

---

### Task 1: PWA — манифест, иконки, ссылки в index.html

**Files:**
- Create: `src/shared/brand.ts`, `src/server/pwa/png.ts`, `src/server/pwa/icons.ts`, `src/server/pwa/routes.ts`, `tests/server/pwa.test.ts`, `tests/shared/brand.test.ts`, `e2e/pwa.spec.ts`
- Modify: `src/server/app.ts`, `src/client/index.html`, `vite.config.ts`, `src/client/components/AppHeader.tsx`

**Interfaces:**
- Consumes: `buildApp` (`src/server/app.ts`), `config.appName`; `createTestApp` (`tests/helpers/test-app.ts`); токены `src/client/styles.css`.
- Produces:
  - `BRAND_COLORS: { chrome: '#16181d'; income: '#0f9d6b'; incomeSoft: '#dff5ec' }` (`src/shared/brand.ts`);
  - `encodePng(width, height, rgba: Uint8Array): Buffer` (`src/server/pwa/png.ts`);
  - `type IconVariant = 'any' | 'full'`, `iconShapes(variant)`, `renderIcon(size, variant): Uint8Array`, `iconPng(size, variant): Buffer`, `iconSvg(): string` (`src/server/pwa/icons.ts`);
  - `PWA_PREFIX = '/pwa/'`, `PWA_PNG_ICONS`, `buildManifest(appName): WebManifest` (с `id: '/'`), `registerPwaRoutes(app, { appName })` (`src/server/pwa/routes.ts`);
  - маршруты `GET /pwa/manifest.webmanifest`, `/pwa/icon.svg`, `/pwa/icon-192.png`, `/pwa/icon-512.png`, `/pwa/icon-maskable-512.png`, `/pwa/apple-touch-icon.png`.

- [ ] **Step 1: Write the failing tests**

`tests/server/pwa.test.ts`:

```ts
import zlib from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { BRAND_COLORS } from '../../src/shared/brand';
import { iconShapes, iconSvg, renderIcon } from '../../src/server/pwa/icons';
import { encodePng } from '../../src/server/pwa/png';
import { buildManifest, PWA_PNG_ICONS } from '../../src/server/pwa/routes';
import { createTestApp, type TestApp } from '../helpers/test-app';

/** Разбор PNG для проверок: подпись, блоки и их CRC, заголовок, пиксели RGBA (у строк — фильтр 0). */
function decodePng(png: Buffer) {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks: { type: string; data: Buffer }[] = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.toString('ascii', at + 4, at + 8);
    expect(png.readUInt32BE(at + 8 + length), `CRC блока ${type}`).toBe(zlib.crc32(png.subarray(at + 4, at + 8 + length)));
    chunks.push({ type, data: png.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
  const ihdr = chunks[0]!.data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  expect([...ihdr.subarray(8)]).toEqual([8, 6, 0, 0, 0]);
  const raw = zlib.inflateSync(chunks[1]!.data);
  const stride = width * 4 + 1;
  expect(raw.length).toBe(height * stride);
  const pixel = (x: number, y: number) => {
    expect(raw[y * stride]).toBe(0);
    const k = y * stride + 1 + x * 4;
    return [...raw.subarray(k, k + 4)];
  };
  return { width, height, pixel };
}

const rgba = (hex: string, alpha = 255) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), alpha];

describe('encodePng', () => {
  it('пиксели RGBA → PNG, который читается обратно точь-в-точь', () => {
    const png = encodePng(2, 2, new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0, 1, 2, 3, 4, 250, 251, 252, 253]));
    const { width, height, pixel } = decodePng(png);
    expect([width, height]).toEqual([2, 2]);
    expect(pixel(0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(1, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(0, 1)).toEqual([1, 2, 3, 4]);
    expect(pixel(1, 1)).toEqual([250, 251, 252, 253]);
  });

  it('число пикселей не совпадает с размером или размер неверный — ошибка, а не битый файл', () => {
    expect(() => encodePng(2, 2, new Uint8Array(12))).toThrow('Число пикселей');
    expect(() => encodePng(0, 1, new Uint8Array(0))).toThrow('Неверный размер');
  });
});

describe('иконка', () => {
  it('any — скруглённый квадрат на прозрачном фоне, full — фон на всю площадь; цвета бренда', () => {
    const any = decodePng(encodePng(192, 192, renderIcon(192, 'any')));
    expect(any.pixel(0, 0)[3]).toBe(0); // угол срезан скруглением
    expect(any.pixel(96, 20)).toEqual(rgba(BRAND_COLORS.chrome)); // фон
    expect(any.pixel(Math.round(0.69 * 192), Math.round(0.5 * 192))).toEqual(rgba(BRAND_COLORS.incomeSoft)); // старший столбик
    expect(any.pixel(Math.round(0.31 * 192), Math.round(0.7 * 192))).toEqual(rgba(BRAND_COLORS.income)); // младший столбик
    const full = decodePng(encodePng(180, 180, renderIcon(180, 'full')));
    expect(full.pixel(0, 0)).toEqual(rgba(BRAND_COLORS.chrome)); // без прозрачности: iOS закрасила бы её чёрным
    expect(full.pixel(179, 179)).toEqual(rgba(BRAND_COLORS.chrome));
  });

  it('столбики — в безопасной зоне maskable-иконки (круг радиусом 0,4 стороны)', () => {
    for (const s of iconShapes('full').slice(1)) {
      for (const [x, y] of [
        [s.x, s.y],
        [s.x + s.w, s.y],
        [s.x, s.y + s.h],
        [s.x + s.w, s.y + s.h],
      ]) {
        expect(Math.hypot(x! - 0.5, y! - 0.5)).toBeLessThan(0.4);
      }
    }
  });

  it('SVG — та же картинка: фон и три столбика в цветах бренда', () => {
    const svg = iconSvg();
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 512 512">/);
    expect(svg.match(/<rect /g)).toHaveLength(4);
    expect(svg).toContain(`fill="${BRAND_COLORS.chrome}"`);
    expect(svg).toContain(`fill="${BRAND_COLORS.income}"`);
  });
});

describe('манифест PWA', () => {
  it('название из APP_NAME, относительный start_url, цвета бренда, иконки 192, 512 и maskable', () => {
    const m = buildManifest('Клубный учёт');
    expect(m).toMatchObject({
      id: '/',
      name: 'Клубный учёт',
      short_name: 'Клубный учёт',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      theme_color: BRAND_COLORS.chrome,
      background_color: BRAND_COLORS.chrome,
    });
    expect(m.icons).toEqual([
      { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/pwa/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ]);
  });
});

let t: TestApp;
afterEach(async () => t?.cleanup());

describe('маршруты PWA', () => {
  it('манифест и иконки отдаются без входа, с верным типом и размером; CSP страницы их не запрещает', async () => {
    t = await createTestApp({ APP_NAME: 'Клубный учёт' });
    const res = await t.app.inject({ method: 'GET', url: '/pwa/manifest.webmanifest' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/manifest+json; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    // manifest-src и img-src не заданы отдельно или разрешают свой сайт: браузер возьмёт манифест и иконки
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("img-src 'self'");
    expect(csp).not.toContain('manifest-src');
    const manifest = res.json();
    expect(manifest.name).toBe('Клубный учёт');

    for (const icon of PWA_PNG_ICONS) {
      const png = await t.app.inject({ method: 'GET', url: `/pwa/${icon.file}` });
      expect(png.statusCode, icon.file).toBe(200);
      expect(png.headers['content-type']).toBe('image/png');
      const { width, height } = decodePng(png.rawPayload);
      expect([width, height]).toEqual([icon.size, icon.size]);
    }
    const svg = await t.app.inject({ method: 'GET', url: '/pwa/icon.svg' });
    expect(svg.statusCode).toBe(200);
    expect(svg.headers['content-type']).toBe('image/svg+xml; charset=utf-8');
    expect(svg.body).toBe(iconSvg());
    // каждая иконка из манифеста существует
    for (const icon of manifest.icons as { src: string; type: string }[]) {
      const r = await t.app.inject({ method: 'HEAD', url: icon.src });
      expect(r.statusCode, icon.src).toBe(200);
      expect(String(r.headers['content-type'])).toContain(icon.type);
    }
  });

  it('изменяющие запросы к файлам PWA не принимаются', async () => {
    t = await createTestApp();
    const res = await t.app.inject({ method: 'POST', url: '/pwa/manifest.webmanifest' });
    expect(res.statusCode).toBe(404);
  });
});
```

`tests/shared/brand.test.ts`:

```ts
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BRAND_COLORS } from '../../src/shared/brand';

const css = fs.readFileSync('src/client/styles.css', 'utf8');
const html = fs.readFileSync('src/client/index.html', 'utf8');

/** Значение токена Tailwind `--color-<name>` из styles.css. */
const token = (name: string) => css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`))?.[1]?.toLowerCase();

describe('цвета бренда для PWA', () => {
  it('совпадают с токенами Tailwind (§7: цвета в одном месте)', () => {
    expect(token('chrome')).toBe(BRAND_COLORS.chrome);
    expect(token('income')).toBe(BRAND_COLORS.income);
    expect(token('income-soft')).toBe(BRAND_COLORS.incomeSoft);
  });

  it('index.html: цвет темы, манифест, иконки вкладки и iOS', () => {
    expect(html).toContain(`<meta name="theme-color" content="${BRAND_COLORS.chrome}" />`);
    expect(html).toContain('<link rel="manifest" href="/pwa/manifest.webmanifest" />');
    expect(html).toContain('<link rel="icon" href="/pwa/icon.svg" type="image/svg+xml" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/pwa/apple-touch-icon.png" />');
    // офлайн-режима нет (§7): service worker не регистрируется
    expect(html).not.toContain('serviceWorker');
  });
});
```

`e2e/pwa.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('PWA: страница ссылается на манифест и иконки, они отдаются без входа с верным типом (§7)', async ({ page, request }) => {
  const res = await page.goto('/login');
  // CSP страницы не запрещает манифест: отдельного manifest-src нет, default-src — свой сайт
  const csp = res!.headers()['content-security-policy'];
  expect(csp).toContain("default-src 'self'");
  expect(csp).not.toContain('manifest-src');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#16181d');

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBe('/pwa/manifest.webmanifest');
  // запрос без куки сессии — как его делает браузер
  const manifestRes = await request.get(manifestHref!);
  expect(manifestRes.status()).toBe(200);
  expect(manifestRes.headers()['content-type']).toBe('application/manifest+json; charset=utf-8');
  const manifest = await manifestRes.json();
  expect(manifest).toMatchObject({ id: '/', name: 'Учёт', start_url: '/', display: 'standalone', theme_color: '#16181d' });
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(['192x192', '512x512', '512x512', 'any']);

  for (const icon of manifest.icons as { src: string; sizes: string; type: string }[]) {
    const r = await request.get(icon.src);
    expect(r.status(), icon.src).toBe(200);
    expect(r.headers()['content-type']).toContain(icon.type);
    if (icon.type === 'image/png') {
      const png = await r.body();
      // подпись PNG и ширина из заголовка IHDR
      expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
      expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(icon.sizes);
    }
  }

  const apple = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  const appleRes = await request.get(apple!);
  expect(appleRes.status()).toBe(200);
  expect(appleRes.headers()['content-type']).toBe('image/png');
  expect((await appleRes.body()).readUInt32BE(16)).toBe(180);

  const favicon = await page.locator('link[rel="icon"]').getAttribute('href');
  const faviconRes = await request.get(favicon!);
  expect(faviconRes.status()).toBe(200);
  expect(faviconRes.headers()['content-type']).toBe('image/svg+xml; charset=utf-8');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/pwa.test.ts tests/shared/brand.test.ts`
Expected: FAIL — нет модулей `src/shared/brand`, `src/server/pwa/*`.

- [ ] **Step 3: Implement**

`src/shared/brand.ts`:

```ts
/**
 * Цвета бренда для PWA: манифест, иконки и `<meta name="theme-color">`. Это те же значения, что токены
 * Tailwind в `src/client/styles.css` (§7: цвета заданы в одном месте), — совпадение проверяет
 * `tests/shared/brand.test.ts`: поменяли токен — тест подскажет поменять и здесь.
 */
export const BRAND_COLORS = {
  /** `--color-chrome`: графитовая шапка; фон иконки, цвет темы и фон заставки PWA. */
  chrome: '#16181d',
  /** `--color-income`: зелёный — столбики иконки. */
  income: '#0f9d6b',
  /** `--color-income-soft`: светло-зелёный — старший столбик иконки. */
  incomeSoft: '#dff5ec',
} as const;
```

`src/server/pwa/png.ts`:

```ts
import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Блок PNG: длина, тип, данные, CRC-32 от типа и данных. */
function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(data, zlib.crc32(head.subarray(4))), 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * PNG из пикселей RGBA (8 бит на канал, построчно сверху вниз): без чересстрочности, у каждой строки
 * фильтр 0. Пакеты для картинок не нужны — сжатие из `node:zlib`.
 */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error('Неверный размер PNG');
  if (rgba.length !== width * height * 4) throw new Error('Число пикселей не совпадает с размером PNG');
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // бит на канал
  ihdr[9] = 6; // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1)); // первый байт строки — фильтр 0
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
```

`src/server/pwa/icons.ts`:

```ts
import { BRAND_COLORS } from '../../shared/brand';
import { encodePng } from './png';

/**
 * Вид иконки: `any` — скруглённый квадрат на прозрачном фоне (вкладка, ярлык на компьютере);
 * `full` — фон на всю площадь без скруглений (`maskable` в манифесте и `apple-touch-icon`: система сама
 * обрезает углы, а прозрачные углы iOS закрасила бы чёрным).
 */
export type IconVariant = 'any' | 'full';

/** Скруглённый прямоугольник в долях стороны иконки (0…1). */
export interface IconShape {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
  color: string;
}

/**
 * Рисунок иконки: графитовый фон и три растущих столбика. Столбики — внутри круга радиусом 0,4 стороны
 * («безопасная зона» maskable-иконки), поэтому их не срежет ни одна маска.
 */
export function iconShapes(variant: IconVariant): IconShape[] {
  const background: IconShape = { x: 0, y: 0, w: 1, h: 1, r: variant === 'any' ? 0.22 : 0, color: BRAND_COLORS.chrome };
  const bars = [0.24, 0.38, 0.52].map((h, i) => ({
    x: 0.25 + i * 0.19,
    y: 0.76 - h,
    w: 0.12,
    h,
    r: 0.03,
    color: i === 2 ? BRAND_COLORS.incomeSoft : BRAND_COLORS.income,
  }));
  return [background, ...bars];
}

function rgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function inside(s: IconShape, x: number, y: number): boolean {
  if (x < s.x || x > s.x + s.w || y < s.y || y > s.y + s.h) return false;
  const dx = Math.max(s.x + s.r - x, 0, x - (s.x + s.w - s.r));
  const dy = Math.max(s.y + s.r - y, 0, y - (s.y + s.h - s.r));
  return dx * dx + dy * dy <= s.r * s.r;
}

/** Точек на пиксель по каждой оси: края фигур сглажены. */
const SUPERSAMPLE = 4;

/** Пиксели RGBA иконки size×size: в каждой точке — цвет верхней фигуры, края сглажены усреднением. */
export function renderIcon(size: number, variant: IconVariant): Uint8Array {
  const shapes = iconShapes(variant).map((shape) => ({ shape, color: rgb(shape.color) }));
  const out = new Uint8Array(size * size * 4);
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let hits = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const x = (px + (sx + 0.5) / SUPERSAMPLE) / size;
          const y = (py + (sy + 0.5) / SUPERSAMPLE) / size;
          for (let i = shapes.length - 1; i >= 0; i--) {
            const s = shapes[i]!;
            if (!inside(s.shape, x, y)) continue;
            r += s.color[0];
            g += s.color[1];
            b += s.color[2];
            hits++;
            break;
          }
        }
      }
      if (hits === 0) continue;
      const k = (py * size + px) * 4;
      // цвет — среднее по закрашенным точкам, прозрачность — доля закрашенных: без тёмной каймы на краю
      out[k] = Math.round(r / hits);
      out[k + 1] = Math.round(g / hits);
      out[k + 2] = Math.round(b / hits);
      out[k + 3] = Math.round((255 * hits) / samples);
    }
  }
  return out;
}

const pngCache = new Map<string, Buffer>();

/** PNG иконки; рисуется при первом запросе и остаётся в памяти. */
export function iconPng(size: number, variant: IconVariant): Buffer {
  const key = `${size}:${variant}`;
  let png = pngCache.get(key);
  if (!png) {
    png = encodePng(size, size, renderIcon(size, variant));
    pngCache.set(key, png);
  }
  return png;
}

/** Та же иконка в SVG (значок вкладки): координаты — в долях стороны 512. */
export function iconSvg(): string {
  const n = (v: number) => String(Math.round(v * 512 * 100) / 100);
  const rects = iconShapes('any')
    .map((s) => `<rect x="${n(s.x)}" y="${n(s.y)}" width="${n(s.w)}" height="${n(s.h)}" rx="${n(s.r)}" fill="${s.color}"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${rects}</svg>`;
}
```

`src/server/pwa/routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { BRAND_COLORS } from '../../shared/brand';
import { iconPng, iconSvg, type IconVariant } from './icons';

/** Файлы PWA (§7 «Мобильная версия»): все под /pwa/ — в разработке Vite проксирует их одним правилом. */
export const PWA_PREFIX = '/pwa/';

/** PNG-иконки: для манифеста (192 и 512, отдельная maskable) и apple-touch-icon для iOS (purpose: null). */
export const PWA_PNG_ICONS: readonly { file: string; size: number; variant: IconVariant; purpose: 'any' | 'maskable' | null }[] = [
  { file: 'icon-192.png', size: 192, variant: 'any', purpose: 'any' },
  { file: 'icon-512.png', size: 512, variant: 'any', purpose: 'any' },
  { file: 'icon-maskable-512.png', size: 512, variant: 'full', purpose: 'maskable' },
  { file: 'apple-touch-icon.png', size: 180, variant: 'full', purpose: null },
];

export interface WebManifest {
  id: string;
  name: string;
  short_name: string;
  lang: string;
  start_url: string;
  scope: string;
  display: 'standalone';
  background_color: string;
  theme_color: string;
  icons: { src: string; sizes: string; type: string; purpose: string }[];
}

/**
 * Манифест PWA: название — APP_NAME, `start_url` — относительный «/» (§7), цвета — токены бренда.
 * Офлайн-режима нет: service worker не регистрируется.
 */
export function buildManifest(appName: string): WebManifest {
  return {
    // постоянный идентификатор приложения: смена названия или start_url не создаёт «другое» установленное приложение
    id: '/',
    name: appName,
    short_name: appName,
    lang: 'ru',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: BRAND_COLORS.chrome,
    theme_color: BRAND_COLORS.chrome,
    icons: [
      ...PWA_PNG_ICONS.flatMap((i) =>
        i.purpose === null ? [] : [{ src: `${PWA_PREFIX}${i.file}`, sizes: `${i.size}x${i.size}`, type: 'image/png', purpose: i.purpose }],
      ),
      { src: `${PWA_PREFIX}icon.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
}

/** Манифест и иконки: без входа (браузер запрашивает их без куки сессии), только GET и HEAD. */
export function registerPwaRoutes(app: FastifyInstance, deps: { appName: string }): void {
  const manifest = JSON.stringify(buildManifest(deps.appName));
  // название меняют в настройках сервера — браузер каждый раз сверяет манифест с сервером
  app.get(`${PWA_PREFIX}manifest.webmanifest`, async (_req, reply) =>
    reply.header('cache-control', 'no-cache').type('application/manifest+json; charset=utf-8').send(manifest),
  );
  app.get(`${PWA_PREFIX}icon.svg`, async (_req, reply) =>
    reply.header('cache-control', 'public, max-age=86400').type('image/svg+xml; charset=utf-8').send(iconSvg()),
  );
  for (const icon of PWA_PNG_ICONS) {
    app.get(`${PWA_PREFIX}${icon.file}`, async (_req, reply) =>
      reply.header('cache-control', 'public, max-age=86400').type('image/png').send(iconPng(icon.size, icon.variant)),
    );
  }
}
```

`src/server/app.ts` — правки:

1. Найдите:

```ts
import { registerPreferencesRoutes } from './modules/preferences/routes';
```

   замените на:

```ts
import { registerPreferencesRoutes } from './modules/preferences/routes';
import { registerPwaRoutes } from './pwa/routes';
```

2. Найдите:

```ts
  app.get('/api/v1/meta', async () => ({ appName: config.appName, timezone: config.timezone }));
```

   замените на:

```ts
  app.get('/api/v1/meta', async () => ({ appName: config.appName, timezone: config.timezone }));
  registerPwaRoutes(app, { appName: config.appName });
```

`src/client/index.html` — правки:

1. Найдите:

```html
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```

   замените на:

```html
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#16181d" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <link rel="manifest" href="/pwa/manifest.webmanifest" />
    <link rel="icon" href="/pwa/icon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="/pwa/apple-touch-icon.png" />
```

Vite оставляет эти адреса как есть (файлов под `/pwa/` в сборке нет — их отдаёт сервер).

`vite.config.ts` — правки:

1. Найдите:

```ts
        headers: { origin: 'http://localhost:3000' },
      },
```

   замените на:

```ts
        headers: { origin: 'http://localhost:3000' },
      },
      // манифест и иконки PWA отдаёт сервер (название — из APP_NAME)
      '/pwa': { target: 'http://127.0.0.1:3000', changeOrigin: true },
```

`src/client/components/AppHeader.tsx` — правки (строка состояния iOS в PWA прозрачная — шапка начинается ниже выреза):

1. Найдите:

```tsx
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-4 text-white">
```

   замените на:

```tsx
    // в PWA на iPhone строка состояния прозрачная (black-translucent): шапка начинается ниже выреза экрана
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 pb-4 pt-[max(1rem,env(safe-area-inset-top))] text-white">
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/pwa.test.ts tests/shared/brand.test.ts tests/server/spa.test.ts`
Expected: PASS.

Run: `npx playwright test e2e/pwa.spec.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test`, `npm run typecheck` и `npm run test:e2e` — зелёные.

```bash
git add src/shared/brand.ts src/server/pwa/png.ts src/server/pwa/icons.ts src/server/pwa/routes.ts src/server/app.ts src/client/index.html vite.config.ts src/client/components/AppHeader.tsx tests/server/pwa.test.ts tests/shared/brand.test.ts e2e/pwa.spec.ts
git commit -m "feat: PWA — манифест с названием из APP_NAME, иконки PNG и SVG, apple-touch-icon, цвет темы

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Нижняя панель «Доход», «Расход», «Перевод» на телефоне

**Files:**
- Create: `e2e/mobile.spec.ts`
- Modify: `src/client/components/operation/OperationFormHost.tsx`, `src/client/pages/CompanyLayout.tsx`, `src/client/components/journal/UndoToast.tsx`, `e2e/operation-form.spec.ts`

**Interfaces:**
- Consumes: `useOpenOperationForm`, `BUTTONS` (план 6a, `OperationFormHost.tsx`).
- Produces:
  - `NewOperationButtons({ placement?: 'header' | 'bottom' })` — `header` (по умолчанию): кнопки в шапке, только от 768 px; `bottom`: `role="group"` с названием «Добавить операцию», закреплена у нижнего края, только ниже 768 px;
  - `e2e/mobile.spec.ts`: помощники `login`, `createCompany`, `csrf`, `apiPost`, константы `PHONE`, `bar(page)`, `newForm(page)` — их используют задачи 3–6.

- [ ] **Step 1: Write the failing test**

`e2e/mobile.spec.ts`:

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

/** Телефон из §10 (сценарий 4): ширина 390 px. */
const PHONE = { width: 390, height: 844 };
const bar = (page: Page) => page.getByRole('group', { name: 'Добавить операцию' });
const newForm = (page: Page) => page.getByRole('dialog', { name: 'Новая операция' });

test('нижняя панель «Доход», «Расход», «Перевод» на телефоне; на компьютере кнопки — в шапке', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Панель ${Date.now()}`);
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await page.reload();
  // компьютер: панели нет, кнопки — в шапке
  await expect(bar(page)).toBeHidden();
  await expect(page.getByRole('banner').getByRole('button', { name: 'Расход', exact: true })).toBeVisible();

  await page.setViewportSize(PHONE);
  await expect(page.getByRole('banner').getByRole('button', { name: 'Расход', exact: true })).toBeHidden();
  await expect(bar(page).getByRole('button')).toHaveText([/Доход/, /Расход/, /Перевод/]);
  // закреплена у нижнего края во всю ширину
  const box = (await bar(page).boundingBox())!;
  expect(Math.round(box.y + box.height)).toBe(PHONE.height);
  expect(Math.round(box.width)).toBe(PHONE.width);

  // кнопка открывает форму своего типа; Esc без изменений закрывает, фокус — снова на кнопке панели
  await bar(page).getByRole('button', { name: 'Перевод', exact: true }).click();
  await expect(newForm(page).getByRole('radio', { name: 'Перевод' })).toBeChecked();
  await expect(newForm(page).getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(newForm(page)).toBeHidden();
  await expect(bar(page).getByRole('button', { name: 'Перевод', exact: true })).toBeFocused();
});
```

`e2e/operation-form.spec.ts` — правки (на телефоне кнопок шапки больше нет — форма открывается с нижней панели):

1. Найдите:

```ts
  await page.setViewportSize({ width: 390, height: 844 });
  dialog = await openForm(page, 'Расход');
```

   замените на:

```ts
  await page.setViewportSize({ width: 390, height: 844 });
  // на телефоне кнопки шапки скрыты — форма открывается с нижней панели
  await expect(page.getByRole('banner').getByRole('button', { name: 'Расход', exact: true })).toBeHidden();
  await page.getByRole('group', { name: 'Добавить операцию' }).getByRole('button', { name: 'Расход', exact: true }).click();
  dialog = form(page);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx playwright test e2e/mobile.spec.ts e2e/operation-form.spec.ts -g "390|нижняя панель"`
Expected: FAIL — нет группы «Добавить операцию».

- [ ] **Step 3: Implement**

`src/client/components/operation/OperationFormHost.tsx` — правки:

1. Найдите:

```tsx
/** Кнопки шапки «+ Доход», «- Расход», «⇄ Перевод» (§7 «Каркас»; у минуса — знак U+2212). */
export function NewOperationButtons() {
  const open = useOpenOperationForm();
  return (
    <div className="flex gap-2">
      {BUTTONS.map((b) => (
        <button
          key={b.type}
          type="button"
          aria-haspopup="dialog"
          onClick={() => open({ kind: 'create', type: b.type })}
          className={`rounded-xl px-3 py-2 text-sm font-semibold hover:brightness-110 ${b.className}`}
        >
          <span aria-hidden="true">{b.symbol}</span> {b.label}
        </button>
      ))}
    </div>
  );
}
```

   замените на:

```tsx
/**
 * Кнопки «+ Доход», «- Расход», «⇄ Перевод» (§7; у минуса — знак U+2212). `header` — в шапке, только на компьютере;
 * `bottom` — на телефоне (меньше 768 px) панель, закреплённая у нижнего края экрана (§7 «Мобильная версия»).
 */
export function NewOperationButtons({ placement = 'header' }: { placement?: 'header' | 'bottom' }) {
  const open = useOpenOperationForm();
  const buttons = BUTTONS.map((b) => (
    <button
      key={b.type}
      type="button"
      aria-haspopup="dialog"
      onClick={() => open({ kind: 'create', type: b.type })}
      className={`rounded-xl font-semibold hover:brightness-110 ${placement === 'header' ? 'px-3 py-2 text-sm' : 'px-2 py-3 text-base'} ${b.className}`}
    >
      <span aria-hidden="true">{b.symbol}</span> {b.label}
    </button>
  ));
  if (placement === 'header') return <div className="hidden gap-2 md:flex">{buttons}</div>;
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

`src/client/pages/CompanyLayout.tsx` — правки:

1. Найдите:

```tsx
        <div className="mx-4 flex items-start gap-4">
          <AccountsPanel company={company} />
          <main className="min-h-[calc(100dvh-5rem)] min-w-0 flex-1 rounded-t-3xl bg-card p-6 md:p-8">
```

   замените на:

```tsx
        <div className="flex items-start gap-4 md:mx-4">
          <AccountsPanel company={company} />
          {/* на телефоне снизу — место под закреплённую панель «Доход», «Расход», «Перевод» */}
          <main className="min-h-[calc(100dvh-5rem)] min-w-0 flex-1 rounded-t-3xl bg-card p-4 pb-[calc(6rem+env(safe-area-inset-bottom))] md:p-8">
```

2. Найдите:

```tsx
          </main>
        </div>
      </div>
    </OperationFormHost>
```

   замените на:

```tsx
          </main>
        </div>
        <NewOperationButtons placement="bottom" />
      </div>
    </OperationFormHost>
```

`src/client/components/journal/UndoToast.tsx` — правки (на телефоне тост — над нижней панелью):

1. Найдите:

```tsx
className="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex justify-center px-4"
```

   замените на:

```tsx
className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 flex justify-center px-4 md:bottom-6"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx playwright test e2e/mobile.spec.ts e2e/operation-form.spec.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test`, `npm run typecheck` и `npm run test:e2e` — зелёные.

```bash
git add src/client/components/operation/OperationFormHost.tsx src/client/pages/CompanyLayout.tsx src/client/components/journal/UndoToast.tsx e2e/mobile.spec.ts e2e/operation-form.spec.ts
git commit -m "feat: на телефоне «Доход», «Расход», «Перевод» — в панели внизу экрана, в шапке — только на компьютере

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Выезжающая панель; счета и «Всего на счетах» слева; шапка телефона

**Files:**
- Create: `src/client/lib/media.ts`, `src/client/components/focus-trap.ts`, `src/client/components/Drawer.tsx`
- Modify: `src/client/components/AccountsPanel.tsx` (замена файла целиком), `src/client/components/AppHeader.tsx`, `src/client/components/CompanySwitcher.tsx`, `src/client/pages/CompanyLayout.tsx`, `e2e/mobile.spec.ts`

**Interfaces:**
- Consumes: задача 2 (`e2e/mobile.spec.ts`: `login`, `createCompany`, `apiPost`, `PHONE`); `groupAccounts`, `useAccounts`, `useBalances`, `useProjects`, `usePreferences`, `savePreference`; `btnIcon`, `btnSmall`.
- Produces:
  - `MOBILE_QUERY = '(width < 48rem)'`, `useIsMobile(): boolean` (`src/client/lib/media.ts`);
  - `cycleTab(e: KeyboardEvent<HTMLElement>, root: HTMLElement | null): void` (`src/client/components/focus-trap.ts`) — Tab по кругу внутри окна; задача 6 подключает его к `Modal`;
  - `Drawer({ open, title, side: 'left' | 'right', onClose, children })` — `<dialog>` с названием `title`, кнопка «Закрыть»;
  - `AccountsPanel({ company })` (компьютер, как раньше) и `AccountsDrawerButton({ company })` — кнопка «Счета» (только ниже 768 px) и панель «Счета» слева; внутреннее `AccountsSummary({ company, onNavigate? })`.

- [ ] **Step 1: Write the failing test**

`e2e/mobile.spec.ts` — в конец файла:

```ts
test('счета на телефоне выезжают слева: итог и балансы; Esc, касание фона и «Закрыть» закрывают, фокус возвращается; переход по счёту', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Счета ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const kaspi = (await apiPost(page, `${base}/accounts`, { name: 'Kaspi', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 100000 })).account.id;
  await apiPost(page, `${base}/accounts`, { name: 'Сейф', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 20000 });
  await page.setViewportSize(PHONE);
  await page.reload();

  // левой панели на узком экране нет — счета открываются кнопкой в шапке
  await expect(page.getByRole('navigation', { name: 'Счета' })).toBeHidden();
  const open = page.getByRole('banner').getByRole('button', { name: 'Счета', exact: true });
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  await open.click();
  const drawer = page.getByRole('dialog', { name: 'Счета' });
  await expect(drawer).toContainText(/Всего на счетах\s*1\s200,00\s₸/);
  await expect(drawer.getByRole('link', { name: /^Kaspi/ })).toContainText(/1\s000,00\s₸/);
  await expect(drawer.getByRole('link', { name: /^Сейф/ })).toContainText(/200,00\s₸/);
  // у левого края, справа виден затемнённый фон
  await expect.poll(async () => Math.round((await drawer.boundingBox())!.x)).toBe(0);
  expect((await drawer.boundingBox())!.width).toBeLessThan(PHONE.width - 40);
  // фокус не уходит из панели на страницу под ней
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
  }

  // Esc закрывает, фокус — снова на кнопке «Счета»
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(open).toBeFocused();
  // касание затемнённого фона справа от панели закрывает; касание внутри панели — нет
  await open.click();
  await drawer.getByText('Всего на счетах').click();
  await expect(drawer).toBeVisible();
  await page.mouse.click(PHONE.width - 10, PHONE.height / 2);
  await expect(drawer).toBeHidden();
  await expect(open).toBeFocused();
  await open.click();
  await drawer.getByRole('button', { name: 'Закрыть' }).click();
  await expect(drawer).toBeHidden();
  await expect(open).toBeFocused();

  // счёт фильтрует журнал, панель закрывается
  await open.click();
  await drawer.getByRole('link', { name: /^Kaspi/ }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${cid}/log\\?account=${kaspi}$`));
  await expect(drawer).toBeHidden();

  // страница без компании (новая компания): в шапке телефона — название продукта, а не одна «Выйти»
  await page.goto('/companies/new');
  await expect(page.getByRole('banner')).toContainText('Учёт');
  await page.goto(`/c/${cid}/log`);

  // компьютер: кнопки нет, на месте левая панель
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(open).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Счета' })).toBeVisible();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test e2e/mobile.spec.ts -g "счета на телефоне"`
Expected: FAIL — в шапке нет кнопки «Счета».

- [ ] **Step 3: Implement**

`src/client/lib/media.ts`:

```ts
import { useSyncExternalStore } from 'react';

/**
 * Телефон (§7 «Мобильная версия»): ширина меньше 768 px — та же граница, что у вариантов Tailwind
 * `md:` и `max-md:` (48rem).
 */
export const MOBILE_QUERY = '(width < 48rem)';

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(MOBILE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/**
 * Узкий экран сейчас: перерисовывает компонент при повороте телефона и изменении окна. Нужен там, где
 * на телефоне показывается другой компонент (карточки вместо таблицы); оформление — классами `max-md:`.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  );
}
```

`src/client/components/focus-trap.ts`:

```ts
import type { KeyboardEvent } from 'react';

const FOCUSABLE = 'input:not([disabled]), button:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"], a[href]';

/**
 * Tab по кругу внутри модального окна (`<dialog>` после showModal() делает страницу недоступной, но Tab
 * с последнего элемента уводит фокус в адресную строку браузера): Tab с последнего видимого элемента —
 * на первый, Shift+Tab с первого — на последний. Вложенные панели (списки с поиском, сохранённые фильтры),
 * которые обработали Tab сами, отменяют событие — его не трогаем. Другие клавиши не обрабатываются.
 */
export function cycleTab(e: KeyboardEvent<HTMLElement>, root: HTMLElement | null): void {
  if (e.key !== 'Tab' || e.defaultPrevented || !root) return;
  const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
  if (items.length === 0) return;
  const edge = e.shiftKey ? items[0] : items[items.length - 1];
  if (document.activeElement !== edge) return;
  e.preventDefault();
  (e.shiftKey ? items[items.length - 1] : items[0])!.focus();
}
```

`src/client/components/Drawer.tsx`:

```tsx
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cycleTab } from './focus-trap';
import { btnIcon } from './ui';

/**
 * Выезжающая панель (§7 «Мобильная версия»): модальное окно `<dialog>` у левого или правого края экрана.
 * showModal() делает остальную страницу недоступной, Tab и Shift+Tab ходят по кругу внутри панели (не уходят
 * в адресную строку браузера); Esc, «Закрыть»
 * и касание затемнённого фона закрывают панель, фокус возвращается на кнопку, которой её открыли.
 * Отступы учитывают вырезы экрана (safe-area). Содержимое монтируется заново при каждом открытии.
 */
export function Drawer(props: { open: boolean; title: string; side: 'left' | 'right'; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  /** Нажатие началось на фоне: выделение текста, отпущенное над фоном, панель не закрывает. */
  const pressedOnBackdrop = useRef(false);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (props.open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!props.open && dialog.open) {
      dialog.close();
    }
  }, [props.open]);

  // фон (::backdrop) принадлежит самому <dialog>: щелчок по нему приходит с target === dialog,
  // а всё содержимое лежит во внутреннем блоке во всю высоту и ширину панели
  const side =
    props.side === 'left'
      ? 'ml-0 mr-auto starting:open:-translate-x-full'
      : 'ml-auto mr-0 starting:open:translate-x-full';
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onKeyDown={(e) => cycleTab(e, ref.current)}
      onPointerDown={(e) => {
        pressedOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressedOnBackdrop.current && e.target === e.currentTarget) ref.current?.close();
        pressedOnBackdrop.current = false;
      }}
      onClose={() => {
        props.onClose();
        opener.current?.focus();
      }}
      className={`my-0 h-dvh max-h-none w-[min(22rem,calc(100vw-3rem))] max-w-none bg-card p-0 text-ink shadow-2xl transition-transform duration-200 backdrop:bg-black/40 motion-reduce:transition-none ${side}`}
    >
      {props.open && (
        <div
          className={`flex h-full flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] ${props.side === 'left' ? 'pl-[env(safe-area-inset-left)]' : 'pr-[env(safe-area-inset-right)]'}`}
        >
          <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2">
            <h2 id={titleId} className="text-xl font-bold">
              {props.title}
            </h2>
            <button type="button" aria-label="Закрыть" onClick={() => ref.current?.close()} className={btnIcon}>
              <span aria-hidden="true">✕</span>
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{props.children}</div>
        </div>
      )}
    </dialog>
  );
}
```

`src/client/components/AccountsPanel.tsx` — замените файл целиком (содержимое панели — отдельный `AccountsSummary`; запросы счетов и балансов теперь в нём, поэтому свёрнутая панель их не держит):

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { formatMoney } from '../../shared/money';
import { groupAccounts } from '../lib/accounts-panel';
import { useIsMobile } from '../lib/media';
import { savePreference, useAccounts, useBalances, usePreferences, useProjects, type Company } from '../lib/queries';
import { Drawer } from './Drawer';
import { btnIcon, btnSmall } from './ui';

const PREF_KEY = 'sidebar.collapsed';

/**
 * Содержимое левой панели (§7): «Всего на счетах» в базовой валюте и счета по группам с балансами, «+ счёт».
 * Без ролей listitem, status, alert, region: их ищут e2e экранов настроек. onNavigate — переход по ссылке
 * (выезжающая панель на телефоне при этом закрывается).
 */
function AccountsSummary({ company, onNavigate }: { company: Company; onNavigate?: () => void }) {
  const accounts = useAccounts(company.id);
  const projects = useProjects(company.id);
  const balances = useBalances(company.id);
  const balanceOf = new Map((balances.data?.accounts ?? []).map((b) => [b.accountId, b.balance]));
  const groups = groupAccounts(accounts.data ?? [], projects.data ?? []);
  const total = balances.data?.total;
  const failed = balances.error ?? accounts.error ?? projects.error;

  return (
    <>
      <div className="mb-3 min-w-0">
        <p className="text-xs text-muted">Всего на счетах</p>
        <p className="truncate text-xl font-bold tabular-nums">{total ? formatMoney(total.amount, total.currency) : balances.error ? '—' : '…'}</p>
        {total?.unavailable.map((code) => (
          <p key={code} className="text-xs text-expense">
            курс {code} недоступен
          </p>
        ))}
      </div>
      {failed && (
        <p className="mb-2 text-xs text-expense">
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
          <p className="mb-1 truncate px-2 text-xs font-semibold text-muted">{g.title}</p>
          {g.items.map((a) => {
            const balance = balanceOf.get(a.id);
            return (
              <Link
                key={a.id}
                to={`/c/${company.id}/log?account=${a.id}`}
                onClick={onNavigate}
                className="flex items-baseline justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-field"
              >
                <span className="truncate">{a.name}</span>
                <span className={`shrink-0 tabular-nums ${balance !== undefined && balance < 0 ? 'text-expense' : ''}`}>
                  {balance === undefined ? '…' : formatMoney(balance, a.currency)}
                </span>
              </Link>
            );
          })}
        </div>
      ))}
      {accounts.data && groups.length === 0 && <p className="mb-3 px-2 text-sm text-muted">Счетов пока нет.</p>}
      {!company.archivedAt && (
        <Link to={`/c/${company.id}/settings/accounts`} onClick={onNavigate} className={`${btnSmall} inline-block`}>
          + счёт
        </Link>
      )}
    </>
  );
}

/**
 * Левая панель на компьютере (§7): сворачивается, состояние — в настройках пользователя.
 * На узком экране скрыта — там счета выезжают слева по кнопке в шапке (AccountsDrawerButton).
 */
export function AccountsPanel({ company }: { company: Company }) {
  const prefs = usePreferences();
  // выбор виден сразу; сохраняется в фоне, сбой сохранения не мешает работе
  const [override, setOverride] = useState<boolean | null>(null);
  const collapsed = override ?? prefs.data?.[PREF_KEY] === true;
  const toggle = () => {
    const next = !collapsed;
    setOverride(next);
    savePreference(PREF_KEY, next).catch(() => undefined);
  };

  // кнопка свёртывания одна и стоит на одном месте в обоих состояниях: фокус не теряется при сворачивании.
  // Состояние передаёт меняющаяся подпись, aria-expanded не нужен.
  return (
    <nav aria-label="Счета" className={collapsed ? 'hidden shrink-0 md:block' : 'hidden w-64 shrink-0 self-start rounded-3xl bg-card p-4 md:block'}>
      <button
        type="button"
        aria-label={collapsed ? 'Развернуть панель счетов' : 'Свернуть панель счетов'}
        onClick={toggle}
        className={`${btnIcon} ${collapsed ? '' : 'float-right ml-2'}`}
      >
        <span aria-hidden="true">{collapsed ? '»' : '«'}</span>
      </button>
      {!collapsed && <AccountsSummary company={company} />}
    </nav>
  );
}

/**
 * Счета на телефоне (§7 «Мобильная версия»): кнопка «Счета» в шапке, «Всего на счетах» и балансы выезжают
 * слева. Переход по счёту (фильтр журнала) или к «+ счёт» закрывает панель.
 */
export function AccountsDrawerButton({ company }: { company: Company }) {
  const [open, setOpen] = useState(false);
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
      <Drawer open={open} title="Счета" side="left" onClose={() => setOpen(false)}>
        <AccountsSummary company={company} onNavigate={() => setOpen(false)} />
      </Drawer>
    </>
  );
}
```

`src/client/components/AppHeader.tsx` — правки:

1. Найдите:

```tsx
    // в PWA на iPhone строка состояния прозрачная (black-translucent): шапка начинается ниже выреза экрана
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 pb-4 pt-[max(1rem,env(safe-area-inset-top))] text-white">
      <div className="flex min-w-0 items-center gap-4">
        <span className="shrink-0 text-lg font-bold">{meta.data?.appName}</span>
```

   замените на:

```tsx
    // в PWA на iPhone строка состояния прозрачная (black-translucent): шапка начинается ниже выреза экрана.
    // На телефоне — одна строка: «Счета», компания, «Выйти»; название продукта (если слева есть что-то ещё)
    // и имя пользователя — только на компьютере
    <header className="flex items-center justify-between gap-x-4 gap-y-2 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white md:flex-wrap md:px-6 md:pb-4 md:pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="flex min-w-0 items-center gap-2 md:gap-4">
        <span className={`shrink-0 text-lg font-bold ${left ? 'hidden md:inline' : ''}`}>{meta.data?.appName}</span>
```

2. Найдите:

```tsx
          <Link to={profileHref} className="text-sm text-white/70 underline-offset-4 hover:text-white hover:underline">
```

   замените на:

```tsx
          <Link to={profileHref} className="hidden text-sm text-white/70 underline-offset-4 hover:text-white hover:underline md:inline">
```

3. Найдите:

```tsx
          <span className="text-sm text-white/70">{me.data?.user.name}</span>
```

   замените на:

```tsx
          <span className="hidden text-sm text-white/70 md:inline">{me.data?.user.name}</span>
```

`src/client/components/CompanySwitcher.tsx` — правки:

1. Найдите:

```tsx
    <div ref={rootRef} className="relative min-w-0">
```

   замените на:

```tsx
    // длинное название обрезается многоточием, когда шапке не хватает ширины (телефон)
    <div ref={rootRef} className="relative min-w-0 max-w-xs">
```

2. Найдите:

```tsx
        className="flex max-w-xs items-center gap-2 rounded-xl bg-chrome-2 px-3 py-2 text-sm hover:bg-white/10"
```

   замените на:

```tsx
        className="flex max-w-full items-center gap-2 rounded-xl bg-chrome-2 px-3 py-2 text-sm hover:bg-white/10"
```

3. Найдите:

```tsx
          className="absolute left-0 z-20 mt-2 w-72 rounded-2xl bg-card p-2 text-ink shadow-xl"
```

   замените на:

```tsx
          className="absolute left-0 z-20 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-2xl bg-card p-2 text-ink shadow-xl"
```

`src/client/pages/CompanyLayout.tsx` — правки:

1. Найдите:

```tsx
import { AccountsPanel } from '../components/AccountsPanel';
```

   замените на:

```tsx
import { AccountsDrawerButton, AccountsPanel } from '../components/AccountsPanel';
```

2. Найдите:

```tsx
          left={<CompanySwitcher current={company} companies={companies.data} />}
```

   замените на:

```tsx
          left={
            <>
              <AccountsDrawerButton company={company} />
              <CompanySwitcher current={company} companies={companies.data} />
            </>
          }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx playwright test e2e/mobile.spec.ts e2e/money.spec.ts`
Expected: PASS (левая панель компьютера — как раньше, в том числе свёрнутая).

- [ ] **Step 5: Full check and commit**

Run: `npm test`, `npm run typecheck` и `npm run test:e2e` — зелёные.

```bash
git add src/client/lib/media.ts src/client/components/Drawer.tsx src/client/components/AccountsPanel.tsx src/client/components/AppHeader.tsx src/client/components/CompanySwitcher.tsx src/client/pages/CompanyLayout.tsx e2e/mobile.spec.ts
git commit -m "feat: на телефоне счета и «Всего на счетах» выезжают слева; выезжающая панель с фокусом внутри; шапка в одну строку

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Журнал карточками на телефоне; сценарий 4 §10

**Files:**
- Create: `src/client/lib/journal-card.ts`, `src/client/components/journal/JournalCards.tsx`, `tests/client/journal-card.test.ts`
- Modify: `src/client/pages/JournalPage.tsx`, `src/client/components/operation/OperationForm.tsx`, `e2e/mobile.spec.ts`, `e2e/operation-form.spec.ts`, `e2e/operation-edit.spec.ts`

**Interfaces:**
- Consumes: задачи 2–3 (`useIsMobile`, `bar`, `newForm`, `PHONE`); `JournalLookups` (`JournalTable.tsx`), `JournalItem`, `OperationLine`, `Account` (`queries.ts`); `dayLabel`, `dayOf`, `timeLabel`, `lineDimension`, `splitLabel`, `signedMoney` (`journal-format.ts`); `formatMoney`; `openForm` (план 6b).
- Produces:
  - `interface JournalCardText { title; account; details: string | null; amount; extra: string | null; date }`, `journalCardText(item, lookups, { baseCurrency, timeZone, today })` (`src/client/lib/journal-card.ts`);
  - `JournalCards({ items, lookups, baseCurrency, timeZone, today, busy, onOpenOperation })` — `<ul aria-label="Операции">`, у каждой карточки — кнопка;
  - `e2e/mobile.spec.ts`: `cards(page)` — его используют задачи 5 и 6.

- [ ] **Step 1: Write the failing tests**

`tests/client/journal-card.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { JournalLookups } from '../../src/client/components/journal/JournalTable';
import { journalCardText, type JournalCardText } from '../../src/client/lib/journal-card';
import type { Account, JournalItem, OperationLine } from '../../src/client/lib/queries';

const TZ = 'Asia/Almaty';
const ctx = { baseCurrency: 'KZT', timeZone: TZ, today: '2026-10-07' };

const account = (id: number, name: string, currency: string): Account => ({
  id,
  companyId: 1,
  projectId: null,
  name,
  currency,
  startingBalance: 0,
  openedAt: '2020-01-01',
  orderIndex: id,
  createdAt: '2020-01-01T00:00:00.000Z',
  archivedAt: null,
  hasOperations: true,
});

const lookups: JournalLookups = {
  accounts: new Map([
    [1, account(1, 'Касса', 'KZT')],
    [2, account(2, 'Валютный', 'USD')],
  ]),
  categories: new Map([
    [10, 'Аренда'],
    [11, 'Зарплата → Администраторы'],
  ]),
  projects: new Map([[20, 'Клуб Север']]),
  counterparties: new Map([[30, 'ТОО Ромашка']]),
};

const line = (categoryId: number | null, projectId: number | null, amount: number, position = 0): OperationLine => ({
  id: position + 1,
  position,
  categoryId,
  projectId,
  amount,
  baseAmount: amount,
});

const item = (patch: Partial<JournalItem>): JournalItem => ({
  id: 1,
  companyId: 1,
  type: 'expense',
  status: 'actual',
  paidAt: '2026-10-07T05:30:00.000Z', // 10:30 по Алматы
  accrualDate: null,
  accountId: 1,
  amount: 250000,
  toAccountId: null,
  toAmount: null,
  rate: '1',
  baseAmount: 250000,
  counterpartyId: null,
  comment: null,
  createdBy: 1,
  createdAt: '2026-10-07T05:30:00.000Z',
  updatedAt: '2026-10-07T05:30:00.000Z',
  version: 1,
  deletedAt: null,
  lines: [line(10, null, 250000)],
  tagIds: [],
  attachmentCount: 0,
  balanceAfter: null,
  toBalanceAfter: null,
  ...patch,
});

/** Неразрывные пробелы денег (U+00A0, U+202F) → обычные: так ожидания читаются. */
const plain = (card: JournalCardText) =>
  Object.fromEntries(Object.entries(card).map(([k, v]) => [k, v === null ? null : v.replace(/[\u00A0\u202F]/g, ' ')]));

describe('карточка операции в журнале на телефоне', () => {
  it('расход: статья, счёт, контрагент и комментарий, сумма со знаком, «сегодня» и время', () => {
    expect(plain(journalCardText(item({ counterpartyId: 30, comment: 'за октябрь' }), lookups, ctx))).toEqual({
      title: 'Аренда',
      account: 'Касса',
      details: 'ТОО Ромашка · за октябрь',
      amount: '\u22122 500,00 ₸',
      extra: null,
      date: 'сегодня 10:30',
    });
  });

  it('разбитый доход — «2 статьи»; без статьи — «Без статьи»; вчера и раньше — по дате', () => {
    const split = item({
      type: 'income',
      paidAt: '2026-10-06T03:00:00.000Z',
      lines: [line(10, 20, 100000), line(11, 20, 150000, 1)],
    });
    expect(plain(journalCardText(split, lookups, ctx))).toMatchObject({ title: '2 статьи', amount: '+2 500,00 ₸', date: 'вчера 08:00', details: null });
    const none = item({ paidAt: '2026-10-01T13:15:00.000Z', lines: [line(null, 20, 250000)] });
    expect(journalCardText(none, lookups, ctx)).toMatchObject({ title: 'Без статьи', date: '01.10.2026 18:15' });
  });

  it('перевод между валютами: оба счёта, сумма без знака и зачисление в валюте счёта получателя', () => {
    const transfer = item({ type: 'transfer', accountId: 1, toAccountId: 2, amount: 50000, toAmount: 100, lines: [] });
    expect(plain(journalCardText(transfer, lookups, ctx))).toMatchObject({
      title: 'Перевод',
      account: 'Касса → Валютный',
      amount: '500,00 ₸',
      extra: '→ 1,00 $',
    });
  });

  it('счёт не в базовой валюте — вторая строка в базовой; неизвестные справочники — «…»', () => {
    const usd = item({ accountId: 2, amount: 100, baseAmount: 50000, counterpartyId: 99, lines: [line(77, null, 100)] });
    expect(plain(journalCardText(usd, lookups, ctx))).toMatchObject({ title: '…', account: 'Валютный', amount: '\u22121,00 $', extra: '500,00 ₸', details: '…' });
    expect(journalCardText(item({ accountId: 5 }), lookups, ctx).account).toBe('…');
  });
});
```

`e2e/mobile.spec.ts` — в конец файла:

```ts
const cards = (page: Page) => page.getByRole('list', { name: 'Операции' });

test('сценарий 4 §10, ширина 390 px: расход с выражением через кнопки-операторы, журнал карточками, правка операции', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Телефон ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 1000000 });
  await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Аренда' });
  await page.reload();

  // на компьютере ряда операторов нет
  await page.getByRole('banner').getByRole('button', { name: 'Расход', exact: true }).click();
  const dialog = newForm(page);
  await expect(dialog.getByRole('textbox', { name: /^Сумма,/ })).toBeFocused();
  await expect(dialog.getByRole('group', { name: /^Операторы/ })).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await page.setViewportSize(PHONE);
  await bar(page).getByRole('button', { name: 'Расход', exact: true }).click();
  // форма — на весь экран
  const box = (await dialog.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(PHONE.width - 1);
  expect(box.height).toBeGreaterThanOrEqual(PHONE.height - 1);
  const amount = dialog.getByRole('textbox', { name: /^Сумма,/ });
  await expect(amount).toBeFocused();
  await expect(amount).toHaveAttribute('inputmode', 'decimal');
  await dialog.getByRole('button', { name: /^Статья:/ }).click();
  await dialog.getByRole('option', { name: 'Аренда', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Статья: Аренда' })).toBeVisible();
  // выражение набирается цифрами, операторы — кнопками под полем; фокус остаётся в поле
  await amount.click();
  await page.keyboard.type('1000');
  await dialog.getByRole('button', { name: 'Оператор умножение' }).click();
  await expect(amount).toBeFocused();
  await page.keyboard.type('3');
  await dialog.getByRole('button', { name: 'Оператор минус' }).click();
  await page.keyboard.type('500');
  await expect(amount).toHaveValue('1000×3\u2212500');
  await amount.blur();
  await expect(amount).toHaveValue('2500');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).toBeHidden();

  // журнал — карточки: сумма, статья, счёт, дата; таблицы и флажков выделения нет
  await expect(page.getByRole('table', { name: 'Операции' })).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  const card = cards(page).getByRole('listitem').first();
  await expect(card).toContainText(/\u22122\s500,00\s₸/);
  await expect(card).toContainText('Аренда');
  await expect(card).toContainText('Касса');
  await expect(card).toContainText(/сегодня \d\d:\d\d/);

  // правка: карточка открывает операцию на весь экран; оператор дописывается в конец суммы
  await card.getByRole('button').click();
  const edit = page.getByRole('dialog', { name: 'Изменить операцию' });
  const editAmount = edit.getByRole('textbox', { name: /^Сумма,/ });
  await expect(editAmount).toBeFocused();
  await expect(editAmount).toHaveValue('2500');
  expect((await edit.boundingBox())!.width).toBeGreaterThanOrEqual(PHONE.width - 1);
  await editAmount.click();
  await page.keyboard.press('End');
  await edit.getByRole('button', { name: 'Оператор деление' }).click();
  await page.keyboard.type('2');
  await editAmount.blur();
  await expect(editAmount).toHaveValue('1250');
  await edit.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(edit).toBeHidden();
  await expect(cards(page).getByRole('listitem')).toHaveCount(1);
  await expect(card).toContainText(/\u22121\s250,00\s₸/);
  // фокус вернулся на карточку, с которой открыли форму
  await expect(card.getByRole('button')).toBeFocused();
});

test('журнал карточками догружается при прокрутке; последняя карточка не прячется под нижней панелью', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Прокрутка ${Date.now()}`);
  const cash = (await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  for (let i = 1; i <= 55; i++) {
    await apiPost(page, `/api/v1/companies/${cid}/operations`, { type: 'income', paidAt: new Date(Date.now() - i * 60_000).toISOString(), accountId: cash, amount: i * 100, comment: `№${i}` });
  }
  await page.setViewportSize(PHONE);
  await page.reload();

  const list = cards(page).getByRole('listitem');
  await expect(list).toHaveCount(50);
  await page.getByRole('button', { name: 'Показать ещё' }).scrollIntoViewIfNeeded();
  await expect(list).toHaveCount(55);
  await expect(page.getByRole('button', { name: 'Показать ещё' })).toHaveCount(0);
  await expect(list.last()).toContainText('№55');
  // в самом низу страницы последняя карточка — над закреплённой панелью
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const last = (await list.last().boundingBox())!;
  const panelTop = (await bar(page).boundingBox())!.y;
  expect(last.y + last.height).toBeLessThanOrEqual(panelTop);
});

test('выделение из широкого окна на телефоне снимается: невидимые строки не удалить массовым действием', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Выделение ${Date.now()}`);
  const cash = (await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' })).account.id;
  await apiPost(page, `/api/v1/companies/${cid}/operations`, { type: 'income', paidAt: new Date(Date.now() - 60_000).toISOString(), accountId: cash, amount: 10000 });
  await page.reload();

  await page.getByRole('checkbox', { name: 'Выбрать все загруженные операции' }).check();
  const bulk = page.getByRole('region', { name: 'Действия с выбранными' });
  await expect(bulk).toContainText('Выбрано: 1');
  await page.setViewportSize(PHONE);
  await expect(cards(page).getByRole('listitem')).toHaveCount(1);
  await expect(bulk).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.getByRole('checkbox', { name: 'Выбрать все загруженные операции' })).not.toBeChecked();
  await expect(bulk).toHaveCount(0);
});
```

Тесты «ширина 390 px: …» планов 6a и 6b заменяются сценарием выше: они ищут строку таблицы, а на телефоне теперь карточки.

`e2e/operation-form.spec.ts` — правки:

1. Найдите (тест целиком):

```ts
test('ширина 390 px: форма на весь экран, сумма через кнопки-операторы (§10, сценарий 4)', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Телефон ${Date.now()}`);
  await apiPost(page, `/api/v1/companies/${cid}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01' });
  await page.reload();

  // на десктопе ряда операторов нет
  let dialog = await openForm(page, 'Расход');
  await expect(dialog.getByRole('group', { name: /^Операторы/ })).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  // на телефоне кнопки шапки скрыты — форма открывается с нижней панели
  await expect(page.getByRole('banner').getByRole('button', { name: 'Расход', exact: true })).toBeHidden();
  await page.getByRole('group', { name: 'Добавить операцию' }).getByRole('button', { name: 'Расход', exact: true }).click();
  dialog = form(page);
  const box = (await dialog.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(389);
  expect(box.height).toBeGreaterThanOrEqual(843);
  const amount = dialog.getByRole('textbox', { name: /^Сумма,/ });
  await expect(amount).toHaveAttribute('inputmode', 'decimal');
  await amount.click();
  await page.keyboard.type('1000');
  await dialog.getByRole('button', { name: 'Оператор умножение' }).click();
  await expect(amount).toBeFocused();
  await page.keyboard.type('3');
  await dialog.getByRole('button', { name: 'Оператор минус' }).click();
  await page.keyboard.type('500');
  await expect(amount).toHaveValue('1000×3\u2212500');
  await amount.blur();
  await expect(amount).toHaveValue('2500');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(table(page).locator('tbody tr').first()).toContainText(/2\s500,00\s₸/);
});
```

   замените на:

```ts
// Сценарий 4 §10 на ширине 390 px (создание с нижней панели и правка из карточки) — в e2e/mobile.spec.ts (план 7).
```

`e2e/operation-edit.spec.ts` — правки:

1. Найдите (тест целиком):

```ts
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
```

   замените на:

```ts
// Правка операции на ширине 390 px (сценарий 4 §10) — в e2e/mobile.spec.ts (план 7).
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/client/journal-card.test.ts`
Expected: FAIL — нет модуля `journal-card`.

Run: `npx playwright test e2e/mobile.spec.ts -g "сценарий 4|догружается|выделение"`
Expected: FAIL — на телефоне нет списка «Операции».

- [ ] **Step 3: Implement**

`src/client/lib/journal-card.ts`:

```ts
import { formatMoney } from '../../shared/money';
import type { JournalLookups } from '../components/journal/JournalTable';
import { dayLabel, dayOf, lineDimension, signedMoney, splitLabel, timeLabel } from './journal-format';
import type { JournalItem } from './queries';

/** Текст карточки операции в журнале на телефоне (§7 «Мобильная версия»: сумма, статья, счёт, дата). */
export interface JournalCardText {
  /** Статья: название, «2 статьи» у разбитой операции или «Без статьи»; у перевода — «Перевод». */
  title: string;
  /** Счёт; у перевода — «Касса → Валютный». */
  account: string;
  /** Контрагент и комментарий через « · »; если нет обоих — null. */
  details: string | null;
  /** Сумма со знаком в валюте счёта. */
  amount: string;
  /** Вторая строка суммы: зачисление перевода в другой валюте («→ 1,00 $») или сумма в базовой валюте; иначе null. */
  extra: string | null;
  /** «сегодня 10:30», «вчера 09:15», «05.10.2026 18:15» — в поясе приложения. */
  date: string;
}

export function journalCardText(
  item: JournalItem,
  lookups: JournalLookups,
  ctx: { baseCurrency: string; timeZone: string; today: string },
): JournalCardText {
  const account = lookups.accounts.get(item.accountId);
  const toAccount = item.toAccountId === null ? undefined : lookups.accounts.get(item.toAccountId);
  const currency = account?.currency ?? ctx.baseCurrency;

  let title = 'Перевод';
  if (item.type !== 'transfer') {
    const d = lineDimension(item.lines, 'categoryId');
    title = d.kind === 'many' ? splitLabel(d.count, 'category') : d.id === null ? 'Без статьи' : (lookups.categories.get(d.id) ?? '…');
  }

  const counterparty = item.counterpartyId === null ? null : (lookups.counterparties.get(item.counterpartyId) ?? '…');
  const details = [counterparty, item.comment].filter((s): s is string => !!s).join(' · ');

  let extra: string | null = null;
  if (item.type === 'transfer' && toAccount && toAccount.currency !== currency && item.toAmount !== null) {
    extra = `→ ${formatMoney(item.toAmount, toAccount.currency)}`;
  } else if (currency !== ctx.baseCurrency) {
    extra = formatMoney(item.baseAmount, ctx.baseCurrency);
  }

  return {
    title,
    account: item.type === 'transfer' ? `${account?.name ?? '…'} → ${toAccount?.name ?? '…'}` : (account?.name ?? '…'),
    details: details === '' ? null : details,
    amount: signedMoney(item.type, item.amount, currency),
    extra,
    date: `${dayLabel(dayOf(item.paidAt, ctx.timeZone), ctx.today)} ${timeLabel(item.paidAt, ctx.timeZone)}`,
  };
}
```

`src/client/components/journal/JournalCards.tsx`:

```tsx
import { journalCardText } from '../../lib/journal-card';
import type { JournalItem } from '../../lib/queries';
import type { JournalLookups } from './JournalTable';

const AMOUNT_CLASS: Record<JournalItem['type'], string> = {
  income: 'text-income',
  expense: 'text-expense',
  transfer: 'text-transfer',
};

/**
 * Журнал на телефоне (§7 «Мобильная версия»): список карточек — сумма, статья, счёт, дата (и контрагент
 * с комментарием, если есть). Карточка — кнопка: открывает операцию в форме на весь экран; после закрытия
 * формы фокус возвращается на неё. Выделения и «Указать» здесь нет — они в таблице на компьютере.
 */
export function JournalCards(props: {
  items: JournalItem[];
  lookups: JournalLookups;
  baseCurrency: string;
  timeZone: string;
  today: string;
  busy: boolean;
  onOpenOperation: (item: JournalItem) => void;
}) {
  return (
    <ul aria-label="Операции" aria-busy={props.busy} className={`divide-y divide-field ${props.busy ? 'opacity-60' : ''}`}>
      {props.items.map((item) => {
        const c = journalCardText(item, props.lookups, props);
        return (
          <li key={item.id}>
            <button
              type="button"
              data-operation-id={item.id}
              onClick={() => props.onOpenOperation(item)}
              className="flex w-full items-start justify-between gap-3 rounded-lg py-3 text-left outline-none focus-visible:bg-field/60"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{c.title}</span>
                <span className="block truncate text-sm text-muted">{c.account}</span>
                {c.details && <span className="block truncate text-xs text-muted">{c.details}</span>}
              </span>
              <span className="shrink-0 text-right tabular-nums">
                <span className={`block font-semibold ${AMOUNT_CLASS[item.type]}`}>
                  {item.type === 'transfer' && <span aria-hidden="true">⇄ </span>}
                  {c.amount}
                </span>
                {c.extra && <span className="block text-xs text-muted">{c.extra}</span>}
                <span className="block text-xs text-muted">{c.date}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
```

`src/client/pages/JournalPage.tsx` — правки:

1. Найдите:

```tsx
import { ColumnsPicker } from '../components/journal/ColumnsPicker';
```

   замените на:

```tsx
import { ColumnsPicker } from '../components/journal/ColumnsPicker';
import { JournalCards } from '../components/journal/JournalCards';
```

2. Найдите:

```tsx
import { queryClient, useMeta } from '../lib/query';
```

   замените на:

```tsx
import { useIsMobile } from '../lib/media';
import { queryClient, useMeta } from '../lib/query';
```

3. Найдите:

```tsx
  const readOnly = company.archivedAt !== null;
  const meta = useMeta();
```

   замените на:

```tsx
  const readOnly = company.archivedAt !== null;
  // телефон (§7 «Мобильная версия»): карточки вместо таблицы, без выделения и «Указать»
  const mobile = useIsMobile();
  const meta = useMeta();
```

4. Найдите:

```tsx
  const savedFilters = useSavedFilters(company.id);
```

   замените на:

```tsx
  const savedFilters = useSavedFilters(company.id);
  const openOperation = (item: { id: number }) => openForm({ kind: 'edit', id: item.id, focusAfterDelete: () => document.getElementById(HEADING_ID) });
```

5. Найдите:

```tsx
  const assigned = useRef<{ id: number; index: number } | null>(null);
```

   замените на:

```tsx
  const assigned = useRef<{ id: number; index: number } | null>(null);
  // на телефоне массовых действий нет: выделение, сделанное в широком окне, снимается — невидимое не удалить по ошибке
  useEffect(() => {
    if (mobile) setSelected(new Set());
  }, [mobile]);
```

6. Найдите:

```tsx
      {selectedIds.length > 0 && (
```

   замените на:

```tsx
      {!mobile && selectedIds.length > 0 && (
```

7. Найдите:

```tsx
      ) : (
        <JournalTable
```

   замените на:

```tsx
      ) : mobile ? (
        <JournalCards
          items={items}
          lookups={lookups}
          baseCurrency={company.baseCurrency}
          timeZone={timeZone}
          today={today}
          busy={journal.isPlaceholderData}
          onOpenOperation={openOperation}
        />
      ) : (
        <JournalTable
```

8. Найдите:

```tsx
          onOpenOperation={(item) => openForm({ kind: 'edit', id: item.id, focusAfterDelete: () => document.getElementById(HEADING_ID) })}
```

   замените на:

```tsx
          onOpenOperation={openOperation}
```

`src/client/components/operation/OperationForm.tsx` — правки (форма на весь экран не уходит под вырез экрана в PWA на iPhone):

1. Найдите:

```tsx
/** Модалка на десктопе, на телефоне (меньше 768 px) — на весь экран (§7). */
const MODAL_CLASS = 'max-w-2xl max-md:m-0 max-md:h-dvh max-md:max-h-dvh max-md:w-full max-md:max-w-none max-md:rounded-none';
```

   замените на:

```tsx
/**
 * Модалка на десктопе, на телефоне (меньше 768 px) — на весь экран (§7); в PWA на iPhone поля не уходят
 * под вырез экрана и «домашнюю» полосу (safe-area).
 */
const MODAL_CLASS =
  'max-w-2xl max-md:m-0 max-md:h-dvh max-md:max-h-dvh max-md:w-full max-md:max-w-none max-md:rounded-none max-md:pt-[env(safe-area-inset-top)] max-md:pr-[env(safe-area-inset-right)] max-md:pb-[env(safe-area-inset-bottom)] max-md:pl-[env(safe-area-inset-left)]';
```

Проверка экранирования (минус и неразрывные пробелы в тестах должны остаться `\u2212`, `\u00A0`, `\u202F`; вывода быть не должно):

Run: `node -e "for (const f of ['tests/client/journal-card.test.ts','e2e/mobile.spec.ts']) { const s=require('fs').readFileSync(f,'utf8'); if (/[\u2212\u00A0\u202F\u200B]/.test(s)) console.log('символ вместо экранирования:', f); }"`
Expected: пустой вывод.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/client/journal-card.test.ts`
Expected: PASS.

Run: `npx playwright test e2e/mobile.spec.ts e2e/operation-form.spec.ts e2e/operation-edit.spec.ts e2e/journal-actions.spec.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test`, `npm run typecheck` и `npm run test:e2e` — зелёные.

```bash
git add src/client/lib/journal-card.ts src/client/components/journal/JournalCards.tsx src/client/pages/JournalPage.tsx src/client/components/operation/OperationForm.tsx tests/client/journal-card.test.ts e2e/mobile.spec.ts e2e/operation-form.spec.ts e2e/operation-edit.spec.ts
git commit -m "feat: журнал на телефоне — карточки, касание открывает операцию на весь экран; сценарий 4 §10 на 390 px

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Фильтры журнала в выезжающей панели

**Files:**
- Create: `tests/client/journal-panel.test.ts`
- Modify: `src/client/lib/journal-filter.ts`, `src/client/components/journal/JournalToolbar.tsx`, `src/client/pages/JournalPage.tsx`, `e2e/mobile.spec.ts`

**Interfaces:**
- Consumes: задачи 3–4 (`Drawer`, `useIsMobile`, `mobile` в `JournalScreen`, `cards`); `filterConditionCount`, `JournalSortKey`, `JournalSortOrder`, `EMPTY_JOURNAL_STATE`; внутренние `SearchBox`, `AmountInput`, `PeriodPicker`, `compactInput`, `omit` в `JournalToolbar.tsx`.
- Produces:
  - `panelConditionCount(state): number`, `SORT_CHOICES: readonly { sort; order; label }[]` (`journal-filter.ts`);
  - `JournalToolbar({ …, mobile?: boolean })` — на телефоне поиск, кнопка «Фильтры · N» и панель «Фильтры» справа (поля «Период», «Сумма от, ₸», «Сумма до, ₸», «Сортировка», кнопки `actions`, «Выгрузить в Excel», «Сбросить фильтр»).

- [ ] **Step 1: Write the failing tests**

`tests/client/journal-panel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EMPTY_JOURNAL_STATE, panelConditionCount, SORT_CHOICES, type JournalUrlState } from '../../src/client/lib/journal-filter';

const state = (patch: Partial<JournalUrlState>): JournalUrlState => ({ ...EMPTY_JOURNAL_STATE, ...patch });

describe('кнопка «Фильтры» на телефоне', () => {
  it('считает спрятанное в панели: период, сумму от и до, условия окна «Фильтр»; поиск и сортировка не в счёт', () => {
    expect(panelConditionCount(EMPTY_JOURNAL_STATE)).toBe(0);
    expect(panelConditionCount(state({ q: 'аренда', sort: 'amount', order: 'asc' }))).toBe(0);
    expect(panelConditionCount(state({ period: 'month' }))).toBe(1);
    expect(panelConditionCount(state({ period: 'custom', from: '2026-10-01' }))).toBe(1);
    expect(panelConditionCount(state({ amountMin: 100, amountMax: 500 }))).toBe(2);
    // условия окна — по разделу, как у кнопки «Фильтр»: два счёта — одно условие, «без статьи» и статья — одно
    expect(panelConditionCount(state({ types: ['expense'], accountIds: [1, 2], categoryIds: [3], withoutCategory: true }))).toBe(3);
    expect(panelConditionCount(state({ period: 'today', amountMin: 0, tagIds: [7] }))).toBe(3);
  });

  it('сортировка списком: четыре варианта, без повторов', () => {
    expect(SORT_CHOICES.map((s) => `${s.sort}:${s.order}`)).toEqual(['date:desc', 'date:asc', 'amount:desc', 'amount:asc']);
  });
});
```

`e2e/mobile.spec.ts` — в конец файла:

```ts
/** Начало сегодняшнего дня по Алматы — APP_TIMEZONE e2e-сервера (с 01.03.2024 — UTC+5). */
function startOfTodayAlmaty(): number {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty' }).format(new Date());
  return Date.parse(`${day}T00:00:00+05:00`);
}

/** Момент «сегодня по Алматы»: чем больше n (0 < n < 1000), тем раньше, но всегда сегодня и не в будущем. */
const todayAgo = (n: number) => {
  const start = startOfTodayAlmaty();
  return new Date(start + (Date.now() - start) * (1 - n / 1000)).toISOString();
};

/** Вчера в полдень по Алматы. */
const yesterdayNoon = () => new Date(startOfTodayAlmaty() - 12 * 3600_000).toISOString();

test('фильтры на телефоне — в панели справа: период, сумма, сортировка, окно «Фильтр» поверх панели, сброс; поиск на виду', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Фильтры ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 1000000 })).account.id;
  await apiPost(page, `${base}/operations`, { type: 'income', paidAt: todayAgo(3), accountId: cash, amount: 50000, comment: 'выручка' });
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: todayAgo(2), accountId: cash, amount: 30000, comment: 'аренда' });
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: yesterdayNoon(), accountId: cash, amount: 10000, comment: 'вчерашний' });
  await page.setViewportSize(PHONE);
  await page.reload();

  const list = cards(page).getByRole('listitem');
  await expect(list).toHaveCount(3);
  // на виду — поиск и «Фильтры»; период, суммы и колонки спрятаны
  await expect(page.getByRole('searchbox', { name: 'Поиск' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Период' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Колонки' })).toHaveCount(0);
  const open = page.getByRole('button', { name: /^Фильтры/ });
  await expect(open).toHaveText('Фильтры');

  await open.click();
  const panel = page.getByRole('dialog', { name: 'Фильтры' });
  // выезжает справа
  await expect.poll(async () => { const b = (await panel.boundingBox())!; return Math.round(b.x + b.width); }).toBe(PHONE.width);
  await expect(panel.getByRole('button', { name: 'Колонки' })).toHaveCount(0);
  await panel.getByLabel('Период').selectOption('yesterday');
  await expect(list).toHaveCount(1);
  await expect(list.first()).toContainText('вчерашний');
  await panel.getByLabel('Период').selectOption('all');
  await expect(list).toHaveCount(3);

  // сортировка: сначала крупные
  await panel.getByLabel('Сортировка').selectOption({ label: 'Сначала крупные' });
  await expect(page).toHaveURL(/sort=amount/);
  await expect(list.first()).toContainText('выручка');

  // сумма от 200 ₸ — по Enter
  await panel.getByLabel('Сумма от, ₸').fill('200');
  await panel.getByLabel('Сумма от, ₸').press('Enter');
  await expect(list).toHaveCount(2);

  // окно «Фильтр» открывается поверх панели; «Готово» возвращает в панель
  await panel.getByRole('button', { name: 'Фильтр', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Фильтр', exact: true });
  await dialog.getByRole('checkbox', { name: 'Расход', exact: true }).check();
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await expect(dialog).toBeHidden();
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Фильтр · 1' })).toBeFocused();
  await expect(list).toHaveCount(1);
  await expect(list.first()).toContainText('аренда');

  // список сохранённых фильтров открывается внутри панели; Esc закрывает только его
  await panel.getByRole('button', { name: 'Сохранённые фильтры' }).click();
  const saved = page.getByRole('dialog', { name: 'Сохранённые фильтры' });
  await expect(saved).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(saved).toBeHidden();
  await expect(panel).toBeVisible();

  // Esc закрывает панель; на кнопке — число спрятанных условий (сумма от и тип)
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(open).toBeFocused();
  await expect(open).toHaveText('Фильтры · 2');

  // касание фона слева от панели закрывает её; «Сбросить фильтр» в панели снимает всё
  await open.click();
  await page.mouse.click(10, PHONE.height / 2);
  await expect(panel).toBeHidden();
  await open.click();
  await panel.getByRole('button', { name: 'Сбросить фильтр' }).click();
  await expect(list).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(open).toHaveText('Фильтры');

  // поиск — без панели
  await page.getByRole('searchbox', { name: 'Поиск' }).fill('вчерашн');
  await expect(list).toHaveCount(1);

  // телефон повернули или окно стало шире при открытой панели: панель закрывается, тулбар и таблица — на месте
  await open.click();
  await expect(panel).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(panel).toBeHidden();
  await expect(page.getByRole('combobox', { name: 'Период' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Операции' }).locator('tbody tr')).toHaveCount(1);
  await page.setViewportSize(PHONE);
  await expect(panel).toBeHidden();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/client/journal-panel.test.ts`
Expected: FAIL — нет `panelConditionCount`.

Run: `npx playwright test e2e/mobile.spec.ts -g "фильтры на телефоне"`
Expected: FAIL — нет кнопки «Фильтры».

- [ ] **Step 3: Implement**

`src/client/lib/journal-filter.ts` — правки:

1. Найдите:

```ts
/** Задано хоть одно условие (включая период, поиск и сумму) — сортировка не в счёт. */
```

   замените на:

```ts
/**
 * Число условий на кнопке «Фильтры» на телефоне (§7 «Мобильная версия»): всё, что спрятано в выезжающей
 * панели, — период, сумма от и до (каждая) и условия окна «Фильтр». Поиск на виду, сортировка не в счёт.
 */
export function panelConditionCount(state: JournalUrlState): number {
  return (state.period !== 'all' ? 1 : 0) + (state.amountMin !== undefined ? 1 : 0) + (state.amountMax !== undefined ? 1 : 0) + filterConditionCount(state);
}

/** Сортировка на телефоне — списком: у карточек нет заголовков колонок. */
export const SORT_CHOICES: readonly { sort: JournalSortKey; order: JournalSortOrder; label: string }[] = [
  { sort: 'date', order: 'desc', label: 'Сначала новые' },
  { sort: 'date', order: 'asc', label: 'Сначала старые' },
  { sort: 'amount', order: 'desc', label: 'Сначала крупные' },
  { sort: 'amount', order: 'asc', label: 'Сначала мелкие' },
];

/** Задано хоть одно условие (включая период, поиск и сумму) — сортировка не в счёт. */
```

`src/client/components/journal/JournalToolbar.tsx` — правки:

1. Найдите:

```tsx
import { clearFilter, isFiltered, journalApiParams, PERIODS, periodRange, SEARCH_MAX, type JournalUrlState, type PeriodKey } from '../../lib/journal-filter';
```

   замените на:

```tsx
import {
  clearFilter,
  isFiltered,
  journalApiParams,
  panelConditionCount,
  PERIODS,
  periodRange,
  SEARCH_MAX,
  SORT_CHOICES,
  type JournalUrlState,
  type PeriodKey,
} from '../../lib/journal-filter';
```

2. Найдите:

```tsx
import { Field } from '../Field';
```

   замените на:

```tsx
import { Drawer } from '../Drawer';
import { Field } from '../Field';
```

3. Найдите:

```tsx
 * Тулбар журнала (§7): период, поиск, сумма от/до в базовой валюте, выгрузка в Excel по текущему фильтру, сброс.
 * actions — кнопки модалки «Фильтр», сохранённых фильтров и колонок (их добавляют следующие задачи).
 */
```

   замените на:

```tsx
 * Тулбар журнала (§7): период, поиск, сумма от/до в базовой валюте, выгрузка в Excel по текущему фильтру, сброс.
 * actions — кнопки модалки «Фильтр», сохранённых фильтров и колонок (их добавляют следующие задачи).
 * На телефоне (`mobile`, §7 «Мобильная версия») на виду только поиск и кнопка «Фильтры · N»: остальное,
 * а также сортировка (у карточек нет заголовков колонок) — в панели, выезжающей справа.
 */
```

4. Найдите:

```tsx
  actions?: ReactNode;
}) {
  const { state, onChange } = props;
```

   замените на:

```tsx
  actions?: ReactNode;
  mobile?: boolean;
}) {
  const { state, onChange } = props;
```

5. Найдите (от `searchKey` до конца функции `JournalToolbar`):

```tsx
  const [searchKey, setSearchKey] = useState(0);

  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-3">
        <PeriodPicker state={state} today={props.today} onChange={onChange} />
        <SearchBox key={searchKey} value={state.q ?? ''} onSearch={(q) => onChange(q ? { ...state, q } : omit(state, 'q'))} />
        <AmountInput key={`min-${searchKey}`} label={`Сумма от, ${currency.symbol}`} value={state.amountMin} minorUnits={currency.minorUnits} onCommit={setAmount('amountMin')} />
        <AmountInput key={`max-${searchKey}`} label={`Сумма до, ${currency.symbol}`} value={state.amountMax} minorUnits={currency.minorUnits} onCommit={setAmount('amountMax')} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {props.actions}
        <a href={exportHref} download className={btnSmall}>
          Выгрузить в Excel
        </a>
        {isFiltered(state) && (
          <button
            type="button"
            onClick={() => {
              setSearchKey((k) => k + 1);
              onChange(clearFilter(state));
            }}
            className={btnSmall}
          >
            Сбросить фильтр
          </button>
        )}
      </div>
    </div>
  );
}
```

   замените на:

```tsx
  const [searchKey, setSearchKey] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  // окно стало шире телефона — панели нет, всё снова в тулбаре
  useEffect(() => {
    if (!props.mobile) setPanelOpen(false);
  }, [props.mobile]);

  const period = <PeriodPicker state={state} today={props.today} onChange={onChange} />;
  const search = <SearchBox key={searchKey} value={state.q ?? ''} onSearch={(q) => onChange(q ? { ...state, q } : omit(state, 'q'))} />;
  const amounts = (
    <>
      <AmountInput key={`min-${searchKey}`} label={`Сумма от, ${currency.symbol}`} value={state.amountMin} minorUnits={currency.minorUnits} onCommit={setAmount('amountMin')} />
      <AmountInput key={`max-${searchKey}`} label={`Сумма до, ${currency.symbol}`} value={state.amountMax} minorUnits={currency.minorUnits} onCommit={setAmount('amountMax')} />
    </>
  );
  const buttons = (
    <div className="flex flex-wrap items-center gap-2">
      {props.actions}
      <a href={exportHref} download className={btnSmall}>
        Выгрузить в Excel
      </a>
      {isFiltered(state) && (
        <button
          type="button"
          onClick={() => {
            setSearchKey((k) => k + 1);
            onChange(clearFilter(state));
          }}
          className={btnSmall}
        >
          Сбросить фильтр
        </button>
      )}
    </div>
  );

  if (props.mobile) {
    const count = panelConditionCount(state);
    return (
      <div className="mb-4 flex items-end gap-2">
        {search}
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={panelOpen}
          onClick={() => setPanelOpen(true)}
          className={`${btnSmall} shrink-0 py-2.5`}
        >
          Фильтры{count > 0 && ` · ${count}`}
        </button>
        <Drawer open={panelOpen} title="Фильтры" side="right" onClose={() => setPanelOpen(false)}>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-3">{period}</div>
            <div className="flex flex-wrap gap-3">{amounts}</div>
            <Field label="Сортировка" className="w-48">
              {(c) => (
                <select
                  {...c}
                  value={`${state.sort}:${state.order}`}
                  onChange={(e) => {
                    const choice = SORT_CHOICES.find((s) => `${s.sort}:${s.order}` === e.target.value);
                    if (choice) onChange({ ...state, sort: choice.sort, order: choice.order });
                  }}
                  className={compactInput}
                >
                  {SORT_CHOICES.map((s) => (
                    <option key={`${s.sort}:${s.order}`} value={`${s.sort}:${s.order}`}>
                      {s.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {buttons}
          </div>
        </Drawer>
      </div>
    );
  }

  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-3">
        {period}
        {search}
        {amounts}
      </div>
      {buttons}
    </div>
  );
}
```

`src/client/pages/JournalPage.tsx` — правки:

1. Найдите:

```tsx
        today={today}
        actions={
```

   замените на:

```tsx
        today={today}
        mobile={mobile}
        actions={
```

2. Найдите:

```tsx
            <ColumnsPicker visible={columns} />
```

   замените на:

```tsx
            {/* у карточек на телефоне колонок нет */}
            {!mobile && <ColumnsPicker visible={columns} />}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/client/journal-panel.test.ts tests/client/journal.test.ts`
Expected: PASS.

Run: `npx playwright test e2e/mobile.spec.ts e2e/journal.spec.ts`
Expected: PASS (тулбар компьютера — прежний).

- [ ] **Step 5: Full check and commit**

Run: `npm test`, `npm run typecheck` и `npm run test:e2e` — зелёные.

```bash
git add src/client/lib/journal-filter.ts src/client/components/journal/JournalToolbar.tsx src/client/pages/JournalPage.tsx tests/client/journal-panel.test.ts e2e/mobile.spec.ts
git commit -m "feat: фильтры журнала на телефоне — в панели справа: период, сумма, сортировка, «Фильтр», сохранённые, выгрузка

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Настройки, форма и окно «Фильтр» на ширине 390 px; Tab в модальных окнах; README

**Files:**
- Modify: `src/client/pages/CompanyLayout.tsx`, `src/client/pages/settings/SplitPresetsSettings.tsx`, `src/client/pages/settings/CategoriesSettings.tsx`, `src/client/components/operation/OperationForm.tsx`, `src/client/components/operation/SplitEditor.tsx`, `src/client/components/journal/FilterDialog.tsx`, `src/client/components/Modal.tsx`, `e2e/mobile.spec.ts`, `README.md`

**Interfaces:**
- Consumes: задачи 2–5 (`bar`, `newForm`, `cards`, `todayAgo`, `csrf`, `PHONE`); `cycleTab` (задача 3).
- Produces: `MobileLabel` (внутренний, `SplitPresetsSettings.tsx`) — подпись поля строки шаблона на телефоне; `Modal` — Tab по кругу внутри окна.

- [ ] **Step 1: Write the failing test**

`e2e/mobile.spec.ts` — в конец файла:

```ts
/**
 * Ни страница, ни открытые окна (`dialog[open]` — форма, «Фильтр», выезжающие панели лежат в верхнем слое,
 * ширину страницы они не меняют) не шире своей видимой области: ничего не прокручивается вбок.
 */
async function expectNoSideScroll(page: Page, where: string) {
  const boxes = await page.evaluate(() =>
    [document.documentElement, ...Array.from(document.querySelectorAll<HTMLElement>('dialog[open]'))].map((el) => ({
      what: el === document.documentElement ? 'страница' : `окно «${el.querySelector('h2')?.textContent ?? ''}»`,
      scroll: el.scrollWidth,
      client: el.clientWidth,
    })),
  );
  for (const b of boxes) expect(b.scroll, `${where}, ${b.what}: ширина содержимого ${b.scroll} px при ${b.client} px`).toBeLessThanOrEqual(b.client);
}

const SETTINGS = ['projects', 'accounts', 'categories', 'counterparties', 'tags', 'split-presets', 'rates', 'companies', 'users', 'profile', 'audit', 'backup'];

test('ширина 390 px: журнал, все разделы настроек, история с подробностями и форма не прокручиваются вбок', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await login(page);
  const cid = await createCompany(page, `ТОО Очень длинное название компании для проверки ширины ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса основная наличные', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 12345678 })).account.id;
  const rent = (await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Аренда помещения под компьютерный клуб' })).category.id;
  await apiPost(page, `${base}/categories`, { kind: 'expense', name: 'Оборудование_для_компьютерного_клуба_без_пробелов' });
  await apiPost(page, `${base}/counterparties`, { type: 'supplier', name: 'ТОО Очень длинное название поставщика оборудования' });
  await apiPost(page, `${base}/tags`, { name: 'длинный-тег-для-проверки-ширины' });
  await apiPost(page, `${base}/split-presets`, { name: 'Аренда целиком', lines: [{ categoryId: rent, projectId: null, bp: 10000 }] });
  await apiPost(page, `${base}/operations`, {
    type: 'expense',
    paidAt: todayAgo(2),
    accountId: cash,
    amount: 1234567,
    comment: 'Очень длинный комментарий к операции, чтобы проверить перенос строк в карточке журнала',
    lines: [{ categoryId: rent, projectId: null, amount: 1234567 }],
  });
  // в истории — значение без пробелов: «Было / Стало» не должны растягивать экран
  const renamed = await page.request.patch(`${base}/accounts/${cash}`, {
    data: { name: 'Касса_без_пробелов_с_очень_длинным_названием_для_проверки_ширины' },
    headers: csrf(page),
  });
  expect(renamed.status()).toBe(200);

  await page.goto(`/c/${cid}/log`);
  await expect(cards(page).getByRole('listitem')).toHaveCount(1);
  await expectNoSideScroll(page, 'журнал');

  for (const section of SETTINGS) {
    await page.goto(`/c/${cid}/settings/${section}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('main').getByText('Загрузка…')).toHaveCount(0);
    await expectNoSideScroll(page, section);
  }

  // история: подробности изменения с длинным значением
  await page.goto(`/c/${cid}/settings/audit`);
  const details = page.getByText('Подробности');
  await expect(details.first()).toBeVisible();
  for (const summary of await details.all()) await summary.click();
  await expect(page.getByRole('main')).toContainText('Касса_без_пробелов');
  await expectNoSideScroll(page, 'история с подробностями');

  // шаблон разделения в правке: строка — карточкой, у статьи вся ширина
  await page.goto(`/c/${cid}/settings/split-presets`);
  await page.getByRole('button', { name: 'Изменить', exact: true }).click();
  const category = page.getByRole('combobox', { name: 'Статья, строка 1' });
  await expect(category).toBeVisible();
  expect((await category.boundingBox())!.width).toBeGreaterThan(250);
  await expectNoSideScroll(page, 'шаблон разделения');

  // форма операции на весь экран с раскрытым блоком «Проект, теги, комментарий»
  await page.goto(`/c/${cid}/log`);
  await bar(page).getByRole('button', { name: 'Расход', exact: true }).click();
  await newForm(page).getByRole('button', { name: 'Проект, теги, комментарий' }).click();
  await expect(newForm(page).getByLabel('Комментарий')).toBeVisible();
  // счёт по умолчанию — «Касса_без_пробелов_…»: кнопка списка не растягивает форму
  await expect(newForm(page).getByRole('button', { name: /^Счёт: Касса_без_пробелов/ })).toBeVisible();
  await expectNoSideScroll(page, 'форма операции');
  const cancel = newForm(page).getByRole('button', { name: 'Отмена', exact: true });
  expect((await cancel.boundingBox())!.x + (await cancel.boundingBox())!.width).toBeLessThanOrEqual(PHONE.width);
  await page.keyboard.press('Escape');
  await expect(newForm(page)).toBeHidden();

  // окно «Фильтр» поверх панели: длинное название статьи переносится, разделы не шире экрана
  await page.getByRole('button', { name: /^Фильтры/ }).click();
  await page.getByRole('dialog', { name: 'Фильтры' }).getByRole('button', { name: 'Фильтр', exact: true }).click();
  const filter = page.getByRole('dialog', { name: 'Фильтр', exact: true });
  await expect(filter.getByRole('checkbox', { name: 'Оборудование_для_компьютерного_клуба_без_пробелов' })).toBeVisible();
  await expectNoSideScroll(page, 'окно «Фильтр»');
  const rights = await filter.locator('fieldset').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right));
  expect(Math.max(...rights)).toBeLessThanOrEqual(PHONE.width);
  // Tab и Shift+Tab ходят по кругу внутри окна: фокус не уходит на панель под ним и в адресную строку
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press(key);
      expect(await filter.evaluate((d) => d.contains(document.activeElement)), `${key} №${i + 1}`).toBe(true);
    }
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test e2e/mobile.spec.ts -g "не прокручиваются"`
Expected: FAIL — «accounts, страница: ширина содержимого … px при 390 px» (название счёта без пробелов растягивает страницу); после исправления страниц — «форма операции, окно «Новая операция»: ширина содержимого … px при 390 px».

- [ ] **Step 3: Implement**

`src/client/pages/CompanyLayout.tsx` — правки:

1. Найдите:

```tsx
          {/* на телефоне снизу — место под закреплённую панель «Доход», «Расход», «Перевод» */}
          <main className="min-h-[calc(100dvh-5rem)] min-w-0 flex-1 rounded-t-3xl bg-card p-4 pb-[calc(6rem+env(safe-area-inset-bottom))] md:p-8">
```

   замените на:

```tsx
          {/* на телефоне снизу — место под закреплённую панель «Доход», «Расход», «Перевод»; длинные слова
              без пробелов (названия, значения в истории) переносятся, а выпадающие списки не шире своего блока —
              страница не растягивается вбок */}
          <main className="min-h-[calc(100dvh-5rem)] min-w-0 flex-1 rounded-t-3xl bg-card p-4 pb-[calc(6rem+env(safe-area-inset-bottom))] max-md:[overflow-wrap:anywhere] max-md:[&_select]:max-w-full md:p-8">
```

`src/client/pages/settings/CategoriesSettings.tsx` — правки:

1. Найдите:

```tsx
                  <span className="flex flex-wrap items-center gap-2">
                    <ReorderButtons label={n.name}
```

   замените на:

```tsx
                  <span className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
                    <ReorderButtons label={n.name}
```

2. Найдите:

```tsx
      <div className="grid gap-6 lg:grid-cols-2">
        {(['income', 'expense'] as const).map((kind) => (
```

   замените на:

```tsx
      {/* колонка не шире экрана: длинное название в «Перенести в…» не растягивает страницу телефона */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
        {(['income', 'expense'] as const).map((kind) => (
```

`src/client/pages/settings/SplitPresetsSettings.tsx` — правки:

1. Найдите:

```tsx
/** Выпадающий список: архивные не предлагаются, но уже выбранный архивный элемент виден с пометкой. */
function OptionSelect(
```

   замените на:

```tsx
/** Подпись поля строки на телефоне, где заголовков таблицы нет; у полей есть свои aria-label. */
function MobileLabel({ children }: { children: string }) {
  return (
    <span aria-hidden="true" className="mb-1 block text-xs text-muted md:hidden">
      {children}
    </span>
  );
}

/** Выпадающий список: архивные не предлагаются, но уже выбранный архивный элемент виден с пометкой. */
function OptionSelect(
```

2. Найдите:

```tsx
      <table className="w-full text-sm">
        <thead>
```

   замените на:

```tsx
      {/* на телефоне строка — карточкой: статья во всю ширину, под ней проект, доля и «×» */}
      <table className="w-full text-sm max-md:block">
        <thead className="max-md:hidden">
```

3. Найдите:

```tsx
        <tbody>
          {draft.lines.map((l, i) => (
            <tr key={i}>
              <td className="pb-2 pr-2">
                <OptionSelect label={`Статья, строка ${i + 1}`}
```

   замените на:

```tsx
        <tbody className="max-md:block">
          {draft.lines.map((l, i) => (
            <tr key={i} className="max-md:mb-3 max-md:grid max-md:grid-cols-[minmax(0,1fr)_6rem_auto] max-md:items-end max-md:gap-x-2">
              <td className="pb-2 pr-2 max-md:col-span-3 max-md:pr-0">
                <MobileLabel>Статья</MobileLabel>
                <OptionSelect label={`Статья, строка ${i + 1}`}
```

4. Найдите:

```tsx
              <td className="pb-2 pr-2">
                <OptionSelect label={`Проект, строка ${i + 1}`}
```

   замените на:

```tsx
              <td className="pb-2 pr-2 max-md:pr-0">
                <MobileLabel>Проект</MobileLabel>
                <OptionSelect label={`Проект, строка ${i + 1}`}
```

5. Найдите:

```tsx
              <td className="pb-2 pr-2">
                <input
                  aria-label={`Доля %, строка ${i + 1}`}
```

   замените на:

```tsx
              <td className="pb-2 pr-2 max-md:pr-0">
                <MobileLabel>Доля, %</MobileLabel>
                <input
                  aria-label={`Доля %, строка ${i + 1}`}
```

`src/client/components/operation/OperationForm.tsx` — правки (колонка сетки без шаблона растёт по самому широкому элементу — длинное название счёта растягивало форму; `minmax(0,1fr)` держит её в ширине окна, `md:grid-cols-2` остаётся):

1. Найдите:

```tsx
noValidate aria-label="Операция" className="grid gap-4">
```

   замените на:

```tsx
noValidate aria-label="Операция" className="grid grid-cols-[minmax(0,1fr)] gap-4">
```

2. Найдите:

```tsx
      <fieldset disabled={pending} className="contents">
      <div className="grid gap-4 md:grid-cols-2">
```

   замените на:

```tsx
      <fieldset disabled={pending} className="contents">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
```

3. Найдите:

```tsx
      {!transfer && (
        <div className="grid gap-4 md:grid-cols-2">
```

   замените на:

```tsx
      {!transfer && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
```

4. Найдите:

```tsx
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={transfer ? 'Дата' : 'Дата оплаты'}
```

   замените на:

```tsx
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
        <Field label={transfer ? 'Дата' : 'Дата оплаты'}
```

5. Найдите:

```tsx
          <div className="mt-3 grid gap-4 md:grid-cols-2">
```

   замените на:

```tsx
          <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
```

`src/client/components/operation/SplitEditor.tsx` — правки:

1. Найдите:

```tsx
aria-label="Разбиение" className="grid gap-3 rounded-2xl bg-canvas p-4 md:col-span-2">
```

   замените на:

```tsx
aria-label="Разбиение" className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-2xl bg-canvas p-4 md:col-span-2">
```

2. Найдите:

```tsx
className="grid items-start gap-2 md:grid-cols-[1fr_1fr_10rem_auto]">
```

   замените на:

```tsx
className="grid grid-cols-[minmax(0,1fr)] items-start gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem_auto]">
```

`src/client/components/journal/FilterDialog.tsx` — правки:

1. Найдите:

```tsx
const checkClass = 'flex items-center gap-2 py-0.5 text-sm';
```

   замените на:

```tsx
// длинное название без пробелов переносится, а не растягивает окно (на телефоне — шириной в экран)
const checkClass = 'flex min-w-0 items-center gap-2 py-0.5 text-sm';
```

2. Найдите:

```tsx
          <span className="truncate">{o.label}</span>
```

   замените на:

```tsx
          <span className="min-w-0 [overflow-wrap:anywhere]">{o.label}</span>
```

3. Найдите:

```tsx
      <div className="grid max-h-[60dvh] gap-3 overflow-y-auto md:grid-cols-2">
```

   замените на:

```tsx
      <div className="grid max-h-[60dvh] grid-cols-[minmax(0,1fr)] gap-3 overflow-y-auto md:grid-cols-2">
```

`src/client/components/Modal.tsx` — правки (Tab по кругу внутри окна, как у выезжающих панелей):

1. Найдите:

```tsx
import { useEffect, useId, useRef, type ReactNode } from 'react';
```

   замените на:

```tsx
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cycleTab } from './focus-trap';
```

2. Найдите:

```tsx
      onKeyDown={(e) => {
        // Esc, который не обработали внутри (список с поиском закрывается сам и отменяет событие)
```

   замените на:

```tsx
      onKeyDown={(e) => {
        // Tab по кругу внутри окна: фокус не уходит в адресную строку браузера
        cycleTab(e, ref.current);
        // Esc, который не обработали внутри (список с поиском закрывается сам и отменяет событие)
```

`README.md` — правки:

1. Найдите:

```md
Сделаны шаги 1–6 этапа 1 (§11 спецификации):
```

   замените на:

```md
Сделаны шаги 1–7 этапа 1 (§11 спецификации):
```

2. Найдите:

```md
Пока нет (следующие шаги): отчёты, мобильная версия и PWA.
```

   замените на:

```md
- **Телефон и PWA (шаг 7):**
  - на экране уже 768 px журнал — карточками (сумма, статья, счёт, дата), касание открывает операцию на весь экран;
  - поиск на виду, период, суммы, сортировка, окно «Фильтр», сохранённые фильтры и выгрузка — в панели «Фильтры» справа;
  - счета и «Всего на счетах» — по кнопке «Счета» в шапке, панель выезжает слева;
  - внизу закреплены кнопки «Доход», «Расход», «Перевод»;
  - массовых действий и «Указать» на телефоне нет — они в таблице на компьютере;
  - приложение можно добавить на главный экран телефона (PWA): название — из `APP_NAME`, иконка своя; без офлайн-режима.

Пока нет (следующие шаги): отчёты.
```

3. Найдите:

```md
Подставьте свой порт. ngrok выдаст временный https-адрес. Для постоянной работы используйте режимы `cloudflare` и `ngrok` (раздел «Режимы развёртывания»).
```

   замените на:

```md
Подставьте свой порт. ngrok выдаст временный https-адрес. Для постоянной работы используйте режимы `cloudflare` и `ngrok` (раздел «Режимы развёртывания»).

### На телефоне — как приложение

Откройте постоянный https-адрес (режимы `cloudflare`, `ngrok`, `vps`) и добавьте сайт на главный экран: в Safari на iPhone — «Поделиться» → «На экран „Домой“», в Chrome на Android — меню → «Установить приложение» (или «Добавить на главный экран»). Значок открывает приложение без адресной строки. Без сети приложение не работает (офлайн-режима нет). Временный адрес ngrok для этого не годится: после перезапуска он меняется, и значок перестаёт открываться.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx playwright test e2e/mobile.spec.ts e2e/dictionaries.spec.ts e2e/operation-form.spec.ts e2e/journal.spec.ts`
Expected: PASS (на компьютере шаблоны разделения, статьи, форма и окно «Фильтр» — прежние).

- [ ] **Step 5: Full check and commit**

Run: `npm test`, `npm run typecheck` и `npm run test:e2e` — зелёные.

```bash
git add src/client/pages/CompanyLayout.tsx src/client/pages/settings/SplitPresetsSettings.tsx src/client/pages/settings/CategoriesSettings.tsx src/client/components/operation/OperationForm.tsx src/client/components/operation/SplitEditor.tsx src/client/components/journal/FilterDialog.tsx src/client/components/Modal.tsx e2e/mobile.spec.ts README.md
git commit -m "feat: настройки, форма операции и окно «Фильтр» на ширине 390 px без прокрутки вбок; Tab по кругу в модальных окнах; README — телефон и PWA

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Архивная компания — форма операции только для просмотра

**Files:**
- Modify: `src/client/components/operation/OperationForm.tsx`, `src/client/components/operation/AttachmentsField.tsx`, `src/client/pages/CompanyLayout.tsx`, `e2e/mobile.spec.ts`

**Interfaces:**
- Consumes: задачи 2–6 (`NewOperationButtons({ placement })`, `bar`, `cards`, `PHONE`); `noticeClass` (`ui.ts`); `Company.archivedAt`.
- Produces:
  - `OperationEditor`: `readOnly = p.company.archivedAt !== null` — поля недоступны, блок «Проект, теги, комментарий, файл» раскрыт, вместо кнопок — «Закрыть», сверху — «Компания в архиве — изменения недоступны.»;
  - `AttachmentsField({ …, readOnly?: boolean })` — без «+ Файл» и «Удалить файл …»;
  - `CompanyLayout`: в архивной компании нет `NewOperationButtons` ни в шапке, ни внизу.

- [ ] **Step 1: Write the failing test**

`e2e/mobile.spec.ts` — в конец файла:

```ts
test('архивная компания: форма операции только для просмотра, кнопок «Доход», «Расход», «Перевод» нет — на компьютере и на телефоне', async ({ page }) => {
  await login(page);
  const cid = await createCompany(page, `ТОО Архивная ${Date.now()}`);
  const base = `/api/v1/companies/${cid}`;
  const cash = (await apiPost(page, `${base}/accounts`, { name: 'Касса', currency: 'KZT', openedAt: '2020-01-01', startingBalance: 30000 })).account.id;
  await apiPost(page, `${base}/operations`, { type: 'expense', paidAt: new Date(Date.now() - 60_000).toISOString(), accountId: cash, amount: 30000, comment: 'до архива' });
  // в архив компанию переводят после её счетов (баланс нулевой)
  await apiPost(page, `${base}/accounts/${cash}/archive`, {});
  await apiPost(page, `${base}/archive`, {});
  await page.reload();

  // компьютер: кнопок новых операций в шапке нет, операция открывается только для просмотра
  await expect(page.getByRole('banner').getByRole('button', { name: 'Расход', exact: true })).toHaveCount(0);
  await page.getByRole('table', { name: 'Операции' }).getByRole('button', { name: /^Открыть операцию/ }).click();
  const view = page.getByRole('dialog', { name: 'Изменить операцию' });
  await expect(view).toContainText('Компания в архиве — изменения недоступны');
  await expect(view.getByRole('textbox', { name: /^Сумма,/ })).toHaveValue('300');
  await expect(view.getByRole('textbox', { name: /^Сумма,/ })).toBeDisabled();
  await expect(view.getByLabel('Комментарий')).toHaveValue('до архива');
  await expect(view.getByLabel('Комментарий')).toBeDisabled();
  for (const name of ['Сохранить', 'Сохранить и создать похожий', 'Дублировать', 'Удалить']) {
    await expect(view.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await expect(view.getByLabel('Добавить файл')).toHaveCount(0);
  await view.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(view).toBeHidden();

  // телефон: нижней панели нет, карточка открывает ту же форму для просмотра; Esc закрывает без вопросов
  await page.setViewportSize(PHONE);
  await expect(bar(page)).toHaveCount(0);
  await cards(page).getByRole('button').first().click();
  await expect(view).toContainText('Компания в архиве — изменения недоступны');
  await expect(view.getByRole('button', { name: 'Сохранить', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(view).toBeHidden();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test e2e/mobile.spec.ts -g "архивная компания"`
Expected: FAIL — в шапке архивной компании есть кнопка «Расход».

- [ ] **Step 3: Implement**

`src/client/components/operation/OperationForm.tsx` — правки:

1. Найдите:

```tsx
import { alertClass, btnDanger, btnPrimary, btnSecondary, btnSmall, inputClass } from '../ui';
```

   замените на:

```tsx
import { alertClass, btnDanger, btnPrimary, btnSecondary, btnSmall, inputClass, noticeClass } from '../ui';
```

2. Найдите:

```tsx
  const today = todayInTimezone(p.timeZone);
  const typeName = useId();
```

   замените на:

```tsx
  const today = todayInTimezone(p.timeZone);
  // архивная компания — только просмотр: поля недоступны, кнопок сохранения, удаления и файлов нет
  const readOnly = p.company.archivedAt !== null;
  const typeName = useId();
```

3. Найдите:

```tsx
  const [more, setMore] = useState(() => initial.projectId !== null || initial.tagIds.length > 0 || initial.comment !== '');
```

   замените на:

```tsx
  const [more, setMore] = useState(() => readOnly || initial.projectId !== null || initial.tagIds.length > 0 || initial.comment !== '');
```

4. Найдите:

```tsx
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit('close');
```

   замените на:

```tsx
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (readOnly) return;
    void submit('close');
```

5. Найдите:

```tsx
noValidate aria-label="Операция" className="grid grid-cols-[minmax(0,1fr)] gap-4">
```

   замените на:

```tsx
noValidate aria-label="Операция" className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {readOnly && <p className={`${noticeClass} mb-0`}>Компания в архиве — изменения недоступны.</p>}
```

6. Найдите:

```tsx
      <fieldset disabled={pending} className="contents">
```

   замените на:

```tsx
      <fieldset disabled={pending || readOnly} className="contents">
```

7. Найдите:

```tsx
            <AttachmentsField companyId={p.company.id} operationId={op?.id ?? null} pending={files} onPendingChange={setFiles} />
```

   замените на:

```tsx
            <AttachmentsField companyId={p.company.id} operationId={op?.id ?? null} pending={files} onPendingChange={setFiles} readOnly={readOnly} />
```

8. Найдите:

```tsx
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={pending} className={btnPrimary}>
```

   замените на:

```tsx
      ) : readOnly ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={p.close} className={btnSecondary}>
            Закрыть
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={pending} className={btnPrimary}>
```

`src/client/components/operation/AttachmentsField.tsx` — правки:

1. Найдите:

```tsx
  pending: File[];
  onPendingChange: (files: File[]) => void;
}) {
```

   замените на:

```tsx
  pending: File[];
  onPendingChange: (files: File[]) => void;
  /** Только просмотр (архивная компания): файлы можно скачать, но не добавить и не удалить. */
  readOnly?: boolean;
}) {
```

2. Найдите:

```tsx
                <span className="text-muted">{formatFileSize(a.size)}</span>
                <button
```

   замените на:

```tsx
                <span className="text-muted">{formatFileSize(a.size)}</span>
                {!props.readOnly && (
                <button
```

3. Найдите:

```tsx
                  onClick={() => setConfirmId(a.id)} className="text-muted hover:text-expense">
                  ×
                </button>
```

   замените на:

```tsx
                  onClick={() => setConfirmId(a.id)} className="text-muted hover:text-expense">
                  ×
                </button>
                )}
```

4. Найдите:

```tsx
      {/* поле выбора скрыто, видна подпись-кнопка; фокус с клавиатуры подсвечивает подпись */}
      <input
```

   замените на:

```tsx
      {/* поле выбора скрыто, видна подпись-кнопка; фокус с клавиатуры подсвечивает подпись */}
      {!props.readOnly && (
      <>
      <input
```

5. Найдите:

```tsx
      <span id={hintId} className="ml-2 text-xs text-muted">PNG, JPG, WEBP, HEIC, PDF, XLSX, CSV до 10 МБ</span>
```

   замените на:

```tsx
      <span id={hintId} className="ml-2 text-xs text-muted">PNG, JPG, WEBP, HEIC, PDF, XLSX, CSV до 10 МБ</span>
      </>
      )}
```

`src/client/pages/CompanyLayout.tsx` — правки:

1. Найдите:

```tsx
          actions={<NewOperationButtons />}
```

   замените на:

```tsx
          // архивная компания — только чтение: новых операций нет ни в шапке, ни в нижней панели
          actions={company.archivedAt ? undefined : <NewOperationButtons />}
```

2. Найдите:

```tsx
        <NewOperationButtons placement="bottom" />
```

   замените на:

```tsx
        {!company.archivedAt && <NewOperationButtons placement="bottom" />}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx playwright test e2e/mobile.spec.ts e2e/operation-edit.spec.ts e2e/journal-actions.spec.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test`, `npm run typecheck` и `npm run test:e2e` — зелёные (два прогона e2e подряд).

```bash
git add src/client/components/operation/OperationForm.tsx src/client/components/operation/AttachmentsField.tsx src/client/pages/CompanyLayout.tsx e2e/mobile.spec.ts
git commit -m "feat: архивная компания — форма операции только для просмотра, без кнопок новых операций

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
