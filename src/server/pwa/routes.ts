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

/** Манифест PWA: название — APP_NAME, `start_url` — относительный «/» (§7), цвета — токены бренда. */
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

const OFFLINE_PAGE = `${PWA_PREFIX}offline.html`;

/**
 * Service worker (PWA, решение владельца 2026-11-08): нужен, чтобы браузеры предлагали установку. Данные не кэширует —
 * учёт всегда с сервера; в кэше только офлайн-страница. Перехватывает лишь переходы между страницами: нет связи —
 * офлайн-страница; запросы API, файлы и картинки идут мимо него. Новая версия кэша — новое имя, старые удаляются.
 */
export const SERVICE_WORKER = `const CACHE = 'offline-v1';
const OFFLINE = '${OFFLINE_PAGE}';
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE)));
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});
`;

const escapeHtml = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Офлайн-страница: без скриптов (CSP), цвета бренда; «Повторить» — обычная ссылка на главную. */
export function offlinePage(appName: string): string {
  const name = escapeHtml(appName);
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="${BRAND_COLORS.chrome}">
<title>${name}</title>
<style>
body{margin:0;min-height:100dvh;display:grid;place-items:center;background:${BRAND_COLORS.chrome};color:#fff;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:24px;box-sizing:border-box}
h1{font-size:20px;margin:0 0 8px}
p{margin:0 0 20px;opacity:.75}
a{display:inline-block;padding:12px 24px;border-radius:999px;background:#fff;color:${BRAND_COLORS.chrome};font-weight:600;text-decoration:none}
</style>
</head>
<body>
<main>
<h1>Нет связи с сервером</h1>
<p>Проверьте интернет и повторите.</p>
<a href="/">Повторить</a>
</main>
</body>
</html>
`;
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
  // service worker — с /pwa/, но на весь сайт: Service-Worker-Allowed разрешает scope «/»; браузер сверяет его при каждом заходе
  app.get(`${PWA_PREFIX}sw.js`, async (_req, reply) =>
    reply.header('cache-control', 'no-cache').header('service-worker-allowed', '/').type('text/javascript; charset=utf-8').send(SERVICE_WORKER),
  );
  const offline = offlinePage(deps.appName);
  app.get(OFFLINE_PAGE, async (_req, reply) => reply.header('cache-control', 'no-cache').type('text/html; charset=utf-8').send(offline));
  for (const icon of PWA_PNG_ICONS) {
    app.get(`${PWA_PREFIX}${icon.file}`, async (_req, reply) =>
      reply.header('cache-control', 'public, max-age=86400').type('image/png').send(iconPng(icon.size, icon.variant)),
    );
  }
}
