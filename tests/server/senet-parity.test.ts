import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCAL_DIR, runParity } from '../../scripts/senet-parity';

/**
 * Сверка с эталоном владельца (спецификация 2026-11-02-senet-autopost, §12.3): только на машине владельца — без
 * .superpowers/senet-local/ (настоящие выгрузки и senet_to_finmap.py) или без Python тест пропускается.
 */
const ready =
  fs.existsSync(path.join(LOCAL_DIR, 'senet_raw', 'cashdesk_session.xlsx')) &&
  fs.existsSync(path.join(LOCAL_DIR, 'senet_to_finmap.py')) &&
  spawnSync('python', ['-c', 'import pandas'], { encoding: 'utf8' }).status === 0;

describe.skipIf(!ready)('сверка с эталоном (локально)', () => {
  it('08.10–01.11.2026: 0 расхождений операций, касса после каждой смены = Senet + 88', () => {
    const r = runParity({ since: '2026-10-08', until: '2026-11-01 23:59:59', offset: 88 });
    expect(r.shifts).toBeGreaterThanOrEqual(48);
    expect([...r.onlyReference, ...r.onlyOurs]).toEqual([]);
    expect(r.reviews.ours).toBe(r.reviews.reference);
    expect(r.balanceMismatches).toEqual([]);
  }, 120_000);
});
