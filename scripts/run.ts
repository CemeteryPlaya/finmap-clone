import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { ensureDataDir } from '../src/server/data-dir';
import { acquireExclusiveLock, isLockHeld, isPortFree, LockHeldError } from '../src/server/lock';
import { checkCloudflaredPath, cloudflaredArgs, cloudflaredTarget } from './lib/cloudflared';
import { needsClientBuild } from './lib/client-build';
import { connectWithRetry, errorText, isFatalNgrokError, maskSecret } from './lib/ngrok';
import { createFileLog, createLineSplitter, loadConfigOrLog, logStartupError, runFiles, serverExitAction, takeStopRequest } from './lib/run-files';
import { createSupervisor, type ChildLike } from './lib/supervise';

try {
  if (fs.existsSync('.env')) process.loadEnvFile('.env');
} catch (e) {
  // Файл настроек не разобран (синтаксис, кодировка): при автозапуске окна нет, причину пишем в журнал.
  logStartupError(process.env, `Не удалось прочитать файл настроек: ${(e as Error).message}`);
  process.exit(1);
}
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

// Сбой самого супервизора (не сервера) без консоли иначе не оставит следа. Обработчик 'exit' ниже
// всё равно снимает блокировку и завершает детей.
const onSupervisorCrash = (err: unknown) => {
  const text = err instanceof Error ? (err.stack ?? err.message) : String(err);
  logError(`Сбой супервизора: ${text}`);
  try {
    void supervisor.shutdown(1).catch(() => process.exit(1));
  } catch {
    process.exit(1);
  }
};
process.on('uncaughtException', onSupervisorCrash);
process.on('unhandledRejection', onSupervisorCrash);

// Обработчики сигналов — до любых await. Консольное событие (Ctrl+C, Ctrl+Break, закрытие окна)
// в Windows уже доставлено всем процессам консоли, поэтому детей там не убиваем.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) {
  process.on(sig, () => void supervisor.shutdown(0, { fromConsole: true }));
}

// Сломанная консоль (автозапуск без окна) не должна ронять супервизор при пересылке stderr сервера.
process.stderr.on('error', () => {});

try {
  ensureDataDir(config.dataDir);
  fs.mkdirSync(config.logsDir, { recursive: true });
} catch (e) {
  logStartupError(process.env, `Не удалось создать папку данных: ${(e as Error).message}`);
  process.exit(1);
}
// Блокировка супервизора: атомарное создание; чужой bootTime (скачок часов) при занятом порте — занято.
const portBusy = async () => !(await isPortFree(config.host, config.port));
let releaseSupervisorLock = () => {};
try {
  releaseSupervisorLock = await acquireExclusiveLock(files.supervisorLock, { portBusy });
} catch (e) {
  if (!(e instanceof LockHeldError)) {
    logError(`Не удалось взять блокировку супервизора: ${(e as Error).message}`);
    process.exit(1);
  }
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
  if (config.cloudflaredPath) {
    const checked = checkCloudflaredPath(config.cloudflaredPath);
    if (!checked.ok) {
      logError(`CLOUDFLARED_PATH: ${checked.message}`);
      process.exit(1);
    }
    cloudflaredBin = checked.path;
  } else {
    cloudflaredBin = cloudflaredTarget(config.binDir);
    if (!fs.existsSync(cloudflaredBin)) {
      logError(`cloudflared не найден (${cloudflaredBin}). Запустите npm run setup или укажите CLOUDFLARED_PATH.`);
      process.exit(1);
    }
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
  () => {
    // stderr сервера — через трубу: в консоль как раньше, непустые строки ещё и в журнал
    // (след необработанного исключения виден после сбоя без окна). stdout (info pino) — только в консоль.
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
      stdio: ['inherit', 'inherit', 'pipe', 'ipc'],
    });
    const splitter = createLineSplitter((line) => fileLog(`[server] ${line}`));
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
      splitter.push(chunk);
    });
    child.stderr?.on('end', () => splitter.flush());
    return child as ChildLike;
  },
  {
    ipc: true,
    onExit: (code) => {
      const action = serverExitAction(code);
      if (action === 'stop') {
        logError(`Приложение уже запущено другим процессом (файл блокировки ${config.lockPath}). Супервизор завершает работу.`);
        void supervisor.shutdown(1);
        return false;
      }
      if (action === 'retry-port-busy') {
        logError(`Порт ${config.port} занят другой программой; сервер будет запущен, когда порт освободится.`);
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
    // Сеть повторяем всегда (она может появиться позже сервера); ответы ngrok с кодом ошибки — нет,
    // кроме занятой прошлой сессией (до TRANSIENT_ATTEMPTS попыток).
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
