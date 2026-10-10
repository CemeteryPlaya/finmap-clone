import path from 'node:path';
import type { DeployMode } from '../../src/server/config';
import { SERVICE_NAME, renderCaddyfile, renderSystemdUnit } from './deploy-files';
import { encodeTaskXml, renderTaskXml, schtasksCreateArgs, schtasksDeleteArgs, schtasksQueryArgs } from './windows-task';

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
  return argv.includes('--dry-run') || ['true', '1'].includes((env.npm_config_dry_run ?? '').trim().toLowerCase());
}

/** Пути записи для песочницы systemd: папка приложения, данные вне её и (необязательно) папка копий бэкапов. */
export function readWritePaths(ctx: Pick<ServiceContext, 'appDir' | 'dataDir' | 'backupCopyDir'>): string[] {
  // Только POSIX-пути (systemd бывает на Linux); хвостовые слэши не мешают сравнению.
  const norm = (p: string) => path.posix.normalize(p).replace(/(?<=.)\/+$/, '');
  const app = norm(ctx.appDir);
  const data = norm(ctx.dataDir);
  const inside = data === app || data.startsWith(`${app}/`);
  return [ctx.appDir, ...(inside ? [] : [ctx.dataDir]), ...(ctx.backupCopyDir ? [`-${ctx.backupCopyDir}`] : [])];
}

export interface ServiceFile {
  path: string;
  text: string;
  /** true — записать в UTF-16 LE с BOM (файл задачи Планировщика). */
  utf16?: boolean;
}

export interface ServicePlan {
  /** Проверка перед командами: если она завершилась ненулём, выполнять нечего (сообщение, код 0). */
  check?: { cmd: string; args: string[]; absentMessage: string };
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
        `  sudo cp --backup=numbered ${shq(caddyPath)} /etc/caddy/Caddyfile`,
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
      check: { cmd: 'schtasks', args: schtasksQueryArgs(), absentMessage: 'Задача автозапуска не найдена — удалять нечего.' },
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

export interface ApplyDeps {
  writeFile: (file: string, bytes: Buffer) => void;
  mkdir: (dir: string) => void;
  /** Запускает команду; при quiet вывод скрыт, иначе виден в консоли (сообщения schtasks в кодировке консоли). */
  exec: (cmd: string, args: string[], opts: { quiet: boolean }) => { status: number | null; error?: Error };
  log: (line: string) => void;
}

/** Выполняет план (или только печатает при dryRun) и возвращает код завершения процесса. */
export function applyServicePlan(plan: ServicePlan, dryRun: boolean, deps: ApplyDeps, dirname: (p: string) => string): number {
  if (dryRun) {
    deps.log('Проверка без изменений (--dry-run).');
    for (const f of plan.files) deps.log(`\n--- файл ${f.path}${f.utf16 ? ' (UTF-16)' : ''} ---\n${f.text}`);
    if (plan.check) deps.log(`\nПроверка: ${plan.check.cmd} ${plan.check.args.join(' ')}`);
    for (const c of plan.commands) deps.log(`\nКоманда: ${c.cmd} ${c.args.join(' ')}`);
    deps.log(`\nПосле выполнения:\n${plan.notes.join('\n')}`);
    return 0;
  }
  if (plan.check) {
    const r = deps.exec(plan.check.cmd, plan.check.args, { quiet: true });
    if (r.status !== 0) {
      deps.log(plan.check.absentMessage);
      return 0;
    }
  }
  for (const f of plan.files) {
    deps.mkdir(dirname(f.path));
    deps.writeFile(f.path, serviceFileBytes(f));
  }
  for (const c of plan.commands) {
    const r = deps.exec(c.cmd, c.args, { quiet: false });
    if (r.status !== 0) {
      deps.log(
        r.error
          ? `Не удалось запустить ${c.cmd}: ${r.error.message}`
          : `Не удалось выполнить ${c.cmd} (код ${r.status}). Если выше написано «Отказано в доступе», запустите окно команд от имени администратора.`,
      );
      return 1;
    }
  }
  deps.log(plan.notes.join('\n'));
  return 0;
}
