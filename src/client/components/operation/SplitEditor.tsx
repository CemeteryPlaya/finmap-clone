import { useId, useState } from 'react';
import { formatBp } from '../../../shared/percent';
import { formatMoney } from '../../../shared/money';
import { api, ApiError } from '../../lib/api';
import { categoryOptions, projectOptions } from '../../lib/operation-options';
import { queryClient } from '../../lib/query';
import type { CategoryTree, Project, SplitPreset } from '../../lib/queries';
import {
  applyPreset,
  droppedText,
  newLine,
  presetContext,
  presetFromSplit,
  splitResult,
  SPLIT_MAX_LINES,
  type SplitDraft,
  type SplitLineDraft,
  type SplitMode,
} from '../../lib/split';
import { Field } from '../Field';
import { SearchPicker } from '../SearchPicker';
import { btnSmall, inputClass } from '../ui';
import { AmountField } from './AmountField';
import { ComboSelect } from './ComboSelect';

const MODES: { mode: SplitMode; label: string }[] = [
  { mode: 'amount', label: 'Суммами' },
  { mode: 'percent', label: 'В процентах' },
];

/**
 * Разбиение операции (§7 «Разделить»): строки «статья, проект, сумма или %», индикатор нераспределённого
 * остатка, применение сохранённого шаблона разделения и сохранение текущего разбиения как шаблона.
 */
