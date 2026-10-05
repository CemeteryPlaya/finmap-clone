# Этап 1, план 1: спайк рисков и каркас с защитой — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Проверить рискованные внешние зависимости на чистой Windows (спайк, шаг 0 §11) и собрать работающий каркас (шаг 1 §11). Каркас включает: один Node-процесс, вход и выход, сессии, защиту (rate-limit, IP по режиму развёртывания, CSRF, helmet), историю действий, справочник валют, бэкап и восстановление, супервизор с туннелями.

**Architecture:**
- Fastify 5 обслуживает `/api/v1` и отдаёт SPA из `dist/client`; React SPA собирается Vite.
- SQLite через `better-sqlite3`, Drizzle ORM; миграции генерируются Drizzle Kit и применяются при старте.
- Модули сервера — фабрики сервисов `createXService(deps)` плюс функции регистрации маршрутов. Всё собирается в `buildApp()`.
- Запуск через супервизор `scripts/run.ts`: перезапускает сервер при падении, поднимает туннель Cloudflare или ngrok.

**Tech Stack:** Node.js 24 LTS, TypeScript, tsx, Fastify 5 (`@fastify/cookie`, `@fastify/helmet`, `@fastify/rate-limit`, `@fastify/static`), zod, drizzle-orm и drizzle-kit, better-sqlite3, `@node-rs/argon2`, pino (pino-pretty, pino-roll), croner, adm-zip, `@ngrok/ngrok`, React 19, react-router 7, TanStack Query, Tailwind CSS 4, Vite, Vitest, Playwright.

**Spec:** [docs/superpowers/specs/2026-10-05-stage1-foundation-core-design.md](../specs/2026-10-05-stage1-foundation-core-design.md). Этот план покрывает шаги 0–1 §11. Шаги 2–8 получат свои планы по мере готовности предыдущего.

## Global Constraints

- Node.js 24 LTS. Нативные зависимости — только с готовыми бинарниками для Windows x64 (`better-sqlite3`, `@node-rs/argon2`, `@ngrok/ngrok`); Visual Studio Build Tools не требуются.
- Только SQLite (`better-sqlite3`, режим WAL), Drizzle ORM диалекта sqlite. PostgreSQL не поддерживается.
- Деньги — целые числа в минимальных единицах; float для денег запрещён. Курсы — десятичные строки, считаются через `big.js` (в этом плане денег ещё нет, правило действует для `shared/`).
- Время хранится в UTC ISO-8601 фиксированной ширины `YYYY-MM-DDTHH:mm:ss.sssZ` (`new Date().toISOString()`); календарные понятия считаются в `APP_TIMEZONE` (по умолчанию `Asia/Almaty`).
- `HOST` по умолчанию `127.0.0.1`. Fastify `trustProxy: 'loopback'`. `CF-Connecting-IP` учитывается только при `DEPLOY_MODE=cloudflare` и только для соединения с loopback.
- CSRF: изменяющие запросы требуют `X-Requested-With: fetch` и `Origin` из списка `PUBLIC_URL`, `http://localhost:PORT`, `http://127.0.0.1:PORT`, `EXTRA_ORIGINS`.
- Сессия хранится в куке `sid` (httpOnly, `SameSite=Lax`, подписана `SESSION_SECRET`, `Secure` при HTTPS-запросе): 12 часов, с «запомнить меня» 30 дней, продление при активности; `lastSeenAt` обновляется не чаще раза в 5 минут.
- Вход: 5 неудачных попыток за 15 минут на логин и на IP дают 429. API: 300 запросов в минуту на сессию.
- Пароли хэшируются argon2id, минимум 10 символов.
- Формат ошибки: `{ error: { code, message, fields? } }`. Коды: 400 `VALIDATION`, 401, 403, 404, 409 `VERSION_CONFLICT`, 422, 429 `RATE_LIMITED`, 500 `INTERNAL`.
- В истории действий (`audit_log.diff`) нет полей с паролями, хэшами, токенами и секретами.
- Бэкап — архив `backup-YYYYMMDD-HHmmss.zip` (`VACUUM INTO` + `uploads/`), хранятся последние `BACKUP_KEEP` (14); копия в `BACKUP_COPY_DIR`, если он задан; бэкап при старте, если последнему больше 24 часов.
- Тексты интерфейса на русском; название продукта берётся из `APP_NAME` (по умолчанию «Учёт»). Бренд, тексты и код Finmap не копируются.
- Каждая задача заканчивается зелёными `npm test` и `npm run typecheck` и коммитом.

## Review Focus

1. **Логин с пробелами или в другом регистре** (« Admin », «ADMIN»). Ожидается, что вход проходит: логин нормализуется `trim` + нижний регистр и при создании, и при входе. Тест — в задаче 6.
2. **Вход с самого ПК клуба по `http://localhost:3000`** при `PUBLIC_URL=https://…`. Ожидается, что вход работает: кука ставится без `Secure`, потому что запрос пришёл по HTTP. За туннелем (`X-Forwarded-Proto: https` от loopback) кука получает `Secure`. Тест — в задаче 7.
3. **Папка данных с пробелами, кириллицей и апострофом** (`C:\Users\Пользователь\O'Brien data`). Ожидается, что бэкап и восстановление работают: путь в `VACUUM INTO` экранируется. Тест — в задаче 9.
4. **Подделанная или устаревшая кука `sid`**, в том числе после восстановления, которое очистило сессии. Ожидается 401 `UNAUTHORIZED`, а не 500. Тест — в задаче 7.
5. **Первый бэкап, когда `data/uploads/` ещё не существует.** Ожидается, что архив создаётся и содержит только `app.db`. Тест — в задаче 9.

---

## Карта файлов

```
package.json, tsconfig.json, vite.config.ts, vitest.config.ts, playwright.config.ts,
drizzle.config.ts, .env.example, setup.cmd, setup.sh
scripts/
  cloudflared-pins.json      # версия и SHA-256 cloudflared (из спайка)
  setup.ts, run.ts, user-add.ts, backup.ts, restore.ts
  lib/{prompt.ts, env-file.ts, cloudflared.ts, client-build.ts}
src/shared/currencies.ts     # справочник валют ISO 4217 (код, название, символ, знаки)
src/server/
  config.ts                  # загрузка и проверка .env → Config
  errors.ts                  # AppError, обработчик ошибок
  logger.ts                  # pino: консоль + файлы с ротацией
  lock.ts                    # data/app.lock
  app.ts                     # buildApp(): плагины, хуки, маршруты
  main.ts                    # startServer(): старт, миграции, бэкап, планировщик, сигналы
  index.ts                   # точка входа: startServer(loadConfig())
  db/{schema.ts, client.ts, migrate.ts, seed.ts, migrations/}
  security/{client-ip.ts, csrf.ts}
  jobs/scheduler.ts
  modules/
    audit/service.ts
    users/{service.ts, passwords.ts}
    auth/{sessions.ts, login-limiter.ts, plugin.ts, routes.ts}
    backup/{service.ts, restore.ts, routes.ts, archive-name.ts}
src/client/
  index.html, main.tsx, styles.css, router.tsx
  lib/{api.ts, query.ts}
  pages/{LoginPage.tsx, AppShell.tsx}
tests/
  helpers/{test-db.ts, test-app.ts}
  shared/currencies.test.ts
  server/{config, errors-and-health, db, audit, users, sessions, login-limiter,
          auth-routes, client-ip, csrf, rate-limit, backup, restore, lock,
          archive-name, env-file, cloudflared, client-build}.test.ts
e2e/{server.ts, auth.spec.ts}
docs/research/spike-stage1.md
```

---

### Task 1: Спайк рисков (шаг 0 §11)

Код спайка выбрасывается. Сохраняются только `docs/research/spike-stage1.md` и `scripts/cloudflared-pins.json`.

**Files:**
- Create: `docs/research/spike-stage1.md`
- Create: `scripts/cloudflared-pins.json`
- Throwaway: `%TEMP%\spike\*` (вне репозитория)

**Interfaces:**
- Produces: `scripts/cloudflared-pins.json` со структурой
  `{ "version": string, "assets": { "win32-x64": { "url": string, "sha256": string }, "linux-x64": { "url": string, "sha256": string } } }`. Её читает задача 13.

- [ ] **Step 1: Готовые бинарники на Windows + Node 24**

На Windows 10/11 x64, где установлен только Node 24 LTS (без Visual Studio Build Tools):

```powershell
mkdir $env:TEMP\spike; cd $env:TEMP\spike
npm init -y
npm install better-sqlite3 @node-rs/argon2 @ngrok/ngrok
node -e "const D=require('better-sqlite3');const d=new D(':memory:');d.function('ulower',{deterministic:true},s=>s.toLocaleLowerCase('ru'));console.log(d.prepare(\"select ulower('АРЕНДА') v\").get())"
node -e "const a=require('@node-rs/argon2');a.hash('password-123').then(h=>a.verify(h,'password-123')).then(console.log)"
```

Expected: `npm install` завершается без вызова `node-gyp` и без сборки, первая проверка печатает `{ v: 'аренда' }`, вторая — `true`. Если какой-то пакет начал сборку из исходников, это записывается в отчёт как **блокер**, и работа останавливается до решения вопроса с заказчиком.

- [ ] **Step 2: Именованный туннель Cloudflare**

1. Скачать последний `cloudflared-windows-amd64.exe` и `cloudflared-linux-amd64` со страницы https://github.com/cloudflare/cloudflared/releases и запомнить номер версии.
2. Посчитать SHA-256 обоих файлов:
   ```powershell
   node -e "const c=require('crypto'),f=require('fs');for(const p of process.argv.slice(1))console.log(p,c.createHash('sha256').update(f.readFileSync(p)).digest('hex'))" cloudflared-windows-amd64.exe cloudflared-linux-amd64
   ```
3. В панели Cloudflare Zero Trust (тестовый домен заказчика) создать туннель с hostname `spike.<домен> → http://localhost:3999`.
4. Запустить временный сервер, который показывает заголовки запроса:
   ```powershell
   node -e "require('http').createServer((q,r)=>{r.end(JSON.stringify({remote:q.socket.remoteAddress,headers:q.headers},null,2))}).listen(3999,'127.0.0.1')"
   ```
5. В другом окне запустить туннель:
   ```powershell
   $env:TUNNEL_TOKEN='<токен>'; .\cloudflared-windows-amd64.exe tunnel --no-autoupdate run
   ```
6. Открыть `https://spike.<домен>` с телефона.

Expected: сервер видит `remote` = `127.0.0.1` или `::1`, в заголовках есть `cf-connecting-ip` (реальный IP телефона), `x-forwarded-for` и `x-forwarded-proto: https`. Скопировать JSON заголовков в отчёт.

- [ ] **Step 3: Статический домен ngrok через `@ngrok/ngrok`**

В `$env:TEMP\spike` при запущенном сервере из шага 2.4:

```powershell
node -e "require('@ngrok/ngrok').forward({addr:3999,authtoken:process.env.NGROK_AUTHTOKEN,domain:process.env.NGROK_DOMAIN}).then(l=>console.log('URL',l.url()))"
```

Expected: печатается `URL https://<NGROK_DOMAIN>`. При открытии с телефона сначала показывается страница-предупреждение ngrok (это записывается в отчёт), затем JSON. `remote` должен быть loopback, есть `x-forwarded-for` и `x-forwarded-proto`. Отдельно проверить: если отправить `curl -H "CF-Connecting-IP: 1.2.3.4" https://<NGROK_DOMAIN>`, заголовок дойдёт до сервера. Это подтверждает, что в режиме ngrok ему доверять нельзя.

- [ ] **Step 4: Курсы Нацбанка РК за выходные**

```powershell
node -e "fetch('https://nationalbank.kz/rss/get_rates.cfm?fdate=04.10.2026').then(r=>r.text()).then(t=>console.log(t.slice(0,1500)))"
node -e "fetch('https://nationalbank.kz/rss/get_rates.cfm?fdate=05.10.2026').then(r=>r.text()).then(t=>console.log(t.slice(0,1500)))"
```

(04.10.2026 — воскресенье, 05.10.2026 — понедельник.) Записать в отчёт: отдаёт ли фид курсы за воскресенье, структуру XML (имена тегов: `item`, `title`, `description`, `quant` и т.д.) и пример `quant` ≠ 1. Сохранить оба ответа как будущие фикстуры: `tests/fixtures/nbrk/2026-10-04.xml` и `tests/fixtures/nbrk/2026-10-05.xml` (используются в плане шага 4).

- [ ] **Step 5: Заголовки Caddy (VPS)**

Если VPS доступен: поставить Caddy, задать `Caddyfile` `spike.<домен> { reverse_proxy 127.0.0.1:3999 }` и повторить шаг 2.4 и шаг 2.6. Если VPS пока нет, записать в отчёт «не проверено, документированное поведение Caddy: дописывает `X-Forwarded-For` и ставит `X-Forwarded-Proto`», и проверка переносится в план шага 8.

- [ ] **Step 6: Записать результаты**

Создать `scripts/cloudflared-pins.json` с реальными значениями из шага 2:

```json
{
  "version": "<версия из шага 2>",
  "assets": {
    "win32-x64": {
      "url": "https://github.com/cloudflare/cloudflared/releases/download/<версия>/cloudflared-windows-amd64.exe",
      "sha256": "<sha256 windows>"
    },
    "linux-x64": {
      "url": "https://github.com/cloudflare/cloudflared/releases/download/<версия>/cloudflared-linux-amd64",
      "sha256": "<sha256 linux>"
    }
  }
}
```

Создать `docs/research/spike-stage1.md` с разделами:

```markdown
# Спайк этапа 1 (шаг 0 §11)

Дата: <дата>. Машина: <Windows-версия>, Node <версия>.

## 1. Нативные пакеты
better-sqlite3 <версия>: готовый бинарник — да/нет. ulower — работает/нет.
@node-rs/argon2 <версия>: да/нет. @ngrok/ngrok <версия>: да/нет.

## 2. Cloudflare Tunnel
cloudflared <версия>. Заголовки на сервере: <JSON>.

## 3. ngrok
Статический домен: работает/нет. Страница-предупреждение: да/нет.
Клиентский CF-Connecting-IP доходит до сервера: да/нет. Заголовки: <JSON>.

## 4. Нацбанк РК
Воскресенье 04.10.2026: курсы есть/нет. Структура XML: <описание>. Пример quant≠1: <валюта, quant>.

## 5. Caddy
<результат или «не проверено»>

## Вывод
<что подтвердилось; что требует правки спецификации — если пусто, «правок не требуется»>
```

Если в выводе есть пункты «требует правки спецификации», показать их заказчику и обновить спецификацию до начала задачи 2.

- [ ] **Step 7: Commit**

```bash
git add docs/research/spike-stage1.md scripts/cloudflared-pins.json tests/fixtures/nbrk
git commit -m "docs: результаты спайка этапа 1 и пины cloudflared"
```

---

### Task 2: Скелет проекта и конфигурация

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`
- Create: `src/server/config.ts`
- Test: `tests/server/config.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type DeployMode = 'local' | 'cloudflare' | 'ngrok' | 'vps';
  interface Config {
    appName: string; timezone: string; host: string; port: number;
    publicUrl: string; deployMode: DeployMode;
    cfTunnelToken: string | null; cloudflaredPath: string | null;
    ngrokAuthtoken: string | null; ngrokDomain: string | null;
    sessionSecret: string; allowedOrigins: string[];
    backupKeep: number; backupCopyDir: string | null; ratesSource: 'nbrk' | 'fixtures';
    dataDir: string; dbPath: string; uploadsDir: string; backupsDir: string;
    logsDir: string; binDir: string; lockPath: string;
  }
  function loadConfig(env?: Record<string, string | undefined>): Config;
  ```

- [ ] **Step 1: Инициализировать проект и поставить зависимости**

```bash
npm init -y
npm pkg set type=module private=true engines.node=">=24"
npm install fastify @fastify/cookie @fastify/helmet @fastify/rate-limit @fastify/static zod drizzle-orm better-sqlite3 @node-rs/argon2 pino pino-pretty pino-roll croner adm-zip tsx @ngrok/ngrok react react-dom react-router @tanstack/react-query
npm install -D typescript vite @vitejs/plugin-react tailwindcss @tailwindcss/vite vitest @playwright/test drizzle-kit concurrently @types/node @types/better-sqlite3 @types/adm-zip @types/react @types/react-dom
```

Задать скрипты в `package.json`:

```bash
npm pkg set scripts.dev="concurrently -k -n server,client \"tsx watch src/server/index.ts\" \"vite\""
npm pkg set scripts.build:client="vite build"
npm pkg set scripts.start="tsx scripts/run.ts"
npm pkg set scripts.setup="tsx scripts/setup.ts"
npm pkg set scripts.user:add="tsx scripts/user-add.ts"
npm pkg set scripts.backup="tsx scripts/backup.ts"
npm pkg set scripts.restore="tsx scripts/restore.ts"
npm pkg set scripts.db:generate="drizzle-kit generate"
npm pkg set scripts.test="vitest run"
npm pkg set scripts.test:e2e="playwright test"
npm pkg set scripts.typecheck="tsc --noEmit"
```

- [ ] **Step 2: tsconfig и vitest**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "types": ["node"]
  },
  "include": ["src", "scripts", "tests", "e2e", "*.ts"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    testTimeout: 15000,
  },
});
```

- [ ] **Step 3: Написать падающий тест конфигурации**

`tests/server/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { loadConfig } from '../../src/server/config';

const base = { SESSION_SECRET: 'x'.repeat(32) };

describe('loadConfig', () => {
  it('применяет значения по умолчанию', () => {
    const c = loadConfig(base);
    expect(c.appName).toBe('Учёт');
    expect(c.timezone).toBe('Asia/Almaty');
    expect(c.host).toBe('127.0.0.1');
    expect(c.port).toBe(3000);
    expect(c.publicUrl).toBe('http://localhost:3000');
    expect(c.deployMode).toBe('local');
    expect(c.backupKeep).toBe(14);
    expect(c.backupCopyDir).toBeNull();
    expect(c.dbPath).toBe(path.resolve('data', 'app.db'));
    expect(c.lockPath).toBe(path.resolve('data', 'app.lock'));
  });

  it('собирает список разрешённых origin без дублей и хвостовых слэшей', () => {
    const c = loadConfig({
      ...base,
      PORT: '3100',
      PUBLIC_URL: 'https://fin.example.kz/',
      EXTRA_ORIGINS: 'http://192.168.1.10:3100, http://localhost:3100',
    });
    expect(c.allowedOrigins).toEqual([
      'https://fin.example.kz',
      'http://localhost:3100',
      'http://127.0.0.1:3100',
      'http://192.168.1.10:3100',
    ]);
  });

  it('отклоняет короткий SESSION_SECRET', () => {
    expect(() => loadConfig({ SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
  });

  it('требует токен в режиме cloudflare и домен в режиме ngrok', () => {
    expect(() => loadConfig({ ...base, DEPLOY_MODE: 'cloudflare' })).toThrow(/CF_TUNNEL_TOKEN/);
    expect(() => loadConfig({ ...base, DEPLOY_MODE: 'ngrok', NGROK_AUTHTOKEN: 't' })).toThrow(/NGROK_DOMAIN/);
  });

  it('учитывает DATA_DIR для всех путей данных', () => {
    const c = loadConfig({ ...base, DATA_DIR: 'tmp/x' });
    expect(c.dbPath).toBe(path.resolve('tmp/x', 'app.db'));
    expect(c.uploadsDir).toBe(path.resolve('tmp/x', 'uploads'));
    expect(c.backupsDir).toBe(path.resolve('tmp/x', 'backups'));
    expect(c.binDir).toBe(path.resolve('tmp/x', 'bin'));
  });
});
```

