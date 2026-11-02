import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Config } from './config';

/**
 * Секретный ключ сервера (спецификация 2026-11-02-senet-autopost, §10): шифрует данные входа Senet (AES-256-GCM) и
 * даёт ключ HMAC для телефонов гостей. Локально — файл в DATA_DIR (права только владельца процесса, в резервную копию
 * не входит), на Vercel — переменная SECRET_KEY: файловая система функции временная.
 */
export interface Secrets {
  /** base64(iv 12 | tag 16 | шифртекст). */
  seal(plain: string): string;
  open(sealed: string): string;
  /** HMAC-SHA256 номера, приведённого к цифрам с 7 в начале; hex. */
  phoneHash(phone: string): string;
}

export class SecretsError extends Error {
  constructor(
    readonly code: 'undecryptable' | 'missing',
    message: string,
  ) {
    super(message);
  }
}

const KEY_FILE = 'secret.key';

export function loadSecrets(config: Config, opts: { create?: boolean } = {}): Secrets | null {
  let key: Buffer | null = null;
  if (config.secretKey) key = Buffer.from(config.secretKey, 'base64');
  else if (config.deployMode !== 'vercel') {
    const file = path.join(config.dataDir, KEY_FILE);
    if (fs.existsSync(file)) key = fs.readFileSync(file);
    else if (opts.create) {
      fs.mkdirSync(config.dataDir, { recursive: true });
      try {
        fs.writeFileSync(file, crypto.randomBytes(32), { mode: 0o600, flag: 'wx' });
      } catch (e) {
        // файл успел создать параллельный запрос — читаем его
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      }
      key = fs.readFileSync(file);
    }
  }
  if (!key) return null;
  if (key.length !== 32) throw new SecretsError('missing', 'Секретный ключ повреждён: нужно ровно 32 байта');
  return createSecrets(key);
}

function createSecrets(key: Buffer): Secrets {
  const hmacKey = Buffer.from(crypto.hkdfSync('sha256', key, Buffer.alloc(0), 'senet-phone', 32));
  return {
    seal(plain) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
    },
    open(sealed) {
      try {
        const raw = Buffer.from(sealed, 'base64');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
        decipher.setAuthTag(raw.subarray(12, 28));
        return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
      } catch {
        throw new SecretsError('undecryptable', 'Данные входа не расшифрованы — введите заново');
      }
    },
    phoneHash(phone) {
      return crypto.createHmac('sha256', hmacKey).update(`phone:${phoneDigits(phone)}`).digest('hex');
    },
  };
}

/** Цифры номера в виде 7XXXXXXXXXX: 8 в начале заменяется на 7, к десяти цифрам добавляется 7. */
function phoneDigits(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('8')) return `7${d.slice(1)}`;
  if (d.length === 10) return `7${d}`;
  return d;
}

/** Маска для показа: «+7 *** ** 12» — только две последние цифры; меньше двух цифр — «—». */
export function phoneMask(phone: string): string {
  const d = phoneDigits(phone);
  return d.length < 2 ? '—' : `+7 *** ** ${d.slice(-2)}`;
}
