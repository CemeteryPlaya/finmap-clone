import { describe, expect, it } from 'vitest';
import { senetDeleteRequests } from '../../src/client/lib/senet';

/** Удаление операции из Senet: «Не проводить повторно» — до удаления (П4 плана 2026-11-02-senet-autopost). */
describe('удаление операции Senet', () => {
  it('без связи или без галочки — только удаление; с галочкой — сначала отметка, потом удаление', () => {
    const del = { method: 'DELETE', url: '/companies/5/operations/7' };
    expect(senetDeleteRequests(5, 7, null, true)).toEqual([del]);
    expect(senetDeleteRequests(5, 7, { shiftId: 1, kind: 'move', noRepost: false }, false)).toEqual([del]);
    expect(senetDeleteRequests(5, 7, { shiftId: 1, kind: 'move', noRepost: false }, true)).toEqual([{ method: 'PATCH', url: '/companies/5/senet/links/7', body: { noRepost: true } }, del]);
  });
});
