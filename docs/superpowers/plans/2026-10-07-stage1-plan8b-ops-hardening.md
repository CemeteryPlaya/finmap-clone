# Этап 1, план 8b: надёжность перед установкой у клиента — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** закрыть пункты из отложенных замечаний плана 1 («Обязательно до первой автономной установки у клиента (план шага 8)» и «Отложенные мелкие замечания → План шага 8»), которые не вошли в план 8a:
- скачок системных часов не даёт второму экземпляру захватить живой `app.lock`;
- ngrok не переподключается бесконечно при ошибках, которые повтор не исправит (`ERR_NGROK_4018` и другие коды);
- `npm run setup` не мигрирует базу под работающим приложением; `CLOUDFLARED_PATH`, указывающий на папку, отклоняется и в `npm start`; `cloudflared` записывается атомарно;
- интерфейс пересобирается после удаления файлов и смены `vite.config.ts` / `package-lock.json` (обновление через `git pull`);
- папка `data/` на Linux получает права 0700.

**Предусловие:** выполнен план 8a (`scripts/lib/run-files.ts` с `runFiles`, `scripts/run.ts` с журналом супервизора и `fs.mkdirSync(config.dataDir, { recursive: true })` после обработчиков сигналов, `npm run stop`).

**Architecture:**
- **Состояние lock** (`src/server/lock.ts`): к `free`/`held` добавлено `suspect` — PID жив, но `bootTime` другой. Это либо перезагрузка (PID достался чужому процессу), либо скачок часов при работающем приложении. Различает их занятость порта: `startServer` при `suspect` и занятом `PORT` отвечает `LockHeldError`, при свободном — перехватывает lock. `isPortFree` переезжает из `restore.ts` в `lock.ts`.
- **ngrok:** ответ с кодом `ERR_NGROK_*` — фатальный, кроме кодов занятой сессии (108, 324, 334): им 8 попыток (около трёх минут). Ошибки без кода (сеть) повторяются всегда, как раньше.
- **Остальное** — маленькие функции с тестами: `appRunning(config)`, `ensureDataDir(dir)`, обновлённые `needsClientBuild` и `ensureCloudflared`.

**Tech Stack:** как в планах 1–8a; новых пакетов нет.

**Spec:** [docs/superpowers/specs/2026-10-05-stage1-foundation-core-design.md](../specs/2026-10-05-stage1-foundation-core-design.md) — §8.1 (cloudflared, ngrok), §9.1 (один экземпляр, супервизор), §9.3, §12. Отложенные замечания: [docs/superpowers/followups/2026-10-06-stage1-plan1-followups.md](../followups/2026-10-06-stage1-plan1-followups.md).

**Ветка:** `stage1/plan1-skeleton`.

## Решения, принятые при планировании

1. **Скачок часов различается по порту, а не по новому формату lock.** Формат `{pid, bootTime}` не меняется. `isLockHeld` по-прежнему считает `suspect` свободным (его используют `run.ts` и `restore`, а `restore` уже дополнительно проверяет порт). Окончательное решение принимает `startServer`.
2. **Блокировка супервизора (`data/supervisor.lock`) порт не проверяет:** у супервизора порта нет. Если при скачке часов запустится второй супервизор, его сервер упрётся в `app.lock` и занятый порт, и супервизор завершится (код 3, план 1).
3. **Повторы ngrok — по белому списку.** Ответ сервиса ngrok с кодом ошибки повтор не исправит: токен, неподтверждённый аккаунт (`4018`), домен, тариф. Исключение — коды занятой сессии `108`, `324`, `334`: после быстрого перезапуска ngrok ещё держит прошлую сессию этого ПК. Им даётся `TRANSIENT_ATTEMPTS = 8` попыток. Номера кодов взяты из прошлых сообщений ngrok; по итогам живой проверки заказчиком список можно поправить в одном месте.
4. **`setup` сохраняет настройки, но не трогает базу, если приложение запущено** (lock сервера или супервизора, либо занят `PORT`). Он предлагает `npm run stop` и повтор. Так смена режима безопасна при работающем приложении.
5. **Пересборка интерфейса** учитывает время самих папок `src/client`, `src/shared` (удаление и переименование файла меняют его) и файлы `vite.config.ts`, `package-lock.json`, `tsconfig.json`. Хэш-метка сборки не нужна.
6. **Права 0700 — только на `data/`** (не рекурсивно): на Linux `UMask=0077` юнита (план 8a) уже даёт закрытые права новым файлам. На Windows права не трогаются.
7. **Пункт «переводить потоковый экспорт бэкапа на диск» закрыт ранее:** `exportArchive` уже пишет архив во временную папку. Здесь ничего не делаем.

