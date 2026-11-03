import { describe, expect, it } from 'vitest';
import { connectionKey, defaultOfficeAccounts, isoToLocalInput, localInputToIso, officeStateText, orgFromInput, senetAddress, statusText } from '../../src/client/lib/senet';

/** «Интеграции» → Senet: окно подключения (план 2026-11-02-senet-autopost, задача 5). */
describe('окно подключения Senet', () => {
  it('адрес организации: имя или ссылка на админ-панель; итоговый адрес', () => {
    expect(orgFromInput('club-demo')).toBe('club-demo');
    expect(orgFromInput(' Club-Demo ')).toBe('club-demo');
    expect(orgFromInput('https://club-demo.admin-v2.enes.tech/')).toBe('club-demo');
    expect(orgFromInput('https://club-demo.admin.enes.tech/map/1')).toBe('club-demo');
    expect(orgFromInput('club-demo.admin-v2.enes.tech')).toBe('club-demo');
    expect(orgFromInput('evil.com/x')).toBeNull();
    expect(orgFromInput('')).toBeNull();
    expect(senetAddress('club-demo')).toBe('https://club-demo.app.enes.tech');
  });

  it('«Сохранить» — только после проверки тех же данных: любая правка требует новой проверки', () => {
    const a = connectionKey({ org: 'club-demo', authMethod: 'password', username: 'reports', password: 'p1', token: '', officeId: 1, cashDeskId: 1 });
    expect(connectionKey({ org: 'club-demo', authMethod: 'password', username: 'reports', password: 'p1', token: 'лишнее', officeId: 1, cashDeskId: 1 })).toBe(a);
    expect(connectionKey({ org: 'club-demo', authMethod: 'password', username: 'reports', password: 'p2', token: '', officeId: 1, cashDeskId: 1 })).not.toBe(a);
    expect(connectionKey({ org: 'club-demo', authMethod: 'token', username: 'reports', password: 'p1', token: 't', officeId: 1, cashDeskId: 1 })).not.toBe(a);
  });

  it('счета клуба по умолчанию — «Касса {проект}» и «Kaspi {проект}» в KZT, без архивных', () => {
    const acc = (id: number, name: string, currency = 'KZT', archivedAt: string | null = null) => ({ id, name, currency, archivedAt });
    const list = [acc(1, 'Касса Клуб 1'), acc(2, 'Kaspi Клуб 1'), acc(3, 'Касса Клуб 2', 'KZT', '2026-01-01'), acc(4, 'Kaspi Клуб 2', 'USD')];
    expect(defaultOfficeAccounts(list, 'Клуб 1')).toEqual({ cashAccountId: 1, kaspiAccountId: 2 });
    expect(defaultOfficeAccounts(list, 'Клуб 2')).toEqual({ cashAccountId: null, kaspiAccountId: null });
  });

  it('«Загружать с даты»: поле datetime-local в часах клуба ↔ момент UTC', () => {
    expect(localInputToIso('2026-10-08T10:05', 'Asia/Almaty')).toBe('2026-10-08T05:05:00.000Z');
    expect(isoToLocalInput('2026-10-08T05:05:00.000Z', 'Asia/Almaty')).toBe('2026-10-08T10:05');
    expect(localInputToIso('', 'Asia/Almaty')).toBeNull();
    expect(isoToLocalInput(null, 'Asia/Almaty')).toBe('');
  });

  it('состояние подключения словами', () => {
    expect(statusText({ status: 'ok', lastSyncAt: null, archivedAt: null })).toBe('Подключено, данных ещё не забирали');
    expect(statusText({ status: 'key_rejected', lastSyncAt: null, archivedAt: null })).toBe('Обновите доступ к Senet — забор остановлен');
    expect(statusText({ status: 'unreachable', lastSyncAt: null, archivedAt: null })).toBe('Senet не отвечает — попробуем снова через час');
    expect(statusText({ status: 'ok', lastSyncAt: null, archivedAt: '2026-10-01' })).toBe('Отключено');
  });

  it('состояние клуба: выключенный — что он забирает и как его включить', () => {
    expect(officeStateText({ enabled: true })).toBe('забирается');
    expect(officeStateText({ enabled: false })).toBe('выключен: забирается только «Загрузить за период». Чтобы смены проводились сами — «Изменить», связи и галочка «Забирать и проводить»');
  });
});
