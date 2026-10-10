import { describe, expect, it } from 'vitest';
import {
  encodeTaskXml,
  renderTaskXml,
  schtasksCreateArgs,
  schtasksDeleteArgs,
  windowsArg,
  windowsUserId,
  xmlEscape,
} from '../../scripts/lib/windows-task';

const base = {
  userId: 'CLUB-PC\\Админ',
  workingDirectory: 'C:\\Учёт\\finmap-clone',
  command: ['C:\\Program Files\\nodejs\\node.exe', 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js', 'start'],
  conhostPath: 'C:\\Windows\\System32\\conhost.exe',
  description: 'Автозапуск «Учёт»',
};

describe('задача Планировщика Windows', () => {
  it('при входе текущего пользователя, от его имени, без лимита времени и без остановки от батареи', () => {
    const xml = renderTaskXml(base);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-16"?>\r\n')).toBe(true);
    expect(xml).toContain('<LogonTrigger>\r\n      <Enabled>true</Enabled>\r\n      <UserId>CLUB-PC\\Админ</UserId>');
    expect(xml).toContain('<LogonType>InteractiveToken</LogonType>');
    expect(xml).toContain('<RunLevel>LeastPrivilege</RunLevel>');
    expect(xml).toContain('<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>');
    expect(xml).toContain('<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>');
    expect(xml).toContain('<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>');
    expect(xml).toContain('<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>');
    expect(xml).not.toContain('RestartOnFailure');
    expect(xml).not.toContain('BootTrigger');
  });

  it('запускает npm start без окна из папки проекта', () => {
    const xml = renderTaskXml(base);
    expect(xml).toContain('<Command>C:\\Windows\\System32\\conhost.exe</Command>');
    expect(xml).toContain(
      '<Arguments>--headless &quot;C:\\Program Files\\nodejs\\node.exe&quot; ' +
        '&quot;C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js&quot; start</Arguments>',
    );
    expect(xml).toContain('<WorkingDirectory>C:\\Учёт\\finmap-clone</WorkingDirectory>');
  });

  it('спецсимволы XML в путях и имени экранируются', () => {
    expect(xmlEscape(`a&b<c>"d"'e'`)).toBe('a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos;');
    const xml = renderTaskXml({ ...base, userId: 'PC\\Tom & Jerry', workingDirectory: 'D:\\R&D <1>' });
    expect(xml).toContain('<UserId>PC\\Tom &amp; Jerry</UserId>');
    expect(xml).toContain('<WorkingDirectory>D:\\R&amp;D &lt;1&gt;</WorkingDirectory>');
  });

  it('аргументы командной строки: кавычки только при пробелах, слэши перед кавычкой удваиваются', () => {
    expect(windowsArg('start')).toBe('start');
    expect(windowsArg('C:\\nodejs\\node.exe')).toBe('C:\\nodejs\\node.exe');
    expect(windowsArg('C:\\Program Files\\node.exe')).toBe('"C:\\Program Files\\node.exe"');
    expect(windowsArg('C:\\My Dir\\')).toBe('"C:\\My Dir\\\\"');
    expect(windowsArg('say "hi"')).toBe('"say \\"hi\\""');
    expect(windowsArg('')).toBe('""');
  });

  it('файл задачи — UTF-16 LE с BOM', () => {
    const buf = encodeTaskXml('<Task>Учёт</Task>');
    expect([...buf.subarray(0, 2)]).toEqual([0xff, 0xfe]);
    expect(buf.subarray(2).toString('utf16le')).toBe('<Task>Учёт</Task>');
  });

  it('пользователь — DOMAIN\\user; без домена — просто имя', () => {
    expect(windowsUserId({ USERDOMAIN: 'CLUB-PC', USERNAME: 'Админ' }, 'x')).toBe('CLUB-PC\\Админ');
    expect(windowsUserId({}, 'admin')).toBe('admin');
  });

  it('команды schtasks: создать с заменой и удалить без вопросов', () => {
    expect(schtasksCreateArgs('C:\\app\\data\\deploy\\finmap-clone-task.xml')).toEqual([
      '/Create', '/TN', 'finmap-clone', '/XML', 'C:\\app\\data\\deploy\\finmap-clone-task.xml', '/F',
    ]);
    expect(schtasksDeleteArgs()).toEqual(['/Delete', '/TN', 'finmap-clone', '/F']);
  });
});
