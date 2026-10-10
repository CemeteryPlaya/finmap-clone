import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { isPidAlive, isPortFree, lockRunningPid, lockState, processImageIsNode } from '../src/server/lock';
import { lenientRunConfig, runFiles } from './lib/run-files';
import { canForceKillFor, forceKillCommand, STOP_MESSAGES, stopApp } from './lib/stop';

if (fs.existsSync('.env')) {
  try {
    process.loadEnvFile('.env');
  } catch (e) {
    console.log(`Не удалось прочитать файл настроек: ${(e as Error).message}; используются значения по умолчанию.`);
  }
}
// Полная проверка настроек не нужна: остановить приложение можно и при ошибке в них.
const cfg = lenientRunConfig(process.env);
const files = runFiles(cfg.dataDir);
// Чужой bootTime в lock (скачок часов) — приложение работает, если его порт занят.
const portBusy = async () => !(await isPortFree(cfg.host, cfg.port));

// Принудительно завершаем только процесс, подтверждённый как наш (см. canForceKillFor).
const canForceKill = (pid: number) =>
  canForceKillFor([lockState(files.supervisorLock), lockState(cfg.lockPath)], processImageIsNode)(pid);

const result = await stopApp({
  supervisorPid: await lockRunningPid(files.supervisorLock, portBusy),
  serverPid: await lockRunningPid(cfg.lockPath, portBusy),
  isAlive: isPidAlive,
  requestStop: () => {
    try {
      fs.writeFileSync(files.stopRequest, String(process.pid));
    } catch (e) {
      console.log(`Не удалось создать заявку на остановку: ${(e as Error).message}`);
      process.exit(1);
    }
  },
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
  // Монотонные часы: скачок системного времени не растягивает и не сокращает ожидание.
  now: () => performance.now(),
});

console.log(STOP_MESSAGES[result]);
if (result === 'failed' || result === 'foreign') process.exit(1);
