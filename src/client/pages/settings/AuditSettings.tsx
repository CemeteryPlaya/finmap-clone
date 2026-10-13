import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { formatDateTime } from '../../../shared/dates';
import { Field } from '../../components/Field';
import { Pending, StaleNotice } from '../../components/QueryState';
import { btnSecondary, inputClass } from '../../components/ui';
import { ACTION_LABELS, auditSubject, COMPANY_ENTITIES, diffRows, ENTITY_LABELS, importDetails, pageDiff, SYSTEM_ENTITIES } from '../../lib/audit-format';
import { OPERATION_FIELD_LABELS } from '../../lib/history';
import { useMeta } from '../../lib/query';
import { useAuditFeed, useUsers, type AuditEntry } from '../../lib/queries';
import type { CompanyOutletContext } from '../CompanyLayout';

type Scope = 'company' | 'system';

function AuditItem({ e, timeZone }: { e: AuditEntry; timeZone: string }) {
  const diff = pageDiff(e);
  const rows = diffRows(diff, e.entity);
  // импорт (§6.5 спецификации импорта): имя файла в строке записи, в подробностях — числа или итог отмены
  const subject = auditSubject(e);
  const details = importDetails(e);
  return (
    <li className="rounded-2xl border border-field p-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <time dateTime={e.at} className="text-muted">
          {formatDateTime(e.at, timeZone)}
        </time>
        <span className="font-semibold">{e.userName ?? 'Система'}</span>
        <span>{ACTION_LABELS[e.action] ?? e.action}</span>
        <span className="text-muted">
          {ENTITY_LABELS[e.entity] ?? e.entity}
          {e.entityId !== null ? ` №${e.entityId}` : ''}
        </span>
        {subject && <span className="min-w-0 [overflow-wrap:anywhere]">{subject}</span>}
      </div>
      {diff && (
        <details className="mt-2">
          <summary className="cursor-pointer text-muted">Подробности</summary>
          {details ? (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              {details.map((d) => (
                <div key={d.label} className="contents">
                  <dt className="text-muted">{d.label}</dt>
                  <dd>{d.value}</dd>
                </div>
              ))}
            </dl>
          ) : rows ? (
            <table className="mt-2 w-full text-left">
              <thead>
                <tr className="text-muted">
                  <th className="pr-3 font-normal">Поле</th>
                  <th className="pr-3 font-normal">Было</th>
                  <th className="font-normal">Стало</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.field}>
                    {/* поля операции — по-русски, как в панели истории («Тип», «Счёт зачисления») */}
                    <td className="pr-3 align-top">{e.entity === 'operation' ? (OPERATION_FIELD_LABELS[r.field] ?? r.field) : r.field}</td>
                    <td className="pr-3 align-top text-expense-strong">{r.before}</td>
                    <td className="align-top text-income">{r.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <pre className="mt-2 overflow-x-auto rounded-xl bg-field p-3 text-xs">{JSON.stringify(diff, null, 2)}</pre>
          )}
        </details>
      )}
    </li>
  );
}

export function AuditSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const meta = useMeta();
  const users = useUsers();
  const [scope, setScope] = useState<Scope>('company');
  const [userId, setUserId] = useState('');
  const [entity, setEntity] = useState('');
  const feed = useAuditFeed(scope === 'company' ? company.id : null, {
    ...(userId ? { userId: Number(userId) } : {}),
    ...(entity ? { entity } : {}),
  });

  if (!feed.data || !meta.data || !users.data) return <Pending queries={[feed, meta, users]} />;
  const timeZone = meta.data.timezone;
  const entries = feed.data.pages.flatMap((p) => p.entries);
  const entityOptions: readonly string[] = scope === 'company' ? COMPANY_ENTITIES : SYSTEM_ENTITIES;
  const switchScope = (s: Scope) => {
    setScope(s);
    setEntity('');
  };

  return (
    <section>
      <StaleNotice queries={[feed]} />
      <h1 className="mb-4 text-2xl font-bold">История действий</h1>
      <div role="group" aria-label="Лента событий" className="mb-4 flex flex-wrap gap-2">
        {(['company', 'system'] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={scope === s}
            onClick={() => switchScope(s)}
            className={`rounded-xl px-3 py-1.5 text-sm ${scope === s ? 'bg-ink font-semibold text-white' : 'bg-field text-ink hover:brightness-95'}`}
          >
            {s === 'company' ? `Компания «${company.name}»` : 'Система'}
          </button>
        ))}
      </div>
      <div className="mb-4 grid max-w-2xl gap-3 md:grid-cols-2">
        <Field label="Пользователь">
          {(c) => (
            <select {...c} value={userId} onChange={(e) => setUserId(e.target.value)} className={inputClass}>
              <option value="">Все</option>
              {users.data.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Что изменилось">
          {(c) => (
            <select {...c} value={entity} onChange={(e) => setEntity(e.target.value)} className={inputClass}>
              <option value="">Всё</option>
              {entityOptions.map((x) => (
                <option key={x} value={x}>
                  {ENTITY_LABELS[x] ?? x}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {entries.length === 0 && <p className="text-muted">Событий нет.</p>}
      <ol className="space-y-2">
        {entries.map((e) => (
          <AuditItem key={e.id} e={e} timeZone={timeZone} />
        ))}
      </ol>
      {feed.hasNextPage && (
        <button type="button" onClick={() => void feed.fetchNextPage()} disabled={feed.isFetchingNextPage} className={`${btnSecondary} mt-4`}>
          {feed.isFetchingNextPage ? 'Загрузка…' : 'Показать ещё'}
        </button>
      )}
    </section>
  );
}
