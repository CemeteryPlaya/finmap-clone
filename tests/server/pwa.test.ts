import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/server/app';
import { createTestDb } from '../helpers/test-db';
import { BRAND_COLORS } from '../../src/shared/brand';
import { iconShapes, iconSvg, renderIcon } from '../../src/server/pwa/icons';
import { encodePng } from '../../src/server/pwa/png';
import { buildManifest, PWA_PNG_ICONS } from '../../src/server/pwa/routes';
import { createTestApp, testConfig, type TestApp } from '../helpers/test-app';

/** Разбор PNG для проверок: подпись, блоки и их CRC, заголовок, пиксели RGBA (у строк — фильтр 0). */
function decodePng(png: Buffer) {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks: { type: string; data: Buffer }[] = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.toString('ascii', at + 4, at + 8);
    expect(png.readUInt32BE(at + 8 + length), `CRC блока ${type}`).toBe(zlib.crc32(png.subarray(at + 4, at + 8 + length)));
    chunks.push({ type, data: png.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
  const ihdr = chunks[0]!.data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  expect([...ihdr.subarray(8)]).toEqual([8, 6, 0, 0, 0]);
  const raw = zlib.inflateSync(chunks[1]!.data);
  const stride = width * 4 + 1;
  expect(raw.length).toBe(height * stride);
  const pixel = (x: number, y: number) => {
    expect(raw[y * stride]).toBe(0);
    const k = y * stride + 1 + x * 4;
    return [...raw.subarray(k, k + 4)];
  };
  return { width, height, pixel };
}

const rgba = (hex: string, alpha = 255) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), alpha];

describe('encodePng', () => {
  it('пиксели RGBA → PNG, который читается обратно точь-в-точь', () => {
    const png = encodePng(2, 2, new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0, 1, 2, 3, 4, 250, 251, 252, 253]));
    const { width, height, pixel } = decodePng(png);
    expect([width, height]).toEqual([2, 2]);
    expect(pixel(0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(1, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(0, 1)).toEqual([1, 2, 3, 4]);
    expect(pixel(1, 1)).toEqual([250, 251, 252, 253]);
  });

  it('число пикселей не совпадает с размером или размер неверный — ошибка, а не битый файл', () => {
    expect(() => encodePng(2, 2, new Uint8Array(12))).toThrow('Число пикселей');
    expect(() => encodePng(0, 1, new Uint8Array(0))).toThrow('Неверный размер');
  });
});

describe('иконка', () => {
  it('any — скруглённый квадрат на прозрачном фоне, full — фон на всю площадь; цвета бренда', () => {
    const any = decodePng(encodePng(192, 192, renderIcon(192, 'any')));
    expect(any.pixel(0, 0)[3]).toBe(0); // угол срезан скруглением
    expect(any.pixel(96, 20)).toEqual(rgba(BRAND_COLORS.chrome)); // фон
    expect(any.pixel(Math.round(0.69 * 192), Math.round(0.5 * 192))).toEqual(rgba(BRAND_COLORS.incomeSoft)); // старший столбик
    expect(any.pixel(Math.round(0.31 * 192), Math.round(0.7 * 192))).toEqual(rgba(BRAND_COLORS.income)); // младший столбик
    const full = decodePng(encodePng(180, 180, renderIcon(180, 'full')));
    expect(full.pixel(0, 0)).toEqual(rgba(BRAND_COLORS.chrome)); // без прозрачности: iOS закрасила бы её чёрным
    expect(full.pixel(179, 179)).toEqual(rgba(BRAND_COLORS.chrome));
  });

  it('столбики — в безопасной зоне maskable-иконки (круг радиусом 0,4 стороны)', () => {
    for (const s of iconShapes('full').slice(1)) {
      for (const [x, y] of [
        [s.x, s.y],
        [s.x + s.w, s.y],
        [s.x, s.y + s.h],
        [s.x + s.w, s.y + s.h],
      ]) {
        expect(Math.hypot(x! - 0.5, y! - 0.5)).toBeLessThan(0.4);
      }
    }
  });

  it('SVG — та же картинка: фон и три столбика в цветах бренда', () => {
    const svg = iconSvg();
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 512 512">/);
    expect(svg.match(/<rect /g)).toHaveLength(4);
    expect(svg).toContain(`fill="${BRAND_COLORS.chrome}"`);
    expect(svg).toContain(`fill="${BRAND_COLORS.income}"`);
  });
});