## Global Constraints

- **Один экземпляр (§9.1):** lock `data/app.lock` с PID; занят живым процессом — второй экземпляр завершается с сообщением; lock несуществующего процесса устарел и перехватывается.
- **Ошибки сети ngrok** повторяются с паузой 1 → 2 → 4 … 60 с (план 1, `connectWithRetry`); секрет в сообщениях маскируется (`maskSecret`).
- **`cloudflared` (§8.1):** скачанный файл проверяется по SHA-256; свой — только через `CLOUDFLARED_PATH`.
- **Восстановление и миграции (§9.3):** не при работающем приложении.
- **Безопасность хуков среды:** shell-команды плана не содержат подстроку «.env»; собирать её из частей запрещено.
- **Завершение задачи:** зелёные `npm test` и `npm run typecheck`, коммит с трейлером `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Задач с интерфейсом нет, e2e не требуется.

## Review Focus

1. **Часы ПК сдвинулись больше чем на минуту (синхронизация времени), приложение работает, запускают второй экземпляр** — второй получает «Приложение уже запущено», живой lock не перезаписан. Тест — в задаче 1.
2. **ПК перезагрузили, PID из старого lock достался другому процессу** — приложение стартует, lock перехвачен. Тест — в задаче 1.
3. **ngrok с неподтверждённым аккаунтом (`ERR_NGROK_4018`)** — одна попытка и понятная ошибка в журнале вместо бесконечного цикла; занятая сессия после перезапуска — до 8 попыток. Тест — в задаче 2.
4. **`npm run setup` при работающем приложении** — база не мигрируется, подсказка `npm run stop`. Тест — в задаче 3 (`appRunning`: lock сервера, lock супервизора, занятый порт).
5. **`git pull` удалил файл интерфейса или обновил зависимости** — `npm start` пересобирает интерфейс. Тест — в задаче 4.

---

## Карта файлов

```
src/server/lock.ts                     # lockState, isPortFree
src/server/main.ts                     # suspect + занятый порт → LockHeldError; ensureDataDir
src/server/data-dir.ts                 # (новый) ensureDataDir
src/server/modules/backup/restore.ts   # isPortFree — из lock.ts
scripts/lib/ngrok.ts                   # белый список повторов
scripts/lib/cloudflared.ts             # проверка CLOUDFLARED_PATH, атомарная запись
scripts/lib/app-running.ts             # (новый) appRunning
scripts/lib/client-build.ts            # время папок и конфигов
scripts/run.ts                         # CLOUDFLARED_PATH через checkCloudflaredPath; ensureDataDir
scripts/setup.ts                       # отказ мигрировать при работающем приложении; ensureDataDir
tests/server/lock.test.ts, main.test.ts, ngrok.test.ts, cloudflared.test.ts, client-build.test.ts   # дополнены
tests/server/app-running.test.ts, data-dir.test.ts                                                    # (новые)
```

---

### Task 1: Скачок системных часов и `app.lock`

**Files:**
- Modify: `src/server/lock.ts`, `src/server/main.ts`, `src/server/modules/backup/restore.ts`, `tests/server/lock.test.ts`, `tests/server/main.test.ts`

**Interfaces:**
- Consumes: `readLock`, `isStale`, `isPidAlive`, `LockHeldError` (`src/server/lock.ts`, план 1).
- Produces:
  - `type LockState = { kind: 'free' } | { kind: 'held'; pid: number } | { kind: 'suspect'; pid: number }`;
  - `lockState(lockPath: string): LockState`;
  - `isPortFree(host: string, port: number): Promise<boolean>` — экспорт из `src/server/lock.ts` (из `restore.ts` удаляется);
  - `startServer` при `suspect` и занятом порту бросает `LockHeldError(pid, lockPath)`, lock не трогает.

- [ ] **Step 1: Write the failing tests**

`tests/server/lock.test.ts` — импорты замените на:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import net from 'node:net';
import { acquireLock, currentBootTime, isLockHeld, isPortFree, LockHeldError, lockState, readLockPid } from '../../src/server/lock';
```

и добавьте в конец файла:

