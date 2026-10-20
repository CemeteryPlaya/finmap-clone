import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { builtinModules } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { buildServer } from '../../scripts/lib/build-server';
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

describe('vercel.json (план 2026-10-20-vercel-postgres, задача 13)', () => {
  const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8')) as {
    regions: string[];
    buildCommand: string;
    functions?: unknown;
    rewrites?: unknown;
    crons: { path: string; schedule: string }[];
  };

  // длительность функции — по умолчанию Fluid compute (300 с на Hobby): ключ functions для точки входа Fastify Vercel не принимает
  it('Франкфурт, сборка с миграциями, ежедневное задание в 04:00 по Алматы; длительность — по умолчанию Fluid compute', () => {
    expect(vercel.regions).toEqual(['fra1']);
    expect(vercel.buildCommand).toBe('npm run vercel-build');
    expect(vercel.functions).toBeUndefined();
    expect(vercel.crons).toEqual([{ path: '/api/v1/cron/daily', schedule: '0 23 * * *' }]);
    expect(JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts['vercel-build']).toBe('vite build && tsx scripts/migrate.ts && tsx scripts/build-server.ts');
  });

  it('интерфейс и его пути отдаёт функция (Vercel не отдаёт public/ у Fastify): правил rewrites нет', () => {
    expect(vercel.rewrites).toBeUndefined();
  });
});

describe('сборка функции Vercel: server.mjs (план 2026-10-20-vercel-postgres, задача 13)', () => {
  /**
   * Загрузчик функций Vercel не умеет require() ES-модулей (Node 24 умеет — локально ошибки не видно): CommonJS-пакеты,
   * подключающие ESM-only зависимости (@fastify/static → content-disposition, light-my-request и @fastify/cookie → cookie),
   * роняли функцию ERR_REQUIRE_ESM. Поэтому все JS-пакеты — внутри бандла; снаружи — только бинарные и WASM.
   */
  const ALLOWED_EXTERNAL = new Set(['better-sqlite3', '@node-rs/argon2', '@electric-sql/pglite', 'pino-pretty', 'pino-roll', 'bufferutil', 'utf-8-validate']);

  it('один ESM-файл: снаружи только встроенные модули Node и бинарные пакеты; Vercel узнаёт в нём приложение Fastify', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-build-server-'));
    try {
      const out = path.join(dir, 'server.mjs');
      const { externals } = await buildServer(out);
      const code = fs.readFileSync(out, 'utf8');
      // распознавание точки входа Vercel (@vercel/fastify): эта строка в тексте файла
      expect(code).toMatch(/(?:from|require|import)\s*(?:\(\s*)?["']fastify["']\s*(?:\))?/);
      expect(code).not.toMatch(/from ["']\.\.?\//); // относительных импортов нет — весь код приложения в файле
      expect(code).toContain('createServerlessApp');
      // внешние импорты бандла (metafile esbuild): встроенные модули Node и пакеты из списка — больше ничего
      const packages = externals
        .filter((sp) => !sp.startsWith('node:') && !builtinModules.includes(sp.split('/')[0]!))
        .map((sp) => (sp.startsWith('@') ? sp.split('/').slice(0, 2).join('/') : sp.split('/')[0]!));
      expect(packages.filter((p) => !ALLOWED_EXTERNAL.has(p))).toEqual([]);
      expect(packages).toContain('better-sqlite3');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('собранная функция запускается', () => {
  it('server.mjs стартует в Node с переменными Vercel и отвечает /api/v1/health и /api/v1/meta', async () => {
    // внутри node_modules: внешние пакеты (better-sqlite3 и др.) находятся, как на Vercel рядом с функцией
    const dir = path.resolve('node_modules/.cache/fc-server-test');
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, 'server.mjs');
    await buildServer(out);
    const port = 42000 + Math.floor(Math.random() * 1000);
    const child = spawn(process.execPath, [out], {
      env: {
        PATH: process.env.PATH,
        SYSTEMROOT: process.env.SYSTEMROOT,
        PORT: String(port),
        SESSION_SECRET: 's'.repeat(40),
        CRON_SECRET: 'c'.repeat(16),
        BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_Store1_secretsecret',
        // пул Neon ленивый: к базе функция не обращается, пока не придёт запрос к данным
        DATABASE_URL: 'postgres://u:p@127.0.0.1:1/db',
        VERCEL_PROJECT_PRODUCTION_URL: 'finmap-clone.vercel.app',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    try {
      const get = async (url: string) => {
        for (let i = 0; i < 100; i++) {
          try {
            return await fetch(`http://127.0.0.1:${port}${url}`);
          } catch {
            if (child.exitCode !== null) throw new Error(`Функция завершилась: ${output}`);
            await new Promise((r) => setTimeout(r, 100));
          }
        }
        throw new Error(`Функция не ответила: ${output}`);
      };
      const health = await get('/api/v1/health');
      expect([health.status, await health.json()]).toEqual([200, { ok: true }]);
      expect(await (await get('/api/v1/meta')).json()).toMatchObject({ timezone: 'Asia/Almaty', uploads: 'blob' });
    } finally {
      child.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
