import { AppError } from '../../errors';

/** Ошибки файла (§4.10 спецификации импорта): предпросмотра нет, панель показывает сообщение. */
export type FileErrorCode = 'F1' | 'F2' | 'F3' | 'F5' | 'F6' | 'F7' | 'F8';

/** 400 IMPORT_FILE; код F* — в `details.fileCode`. */
export function fileError(code: FileErrorCode, message: string): AppError {
  return new AppError(400, 'IMPORT_FILE', message, undefined, { fileCode: code });
}

/** F3: файл повреждён или небезопасен (ZIP, XML, пределы распаковки). */
export function damaged(reason: string): AppError {
  return fileError('F3', `Файл повреждён или небезопасен: ${reason}`);
}

/** Не больше строк данных в файле (§2.3) — столько же, сколько выгрузка журнала (JOURNAL_EXPORT_MAX). */
export const IMPORT_MAX_ROWS = 50_000;
/** Непустых строк, которые читатель листа ещё принимает: данные, заголовки и до 9 строк над ними (§2.2). */
export const IMPORT_READ_MAX_ROWS = IMPORT_MAX_ROWS + 10;

/** F5: больше 50 000 строк данных. */
export function tooManyRows(): AppError {
  return fileError('F5', 'В файле больше 50 000 строк — разбейте его по годам');
}
