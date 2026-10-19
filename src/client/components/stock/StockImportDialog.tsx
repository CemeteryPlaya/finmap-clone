import { useId, useRef, useState } from 'react';
import type { StockImportKind, StockImportResult } from '../../../shared/schemas/stock';
import { api, ApiError } from '../../lib/api';
import { invalidateStock } from '../../lib/stock';
import { importFileError, importSummary } from '../../lib/stock-import';
import { Modal } from '../Modal';
import { alertClass, btnPrimary, btnSecondary, noticeClass, phoneFullScreenModal } from '../ui';

const COLUMNS: Record<StockImportKind, string> = {
  items: '«Название» (обязательно), «Группа», «Единица» (шт, л, кг, уп), «Штрихкод», «Цена продажи»',
  receipts: '«Дата», «Товар», «Количество» и «Сумма» или «Цена» (обязательно), «Поставщик» (по желанию)',
};

/**
 * Импорт склада из Excel или CSV (§9.1 спецификации «Склад»): выбор файла → проверка (числа, «Будет создано», ошибки со
 * строками) → «Загрузить». Проверка ничего не пишет; при ошибках загрузить нельзя. Поступления идут на склад из адреса.
 */
export function StockImportDialog(props: { companyId: number; kind: StockImportKind; warehouse: number | null; warehouseName: string | null; currency: string; onClose: () => void }) {
  const [open, setOpen] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<StockImportResult | null>(null);
  const [done, setDone] = useState<StockImportResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const reasonId = useId();
  const title = props.kind === 'items' ? 'Импорт товаров из Excel' : 'Импорт поступлений';
  const query = (commit: boolean) => `commit=${commit ? 1 : 0}${props.kind === 'receipts' && props.warehouse !== null ? `&warehouse=${props.warehouse}` : ''}`;

  const send = async (commit: boolean) => {
    if (!file || pending) return;
    setPending(true);
    setError(null);
    try {
      const r = await api<StockImportResult>(`/companies/${props.companyId}/stock/import/${props.kind}?${query(commit)}`, { method: 'POST', file: { data: file, name: file.name } });
      if (commit) {
        setDone(r);
        await invalidateStock(props.companyId);
      } else setCheck(r);
    } catch (e) {
      // запись с ошибками: сервер возвращает свежую проверку
      if (e instanceof ApiError && e.code === 'IMPORT_INVALID' && e.details) setCheck(e.details as unknown as StockImportResult);
      setError(e instanceof ApiError ? importFileError(e) : 'Ошибка сервера');
    } finally {
      setPending(false);
    }
  };

  const canLoad = check !== null && check.errorsTotal === 0 && !pending;

  return (
    <Modal open={open} title={title} onClose={props.onClose} onCancel={() => !pending && setOpen(false)} className={`max-w-2xl ${phoneFullScreenModal}`} phoneFullScreen>
      {done ? (
        <div className="grid gap-4">
          <p role="status" className={`${noticeClass} mb-0`}>
            Загружено.{' '}
            {props.kind === 'items' ? `Товаров создано: ${done.create.items}, групп: ${done.create.groups}.` : `Документов: ${done.docs}, строк: ${done.lines}.`}
          </p>
          <button type="button" onClick={() => setOpen(false)} className={`${btnPrimary} justify-self-start`}>
            Готово
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {props.kind === 'receipts' && (
            <p className="text-sm">
              Склад: <strong>{props.warehouseName ?? 'не выбран'}</strong>
            </p>
          )}
          <p className="text-sm text-muted">
            Первая строка — заголовки: {COLUMNS[props.kind]}. Файл .xlsx или .csv, до 5 МБ и 5 000 строк.
            {props.kind === 'receipts' && ' Строки с одной датой и поставщиком станут одним поступлением; новые товары и поставщики создадутся.'}
            {props.kind === 'items' && ' Товары, которые уже есть в каталоге, пропускаются.'}
          </p>
          <label className="grid gap-1 text-sm font-medium">
            Файл
            <input
              ref={input}
              type="file"
              accept=".xlsx,.csv"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setCheck(null);
                setError(null);
              }}
              className="text-sm"
            />
          </label>
          {check && (
            <section aria-label="Проверка файла" className="grid gap-2 rounded-xl bg-field px-4 py-3 text-sm">
              <ul className="grid gap-1">
                {importSummary(check, props.kind, props.currency).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {check.errorsTotal > 0 && (
                <>
                  <p className="font-semibold text-expense-strong">Ошибок: {check.errorsTotal} — исправьте файл и проверьте снова</p>
                  <ul aria-label="Ошибки файла" className="grid gap-1">
                    {check.errors.map((e, i) => (
                      <li key={`${i}:${e.row}:${e.field}`}>
                        {e.row > 0 ? `Строка ${e.row}, «${e.field}»: ` : ''}
                        {e.message}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}
          {error && (
            <p role="alert" className={`${alertClass} mb-0`}>
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              aria-disabled={!file || pending || undefined}
              title={!file ? 'Сначала выберите файл' : undefined}
              onClick={() => {
                if (file && !pending) void send(false);
              }}
              className={`${btnSecondary} aria-disabled:opacity-50`}
            >
              Проверить
            </button>
            <button
              type="button"
              aria-disabled={!canLoad || undefined}
              aria-describedby={canLoad || pending ? undefined : reasonId}
              onClick={() => {
                if (canLoad) void send(true);
              }}
              className={`${btnPrimary} aria-disabled:opacity-50`}
            >
              Загрузить
            </button>
          </div>
          {!canLoad && !pending && (
            <p id={reasonId} className="text-sm text-muted">
              {check && check.errorsTotal > 0 ? 'Сначала исправьте ошибки файла' : 'Сначала проверьте файл'}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