```ts
describe('lockState: скачок часов и перезагрузка', () => {
  it('нет файла, мёртвый PID, свой PID — free; живой из этой загрузки — held', () => {
    expect(lockState(lock)).toEqual({ kind: 'free' });
    fs.writeFileSync(lock, JSON.stringify({ pid: 999999, bootTime: currentBootTime() }));
    expect(lockState(lock)).toEqual({ kind: 'free' });
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, bootTime: currentBootTime() }));
    expect(lockState(lock)).toEqual({ kind: 'free' });
    fs.writeFileSync(lock, JSON.stringify({ pid: process.ppid, bootTime: currentBootTime() }));
    expect(lockState(lock)).toEqual({ kind: 'held', pid: process.ppid });
  });

  it('живой PID с другим bootTime — suspect (часы сдвинулись или PID достался другому процессу)', () => {
    fs.writeFileSync(lock, JSON.stringify({ pid: process.ppid, bootTime: currentBootTime() - 3600 }));
    expect(lockState(lock)).toEqual({ kind: 'suspect', pid: process.ppid });
    expect(isLockHeld(lock)).toBe(false);
  });
});

describe('isPortFree', () => {
  it('занятый порт — false, освобождённый — true', async () => {
    const srv = net.createServer();
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as net.AddressInfo).port;
    expect(await isPortFree('127.0.0.1', port)).toBe(false);
    await new Promise<void>((r) => srv.close(() => r()));
    expect(await isPortFree('127.0.0.1', port)).toBe(true);
  });
});
```

`tests/server/main.test.ts` — после `it('не стартует второй экземпляр при живом lock', …)` (в файле уже импортированы `net`, `currentBootTime`, `LockHeldError`, `testConfig`):

```ts
  it('скачок часов: живой lock с другим bootTime и занятый порт — второй экземпляр не стартует', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-main-'));
    const blocker = net.createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
    try {
      const port = (blocker.address() as net.AddressInfo).port;
      const config = testConfig(dir, { PORT: String(port) });
      fs.mkdirSync(config.dataDir, { recursive: true });
      const suspect = JSON.stringify({ pid: process.ppid, bootTime: currentBootTime() - 3600 });
      fs.writeFileSync(config.lockPath, suspect);
      await expect(startServer(config, { logger: false, handleSignals: false })).rejects.toBeInstanceOf(LockHeldError);
      expect(fs.readFileSync(config.lockPath, 'utf8')).toBe(suspect);
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()));
    }
  });

  it('после перезагрузки: живой lock с другим bootTime и свободный порт — lock перехватывается', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-main-'));
    const config = testConfig(dir, { PORT: '0' });
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(config.lockPath, JSON.stringify({ pid: process.ppid, bootTime: currentBootTime() - 3600 }));
    const s = await startServer(config, { logger: false, handleSignals: false });
    try {
      expect((JSON.parse(fs.readFileSync(config.lockPath, 'utf8')) as { pid: number }).pid).toBe(process.pid);
    } finally {
      await s.stop();
    }
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/lock.test.ts tests/server/main.test.ts`
Expected: FAIL — `lockState`/`isPortFree` не экспортируются; «скачок часов» отклоняется с `EADDRINUSE`, а не `LockHeldError`, и lock перезаписан.

- [ ] **Step 3: Implement**

`src/server/lock.ts` — импорт `import net from 'node:net';` после `import fs from 'node:fs';` и перед `export function isLockHeld(…)`:

```ts
/**
 * Состояние lock: free — нет или процесс мёртв (или это мы); held — жив и из этой загрузки системы;
 * suspect — PID жив, но bootTime другой. Это либо перезагрузка (PID достался чужому процессу),
 * либо скачок системных часов больше чем на минуту при работающем приложении — различить можно
 * только по занятому порту (см. startServer).
 */
export type LockState = { kind: 'free' } | { kind: 'held'; pid: number } | { kind: 'suspect'; pid: number };

export function lockState(lockPath: string): LockState {
  const info = readLock(lockPath);
  if (info === null || info.pid === process.pid || !isPidAlive(info.pid)) return { kind: 'free' };
  return isStale(info) ? { kind: 'suspect', pid: info.pid } : { kind: 'held', pid: info.pid };
}

/** Порт свободен: удалось начать и закончить прослушивание. */
export function isPortFree(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
}
```

`src/server/main.ts` — импорт `import { acquireLock } from './lock';` замените на:

```ts
import { acquireLock, isPortFree, LockHeldError, lockState } from './lock';
```

и строку `const releaseLock = acquireLock(config.lockPath);` в `startServer` — на:

```ts
  // Живой PID с чужим bootTime: перезагрузка (PID занят другим процессом) или скачок часов при
  // работающем приложении. Во втором случае порт занят — тогда это второй экземпляр.
  const state = lockState(config.lockPath);
  if (state.kind === 'suspect' && !(await isPortFree(config.host, config.port))) {
    throw new LockHeldError(state.pid, config.lockPath);
  }
  const releaseLock = acquireLock(config.lockPath);
```

