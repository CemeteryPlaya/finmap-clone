import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { loadConfig } from '../src/server/config';
import { isLockHeld } from '../src/server/lock';
import { EXIT_LOCK_HELD } from '../src/server/main';
import { cloudflaredTarget } from './lib/cloudflared';
import { needsClientBuild } from './lib/client-build';
import { connectWithRetry, errorText, isFatalNgrokError, maskSecret } from './lib/ngrok';
import { createSupervisor, type ChildLike } from './lib/supervise';

if (fs.existsSync('.env')) process.loadEnvFile('.env');
const config = loadConfig();

const supervisor = createSupervisor({ exit: (code) => process.exit(code) });

// Обработчики сигналов — до любых await. Консольное событие (Ctrl+C, Ctrl+Break, закрытие окна)
// в Windows уже доставлено всем процессам консоли, поэтому детей там не убиваем.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) {
  process.on(sig, () => void supervisor.shutdown(0, { fromConsole: true }));
}
// Страховка: при любом выходе не оставляем детей-сирот.
process.on('exit', () => supervisor.killAll());

if (isLockHeld(config.lockPath)) {
  console.error(
    `Приложение уже запущено другим процессом (файл блокировки ${config.lockPath}). Остановите его и повторите. ` +
      'Если приложение точно не запущено, удалите этот файл.',
  );
  process.exit(1);
}

let cloudflaredBin = '';
if (config.deployMode === 'cloudflare') {
  cloudflaredBin = config.cloudflaredPath ?? cloudflaredTarget(config.binDir);
  if (!fs.existsSync(cloudflaredBin)) {
    console.error(`cloudflared не найден (${cloudflaredBin}). Запустите npm run setup или укажите CLOUDFLARED_PATH.`);
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
        console.error(`Приложение уже запущено другим процессом (файл блокировки ${config.lockPath}). Супервизор завершает работу.`);
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
  console.log(`Публичный адрес: ${config.publicUrl}`);
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
        console.error(`Не удалось открыть туннель ngrok: ${maskSecret(errorText(e), secret)}; повтор через ${ms / 1000} с`),
    });
    if (listener) console.log(`Публичный адрес: ${listener.url()}`);
  } catch (e) {
    console.error(`Не удалось открыть туннель ngrok: ${maskSecret(errorText(e), secret)}`);
    await supervisor.shutdown(1);
  }
}
