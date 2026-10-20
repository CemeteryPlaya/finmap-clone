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
import { excelSerial, finmapLikeRow, finmapLikeSample, finmapLikeXlsx, type FinmapLikeValue } from '../tests/helpers/finmap-like';
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
const newForm = (p: Page) => p.getByRole('dialog', { name: /^Новый (доход|расход|перевод)$/ });

const openForm = (label: 'Доход' | 'Расход' | 'Перевод') => async (p: Page) => {
  await banner(p).getByRole('button', { name: label, exact: true }).click();
  await newForm(p).getByRole('textbox', { name: /^Сумма,/ }).waitFor();
};
/** Список поля формы дохода: поле со списком (§6.6 этапа 1.5), имя — подпись поля. */
const formList = (field: string) => async (p: Page) => {
  await openForm('Доход')(p);
  await newForm(p).getByRole('combobox', { name: field, exact: true }).click();
  await p.getByRole('listbox').first().waitFor();
};

/**
 * Расход с категорией (в ячейке категории нет «Указать»): «Изменить в перевод» спросит, что будет убрано (§6.8 этапа 1.5).
 * Возвращает окно «Расход» с суммой на месте.
 */
const openCategorizedExpense = async (p: Page) => {
  // демо-данные детерминированы (seedDemo: фиксированный NOW, 400 операций); строку ищем по имени кнопки «Открыть операцию …»
  // со знаком минус (расход), а не по тексту строки: минус может стоять и в остатке счёта
  const row = table(p)
    .locator('tbody tr')
    .filter({ has: p.getByRole('button', { name: /^Открыть операцию.*\u2212/ }) })
    .filter({ has: p.locator('[data-column="category"]', { hasNotText: 'Указать' }) })
    .first();
  await row.getByRole('button', { name: /^Открыть операцию/ }).click();
  const dialog = p.getByRole('dialog', { name: 'Расход', exact: true });
  await dialog.getByRole('textbox', { name: /^Сумма,/ }).waitFor();
  return dialog;
};

/** «Ещё» → «Экспорт»: панель с раскрытым разделом «Экспортировать в» (§8.1 спецификации импорта). */
const openExportMenu = async (p: Page) => {
  await p.getByRole('button', { name: 'Ещё', exact: true }).click();
  await p.getByRole('dialog', { name: 'Ещё', exact: true }).getByRole('button', { name: 'Экспорт', exact: true }).click();
  await p.getByRole('group', { name: 'Экспортировать в' }).waitFor();
};

