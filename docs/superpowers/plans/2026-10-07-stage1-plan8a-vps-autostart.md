# Этап 1, план 8a: режим vps, автозапуск, остановка, копии бэкапов, README — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** шаг 8 §11 спецификации «Эксплуатация»:
- режим `vps`: Caddyfile и systemd-юнит генерируются из настроек, примеры лежат в `deploy/`;
- автозапуск `npm run service:install` / `service:uninstall`: на Windows задача Планировщика при входе пользователя без окна, на Linux systemd-юнит;
- `npm run stop` — остановка приложения, запущенного без окна (нужна перед восстановлением и обновлением, §9.3);
- журнал супервизора в файле и блокировка супервизора (второй `npm start` не запускается);
- `BACKUP_COPY_DIR`: копия не уходит на системный диск, если флешка отключена;
- README для владельца клуба по всем режимам, автозапуску, бэкапам, восстановлению, обновлению и неполадкам.

**Предусловие:** выполнены планы 1–5 (супервизор `scripts/run.ts`, `scripts/lib/supervise.ts`, `src/server/lock.ts`, бэкапы с `BACKUP_COPY_DIR`, экран «Резервная копия» с `lastCopyError`). Шаги 6–7 на этот план не влияют. Хардинг из отложенных замечаний плана 1 (скачок часов, ngrok, setup при работающем приложении, пересборка интерфейса, права `data/`) — в плане 8b.

**Architecture:**
- **Всё, что регистрирует службы, — чистые функции.** `scripts/lib/deploy-files.ts` (Caddyfile, systemd-юнит), `scripts/lib/windows-task.ts` (XML задачи, аргументы `schtasks`), `scripts/lib/service-plan.ts` (`planInstall`/`planUninstall` → файлы, команды, подсказки) покрыты тестами. Тонкая обёртка `scripts/lib/service-run.ts` читает окружение, пишет файлы и выполняет команды; с `--dry-run` только печатает. Тесты ничего не регистрируют и не вызывают `sudo`.
- **Windows:** задача создаётся из XML (`schtasks /Create /XML`), потому что флаги `schtasks` не умеют снять лимит 3 дня и запрет работы от батареи. Действие — `conhost.exe --headless "<node>" "<npm-cli.js>" start` в папке проекта: окна нет совсем (`powershell -WindowStyle Hidden` не прячет окно Windows Terminal). Перезапуск при падении — только у супервизора.
- **Остановка:** `npm run stop` создаёт `data/stop.request`; супервизор раз в секунду забирает заявку и останавливает сервер штатно (IPC, БД закрыта, lock снят). Если за 20 с процессы не завершились — `taskkill /PID <супервизор> /T /F` (на Linux — SIGTERM). PID супервизора — в `data/supervisor.lock` (тот же формат `{pid, bootTime}`, что `app.lock`).
- **Linux:** `service:install` от имени пользователя приложения пишет `data/deploy/finmap-clone.service` (и `data/deploy/Caddyfile` в режиме vps) и печатает три-пять команд `sudo`. Сам `sudo` не вызывает.

**Tech Stack:** как в планах 1–5; новых пакетов нет.

**Spec:** [docs/superpowers/specs/2026-10-05-stage1-foundation-core-design.md](../specs/2026-10-05-stage1-foundation-core-design.md) — §3 (структура, команды, переменные), §8 (IP клиента), §8.1, §9.1, §9.2, §9.3, §11 шаг 8, §12.

**Ветка:** `stage1/plan1-skeleton`. В `main` не сливаем до завершения всех работ.

## Решения, принятые при планировании

