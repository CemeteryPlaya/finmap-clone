import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
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
  it('один ESM-файл из src/server/vercel-entry.ts: свой код внутри, пакеты — импортами (их собирает Vercel), fastify виден точке входа', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-build-server-'));
    try {
      const out = path.join(dir, 'server.mjs');
      await buildServer(out);
      const code = fs.readFileSync(out, 'utf8');
      expect(code).toMatch(/from ["']fastify["']/);
      expect(code).toMatch(/from ["']better-sqlite3["']/);
      expect(code).not.toMatch(/from ["']\.\.?\//); // относительных импортов нет — весь код приложения в файле
      expect(code).toContain('createServerlessApp');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