- [ ] **Step 4: Убедиться, что тест падает**

Run: `npx vitest run tests/server/config.test.ts`
Expected: FAIL — `Cannot find module '../../src/server/config'`.

- [ ] **Step 5: Реализовать `src/server/config.ts`**

```ts
import path from 'node:path';
import { z } from 'zod';

export type DeployMode = 'local' | 'cloudflare' | 'ngrok' | 'vps';

export interface Config {
  appName: string;
  timezone: string;
  host: string;
  port: number;
  publicUrl: string;
  deployMode: DeployMode;
  cfTunnelToken: string | null;
  cloudflaredPath: string | null;
  ngrokAuthtoken: string | null;
  ngrokDomain: string | null;
  sessionSecret: string;
  allowedOrigins: string[];
  backupKeep: number;
  backupCopyDir: string | null;
  ratesSource: 'nbrk' | 'fixtures';
  dataDir: string;
  dbPath: string;
  uploadsDir: string;
  backupsDir: string;
  logsDir: string;
  binDir: string;
  lockPath: string;
}

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : null));

const envSchema = z.object({
  APP_NAME: z.string().default('Учёт'),
  APP_TIMEZONE: z.string().default('Asia/Almaty'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PUBLIC_URL: optional,
  DEPLOY_MODE: z.enum(['local', 'cloudflare', 'ngrok', 'vps']).default('local'),
  CF_TUNNEL_TOKEN: optional,
  CLOUDFLARED_PATH: optional,
  NGROK_AUTHTOKEN: optional,
  NGROK_DOMAIN: optional,
  SESSION_SECRET: z.string({ message: 'SESSION_SECRET обязателен' }).min(32, 'SESSION_SECRET должен быть не короче 32 символов'),
  EXTRA_ORIGINS: z.string().default(''),
  BACKUP_KEEP: z.coerce.number().int().min(1).default(14),
  BACKUP_COPY_DIR: optional,
  RATES_SOURCE: z.enum(['nbrk', 'fixtures']).default('nbrk'),
  DATA_DIR: z.string().default('data'),
});

function toOrigin(url: string): string {
  return new URL(url).origin;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Ошибка конфигурации .env — ${msg}`);
  }
  const e = parsed.data;

  if (e.DEPLOY_MODE === 'cloudflare' && !e.CF_TUNNEL_TOKEN) {
    throw new Error('Ошибка конфигурации .env — CF_TUNNEL_TOKEN обязателен в режиме cloudflare');
  }
  if (e.DEPLOY_MODE === 'ngrok' && (!e.NGROK_AUTHTOKEN || !e.NGROK_DOMAIN)) {
    throw new Error('Ошибка конфигурации .env — NGROK_AUTHTOKEN и NGROK_DOMAIN обязательны в режиме ngrok');
  }

  const publicUrl = (e.PUBLIC_URL ?? `http://localhost:${e.PORT}`).replace(/\/+$/, '');
  const origins = [
    toOrigin(publicUrl),
    `http://localhost:${e.PORT}`,
    `http://127.0.0.1:${e.PORT}`,
    ...e.EXTRA_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean).map(toOrigin),
  ];
  const dataDir = path.resolve(e.DATA_DIR);

  return {
    appName: e.APP_NAME,
    timezone: e.APP_TIMEZONE,
    host: e.HOST,
    port: e.PORT,
    publicUrl,
    deployMode: e.DEPLOY_MODE,
    cfTunnelToken: e.CF_TUNNEL_TOKEN,
    cloudflaredPath: e.CLOUDFLARED_PATH,
    ngrokAuthtoken: e.NGROK_AUTHTOKEN,
    ngrokDomain: e.NGROK_DOMAIN,
    sessionSecret: e.SESSION_SECRET,
    allowedOrigins: [...new Set(origins)],
    backupKeep: e.BACKUP_KEEP,
    backupCopyDir: e.BACKUP_COPY_DIR,
    ratesSource: e.RATES_SOURCE,
    dataDir,
    dbPath: path.join(dataDir, 'app.db'),
    uploadsDir: path.join(dataDir, 'uploads'),
    backupsDir: path.join(dataDir, 'backups'),
    logsDir: path.join(dataDir, 'logs'),
    binDir: path.join(dataDir, 'bin'),
    lockPath: path.join(dataDir, 'app.lock'),
  };
}
```

- [ ] **Step 6: Добавить `.env.example`**

```dotenv
# Название продукта в интерфейсе и PWA
APP_NAME=Учёт
APP_TIMEZONE=Asia/Almaty
HOST=127.0.0.1
PORT=3000
# Внешний адрес (https://fin.example.kz). Пусто = http://localhost:PORT
PUBLIC_URL=
# local | cloudflare | ngrok | vps
DEPLOY_MODE=local
CF_TUNNEL_TOKEN=
CLOUDFLARED_PATH=
NGROK_AUTHTOKEN=
NGROK_DOMAIN=
# Генерируется npm run setup
SESSION_SECRET=
# Доп. разрешённые origin через запятую (например http://192.168.1.10:3000 при HOST=0.0.0.0)
EXTRA_ORIGINS=
BACKUP_KEEP=14
# Папка для копий бэкапов (OneDrive, Google Drive, сетевая шара)
BACKUP_COPY_DIR=
RATES_SOURCE=nbrk
```

- [ ] **Step 7: Убедиться, что тесты и типы проходят**

Run: `npx vitest run tests/server/config.test.ts && npm run typecheck`
Expected: PASS (5 тестов), `tsc` без ошибок.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .env.example src/server/config.ts tests/server/config.test.ts
git commit -m "feat: скелет проекта и загрузка конфигурации"
```

---

### Task 3: База данных: схема, миграции, `ulower`, справочник валют

**Files:**
- Create: `drizzle.config.ts`, `src/server/db/schema.ts`, `src/server/db/client.ts`, `src/server/db/migrate.ts`, `src/server/db/seed.ts`, `src/shared/currencies.ts`
- Create (генерируется): `src/server/db/migrations/*`
- Create: `tests/helpers/test-db.ts`
- Test: `tests/server/db.test.ts`, `tests/shared/currencies.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces:
  ```ts
  // client.ts
  type Sqlite = import('better-sqlite3').Database;
  type Db = BetterSQLite3Database<typeof schema>;
  function openDb(filePath: string): { sqlite: Sqlite; db: Db };
  function ulower(value: unknown): string | null;
  // migrate.ts
  const MIGRATIONS_DIR: string;
  function runMigrations(db: Db): void;
  function codeMigrationsCount(): number;
  function appliedMigrationsCount(sqlite: Sqlite): number;
  // seed.ts
  function seedCurrencies(db: Db): void;
  // shared/currencies.ts
  interface CurrencyDef { code: string; name: string; symbol: string; minorUnits: number }
  const CURRENCIES: readonly CurrencyDef[];
  function getCurrency(code: string): CurrencyDef; // бросает Error для неизвестного кода
  // schema.ts — таблицы users, sessions, auditLog, currencies
  // tests/helpers/test-db.ts
  function createTestDb(): { sqlite: Sqlite; db: Db; dir: string; cleanup(): void };
  ```

- [ ] **Step 1: Написать падающие тесты**

`tests/shared/currencies.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CURRENCIES, getCurrency } from '../../src/shared/currencies';

describe('справочник валют', () => {
  it('содержит KZT с 2 знаками и символом ₸', () => {
    expect(getCurrency('KZT')).toEqual({ code: 'KZT', name: 'Казахстанский тенге', symbol: '₸', minorUnits: 2 });
  });
  it('знает валюты с 0 и 3 знаками', () => {
    expect(getCurrency('JPY').minorUnits).toBe(0);
    expect(getCurrency('KWD').minorUnits).toBe(3);
  });
  it('коды уникальны и в верхнем регистре', () => {
    const codes = CURRENCIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((c) => /^[A-Z]{3}$/.test(c))).toBe(true);
  });
  it('бросает ошибку на неизвестный код', () => {
    expect(() => getCurrency('XXX')).toThrow(/XXX/);
  });
});
```

`tests/helpers/test-db.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../../src/server/db/client';
import { runMigrations } from '../../src/server/db/migrate';