1. **Автозапуск Windows — только «при входе пользователя»** (§9.1). Режим «при запуске системы» не делаем: спецификация его прямо исключает (нужен сохранённый пароль или SYSTEM). Для ПК клуба README объясняет автовход Windows.
2. **Окно скрывает `conhost.exe --headless`.** Флаг не документирован, но есть в Windows 10 1903+ и 11 и проверен на машине разработки. `powershell -WindowStyle Hidden` не годится: при Windows Terminal по умолчанию окно остаётся. Если на конкретном ПК окно всё же появится — README подсказывает, что его можно свернуть, но не закрывать.
3. **Перезапуск при падении — только супервизор.** В задаче нет `RestartOnFailure`: супервизор выходит с кодом 1, когда приложение уже запущено, и Планировщик крутил бы его по кругу. В systemd `Restart=on-failure` оставлен как страховка от падения самого супервизора.
4. **Новая команда `npm run stop`.** `schtasks /End` завершает только запущенный процесс, а не его детей (сервер и cloudflared остаются), окна для Ctrl+C нет. Мягкая остановка — файлом-заявкой, жёсткая — через 20 с.
5. **Блокировка супервизора `data/supervisor.lock` и журнал `data/logs/supervisor.log`** (10 МБ, одна старая копия `.1`). Отложенное замечание плана 1 «журнал падений супервизора писать в файл» закрыто.
6. **Задача запускает `node npm-cli.js start` по абсолютным путям** (из `process.execPath` и `npm_execpath`), а не `npm` из PATH. Поэтому `service:install` нужно запускать через `npm run`; после переустановки Node в другую папку — повторить `service:install` (README).
7. **Linux: `service:install` не вызывает `sudo`** — запускается от пользователя приложения, пишет файлы в `data/deploy/` и печатает команды. От root отказывается.
8. **Режим `vps` требует `PUBLIC_URL` вида `https://домен`** (не localhost): от него зависят Caddyfile, CSRF и флаг `Secure`. Ошибка — при загрузке настроек.
9. **`BACKUP_COPY_DIR` не создаётся автоматически.** Иначе отключённая флешка (`E:\Бэкапы`) или несмонтированный диск (`/mnt/usb/backups`) дали бы «успешную» копию на системный диск. Нет папки — предупреждение в журнале и на экране «Резервная копия», сам бэкап создан. Относительный путь считается от папки проекта.
10. **`npm run doctor` не делаем:** §12 описывает ручную приёмку, спецификация такой команды не предполагает.
11. **Примеры `deploy/Caddyfile.example` и `deploy/finmap-clone.service`** (§3) совпадают с выводом генераторов — это проверяет тест. `.gitattributes` закрепляет для `deploy/*` переводы строк LF (systemd не понимает CRLF).

## Global Constraints

- **Режимы (§8.1):** `local`, `cloudflare`, `ngrok`, `vps`; в `vps` — Caddy с автоматическим HTTPS и systemd-юнит. `HOST` по умолчанию `127.0.0.1`; Caddy проксирует на loopback.
- **IP клиента (§8):** `trustProxy` — только loopback; `CF-Connecting-IP` — только в `cloudflare` и только с loopback. В `vps` IP — правый недоверенный адрес `X-Forwarded-For` от Caddy; подделка начала заголовка и `CF-Connecting-IP` не влияют.
- **Автозапуск (§9.1):** Windows — задача Планировщика при входе текущего пользователя, скрытое окно, `npm start`, рабочая папка — папка проекта (отложенное замечание плана 1); Linux — systemd-юнит от отдельного пользователя.
- **Перезапуск (§9.1):** супервизор, пауза 1 → 2 → 4 … 60 с, пишет в журнал.
- **Бэкапы (§9.2):** последние `BACKUP_KEEP` архивов; копия в `BACKUP_COPY_DIR` с той же ротацией; ошибка копирования — в журнал и на экран «Резервная копия»; сервер из-за неё не падает.
- **Восстановление (§9.3):** только при остановленном приложении; README описывает, как остановить супервизор и задачу Планировщика.
- **Тесты не регистрируют службы, не вызывают `sudo` и `schtasks`** — только чистые функции и `--dry-run`.
- **Безопасность хуков среды:** shell-команды плана не содержат подстроку «.env»; собирать её из частей запрещено. Невидимые символы в коде — через `\uXXXX` (BOM — `\uFEFF`).
- **Завершение задачи:** зелёные `npm test` и `npm run typecheck`, коммит с трейлером `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Задач с интерфейсом в плане нет, e2e не требуется.

## Review Focus

1. **Пути с пробелами, кириллицей, `&` и апострофом** (`C:\Users\Админ\Мой клуб`, `D:\R&D`, `/home/o'brien`) в задаче Планировщика, юните и подсказках `sudo cp` — задача и юнит остаются корректными. Тесты — в задачах 1, 4, 5.
2. **Задача Планировщика по умолчанию останавливается через 72 часа и не запускается от батареи** — у нашей `ExecutionTimeLimit=PT0S`, батарея разрешена, повторный запуск игнорируется. Тест — в задаче 4.
3. **`npm run stop`, когда приложение зависло** — через 20 с дерево процессов завершается принудительно; когда не запущено — сообщение, ничего не трогается; сервер без супервизора (`npm run dev`) тоже останавливается. Тест — в задаче 3.
4. **`BACKUP_COPY_DIR` на отключённой флешке** — бэкап создан, папка на системном диске не появилась, предупреждение в журнале и статусе; после подключения следующий бэкап копируется и ошибка сбрасывается. Тест — в задаче 6.
5. **Журнал супервизора не может записаться** (папка `logs` недоступна) — супервизор не падает. Тест — в задаче 2.

---

## Карта файлов

