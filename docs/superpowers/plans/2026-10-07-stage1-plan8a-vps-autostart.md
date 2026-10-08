# Этап 1, план 8a: режим vps, автозапуск, остановка, копии бэкапов, README — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** шаг 8 §11 спецификации «Эксплуатация»:
- режим `vps`: Caddyfile и systemd-юнит (с песочницей) генерируются из настроек, примеры лежат в `deploy/`;
- автозапуск `npm run service:install` / `service:uninstall`: на Windows задача Планировщика при входе пользователя без окна, на Linux systemd-юнит;
- `npm run stop` — остановка приложения, запущенного без окна (нужна перед восстановлением и обновлением, §9.3);
- атомарная блокировка супервизора, устойчивая к скачку часов; журнал супервизора в файле, включая ошибки настроек и сборки; журнал cloudflared в файле;
- `BACKUP_COPY_DIR`: копия не уходит на системный диск, если флешка отключена;
- README для владельца клуба по всем режимам, автозапуску, бэкапам, восстановлению, обновлению и неполадкам.

**Предусловие:** выполнены планы 1–5 (супервизор `scripts/run.ts`, `scripts/lib/supervise.ts`, `src/server/lock.ts`, бэкапы с `BACKUP_COPY_DIR`, экран «Резервная копия» с `lastCopyError`). Шаги 6–7 на этот план не влияют. Хардинг из отложенных замечаний плана 1 (скачок часов для `app.lock` сервера, ngrok, setup при работающем приложении, пересборка интерфейса, права `data/` и ACL Windows) — в плане 8b.

**Architecture:**
- **Всё, что регистрирует службы, — чистые функции.** `scripts/lib/deploy-files.ts` (Caddyfile, systemd-юнит), `scripts/lib/windows-task.ts` (XML задачи, аргументы `schtasks`), `scripts/lib/service-plan.ts` (`planInstall`/`planUninstall` → файлы, команды, подсказки) покрыты тестами. Тонкая обёртка `scripts/lib/service-run.ts` читает окружение, пишет файлы и выполняет команды; с `--dry-run` (или `npm_config_dry_run=true`) только печатает. Тесты ничего не регистрируют и не вызывают `sudo`.
- **Состояние блокировки** (`src/server/lock.ts`): `free` / `held` / `suspect` (PID жив, но `bootTime` другой — скачок часов или PID после перезагрузки). `suspect` считается работающим, если порт приложения занят (`lockRunningPid`). Блокировка супервизора `data/supervisor.lock` создаётся атомарно (`wx`), перехват устаревшего файла проверяется, снятие удаляет только файл со своим `token`.
- **Windows:** задача создаётся из XML (`schtasks /Create /XML`), потому что флаги `schtasks` не умеют снять лимит 3 дня и запрет работы от батареи. Действие — `conhost.exe --headless "<node>" "<npm-cli.js>" start` в папке проекта: окна нет совсем. Перезапуск при падении — только у супервизора.
- **Остановка:** `npm run stop` создаёт `data/stop.request`; супервизор раз в секунду забирает заявку и останавливает сервер штатно. Если за 20 с процессы не завершились — `taskkill /PID <pid> /T /F` (на Linux — SIGKILL) и проверка, что процессов больше нет. `npm run stop` не требует верных настроек: ему нужны только `DATA_DIR`, `HOST`, `PORT`.
- **Журналы без окна:** ошибка настроек при запуске, сбой сборки интерфейса, перезапуски и ошибки туннеля пишутся в `data/logs/supervisor.log`; cloudflared пишет в `data/logs/cloudflared.log`.
- **Linux:** `service:install` от имени пользователя приложения пишет `data/deploy/finmap-clone.service` (и `data/deploy/Caddyfile` в режиме vps) и печатает команды `sudo`. Сам `sudo` не вызывает. Юнит — в песочнице: вся система только для чтения, кроме папки приложения, данных и папки копий бэкапов.

**Tech Stack:** как в планах 1–5; новых пакетов нет.

**Spec:** [docs/superpowers/specs/2026-10-05-stage1-foundation-core-design.md](../specs/2026-10-05-stage1-foundation-core-design.md) — §3 (структура, команды, переменные), §8 (IP клиента), §8.1, §9.1, §9.2, §9.3, §11 шаг 8, §12.

**Ветка:** `stage1/plan1-skeleton`. В `main` не сливаем до завершения всех работ.

## Решения, принятые при планировании

1. **Автозапуск Windows — только «при входе пользователя»** (§9.1). Режим «при запуске системы» не делаем: спецификация его прямо исключает (нужен сохранённый пароль или SYSTEM). Для ПК клуба README объясняет автовход Windows.
2. **Окно скрывает `conhost.exe --headless`.** Флаг не документирован, но есть в Windows 10 1903+ и 11 и проверен на машине разработки. `powershell -WindowStyle Hidden` не годится: при Windows Terminal по умолчанию окно остаётся.
3. **Перезапуск при падении — только супервизор.** В задаче нет `RestartOnFailure`: супервизор выходит с кодом 1, когда приложение уже запущено, и Планировщик крутил бы его по кругу. В systemd `Restart=on-failure` оставлен как страховка от падения самого супервизора.
4. **Новая команда `npm run stop`.** `schtasks /End` завершает только запущенный процесс, а не его детей (сервер и cloudflared остаются), окна для Ctrl+C нет. Мягкая остановка — файлом-заявкой, жёсткая — через 20 с с проверкой результата.
5. **Блокировка супервизора атомарная и с `token`.** Скачок системных часов больше чем на минуту делает живой lock «подозрительным» (`suspect`). Тогда `npm run stop` и второй `npm start` проверяют порт приложения: занят — приложение работает. Иначе второй запуск перехватил бы и потом удалил чужую блокировку.
6. **Журнал супервизора** `data/logs/supervisor.log` (10 МБ, одна старая копия `.1`) и журнал cloudflared `data/logs/cloudflared.log`. Ошибки настроек и сборки интерфейса тоже попадают в журнал, иначе при автозапуске без окна причина пропадает.
7. **Задача запускает `node npm-cli.js start` по абсолютным путям** (из `process.execPath` и `npm_execpath`), а не `npm` из PATH. Поэтому `service:install` нужно запускать через `npm run`; после переустановки Node в другую папку — повторить `service:install` (README).
8. **Linux: `service:install` не вызывает `sudo`** — запускается от пользователя приложения, пишет файлы в `data/deploy/` и печатает команды. От root отказывается. Юнит с песочницей: `ProtectSystem=strict`, `ReadWritePaths` (папка приложения, данные вне её, `-` папка копий — может быть не смонтирована), `PrivateTmp`, `ProtectKernelTunables`, `ProtectControlGroups`, `RestrictSUIDSGID`, `NoNewPrivileges`, `UMask=0077`; кэш npm — в `data/npm-cache` (домашняя папка в песочнице только для чтения).
9. **Режим `vps` требует `PUBLIC_URL` вида `https://домен`** (не localhost): от него зависят Caddyfile, CSRF и флаг `Secure`. Ошибка — при загрузке настроек.
10. **`BACKUP_COPY_DIR` не создаётся автоматически.** Иначе отключённая флешка (`E:\Бэкапы`) или несмонтированный диск (`/mnt/usb/backups`) дали бы «успешную» копию на системный диск. Относительный путь считается от папки проекта.
11. **Папка проекта на Windows — внутри профиля пользователя** (`%USERPROFILE%\Учёт`), а не на `C:\`: корень диска даёт всем «Пользователям» чтение и «Прошедшим проверку» изменение, а в папке лежат файл настроек с секретами и база. Плюс к этому `npm run setup` закрывает `data\` и файл настроек через `icacls` (план 8b).
12. **`npm run doctor` не делаем:** §12 описывает ручную приёмку, спецификация такой команды не предполагает.
13. **Примеры `deploy/Caddyfile.example` и `deploy/finmap-clone.service`** (§3) совпадают с выводом генераторов — это проверяет тест. `.gitattributes` закрепляет для `deploy/*` переводы строк LF (systemd не понимает CRLF).

## Global Constraints

- **Режимы (§8.1):** `local`, `cloudflare`, `ngrok`, `vps`; в `vps` — Caddy с автоматическим HTTPS и systemd-юнит. `HOST` по умолчанию `127.0.0.1`; Caddy проксирует на loopback.
- **IP клиента (§8):** `trustProxy` — только loopback; `CF-Connecting-IP` — только в `cloudflare` и только с loopback. В `vps` IP — правый недоверенный адрес `X-Forwarded-For` от Caddy; подделка начала заголовка и `CF-Connecting-IP` не влияют.
- **Автозапуск (§9.1):** Windows — задача Планировщика при входе текущего пользователя, скрытое окно, `npm start`, рабочая папка — папка проекта (отложенное замечание плана 1); Linux — systemd-юнит от отдельного пользователя.
- **Перезапуск (§9.1):** супервизор, пауза 1 → 2 → 4 … 60 с, пишет в журнал.
- **Один экземпляр (§9.1):** живой lock — второй экземпляр завершается с сообщением; lock мёртвого процесса устарел и перехватывается.
- **Бэкапы (§9.2):** последние `BACKUP_KEEP` архивов; копия в `BACKUP_COPY_DIR` с той же ротацией; ошибка копирования — в журнал и на экран «Резервная копия»; сервер из-за неё не падает.
- **Восстановление (§9.3):** только при остановленном приложении (lock сервера, lock супервизора, порт); README описывает, как остановить супервизор и задачу Планировщика.
- **Тесты не регистрируют службы, не вызывают `sudo` и `schtasks`** — только чистые функции и `--dry-run`.
- **Безопасность хуков среды:** shell-команды плана не содержат подстроку «.env»; собирать её из частей запрещено. Невидимые символы в коде — через `\uXXXX` (BOM — `\uFEFF`).
- **Завершение задачи:** зелёные `npm test` и `npm run typecheck`, коммит с трейлером `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Задач с интерфейсом в плане нет; e2e — один раз в конце (задача 7).

## Review Focus

1. **Системные часы сдвинулись на час при работающем приложении** — `npm run stop` всё равно его находит и останавливает; второй `npm start` отказывается и не трогает `supervisor.lock`; два одновременных захвата устаревшей блокировки — побеждает один. Тесты — в задаче 2 (`lockRunningPid`, `acquireExclusiveLock`), живая проверка — в задаче 4.
2. **Автозапуск без окна и ошибка в настройках или сборке** — причина видна в `data/logs/supervisor.log`, а не теряется. Тест — в задаче 3 (`loadConfigOrLog`).
3. **`npm run stop`, когда приложение зависло, когда настройки сломаны, когда запущен только `npm run dev`** — принудительно через 20 с с проверкой результата; без проверки настроек; без «20 секунд» в сообщении для `dev`. Тесты — в задаче 4.
4. **`npm run service:install --dry-run` без `--`** — ничего не регистрирует (npm передаёт флаг как `npm_config_dry_run`). Тест — в задаче 5.
5. **`BACKUP_COPY_DIR` на отключённой флешке** — бэкап создан, папка на системном диске не появилась, предупреждение в журнале и статусе; после подключения следующий бэкап копируется и ошибка сбрасывается. Тест — в задаче 6.

---

## Карта файлов

```
.gitattributes                         # (новый) deploy/* — LF
deploy/Caddyfile.example               # (новый) пример Caddyfile
deploy/finmap-clone.service            # (новый) пример systemd-юнита
src/server/config.ts                   # vps требует https PUBLIC_URL; BACKUP_COPY_DIR → абсолютный путь
src/server/lock.ts                     # lockState, isPortFree, lockRunningPid, acquireExclusiveLock, SUPERVISOR_LOCK_FILE
src/server/modules/backup/restore.ts   # isPortFree — из lock.ts; проверка supervisor.lock
src/server/modules/backup/service.ts   # папка копий не создаётся
scripts/
  lib/deploy-files.ts                  # (новый) renderCaddyfile, renderSystemdUnit
  lib/run-files.ts                     # (новый) пути супервизора, заявка, журнал, lenientRunConfig, loadConfigOrLog
  lib/cloudflared.ts                   # cloudflaredArgs (--logfile)
  lib/stop.ts                          # (новый) stopApp, forceKillCommand, STOP_MESSAGES
  lib/windows-task.ts                  # (новый) XML задачи, аргументы schtasks
  lib/service-plan.ts                  # (новый) planInstall / planUninstall, isDryRun, readWritePaths
  lib/service-run.ts                   # (новый) обёртка: окружение, запись, выполнение, --dry-run
  run.ts                               # журнал, блокировка супервизора, заявка на остановку, ошибки настроек и сборки
  stop.ts, service-install.ts, service-uninstall.ts   # (новые) команды
  setup.ts                             # подсказка после режима vps
  backup.ts                            # предупреждение о сбое копии с причиной
package.json                           # stop, service:install, service:uninstall
README.md                              # эксплуатация для владельца клуба
tests/server/
  deploy-files.test.ts, run-files.test.ts, stop.test.ts,
  windows-task.test.ts, service-plan.test.ts                       # (новые)
  config.test.ts, client-ip.test.ts, lock.test.ts, restore.test.ts,
  cloudflared.test.ts, backup.test.ts                               # дополнены
```

---

### Task 1: Режим vps — проверка настроек, Caddyfile и systemd-юнит

**Files:**
- Create: `scripts/lib/deploy-files.ts`, `deploy/Caddyfile.example`, `deploy/finmap-clone.service`, `.gitattributes`, `tests/server/deploy-files.test.ts`
- Modify: `src/server/config.ts`, `scripts/setup.ts`, `tests/server/config.test.ts`, `tests/server/client-ip.test.ts`

**Interfaces:**
- Consumes: `loadConfig` (`src/server/config.ts`), `createTestApp` (`tests/helpers/test-app.ts`).
- Produces:
  - `SERVICE_NAME = 'finmap-clone'`;
  - `upstreamAddress(host: string, port: number): string`;
  - `renderCaddyfile(o: { publicUrl: string; host: string; port: number }): string`;
  - `systemdArg(s: string): string`;
  - `renderSystemdUnit(o: { appName: string; user: string; workingDirectory: string; dataDir: string; execStart: string[]; readWritePaths: string[] }): string`;
  - `EXAMPLE` — значения для файлов в `deploy/`;
  - `loadConfig` бросает «в режиме vps PUBLIC_URL обязателен: https://ваш-домен …», если `DEPLOY_MODE=vps`, а `PUBLIC_URL` пуст, не https, не адрес или localhost/127.0.0.1/[::1].

- [ ] **Step 1: Write the failing tests**

`tests/server/deploy-files.test.ts`:

```ts
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXAMPLE, renderCaddyfile, renderSystemdUnit, systemdArg, upstreamAddress } from '../../scripts/lib/deploy-files';

/** Отступы в примерах могут быть табами или пробелами — сравниваем без них. */
const noIndent = (s: string) => s.replace(/\r\n/g, '\n').replace(/^[ \t]+/gm, '');

