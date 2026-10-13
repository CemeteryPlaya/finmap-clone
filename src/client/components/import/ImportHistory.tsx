import { useEffect, useRef, useState } from 'react';
import type { ImportListItem } from '../../../shared/schemas/imports';
import { ApiError } from '../../lib/api';
import {
  importAddedText,
  importMetaText,
  importUndoneText,
  replaceImportItem,
  undoButtonLabel,
  undoCheckboxLabel,
  undoConfirmText,
  undoImport,
  undoResultText,
} from '../../lib/import-history';
import { invalidateAfterImport } from '../../lib/import-panel';
import { queryClient, useMeta } from '../../lib/query';
import { useImports, type Company } from '../../lib/queries';
import { ConfirmDialog } from '../ConfirmDialog';
import { Pending } from '../QueryState';
import { alertClass, btnSecondary, btnSmall } from '../ui';

type ImportPages = Parameters<typeof replaceImportItem>[0];

/** Кнопка «Отменить» записи есть в загруженном списке: запись не отменена. */
const undoable = (data: ImportPages, id: number) => data?.pages.some((p) => p.items.some((x) => x.id === id && x.status === 'done')) ?? false;

/**
 * Вкладка «Импорты» панели «История действий» (§7.2–§7.3 спецификации импорта): импорты компании, новые сверху,
 * «Показать ещё»; у неотменённого (компания не в архиве) — «Отменить» с подтверждением «Не отменять | Отменить импорт».
 * Итог отмены — в живой области; кнопка «Отменить» исчезает вместе с подтверждением — фокус на вкладку (onFocusLost).
 */
export function ImportHistory({ company, onFocusLost }: { company: Company; onFocusLost: () => void }) {
  const feed = useImports(company.id);
  const meta = useMeta();
  const [confirm, setConfirm] = useState<ImportListItem | null>(null);
  const [includeEdited, setIncludeEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  /** Номер первой записи новой страницы, пока «Показать ещё» держит фокус (R2): если кнопка исчезла, фокус — на неё, а не в никуда. */
  const focusFrom = useRef<number | null>(null);
  /**
   * Импорт, у которого после закрытия подтверждения пропадёт «Отменить» (отменён здесь или в другом окне, R6): как только
   * подтверждение закрыто и запись в списке уже «Отменён», фокус явно уходит на вкладку — не полагаясь на то, что окно
   * закроется после исчезновения кнопки (список обновляется отдельным уведомлением запроса).
   */
  const focusTabAfter = useRef<number | null>(null);
  const hasNext = feed.hasNextPage;
  const fetching = feed.isFetchingNextPage;
  const data = feed.data;

  useEffect(() => {
    if (fetching || focusFrom.current === null) return;
    const from = focusFrom.current;
    focusFrom.current = null;
    if (hasNext) return; // кнопка осталась — фокус на ней
    const list = listRef.current;
    const target = (list?.children[from] as HTMLElement | undefined) ?? list;
    target?.focus({ preventScroll: true });
  }, [fetching, hasNext]);

  useEffect(() => {
    const id = focusTabAfter.current;
    if (id === null || confirm !== null || undoable(data, id)) return;
    focusTabAfter.current = null;
    onFocusLost();
  }, [confirm, data, onFocusLost]);

  const ask = (item: ImportListItem) => {
    setIncludeEdited(false);
    setError(null);
    focusTabAfter.current = null;
    setConfirm(item);
  };

  const run = async () => {
    if (!confirm || busy) return;
    setBusy(true);
    setError(null);
    setResult('');
    try {
      const r = await undoImport(company.id, confirm.id, { includeEdited, edited: confirm.pending?.edited ?? 0 });
      // запись — «Отменён» до перечитывания: кнопка «Отменить» исчезает вместе с подтверждением
      queryClient.setQueryData(['imports', company.id], (d: ImportPages) => replaceImportItem(d, r.import));
      focusTabAfter.current = r.import.id;
      setResult(undoResultText(r.result));
      setConfirm(null);
      void invalidateAfterImport(company.id);
    } catch (e) {
      // уже отменён (409), изменены ещё операции (409), счёт в архиве (422): свежий список — до закрытия подтверждения;
      // «Отменить» осталась — фокус вернётся на неё, исчезла — на вкладку
      setError(e instanceof ApiError ? e.message : 'Ошибка сервера');
      await queryClient.invalidateQueries({ queryKey: ['imports', company.id] });
      if (!undoable(queryClient.getQueryData<ImportPages>(['imports', company.id]), confirm.id)) focusTabAfter.current = confirm.id;
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  // прошлый список при повторном открытии не показываем: «Загрузка…», пока не пришёл свежий ответ
  if (!feed.data || !feed.isFetchedAfterMount || !meta.data) return <Pending queries={[feed, meta]} />;
  const timeZone = meta.data.timezone;
  const items = feed.data.pages.flatMap((p) => p.items);
  const canUndo = company.archivedAt === null;
  const edited = confirm?.pending?.edited ?? 0;

  return (
    <div>
      <p role="status" className="sr-only">
        {result}
      </p>
      {/* видимая копия итога: читалка его уже услышала из живой области выше */}
      {result && (
        <p aria-hidden="true" className="mb-3 rounded-xl bg-field px-4 py-3 text-sm">
          {result}
        </p>
      )}
      {error && (
        <p role="alert" className={alertClass}>
          {error}
        </p>
      )}
      {items.length === 0 ? (
        <p className="text-sm text-muted">Импортов пока не было.</p>
      ) : (
        <ul ref={listRef} tabIndex={-1} aria-label="Импорты" className="divide-y divide-field focus-visible:outline-2 focus-visible:outline-focus">
          {items.map((it) => {
            const undone = importUndoneText(it, timeZone);
            return (
              <li key={it.id} tabIndex={-1} className="flex items-start gap-2 py-2 focus-visible:outline-2 focus-visible:outline-focus">
                <div className="min-w-0 flex-1 px-2 py-1">
                  <span title={it.fileName} className="block truncate font-semibold">
                    {it.fileName}
                  </span>
                  <span className="block text-sm">{importAddedText(it)}</span>
                  {undone && <span className="block text-sm">{undone}</span>}
                  <span className="block text-xs text-muted">{importMetaText(it, timeZone)}</span>
                </div>
                {canUndo && it.status === 'done' && (
                  <button type="button" aria-label={undoButtonLabel(it, timeZone)} onClick={() => ask(it)} className={`${btnSmall} mt-1 shrink-0 max-md:min-h-11`}>
                    Отменить
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {feed.hasNextPage && (
        <button
          type="button"
          onClick={() => {
            if (feed.isFetchingNextPage) return;
            focusFrom.current = items.length;
            void feed.fetchNextPage();
          }}
          aria-disabled={feed.isFetchingNextPage}
          className={`${btnSecondary} mt-3 w-full ${feed.isFetchingNextPage ? 'cursor-wait opacity-60' : ''}`}
        >
          {feed.isFetchingNextPage ? 'Загрузка…' : 'Показать ещё'}
        </button>
      )}
      <ConfirmDialog
        open={confirm !== null}
        title="Отменить импорт?"
        text={confirm ? undoConfirmText(confirm, includeEdited) : ''}
        cancelLabel="Не отменять"
        confirmLabel="Отменить импорт"
        danger
        pending={busy}
        checkbox={edited > 0 ? { label: undoCheckboxLabel(edited), checked: includeEdited, onChange: setIncludeEdited } : undefined}
        onConfirm={() => void run()}
        onCancel={() => setConfirm(null)}
        onFocusLost={onFocusLost}
      />
    </div>
  );
}
