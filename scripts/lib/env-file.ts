import fs from 'node:fs';

/** Шаблон настроек: используется, когда файла-шаблона в папке нет. */
export const ENV_TEMPLATE = `# Название продукта в интерфейсе и PWA
APP_NAME=Учёт
APP_TIMEZONE=Asia/Almaty
HOST=127.0.0.1
PORT=3000
# Внешний адрес (https://fin.example.kz). Пусто = http://localhost:PORT
PUBLIC_URL=
# local | cloudflare | ngrok | vps
DEPLOY_MODE=local
CF_TUNNEL_TOKEN=
CLOUDFLARED_PATH=
NGROK_AUTHTOKEN=
NGROK_DOMAIN=
# Генерируется npm run setup
SESSION_SECRET=
# Доп. разрешённые origin через запятую (например http://192.168.1.10:3000 при HOST=0.0.0.0)
EXTRA_ORIGINS=
BACKUP_KEEP=14
# Папка для копий бэкапов (OneDrive, Google Drive, сетевая шара)
BACKUP_COPY_DIR=
RATES_SOURCE=nbrk
`;

/** Убирает http(s):// и хвостовые слэши; пустая строка, если адреса нет. */
export function normalizeHost(input: string): string {
  return input.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').trim();
}

/** Атомарная запись с правами 0600 (файл содержит секреты): temp в той же папке -> rename -> chmod. */
export function writeEnvFileSecure(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  fs.chmodSync(file, 0o600);
}

const LINE =/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/;

function unquote(v: string): string {
  const m = v.match(/^"(.*)"$/) ?? v.match(/^'(.*)'$/);
  return m ? m[1]! : v;
}

export function parseEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = line.match(LINE);
    if (m) out.set(m[1]!, unquote(m[2]!));
  }
  return out;
}

export function updateEnvText(text: string, updates: Record<string, string>): string {
  const pending = new Map(Object.entries(updates));
  const lines = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  const result = lines.map((line) => {
    const m = line.match(LINE);
    if (m && !/^\s*#/.test(line) && pending.has(m[1]!)) {
      const v = pending.get(m[1]!)!;
      pending.delete(m[1]!);
      return `${m[1]}=${v}`;
    }
    return line;
  });
  for (const [k, v] of pending) result.push(`${k}=${v}`);
  return result.filter((l, i) => !(i === 0 && l === '' && result.length === 1)).join('\n') + '\n';
}