/** Панель «Импорт из Excel» (§5 спецификации импорта): «Импортировать» в тулбаре журнала или «Ещё» → «Импорт из Excel» на телефоне. */
const importPanel = (p: Page) => p.getByRole('dialog', { name: 'Импорт из Excel' });
const openImport = async (p: Page, phone = false) => {
  if (phone) {
    await p.getByRole('navigation', { name: 'Разделы', exact: true }).getByRole('button', { name: 'Ещё', exact: true }).click();
    await p.getByRole('dialog', { name: 'Ещё', exact: true }).getByRole('button', { name: 'Импорт из Excel' }).click();
  } else {
    await p.getByRole('main').getByRole('button', { name: 'Импортировать' }).click();
  }
  await importPanel(p).getByRole('button', { name: 'Выберите файл' }).waitFor();
};
/** Синтетический файл «как у Finmap» (tests/helpers/finmap-like.ts) — без настоящих данных; ждёт итог проверки. */
const importFile = async (p: Page, rows: FinmapLikeValue[][], expect: 'Проверка файла' | 'Найдено ошибок') => {
  await importPanel(p)
    .locator('[data-import-file]')
    .setInputFiles({ name: 'выгрузка.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: finmapLikeXlsx(rows) });
  await (expect === 'Проверка файла' ? importPanel(p).getByRole('heading', { level: 3, name: 'Проверка файла' }) : importPanel(p).getByText(/^Найдено ошибок: \d+\./)).waitFor();
};
/** Компания открытой страницы и заголовки защиты от CSRF — для запросов API из сценария. */
const apiOf = (p: Page) => {
  const url = new URL(p.url());
  return { cid: Number(/\/c\/(\d+)\//.exec(url.pathname)![1]), headers: { origin: url.origin, 'x-requested-with': 'fetch' } };
};
/** Импорт синтетического файла через API (вкладка «Импорты», §7 спецификации импорта): загрузка и запись; id импорта. */
const importViaApi = async (p: Page, name: string, rows: FinmapLikeValue[][]): Promise<number> => {
  const { cid, headers } = apiOf(p);
  const up = await p.request.post(`/api/v1/companies/${cid}/imports/upload`, {
    headers: { ...headers, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name) },
    data: finmapLikeXlsx(rows),
  });
  if (!up.ok()) throw new Error(`Загрузка: ${up.status()} ${await up.text()}`);
  const preview = (await up.json()) as { token: string; revision: string };
  const done = await p.request.post(`/api/v1/companies/${cid}/imports`, { headers, data: { token: preview.token, accounts: [], revision: preview.revision } });
  if (!done.ok()) throw new Error(`Запись: ${done.status()} ${await done.text()}`);
  return ((await done.json()) as { import: { id: number } }).import.id;
};
/** Отмена импорта через API (без изменённых операций). */
const undoViaApi = async (p: Page, importId: number) => {
  const { cid, headers } = apiOf(p);
  const res = await p.request.post(`/api/v1/companies/${cid}/imports/${importId}/undo`, { headers, data: { includeEdited: false, edited: 0 } });
  if (!res.ok()) throw new Error(`Отмена: ${res.status()} ${await res.text()}`);
};
/** Файл с ошибками строк: дата текстом, пустая сумма, строка без счёта. */
const IMPORT_ERRORS = [
  ...finmapLikeSample(),
  finmapLikeRow({ paidAt: 'вчера', amount: 1500, to: 'Касса-1' }),
  finmapLikeRow({ paidAt: excelSerial('2026-10-06', '12:00:00'), amount: null, to: 'Касса-1' }),
  finmapLikeRow({ paidAt: excelSerial('2026-10-06', '13:00:00'), amount: 700 }),
];

/**
 * Склад для снимков «Склад» (план Склад-1): склад первого проекта, три синтетических товара, поступление и продажа.
 * Повторный вызов ничего не создаёт — сценарии идут каждый в своём входе, данные общие.
 */
const seedStock = async (p: Page) => {
  const { cid, headers } = apiOf(p);
  const base = `/api/v1/companies/${cid}`;
  const get = async (url: string) => (await (await p.request.get(url)).json()) as any;
  const post = async (url: string, data: unknown) => {
    const res = await p.request.post(url, { headers, data });
    if (!res.ok()) throw new Error(`${url}: ${res.status()} ${await res.text()}`);
    return (await res.json()) as any;
  };
  if ((await get(`${base}/stock/warehouses`)).warehouses.length > 0) return;
  const project = (await get(`${base}/projects`)).projects.find((x: { archivedAt: string | null }) => !x.archivedAt);
  const warehouse = (await post(`${base}/stock/warehouses`, { projectId: project.id, name: `Бар ${project.name}` })).warehouse.id as number;
  const group = (await post(`${base}/stock/groups`, { name: 'Напитки' })).group.id as number;
  const item = async (name: string, salePrice: number, extra: Record<string, unknown> = {}) =>
    (await post(`${base}/stock/items`, { name, unit: 'pcs', salePrice, ...extra })).item.id as number;
  const cola = await item('Кола 0,5', 50_000, { groupId: group });
  const chips = await item('Чипсы', 70_000, { minQty: 5000 });
  const supplier = (await post(`${base}/counterparties`, { type: 'supplier', name: 'Поставщик А' })).counterparty.id as number;
  await post(`${base}/stock/docs`, {
    type: 'receipt',
    at: '2026-10-08T10:00:00.000Z',
    warehouseId: warehouse,
    counterpartyId: supplier,
    lines: [
      { itemId: cola, qty: 24_000, amount: 240_000 },
      { itemId: chips, qty: 3000, amount: 21_000 },
    ],
  });
  await post(`${base}/stock/docs`, { type: 'sale', at: '2026-10-09T10:00:00.000Z', warehouseId: warehouse, lines: [{ itemId: cola, qty: 6000, amount: 300_000 }] });
};
/** Второй склад (план Склад-2, перемещение): у второго неархивного проекта, если его ещё нет. */
const seedSecondWarehouse = async (p: Page) => {
  const { cid, headers } = apiOf(p);
  const base = `/api/v1/companies/${cid}`;
  const get = async (url: string) => (await (await p.request.get(url)).json()) as any;
  const warehouses = (await get(`${base}/stock/warehouses`)).warehouses as { projectId: number }[];
  if (warehouses.length > 1) return;
  const project = (await get(`${base}/projects`)).projects.find((x: { id: number; archivedAt: string | null }) => !x.archivedAt && !warehouses.some((w) => w.projectId === x.id));
  if (!project) throw new Error('Для второго склада нужен второй проект демо-компании');
  const res = await p.request.post(`${base}/stock/warehouses`, { headers, data: { projectId: project.id, name: `Бар ${project.name}` } });
  if (!res.ok()) throw new Error(`Второй склад: ${res.status()} ${await res.text()}`);
};
const stockTable = (p: Page) => p.getByRole('main').getByRole('table', { name: 'Остатки' });
/** Таблица «Денег» (план А-1) дождалась данных демо-компании: строка «Поступления» на месте. */
const cashflowReady = (p: Page) => p.getByRole('main').getByRole('table', { name: 'Деньги' }).getByRole('rowheader', { name: 'Поступления' }).waitFor();
/** «Проекты» (план А-3): таблица демо-компании дождалась данных — строка «Всего» на месте. */
const projectsReady = (p: Page) => p.getByRole('main').getByRole('table', { name: 'Проекты' }).getByRole('rowheader', { name: 'Всего', exact: true }).waitFor();
/** «Финансовые показатели» (план А-4): таблица демо-компании дождалась данных — строка «EBITDA» на месте. */
const indicatorsReady = (p: Page) => p.getByRole('main').getByRole('table', { name: 'Финансовые показатели' }).getByRole('rowheader', { name: 'EBITDA' }).waitFor();
/** Вид «график» (план А-2): рисунок отчёта и первые строки обоих списков операций под графиками загружены. */
const chartReady = async (p: Page, title: string) => {
  await p.getByRole('main').getByRole('img', { name: new RegExp(`^${title}\\. `) }).waitFor();
  for (const i of [0, 1]) await p.locator('section[data-report-operations]').nth(i).locator('tbody tr, li').first().waitFor();
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
      await p.getByRole('dialog', { name: /^Редактирование/ }).waitFor();
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
      // как на снимке Finmap 05 — правка расхода (в подписи кнопки сумма со знаком «минус» U+2212)
      await table(p).getByRole('button', { name: /^Открыть операцию.*\u2212/ }).first().click();
      const dialog = p.getByRole('dialog', { name: 'Расход', exact: true });
      await dialog.getByRole('textbox', { name: /^Сумма,/ }).waitFor();
      // окно выше экрана: прокручиваем тело вниз, чтобы на снимке были нижние строки — «Дублировать платёж», «Удалить платёж» и кнопка
      await dialog.getByRole('button', { name: 'Сохранить изменения' }).scrollIntoViewIfNeeded();
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
      const transfer = p.getByRole('dialog', { name: 'Перевод', exact: true });
      await transfer.getByRole('combobox', { name: 'На счёт', exact: true }).waitFor();
      // фокус на «На счёт» прокрутил тело вниз: возвращаем верх, чтобы на снимке были «Со счёта» и дата
      await transfer.getByRole('combobox', { name: 'Со счёта', exact: true }).evaluate((el) => {
        for (let n = el.parentElement; n; n = n.parentElement) if (n.scrollTop > 0) n.scrollTop = 0;
      });
      await p.mouse.move(0, 0);
    },
  },
  { ours: 'c06-income.png', finmap: '06-income.png', path: 'log', act: openForm('Доход') },
  {
    ours: 'c07-income-expanded.png',
    finmap: '07-income-expanded.png',
    path: 'log',
    act: async (p) => {
      await openForm('Доход')(p);
      await newForm(p).getByRole('button', { name: 'Добавить проект, тег, комментарий, файл' }).click();
    },
  },
  { ours: 'c08-income-account-dd.png', finmap: '08-income-account-dd.png', path: 'log', act: formList('На счёт') },
  { ours: 'c09-income-category-dd.png', finmap: '09-income-category-dd.png', path: 'log', act: formList('Категория') },
  {
    ours: 'c09b-category-typed.png',
    finmap: '09b-category-typed.png',
    path: 'log',
    act: async (p) => {
      // как на снимке Finmap: расход, в поле категории набрано «аре» — найденное и «+ Создать категорию „аре“» после него
      await openForm('Расход')(p);
      await newForm(p).getByRole('combobox', { name: 'Категория', exact: true }).fill('аре');
      await p.getByRole('listbox').first().waitFor();
    },
  },
  { ours: 'c10-income-counterparty-dd.png', finmap: '10-income-counterparty-dd.png', path: 'log', act: formList('Мой контрагент') },
  {
    ours: 'c11-income-project-dd.png',
    finmap: '11-income-project-dd.png',
    path: 'log',
    act: async (p) => {
      // «+ Создать проект» — первым пунктом пустого запроса
      await openForm('Доход')(p);
      await newForm(p).getByRole('button', { name: 'Добавить проект, тег, комментарий, файл' }).click();
      await newForm(p).getByRole('combobox', { name: 'Проект', exact: true }).click();
      await p.getByRole('listbox').first().waitFor();
    },
  },
  {
    ours: 'c12-income-datepicker.png',
    finmap: '12-income-datepicker.png',
    path: 'log',
    act: async (p) => {
      // календарь поля «Дата поступления денег» со строкой «Время» (§6.5)
      await openForm('Доход')(p);
      await newForm(p).getByRole('button', { name: /^Дата поступления денег:/ }).click();
      await p.getByRole('dialog', { name: 'Дата поступления денег: календарь' }).waitFor();
    },
  },
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
    ours: 'c17-period-dd.png',
    finmap: '17-period-dd.png',
    path: 'log',
    act: async (p) => {
      await p.getByRole('button', { name: /^Период:/ }).click();
      await p.getByRole('dialog', { name: 'Период', exact: true }).waitFor();
    },
  },
  {
    ours: 'c18-filter-modal.png',
    finmap: '18-filter-modal.png',
    path: 'log',
    act: async (p) => {
      await p.getByRole('button', { name: 'Фильтр', exact: true }).click();
      await p.getByRole('dialog', { name: 'Фильтры', exact: true }).waitFor();
    },
  },
  {
    ours: 'c18b-filter-saved-dd.png',
    finmap: '18b-filter-saved-dd.png',
    path: 'log',
    act: async (p) => {
      await p.getByRole('button', { name: 'Быстрые фильтры' }).click();
      await p.getByRole('dialog', { name: 'Быстрые фильтры' }).waitFor();
    },
  },
  {
    ours: 'c19-toolbar-more.png',
    finmap: '19-toolbar-more.png',
    path: 'log',
    act: async (p) => {
      await p.getByRole('button', { name: 'Ещё', exact: true }).click();
      await p.getByRole('dialog', { name: 'Ещё', exact: true }).waitFor();
    },
  },
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
  { ours: 'c28c-my-counterparties.png', finmap: '28c-my-counterparties.png', path: 'settings/counterparties?type=my' },
  { ours: 'c29-settings-Счета.png', finmap: '29-settings-Счета.png', path: 'settings/accounts' },
  { ours: 'c30-settings-Категории.png', finmap: '30-settings-Категории.png', path: 'settings/categories' },
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
  { ours: 'c31-settings-Проекты.png', finmap: '31-settings-Проекты.png', path: 'settings/projects' },
  { ours: 'c32-settings-Теги.png', finmap: '32-settings-Теги.png', path: 'settings/tags' },
  { ours: 'c33-settings-Пользователи.png', finmap: '33-settings-Пользователи.png', path: 'settings/users' },
  { ours: 'c34-settings-rates.png', finmap: '34-settings-rates.png', path: 'settings/rates' },
  { ours: 'c35-settings-backup.png', finmap: '35-settings-backup.png', path: 'settings/backup' },
  { ours: 'c36-settings-log-view.png', finmap: '36-settings-log-view.png', path: 'settings/journal' },
  // экспорт (§8 спецификации импорта): «Ещё» с раскрытым «Экспортировать в» и окно «Собрать Excel» — пары к Finmap 40 и 43
  {
    ours: 'c40-export-click.png',
    finmap: '40-export-click.png',
    path: 'log',
    act: openExportMenu,
  },
  {
    ours: 'c43-export-custom.png',
    finmap: '43-export-custom.png',
    path: 'log',
    act: async (p) => {
      await openExportMenu(p);
      await p.getByRole('group', { name: 'Экспортировать в' }).getByRole('button', { name: 'Собрать Excel', exact: true }).click();
      // превью загрузилось: первая строка операции видна
      await p.getByRole('dialog', { name: 'Собрать Excel', exact: true }).getByRole('table', { name: 'Превью файла' }).locator('tbody tr').first().waitFor();
    },
  },
  // панель «Импорт из Excel» (§11.4 спецификации импорта): пустая — пара к Finmap 42; предпросмотр и ошибки — снимков Finmap нет
  { ours: 'c42-import-excel.png', finmap: '42-import-excel.png', path: 'log', act: (p) => openImport(p) },
  {
    ours: 'c42b-import-preview.png',
    finmap: '42b-import-preview.png',
    path: 'log',
    act: async (p) => {
      await openImport(p);
      await importFile(p, finmapLikeSample(), 'Проверка файла');
      // первая группа «Будет создано» раскрыта (в демо-компании категории файла уже есть — это контрагенты)
      await importPanel(p).getByRole('button', { name: /^(Категории|Контрагенты|Проекты|Теги): \d+$/ }).first().click();
    },
  },
  {
    ours: 'c42c-import-errors.png',
    finmap: '42c-import-errors.png',
    path: 'log',
    act: async (p) => {
      await openImport(p);
      await importFile(p, IMPORT_ERRORS, 'Найдено ошибок');
    },
  },
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
  {
    ours: 'cm04-op-open.png',
    finmap: 'm04-op-open.png',
    phone: true,
    path: 'log',
    act: async (p) => {
      // как на снимке Finmap m04 — правка расхода (в карточке сумма со знаком «минус» U+2212)
      await p.getByRole('list', { name: 'Операции' }).getByRole('button').filter({ hasText: /\u2212/ }).first().click();
      await p.getByRole('dialog', { name: 'Расход', exact: true }).getByRole('textbox', { name: /^Сумма,/ }).waitFor();
      // указатель остался над строкой «Разделить платёж» — убрать, иначе на снимке hover-заливка (не различие продукта)
      await p.mouse.move(0, 0);
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
  {
    ours: 'cm06-filter.png',
    finmap: 'm06-filter.png',
    phone: true,
    path: 'log',
    act: async (p) => {
      // воронка сразу открывает окно «Фильтры» на весь экран, «Период» — первым полем (§8.5)
      await p.getByRole('main').getByRole('button', { name: /^Фильтр( · \d+)?$/ }).click();
      await p.getByRole('dialog', { name: 'Фильтры', exact: true }).waitFor();
    },
  },
  // экран «Настройки» на телефоне (§8.6); снимка Finmap нет — в index.html слева «нет снимка Finmap»
  { ours: 'cm07-settings.png', finmap: 'm07-settings.png', phone: true, path: 'settings' },
  {
    // панель импорта на телефоне 390×844 — на весь экран (§5.7 спецификации импорта); снимка Finmap нет
    ours: 'cm-import.png',
    finmap: 'm42-import.png',
    phone: true,
    path: 'log',
    act: async (p) => {
      await openImport(p, true);
      await importFile(p, finmapLikeSample(), 'Проверка файла');
    },
  },
  // «Склад» (план Склад-1): остатки, документы, форма поступления; на телефоне — «Остатки» через «Ещё»
  {
    ours: 'c44-stock-balance.png',
    finmap: '44-stock-balance.png',
    path: 'stock/balance',
    act: async (p) => {
      await seedStock(p);
      await p.reload();
      await stockTable(p).getByRole('row').filter({ hasText: 'Кола 0,5' }).first().waitFor();
      await stockTable(p).getByRole('button', { name: 'Партии: Кола 0,5' }).click();
    },
  },
  {
    ours: 'c45-stock-docs.png',
    finmap: '45-stock-docs.png',
    path: 'stock/docs',
    act: async (p) => {
      await seedStock(p);
      await p.reload();
      await p.getByRole('main').getByRole('table', { name: 'Документы' }).locator('tbody tr').first().waitFor();
    },
  },
  {
    ours: 'c46-stock-receipt-form.png',
    finmap: '46-stock-receipt-form.png',
    path: 'stock/docs',
    act: async (p) => {
      await seedStock(p);
      await p.reload();
      await p.getByRole('main').getByRole('button', { name: '+ Поступление' }).click();
      await p.getByRole('dialog', { name: 'Новое поступление' }).getByRole('group', { name: 'Строка 1' }).waitFor();
    },
  },
  {
    ours: 'cm05-stock.png',
    finmap: 'm05-stock.png',
    phone: true,
    path: 'log',
    act: async (p) => {
      await seedStock(p);
      await p.reload();
      await p.getByRole('navigation', { name: 'Разделы', exact: true }).getByRole('button', { name: 'Ещё', exact: true }).click();
      await p.getByRole('dialog', { name: 'Ещё', exact: true }).getByRole('link', { name: 'Склад' }).click();
      await stockTable(p).getByRole('row').filter({ hasText: 'Кола 0,5' }).first().waitFor();
    },
  },
  // «Склад-2»: перемещение, инвентаризация, комплект, импорт каталога. Пар в Finmap нет — имена m59–m62 заглушки, как у cm11/cm12
  {
    ours: 'c59-stock-transfer-form.png',
    finmap: 'm59-stock-transfer.png',
    path: 'stock/docs',
    act: async (p) => {
      await seedStock(p);
      await seedSecondWarehouse(p);
      await p.reload();
      await p.getByRole('main').getByRole('button', { name: '+ Перемещение' }).click();
      const form = p.getByRole('dialog', { name: 'Новое перемещение' });
      await form.getByLabel('Куда', { exact: true }).selectOption({ index: 1 });
      await form.getByRole('group', { name: 'Строка 1' }).waitFor();
    },
  },
  {
    ours: 'c60-stock-count.png',
    finmap: 'm60-stock-count.png',
    path: 'stock/docs',
    act: async (p) => {
      await seedStock(p);
      await p.reload();
      await p.getByRole('main').getByRole('button', { name: '+ Инвентаризация' }).click();
      await p.getByRole('dialog', { name: 'Новая инвентаризация' }).getByRole('button', { name: 'Начать инвентаризацию' }).click();
      const table = p.getByRole('table', { name: 'Строки инвентаризации' });
      await table.getByRole('row').filter({ hasText: 'Кола 0,5' }).waitFor();
      await p.getByLabel('Факт: Кола 0,5, шт').fill('17');
    },
  },
  {
    ours: 'c61-stock-combo.png',
    finmap: 'm61-stock-combo.png',
    path: 'stock/items',
    act: async (p) => {
      await seedStock(p);
      await p.reload();
      await p.getByRole('main').getByRole('button', { name: '+ Товар' }).click();
      const dialog = p.getByRole('dialog', { name: 'Новый товар' });
      await dialog.getByLabel('Название товара').fill('Чипсы + кола');
      await dialog.getByLabel(/^Комплект/).check();
      await dialog.getByRole('group', { name: 'Составляющая 1' }).getByLabel('Товар').selectOption({ label: 'Чипсы' });
      await dialog.getByRole('button', { name: '+ Составляющая' }).click();
      await dialog.getByRole('group', { name: 'Составляющая 2' }).getByLabel('Товар').selectOption({ label: 'Кола 0,5' });
    },
  },
  {
    ours: 'c62-stock-import.png',
    finmap: 'm62-stock-import.png',
    path: 'stock/items',
    act: async (p) => {
      await seedStock(p);
      await p.reload();
      await p.getByRole('main').getByRole('button', { name: 'Импорт из Excel' }).click();
      const dialog = p.getByRole('dialog', { name: 'Импорт товаров из Excel' });
      const csv = 'Название;Группа;Единица;Цена продажи\nСок;Напитки;л;450\nЖвачка;;;150\nВода;;ящ;300\n';
      await dialog.locator('[data-stock-import-file]').setInputFiles({ name: 'каталог.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
      await dialog.getByRole('button', { name: 'Проверить' }).click();
      await dialog.getByRole('region', { name: 'Проверка файла' }).waitFor();
    },
  },
  // «Склад-3»: «Аналитика» склада, «Динамика цен», телефон. Пар в Finmap нет — имена m63, m64, m13 заглушки
  {
    ours: 'c63-stock-analytics.png',
    finmap: 'm63-stock-analytics.png',
    path: 'stock/analytics',
    act: async (p) => {
      await seedStock(p);
      await p.reload();
      await p.getByRole('main').getByRole('table', { name: 'Аналитика по товарам' }).getByRole('row').filter({ hasText: 'Кола 0,5' }).first().waitFor();
    },
  },
  {
    ours: 'c64-stock-price-dynamics.png',
    finmap: 'm64-stock-prices.png',
    path: 'stock/analytics',
    act: async (p) => {
      await seedStock(p);
      await p.reload();
      await p.getByRole('main').getByRole('button', { name: 'Динамика цен: Кола 0,5' }).click();
      await p.getByRole('dialog', { name: 'Динамика цен: Кола 0,5' }).getByRole('table', { name: 'История цены продажи' }).waitFor();
    },
  },
  {
    ours: 'cm13-stock-analytics.png',
    finmap: 'm13-stock-analytics.png',
    phone: true,
    path: 'stock/analytics',
    act: async (p) => {
      await seedStock(p);
      await p.reload();
      await p.getByRole('main').getByRole('table', { name: 'Аналитика по товарам' }).getByRole('row').filter({ hasText: 'Кола 0,5' }).first().waitFor();
    },
  },
  // «Аналитика» (план А-1): карточки, «Деньги» таблицей, операции ячейки; на телефоне — карточки и окно «Фильтры»
  { ours: 'c47-analytics-index.png', finmap: 'analytics/00-analytic-index.png', path: 'analytics' },
  {
    ours: 'c48-cashflow-table.png',
    finmap: 'analytics/09-cashflow-table.png',
    path: 'analytics/cashflow?view=table',
    act: async (p) => {
      await cashflowReady(p);
      await p.getByRole('main').getByRole('button', { name: 'Неоперационные изменения остатка', exact: true }).click();
    },
  },
  {
    ours: 'c49-cashflow-cell.png',
    finmap: 'analytics/11-cashflow-cell-click.png',
    path: 'analytics/cashflow?view=table',
    act: async (p) => {
      await cashflowReady(p);
      // первая категория доходов с суммой за октябрь 2026 — список операций под таблицей
      await p.locator('[data-cell^="income:category:"][data-cell$="|2026-10-01"]').filter({ hasText: /[1-9]/ }).first().click();
      await p.locator('section[data-report-operations] table tbody tr').first().waitFor();
    },
  },
  {
    ours: 'cm08-analytics.png',
    finmap: 'analytics/90-mobile-index.png',
    phone: true,
    path: 'log',
    act: async (p) => {
      await p.getByRole('navigation', { name: 'Разделы', exact: true }).getByRole('button', { name: 'Ещё', exact: true }).click();
      await p.getByRole('dialog', { name: 'Ещё', exact: true }).getByRole('link', { name: 'Аналитика' }).click();
      await p.getByRole('main').getByRole('list', { name: 'Отчёты' }).waitFor();
    },
  },
  {
    ours: 'cm09-cashflow-filter.png',
    finmap: 'analytics/92-mobile-filter.png',
    phone: true,
    path: 'analytics/cashflow?view=table',
    act: async (p) => {
      await cashflowReady(p);
      await p.getByRole('main').getByRole('button', { name: /^Фильтры/ }).click();
      await p.getByRole('dialog', { name: 'Фильтры', exact: true }).getByRole('button', { name: /^Разрез:/ }).waitFor();
    },
  },
  // «Аналитика» (план А-2): «Деньги» графиком, «Прибыль» графиком и таблицей (склад демо-компании — из сценариев склада), телефон
  {
    ours: 'c50-cashflow-chart.png',
    finmap: 'analytics/01-cashflow-chart.png',
    path: 'analytics/cashflow',
    act: (p) => chartReady(p, 'Деньги'),
  },
  {
    ours: 'c51-pnl-chart.png',
    finmap: 'analytics/20-pnl-chart.png',
    path: 'analytics/pnl',
    act: async (p) => {
      await seedStock(p);
      await p.reload();
      await chartReady(p, 'Прибыль');
    },
  },
  {
    ours: 'c52-pnl-table.png',
    finmap: 'analytics/23-pnl-table.png',
    path: 'analytics/pnl?view=table',
    act: (p) => p.getByRole('main').getByRole('table', { name: 'Прибыль' }).getByRole('rowheader', { name: 'Доходы', exact: true }).waitFor(),
  },
  {
    ours: 'cm10-pnl-chart.png',
    finmap: 'analytics/91-mobile-pnl-chart.png',
    phone: true,
    path: 'analytics/pnl',
    act: (p) => chartReady(p, 'Прибыль'),
  },
  // «Аналитика» (план А-3): «Выписка по счету» первого счёта, «Проекты» (склад демо-компании — из сценариев выше), телефон.
  // У cm11 и cm12 пары в Finmap нет: имена m30 и m40 — заглушки, чтобы карта пар осталась уникальной
  {
    ours: 'c53-statement.png',
    finmap: 'analytics/30-statement.png',
    path: 'analytics/statement',
    act: (p) => p.getByRole('main').getByRole('table', { name: /^Операции: / }).locator('tbody tr').first().waitFor(),
  },
  { ours: 'c54-projects.png', finmap: 'analytics/40-projects.png', path: 'analytics/projects', act: projectsReady },
  {
    ours: 'c55-projects-categories.png',
    finmap: 'analytics/41-projects-with-categories.png',
    path: 'analytics/projects?mode=categories',
    act: async (p) => {
      await projectsReady(p);
      // операции первого проекта под таблицей — как на снимке Finmap
      await p.getByRole('main').getByRole('table', { name: 'Проекты' }).getByRole('rowheader').first().getByRole('button').click();
      await p.locator('section[data-report-operations] table tbody tr').first().waitFor();
      // курсор не оставляем над таблицей: иначе на снимке подсвечена строка
      await p.mouse.move(0, 0);
    },
  },
  {
    ours: 'cm11-statement.png',
    finmap: 'analytics/m30-statement.png',
    phone: true,
    path: 'analytics/statement',
    act: (p) => p.getByRole('main').getByRole('list', { name: /^Операции: / }).getByRole('listitem').first().waitFor(),
  },
  { ours: 'cm12-projects.png', finmap: 'analytics/m40-projects.png', phone: true, path: 'analytics/projects', act: projectsReady },
  // «Аналитика» (план А-4): «Финансовые показатели» — таблица, окно «Редактировать показатель», вкладка «История»
  { ours: 'c56-indicators.png', finmap: 'analytics/70-financial-indicators.png', path: 'analytics/indicators', act: indicatorsReady },
  {
    ours: 'c57-indicator-dialog.png',
    finmap: 'analytics/71-indicator-categories.png',
    path: 'analytics/indicators',
    act: async (p) => {
      await indicatorsReady(p);
      await p.getByRole('main').getByRole('table', { name: 'Финансовые показатели' }).getByRole('button', { name: 'Валовая прибыль', exact: true }).click();
      await p.getByRole('dialog', { name: 'Редактировать показатель' }).getByRole('button', { name: 'Сохранить' }).waitFor();
    },
  },
  {
    ours: 'c58-indicators-history.png',
    finmap: 'analytics/72-indicators-history.png',
    path: 'analytics/indicators',
    act: async (p) => {
      await indicatorsReady(p);
      // запись в истории — настройка части через API: «Себестоимость» — все категории расхода, без склада
      const { cid, headers } = apiOf(p);
      const res = await p.request.put(`/api/v1/companies/${cid}/analytics/indicators/parts/cogs`, { headers, data: { allCategories: true, categoryIds: [], includeStock: false } });
      if (!res.ok()) throw new Error(`Показатели: ${res.status()} ${await res.text()}`);
      await p.getByRole('main').getByRole('button', { name: 'История', exact: true }).click();
      await p.getByRole('main').getByRole('table', { name: 'История изменений показателей' }).getByRole('row').nth(1).waitFor();
    },
  },
  {
    // выбор одной категории в «Деньгах» (план 2026-10-20, задача 5): плашка и график только по ней. Пары в Finmap нет — m66 заглушка
    ours: 'c66-analytics-category.png',
    finmap: 'm66-analytics-category.png',
    path: 'analytics/cashflow',
    act: async (p) => {
      await chartReady(p, 'Деньги');
      const legend = p.getByRole('main').getByRole('list', { name: 'Легенда: Списания', exact: true });
      await legend.getByRole('button').first().click();
      await p.getByRole('main').getByText('Категория:').waitFor();
      // новый отчёт пришёл (у категории с подкатегориями кольцо — по подкатегориям, нажатой кнопки там нет);
      // ждём строки списка «Списания» — поступлений по расходной категории нет
      await p.waitForFunction(() => !document.querySelector('main [aria-busy="true"]'));
      await p.locator('section[data-report-operations]').nth(1).locator('tbody tr, li').first().waitFor();
    },
  },
  {
    // импорт склада (план 2026-10-20, задача 7): «Выбрать файл» с именем файла и «Скачать шаблон». Пары в Finmap нет — m67 заглушка
    ours: 'c67-stock-import-file.png',
    finmap: 'm67-stock-import-file.png',
    path: 'stock/docs',
    act: async (p) => {
      await seedStock(p);
      await p.reload();
      await p.getByRole('main').getByRole('button', { name: 'Импорт поступлений' }).click();
      const dialog = p.getByRole('dialog', { name: 'Импорт поступлений' });
      const href = await dialog.getByRole('link', { name: 'Скачать шаблон' }).getAttribute('href');
      const file = await p.request.get(href!);
      if (!file.ok()) throw new Error(`Шаблон: ${file.status()}`);
      await dialog.locator('[data-stock-import-file]').setInputFiles({ name: 'Шаблон поступлений.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: await file.body() });
      await dialog.getByRole('group', { name: 'Файл' }).getByText('Шаблон поступлений.xlsx').waitFor();
    },
  },
  {
    // вкладка «Импорты» (§7 спецификации импорта) — пара к Finmap 24 «История действий» (там снимок c24-history):
    // отменённый импорт и импорт с «Отменить». Сценарий последний: импорт меняет данные демо-компании
    ours: 'c24-history-imports.png',
    finmap: '24b-history-imports.png',
    path: 'log',
    act: async (p) => {
      await undoViaApi(p, await importViaApi(p, 'выгрузка-сентябрь.xlsx', finmapLikeSample()));
      await importViaApi(p, 'выгрузка-октябрь.xlsx', finmapLikeSample());
      // импорт и отмена шли мимо интерфейса: журнал, счета и балансы — заново
      await p.reload();
      await table(p).locator('tbody tr').first().waitFor();
      await banner(p).getByRole('button', { name: 'История действий' }).click();
      const history = p.getByRole('dialog', { name: 'История действий' });
      await history.getByRole('tab', { name: 'Импорты' }).click();
      await history.getByRole('button', { name: /^Отменить импорт «выгрузка-октябрь\.xlsx»/ }).waitFor();
    },
  },
  {
    // «Отмена» в «Истории действий» (план 2026-10-20, задача 3): окно отмены каскада из двух правок. Пары в Finmap нет —
    // m65 заглушка. Сценарий в конце: создаёт и правит операцию демо-компании
    ours: 'c65-history-undo.png',
    finmap: 'm65-history-undo.png',
    path: 'log',
    act: async (p) => {
      const { cid, headers } = apiOf(p);
      const base = `/api/v1/companies/${cid}`;
      const accounts = ((await (await p.request.get(`${base}/accounts`)).json()) as { accounts: { id: number; currency: string; archivedAt: string | null }[] }).accounts;
      const cash = accounts.find((a) => a.currency === 'KZT' && !a.archivedAt)!;
      const send = async (method: 'post' | 'patch', url: string, data: unknown) => {
        const res = await p.request[method](url, { headers, data });
        if (!res.ok()) throw new Error(`${url}: ${res.status()} ${await res.text()}`);
        return (await res.json()) as { operation: { id: number; version: number } };
      };
      const paidAt = new Date(Date.now() - 3_600_000).toISOString();
      const op = (await send('post', `${base}/operations`, { type: 'expense', paidAt, accountId: cash.id, amount: 1_000_000, comment: 'Клуб 1' })).operation;
      const v2 = (await send('patch', `${base}/operations/${op.id}`, { version: op.version, amount: 1_500_000 })).operation;
      await send('patch', `${base}/operations/${op.id}`, { version: v2.version, comment: 'Клуб 2' });
      await p.reload();
      await table(p).locator('tbody tr').first().waitFor();
      await banner(p).getByRole('button', { name: 'История действий' }).click();
      const history = p.getByRole('dialog', { name: 'История действий' });
      await history.getByRole('button', { name: /^Отмена: Изменён расход, / }).nth(1).click();
      await p.getByRole('alertdialog', { name: 'Отменить действия?' }).getByRole('list', { name: 'Что отменится' }).waitFor();
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
      await page.waitForFunction(() => !document.querySelector('main')?.textContent?.includes('Загрузка…'));
    }
    if (s.act) await s.act(page);
    // шрифты и балансы левой панели догрузились, окна не показывают «Загрузка…»: иначе снимок ловит промежуточное состояние
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(
      () => !(document.querySelector('nav[aria-label="Счета"]')?.textContent ?? '').includes('…') && ![...document.querySelectorAll('dialog[open]')].some((d) => (d.textContent ?? '').includes('Загрузка…')),
    );
    await page.screenshot({ path: path.join(outDir, s.ours), animations: 'disabled' });
  } finally {
    await page.close();
  }
}

if (FORBIDDEN_PORTS.includes(PORT)) fail(`Порт ${PORT} занят живым приложением, демо или e2e — задайте другой SHOTS_PORT.`);
fs.mkdirSync(outDir, { recursive: true });

// временная папка, база, сид и сервер — внутри try/finally: при сбое подготовки очистка всё равно выполняется
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-shots-'));
const results = new Map<string, string>();
const failed: string[] = [];
let failures = 0;
let browser: Browser | null = null;
let server: Awaited<ReturnType<typeof startServer>> | null = null;
try {
  const config = loadConfig({ SESSION_SECRET: 's'.repeat(40), DATA_DIR: dataDir, PORT: String(PORT), RATES_SOURCE: 'fixtures' });
  fs.mkdirSync(config.dataDir, { recursive: true });
  const { sqlite, db } = openDb(config.dbPath);
  try {
    runMigrations(db);
    seedCurrencies(db);
    await createUsersService(db, createAuditService(db)).create({ login: LOGIN, name: 'Владелец', password: PASSWORD }, null);
    seedDemo({ db, timezone: config.timezone, now: NOW, operations: 400 });
  } finally {
    sqlite.close();
  }
  server = await startServer(config, { logger: false });
  const base = `http://localhost:${PORT}`;
  browser = await chromium.launch();
  const first = await newContext(browser, base, false);
  const companies = (await (await first.request.get('/api/v1/companies')).json()).companies as { id: number; name: string }[];
  await first.close();
  const cid = companies.find((c) => c.name === DEMO_COMPANY)?.id;
  if (cid === undefined) throw new Error(`В демо-наборе нет компании ${DEMO_COMPANY}`);
  for (const s of SCENARIOS) {
    try {
      // на каждый снимок — новый вход: лимит запросов сервера (300 в минуту) считается на сессию, одной на все экраны не хватает
      const context = await newContext(browser, base, s.phone === true);
      try {
        await shoot(context, cid, s);
      } finally {
        await context.close();
      }
      results.set(s.finmap, 'снято');
      console.log(`✓ ${s.ours}`);
    } catch (e) {
      failures++;
      failed.push(s.ours);
      const message = (e as Error).message.split('\n')[0]!;
      results.set(s.finmap, `ошибка: ${message}`);
      console.error(`✗ ${s.ours}: ${message}`);
    }
  }
} finally {
  await browser?.close();
  await server?.stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
if (failed.length > 0) console.error(`Не сняты сценарии (${failed.length}): ${failed.join(', ')}`);

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
