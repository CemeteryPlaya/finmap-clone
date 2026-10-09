import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { checkCloudflaredPath, cloudflaredArgs, cloudflaredTarget, ensureCloudflared, platformKey } from '../../scripts/lib/cloudflared';

const body = Buffer.from('fake-binary');
const sha = crypto.createHash('sha256').update(body).digest('hex');
const pins = (hash: string) => ({ version: '1', assets: { [platformKey()]: { url: 'https://example/bin', sha256: hash } } });
const fakeFetch = (async () => new Response(body)) as typeof fetch;

describe('ensureCloudflared', () => {
  it('скачивает, проверяет SHA-256 и кладёт в binDir', async () => {
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-bin-'));
    const p = await ensureCloudflared({ binDir, pins: pins(sha), customPath: null, fetchImpl: fakeFetch });
    expect(p).toBe(cloudflaredTarget(binDir));
    expect(fs.readFileSync(p)).toEqual(body);
  });

  it('не скачивает повторно, если файл с верным хэшем уже есть', async () => {
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-bin-'));
    fs.writeFileSync(cloudflaredTarget(binDir), body);
    const failingFetch = (async () => {
      throw new Error('не должен вызываться');
    }) as typeof fetch;
    await expect(ensureCloudflared({ binDir, pins: pins(sha), customPath: null, fetchImpl: failingFetch })).resolves.toBe(
      cloudflaredTarget(binDir),
    );
  });

  it('отклоняет файл с неверным хэшем и не оставляет его на диске', async () => {
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-bin-'));
    await expect(ensureCloudflared({ binDir, pins: pins('0'.repeat(64)), customPath: null, fetchImpl: fakeFetch })).rejects.toThrow(
      /SHA-256/,
    );
    expect(fs.existsSync(cloudflaredTarget(binDir))).toBe(false);
  });

  it('CLOUDFLARED_PATH имеет приоритет', async () => {
    const custom = path.join(os.tmpdir(), 'my-cloudflared');
    fs.writeFileSync(custom, 'x');
    await expect(ensureCloudflared({ binDir: 'unused', pins: pins(sha), customPath: custom })).resolves.toBe(custom);
  });

  it('без закреплённых сборок (unpinned) и без customPath просит указать CLOUDFLARED_PATH', async () => {
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-bin-'));
    await expect(
      ensureCloudflared({ binDir, pins: { version: 'unpinned', assets: {} }, customPath: null }),
    ).rejects.toThrow(/CLOUDFLARED_PATH/);
  });
});

describe('checkCloudflaredPath', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-cfpath- '));
  const exe = path.join(dir, 'cloudflared.exe');
  fs.writeFileSync(exe, 'bin');
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('принимает путь к файлу как есть и в кавычках («Копировать как путь» в Windows)', () => {
    expect(checkCloudflaredPath(exe)).toEqual({ ok: true, path: exe });
    expect(checkCloudflaredPath(`"${exe}"`)).toEqual({ ok: true, path: exe });
    expect(checkCloudflaredPath(`  '${exe}'  `)).toEqual({ ok: true, path: exe });
  });

  it('отклоняет папку и несуществующий путь с понятным сообщением', () => {
    const asDir = checkCloudflaredPath(`"${dir}"`);
    expect(asDir.ok).toBe(false);
    expect(!asDir.ok && asDir.message).toMatch(/не файл/);
    const missing = checkCloudflaredPath(path.join(dir, 'nope.exe'));
    expect(missing.ok).toBe(false);
    expect(!missing.ok && missing.message).toMatch(/не найден/);
  });
});

describe('cloudflaredArgs', () => {
  it('именованный туннель без автообновления, журнал — в data/logs/cloudflared.log', () => {
    expect(cloudflaredArgs(path.join('D:', 'club', 'data', 'logs'))).toEqual([
      'tunnel',
      '--no-autoupdate',
      '--logfile',
      path.join('D:', 'club', 'data', 'logs', 'cloudflared.log'),
      'run',
    ]);
  });
});
