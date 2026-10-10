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
