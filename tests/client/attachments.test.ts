import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/client/lib/api';
import { ATTACHMENT_MAX_BYTES, attachmentSizeError, attachmentUrl, formatFileSize, uploadErrorText } from '../../src/client/lib/attachments';

describe('вложения в форме операции', () => {
  it('размер проверяется до отправки: пустой и больше 10 МБ (§8)', () => {
    expect(attachmentSizeError(0)).toBe('Файл пустой');
    expect(attachmentSizeError(1)).toBeNull();
    expect(attachmentSizeError(ATTACHMENT_MAX_BYTES)).toBeNull();
    expect(attachmentSizeError(ATTACHMENT_MAX_BYTES + 1)).toBe('Файл больше 10 МБ');
  });

  it('размер файла по-русски, ссылка скачивания', () => {
    expect(formatFileSize(512)).toBe('512 Б');
    expect(formatFileSize(12 * 1024 + 300)).toBe('12 КБ');
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe('1,5 МБ');
    expect(attachmentUrl(3, 7)).toBe('/api/v1/companies/3/attachments/7');
  });

  it('ошибка загрузки: поле file или name, иначе сообщение сервера', () => {
    expect(uploadErrorText(new ApiError(400, 'VALIDATION', 'Проверьте файл', { file: 'Допустимые файлы: PNG' }))).toBe('Допустимые файлы: PNG');
    expect(uploadErrorText(new ApiError(400, 'VALIDATION', 'Проверьте файл', { name: 'Имя файла: от 1 до 200 символов' }))).toBe('Имя файла: от 1 до 200 символов');
    expect(uploadErrorText(new ApiError(413, 'TOO_LARGE', 'Файл больше 10 МБ'))).toBe('Файл больше 10 МБ');
    expect(uploadErrorText(new Error('x'))).toBe('Ошибка сервера');
  });
});