export function createTestDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-test-'));
  const { sqlite, db } = openDb(path.join(dir, 'app.db'));
  runMigrations(db);
  return {
    sqlite,
    db,
    dir,
    cleanup() {
      sqlite.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
```

`tests/server/db.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { ulower } from '../../src/server/db/client';
import { appliedMigrationsCount, codeMigrationsCount } from '../../src/server/db/migrate';
import { seedCurrencies } from '../../src/server/db/seed';
import { currencies } from '../../src/server/db/schema';

let t: ReturnType<typeof createTestDb>;
afterEach(() => t?.cleanup());

describe('db', () => {
  it('включает WAL и внешние ключи', () => {
    t = createTestDb();
    expect(t.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(t.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('применяет все миграции кода', () => {
    t = createTestDb();
    expect(codeMigrationsCount()).toBeGreaterThan(0);
    expect(appliedMigrationsCount(t.sqlite)).toBe(codeMigrationsCount());
  });

  it('ulower приводит кириллицу к нижнему регистру и ё→е', () => {
    expect(ulower('АРЕНДА Ёлки')).toBe('аренда елки');
    expect(ulower(null)).toBeNull();
    t = createTestDb();
    const row = t.sqlite.prepare("SELECT ulower('ЗАКУП Бара') AS v").get() as { v: string };
    expect(row.v).toBe('закуп бара');
  });

  it('seedCurrencies идемпотентен', () => {
    t = createTestDb();
    seedCurrencies(t.db);
    seedCurrencies(t.db);
    const rows = t.db.select().from(currencies).all();
    expect(rows.find((r) => r.code === 'KZT')?.minorUnits).toBe(2);
    expect(new Set(rows.map((r) => r.code)).size).toBe(rows.length);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run tests/shared/currencies.test.ts tests/server/db.test.ts`
Expected: FAIL — модули не найдены.

- [ ] **Step 3: Реализовать справочник валют `src/shared/currencies.ts`**

Список охватывает валюты, которые котирует Нацбанк РК, и распространённые валюты расчётов.

```ts
export interface CurrencyDef {
  code: string;
  name: string;
  symbol: string;
  minorUnits: number;
}

export const CURRENCIES: readonly CurrencyDef[] = [
  { code: 'KZT', name: 'Казахстанский тенге', symbol: '₸', minorUnits: 2 },
  { code: 'USD', name: 'Доллар США', symbol: '$', minorUnits: 2 },
  { code: 'EUR', name: 'Евро', symbol: '€', minorUnits: 2 },
  { code: 'RUB', name: 'Российский рубль', symbol: '₽', minorUnits: 2 },
  { code: 'CNY', name: 'Китайский юань', symbol: '¥', minorUnits: 2 },
  { code: 'GBP', name: 'Фунт стерлингов', symbol: '£', minorUnits: 2 },
  { code: 'KGS', name: 'Киргизский сом', symbol: 'сом', minorUnits: 2 },
  { code: 'UZS', name: 'Узбекский сум', symbol: 'сўм', minorUnits: 2 },
  { code: 'TRY', name: 'Турецкая лира', symbol: '₺', minorUnits: 2 },
  { code: 'AED', name: 'Дирхам ОАЭ', symbol: 'AED', minorUnits: 2 },
  { code: 'AUD', name: 'Австралийский доллар', symbol: 'A$', minorUnits: 2 },
  { code: 'AZN', name: 'Азербайджанский манат', symbol: '₼', minorUnits: 2 },
  { code: 'AMD', name: 'Армянский драм', symbol: '֏', minorUnits: 2 },
  { code: 'BYN', name: 'Белорусский рубль', symbol: 'Br', minorUnits: 2 },
  { code: 'BRL', name: 'Бразильский реал', symbol: 'R$', minorUnits: 2 },
  { code: 'CAD', name: 'Канадский доллар', symbol: 'C$', minorUnits: 2 },
  { code: 'CHF', name: 'Швейцарский франк', symbol: 'CHF', minorUnits: 2 },
  { code: 'CZK', name: 'Чешская крона', symbol: 'Kč', minorUnits: 2 },
  { code: 'DKK', name: 'Датская крона', symbol: 'kr', minorUnits: 2 },
  { code: 'GEL', name: 'Грузинский лари', symbol: '₾', minorUnits: 2 },
  { code: 'HKD', name: 'Гонконгский доллар', symbol: 'HK$', minorUnits: 2 },
  { code: 'HUF', name: 'Венгерский форинт', symbol: 'Ft', minorUnits: 2 },
  { code: 'INR', name: 'Индийская рупия', symbol: '₹', minorUnits: 2 },
  { code: 'IRR', name: 'Иранский риал', symbol: '﷼', minorUnits: 2 },
  { code: 'JPY', name: 'Японская иена', symbol: '¥', minorUnits: 0 },
  { code: 'KRW', name: 'Южнокорейская вона', symbol: '₩', minorUnits: 0 },
  { code: 'KWD', name: 'Кувейтский динар', symbol: 'KD', minorUnits: 3 },
  { code: 'MDL', name: 'Молдавский лей', symbol: 'L', minorUnits: 2 },
  { code: 'MXN', name: 'Мексиканское песо', symbol: 'MX$', minorUnits: 2 },
  { code: 'MYR', name: 'Малайзийский ринггит', symbol: 'RM', minorUnits: 2 },
  { code: 'NOK', name: 'Норвежская крона', symbol: 'kr', minorUnits: 2 },
  { code: 'PLN', name: 'Польский злотый', symbol: 'zł', minorUnits: 2 },
  { code: 'SAR', name: 'Саудовский риял', symbol: 'SAR', minorUnits: 2 },
  { code: 'SEK', name: 'Шведская крона', symbol: 'kr', minorUnits: 2 },
  { code: 'SGD', name: 'Сингапурский доллар', symbol: 'S$', minorUnits: 2 },
  { code: 'TJS', name: 'Таджикский сомони', symbol: 'SM', minorUnits: 2 },
  { code: 'THB', name: 'Тайский бат', symbol: '฿', minorUnits: 2 },
  { code: 'TMT', name: 'Туркменский манат', symbol: 'm', minorUnits: 2 },
  { code: 'UAH', name: 'Украинская гривна', symbol: '₴', minorUnits: 2 },
  { code: 'ZAR', name: 'Южноафриканский рэнд', symbol: 'R', minorUnits: 2 },
];

const byCode = new Map(CURRENCIES.map((c) => [c.code, c]));

export function getCurrency(code: string): CurrencyDef {
  const c = byCode.get(code);
  if (!c) throw new Error(`Неизвестная валюта: ${code}`);
  return c;
}
```

- [ ] **Step 4: Реализовать схему `src/server/db/schema.ts`**

```ts
import { integer, sqliteTable, text, index } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  login: text('login').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: text('created_at').notNull(),
  disabledAt: text('disabled_at'),
});

export const sessions = sqliteTable(
  'sessions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tokenHash: text('token_hash').notNull().unique(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    remember: integer('remember', { mode: 'boolean' }).notNull(),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    companyId: integer('company_id'),
    userId: integer('user_id'),
    entity: text('entity').notNull(),
    entityId: integer('entity_id'),
    action: text('action').notNull(),
    diff: text('diff'),
    at: text('at').notNull(),
  },
  (t) => [index('audit_company_idx').on(t.companyId, t.id)],
);

export const currencies = sqliteTable('currencies', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  symbol: text('symbol').notNull(),
  minorUnits: integer('minor_units').notNull(),
});
```

`audit_log.company_id` пока без внешнего ключа: таблица `companies` появится в плане шага 2. Связь проверяется на уровне сервиса.

- [ ] **Step 5: Реализовать `src/server/db/client.ts`**

```ts
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export type Sqlite = Database.Database;
export type Db = BetterSQLite3Database<typeof schema>;

export function ulower(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value).toLocaleLowerCase('ru').replaceAll('ё', 'е');
}

export function openDb(filePath: string): { sqlite: Sqlite; db: Db } {
  const sqlite = new Database(filePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.function('ulower', { deterministic: true }, (v: unknown) => ulower(v));
  const db = drizzle({ client: sqlite, schema });
  return { sqlite, db };
}
```

- [ ] **Step 6: Реализовать `src/server/db/migrate.ts` и `drizzle.config.ts`**

`drizzle.config.ts`:

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/server/db/schema.ts',
  out: './src/server/db/migrations',
});
```

`src/server/db/migrate.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Db, Sqlite } from './client';

export const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url));

export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}

export function codeMigrationsCount(): number {
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8')) as {
    entries: unknown[];
  };
  return journal.entries.length;
}

export function appliedMigrationsCount(sqlite: Sqlite): number {
  const table = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get();
  if (!table) return 0;
  return (sqlite.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get() as { n: number }).n;
}
```

- [ ] **Step 7: Реализовать `src/server/db/seed.ts`**

```ts
import { CURRENCIES } from '../../shared/currencies';
import type { Db } from './client';
import { currencies } from './schema';

export function seedCurrencies(db: Db): void {
  db.transaction((tx) => {
    for (const c of CURRENCIES) {
      tx.insert(currencies)
        .values(c)
        .onConflictDoUpdate({ target: currencies.code, set: { name: c.name, symbol: c.symbol, minorUnits: c.minorUnits } })
        .run();
    }
  });
}
```

- [ ] **Step 8: Сгенерировать первую миграцию**

Run: `npm run db:generate`
Expected: появились `src/server/db/migrations/0000_*.sql` и `src/server/db/migrations/meta/_journal.json`; в SQL есть `CREATE TABLE users`, `sessions`, `audit_log`, `currencies`.

- [ ] **Step 9: Убедиться, что тесты проходят**

Run: `npx vitest run tests/shared/currencies.test.ts tests/server/db.test.ts && npm run typecheck`
Expected: PASS (8 тестов).

- [ ] **Step 10: Commit**

```bash
git add drizzle.config.ts src/shared/currencies.ts src/server/db tests/helpers/test-db.ts tests/shared/currencies.test.ts tests/server/db.test.ts
git commit -m "feat: БД SQLite, схема, миграции, ulower и справочник валют"
```

---

### Task 4: Фабрика приложения, ошибки, health и meta

**Files:**
- Create: `src/server/errors.ts`, `src/server/app.ts`
- Create: `tests/helpers/test-app.ts`
- Test: `tests/server/errors-and-health.test.ts`

**Interfaces:**
- Consumes: `Config`, `loadConfig` (задача 2); `openDb`, `Db`, `Sqlite`, `runMigrations` (задача 3); `createTestDb` (задача 3).
- Produces:
  ```ts
  // errors.ts
  class AppError extends Error { status: number; code: string; fields?: Record<string, string> }
  function registerErrorHandler(app: FastifyInstance): void;
  // app.ts
  interface AppDeps { config: Config; db: Db; sqlite: Sqlite; logger?: FastifyServerOptions['logger']; now?: () => Date }
  async function buildApp(deps: AppDeps): Promise<FastifyInstance>;
  // tests/helpers/test-app.ts
  function testConfig(dir: string, overrides?: Record<string, string>): Config;
  async function createTestApp(overrides?: Record<string, string>): Promise<TestApp>;
  interface TestApp { app: FastifyInstance; db: Db; sqlite: Sqlite; config: Config; dir: string; cleanup(): Promise<void> }
  const ORIGIN_HEADERS: { origin: string; 'x-requested-with': 'fetch' }; // origin = http://localhost:3000
  ```
  Задачи 5–9 расширяют `buildApp` (сервисы, хуки, маршруты), сохраняя сигнатуру `AppDeps`.

- [ ] **Step 1: Написать хелпер и падающий тест**

`tests/helpers/test-app.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app';
import { loadConfig, type Config } from '../../src/server/config';
import type { Db, Sqlite } from '../../src/server/db/client';
import { createTestDb } from './test-db';

export const ORIGIN_HEADERS = { origin: 'http://localhost:3000', 'x-requested-with': 'fetch' } as const;

export function testConfig(dir: string, overrides: Record<string, string> = {}): Config {
  return loadConfig({ SESSION_SECRET: 's'.repeat(40), DATA_DIR: dir, RATES_SOURCE: 'fixtures', ...overrides });
}

export interface TestApp {
  app: FastifyInstance;
  db: Db;
  sqlite: Sqlite;
  config: Config;
  dir: string;
  cleanup(): Promise<void>;
}

// extraRoutes регистрирует тестовые маршруты до ready(): после ready() добавлять маршруты нельзя.
export async function createTestApp(
  overrides: Record<string, string> = {},
  extraRoutes?: (app: FastifyInstance) => void,
): Promise<TestApp> {
  const t = createTestDb();
  const config = testConfig(t.dir, overrides);
  const app = await buildApp({ config, db: t.db, sqlite: t.sqlite, logger: false, extraRoutes });
  await app.ready();
  return {
    app,
    db: t.db,
    sqlite: t.sqlite,
    config,
    dir: t.dir,
    async cleanup() {
      await app.close();
      t.cleanup();
    },
  };
}
```

`tests/server/errors-and-health.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from '../../src/server/errors';
import { createTestApp, type TestApp } from '../helpers/test-app';

let t: TestApp;
afterEach(async () => t?.cleanup());

describe('app', () => {
  it('GET /api/v1/health отвечает ok', async () => {
    t = await createTestApp();
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('GET /api/v1/meta отдаёт название продукта', async () => {
    t = await createTestApp({ APP_NAME: 'Клубный учёт' });
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/meta' });
    expect(res.json()).toEqual({ appName: 'Клубный учёт' });
  });

  it('превращает AppError, ZodError и неизвестные ошибки в единый формат', async () => {
    t = await createTestApp({}, (app) => {
      app.get('/api/v1/__test/app-error', async () => {
        throw new AppError(422, 'INVARIANT_1', 'Сумма строк не равна сумме операции', { lines: 'не сходится' });
      });
      app.get('/api/v1/__test/zod', async () => z.object({ name: z.string().min(1) }).parse({ name: '' }));
      app.get('/api/v1/__test/crash', async () => {
        throw new Error('секретная деталь');
      });
    });

    const a = await t.app.inject({ method: 'GET', url: '/api/v1/__test/app-error' });
    expect(a.statusCode).toBe(422);
    expect(a.json()).toEqual({
      error: { code: 'INVARIANT_1', message: 'Сумма строк не равна сумме операции', fields: { lines: 'не сходится' } },
    });

    const z1 = await t.app.inject({ method: 'GET', url: '/api/v1/__test/zod' });
    expect(z1.statusCode).toBe(400);
    expect(z1.json().error.code).toBe('VALIDATION');
    expect(Object.keys(z1.json().error.fields)).toEqual(['name']);

    const c = await t.app.inject({ method: 'GET', url: '/api/v1/__test/crash' });
    expect(c.statusCode).toBe(500);
    expect(c.json()).toEqual({ error: { code: 'INTERNAL', message: 'Внутренняя ошибка сервера' } });
  });

  it('неизвестный /api путь даёт 404 в формате ошибки', async () => {
    t = await createTestApp();
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run tests/server/errors-and-health.test.ts`
Expected: FAIL — `Cannot find module '../../src/server/app'`.

- [ ] **Step 3: Реализовать `src/server/errors.ts`**

```ts
import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

function zodFields(err: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ??= issue.message;
  }
  return fields;
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({
        error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) },
      });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: { code: 'VALIDATION', message: 'Проверьте заполнение полей', fields: zodFields(err) },
      });
    }
    const status = (err as FastifyError).statusCode;
    if (status === 429) {
      return reply.status(429).send({ error: { code: 'RATE_LIMITED', message: 'Слишком много запросов, повторите позже' } });
    }
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ error: { code: 'BAD_REQUEST', message: err.message } });
    }
    req.log.error({ err }, 'Необработанная ошибка');
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Внутренняя ошибка сервера' } });
  });

  app.setNotFoundHandler((req, reply) => {
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Не найдено' } });
  });
}
```

- [ ] **Step 4: Реализовать `src/server/app.ts`**

```ts
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Config } from './config';
import type { Db, Sqlite } from './db/client';
import { registerErrorHandler } from './errors';

export interface AppDeps {
  config: Config;
  db: Db;
  sqlite: Sqlite;
  logger?: FastifyServerOptions['logger'];
  now?: () => Date;
  extraRoutes?: (app: FastifyInstance) => void;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config } = deps;
  const app = Fastify({
    logger: deps.logger ?? false,
    trustProxy: 'loopback',
    bodyLimit: 1024 * 1024,
  });

  registerErrorHandler(app);

  app.get('/api/v1/health', async () => ({ ok: true }));
  app.get('/api/v1/meta', async () => ({ appName: config.appName }));

  deps.extraRoutes?.(app);
  return app;
}
```

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `npx vitest run tests/server/errors-and-health.test.ts && npm run typecheck`
Expected: PASS (4 теста).

- [ ] **Step 6: Commit**

```bash
git add src/server/errors.ts src/server/app.ts tests/helpers/test-app.ts tests/server/errors-and-health.test.ts
git commit -m "feat: фабрика приложения, единый формат ошибок, health и meta"
```

---

### Task 5: История действий (audit)

**Files:**
- Create: `src/server/modules/audit/service.ts`
- Test: `tests/server/audit.test.ts`

**Interfaces:**
- Consumes: `Db` (задача 3), таблица `auditLog`.
- Produces:
  ```ts
  type AuditAction = 'create' | 'update' | 'delete' | 'restore' | 'archive' | 'unarchive'
    | 'reorder' | 'login' | 'logout' | 'password_change';
  interface AuditEntry { companyId?: number | null; userId?: number | null; entity: string;
    entityId?: number | null; action: AuditAction; diff?: Record<string, unknown> | null }
  interface AuditRow { id: number; companyId: number | null; userId: number | null; entity: string;
    entityId: number | null; action: AuditAction; diff: Record<string, unknown> | null; at: string }
  interface AuditService { record(e: AuditEntry): void;
    list(q: { companyId: number | null; limit?: number; beforeId?: number }): AuditRow[] }
  function createAuditService(db: Db, now?: () => Date): AuditService;
  function sanitizeDiff(value: unknown): unknown;
  ```

- [ ] **Step 1: Написать падающий тест**

`tests/server/audit.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { createAuditService, sanitizeDiff } from '../../src/server/modules/audit/service';
import { createTestDb } from '../helpers/test-db';

let t: ReturnType<typeof createTestDb>;
afterEach(() => t?.cleanup());

describe('audit', () => {
  it('sanitizeDiff вырезает пароли, хэши, токены и секреты на любой глубине', () => {
    expect(
      sanitizeDiff({
        name: 'Админ',
        password: 'p',
        passwordHash: 'h',
        nested: { tokenHash: 't', apiSecret: 's', ok: 1 },
        list: [{ sessionToken: 'x', v: 2 }],
      }),
    ).toEqual({ name: 'Админ', nested: { ok: 1 }, list: [{ v: 2 }] });
  });

  it('записывает и отдаёт события компании от новых к старым', () => {
    t = createTestDb();
    let n = 0;
    const audit = createAuditService(t.db, () => new Date(Date.UTC(2026, 9, 5, 10, 0, n++)));
    audit.record({ companyId: 1, userId: 7, entity: 'account', entityId: 3, action: 'create', diff: { name: 'Касса' } });
    audit.record({ companyId: 1, userId: 7, entity: 'account', entityId: 3, action: 'archive' });
    audit.record({ companyId: 2, userId: 7, entity: 'account', entityId: 9, action: 'create' });
    audit.record({ companyId: null, userId: 7, entity: 'user', entityId: 7, action: 'login' });

    const rows = audit.list({ companyId: 1 });
    expect(rows.map((r) => r.action)).toEqual(['archive', 'create']);
    expect(rows[1]!.diff).toEqual({ name: 'Касса' });
    expect(rows[1]!.at).toBe('2026-10-05T10:00:00.000Z');

    expect(audit.list({ companyId: null }).map((r) => r.entity)).toEqual(['user']);
    expect(audit.list({ companyId: 1, beforeId: rows[0]!.id }).map((r) => r.action)).toEqual(['create']);
  });

  it('не сохраняет секретные поля в diff', () => {
    t = createTestDb();
    const audit = createAuditService(t.db);
    audit.record({ userId: 1, entity: 'user', entityId: 1, action: 'password_change', diff: { passwordHash: 'h' } });
    expect(audit.list({ companyId: null })[0]!.diff).toEqual({});
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run tests/server/audit.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать `src/server/modules/audit/service.ts`**

```ts
import { and, desc, eq, isNull, lt, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { auditLog } from '../../db/schema';

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'restore'
  | 'archive'
  | 'unarchive'
  | 'reorder'
  | 'login'
  | 'logout'
  | 'password_change';

export interface AuditEntry {
  companyId?: number | null;
  userId?: number | null;
  entity: string;
  entityId?: number | null;
  action: AuditAction;
  diff?: Record<string, unknown> | null;
}

export interface AuditRow {
  id: number;
  companyId: number | null;
  userId: number | null;
  entity: string;
  entityId: number | null;
  action: AuditAction;
  diff: Record<string, unknown> | null;
  at: string;
}

export interface AuditService {
  record(entry: AuditEntry): void;
  list(q: { companyId: number | null; limit?: number; beforeId?: number }): AuditRow[];
}

const SECRET_KEY = /password|hash|token|secret/i;

export function sanitizeDiff(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeDiff);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k)) continue;
      out[k] = sanitizeDiff(v);
    }
    return out;
  }
  return value;
}

export function createAuditService(db: Db, now: () => Date = () => new Date()): AuditService {
  return {
    record(entry) {
      db.insert(auditLog)
        .values({
          companyId: entry.companyId ?? null,
          userId: entry.userId ?? null,
          entity: entry.entity,
          entityId: entry.entityId ?? null,
          action: entry.action,
          diff: entry.diff ? JSON.stringify(sanitizeDiff(entry.diff)) : null,
          at: now().toISOString(),
        })
        .run();
    },
    list({ companyId, limit = 50, beforeId }) {
      const conds: SQL[] = [companyId === null ? isNull(auditLog.companyId) : eq(auditLog.companyId, companyId)];
      if (beforeId !== undefined) conds.push(lt(auditLog.id, beforeId));
      return db
        .select()
        .from(auditLog)
        .where(and(...conds))
        .orderBy(desc(auditLog.id))
        .limit(Math.min(limit, 200))
        .all()
        .map((r) => ({
          ...r,
          action: r.action as AuditAction,
          diff: r.diff ? (JSON.parse(r.diff) as Record<string, unknown>) : null,
        }));
    },
  };
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run tests/server/audit.test.ts && npm run typecheck`
Expected: PASS (3 теста).

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/audit tests/server/audit.test.ts
git commit -m "feat: сервис истории действий с очисткой секретов"
```

---

### Task 6: Пользователи, пароли и `user:add`

**Files:**
- Create: `src/server/modules/users/passwords.ts`, `src/server/modules/users/service.ts`
- Create: `scripts/lib/prompt.ts`, `scripts/user-add.ts`
- Test: `tests/server/users.test.ts`

**Interfaces:**
- Consumes: `Db` (задача 3), `AppError` (задача 4), `AuditService` (задача 5).
- Produces:
  ```ts
  // passwords.ts
  async function hashPassword(plain: string): Promise<string>;
  async function verifyPassword(hash: string, plain: string): Promise<boolean>;
  // service.ts
  interface AuthUser { id: number; login: string; name: string }
  function normalizeLogin(login: string): string;
  interface UsersService {
    create(input: { login: string; name: string; password: string }, actorId: number | null): Promise<AuthUser>;
    verifyCredentials(login: string, password: string): Promise<AuthUser | null>;
    getActive(id: number): AuthUser | null;
    count(): number;
  }
  function createUsersService(db: Db, audit: AuditService, now?: () => Date): UsersService;
  // scripts/lib/prompt.ts
  function createPrompt(): { ask(q: string, def?: string): Promise<string>; askSecret(q: string): Promise<string>; close(): void };
  ```

- [ ] **Step 1: Написать падающий тест**

`tests/server/users.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '../../src/server/errors';
import { createAuditService } from '../../src/server/modules/audit/service';
import { createUsersService, normalizeLogin } from '../../src/server/modules/users/service';
import { users } from '../../src/server/db/schema';
import { createTestDb } from '../helpers/test-db';

let t: ReturnType<typeof createTestDb>;
afterEach(() => t?.cleanup());

function setup() {
  t = createTestDb();
  const audit = createAuditService(t.db);
  return { audit, svc: createUsersService(t.db, audit) };
}

describe('users', () => {
  it('normalizeLogin обрезает пробелы и приводит к нижнему регистру', () => {
    expect(normalizeLogin('  Admin ')).toBe('admin');
  });

  it('создаёт пользователя, хранит argon2id-хэш и пишет историю', async () => {
    const { svc, audit } = setup();
    const u = await svc.create({ login: ' Admin ', name: 'Владелец', password: 'correct-horse-1' }, null);
    expect(u).toEqual({ id: u.id, login: 'admin', name: 'Владелец' });
    const row = t.db.select().from(users).all()[0]!;
    expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(audit.list({ companyId: null })[0]).toMatchObject({ entity: 'user', action: 'create', diff: { login: 'admin', name: 'Владелец' } });
  });

  it('вход нечувствителен к регистру и пробелам логина (Review Focus 1)', async () => {
    const { svc } = setup();
    await svc.create({ login: 'admin', name: 'В', password: 'correct-horse-1' }, null);
    expect(await svc.verifyCredentials(' ADMIN ', 'correct-horse-1')).toMatchObject({ login: 'admin' });
    expect(await svc.verifyCredentials('admin', 'wrong-password')).toBeNull();
    expect(await svc.verifyCredentials('nobody', 'correct-horse-1')).toBeNull();
  });

  it('отклоняет короткий пароль, плохой логин и дубликат', async () => {
    const { svc } = setup();
    await expect(svc.create({ login: 'admin', name: 'В', password: 'short' }, null)).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION',
      fields: { password: 'Пароль должен быть не короче 10 символов' },
    });
    await expect(svc.create({ login: 'а б', name: 'В', password: 'correct-horse-1' }, null)).rejects.toBeInstanceOf(AppError);
    await svc.create({ login: 'admin', name: 'В', password: 'correct-horse-1' }, null);
    await expect(svc.create({ login: 'ADMIN', name: 'Д', password: 'correct-horse-1' }, null)).rejects.toMatchObject({
      fields: { login: 'Логин уже занят' },
    });
  });

  it('отключённый пользователь не входит и не считается активным', async () => {
    const { svc } = setup();
    const u = await svc.create({ login: 'admin', name: 'В', password: 'correct-horse-1' }, null);
    t.sqlite.prepare('UPDATE users SET disabled_at = ? WHERE id = ?').run(new Date().toISOString(), u.id);
    expect(await svc.verifyCredentials('admin', 'correct-horse-1')).toBeNull();
    expect(svc.getActive(u.id)).toBeNull();
    expect(svc.count()).toBe(1);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run tests/server/users.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать `src/server/modules/users/passwords.ts`**

```ts
import { Algorithm, hash, verify } from '@node-rs/argon2';

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, { algorithm: Algorithm.Argon2id });
}

export async function verifyPassword(passwordHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(passwordHash, plain);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Реализовать `src/server/modules/users/service.ts`**

```ts
import { count, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { users } from '../../db/schema';
import { AppError } from '../../errors';
import type { AuditService } from '../audit/service';
import { hashPassword, verifyPassword } from './passwords';

export interface AuthUser {
  id: number;
  login: string;
  name: string;
}

export interface UsersService {
  create(input: { login: string; name: string; password: string }, actorId: number | null): Promise<AuthUser>;
  verifyCredentials(login: string, password: string): Promise<AuthUser | null>;
  getActive(id: number): AuthUser | null;
  count(): number;
}

const LOGIN_RE = /^[a-z0-9._-]{3,32}$/;
export const MIN_PASSWORD = 10;

export function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

export function createUsersService(db: Db, audit: AuditService, now: () => Date = () => new Date()): UsersService {
  let dummyHash: Promise<string> | null = null;
  const getDummy = () => (dummyHash ??= hashPassword('dummy-password-for-timing'));

  return {
    async create(input, actorId) {
      const login = normalizeLogin(input.login);
      const name = input.name.trim();
      const fields: Record<string, string> = {};
      if (!LOGIN_RE.test(login)) fields.login = 'Логин: 3–32 символа, латиница, цифры, точка, дефис, подчёркивание';
      if (name.length < 1 || name.length > 100) fields.name = 'Имя: от 1 до 100 символов';
      if (input.password.length < MIN_PASSWORD) fields.password = `Пароль должен быть не короче ${MIN_PASSWORD} символов`;
      if (Object.keys(fields).length) throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', fields);

      const exists = db.select({ id: users.id }).from(users).where(eq(users.login, login)).get();
      if (exists) throw new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', { login: 'Логин уже занят' });

      const passwordHash = await hashPassword(input.password);
      const row = db
        .insert(users)
        .values({ login, name, passwordHash, createdAt: now().toISOString() })
        .returning({ id: users.id })
        .get();
      audit.record({ userId: actorId, entity: 'user', entityId: row.id, action: 'create', diff: { login, name } });
      return { id: row.id, login, name };
    },

    async verifyCredentials(login, password) {
      const row = db.select().from(users).where(eq(users.login, normalizeLogin(login))).get();
      if (!row) {
        await verifyPassword(await getDummy(), password);
        return null;
      }
      const ok = await verifyPassword(row.passwordHash, password);
      if (!ok || row.disabledAt) return null;
      return { id: row.id, login: row.login, name: row.name };
    },

    getActive(id) {
      const row = db.select().from(users).where(eq(users.id, id)).get();
      if (!row || row.disabledAt) return null;
      return { id: row.id, login: row.login, name: row.name };
    },

    count() {
      return db.select({ n: count() }).from(users).get()?.n ?? 0;
    },
  };
}
```

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `npx vitest run tests/server/users.test.ts && npm run typecheck`
Expected: PASS (5 тестов).

- [ ] **Step 6: Реализовать ввод в терминале и `user:add`**

`scripts/lib/prompt.ts`:

```ts
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

export function createPrompt() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  return {
    async ask(question: string, def?: string): Promise<string> {
      const answer = (await rl.question(def ? `${question} [${def}]: ` : `${question}: `)).trim();
      return answer || def || '';
    },
    async askSecret(question: string): Promise<string> {
      const out = stdout as NodeJS.WriteStream & { _origWrite?: typeof stdout.write };
      const orig = out.write.bind(out);
      let muted = false;
      out.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
        if (muted && typeof chunk === 'string' && chunk !== '\n' && chunk !== '\r\n') return true;
        return orig(chunk as string, ...(rest as []));
      }) as typeof stdout.write;
      const p = rl.question(`${question}: `);
      muted = true;
      const answer = await p;
      muted = false;
      out.write = orig;
      orig('\n');
      return answer;
    },
    close() {
      rl.close();
    },
  };
}
```

`scripts/user-add.ts`:

```ts
import fs from 'node:fs';
import { loadConfig } from '../src/server/config';
import { openDb } from '../src/server/db/client';
import { runMigrations } from '../src/server/db/migrate';
import { AppError } from '../src/server/errors';
import { createAuditService } from '../src/server/modules/audit/service';
import { createUsersService } from '../src/server/modules/users/service';
import { createPrompt } from './lib/prompt';

if (fs.existsSync('.env')) process.loadEnvFile('.env');
const config = loadConfig();
fs.mkdirSync(config.dataDir, { recursive: true });
const { sqlite, db } = openDb(config.dbPath);
runMigrations(db);
const users = createUsersService(db, createAuditService(db));
const prompt = createPrompt();

try {
  const login = await prompt.ask('Логин');
  const name = await prompt.ask('Имя', login);
  const password = await prompt.askSecret('Пароль (не короче 10 символов)');
  const again = await prompt.askSecret('Повторите пароль');
  if (password !== again) throw new Error('Пароли не совпадают');
  const u = await users.create({ login, name, password }, null);
  console.log(`Пользователь «${u.login}» создан.`);
} catch (e) {
  if (e instanceof AppError && e.fields) console.error(Object.values(e.fields).join('\n'));
  else console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  prompt.close();
  sqlite.close();
}
```

- [ ] **Step 7: Проверить CLI вручную**

Run (PowerShell): `$env:SESSION_SECRET='x'*40; $env:DATA_DIR="$env:TEMP\fc-cli"; npm run user:add`
Expected: спрашивает логин, имя и пароль (пароль не отображается), печатает «Пользователь «…» создан.». Повторный запуск с тем же логином печатает «Логин уже занят» и завершается с кодом 1.

- [ ] **Step 8: Commit**

```bash
git add src/server/modules/users scripts/lib/prompt.ts scripts/user-add.ts tests/server/users.test.ts
git commit -m "feat: пользователи, argon2id-пароли и скрипт user:add"
```

---

### Task 7: Сессии, ограничитель входа и маршруты авторизации

**Files:**
- Create: `src/server/modules/auth/sessions.ts`, `src/server/modules/auth/login-limiter.ts`, `src/server/modules/auth/plugin.ts`, `src/server/modules/auth/routes.ts`
- Create: `src/server/security/client-ip.ts` (только функция `resolveClientIp`; тесты на подделку заголовков — в задаче 8)
- Modify: `src/server/app.ts`
- Modify: `tests/helpers/test-app.ts` (хелпер `seedUser`, `loginAs`)
- Test: `tests/server/sessions.test.ts`, `tests/server/login-limiter.test.ts`, `tests/server/auth-routes.test.ts`

**Interfaces:**
- Consumes: `UsersService`, `AuthUser`, `normalizeLogin` (задача 6), `AuditService` (задача 5), `AppError` (задача 4), `Config` (задача 2).
- Produces:
  ```ts
  // sessions.ts
  const SESSION_TTL_MS = 12 * 3600_000; const REMEMBER_TTL_MS = 30 * 24 * 3600_000; const TOUCH_INTERVAL_MS = 5 * 60_000;
  interface SessionsService {
    create(i: { userId: number; remember: boolean; ip: string | null; userAgent: string | null }): { id: number; token: string; expiresAt: Date };
    touch(token: string): { id: number; user: AuthUser } | null;
    revoke(token: string): void;
    revokeAllForUser(userId: number, exceptSessionId?: number): void;
  }
  function createSessionsService(db: Db, users: UsersService, now?: () => Date): SessionsService;
  // login-limiter.ts
  class LoginLimiter { constructor(max?: number, windowMs?: number, now?: () => number);
    isBlocked(keys: string[]): boolean; recordFailure(keys: string[]): void; reset(keys: string[]): void }
  // security/client-ip.ts
  function isLoopback(addr: string | undefined): boolean;
  function resolveClientIp(req: FastifyRequest, mode: DeployMode): string;
  // plugin.ts
  declare module 'fastify' { interface FastifyRequest { user: AuthUser | null; sessionId: number | null } }
  function registerAuth(app: FastifyInstance, deps: { sessions: SessionsService }): void;
  // routes.ts — POST /api/v1/auth/login, POST /api/v1/auth/logout, GET /api/v1/auth/me
  function registerAuthRoutes(app: FastifyInstance, deps: { users: UsersService; sessions: SessionsService;
    limiter: LoginLimiter; audit: AuditService; config: Config }): void;
  // tests/helpers/test-app.ts
  async function seedUser(t: TestApp, login?: string, password?: string): Promise<AuthUser>;
  async function loginAs(t: TestApp, login?: string, password?: string): Promise<string>; // строка для заголовка cookie
  ```
  Буквальное значение куки: `sid=<подписанный токен>`.

- [ ] **Step 1: Написать падающие тесты сервисов**

`tests/server/login-limiter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { LoginLimiter } from '../../src/server/modules/auth/login-limiter';

describe('LoginLimiter', () => {
  it('блокирует после 5 неудач за 15 минут по любому из ключей', () => {
    let now = 0;
    const l = new LoginLimiter(5, 15 * 60_000, () => now);
    for (let i = 0; i < 5; i++) l.recordFailure(['login:admin', 'ip:1.1.1.1']);
    expect(l.isBlocked(['login:admin', 'ip:2.2.2.2'])).toBe(true);
    expect(l.isBlocked(['login:other', 'ip:1.1.1.1'])).toBe(true);
    expect(l.isBlocked(['login:other', 'ip:2.2.2.2'])).toBe(false);
    now = 15 * 60_000 + 1;
    expect(l.isBlocked(['login:admin', 'ip:1.1.1.1'])).toBe(false);
  });

  it('reset очищает счётчик ключа', () => {
    const l = new LoginLimiter(2, 1000, () => 0);
    l.recordFailure(['login:a']);
    l.recordFailure(['login:a']);
    expect(l.isBlocked(['login:a'])).toBe(true);
    l.reset(['login:a']);
    expect(l.isBlocked(['login:a'])).toBe(false);
  });
});
```

`tests/server/sessions.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { createAuditService } from '../../src/server/modules/audit/service';
import { createSessionsService, REMEMBER_TTL_MS, SESSION_TTL_MS } from '../../src/server/modules/auth/sessions';
import { createUsersService } from '../../src/server/modules/users/service';
import { sessions } from '../../src/server/db/schema';
import { createTestDb } from '../helpers/test-db';

let t: ReturnType<typeof createTestDb>;
afterEach(() => t?.cleanup());

async function setup() {
  t = createTestDb();
  let now = new Date('2026-10-05T10:00:00.000Z');
  const clock = { set: (iso: string) => (now = new Date(iso)), now: () => now };
  const users = createUsersService(t.db, createAuditService(t.db));
  const u = await users.create({ login: 'admin', name: 'В', password: 'correct-horse-1' }, null);
  const svc = createSessionsService(t.db, users, clock.now);
  return { svc, u, clock, users };
}

describe('sessions', () => {
  it('хранит только хэш токена и находит пользователя по токену', async () => {
    const { svc, u } = await setup();
    const s = svc.create({ userId: u.id, remember: false, ip: '1.1.1.1', userAgent: 'test' });
    const row = t.db.select().from(sessions).all()[0]!;
    expect(row.tokenHash).not.toBe(s.token);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(svc.touch(s.token)).toEqual({ id: s.id, user: { id: u.id, login: 'admin', name: 'В' } });
    expect(svc.touch('неизвестный')).toBeNull();
  });

  it('истекает через 12 часов без активности и продлевается при активности', async () => {
    const { svc, u, clock } = await setup();
    const s = svc.create({ userId: u.id, remember: false, ip: null, userAgent: null });
    expect(s.expiresAt.getTime() - new Date('2026-10-05T10:00:00.000Z').getTime()).toBe(SESSION_TTL_MS);
    clock.set('2026-10-05T21:00:00.000Z');
    expect(svc.touch(s.token)).not.toBeNull(); // продлила до 09:00 следующего дня
    clock.set('2026-10-06T08:59:00.000Z');
    expect(svc.touch(s.token)).not.toBeNull();
    clock.set('2026-10-06T21:00:00.000Z');
    expect(svc.touch(s.token)).toBeNull();
  });

  it('remember даёт 30 дней', async () => {
    const { svc, u } = await setup();
    const s = svc.create({ userId: u.id, remember: true, ip: null, userAgent: null });
    expect(s.expiresAt.getTime() - new Date('2026-10-05T10:00:00.000Z').getTime()).toBe(REMEMBER_TTL_MS);
  });

  it('lastSeenAt пишется не чаще раза в 5 минут', async () => {
    const { svc, u, clock } = await setup();
    const s = svc.create({ userId: u.id, remember: false, ip: null, userAgent: null });
    clock.set('2026-10-05T10:04:00.000Z');
    svc.touch(s.token);
    expect(t.db.select().from(sessions).all()[0]!.lastSeenAt).toBe('2026-10-05T10:00:00.000Z');
    clock.set('2026-10-05T10:06:00.000Z');
    svc.touch(s.token);
    expect(t.db.select().from(sessions).all()[0]!.lastSeenAt).toBe('2026-10-05T10:06:00.000Z');
  });

  it('revoke и revokeAllForUser удаляют сессии; отключённый пользователь не проходит', async () => {
    const { svc, u } = await setup();
    const a = svc.create({ userId: u.id, remember: false, ip: null, userAgent: null });
    const b = svc.create({ userId: u.id, remember: false, ip: null, userAgent: null });
    const c = svc.create({ userId: u.id, remember: false, ip: null, userAgent: null });
    svc.revoke(a.token);
    expect(svc.touch(a.token)).toBeNull();
    svc.revokeAllForUser(u.id, b.id);
    expect(svc.touch(b.token)).not.toBeNull();
    expect(svc.touch(c.token)).toBeNull();
    t.sqlite.prepare('UPDATE users SET disabled_at = ? WHERE id = ?').run('2026-10-05T10:00:00.000Z', u.id);
    expect(svc.touch(b.token)).toBeNull();
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run tests/server/login-limiter.test.ts tests/server/sessions.test.ts`
Expected: FAIL — модули не найдены.

- [ ] **Step 3: Реализовать ограничитель и сессии**

`src/server/modules/auth/login-limiter.ts`:

```ts
export class LoginLimiter {
  private failures = new Map<string, number[]>();

  constructor(
    private readonly max = 5,
    private readonly windowMs = 15 * 60_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private recent(key: string): number[] {
    const since = this.now() - this.windowMs;
    const list = (this.failures.get(key) ?? []).filter((ts) => ts > since);
    if (list.length) this.failures.set(key, list);
    else this.failures.delete(key);
    return list;
  }

  isBlocked(keys: string[]): boolean {
    return keys.some((k) => this.recent(k).length >= this.max);
  }

  recordFailure(keys: string[]): void {
    for (const k of keys) this.failures.set(k, [...this.recent(k), this.now()]);
  }

  reset(keys: string[]): void {
    for (const k of keys) this.failures.delete(k);
  }
}
```

`src/server/modules/auth/sessions.ts`:

```ts
import crypto from 'node:crypto';
import { and, eq, ne } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { sessions } from '../../db/schema';
import type { AuthUser, UsersService } from '../users/service';

export const SESSION_TTL_MS = 12 * 3600_000;
export const REMEMBER_TTL_MS = 30 * 24 * 3600_000;
export const TOUCH_INTERVAL_MS = 5 * 60_000;

export interface SessionsService {
  create(i: { userId: number; remember: boolean; ip: string | null; userAgent: string | null }): {
    id: number;
    token: string;
    expiresAt: Date;
  };
  touch(token: string): { id: number; user: AuthUser } | null;
  revoke(token: string): void;
  revokeAllForUser(userId: number, exceptSessionId?: number): void;
}

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export function createSessionsService(db: Db, users: UsersService, now: () => Date = () => new Date()): SessionsService {
  return {
    create({ userId, remember, ip, userAgent }) {
      const token = crypto.randomBytes(32).toString('base64url');
      const t = now();
      const expiresAt = new Date(t.getTime() + (remember ? REMEMBER_TTL_MS : SESSION_TTL_MS));
      const row = db
        .insert(sessions)
        .values({
          tokenHash: hashToken(token),
          userId,
          remember,
          createdAt: t.toISOString(),
          expiresAt: expiresAt.toISOString(),
          lastSeenAt: t.toISOString(),
          ip,
          userAgent: userAgent?.slice(0, 300) ?? null,
        })
        .returning({ id: sessions.id })
        .get();
      return { id: row.id, token, expiresAt };
    },

    touch(token) {
      const row = db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(token))).get();
      if (!row) return null;
      const t = now();
      if (new Date(row.expiresAt).getTime() <= t.getTime()) {
        db.delete(sessions).where(eq(sessions.id, row.id)).run();
        return null;
      }
      const user = users.getActive(row.userId);
      if (!user) return null;
      if (t.getTime() - new Date(row.lastSeenAt).getTime() >= TOUCH_INTERVAL_MS) {
        const ttl = row.remember ? REMEMBER_TTL_MS : SESSION_TTL_MS;
        db.update(sessions)
          .set({ lastSeenAt: t.toISOString(), expiresAt: new Date(t.getTime() + ttl).toISOString() })
          .where(eq(sessions.id, row.id))
          .run();
      }
      return { id: row.id, user };
    },

    revoke(token) {
      db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token))).run();
    },

    revokeAllForUser(userId, exceptSessionId) {
      const cond =
        exceptSessionId === undefined
          ? eq(sessions.userId, userId)
          : and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId));
      db.delete(sessions).where(cond).run();
    },
  };
}
```

В тесте продления сессия создана в 10:00. В 21:00 `touch` срабатывает, потому что с `lastSeenAt` прошло больше 5 минут: `expiresAt` становится 09:00 следующего дня. В 08:59 сессия ещё жива и снова продлевается, до 20:59. В 21:00 она уже истекла.

- [ ] **Step 4: Убедиться, что тесты сервисов проходят**

Run: `npx vitest run tests/server/login-limiter.test.ts tests/server/sessions.test.ts`
Expected: PASS (7 тестов).

- [ ] **Step 5: Написать падающий тест маршрутов**

Расширьте `tests/helpers/test-app.ts`:

```ts
import { createAuditService } from '../../src/server/modules/audit/service';
import { createUsersService, type AuthUser } from '../../src/server/modules/users/service';

export async function seedUser(t: TestApp, login = 'admin', password = 'correct-horse-1'): Promise<AuthUser> {
  return createUsersService(t.db, createAuditService(t.db)).create({ login, name: 'Тест', password }, null);
}

export async function loginAs(t: TestApp, login = 'admin', password = 'correct-horse-1'): Promise<string> {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: ORIGIN_HEADERS,
    payload: { login, password },
  });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === 'sid');
  if (!cookie) throw new Error('no sid cookie');
  return `sid=${cookie.value}`;
}
```

`tests/server/auth-routes.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, loginAs, ORIGIN_HEADERS, seedUser, type TestApp } from '../helpers/test-app';

let t: TestApp;
afterEach(async () => t?.cleanup());

describe('auth routes', () => {
  it('вход ставит httpOnly-куку sid и /auth/me возвращает пользователя', async () => {
    t = await createTestApp();
    await seedUser(t);
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: ORIGIN_HEADERS,
      payload: { login: 'Admin', password: 'correct-horse-1' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ user: { id: 1, login: 'admin', name: 'Тест' } });
    const c = res.cookies.find((x) => x.name === 'sid')!;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe('Lax');
    expect(c.secure).toBeFalsy(); // Review Focus 2: HTTP-запрос → без Secure
    expect(c.expires).toBeUndefined(); // без remember — сессионная кука

    const me = await t.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: `sid=${c.value}` } });
    expect(me.json()).toEqual({ user: { id: 1, login: 'admin', name: 'Тест' } });
  });

  it('за прокси с X-Forwarded-Proto: https кука получает Secure; remember ставит срок', async () => {
    t = await createTestApp({ PUBLIC_URL: 'https://fin.example.kz' });
    await seedUser(t);
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://fin.example.kz', 'x-requested-with': 'fetch', 'x-forwarded-proto': 'https' },
      payload: { login: 'admin', password: 'correct-horse-1', remember: true },
    });
    const c = res.cookies.find((x) => x.name === 'sid')!;
    expect(c.secure).toBe(true);
    expect(c.expires).toBeInstanceOf(Date);
  });

  it('неверный пароль → 401, после 5 неудач → 429 даже с верным паролем', async () => {
    t = await createTestApp();
    await seedUser(t);
    const attempt = (password: string) =>
      t.app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: ORIGIN_HEADERS, payload: { login: 'admin', password } });
    for (let i = 0; i < 5; i++) {
      const r = await attempt('wrong-password');
      expect(r.statusCode).toBe(401);
      expect(r.json().error.code).toBe('INVALID_CREDENTIALS');
    }
    const blocked = await attempt('correct-horse-1');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('RATE_LIMITED');
  });

  it('без сессии, с подделанной или отозванной кукой → 401 (Review Focus 4)', async () => {
    t = await createTestApp();
    await seedUser(t);
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/auth/me' })).statusCode).toBe(401);
    const forged = await t.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: 'sid=abc.def' } });
    expect(forged.statusCode).toBe(401);
    expect(forged.json().error.code).toBe('UNAUTHORIZED');

    const cookie = await loginAs(t);
    t.sqlite.prepare('DELETE FROM sessions').run(); // как после восстановления бэкапа
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } })).statusCode).toBe(401);
  });

  it('выход удаляет сессию и пишет историю', async () => {
    t = await createTestApp();
    await seedUser(t);
    const cookie = await loginAs(t);
    const out = await t.app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { ...ORIGIN_HEADERS, cookie } });
    expect(out.statusCode).toBe(204);
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } })).statusCode).toBe(401);
    const actions = t.sqlite.prepare('SELECT action FROM audit_log ORDER BY id').all() as { action: string }[];
    expect(actions.map((a) => a.action)).toEqual(['create', 'login', 'logout']);
  });

  it('health и meta доступны без входа', async () => {
    t = await createTestApp();
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/health' })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/meta' })).statusCode).toBe(200);
  });
});
```

- [ ] **Step 6: Убедиться, что тест падает**

Run: `npx vitest run tests/server/auth-routes.test.ts`
Expected: FAIL — 404 на `/api/v1/auth/login`.

- [ ] **Step 7: Реализовать определение IP, плагин и маршруты**

`src/server/security/client-ip.ts`:

```ts
import type { FastifyRequest } from 'fastify';
import type { DeployMode } from '../config';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function isLoopback(addr: string | undefined): boolean {
  return addr !== undefined && LOOPBACK.has(addr);
}

export function resolveClientIp(req: FastifyRequest, mode: DeployMode): string {
  if (mode === 'cloudflare' && isLoopback(req.socket.remoteAddress)) {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf.trim() !== '') return cf.trim();
  }
  return req.ip;
}
```

`src/server/modules/auth/plugin.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors';
import type { AuthUser } from '../users/service';
import type { SessionsService } from './sessions';

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
    sessionId: number | null;
  }
}

const PUBLIC_ROUTES = new Set(['/api/v1/health', '/api/v1/meta', '/api/v1/auth/login']);

export function readSessionToken(req: import('fastify').FastifyRequest): string | null {
  const raw = req.cookies.sid;
  if (!raw) return null;
  const un = req.unsignCookie(raw);
  return un.valid && un.value ? un.value : null;
}

export function registerAuth(app: FastifyInstance, deps: { sessions: SessionsService }): void {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionId', null);

  app.addHook('preHandler', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    const token = readSessionToken(req);
    if (token) {
      const s = deps.sessions.touch(token);
      if (s) {
        req.user = s.user;
        req.sessionId = s.id;
      }
    }
    const route = req.routeOptions.url;
    if (!route) return; // неизвестный путь — отдаст 404 обработчик not-found
    if (PUBLIC_ROUTES.has(route)) return;
    // тестовые маршруты из createTestApp(…, extraRoutes); VITEST выставляет сам Vitest, в рабочем процессе её нет
    if (process.env.VITEST && route.startsWith('/api/v1/__test/')) return;
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', 'Требуется вход');
  });
}
```

`src/server/modules/auth/routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../../config';
import { AppError } from '../../errors';
import { resolveClientIp } from '../../security/client-ip';
import type { AuditService } from '../audit/service';
import { normalizeLogin, type UsersService } from '../users/service';
import type { LoginLimiter } from './login-limiter';
import { readSessionToken } from './plugin';
import type { SessionsService } from './sessions';

const loginBody = z.object({
  login: z.string().min(1, 'Введите логин').max(64),
  password: z.string().min(1, 'Введите пароль').max(256),
  remember: z.boolean().optional().default(false),
});

export function registerAuthRoutes(
  app: FastifyInstance,
  deps: { users: UsersService; sessions: SessionsService; limiter: LoginLimiter; audit: AuditService; config: Config },
): void {
  app.post('/api/v1/auth/login', async (req, reply) => {
    const body = loginBody.parse(req.body);
    const ip = resolveClientIp(req, deps.config.deployMode);
    const keys = [`login:${normalizeLogin(body.login)}`, `ip:${ip}`];
    if (deps.limiter.isBlocked(keys)) {
      throw new AppError(429, 'RATE_LIMITED', 'Слишком много попыток входа. Повторите через 15 минут');
    }
    const user = await deps.users.verifyCredentials(body.login, body.password);
    if (!user) {
      deps.limiter.recordFailure(keys);
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Неверный логин или пароль');
    }
    deps.limiter.reset(keys);
    const s = deps.sessions.create({
      userId: user.id,
      remember: body.remember,
      ip,
      userAgent: req.headers['user-agent'] ?? null,
    });
    reply.setCookie('sid', s.token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: req.protocol === 'https',
      signed: true,
      ...(body.remember ? { expires: s.expiresAt } : {}),
    });
    deps.audit.record({ userId: user.id, entity: 'user', entityId: user.id, action: 'login', diff: { ip } });
    return { user };
  });

  app.post('/api/v1/auth/logout', async (req, reply) => {
    const token = readSessionToken(req);
    if (token) deps.sessions.revoke(token);
    reply.clearCookie('sid', { path: '/' });
    deps.audit.record({ userId: req.user!.id, entity: 'user', entityId: req.user!.id, action: 'logout' });
    return reply.status(204).send();
  });

  app.get('/api/v1/auth/me', async (req) => ({ user: req.user }));
}
```

Изменения в `src/server/app.ts`: подключить куки, сервисы, авторизацию и маршруты. Итоговая версия файла:

```ts
import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Config } from './config';
import type { Db, Sqlite } from './db/client';
import { registerErrorHandler } from './errors';
import { createAuditService } from './modules/audit/service';
import { LoginLimiter } from './modules/auth/login-limiter';
import { registerAuth } from './modules/auth/plugin';
import { registerAuthRoutes } from './modules/auth/routes';
import { createSessionsService } from './modules/auth/sessions';
import { createUsersService } from './modules/users/service';

export interface AppDeps {
  config: Config;
  db: Db;
  sqlite: Sqlite;
  logger?: FastifyServerOptions['logger'];
  now?: () => Date;
  extraRoutes?: (app: FastifyInstance) => void;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, db } = deps;
  const now = deps.now ?? (() => new Date());
  const app = Fastify({ logger: deps.logger ?? false, trustProxy: 'loopback', bodyLimit: 1024 * 1024 });

  registerErrorHandler(app);
  await app.register(cookie, { secret: config.sessionSecret });

  const audit = createAuditService(db, now);
  const users = createUsersService(db, audit, now);
  const sessions = createSessionsService(db, users, now);
  const limiter = new LoginLimiter();

  registerAuth(app, { sessions });

  app.get('/api/v1/health', async () => ({ ok: true }));
  app.get('/api/v1/meta', async () => ({ appName: config.appName }));
  registerAuthRoutes(app, { users, sessions, limiter, audit, config });

  deps.extraRoutes?.(app);
  return app;
}
```


- [ ] **Step 8: Убедиться, что все тесты проходят**

Run: `npm test && npm run typecheck`
Expected: PASS — все тесты задач 2–7.

- [ ] **Step 9: Commit**

```bash
git add src/server tests
git commit -m "feat: сессии, ограничитель входа, вход/выход и /auth/me"
```

---

### Task 8: Защита: IP по режиму, CSRF, helmet, лимит API

**Files:**
- Create: `src/server/security/csrf.ts`
- Modify: `src/server/app.ts`
- Test: `tests/server/client-ip.test.ts`, `tests/server/csrf.test.ts`, `tests/server/rate-limit.test.ts`

**Interfaces:**
- Consumes: `resolveClientIp`, `isLoopback` (задача 7), `Config.allowedOrigins` (задача 2), `readSessionToken` (задача 7).
- Produces:
  ```ts
  function registerCsrf(app: FastifyInstance, allowedOrigins: string[]): void;
  ```
  `buildApp` регистрирует `@fastify/helmet` и `@fastify/rate-limit` (300 запросов в минуту на сессию, без сессии — на IP).

- [ ] **Step 1: Написать падающие тесты**

`tests/server/client-ip.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { resolveClientIp } from '../../src/server/security/client-ip';
import { createTestApp, type TestApp } from '../helpers/test-app';

let t: TestApp | null = null;
afterEach(async () => {
  await t?.cleanup();
  t = null;
});

const MODE_ENV = {
  cloudflare: { DEPLOY_MODE: 'cloudflare', CF_TUNNEL_TOKEN: 't' },
  ngrok: { DEPLOY_MODE: 'ngrok', NGROK_AUTHTOKEN: 'a', NGROK_DOMAIN: 'x.ngrok-free.app' },
  vps: { DEPLOY_MODE: 'vps' },
} as const;

async function ipOf(mode: keyof typeof MODE_ENV, headers: Record<string, string>, remoteAddress = '127.0.0.1') {
  await t?.cleanup();
  t = await createTestApp({ ...MODE_ENV[mode] }, (app) => {
    app.get('/api/v1/__test/ip', async (req) => ({ ip: resolveClientIp(req, mode) }));
  });
  const res = await t.app.inject({ method: 'GET', url: '/api/v1/__test/ip', headers, remoteAddress });
  return res.json().ip as string;
}

describe('resolveClientIp', () => {
  it('в режиме ngrok игнорирует CF-Connecting-IP и берёт правый недоверенный адрес X-Forwarded-For', async () => {
    expect(await ipOf('ngrok', { 'cf-connecting-ip': '6.6.6.6', 'x-forwarded-for': '6.6.6.6, 9.9.9.9' })).toBe('9.9.9.9');
  });

  it('в режиме vps подделка начала X-Forwarded-For не меняет IP', async () => {
    expect(await ipOf('vps', { 'x-forwarded-for': '1.1.1.1, 9.9.9.9' })).toBe('9.9.9.9');
    expect(await ipOf('vps', { 'x-forwarded-for': '2.2.2.2, 9.9.9.9' })).toBe('9.9.9.9');
  });

  it('в режиме cloudflare с loopback учитывает CF-Connecting-IP', async () => {
    expect(await ipOf('cloudflare', { 'cf-connecting-ip': '5.5.5.5', 'x-forwarded-for': '5.5.5.5' })).toBe('5.5.5.5');
  });

  it('в режиме cloudflare не с loopback (локальная сеть) CF-Connecting-IP игнорируется', async () => {
    expect(await ipOf('cloudflare', { 'cf-connecting-ip': '5.5.5.5' }, '192.168.1.20')).toBe('192.168.1.20');
  });
});
```

`tests/server/csrf.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, seedUser, type TestApp } from '../helpers/test-app';

let t: TestApp;
afterEach(async () => t?.cleanup());

const login = (headers: Record<string, string>) =>
  t.app.inject({ method: 'POST', url: '/api/v1/auth/login', headers, payload: { login: 'admin', password: 'correct-horse-1' } });

describe('CSRF', () => {
  it('отклоняет POST без X-Requested-With', async () => {
    t = await createTestApp();
    await seedUser(t);
    const r = await login({ origin: 'http://localhost:3000' });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('CSRF');
  });

  it('отклоняет чужой и отсутствующий Origin', async () => {
    t = await createTestApp();
    await seedUser(t);
    expect((await login({ origin: 'https://evil.example', 'x-requested-with': 'fetch' })).statusCode).toBe(403);
    expect((await login({ 'x-requested-with': 'fetch' })).statusCode).toBe(403);
  });

  it('пропускает PUBLIC_URL, localhost, 127.0.0.1 и EXTRA_ORIGINS', async () => {
    t = await createTestApp({ PUBLIC_URL: 'https://fin.example.kz', EXTRA_ORIGINS: 'http://192.168.1.10:3000' });
    await seedUser(t);
    for (const origin of ['https://fin.example.kz', 'http://localhost:3000', 'http://127.0.0.1:3000', 'http://192.168.1.10:3000']) {
      expect((await login({ origin, 'x-requested-with': 'fetch' })).statusCode).toBe(200);
    }
  });

  it('GET не требует CSRF-заголовков', async () => {
    t = await createTestApp();
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/health' })).statusCode).toBe(200);
  });
});
```

`tests/server/rate-limit.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, loginAs, seedUser, type TestApp } from '../helpers/test-app';

let t: TestApp;
afterEach(async () => t?.cleanup());

describe('лимит API и заголовки', () => {
  it('301-й запрос сессии за минуту получает 429', async () => {
    t = await createTestApp();
    await seedUser(t);
    const cookie = await loginAs(t);
    let last = 0;
    for (let i = 0; i < 301; i++) {
      last = (await t.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } })).statusCode;
    }
    expect(last).toBe(429);
  });

  it('helmet ставит защитные заголовки', async () => {
    t = await createTestApp();
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run tests/server/client-ip.test.ts tests/server/csrf.test.ts tests/server/rate-limit.test.ts`
Expected: `client-ip` PASS (функция уже есть с задачи 7), `csrf` FAIL (вход без заголовков отдаёт 200), `rate-limit` FAIL.

- [ ] **Step 3: Реализовать CSRF и подключить helmet и лимит API**

`src/server/security/csrf.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { AppError } from '../errors';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export function registerCsrf(app: FastifyInstance, allowedOrigins: string[]): void {
  const allowed = new Set(allowedOrigins);
  app.addHook('onRequest', async (req) => {
    if (SAFE.has(req.method) || !req.url.startsWith('/api/')) return;
    if (req.headers['x-requested-with'] !== 'fetch') {
      throw new AppError(403, 'CSRF', 'Запрос отклонён защитой от подделки');
    }
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || !allowed.has(origin)) {
      throw new AppError(403, 'CSRF', 'Запрос отклонён защитой от подделки');
    }
  });
}
```

В `src/server/app.ts` после регистрации cookie добавьте:

```ts
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { registerCsrf } from './security/csrf';
import { readSessionToken } from './modules/auth/plugin';
import { resolveClientIp } from './security/client-ip';

  // ...после await app.register(cookie, ...)
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
  });
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      const token = readSessionToken(req);
      return token ? `s:${token}` : `ip:${resolveClientIp(req, config.deployMode)}`;
    },
  });
  registerCsrf(app, config.allowedOrigins);
```

`upgradeInsecureRequests: null` нужен, чтобы вход по `http://localhost` с ПК клуба не превращался браузером в HTTPS.

- [ ] **Step 4: Убедиться, что все тесты проходят**

Run: `npm test && npm run typecheck`
Expected: PASS — все тесты, включая `auth-routes` (хелперы уже шлют `ORIGIN_HEADERS`).

- [ ] **Step 5: Commit**

```bash
git add src/server tests/server/client-ip.test.ts tests/server/csrf.test.ts tests/server/rate-limit.test.ts
git commit -m "feat: CSRF по Origin, helmet, лимит API и IP по режиму развёртывания"
```

---

### Task 9: Бэкап и восстановление

**Files:**
- Create: `src/server/modules/backup/archive-name.ts`, `src/server/modules/backup/service.ts`, `src/server/modules/backup/restore.ts`, `src/server/modules/backup/routes.ts`
- Create: `src/server/lock.ts`
- Create: `scripts/backup.ts`, `scripts/restore.ts`
- Modify: `src/server/app.ts`
- Test: `tests/server/archive-name.test.ts`, `tests/server/backup.test.ts`, `tests/server/restore.test.ts`, `tests/server/lock.test.ts`

**Interfaces:**
- Consumes: `Config`, `openDb`, `runMigrations`, `codeMigrationsCount`, `appliedMigrationsCount`, `Sqlite`.
- Produces:
  ```ts
  // archive-name.ts
  function archiveName(at: Date, timezone: string): string; // backup-YYYYMMDD-HHmmss.zip
  const ARCHIVE_RE: RegExp;
  // service.ts
  type BackupReason = 'daily' | 'startup' | 'manual' | 'pre-migration';
  interface BackupInfo { file: string; path: string; createdAt: Date; size: number }
  interface BackupService {
    create(reason: BackupReason): string;
    list(): BackupInfo[];
    last(): BackupInfo | null;
    ensureRecent(maxAgeMs?: number): string | null;
    status(): { last: BackupInfo | null; copyDir: string | null; lastCopyError: string | null };
  }
  function createBackupService(d: { sqlite: Sqlite; config: Config; now?: () => Date;
    log?: (msg: string, err?: unknown) => void }): BackupService;
  // lock.ts
  class LockHeldError extends Error { pid: number }
  function isPidAlive(pid: number): boolean;
  function readLockPid(lockPath: string): number | null;
  function isLockHeld(lockPath: string): boolean;
  function acquireLock(lockPath: string): () => void;
  // restore.ts
  async function restoreBackup(i: { archivePath: string; config: Config; now?: () => Date }): Promise<{ preRestoreDir: string }>;
  // routes.ts — GET /api/v1/backup/download, GET /api/v1/backup/status
  function registerBackupRoutes(app: FastifyInstance, deps: { backup: BackupService }): void;
  ```

- [ ] **Step 1: Написать падающие тесты**

`tests/server/archive-name.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ARCHIVE_RE, archiveName } from '../../src/server/modules/backup/archive-name';

describe('archiveName', () => {
  it('форматирует время в APP_TIMEZONE', () => {
    // 2026-10-05 21:30:05 UTC = 2026-10-06 02:30:05 в Алматы (UTC+5)
    expect(archiveName(new Date('2026-10-05T21:30:05.000Z'), 'Asia/Almaty')).toBe('backup-20261006-023005.zip');
    expect(ARCHIVE_RE.test('backup-20261006-023005.zip')).toBe(true);
    expect(ARCHIVE_RE.test('backup-20261006-023005-2.zip')).toBe(true);
    expect(ARCHIVE_RE.test('notes.zip')).toBe(false);
  });
});
```

`tests/server/lock.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireLock, isLockHeld, LockHeldError, readLockPid } from '../../src/server/lock';

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
});
```

`tests/server/backup.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/server/db/client';
import { runMigrations } from '../../src/server/db/migrate';
import { createBackupService } from '../../src/server/modules/backup/service';
import { testConfig } from '../helpers/test-app';

let cleanup: (() => void) | null = null;
afterEach(() => cleanup?.());

function setup(dirName = 'fc-backup-', overrides: Record<string, string> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), dirName));
  const config = testConfig(dir, { BACKUP_KEEP: '3', ...overrides });
  fs.mkdirSync(config.dataDir, { recursive: true });
  const { sqlite, db } = openDb(config.dbPath);
  runMigrations(db);
  sqlite.prepare("INSERT INTO currencies (code, name, symbol, minor_units) VALUES ('KZT','Тенге','₸',2)").run();
  let now = new Date('2026-10-05T00:00:00.000Z');
  const clock = { advance: (ms: number) => (now = new Date(now.getTime() + ms)), now: () => now };
  const svc = createBackupService({ sqlite, config, now: clock.now });
  cleanup = () => {
    sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { dir, config, sqlite, svc, clock };
}

describe('backup', () => {
  it('создаёт архив с app.db, когда uploads/ ещё нет (Review Focus 5)', () => {
    const { svc } = setup();
    const file = svc.create('manual');
    const zip = new AdmZip(file);
    expect(zip.getEntries().map((e) => e.entryName)).toEqual(['app.db']);
  });

  it('включает uploads/ и даёт согласованный снимок БД', () => {
    const { svc, config } = setup();
    fs.mkdirSync(path.join(config.uploadsDir, 'a'), { recursive: true });
    fs.writeFileSync(path.join(config.uploadsDir, 'a', 'check.pdf'), 'PDF');
    const zip = new AdmZip(svc.create('manual'));
    expect(zip.getEntry('uploads/a/check.pdf')?.getData().toString()).toBe('PDF');
    const tmp = path.join(config.dataDir, 'extract.db');
    fs.writeFileSync(tmp, zip.getEntry('app.db')!.getData());
    const { sqlite } = openDb(tmp);
    expect((sqlite.prepare('SELECT code FROM currencies').get() as { code: string }).code).toBe('KZT');
    sqlite.close();
  });

  it('работает в папке с пробелами, кириллицей и апострофом (Review Focus 3)', () => {
    const { svc } = setup("fc-backup Пользователь O'Brien ");
    expect(fs.existsSync(svc.create('manual'))).toBe(true);
  });

  it('хранит последние BACKUP_KEEP архивов и копирует в BACKUP_COPY_DIR', () => {
    const copyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-copy-'));
    const { svc, clock } = setup('fc-backup-', { BACKUP_COPY_DIR: copyDir });
    for (let i = 0; i < 5; i++) {
      svc.create('daily');
      clock.advance(60_000);
    }
    expect(svc.list()).toHaveLength(3);
    expect(fs.readdirSync(copyDir).filter((f) => f.endsWith('.zip'))).toHaveLength(3);
    expect(svc.status().lastCopyError).toBeNull();
    fs.rmSync(copyDir, { recursive: true, force: true });
  });

  it('два бэкапа в одну секунду не перезаписывают друг друга', () => {
    const { svc } = setup();
    const a = svc.create('manual');
    const b = svc.create('manual');
    expect(a).not.toBe(b);
    expect(path.basename(b)).toMatch(/-2\.zip$/);
  });

  it('ensureRecent делает бэкап, только если последнему больше 24 часов', () => {
    const { svc, clock } = setup();
    expect(svc.ensureRecent()).not.toBeNull(); // бэкапов не было
    clock.advance(23 * 3600_000);
    expect(svc.ensureRecent()).toBeNull();
    clock.advance(2 * 3600_000);
    expect(svc.ensureRecent()).not.toBeNull();
  });
});
```

`tests/server/restore.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/server/db/client';
import { runMigrations } from '../../src/server/db/migrate';
import { createBackupService } from '../../src/server/modules/backup/service';
import { restoreBackup } from '../../src/server/modules/backup/restore';
import { testConfig } from '../helpers/test-app';

let dir = '';
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function prepare() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fc-restore O'Б "));
  const config = testConfig(dir, { PORT: '39123' });
  fs.mkdirSync(config.uploadsDir, { recursive: true });
  const { sqlite, db } = openDb(config.dbPath);
  runMigrations(db);
  sqlite.prepare("INSERT INTO users (login, name, password_hash, created_at) VALUES ('admin','A','h','2026-10-05T00:00:00.000Z')").run();
  sqlite
    .prepare("INSERT INTO sessions (token_hash, user_id, remember, created_at, expires_at, last_seen_at) VALUES ('x',1,0,'a','b','c')")
    .run();
  fs.writeFileSync(path.join(config.uploadsDir, 'old.pdf'), 'OLD');
  const archive = createBackupService({ sqlite, config }).create('manual');
  // после бэкапа данные меняются
  sqlite.prepare("UPDATE users SET name = 'Изменено'").run();
  fs.writeFileSync(path.join(config.uploadsDir, 'new.pdf'), 'NEW');
  sqlite.close();
  return { config, archive };
}

describe('restore', () => {
  it('возвращает данные и вложения из архива, очищает сессии, убирает WAL-файлы', async () => {
    const { config, archive } = prepare();
    fs.writeFileSync(config.dbPath + '-wal', 'garbage'); // остаток WAL должен уйти в pre-restore
    const { preRestoreDir } = await restoreBackup({ archivePath: archive, config });

    const { sqlite } = openDb(config.dbPath);
    expect((sqlite.prepare('SELECT name FROM users').get() as { name: string }).name).toBe('A');
    expect((sqlite.prepare('SELECT COUNT(*) n FROM sessions').get() as { n: number }).n).toBe(0);
    sqlite.close();
    expect(fs.readdirSync(config.uploadsDir)).toEqual(['old.pdf']);
    expect(fs.existsSync(path.join(preRestoreDir, 'app.db-wal'))).toBe(true);
    expect(fs.existsSync(path.join(preRestoreDir, 'uploads', 'new.pdf'))).toBe(true);
  });

  it('отказывается, если приложение запущено (lock с живым PID)', async () => {
    const { config, archive } = prepare();
    fs.writeFileSync(config.lockPath, String(process.ppid));
    await expect(restoreBackup({ archivePath: archive, config })).rejects.toThrow(/остановите приложение/i);
  });

  it('отказывается восстанавливать архив с более новой схемой', async () => {
    const { config, archive } = prepare();
    const zip = new AdmZip(archive);
    const tmp = path.join(dir, 'newer.db');
    fs.writeFileSync(tmp, zip.getEntry('app.db')!.getData());
    const { sqlite } = openDb(tmp);
    sqlite.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('future', 9999999999999)").run();
    sqlite.close();
    zip.updateFile('app.db', fs.readFileSync(tmp));
    zip.writeZip(archive);
    await expect(restoreBackup({ archivePath: archive, config })).rejects.toThrow(/новее/);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run tests/server/archive-name.test.ts tests/server/lock.test.ts tests/server/backup.test.ts tests/server/restore.test.ts`
Expected: FAIL — модули не найдены.

- [ ] **Step 3: Реализовать имя архива и lock**

`src/server/modules/backup/archive-name.ts`:

```ts
export const ARCHIVE_RE = /^backup-\d{8}-\d{6}(-\d+)?\.zip$/;

export function archiveName(at: Date, timezone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return `backup-${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}.zip`;
}
```

`src/server/lock.ts`:

```ts
import fs from 'node:fs';

export class LockHeldError extends Error {
  constructor(public readonly pid: number) {
    super(`Приложение уже запущено (PID ${pid}). Остановите его и повторите.`);
    this.name = 'LockHeldError';
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function readLockPid(lockPath: string): number | null {
  try {
    const pid = Number.parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

export function isLockHeld(lockPath: string): boolean {
  const pid = readLockPid(lockPath);
  return pid !== null && pid !== process.pid && isPidAlive(pid);
}

export function acquireLock(lockPath: string): () => void {
  const pid = readLockPid(lockPath);
  if (pid !== null && pid !== process.pid && isPidAlive(pid)) throw new LockHeldError(pid);
  fs.writeFileSync(lockPath, String(process.pid));
  return () => {
    if (readLockPid(lockPath) === process.pid) fs.rmSync(lockPath, { force: true });
  };
}
```

- [ ] **Step 4: Реализовать сервис бэкапа**

`src/server/modules/backup/service.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import type { Config } from '../../config';
import type { Sqlite } from '../../db/client';
import { ARCHIVE_RE, archiveName } from './archive-name';

export type BackupReason = 'daily' | 'startup' | 'manual' | 'pre-migration';

export interface BackupInfo {
  file: string;
  path: string;
  createdAt: Date;
  size: number;
}

export interface BackupService {
  create(reason: BackupReason): string;
  list(): BackupInfo[];
  last(): BackupInfo | null;
  ensureRecent(maxAgeMs?: number): string | null;
  status(): { last: BackupInfo | null; copyDir: string | null; lastCopyError: string | null };
}

const DAY_MS = 24 * 3600_000;

function listArchives(dir: string): BackupInfo[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => ARCHIVE_RE.test(f))
    .map((file) => {
      const p = path.join(dir, file);
      const st = fs.statSync(p);
      return { file, path: p, createdAt: st.mtime, size: st.size };
    })
    .sort((a, b) => b.file.localeCompare(a.file, 'en', { numeric: true }));
}

function prune(dir: string, keep: number): void {
  for (const info of listArchives(dir).slice(keep)) fs.rmSync(info.path, { force: true });
}

export function createBackupService(d: {
  sqlite: Sqlite;
  config: Config;
  now?: () => Date;
  log?: (msg: string, err?: unknown) => void;
}): BackupService {
  const { sqlite, config } = d;
  const now = d.now ?? (() => new Date());
  const log = d.log ?? (() => {});
  let lastCopyError: string | null = null;

  function uniqueTarget(base: string): string {
    let target = path.join(config.backupsDir, base);
    for (let i = 2; fs.existsSync(target); i++) target = path.join(config.backupsDir, base.replace(/\.zip$/, `-${i}.zip`));
    return target;
  }

  const svc: BackupService = {
    create(reason) {
      fs.mkdirSync(config.backupsDir, { recursive: true });
      const at = now();
      const target = uniqueTarget(archiveName(at, config.timezone));
      const tmpDb = `${target}.db.tmp`;
      try {
        sqlite.prepare('VACUUM INTO ?').run(tmpDb);
        const zip = new AdmZip();
        zip.addLocalFile(tmpDb, '', 'app.db');
        if (fs.existsSync(config.uploadsDir)) zip.addLocalFolder(config.uploadsDir, 'uploads');
        zip.writeZip(target);
        fs.utimesSync(target, at, at);
      } finally {
        fs.rmSync(tmpDb, { force: true });
      }
      prune(config.backupsDir, config.backupKeep);

      if (config.backupCopyDir) {
        try {
          fs.mkdirSync(config.backupCopyDir, { recursive: true });
          const copy = path.join(config.backupCopyDir, path.basename(target));
          fs.copyFileSync(target, copy);
          fs.utimesSync(copy, at, at);
          prune(config.backupCopyDir, config.backupKeep);
          lastCopyError = null;
        } catch (e) {
          lastCopyError = (e as Error).message;
          log(`Не удалось скопировать бэкап в ${config.backupCopyDir}`, e);
        }
      }
      log(`Бэкап создан (${reason}): ${target}`);
      return target;
    },
    list: () => listArchives(config.backupsDir),
    last: () => listArchives(config.backupsDir)[0] ?? null,
    ensureRecent(maxAgeMs = DAY_MS) {
      const last = svc.last();
      if (last && now().getTime() - last.createdAt.getTime() < maxAgeMs) return null;
      return svc.create('startup');
    },
    status: () => ({ last: svc.last(), copyDir: config.backupCopyDir, lastCopyError }),
  };
  return svc;
}
```

`VACUUM INTO ?` с параметром экранирует путь (апостроф, кириллица, пробелы), поэтому имя файла не подставляется в SQL строкой. Время изменения архива выставляется равным `now()`, чтобы ротация и `ensureRecent` работали по часам сервиса, а не файловой системы. Это делает тесты детерминированными.

- [ ] **Step 5: Реализовать восстановление**

`src/server/modules/backup/restore.ts`:

```ts
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import AdmZip from 'adm-zip';
import type { Config } from '../../config';
import { openDb } from '../../db/client';
import { appliedMigrationsCount, codeMigrationsCount, runMigrations } from '../../db/migrate';
import { isLockHeld } from '../../lock';

function isPortFree(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
}

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

export async function restoreBackup(i: {
  archivePath: string;
  config: Config;
  now?: () => Date;
}): Promise<{ preRestoreDir: string }> {
  const { config } = i;
  const now = i.now ?? (() => new Date());

  if (isLockHeld(config.lockPath) || !(await isPortFree(config.host, config.port))) {
    throw new Error('Приложение запущено. Остановите приложение (и задачу автозапуска) и повторите восстановление.');
  }
  if (!fs.existsSync(i.archivePath)) throw new Error(`Файл не найден: ${i.archivePath}`);

  const zip = new AdmZip(i.archivePath);
  const dbEntry = zip.getEntry('app.db');
  if (!dbEntry) throw new Error('В архиве нет app.db — это не бэкап приложения');

  fs.mkdirSync(config.dataDir, { recursive: true });
  const staged = path.join(config.dataDir, `restore-${stamp(now())}.db`);
  fs.writeFileSync(staged, dbEntry.getData());
  {
    const { sqlite } = openDb(staged);
    const applied = appliedMigrationsCount(sqlite);
    const integrity = sqlite.pragma('integrity_check', { simple: true });
    sqlite.close();
    for (const ext of ['-wal', '-shm']) fs.rmSync(staged + ext, { force: true });
    if (applied > codeMigrationsCount()) {
      fs.rmSync(staged, { force: true });
      throw new Error('Бэкап сделан более новой версией приложения (схема новее). Обновите приложение.');
    }
    if (integrity !== 'ok') {
      fs.rmSync(staged, { force: true });
      throw new Error(`Бэкап повреждён: integrity_check = ${String(integrity)}`);
    }
  }

  const preRestoreDir = path.join(config.dataDir, `pre-restore-${stamp(now())}`);
  fs.mkdirSync(preRestoreDir, { recursive: true });
  for (const name of ['app.db', 'app.db-wal', 'app.db-shm']) {
    const p = path.join(config.dataDir, name);
    if (fs.existsSync(p)) fs.renameSync(p, path.join(preRestoreDir, name));
  }
  if (fs.existsSync(config.uploadsDir)) fs.renameSync(config.uploadsDir, path.join(preRestoreDir, 'uploads'));

  fs.renameSync(staged, config.dbPath);
  fs.mkdirSync(config.uploadsDir, { recursive: true });
  for (const entry of zip.getEntries()) {
    if (!entry.entryName.startsWith('uploads/') || entry.isDirectory) continue;
    const rel = entry.entryName.slice('uploads/'.length);
    const target = path.resolve(config.uploadsDir, rel);
    if (!target.startsWith(path.resolve(config.uploadsDir) + path.sep)) continue; // защита от ../ в архиве
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.getData());
  }

  const { sqlite, db } = openDb(config.dbPath);
  runMigrations(db);
  sqlite.prepare('DELETE FROM sessions').run();
  sqlite.close();
  return { preRestoreDir };
}
```

- [ ] **Step 6: Маршруты и скрипты**

`src/server/modules/backup/routes.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { BackupService } from './service';

export function registerBackupRoutes(app: FastifyInstance, deps: { backup: BackupService }): void {
  app.get('/api/v1/backup/download', async (req, reply) => {
    const file = deps.backup.create('manual');
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${path.basename(file)}"`);
    reply.header('X-Content-Type-Options', 'nosniff');
    return reply.send(fs.createReadStream(file));
  });

  app.get('/api/v1/backup/status', async () => {
    const s = deps.backup.status();
    return {
      last: s.last ? { file: s.last.file, createdAt: s.last.createdAt.toISOString(), size: s.last.size } : null,
      copyDir: s.copyDir,
      lastCopyError: s.lastCopyError,
    };
  });
}
```

В `src/server/app.ts` добавьте:

```ts
import { createBackupService } from './modules/backup/service';
import { registerBackupRoutes } from './modules/backup/routes';

  // после registerAuthRoutes(...)
  const backup = createBackupService({ sqlite: deps.sqlite, config, now, log: (m, e) => app.log.info({ err: e }, m) });
  registerBackupRoutes(app, { backup });