`src/server/modules/backup/restore.ts` — удалите локальную функцию `isPortFree` и импорт `import net from 'node:net';`, импорт lock замените на:

```ts
import { acquireLock, isLockHeld, isPortFree } from '../../lock';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/lock.test.ts tests/server/main.test.ts tests/server/restore.test.ts tests/server/main-backup.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/server/lock.ts src/server/main.ts src/server/modules/backup/restore.ts tests/server/lock.test.ts tests/server/main.test.ts
git commit -m "fix: скачок часов — живой app.lock с чужим bootTime не перехватывается, пока порт занят

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: ngrok — повторы только для сети и занятой сессии

**Files:**
- Modify: `scripts/lib/ngrok.ts`, `scripts/run.ts`, `tests/server/ngrok.test.ts`

**Interfaces:**
- Consumes: `connectWithRetry`, `isFatalNgrokError`, `ngrokCode` (план 1).
- Produces:
  - `TRANSIENT_ATTEMPTS = 8`;
  - `isFatalNgrokError(err: unknown, attempt = 1): boolean` — нет кода → `false`; код 108/324/334 → `attempt >= TRANSIENT_ATTEMPTS`; любой другой код → `true`;
  - `connectWithRetry` передаёт в `isFatal(err, attempt)` номер неудачной попытки с 1.

- [ ] **Step 1: Write the failing tests**

`tests/server/ngrok.test.ts` — импорт:

```ts
import { connectWithRetry, isFatalNgrokError, maskSecret, TRANSIENT_ATTEMPTS } from '../../scripts/lib/ngrok';
```

Тест `it('ERR_NGROK_3xx без упоминания домена — повторяем', …)` замените двумя:

```ts
  it('занятая сессия (ERR_NGROK_108, 324, 334) — повторяем, но не больше TRANSIENT_ATTEMPTS раз', () => {
    for (const code of ['108', '324', '334']) {
      const e = ngrokError(`session limit\n\nerror_code: ERR_NGROK_${code}`, `ERR_NGROK_${code}`);
      expect(isFatalNgrokError(e, 1)).toBe(false);
      expect(isFatalNgrokError(e, TRANSIENT_ATTEMPTS - 1)).toBe(false);
      expect(isFatalNgrokError(e, TRANSIENT_ATTEMPTS)).toBe(true);
    }
  });

  it('ERR_NGROK_4018 (нет подтверждённого аккаунта и authtoken) и другие коды ngrok — фатальные', () => {
    const auth = 'authentication failed: Usage of ngrok requires a verified account and authtoken.\n\nERR_NGROK_4018';
    expect(isFatalNgrokError(ngrokError(auth, 'ERR_NGROK_4018'))).toBe(true);
    expect(isFatalNgrokError(ngrokError('failed to start tunnel\n\nerror_code: ERR_NGROK_302'))).toBe(true);
    expect(isFatalNgrokError(ngrokError('account limit\n\nerror_code: ERR_NGROK_9017'))).toBe(true);
  });