export function SplitEditor(props: {
  companyId: number;
  kind: 'income' | 'expense';
  value: SplitDraft;
  onChange: (split: SplitDraft) => void;
  /** Отменить разбиение: вернуться к одной статье и проекту. */
  onCancel: () => void;
  /** Сумма операции в минимальных единицах; null — ещё не введена. */
  total: number | null;
  currency: string;
  minorUnits: number;
  categories: CategoryTree;
  projects: Project[];
  presets: SplitPreset[];
  error?: string;
}) {
  const modeName = useId();
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState<{ name: string; error: string | null; pending: boolean } | null>(null);
  const split = props.value;
  const result = splitResult(split, props.total, props.minorUnits);

  const setLine = (index: number, patch: Partial<SplitLineDraft>) =>
    props.onChange({ ...split, lines: split.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) });

  const leftText =
    result.left === null
      ? 'Введите сумму операции'
      : result.left === 0
        ? 'Распределено полностью'
        : split.mode === 'amount'
          ? result.left > 0
            ? `Не распределено: ${formatMoney(result.left, props.currency)}`
            : `Распределено больше суммы на ${formatMoney(-result.left, props.currency)}`
          : result.left > 0
            ? `Не распределено: ${formatBp(result.left)} %`
            : `Распределено больше 100 % на ${formatBp(-result.left)} %`;

  const apply = (preset: SplitPreset) => {
    const r = applyPreset(preset.lines, presetContext(props.categories, props.projects, props.kind));
    if (r.split) props.onChange(r.split);
    setNotice(
      r.split === null
        ? `Шаблон «${preset.name}» не применён: все его статьи и проекты недоступны (удалены, в архиве или другого вида).`
        : r.dropped > 0
          ? `Шаблон «${preset.name}»: ${droppedText(r.dropped)} (удалены, в архиве или другого вида) — не применены.`
          : null,
    );
  };

  const savePreset = async () => {
    if (!saving) return;
    const lines = presetFromSplit(split, result);
    if (!lines.ok) {
      setSaving({ ...saving, error: lines.error });
      return;
    }
    setSaving({ ...saving, pending: true, error: null });
    try {
      await api(`/companies/${props.companyId}/split-presets`, { method: 'POST', body: { name: saving.name, lines: lines.lines } });
      await queryClient.invalidateQueries({ queryKey: ['split-presets', props.companyId] });
      setSaving(null);
      setNotice(`Шаблон «${saving.name.trim()}» сохранён.`);
    } catch (e) {
      const fields = e instanceof ApiError ? e.fields : undefined;
      setSaving({ ...saving, pending: false, error: fields?.name ?? fields?.lines ?? (e instanceof ApiError ? e.message : 'Ошибка сервера') });
    }
  };

  return (
    <section aria-label="Разбиение" className="grid gap-3 rounded-2xl bg-canvas p-4 md:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <fieldset className="inline-flex gap-1 rounded-xl bg-field p-1">
          <legend className="sr-only">Как делить</legend>
          {MODES.map((m) => (
            <label
              key={m.mode}
              className="relative cursor-pointer rounded-lg px-3 py-1.5 text-sm font-semibold text-muted has-[:checked]:bg-card has-[:checked]:text-ink has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus"
            >
              <input
                type="radio"
                name={modeName}
                checked={split.mode === m.mode}
                onChange={() => props.onChange({ mode: m.mode, lines: split.lines.map((l) => ({ ...l, value: '' })) })}
                className="absolute inset-0 cursor-pointer appearance-none rounded-lg opacity-0"
              />
              {m.label}
            </label>
          ))}
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <SearchPicker
            label="Применить шаблон"
            listLabel="Шаблоны разделения"
            options={props.presets.filter((p) => !p.archivedAt).map((p) => ({ id: p.id, label: p.name }))}
            onPick={(id) => apply(props.presets.find((p) => p.id === id)!)}
            buttonClassName={btnSmall}
          />
          <button type="button" onClick={() => setSaving({ name: '', error: null, pending: false })} className={btnSmall}>
            Сохранить как шаблон
          </button>
        </div>
      </div>

      {split.lines.map((line, i) => (
        <div key={line.key} role="group" aria-label={`Строка ${i + 1}`} className="grid items-start gap-2 md:grid-cols-[1fr_1fr_10rem_auto]">
          <ComboSelect
            label="Статья"
            listLabel="Статьи"
            value={line.categoryId}
            options={categoryOptions(props.categories, props.kind, [line.categoryId])}
            emptyLabel="Без статьи"
            onChange={(categoryId) => setLine(i, { categoryId })}
          />
          <ComboSelect
            label="Проект"
            listLabel="Проекты"
            value={line.projectId}
            options={projectOptions(props.projects, [line.projectId])}
            emptyLabel="Без проекта"
            onChange={(projectId) => setLine(i, { projectId })}
          />
          {split.mode === 'amount' ? (
            <AmountField
              label="Сумма"
              value={line.value}
              onChange={(value) => setLine(i, { value })}
              minorUnits={props.minorUnits}
              error={line.value.trim() !== '' ? (result.errors[i] ?? undefined) : undefined}
            />
          ) : (
            <Field
              label="Доля, %"
              error={line.value.trim() !== '' ? (result.errors[i] ?? undefined) : undefined}
              hint={result.amounts[i] != null ? `= ${formatMoney(result.amounts[i]!, props.currency)}` : undefined}
            >
              {(c) => <input {...c} inputMode="decimal" autoComplete="off" value={line.value} onChange={(e) => setLine(i, { value: e.target.value })} className={inputClass} />}
            </Field>
          )}
          <button
            type="button"
            aria-label={`Убрать строку ${i + 1}`}
            disabled={split.lines.length <= 1}
            onClick={() => props.onChange({ ...split, lines: split.lines.filter((_, j) => j !== i) })}
            className={`${btnSmall} md:mt-7`}
          >
            ×
          </button>
        </div>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          disabled={split.lines.length >= SPLIT_MAX_LINES}
          onClick={() => props.onChange({ ...split, lines: [...split.lines, newLine()] })}
          className={btnSmall}
        >
          + Строка
        </button>
        <p role="status" className={`text-sm font-semibold ${result.left === 0 ? 'text-income' : 'text-expense'}`}>
          {leftText}
        </p>
      </div>
      {props.error && <p className="text-sm text-expense">{props.error}</p>}
      {/* область role="status" есть всегда — меняется только текст, так его объявляют программы чтения с экрана */}
      <div role="status" className={notice ? 'flex flex-wrap items-center justify-between gap-2 rounded-xl bg-field px-3 py-2 text-sm' : 'sr-only'}>
        {notice && (
          <>
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} className="font-semibold underline">
              Скрыть
            </button>
          </>
        )}
      </div>
      {saving && (
        <div role="group" aria-label="Новый шаблон разделения" className="flex flex-wrap items-end gap-2">
          <Field label="Название шаблона" error={saving.error ?? undefined} className="min-w-48 flex-1">
            {(c) => (
              <input
                {...c}
                autoFocus
                value={saving.name}
                onChange={(e) => setSaving({ ...saving, name: e.target.value, error: null })}
                onKeyDown={(e) => {
                  // Enter здесь сохраняет шаблон, а не операцию
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void savePreset();
                  }
                }}
                className={inputClass}
              />
            )}
          </Field>
          <button type="button" disabled={saving.pending} onClick={() => void savePreset()} className={btnSmall}>
            Сохранить шаблон
          </button>
          <button type="button" onClick={() => setSaving(null)} className={btnSmall}>
            Не сохранять
          </button>
        </div>
      )}
      <button type="button" onClick={props.onCancel} className="justify-self-start text-sm font-semibold text-muted underline">
        Отменить разбиение
      </button>
    </section>
  );
}
