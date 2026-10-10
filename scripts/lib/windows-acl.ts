import path from 'node:path';

/** SID встроенных учётных записей: имена локализованы («Администраторы»), SID — нет. */
const SYSTEM_SID = '*S-1-5-18';
const ADMINISTRATORS_SID = '*S-1-5-32-544';

/**
 * Аргументы icacls, закрывающие папку данных или файл настроек от других пользователей Windows:
 * унаследованные права (например, «Пользователи: чтение» и «Прошедшие проверку: изменение» с диска C:\)
 * убираются, полный доступ — текущему пользователю, SYSTEM и Администраторам.
 */
export function icaclsRestrictArgs(target: string, userId: string, kind: 'dir' | 'file'): string[] {
  const inherit = kind === 'dir' ? '(OI)(CI)' : '';
  return [target, '/inheritance:r', '/grant:r', `${userId}:${inherit}F`, `${SYSTEM_SID}:${inherit}F`, `${ADMINISTRATORS_SID}:${inherit}F`];
}

/**
 * Папка проекта вне профиля пользователя (например, прямо на C:\)? Сравнение без учёта регистра, по границе папки.
 * Там код программы доступен на запись другим пользователям Windows (наследуются права диска).
 */
export function projectOutsideProfile(cwd: string, home: string): boolean {
  const norm = (p: string) => path.win32.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
  const c = norm(cwd);
  const h = norm(home);
  return !(c === h || c.startsWith(`${h}\\`));
}