```

В `describe('connectWithRetry', …)` перед `it('прекращает попытки при остановке и возвращает null', …)`:

```ts
  it('занятая сессия: TRANSIENT_ATTEMPTS попыток, затем ошибка пробрасывается', async () => {
    const busy = ngrokError('endpoint already online\n\nerror_code: ERR_NGROK_334', 'ERR_NGROK_334');
    const h = harness([busy]);
    await expect(h.run).rejects.toBe(busy);
    expect(h.calls()).toBe(TRANSIENT_ATTEMPTS);
    expect(h.sleeps).toHaveLength(TRANSIENT_ATTEMPTS - 1);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/ngrok.test.ts`
Expected: FAIL — нет экспорта `TRANSIENT_ATTEMPTS`.

- [ ] **Step 3: Implement**

`scripts/lib/ngrok.ts` — комментарий и функцию `isFatalNgrokError` замените на:

```ts
/** Коды, которые проходят сами: прошлая сессия этого ПК ещё не закрыта на стороне ngrok (сразу после перезапуска). */
const TRANSIENT_CODES = new Set([108, 324, 334]);
/** Сколько попыток даём таким кодам (паузы 1→2→4…60 с — около трёх минут). */
export const TRANSIENT_ATTEMPTS = 8;

/**
 * Повтор не исправит ответ ngrok с кодом ошибки: authtoken (105, 4018), домен и тариф (3xx).
 * Исключение — коды занятой сессии: им даём TRANSIENT_ATTEMPTS попыток. Ошибки без кода (сеть) — повторяем всегда.
 * attempt — номер неудачной попытки, начиная с 1.
 */
export function isFatalNgrokError(err: unknown, attempt = 1): boolean {
  const code = ngrokCode(err);
  if (code === null) return false;
  if (TRANSIENT_CODES.has(code)) return attempt >= TRANSIENT_ATTEMPTS;
  return true;
}
```

В `connectWithRetry`: тип параметра `isFatal: (err: unknown) => boolean;` → `isFatal: (err: unknown, attempt: number) => boolean;`; после `let delay = 1000;` добавьте `let attempt = 0;`; строку `if (o.isFatal(e)) throw e;` замените на:

```ts
      attempt++;
      if (o.isFatal(e, attempt)) throw e;
```

`scripts/run.ts` — комментарий над `connectWithRetry` в блоке ngrok замените:

```ts
    // Сеть повторяем всегда (она может появиться позже сервера); ответы ngrok с кодом ошибки — нет,
    // кроме занятой прошлой сессией (до TRANSIENT_ATTEMPTS попыток).
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/ngrok.test.ts`
Expected: PASS (старые тесты: 105 и 3xx про домен — фатальные, сеть и неизвестное — повторяем, паузы 1→…→60 с).

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add scripts/lib/ngrok.ts scripts/run.ts tests/server/ngrok.test.ts
git commit -m "fix: ngrok не переподключается бесконечно при ERR_NGROK_4018 и других кодах; занятой сессии — 8 попыток

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: setup при работающем приложении, `CLOUDFLARED_PATH` на папку, атомарная запись cloudflared

**Files:**
- Create: `scripts/lib/app-running.ts`, `tests/server/app-running.test.ts`
- Modify: `scripts/lib/cloudflared.ts`, `scripts/run.ts`, `scripts/setup.ts`, `tests/server/cloudflared.test.ts`

**Interfaces:**
- Consumes: `isLockHeld`, `isPortFree` (задача 1), `runFiles` (план 8a), `checkCloudflaredPath` (план 1).
- Produces:
  - `appRunning(config: Pick<Config, 'lockPath' | 'dataDir' | 'host' | 'port'>): Promise<boolean>`;
  - `ensureCloudflared` с `customPath` на папку или несуществующий файл бросает «CLOUDFLARED_PATH: …»; скачанный файл пишется через `<target>.<pid>.tmp` и `rename`;
  - `npm start` в режиме cloudflare проверяет `CLOUDFLARED_PATH` через `checkCloudflaredPath`.

- [ ] **Step 1: Write the failing tests**

`tests/server/app-running.test.ts`:

```ts
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { currentBootTime } from '../../src/server/lock';
import { appRunning } from '../../scripts/lib/app-running';

let dir = '';
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

async function freePort(): Promise<number> {
  const srv = net.createServer();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as net.AddressInfo).port;
  await new Promise<void>((r) => srv.close(() => r()));
  return port;
}

function cfg(port: number) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-running-'));
  return { lockPath: path.join(dir, 'app.lock'), dataDir: dir, host: '127.0.0.1', port };
}

const liveLock = () => JSON.stringify({ pid: process.ppid, bootTime: currentBootTime() });

