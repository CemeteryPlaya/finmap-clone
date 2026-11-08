import { describe, expect, it } from 'vitest';
import { installMode } from '../../src/client/lib/install-app';

/** «Установить приложение» в панели «Настройки» (PWA, решение владельца 2026-11-08). */
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

describe('installMode', () => {
  it('уже установлено (открыто как приложение) — ничего', () => {
    expect(installMode({ standalone: true, canPrompt: true, userAgent: ANDROID, maxTouchPoints: 5 })).toBe('installed');
  });
  it('браузер предложил установку — кнопка', () => {
    expect(installMode({ standalone: false, canPrompt: true, userAgent: ANDROID, maxTouchPoints: 5 })).toBe('prompt');
  });
  it('iPhone и iPad (в том числе «как компьютер») — подсказка «Поделиться → На экран „Домой“»', () => {
    expect(installMode({ standalone: false, canPrompt: false, userAgent: IPHONE, maxTouchPoints: 5 })).toBe('ios');
    expect(installMode({ standalone: false, canPrompt: false, userAgent: IPAD_DESKTOP, maxTouchPoints: 5 })).toBe('ios');
  });
  it('Mac без сенсора и браузер без предложения — ничего', () => {
    expect(installMode({ standalone: false, canPrompt: false, userAgent: IPAD_DESKTOP, maxTouchPoints: 0 })).toBe('none');
    expect(installMode({ standalone: false, canPrompt: false, userAgent: ANDROID, maxTouchPoints: 5 })).toBe('none');
  });
});
