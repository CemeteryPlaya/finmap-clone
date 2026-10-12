import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/server/errors';
import { isSafeEntryName, openZip } from '../../src/server/modules/imports/zip';
import { buildZip } from '../helpers/zip-build';

const MB = 1024 * 1024;

/** Ошибка файла импорта: 400 IMPORT_FILE с кодом F* и текстом. */
function fileErr(fn: () => unknown): { fileCode: string; message: string } {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    const err = e as AppError;
    expect(err.status).toBe(400);
    expect(err.code).toBe('IMPORT_FILE');
    return { fileCode: err.details!.fileCode!, message: err.message };
  }
  throw new Error('ожидалась ошибка файла');
}

describe('ZIP: чтение (§3.1 спецификации импорта)', () => {
  it('stored и deflate; имена в порядке каталога; нет записи — null', () => {
    const zip = openZip(buildZip([{ name: 'a.txt', data: 'привет', method: 0 }, { name: 'xl/b.xml', data: '<b/>'.repeat(1000) }]));
    expect(zip.names()).toEqual(['a.txt', 'xl/b.xml']);
    expect(zip.has('xl/b.xml')).toBe(true);
    expect(zip.read('a.txt', MB)!.toString('utf8')).toBe('привет');
    expect(zip.read('xl/b.xml', MB)!.toString('utf8')).toBe('<b/>'.repeat(1000));
    expect(zip.read('нет', MB)).toBeNull();
  });

  it('дескриптор данных (бит 3): размеры берутся из каталога; пустая запись; книга, собранная AdmZip', () => {
    const zip = openZip(buildZip([{ name: 'd.xml', data: 'данные', descriptor: true }, { name: 'empty', data: '' }]));
    expect(zip.read('d.xml', MB)!.toString('utf8')).toBe('данные');
    expect(zip.read('empty', MB)!.length).toBe(0);
    const adm = new AdmZip();
    adm.addFile('xl/workbook.xml', Buffer.from('<workbook/>'));
    expect(openZip(adm.toBuffer()).read('xl/workbook.xml', MB)!.toString()).toBe('<workbook/>');
  });

  it('CRC не совпал, фактический размер не равен объявленному — F3', () => {
    expect(fileErr(() => openZip(buildZip([{ name: 'a', data: 'abc', crc: 1 }])).read('a', MB)).message).toBe(
      'Файл повреждён или небезопасен: контрольная сумма «a» не совпала',
    );
    expect(fileErr(() => openZip(buildZip([{ name: 'a', data: 'abc', declaredSize: 10 }])).read('a', MB)).message).toBe(
      'Файл повреждён или небезопасен: размер «a» не совпадает с объявленным',
    );
    expect(fileErr(() => openZip(buildZip([{ name: 'a', data: 'abc', method: 0, declaredSize: 2 }])).read('a', MB)).fileCode).toBe('F3');
  });

  it('шифрование, неизвестный метод, ZIP64, многотомный архив — F3', () => {
    expect(fileErr(() => openZip(buildZip([{ name: 'a', data: 'x', flags: 1 }])).read('a', MB))).toEqual({
      fileCode: 'F3',
      message: 'Файл защищён паролем — сохраните его без пароля',
    });
    expect(fileErr(() => openZip(buildZip([{ name: 'a', data: 'x', method: 0, methodCode: 12 }])).read('a', MB)).message).toContain(
      'неизвестный способ сжатия',
    );
    expect(fileErr(() => openZip(buildZip([{ name: 'a', data: 'x' }], { totalEntries: 0xffff }))).message).toBe(
      'Файл повреждён или небезопасен: файл слишком велик (ZIP64)',
    );
    expect(fileErr(() => openZip(buildZip([{ name: 'a', data: 'x' }], { cdOffset: 0xffffffff }))).message).toContain('ZIP64');
    expect(fileErr(() => openZip(buildZip([{ name: 'a', data: 'x' }], { disk: 1 }))).message).toContain('многотомный');
  });

  it('больше 1 000 записей — F3 до чтения каталога; 1 000 — можно', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `f${i}`, data: '', method: 0 as const }));
    expect(openZip(buildZip(many(1000))).names()).toHaveLength(1000);
    expect(fileErr(() => openZip(buildZip(many(1001)))).message).toBe('Файл повреждён или небезопасен: больше 1000 записей в архиве');
  });

  it('имена ../x, /x, a\\b, ./x, a//b, не-ASCII и NUL — F3 всего архива (zip-slip, Review Focus)', () => {
    for (const name of ['../x', 'xl/../../x', '/x', 'a\\b', './x', 'a//b', 'имя', 'a\u0000b', 'x'.repeat(256)]) {
      expect(isSafeEntryName(name), name).toBe(false);
      expect(fileErr(() => openZip(buildZip([{ name, data: 'x' }]))).message, name).toBe(
        'Файл повреждён или небезопасен: недопустимое имя записи в архиве',
      );
    }
    for (const name of ['xl/workbook.xml', 'xl/', '[Content_Types].xml', 'a b.xml']) expect(isSafeEntryName(name), name).toBe(true);
  });

  it('повтор имени и имя локального заголовка, отличное от каталога, — F3', () => {
    expect(fileErr(() => openZip(buildZip([{ name: 'a', data: '1' }, { name: 'a', data: '2' }]))).message).toContain('встречается дважды');
    expect(fileErr(() => openZip(buildZip([{ name: 'a', data: '1', localName: 'b' }])).read('a', MB)).message).toContain('не совпадает с каталогом');
  });

  it('объявленный размер больше предела — F3 без распаковки', () => {
    const zip = openZip(buildZip([{ name: 'big', data: Buffer.alloc(2 * MB) }]));
    expect(fileErr(() => zip.read('big', MB)).message).toBe('Файл повреждён или небезопасен: часть «big» больше предела распаковки');
  });

  it('zip-бомба: 2 МБ нулей, объявлено 1 МБ при пределе 1 МБ — распаковка прерывается (Review Focus)', () => {
    const zip = openZip(buildZip([{ name: 'bomb', data: Buffer.alloc(2 * MB), declaredSize: MB }]));
    expect(fileErr(() => zip.read('bomb', MB)).message).toBe('Файл повреждён или небезопасен: часть «bomb» распаковывается больше объявленного размера');
  });

  it('предел распаковки всего архива: сумма частей больше maxTotal — F3', () => {
    const zip = openZip(buildZip([{ name: 'a', data: Buffer.alloc(600) }, { name: 'b', data: Buffer.alloc(600) }]), { maxTotal: 1000 });
    expect(zip.read('a', MB)!.length).toBe(600);
    expect(fileErr(() => zip.read('b', MB)).message).toBe('Файл повреждён или небезопасен: распакованный файл больше предела');
  });

  it('обрезанный архив, мусор, данные за пределами — F3', () => {
    const good = buildZip([{ name: 'a', data: 'abc'.repeat(100) }]);
    expect(fileErr(() => openZip(good.subarray(0, good.length - 30))).message).toBe('Файл повреждён или небезопасен: не найден конец архива');
    expect(fileErr(() => openZip(Buffer.from('не архив'))).fileCode).toBe('F3');
    expect(fileErr(() => openZip(Buffer.alloc(0))).fileCode).toBe('F3');
    // каталог (47 байт) и конец (22 байта) на месте, а из данных записи вырезана часть: смещения указывают не туда
    const cut = Buffer.concat([good.subarray(0, 35), good.subarray(good.length - 22 - 47)]);
    expect(fileErr(() => openZip(cut).read('a', MB)).fileCode).toBe('F3');
  });
});
