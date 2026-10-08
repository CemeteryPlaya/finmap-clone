# Этап 1, план 8b: надёжность перед установкой у клиента — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** закрыть пункты из отложенных замечаний плана 1 («Обязательно до первой автономной установки у клиента (план шага 8)» и «Отложенные мелкие замечания → План шага 8»), которые не вошли в план 8a:
- скачок системных часов не даёт второму серверу захватить живой `app.lock`; занятый чужой программой порт после перезагрузки не останавливает супервизор насовсем;
- ngrok не переподключается бесконечно при ошибках, которые повтор не исправит (`ERR_NGROK_4018` и другие коды);
- `npm run setup` не мигрирует базу под работающим приложением и различает «приложение запущено» и «порт занят другой программой»; `CLOUDFLARED_PATH`, указывающий на папку, отклоняется и в `npm start`; `cloudflared` записывается атомарно;
- интерфейс пересобирается после удаления файлов и смены `vite.config.ts` / `package-lock.json` (обновление через `git pull`);
- папка `data/` на Linux получает права 0700; на Windows `npm run setup` закрывает `data\` и файл настроек через `icacls`.

**Предусловие:** выполнен план 8a (`lockState`, `isPortFree`, `lockRunningPid`, `SUPERVISOR_LOCK_FILE` в `src/server/lock.ts`; `scripts/lib/run-files.ts` с `runFiles`; `scripts/run.ts` с журналом супервизора; `windowsUserId` в `scripts/lib/windows-task.ts`; `npm run stop`).

**Architecture:**
- **`app.lock` при скачке часов:** `startServer` при `suspect` и занятом `PORT` бросает `LockSuspectError` (наследник `LockHeldError`), при свободном — перехватывает lock. Сервер выходит с кодом 4 (`EXIT_LOCK_SUSPECT`), и супервизор повторяет запуск с паузой 1 → 60 с, а не останавливается насовсем, как при коде 3: после перезагрузки порт мог занять чужой процесс, а потом освободить.
- **ngrok:** ответ с кодом `ERR_NGROK_*` — фатальный, кроме кодов занятой сессии (108, 324, 334): им 8 попыток (около двух минут). Ошибки без кода (сеть) повторяются всегда, как раньше.
- **ACL Windows:** чистая функция `icaclsRestrictArgs` (аргументы `icacls`), тонкая обёртка в `scripts/setup.ts`; группы указаны SID, потому что их имена в Windows локализованы.
- **Остальное** — маленькие функции с тестами: `appRunning(config)`, `appRunningMessage`, `ensureDataDir(dir)`, обновлённые `needsClientBuild` и `ensureCloudflared`.

**Tech Stack:** как в планах 1–8a; новых пакетов нет.

**Spec:** [docs/superpowers/specs/2026-10-05-stage1-foundation-core-design.md](../specs/2026-10-05-stage1-foundation-core-design.md) — §8.1 (cloudflared, ngrok), §9.1 (один экземпляр, супервизор), §9.3, §12. Отложенные замечания: [docs/superpowers/followups/2026-10-06-stage1-plan1-followups.md](../followups/2026-10-06-stage1-plan1-followups.md).

**Ветка:** `stage1/plan1-skeleton`.

## Решения, принятые при планировании

1. **Скачок часов различается по порту, а не по новому формату `app.lock`.** Формат `{pid, bootTime}` не меняется. `isLockHeld` по-прежнему считает `suspect` свободным; `npm run stop`, `setup` и блокировка супервизора (план 8a) смотрят на порт через `lockRunningPid`; окончательное решение для сервера принимает `startServer`.
2. **Код выхода 4 — повтор с паузой.** `LockSuspectError` означает «порт занят, а lock из прошлой загрузки». Второй супервизор при скачке часов сюда не доходит: его останавливает `supervisor.lock` (план 8a). Значит, это чужая программа на порту после перезагрузки — ждём, пока порт освободится, и пишем причину в `supervisor.log`.
3. **Повторы ngrok — по белому списку.** Ответ сервиса ngrok с кодом ошибки повтор не исправит: токен, неподтверждённый аккаунт (`4018`), домен, тариф. Исключение — коды занятой сессии `108`, `324`, `334`: после быстрого перезапуска ngrok ещё держит прошлую сессию этого ПК. Им даётся `TRANSIENT_ATTEMPTS = 8` попыток (паузы 1+2+4+8+16+32+60 с — около двух минут). Номера кодов взяты из прошлых сообщений ngrok; по итогам живой проверки заказчиком список можно поправить в одном месте.
4. **`setup` сохраняет настройки, но не трогает базу, если приложение запущено** (lock сервера или супервизора; lock из прошлой загрузки — при занятом порте) — совет `npm run stop`; **или если порт занят чужой программой** — совет сменить `PORT`.
5. **Пересборка интерфейса** учитывает время самих папок `src/client`, `src/shared` (удаление и переименование файла меняют его) и файлы `vite.config.ts`, `package-lock.json`, `tsconfig.json`. Хэш-метка сборки не нужна.
6. **Права на данные.** Linux: 0700 на `data/` (если папка чужая и `chmod` не проходит — предупреждение, а не ошибка запуска); `UMask=0077` юнита (план 8a) закрывает новые файлы. **Windows:** наследование прав не безопасно — если проект лежит прямо на `C:\`, корень диска даёт «Пользователям» чтение, а «Прошедшим проверку» изменение. Поэтому `npm run setup` выключает наследование у `data\` и файла настроек и оставляет полный доступ текущему пользователю, SYSTEM (`*S-1-5-18`) и Администраторам (`*S-1-5-32-544`). Это делается после последней записи файла настроек: запись через временный файл возвращает унаследованные права. README (план 8a) советует папку внутри профиля пользователя.
7. **Пункт «переводить потоковый экспорт бэкапа на диск» закрыт ранее:** `exportArchive` уже пишет архив во временную папку. Здесь ничего не делаем.

## Global Constraints

- **Один экземпляр (§9.1):** lock `data/app.lock` с PID; занят живым процессом — второй экземпляр завершается с сообщением; lock несуществующего процесса устарел и перехватывается.
- **Перезапуск (§9.1):** супервизор, пауза 1 → 2 → 4 … 60 с, пишет в журнал.
- **Ошибки сети ngrok** повторяются с паузой 1 → 2 → 4 … 60 с (план 1, `connectWithRetry`); секрет в сообщениях маскируется (`maskSecret`).
- **`cloudflared` (§8.1):** скачанный файл проверяется по SHA-256; свой — только через `CLOUDFLARED_PATH`.
- **Восстановление и миграции (§9.3):** не при работающем приложении.
- **Тесты не меняют права на настоящих папках проекта и не регистрируют службы** — `icacls` проверяется по аргументам.
- **Безопасность хуков среды:** shell-команды плана не содержат подстроку «.env»; собирать её из частей запрещено.
- **Завершение задачи:** зелёные `npm test` и `npm run typecheck`, коммит с трейлером `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Задач с интерфейсом нет; e2e — в конце задачи 4.

