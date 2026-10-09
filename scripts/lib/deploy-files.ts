/** Имя юнита systemd и задачи Планировщика (§3 «Структура репозитория»: deploy/finmap-clone.service). */
export const SERVICE_NAME = 'finmap-clone';

/** Адрес приложения для Caddy на той же машине: «все интерфейсы» и localhost — это 127.0.0.1. */
export function upstreamAddress(host: string, port: number): string {
  if (host === '::1') return `[::1]:${port}`;
  if (['', '0.0.0.0', '::', 'localhost', '127.0.0.1'].includes(host)) return `127.0.0.1:${port}`;
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;
}

/**
 * Caddyfile для режима vps (§8.1): сайт по хосту PUBLIC_URL (Caddy сам получает сертификат)
 * и обратный прокси в приложение. Caddy передаёт X-Forwarded-For/Proto, приложение доверяет им
 * только от loopback (§8 «IP клиента»).
 */
export function renderCaddyfile(o: { publicUrl: string; host: string; port: number }): string {
  const site = new URL(o.publicUrl).host;
  return [
    `# Caddy для ${o.publicUrl}: HTTPS и проксирование в приложение.`,
    '# Сертификат Caddy получает сам; порты 80 и 443 должны быть открыты.',
    `${site} {`,
    '\tencode zstd gzip',
    `\treverse_proxy ${upstreamAddress(o.host, o.port)}`,
    '}',
    '',
  ].join('\n');
}

/** Экранирование спецификаторов systemd (%) в любом значении. */
function systemdValue(s: string): string {
  return s.replace(/%/g, '%%');
}

/** Аргумент ExecStart: % и $ экранируются, пробелы, кавычки и \ — в двойных кавычках. */
export function systemdArg(s: string): string {
  const v = systemdValue(s).replace(/\$/g, '$$$$');
  if (v !== '' && !/[\s"'\\;]/.test(v)) return v;
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Путь или присваивание в списке systemd: % экранируется, пробелы, кавычки и \ — в двойных кавычках. */
function systemdWord(s: string): string {
  const v = systemdValue(s);
  if (v !== '' && !/[\s"'\\;]/.test(v)) return v;
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * systemd-юнит (§9.1: на Linux — от отдельного пользователя). Перезапуск при падении — у супервизора и systemd.
 * Песочница: вся система только для чтения, кроме readWritePaths (папка приложения, данные, копии бэкапов);
 * путь с «-» в начале может отсутствовать (флешка не смонтирована) — юнит всё равно стартует.
 * Кэш npm — в папке данных: домашняя папка пользователя в песочнице только для чтения.
 */
export function renderSystemdUnit(o: {
  appName: string;
  user: string;
  workingDirectory: string;
  dataDir: string;
  execStart: string[];
  readWritePaths: string[];
}): string {
  return [
    '[Unit]',
    `Description=${systemdValue(o.appName)} (${SERVICE_NAME})`,
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `User=${systemdValue(o.user)}`,
    `WorkingDirectory=${systemdValue(o.workingDirectory)}`,
    `Environment=${systemdWord(`npm_config_cache=${o.dataDir}/npm-cache`)}`,
    'Environment=npm_config_update_notifier=false',
    `ExecStart=${o.execStart.map(systemdArg).join(' ')}`,
    'Restart=on-failure',
    'RestartSec=10',
    'TimeoutStopSec=30',
    'UMask=0077',
    'NoNewPrivileges=true',
    'PrivateTmp=true',
    'ProtectSystem=strict',
    `ReadWritePaths=${o.readWritePaths.map(systemdWord).join(' ')}`,
    'ProtectKernelTunables=true',
    'ProtectControlGroups=true',
    'RestrictSUIDSGID=true',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
  ].join('\n');
}

/** Значения для примеров в deploy/ (README ссылается на них). */
export const EXAMPLE = {
  publicUrl: 'https://fin.example.kz',
  host: '127.0.0.1',
  port: 3000,
  appName: 'Учёт',
  user: 'finmap',
  workingDirectory: '/opt/finmap-clone',
  dataDir: '/opt/finmap-clone/data',
  execStart: ['/usr/bin/npm', 'start'],
  readWritePaths: ['/opt/finmap-clone'],
} as const;
