import { useEffect, useId, useRef, useState } from 'react';
import { formatBp } from '../../../shared/percent';
import { formatMoney, MONEY_SCREEN } from '../../../shared/money';
import { api, ApiError } from '../../lib/api';
import { categoryOptions, projectOptions } from '../../lib/operation-options';
import { createProps } from '../../lib/picker';
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
import { ConfirmDialog } from '../ConfirmDialog';
import { Field } from '../Field';
import { SearchPicker } from '../SearchPicker';
import { btnSmall, floatingControlClass, inputClass } from '../ui';
import { AmountField } from './AmountField';
import { ComboSelect } from './ComboSelect';

const MODES: { mode: SplitMode; label: string }[] = [
  { mode: 'amount', label: 'Суммами' },
  { mode: 'percent', label: 'В процентах' },
];

/**
 * Разбиение операции (§7 «Разделить»): строки «категория, проект, сумма или %», индикатор нераспределённого
 * остатка, применение сохранённого шаблона разделения и сохранение текущего разбиения как шаблона.
 */
export function SplitEditor(props: {
  companyId: number;
  kind: 'income' | 'expense';
  value: SplitDraft;
  onChange: (split: SplitDraft) => void;
  /** Сумма операции в минимальных единицах; null — ещё не введена. */
  total: number | null;
  currency: string;
  minorUnits: number;
  categories: CategoryTree;
  projects: Project[];
  presets: SplitPreset[];
  error?: string;
  /** «+ Создать „…“» в строке: создать категорию или проект и выбрать его в строке с ключом key. */
  onCreateCategory?: (name: string, key: number) => void | Promise<boolean>;
  onCreateProject?: (name: string, key: number) => void | Promise<boolean>;
  /** Элемент, с которого спросили подтверждение, исчез: куда вернуть фокус (форма — в поле суммы, §11). */
  onFocusLost?: () => void;
}) {
  const modeName = useId();
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState<{ name: string; error: string | null; pending: boolean } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'mode'; mode: SplitMode } | { kind: 'preset'; preset: SplitPreset } | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  /** Куда перевести фокус после изменения списка строк (строки появляются и исчезают). */
  const focusAfter = useRef<{ kind: 'add' } | { kind: 'remove'; index: number } | null>(null);
  const split = props.value;
  const filled = split.lines.some((l) => l.value.trim() !== '');
  const result = splitResult(split, props.total, props.minorUnits);

  useEffect(() => {
    const target = focusAfter.current;
    focusAfter.current = null;
    const section = sectionRef.current;
    if (!target || !section) return;
    const rows = Array.from(section.querySelectorAll<HTMLElement>(':scope > [role="group"][aria-label^="Строка"]'));
    if (target.kind === 'add') {
      // новая строка — фокус в её первое поле (категория — поле ввода со списком)
      // на телефоне фокус в поле открыл бы экранную клавиатуру поверх формы: фокус остаётся на «+ Строка», новая строка прокручивается в видимую область
      const row = rows[rows.length - 1];
      if (window.matchMedia?.('(pointer: coarse)').matches) row?.scrollIntoView({ block: 'nearest' });
      else row?.querySelector<HTMLElement>('input, button')?.focus();
      return;
    }
    const remove = rows[Math.max(target.index - 1, 0)]?.querySelector<HTMLButtonElement>('button[aria-label^="Убрать строку"]');
    if (remove && !remove.disabled) remove.focus();
    else section.querySelector<HTMLElement>('[data-add-line]')?.focus();
  }, [split.lines.length]);

  const setLine = (index: number, patch: Partial<SplitLineDraft>) =>
    props.onChange({ ...split, lines: split.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) });

  const leftText =
    result.left === null || props.total === null
      ? 'Введите сумму операции'
      : result.left === 0
        ? 'Распределено полностью'
        : split.mode === 'amount'
          ? result.left > 0
            ? `Не распределено: ${formatMoney(result.left, props.currency, MONEY_SCREEN)}`
            : `Распределено больше суммы на ${formatMoney(-result.left, props.currency, MONEY_SCREEN)}`
          : result.left > 0
            ? `Не распределено: ${formatBp(result.left)} %`
            : `Распределено больше 100 % на ${formatBp(-result.left)} %`;

  const switchMode = (mode: SplitMode) => {
    setConfirm(null);
    props.onChange({ mode, lines: split.lines.map((l) => ({ ...l, value: '' })) });
  };

  const pickPreset = (preset: SplitPreset) => (filled ? setConfirm({ kind: 'preset', preset }) : apply(preset));

  const apply = (preset: SplitPreset) => {
    setConfirm(null);
    const r = applyPreset(preset.lines, presetContext(props.categories, props.projects, props.kind));
    if (r.split) props.onChange(r.split);
    setNotice(
      r.split === null
        ? `Шаблон «${preset.name}» не применён: все его категории и проекты недоступны (удалены, в архиве или другого вида).`
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
      await api(`/companies/${props.companyId}/split-presets`, { method: 'POST', body: { name: saving.name.trim(), lines: lines.lines } });
      await queryClient.invalidateQueries({ queryKey: ['split-presets', props.companyId] });
      setSaving(null);
      setNotice(`Шаблон «${saving.name.trim()}» сохранён.`);
    } catch (e) {
      const fields = e instanceof ApiError ? e.fields : undefined;
      setSaving({ ...saving, pending: false, error: fields?.name ?? fields?.lines ?? (e instanceof ApiError ? e.message : 'Ошибка сервера') });
    }
  };

  return (
    <section ref={sectionRef} aria-label="Разбиение" className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-2xl bg-canvas p-4">
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
                onChange={() => (filled ? setConfirm({ kind: 'mode', mode: m.mode }) : switchMode(m.mode))}
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
            onPick={(id) => pickPreset(props.presets.find((p) => p.id === id)!)}
            buttonClassName={btnSmall}
          />
          <button type="button" onClick={() => setSaving({ name: '', error: null, pending: false })} className={btnSmall}>
            Сохранить как шаблон
          </button>
        </div>
      </div>

      {/* окно 480 px (§6.1 этапа 1.5): категория и проект — в одну строку, ниже сумма (или доля) и «×» */}
      {split.lines.map((line, i) => (
        <div key={line.key} role="group" aria-label={`Строка ${i + 1}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-2">
          <ComboSelect
            label="Категория"
            listLabel="Категории"
            value={line.categoryId}
            options={categoryOptions(props.categories, props.kind, [line.categoryId])}
            emptyLabel="Без категории"
            onChange={(categoryId) => setLine(i, { categoryId })}
            {...createProps<void | Promise<boolean>>(props.onCreateCategory ? { onCreate: (name) => props.onCreateCategory!(name, line.key), createNoun: 'категорию' } : {})}
          />
          <ComboSelect
            label="Проект"
            listLabel="Проекты"
            value={line.projectId}
            options={projectOptions(props.projects, [line.projectId])}
            emptyLabel="Без проекта"
            onChange={(projectId) => setLine(i, { projectId })}
            {...createProps<void | Promise<boolean>>(props.onCreateProject ? { onCreate: (name) => props.onCreateProject!(name, line.key), createNoun: 'проект' } : {})}
          />
          <div className="col-span-2 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
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
              hint={result.amounts[i] != null ? `= ${formatMoney(result.amounts[i]!, props.currency, MONEY_SCREEN)}` : undefined}
              floating
              filled={line.value !== ''}
            >
              {(c) => (
                <input {...c} inputMode="decimal" autoComplete="off" value={line.value} onChange={(e) => setLine(i, { value: e.target.value })} className={floatingControlClass} />
              )}
            </Field>
          )}
          <button
            type="button"
            aria-label={`Убрать строку ${i + 1}`}
            disabled={split.lines.length <= 1}
            onClick={() => {
              focusAfter.current = { kind: 'remove', index: i };
              props.onChange({ ...split, lines: split.lines.filter((_, j) => j !== i) });
            }}
            className={`${btnSmall} mt-3`}
          >
            ×
          </button>
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          disabled={split.lines.length >= SPLIT_MAX_LINES}
          data-add-line=""
          onClick={() => {
            focusAfter.current = { kind: 'add' };
            props.onChange({ ...split, lines: [...split.lines, newLine()] });
          }}
          className={btnSmall}
        >
          + Строка
        </button>
        <p role="status" className={`text-sm font-semibold ${result.left === 0 ? 'text-income' : 'text-expense'}`}>
          {leftText}
        </p>
      </div>
      {props.error && <p role="alert" className="text-sm text-expense">{props.error}</p>}
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
      {/* подтверждение — вложенное окно (§2.4 этапа 1.5): Esc закрывает только его, вопроса формы нет (отложенное 6a №2) */}
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === 'preset' ? `Применить шаблон «${confirm.preset.name}»?` : 'Сменить способ деления?'}
        text={confirm?.kind === 'preset' ? 'Строки будут заменены шаблоном, значения сброшены.' : 'Значения строк будут сброшены.'}
        confirmLabel={confirm?.kind === 'preset' ? 'Применить' : 'Сбросить значения'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind === 'mode') switchMode(confirm.mode);
          else if (confirm?.kind === 'preset') apply(confirm.preset);
        }}
        // переключатель или кнопка шаблона исчезли (или фокус был ничей) — как у всех подтверждений формы (§11): в поле суммы
        onFocusLost={props.onFocusLost}
      />
    </section>
  );
}
