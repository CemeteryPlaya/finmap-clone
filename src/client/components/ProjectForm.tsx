import { useState, type FormEvent } from 'react';
import { getTemplate } from '../../templates';
import { parseIntInput } from '../lib/numbers';
import type { TemplateInfo } from '../lib/queries';
import { Field } from './Field';
import { btnPrimary, btnSecondary, inputClass } from './ui';

export interface ProjectFormValues {
  name: string;
  templateKey: string;
  templateParams: Record<string, unknown>;
  /** Только при правке с изменённым названием: переименовать счета шаблона вместе с проектом. */
  renameAccounts?: boolean;
}

function toInputs(params: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v === undefined || v === null ? '' : String(v)]));
}

export function ProjectForm(props: {
  templates: TemplateInfo[];
  mode: 'create' | 'edit';
  initial?: ProjectFormValues;
  pending: boolean;
  serverFields?: Record<string, string>;
  serverError?: string;
  onSubmit: (values: ProjectFormValues) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(props.initial?.name ?? '');
  const [templateKey, setTemplateKey] = useState(props.initial?.templateKey ?? props.templates[0]?.key ?? '');
  const [inputs, setInputs] = useState<Record<string, string>>(toInputs(props.initial?.templateParams ?? {}));
  const [renameAccounts, setRenameAccounts] = useState(true);
  const [clientFields, setClientFields] = useState<Record<string, string>>({});
  const info = props.templates.find((t) => t.key === templateKey);
  const fields = { ...props.serverFields, ...clientFields };
  const offerRename =
    props.mode === 'edit' && props.initial !== undefined && name.trim() !== props.initial.name && (info?.defaultAccounts.length ?? 0) > 0;
  const accountPatterns = (info?.defaultAccounts ?? []).map((a) => `«${a.replaceAll('{project}', '…')}»`).join(', ');

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const raw: Record<string, unknown> = {};
    const errors: Record<string, string> = {};
    for (const p of info?.paramsUi ?? []) {
      const s = (inputs[p.key] ?? '').trim();
      if (s === '') continue; // пусто — значение по умолчанию схемы или «обязательное поле»
      if (p.type === 'int') {
        const n = parseIntInput(s);
        if (n.ok) raw[p.key] = n.value;
        else errors[`templateParams.${p.key}`] = n.error;
      } else {
        raw[p.key] = s;
      }
    }
    let params = raw;
    if (Object.keys(errors).length === 0) {
      const parsed = getTemplate(templateKey)?.params.safeParse(raw);
      if (parsed && !parsed.success) {
        for (const issue of parsed.error.issues) errors[`templateParams.${issue.path.join('.')}`] ??= issue.message;
      } else if (parsed) {
        // отправляем значения после схемы: очищенное поле получает значение по умолчанию, а не старое с сервера
        params = parsed.data;
      }
    }
    setClientFields(errors);
    if (Object.keys(errors).length > 0) return;
    props.onSubmit({ name, templateKey, templateParams: params, ...(offerRename ? { renameAccounts } : {}) });
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4 rounded-2xl bg-canvas p-4">
      <Field label="Название проекта" error={fields.name}>
        {(c) => <input {...c} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Клуб на Ленина" className={inputClass} />}
      </Field>
      <Field label="Тип бизнеса" error={fields.templateKey}>
        {(c) => (
          <select
            {...c}
            value={templateKey}
            disabled={props.mode === 'edit'}
            onChange={(e) => {
              setTemplateKey(e.target.value);
              setInputs({});
              setClientFields({});
            }}
            className={inputClass}
          >
            {props.templates.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      {info?.paramsUi.map((p) => (
        <Field key={p.key} label={p.label} hint={p.hint} error={fields[`templateParams.${p.key}`]}>
          {(c) => (
            <input
              {...c}
              inputMode={p.type === 'int' ? 'numeric' : 'text'}
              value={inputs[p.key] ?? ''}
              onChange={(e) => setInputs((v) => ({ ...v, [p.key]: e.target.value }))}
              className={inputClass}
            />
          )}
        </Field>
      ))}
      {offerRename && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={renameAccounts} onChange={(e) => setRenameAccounts(e.target.checked)} className="mt-1" />
          <span>Переименовать счета проекта ({accountPatterns}), если их названия не меняли вручную</span>
        </label>
      )}
      {props.serverError && (
        <p role="alert" className="rounded-xl bg-expense-soft px-4 py-3 text-sm text-expense">
          {props.serverError}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={props.pending || !name.trim()} className={btnPrimary}>
          {props.mode === 'create' ? 'Создать проект' : 'Сохранить'}
        </button>
        <button type="button" onClick={props.onCancel} className={btnSecondary}>
          Отмена
        </button>
      </div>
    </form>
  );
}
