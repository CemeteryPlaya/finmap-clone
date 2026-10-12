import zlib from 'node:zlib';
import { damaged, fileError } from './errors';

/**
 * Чтение ZIP чужого файла (§3.1 спецификации импорта) без пакетов: только центральный каталог, только
 * нужные записи, каждая — с пределом распаковки. На диск ничего не пишется: записи ищутся по точному имени.
 */
export interface ZipArchive {
  /** Имена записей в порядке каталога. */
  names(): string[];
  has(name: string): boolean;
  /**
   * Распакованная запись; null — такой записи нет. Объявленный размер больше limit — F3 без распаковки;
   * распаковка прерывается за объявленным размером (zip-бомба); CRC-32 сверяется.
   */
  read(name: string, limit: number): Buffer | null;
}

export interface ZipOptions {
  /** Не больше записей в каталоге (1 000). */
  maxEntries?: number;
  /** Не больше распакованных байтов всего (100 МБ). */
  maxTotal?: number;
}

export const ZIP_MAX_ENTRIES = 1000;
export const ZIP_MAX_TOTAL = 100 * 1024 * 1024;

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
/** 22 байта конца каталога и до 65 535 байт комментария. */
const EOCD_MIN = 22;
const EOCD_SEARCH = EOCD_MIN + 0xffff;

interface Entry {
  name: string;
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
  /** Где начинается следующая запись (или каталог): заголовок и данные этой записи лежат до него. */
  end: number;
}

/** Имя записи: печатный ASCII до 255 символов; без `\`, `/` в начале, сегментов `..` и `.` и пустых сегментов (zip-slip). */
export function isSafeEntryName(name: string): boolean {
  if (name.length === 0 || name.length > 255) return false;
  if (!/^[\x20-\x7e]+$/.test(name) || name.includes('\\') || name.startsWith('/')) return false;
  const segments = name.endsWith('/') ? name.slice(0, -1).split('/') : name.split('/');
  return segments.every((s) => s !== '' && s !== '.' && s !== '..');
}

/**
 * Конец каталога — с конца файла назад. Длина комментария должна доводить запись ровно до конца файла: сигнатура внутри
 * комментария не принимается за конец. Ровного совпадения нет (мусор после архива) — ближайшая к концу сигнатура,
 * комментарий которой помещается в файл.
 */
function findEocd(data: Buffer): number {
  const stop = Math.max(0, data.length - EOCD_SEARCH);
  let loose = -1;
  for (let i = data.length - EOCD_MIN; i >= stop; i--) {
    if (data.readUInt32LE(i) !== SIG_EOCD) continue;
    const end = i + EOCD_MIN + data.readUInt16LE(i + 20);
    if (end === data.length) return i;
    if (loose < 0 && end <= data.length) loose = i;
  }
  return loose;
}

