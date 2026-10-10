import type { Config } from '../../src/server/config';
import { isPortFree, lockRunningPid, type IsNodeProcess } from '../../src/server/lock';
import { runFiles } from './run-files';

/**
 * Что мешает setup трогать базу: 'app' — работает приложение (lock сервера или супервизора;
 * lock из прошлой загрузки считается работающим, если порт занят; живой PID с образом, проверенным как
 * «не node», — не приложение); 'port-busy' — порт занят чужой программой; null — ничего.
 * isNode и portBusy подставляются в тестах.
 */
export async function appRunning(
  config: Pick<Config, 'lockPath' | 'dataDir' | 'host' | 'port'>,
  o: { isNode?: IsNodeProcess; portBusy?: () => Promise<boolean> } = {},
): Promise<'app' | 'port-busy' | null> {
  const portBusy = o.portBusy ?? (async () => !(await isPortFree(config.host, config.port)));
  for (const lock of [config.lockPath, runFiles(config.dataDir).supervisorLock]) {
    if ((await lockRunningPid(lock, portBusy, o.isNode)) !== null) return 'app';
  }
  return (await portBusy()) ? 'port-busy' : null;
}

/** Сообщение setup, когда базу трогать нельзя. */
export function appRunningMessage(state: 'app' | 'port-busy', port: number): string {
  return state === 'app'
    ? 'Настройки сохранены, но база не тронута: приложение запущено. Остановите его (npm run stop) и повторите npm run setup.'
    : `Настройки сохранены, но база не тронута: порт ${port} занят другой программой. ` +
        'Укажите другой PORT в файле настроек .env и повторите npm run setup.';
}
