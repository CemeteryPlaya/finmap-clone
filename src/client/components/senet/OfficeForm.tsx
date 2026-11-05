import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type {
  SenetOfficeDto,
  SenetOfficeInput,
} from "../../../shared/schemas/senet";
import { api, type ApiError } from "../../lib/api";
import {
  useAccounts,
  useCategories,
  useProjects,
  type CategoryNode,
} from "../../lib/queries";
import {
  defaultOfficeAccounts,
  invalidateSenet,
  isoToLocalInput,
  localInputToIso,
} from "../../lib/senet";
import { Field } from "../Field";
import { Pending } from "../QueryState";
import { OfficeZones } from "./OfficeZones";
import { alertClass, btnPrimary, btnSecondary, inputClass } from "../ui";

const flat = (
  nodes: CategoryNode[],
  depth = 0,
): { id: number; label: string }[] =>
  nodes
    .filter((n) => !n.archivedAt)
    .flatMap((n) => [
      { id: n.id, label: `${"— ".repeat(depth)}${n.name}` },
      ...flat(n.children, depth + 1),
    ]);

/**
 * Клуб подключения и его связи (§8.1): проект, счета кассы и Kaspi, категория дохода смены, «Загружать с даты»,
 * постоянная разница кассы. Включённый клуб забирается и проводится; связи у него обязательны.
 */
