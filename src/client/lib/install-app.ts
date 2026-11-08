import { useSyncExternalStore } from 'react';

/**
 * «Установить приложение» (PWA, решение владельца 2026-11-08): браузеры на Chromium (Android, Windows) присылают
 * `beforeinstallprompt` — его нужно поймать сразу при запуске и показать по кнопке; Safari на iPhone и iPad такого
 * события не шлёт — там подсказка «Поделиться → На экран „Домой“».
 */
export type InstallMode = 'installed' | 'prompt' | 'ios' | 'none';

export function installMode(env: { standalone: boolean; canPrompt: boolean; userAgent: string; maxTouchPoints: number }): InstallMode {
  if (env.standalone) return 'installed';
  if (env.canPrompt) return 'prompt';
  // iPad в режиме «как компьютер» называет себя Mac — отличается сенсорным экраном
  const ios = /iPhone|iPad|iPod/.test(env.userAgent) || (/Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1);
  return ios ? 'ios' : 'none';
}

interface PromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: PromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Ловить предложение установки с самого запуска (событие приходит один раз, раньше, чем откроют настройки). */
export function captureInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as PromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    notify();
  });
}

/** Service worker — только в собранном приложении: в разработке Vite отдаёт модули сам. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/pwa/sw.js', { scope: '/' }).catch(() => {
      // без service worker приложение работает как сайт — установка просто не предлагается
    });
  });
}

function currentMode(): InstallMode {
  const standalone = installed || window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  return installMode({ standalone, canPrompt: deferred !== null, userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Режим кнопки и установка по предложению браузера (событие одноразовое — после ответа кнопка пропадает). */
export function useInstallApp(): { mode: InstallMode; install: () => Promise<void> } {
  const mode = useSyncExternalStore(subscribe, currentMode);
  const install = async () => {
    const e = deferred;
    if (!e) return;
    deferred = null;
    await e.prompt();
    await e.userChoice;
    notify();
  };
  return { mode, install };
}
