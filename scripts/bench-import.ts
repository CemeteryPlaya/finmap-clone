import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/server/app';
import { loadConfig } from '../src/server/config';
import { openDb } from '../src/server/db/client';
import { runMigrations } from '../src/server/db/migrate';
import { seedCurrencies } from '../src/server/db/seed';
import { createAuditService } from '../src/server/modules/audit/service';
import { createUsersService } from '../src/server/modules/users/service';
import type { ImportCommitResult, ImportPreview } from '../src/shared/schemas/imports';
import { finmapLikeMany, finmapLikeXlsx } from '../tests/helpers/finmap-like';

// Замер импорта (§10 спецификации импорта), три свежих процесса:
// 1) «write» — синтетический файл «как у Finmap» на 16 000 строк: загрузка с проверкой, пересчёт предпросмотра и запись
//    одной транзакцией (бюджеты 3 с, 1 с, 5 с) и пик памяти процесса за всё это (бюджет 400 МБ);
// 2) «commit50k» — 50 000 строк (предел §2.3): загрузка и запись — предпросмотр, план и вставка в одной транзакции;
//    пик памяти процесса (принятый бюджет 500 МБ, решение 9 плана И-2);
// 3) «cache» — худший случай кэша проверки, три файла по 50 000 строк в трёх компаниях: пик на первом файле
//    (бюджет 500 МБ), память кэша (куча после сборки мусора, оценка §10 — около 25 МБ на файл) и пик с тремя файлами.
// Файлы — размера настоящих (§2.4): лист без сжатия, около 600 байт на строку (16 000 строк — около 9 МБ, 50 000 — около
// 29 МБ при пределе загрузки 30 МБ). Код выхода 1 — нарушен бюджет («Итог: бюджет нарушен») или замер не удался
// («Итог: ошибка замера»: исключение, неожиданный ответ, сбой дочернего процесса — дочерний процесс выходит с кодом 2,
// чтобы родитель отличил это от бюджета). Запросы идут через app.inject. npm run bench:import. Файлы собираются
// заранее, замеры идут в дочерних процессах — сборка файлов и прошлый замер не попадают в пик памяти следующего.
// Всё — во временной папке, которая удаляется в конце; папка данных приложения не трогается. Настоящие файлы владельца
// не используются. В CI не входит.

const NOW = new Date('2026-10-06T12:00:00.000Z');
const LOGIN = 'bench';
const PASSWORD = 'bench-password-1';
const HEADERS = { origin: 'http://localhost:3000', 'x-requested-with': 'fetch' };
const BUDGET_MS = { upload: 3000, preview: 1000, commit: 5000 };
/** Пик памяти процесса (§10): файл 16 000 строк — 400 МБ; 50 000 строк — принятые 500 МБ. */
const RSS_BUDGET_16K_MB = 400;
const RSS_BUDGET_50K_MB = 500;
const FILE_16K = '16k.xlsx';
const FILE_50K = '50k.xlsx';
const PHASES = ['write', 'commit50k', 'cache'] as const;
/** Код выхода дочернего процесса: бюджет нарушен — 1, замер не удался — 2. */
const EXIT_OVER_BUDGET = 1;
const EXIT_MEASURE_ERROR = 2;

type Phase = (typeof PHASES)[number];

const mb = (bytes: number) => bytes / 1024 / 1024;
/** Пик памяти процесса с его начала, МБ (resourceUsage().maxRSS — в килобайтах). */
const peakMb = () => process.resourceUsage().maxRSS / 1024;