## Review Focus

1. **Часы ПК сдвинулись больше чем на минуту (синхронизация времени), приложение работает, сервер запускают второй раз** — второй получает `LockSuspectError`, живой lock не перезаписан. Тест — в задаче 1.
2. **ПК перезагрузили, PID из старого lock достался другому процессу, порт свободен** — приложение стартует, lock перехвачен; **порт занят чужой программой** — супервизор не сдаётся, а повторяет запуск с паузой. Тесты — в задаче 1.
3. **ngrok с неподтверждённым аккаунтом (`ERR_NGROK_4018`)** — одна попытка и понятная ошибка в журнале вместо бесконечного цикла; занятая сессия после перезапуска — до 8 попыток. Тест — в задаче 2 (с предохранителем от бесконечного цикла в самом тесте).
4. **`npm run setup` при работающем приложении или при чужой программе на `PORT`** — база не мигрируется, совет по ситуации: `npm run stop` или сменить `PORT`. Тест — в задаче 3.
5. **Проект лежит прямо на `C:\`** — после `npm run setup` у `data\` и файла настроек нет унаследованных прав «Пользователей» и «Прошедших проверку». Тест аргументов — в задаче 4.

---

## Карта файлов

```
src/server/lock.ts                     # LockSuspectError
src/server/exit-codes.ts               # (новый) EXIT_LOCK_HELD = 3, EXIT_LOCK_SUSPECT = 4
src/server/main.ts                     # suspect + занятый порт → LockSuspectError; ensureDataDir; реэкспорт кодов
src/server/index.ts                    # код выхода 4
src/server/data-dir.ts                 # (новый) ensureDataDir
scripts/lib/run-files.ts               # serverExitAction
scripts/lib/ngrok.ts                   # белый список повторов
scripts/lib/cloudflared.ts             # проверка CLOUDFLARED_PATH, атомарная запись
scripts/lib/app-running.ts             # (новый) appRunning, appRunningMessage
scripts/lib/client-build.ts            # время папок и конфигов
scripts/lib/windows-acl.ts             # (новый) icaclsRestrictArgs
scripts/run.ts                         # повтор при коде 4; CLOUDFLARED_PATH через checkCloudflaredPath; ensureDataDir
scripts/setup.ts                       # отказ мигрировать при работающем приложении; icacls; ensureDataDir
README.md                              # строки о setup и правах
tests/server/main.test.ts, run-files.test.ts, ngrok.test.ts, cloudflared.test.ts, client-build.test.ts   # дополнены
tests/server/app-running.test.ts, data-dir.test.ts                                                         # (новые)
```

---

### Task 1: Скачок системных часов и `app.lock` сервера

**Files:**
- Create: `src/server/exit-codes.ts`
- Modify: `src/server/lock.ts`, `src/server/main.ts`, `src/server/index.ts`, `scripts/lib/run-files.ts`, `scripts/run.ts`, `tests/server/main.test.ts`, `tests/server/run-files.test.ts`

**Interfaces:**
- Consumes: `lockState`, `isPortFree`, `LockHeldError` (`src/server/lock.ts`, план 8a); `createSupervisor` `onExit` (план 1).
- Produces:
  - `class LockSuspectError extends LockHeldError` — `constructor(pid, lockPath, port)`, сообщение «Порт N занят, а в файле блокировки … — живой процесс PID … из прошлой загрузки системы …»;
  - `EXIT_LOCK_HELD = 3`, `EXIT_LOCK_SUSPECT = 4` в `src/server/exit-codes.ts` (модуль без зависимостей; `main.ts` реэкспортирует оба);
  - `startServer` при `suspect` и занятом порту бросает `LockSuspectError`, lock не трогает;
  - `serverExitAction(code: number | null): 'stop' | 'retry-port-busy' | 'restart'` в `scripts/lib/run-files.ts`.

- [ ] **Step 1: Write the failing tests**

`tests/server/main.test.ts` — импорт из lock замените на:

```ts
import { currentBootTime, LockHeldError, LockSuspectError } from '../../src/server/lock';
```

и после `it('не стартует второй экземпляр при живом lock', …)` (в файле уже импортированы `net`, `testConfig`):

```ts
  it('скачок часов: живой lock с другим bootTime и занятый порт — второй экземпляр не стартует, lock не тронут', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-main-'));
    const blocker = net.createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
    try {
      const port = (blocker.address() as net.AddressInfo).port;
      const config = testConfig(dir, { PORT: String(port) });
      fs.mkdirSync(config.dataDir, { recursive: true });
      const suspect = JSON.stringify({ pid: process.ppid, bootTime: currentBootTime() - 3600 });
      fs.writeFileSync(config.lockPath, suspect);
      const err = await startServer(config, { logger: false, handleSignals: false }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(LockSuspectError);
      expect(err).toBeInstanceOf(LockHeldError);
      expect((err as Error).message).toContain(`Порт ${port} занят`);
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

`tests/server/run-files.test.ts` — в импорт из `../../scripts/lib/run-files` добавьте `serverExitAction` и в конец файла:

```ts
describe('супервизор после выхода сервера', () => {
  it('3 — приложение уже запущено (стоп); 4 — порт занят чужой программой (повтор с паузой); остальное — перезапуск', () => {
    expect(serverExitAction(3)).toBe('stop');
    expect(serverExitAction(4)).toBe('retry-port-busy');
    expect(serverExitAction(1)).toBe('restart');
    expect(serverExitAction(null)).toBe('restart');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/main.test.ts tests/server/run-files.test.ts`
Expected: FAIL — нет экспортов `LockSuspectError` и `serverExitAction`; «скачок часов» отклоняется с `EADDRINUSE`, и lock перезаписан.

- [ ] **Step 3: Implement**

`src/server/exit-codes.ts`:

```ts
/** Коды выхода сервера, которые различает супервизор (scripts/run.ts). Модуль без зависимостей. */

/** app.lock занят живым процессом из этой загрузки системы: второй экземпляр, супервизор останавливается. */
export const EXIT_LOCK_HELD = 3;
/** Lock с чужим bootTime и занятый порт: супервизор повторяет запуск с паузой, а не сдаётся. */
export const EXIT_LOCK_SUSPECT = 4;
```

`src/server/lock.ts` — перед `/** Блокировка супервизора в папке данных (npm start, npm run stop, restore). */`:

```ts
/**
 * В app.lock живой PID из другой загрузки системы, и порт приложения занят. Это либо скачок часов при
 * работающем приложении, либо после перезагрузки порт занят чужой программой (а PID достался другому
 * процессу). Супервизор в этом случае не сдаётся, а повторяет запуск с паузой.
 */
export class LockSuspectError extends LockHeldError {
  constructor(pid: number, lockPath: string, port: number) {
    super(pid, lockPath);
    this.message =
      `Порт ${port} занят, а в файле блокировки ${lockPath} — живой процесс PID ${pid} из прошлой загрузки системы. ` +
      'Либо приложение уже запущено (сдвинулись часы), либо порт занят другой программой.';
    this.name = 'LockSuspectError';
  }
}
```

`src/server/main.ts` — импорт `import { acquireLock } from './lock';` замените на:

```ts
import { acquireLock, isPortFree, lockState, LockSuspectError } from './lock';
```

строку `export const EXIT_LOCK_HELD = 3;` — на:

```ts
export { EXIT_LOCK_HELD, EXIT_LOCK_SUSPECT } from './exit-codes';
```

и строку `const releaseLock = acquireLock(config.lockPath);` в `startServer` — на:

```ts
  // Живой PID с чужим bootTime: перезагрузка (PID занят другим процессом) или скачок часов при
  // работающем приложении. Во втором случае порт занят — тогда lock не перехватываем.
  const state = lockState(config.lockPath);
  if (state.kind === 'suspect' && !(await isPortFree(config.host, config.port))) {
    throw new LockSuspectError(state.pid, config.lockPath, config.port);
  }
  const releaseLock = acquireLock(config.lockPath);
```

`src/server/index.ts` — замените файл целиком:

```ts
import fs from 'node:fs';
import { loadConfig } from './config';
import { LockHeldError, LockSuspectError } from './lock';
import { EXIT_LOCK_HELD, EXIT_LOCK_SUSPECT, startServer } from './main';

if (fs.existsSync('.env')) process.loadEnvFile('.env');

try {
  const s = await startServer(loadConfig());
  s.app.log.info(`Сервер запущен: ${s.url}`);
} catch (e) {
  if (e instanceof LockSuspectError) {
    console.error(e.message);
    process.exit(EXIT_LOCK_SUSPECT);
  }
  if (e instanceof LockHeldError) {
    console.error(e.message);
    process.exit(EXIT_LOCK_HELD);
  }
  console.error(e);
  process.exit(1);
}
```

`scripts/lib/run-files.ts` — импорт после `import { loadConfig, type Config } from '../../src/server/config';`:

```ts
import { EXIT_LOCK_HELD, EXIT_LOCK_SUSPECT } from '../../src/server/exit-codes';
```

и в конец файла:

```ts
/**
 * Что делать супервизору после выхода сервера: 3 — приложение уже запущено другим процессом (остановиться);
 * 4 — порт занят, а lock из прошлой загрузки (повторять с паузой: порт может освободиться); остальное — перезапуск.
 */
export function serverExitAction(code: number | null): 'stop' | 'retry-port-busy' | 'restart' {
  if (code === EXIT_LOCK_HELD) return 'stop';
  if (code === EXIT_LOCK_SUSPECT) return 'retry-port-busy';
  return 'restart';
}
```

`scripts/run.ts` — удалите импорт `import { EXIT_LOCK_HELD } from '../src/server/main';`, в импорт из `./lib/run-files` добавьте `serverExitAction`, а `onExit` сервера замените на:

```ts
    onExit: (code) => {
      const action = serverExitAction(code);
      if (action === 'stop') {
        logError(`Приложение уже запущено другим процессом (файл блокировки ${config.lockPath}). Супервизор завершает работу.`);
        void supervisor.shutdown(1);
        return false;
      }
      if (action === 'retry-port-busy') {
        logError(`Порт ${config.port} занят другой программой; сервер будет запущен, когда порт освободится.`);
      }
      return true;
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/main.test.ts tests/server/run-files.test.ts tests/server/lock.test.ts tests/server/restore.test.ts tests/server/main-backup.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/server/exit-codes.ts src/server/lock.ts src/server/main.ts src/server/index.ts scripts/lib/run-files.ts scripts/run.ts tests/server/main.test.ts tests/server/run-files.test.ts
git commit -m "fix: скачок часов — живой app.lock с чужим bootTime не перехватывается, пока порт занят; супервизор ждёт освобождения порта

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
    expect(TRANSIENT_ATTEMPTS).toBe(8);
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

В `describe('connectWithRetry', …)` перед `it('прекращает попытки при остановке и возвращает null', …)` (второй аргумент `harness` — предохранитель: после 20 пауз цикл останавливается, поэтому со старым кодом тест падает быстро, а не съедает память бесконечными повторами):

```ts
  it('занятая сессия: TRANSIENT_ATTEMPTS попыток, затем ошибка пробрасывается', async () => {
    const busy = ngrokError('endpoint already online\n\nerror_code: ERR_NGROK_334', 'ERR_NGROK_334');
    // Предохранитель: не больше 20 пауз, иначе harness останавливает цикл (старый код повторял бы бесконечно).
    const h = harness([busy], 20);
    await expect(h.run).rejects.toBe(busy);
    expect(h.calls()).toBe(TRANSIENT_ATTEMPTS);
    expect(h.sleeps).toHaveLength(TRANSIENT_ATTEMPTS - 1);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/ngrok.test.ts`
Expected: FAIL за секунды — нет экспорта `TRANSIENT_ATTEMPTS`; 4018 и 302 не фатальные; «занятая сессия» разрешается `null` после 20 пауз вместо ошибки.

- [ ] **Step 3: Implement**

`scripts/lib/ngrok.ts` — комментарий и функцию `isFatalNgrokError` замените на:

```ts
/** Коды, которые проходят сами: прошлая сессия этого ПК ещё не закрыта на стороне ngrok (сразу после перезапуска). */
const TRANSIENT_CODES = new Set([108, 324, 334]);
/** Сколько попыток даём таким кодам (паузы 1+2+4+8+16+32+60 с — около двух минут). */
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
- Consumes: `isPortFree`, `lockRunningPid` (план 8a), `runFiles` (план 8a), `checkCloudflaredPath` (план 1).
- Produces:
  - `appRunning(config: Pick<Config, 'lockPath' | 'dataDir' | 'host' | 'port'>): Promise<'app' | 'port-busy' | null>`;
  - `appRunningMessage(state: 'app' | 'port-busy', port: number): string` — для `app` совет `npm run stop`, для `port-busy` — сменить `PORT`;
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
import { appRunning, appRunningMessage } from '../../scripts/lib/app-running';

let dir = '';
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

async function freePort(): Promise<number> {
  const srv = net.createServer();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as net.AddressInfo).port;
  await new Promise<void>((r) => srv.close(() => r()));
  return port;
}

async function withBusyPort<T>(fn: (port: number) => Promise<T>): Promise<T> {
  const srv = net.createServer();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  try {
    return await fn((srv.address() as net.AddressInfo).port);
  } finally {
    await new Promise<void>((r) => srv.close(() => r()));
  }
}

function cfg(port: number) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-running-'));
  return { lockPath: path.join(dir, 'app.lock'), dataDir: dir, host: '127.0.0.1', port };
}

const liveLock = (shift = 0) => JSON.stringify({ pid: process.ppid, bootTime: currentBootTime() + shift });

describe('appRunning (проверка перед npm run setup)', () => {
  it('ничего не запущено — null', async () => {
    expect(await appRunning(cfg(await freePort()))).toBeNull();
  });

  it('живой lock сервера или супервизора — app', async () => {
    const c = cfg(await freePort());
    fs.writeFileSync(c.lockPath, liveLock());
    expect(await appRunning(c)).toBe('app');
    fs.rmSync(c.lockPath);
    fs.writeFileSync(path.join(dir, 'supervisor.lock'), liveLock());
    expect(await appRunning(c)).toBe('app');
  });

  it('порт занят чужой программой, блокировок нет — port-busy, совет сменить PORT', async () => {
    const state = await withBusyPort((port) => appRunning(cfg(port)));
    expect(state).toBe('port-busy');
    expect(appRunningMessage('port-busy', 3000)).toMatch(/порт 3000 занят другой программой.*PORT/);
    expect(appRunningMessage('port-busy', 3000)).not.toMatch(/npm run stop/);
    expect(appRunningMessage('app', 3000)).toMatch(/npm run stop/);
  });

  it('скачок часов: lock из прошлой загрузки и занятый порт — app', async () => {
    const state = await withBusyPort(async (port) => {
      const c = cfg(port);
      fs.writeFileSync(c.lockPath, liveLock(-3600));
      return appRunning(c);
    });
    expect(state).toBe('app');
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
import { isPortFree, lockRunningPid } from '../../src/server/lock';
import { runFiles } from './run-files';

/**
 * Что мешает setup трогать базу: 'app' — работает приложение (lock сервера или супервизора;
 * lock из прошлой загрузки считается работающим, если порт занят); 'port-busy' — порт занят чужой
 * программой; null — ничего.
 */
export async function appRunning(config: Pick<Config, 'lockPath' | 'dataDir' | 'host' | 'port'>): Promise<'app' | 'port-busy' | null> {
  const portBusy = async () => !(await isPortFree(config.host, config.port));
  for (const lock of [config.lockPath, runFiles(config.dataDir).supervisorLock]) {
    if ((await lockRunningPid(lock, portBusy)) !== null) return 'app';
  }
  return (await portBusy()) ? 'port-busy' : null;
}

/** Сообщение setup, когда базу трогать нельзя. */
export function appRunningMessage(state: 'app' | 'port-busy', port: number): string {
  return state === 'app'
    ? 'Настройки сохранены, но база не тронута: приложение запущено. Остановите его (npm run stop) и повторите npm run setup.'
    : `Настройки сохранены, но база не тронута: порт ${port} занят другой программой. ` +
        'Укажите другой PORT в файле настроек .env и повторите npm run setup.';
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

`scripts/run.ts` — в импорт из `./lib/cloudflared` добавьте `checkCloudflaredPath`, блок выбора `cloudflaredBin` замените на:

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

`scripts/setup.ts` — импорт перед `import { checkCloudflaredPath, ensureCloudflared, type Pins } from './lib/cloudflared';`:

```ts
import { appRunning, appRunningMessage } from './lib/app-running';
```

и перед строкой `const dbExisted = fs.existsSync(config.dbPath);`:

```ts
const running = await appRunning(config);
if (running) {
  prompt.close();
  console.error(appRunningMessage(running, config.port));
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
git commit -m "fix: setup не мигрирует базу под работающим приложением и подсказывает по ситуации; CLOUDFLARED_PATH на папку отклоняется; cloudflared пишется атомарно

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Пересборка интерфейса после `git pull`, права `data/` на Linux и ACL на Windows

**Files:**
- Create: `src/server/data-dir.ts`, `scripts/lib/windows-acl.ts`, `tests/server/data-dir.test.ts`
- Modify: `scripts/lib/client-build.ts`, `tests/server/client-build.test.ts`, `src/server/main.ts`, `scripts/run.ts`, `scripts/setup.ts`, `README.md`

**Interfaces:**
- Consumes: `needsClientBuild(root)` (план 1); `windowsUserId` (план 8a); в `setup.ts` — `ENV_FILE`, `config`, `prompt`.
- Produces:
  - `needsClientBuild(root: string): boolean` учитывает время папок `src/client`, `src/shared` (рекурсивно) и файлов `vite.config.ts`, `package-lock.json`, `tsconfig.json`;
  - `ensureDataDir(dir, o?: { platform?; chmod?; warn? }): void` — `mkdir -p`; не на Windows — `chmod 0700`, при ошибке — предупреждение;
  - `icaclsRestrictArgs(target: string, userId: string, kind: 'dir' | 'file'): string[]`;
  - `npm run setup` на Windows закрывает `data\` и файл настроек.

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
import { icaclsRestrictArgs } from '../../scripts/lib/windows-acl';

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

  it('папка чужая и chmod падает (EPERM) — предупреждение, а не ошибка запуска', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-datadir-'));
    const warnings: string[] = [];
    expect(() =>
      ensureDataDir(dir, {
        platform: 'linux',
        chmod: () => {
          throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
        },
        warn: (m) => warnings.push(m),
      }),
    ).not.toThrow();
    expect(warnings).toEqual([expect.stringMatching(/Не удалось закрыть папку данных .*EPERM/)]);
  });

  it.skipIf(process.platform === 'win32')('на POSIX права действительно 0700', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-datadir-'));
    fs.chmodSync(dir, 0o755);
    ensureDataDir(dir);
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
  });
});

describe('icaclsRestrictArgs (Windows: папка данных и файл настроек)', () => {
  it('папка: наследование выключено, полный доступ — только текущему пользователю, SYSTEM и Администраторам, с наследованием вниз', () => {
    expect(icaclsRestrictArgs('C:\\Users\\Админ\\Учёт\\data', 'CLUB-PC\\Админ', 'dir')).toEqual([
      'C:\\Users\\Админ\\Учёт\\data',
      '/inheritance:r',
      '/grant:r',
      'CLUB-PC\\Админ:(OI)(CI)F',
      '*S-1-5-18:(OI)(CI)F',
      '*S-1-5-32-544:(OI)(CI)F',
    ]);
  });

  it('файл: те же три владельца без флагов наследования; SID вместо локализованных имён групп', () => {
    expect(icaclsRestrictArgs('C:\\Учёт\\.env', 'PC\\User', 'file')).toEqual([
      'C:\\Учёт\\.env',
      '/inheritance:r',
      '/grant:r',
      'PC\\User:F',
      '*S-1-5-18:F',
      '*S-1-5-32-544:F',
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/client-build.test.ts tests/server/data-dir.test.ts`
Expected: FAIL — «удалённый файл» и «vite.config.ts / package-lock.json» (2 теста `client-build`); нет модулей `src/server/data-dir` и `scripts/lib/windows-acl`.

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
 * Создаёт папку данных. На Linux и macOS — права 0700: в ней база, вложения, бэкапы и журналы,
 * другим пользователям сервера доступ не нужен. Если права сменить нельзя (папка чужая), это
 * предупреждение, а не ошибка запуска. На Windows доступ закрывает npm run setup (icacls).
 */
export function ensureDataDir(
  dir: string,
  o: { platform?: NodeJS.Platform; chmod?: (p: string, mode: number) => void; warn?: (message: string) => void } = {},
): void {
  fs.mkdirSync(dir, { recursive: true });
  if ((o.platform ?? process.platform) === 'win32') return;
  try {
    (o.chmod ?? fs.chmodSync)(dir, 0o700);
  } catch (e) {
    (o.warn ?? ((m: string) => console.warn(m)))(`Не удалось закрыть папку данных ${dir} от других пользователей (права 0700): ${(e as Error).message}`);
  }
}
```

`scripts/lib/windows-acl.ts`:

```ts
/** SID встроенных учётных записей: имена локализованы («Администраторы»), SID — нет. */
const SYSTEM_SID = '*S-1-5-18';
const ADMINISTRATORS_SID = '*S-1-5-32-544';

/**
 * Аргументы icacls, закрывающие папку данных или файл настроек от других пользователей Windows:
 * унаследованные права (например, «Пользователи: чтение» и «Прошедшие проверку: изменение» с диска C:\)
 * убираются, полный доступ — текущему пользователю, SYSTEM и Администраторам.
 */
export function icaclsRestrictArgs(target: string, userId: string, kind: 'dir' | 'file'): string[] {
  const inherit = kind === 'dir' ? '(OI)(CI)' : '';
  return [target, '/inheritance:r', '/grant:r', `${userId}:${inherit}F`, `${SYSTEM_SID}:${inherit}F`, `${ADMINISTRATORS_SID}:${inherit}F`];
}
```

`src/server/main.ts` — импорт `import { ensureDataDir } from './data-dir';` (перед `import { openDb, … } from './db/client';`) и первая строка `startServer`:

```ts
  ensureDataDir(config.dataDir);
  for (const d of [config.uploadsDir, config.backupsDir, config.logsDir]) fs.mkdirSync(d, { recursive: true });
```

(вместо `for (const d of [config.dataDir, config.uploadsDir, config.backupsDir, config.logsDir]) fs.mkdirSync(d, { recursive: true });`).

`scripts/run.ts` — импорт `import { ensureDataDir } from '../src/server/data-dir';` перед импортом из `../src/server/lock`, строку `fs.mkdirSync(config.dataDir, { recursive: true });` замените на `ensureDataDir(config.dataDir);`.

`scripts/setup.ts`:
- импорты: в начало файла `import { spawnSync } from 'node:child_process';`, после `import fs from 'node:fs';` — `import os from 'node:os';` и `import path from 'node:path';`, перед `import { openDb } …` — `import { ensureDataDir } from '../src/server/data-dir';`, после импорта из `./lib/env-file` — `import { icaclsRestrictArgs } from './lib/windows-acl';` и `import { windowsUserId } from './lib/windows-task';`;
- строку `fs.mkdirSync(config.dataDir, { recursive: true });` замените на `ensureDataDir(config.dataDir);`;
- перед `const running = await appRunning(config);` (задача 3) — после блока cloudflared, где файл настроек записывается последний раз:

```ts
// Windows: папка проекта может наследовать «Пользователи: чтение» и «Прошедшие проверку: изменение»
// (например, если она прямо на C:\). Закрываем data\ и файл настроек (секреты, токены) — после
// последней записи файла настроек: запись через временный файл возвращает унаследованные права.
if (process.platform === 'win32') {
  const user = windowsUserId(process.env, os.userInfo().username);
  for (const [target, kind] of [
    [config.dataDir, 'dir'],
    [path.resolve(ENV_FILE), 'file'],
  ] as const) {
    const r = spawnSync('icacls', icaclsRestrictArgs(target, user, kind), { stdio: 'ignore' });
    if (r.status !== 0) {
      console.warn(`Внимание: не удалось закрыть ${target} от других пользователей Windows (icacls, код ${r.status ?? '—'}).`);
    }
  }
}
```

`README.md` — в таблицу «Если что-то не работает» добавьте строки после «Забыли пароль»:

```markdown
| `npm run setup` пишет «база не тронута: приложение запущено» | Остановите приложение (`npm run stop`) и повторите `npm run setup`; настройки уже сохранены |
| `npm run setup` пишет «порт … занят другой программой» | Поменяйте `PORT` в `.env` (и адрес туннеля в Cloudflare) и повторите `npm run setup` |
| `npm run setup` пишет «не удалось закрыть … от других пользователей Windows» | Повторите `npm run setup` в окне команд, открытом от имени администратора под своей учётной записью |
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/client-build.test.ts tests/server/data-dir.test.ts tests/server/main.test.ts`
Expected: PASS (на Windows тест прав POSIX пропущен).

Ручная проверка аргументов `icacls` на Windows — только на временной папке, не на проекте. Создайте в корне проекта временный файл `fc-acl-check.mts` (не коммитить):

```ts
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { icaclsRestrictArgs } from './scripts/lib/windows-acl';
import { windowsUserId } from './scripts/lib/windows-task';

const T = process.argv[2]!;
const user = windowsUserId(process.env, os.userInfo().username);
console.log(
  spawnSync('icacls', icaclsRestrictArgs(T, user, 'dir')).status,
  spawnSync('icacls', icaclsRestrictArgs(`${T}\\settings.txt`, user, 'file')).status,
);
```

и выполните в Git Bash:

```bash
mkdir -p /tmp/fc-acl/sub && echo x > /tmp/fc-acl/sub/f.txt && echo s > /tmp/fc-acl/settings.txt
npx tsx fc-acl-check.mts "$(cygpath -w /tmp/fc-acl)"; rm fc-acl-check.mts
icacls "$(cygpath -w /tmp/fc-acl)"; icacls "$(cygpath -w /tmp/fc-acl/settings.txt)"
```

Expected: `0 0`; у папки три записи `(OI)(CI)(F)` без `(I)` (наследование выключено) — SYSTEM, Администраторы, текущий пользователь; у `settings.txt` те же три с `(F)`; у `sub\f.txt` — они же с `(I)`. «Пользователи» и «Прошедшие проверку» не упоминаются.

- [ ] **Step 5: Full check and commit**

Run: `npm test`, `npm run typecheck` и `npm run test:e2e` (свободный `E2E_PORT`) — зелёные.

```bash
git add scripts/lib/client-build.ts scripts/lib/windows-acl.ts src/server/data-dir.ts src/server/main.ts scripts/run.ts scripts/setup.ts README.md tests/server/client-build.test.ts tests/server/data-dir.test.ts
git commit -m "fix: интерфейс пересобирается после удаления файлов и смены конфигов; data/ с правами 0700 на Linux; setup закрывает data и настройки через icacls на Windows

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Покрытие отложенных замечаний плана 1 («план шага 8»)

| Замечание | Где |
| --- | --- |
| Скачок системных часов: статус «подозрительно», захват только при свободном порте | План 8a, Task 2 (состояние, блокировка супервизора, stop); Task 1 (`app.lock` сервера) |
| Windows Fast Startup и `os.uptime()` | Покрыто правилом порта; живая проверка — заказчик (§12) |
| ngrok бесконечно переподключается при `ERR_NGROK_4018` и 3xx без домена | Task 2 |
| `setup.ts` мигрирует, не проверяя lock и порт | Task 3 |
| `CLOUDFLARED_PATH` в env может указывать на папку | Task 3 |
| Задача Планировщика: рабочая папка — папка проекта | План 8a, Task 5 |
| Заголовки `X-Forwarded-*` от cloudflared, ngrok и Caddy | Спайк заказчика (живые туннели); IP-правила для vps закреплены тестами плана 8a |
| README: `user:add` вручную | Уже в README; сохранено планом 8a |
| Атомарная запись `cloudflared` | Task 3 |
| `needsClientBuild`: удалённые файлы и конфиги | Task 4 |
| Права 0700 на `data/` в POSIX | Task 4 (+ `UMask=0077` юнита, план 8a); на Windows — `icacls` (Task 4) |
| Журнал падений супервизора в файл | План 8a, Task 3 |
| Потоковый экспорт бэкапа на диск | Уже сделано (`exportArchive` пишет во временную папку) |
