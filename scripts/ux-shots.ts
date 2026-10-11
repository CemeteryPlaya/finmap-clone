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
      await table(p).getByRole('button', { name: /^Открыть операцию/ }).first().click();
      await p.getByRole('dialog', { name: /^(Доход|Расход|Перевод)$/ }).getByRole('textbox', { name: /^Сумма,/ }).waitFor();
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
      await p.getByRole('dialog', { name: /^(Доход|Расход|Перевод)$/ }).getByRole('textbox', { name: /^Сумма,/ }).waitFor();
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
