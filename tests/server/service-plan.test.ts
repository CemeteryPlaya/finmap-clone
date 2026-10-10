import { describe, expect, it } from 'vitest';
import { applyServicePlan, isDryRun, planInstall, planUninstall, readWritePaths, serviceFileBytes, type ApplyDeps, type ServiceContext } from '../../scripts/lib/service-plan';

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
    expect(notes).toContain("sudo cp --backup=numbered '/opt/finmap-clone/data/deploy/Caddyfile' /etc/caddy/Caddyfile");
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

  it('--dry-run: значения 1, TRUE, True тоже включают проверку; false и пустое — нет', () => {
    for (const v of ['1', 'TRUE', 'True']) expect(isDryRun([], { npm_config_dry_run: v })).toBe(true);
    expect(isDryRun([], { npm_config_dry_run: 'false' })).toBe(false);
    expect(isDryRun([], { npm_config_dry_run: '' })).toBe(false);
  });

  it('папка данных с хвостовым слэшем всё равно внутри папки приложения', () => {
    expect(readWritePaths({ appDir: '/opt/app', dataDir: '/opt/app/data/', backupCopyDir: null })).toEqual(['/opt/app']);
    expect(readWritePaths({ appDir: '/opt/app/', dataDir: '/opt/app/data', backupCopyDir: null })).toEqual(['/opt/app/']);
    expect(readWritePaths({ appDir: '/opt/app', dataDir: '/opt/app-data/', backupCopyDir: null })).toEqual(['/opt/app', '/opt/app-data/']);
  });
});

function fakeDeps(execStatus: (cmd: string, args: string[]) => number = () => 0) {
  const calls: string[] = [];
  const logs: string[] = [];
  const deps: ApplyDeps = {
    writeFile: (file) => void calls.push(`write ${file}`),
    mkdir: (dir) => void calls.push(`mkdir ${dir}`),
    exec: (cmd, args, { quiet }) => {
      calls.push(`exec${quiet ? '(quiet)' : ''} ${cmd} ${args.join(' ')}`);
      return { status: execStatus(cmd, args) };
    },
    log: (line) => void logs.push(line),
  };
  return { calls, logs, deps };
}
const dir = (p: string) => p.slice(0, p.lastIndexOf('\\'));

describe('выполнение плана', () => {
  it('--dry-run: ничего не пишет и не запускает, только печатает план', () => {
    for (const plan of [planInstall(win), planUninstall(win)]) {
      const { calls, logs, deps } = fakeDeps();
      expect(applyServicePlan(plan, true, deps, dir)).toBe(0);
      expect(calls).toEqual([]);
      expect(logs[0]).toContain('Проверка без изменений');
      expect(logs.join('\n')).toContain('Команда: schtasks');
    }
    expect(fakeDepsPrint(planUninstall(win))).toContain('Проверка: schtasks /Query /TN finmap-clone');
  });

  it('без --dry-run: папка, файл, команда — по порядку', () => {
    const { calls, deps } = fakeDeps();
    const plan = planInstall(win);
    expect(applyServicePlan(plan, false, deps, dir)).toBe(0);
    expect(calls).toEqual([
      'mkdir C:\\club\\finmap-clone\\data\\deploy',
      'write C:\\club\\finmap-clone\\data\\deploy\\finmap-clone-task.xml',
      'exec schtasks /Create /TN finmap-clone /XML C:\\club\\finmap-clone\\data\\deploy\\finmap-clone-task.xml /F',
    ]);
  });

  it('uninstall без задачи: сообщение и код 0, удаление не запускается', () => {
    const { calls, logs, deps } = fakeDeps((_c, args) => (args[0] === '/Query' ? 1 : 0));
    expect(applyServicePlan(planUninstall(win), false, deps, dir)).toBe(0);
    expect(calls).toEqual(['exec(quiet) schtasks /Query /TN finmap-clone']);
    expect(logs).toEqual(['Задача автозапуска не найдена — удалять нечего.']);
  });

  it('uninstall с задачей: проверка, затем удаление', () => {
    const { calls, deps } = fakeDeps();
    expect(applyServicePlan(planUninstall(win), false, deps, dir)).toBe(0);
    expect(calls).toEqual(['exec(quiet) schtasks /Query /TN finmap-clone', 'exec schtasks /Delete /TN finmap-clone /F']);
  });

  it('ошибка schtasks: одна строка с кодом и подсказкой про «Отказано в доступе», код 1', () => {
    const { logs, deps } = fakeDeps(() => 5);
    expect(applyServicePlan(planInstall(win), false, deps, dir)).toBe(1);
    expect(logs).toEqual([
      'Не удалось выполнить schtasks (код 5). Если выше написано «Отказано в доступе», запустите окно команд от имени администратора.',
    ]);
  });
});

function fakeDepsPrint(plan: ReturnType<typeof planInstall>): string {
  const { logs, deps } = fakeDeps();
  applyServicePlan(plan, true, deps, dir);
  return logs.join('\n');
}
