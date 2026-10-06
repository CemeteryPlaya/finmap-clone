import { describe, expect, it } from 'vitest';
import { detectFileType } from '../../src/server/modules/attachments/file-type';

const bytes = (...xs: (number | string)[]) => Buffer.concat(xs.map((x) => (typeof x === 'string' ? Buffer.from(x, 'latin1') : Buffer.from([x]))));

describe('detectFileType (§8: тип по содержимому)', () => {
  it('распознаёт разрешённые форматы по сигнатуре, а не по имени', () => {
    expect(detectFileType(bytes(0x89, 'PNG\r\n\x1a\n', 'rest'), 'a.pdf')).toEqual({ mime: 'image/png', ext: '.png' });
    expect(detectFileType(bytes(0xff, 0xd8, 0xff, 0xe0, 'jfif'), 'a')).toEqual({ mime: 'image/jpeg', ext: '.jpg' });
    expect(detectFileType(bytes('RIFF', 0, 0, 0, 0, 'WEBPVP8 '), 'a')).toEqual({ mime: 'image/webp', ext: '.webp' });
    expect(detectFileType(bytes(0, 0, 0, 0x18, 'ftypheic', 0, 0, 0, 0), 'a')).toEqual({ mime: 'image/heic', ext: '.heic' });
    expect(detectFileType(bytes(0, 0, 0, 0x18, 'ftypmif1', 0, 0, 0, 0), 'a')).toEqual({ mime: 'image/heic', ext: '.heic' });
    expect(detectFileType(bytes('%PDF-1.7\n'), 'a')).toEqual({ mime: 'application/pdf', ext: '.pdf' });
    expect(detectFileType(bytes('PK\x03\x04', '....[Content_Types].xml....xl/workbook.xml'), 'a')).toEqual({
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ext: '.xlsx',
    });
  });

  it('CSV — текст UTF-8 без нулевых байтов и с расширением .csv; иначе не принимается', () => {
    expect(detectFileType(Buffer.from('дата;сумма\n01.10.2026;100\n'), 'выписка.CSV')).toEqual({ mime: 'text/csv', ext: '.csv' });
    expect(detectFileType(Buffer.from('a,b\n1,2\n'), 'x.txt')).toBeNull();
    expect(detectFileType(Buffer.from([0x61, 0x00, 0x62]), 'x.csv')).toBeNull();
    expect(detectFileType(Buffer.from([0xc3, 0x28]), 'x.csv')).toBeNull(); // битый UTF-8
  });

  it('прочее — не принимается: HTML, ZIP без книги Excel, исполняемый файл, обрезанная сигнатура', () => {
    expect(detectFileType(Buffer.from('<html><script>alert(1)</script></html>'), 'x.html')).toBeNull();
    expect(detectFileType(bytes('PK\x03\x04', 'word/document.xml'), 'x.xlsx')).toBeNull();
    expect(detectFileType(bytes('MZ', 0x90, 0), 'x.png')).toBeNull();
    expect(detectFileType(bytes(0x89, 'PN'), 'x.png')).toBeNull();
  });
});
