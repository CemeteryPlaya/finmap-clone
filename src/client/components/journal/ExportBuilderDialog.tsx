import { useId, useRef, useState } from 'react';
import { EXPORT_COLUMNS, EXPORT_GROUPS, exportColumnLabel, type ExportColumnId } from '../../../shared/export-columns';
import { EXPORT_COLUMNS_PREF, savedExportColumns, toggleExportColumn } from '../../lib/export-columns';
import { journalApiParams, journalExportHref, type JournalUrlState } from '../../lib/journal-filter';
import { useExportPreview, usePreferences, savePreference } from '../../lib/queries';
import { Modal } from '../Modal';
import { btnPrimary, btnSecondary } from '../ui';

/** Чип «Что выгрузить»: включённый — с галочкой и цветом дохода, выключенный — серый. */
const chipClass = (on: boolean) =>
  `rounded-full px-3 py-1.5 text-sm font-medium hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus ${on ? 'bg-income-soft text-ink' : 'bg-field text-muted'}`;

/**
 * Превью: колонки в выбранном порядке и первые операции фильтра. Тексты ячеек присылает сервер — они совпадают с
 * файлом (период начисления, знак суммы, «; » у разбитой операции, остатки).
 */
function Preview(props: { columns: readonly ExportColumnId[]; params: string; companyId: number }) {
  const preview = useExportPreview(props.companyId, props.params);
  const rows = preview.data?.rows ?? [];
  return (
    <div>
      <div className="overflow-x-auto rounded-xl bg-field">
        <table aria-label="Превью файла" className="w-full border-collapse text-left text-sm">
          <thead>
            <tr>
              {props.columns.map((id) => (
                <th key={id} scope="col" className="min-w-36 whitespace-nowrap px-3 py-2 font-semibold">
                  <span data-column-label="">{exportColumnLabel(id)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-card">
                {props.columns.map((id) => (
                  <td key={id} className="max-w-64 truncate px-3 py-1.5" title={row[id]}>
                    {row[id]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {preview.error ? (
        <p role="alert" className="mt-2 text-sm text-expense-strong">
          Не удалось загрузить превью: {preview.error.message}
        </p>
      ) : preview.data === undefined ? (
        <p role="status" className="mt-2 text-sm text-muted">
          Загрузка…
        </p>
      ) : rows.length === 0 ? (
        <p role="status" className="mt-2 text-sm text-muted">
          По фильтру журнала операций нет — в файле будут только заголовки.
        </p>
      ) : null}
      <p className="mt-2 text-xs text-muted">В файле — все операции по фильтру журнала и строка «Итого».</p>
      <p className="mt-1 text-xs text-muted">Переводы входят в «Итого» без знака.</p>
    </div>
  );
}

function BuilderBody(props: { companyId: number; state: JournalUrlState; today: string; onClose: () => void }) {
  const prefs = usePreferences();
  // набор из настройки пользователя; окно монтируется заново при каждом открытии, поэтому читается один раз
  // настройки загружаются при старте приложения, поэтому окно не пересинхронизирует набор позже
  const [columns, setColumns] = useState<ExportColumnId[]>(() => savedExportColumns(prefs.data?.[EXPORT_COLUMNS_PREF]));
  const params = journalApiParams(props.state, props.today).toString();
  const empty = columns.length === 0;
  const hintId = useId();
  const downloaded = useRef(false);

  return (
    <div>
      <p className="mb-3 text-sm text-muted">Выберите колонки, чтобы собрать свой файл. В превью — первые операции журнала.</p>
      <Preview columns={columns} params={params} companyId={props.companyId} />

      <h3 className="mt-6 mb-2 text-xs font-semibold tracking-wide text-label uppercase">Что выгрузить</h3>
      <div className="flex flex-col gap-3">
        {EXPORT_GROUPS.map((group) => (
          <div key={group.id} role="group" aria-label={group.label} className="flex flex-wrap items-center gap-2">
            <span aria-hidden="true" className="w-full text-xs font-semibold tracking-wide text-label uppercase md:w-44">
              {group.label}
            </span>
            {EXPORT_COLUMNS.filter((c) => c.group === group.id).map((c) => (
              <button key={c.id} type="button" aria-pressed={columns.includes(c.id)} onClick={() => setColumns((cols) => toggleExportColumn(cols, c.id))} className={chipClass(columns.includes(c.id))}>
                <span aria-hidden="true">{columns.includes(c.id) ? '✓ ' : ''}</span>
                {c.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-field pt-4">
        {empty && (
          <p id={hintId} className="mr-auto text-sm text-muted">
            Выберите хотя бы одну колонку.
          </p>
        )}
        <button type="button" onClick={props.onClose} className={btnSecondary}>
          Отмена
        </button>
        {/* ссылка-скачивание: без побочных эффектов на сервере; набор запоминается при нажатии (§8.3) */}
        <a
          href={journalExportHref(props.companyId, props.state, props.today, 'custom', columns)}
          download
          aria-disabled={empty || undefined}
          aria-describedby={empty ? hintId : undefined}
          onClick={(e) => {
            // aria-disabled не гасит нажатие
            if (empty || downloaded.current) {
              e.preventDefault();
              return;
            }
            downloaded.current = true;
            // запомнить набор — удобство, а не условие скачивания: сбой записи файл не отменяет
            void savePreference(EXPORT_COLUMNS_PREF, columns).catch(() => undefined);
            // закрыть после того, как браузер начал скачивание: ссылка до этого должна остаться в странице
            setTimeout(props.onClose, 0);
          }}
          className={`${btnPrimary} inline-block aria-disabled:cursor-not-allowed aria-disabled:opacity-50`}
        >
          Собрать файл
        </a>
      </div>
    </div>
  );
}

/**
 * «Собрать Excel» (§8.3 спецификации импорта): превью файла, чипы «Что выгрузить» по группам, «Отмена» и «Собрать файл».
 * Только компьютер. Набор колонок и порядок запоминаются в настройке `export.columns` при «Собрать файл».
 */
export function ExportBuilderDialog(props: { open: boolean; onClose: () => void; companyId: number; state: JournalUrlState; today: string }) {
  return (
    <Modal open={props.open} title="Собрать Excel" onClose={props.onClose} className="max-w-[1280px]">
      <BuilderBody companyId={props.companyId} state={props.state} today={props.today} onClose={props.onClose} />
    </Modal>
  );
}
