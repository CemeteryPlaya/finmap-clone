import { describe, expect, it } from 'vitest';
import { connectWithRetry, isFatalNgrokError, maskSecret } from '../../scripts/lib/ngrok';

function ngrokError(message: string, errorCode?: string): Error {
  return Object.assign(new Error(message), errorCode ? { errorCode } : {});
}

describe('maskSecret', () => {
  it('заменяет каждое вхождение секрета на ***', () => {
    expect(maskSecret('token 2abcSECRET is invalid; 2abcSECRET', '2abcSECRET')).toBe('token *** is invalid; ***');
  });

  it('пустой или отсутствующий секрет не меняет текст', () => {
    expect(maskSecret('some text', '')).toBe('some text');
    expect(maskSecret('some text', null)).toBe('some text');
    expect(maskSecret('some text', undefined)).toBe('some text');
  });

  it('секрет со спецсимволами регулярных выражений маскируется буквально', () => {
    expect(maskSecret('a.b*c+d a.b*c+d', 'a.b*c+d')).toBe('*** ***');
  });
});

describe('isFatalNgrokError', () => {
  it('ERR_NGROK_105 (неверный authtoken) — фатальная', () => {
    const e = ngrokError(
      'The authentication you specified does not look like a proper ngrok authtoken: "xyz".\n\nERR_NGROK_105\n\nerror_code: ERR_NGROK_105',
      'ERR_NGROK_105',
    );
    expect(isFatalNgrokError(e)).toBe(true);
  });

  it('код 105 распознаётся и по тексту сообщения без errorCode', () => {
    expect(isFatalNgrokError(ngrokError('failed to start tunnel: ERR_NGROK_105'))).toBe(true);
  });

  it('ERR_NGROK_3xx про домен — фатальная', () => {
    const e = ngrokError(
      'The domain "x.ngrok-free.app" is not reserved for your account.\n\nerror_code: ERR_NGROK_320',
      'ERR_NGROK_320',
    );
    expect(isFatalNgrokError(e)).toBe(true);
  });

  it('ERR_NGROK_3xx без упоминания домена — повторяем', () => {
    expect(isFatalNgrokError(ngrokError('session limit\n\nerror_code: ERR_NGROK_324', 'ERR_NGROK_324'))).toBe(false);
  });

  it('сетевая ошибка — повторяем', () => {
    const e = Object.assign(new Error('failed to connect to connect.ngrok-agent.com:443: getaddrinfo ENOTFOUND'), {
      code: 'ENOTFOUND',
    });
    expect(isFatalNgrokError(e)).toBe(false);
  });

  it('неизвестная ошибка — повторяем', () => {
    expect(isFatalNgrokError(new Error('something odd'))).toBe(false);
    expect(isFatalNgrokError('plain string')).toBe(false);
    expect(isFatalNgrokError(null)).toBe(false);
  });
});

describe('connectWithRetry', () => {
  function harness(outcomes: Array<'ok' | Error>, stopAfterSleeps = Infinity) {
    const sleeps: number[] = [];
    const retries: Array<{ err: unknown; delayMs: number }> = [];
    let calls = 0;
    let stopped = false;
    const run = connectWithRetry({
      connect: async () => {
        const o = outcomes[Math.min(calls++, outcomes.length - 1)]!;
        if (o === 'ok') return 'listener';
        throw o;
      },
      isFatal: isFatalNgrokError,
      isStopped: () => stopped,
      sleep: async (ms) => {
        sleeps.push(ms);
        if (sleeps.length >= stopAfterSleeps) stopped = true;
      },
      onRetry: (err, delayMs) => retries.push({ err, delayMs }),
    });
    return { run, sleeps, retries, calls: () => calls };
  }

  it('повторяет сетевые ошибки с нарастающей паузой 1→2→4…60 с', async () => {
    const net = new Error('ENOTFOUND');
    const h = harness([...Array<Error>(8).fill(net), 'ok']);
    await expect(h.run).resolves.toBe('listener');
    expect(h.sleeps).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000]);
    expect(h.retries).toHaveLength(8);
  });

  it('фатальную ошибку пробрасывает сразу, без повторов', async () => {
    const fatal = ngrokError('bad token\n\nerror_code: ERR_NGROK_105', 'ERR_NGROK_105');
    const h = harness([fatal]);
    await expect(h.run).rejects.toBe(fatal);
    expect(h.sleeps).toEqual([]);
    expect(h.calls()).toBe(1);
  });

  it('прекращает попытки при остановке и возвращает null', async () => {
    const h = harness([new Error('ENOTFOUND')], 2);
    await expect(h.run).resolves.toBeNull();
    expect(h.calls()).toBe(2);
  });
});
