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
