import { useId, useState } from 'react';
import { CURRENCIES, getCurrency, isKnownCurrency } from '../../../shared/currencies';
import { formatDateRu } from '../../../shared/dates';
import { nameKey } from '../../../shared/finmap-format';
import { formatMoney, MONEY_SCREEN_BEFORE } from '../../../shared/money';
import type { AccountMapping, ImportPreviewAccount } from '../../../shared/schemas/imports';
import {
  draftFromCard,
  existingAccountHint,
  formatCount,
  mappingFromDraft,
  NEW_ACCOUNT,
  newAccountHint,
  sameMapping,
  signedMoney,
  type CardDraft,
} from '../../lib/import-panel';
import { accountOptions } from '../../lib/operation-options';
import type { Account } from '../../lib/queries';
import { Field } from '../Field';
import { ComboSelect } from '../operation/ComboSelect';
import { inputClass } from '../ui';

/** Почему «Создать новый счёт» недоступен (R4 плана И-2): активный счёт с таким названием уже есть. */
export const CREATE_TAKEN_HINT = 'Счёт с таким названием уже есть — выберите его';

/**
 * Карточка «Счета из файла» (§5.4 спецификации импорта): название из файла (`h4`), число операций и движение,
 * поле «Счёт» — «Создать новый счёт» или активный счёт компании. Новый счёт — название, валюта, «Текущий остаток» или
 * «Стартовый баланс» и вычисленное значение под суммой; существующий — текущий остаток, «Остаток после импорта» и
 * перенос даты открытия. Черновик полей — в карточке; верное сопоставление уходит наверх (пересчёт через 300 мс).
 * Состояние карточки — по сопоставлению сервера (`mapping === null` — счёт не выбран, R4): пришло другое
 * сопоставление (свежая проверка после 409) — черновик берётся из него. Активный счёт с таким же названием есть —
 * «Создать новый счёт» недоступен.
 */
