import { useState, type FormEvent } from 'react';
import { getTemplate } from '../../templates';
import type { TemplateInfo } from '../lib/queries';
import { btnPrimary, btnSecondary, inputClass } from './ui';

export interface ProjectFormValues {
  name: string;
  templateKey: string;
  templateParams: Record<string, unknown>;
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
  const [clientFields, setClientFields] = useState<Record<string, string>>({});
  const info = props.templates.find((t) => t.key === templateKey);
  const fields = { ...props.serverFields, ...clientFields };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const raw: Record<string, unknown> = {};
    for (const p of info?.paramsUi ?? []) {
      const s = (inputs[p.key] ?? '').trim();
      if (s === '') continue;
      raw[p.key] = p.type === 'int' ? Number(s) : s;
    }
    const schema = getTemplate(templateKey)?.params;
    const parsed = schema?.safeParse(raw);
    if (parsed && !parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[`templateParams.${issue.path.join('.')}`] ??= issue.message;
      setClientFields(next);
      return;
    }
    setClientFields({});
    props.onSubmit({ name, templateKey, templateParams: raw });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-2xl bg-canvas p-4">
      <label className="block">
        <span className="mb-1 block text-sm text-muted">Название проекта</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Клуб на Ленина" className={inputClass} />
        {fields.name && <span className="mt-1 block text-sm text-expense">{fields.name}</span>}
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-muted">Тип бизнеса</span>
        <select
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
        {fields.templateKey && <span className="mt-1 block text-sm text-expense">{fields.templateKey}</span>}
      </label>
      {info?.paramsUi.map((p) => (
        <label key={p.key} className="block">
          <span className="mb-1 block text-sm text-muted">{p.label}</span>
          <input
            inputMode={p.type === 'int' ? 'numeric' : 'text'}
            value={inputs[p.key] ?? ''}
            onChange={(e) => setInputs((v) => ({ ...v, [p.key]: e.target.value }))}
            className={inputClass}
          />
          {p.hint && <span className="mt-1 block text-xs text-muted">{p.hint}</span>}
          {fields[`templateParams.${p.key}`] && (
            <span className="mt-1 block text-sm text-expense">{fields[`templateParams.${p.key}`]}</span>
          )}
        </label>
      ))}
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