if (process.argv[2] !== '--measure') {
  // родительский процесс: файлы на диск, каждый замер — в своём дочернем процессе с --expose-gc
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finmap-bench-import-'));
  let overBudget = false;
  let measureError = false;
  try {
    fs.writeFileSync(path.join(dir, FILE_16K), finmapLikeXlsx(finmapLikeMany(16_000, { realSize: true }), { stored: true }));
    fs.writeFileSync(path.join(dir, FILE_50K), finmapLikeXlsx(finmapLikeMany(50_000, { perDay: 40, realSize: true }), { stored: true }));
    console.log(`Замер импорта (§10 спецификации импорта), Node ${process.version}, ${os.cpus().length} ядер`);
    for (const phase of PHASES) {
      const child = spawnSync(process.execPath, [...process.execArgv, '--expose-gc', fileURLToPath(import.meta.url), '--measure', dir, phase], { stdio: 'inherit' });
      if (child.status === EXIT_OVER_BUDGET) overBudget = true;
      // код 2, другой код (непойманное исключение, нехватка памяти), сигнал или процесс не запустился — не бюджет
      else if (child.status !== 0) {
        measureError = true;
        console.log(`Ошибка замера «${phase}»: дочерний процесс — ${child.error?.message ?? (child.signal ? `сигнал ${child.signal}` : `код выхода ${child.status}`)}`);
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (measureError) console.log(`\nИтог: ошибка замера — не все замеры выполнены${overBudget ? '; бюджет нарушен' : ''}`);
  else console.log(overBudget ? '\nИтог: бюджет нарушен' : '\nИтог: все бюджеты соблюдены');
  process.exitCode = overBudget || measureError ? 1 : 0;
} else {
  const phase = PHASES.find((p) => p === process.argv[4]);
  if (!phase) {
    console.log(`Ошибка замера: неизвестный замер ${process.argv[4]}`);
    process.exitCode = EXIT_MEASURE_ERROR;
  } else {
    try {
      await measure(process.argv[3]!, phase);
    } catch (e) {
      // сбой до замеров (база, сборка приложения): непойманное исключение дало бы код 1 — как у бюджета
      console.log(`Ошибка замера: ${(e as Error).message}`);
      process.exitCode = EXIT_MEASURE_ERROR;
    }
  }
}

async function measure(dir: string, phase: Phase): Promise<void> {
  const gc = (globalThis as { gc?: () => void }).gc;
  /** Куча после сборки мусора, МБ: столько держат живые объекты (кэш проверки). */
  const heapMb = () => {
    gc?.();
    return mb(process.memoryUsage().heapUsed);
  };
  const config = loadConfig({ SESSION_SECRET: 'b'.repeat(40), DATA_DIR: path.join(dir, `data-${phase}`), RATES_SOURCE: 'fixtures' });
  fs.mkdirSync(config.dataDir, { recursive: true });
  const { sqlite, db } = openDb(config.dbPath);
  runMigrations(db);
  seedCurrencies(db);
  await createUsersService(db, createAuditService(db)).create({ login: LOGIN, name: 'Замер', password: PASSWORD }, null);
  const app = await buildApp({ config, db, sqlite, logger: false, now: () => NOW });
  await app.ready();

  const lines: string[] = [];
  let over = false;
  let failed = false;
  const report = (name: string, ms: number, budget?: number) => {
    const verdict = budget === undefined ? 'без бюджета' : ms <= budget ? `OK (бюджет ${budget} мс)` : `ПРЕВЫШЕН (бюджет ${budget} мс)`;
    if (budget !== undefined && ms > budget) over = true;
    lines.push(`${name.padEnd(48)} ${ms.toFixed(0).padStart(7)} мс   ${verdict}`);
  };
  const reportPeak = (name: string, budget: number) => {
    const peak = peakMb();
    if (peak > budget) over = true;
    lines.push(`${name}: ${peak.toFixed(0)} МБ — ${peak <= budget ? 'OK' : 'ПРЕВЫШЕН'} (бюджет ${budget} МБ)`);
  };

  try {
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: HEADERS, payload: { login: LOGIN, password: PASSWORD } });
    const sid = login.cookies.find((c) => c.name === 'sid');
    if (login.statusCode !== 200 || !sid) throw new Error(`Вход не удался: ${login.statusCode} ${login.body}`);
    const headers = { ...HEADERS, cookie: `sid=${sid.value}` };
    const company = async (name: string) => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/companies', headers, payload: { name } });
      if (res.statusCode !== 201) throw new Error(`Компания: ${res.statusCode} ${res.body}`);
      return (res.json() as { company: { id: number } }).company.id;
    };
    const upload = async (cid: number, file: Buffer) => {
      const t = performance.now();
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/companies/${cid}/imports/upload`,
        headers: { ...headers, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('замер.xlsx') },
        payload: file,
      });
      const ms = performance.now() - t;
      if (res.statusCode !== 200) throw new Error(`Загрузка: ${res.statusCode} ${res.body.slice(0, 300)}`);
      return { ms, preview: res.json() as ImportPreview };
    };
    const commit = async (cid: number, p: ImportPreview, rows: number) => {
      const t = performance.now();
      const res = await app.inject({ method: 'POST', url: `/api/v1/companies/${cid}/imports`, headers, payload: { token: p.token, accounts: [], revision: p.revision } });
      const ms = performance.now() - t;
      if (res.statusCode !== 201) throw new Error(`Запись: ${res.statusCode} ${res.body.slice(0, 300)}`);
      if ((res.json() as ImportCommitResult).counts.added !== rows) throw new Error(`Записаны не все ${rows} операций`);
      return ms;
    };

    if (phase === 'write') {
      const cid = await company('Замер импорта');
      const file = fs.readFileSync(path.join(dir, FILE_16K));
      lines.push(`Файл: 16 000 строк, ${mb(file.length).toFixed(1)} МБ`);
      const up = await upload(cid, file);
      if (!up.preview.canImport || up.preview.counts.add !== 16_000) throw new Error('Проверка файла 16 000 строк не прошла');
      report('Загрузка и проверка (upload)', up.ms, BUDGET_MS.upload);
      const t = performance.now();
      const again = await app.inject({ method: 'POST', url: `/api/v1/companies/${cid}/imports/preview`, headers, payload: { token: up.preview.token, accounts: [] } });
      if (again.statusCode !== 200) throw new Error(`Пересчёт: ${again.statusCode} ${again.body.slice(0, 300)}`);
      report('Пересчёт предпросмотра (preview)', performance.now() - t, BUDGET_MS.preview);
      report('Запись одной транзакцией (POST /imports)', await commit(cid, again.json() as ImportPreview, 16_000), BUDGET_MS.commit);
      reportPeak('Пик памяти процесса: загрузка, пересчёт и запись 16 000 строк', RSS_BUDGET_16K_MB);
    } else if (phase === 'commit50k') {
      // предел файла: предпросмотр, план и вставка 50 000 строк — внутри одной транзакции записи
      const cid = await company('Замер записи 50 000');
      const big = fs.readFileSync(path.join(dir, FILE_50K));
      lines.push(`Файл: 50 000 строк, ${mb(big.length).toFixed(1)} МБ`);
      const up = await upload(cid, big);
      if (!up.preview.canImport || up.preview.counts.add !== 50_000) throw new Error('Проверка файла 50 000 строк не прошла');
      report('Загрузка и проверка 50 000 строк', up.ms);
      report('Запись 50 000 строк одной транзакцией', await commit(cid, up.preview, 50_000));
      reportPeak('Пик памяти процесса: загрузка и запись 50 000 строк', RSS_BUDGET_50K_MB);
    } else {
      // три файла по 50 000 строк в трёх компаниях — кэш (не больше 3 файлов) держит все три
      const big = fs.readFileSync(path.join(dir, FILE_50K));
      lines.push(`Файл: 50 000 строк, ${mb(big.length).toFixed(1)} МБ`);
      const heapBefore = heapMb();
      for (let i = 1; i <= 3; i++) {
        const res = await upload(await company(`Замер кэша ${i}`), big);
        report(`Загрузка 50 000 строк, файл ${i} из 3`, res.ms);
        if (i === 1) reportPeak('Пик памяти процесса на первом файле 50 000 строк', RSS_BUDGET_50K_MB);
      }
      lines.push(`Кэш: 3 файла по 50 000 строк занимают ${(heapMb() - heapBefore).toFixed(0)} МБ кучи (оценка §10 — около 25 МБ на файл)`);
      lines.push(`Пик памяти процесса с тремя файлами в кэше: ${peakMb().toFixed(0)} МБ (без бюджета)`);
    }
  } catch (e) {
    failed = true;
    lines.push(`Ошибка замера: ${(e as Error).message}`);
  } finally {
    await app.close();
    sqlite.close();
  }

  const titles: Record<Phase, string> = { write: 'Запись 16 000 строк', commit50k: 'Запись 50 000 строк', cache: 'Худший случай кэша' };
  console.log(`\n${titles[phase]}:`);
  for (const l of lines) console.log(l);
  process.exitCode = failed ? EXIT_MEASURE_ERROR : over ? EXIT_OVER_BUDGET : 0;
}
