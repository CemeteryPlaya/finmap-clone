import { useEffect, useRef, useState } from 'react';
import { BULK_MAX, selectionTotals, type BulkAction } from '../../lib/journal-bulk';
import type { JournalItem } from '../../lib/queries';
import { PencilIcon, TrashIcon } from '../icons';

const barButton =
  'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-60 aria-disabled:opacity-60';

/**
 * Полоса массовых действий (§5.5 этапа 1.5): пока есть выделение, лежит на месте строки заголовков таблицы,
 * акцентным цветом, в одну строку той же высоты (не переносится и не наезжает на первую строку таблицы).
 * Слева — общий чекбокс со знаком минус (снимает выделение), «Изменить данные» (окно открывает страница)
 * и «Удалить» с подтверждением в полосе; справа — итог выделения по типам в базовой валюте, длинный обрезается
 * (полный — в title). Пока на экране подтверждение, «Изменить данные» и итог скрыты; итог для программ чтения
 * объявляет постоянная живая область страницы. Не больше BULK_MAX операций за раз. Пока действие выполняется,
 * «Изменить данные» только помечена недоступной (aria-disabled): фокус, вернувшийся на неё после окна, не теряется.
 */
export function BulkBar(props: {
  /** Выбранные загруженные операции — для итога. */
  items: readonly Pick<JournalItem, 'type' | 'baseAmount'>[];
  baseCurrency: string;
  pending: boolean;
  onRun: (action: BulkAction) => Promise<void> | void;
  /** «Изменить данные»: окно открывает страница. */
  onEdit: () => void;
  onClear: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const deleteRef = useRef<HTMLButtonElement>(null);
  // «Отмена» убирает сфокусированную кнопку: фокус возвращается на «Удалить», как только она снова на месте
  const refocusDelete = useRef(false);
  // и после «Отмены», и после неудачного удаления: фокус на «Удалить», когда она снова на месте и доступна
  useEffect(() => {
    if (!confirm && !props.pending && refocusDelete.current) {
      refocusDelete.current = false;
      deleteRef.current?.focus();
    }
  }, [confirm, props.pending]);
  const count = props.items.length;
  const tooMany = count > BULK_MAX;
  const disabled = props.pending || tooMany;
  const totals = selectionTotals(props.items, props.baseCurrency);
  const question = `Удалить выбранные операции (${count})? Отменить можно будет 10 секунд.`;

  return (
    <div role="region" aria-label="Действия с выбранными" className="flex h-12 flex-nowrap items-center gap-2 overflow-hidden bg-income-strong px-3 text-white">
      <button
        type="button"
        role="checkbox"
        aria-checked="mixed"
        aria-label="Снять выделение"
        title="Снять выделение"
        onClick={props.onClear}
        className="grid size-[18px] shrink-0 place-items-center rounded bg-white text-sm leading-none font-bold text-income-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        <span aria-hidden="true">{'−'}</span>
      </button>
      {tooMany ? (
        <span className="min-w-0 truncate text-sm" title={`Не больше ${BULK_MAX} операций за раз — снимите часть выделения`}>
          Не больше {BULK_MAX} операций за раз — снимите часть выделения
        </span>
      ) : (
        !confirm && (
          <>
            <button
              type="button"
              aria-haspopup="dialog"
              aria-disabled={props.pending || undefined}
              onClick={() => {
                if (!props.pending) props.onEdit();
              }}
              className={barButton}
            >
              <PencilIcon />
              Изменить данные
            </button>
            <button ref={deleteRef} type="button" disabled={disabled} onClick={() => setConfirm(true)} className={barButton}>
              <TrashIcon />
              Удалить
            </button>
          </>
        )
      )}
      {confirm && !tooMany && (
        <span role="group" aria-label="Подтверждение удаления" className="flex min-w-0 items-center gap-2 text-sm">
          <span className="min-w-0 truncate" title={question}>
            {question}
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              // ошибка: полоса остаётся — эффект выше вернёт фокус на «Удалить»; при успехе полосы уже нет (ссылка пуста)
              refocusDelete.current = true;
              setConfirm(false);
              void props.onRun({ action: 'delete' });
            }}
            className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-expense hover:brightness-95 disabled:opacity-60"
          >
            Да, удалить
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => {
              refocusDelete.current = true;
              setConfirm(false);
            }}
            className={barButton}
          >
            Отмена
          </button>
        </span>
      )}
      {!confirm && (
        <p title={totals} className="ml-auto min-w-0 truncate text-sm font-semibold">
          {totals}
        </p>
      )}
    </div>
  );
}
