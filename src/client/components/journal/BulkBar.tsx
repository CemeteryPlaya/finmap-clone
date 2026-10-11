import { useEffect, useRef, useState } from 'react';
import type { AssignData } from '../../lib/journal-assign';
import { BULK_MAX, type BulkAction } from '../../lib/journal-bulk';
import { categoryOptions } from '../../lib/operation-options';
import { SearchPicker } from '../SearchPicker';
import { btnDanger, btnSecondary, btnSmall } from '../ui';

/**
 * Массовые действия с выбранными строками (§7): «Категория», «Проект», «Контрагент» (только назначают значение),
 * «Удалить» с подтверждением. Не больше BULK_MAX операций за раз. Пока действие выполняется, списки только помечены
 * недоступными (aria-disabled): после выбора фокус возвращается на кнопку списка и там остаётся.
 */
export function BulkBar(props: { count: number; data: AssignData; pending: boolean; onRun: (action: BulkAction) => Promise<void> | void; onClear: () => void }) {
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
  const tooMany = props.count > BULK_MAX;
  const disabled = props.pending || tooMany;
  const pickerClass = btnSmall;
  const categoryChoices = [
    ...categoryOptions(props.data.categories, 'income', []).map((o) => ({ ...o, label: `Доход: ${o.label}` })),
    ...categoryOptions(props.data.categories, 'expense', []).map((o) => ({ ...o, label: `Расход: ${o.label}` })),
  ];

  return (
    <div role="region" aria-label="Действия с выбранными" className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl bg-field/60 px-3 py-2">
      <span className="text-sm font-semibold">Выбрано: {props.count}</span>
      {tooMany ? (
        <span className="text-sm text-expense">Не больше {BULK_MAX} операций за раз — снимите часть выделения</span>
      ) : (
        <>
          <SearchPicker
            label="Категория"
            listLabel="Категории"
            options={categoryChoices}
            onPick={(categoryId) => props.onRun({ action: 'setCategory', categoryId })}
            buttonClassName={pickerClass}
            inactive={props.pending}
          />
          <SearchPicker
            label="Проект"
            listLabel="Проекты"
            options={props.data.projects.filter((p) => !p.archivedAt).map((p) => ({ id: p.id, label: p.name }))}
            onPick={(projectId) => props.onRun({ action: 'setProject', projectId })}
            buttonClassName={pickerClass}
            inactive={props.pending}
          />
          <SearchPicker
            label="Контрагент"
            listLabel="Контрагенты"
            options={props.data.counterparties.filter((c) => !c.archivedAt).map((c) => ({ id: c.id, label: c.name }))}
            onPick={(counterpartyId) => props.onRun({ action: 'setCounterparty', counterpartyId })}
            buttonClassName={pickerClass}
            inactive={props.pending}
          />
          {!confirm && (
            <button ref={deleteRef} type="button" disabled={disabled} onClick={() => setConfirm(true)} className={`${btnSmall} text-expense`}>
              Удалить
            </button>
          )}
        </>
      )}
      {confirm && !tooMany && (
        <span role="group" aria-label="Подтверждение удаления" className="flex flex-wrap items-center gap-2 text-sm">
          <span>Удалить выбранные операции ({props.count})? Отменить можно будет 10 секунд.</span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              // ошибка: полоса остаётся — эффект выше вернёт фокус на «Удалить»; при успехе полосы уже нет (ссылка пуста)
              refocusDelete.current = true;
              setConfirm(false);
              void props.onRun({ action: 'delete' });
            }}
            className={`${btnDanger} px-3 py-1.5 text-sm`}
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
            className={`${btnSecondary} px-3 py-1.5 text-sm`}>
            Отмена
          </button>
        </span>
      )}
      <button type="button" onClick={props.onClear} className="ml-auto text-sm font-semibold underline">
        Снять выделение
      </button>
    </div>
  );
}
