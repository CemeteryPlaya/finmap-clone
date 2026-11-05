import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type ApiError } from "../../lib/api";
import { parseSeats } from "../../lib/club-load";
import { Field } from "../Field";
import { Pending } from "../QueryState";
import { alertClass, btnSecondary, inputClass } from "../ui";

interface ZoneView {
  zone: string;
  found: number;
  seats: number | null;
}

/** Поля зон по ответу: своё число — строкой, пусто — по данным. */
const textsOf = (zones: readonly ZoneView[]) =>
  Object.fromEntries(
    zones.map((z) => [z.zone, z.seats === null ? "" : String(z.seats)]),
  );

/**
 * Зоны клуба Senet (спецификация «Аналитика клуба», §6.1): сколько ПК найдено по данным за 30 дней и своё число. Пустое
 * поле — по данным. Сохраняется отдельно от связей клуба кнопкой «Сохранить зоны»: это знаменатель отчёта «Загрузка».
 */
export function OfficeZones(props: { companyId: number; officeId: number }) {
  const key = ["senet", props.companyId, "office-zones", props.officeId];
  const url = `/companies/${props.companyId}/senet/offices/${props.officeId}/zones`;
  const qc = useQueryClient();
  const zones = useQuery({
    queryKey: key,
    queryFn: () => api<{ zones: ZoneView[] }>(url),
  });
  const [texts, setTexts] = useState<Record<string, string> | null>(null);
  const [saved, setSaved] = useState(false);
  const save = useMutation<
    { zones: ZoneView[] },
    ApiError,
    { zone: string; seats: number | null }[]
  >({
    mutationFn: (body) =>
      api<{ zones: ZoneView[] }>(url, { method: "PUT", body: { zones: body } }),
    onSuccess: async (r) => {
      setTexts(textsOf(r.zones));
      setSaved(true);
      qc.setQueryData(key, r);
      await qc.invalidateQueries({
        queryKey: ["analytics", props.companyId, "club"],
      });
    },
  });
  if (!zones.data) return <Pending queries={[zones]} />;
  const list = zones.data.zones;
  const values = texts ?? textsOf(list);
  const parsed = list.map((z) => ({
    zone: z.zone,
    r: parseSeats(values[z.zone] ?? ""),
  }));
  const bad = new Map(
    parsed.flatMap((p) =>
      "error" in p.r ? [[p.zone, p.r.error] as const] : [],
    ),
  );

  return (
    <section
      aria-labelledby="office-zones"
      className="mt-6 border-t border-field pt-4"
    >
      <h3 id="office-zones" className="mb-1 font-bold">
        Зоны
      </h3>
      <p className="mb-3 text-sm text-muted">
        Сколько ПК в зоне — для отчёта «Загрузка». Пустое поле — сколько мест
        найдено в данных Senet.
      </p>
      {list.length === 0 ? (
        <p className="text-sm text-muted">Сеансов по зонам за 30 дней нет</p>
      ) : (
        <div className="grid gap-3">
          {list.map((z) => (
            <Field
              key={z.zone}
              label={`${z.zone}: своё число ПК`}
              hint={`Найдено по данным за 30 дней: ${z.found}`}
              error={bad.get(z.zone) ?? save.error?.fields?.[z.zone]}
            >
              {(c) => (
                <input
                  {...c}
                  inputMode="numeric"
                  value={values[z.zone] ?? ""}
                  placeholder={String(z.found)}
                  onChange={(e) => {
                    setSaved(false);
                    setTexts({ ...values, [z.zone]: e.target.value });
                  }}
                  className={inputClass}
                />
              )}
            </Field>
          ))}
          {save.error && (
            <p role="alert" className={`${alertClass} mb-0`}>
              {save.error.message}
            </p>
          )}
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={save.isPending || bad.size > 0}
              className={btnSecondary}
              onClick={() =>
                save.mutate(
                  parsed.map((p) => ({
                    zone: p.zone,
                    seats: "seats" in p.r ? p.r.seats : null,
                  })),
                )
              }
            >
              Сохранить зоны
            </button>
            {saved && (
              <span role="status" className="text-sm text-muted">
                Зоны сохранены
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