describe('Caddyfile (режим vps)', () => {
  it('сайт по хосту PUBLIC_URL, прокси в приложение на loopback', () => {
    expect(renderCaddyfile({ publicUrl: 'https://fin.example.kz', host: '127.0.0.1', port: 3000 })).toBe(
      '# Caddy для https://fin.example.kz: HTTPS и проксирование в приложение.\n' +
        '# Сертификат Caddy получает сам; порты 80 и 443 должны быть открыты.\n' +
        'fin.example.kz {\n' +
        '\tencode zstd gzip\n' +
        '\treverse_proxy 127.0.0.1:3000\n' +
        '}\n',
    );
  });

  it('порт в PUBLIC_URL сохраняется, кириллический домен — в punycode', () => {
    expect(renderCaddyfile({ publicUrl: 'https://fin.example.kz:8443', host: '127.0.0.1', port: 3100 })).toContain('fin.example.kz:8443 {');
    expect(renderCaddyfile({ publicUrl: 'https://учёт.рф', host: '127.0.0.1', port: 3000 })).toMatch(/^xn--.+\.xn--p1ai \{$/m);
  });

  it('адрес приложения: все интерфейсы и localhost → 127.0.0.1, IPv6 — в скобках', () => {
    expect(upstreamAddress('0.0.0.0', 3000)).toBe('127.0.0.1:3000');
    expect(upstreamAddress('::', 3000)).toBe('127.0.0.1:3000');
    expect(upstreamAddress('localhost', 3000)).toBe('127.0.0.1:3000');
    expect(upstreamAddress('::1', 3000)).toBe('[::1]:3000');
    expect(upstreamAddress('10.0.0.5', 3000)).toBe('10.0.0.5:3000');
    expect(upstreamAddress('fd00::5', 3000)).toBe('[fd00::5]:3000');
  });
});

describe('systemd-юнит', () => {
  const base = {
    appName: 'Учёт',
    user: 'finmap',
    workingDirectory: '/opt/finmap-clone',
    dataDir: '/opt/finmap-clone/data',
    execStart: ['/usr/bin/npm', 'start'],
    readWritePaths: ['/opt/finmap-clone'],
  };

  it('пользователь, рабочая папка, команда запуска и перезапуск при падении', () => {
    const unit = renderSystemdUnit(base);
    expect(unit).toContain('Description=Учёт (finmap-clone)\n');
    expect(unit).toContain('User=finmap\n');
    expect(unit).toContain('WorkingDirectory=/opt/finmap-clone\n');
    expect(unit).toContain('ExecStart=/usr/bin/npm start\n');
    expect(unit).toContain('Restart=on-failure\n');
    expect(unit).toContain('WantedBy=multi-user.target\n');
  });

  it('песочница: система только для чтения, запись — в папку приложения; кэш npm — в папке данных', () => {
    const unit = renderSystemdUnit(base);
    for (const line of [
      'UMask=0077',
      'NoNewPrivileges=true',
      'PrivateTmp=true',
      'ProtectSystem=strict',
      'ReadWritePaths=/opt/finmap-clone',
      'ProtectKernelTunables=true',
      'ProtectControlGroups=true',
      'RestrictSUIDSGID=true',
      'Environment=npm_config_cache=/opt/finmap-clone/data/npm-cache',
      'Environment=npm_config_update_notifier=false',
    ]) {
      expect(unit).toContain(`${line}\n`);
    }
  });

  it('несколько путей записи; необязательный путь с «-» (флешка может быть не смонтирована)', () => {
    const unit = renderSystemdUnit({ ...base, readWritePaths: ['/opt/finmap-clone', '/srv/fin data', '-/mnt/usb/backups'] });
    expect(unit).toContain('ReadWritePaths=/opt/finmap-clone "/srv/fin data" -/mnt/usb/backups\n');
  });

  it('пробелы, кавычки, % и $ в путях не ломают юнит', () => {
    expect(systemdArg('/opt/my app/npm-cli.js')).toBe('"/opt/my app/npm-cli.js"');
    expect(systemdArg('/opt/100%/x')).toBe('/opt/100%%/x');
    expect(systemdArg('/opt/$HOME/x')).toBe('/opt/$$HOME/x');
    expect(systemdArg('/opt/a"b')).toBe('"/opt/a\\"b"');
    const unit = renderSystemdUnit({
      ...base,
      appName: 'Клуб 100%',
      workingDirectory: '/srv/fin 100%',
      dataDir: '/srv/fin 100%/data',
      execStart: ['/usr/bin/node', '/srv/fin 100%/npm-cli.js', 'start'],
      readWritePaths: ['/srv/fin 100%'],
    });
    expect(unit).toContain('Description=Клуб 100%% (finmap-clone)\n');
    expect(unit).toContain('WorkingDirectory=/srv/fin 100%%\n');
    expect(unit).toContain('Environment="npm_config_cache=/srv/fin 100%%/data/npm-cache"\n');
    expect(unit).toContain('ExecStart=/usr/bin/node "/srv/fin 100%%/npm-cli.js" start\n');
    expect(unit).toContain('ReadWritePaths="/srv/fin 100%%"\n');
  });

  it('примеры в deploy/ совпадают с тем, что генерирует код', () => {
    expect(noIndent(fs.readFileSync('deploy/Caddyfile.example', 'utf8'))).toBe(noIndent(renderCaddyfile(EXAMPLE)));
    expect(noIndent(fs.readFileSync('deploy/finmap-clone.service', 'utf8'))).toBe(
      noIndent(renderSystemdUnit({ ...EXAMPLE, execStart: [...EXAMPLE.execStart], readWritePaths: [...EXAMPLE.readWritePaths] })),
    );
  });
});
```

`tests/server/config.test.ts` — новый тест перед `it('учитывает DATA_DIR для всех путей данных', …)`:

```ts
  it('режим vps требует PUBLIC_URL с https и настоящим доменом', () => {
    expect(() => loadConfig({ ...base, DEPLOY_MODE: 'vps' })).toThrow(/vps PUBLIC_URL обязателен/);
    expect(() => loadConfig({ ...base, DEPLOY_MODE: 'vps', PUBLIC_URL: 'http://fin.example.kz' })).toThrow(/https/);
    expect(() => loadConfig({ ...base, DEPLOY_MODE: 'vps', PUBLIC_URL: 'https://localhost' })).toThrow(/vps/);
    expect(() => loadConfig({ ...base, DEPLOY_MODE: 'vps', PUBLIC_URL: 'не адрес' })).toThrow(/vps/);
    const c = loadConfig({ ...base, DEPLOY_MODE: 'vps', PUBLIC_URL: 'https://fin.example.kz/' });
    expect(c.deployMode).toBe('vps');
    expect(c.publicUrl).toBe('https://fin.example.kz');
  });
```

`tests/server/client-ip.test.ts` — режиму vps нужен домен; строку в `MODE_ENV` замените:

```ts
  vps: { DEPLOY_MODE: 'vps', PUBLIC_URL: 'https://fin.example.kz' },
```

и добавьте перед `it('в режиме cloudflare с loopback учитывает CF-Connecting-IP', …)` (характеризационные тесты §8 для Caddy — проходят уже на текущем коде):

```ts
  it('в режиме vps Caddy с loopback передаёт IP клиента в X-Forwarded-For; CF-Connecting-IP игнорируется', async () => {
    expect(await ipOf('vps', { 'x-forwarded-for': '9.9.9.9' })).toBe('9.9.9.9');
    expect(await ipOf('vps', { 'x-forwarded-for': '9.9.9.9', 'cf-connecting-ip': '6.6.6.6' })).toBe('9.9.9.9');
  });

  it('в режиме vps прямое подключение не с loopback: X-Forwarded-For не учитывается', async () => {
    expect(await ipOf('vps', { 'x-forwarded-for': '9.9.9.9' }, '192.168.1.20')).toBe('192.168.1.20');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/deploy-files.test.ts tests/server/config.test.ts tests/server/client-ip.test.ts`
Expected: FAIL — нет модуля `scripts/lib/deploy-files`; тест vps в `config.test.ts` не получает ошибку. Тесты `client-ip` проходят.

- [ ] **Step 3: Implement**

`scripts/lib/deploy-files.ts` (`'$$$$'` в строке замены вставляет `$$` — так systemd получает буквальный `$`):

```ts
/** Имя юнита systemd и задачи Планировщика (§3 «Структура репозитория»: deploy/finmap-clone.service). */
export const SERVICE_NAME = 'finmap-clone';

/** Адрес приложения для Caddy на той же машине: «все интерфейсы» и localhost — это 127.0.0.1. */
export function upstreamAddress(host: string, port: number): string {
  if (host === '::1') return `[::1]:${port}`;
  if (['', '0.0.0.0', '::', 'localhost', '127.0.0.1'].includes(host)) return `127.0.0.1:${port}`;
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;
}

/**
 * Caddyfile для режима vps (§8.1): сайт по хосту PUBLIC_URL (Caddy сам получает сертификат)
 * и обратный прокси в приложение. Caddy передаёт X-Forwarded-For/Proto, приложение доверяет им
 * только от loopback (§8 «IP клиента»).
 */
export function renderCaddyfile(o: { publicUrl: string; host: string; port: number }): string {
  const site = new URL(o.publicUrl).host;
  return [
    `# Caddy для ${o.publicUrl}: HTTPS и проксирование в приложение.`,
    '# Сертификат Caddy получает сам; порты 80 и 443 должны быть открыты.',
    `${site} {`,
    '\tencode zstd gzip',
    `\treverse_proxy ${upstreamAddress(o.host, o.port)}`,
    '}',
    '',
  ].join('\n');
}

/** Экранирование спецификаторов systemd (%) в любом значении. */
function systemdValue(s: string): string {
  return s.replace(/%/g, '%%');
}

/** Аргумент ExecStart: % и $ экранируются, пробелы, кавычки и \ — в двойных кавычках. */
export function systemdArg(s: string): string {
  const v = systemdValue(s).replace(/\$/g, '$$$$');
  if (v !== '' && !/[\s"'\\;]/.test(v)) return v;
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Путь или присваивание в списке systemd: % экранируется, пробелы, кавычки и \ — в двойных кавычках. */
function systemdWord(s: string): string {
  const v = systemdValue(s);
  if (v !== '' && !/[\s"'\\;]/.test(v)) return v;
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * systemd-юнит (§9.1: на Linux — от отдельного пользователя). Перезапуск при падении — у супервизора и systemd.
 * Песочница: вся система только для чтения, кроме readWritePaths (папка приложения, данные, копии бэкапов);
 * путь с «-» в начале может отсутствовать (флешка не смонтирована) — юнит всё равно стартует.
 * Кэш npm — в папке данных: домашняя папка пользователя в песочнице только для чтения.
 */
export function renderSystemdUnit(o: {
  appName: string;
  user: string;
  workingDirectory: string;
  dataDir: string;
  execStart: string[];
  readWritePaths: string[];
}): string {
  return [
    '[Unit]',
    `Description=${systemdValue(o.appName)} (${SERVICE_NAME})`,
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `User=${systemdValue(o.user)}`,
    `WorkingDirectory=${systemdValue(o.workingDirectory)}`,
    `Environment=${systemdWord(`npm_config_cache=${o.dataDir}/npm-cache`)}`,
    'Environment=npm_config_update_notifier=false',
    `ExecStart=${o.execStart.map(systemdArg).join(' ')}`,
    'Restart=on-failure',
    'RestartSec=10',
    'TimeoutStopSec=30',
    'UMask=0077',
    'NoNewPrivileges=true',
    'PrivateTmp=true',
    'ProtectSystem=strict',
    `ReadWritePaths=${o.readWritePaths.map(systemdWord).join(' ')}`,
    'ProtectKernelTunables=true',
    'ProtectControlGroups=true',
    'RestrictSUIDSGID=true',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
  ].join('\n');
}

/** Значения для примеров в deploy/ (README ссылается на них). */
export const EXAMPLE = {
  publicUrl: 'https://fin.example.kz',
  host: '127.0.0.1',
  port: 3000,
  appName: 'Учёт',
  user: 'finmap',
  workingDirectory: '/opt/finmap-clone',
  dataDir: '/opt/finmap-clone/data',
  execStart: ['/usr/bin/npm', 'start'],
  readWritePaths: ['/opt/finmap-clone'],
} as const;
```

`deploy/Caddyfile.example` (отступ двух внутренних строк — табуляция, как у `caddy fmt`; тест сравнивает без отступов):

```
# Caddy для https://fin.example.kz: HTTPS и проксирование в приложение.
# Сертификат Caddy получает сам; порты 80 и 443 должны быть открыты.
fin.example.kz {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000
}
```

`deploy/finmap-clone.service`:

```
[Unit]
Description=Учёт (finmap-clone)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=finmap
WorkingDirectory=/opt/finmap-clone
Environment=npm_config_cache=/opt/finmap-clone/data/npm-cache
Environment=npm_config_update_notifier=false
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=10
TimeoutStopSec=30
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/opt/finmap-clone
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
```

`.gitattributes` (в корне):

```
# Файлы для Linux-сервера: systemd и Caddy ждут LF
deploy/* text eol=lf
```

`src/server/config.ts` — функция перед `toOrigin`:

```ts
/** https-адрес с настоящим доменом: для него Caddy получает сертификат (§8.1, режим vps). */
function isPublicHttps(url: string | null): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}
```

и проверка в `loadConfig` сразу после проверки режима `ngrok` (перед `const publicUrl = …`):

```ts
  if (e.DEPLOY_MODE === 'vps' && !isPublicHttps(e.PUBLIC_URL)) {
    throw new Error('Ошибка конфигурации .env — в режиме vps PUBLIC_URL обязателен: https://ваш-домен (например https://fin.example.kz)');
  }
```

`scripts/setup.ts` — в самом конце файла, после `console.log(`Адрес: ${config.publicUrl}`);`:

```ts
if (mode === 'vps') {
  console.log('Дальше на сервере: npm run service:install — подготовит Caddyfile и systemd-юнит и подскажет команды (README, «Режим vps»).');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/deploy-files.test.ts tests/server/config.test.ts tests/server/client-ip.test.ts`
Expected: PASS.

Run: `git add .gitattributes deploy && git ls-files --eol deploy`
Expected: у обоих файлов `attr/text eol=lf`.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add .gitattributes deploy scripts/lib/deploy-files.ts scripts/setup.ts src/server/config.ts tests/server/deploy-files.test.ts tests/server/config.test.ts tests/server/client-ip.test.ts
git commit -m "feat: режим vps — Caddyfile и systemd-юнит с песочницей из настроек, https-домен обязателен

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Блокировки — состояние, скачок часов, атомарная блокировка супервизора

**Files:**
- Modify: `src/server/lock.ts`, `src/server/modules/backup/restore.ts`, `tests/server/lock.test.ts`, `tests/server/restore.test.ts`

**Interfaces:**
- Consumes: `readLock`, `isStale`, `isPidAlive`, `currentBootTime`, `LockHeldError`, `acquireLock`, `isLockHeld` (`src/server/lock.ts`, план 1).
- Produces:
  - `SUPERVISOR_LOCK_FILE = 'supervisor.lock'`;
  - `type LockState = { kind: 'free' } | { kind: 'held'; pid: number } | { kind: 'suspect'; pid: number }`, `lockState(lockPath): LockState` (свой PID — `free`);
  - `isPortFree(host: string, port: number): Promise<boolean>` — переезжает из `restore.ts`;
  - `lockRunningPid(lockPath, portBusy: () => Promise<boolean>): Promise<number | null>` — `held` → PID; `suspect` → PID, только если порт занят;
  - `acquireExclusiveLock(lockPath, o: { portBusy: () => Promise<boolean>; token?: string }): Promise<() => void>` — файл `{pid, bootTime, token}` создаётся флагом `wx`; занят (`held`, или `suspect` при занятом порте, или свой PID из этой загрузки) → `LockHeldError`; устаревший перехватывается с проверкой; снятие удаляет файл только со своим `token`;
  - `restoreBackup` отказывает и при живом `data/supervisor.lock`.

- [ ] **Step 1: Write the failing tests**

`tests/server/lock.test.ts` — замените файл целиком (первые семь тестов — прежние):

```ts
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  acquireExclusiveLock,
  acquireLock,
  currentBootTime,
  isLockHeld,
  isPortFree,
  LockHeldError,
  lockRunningPid,
  lockState,
  readLockPid,
} from '../../src/server/lock';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-lock-'));
const lock = path.join(dir, 'app.lock');
afterEach(() => fs.rmSync(lock, { force: true }));

describe('lock', () => {
  it('берёт и снимает lock', () => {
    const release = acquireLock(lock);
    expect(readLockPid(lock)).toBe(process.pid);
    release();
    expect(fs.existsSync(lock)).toBe(false);
  });

  it('второй экземпляр не стартует, пока жив процесс-владелец', () => {
    fs.writeFileSync(lock, String(process.ppid)); // живой процесс (родитель vitest-воркера)
    expect(isLockHeld(lock)).toBe(true);
    expect(() => acquireLock(lock)).toThrow(LockHeldError);
  });

  it('перехватывает устаревший lock мёртвого процесса', () => {
    fs.writeFileSync(lock, '999999');
    expect(isLockHeld(lock)).toBe(false);
    const release = acquireLock(lock);
    expect(readLockPid(lock)).toBe(process.pid);
    release();
  });

  it('пишет lock в формате JSON { pid, bootTime }', () => {
    const release = acquireLock(lock);
    const data = JSON.parse(fs.readFileSync(lock, 'utf8')) as { pid: number; bootTime: number };
    expect(data.pid).toBe(process.pid);
    expect(Math.abs(data.bootTime - currentBootTime())).toBeLessThanOrEqual(2);
    release();
  });

  it('lock живого PID с текущим bootTime блокирует запуск; сообщение называет файл lock', () => {
    fs.writeFileSync(lock, JSON.stringify({ pid: process.ppid, bootTime: currentBootTime() }));
    expect(isLockHeld(lock)).toBe(true);
    let err: unknown;
    try {
      acquireLock(lock);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LockHeldError);
    expect((err as Error).message).toContain(lock);
    expect((err as Error).message).toMatch(/удал/i);
  });

  it('lock живого PID из прошлой загрузки системы (другой bootTime) устарел и перехватывается', () => {
    fs.writeFileSync(lock, JSON.stringify({ pid: process.ppid, bootTime: currentBootTime() - 3600 }));
    expect(isLockHeld(lock)).toBe(false);
    const release = acquireLock(lock);
    expect(readLockPid(lock)).toBe(process.pid);
    release();
  });

  it('старый формат (только PID): файл старше загрузки системы устарел, даже если PID жив', () => {
    fs.writeFileSync(lock, String(process.ppid));
    const beforeBoot = new Date((currentBootTime() - 3600) * 1000);
    fs.utimesSync(lock, beforeBoot, beforeBoot);
    expect(isLockHeld(lock)).toBe(false);
    const release = acquireLock(lock);
    expect(readLockPid(lock)).toBe(process.pid);
    release();
  });
});

const live = (bootShift = 0) => JSON.stringify({ pid: process.ppid, bootTime: currentBootTime() + bootShift });
const busy = async () => true;
const free = async () => false;

describe('lockState: скачок часов и перезагрузка', () => {
  it('нет файла, мёртвый PID, свой PID — free; живой из этой загрузки — held', () => {
    expect(lockState(lock)).toEqual({ kind: 'free' });
    fs.writeFileSync(lock, JSON.stringify({ pid: 999999, bootTime: currentBootTime() }));
    expect(lockState(lock)).toEqual({ kind: 'free' });
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, bootTime: currentBootTime() }));
    expect(lockState(lock)).toEqual({ kind: 'free' });
    fs.writeFileSync(lock, live());
    expect(lockState(lock)).toEqual({ kind: 'held', pid: process.ppid });
  });

  it('живой PID с другим bootTime — suspect; работает он, только если порт приложения занят', async () => {
    fs.writeFileSync(lock, live(-3600));
    expect(lockState(lock)).toEqual({ kind: 'suspect', pid: process.ppid });
    expect(isLockHeld(lock)).toBe(false);
    expect(await lockRunningPid(lock, busy)).toBe(process.ppid);
    expect(await lockRunningPid(lock, free)).toBeNull();
    fs.writeFileSync(lock, live());
    expect(await lockRunningPid(lock, free)).toBe(process.ppid);
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

describe('acquireExclusiveLock (блокировка супервизора)', () => {
  it('создаёт файл с pid, bootTime и token; снятие удаляет его', async () => {
    const release = await acquireExclusiveLock(lock, { portBusy: busy, token: 't1' });
    const data = JSON.parse(fs.readFileSync(lock, 'utf8')) as { pid: number; bootTime: number; token: string };
    expect(data).toMatchObject({ pid: process.pid, token: 't1' });
    release();
    expect(fs.existsSync(lock)).toBe(false);
  });

  it('живой владелец из этой загрузки — LockHeldError, файл не тронут', async () => {
    fs.writeFileSync(lock, live());
    await expect(acquireExclusiveLock(lock, { portBusy: free })).rejects.toBeInstanceOf(LockHeldError);
    expect(fs.readFileSync(lock, 'utf8')).toBe(live());
  });

  it('скачок часов: другой bootTime и занятый порт — занято, файл не тронут', async () => {
    const suspect = live(-3600);
    fs.writeFileSync(lock, suspect);
    await expect(acquireExclusiveLock(lock, { portBusy: busy })).rejects.toBeInstanceOf(LockHeldError);
    expect(fs.readFileSync(lock, 'utf8')).toBe(suspect);
  });

  it('после перезагрузки (другой bootTime, порт свободен) и мёртвый PID — перехват', async () => {
    for (const stale of [live(-3600), JSON.stringify({ pid: 999999, bootTime: currentBootTime() })]) {
      fs.writeFileSync(lock, stale);
      const release = await acquireExclusiveLock(lock, { portBusy: free, token: 'mine' });
      expect((JSON.parse(fs.readFileSync(lock, 'utf8')) as { token: string }).token).toBe('mine');
      release();
      expect(fs.existsSync(lock)).toBe(false);
      expect(fs.readdirSync(dir).filter((f) => f.includes('.stale'))).toEqual([]);
    }
  });

  it('два одновременных захвата устаревшего файла — побеждает один', async () => {
    fs.writeFileSync(lock, JSON.stringify({ pid: 999999, bootTime: currentBootTime() }));
    const results = await Promise.allSettled([
      acquireExclusiveLock(lock, { portBusy: free, token: 'a' }),
      acquireExclusiveLock(lock, { portBusy: free, token: 'b' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected' && r.reason instanceof LockHeldError)).toHaveLength(1);
    for (const r of results) if (r.status === 'fulfilled') r.value();
  });

  it('снятие не удаляет чужую блокировку (файл перехватил другой процесс)', async () => {
    const release = await acquireExclusiveLock(lock, { portBusy: free, token: 'old' });
    fs.writeFileSync(lock, JSON.stringify({ pid: process.ppid, bootTime: currentBootTime(), token: 'other' }));
    release();
    expect(fs.existsSync(lock)).toBe(true);
  });
});
```

`tests/server/restore.test.ts` — перед `it('держит lock на время восстановления и снимает его после (и после ошибки)', …)`:

```ts
  it('отказывается, если работает супервизор (data/supervisor.lock с живым PID)', async () => {
    const { config, archive } = prepare();
    fs.writeFileSync(path.join(config.dataDir, 'supervisor.lock'), JSON.stringify({ pid: process.ppid, bootTime: currentBootTime() }));
    await expect(restoreBackup({ archivePath: archive, config })).rejects.toThrow(/остановите приложение/i);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/lock.test.ts tests/server/restore.test.ts`
Expected: FAIL — `lockState`, `isPortFree`, `lockRunningPid`, `acquireExclusiveLock` не экспортируются; восстановление при живом `supervisor.lock` проходит.

- [ ] **Step 3: Implement**

`src/server/lock.ts` — замените файл целиком (`readLock`, `isStale`, `acquireLock`, `isLockHeld`, `readLockPid`, `LockHeldError` — прежние):

```ts
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';

/** Допуск при сравнении времени загрузки системы (uptime и часы дают погрешность). */
const BOOT_TOLERANCE_S = 60;

export class LockHeldError extends Error {
  constructor(
    public readonly pid: number,
    public readonly lockPath: string,
  ) {
    super(
      `Приложение уже запущено (PID ${pid}, файл блокировки ${lockPath}). Остановите его и повторите. ` +
        `Если приложение точно не запущено, удалите файл ${lockPath}.`,
    );
    this.name = 'LockHeldError';
  }
}

/** Время загрузки системы, в секундах Unix. */
export function currentBootTime(): number {
  return Math.round((Date.now() - os.uptime() * 1000) / 1000);
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

interface LockInfo {
  pid: number;
  /** null — старый формат (в файле только PID). */
  bootTime: number | null;
  mtimeMs: number;
}

function readLock(lockPath: string): LockInfo | null {
  try {
    const text = fs.readFileSync(lockPath, 'utf8').trim();
    const mtimeMs = fs.statSync(lockPath).mtimeMs;
    let pid: unknown;
    let bootTime: number | null = null;
    if (text.startsWith('{')) {
      const data = JSON.parse(text) as { pid?: unknown; bootTime?: unknown };
      pid = data.pid;
      if (typeof data.bootTime === 'number' && Number.isFinite(data.bootTime)) bootTime = data.bootTime;
    } else {
      pid = Number.parseInt(text, 10);
    }
    return typeof pid === 'number' && Number.isInteger(pid) && pid > 0 ? { pid, bootTime, mtimeMs } : null;
  } catch {
    return null;
  }
}

export function readLockPid(lockPath: string): number | null {
  return readLock(lockPath)?.pid ?? null;
}

/**
 * Lock устарел, если записан в прошлую загрузку системы (после перезагрузки PID может принадлежать
 * чужому процессу) или его процесс мёртв.
 */
function isStale(info: LockInfo): boolean {
  const boot = currentBootTime();
  if (info.bootTime !== null) {
    if (Math.abs(info.bootTime - boot) > BOOT_TOLERANCE_S) return true;
  } else if (info.mtimeMs < boot * 1000) {
    return true;
  }
  return !isPidAlive(info.pid);
}

function heldByOther(info: LockInfo | null): info is LockInfo {
  return info !== null && info.pid !== process.pid && !isStale(info);
}

/** Блокировка супервизора в папке данных (npm start, npm run stop, restore). */
export const SUPERVISOR_LOCK_FILE = 'supervisor.lock';

/**
 * Состояние lock: free — нет или процесс мёртв (или это мы); held — жив и из этой загрузки системы;
 * suspect — PID жив, но bootTime другой. Это либо перезагрузка (PID достался чужому процессу),
 * либо скачок системных часов больше чем на минуту при работающем приложении — различить можно
 * только по занятому порту приложения.
 */
export type LockState = { kind: 'free' } | { kind: 'held'; pid: number } | { kind: 'suspect'; pid: number };

function stateOf(info: LockInfo | null, ownIsFree: boolean): LockState {
  if (info === null || !isPidAlive(info.pid)) return { kind: 'free' };
  if (info.pid === process.pid && ownIsFree) return { kind: 'free' };
  return isStale(info) ? { kind: 'suspect', pid: info.pid } : { kind: 'held', pid: info.pid };
}

export function lockState(lockPath: string): LockState {
  return stateOf(readLock(lockPath), true);
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

/** Процесс lock работает: held, либо suspect при занятом порте приложения (скачок часов). */
export async function lockRunningPid(lockPath: string, portBusy: () => Promise<boolean>): Promise<number | null> {
  const s = lockState(lockPath);
  if (s.kind === 'held') return s.pid;
  if (s.kind === 'suspect' && (await portBusy())) return s.pid;
  return null;
}

function writeExclusive(lockPath: string, token: string): boolean {
  try {
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, bootTime: currentBootTime(), token }), { flag: 'wx' });
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw e;
  }
}

function readRaw(p: string): string | null {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Атомарная блокировка (супервизор): файл создаётся только если его нет (flag 'wx').
 * Занятый файл перехватывается, только если он устарел: процесс мёртв, либо bootTime другой и порт
 * приложения свободен (portBusy). Перехват проверяется: файл уносится в сторону переименованием,
 * и если унесли не то, что оценивали (его успел заменить другой процесс), он возвращается.
 * Снятие удаляет файл, только если в нём наш token.
 */
export async function acquireExclusiveLock(
  lockPath: string,
  o: { portBusy: () => Promise<boolean>; token?: string },
): Promise<() => void> {
  const token = o.token ?? crypto.randomUUID();
  const release = () => {
    try {
      const data = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as { token?: unknown };
      if (data.token === token) fs.rmSync(lockPath, { force: true });
    } catch {
      /* файла нет или он чужой и битый — не трогаем */
    }
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    if (writeExclusive(lockPath, token)) return release;
    const raw = readRaw(lockPath);
    if (raw === null) continue; // исчез между попытками
    // Свой PID с чужим token — второй захват в этом же процессе: занято.
    const state = stateOf(readLock(lockPath), false);
    if (state.kind === 'held' || (state.kind === 'suspect' && (await o.portBusy()))) {
      throw new LockHeldError(state.pid, lockPath);
    }
    const aside = `${lockPath}.${token}.stale`;
    try {
      fs.renameSync(lockPath, aside);
    } catch {
      continue;
    }
    if (readRaw(aside) !== raw) {
      // Унесли свежую блокировку другого процесса — возвращаем её на место (если место ещё свободно).
      try {
        fs.copyFileSync(aside, lockPath, fs.constants.COPYFILE_EXCL);
      } catch {
        /* место уже занято — тот процесс сам разберётся */
      }
      fs.rmSync(aside, { force: true });
      throw new LockHeldError(readLockPid(lockPath) ?? 0, lockPath);
    }
    fs.rmSync(aside, { force: true });
  }
  throw new LockHeldError(readLockPid(lockPath) ?? 0, lockPath);
}

export function isLockHeld(lockPath: string): boolean {
  return heldByOther(readLock(lockPath));
}

export function acquireLock(lockPath: string): () => void {
  const info = readLock(lockPath);
  if (heldByOther(info)) throw new LockHeldError(info.pid, lockPath);
  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, bootTime: currentBootTime() }));
  return () => {
    if (readLockPid(lockPath) === process.pid) fs.rmSync(lockPath, { force: true });
  };
}
```

`src/server/modules/backup/restore.ts` — удалите локальную функцию `isPortFree` и импорт `import net from 'node:net';`; импорт lock замените на:

```ts
import { acquireLock, isLockHeld, isPortFree, SUPERVISOR_LOCK_FILE } from '../../lock';
```

и проверку в начале `restoreBackup` `if (isLockHeld(config.lockPath) || !(await isPortFree(config.host, config.port))) {` — на:

```ts
  const supervisorLock = path.join(config.dataDir, SUPERVISOR_LOCK_FILE);
  if (isLockHeld(config.lockPath) || isLockHeld(supervisorLock) || !(await isPortFree(config.host, config.port))) {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/lock.test.ts tests/server/restore.test.ts tests/server/main.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/server/lock.ts src/server/modules/backup/restore.ts tests/server/lock.test.ts tests/server/restore.test.ts
git commit -m "feat: состояние блокировки при скачке часов и атомарная блокировка с token; restore проверяет супервизор

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Супервизор — журнал в файле, блокировка, заявка на остановку, ошибки без окна

**Files:**
- Create: `scripts/lib/run-files.ts`, `tests/server/run-files.test.ts`
- Modify: `scripts/run.ts`, `scripts/lib/cloudflared.ts`, `tests/server/cloudflared.test.ts`

**Interfaces:**
- Consumes: `acquireExclusiveLock`, `isPortFree`, `isLockHeld`, `LockHeldError`, `SUPERVISOR_LOCK_FILE` (задача 2); `loadConfig`, `Config`; `createSupervisor({ exit, logError })`.
- Produces:
  - `runFiles(dataDir): { supervisorLock; stopRequest; supervisorLog }` — `<data>/supervisor.lock`, `<data>/stop.request`, `<data>/logs/supervisor.log`;
  - `takeStopRequest(file): boolean`;
  - `createFileLog(file, o?: { maxBytes?: number; now?: () => Date }): (message: string) => void`;
  - `lenientRunConfig(env): { dataDir; lockPath; host; port }` — без проверки остальных настроек;
  - `loadConfigOrLog(env, now?): Config | null` — ошибка настроек → консоль и `<DATA_DIR или data>/logs/supervisor.log`;
  - `cloudflaredArgs(logsDir): string[]` — `['tunnel', '--no-autoupdate', '--logfile', <logs>/cloudflared.log, 'run']`;
  - `npm start` держит `data/supervisor.lock` всё время работы, проверяет `data/stop.request` раз в секунду, пишет сбой сборки интерфейса в журнал.

- [ ] **Step 1: Write the failing tests**

`tests/server/run-files.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFileLog, lenientRunConfig, loadConfigOrLog, runFiles, takeStopRequest } from '../../scripts/lib/run-files';

let dir = '';
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = '';
});
const tmp = () => (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-run-files-')));

describe('служебные файлы супервизора', () => {
  it('лежат в папке данных, журнал — в logs/', () => {
    const f = runFiles('/srv/data');
    expect(f.supervisorLock).toBe(path.join('/srv/data', 'supervisor.lock'));
    expect(f.stopRequest).toBe(path.join('/srv/data', 'stop.request'));
    expect(f.supervisorLog).toBe(path.join('/srv/data', 'logs', 'supervisor.log'));
  });

  it('заявка на остановку забирается один раз', () => {
    const file = path.join(tmp(), 'stop.request');
    expect(takeStopRequest(file)).toBe(false);
    fs.writeFileSync(file, '');
    expect(takeStopRequest(file)).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
    expect(takeStopRequest(file)).toBe(false);
  });
});

describe('журнал супервизора в файле', () => {
  it('создаёт папку и дописывает строки со временем', () => {
    const file = path.join(tmp(), 'logs', 'supervisor.log');
    const log = createFileLog(file, { now: () => new Date('2026-10-07T10:00:00.000Z') });
    log('[server] завершился с кодом 1; перезапуск через 1 с');
    log('второе');
    expect(fs.readFileSync(file, 'utf8')).toBe(
      '2026-10-07T10:00:00.000Z [server] завершился с кодом 1; перезапуск через 1 с\n2026-10-07T10:00:00.000Z второе\n',
    );
  });

  it('при превышении размера переносит старое в .1 и начинает заново', () => {
    const file = path.join(tmp(), 'supervisor.log');
    const log = createFileLog(file, { maxBytes: 50, now: () => new Date('2026-10-07T10:00:00.000Z') });
    log('a'.repeat(40));
    log('b'.repeat(40));
    log('c');
    expect(fs.readFileSync(`${file}.1`, 'utf8')).toContain('b'.repeat(40));
    expect(fs.readFileSync(file, 'utf8')).toBe('2026-10-07T10:00:00.000Z c\n');
  });

  it('ошибка записи не выбрасывается (вместо папки журналов — файл)', () => {
    const blocker = path.join(tmp(), 'logs');
    fs.writeFileSync(blocker, 'x');
    const log = createFileLog(path.join(blocker, 'supervisor.log'));
    expect(() => log('сообщение')).not.toThrow();
  });
});

describe('настройки супервизора', () => {
  it('lenientRunConfig: пути и порт без проверки остальных настроек; значения по умолчанию', () => {
    expect(lenientRunConfig({})).toEqual({
      dataDir: path.resolve('data'),
      lockPath: path.resolve('data', 'app.lock'),
      host: '127.0.0.1',
      port: 3000,
    });
    const c = lenientRunConfig({ DATA_DIR: ' /srv/fin ', HOST: '0.0.0.0', PORT: '3457', SESSION_SECRET: 'short' });
    expect(c).toEqual({ dataDir: path.resolve('/srv/fin'), lockPath: path.resolve('/srv/fin', 'app.lock'), host: '0.0.0.0', port: 3457 });
    expect(lenientRunConfig({ PORT: 'abc' }).port).toBe(3000);
  });

  it('ошибка настроек при автозапуске попадает в data/logs/supervisor.log', () => {
    const data = tmp();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const config = loadConfigOrLog({ DATA_DIR: data, SESSION_SECRET: 'short' }, () => new Date('2026-10-07T10:00:00.000Z'));
    vi.restoreAllMocks();
    expect(config).toBeNull();
    const log = fs.readFileSync(path.join(data, 'logs', 'supervisor.log'), 'utf8');
    expect(log).toMatch(/^2026-10-07T10:00:00\.000Z Приложение не запущено: .*SESSION_SECRET/);
  });

  it('верные настройки — Config, журнал не пишется', () => {
    const data = tmp();
    const config = loadConfigOrLog({ DATA_DIR: data, SESSION_SECRET: 's'.repeat(40) });
    expect(config?.dataDir).toBe(path.resolve(data));
    expect(fs.existsSync(path.join(data, 'logs'))).toBe(false);
  });
});
```

`tests/server/cloudflared.test.ts` — в импорт из `../../scripts/lib/cloudflared` добавьте `cloudflaredArgs` и в конец файла:

```ts
describe('cloudflaredArgs', () => {
  it('именованный туннель без автообновления, журнал — в data/logs/cloudflared.log', () => {
    expect(cloudflaredArgs(path.join('D:', 'club', 'data', 'logs'))).toEqual([
      'tunnel',
      '--no-autoupdate',
      '--logfile',
      path.join('D:', 'club', 'data', 'logs', 'cloudflared.log'),
      'run',
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/run-files.test.ts tests/server/cloudflared.test.ts`
Expected: FAIL — нет модуля `scripts/lib/run-files`, нет экспорта `cloudflaredArgs`.

- [ ] **Step 3: Implement**

`scripts/lib/run-files.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, type Config } from '../../src/server/config';
import { SUPERVISOR_LOCK_FILE } from '../../src/server/lock';

/** Служебные файлы супервизора в папке данных. */
export function runFiles(dataDir: string) {
  return {
    /** Блокировка супервизора {pid, bootTime, token}: второй npm start не запускается, npm run stop знает, кого остановить. */
    supervisorLock: path.join(dataDir, SUPERVISOR_LOCK_FILE),
    /** Заявка на остановку: её создаёт npm run stop, супервизор проверяет раз в секунду. */
    stopRequest: path.join(dataDir, 'stop.request'),
    /** Журнал супервизора: перезапуски, ошибки туннеля (§9.1) — окна консоли при автозапуске нет. */
    supervisorLog: path.join(dataDir, 'logs', 'supervisor.log'),
  };
}

/** Забирает заявку на остановку: файл был — удаляет его и возвращает true. */
export function takeStopRequest(file: string): boolean {
  try {
    fs.rmSync(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Журнал в файл: строка «время сообщение». При размере от maxBytes файл переименовывается в .1
 * (одна старая копия). Ошибки записи глотаются: журнал не должен ронять супервизор.
 */
export function createFileLog(file: string, o: { maxBytes?: number; now?: () => Date } = {}): (message: string) => void {
  const maxBytes = o.maxBytes ?? 10 * 1024 * 1024;
  const now = o.now ?? (() => new Date());
  return (message) => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      let size = 0;
      try {
        size = fs.statSync(file).size;
      } catch {
        /* файла ещё нет */
      }
      if (size >= maxBytes) fs.renameSync(file, `${file}.1`);
      fs.appendFileSync(file, `${now().toISOString()} ${message}\n`);
    } catch {
      /* диск недоступен — сообщение остаётся только в консоли */
    }
  };
}

/**
 * Пути и порт без полной проверки настроек: для npm run stop и журнала ошибок настроек.
 * Значения по умолчанию — как в loadConfig (§3 «Переменные»).
 */
export function lenientRunConfig(env: Record<string, string | undefined>) {
  const dataDir = path.resolve(env.DATA_DIR?.trim() || 'data');
  const port = Number.parseInt(env.PORT?.trim() ?? '', 10);
  return {
    dataDir,
    lockPath: path.join(dataDir, 'app.lock'),
    host: env.HOST?.trim() || '127.0.0.1',
    port: Number.isInteger(port) && port >= 0 && port <= 65535 ? port : 3000,
  };
}

/**
 * Загружает настройки; при ошибке пишет её в консоль и в data/logs/supervisor.log
 * (при автозапуске окна нет — иначе причина пропадёт) и возвращает null.
 */
export function loadConfigOrLog(env: Record<string, string | undefined>, now?: () => Date): Config | null {
  try {
    return loadConfig(env);
  } catch (e) {
    const message = `Приложение не запущено: ${(e as Error).message}`;
    console.error(message);
    createFileLog(runFiles(lenientRunConfig(env).dataDir).supervisorLog, { now })(message);
    return null;
  }
}
```

`scripts/lib/cloudflared.ts` — в конец файла (`path` там уже импортирован):

```ts
/** Аргументы запуска туннеля: журнал cloudflared — в data/logs (при автозапуске окна нет). */
export function cloudflaredArgs(logsDir: string): string[] {
  return ['tunnel', '--no-autoupdate', '--logfile', path.join(logsDir, 'cloudflared.log'), 'run'];
}
```

`scripts/run.ts` — замените файл целиком (сборка, сервер, cloudflared и ngrok — как раньше; новое — ошибки настроек и сборки в журнал, атомарная блокировка супервизора, заявка на остановку, `--logfile` для cloudflared):

```ts
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { acquireExclusiveLock, isLockHeld, isPortFree, LockHeldError } from '../src/server/lock';
import { EXIT_LOCK_HELD } from '../src/server/main';
import { cloudflaredArgs, cloudflaredTarget } from './lib/cloudflared';
import { needsClientBuild } from './lib/client-build';
import { connectWithRetry, errorText, isFatalNgrokError, maskSecret } from './lib/ngrok';
import { createFileLog, loadConfigOrLog, runFiles, takeStopRequest } from './lib/run-files';
import { createSupervisor, type ChildLike } from './lib/supervise';

if (fs.existsSync('.env')) process.loadEnvFile('.env');
// Ошибка настроек пишется и в data/logs/supervisor.log: при автозапуске окна нет.
const config = loadConfigOrLog(process.env) ?? process.exit(1);

const files = runFiles(config.dataDir);
const fileLog = createFileLog(files.supervisorLog);
// При автозапуске окна консоли нет: всё, что пишет супервизор, дублируется в data/logs/supervisor.log.
const logInfo = (m: string) => {
  console.log(m);
  fileLog(m);
};
const logError = (m: string) => {
  console.error(m);
  fileLog(m);
};

const supervisor = createSupervisor({ exit: (code) => process.exit(code), logError });

// Обработчики сигналов — до любых await. Консольное событие (Ctrl+C, Ctrl+Break, закрытие окна)
// в Windows уже доставлено всем процессам консоли, поэтому детей там не убиваем.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) {
  process.on(sig, () => void supervisor.shutdown(0, { fromConsole: true }));
}

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.logsDir, { recursive: true });
// Блокировка супервизора: атомарное создание; чужой bootTime (скачок часов) при занятом порте — занято.
const portBusy = async () => !(await isPortFree(config.host, config.port));
let releaseSupervisorLock = () => {};
try {
  releaseSupervisorLock = await acquireExclusiveLock(files.supervisorLock, { portBusy });
} catch (e) {
  if (!(e instanceof LockHeldError)) throw e;
  logError(`Приложение уже запущено (супервизор PID ${e.pid}). Остановите его командой npm run stop и повторите.`);
  process.exit(1);
}
// Страховка: при любом выходе не оставляем детей-сирот и снимаем свою (и только свою) блокировку.
process.on('exit', () => {
  supervisor.killAll();
  releaseSupervisorLock();
});
// Старая заявка (npm run stop при остановленном приложении) не должна остановить новый запуск.
takeStopRequest(files.stopRequest);
setInterval(() => {
  if (takeStopRequest(files.stopRequest)) {
    logInfo('Остановка по команде npm run stop');
    void supervisor.shutdown(0);
  }
}, 1000).unref();
logInfo(`Супервизор запущен (PID ${process.pid}), режим ${config.deployMode}`);

if (isLockHeld(config.lockPath)) {
  logError(
    `Приложение уже запущено другим процессом (файл блокировки ${config.lockPath}). Остановите его и повторите. ` +
      'Если приложение точно не запущено, удалите этот файл.',
  );
  process.exit(1);
}

let cloudflaredBin = '';
if (config.deployMode === 'cloudflare') {
  cloudflaredBin = config.cloudflaredPath ?? cloudflaredTarget(config.binDir);
  if (!fs.existsSync(cloudflaredBin)) {
    logError(`cloudflared не найден (${cloudflaredBin}). Запустите npm run setup или укажите CLOUDFLARED_PATH.`);
    process.exit(1);
  }
}

if (needsClientBuild(process.cwd())) {
  logInfo('Собираем интерфейс…');
  const npmCli = process.env.npm_execpath;
  const r = npmCli
    ? spawnSync(process.execPath, [npmCli, 'run', 'build:client'], { stdio: 'inherit' })
    : spawnSync('npm run build:client', { stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    logError(
      `Не удалось собрать интерфейс (код ${r.status ?? '—'}${r.error ? `, ${r.error.message}` : ''}). ` +
        'Выполните npm run build:client в окне команд, чтобы увидеть ошибку.',
    );
    process.exit(r.status ?? 1);
  }
}

supervisor.supervise(
  'server',
  () => spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], { stdio: ['inherit', 'inherit', 'inherit', 'ipc'] }) as ChildLike,
  {
    ipc: true,
    onExit: (code) => {
      if (code === EXIT_LOCK_HELD) {
        logError(`Приложение уже запущено другим процессом (файл блокировки ${config.lockPath}). Супервизор завершает работу.`);
        void supervisor.shutdown(1);
        return false;
      }
      return true;
    },
  },
);

if (config.deployMode === 'cloudflare') {
  supervisor.supervise('cloudflared', () => {
    const env: NodeJS.ProcessEnv = { ...process.env, TUNNEL_TOKEN: config.cfTunnelToken ?? '' };
    // Туннелю не нужны остальные секреты приложения.
    for (const k of ['SESSION_SECRET', 'NGROK_AUTHTOKEN', 'CF_TUNNEL_TOKEN']) delete env[k];
    return spawn(cloudflaredBin, cloudflaredArgs(config.logsDir), { stdio: 'inherit', env }) as ChildLike;
  });
  logInfo(`Публичный адрес: ${config.publicUrl}`);
}

if (config.deployMode === 'ngrok') {
  const secret = config.ngrokAuthtoken;
  try {
    const ngrok = await import('@ngrok/ngrok');
    // Повторяем всё, кроме ошибок токена/домена: сеть клуба может появиться позже сервера.
    const listener = await connectWithRetry({
      connect: () =>
        ngrok.forward({
          addr: config.port,
          authtoken: config.ngrokAuthtoken ?? undefined,
          domain: config.ngrokDomain ?? undefined,
        }),
      isFatal: isFatalNgrokError,
      isStopped: () => supervisor.isShuttingDown(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      onRetry: (e, ms) =>
        logError(`Не удалось открыть туннель ngrok: ${maskSecret(errorText(e), secret)}; повтор через ${ms / 1000} с`),
    });
    if (listener) logInfo(`Публичный адрес: ${listener.url()}`);
  } catch (e) {
    logError(`Не удалось открыть туннель ngrok: ${maskSecret(errorText(e), secret)}`);
    await supervisor.shutdown(1);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/run-files.test.ts tests/server/cloudflared.test.ts tests/server/supervise.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add scripts/lib/run-files.ts scripts/lib/cloudflared.ts scripts/run.ts tests/server/run-files.test.ts tests/server/cloudflared.test.ts
git commit -m "feat: супервизор — журнал data/logs/supervisor.log с ошибками настроек и сборки, атомарная блокировка, заявка на остановку, журнал cloudflared

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `npm run stop`

**Files:**
- Create: `scripts/lib/stop.ts`, `scripts/stop.ts`, `tests/server/stop.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `runFiles`, `lenientRunConfig` (задача 3); `isPidAlive`, `isPortFree`, `lockRunningPid` (задача 2).
- Produces:
  - `interface StopDeps { supervisorPid; serverPid; isAlive; requestStop; clearRequest; forceKill; sleep; now; timeoutMs?; killWaitMs? }`;
  - `type StopResult = 'not-running' | 'stopped' | 'killed' | 'killed-server' | 'failed'`, `stopApp(d): Promise<StopResult>`;
  - `forceKillCommand(platform, pid): { cmd; args } | null`, `STOP_MESSAGES: Record<StopResult, string>`;
  - npm-скрипт `stop` (код выхода 1 при `failed`).

- [ ] **Step 1: Write the failing test**

`tests/server/stop.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { forceKillCommand, STOP_MESSAGES, stopApp, type StopDeps } from '../../scripts/lib/stop';

/** Мир с подменёнными часами: процессы «умирают» в заданный момент или от принудительного завершения. */
function world(o: { sup: number | null; srv: number | null; dieAtMs?: number | null; unkillable?: boolean }) {
  let clock = 0;
  const events: string[] = [];
  const killed = new Set<number>();
  const deps: StopDeps = {
    supervisorPid: o.sup,
    serverPid: o.srv,
    isAlive: (pid) => !killed.has(pid) && (o.dieAtMs == null || clock < o.dieAtMs),
    requestStop: () => events.push('request'),
    clearRequest: () => events.push('clear'),
    forceKill: (pid) => {
      events.push(`kill ${pid}`);
      if (!o.unkillable) killed.add(pid);
    },
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    timeoutMs: 20_000,
    killWaitMs: 5_000,
  };
  return { deps, events, clock: () => clock };
}

describe('npm run stop', () => {
  it('ничего не запущено — ничего не делает', async () => {
    const w = world({ sup: null, srv: null });
    expect(await stopApp(w.deps)).toBe('not-running');
    expect(w.events).toEqual([]);
  });

  it('супервизор остановился по заявке — без принудительного завершения', async () => {
    const w = world({ sup: 100, srv: 200, dieAtMs: 1500 });
    expect(await stopApp(w.deps)).toBe('stopped');
    expect(w.events).toEqual(['request']);
    expect(w.clock()).toBe(1500);
  });

  it('супервизор не ответил за 20 с — заявка убирается, процессы завершаются принудительно', async () => {
    const w = world({ sup: 100, srv: 200, dieAtMs: null });
    expect(await stopApp(w.deps)).toBe('killed');
    expect(w.events).toEqual(['request', 'clear', 'kill 100', 'kill 200']);
    expect(w.clock()).toBe(20_000);
  });

  it('сервер без супервизора (npm run dev) завершается сразу, без заявки и без «20 секунд» в сообщении', async () => {
    const w = world({ sup: null, srv: 200, dieAtMs: null });
    expect(await stopApp(w.deps)).toBe('killed-server');
    expect(w.events).toEqual(['kill 200']);
    expect(STOP_MESSAGES['killed-server']).not.toMatch(/20 секунд/);
  });

  it('процесс жив и после принудительного завершения — failed через 5 с ожидания', async () => {
    const w = world({ sup: 100, srv: null, dieAtMs: null, unkillable: true });
    expect(await stopApp(w.deps)).toBe('failed');
    expect(w.events).toEqual(['request', 'clear', 'kill 100']);
    expect(w.clock()).toBe(25_000);
    expect(STOP_MESSAGES.failed).toMatch(/Перезагрузите/);
  });

  it('на Windows — taskkill всего дерева, на POSIX — сигнал (SIGKILL в обёртке)', () => {
    expect(forceKillCommand('win32', 4242)).toEqual({ cmd: 'taskkill', args: ['/PID', '4242', '/T', '/F'] });
    expect(forceKillCommand('linux', 4242)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/stop.test.ts`
Expected: FAIL — нет модуля `scripts/lib/stop`.

- [ ] **Step 3: Implement**

`scripts/lib/stop.ts`:

```ts
export interface StopDeps {
  /** PID работающего супервизора (data/supervisor.lock) или null. */
  supervisorPid: number | null;
  /** PID работающего сервера (data/app.lock) или null. */
  serverPid: number | null;
  isAlive: (pid: number) => boolean;
  /** Создать заявку на остановку (data/stop.request). */
  requestStop: () => void;
  /** Убрать заявку, которую никто не забрал. */
  clearRequest: () => void;
  /** Принудительно завершить процесс (на Windows — вместе с дочерними). */
  forceKill: (pid: number) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** Сколько ждать мягкой остановки, мс (по умолчанию 20 000). */
  timeoutMs?: number;
  /** Сколько ждать исчезновения процессов после принудительного завершения, мс (по умолчанию 5 000). */
  killWaitMs?: number;
}

/**
 * not-running — ничего не запущено; stopped — остановлено по заявке; killed — супервизор не ответил,
 * завершён принудительно; killed-server — сервер без супервизора (npm run dev) завершён принудительно;
 * failed — процесс жив и после принудительного завершения.
 */
export type StopResult = 'not-running' | 'stopped' | 'killed' | 'killed-server' | 'failed';

/**
 * Остановка приложения (§9.3: перед восстановлением и обновлением). Сначала мягко — заявкой,
 * которую супервизор забирает раз в секунду и останавливает сервер штатно (БД закрыта, lock снят).
 * Если за timeoutMs процессы не завершились — принудительно (WAL сохраняет согласованность, §9.1),
 * затем проверка, что процессов больше нет.
 */
export async function stopApp(d: StopDeps): Promise<StopResult> {
  const { supervisorPid: sup, serverPid: srv } = d;
  if (sup === null && srv === null) return 'not-running';
  const alive = (pid: number | null): pid is number => pid !== null && d.isAlive(pid);
  const gone = () => !alive(sup) && !alive(srv);

  if (sup !== null) {
    d.requestStop();
    const deadline = d.now() + (d.timeoutMs ?? 20_000);
    while (d.now() < deadline) {
      if (gone()) return 'stopped';
      await d.sleep(500);
    }
    if (gone()) return 'stopped';
    d.clearRequest();
  }
  for (const pid of [sup, srv]) if (alive(pid)) d.forceKill(pid);
  const killDeadline = d.now() + (d.killWaitMs ?? 5_000);
  while (!gone() && d.now() < killDeadline) await d.sleep(250);
  if (!gone()) return 'failed';
  return sup === null ? 'killed-server' : 'killed';
}

/** Команда принудительного завершения дерева процессов; на POSIX — null (используется SIGKILL). */
export function forceKillCommand(platform: NodeJS.Platform, pid: number): { cmd: string; args: string[] } | null {
  return platform === 'win32' ? { cmd: 'taskkill', args: ['/PID', String(pid), '/T', '/F'] } : null;
}

export const STOP_MESSAGES: Record<StopResult, string> = {
  'not-running': 'Приложение не запущено.',
  stopped: 'Приложение остановлено.',
  killed:
    'Приложение не ответило за 20 секунд и остановлено принудительно. База осталась согласованной; ' +
    'могли не сохраниться только изменения, которые выполнялись в эту секунду.',
  'killed-server': 'Сервер, запущенный без супервизора (например npm run dev), остановлен принудительно.',
  failed: 'Не удалось остановить приложение даже принудительно. Перезагрузите компьютер и повторите.',
};
```

`scripts/stop.ts` (тонкая обёртка, не тестируется; настройки не проверяет — нужны только `DATA_DIR`, `HOST`, `PORT`):

```ts
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { isPidAlive, isPortFree, lockRunningPid } from '../src/server/lock';
import { lenientRunConfig, runFiles } from './lib/run-files';
import { forceKillCommand, STOP_MESSAGES, stopApp } from './lib/stop';

if (fs.existsSync('.env')) process.loadEnvFile('.env');
// Полная проверка настроек не нужна: остановить приложение можно и при ошибке в них.
const cfg = lenientRunConfig(process.env);
const files = runFiles(cfg.dataDir);
// Чужой bootTime в lock (скачок часов) — приложение работает, если его порт занят.
const portBusy = async () => !(await isPortFree(cfg.host, cfg.port));

const result = await stopApp({
  supervisorPid: await lockRunningPid(files.supervisorLock, portBusy),
  serverPid: await lockRunningPid(cfg.lockPath, portBusy),
  isAlive: isPidAlive,
  requestStop: () => fs.writeFileSync(files.stopRequest, String(process.pid)),
  clearRequest: () => fs.rmSync(files.stopRequest, { force: true }),
  forceKill: (pid) => {
    const c = forceKillCommand(process.platform, pid);
    if (c) spawnSync(c.cmd, c.args, { stdio: 'ignore' });
    else {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* уже завершился */
      }
    }
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: Date.now,
});

console.log(STOP_MESSAGES[result]);
if (result === 'failed') process.exit(1);
```

`package.json` — в `scripts` сразу после `"start": "tsx scripts/run.ts",`:

```json
    "stop": "tsx scripts/stop.ts",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/stop.test.ts`
Expected: PASS.

- [ ] **Step 5: Live check on a test port (без автозапуска)**

Сохраните скрипт как `/tmp/p8-shift.mjs` (не в репозитории):

```js
// Сдвигает bootTime в app.lock и supervisor.lock на час назад (имитация скачка часов).
import fs from 'node:fs';
import path from 'node:path';
const dir = process.argv[2];
for (const f of ['app.lock', 'supervisor.lock']) {
  const p = path.join(dir, f);
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  d.bootTime -= 3600;
  fs.writeFileSync(p, JSON.stringify(d));
}
```

В Git Bash из папки проекта, с отдельной папкой данных и свободным портом (не 3000 и не порт рабочего приложения; `cygpath -m` даёт путь, понятный Node на Windows):

```bash
export SESSION_SECRET=ssssssssssssssssssssssssssssssssssssssss DATA_DIR="$(cygpath -m "$(mktemp -d)")" PORT=41799 RATES_SOURCE=fixtures
npm start > /tmp/fc-stop-check.log 2>&1 &
for i in $(seq 1 90); do curl -s http://127.0.0.1:41799/api/v1/health | grep -q ok && break; sleep 1; done
npm start; echo "второй запуск: код $?"
node /tmp/p8-shift.mjs "$DATA_DIR"
cp "$DATA_DIR/supervisor.lock" /tmp/sup.before
npm start; echo "второй запуск после скачка часов: код $?"
cmp "$DATA_DIR/supervisor.lock" /tmp/sup.before && echo "supervisor.lock не тронут"
npm run stop
curl -s -m 2 http://127.0.0.1:41799/api/v1/health || echo "остановлено"
SESSION_SECRET=short npm run stop
SESSION_SECRET=short npm start; tail -1 "$DATA_DIR/logs/supervisor.log"
```

Expected: второй `npm start` (до и после сдвига часов) печатает «Приложение уже запущено (супервизор PID …)» и код 1; `supervisor.lock` не тронут; `npm run stop` — «Приложение остановлено.» за 1–3 с, сервер недоступен, в `$DATA_DIR` нет `app.lock` и `supervisor.lock`; `npm run stop` со сломанными настройками — «Приложение не запущено.» без трассировки; запуск со сломанными настройками пишет в `supervisor.log` строку «Приложение не запущено: Ошибка конфигурации … SESSION_SECRET …».

- [ ] **Step 6: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add scripts/lib/stop.ts scripts/stop.ts package.json tests/server/stop.test.ts
git commit -m "feat: npm run stop — мягкая остановка заявкой, через 20 с принудительно с проверкой; работает при скачке часов и сломанных настройках

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Автозапуск — задача Планировщика, systemd, `service:install` / `service:uninstall`

**Files:**
- Create: `scripts/lib/windows-task.ts`, `scripts/lib/service-plan.ts`, `scripts/lib/service-run.ts`, `scripts/service-install.ts`, `scripts/service-uninstall.ts`, `tests/server/windows-task.test.ts`, `tests/server/service-plan.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `SERVICE_NAME`, `renderCaddyfile`, `renderSystemdUnit` (задача 1); `DeployMode`, `loadConfig`, `Config.backupCopyDir`.
- Produces:
  - `xmlEscape`, `windowsArg` (правила `CommandLineToArgvW`), `windowsUserId(env, fallbackUser)` — `DOMAIN\user`;
  - `renderTaskXml(o: { userId; workingDirectory; command: string[]; conhostPath; description }): string` (строки через `\r\n`), `encodeTaskXml(xml): Buffer` (UTF-16 LE с BOM), `schtasksCreateArgs(xmlPath, name?)`, `schtasksDeleteArgs(name?)`;
  - `interface ServiceContext { platform; appDir; dataDir; nodePath; npmCli; user; isRoot; appName; deployMode; publicUrl; host; port; systemRoot; backupCopyDir }`;
  - `isDryRun(argv, env): boolean`, `readWritePaths(ctx): string[]`, `planInstall(ctx)`, `planUninstall(ctx)`, `serviceFileBytes(f)`;
  - `runServicePlan(kind, argv)`; npm-скрипты `service:install`, `service:uninstall`.

- [ ] **Step 1: Write the failing tests**

`tests/server/windows-task.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  encodeTaskXml,
  renderTaskXml,
  schtasksCreateArgs,
  schtasksDeleteArgs,
  windowsArg,
  windowsUserId,
  xmlEscape,
} from '../../scripts/lib/windows-task';

const base = {
  userId: 'CLUB-PC\\Админ',
  workingDirectory: 'C:\\Учёт\\finmap-clone',
  command: ['C:\\Program Files\\nodejs\\node.exe', 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js', 'start'],
  conhostPath: 'C:\\Windows\\System32\\conhost.exe',
  description: 'Автозапуск «Учёт»',
};

describe('задача Планировщика Windows', () => {
  it('при входе текущего пользователя, от его имени, без лимита времени и без остановки от батареи', () => {
    const xml = renderTaskXml(base);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-16"?>\r\n')).toBe(true);
    expect(xml).toContain('<LogonTrigger>\r\n      <Enabled>true</Enabled>\r\n      <UserId>CLUB-PC\\Админ</UserId>');
    expect(xml).toContain('<LogonType>InteractiveToken</LogonType>');
    expect(xml).toContain('<RunLevel>LeastPrivilege</RunLevel>');
    expect(xml).toContain('<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>');
    expect(xml).toContain('<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>');
    expect(xml).toContain('<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>');
    expect(xml).toContain('<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>');
    expect(xml).not.toContain('RestartOnFailure');
    expect(xml).not.toContain('BootTrigger');
  });

  it('запускает npm start без окна из папки проекта', () => {
    const xml = renderTaskXml(base);
    expect(xml).toContain('<Command>C:\\Windows\\System32\\conhost.exe</Command>');
    expect(xml).toContain(
      '<Arguments>--headless &quot;C:\\Program Files\\nodejs\\node.exe&quot; ' +
        '&quot;C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js&quot; start</Arguments>',
    );
    expect(xml).toContain('<WorkingDirectory>C:\\Учёт\\finmap-clone</WorkingDirectory>');
  });

  it('спецсимволы XML в путях и имени экранируются', () => {
    expect(xmlEscape(`a&b<c>"d"'e'`)).toBe('a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos;');
    const xml = renderTaskXml({ ...base, userId: 'PC\\Tom & Jerry', workingDirectory: 'D:\\R&D <1>' });
    expect(xml).toContain('<UserId>PC\\Tom &amp; Jerry</UserId>');
    expect(xml).toContain('<WorkingDirectory>D:\\R&amp;D &lt;1&gt;</WorkingDirectory>');
  });

  it('аргументы командной строки: кавычки только при пробелах, слэши перед кавычкой удваиваются', () => {
    expect(windowsArg('start')).toBe('start');
    expect(windowsArg('C:\\nodejs\\node.exe')).toBe('C:\\nodejs\\node.exe');
    expect(windowsArg('C:\\Program Files\\node.exe')).toBe('"C:\\Program Files\\node.exe"');
    expect(windowsArg('C:\\My Dir\\')).toBe('"C:\\My Dir\\\\"');
    expect(windowsArg('say "hi"')).toBe('"say \\"hi\\""');
    expect(windowsArg('')).toBe('""');
  });

  it('файл задачи — UTF-16 LE с BOM', () => {
    const buf = encodeTaskXml('<Task>Учёт</Task>');
    expect([...buf.subarray(0, 2)]).toEqual([0xff, 0xfe]);
    expect(buf.subarray(2).toString('utf16le')).toBe('<Task>Учёт</Task>');
  });

  it('пользователь — DOMAIN\\user; без домена — просто имя', () => {
    expect(windowsUserId({ USERDOMAIN: 'CLUB-PC', USERNAME: 'Админ' }, 'x')).toBe('CLUB-PC\\Админ');
    expect(windowsUserId({}, 'admin')).toBe('admin');
  });

  it('команды schtasks: создать с заменой и удалить без вопросов', () => {
    expect(schtasksCreateArgs('C:\\app\\data\\deploy\\finmap-clone-task.xml')).toEqual([
      '/Create', '/TN', 'finmap-clone', '/XML', 'C:\\app\\data\\deploy\\finmap-clone-task.xml', '/F',
    ]);
    expect(schtasksDeleteArgs()).toEqual(['/Delete', '/TN', 'finmap-clone', '/F']);
  });
});
```

`tests/server/service-plan.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isDryRun, planInstall, planUninstall, readWritePaths, serviceFileBytes, type ServiceContext } from '../../scripts/lib/service-plan';

const win: ServiceContext = {
  platform: 'win32',
  appDir: 'C:\\club\\finmap-clone',
  dataDir: 'C:\\club\\finmap-clone\\data',
  nodePath: 'C:\\Program Files\\nodejs\\node.exe',
  npmCli: 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
  user: 'CLUB-PC\\Админ',
  isRoot: false,
  appName: 'Учёт',
  deployMode: 'cloudflare',
  publicUrl: 'https://fin.example.kz',
  host: '127.0.0.1',
  port: 3000,
  systemRoot: 'C:\\Windows',
  backupCopyDir: null,
};

const linux: ServiceContext = {
  ...win,
  platform: 'linux',
  appDir: '/opt/finmap-clone',
  dataDir: '/opt/finmap-clone/data',
  nodePath: '/usr/bin/node',
  npmCli: '/usr/lib/node_modules/npm/bin/npm-cli.js',
  user: 'finmap',
  deployMode: 'vps',
  systemRoot: '',
};

describe('service:install — Windows', () => {
  it('пишет файл задачи в data/deploy и регистрирует его через schtasks', () => {
    const plan = planInstall(win);
    expect(plan.files).toHaveLength(1);
    const f = plan.files[0]!;
    expect(f.path).toBe('C:\\club\\finmap-clone\\data\\deploy\\finmap-clone-task.xml');
    expect(f.utf16).toBe(true);
    expect([...serviceFileBytes(f).subarray(0, 2)]).toEqual([0xff, 0xfe]);
    expect(f.text).toContain('<WorkingDirectory>C:\\club\\finmap-clone</WorkingDirectory>');
    expect(f.text).toContain('<Command>C:\\Windows\\System32\\conhost.exe</Command>');
    expect(f.text).toContain('npm-cli.js&quot; start</Arguments>');
    expect(plan.commands).toEqual([{ cmd: 'schtasks', args: ['/Create', '/TN', 'finmap-clone', '/XML', f.path, '/F'] }]);
    expect(plan.notes.join('\n')).toMatch(/schtasks \/Run \/TN finmap-clone/);
    expect(plan.notes.join('\n')).toMatch(/автовход/);
  });

  it('без npm (запуск не через npm run) — понятная ошибка', () => {
    expect(() => planInstall({ ...win, npmCli: undefined })).toThrow(/npm run service:install/);
  });

  it('service:uninstall удаляет задачу', () => {
    expect(planUninstall(win).commands).toEqual([{ cmd: 'schtasks', args: ['/Delete', '/TN', 'finmap-clone', '/F'] }]);
  });
});

describe('service:install — Linux', () => {
  it('в режиме vps готовит юнит и Caddyfile, сам ничего не выполняет и подсказывает команды sudo', () => {
    const plan = planInstall(linux);
    expect(plan.commands).toEqual([]);
    expect(plan.files.map((f) => f.path)).toEqual(['/opt/finmap-clone/data/deploy/finmap-clone.service', '/opt/finmap-clone/data/deploy/Caddyfile']);
    expect(plan.files[0]!.text).toContain('User=finmap\n');
    expect(plan.files[0]!.text).toContain('ExecStart=/usr/bin/node /usr/lib/node_modules/npm/bin/npm-cli.js start\n');
    expect(plan.files[1]!.text).toContain('fin.example.kz {\n\tencode zstd gzip\n\treverse_proxy 127.0.0.1:3000\n}');
    const notes = plan.notes.join('\n');
    expect(notes).toContain("sudo cp '/opt/finmap-clone/data/deploy/finmap-clone.service' /etc/systemd/system/finmap-clone.service");
    expect(notes).toContain('sudo systemctl enable --now finmap-clone');
    expect(notes).toContain("sudo cp '/opt/finmap-clone/data/deploy/Caddyfile' /etc/caddy/Caddyfile");
  });

  it('вне режима vps Caddyfile не нужен', () => {
    const plan = planInstall({ ...linux, deployMode: 'local' });
    expect(plan.files.map((f) => f.path)).toEqual(['/opt/finmap-clone/data/deploy/finmap-clone.service']);
    expect(plan.notes.join('\n')).not.toMatch(/caddy/i);
  });

  it('путь с апострофом в подсказке экранирован для shell', () => {
    const plan = planInstall({ ...linux, dataDir: "/home/o'brien/app/data" });
    expect(plan.notes.join('\n')).toContain("sudo cp '/home/o'\\''brien/app/data/deploy/finmap-clone.service'");
  });

  it('от root — отказ', () => {
    expect(() => planInstall({ ...linux, isRoot: true })).toThrow(/root/);
  });

  it('service:uninstall подсказывает команды отключения', () => {
    const notes = planUninstall(linux).notes.join('\n');
    expect(notes).toContain('sudo systemctl disable --now finmap-clone');
    expect(notes).toContain('sudo rm /etc/systemd/system/finmap-clone.service');
  });
});

describe('другие ОС', () => {
  it('macOS — понятный отказ', () => {
    expect(() => planInstall({ ...linux, platform: 'darwin' })).toThrow(/Windows и Linux/);
    expect(() => planUninstall({ ...linux, platform: 'darwin' })).toThrow(/Windows и Linux/);
  });
});

describe('песочница systemd и проверка без изменений', () => {
  it('юнит пишет только в папку приложения; данные вне её и папка копий — тоже доступны, копии — необязательно', () => {
    expect(readWritePaths({ appDir: '/opt/finmap-clone', dataDir: '/opt/finmap-clone/data', backupCopyDir: null })).toEqual(['/opt/finmap-clone']);
    expect(readWritePaths({ appDir: '/opt/finmap-clone', dataDir: '/srv/fin-data', backupCopyDir: '/mnt/usb/backups' })).toEqual([
      '/opt/finmap-clone',
      '/srv/fin-data',
      '-/mnt/usb/backups',
    ]);
    expect(readWritePaths({ appDir: '/opt/fin', dataDir: '/opt/fin-data', backupCopyDir: null })).toEqual(['/opt/fin', '/opt/fin-data']);
    const unit = planInstall({ ...linux, backupCopyDir: '/mnt/usb/backups' }).files[0]!.text;
    expect(unit).toContain('ReadWritePaths=/opt/finmap-clone -/mnt/usb/backups\n');
    expect(unit).toContain('Environment=npm_config_cache=/opt/finmap-clone/data/npm-cache\n');
  });

  it('--dry-run после «--» и без него (npm передаёт npm_config_dry_run=true)', () => {
    expect(isDryRun(['--dry-run'], {})).toBe(true);
    expect(isDryRun([], { npm_config_dry_run: 'true' })).toBe(true);
    expect(isDryRun([], { npm_config_dry_run: '' })).toBe(false);
    expect(isDryRun([], {})).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/windows-task.test.ts tests/server/service-plan.test.ts`
Expected: FAIL — нет модулей `scripts/lib/windows-task` и `scripts/lib/service-plan`.

- [ ] **Step 3: Implement**

`scripts/lib/windows-task.ts`:

```ts
import { SERVICE_NAME } from './deploy-files';

export function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Аргумент командной строки Windows (правила CommandLineToArgvW): кавычки только когда нужны. */
export function windowsArg(s: string): string {
  if (s !== '' && !/[\s"]/.test(s)) return s;
  let out = '"';
  let slashes = 0;
  for (const ch of s) {
    if (ch === '\\') {
      slashes++;
      continue;
    }
    // Обратные слэши перед кавычкой удваиваются, сама кавычка экранируется.
    out += ch === '"' ? '\\'.repeat(slashes * 2 + 1) + '"' : '\\'.repeat(slashes) + ch;
    slashes = 0;
  }
  // Хвостовые слэши удваиваются, чтобы не съесть закрывающую кавычку.
  return `${out}${'\\'.repeat(slashes * 2)}"`;
}

/** Учётная запись для задачи: DOMAIN\user из окружения Windows. */
export function windowsUserId(env: Record<string, string | undefined>, fallbackUser: string): string {
  const user = env.USERNAME || fallbackUser;
  return env.USERDOMAIN ? `${env.USERDOMAIN}\\${user}` : user;
}

/**
 * Задача Планировщика (§9.1): при входе пользователя, от его имени, без окна.
 * Окно скрывает conhost.exe --headless (powershell -WindowStyle Hidden не прячет окно Windows Terminal).
 * Без лимита времени (по умолчанию Планировщик останавливает задачу через 3 дня), работает от батареи,
 * повторный запуск при уже работающей задаче игнорируется. Перезапуск при падении — у супервизора.
 */
export function renderTaskXml(o: { userId: string; workingDirectory: string; command: string[]; conhostPath: string; description: string }): string {
  const args = ['--headless', ...o.command].map(windowsArg).join(' ');
  const user = xmlEscape(o.userId);
  return [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    '  <RegistrationInfo>',
    `    <Description>${xmlEscape(o.description)}</Description>`,
    '  </RegistrationInfo>',
    '  <Triggers>',
    '    <LogonTrigger>',
    '      <Enabled>true</Enabled>',
    `      <UserId>${user}</UserId>`,
    '    </LogonTrigger>',
    '  </Triggers>',
    '  <Principals>',
    '    <Principal id="Author">',
    `      <UserId>${user}</UserId>`,
    '      <LogonType>InteractiveToken</LogonType>',
    '      <RunLevel>LeastPrivilege</RunLevel>',
    '    </Principal>',
    '  </Principals>',
    '  <Settings>',
    '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>',
    '    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>',
    '    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>',
    '    <AllowHardTerminate>true</AllowHardTerminate>',
    '    <StartWhenAvailable>false</StartWhenAvailable>',
    '    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>',
    '    <AllowStartOnDemand>true</AllowStartOnDemand>',
    '    <Enabled>true</Enabled>',
    '    <Hidden>false</Hidden>',
    '    <RunOnlyIfIdle>false</RunOnlyIfIdle>',
    '    <WakeToRun>false</WakeToRun>',
    '    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>',
    '    <Priority>5</Priority>',
    '  </Settings>',
    '  <Actions Context="Author">',
    '    <Exec>',
    `      <Command>${xmlEscape(o.conhostPath)}</Command>`,
    `      <Arguments>${xmlEscape(args)}</Arguments>`,
    `      <WorkingDirectory>${xmlEscape(o.workingDirectory)}</WorkingDirectory>`,
    '    </Exec>',
    '  </Actions>',
    '</Task>',
    '',
  ].join('\r\n');
}

/** schtasks /XML ждёт файл в UTF-16 LE с BOM (как при экспорте из Планировщика). */
export function encodeTaskXml(xml: string): Buffer {
  return Buffer.from(`\uFEFF${xml}`, 'utf16le');
}

export function schtasksCreateArgs(xmlPath: string, name = SERVICE_NAME): string[] {
  return ['/Create', '/TN', name, '/XML', xmlPath, '/F'];
}

export function schtasksDeleteArgs(name = SERVICE_NAME): string[] {
  return ['/Delete', '/TN', name, '/F'];
}
```

`scripts/lib/service-plan.ts` (пути строятся `path.win32`/`path.posix` по целевой ОС — тесты Linux-ветки идут и на Windows):

```ts
import path from 'node:path';
import type { DeployMode } from '../../src/server/config';
import { SERVICE_NAME, renderCaddyfile, renderSystemdUnit } from './deploy-files';
import { encodeTaskXml, renderTaskXml, schtasksCreateArgs, schtasksDeleteArgs } from './windows-task';

export interface ServiceContext {
  platform: NodeJS.Platform;
  /** Папка проекта (рабочая папка задачи и юнита). */
  appDir: string;
  dataDir: string;
  /** process.execPath — абсолютный путь к node. */
  nodePath: string;
  /** process.env.npm_execpath — npm-cli.js, когда команда запущена через npm run. */
  npmCli: string | undefined;
  /** Windows: DOMAIN\user; Linux: имя пользователя. */
  user: string;
  isRoot: boolean;
  appName: string;
  deployMode: DeployMode;
  publicUrl: string;
  host: string;
  port: number;
  /** Windows: %SystemRoot%. */
  systemRoot: string;
  /** BACKUP_COPY_DIR (абсолютный путь) или null: в песочнице systemd он должен быть доступен на запись. */
  backupCopyDir: string | null;
}

/**
 * Проверка без изменений: «npm run service:install -- --dry-run», а также «npm run service:install --dry-run»
 * без «--» — тогда npm забирает флаг себе и передаёт его как npm_config_dry_run=true.
 */
export function isDryRun(argv: string[], env: Record<string, string | undefined>): boolean {
  return argv.includes('--dry-run') || ['true', '1'].includes((env.npm_config_dry_run ?? '').toLowerCase());
}

/** Пути записи для песочницы systemd: папка приложения, данные вне её и (необязательно) папка копий бэкапов. */
export function readWritePaths(ctx: Pick<ServiceContext, 'appDir' | 'dataDir' | 'backupCopyDir'>): string[] {
  const inside = (p: string) => p === ctx.appDir || p.startsWith(`${ctx.appDir}/`);
  return [ctx.appDir, ...(inside(ctx.dataDir) ? [] : [ctx.dataDir]), ...(ctx.backupCopyDir ? [`-${ctx.backupCopyDir}`] : [])];
}

export interface ServiceFile {
  path: string;
  text: string;
  /** true — записать в UTF-16 LE с BOM (файл задачи Планировщика). */
  utf16?: boolean;
}

export interface ServicePlan {
  files: ServiceFile[];
  commands: { cmd: string; args: string[] }[];
  /** Что сказать пользователю после выполнения. */
  notes: string[];
}

export function serviceFileBytes(f: ServiceFile): Buffer {
  return f.utf16 ? encodeTaskXml(f.text) : Buffer.from(f.text, 'utf8');
}

/** Путь для команды в терминале Linux: в одинарных кавычках. */
function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function startCommand(ctx: ServiceContext): string[] {
  if (!ctx.npmCli || !/\.c?js$/i.test(ctx.npmCli)) {
    throw new Error('Запустите команду через npm: npm run service:install');
  }
  return [ctx.nodePath, ctx.npmCli, 'start'];
}

function unsupported(platform: string): Error {
  return new Error(`Автозапуск поддерживается на Windows и Linux, а это ${platform}. Запускайте приложение командой npm start.`);
}

export function planInstall(ctx: ServiceContext): ServicePlan {
  // Пути — по правилам целевой ОС (тесты Linux-ветки идут и на Windows).
  const p = ctx.platform === 'win32' ? path.win32 : path.posix;
  const deployDir = p.join(ctx.dataDir, 'deploy');
  if (ctx.platform === 'win32') {
    const xmlPath = p.join(deployDir, `${SERVICE_NAME}-task.xml`);
    const text = renderTaskXml({
      userId: ctx.user,
      workingDirectory: ctx.appDir,
      command: startCommand(ctx),
      conhostPath: path.win32.join(ctx.systemRoot, 'System32', 'conhost.exe'),
      description: `Автозапуск «${ctx.appName}» (npm start) при входе пользователя ${ctx.user}`,
    });
    return {
      files: [{ path: xmlPath, text, utf16: true }],
      commands: [{ cmd: 'schtasks', args: schtasksCreateArgs(xmlPath) }],
      notes: [
        `Автозапуск включён: приложение запустится без окна при следующем входе пользователя ${ctx.user} в Windows.`,
        `Запустить сейчас, не перезагружая ПК: schtasks /Run /TN ${SERVICE_NAME}`,
        'Остановить: npm run stop. Журналы: папка data\\logs (supervisor.log — перезапуски, app.*.log — сервер).',
        'Чтобы приложение поднималось после перезагрузки без человека, включите автовход в Windows (README, «Автозапуск»).',
      ],
    };
  }
  if (ctx.platform === 'linux') {
    if (ctx.isRoot) {
      throw new Error('Не запускайте приложение от root: создайте отдельного пользователя и выполните команду от его имени (README, «Режим vps»).');
    }
    const unitPath = p.join(deployDir, `${SERVICE_NAME}.service`);
    const files: ServiceFile[] = [
      {
        path: unitPath,
        text: renderSystemdUnit({
          appName: ctx.appName,
          user: ctx.user,
          workingDirectory: ctx.appDir,
          dataDir: ctx.dataDir,
          execStart: startCommand(ctx),
          readWritePaths: readWritePaths(ctx),
        }),
      },
    ];
    const notes = [
      `Файлы подготовлены в ${deployDir}. Выполните (нужны права sudo):`,
      `  sudo cp ${shq(unitPath)} /etc/systemd/system/${SERVICE_NAME}.service`,
      '  sudo systemctl daemon-reload',
      `  sudo systemctl enable --now ${SERVICE_NAME}`,
    ];
    if (ctx.deployMode === 'vps') {
      const caddyPath = p.join(deployDir, 'Caddyfile');
      files.push({ path: caddyPath, text: renderCaddyfile({ publicUrl: ctx.publicUrl, host: ctx.host, port: ctx.port }) });
      notes.push(
        'Caddy (если на сервере нет других сайтов; иначе добавьте блок из файла в свой Caddyfile):',
        `  sudo cp ${shq(caddyPath)} /etc/caddy/Caddyfile`,
        '  sudo systemctl reload caddy',
      );
    }
    notes.push(`Проверка: systemctl status ${SERVICE_NAME}; журнал: journalctl -u ${SERVICE_NAME} -f`);
    return { files, commands: [], notes };
  }
  throw unsupported(ctx.platform);
}

export function planUninstall(ctx: ServiceContext): ServicePlan {
  if (ctx.platform === 'win32') {
    return {
      files: [],
      commands: [{ cmd: 'schtasks', args: schtasksDeleteArgs() }],
      notes: ['Автозапуск выключен. Если приложение сейчас работает, остановите его: npm run stop'],
    };
  }
  if (ctx.platform === 'linux') {
    return {
      files: [],
      commands: [],
      notes: [
        'Выполните (нужны права sudo):',
        `  sudo systemctl disable --now ${SERVICE_NAME}`,
        `  sudo rm /etc/systemd/system/${SERVICE_NAME}.service`,
        '  sudo systemctl daemon-reload',
      ],
    };
  }
  throw unsupported(ctx.platform);
}
```

`scripts/lib/service-run.ts` (обёртка, не тестируется):

```ts
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../src/server/config';
import { isDryRun, planInstall, planUninstall, serviceFileBytes, type ServiceContext, type ServicePlan } from './service-plan';
import { windowsUserId } from './windows-task';

/** Контекст текущей машины для service:install / service:uninstall. Не тестируется — только чтение окружения. */
export function currentServiceContext(): ServiceContext {
  if (fs.existsSync('.env')) process.loadEnvFile('.env');
  const config = loadConfig();
  const username = os.userInfo().username;
  return {
    platform: process.platform,
    appDir: process.cwd(),
    dataDir: config.dataDir,
    nodePath: process.execPath,
    npmCli: process.env.npm_execpath,
    user: process.platform === 'win32' ? windowsUserId(process.env, username) : username,
    isRoot: typeof process.getuid === 'function' && process.getuid() === 0,
    appName: config.appName,
    deployMode: config.deployMode,
    publicUrl: config.publicUrl,
    host: config.host,
    port: config.port,
    systemRoot: process.env.SystemRoot ?? 'C:\\Windows',
    backupCopyDir: config.backupCopyDir,
  };
}

/**
 * Выполняет план: пишет файлы, запускает команды, печатает подсказки.
 * С --dry-run только печатает, что было бы сделано (ничего не пишет и не регистрирует).
 */
export function runServicePlan(kind: 'install' | 'uninstall', argv: string[]): void {
  const dryRun = isDryRun(argv, process.env);
  let plan: ServicePlan;
  try {
    const ctx = currentServiceContext();
    plan = kind === 'install' ? planInstall(ctx) : planUninstall(ctx);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }

  if (dryRun) {
    console.log('Проверка без изменений (--dry-run).');
    for (const f of plan.files) console.log(`\n--- файл ${f.path}${f.utf16 ? ' (UTF-16)' : ''} ---\n${f.text}`);
    for (const c of plan.commands) console.log(`\nКоманда: ${c.cmd} ${c.args.join(' ')}`);
    console.log(`\nПосле выполнения:\n${plan.notes.join('\n')}`);
    return;
  }

  for (const f of plan.files) {
    fs.mkdirSync(path.dirname(f.path), { recursive: true });
    fs.writeFileSync(f.path, serviceFileBytes(f));
  }
  for (const c of plan.commands) {
    const r = spawnSync(c.cmd, c.args, { stdio: 'inherit' });
    if (r.status !== 0) {
      console.error(
        `Команда ${c.cmd} завершилась с ошибкой${r.error ? `: ${r.error.message}` : ''}. ` +
          'Если Windows пишет «Отказано в доступе», откройте терминал от имени администратора и повторите.',
      );
      process.exit(1);
    }
  }
  console.log(plan.notes.join('\n'));
}
```

`scripts/service-install.ts`:

```ts
import { runServicePlan } from './lib/service-run';

runServicePlan('install', process.argv.slice(2));
```

`scripts/service-uninstall.ts`:

```ts
import { runServicePlan } from './lib/service-run';

runServicePlan('uninstall', process.argv.slice(2));
```

`package.json` — в `scripts` сразу после `"stop": "tsx scripts/stop.ts",`:

```json
    "service:install": "tsx scripts/service-install.ts",
    "service:uninstall": "tsx scripts/service-uninstall.ts",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/windows-task.test.ts tests/server/service-plan.test.ts`
Expected: PASS.

- [ ] **Step 5: Dry run (ничего не регистрирует)**

Run: `npm run service:install -- --dry-run`, `npm run service:install --dry-run` (без `--`) и `npm run service:uninstall --dry-run`
Expected: каждая печатает «Проверка без изменений (--dry-run).»; у `install` — XML задачи (`<Command>…\System32\conhost.exe</Command>`, `<WorkingDirectory>` — папка проекта, `npm-cli.js … start`) и строка `Команда: schtasks /Create /TN finmap-clone /XML …\data\deploy\finmap-clone-task.xml /F`; папка `data/deploy` не создана. **Без `--dry-run` команду в ходе выполнения плана не запускать** — она регистрирует задачу на машине.

- [ ] **Step 6: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add scripts/lib/windows-task.ts scripts/lib/service-plan.ts scripts/lib/service-run.ts scripts/service-install.ts scripts/service-uninstall.ts package.json tests/server/windows-task.test.ts tests/server/service-plan.test.ts
git commit -m "feat: service:install и service:uninstall — задача Планировщика на Windows, systemd-юнит и Caddyfile на Linux, --dry-run

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `BACKUP_COPY_DIR` — без копии на системный диск

**Files:**
- Modify: `src/server/modules/backup/service.ts`, `src/server/config.ts`, `scripts/backup.ts`, `tests/server/backup.test.ts`, `tests/server/config.test.ts`

**Interfaces:**
- Consumes: `createBackupService({ sqlite, config, now?, log? })`, `status().lastCopyError` (план 1); экран «Резервная копия» уже показывает `lastCopyError` (план 3b).
- Produces:
  - копия не создаёт `BACKUP_COPY_DIR`: нет папки → `lastCopyError` «папка … не найдена — подключите диск или создайте папку», запись в журнал через `log(msg, err)`;
  - `config.backupCopyDir` — абсолютный путь (`path.resolve`) или `null`;
  - `npm run backup` печатает «Внимание: Не удалось скопировать бэкап в …: <причина>».

- [ ] **Step 1: Write the failing tests**

`tests/server/backup.test.ts` — в `describe('backup', …)` перед `it('два бэкапа в одну секунду не перезаписывают друг друга', …)`:

```ts
  it('BACKUP_COPY_DIR нет (флешка отключена) — бэкап создан, папка не создаётся, предупреждение в журнале и статусе', () => {
    const missing = path.join(os.tmpdir(), `fc-copy-missing-${process.pid}-${Date.now()}`, 'backups');
    const { config, sqlite } = setup('fc-backup-', { BACKUP_COPY_DIR: missing });
    const logs: { msg: string; err?: unknown }[] = [];
    const svc = createBackupService({ sqlite, config, log: (msg, err) => logs.push({ msg, err }) });
    const file = svc.create('daily');
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.existsSync(missing)).toBe(false);
    expect(svc.status().lastCopyError).toMatch(/не найдена/);
    expect(logs.some((l) => /Не удалось скопировать бэкап/.test(l.msg) && l.err instanceof Error)).toBe(true);
  });

  it('после восстановления папки следующий бэкап копируется и ошибка сбрасывается', () => {
    const copyParent = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-copy-later-'));
    const copyDir = path.join(copyParent, 'backups');
    const { svc, clock } = setup('fc-backup-', { BACKUP_COPY_DIR: copyDir });
    svc.create('daily');
    expect(svc.status().lastCopyError).not.toBeNull();
    fs.mkdirSync(copyDir);
    clock.advance(60_000);
    svc.create('daily');
    expect(svc.status().lastCopyError).toBeNull();
    expect(fs.readdirSync(copyDir).filter((f) => f.endsWith('.zip'))).toHaveLength(1);
    fs.rmSync(copyParent, { recursive: true, force: true });
  });

  it('нет прав на запись в BACKUP_COPY_DIR — бэкап создан, ошибка в статусе, сервер не падает', () => {
    const copyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-copy-ro-'));
    const { svc } = setup('fc-backup-', { BACKUP_COPY_DIR: copyDir });
    vi.spyOn(fs, 'copyFileSync').mockImplementation(() => {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    });
    expect(() => svc.create('daily')).not.toThrow();
    vi.restoreAllMocks();
    expect(svc.list()).toHaveLength(1);
    expect(svc.status().lastCopyError).toMatch(/EACCES/);
    fs.rmSync(copyDir, { recursive: true, force: true });
  });

  it('ротация в BACKUP_COPY_DIR не трогает чужие файлы', () => {
    const copyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-copy-own-'));
    fs.writeFileSync(path.join(copyDir, 'отчёт.xlsx'), 'x');
    fs.writeFileSync(path.join(copyDir, 'backup-old.zip'), 'x');
    const { svc, clock } = setup('fc-backup-', { BACKUP_COPY_DIR: copyDir });
    for (let i = 0; i < 5; i++) {
      svc.create('daily');
      clock.advance(60_000);
    }
    const files = fs.readdirSync(copyDir);
    expect(files).toContain('отчёт.xlsx');
    expect(files).toContain('backup-old.zip');
    expect(files.filter((f) => /^backup-\d{8}-\d{6}\.zip$/.test(f))).toHaveLength(3);
    fs.rmSync(copyDir, { recursive: true, force: true });
  });
```

(`setup` в этом файле ставит `BACKUP_KEEP: '3'`.)

`tests/server/config.test.ts` — перед `it('учитывает DATA_DIR для всех путей данных', …)`:

```ts
  it('BACKUP_COPY_DIR: относительный путь — от папки проекта', () => {
    expect(loadConfig({ ...base, BACKUP_COPY_DIR: 'copies' }).backupCopyDir).toBe(path.resolve('copies'));
    expect(loadConfig({ ...base, BACKUP_COPY_DIR: '' }).backupCopyDir).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/server/backup.test.ts tests/server/config.test.ts`
Expected: FAIL — «флешка отключена» (папка создаётся), «после восстановления папки» (ошибки нет с первого раза) и `BACKUP_COPY_DIR: относительный путь`. Тесты прав и ротации проходят уже на текущем коде (характеризационные).

- [ ] **Step 3: Implement**

`src/server/modules/backup/service.ts` — функция перед `prune`:

```ts
function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
```

и в `create` строку `fs.mkdirSync(config.backupCopyDir, { recursive: true });` замените на:

```ts
          // Папку не создаём: отключённая флешка или несмонтированный диск дали бы «успешную» копию
          // на системный диск. Нет папки — предупреждение в журнале и на экране «Резервная копия».
          if (!isDirectory(config.backupCopyDir)) {
            throw new Error(`папка ${config.backupCopyDir} не найдена — подключите диск или создайте папку`);
          }
```

`src/server/config.ts` — в возвращаемом объекте строку `backupCopyDir: e.BACKUP_COPY_DIR,` замените на:

```ts
    // Относительный путь — от папки проекта (рабочая папка npm start и задачи автозапуска).
    backupCopyDir: e.BACKUP_COPY_DIR ? path.resolve(e.BACKUP_COPY_DIR) : null,
```

`scripts/backup.ts` — строку `const file = createBackupService({ sqlite, config, log: (m) => console.log(m) }).create('manual');` замените на:

```ts
  const log = (m: string, e?: unknown) => (e ? console.warn(`Внимание: ${m}: ${(e as Error).message}`) : console.log(m));
  const file = createBackupService({ sqlite, config, log }).create('manual');
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/backup.test.ts tests/server/main-backup.test.ts tests/server/config.test.ts`
Expected: PASS (тест `main-backup` с файлом вместо папки по-прежнему видит `lastCopyError`).

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add src/server/modules/backup/service.ts src/server/config.ts scripts/backup.ts tests/server/backup.test.ts tests/server/config.test.ts
git commit -m "fix: BACKUP_COPY_DIR не создаётся сам — копия не уходит на системный диск при отключённой флешке

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: README — эксплуатация для владельца клуба

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: команды задач 1–6: `npm run stop`, `npm run service:install [-- --dry-run]`, `npm run service:uninstall`, `schtasks /Run /TN finmap-clone`, `data/logs/supervisor.log`, `data/logs/cloudflared.log`, `data/deploy/`, правило `BACKUP_COPY_DIR`.
- Produces: README на русском для владельца-непрограммиста.

- [ ] **Step 1: Update the progress lines**

В разделе «## Что уже работает»:
- в строке «Сделаны шаги … этапа 1 (§11 спецификации):» добавьте к перечню шаг 8 (например «Сделаны шаги 1–5 и 8 этапа 1» — с учётом уже сделанных к этому моменту шагов 6–7);
- в конец списка (перед строкой «Пока нет …») добавьте:

```markdown
- **Эксплуатация (шаг 8):**
  - режим `vps` с Caddy и systemd;
  - автозапуск `npm run service:install` (Windows — при входе пользователя, без окна; Linux — systemd);
  - `npm run stop`, журналы супервизора и cloudflared в `data/logs`;
  - копии бэкапов в `BACKUP_COPY_DIR`.
```

- в строке «Пока нет (следующие шаги): …» уберите упоминания эксплуатации, режима `vps` и автозапуска, если они там есть.

- [ ] **Step 2: Replace the operating sections**

Замените всё от строки `## Требования` до строки перед `## Разработка` (разделы «Требования», «Первый запуск», «Запуск», «Пользователи», «Настройки (`.env`)», «Режимы развёртывания», «Данные и бэкапы») текстом ниже. Раздел «Пользователи» и таблица настроек сохраняются по смыслу; в таблице меняются строки `PUBLIC_URL` и `BACKUP_COPY_DIR`.

````markdown
## Требования

- Windows 10/11 x64 (ПК клуба) или Linux-сервер (режим `vps`, например Ubuntu 24.04).
- Node.js 24 LTS — установщик с nodejs.org, все галочки по умолчанию. Visual Studio и Build Tools не нужны.
- Git — чтобы скачивать обновления (git-scm.com, настройки по умолчанию).
- Для доступа с телефона: свой домен в Cloudflare (режим `cloudflare`), бесплатный аккаунт ngrok (режим `ngrok`) или VPS (режим `vps`).

## Установка на ПК клуба (Windows)

1. Установите Node.js 24 LTS и Git.
2. Откройте свою папку пользователя: `Win+R`, введите `%USERPROFILE%`, Enter. Создайте в ней папку `Учёт` и откройте её. Не кладите проект прямо на диск `C:\`: там его файлы может читать любой пользователь компьютера, а в них пароли туннеля и база.
3. Щёлкните по адресной строке Проводника, наберите `cmd` и нажмите Enter — откроется окно команд в этой папке. В нём:
   ```bat
   git clone <адрес репозитория> finmap-clone
   cd finmap-clone
   setup.cmd
   ```
4. `setup.cmd` ставит зависимости и задаёт вопросы: режим (`local`, `cloudflare`, `ngrok` — см. «Режимы развёртывания»), адрес и токен, затем логин и пароль первого пользователя (не короче 10 символов). Он же закрывает папку `data` и файл настроек от других пользователей Windows.
5. Запустите приложение: `npm start`. Откройте адрес из окна (по умолчанию http://127.0.0.1:3000) и войдите. Это окно занято приложением — не закрывайте его.
6. Включите автозапуск в **новом** окне команд (снова `cmd` в адресной строке папки `finmap-clone`): `npm run service:install` (раздел «Автозапуск»).

**Linux / macOS вручную:** `./setup.sh`, затем `npm start`. Если зависимости уже стоят, достаточно `npm run setup`.

Дальше все команды выполняются в окне команд, открытом в папке проекта (`%USERPROFILE%\Учёт\finmap-clone`).

## Запуск и остановка

- **Запуск:** `npm start`. Команда собирает интерфейс (если нужно), запускает сервер под супервизором, который перезапускает его при падении, и в режимах `cloudflare` и `ngrok` поднимает туннель. Окно можно свернуть, но не закрывать — закрытие окна останавливает приложение.
- **Остановка:** `Ctrl+C` в окне приложения или `npm run stop` из любого окна в папке проекта. `npm run stop` нужен, когда приложение запущено автозапуском без окна. Он просит приложение завершиться штатно, а если оно не ответило за 20 секунд, завершает его принудительно. Он работает, даже если в настройках ошибка.
- **Журналы:** папка `data/logs`. В `supervisor.log` — запуски, остановки, перезапуски после падений, ошибки настроек и сборки, ошибки ngrok; в `cloudflared.log` — работа туннеля Cloudflare; в `app.*.log` — работа сервера.
- **Перед обновлением базы** (новая версия приложения) создаётся бэкап в `data/backups/`.

**Порт для одного запуска** можно задать переменной окружения, не трогая `.env`:

```bash
# Git Bash / Linux
PORT=3457 npm start
```

```powershell
# PowerShell
$env:PORT=3457; npm start
```

### Показать приложение снаружи без настройки туннеля

Запустите приложение, затем во втором окне `ngrok http 3457` (подставьте свой порт). ngrok выдаст временный https-адрес. Для постоянной работы используйте режимы `cloudflare` и `ngrok`.

## Пользователи

| Команда | Что делает |
|---|---|
| `npm run user:add` | Добавить пользователя из консоли. Отвечать на вопросы нужно вручную: передача ответов через конвейер не работает. |
| `npm run user:passwd -- <логин>` | Сбросить пароль, если войти некому. Все сеансы пользователя завершаются. |

В интерфейсе: **Настройки → Пользователи** (добавить, сбросить пароль, отключить) и **Настройки → Профиль** (своё имя и пароль). Пароль — не короче 10 символов.

## Настройки (`.env`)

Файл `.env` в папке проекта создаёт `npm run setup`. Чтобы изменить настройку:
1. Остановите приложение: `npm run stop`.
2. Откройте `.env` Блокнотом, поправьте строку, сохраните.
3. Запустите приложение: `npm start` или `schtasks /Run /TN finmap-clone`. Если в настройке ошибка, приложение не запустится, а причина будет в `data\logs\supervisor.log`.

| Переменная | Значение по умолчанию | Смысл |
|---|---|---|
| `APP_NAME` | `Учёт` | Название в интерфейсе |
| `APP_TIMEZONE` | `Asia/Almaty` | Часовой пояс для дат |
| `HOST` | `127.0.0.1` | Адрес прослушивания. `0.0.0.0` — доступ из локальной сети по HTTP, без шифрования |
| `PORT` | `3000` | Порт |
| `PUBLIC_URL` | `http://localhost:PORT` | Внешний адрес, например `https://fin.example.kz`. В режиме `vps` обязателен и начинается с `https://` |
| `DEPLOY_MODE` | `local` | Режим: `local`, `cloudflare`, `ngrok` или `vps` |
| `CF_TUNNEL_TOKEN`, `CLOUDFLARED_PATH` | — | Для режима `cloudflare` |
| `NGROK_AUTHTOKEN`, `NGROK_DOMAIN` | — | Для режима `ngrok` |
| `SESSION_SECRET` | — | Генерирует `npm run setup`, не меньше 32 символов |
| `EXTRA_ORIGINS` | — | Дополнительные разрешённые адреса через запятую |
| `BACKUP_KEEP` | `14` | Сколько бэкапов хранить |
| `BACKUP_COPY_DIR` | — | Существующая папка, куда копируется каждый бэкап: OneDrive, Google Drive, флешка, сетевая папка |

## Режимы развёртывания

### `local` — только этот компьютер

Приложение открывается по адресу http://127.0.0.1:3000 на самом ПК. С телефона недоступно.

### `cloudflare` — свой домен (рекомендуется для ПК клуба)

Нужен домен, подключённый к Cloudflare (бесплатный тариф подходит).

1. Войдите в панель Cloudflare → **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel** → тип **Cloudflared** → придумайте имя (например `club`).
2. На шаге установки Cloudflare показывает команду с длинным токеном после `--token`. Скопируйте только токен — сам `cloudflared` устанавливать не нужно, его скачивает `npm run setup`.
3. На шаге **Public Hostname** укажите поддомен (например `fin`), ваш домен, тип **HTTP** и адрес `127.0.0.1:3000`.
4. Запустите `npm run setup`, выберите `cloudflare`, введите адрес (`fin.example.kz`) и токен.
5. `npm start`. Адрес `https://fin.example.kz` открывается с телефона; в панели туннель должен стать **Healthy**.

Если `npm run setup` пишет, что закреплённой сборки `cloudflared` нет, скачайте `cloudflared-windows-amd64.exe` со страницы github.com/cloudflare/cloudflared/releases и укажите путь к файлу, когда setup спросит `CLOUDFLARED_PATH`.

### `ngrok` — постоянный адрес без своего домена

1. Зарегистрируйтесь на ngrok.com и подтвердите почту (без этого ngrok отвечает ошибкой `ERR_NGROK_4018`).
2. В панели ngrok: **Your Authtoken** — скопируйте токен; **Domains** — получите бесплатный статический домен вида `xxx.ngrok-free.app`.
3. `npm run setup` → `ngrok`, введите токен и домен. Затем `npm start`.

Ограничения бесплатного ngrok: при первом открытии сайта в каждом браузере показывается страница-предупреждение ngrok (нажмите **Visit Site**), действуют лимиты запросов и трафика. Если домен есть — выбирайте `cloudflare`.

### `vps` — свой сервер с Caddy

Пример для Ubuntu 24.04; домен `fin.example.kz` должен указывать на IP сервера (DNS-запись A).

1. Установите Node.js 24 (инструкция NodeSource на nodejs.org), Git и Caddy (инструкция для Ubuntu на caddyserver.com/docs/install).
2. Создайте пользователя приложения и папку:
   ```bash
   sudo adduser --system --group --home /home/finmap finmap
   sudo mkdir /opt/finmap-clone && sudo chown finmap:finmap /opt/finmap-clone
   sudo -u finmap -H git clone <адрес репозитория> /opt/finmap-clone
   cd /opt/finmap-clone
   sudo -u finmap -H ./setup.sh
   ```
   В `setup` выберите `vps` и введите домен.
3. Подготовьте службу и Caddy: `sudo -u finmap -H npm run service:install`. Команда пишет `data/deploy/finmap-clone.service` и `data/deploy/Caddyfile` (образцы — в папке `deploy/`) и печатает команды. Выполните их:
   ```bash
   sudo cp '/opt/finmap-clone/data/deploy/finmap-clone.service' /etc/systemd/system/finmap-clone.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now finmap-clone
   sudo cp '/opt/finmap-clone/data/deploy/Caddyfile' /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   ```
   Если в Caddy уже есть другие сайты, не заменяйте `/etc/caddy/Caddyfile`, а добавьте в него блок из `data/deploy/Caddyfile`. Служба работает в песочнице: писать она может только в папку приложения, данные и папку копий бэкапов. Если вы поменяли `BACKUP_COPY_DIR` или `DATA_DIR`, повторите `service:install` и команды выше.
4. Откройте в брандмауэре порты 80 и 443 (`sudo ufw allow 80,443/tcp`). Порт приложения (3000) открывать не нужно: оно слушает только `127.0.0.1`, наружу его отдаёт Caddy.
5. Откройте `https://fin.example.kz`. Сертификат Caddy получает сам за минуту.

Управление: `sudo systemctl status|stop|start|restart finmap-clone`; журнал: `journalctl -u finmap-clone -f` и `data/logs`.

## Автозапуск

### Windows

В новом окне команд в папке проекта (первое занято `npm start`):

```bat
npm run service:install
```

Команда создаёт задачу Планировщика `finmap-clone`. При входе вашего пользователя в Windows она запускает `npm start` без окна из папки проекта. Задача работает от имени того пользователя, который выполнил `service:install`, поэтому запускайте её под той учётной записью, под которой ПК клуба входит в Windows. При падении приложение перезапускает супервизор.

- Проверить без изменений: `npm run service:install -- --dry-run`.
- Запустить сейчас, не перезагружая ПК: сначала остановите ручной запуск (`Ctrl+C` в его окне), затем `schtasks /Run /TN finmap-clone`.
- Остановить: `npm run stop`. Выключить автозапуск: `npm run service:uninstall`, затем `npm run stop`.
- Если `schtasks` пишет «Отказано в доступе», откройте окно команд от имени администратора (Пуск → введите `cmd` → правой кнопкой «Запуск от имени администратора») **под своей учётной записью**. Такое окно открывается в папке `C:\Windows\System32`, поэтому сначала перейдите в папку проекта: `cd /d "%USERPROFILE%\Учёт\finmap-clone"`. Если Windows просит пароль **другого** администратора, не вводите его: задача создастся для того пользователя и при вашем входе не запустится. Попросите администратора дать вашей учётной записи права администратора и повторите.
- Если вы переустановили Node.js в другую папку, выполните `npm run service:install` ещё раз.
- Если на каком-то ПК всё же появилось чёрное окно, его можно свернуть, но не закрывать.

**Чтобы приложение поднималось после перезагрузки без человека**, включите автовход в Windows:
1. Нажмите `Win+R`, введите `netplwiz`, Enter.
2. Снимите галочку «Требовать ввод имени пользователя и пароля», нажмите «Применить» и введите пароль. Если галочки нет, в Windows 11 сначала выключите **Параметры → Учётные записи → Варианты входа → «Для повышения безопасности разрешить вход только с Windows Hello»**.
3. В **Параметрах → Система → Питание** поставьте «Переводить в спящий режим» — «Никогда»: спящий ПК недоступен с телефона.

Проверка: перезагрузите ПК, не трогая его. Через минуту-две адрес открывается с телефона.

### Linux

Systemd-служба из раздела «`vps` — свой сервер с Caddy» запускается при загрузке сервера. Выключить: `npm run service:uninstall` покажет команды.

## Данные и бэкапы

Всё хранится в папке `data/`:
- `app.db` — база SQLite;
- `uploads/` — вложения;
- `backups/` — архивы бэкапов;
- `logs/` — журналы.

Бэкапы:
- **Автоматически** — каждый день в 04:00 и при запуске, если последнему бэкапу больше суток. Хранятся последние `BACKUP_KEEP`.
- **Вручную** — командой `npm run backup` или в интерфейсе: **Настройки → Резервная копия → «Скачать сейчас»**.

### Копия бэкапов в другую папку (`BACKUP_COPY_DIR`)

Чтобы бэкапы пережили поломку диска ПК, копируйте их в облачную папку или на флешку:
1. Создайте папку, например `C:\Users\Админ\OneDrive\Учёт-бэкапы` или `E:\Бэкапы`.
2. Остановите приложение (`npm run stop`), впишите в `.env` строку `BACKUP_COPY_DIR=C:\Users\Админ\OneDrive\Учёт-бэкапы` и запустите приложение снова.

Каждый новый архив копируется туда. В этой папке хранятся тоже последние `BACKUP_KEEP` архивов. Удаляются только файлы `backup-*.zip`, остальные файлы в папке не трогаются. Если папки нет (флешка отключена, диск не подключён), бэкап всё равно создаётся в `data/backups`. Тогда **Настройки → Резервная копия** и журнал показывают ошибку копирования. Папка сама не создаётся, чтобы копия не попала на диск ПК вместо флешки. Для каждого ПК заведите отдельную папку.

## Восстановление из бэкапа

1. Остановите приложение: `npm run stop` (на VPS — `sudo systemctl stop finmap-clone`).
2. Восстановите архив (из `data/backups` или из папки копий):
   ```bash
   npm run restore -- data/backups/backup-20261006-040000.zip
   ```
3. Запустите приложение: `npm start` или `schtasks /Run /TN finmap-clone` (на VPS — `sudo systemctl start finmap-clone`).

Прежние данные сохраняются в `data/pre-restore-<время>/`, путь выводится в консоль. После восстановления все пользователи входят заново. Если архив сделан более новой версией приложения, сначала обновите приложение.

## Обновление приложения

Windows:

```bat
npm run stop
git pull
npm ci
npm start
```

Вместо `npm start` можно `schtasks /Run /TN finmap-clone`, если включён автозапуск. Перед обновлением базы автоматически создаётся бэкап, интерфейс пересобирается сам. Если `npm ci` пишет `EPERM`, значит приложение ещё работает: выполните `npm run stop` и повторите.

VPS:

```bash
sudo systemctl stop finmap-clone
cd /opt/finmap-clone
sudo -u finmap -H git pull
sudo -u finmap -H npm ci
sudo systemctl start finmap-clone
```

## Если что-то не работает

| Что случилось | Что сделать |
|---|---|
| «Приложение уже запущено» | `npm run stop` и повторите. Если не помогло и приложение точно не работает, удалите `data\app.lock` и `data\supervisor.lock` |
| После перезагрузки ПК не открывается | Проверьте, что Windows вошла в пользователя (автовход), и что задача есть: `schtasks /Query /TN finmap-clone`. Последние строки `data\logs\supervisor.log` подскажут причину |
| На ПК открывается, с телефона — нет | `cloudflare`: в панели Zero Trust туннель должен быть **Healthy**, подробности — в `data\logs\cloudflared.log`; `ngrok`: строки «Не удалось открыть туннель ngrok» в `supervisor.log` (`ERR_NGROK_4018` — подтвердите почту, `ERR_NGROK_105` — неверный токен) |
| «Запрос отклонён защитой от подделки» | Сайт открыт по адресу, которого нет в `PUBLIC_URL` и `EXTRA_ORIGINS`. Откройте его по адресу из `PUBLIC_URL` или добавьте адрес в `EXTRA_ORIGINS` |
| VPS: сайт без HTTPS или ошибка сертификата | DNS-запись A указывает на сервер, порты 80 и 443 открыты; журнал Caddy: `journalctl -u caddy -f` |
| На «Резервная копия» ошибка копирования | Подключите диск или создайте папку из `BACKUP_COPY_DIR`; следующий бэкап скопируется сам |
| `npm run stop` пишет «Не удалось остановить приложение даже принудительно» | Перезагрузите компьютер |
| «Порт … занят другой программой» в `supervisor.log` | Порт занят чужой программой: поменяйте `PORT` в `.env` (и адрес туннеля в Cloudflare) |
| Забыли пароль | `npm run user:passwd -- <логин>` |
````

- [ ] **Step 3: Update the structure block**

В разделе «## Разработка», в блоке «Структура», строку `scripts/ …` замените и добавьте `deploy/`:

```
scripts/      — setup, start (супервизор), stop, service:install/uninstall, user:add, user:passwd, backup, restore
deploy/       — примеры Caddyfile и systemd-юнита для режима vps
```

- [ ] **Step 4: Check commands mentioned in README exist**

Run: `npm run stop` (приложение не запущено)
Expected: «Приложение не запущено.»

Run: `npm run service:uninstall -- --dry-run`
Expected: «Команда: schtasks /Delete /TN finmap-clone /F» (на Windows); ничего не выполняется.

- [ ] **Step 5: Full check and commit**

Run: `npm test`, `npm run typecheck` и `npm run test:e2e` (свободный `E2E_PORT`) — зелёные.

```bash
git add README.md
git commit -m "docs: README — установка в профиль пользователя, режимы, автозапуск, остановка, копии бэкапов, восстановление, обновление, неполадки

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Покрытие спецификации

| Требование | Где |
| --- | --- |
| §8.1 режим `vps`: Caddy с автоматическим HTTPS, `deploy/Caddyfile.example`, systemd-юнит `deploy/finmap-clone.service` | Tasks 1, 5 |
| §8 IP клиента в `vps`: loopback-прокси, подделка `X-Forwarded-For` и `CF-Connecting-IP` не влияет | Task 1 (тесты `client-ip`) |
| §3 команды `service:install` / `service:uninstall` | Task 5 |
| §9.1 автозапуск Windows: при входе текущего пользователя, скрытое окно, `npm start`, рабочая папка — проект; без режима «при запуске системы» | Task 5 |
| §9.1 автозапуск Linux: systemd-юнит от отдельного пользователя | Tasks 1, 5, 7 |
| §9.1 супервизор пишет в журнал | Task 3 |
| §9.1 один экземпляр (в том числе при скачке часов) | Tasks 2, 3 |
| §9.2 `BACKUP_COPY_DIR` с той же ротацией, ошибка — в журнал и на экран | Task 6 |
| §9.3 остановка супервизора и задачи перед восстановлением; restore проверяет супервизор; README | Tasks 2, 4, 7 |
| §8.1 README: пошаговые инструкции для каждого режима, получение токенов; `cloudflare` рекомендуется, `ngrok` — без домена | Task 7 |
| §12 чистый ПК, доступ после перезагрузки (после `service:install`, с автовходом) | Tasks 5, 7 (ручная проверка по README) |
| §12 `npm run backup` / `restore` по README | Task 7 |

Вне этого плана (план 8b): скачок системных часов для `app.lock` сервера, сужение повторов ngrok, `setup` при работающем приложении или занятом порте, `CLOUDFLARED_PATH` на папку, атомарная запись `cloudflared`, пересборка интерфейса после удаления файлов и смены конфигов, права `data/` 0700 на Linux и ACL `data\` и файла настроек на Windows.
