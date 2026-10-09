import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFileLog,
  lenientRunConfig,
  loadConfigOrLog,
  logStartupError,
  runFiles,
  takeStopRequest,
} from '../../scripts/lib/run-files';

let dir = '';
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = '';
});
const tmp = () => (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-run-files-')));

describe('служебные файлы супервизора', () => {
  it('лежат в папке данных, журнал — в logs/', () => {
    const f = runFiles('/srv/data');
    expect(f.supervisorLock).toBe(path.join('/srv/data', 'supervisor.lock'));
    expect(f.stopRequest).toBe(path.join('/srv/data', 'stop.request'));
    expect(f.supervisorLog).toBe(path.join('/srv/data', 'logs', 'supervisor.log'));
  });

  it('заявка на остановку забирается один раз', () => {
    const file = path.join(tmp(), 'stop.request');
    expect(takeStopRequest(file)).toBe(false);
    fs.writeFileSync(file, '');
    expect(takeStopRequest(file)).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
    expect(takeStopRequest(file)).toBe(false);
  });
});

describe('журнал супервизора в файле', () => {
  it('создаёт папку и дописывает строки со временем', () => {
    const file = path.join(tmp(), 'logs', 'supervisor.log');
    const log = createFileLog(file, { now: () => new Date('2026-10-07T10:00:00.000Z') });
    log('[server] завершился с кодом 1; перезапуск через 1 с');
    log('второе');
    expect(fs.readFileSync(file, 'utf8')).toBe(
      '2026-10-07T10:00:00.000Z [server] завершился с кодом 1; перезапуск через 1 с\n2026-10-07T10:00:00.000Z второе\n',
    );
  });

  it('при превышении размера переносит старое в .1 и начинает заново', () => {
    const file = path.join(tmp(), 'supervisor.log');
    const log = createFileLog(file, { maxBytes: 50, now: () => new Date('2026-10-07T10:00:00.000Z') });
    log('a'.repeat(40));
    log('b'.repeat(40));
    log('c');
    expect(fs.readFileSync(`${file}.1`, 'utf8')).toContain('b'.repeat(40));
    expect(fs.readFileSync(file, 'utf8')).toBe('2026-10-07T10:00:00.000Z c\n');
  });

  it('ошибка записи не выбрасывается (вместо папки журналов — файл)', () => {
    const blocker = path.join(tmp(), 'logs');
    fs.writeFileSync(blocker, 'x');
    const log = createFileLog(path.join(blocker, 'supervisor.log'));
    expect(() => log('сообщение')).not.toThrow();
  });
});

describe('настройки супервизора', () => {
  it('lenientRunConfig: пути и порт без проверки остальных настроек; значения по умолчанию', () => {
    expect(lenientRunConfig({})).toEqual({
      dataDir: path.resolve('data'),
      lockPath: path.resolve('data', 'app.lock'),
      host: '127.0.0.1',
      port: 3000,
    });
    const c = lenientRunConfig({ DATA_DIR: ' /srv/fin ', HOST: '0.0.0.0', PORT: '3457', SESSION_SECRET: 'short' });
    expect(c).toEqual({ dataDir: path.resolve('/srv/fin'), lockPath: path.resolve('/srv/fin', 'app.lock'), host: '0.0.0.0', port: 3457 });
    expect(lenientRunConfig({ PORT: 'abc' }).port).toBe(3000);
  });

  it('ошибка настроек при автозапуске попадает в data/logs/supervisor.log', () => {
    const data = tmp();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const config = loadConfigOrLog({ DATA_DIR: data, SESSION_SECRET: 'short' }, () => new Date('2026-10-07T10:00:00.000Z'));
    vi.restoreAllMocks();
    expect(config).toBeNull();
    const log = fs.readFileSync(path.join(data, 'logs', 'supervisor.log'), 'utf8');
    expect(log).toMatch(/^2026-10-07T10:00:00\.000Z Приложение не запущено: .*SESSION_SECRET/);
  });

  it('верные настройки — Config, журнал не пишется', () => {
    const data = tmp();
    const config = loadConfigOrLog({ DATA_DIR: data, SESSION_SECRET: 's'.repeat(40) });
    expect(config?.dataDir).toBe(path.resolve(data));
    expect(fs.existsSync(path.join(data, 'logs'))).toBe(false);
  });
});

describe('logStartupError (ruling R2)', () => {
  it('пишет сообщение в консоль и в <DATA_DIR>/logs/supervisor.log со временем', () => {
    const data = tmp();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logStartupError({ DATA_DIR: data }, 'Не удалось прочитать файл настроек: bad', () => new Date('2026-10-07T10:00:00.000Z'));
    expect(spy).toHaveBeenCalledWith('Не удалось прочитать файл настроек: bad');
    vi.restoreAllMocks();
    expect(fs.readFileSync(path.join(data, 'logs', 'supervisor.log'), 'utf8')).toBe(
      '2026-10-07T10:00:00.000Z Не удалось прочитать файл настроек: bad\n',
    );
  });
});
