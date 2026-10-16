import { useState } from 'react';
import { dimensionOptions, dimensionSelected, REPORT_DIMENSIONS, toggleDimension, type FilterDialogData } from '../../lib/journal-filter-dialog';
import {
  BY_CHOICES,
  customRangeError,
  DEFAULT_REPORT_STATE,
  effectiveStep,
  resetReportState,
  PERCENT_CHOICES,
  REPORT_PERIODS,
  reportDialogFields,
  reportRange,
  stepChoices,
  STOCK_CHOICES,
  withDialogFields,
  withFittingStep,
  type ReportUrlState,
} from '../../lib/report-url';
import { PeriodMenu } from '../journal/PeriodMenu';
import { Modal } from '../Modal';
import { MultiSelectField } from '../MultiSelectField';
import { btnPrimary, phoneFullScreenModal } from '../ui';
import { ChoiceMenu } from './ChoiceMenu';

/**
 * Поля окна: черновик — настройки отчёта (§2.4 спецификации «Аналитика»). На компьютере окно задаёт только фильтр
 * (категории, контрагенты, проекты, теги, счета); на телефоне (§2.2) первыми идут период, разрез, шаг и проценты —
 * остальные контролы переезжают сюда. «Готово» применяет черновик поверх текущих настроек, «Сбросить» возвращает черновик
 * к значениям по умолчанию (вид «график / таблица» остаётся), «×» и Esc закрывают без изменений. Поля фильтра — те же, что
 * у журнала, без типов операций. Проценты — только в виде «таблица» (§2.2); склад — у «Прибыли» компании со складом (§5.3).
 */
function ReportFilterForm(props: {
  state: ReportUrlState;
  data: FilterDialogData;
  phone: boolean;
  today: string;
  dateHeading: string;
  stock: boolean;
  onApply: (next: ReportUrlState) => void;
}) {
  const [draft, setDraft] = useState<ReportUrlState>(props.state);
  const fields = reportDialogFields(draft);
  const range = reportRange(draft, props.today);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        props.onApply(props.phone ? withFittingStep(draft, props.today) : withDialogFields(props.state, fields));
      }}
    >
      {props.phone && (
        <div className="mb-3 flex flex-col gap-3">
          <PeriodMenu
            wide
            state={draft}
            today={props.today}
            periods={REPORT_PERIODS}
            heading={props.dateHeading}
            validate={customRangeError}
            onChange={(next) => setDraft(withFittingStep(next, props.today))}
          />
          <ChoiceMenu wide name="Разрез" value={draft.by} options={BY_CHOICES} onChange={(by) => setDraft((d) => ({ ...d, by }))} />
          <ChoiceMenu wide name="Шаг" value={effectiveStep(draft.step, range)} options={stepChoices(range)} onChange={(step) => setDraft((d) => ({ ...d, step }))} />
          {draft.view === 'table' && (
            <ChoiceMenu wide name="Проценты" value={draft.percent ? 'on' : 'off'} options={PERCENT_CHOICES} onChange={(v) => setDraft((d) => ({ ...d, percent: v === 'on' }))} />
          )}
          {props.stock && (
            <ChoiceMenu wide name="Склад" value={draft.stock ? 'on' : 'off'} options={STOCK_CHOICES} onChange={(v) => setDraft((d) => ({ ...d, stock: v === 'on' }))} />
          )}
        </div>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2">
        {REPORT_DIMENSIONS.map((d) => (
          <div key={d.dim} className={`min-w-0 ${d.dim === 'typesCategories' ? 'md:col-span-2' : ''}`}>
            <MultiSelectField
              label={d.label}
              allLabel={d.allLabel}
              options={dimensionOptions(d.dim, props.data, fields, { types: false })}
              selected={dimensionSelected(d.dim, fields)}
              onToggle={(key) => setDraft((current) => withDialogFields(current, toggleDimension(d.dim, reportDialogFields(current), key)))}
            />
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        Родительская категория включает подкатегории. При фильтре по категориям, контрагентам, проектам или тегам остатки не считаются — фильтр по счетам их
        сохраняет.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3 max-md:sticky max-md:bottom-0 max-md:z-10 max-md:-mx-6 max-md:bg-card max-md:px-6 max-md:py-3">
        <button type="submit" className={`${btnPrimary} max-md:basis-full`}>
          Готово
        </button>
        <button
          type="button"
          onClick={() => setDraft((d) => (props.phone ? resetReportState(d) : withDialogFields(d, reportDialogFields(DEFAULT_REPORT_STATE))))}
          className="text-sm font-semibold text-muted underline hover:text-ink"
        >
          Сбросить
        </button>
      </div>
    </form>
  );
}

/**
 * Окно «Фильтры» отчёта (§2.4): категории с подкатегориями, контрагенты, проекты, теги, счета; по умолчанию — «Все».
 * На телефоне — на весь экран и с контролами отчёта (§2.2); режим запоминается при открытии.
 */
export function ReportFilterDialog(props: {
  open: boolean;
  state: ReportUrlState;
  data: FilterDialogData;
  phone: boolean;
  today: string;
  /** Тип даты над списком периодов (§2.3): «По дате платежа» или «По дате сделки». */
  dateHeading: string;
  /** Переключатель «Учитывать склад по себестоимости» на телефоне (§5.3): у «Прибыли» компании со складом. */
  stock?: boolean;
  onApply: (next: ReportUrlState) => void;
  onClose: () => void;
}) {
  return (
    <Modal open={props.open} title="Фильтры" onClose={props.onClose} className={`max-w-[818px] max-md:scroll-pb-44 ${phoneFullScreenModal}`} phoneFullScreen>
      <ReportFilterForm
        state={props.state}
        data={props.data}
        phone={props.phone}
        today={props.today}
        dateHeading={props.dateHeading}
        stock={props.stock ?? false}
        onApply={(next) => {
          props.onApply(next);
          props.onClose();
        }}
      />
    </Modal>
  );
}
