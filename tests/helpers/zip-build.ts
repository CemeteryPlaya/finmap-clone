import zlib from 'node:zlib';

/** Запись тестового архива; поля «подмены» портят архив нарочно (§11.1 спецификации импорта). */
export interface ZipBuildEntry {
  name: string;
  data: Buffer | string;
  /** 0 — stored, 8 — deflate (по умолчанию). */
  method?: 0 | 8;
  /** Код метода в заголовках вместо настоящего (например, 12 — bzip2). */
  methodCode?: number;
  /** Объявленный распакованный размер вместо настоящего. */
  declaredSize?: number;
  /** CRC-32 вместо настоящего. */
  crc?: number;
  /** Флаги общего назначения (бит 0 — шифрование). */
  flags?: number;
  /** Имя в локальном заголовке вместо имени каталога. */
  localName?: string;
  /** Бит 3: размеры и CRC — в дескрипторе после данных, в локальном заголовке нули. */
  descriptor?: boolean;
}

export interface ZipBuildOptions {
  /** Число записей в конце каталога вместо настоящего (0xFFFF — признак ZIP64). */
  totalEntries?: number;
  /** Смещение каталога вместо настоящего (0xFFFFFFFF — признак ZIP64). */
  cdOffset?: number;
  /** Номер диска (не 0 — многотомный архив). */
  disk?: number;
  comment?: string;
}

const u16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};

/** Маленький писатель ZIP для своих, в том числе испорченных, архивов. */
export function buildZip(entries: ZipBuildEntry[], opts: ZipBuildOptions = {}): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = typeof e.data === 'string' ? Buffer.from(e.data, 'utf8') : e.data;
    const method = e.method ?? 8;
    const body = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const crc = e.crc ?? zlib.crc32(raw);
    const size = e.declaredSize ?? raw.length;
    const code = e.methodCode ?? method;
    const flags = (e.flags ?? 0) | (e.descriptor ? 8 : 0);
    const name = Buffer.from(e.name, 'utf8');
    const localName = Buffer.from(e.localName ?? e.name, 'utf8');
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(flags), u16(code), u16(0), u16(0x21),
      u32(e.descriptor ? 0 : crc), u32(e.descriptor ? 0 : body.length), u32(e.descriptor ? 0 : size),
      u16(localName.length), u16(0), localName,
    ]);
    const descriptor = e.descriptor ? Buffer.concat([u32(0x08074b50), u32(crc), u32(body.length), u32(size)]) : Buffer.alloc(0);
    parts.push(local, body, descriptor);
    central.push(
      Buffer.concat([
        u32(0x02014b50), u16(20), u16(20), u16(flags), u16(code), u16(0), u16(0x21),
        u32(crc), u32(body.length), u32(size),
        u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
      ]),
    );
    offset += local.length + body.length + descriptor.length;
  }
  const cd = Buffer.concat(central);
  const comment = Buffer.from(opts.comment ?? '', 'latin1');
  const total = opts.totalEntries ?? entries.length;
  const eocd = Buffer.concat([
    u32(0x06054b50), u16(opts.disk ?? 0), u16(opts.disk ?? 0), u16(total), u16(total),
    u32(cd.length), u32(opts.cdOffset ?? offset), u16(comment.length), comment,
  ]);
  return Buffer.concat([...parts, cd, eocd]);
}
