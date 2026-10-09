import type { FastifyInstance } from 'fastify';
import { BRAND_COLORS } from '../../shared/brand';
import { iconPng, iconSvg, type IconVariant } from './icons';

/** Файлы PWA (§7 «Мобильная версия»): все под /pwa/ — в разработке Vite проксирует их одним правилом. */
export const PWA_PREFIX = '/pwa/';

/** PNG-иконки: для манифеста (192 и 512, отдельная maskable) и apple-touch-icon для iOS (purpose: null). */
export const PWA_PNG_ICONS: readonly { file: string; size: number; variant: IconVariant; purpose: 'any' | 'maskable' | null }[] = [
  { file: 'icon-192.png', size: 192, variant: 'any', purpose: 'any' },
  { file: 'icon-512.png', size: 512, variant: 'any', purpose: 'any' },
  { file: 'icon-maskable-512.png', size: 512, variant: 'full', purpose: 'maskable' },
  { file: 'apple-touch-icon.png', size: 180, variant: 'full', purpose: null },
];

export interface WebManifest {
  id: string;
  name: string;
  short_name: string;
  lang: string;
  start_url: string;
  scope: string;
  display: 'standalone';
  background_color: string;
  theme_color: string;
  icons: { src: string; sizes: string; type: string; purpose: string }[];
}

/**
 * Манифест PWA: название — APP_NAME, `start_url` — относительный «/» (§7), цвета — токены бренда.
 * Офлайн-режима нет: service worker не регистрируется.
 */
export function buildManifest(appName: string): WebManifest {
  return {
    // постоянный идентификатор приложения: смена названия или start_url не создаёт «другое» установленное приложение
    id: '/',
    name: appName,
    short_name: appName,
    lang: 'ru',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: BRAND_COLORS.chrome,
    theme_color: BRAND_COLORS.chrome,
    icons: [
      ...PWA_PNG_ICONS.flatMap((i) =>
        i.purpose === null ? [] : [{ src: `${PWA_PREFIX}${i.file}`, sizes: `${i.size}x${i.size}`, type: 'image/png', purpose: i.purpose }],
      ),
      { src: `${PWA_PREFIX}icon.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
}

/** Манифест и иконки: без входа (браузер запрашивает их без куки сессии), только GET и HEAD. */
export function registerPwaRoutes(app: FastifyInstance, deps: { appName: string }): void {
  const manifest = JSON.stringify(buildManifest(deps.appName));
  // название меняют в настройках сервера — браузер каждый раз сверяет манифест с сервером
  app.get(`${PWA_PREFIX}manifest.webmanifest`, async (_req, reply) =>
    reply.header('cache-control', 'no-cache').type('application/manifest+json; charset=utf-8').send(manifest),
  );
  app.get(`${PWA_PREFIX}icon.svg`, async (_req, reply) =>
    reply.header('cache-control', 'public, max-age=86400').type('image/svg+xml; charset=utf-8').send(iconSvg()),
  );
  for (const icon of PWA_PNG_ICONS) {
    app.get(`${PWA_PREFIX}${icon.file}`, async (_req, reply) =>
      reply.header('cache-control', 'public, max-age=86400').type('image/png').send(iconPng(icon.size, icon.variant)),
    );
  }
}
