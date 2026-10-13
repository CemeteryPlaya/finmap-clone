import type { AccountMapping, ImportCommitResult, ImportPreview } from '../../src/shared/schemas/imports';
import { finmapLikeXlsx, type FinmapLikeValue } from './finmap-like';
import type { OpsWorld } from './ops';
import { ORIGIN_HEADERS } from './test-app';

/**
 * Импорт синтетического файла через API: загрузка, пересчёт с сопоставлениями (если заданы) и запись. Возвращает ответ
 * 201; любой другой ответ — исключение с телом.
 */
export async function importRows(
  w: OpsWorld,
  rows: FinmapLikeValue[][],
  opts: { accounts?: AccountMapping[]; name?: string; cid?: number } = {},
): Promise<ImportCommitResult> {
  const base = `/api/v1/companies/${opts.cid ?? w.cid}/imports`;
  const up = await w.h.t.app.inject({
    method: 'POST',
    url: `${base}/upload`,
    headers: { ...ORIGIN_HEADERS, cookie: w.h.cookie, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(opts.name ?? 'выгрузка.xlsx') },
    payload: finmapLikeXlsx(rows),
  });
  if (up.statusCode !== 200) throw new Error(`upload: ${up.statusCode} ${up.body}`);
  let p = up.json() as ImportPreview;
  if (opts.accounts) {
    const res = await w.h.req('POST', `${base}/preview`, { token: p.token, accounts: opts.accounts });
    if (res.statusCode !== 200) throw new Error(`preview: ${res.statusCode} ${res.body}`);
    p = res.json() as ImportPreview;
  }
  const res = await w.h.req('POST', base, { token: p.token, accounts: opts.accounts ?? [], revision: p.revision });
  if (res.statusCode !== 201) throw new Error(`commit: ${res.statusCode} ${res.body}`);
  return res.json() as ImportCommitResult;
}
