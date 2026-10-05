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
