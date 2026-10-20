import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { UndoPreviewEntry } from '../../shared/schemas/audit';
import { ApiError } from '../lib/api';
import { focusHeadingSoon, isPlainLeftClick } from '../lib/focus-heading';
import { historyItems, type HistoryItem } from '../lib/history';
import { HISTORY_TABS, tabAfterKey, type HistoryTab } from '../lib/import-history';
import { invalidateOperations } from '../lib/journal-mutations';
import { fetchUndoPreview, runUndo, undoConfirmText, undoDoneText, undoEntryLine } from '../lib/operation-undo';
import { queryClient, useMeta } from '../lib/query';
import { useAccounts, useOperationHistory, type AuditEntry, type Company } from '../lib/queries';
import { ConfirmDialog } from './ConfirmDialog';
import { Drawer } from './Drawer';
import { HistoryIcon } from './icons';
import { ImportHistory } from './import/ImportHistory';
import { useOpenOperationForm } from './operation/OperationFormHost';
import { Pending } from './QueryState';
import { alertClass, btnPrimary, btnSmall, headerIconClass } from './ui';

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
 * `hidden` — aria-controls всегда указывает на существующий элемент. «Импорты» наполняются при первом открытии вкладки
 * и дальше остаются смонтированными до закрытия панели: итог отмены переживает переход на «Журнал» и обратно.
 */
function HistoryTabs(props: { company: Company; onOpenOperation: (id: number) => void }) {
  const [tab, setTabState] = useState<HistoryTab>('log');
  /** Вкладку «Импорты» уже открывали в этой панели. */
  const [importsSeen, setImportsSeen] = useState(false);
  const setTab = (t: HistoryTab) => {
    setTabState(t);
    if (t === 'imports') setImportsSeen(true);
  };
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
          {t.key === 'log' ? (
            <HistoryList company={props.company} onOpenOperation={props.onOpenOperation} onFocusLost={() => refs.current.get('log')?.focus()} />
          ) : (
            importsSeen && <ImportHistory company={props.company} onFocusLost={() => refs.current.get('imports')?.focus()} />
          )}
        </div>
      ))}
    </div>
  );
}

/** Запись ленты ещё отменяема (кнопка «Отмена» есть). */
const stillUndoable = (list: readonly AuditEntry[] | undefined, id: number) => !!list?.find((e) => e.id === id)?.undoable;

/**
 * Список «Журнал» панели. У записи об операции справа — «Отмена» (спецификация 2026-10-19, часть 2): окно «Отменить
 * действия?» со списком каскада, затем отмена; у отменённой — пометка «Отменено». Как у «Импортов»: запись становится
 * «Отменено» до перечитывания — кнопка исчезает вместе с окном, фокус уходит на вкладку; итог или ошибка (в том числе 409
 * «обновите историю») объявляются, когда окно уже закрыто.
 */
