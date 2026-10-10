import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { isPidAlive, isPortFree, lockRunningPid, lockState, processImageIsNode } from '../src/server/lock';
import { lenientRunConfig, runFiles } from './lib/run-files';
import { forceKillCommand, STOP_MESSAGES, stopApp } from './lib/stop';

if (fs.existsSync('.env')) process.loadEnvFile('.env');
// Полная проверка настроек не нужна: остановить приложение можно и при ошибке в них.
const cfg = lenientRunConfig(process.env);
const files = runFiles(cfg.dataDir);
// Чужой bootTime в lock (скачок часов) — приложение работает, если его порт занят.
const portBusy = async () => !(await isPortFree(cfg.host, cfg.port));

// Принудительно завершаем только процесс, подтверждённый как наш: PID в живом lock этой загрузки системы
// либо образ node. Подозрительный lock с неопознанным образом мог достаться чужому процессу.
const locks = [files.supervisorLock, cfg.lockPath];
const canForceKill = (pid: number) =>
  locks.some((l) => {
    const s = lockState(l);
    return s.kind === 'held' && s.pid === pid;
  }) || processImageIsNode(pid) === true;

const result = await stopApp({
  supervisorPid: await lockRunningPid(files.supervisorLock, portBusy),
  serverPid: await lockRunningPid(cfg.lockPath, portBusy),
  isAlive: isPidAlive,
  requestStop: () => fs.writeFileSync(files.stopRequest, String(process.pid)),
  clearRequest: () => fs.rmSync(files.stopRequest, { force: true }),
  forceKill: (pid) => {
    const c = forceKillCommand(process.platform, pid);
    if (c) spawnSync(c.cmd, c.args, { stdio: 'ignore' });
    else {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* уже завершился */
      }
    }
  },
  canForceKill,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: Date.now,
});

console.log(STOP_MESSAGES[result]);
if (result === 'failed') process.exit(1);