```

Добавьте в `tests/server/backup.test.ts` тест маршрута:

```ts
import { createTestApp, loginAs, seedUser } from '../helpers/test-app';

describe('backup routes', () => {
  it('скачивание требует входа и отдаёт zip', async () => {
    const t = await createTestApp();
    try {
      expect((await t.app.inject({ method: 'GET', url: '/api/v1/backup/download' })).statusCode).toBe(401);
      await seedUser(t);
      const cookie = await loginAs(t);
      const res = await t.app.inject({ method: 'GET', url: '/api/v1/backup/download', headers: { cookie } });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/zip');
      expect(res.headers['content-disposition']).toMatch(/attachment; filename="backup-\d{8}-\d{6}\.zip"/);
      const status = await t.app.inject({ method: 'GET', url: '/api/v1/backup/status', headers: { cookie } });
      expect(status.json().last.file).toMatch(/^backup-/);
    } finally {
      await t.cleanup();
    }
  });
});
```

`scripts/backup.ts`:

```ts
import fs from 'node:fs';
import { loadConfig } from '../src/server/config';
import { openDb } from '../src/server/db/client';
import { createBackupService } from '../src/server/modules/backup/service';

if (fs.existsSync('.env')) process.loadEnvFile('.env');
const config = loadConfig();
if (!fs.existsSync(config.dbPath)) {
  console.error(`База не найдена: ${config.dbPath}`);
  process.exit(1);
}
const { sqlite } = openDb(config.dbPath);
try {
  const file = createBackupService({ sqlite, config, log: (m) => console.log(m) }).create('manual');
  console.log(`Готово: ${file}`);
} finally {
  sqlite.close();
}
```

`scripts/restore.ts`:

```ts
import fs from 'node:fs';
import { loadConfig } from '../src/server/config';
import { restoreBackup } from '../src/server/modules/backup/restore';

