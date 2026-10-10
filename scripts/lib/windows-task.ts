import { SERVICE_NAME } from './deploy-files';

export function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Аргумент командной строки Windows (правила CommandLineToArgvW): кавычки только когда нужны. */
export function windowsArg(s: string): string {
  if (s !== '' && !/[\s"]/.test(s)) return s;
  let out = '"';
  let slashes = 0;
  for (const ch of s) {
    if (ch === '\\') {
      slashes++;
      continue;
    }
    // Обратные слэши перед кавычкой удваиваются, сама кавычка экранируется.
    out += ch === '"' ? '\\'.repeat(slashes * 2 + 1) + '"' : '\\'.repeat(slashes) + ch;
    slashes = 0;
  }
  // Хвостовые слэши удваиваются, чтобы не съесть закрывающую кавычку.
  return `${out}${'\\'.repeat(slashes * 2)}"`;
}

/** Учётная запись для задачи: DOMAIN\user из окружения Windows. */
export function windowsUserId(env: Record<string, string | undefined>, fallbackUser: string): string {
  const user = env.USERNAME || fallbackUser;
  return env.USERDOMAIN ? `${env.USERDOMAIN}\\${user}` : user;
}

/**
 * Задача Планировщика (§9.1): при входе пользователя, от его имени, без окна.
 * Окно скрывает conhost.exe --headless (powershell -WindowStyle Hidden не прячет окно Windows Terminal).
 * Без лимита времени (по умолчанию Планировщик останавливает задачу через 3 дня), работает от батареи,
 * повторный запуск при уже работающей задаче игнорируется. Перезапуск при падении — у супервизора.
 */
export function renderTaskXml(o: { userId: string; workingDirectory: string; command: string[]; conhostPath: string; description: string }): string {
  const args = ['--headless', ...o.command].map(windowsArg).join(' ');
  const user = xmlEscape(o.userId);
  return [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    '  <RegistrationInfo>',
    `    <Description>${xmlEscape(o.description)}</Description>`,
    '  </RegistrationInfo>',
    '  <Triggers>',
    '    <LogonTrigger>',
    '      <Enabled>true</Enabled>',
    `      <UserId>${user}</UserId>`,
    '    </LogonTrigger>',
    '  </Triggers>',
    '  <Principals>',
    '    <Principal id="Author">',
    `      <UserId>${user}</UserId>`,
    '      <LogonType>InteractiveToken</LogonType>',
    '      <RunLevel>LeastPrivilege</RunLevel>',
    '    </Principal>',
    '  </Principals>',
    '  <Settings>',
    '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>',
    '    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>',
    '    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>',
    '    <AllowHardTerminate>true</AllowHardTerminate>',
    '    <StartWhenAvailable>false</StartWhenAvailable>',
    '    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>',
    '    <AllowStartOnDemand>true</AllowStartOnDemand>',
    '    <Enabled>true</Enabled>',
    '    <Hidden>false</Hidden>',
    '    <RunOnlyIfIdle>false</RunOnlyIfIdle>',
    '    <WakeToRun>false</WakeToRun>',
    '    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>',
    '    <Priority>5</Priority>',
    '  </Settings>',
    '  <Actions Context="Author">',
    '    <Exec>',
    `      <Command>${xmlEscape(o.conhostPath)}</Command>`,
    `      <Arguments>${xmlEscape(args)}</Arguments>`,
    `      <WorkingDirectory>${xmlEscape(o.workingDirectory)}</WorkingDirectory>`,
    '    </Exec>',
    '  </Actions>',
    '</Task>',
    '',
  ].join('\r\n');
}

/** schtasks /XML ждёт файл в UTF-16 LE с BOM (как при экспорте из Планировщика). */
export function encodeTaskXml(xml: string): Buffer {
  return Buffer.from(`\uFEFF${xml}`, 'utf16le');
}

export function schtasksCreateArgs(xmlPath: string, name = SERVICE_NAME): string[] {
  return ['/Create', '/TN', name, '/XML', xmlPath, '/F'];
}

export function schtasksDeleteArgs(name = SERVICE_NAME): string[] {
  return ['/Delete', '/TN', name, '/F'];
}

export function schtasksQueryArgs(name = SERVICE_NAME): string[] {
  return ['/Query', '/TN', name];
}