describe('манифест PWA', () => {
  it('название из APP_NAME, относительный start_url, цвета бренда, иконки 192, 512 и maskable', () => {
    const m = buildManifest('Клубный учёт');
    expect(m).toMatchObject({
      id: '/',
      name: 'Клубный учёт',
      short_name: 'Клубный учёт',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      theme_color: BRAND_COLORS.chrome,
      background_color: BRAND_COLORS.chrome,
    });
    expect(m.icons).toEqual([
      { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/pwa/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ]);
  });
});

let t: TestApp;
afterEach(async () => t?.cleanup());

describe('маршруты PWA', () => {
  it('манифест и иконки отдаются без входа, с верным типом и размером; CSP страницы их не запрещает', async () => {
    t = await createTestApp({ APP_NAME: 'Клубный учёт' });
    const res = await t.app.inject({ method: 'GET', url: '/pwa/manifest.webmanifest' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/manifest+json; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    // manifest-src и img-src не заданы отдельно или разрешают свой сайт: браузер возьмёт манифест и иконки
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("img-src 'self'");
    expect(csp).not.toContain('manifest-src');
    const manifest = res.json();
    expect(manifest.name).toBe('Клубный учёт');

    for (const icon of PWA_PNG_ICONS) {
      const png = await t.app.inject({ method: 'GET', url: `/pwa/${icon.file}` });
      expect(png.statusCode, icon.file).toBe(200);
      expect(png.headers['content-type']).toBe('image/png');
      const { width, height } = decodePng(png.rawPayload);
      expect([width, height]).toEqual([icon.size, icon.size]);
    }
    const svg = await t.app.inject({ method: 'GET', url: '/pwa/icon.svg' });
    expect(svg.statusCode).toBe(200);
    expect(svg.headers['content-type']).toBe('image/svg+xml; charset=utf-8');
    expect(svg.body).toBe(iconSvg());
    // каждая иконка из манифеста существует
    for (const icon of manifest.icons as { src: string; type: string }[]) {
      const r = await t.app.inject({ method: 'HEAD', url: icon.src });
      expect(r.statusCode, icon.src).toBe(200);
      expect(String(r.headers['content-type'])).toContain(icon.type);
    }
  });

  it('изменяющие запросы к файлам PWA не принимаются', async () => {
    t = await createTestApp();
    const res = await t.app.inject({ method: 'POST', url: '/pwa/manifest.webmanifest' });
    expect(res.statusCode).toBe(404);
  });

  it('неизвестный путь /pwa/... — 404, а не страница приложения (даже когда клиент собран)', async () => {
    const db = createTestDb();
    const clientDir = path.join(db.dir, 'client');
    fs.mkdirSync(clientDir, { recursive: true });
    fs.writeFileSync(path.join(clientDir, 'index.html'), '<!doctype html><title>SPA</title>');
    const app = await buildApp({ config: testConfig(db.dir), db: db.db, sqlite: db.sqlite, clientDir });
    try {
      const typo = await app.inject({ method: 'GET', url: '/pwa/typo.png' });
      expect(typo.statusCode).toBe(404);
      expect(typo.body).not.toContain('<title>SPA</title>');
      const spa = await app.inject({ method: 'GET', url: '/c/1/log' });
      expect(spa.statusCode).toBe(200);
    } finally {
      await app.close();
      db.cleanup();
    }
  });
});