```
.gitattributes                         # (новый) deploy/* — LF
deploy/Caddyfile.example               # (новый) пример Caddyfile
deploy/finmap-clone.service            # (новый) пример systemd-юнита
src/server/config.ts                   # vps требует https PUBLIC_URL; BACKUP_COPY_DIR → абсолютный путь
src/server/modules/backup/service.ts   # папка копий не создаётся
scripts/
  lib/deploy-files.ts                  # (новый) renderCaddyfile, renderSystemdUnit
  lib/run-files.ts                     # (новый) пути супервизора, заявка на остановку, журнал в файл
  lib/stop.ts                          # (новый) stopApp, forceKillCommand
  lib/windows-task.ts                  # (новый) XML задачи, аргументы schtasks
  lib/service-plan.ts                  # (новый) planInstall / planUninstall
  lib/service-run.ts                   # (новый) обёртка: окружение, запись, выполнение, --dry-run
  run.ts                               # журнал в файл, блокировка супервизора, заявка на остановку
  stop.ts, service-install.ts, service-uninstall.ts   # (новые) команды
  setup.ts                             # подсказка после режима vps
  backup.ts                            # предупреждение о сбое копии с причиной
package.json                           # stop, service:install, service:uninstall
README.md                              # эксплуатация для владельца клуба
tests/server/
  deploy-files.test.ts, run-files.test.ts, stop.test.ts,
  windows-task.test.ts, service-plan.test.ts            # (новые)
  config.test.ts, client-ip.test.ts, backup.test.ts     # дополнены
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
  - `renderSystemdUnit(o: { appName: string; user: string; workingDirectory: string; execStart: string[] }): string`;
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
  it('пользователь, рабочая папка, команда запуска и перезапуск при падении', () => {
    const unit = renderSystemdUnit({ appName: 'Учёт', user: 'finmap', workingDirectory: '/opt/finmap-clone', execStart: ['/usr/bin/npm', 'start'] });
    expect(unit).toContain('Description=Учёт (finmap-clone)\n');
    expect(unit).toContain('User=finmap\n');
    expect(unit).toContain('WorkingDirectory=/opt/finmap-clone\n');
    expect(unit).toContain('ExecStart=/usr/bin/npm start\n');
    expect(unit).toContain('Restart=on-failure\n');
    expect(unit).toContain('UMask=0077\n');
    expect(unit).toContain('WantedBy=multi-user.target\n');
  });

  it('пробелы, кавычки, % и $ в путях не ломают юнит', () => {
    expect(systemdArg('/opt/my app/npm-cli.js')).toBe('"/opt/my app/npm-cli.js"');
    expect(systemdArg('/opt/100%/x')).toBe('/opt/100%%/x');
    expect(systemdArg('/opt/$HOME/x')).toBe('/opt/$$HOME/x');
    expect(systemdArg('/opt/a"b')).toBe('"/opt/a\\"b"');
    const unit = renderSystemdUnit({ appName: 'Клуб 100%', user: 'finmap', workingDirectory: '/srv/fin 100%', execStart: ['/usr/bin/node', '/srv/fin 100%/npm-cli.js', 'start'] });
    expect(unit).toContain('Description=Клуб 100%% (finmap-clone)\n');
    expect(unit).toContain('WorkingDirectory=/srv/fin 100%%\n');
    expect(unit).toContain('ExecStart=/usr/bin/node "/srv/fin 100%%/npm-cli.js" start\n');
  });

  it('примеры в deploy/ совпадают с тем, что генерирует код', () => {
    expect(noIndent(fs.readFileSync('deploy/Caddyfile.example', 'utf8'))).toBe(noIndent(renderCaddyfile(EXAMPLE)));
    expect(noIndent(fs.readFileSync('deploy/finmap-clone.service', 'utf8'))).toBe(noIndent(renderSystemdUnit({ ...EXAMPLE, execStart: [...EXAMPLE.execStart] })));
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

и добавьте перед `it('в режиме cloudflare с loopback учитывает CF-Connecting-IP', …)` (это характеризационные тесты §8 для Caddy — они должны пройти уже на текущем коде):

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

`scripts/lib/deploy-files.ts`:

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

/** systemd-юнит (§9.1: на Linux — от отдельного пользователя). Перезапуск при падении — у супервизора и systemd. */
export function renderSystemdUnit(o: { appName: string; user: string; workingDirectory: string; execStart: string[] }): string {
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
    `ExecStart=${o.execStart.map(systemdArg).join(' ')}`,
    'Restart=on-failure',
    'RestartSec=10',
    'TimeoutStopSec=30',
    'UMask=0077',
    'NoNewPrivileges=true',
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
  execStart: ['/usr/bin/npm', 'start'],
} as const;
```

(`'$$$$'` в строке замены вставляет `$$` — так systemd получает буквальный `$`.)

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
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=10
TimeoutStopSec=30
UMask=0077
NoNewPrivileges=true

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
git commit -m "feat: режим vps — Caddyfile и systemd-юнит из настроек, https-домен обязателен

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Супервизор — журнал в файле, блокировка, заявка на остановку

