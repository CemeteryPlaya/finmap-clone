import { expect, test } from '@playwright/test';

test('PWA: страница ссылается на манифест и иконки, они отдаются без входа с верным типом (§7)', async ({ page, request }) => {
  const res = await page.goto('/login');
  // CSP страницы не запрещает манифест: отдельного manifest-src нет, default-src — свой сайт
  const csp = res!.headers()['content-security-policy'];
  expect(csp).toContain("default-src 'self'");
  expect(csp).not.toContain('manifest-src');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#16181d');

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBe('/pwa/manifest.webmanifest');
  // запрос без куки сессии — как его делает браузер
  const manifestRes = await request.get(manifestHref!);
  expect(manifestRes.status()).toBe(200);
  expect(manifestRes.headers()['content-type']).toBe('application/manifest+json; charset=utf-8');
  const manifest = await manifestRes.json();
  expect(manifest).toMatchObject({ id: '/', name: 'Учёт', start_url: '/', display: 'standalone', theme_color: '#16181d' });
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(['192x192', '512x512', '512x512', 'any']);

  for (const icon of manifest.icons as { src: string; sizes: string; type: string }[]) {
    const r = await request.get(icon.src);
    expect(r.status(), icon.src).toBe(200);
    expect(r.headers()['content-type']).toContain(icon.type);
    if (icon.type === 'image/png') {
      const png = await r.body();
      // подпись PNG и ширина из заголовка IHDR
      expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
      expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(icon.sizes);
    }
  }

  const apple = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  const appleRes = await request.get(apple!);
  expect(appleRes.status()).toBe(200);
  expect(appleRes.headers()['content-type']).toBe('image/png');
  expect((await appleRes.body()).readUInt32BE(16)).toBe(180);

  const favicon = await page.locator('link[rel="icon"]').getAttribute('href');
  const faviconRes = await request.get(favicon!);
  expect(faviconRes.status()).toBe(200);
  expect(faviconRes.headers()['content-type']).toBe('image/svg+xml; charset=utf-8');
});

test('PWA: service worker на весь сайт; без сети — страница «Нет связи с сервером»', async ({ page, context }) => {
  await page.goto('/login');
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toBe(new URL('/', page.url()).href);
  // страница под управлением service worker — после перезагрузки (или clients.claim)
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await context.setOffline(true);
  await page.goto('/c/1/log').catch(() => {});
  await expect(page.getByRole('heading', { name: 'Нет связи с сервером' })).toBeVisible();
  await context.setOffline(false);
  await page.getByRole('link', { name: 'Повторить' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('PWA: «Установить приложение» в «Настройках» — по предложению браузера; после ответа пункт пропадает', async ({ page }) => {
  await page.goto('/login');
  await page.getByPlaceholder('Логин').fill('admin');
  await page.getByPlaceholder('Пароль').fill('e2e-password-1');
  await page.getByRole('button', { name: 'Войти' }).click();
  const gear = page.getByRole('button', { name: 'Настройки', exact: true });
  await expect(gear).toBeVisible();
  await gear.click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('button', { name: 'Выйти' })).toBeVisible();
  // headless Chromium не предлагает установку сам — событие браузера подставляется
  await expect(drawer.getByRole('button', { name: 'Установить приложение' })).toHaveCount(0);
  await page.evaluate(() => {
    const e = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: async () => void ((window as unknown as { prompted: boolean }).prompted = true),
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    });
    window.dispatchEvent(e);
  });
  await drawer.getByRole('button', { name: 'Установить приложение' }).click();
  expect(await page.evaluate(() => (window as unknown as { prompted?: boolean }).prompted)).toBe(true);
  await expect(drawer.getByRole('button', { name: 'Установить приложение' })).toHaveCount(0);
});
