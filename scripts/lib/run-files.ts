import { StringDecoder } from 'node:string_decoder';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, type Config } from '../../src/server/config';
import { SUPERVISOR_LOCK_FILE } from '../../src/server/lock';

/** Служебные файлы супервизора в папке данных. */
export function runFiles(dataDir: string) {
  return {
    /** Блокировка супервизора {pid, bootTime, token}: второй npm start не запускается, npm run stop знает, кого остановить. */
    supervisorLock: path.join(dataDir, SUPERVISOR_LOCK_FILE),
    /** Заявка на остановку: её создаёт npm run stop, супервизор проверяет раз в секунду. */
    stopRequest: path.join(dataDir, 'stop.request'),
    /** Журнал супервизора: перезапуски, ошибки туннеля (§9.1) — окна консоли при автозапуске нет. */
    supervisorLog: path.join(dataDir, 'logs', 'supervisor.log'),
  };
}

/** Забирает заявку на остановку: файл был — удаляет его и возвращает true. */
export function takeStopRequest(file: string): boolean {
  try {
    fs.rmSync(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Журнал в файл: строка «время сообщение». При размере от maxBytes файл переименовывается в .1
 * (одна старая копия). Ошибки записи глотаются: журнал не должен ронять супервизор.
 */
export function createFileLog(file: string, o: { maxBytes?: number; now?: () => Date } = {}): (message: string) => void {
  const maxBytes = o.maxBytes ?? 10 * 1024 * 1024;
  const now = o.now ?? (() => new Date());
  return (message) => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      let size = 0;
      try {
        size = fs.statSync(file).size;
      } catch {
        /* файла ещё нет */
      }
      if (size >= maxBytes) fs.renameSync(file, `${file}.1`);
      fs.appendFileSync(file, `${now().toISOString()} ${message}\n`);
    } catch {
      /* диск недоступен — сообщение остаётся только в консоли */
    }
  };
}

/**
 * Пути и порт без полной проверки настроек: для npm run stop и журнала ошибок настроек.
 * Значения по умолчанию — как в loadConfig (§3 «Переменные»).
 */
export function lenientRunConfig(env: Record<string, string | undefined>) {
  const dataDir = path.resolve(env.DATA_DIR?.trim() || 'data');
  const port = Number.parseInt(env.PORT?.trim() ?? '', 10);
  return {
    dataDir,
    lockPath: path.join(dataDir, 'app.lock'),
    host: env.HOST?.trim() || '127.0.0.1',
    port: Number.isInteger(port) && port >= 0 && port <= 65535 ? port : 3000,
  };
}

/**
 * Ранняя ошибка запуска (до того, как известны настройки): в консоль и в
 * <DATA_DIR или data>/logs/supervisor.log — при автозапуске окна нет, иначе причина пропадёт.
 */
export function logStartupError(env: Record<string, string | undefined>, message: string, now?: () => Date): void {
  console.error(message);
  createFileLog(runFiles(lenientRunConfig(env).dataDir).supervisorLog, { now })(message);
}

/** Загружает настройки; при ошибке пишет её через logStartupError и возвращает null. */
export function loadConfigOrLog(env: Record<string, string | undefined>, now?: () => Date): Config | null {
  try {
    return loadConfig(env);
  } catch (e) {
    logStartupError(env, `Приложение не запущено: ${(e as Error).message}`, now);
    return null;
  }
}

/**
 * Построчный разбор потока байт: UTF-8 символ, разрезанный между кусками, декодируется верно;
 * пустые строки пропускаются; накопленный без перевода строки текст длиннее maxPending выдаётся как строка.
 */
export function createLineSplitter(
  onLine: (line: string) => void,
  maxPending = 64 * 1024,
): { push(chunk: Buffer): void; flush(): void } {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  const emit = (line: string) => {
    if (line.trim()) onLine(line);
  };
  const take = (text: string) => {
    const lines = (pending + text).split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) emit(line.endsWith('\r') ? line.slice(0, -1) : line);
    if (pending.length > maxPending) {
      emit(pending);
      pending = '';
    }
  };
  return {
    push: (chunk) => take(decoder.write(chunk)),
    flush: () => {
      take(decoder.end());
      emit(pending.endsWith('\r') ? pending.slice(0, -1) : pending);
      pending = '';
    },
  };
}
