import fs from 'node:fs';
import path from 'node:path';

/**
 * Проверка папки замера до любой записи. Возвращает текст отказа или null.
 * - это папка данных приложения (сравнение через path.resolve, на Windows без учёта регистра) — отказ всегда;
 * - свежая копия (hasDb = false) заливается только в несуществующую или пустую папку.
 * Копию, где уже есть app.db, дальше проверяет сам замер (файл-метка и состав компаний).
 */
export function benchDirProblem(dir: string, appDataDir: string, hasDb: boolean, platform: NodeJS.Platform = process.platform): string | null {
  const norm = (p: string) => (platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  if (norm(dir) === norm(appDataDir)) {
    return `${dir} — папка данных приложения. Замер пишет только в свою папку. Ничего не изменено. Укажите другую папку.`;
  }
  if (hasDb || !fs.existsSync(dir)) return null;
  if (!fs.statSync(dir).isDirectory()) return `${dir} — не папка. Ничего не изменено. Укажите другую папку.`;
  if (fs.readdirSync(dir).length > 0) {
    return `Папка ${dir} не пуста и не содержит демо-копии замера. Ничего не изменено. Укажите пустую или несуществующую папку.`;
  }
  return null;
}
