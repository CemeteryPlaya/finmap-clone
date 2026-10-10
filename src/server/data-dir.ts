import fs from 'node:fs';

/**
 * Создаёт папку данных. На Linux и macOS — права 0700: в ней база, вложения, бэкапы и журналы,
 * другим пользователям сервера доступ не нужен. Если права сменить нельзя (папка чужая), это
 * предупреждение, а не ошибка запуска. На Windows доступ закрывает npm run setup (icacls).
 */
export function ensureDataDir(
  dir: string,
  o: { platform?: NodeJS.Platform; chmod?: (p: string, mode: number) => void; warn?: (message: string) => void } = {},
): void {
  fs.mkdirSync(dir, { recursive: true });
  if ((o.platform ?? process.platform) === 'win32') return;
  try {
    (o.chmod ?? fs.chmodSync)(dir, 0o700);
  } catch (e) {
    (o.warn ?? ((m: string) => console.warn(m)))(`Не удалось закрыть папку данных ${dir} от других пользователей (права 0700): ${(e as Error).message}`);
  }
}