export function ImportAccountCard(props: {
  card: ImportPreviewAccount;
  /** Счета компании, включая архивные (подсказка «Есть счёт «…» в архиве»). */
  accounts: readonly Account[];
  baseCurrency: string;
  onChange: (key: string, mapping: AccountMapping | null, error: string | null) => void;
}) {
  const { card } = props;
  const [draft, setDraft] = useState<CardDraft>(() => draftFromCard(card, props.baseCurrency));
  const [amountError, setAmountError] = useState<string | null>(null);
  const [seen, setSeen] = useState(card.mapping);
  const titleId = useId();
  const hintId = useId();
  const active = props.accounts.filter((a) => !a.archivedAt);
  const chosen = props.accounts.find((a) => a.id === draft.choice) ?? null;
  const archived = props.accounts.find((a) => a.archivedAt && nameKey(a.name) === card.key);
  const parsed = mappingFromDraft(card.key, draft, chosen?.currency ?? null).mapping;

  // сервер прислал другое сопоставление, чем в черновике (свежая проверка после 409 или 422): черновик — из него.
  // Неверно введённая сумма остаётся как есть: её человек ещё правит, на сервер она не уходила
  if (seen !== card.mapping) {
    setSeen(card.mapping);
    const same = parsed === null ? card.mapping === null : sameMapping(parsed, card.mapping);
    if (!same && amountError === null) setDraft(draftFromCard(card, props.baseCurrency));
  }

  const update = (patch: Partial<CardDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    const account = props.accounts.find((a) => a.id === next.choice) ?? null;
    const { mapping, error } = mappingFromDraft(card.key, next, account?.currency ?? null);
    setAmountError(error);
    props.onChange(card.key, mapping, error);
  };

  const currency = draft.choice === NEW_ACCOUNT ? draft.currency : (chosen?.currency ?? card.currency ?? props.baseCurrency);
  const minorUnits = isKnownCurrency(currency) ? getCurrency(currency).minorUnits : 2;
  // ошибки сервера; «Выберите счёт» (A1) — у поля «Счёт»
  const pickError = card.errors.find((e) => e.code === 'A1' || e.code === 'A5')?.message;
  const otherErrors = card.errors.filter((e) => e.code !== 'A1' && e.code !== 'A5');
  // R4: активный счёт с таким же названием есть — новый не создать; подсказка, если выбран не он (текст гонки A1 — свой)
  const taken = active.find((a) => nameKey(a.name) === card.key);
  const createTaken = taken !== undefined;
  const ownChosen = chosen !== null && !chosen.archivedAt && nameKey(chosen.name) === card.key;
  const pickHint = createTaken && !pickError && !ownChosen ? CREATE_TAKEN_HINT : undefined;

  return (
    <article aria-labelledby={titleId} className="grid gap-3 rounded-xl border border-field p-3">
      <div>
        <h4 id={titleId} className="font-semibold [overflow-wrap:anywhere]">
          {card.fileName}
        </h4>
        <p className="text-sm text-muted">
          Операций: {formatCount(card.rows)}
          {card.currency && isKnownCurrency(card.currency) && ` · движение: ${signedMoney(card.movement, card.currency)}`}
        </p>
      </div>
      <ComboSelect
        label={`Счёт для «${card.fileName}»`}
        listLabel="Счета"
        value={draft.choice}
        // причина — и в имени недоступного пункта: её слышно в списке
        options={[
          { id: NEW_ACCOUNT, label: taken ? `Создать новый счёт — счёт «${taken.name}» уже есть` : 'Создать новый счёт', disabled: createTaken },
          ...accountOptions(active, null),
        ]}
        emptyLabel={null}
        error={pickError}
        hint={pickHint}
        onChange={(id) => update({ choice: id, target: '' })}
      />
      {draft.choice === NEW_ACCOUNT && archived && <p className="text-sm text-muted">Есть счёт «{archived.name}» в архиве</p>}

      {draft.choice === NEW_ACCOUNT && (
        <>
          <Field label="Название">
            {(c) => <input {...c} value={draft.name} maxLength={120} onChange={(e) => update({ name: e.target.value })} className={inputClass} />}
          </Field>
          <Field label="Валюта">
            {(c) => (
              <select {...c} value={draft.currency} onChange={(e) => update({ currency: e.target.value })} className={inputClass}>
                {CURRENCIES.map((x) => (
                  <option key={x.code} value={x.code}>
                    {x.code} — {x.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <div role="radiogroup" aria-label="Указать остаток" className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {(
              [
                ['current', 'Текущий остаток'],
                ['start', 'Стартовый баланс'],
              ] as const
            ).map(([mode, label]) => (
              <label key={mode} className="flex min-h-11 items-center gap-2">
                <input type="radio" name={`${titleId}-mode`} checked={draft.mode === mode} onChange={() => update({ mode })} className="size-4 accent-income" />
                {label}
              </label>
            ))}
          </div>
          <Field label={`${draft.mode === 'current' ? 'Текущий остаток' : 'Стартовый баланс'}, ${isKnownCurrency(draft.currency) ? getCurrency(draft.currency).symbol : draft.currency}`} error={amountError ?? undefined}>
            {(c) => (
              <input
                {...c}
                inputMode="decimal"
                aria-describedby={[c['aria-describedby'], hintId].filter(Boolean).join(' ')}
                value={draft.amount}
                placeholder={minorUnits > 0 ? '0,00' : '0'}
                onChange={(e) => update({ amount: e.target.value })}
                className={inputClass}
              />
            )}
          </Field>
          <p id={hintId} aria-live="polite" className="-mt-2 text-sm text-muted">
            {card.currency && isKnownCurrency(card.currency) && parsed?.kind === 'new' ? newAccountHint(parsed.balance, card.movement, card.currency) : ''}
          </p>
        </>
      )}

      {draft.choice !== null && draft.choice !== NEW_ACCOUNT && card.existing && card.currency && isKnownCurrency(card.currency) && (
        <>
          <p className="text-sm">Текущий остаток: {formatMoney(card.existing.balance, card.currency, MONEY_SCREEN_BEFORE)}</p>
          <Field label="Остаток после импорта (необязательно)" error={amountError ?? undefined}>
            {(c) => (
              <input
                {...c}
                inputMode="decimal"
                aria-describedby={[c['aria-describedby'], hintId].filter(Boolean).join(' ')}
                value={draft.target}
                onChange={(e) => update({ target: e.target.value })}
                className={inputClass}
              />
            )}
          </Field>
          <p id={hintId} aria-live="polite" className="-mt-2 text-sm text-muted">
            {existingAccountHint(parsed?.kind === 'existing' ? (parsed.targetBalance ?? null) : null, card.existing.balance, card.movement, card.currency)}
          </p>
          {card.existing.newOpenedAt && <p className="text-sm text-muted">Дата открытия будет перенесена на {formatDateRu(card.existing.newOpenedAt)}</p>}
        </>
      )}

      {otherErrors.length > 0 && (
        <ul className="text-sm text-expense-strong">
          {otherErrors.map((e) => (
            <li key={`${e.code}-${e.message}`}>{e.message}</li>
          ))}
        </ul>
      )}
    </article>
  );
}
