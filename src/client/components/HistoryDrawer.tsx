import { useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { focusHeadingSoon, isPlainLeftClick } from '../lib/focus-heading';
import { historyItems, type HistoryItem } from '../lib/history';
import { HISTORY_TABS, tabAfterKey, type HistoryTab } from '../lib/import-history';
import { useMeta } from '../lib/query';
import { useAccounts, useOperationHistory, type Company } from '../lib/queries';
import { Drawer } from './Drawer';
import { HistoryIcon } from './icons';
import { ImportHistory } from './import/ImportHistory';
import { useOpenOperationForm } from './operation/OperationFormHost';
import { Pending } from './QueryState';
import { btnPrimary, headerIconClass } from './ui';

const AMOUNT_CLASS: Record<NonNullable<HistoryItem['type']>, string> = { income: 'text-income', expense: 'text-expense-strong', transfer: 'text-transfer' };

/**
 * Правая панель «История действий» (§3.4 этапа 1.5) — вкладки «Журнал» (последние действия с операциями) и «Импорты»
 * (§7 спецификации импорта). Открывается значком в шапке (компьютер) и пунктом «История действий» в «Ещё» нижней панели
 * (телефон, §8.3). Закрытие — фокус на то, чем открыли. Содержимое монтируется заново при каждом открытии — вкладка
 * снова «Журнал».
 */
export function HistoryPanel({ company, open, onClose }: { company: Company; open: boolean; onClose: () => void }) {
  const navigated = useRef(false);
  /** Операция из списка: форма открывается, когда панель уже закрыта, — по закрытии формы фокус вернётся на кнопку открытия. */
  const pendingOperation = useRef<number | null>(null);
  const openForm = useOpenOperationForm();
  return (
    <Drawer
      open={open}
      side="right"
      title="История действий"
      onClose={onClose}
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
            onClose();
          }}
          className={`${btnPrimary} block text-center`}
        >
          Подробнее
        </Link>
      }
    >
      <HistoryTabs
        company={company}
        onOpenOperation={(id) => {
          pendingOperation.current = id;
          onClose();
        }}
      />
    </Drawer>
  );
}

/** Значок «История действий» в шапке компьютера (§3.1); на телефоне история — в «Ещё» нижней панели (§8.3). */
export function HistoryButton({ company }: { company: Company }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label="История действий"
        title="История действий"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={`${headerIconClass} max-md:hidden`}
      >
        <HistoryIcon />
      </button>
      <HistoryPanel company={company} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/**
 * Вкладки-пилюли «Журнал | Импорты» (§7.1 спецификации импорта): tablist, стрелки ←/→ (и Home, End) переключают вкладку
 * и переводят на неё фокус — в порядке Tab только выбранная вкладка (roving tabindex). Обе панели в DOM, неактивная
 * `hidden` — aria-controls всегда указывает на существующий элемент; «Импорты» наполняются только при открытии вкладки.
 */
function HistoryTabs(props: { company: Company; onOpenOperation: (id: number) => void }) {
  const [tab, setTab] = useState<HistoryTab>('log');
  const refs = useRef(new Map<HistoryTab, HTMLButtonElement>());
  const id = useId();
  const tabId = (t: HistoryTab) => `${id}-tab-${t}`;
  const panelId = (t: HistoryTab) => `${id}-panel-${t}`;
  return (
    <div>
      <div role="tablist" aria-label="Разделы истории" className="mb-3 grid grid-cols-2 gap-1">
        {HISTORY_TABS.map((t) => (
          <button
            key={t.key}
            ref={(el) => {
              if (el) refs.current.set(t.key, el);
              else refs.current.delete(t.key);
            }}
            type="button"
            role="tab"
            id={tabId(t.key)}
            aria-selected={tab === t.key}
            aria-controls={panelId(t.key)}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => setTab(t.key)}
            onKeyDown={(e) => {
              const next = tabAfterKey(tab, e.key);
              if (!next) return;
              e.preventDefault();
              setTab(next);
              refs.current.get(next)?.focus();
            }}
            className={`rounded-xl px-3 py-2 text-sm max-md:min-h-11 ${tab === t.key ? 'bg-field font-semibold text-ink' : 'text-muted hover:bg-field/60'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {HISTORY_TABS.map((t) => (
        <div key={t.key} role="tabpanel" id={panelId(t.key)} aria-labelledby={tabId(t.key)} tabIndex={0} hidden={tab !== t.key}>
          {t.key === 'log' ? <HistoryList company={props.company} onOpenOperation={props.onOpenOperation} /> : tab === 'imports' && <ImportHistory company={props.company} />}
        </div>
      ))}
    </div>
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