**Files:**
- Create: `scripts/lib/run-files.ts`, `tests/server/run-files.test.ts`
- Modify: `scripts/run.ts`

**Interfaces:**
- Consumes: `acquireLock`, `isLockHeld`, `LockHeldError` (`src/server/lock.ts`); `createSupervisor({ exit, logError })` (`scripts/lib/supervise.ts`).
- Produces:
  - `runFiles(dataDir: string): { supervisorLock: string; stopRequest: string; supervisorLog: string }` — `<data>/supervisor.lock`, `<data>/stop.request`, `<data>/logs/supervisor.log`;
  - `takeStopRequest(file: string): boolean` — файл был: удаляет, `true`;
  - `createFileLog(file: string, o?: { maxBytes?: number; now?: () => Date }): (message: string) => void`;
  - `npm start` держит `data/supervisor.lock` (`{pid, bootTime}`) всё время работы и проверяет `data/stop.request` раз в секунду.

- [ ] **Step 1: Write the failing test**

`tests/server/run-files.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFileLog, runFiles, takeStopRequest } from '../../scripts/lib/run-files';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/run-files.test.ts`
Expected: FAIL — нет модуля `scripts/lib/run-files`.

- [ ] **Step 3: Implement**

`scripts/lib/run-files.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';

/** Служебные файлы супервизора в папке данных. */
export function runFiles(dataDir: string) {
  return {
    /** Блокировка супервизора {pid, bootTime}: второй npm start не запускается, npm run stop знает, кого остановить. */
    supervisorLock: path.join(dataDir, 'supervisor.lock'),
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
```

`scripts/run.ts` — замените файл целиком (логика сборки, сервера, cloudflared и ngrok прежняя; новое — журнал в файл, блокировка супервизора, заявка на остановку):

```ts
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { loadConfig } from '../src/server/config';
import { acquireLock, isLockHeld, LockHeldError } from '../src/server/lock';
import { EXIT_LOCK_HELD } from '../src/server/main';
import { cloudflaredTarget } from './lib/cloudflared';
import { needsClientBuild } from './lib/client-build';
import { connectWithRetry, errorText, isFatalNgrokError, maskSecret } from './lib/ngrok';
import { createFileLog, runFiles, takeStopRequest } from './lib/run-files';
import { createSupervisor, type ChildLike } from './lib/supervise';

if (fs.existsSync('.env')) process.loadEnvFile('.env');
const config = loadConfig();

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
let releaseSupervisorLock = () => {};
try {
  releaseSupervisorLock = acquireLock(files.supervisorLock);
} catch (e) {
  if (!(e instanceof LockHeldError)) throw e;
  logError(`Приложение уже запущено (супервизор PID ${e.pid}). Остановите его командой npm run stop и повторите.`);
  process.exit(1);
}
// Страховка: при любом выходе не оставляем детей-сирот и снимаем блокировку супервизора.
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
  console.log('Собираем интерфейс…');
  const npmCli = process.env.npm_execpath;
  const r = npmCli
    ? spawnSync(process.execPath, [npmCli, 'run', 'build:client'], { stdio: 'inherit' })
    : spawnSync('npm run build:client', { stdio: 'inherit', shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
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
    return spawn(cloudflaredBin, ['tunnel', '--no-autoupdate', 'run'], { stdio: 'inherit', env }) as ChildLike;
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

Run: `npx vitest run tests/server/run-files.test.ts tests/server/supervise.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add scripts/lib/run-files.ts scripts/run.ts tests/server/run-files.test.ts
git commit -m "feat: супервизор пишет журнал в data/logs/supervisor.log, держит свою блокировку и принимает заявку на остановку

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `npm run stop`

**Files:**
- Create: `scripts/lib/stop.ts`, `scripts/stop.ts`, `tests/server/stop.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `runFiles` (задача 2); `isLockHeld`, `isPidAlive`, `readLockPid` (`src/server/lock.ts`).
- Produces:
  - `interface StopDeps { supervisorPid: number | null; serverPid: number | null; isAlive(pid): boolean; requestStop(): void; clearRequest(): void; forceKill(pid): void; sleep(ms): Promise<void>; now(): number; timeoutMs?: number }`;
  - `stopApp(d: StopDeps): Promise<'not-running' | 'stopped' | 'killed'>`;
  - `forceKillCommand(platform: NodeJS.Platform, pid: number): { cmd: string; args: string[] } | null`;
  - npm-скрипт `stop`.

- [ ] **Step 1: Write the failing test**

`tests/server/stop.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { forceKillCommand, stopApp, type StopDeps } from '../../scripts/lib/stop';

