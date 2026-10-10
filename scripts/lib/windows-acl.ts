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