describe('appRunning (проверка перед npm run setup)', () => {
  it('ничего не запущено — false', async () => {
    expect(await appRunning(cfg(await freePort()))).toBe(false);
  });

  it('живой lock сервера или супервизора — true', async () => {
    const c = cfg(await freePort());
    fs.writeFileSync(c.lockPath, liveLock());
    expect(await appRunning(c)).toBe(true);
    fs.rmSync(c.lockPath);
    fs.writeFileSync(path.join(dir, 'supervisor.lock'), liveLock());
    expect(await appRunning(c)).toBe(true);
  });

  it('порт занят — true', async () => {
    const srv = net.createServer();
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    try {
      expect(await appRunning(cfg((srv.address() as net.AddressInfo).port))).toBe(true);
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });
});
```

`tests/server/cloudflared.test.ts` — импорт vitest:

```ts
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
```

перед `describe('ensureCloudflared', …)`:

```ts
afterEach(() => vi.restoreAllMocks());
```

и в `describe('ensureCloudflared', …)` перед `it('без закреплённых сборок (unpinned) …', …)`:

```ts
  it('CLOUDFLARED_PATH, указывающий на папку, отклоняется с понятным сообщением', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-cfdir-'));
    await expect(ensureCloudflared({ binDir: 'unused', pins: pins(sha), customPath: dir })).rejects.toThrow(/CLOUDFLARED_PATH: Это не файл/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('сбой записи не оставляет ни cloudflared, ни временного файла', async () => {
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-bin-'));
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
    });
    await expect(ensureCloudflared({ binDir, pins: pins(sha), customPath: null, fetchImpl: fakeFetch })).rejects.toThrow(/ENOSPC/);
    vi.restoreAllMocks();
    expect(fs.readdirSync(binDir)).toEqual([]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/app-running.test.ts tests/server/cloudflared.test.ts`
Expected: FAIL — нет модуля `scripts/lib/app-running`; папка в `CLOUDFLARED_PATH` принимается; при сбое `renameSync` (сейчас не вызывается) файл остаётся.

- [ ] **Step 3: Implement**

`scripts/lib/app-running.ts`:

```ts
import type { Config } from '../../src/server/config';
import { isLockHeld, isPortFree } from '../../src/server/lock';
import { runFiles } from './run-files';

/**
 * Приложение (или чужая программа на его порту) работает: занят lock сервера или супервизора, либо порт.
 * setup не должен мигрировать базу под работающим сервером.
 */
export async function appRunning(config: Pick<Config, 'lockPath' | 'dataDir' | 'host' | 'port'>): Promise<boolean> {
  if (isLockHeld(config.lockPath) || isLockHeld(runFiles(config.dataDir).supervisorLock)) return true;
  return !(await isPortFree(config.host, config.port));
}
```

`scripts/lib/cloudflared.ts` — в `ensureCloudflared` блок `if (o.customPath) { … }` замените на:

```ts
  if (o.customPath) {
    const checked = checkCloudflaredPath(o.customPath);
    if (!checked.ok) throw new Error(`CLOUDFLARED_PATH: ${checked.message}`);
    return checked.path;
  }
```

и строку `fs.writeFileSync(target, buf, { mode: 0o755 });` — на:

```ts
  // Через временный файл: оборванная запись не оставит битый cloudflared под рабочим именем.
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, buf, { mode: 0o755 });
    fs.renameSync(tmp, target);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
```

`scripts/run.ts` — импорт `import { cloudflaredTarget } from './lib/cloudflared';` → `import { checkCloudflaredPath, cloudflaredTarget } from './lib/cloudflared';`, блок выбора `cloudflaredBin` замените на:

```ts
let cloudflaredBin = '';
if (config.deployMode === 'cloudflare') {
  if (config.cloudflaredPath) {
    const checked = checkCloudflaredPath(config.cloudflaredPath);
    if (!checked.ok) {
      logError(`CLOUDFLARED_PATH: ${checked.message}`);
      process.exit(1);
    }
    cloudflaredBin = checked.path;
  } else {
    cloudflaredBin = cloudflaredTarget(config.binDir);
    if (!fs.existsSync(cloudflaredBin)) {
      logError(`cloudflared не найден (${cloudflaredBin}). Запустите npm run setup или укажите CLOUDFLARED_PATH.`);
      process.exit(1);
    }
  }
}
```

`scripts/setup.ts` — импорт после `import { createUsersService } …`:

```ts
import { appRunning } from './lib/app-running';
```

и перед строкой `const dbExisted = fs.existsSync(config.dbPath);`:

```ts
if (await appRunning(config)) {
  prompt.close();
  console.error(
    `Настройки сохранены, но база не тронута: приложение запущено или порт ${config.port} занят другой программой. ` +
      'Остановите приложение (npm run stop) и повторите npm run setup.',
  );
  process.exit(1);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/app-running.test.ts tests/server/cloudflared.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add scripts/lib/app-running.ts scripts/lib/cloudflared.ts scripts/run.ts scripts/setup.ts tests/server/app-running.test.ts tests/server/cloudflared.test.ts
git commit -m "fix: setup не мигрирует базу под работающим приложением; CLOUDFLARED_PATH на папку отклоняется; cloudflared пишется атомарно

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Пересборка интерфейса после `git pull` и права `data/`

**Files:**
- Create: `src/server/data-dir.ts`, `tests/server/data-dir.test.ts`
- Modify: `scripts/lib/client-build.ts`, `tests/server/client-build.test.ts`, `src/server/main.ts`, `scripts/run.ts`, `scripts/setup.ts`, `README.md`

**Interfaces:**
- Consumes: `needsClientBuild(root)` (план 1).
- Produces:
  - `needsClientBuild(root: string): boolean` учитывает время папок `src/client`, `src/shared` (рекурсивно) и файлов `vite.config.ts`, `package-lock.json`, `tsconfig.json`;
  - `ensureDataDir(dir: string, o?: { platform?: NodeJS.Platform; chmod?: (p: string, mode: number) => void }): void` — `mkdir -p`, на не-Windows `chmod 0700`.

- [ ] **Step 1: Write the failing tests**

`tests/server/client-build.test.ts` — замените файл целиком:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { needsClientBuild } from '../../scripts/lib/client-build';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

const DIRS = ['src/client', 'src/client/pages', 'src/shared', 'dist/client'];

function tree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-cb-'));
  roots.push(root);
  for (const d of DIRS) fs.mkdirSync(path.join(root, d), { recursive: true });
  return root;
}
const touch = (p: string, t: number) => {
  fs.writeFileSync(p, 'x');
  fs.utimesSync(p, t, t);
};
/** Время папок: создание файлов в тесте сдвигает его на «сейчас». */
const ageDirs = (root: string, t: number) => {
  for (const d of DIRS) fs.utimesSync(path.join(root, d), t, t);
};

describe('needsClientBuild', () => {
  it('true, если сборки нет', () => {
    const root = tree();
    touch(path.join(root, 'src/client/main.tsx'), 1000);
    expect(needsClientBuild(root)).toBe(true);
  });

  it('false, если сборка новее исходников, и true, если исходник изменился позже', () => {
    const root = tree();
    touch(path.join(root, 'src/client/main.tsx'), 1000);
    touch(path.join(root, 'dist/client/index.html'), 2000);
    ageDirs(root, 1000);
    expect(needsClientBuild(root)).toBe(false);
    touch(path.join(root, 'src/shared/currencies.ts'), 3000);
    ageDirs(root, 1000);
    expect(needsClientBuild(root)).toBe(true);
  });

  it('удалённый файл (git pull) — пересборка: время папки новее сборки', () => {
    const root = tree();
    touch(path.join(root, 'src/client/pages/Old.tsx'), 1000);
    touch(path.join(root, 'dist/client/index.html'), 2000);
    ageDirs(root, 1000);
    expect(needsClientBuild(root)).toBe(false);
    fs.rmSync(path.join(root, 'src/client/pages/Old.tsx'));
    fs.utimesSync(path.join(root, 'src/client/pages'), 3000, 3000);
    expect(needsClientBuild(root)).toBe(true);
  });

  it('изменённые vite.config.ts или package-lock.json (новые зависимости) — пересборка', () => {
    for (const file of ['vite.config.ts', 'package-lock.json']) {
      const root = tree();
      touch(path.join(root, 'src/client/main.tsx'), 1000);
      touch(path.join(root, file), 1000);
      touch(path.join(root, 'dist/client/index.html'), 2000);
      ageDirs(root, 1000);
      expect(needsClientBuild(root)).toBe(false);
      touch(path.join(root, file), 3000);
      expect(needsClientBuild(root)).toBe(true);
    }
  });
});
```

`tests/server/data-dir.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureDataDir } from '../../src/server/data-dir';

let dir = '';
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('ensureDataDir', () => {
  it('создаёт вложенную папку; на Linux ставит права 0700', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-datadir-'));
    const target = path.join(dir, 'a', 'data');
    const calls: Array<[string, number]> = [];
    ensureDataDir(target, { platform: 'linux', chmod: (p, m) => calls.push([p, m]) });
    expect(fs.statSync(target).isDirectory()).toBe(true);
    expect(calls).toEqual([[target, 0o700]]);
  });

  it('на Windows права не трогает; повторный вызов не падает', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-datadir-'));
    const calls: unknown[] = [];
    ensureDataDir(dir, { platform: 'win32', chmod: () => calls.push(1) });
    ensureDataDir(dir, { platform: 'win32', chmod: () => calls.push(1) });
    expect(calls).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')('на POSIX права действительно 0700', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-datadir-'));
    fs.chmodSync(dir, 0o755);
    ensureDataDir(dir);
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/client-build.test.ts tests/server/data-dir.test.ts`
Expected: FAIL — «удалённый файл» и «vite.config.ts / package-lock.json» (2 теста `client-build`); нет модуля `src/server/data-dir`.

- [ ] **Step 3: Implement**

`scripts/lib/client-build.ts` — замените файл целиком:

```ts
import fs from 'node:fs';
import path from 'node:path';

/** Файлы и папки, от которых зависит сборка интерфейса. */
const INPUTS = ['src/client', 'src/shared', 'vite.config.ts', 'package-lock.json', 'tsconfig.json'];

/** Новейшее время изменения: у папки учитывается и её собственное (удаление и переименование файлов меняют его). */
function newestMtime(p: string): number {
  let st: fs.Stats;
  try {
    st = fs.statSync(p);
  } catch {
    return 0;
  }
  if (!st.isDirectory()) return st.mtimeMs;
  let max = st.mtimeMs;
  for (const entry of fs.readdirSync(p)) max = Math.max(max, newestMtime(path.join(p, entry)));
  return max;
}

export function needsClientBuild(root: string): boolean {
  const index = path.join(root, 'dist', 'client', 'index.html');
  if (!fs.existsSync(index)) return true;
  const built = fs.statSync(index).mtimeMs;
  const sources = Math.max(...INPUTS.map((rel) => newestMtime(path.join(root, rel))));
  return sources > built;
}
```

`src/server/data-dir.ts`:

```ts
import fs from 'node:fs';

/**
 * Создаёт папку данных. На Linux и macOS права 0700: в ней база, вложения, бэкапы и журналы,
 * другим пользователям сервера доступ не нужен. На Windows права наследуются от папки профиля.
 */
export function ensureDataDir(dir: string, o: { platform?: NodeJS.Platform; chmod?: (p: string, mode: number) => void } = {}): void {
  fs.mkdirSync(dir, { recursive: true });
  if ((o.platform ?? process.platform) !== 'win32') (o.chmod ?? fs.chmodSync)(dir, 0o700);
}
```

`src/server/main.ts` — импорт `import { ensureDataDir } from './data-dir';` (перед `import { openDb, … } from './db/client';`) и первая строка `startServer`:

```ts
  ensureDataDir(config.dataDir);
  for (const d of [config.uploadsDir, config.backupsDir, config.logsDir]) fs.mkdirSync(d, { recursive: true });
```

(вместо `for (const d of [config.dataDir, config.uploadsDir, config.backupsDir, config.logsDir]) fs.mkdirSync(d, { recursive: true });`).

`scripts/run.ts` — импорт `import { ensureDataDir } from '../src/server/data-dir';` после `import { loadConfig } …`, строку `fs.mkdirSync(config.dataDir, { recursive: true });` замените на `ensureDataDir(config.dataDir);`.

`scripts/setup.ts` — импорт `import { ensureDataDir } from '../src/server/data-dir';` перед `import { openDb } …`, строку `fs.mkdirSync(config.dataDir, { recursive: true });` замените на `ensureDataDir(config.dataDir);`.

`README.md` — в таблицу «Если что-то не работает» добавьте строку после «Забыли пароль»:

```markdown
| `npm run setup` пишет «база не тронута: приложение запущено» | Остановите приложение (`npm run stop`) и повторите `npm run setup`; настройки уже сохранены |
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/client-build.test.ts tests/server/data-dir.test.ts tests/server/main.test.ts`
Expected: PASS (на Windows тест прав POSIX пропущен).

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add scripts/lib/client-build.ts src/server/data-dir.ts src/server/main.ts scripts/run.ts scripts/setup.ts README.md tests/server/client-build.test.ts tests/server/data-dir.test.ts
git commit -m "fix: интерфейс пересобирается после удаления файлов и смены конфигов; data/ с правами 0700 на Linux

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Покрытие отложенных замечаний плана 1 («план шага 8»)

| Замечание | Где |
| --- | --- |
| Скачок системных часов: статус «подозрительно», захват только при свободном порте | Task 1 |
| Windows Fast Startup и `os.uptime()` | Task 1 покрывает правилом порта; живая проверка — заказчик (§12) |
| ngrok бесконечно переподключается при `ERR_NGROK_4018` и 3xx без домена | Task 2 |
| `setup.ts` мигрирует, не проверяя lock и порт | Task 3 |
| `CLOUDFLARED_PATH` в env может указывать на папку | Task 3 |
| Задача Планировщика: рабочая папка — папка проекта | План 8a, Task 4–5 |
| Заголовки `X-Forwarded-*` от cloudflared, ngrok и Caddy | Спайк заказчика (живые туннели); IP-правила для vps закреплены тестами плана 8a |
| README: `user:add` вручную | Уже в README; сохранено планом 8a |
| Атомарная запись `cloudflared` | Task 3 |
| `needsClientBuild`: удалённые файлы и конфиги | Task 4 |
| Права 0700 на `data/` в POSIX | Task 4 (+ `UMask=0077` юнита, план 8a) |
| Журнал падений супервизора в файл | План 8a, Task 2 |
| Потоковый экспорт бэкапа на диск | Уже сделано (`exportArchive` пишет во временную папку) |