/** Мир с подменёнными часами: процессы «умирают» в заданный момент. */
function world(o: { sup: number | null; srv: number | null; dieAtMs?: number | null }) {
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
      killed.add(pid);
    },
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    timeoutMs: 20_000,
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

  it('супервизор не ответил за 20 с — заявка убирается, дерево процессов завершается принудительно', async () => {
    const w = world({ sup: 100, srv: 200, dieAtMs: null });
    expect(await stopApp(w.deps)).toBe('killed');
    expect(w.events).toEqual(['request', 'clear', 'kill 100', 'kill 200']);
    expect(w.clock()).toBe(20_000);
  });

  it('сервер без супервизора (npm run dev) завершается сразу, без заявки', async () => {
    const w = world({ sup: null, srv: 200, dieAtMs: null });
    expect(await stopApp(w.deps)).toBe('killed');
    expect(w.events).toEqual(['kill 200']);
  });

  it('на Windows — taskkill всего дерева, на Linux — сигнал', () => {
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
  /** PID живого супервизора (data/supervisor.lock) или null. */
  supervisorPid: number | null;
  /** PID живого сервера (data/app.lock) или null. */
  serverPid: number | null;
  isAlive: (pid: number) => boolean;
  /** Создать заявку на остановку (data/stop.request). */
  requestStop: () => void;
  /** Убрать заявку, которую никто не забрал. */
  clearRequest: () => void;
  /** Принудительно завершить процесс вместе с дочерними. */
  forceKill: (pid: number) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  timeoutMs?: number;
}

export type StopResult = 'not-running' | 'stopped' | 'killed';

/**
 * Остановка приложения (§9.3: перед восстановлением и обновлением). Сначала мягко — заявкой,
 * которую супервизор забирает раз в секунду и останавливает сервер штатно (БД закрыта, lock снят).
 * Если за timeoutMs процессы не завершились — принудительно (WAL сохраняет согласованность, §9.1).
 */
export async function stopApp(d: StopDeps): Promise<StopResult> {
  const { supervisorPid: sup, serverPid: srv } = d;
  if (sup === null && srv === null) return 'not-running';
  const gone = () => (sup === null || !d.isAlive(sup)) && (srv === null || !d.isAlive(srv));

  if (sup !== null) {
    d.requestStop();
    const deadline = d.now() + (d.timeoutMs ?? 20_000);
    while (d.now() < deadline) {
      if (gone()) return 'stopped';
      await d.sleep(500);
    }
    if (gone()) return 'stopped';
    d.clearRequest();
    if (d.isAlive(sup)) d.forceKill(sup);
  }
  if (srv !== null && d.isAlive(srv)) d.forceKill(srv);
  return 'killed';
}

/** Команда принудительного завершения дерева процессов; на POSIX — null (используется сигнал). */
export function forceKillCommand(platform: NodeJS.Platform, pid: number): { cmd: string; args: string[] } | null {
  return platform === 'win32' ? { cmd: 'taskkill', args: ['/PID', String(pid), '/T', '/F'] } : null;
}
```

`scripts/stop.ts` (тонкая обёртка, не тестируется):

```ts
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { loadConfig } from '../src/server/config';
import { isLockHeld, isPidAlive, readLockPid } from '../src/server/lock';
import { runFiles } from './lib/run-files';
import { forceKillCommand, stopApp } from './lib/stop';

if (fs.existsSync('.env')) process.loadEnvFile('.env');
const config = loadConfig();
const files = runFiles(config.dataDir);
const livePid = (lockPath: string) => (isLockHeld(lockPath) ? readLockPid(lockPath) : null);

const result = await stopApp({
  supervisorPid: livePid(files.supervisorLock),
  serverPid: livePid(config.lockPath),
  isAlive: isPidAlive,
  requestStop: () => fs.writeFileSync(files.stopRequest, String(process.pid)),
  clearRequest: () => fs.rmSync(files.stopRequest, { force: true }),
  forceKill: (pid) => {
    const c = forceKillCommand(process.platform, pid);
    if (c) spawnSync(c.cmd, c.args, { stdio: 'ignore' });
    else {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* уже завершился */
      }
    }
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: Date.now,
});

const messages = {
  'not-running': 'Приложение не запущено.',
  stopped: 'Приложение остановлено.',
  killed:
    'Приложение не ответило за 20 секунд и остановлено принудительно. База осталась согласованной; ' +
    'могли не сохраниться только изменения, которые выполнялись в эту секунду.',
} as const;
console.log(messages[result]);
```

`package.json` — в `scripts` сразу после `"start": "tsx scripts/run.ts",`:

```json
    "stop": "tsx scripts/stop.ts",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/stop.test.ts`
Expected: PASS.

- [ ] **Step 5: Live check on a test port (no autostart involved)**

В Git Bash из папки проекта, с отдельной папкой данных и свободным портом (не 3000 и не порт рабочего приложения; `cygpath -m` даёт путь, понятный Node на Windows):

```bash
export SESSION_SECRET=ssssssssssssssssssssssssssssssssssssssss DATA_DIR="$(cygpath -m "$(mktemp -d)")" PORT=41799 RATES_SOURCE=fixtures
npm start > /tmp/fc-stop-check.log 2>&1 &
for i in $(seq 1 60); do curl -s http://127.0.0.1:41799/api/v1/health | grep -q ok && break; sleep 1; done
npm start; echo "второй запуск: код $?"
npm run stop
ls "$DATA_DIR"; tail -3 "$DATA_DIR/logs/supervisor.log"
```

Expected: второй `npm start` печатает «Приложение уже запущено (супервизор PID …)» и код 1; `npm run stop` — «Приложение остановлено.» за 1–3 с; в `$DATA_DIR` нет `app.lock` и `supervisor.lock`; последняя строка журнала — «Остановка по команде npm run stop».

- [ ] **Step 6: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add scripts/lib/stop.ts scripts/stop.ts package.json tests/server/stop.test.ts
git commit -m "feat: npm run stop — мягкая остановка заявкой, через 20 с принудительно

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Задача Планировщика Windows

**Files:**
- Create: `scripts/lib/windows-task.ts`, `tests/server/windows-task.test.ts`

**Interfaces:**
- Consumes: `SERVICE_NAME` (задача 1).
- Produces:
  - `xmlEscape(s: string): string`;
  - `windowsArg(s: string): string` — правила `CommandLineToArgvW`;
  - `windowsUserId(env: Record<string, string | undefined>, fallbackUser: string): string` — `DOMAIN\user`;
  - `renderTaskXml(o: { userId: string; workingDirectory: string; command: string[]; conhostPath: string; description: string }): string` — строки через `\r\n`;
  - `encodeTaskXml(xml: string): Buffer` — UTF-16 LE с BOM;
  - `schtasksCreateArgs(xmlPath: string, name?: string): string[]`, `schtasksDeleteArgs(name?: string): string[]`.

- [ ] **Step 1: Write the failing test**

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

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/windows-task.test.ts`
Expected: FAIL — нет модуля `scripts/lib/windows-task`.

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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/windows-task.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add scripts/lib/windows-task.ts tests/server/windows-task.test.ts
git commit -m "feat: XML задачи Планировщика — при входе пользователя, без окна, без лимита времени

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `npm run service:install` и `service:uninstall`

**Files:**
- Create: `scripts/lib/service-plan.ts`, `scripts/lib/service-run.ts`, `scripts/service-install.ts`, `scripts/service-uninstall.ts`, `tests/server/service-plan.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `SERVICE_NAME`, `renderCaddyfile`, `renderSystemdUnit` (задача 1); `renderTaskXml`, `encodeTaskXml`, `schtasksCreateArgs`, `schtasksDeleteArgs`, `windowsUserId` (задача 4); `DeployMode`, `loadConfig` (`src/server/config.ts`).
- Produces:
  - `interface ServiceContext { platform; appDir; dataDir; nodePath; npmCli: string | undefined; user; isRoot; appName; deployMode; publicUrl; host; port; systemRoot }`;
  - `interface ServiceFile { path: string; text: string; utf16?: boolean }`, `interface ServicePlan { files: ServiceFile[]; commands: { cmd: string; args: string[] }[]; notes: string[] }`;
  - `planInstall(ctx): ServicePlan`, `planUninstall(ctx): ServicePlan` — бросают `Error` с русским текстом (нет npm, root на Linux, другая ОС);
  - `serviceFileBytes(f: ServiceFile): Buffer`;
  - `runServicePlan(kind: 'install' | 'uninstall', argv: string[]): void` — с `--dry-run` ничего не пишет и не выполняет;
  - npm-скрипты `service:install`, `service:uninstall`.

- [ ] **Step 1: Write the failing test**

`tests/server/service-plan.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { planInstall, planUninstall, serviceFileBytes, type ServiceContext } from '../../scripts/lib/service-plan';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/service-plan.test.ts`
Expected: FAIL — нет модуля `scripts/lib/service-plan`.

- [ ] **Step 3: Implement**

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
      { path: unitPath, text: renderSystemdUnit({ appName: ctx.appName, user: ctx.user, workingDirectory: ctx.appDir, execStart: startCommand(ctx) }) },
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
import { planInstall, planUninstall, serviceFileBytes, type ServiceContext, type ServicePlan } from './service-plan';
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
  };
}

/**
 * Выполняет план: пишет файлы, запускает команды, печатает подсказки.
 * С --dry-run только печатает, что было бы сделано (ничего не пишет и не регистрирует).
 */
export function runServicePlan(kind: 'install' | 'uninstall', argv: string[]): void {
  const dryRun = argv.includes('--dry-run');
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

Run: `npx vitest run tests/server/service-plan.test.ts`
Expected: PASS.

- [ ] **Step 5: Dry run (ничего не регистрирует)**

Run: `npm run service:install -- --dry-run` и `npm run service:uninstall -- --dry-run`
Expected: на Windows печатается XML задачи (`<Command>…\System32\conhost.exe</Command>`, `<WorkingDirectory>` — папка проекта, `npm-cli.js … start` в `<Arguments>`), строка `Команда: schtasks /Create /TN finmap-clone /XML …\data\deploy\finmap-clone-task.xml /F` и подсказки; папка `data/deploy` не создана. **Без `--dry-run` команду в ходе выполнения плана не запускать** — она регистрирует задачу на машине.

- [ ] **Step 6: Full check and commit**

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add scripts/lib/service-plan.ts scripts/lib/service-run.ts scripts/service-install.ts scripts/service-uninstall.ts package.json tests/server/service-plan.test.ts
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
- Consumes: команды задач 1–6: `npm run stop`, `npm run service:install [-- --dry-run]`, `npm run service:uninstall`, `schtasks /Run /TN finmap-clone`, `data/logs/supervisor.log`, `data/deploy/`, правило `BACKUP_COPY_DIR`.
- Produces: README на русском для владельца-непрограммиста.

- [ ] **Step 1: Update «Что уже работает»**

В разделе «## Что уже работает» добавьте в конец списка (перед строкой «Пока нет …»):

```markdown
- **Эксплуатация (шаг 8):**
  - режим `vps` с Caddy и systemd;
  - автозапуск `npm run service:install` (Windows — при входе пользователя, без окна; Linux — systemd);
  - `npm run stop`, журнал супервизора `data/logs/supervisor.log`;
  - копии бэкапов в `BACKUP_COPY_DIR`.
```

- [ ] **Step 2: Replace the operating sections**

Замените всё от строки `## Требования` до строки перед `## Разработка` (разделы «Требования», «Первый запуск», «Запуск», «Пользователи», «Настройки (`.env`)», «Режимы развёртывания», «Данные и бэкапы») текстом ниже. Раздел «Пользователи» и таблица настроек сохраняются по смыслу; в таблице меняется строка `BACKUP_COPY_DIR`.

````markdown
## Требования

- Windows 10/11 x64 (ПК клуба) или Linux-сервер (режим `vps`, например Ubuntu 24.04).
- Node.js 24 LTS — установщик с nodejs.org, все галочки по умолчанию. Visual Studio и Build Tools не нужны.
- Git — чтобы скачивать обновления (git-scm.com, настройки по умолчанию).
- Для доступа с телефона: свой домен в Cloudflare (режим `cloudflare`), бесплатный аккаунт ngrok (режим `ngrok`) или VPS (режим `vps`).

## Установка на ПК клуба (Windows)

1. Установите Node.js 24 LTS и Git.
2. Скачайте проект: откройте папку, куда его положить (например `C:\Учёт`), щёлкните по адресной строке Проводника, наберите `cmd` и нажмите Enter. В открывшемся окне:
   ```bat
   git clone <адрес репозитория> finmap-clone
   cd finmap-clone
   setup.cmd
   ```
3. `setup.cmd` ставит зависимости и задаёт вопросы: режим (`local`, `cloudflare`, `ngrok` — см. «Режимы развёртывания»), адрес и токен, затем логин и пароль первого пользователя (не короче 10 символов).
4. Запустите приложение: `npm start`. Откройте адрес из окна (по умолчанию http://127.0.0.1:3000) и войдите.
5. Включите автозапуск: `npm run service:install` (раздел «Автозапуск»).

**Linux / macOS вручную:** `./setup.sh`, затем `npm start`. Если зависимости уже стоят, достаточно `npm run setup`.

Дальше все команды выполняются в окне команд, открытом в папке проекта (`finmap-clone`).

## Запуск и остановка

- **Запуск:** `npm start`. Команда собирает интерфейс (если нужно), запускает сервер под супервизором, который перезапускает его при падении, и в режимах `cloudflare` и `ngrok` поднимает туннель. Окно можно свернуть, но не закрывать — закрытие окна останавливает приложение.
- **Остановка:** `Ctrl+C` в окне приложения или `npm run stop` из любого окна в папке проекта. `npm run stop` нужен, когда приложение запущено автозапуском без окна. Он просит приложение завершиться штатно, а если оно не ответило за 20 секунд, завершает его принудительно.
- **Журналы:** папка `data/logs`. В `supervisor.log` — запуски, остановки, перезапуски после падений и ошибки туннеля; в `app.*.log` — работа сервера.
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

Файл `.env` в папке проекта создаёт `npm run setup`. Его можно открыть Блокнотом. После правки перезапустите приложение (`npm run stop`, затем `npm start` или `schtasks /Run /TN finmap-clone`).

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
   Если в Caddy уже есть другие сайты, не заменяйте `/etc/caddy/Caddyfile`, а добавьте в него блок из `data/deploy/Caddyfile`.
4. Откройте в брандмауэре порты 80 и 443 (`sudo ufw allow 80,443/tcp`). Порт приложения (3000) открывать не нужно: оно слушает только `127.0.0.1`, наружу его отдаёт Caddy.
5. Откройте `https://fin.example.kz`. Сертификат Caddy получает сам за минуту.

Управление: `sudo systemctl status|stop|start|restart finmap-clone`; журнал: `journalctl -u finmap-clone -f` и `data/logs`.

## Автозапуск

### Windows

```bat
npm run service:install
```

Команда создаёт задачу Планировщика `finmap-clone`. При входе вашего пользователя в Windows она запускает `npm start` без окна из папки проекта. Задача работает от вашего имени, поэтому всё как при ручном запуске. При падении приложение перезапускает супервизор.

- Проверить без изменений: `npm run service:install -- --dry-run`.
- Запустить сейчас, не перезагружая ПК: `schtasks /Run /TN finmap-clone`.
- Остановить: `npm run stop`. Выключить автозапуск: `npm run service:uninstall`, затем `npm run stop`.
- Если `schtasks` пишет «Отказано в доступе», откройте окно команд от имени администратора и повторите. Задача всё равно будет работать от вашего пользователя.
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
2. В `.env` впишите `BACKUP_COPY_DIR=C:\Users\Админ\OneDrive\Учёт-бэкапы` и перезапустите приложение.

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
| На ПК открывается, с телефона — нет | `cloudflare`: в панели Zero Trust туннель должен быть **Healthy**; `ngrok`: строки «Не удалось открыть туннель ngrok» в `supervisor.log` (`ERR_NGROK_4018` — подтвердите почту, `ERR_NGROK_105` — неверный токен) |
| «Запрос отклонён защитой от подделки» | Сайт открыт по адресу, которого нет в `PUBLIC_URL` и `EXTRA_ORIGINS`. Откройте его по адресу из `PUBLIC_URL` или добавьте адрес в `EXTRA_ORIGINS` |
| VPS: сайт без HTTPS или ошибка сертификата | DNS-запись A указывает на сервер, порты 80 и 443 открыты; журнал Caddy: `journalctl -u caddy -f` |
| На «Резервная копия» ошибка копирования | Подключите диск или создайте папку из `BACKUP_COPY_DIR`; следующий бэкап скопируется сам |
| `EADDRINUSE` в журнале | Порт занят другой программой: поменяйте `PORT` в `.env` (и адрес туннеля в Cloudflare) |
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

Run: `npm test` и `npm run typecheck` — зелёные.

```bash
git add README.md
git commit -m "docs: README — установка, режимы, автозапуск, остановка, копии бэкапов, восстановление, обновление, неполадки

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Покрытие спецификации

| Требование | Где |
| --- | --- |
| §8.1 режим `vps`: Caddy с автоматическим HTTPS, `deploy/Caddyfile.example`, systemd-юнит `deploy/finmap-clone.service` | Tasks 1, 5 |
| §8 IP клиента в `vps`: loopback-прокси, подделка `X-Forwarded-For` и `CF-Connecting-IP` не влияет | Task 1 (тесты `client-ip`) |
| §3 команды `service:install` / `service:uninstall` | Task 5 |
| §9.1 автозапуск Windows: при входе текущего пользователя, скрытое окно, `npm start`, рабочая папка — проект; без режима «при запуске системы» | Tasks 4, 5 |
| §9.1 автозапуск Linux: systemd-юнит от отдельного пользователя | Tasks 1, 5, 7 |
| §9.1 супервизор пишет в журнал | Task 2 |
| §9.1 один экземпляр | Task 2 (блокировка супервизора) |
| §9.2 `BACKUP_COPY_DIR` с той же ротацией, ошибка — в журнал и на экран | Task 6 |
| §9.3 остановка супервизора и задачи перед восстановлением; README | Tasks 3, 7 |
| §8.1 README: пошаговые инструкции для каждого режима, получение токенов; `cloudflare` рекомендуется, `ngrok` — без домена | Task 7 |
| §12 чистый ПК, доступ после перезагрузки (после `service:install`, с автовходом) | Tasks 4, 5, 7 (ручная проверка по README) |
| §12 `npm run backup` / `restore` по README | Task 7 |

Вне этого плана (план 8b): скачок системных часов и `app.lock`, сужение повторов ngrok, `setup` при работающем приложении, `CLOUDFLARED_PATH` на папку, атомарная запись `cloudflared`, пересборка интерфейса после удаления файлов и смены конфигов, права `data/` 0700.
