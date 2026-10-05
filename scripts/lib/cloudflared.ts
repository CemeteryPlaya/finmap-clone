import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface Pins {
  version: string;
  assets: Record<string, { url: string; sha256: string }>;
}

export function platformKey(): string {
  return `${process.platform}-${process.arch}`;
}

export function cloudflaredTarget(binDir: string): string {
  return path.join(binDir, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
}

const sha256 = (buf: Buffer) => crypto.createHash('sha256').update(buf).digest('hex');

export async function ensureCloudflared(o: {
  binDir: string;
  pins: Pins;
  customPath: string | null;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  if (o.customPath) {
    if (!fs.existsSync(o.customPath)) throw new Error(`CLOUDFLARED_PATH не найден: ${o.customPath}`);
    return o.customPath;
  }
  const asset = o.pins.assets[platformKey()];
  if (!asset) throw new Error(`Нет закреплённой сборки cloudflared для платформы ${platformKey()}. Укажите CLOUDFLARED_PATH.`);

  const target = cloudflaredTarget(o.binDir);
  if (fs.existsSync(target) && sha256(fs.readFileSync(target)) === asset.sha256) return target;

  const res = await (o.fetchImpl ?? fetch)(asset.url);
  if (!res.ok) throw new Error(`Не удалось скачать cloudflared: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const actual = sha256(buf);
  if (actual !== asset.sha256) {
    throw new Error(`SHA-256 cloudflared не совпадает (ожидалось ${asset.sha256}, получено ${actual}). Файл отклонён.`);
  }
  fs.mkdirSync(o.binDir, { recursive: true });
  fs.writeFileSync(target, buf, { mode: 0o755 });
  return target;
}