export function OfficeForm(props: {
  companyId: number;
  connectionId: number;
  timeZone: string;
  office: SenetOfficeDto | null;
  onDone: () => void;
}) {
  const projects = useProjects(props.companyId);
  const accounts = useAccounts(props.companyId);
  const categories = useCategories(props.companyId);
  const o = props.office;
  const [v, setV] = useState<SenetOfficeInput>({
    senetOfficeId: o?.senetOfficeId ?? 1,
    cashDeskId: o?.cashDeskId ?? 1,
    name: o?.name ?? "",
    enabled: o?.enabled ?? false,
    projectId: o?.projectId ?? null,
    cashAccountId: o?.cashAccountId ?? null,
    kaspiAccountId: o?.kaspiAccountId ?? null,
    incomeCategoryId: o?.incomeCategoryId ?? null,
    historyFrom: o?.historyFrom ?? null,
    cashOffset: o?.cashOffset ?? 0,
  });
  const [historyText, setHistoryText] = useState(
    isoToLocalInput(v.historyFrom, props.timeZone),
  );
  const [offsetText, setOffsetText] = useState(
    String((o?.cashOffset ?? 0) / 100),
  );
  const set = (patch: Partial<SenetOfficeInput>) =>
    setV((x) => ({ ...x, ...patch }));
  /** Начало первой смены, которой ещё нет в журнале (§5.5). */
  const suggestHistory = async () => {
    const r = await api<{ openedAt: string | null }>(
      `/companies/${props.companyId}/senet/offices/${o!.id}/history-from-suggestion`,
    );
    if (r.openedAt) setHistoryText(isoToLocalInput(r.openedAt, props.timeZone));
  };
  const save = useMutation<unknown, ApiError>({
    mutationFn: () => {
      const body = {
        ...v,
        historyFrom: localInputToIso(historyText, props.timeZone),
        cashOffset: Math.round(Number(offsetText.replace(",", ".") || 0) * 100),
      };
      return o
        ? api(`/companies/${props.companyId}/senet/offices/${o.id}`, {
            method: "PATCH",
            body,
          })
        : api(
            `/companies/${props.companyId}/senet/connections/${props.connectionId}/offices`,
            { method: "POST", body },
          );
    },
    onSuccess: async () => {
      await invalidateSenet(props.companyId);
      props.onDone();
    },
  });
  if (!projects.data || !accounts.data || !categories.data)
    return <Pending queries={[projects, accounts, categories]} />;
  const kzt = accounts.data.filter(
    (a) => a.currency === "KZT" && !a.archivedAt,
  );
  const err = (f: string) => save.error?.fields?.[f];
  const pickProject = (id: number | null) => {
    const p = projects.data.find((x) => x.id === id);
    const defaults = p
      ? defaultOfficeAccounts(accounts.data, p.name)
      : { cashAccountId: null, kaspiAccountId: null };
    set({
      projectId: id,
      cashAccountId: v.cashAccountId ?? defaults.cashAccountId,
      kaspiAccountId: v.kaspiAccountId ?? defaults.kaspiAccountId,
    });
  };
  const select =
    (
      value: number | null,
      onChange: (id: number | null) => void,
      options: { id: number; label: string }[],
    ) =>
    (c: object) => (
      <select
        {...c}
        value={value ?? ""}
        onChange={(e) =>
          onChange(e.target.value ? Number(e.target.value) : null)
        }
        className={inputClass}
      >
        <option value="">—</option>
        {options.map((x) => (
          <option key={x.id} value={x.id}>
            {x.label}
          </option>
        ))}
      </select>
    );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <>
      <form noValidate onSubmit={submit} className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Номер клуба Senet" error={err("senetOfficeId")}>
            {(c) => (
              <input
                {...c}
                type="number"
                min={1}
                value={v.senetOfficeId}
                onChange={(e) =>
                  set({ senetOfficeId: Number(e.target.value) || 1 })
                }
                className={inputClass}
              />
            )}
          </Field>
          <Field label="Номер кассы" error={err("cashDeskId")}>
            {(c) => (
              <input
                {...c}
                type="number"
                min={1}
                value={v.cashDeskId}
                onChange={(e) =>
                  set({ cashDeskId: Number(e.target.value) || 1 })
                }
                className={inputClass}
              />
            )}
          </Field>
        </div>
        <Field label="Название в Senet">
          {(c) => (
            <input
              {...c}
              value={v.name}
              maxLength={100}
              onChange={(e) => set({ name: e.target.value })}
              className={inputClass}
            />
          )}
        </Field>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={v.enabled}
            onChange={(e) => set({ enabled: e.target.checked })}
          />
          Забирать и проводить смены клуба
        </label>
        <Field label="Проект" error={err("projectId")}>
          {select(
            v.projectId,
            pickProject,
            projects.data
              .filter((p) => !p.archivedAt)
              .map((p) => ({ id: p.id, label: p.name })),
          )}
        </Field>
        <Field
          label="Счёт кассы"
          hint="Сюда идут доход «Касса» и все выемки"
          error={err("cashAccountId")}
        >
          {select(
            v.cashAccountId,
            (id) => set({ cashAccountId: id }),
            kzt.map((a) => ({ id: a.id, label: a.name })),
          )}
        </Field>
        <Field
          label="Счёт Kaspi"
          hint="Доход «Каспи» — сумма выносов kaspi за смену"
          error={err("kaspiAccountId")}
        >
          {select(
            v.kaspiAccountId,
            (id) => set({ kaspiAccountId: id }),
            kzt.map((a) => ({ id: a.id, label: a.name })),
          )}
        </Field>
        <Field label="Категория дохода смены" error={err("incomeCategoryId")}>
          {select(
            v.incomeCategoryId,
            (id) => set({ incomeCategoryId: id }),
            flat(categories.data.income),
          )}
        </Field>
        <Field
          label="Загружать с даты"
          hint="Смены раньше этой даты считаются уже внесёнными вручную"
          error={err("historyFrom")}
        >
          {(c) => (
            <div className="flex gap-2">
              <input
                {...c}
                type="datetime-local"
                value={historyText}
                onChange={(e) => setHistoryText(e.target.value)}
                className={inputClass}
              />
              {o && (
                <button
                  type="button"
                  className={btnSecondary}
                  onClick={() => void suggestHistory()}
                >
                  Предложить
                </button>
              )}
            </div>
          )}
        </Field>
        <Field
          label="Постоянная разница кассы, ₸"
          hint="Учёт минус Senet: так «Сверка» сравнивает остаток кассы после смены"
          error={err("cashOffset")}
        >
          {(c) => (
            <input
              {...c}
              inputMode="decimal"
              value={offsetText}
              onChange={(e) => setOffsetText(e.target.value)}
              className={inputClass}
            />
          )}
        </Field>
        {save.error && !save.error.fields && (
          <p role="alert" className={`${alertClass} mb-0`}>
            {save.error.message}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={save.isPending}
            className={btnPrimary}
          >
            Сохранить
          </button>
          <button type="button" onClick={props.onDone} className={btnSecondary}>
            Отмена
          </button>
        </div>
      </form>
      {o && <OfficeZones companyId={props.companyId} officeId={o.id} />}
    </>
  );
}