if (fs.existsSync('.env')) process.loadEnvFile('.env');
const archivePath = process.argv[2];
if (!archivePath) {
  console.error('Использование: npm run restore -- <путь к backup-*.zip>');
  process.exit(1);
}
try {
  const { preRestoreDir } = await restoreBackup({ archivePath, config: loadConfig() });
  console.log('Восстановление завершено. Все пользователи войдут заново.');
  console.log(`Прежние данные сохранены в ${preRestoreDir}`);
  console.log('Запустите приложение: npm start');
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
```

- [ ] **Step 7: Убедиться, что все тесты проходят**

Run: `npm test && npm run typecheck`
Expected: PASS — все тесты, включая 13 новых.

- [ ] **Step 8: Commit**

```bash
git add src/server scripts/backup.ts scripts/restore.ts tests/server
git commit -m "feat: бэкап с вложениями, ротация, копия, восстановление и lock-файл"
```

---

### Task 10: Логи, планировщик и точка входа сервера

**Files:**
- Create: `src/server/logger.ts`, `src/server/jobs/scheduler.ts`, `src/server/main.ts`, `src/server/index.ts`
- Test: `tests/server/main.test.ts`

**Interfaces:**
- Consumes: всё из задач 2–9.
- Produces:
  ```ts
  // logger.ts
  function createLoggerOptions(config: Config): FastifyServerOptions['logger'];
  // jobs/scheduler.ts
  interface Job { name: string; cron: string; run(): void | Promise<void> }
  function startScheduler(o: { timezone: string; jobs: Job[]; log: (msg: string, err?: unknown) => void }): { stop(): void };
  // main.ts
  interface RunningServer { app: FastifyInstance; url: string; stop(): Promise<void> }
  async function startServer(config: Config, opts?: { logger?: FastifyServerOptions['logger']; handleSignals?: boolean }): Promise<RunningServer>;
  const EXIT_LOCK_HELD = 3;
  ```

- [ ] **Step 1: Написать падающий тест**

`tests/server/main.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer } from '../../src/server/main';
import { LockHeldError } from '../../src/server/lock';
import { testConfig } from '../helpers/test-app';

