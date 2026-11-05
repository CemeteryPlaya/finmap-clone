import { Link } from 'react-router';
import { delta } from '../../../shared/club-analytics/delta';
import { sparkPath, tileValueText, type OverviewTile } from '../../lib/club-overview';

const TONE = { up: 'text-income-strong', down: 'text-expense-strong', flat: 'text-muted' } as const;

/** Δ плитки к прошлому периоду (§2.2): прошлого нет — «—»; «≈» у сумм при неполных данных. */
function TileDelta(props: { tile: OverviewTile }) {
  const t = props.tile;
  const d = delta(t.value, t.prev, t.kind, t.approx);
  if (!d) return <span className="text-xs text-muted">—</span>;
  return (
    <span className={`text-xs font-semibold ${TONE[d.tone]}`} title={t.approx && t.kind === 'sum' ? 'данные не за все дни' : undefined}>
      {d.text}
      <span className="sr-only"> к прошлому периоду</span>
    </span>
  );
}

/** Мини-график без осей: только форма ряда по дням. */
function Spark(props: { values: readonly (number | null)[] }) {
  const d = sparkPath(props.values);
  if (!d) return <span aria-hidden="true" className="block h-6" />;
  return (
    <svg aria-hidden="true" viewBox="-2 -2 104 28" preserveAspectRatio="none" className="block h-6 w-full overflow-visible">
      <path d={d} fill="none" strokeWidth={2} vectorEffect="non-scaling-stroke" className="stroke-income" />
    </svg>
  );
}

/**
 * Плитка «Обзора клуба» (§4): название, значение периода, Δ к прошлому (при сравнении) и мини-график по дням. Доступная
 * плитка — ссылка в свой отчёт с тем же периодом и клубом; недоступная — серая, с пометкой вместо значения.
 */
export function Tile(props: { tile: OverviewTile; to: string | null; compare: boolean }) {
  const t = props.tile;
  const body = (
    <>
      <span className="text-sm text-muted">{t.label}</span>
      {t.available ? (
        <span className="text-xl font-bold text-ink tabular-nums max-md:text-lg">{tileValueText(t)}</span>
      ) : (
        <span className="text-sm text-muted">{tileValueText(t)}</span>
      )}
      {t.available && props.compare && <TileDelta tile={t} />}
      {t.available && <Spark values={t.spark} />}
    </>
  );
  const box = 'flex min-h-32 flex-col gap-1 rounded-xl bg-card p-4 ring-1 ring-field';
  if (!t.available || !props.to) return <div className={`${box} ${t.available ? '' : 'bg-field/40'}`}>{body}</div>;
  return (
    <Link to={props.to} className={`${box} hover:ring-income focus-visible:outline-2 focus-visible:outline-focus`}>
      {body}
    </Link>
  );
}