function HistoryList(props: { company: Company; onOpenOperation: (id: number) => void; onFocusLost: () => void }) {
  const companyId = props.company.id;
  const { onFocusLost } = props;
  const feed = useOperationHistory(companyId);
  const accounts = useAccounts(companyId);
  const meta = useMeta();
  const [confirm, setConfirm] = useState<{ entryId: number; entries: UndoPreviewEntry[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** Запись, у которой после закрытия окна пропадёт «Отмена»: фокус — на вкладку, а не в никуда. */
  const focusTabAfter = useRef<number | null>(null);
  /** Итог или ошибка, которые покажутся, когда окно закроется (пока оно открыто, страница под ним инертна). */
  const announce = useRef<{ status: string } | { error: string } | null>(null);
  const historyKey = ['audit', companyId, 'operations-recent'];
  const message = (e: unknown) => (e instanceof ApiError ? e.message : 'Ошибка сервера');
  const data = feed.data;

  useEffect(() => {
    const id = focusTabAfter.current;
    if (id === null || confirm !== null || stillUndoable(data, id)) return;
    focusTabAfter.current = null;
    onFocusLost();
  }, [confirm, data, onFocusLost]);

  useEffect(() => {
    const a = announce.current;
    if (confirm !== null || a === null) return;
    announce.current = null;
    if ('status' in a) setStatus(a.status);
    else setError(a.error);
  }, [confirm]);

  const ask = async (entryId: number) => {
    if (busy) return;
    setError(null);
    setStatus('');
    focusTabAfter.current = null;
    setBusy(true);
    try {
      setConfirm({ entryId, entries: (await fetchUndoPreview(companyId, entryId)).entries });
    } catch (e) {
      // уже отменено в другом окне, операции нет, сначала нужно отменить удаление: свежая лента; кнопка исчезла — фокус на вкладку
      setError(message(e));
      await queryClient.invalidateQueries({ queryKey: ['audit', companyId] });
      if (!stillUndoable(queryClient.getQueryData<AuditEntry[]>(historyKey), entryId)) onFocusLost();
    } finally {
      setBusy(false);
    }
  };
  const run = async () => {
    if (!confirm || busy) return;
    setBusy(true);
    try {
      const r = await runUndo(companyId, confirm.entryId, confirm.entries.map((e) => e.id));
      // записи — «Отменено» до перечитывания: кнопка «Отмена» исчезает вместе с окном
      queryClient.setQueryData<AuditEntry[]>(historyKey, (list) => list?.map((e) => (r.undone.includes(e.id) ? { ...e, undoneBy: r.undoId, undoable: false } : e)));
      focusTabAfter.current = confirm.entryId;
      announce.current = { status: undoDoneText(r.undone.length) };
      setConfirm(null);
      void Promise.all([invalidateOperations(companyId), queryClient.invalidateQueries({ queryKey: ['audit', companyId] })]);
    } catch (e) {
      // каскад изменился (409), справочник в архиве (422): свежая лента — до закрытия окна; кнопка осталась — фокус на ней
      announce.current = { error: message(e) };
      await queryClient.invalidateQueries({ queryKey: ['audit', companyId] });
      if (!stillUndoable(queryClient.getQueryData<AuditEntry[]>(historyKey), confirm.entryId)) focusTabAfter.current = confirm.entryId;
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  // прошлые строки при повторном открытии не показываем: «Загрузка…», пока не пришёл свежий ответ
  if (!feed.data || !feed.isFetchedAfterMount || !accounts.data || !meta.data) return <Pending queries={[feed, accounts, meta]} />;
  const timeZone = meta.data.timezone;
  const items = historyItems(feed.data, { accounts: new Map(accounts.data.map((a) => [a.id, a])), timeZone });
  const canUndo = !props.company.archivedAt;

  return (
    <div>
      <p role="status" aria-live="polite" className={status ? 'mb-2 text-sm text-income' : 'sr-only'}>
        {status}
      </p>
      {error && (
        <p role="alert" className={alertClass}>
          {error}
        </p>
      )}
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
                <li key={it.id} className="flex items-start gap-2 py-2">
                  <div className="min-w-0 flex-1">
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
                  </div>
                  {it.undone && <span className="shrink-0 px-2 py-1 text-xs text-muted">Отменено</span>}
                  {it.undoable && canUndo && (
                    <button
                      type="button"
                      aria-label={`Отмена: ${it.title}, ${it.meta}`}
                      aria-disabled={busy || undefined}
                      onClick={() => void ask(it.id)}
                      className={`${btnSmall} shrink-0 max-md:min-h-11 aria-disabled:opacity-50`}
                    >
                      Отмена
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={confirm !== null}
        title="Отменить действия?"
        text={confirm ? undoConfirmText(confirm.entries.length) : ''}
        details={confirm ? confirm.entries.map((e) => undoEntryLine(e, timeZone)) : undefined}
        cancelLabel="Закрыть"
        confirmLabel="Отменить действия"
        danger
        pending={busy}
        onConfirm={() => void run()}
        onCancel={() => setConfirm(null)}
        onFocusLost={props.onFocusLost}
      />
    </div>
  );
}