let dir = '';
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('startServer', () => {
  it('создаёт папки, мигрирует, сеет валюты, делает стартовый бэкап и слушает порт', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-main-'));
    const config = testConfig(dir, { PORT: '0' });
    const s = await startServer(config, { logger: false, handleSignals: false });
    try {
      const res = await fetch(`${s.url}/api/v1/health`);
      expect(await res.json()).toEqual({ ok: true });
      expect(fs.readdirSync(config.backupsDir).some((f) => f.startsWith('backup-'))).toBe(true);
      expect(fs.readFileSync(config.lockPath, 'utf8')).toBe(String(process.pid));
    } finally {
      await s.stop();
    }
    expect(fs.existsSync(config.lockPath)).toBe(false);
  });

  it('не стартует второй экземпляр при живом lock', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-main-'));
    const config = testConfig(dir, { PORT: '0' });
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(config.lockPath, String(process.ppid));
    await expect(startServer(config, { logger: false, handleSignals: false })).rejects.toBeInstanceOf(LockHeldError);
  });
});
```

`PORT: '0'` нужен, чтобы ОС выдала свободный порт. Если `loadConfig` отклоняет 0 (`min(1)`), смягчите схему до `min(0)`.

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run tests/server/main.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Разрешить порт 0 в конфигурации**

В `src/server/config.ts` замените `PORT: z.coerce.number().int().min(1).max(65535).default(3000)` на `PORT: z.coerce.number().int().min(0).max(65535).default(3000)`.

- [ ] **Step 4: Реализовать логгер и планировщик**

`src/server/logger.ts`:

```ts
import path from 'node:path';
import type { FastifyServerOptions } from 'fastify';
import type { Config } from './config';

