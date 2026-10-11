import { useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import { formatMoney, MONEY_SCREEN_BEFORE } from '../../../shared/money';
import { CompanyAvatar } from '../../components/CompaniesDrawer';
import { CompanyEditDialog } from '../../components/CompanyEditDialog';
import { PencilIcon } from '../../components/icons';
import { Pending, StaleNotice } from '../../components/QueryState';
import { btnPrimary } from '../../components/ui';
import { useCompanies, useCompaniesSummary, type Company, type CompanyTotal } from '../../lib/queries';
import type { CompanyOutletContext } from '../CompanyLayout';

/**
 * «Мои компании» (§7.4 этапа 1.5): «Добавить компанию» слева вверху; карточки только для чтения — аватар, название,
 * «Баланс на счетах», базовая валюта и ✎ (окно «Компания» с «В архив» / «Вернуть из архива»). Архивные — ниже.
 */
export function CompaniesSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const companies = useCompanies();
  const summary = useCompaniesSummary(true);
  const [editingId, setEditingId] = useState<number | null>(null);

  if (!companies.data) return <Pending queries={[companies]} />;
  const totals = new Map((summary.data ?? []).map((s) => [s.id, s.total]));
  const active = companies.data.filter((c) => !c.archivedAt);
  const archived = companies.data.filter((c) => c.archivedAt);
  const card = (c: Company) => <CompanyCard key={c.id} company={c} total={totals.get(c.id)} onEdit={() => setEditingId(c.id)} />;

  return (
    <section>
      <StaleNotice queries={[companies]} />
      <h1 className="mb-4 text-2xl font-bold">Мои компании</h1>
      <Link to="/companies/new" className={`${btnPrimary} mb-6 inline-block`}>
        Добавить компанию
      </Link>
      <ul aria-label="Компании" className="grid gap-3">
        {active.map(card)}
      </ul>
      {archived.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 text-lg font-semibold">В архиве</h2>
          <ul aria-label="Компании в архиве" className="grid gap-3">
            {archived.map(card)}
          </ul>
        </>
      )}
      <CompanyEditDialog company={companies.data.find((c) => c.id === editingId) ?? null} currentId={company.id} onClose={() => setEditingId(null)} />
    </section>
  );
}

function CompanyCard({ company, total, onEdit }: { company: Company; total: CompanyTotal | undefined; onEdit: () => void }) {
  return (
    <li className={`flex flex-wrap items-center gap-4 rounded-2xl bg-field/60 px-5 py-4 ${company.archivedAt ? 'opacity-70' : ''}`}>
      <CompanyAvatar name={company.name} className="grid h-10 w-10 text-sm" />
      <dl className="grid min-w-0 flex-1 gap-x-8 gap-y-2 sm:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-xs text-muted">Компания</dt>
          <dd className="truncate font-semibold">{company.name}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Баланс на счетах</dt>
          <dd className="font-semibold tabular-nums">
            {total ? formatMoney(total.amount, total.currency, MONEY_SCREEN_BEFORE) : '—'}
            {total && total.unavailable.length > 0 && <span className="ml-1 text-xs font-normal text-muted">без {total.unavailable.join(', ')}</span>}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Базовая валюта</dt>
          <dd className="font-semibold">{company.baseCurrency}</dd>
        </div>
      </dl>
      <button
        type="button"
        aria-label={`Изменить компанию «${company.name}»`}
        title="Изменить"
        onClick={onEdit}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-card hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
      >
        <PencilIcon />
      </button>
    </li>
  );
}