export function openZip(data: Buffer, opts: ZipOptions = {}): ZipArchive {
  const maxEntries = opts.maxEntries ?? ZIP_MAX_ENTRIES;
  const maxTotal = opts.maxTotal ?? ZIP_MAX_TOTAL;
  if (data.length < EOCD_MIN) throw damaged('не найден конец архива');
  const eocd = findEocd(data);
  if (eocd < 0) throw damaged('не найден конец архива');

  const disk = data.readUInt16LE(eocd + 4);
  const cdDisk = data.readUInt16LE(eocd + 6);
  const onDisk = data.readUInt16LE(eocd + 8);
  const total = data.readUInt16LE(eocd + 10);
  const cdSize = data.readUInt32LE(eocd + 12);
  const cdOffset = data.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw damaged('файл слишком велик (ZIP64)');
  if (disk !== 0 || cdDisk !== 0 || onDisk !== total) throw damaged('многотомный архив');
  if (total > maxEntries) throw damaged(`больше ${maxEntries} записей в архиве`);
  if (cdOffset + cdSize > eocd) throw damaged('каталог архива за пределами файла');

  const entries = new Map<string, Entry>();
  let p = cdOffset;
  const cdEnd = cdOffset + cdSize;
  for (let n = 0; n < total; n++) {
    if (p + 46 > cdEnd || data.readUInt32LE(p) !== SIG_CENTRAL) throw damaged('каталог архива повреждён');
    const nameLen = data.readUInt16LE(p + 28);
    const extraLen = data.readUInt16LE(p + 30);
    const commentLen = data.readUInt16LE(p + 32);
    const next = p + 46 + nameLen + extraLen + commentLen;
    if (next > cdEnd) throw damaged('каталог архива повреждён');
    const entry: Entry = {
      name: data.toString('latin1', p + 46, p + 46 + nameLen),
      flags: data.readUInt16LE(p + 8),
      method: data.readUInt16LE(p + 10),
      crc: data.readUInt32LE(p + 16),
      compressedSize: data.readUInt32LE(p + 20),
      size: data.readUInt32LE(p + 24),
      localOffset: data.readUInt32LE(p + 42),
      end: cdOffset,
    };
    if (entry.compressedSize === 0xffffffff || entry.size === 0xffffffff || entry.localOffset === 0xffffffff) {
      throw damaged('файл слишком велик (ZIP64)');
    }
    if (!isSafeEntryName(entry.name)) throw damaged('недопустимое имя записи в архиве');
    if (entries.has(entry.name)) throw damaged(`запись «${entry.name}» встречается дважды`);
    entries.set(entry.name, entry);
    p = next;
  }
  // каталог занимает ровно объявленный размер
  if (p !== cdEnd) throw damaged('каталог архива повреждён');
  // записи не перекрываются: заголовок (не короче 30 байт и имени) и данные каждой — до следующей записи или каталога
  const byOffset = [...entries.values()].sort((a, b) => a.localOffset - b.localOffset);
  byOffset.forEach((e, k) => {
    e.end = byOffset[k + 1]?.localOffset ?? cdOffset;
    if (e.localOffset + 30 + e.name.length + e.compressedSize > e.end) throw damaged('записи архива перекрываются');
  });

  let unpacked = 0;

  function read(name: string, limit: number): Buffer | null {
    const e = entries.get(name);
    if (!e) return null;
    if (e.flags & 1) throw fileError('F3', 'Файл защищён паролем — сохраните его без пароля');
    if (e.method !== 0 && e.method !== 8) throw damaged(`неизвестный способ сжатия у «${name}»`);
    if (e.size > limit) throw damaged(`часть «${name}» больше предела распаковки`);
    if (unpacked + e.size > maxTotal) throw damaged('распакованный файл больше предела');

    const lh = e.localOffset;
    if (lh + 30 > cdOffset || data.readUInt32LE(lh) !== SIG_LOCAL) throw damaged(`запись «${name}» повреждена`);
    const nameLen = data.readUInt16LE(lh + 26);
    const extraLen = data.readUInt16LE(lh + 28);
    if (data.toString('latin1', lh + 30, lh + 30 + nameLen) !== name) throw damaged(`имя записи «${name}» не совпадает с каталогом`);
    // шифрование и способ сжатия в локальном заголовке — те же, что в каталоге
    if (data.readUInt16LE(lh + 6) & 1) throw fileError('F3', 'Файл защищён паролем — сохраните его без пароля');
    if (data.readUInt16LE(lh + 8) !== e.method) throw damaged(`способ сжатия «${name}» не совпадает с каталогом`);
    const start = lh + 30 + nameLen + extraLen;
    if (start + e.compressedSize > e.end) throw damaged(e.end === cdOffset ? `данные «${name}» за пределами файла` : 'записи архива перекрываются');
    const raw = data.subarray(start, start + e.compressedSize);

    let out: Buffer;
    if (e.method === 0) {
      if (e.compressedSize !== e.size) throw damaged(`размер «${name}» не совпадает с объявленным`);
      out = raw;
    } else {
      try {
        // выход за объявленный размер (он уже не больше предела) прерывает распаковку: защита от zip-бомбы
        out = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(1, e.size) });
      } catch (err) {
        if ((err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') throw damaged(`часть «${name}» распаковывается больше объявленного размера`);
        throw damaged(`не удалось распаковать «${name}»`);
      }
      if (out.length !== e.size) throw damaged(`размер «${name}» не совпадает с объявленным`);
    }
    if (zlib.crc32(out) >>> 0 !== e.crc >>> 0) throw damaged(`контрольная сумма «${name}» не совпала`);
    unpacked += out.length;
    return out;
  }

  return {
    names: () => [...entries.keys()],
    has: (name) => entries.has(name),
    read,
  };
}