export function createLoggerOptions(config: Config): FastifyServerOptions['logger'] {
  return {
    level: 'info',
    redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
    transport: {
      targets: [
        { target: 'pino-pretty', options: { translateTime: 'SYS:yyyy-mm-dd HH:MM:ss', ignore: 'pid,hostname' } },
        {
          target: 'pino-roll',
          options: { file: path.join(config.logsDir, 'app'), size: '10m', limit: { count: 7 }, mkdir: true, extension: '.log' },
        },
      ],
    },
  };
}
```

`src/server/jobs/scheduler.ts`:

```ts
import { Cron } from 'croner';

export interface Job {
  name: string;
  cron: string;
  run(): void | Promise<void>;
}

export function startScheduler(o: {
  timezone: string;
  jobs: Job[];
  log: (msg: string, err?: unknown) => void;
}): { stop(): void } {
  const crons = o.jobs.map(
    (job) =>
      new Cron(job.cron, { timezone: o.timezone, protect: true }, async () => {
        try {
          await job.run();
        } catch (e) {
          o.log(`Задача «${job.name}» завершилась с ошибкой`, e);
        }
      }),
  );
  return { stop: () => crons.forEach((c) => c.stop()) };
}
```

- [ ] **Step 5: Реализовать `main.ts` и `index.ts`**

`src/server/main.ts`:

```ts
import fs from 'node:fs';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { buildApp } from './app';
import type { Config } from './config';
import { openDb } from './db/client';
import { appliedMigrationsCount, codeMigrationsCount, runMigrations } from './db/migrate';
import { seedCurrencies } from './db/seed';
import { startScheduler } from './jobs/scheduler';
import { acquireLock } from './lock';
import { createLoggerOptions } from './logger';
import { createBackupService } from './modules/backup/service';

export const EXIT_LOCK_HELD = 3;

export interface RunningServer {
  app: FastifyInstance;
  url: string;
  stop(): Promise<void>;
}

export async function startServer(
  config: Config,
  opts: { logger?: FastifyServerOptions['logger']; handleSignals?: boolean } = {},
): Promise<RunningServer> {
  for (const d of [config.dataDir, config.uploadsDir, config.backupsDir, config.logsDir]) fs.mkdirSync(d, { recursive: true });
  const releaseLock = acquireLock(config.lockPath);

  const dbExisted = fs.existsSync(config.dbPath);
  const { sqlite, db } = openDb(config.dbPath);
  const log = (m: string, e?: unknown) => (e ? console.error(m, e) : console.log(m));
  const backup = createBackupService({ sqlite, config, log });

  const applied = appliedMigrationsCount(sqlite);
  if (dbExisted && applied > 0 && applied < codeMigrationsCount()) backup.create('pre-migration');
  runMigrations(db);
  seedCurrencies(db);
  backup.ensureRecent();

  const app = await buildApp({ config, db, sqlite, logger: opts.logger ?? createLoggerOptions(config) });
  const scheduler = startScheduler({
    timezone: config.timezone,
    log: (m, e) => app.log.error({ err: e }, m),
    jobs: [{ name: 'daily-backup', cron: '0 4 * * *', run: () => void backup.create('daily') }],
  });

  await app.listen({ host: config.host, port: config.port });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : config.port;
  const url = `http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${port}`;
  if (config.host === '0.0.0.0') {
    app.log.warn('HOST=0.0.0.0: приложение доступно в локальной сети по HTTP без шифрования');
  }

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    scheduler.stop();
    const timer = setTimeout(() => process.exit(1), 10_000);
    timer.unref();
    await app.close();
    sqlite.close();
    releaseLock();
    clearTimeout(timer);
  };

  if (opts.handleSignals ?? true) {
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) {
      process.on(sig, () => {
        void stop().then(() => process.exit(0));
      });
    }
  }
  return { app, url, stop };
}
```

`src/server/index.ts`:

```ts
import fs from 'node:fs';
import { loadConfig } from './config';
import { LockHeldError } from './lock';
import { EXIT_LOCK_HELD, startServer } from './main';

if (fs.existsSync('.env')) process.loadEnvFile('.env');

try {
  const s = await startServer(loadConfig());
  s.app.log.info(`Сервер запущен: ${s.url}`);
} catch (e) {
  if (e instanceof LockHeldError) {
    console.error(e.message);
    process.exit(EXIT_LOCK_HELD);
  }
  console.error(e);
  process.exit(1);
}
```

- [ ] **Step 6: Убедиться, что тесты проходят**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Проверить запуск вручную**

Run (PowerShell): `$env:SESSION_SECRET='x'*40; $env:DATA_DIR="$env:TEMP\fc-run"; npx tsx src/server/index.ts`
Expected: в консоли «Сервер запущен: http://127.0.0.1:3000», появились `%TEMP%\fc-run\logs\app*.log` и `backups\backup-*.zip`. Запуск второго экземпляра в другом окне печатает «Приложение уже запущено (PID …)» и завершается с кодом 3. После Ctrl+C в первом окне файл `app.lock` удалён.

- [ ] **Step 8: Commit**

```bash
git add src/server tests/server/main.test.ts
git commit -m "feat: точка входа сервера, логи с ротацией, планировщик и корректное завершение"
```

---

### Task 11: Клиентская оболочка и раздача SPA

**Files:**
- Create: `vite.config.ts`, `src/client/index.html`, `src/client/main.tsx`, `src/client/styles.css`, `src/client/router.tsx`, `src/client/lib/api.ts`, `src/client/lib/query.ts`, `src/client/pages/LoginPage.tsx`, `src/client/pages/AppShell.tsx`
- Modify: `src/server/app.ts` (раздача `dist/client` с SPA-fallback)
- Test: `tests/server/spa.test.ts`

**Interfaces:**
- Consumes: `/api/v1/meta`, `/api/v1/auth/login|logout|me` (задачи 4, 7).
- Produces:
  ```ts
  // src/client/lib/api.ts
  class ApiError extends Error { status: number; code: string; fields?: Record<string, string> }
  async function api<T>(path: string, opts?: { method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown }): Promise<T>;
  // src/client/lib/query.ts
  const queryClient: QueryClient;
  function useMe(): UseQueryResult<{ user: { id: number; login: string; name: string } }, ApiError>;
  function useMeta(): UseQueryResult<{ appName: string }, ApiError>;
  ```
  `buildApp` принимает `clientDir?: string` в `AppDeps` (по умолчанию `<cwd>/dist/client`) и раздаёт его, если папка существует.

- [ ] **Step 1: Написать падающий тест раздачи SPA**

`tests/server/spa.test.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server/app';
import { createTestDb } from '../helpers/test-db';
import { testConfig } from '../helpers/test-app';

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => cleanup?.());

describe('SPA', () => {
  it('отдаёт index.html для клиентских маршрутов и JSON 404 для /api', async () => {
    const t = createTestDb();
    const clientDir = path.join(t.dir, 'client');
    fs.mkdirSync(path.join(clientDir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(clientDir, 'index.html'), '<!doctype html><title>SPA</title>');
    fs.writeFileSync(path.join(clientDir, 'assets', 'app.js'), 'console.log(1)');
    const app = await buildApp({ config: testConfig(t.dir), db: t.db, sqlite: t.sqlite, clientDir });
    cleanup = async () => {
      await app.close();
      t.cleanup();
    };

    const page = await app.inject({ method: 'GET', url: '/c/1/log' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<title>SPA</title>');

    const asset = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(asset.body).toBe('console.log(1)');

    const api = await app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(api.statusCode).toBe(404);
    expect(api.json().error.code).toBe('NOT_FOUND');
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run tests/server/spa.test.ts`
Expected: FAIL — `/c/1/log` отдаёт 404 JSON.

- [ ] **Step 3: Раздача SPA в `src/server/app.ts`**

Добавьте в `AppDeps` поле `clientDir?: string;`. Перед `deps.extraRoutes?.(app)` вставьте:

```ts
import fs from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';

  const clientDir = deps.clientDir ?? path.resolve('dist', 'client');
  if (fs.existsSync(path.join(clientDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: clientDir, prefix: '/', wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.method !== 'GET') {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Не найдено' } });
      }
      return reply.type('text/html').sendFile('index.html');
    });
  }
```

`setNotFoundHandler` из `registerErrorHandler` остаётся для случая без собранного клиента (тесты API). Fastify разрешает переопределить обработчик 404 в том же контексте только один раз. Поэтому перенесите вызов `app.setNotFoundHandler(...)` из `registerErrorHandler` в `buildApp`: в ветку `else` этого `if`. Итог:

```ts
  if (fs.existsSync(path.join(clientDir, 'index.html'))) {
    // ... как выше
  } else {
    app.setNotFoundHandler((req, reply) =>
      reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Не найдено' } }),
    );
  }
```

и удалите `setNotFoundHandler` из `src/server/errors.ts`.

- [ ] **Step 4: Убедиться, что серверные тесты проходят**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Vite и точка входа клиента**

`vite.config.ts`:

```ts
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/client',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../../dist/client', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        headers: { origin: 'http://localhost:3000' },
      },
    },
  },
});
```

Прокси переписывает `Origin` на `http://localhost:3000`: этот origin всегда разрешён CSRF-защитой. Так `npm run dev` работает без правки `.env`.

`src/client/index.html`:

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Учёт</title>
  </head>
  <body class="bg-canvas text-ink antialiased">
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`src/client/styles.css` (единственное место, где заданы цвета):

```css
@import 'tailwindcss';

@theme {
  --font-sans: 'Inter', ui-sans-serif, system-ui, 'Segoe UI', Roboto, sans-serif;
  --color-chrome: #16181d; /* графитовая шапка */
  --color-chrome-2: #23262d;
  --color-canvas: #eef1f4; /* фон вокруг карточек */
  --color-card: #ffffff;
  --color-field: #edf1f5; /* поля ввода без рамки */
  --color-ink: #14161a;
  --color-muted: #6b7280;
  --color-income: #0f9d6b;
  --color-income-soft: #dff5ec;
  --color-expense: #e2553f;
  --color-expense-soft: #fde7e2;
  --color-transfer: #5b6270;
  --color-focus: #2bb3a0;
}
```

`src/client/lib/api.ts`:

```ts
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(
  path: string,
  opts: { method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: opts.method ?? 'GET',
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'fetch',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Нет связи с сервером');
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string; fields?: Record<string, string> } } | null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? 'INTERNAL', data?.error?.message ?? 'Ошибка сервера', data?.error?.fields);
  }
  return data as T;
}
```

`src/client/lib/query.ts`:

```ts
import { QueryClient, useQuery } from '@tanstack/react-query';
import { api, ApiError } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});

export interface Me {
  user: { id: number; login: string; name: string };
}

export function useMe() {
  return useQuery<Me, ApiError>({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me') });
}

export function useMeta() {
  return useQuery<{ appName: string }, ApiError>({
    queryKey: ['meta'],
    queryFn: () => api('/meta'),
    staleTime: Infinity,
  });
}
```

- [ ] **Step 6: Страницы и маршрутизация**

`src/client/pages/LoginPage.tsx`:

```tsx
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError } from '../lib/api';
import { queryClient, useMeta, type Me } from '../lib/query';

export function LoginPage() {
  const navigate = useNavigate();
  const meta = useMeta();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    if (meta.data) document.title = `Вход — ${meta.data.appName}`;
  }, [meta.data]);

  const mutation = useMutation<Me, ApiError>({
    mutationFn: () => api<Me>('/auth/login', { method: 'POST', body: { login, password, remember } }),
    onSuccess: (me) => {
      queryClient.setQueryData(['me'], me);
      navigate('/', { replace: true });
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };

  const err = mutation.error;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-chrome px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-3xl bg-card p-8 shadow-xl">
        <h1 className="mb-6 text-3xl font-bold">{meta.data?.appName ?? ''}</h1>
        <label className="mb-3 block">
          <span className="sr-only">Логин</span>
          <input
            autoFocus
            autoComplete="username"
            placeholder="Логин"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            className="w-full rounded-xl bg-field px-4 py-3 outline-none focus:ring-2 focus:ring-focus"
          />
        </label>
        <label className="mb-3 block">
          <span className="sr-only">Пароль</span>
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Пароль"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl bg-field px-4 py-3 outline-none focus:ring-2 focus:ring-focus"
          />
        </label>
        <label className="mb-5 flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Запомнить меня на 30 дней
        </label>
        {err && (
          <p role="alert" className="mb-4 rounded-xl bg-expense-soft px-4 py-3 text-sm text-expense">
            {err.fields ? Object.values(err.fields).join('. ') : err.message}
          </p>
        )}
        <button
          type="submit"
          disabled={mutation.isPending || !login || !password}
          className="w-full rounded-xl bg-income py-3 font-semibold text-white disabled:opacity-50"
        >
          {mutation.isPending ? 'Входим…' : 'Войти'}
        </button>
      </form>
    </main>
  );
}
```

`src/client/pages/AppShell.tsx`:

```tsx
import { useMutation } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { api } from '../lib/api';
import { queryClient, useMe, useMeta } from '../lib/query';

export function AppShell() {
  const me = useMe();
  const meta = useMeta();
  const navigate = useNavigate();
  const logout = useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      queryClient.clear();
      navigate('/login', { replace: true });
    },
  });

  useEffect(() => {
    if (meta.data) document.title = meta.data.appName;
  }, [meta.data]);

  if (me.isPending) return <div className="p-8 text-muted">Загрузка…</div>;
  if (me.error?.status === 401) return <Navigate to="/login" replace />;
  if (me.error) return <div className="p-8 text-expense">{me.error.message}</div>;

  return (
    <div className="min-h-dvh bg-chrome">
      <header className="flex items-center justify-between px-6 py-4 text-white">
        <span className="text-lg font-bold">{meta.data?.appName}</span>
        <div className="flex items-center gap-4">
          <span className="text-sm text-white/70">{me.data.user.name}</span>
          <button
            onClick={() => logout.mutate()}
            className="rounded-xl bg-chrome-2 px-4 py-2 text-sm hover:bg-white/10"
          >
            Выйти
          </button>
        </div>
      </header>
      <main className="mx-4 min-h-[calc(100dvh-5rem)] rounded-t-3xl bg-card p-8">
        <h1 className="text-2xl font-bold">Журнал</h1>
        <p className="mt-2 text-muted">Журнал операций появится на следующих шагах.</p>
      </main>
    </div>
  );
}
```

`src/client/router.tsx`:

```tsx
import { createBrowserRouter } from 'react-router';
import { AppShell } from './pages/AppShell';
import { LoginPage } from './pages/LoginPage';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '*', element: <AppShell /> },
]);
```

`src/client/main.tsx`:

```tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { queryClient } from './lib/query';
import { router } from './router';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
```

- [ ] **Step 7: Собрать клиент и проверить вручную**

Run: `npm run build:client && npm run typecheck`
Expected: собранный клиент лежит в `dist/client/index.html` и `dist/client/assets/*`; ошибок типов нет.

Run (PowerShell): `$env:SESSION_SECRET='x'*40; $env:DATA_DIR="$env:TEMP\fc-run"; npx tsx src/server/index.ts`, затем открыть `http://localhost:3000`.
Expected:
- редирект на `/login`;
- вход пользователем из задачи 6 открывает графитовую шапку с названием «Учёт», именем пользователя и кнопкой «Выйти»;
- неверный пароль показывает «Неверный логин или пароль»;
- после 5 ошибок появляется «Слишком много попыток входа…»;
- «Выйти» возвращает на `/login`.

- [ ] **Step 8: Commit**

```bash
git add vite.config.ts src/client src/server tests/server/spa.test.ts
git commit -m "feat: клиентская оболочка (вход, шапка, выход) и раздача SPA"
```

---

### Task 12: Установка, супервизор и туннели

**Files:**
- Create: `scripts/lib/env-file.ts`, `scripts/lib/cloudflared.ts`, `scripts/lib/client-build.ts`, `scripts/setup.ts`, `scripts/run.ts`, `setup.cmd`, `setup.sh`
- Test: `tests/server/env-file.test.ts`, `tests/server/cloudflared.test.ts`, `tests/server/client-build.test.ts`

**Interfaces:**
- Consumes: `loadConfig`, `Config` (задача 2); `openDb`, `runMigrations`, `seedCurrencies` (задача 3); `createUsersService` (задача 6); `createPrompt` (задача 6); `EXIT_LOCK_HELD` (задача 10); `scripts/cloudflared-pins.json` (задача 1).
- Produces:
  ```ts
  // env-file.ts
  function parseEnv(text: string): Map<string, string>;
  function updateEnvText(text: string, updates: Record<string, string>): string; // сохраняет комментарии и порядок
  // cloudflared.ts
  interface Pins { version: string; assets: Record<string, { url: string; sha256: string }> }
  function platformKey(): string; // 'win32-x64' | 'linux-x64'
  function cloudflaredTarget(binDir: string): string;
  async function ensureCloudflared(o: { binDir: string; pins: Pins; customPath: string | null;
    fetchImpl?: typeof fetch }): Promise<string>;
  // client-build.ts
  function needsClientBuild(root: string): boolean;
  ```

- [ ] **Step 1: Написать падающие тесты**

`tests/server/env-file.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseEnv, updateEnvText } from '../../scripts/lib/env-file';

describe('env-file', () => {
  it('парсит KEY=VALUE, игнорирует комментарии и кавычки', () => {
    const m = parseEnv('# c\nA=1\nB="два слова"\n\nC=\n');
    expect([...m]).toEqual([['A', '1'], ['B', 'два слова'], ['C', '']]);
  });

  it('обновляет существующие ключи на месте и дописывает новые, сохраняя комментарии', () => {
    const out = updateEnvText('# Порт\nPORT=3000\nAPP_NAME=Учёт\n', { PORT: '3100', SESSION_SECRET: 'abc' });
    expect(out).toBe('# Порт\nPORT=3100\nAPP_NAME=Учёт\nSESSION_SECRET=abc\n');
  });
});
```

`tests/server/cloudflared.test.ts`:

```ts
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cloudflaredTarget, ensureCloudflared, platformKey } from '../../scripts/lib/cloudflared';

const body = Buffer.from('fake-binary');
const sha = crypto.createHash('sha256').update(body).digest('hex');
const pins = (hash: string) => ({ version: '1', assets: { [platformKey()]: { url: 'https://example/bin', sha256: hash } } });
const fakeFetch = (async () => new Response(body)) as typeof fetch;

describe('ensureCloudflared', () => {
  it('скачивает, проверяет SHA-256 и кладёт в binDir', async () => {
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-bin-'));
    const p = await ensureCloudflared({ binDir, pins: pins(sha), customPath: null, fetchImpl: fakeFetch });
    expect(p).toBe(cloudflaredTarget(binDir));
    expect(fs.readFileSync(p)).toEqual(body);
  });

  it('не скачивает повторно, если файл с верным хэшем уже есть', async () => {
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-bin-'));
    fs.writeFileSync(cloudflaredTarget(binDir), body);
    const failingFetch = (async () => {
      throw new Error('не должен вызываться');
    }) as typeof fetch;
    await expect(ensureCloudflared({ binDir, pins: pins(sha), customPath: null, fetchImpl: failingFetch })).resolves.toBe(
      cloudflaredTarget(binDir),
    );
  });

  it('отклоняет файл с неверным хэшем и не оставляет его на диске', async () => {
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-bin-'));
    await expect(ensureCloudflared({ binDir, pins: pins('0'.repeat(64)), customPath: null, fetchImpl: fakeFetch })).rejects.toThrow(
      /SHA-256/,
    );
    expect(fs.existsSync(cloudflaredTarget(binDir))).toBe(false);
  });

  it('CLOUDFLARED_PATH имеет приоритет', async () => {
    const custom = path.join(os.tmpdir(), 'my-cloudflared');
    fs.writeFileSync(custom, 'x');
    await expect(ensureCloudflared({ binDir: 'unused', pins: pins(sha), customPath: custom })).resolves.toBe(custom);
  });
});
```

`tests/server/client-build.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { needsClientBuild } from '../../scripts/lib/client-build';

function tree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-cb-'));
  for (const d of ['src/client', 'src/shared', 'dist/client']) fs.mkdirSync(path.join(root, d), { recursive: true });
  return root;
}
const touch = (p: string, t: number) => {
  fs.writeFileSync(p, 'x');
  fs.utimesSync(p, t, t);
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
    expect(needsClientBuild(root)).toBe(false);
    touch(path.join(root, 'src/shared/currencies.ts'), 3000);
    expect(needsClientBuild(root)).toBe(true);
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run tests/server/env-file.test.ts tests/server/cloudflared.test.ts tests/server/client-build.test.ts`
Expected: FAIL — модули не найдены.

- [ ] **Step 3: Реализовать библиотеки скриптов**

`scripts/lib/env-file.ts`:

```ts
const LINE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/;

function unquote(v: string): string {
  const m = v.match(/^"(.*)"$/) ?? v.match(/^'(.*)'$/);
  return m ? m[1]! : v;
}

export function parseEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = line.match(LINE);
    if (m) out.set(m[1]!, unquote(m[2]!));
  }
  return out;
}

export function updateEnvText(text: string, updates: Record<string, string>): string {
  const pending = new Map(Object.entries(updates));
  const lines = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  const result = lines.map((line) => {
    const m = line.match(LINE);
    if (m && !/^\s*#/.test(line) && pending.has(m[1]!)) {
      const v = pending.get(m[1]!)!;
      pending.delete(m[1]!);
      return `${m[1]}=${v}`;
    }
    return line;
  });
  for (const [k, v] of pending) result.push(`${k}=${v}`);
  return result.filter((l, i) => !(i === 0 && l === '' && result.length === 1)).join('\n') + '\n';
}
```

`scripts/lib/cloudflared.ts`:

```ts
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface Pins {
  version: string;
  assets: Record<string, { url: string; sha256: string }>;
}

export function platformKey(): string {
  return `${process.platform}-${process.arch}`;
}

export function cloudflaredTarget(binDir: string): string {
  return path.join(binDir, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
}

const sha256 = (buf: Buffer) => crypto.createHash('sha256').update(buf).digest('hex');

export async function ensureCloudflared(o: {
  binDir: string;
  pins: Pins;
  customPath: string | null;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  if (o.customPath) {
    if (!fs.existsSync(o.customPath)) throw new Error(`CLOUDFLARED_PATH не найден: ${o.customPath}`);
    return o.customPath;
  }
  const asset = o.pins.assets[platformKey()];
  if (!asset) throw new Error(`Нет закреплённой сборки cloudflared для платформы ${platformKey()}. Укажите CLOUDFLARED_PATH.`);

  const target = cloudflaredTarget(o.binDir);
  if (fs.existsSync(target) && sha256(fs.readFileSync(target)) === asset.sha256) return target;

  const res = await (o.fetchImpl ?? fetch)(asset.url);
  if (!res.ok) throw new Error(`Не удалось скачать cloudflared: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const actual = sha256(buf);
  if (actual !== asset.sha256) {
    throw new Error(`SHA-256 cloudflared не совпадает (ожидалось ${asset.sha256}, получено ${actual}). Файл отклонён.`);
  }
  fs.mkdirSync(o.binDir, { recursive: true });
  fs.writeFileSync(target, buf, { mode: 0o755 });
  return target;
}
```

`scripts/lib/client-build.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';

