import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../src/server/config';
import { applyServicePlan, isDryRun, planInstall, planUninstall, type ServiceContext, type ServicePlan } from './service-plan';
import { lenientRunConfig } from './run-files';
import { windowsUserId } from './windows-task';

/**
 * Контекст для service:uninstall: без проверки настроек (сломанные настройки не должны мешать
 * снять автозапуск). Удалению нужны только платформа и пути; остальное — значения по умолчанию.
 */
export function uninstallServiceContext(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform = process.platform,
): ServiceContext {
  const lenient = lenientRunConfig(env);
  return {
    platform,
    appDir: process.cwd(),
    dataDir: lenient.dataDir,
    nodePath: process.execPath,
    npmCli: env.npm_execpath,
    user: '',
    isRoot: false,
    appName: '',
    deployMode: 'local',
    publicUrl: '',
    host: lenient.host,
    port: lenient.port,
    systemRoot: env.SystemRoot ?? 'C:\\Windows',
    backupCopyDir: null,
  };
}

/** Контекст текущей машины для service:install. Не тестируется — только чтение окружения. */
export function currentServiceContext(): ServiceContext {
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

/** Выполняет план текущей машины; с --dry-run только печатает, что было бы сделано. */
export function runServicePlan(kind: 'install' | 'uninstall', argv: string[]): void {
  const dryRun = isDryRun(argv, process.env);
  let plan: ServicePlan;
  try {
    try {
      if (fs.existsSync('.env')) process.loadEnvFile('.env');
    } catch (e) {
      if (kind === 'install') throw new Error(`Не удалось прочитать файл настроек: ${(e as Error).message}`);
      console.warn(`Не удалось прочитать файл настроек (${(e as Error).message}); удаление автозапуска продолжается без него.`);
    }
    plan = kind === 'install' ? planInstall(currentServiceContext()) : planUninstall(uninstallServiceContext(process.env));
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
  const code = applyServicePlan(
    plan,
    dryRun,
    {
      writeFile: (file, bytes) => fs.writeFileSync(file, bytes),
      mkdir: (dir) => void fs.mkdirSync(dir, { recursive: true }),
      exec: (cmd, args, { quiet }) => spawnSync(cmd, args, { stdio: quiet ? 'ignore' : 'inherit' }),
      log: (line) => console.log(line),
    },
    path.dirname,
  );
  if (code !== 0) process.exit(code);
}
