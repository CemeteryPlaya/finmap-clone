import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { focusHeadingSoon, isPlainLeftClick } from '../lib/focus-heading';
import { historyItems, type HistoryItem } from '../lib/history';
import { useMeta } from '../lib/query';
import { useAccounts, useOperationHistory, type Company } from '../lib/queries';
import { Drawer } from './Drawer';
import { HistoryIcon } from './icons';
import { useOpenOperationForm } from './operation/OperationFormHost';
import { Pending } from './QueryState';
import { btnPrimary, headerIconClass } from './ui';

const AMOUNT_CLASS: Record<NonNullable<HistoryItem['type']>, string> = { income: 'text-income', expense: 'text-expense', transfer: 'text-transfer' };

/** Иконка «История действий» в шапке и правая панель с последними действиями по операциям (§3.4 этапа 1.5). */
export function HistoryButton({ company }: { company: Company }) {
  const [open, setOpen] = useState(false);
  const navigated = useRef(false);
  /** Операция из списка: форма открывается, когда панель уже закрыта, — по закрытии формы фокус вернётся на эту кнопку. */
  const pendingOperation = useRef<number | null>(null);
  const openForm = useOpenOperationForm();
  return (
    <>
      <button type="button" aria-label="История действий" title="История действий" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} className={headerIconClass}>
        <HistoryIcon />
      </button>
      <Drawer
        open={open}
        side="right"
        title="История действий"
        onClose={() => setOpen(false)}
        afterClose={() => {
          const handled = navigated.current;
          navigated.current = false;
          const id = pendingOperation.current;
          pendingOperation.current = null;
          if (id === null) return handled;
          openForm({ kind: 'edit', id });
          return false; // фокус сначала на кнопку открытия: она станет «откуда открыли» для формы
        }}
        footer={
          <Link
            to={`/c/${company.id}/settings/audit`}
            onClick={(e) => {
              if (!isPlainLeftClick(e)) return;
              navigated.current = true;
              focusHeadingSoon(`/c/${company.id}/settings/audit`);
              setOpen(false);
            }}
            className={`${btnPrimary} block text-center`}
          >
            Подробнее
          </Link>
        }
      >
        <HistoryList
          company={company}
          onOpenOperation={(id) => {
            pendingOperation.current = id;
            setOpen(false);
          }}
        />
      </Drawer>
    </>
  );
}

function HistoryList(props: { company: Company; onOpenOperation: (id: number) => void }) {
  const feed = useOperationHistory(props.company.id);
  const accounts = useAccounts(props.company.id);
  const meta = useMeta();
  // прошлые строки при повторном открытии не показываем: «Загрузка…», пока не пришёл свежий ответ
  if (!feed.data || !feed.isFetchedAfterMount || !accounts.data || !meta.data) return <Pending queries={[feed, accounts, meta]} />;
  const items = historyItems(feed.data, { accounts: new Map(accounts.data.map((a) => [a.id, a])), timeZone: meta.data.timezone });

  return (
    <div>
      <div>
        {items.length === 0 ? (
          <p className="text-sm text-muted">Действий с операциями пока нет.</p>
        ) : (
          <ul aria-label="Последние действия" className="divide-y divide-field">
            {items.map((it) => {
              const body = (
                <>
                  <span className="block font-semibold">{it.title}</span>
                  {(it.amount || it.account) && (
                    <span className="block text-sm">
                      {it.amount && <span className={`tabular-nums ${it.type ? AMOUNT_CLASS[it.type] : ''}`}>{it.amount}</span>}
                      {it.amount && it.account && ' · '}
                      {it.account}
                    </span>
                  )}
                  {it.changes && <span className="block text-sm text-muted">{it.changes}</span>}
                  <span className="block text-xs text-muted">{it.meta}</span>
                </>
              );
              return (
                <li key={it.id} className="py-2">
                  {it.openable && it.operationId !== null ? (
                    <button
                      type="button"
                      onClick={() => props.onOpenOperation(it.operationId!)}
                      className="w-full rounded-xl px-2 py-1 text-left hover:bg-field"
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="px-2 py-1">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