function newestMtime(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let max = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    max = Math.max(max, entry.isDirectory() ? newestMtime(p) : fs.statSync(p).mtimeMs);
  }
  return max;
}

export function needsClientBuild(root: string): boolean {
  const index = path.join(root, 'dist', 'client', 'index.html');
  if (!fs.existsSync(index)) return true;
  const built = fs.statSync(index).mtimeMs;
  const sources = Math.max(newestMtime(path.join(root, 'src', 'client')), newestMtime(path.join(root, 'src', 'shared')));
  return sources > built;
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npx vitest run tests/server/env-file.test.ts tests/server/cloudflared.test.ts tests/server/client-build.test.ts && npm run typecheck`
Expected: PASS (8 тестов).

- [ ] **Step 5: Реализовать `scripts/setup.ts`**

```ts
import crypto from 'node:crypto';
import fs from 'node:fs';
import { loadConfig } from '../src/server/config';
import { openDb } from '../src/server/db/client';
import { runMigrations } from '../src/server/db/migrate';
import { seedCurrencies } from '../src/server/db/seed';
import { AppError } from '../src/server/errors';
import { createAuditService } from '../src/server/modules/audit/service';
import { createUsersService } from '../src/server/modules/users/service';
import { ensureCloudflared, type Pins } from './lib/cloudflared';
import { parseEnv, updateEnvText } from './lib/env-file';
import { createPrompt } from './lib/prompt';

const prompt = createPrompt();
const envText = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : fs.readFileSync('.env.example', 'utf8');
const current = parseEnv(envText);
const updates: Record<string, string> = {};

if (!current.get('SESSION_SECRET')) updates.SESSION_SECRET = crypto.randomBytes(48).toString('base64url');

console.log('Режимы: local — только этот компьютер; cloudflare — свой домен через Cloudflare Tunnel;');
console.log('        ngrok — статический домен ngrok; vps — сервер с Caddy.');
let mode = '';
while (!['local', 'cloudflare', 'ngrok', 'vps'].includes(mode)) {
  mode = await prompt.ask('Режим развёртывания', current.get('DEPLOY_MODE') || 'local');
}
updates.DEPLOY_MODE = mode;

if (mode === 'cloudflare') {
  const host = await prompt.ask('Адрес сайта (например fin.example.kz)', current.get('PUBLIC_URL')?.replace(/^https:\/\//, ''));
  updates.PUBLIC_URL = `https://${host.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  updates.CF_TUNNEL_TOKEN = (await prompt.askSecret('Токен туннеля Cloudflare (Zero Trust → Tunnels)')) || current.get('CF_TUNNEL_TOKEN') || '';
} else if (mode === 'ngrok') {
  updates.NGROK_AUTHTOKEN = (await prompt.askSecret('NGROK_AUTHTOKEN')) || current.get('NGROK_AUTHTOKEN') || '';
  const domain = await prompt.ask('Статический домен ngrok (xxx.ngrok-free.app)', current.get('NGROK_DOMAIN'));
  updates.NGROK_DOMAIN = domain;
  updates.PUBLIC_URL = `https://${domain}`;
} else if (mode === 'vps') {
  const host = await prompt.ask('Домен сайта (например fin.example.kz)', current.get('PUBLIC_URL')?.replace(/^https:\/\//, ''));
  updates.PUBLIC_URL = `https://${host.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
} else {
  updates.PUBLIC_URL = '';
}

fs.writeFileSync('.env', updateEnvText(envText, updates));
process.loadEnvFile('.env');
const config = loadConfig();
fs.mkdirSync(config.dataDir, { recursive: true });

if (mode === 'cloudflare') {
  const pins = JSON.parse(fs.readFileSync('scripts/cloudflared-pins.json', 'utf8')) as Pins;
  const p = await ensureCloudflared({ binDir: config.binDir, pins, customPath: config.cloudflaredPath });
  console.log(`cloudflared готов: ${p}`);
}

const { sqlite, db } = openDb(config.dbPath);
runMigrations(db);
seedCurrencies(db);
const users = createUsersService(db, createAuditService(db));
if (users.count() === 0) {
  console.log('Создаём первого пользователя.');
  for (;;) {
    try {
      const login = await prompt.ask('Логин');
      const name = await prompt.ask('Имя', login);
      const password = await prompt.askSecret('Пароль (не короче 10 символов)');
      if (password !== (await prompt.askSecret('Повторите пароль'))) {
        console.log('Пароли не совпадают.');
        continue;
      }
      await users.create({ login, name, password }, null);
      break;
    } catch (e) {
      console.log(e instanceof AppError && e.fields ? Object.values(e.fields).join('\n') : (e as Error).message);
    }
  }
}
sqlite.close();
prompt.close();
console.log('\nГотово. Запуск: npm start');
console.log(`Адрес: ${config.publicUrl}`);
```

`setup.cmd`:

```bat
@echo off
call npm ci || exit /b 1
call npm run setup
```

`setup.sh`:

```sh
#!/usr/bin/env sh
set -e
npm ci
npm run setup
```

- [ ] **Step 6: Реализовать супервизор `scripts/run.ts`**

```ts
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { loadConfig } from '../src/server/config';
import { EXIT_LOCK_HELD } from '../src/server/main';
import { cloudflaredTarget } from './lib/cloudflared';
import { needsClientBuild } from './lib/client-build';

if (fs.existsSync('.env')) process.loadEnvFile('.env');
const config = loadConfig();

if (needsClientBuild(process.cwd())) {
  console.log('Собираем интерфейс…');
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:client'], { stdio: 'inherit', shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

let shuttingDown = false;
const children: ChildProcess[] = [];

function supervise(name: string, start: () => ChildProcess, onExit?: (code: number | null) => boolean): void {
  let delay = 1000;
  const launch = () => {
    const startedAt = Date.now();
    const child = start();
    children.push(child);
    child.on('exit', (code) => {
      children.splice(children.indexOf(child), 1);
      if (shuttingDown) return;
      if (onExit && !onExit(code)) return;
      if (Date.now() - startedAt > 60_000) delay = 1000;
      console.error(`[${name}] завершился с кодом ${code}; перезапуск через ${delay / 1000} с`);
      setTimeout(launch, delay);
      delay = Math.min(delay * 2, 60_000);
    });
  };
  launch();
}

supervise(
  'server',
  () => spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], { stdio: 'inherit' }),
  (code) => {
    if (code === EXIT_LOCK_HELD) {
      console.error('Приложение уже запущено другим процессом. Супервизор завершает работу.');
      shutdown(1);
      return false;
    }
    return true;
  },
);

if (config.deployMode === 'cloudflare') {
  const bin = config.cloudflaredPath ?? cloudflaredTarget(config.binDir);
  if (!fs.existsSync(bin)) {
    console.error(`cloudflared не найден (${bin}). Запустите npm run setup.`);
    shutdown(1);
  }
  supervise('cloudflared', () =>
    spawn(bin, ['tunnel', '--no-autoupdate', 'run'], {
      stdio: 'inherit',
      env: { ...process.env, TUNNEL_TOKEN: config.cfTunnelToken ?? '' },
    }),
  );
  console.log(`Публичный адрес: ${config.publicUrl}`);
}

if (config.deployMode === 'ngrok') {
  const ngrok = await import('@ngrok/ngrok');
  const listener = await ngrok.forward({
    addr: config.port,
    authtoken: config.ngrokAuthtoken ?? undefined,
    domain: config.ngrokDomain ?? undefined,
  });
  console.log(`Публичный адрес: ${listener.url()}`);
}

function shutdown(code = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 11_000).unref();
  Promise.all(children.map((c) => new Promise((r) => c.once('exit', r)))).then(() => process.exit(code));
}

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) process.on(sig, () => shutdown(0));
```

- [ ] **Step 7: Проверить вручную**

На Windows в чистой копии репозитория:
1. `setup.cmd` → выбрать `local`, создать пользователя. Expected: появились `.env` (с `SESSION_SECRET`) и `data\app.db`.
2. `npm start`. Expected: при первом запуске «Собираем интерфейс…», затем «Сервер запущен: http://127.0.0.1:3000»; вход работает.
3. В диспетчере задач завершить процесс `node` сервера (не супервизора). Expected: «[server] завершился… перезапуск через 1 с», сайт снова доступен.
4. Ctrl+C. Expected: оба процесса завершились, `data\app.lock` удалён.
5. Повторить `npm run setup` с режимом `cloudflare` и токеном из спайка. Expected: `data\bin\cloudflared.exe` скачан; `npm start` печатает публичный адрес; сайт открывается с телефона по HTTPS, вход работает, кука `Secure`.
6. Режим `ngrok` с доменом из спайка. Expected: «Публичный адрес: https://<домен>», сайт открывается с телефона.

- [ ] **Step 8: Commit**

```bash
git add scripts setup.cmd setup.sh tests/server/env-file.test.ts tests/server/cloudflared.test.ts tests/server/client-build.test.ts
git commit -m "feat: setup, супервизор с перезапуском и туннели cloudflare/ngrok"
```

---

### Task 13: E2E: вход и выход

**Files:**
- Create: `playwright.config.ts`, `e2e/server.ts`, `e2e/auth.spec.ts`

**Interfaces:**
- Consumes: `startServer` (задача 10), `createUsersService` (задача 6), собранный клиент (задача 11).
- Produces: команду `npm run test:e2e`; шаблон тестового сервера для E2E следующих планов: порт 3100, пользователь `admin` / `e2e-password-1`.

- [ ] **Step 1: Конфигурация и тестовый сервер**

```bash
npx playwright install chromium
```

`playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:3100', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build:client && npx tsx e2e/server.ts',
    url: 'http://localhost:3100/api/v1/health',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
```

`e2e/server.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/server/config';
import { openDb } from '../src/server/db/client';
import { runMigrations } from '../src/server/db/migrate';
import { startServer } from '../src/server/main';
import { createAuditService } from '../src/server/modules/audit/service';
import { createUsersService } from '../src/server/modules/users/service';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-e2e-'));
const config = loadConfig({
  SESSION_SECRET: 'e'.repeat(40),
  DATA_DIR: dataDir,
  PORT: '3100',
  RATES_SOURCE: 'fixtures',
});
fs.mkdirSync(config.dataDir, { recursive: true });
{
  const { sqlite, db } = openDb(config.dbPath);
  runMigrations(db);
  await createUsersService(db, createAuditService(db)).create({ login: 'admin', name: 'Админ', password: 'e2e-password-1' }, null);
  sqlite.close();
}
await startServer(config, { logger: false });
console.log('E2E server ready');
```

- [ ] **Step 2: Написать тест**

`e2e/auth.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('вход, неверный пароль, выход', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);

  await page.getByPlaceholder('Логин').fill('admin');
  await page.getByPlaceholder('Пароль').fill('wrong-password');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('alert')).toHaveText('Неверный логин или пароль');

  await page.getByPlaceholder('Пароль').fill('e2e-password-1');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('heading', { name: 'Журнал' })).toBeVisible();
  await expect(page.getByText('Админ')).toBeVisible();
  await expect(page).toHaveTitle('Учёт');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Журнал' })).toBeVisible(); // сессия переживает перезагрузку

  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});
```

- [ ] **Step 3: Запустить E2E**

Run: `npm run test:e2e`
Expected: PASS (1 тест). Если тест падает, причину ищут в `test-results/` (trace) и исправляют код, а не тест.

- [ ] **Step 4: Финальная проверка шага**

Run: `npm test && npm run typecheck && npm run test:e2e`
Expected: всё зелёное.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts e2e
git commit -m "test: e2e входа и выхода"
```

---

## После этого плана

Готов шаг 1 §11. Следующий план, `2026-xx-xx-stage1-plan2-companies-templates.md`, покрывает шаг 2: схему и сервисы категорий и счетов, компании, проекты, систему шаблонов `general` и `computer-club`, переключатель компаний. Он пишется после того, как этот план выполнен и учтены выводы спайка.
