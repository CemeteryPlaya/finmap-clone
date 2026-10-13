import { useId, useState, type Ref } from 'react';
import type { AccountMapping, ImportPreview } from '../../../shared/schemas/imports';
import { checkSummary, createGroups, formatCount, issueRowsText, issueText, type CreateGroup } from '../../lib/import-panel';
import type { Account } from '../../lib/queries';
import { alertClass } from '../ui';
import { ImportAccountCard } from './ImportAccountCard';

/** Группа «Будет создано» (§5.3 п. 4, §5.8): кнопка с aria-expanded и счётчиком в имени, по умолчанию свёрнута. */
function CreateGroupView({ group }: { group: CreateGroup }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <div className="border-b border-field py-1 last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center justify-between gap-2 text-left font-medium focus-visible:outline-2 focus-visible:outline-focus"
      >
        {group.title}: {formatCount(group.total)}
        <span aria-hidden="true" className="text-muted">
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <div id={listId} className="pb-2 text-sm">
          {group.sections.map((s) => (
            <div key={s.title ?? ''} className="mb-1">
              {s.title && <p className="mt-1 text-xs font-semibold text-muted">{s.title}</p>}
              <ul>
                {s.items.map((i) => (
                  <li key={i.name} className="[overflow-wrap:anywhere]">
                    {i.name}
                    {i.note && <span className="text-muted"> · {i.note}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {group.more > 0 && <p className="text-muted">и ещё {formatCount(group.more)}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * Предпросмотр (§5.3 спецификации импорта) сверху вниз: итог (`h3` «Проверка файла», фокус на нём после проверки),
 * ошибки (`role="alert"`), «Счета из файла», «Будет создано», предупреждения.
 */
export function ImportPreviewView(props: {
  preview: ImportPreview;
  headingRef: Ref<HTMLHeadingElement>;
  accounts: readonly Account[];
  baseCurrency: string;
  onCardChange: (key: string, mapping: AccountMapping | null, error: string | null) => void;
}) {
  const p = props.preview;
  const groups = createGroups(p);
  return (
    <div className="grid gap-4">
      <section className="grid gap-1">
        <h3 ref={props.headingRef} tabIndex={-1} className="text-lg font-semibold focus:outline-none">
          Проверка файла
        </h3>
        <p className="text-sm">{checkSummary(p)}</p>
        <p className="text-sm font-semibold">Будет добавлено: {formatCount(p.counts.add)}</p>
        {p.duplicates.count > 0 && (
          <p className="text-sm">
            Дубликаты: {formatCount(p.duplicates.count)} — уже есть в компании, будут пропущены ({issueRowsText({ count: p.duplicates.count, rows: p.duplicates.rows })})
          </p>
        )}
        {p.counts.skippedFuture > 0 && <p className="text-sm">Плановые: {formatCount(p.counts.skippedFuture)} — пропущены</p>}
      </section>

      {p.errors.total > 0 && (
        <div role="alert" className={`${alertClass} mb-0`}>
          <p className="font-semibold">Найдено ошибок: {formatCount(p.errors.total)}. Исправьте файл и загрузите его снова</p>
          <ul className="mt-1 list-disc pl-5">
            {p.errors.byCode.map((g) => (
              <li key={`${g.code}-${g.message}`} className="[overflow-wrap:anywhere]">
                {issueText(g)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <section className="grid gap-3">
        <h3 className="font-semibold">Счета из файла</h3>
        {p.accounts.map((card) => (
          <ImportAccountCard key={card.key} card={card} accounts={props.accounts} baseCurrency={props.baseCurrency} onChange={props.onCardChange} />
        ))}
      </section>

      {groups.length > 0 && (
        <section>
          <h3 className="font-semibold">Будет создано</h3>
          {groups.map((g) => (
            <CreateGroupView key={g.key} group={g} />
          ))}
        </section>
      )}

      {p.warnings.length > 0 && (
        <section>
          <h3 className="font-semibold">Предупреждения</h3>
          <ul className="mt-1 list-disc pl-5 text-sm text-muted">
            {p.warnings.map((g) => (
              <li key={`${g.code}-${g.message}`} className="[overflow-wrap:anywhere]">
                {issueText(g)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
