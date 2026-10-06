/** Тип файла по содержимому (§8): png, jpg, webp, heic, pdf, xlsx, csv. Расширение имени учитывается только для CSV. */
export interface DetectedType {
  mime: string;
  ext: string;
}

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);
const XLSX: DetectedType = { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: '.xlsx' };

const startsWith = (data: Buffer, sig: number[], offset = 0) => data.length >= offset + sig.length && sig.every((b, i) => data[offset + i] === b);
const ascii = (data: Buffer, start: number, end: number) => data.subarray(start, end).toString('latin1');

/** Текст UTF-8 без нулевых байтов — у CSV нет сигнатуры, поэтому нужен ещё и .csv в имени. */
function isUtf8Text(data: Buffer): boolean {
  if (data.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(data);
    return true;
  } catch {
    return false;
  }
}

export function detectFileType(data: Buffer, name: string): DetectedType | null {
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', ext: '.png' };
  if (startsWith(data, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ext: '.jpg' };
  if (ascii(data, 0, 4) === 'RIFF' && ascii(data, 8, 12) === 'WEBP') return { mime: 'image/webp', ext: '.webp' };
  if (ascii(data, 4, 8) === 'ftyp' && HEIC_BRANDS.has(ascii(data, 8, 12))) return { mime: 'image/heic', ext: '.heic' };
  if (ascii(data, 0, 5) === '%PDF-') return { mime: 'application/pdf', ext: '.pdf' };
  // xlsx — ZIP-архив с книгой Excel внутри (имя части есть в заголовках архива)
  if (startsWith(data, [0x50, 0x4b, 0x03, 0x04])) return data.includes('xl/workbook.xml') ? XLSX : null;
  if (/\.csv$/i.test(name) && isUtf8Text(data)) return { mime: 'text/csv', ext: '.csv' };
  return null;
}
