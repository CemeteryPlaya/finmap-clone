import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { Company } from '../lib/queries';

export function CompanySwitcher({ current, companies }: { current: Company; companies: Company[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const active = companies.filter((c) => !c.archivedAt);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        aria-label="Сменить компанию"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-xs items-center gap-2 truncate rounded-xl bg-chrome-2 px-3 py-2 text-sm hover:bg-white/10"
      >
        <span className="truncate">{current.name}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div role="menu" className="absolute left-0 z-20 mt-2 w-72 rounded-2xl bg-card p-2 text-ink shadow-xl">
          {active.map((c) => (
            <button
              key={c.id}
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                navigate(`/c/${c.id}/log`);
              }}
              className={`block w-full truncate rounded-xl px-3 py-2 text-left text-sm hover:bg-field ${c.id === current.id ? 'font-semibold' : ''}`}
            >
              {c.name}
            </button>
          ))}
          <div className="my-1 border-t border-field" />
          <Link role="menuitem" to="/companies/new" onClick={() => setOpen(false)} className="block rounded-xl px-3 py-2 text-sm hover:bg-field">
            + Добавить компанию
          </Link>
          <Link
            role="menuitem"
            to={`/c/${current.id}/settings/companies`}
            onClick={() => setOpen(false)}
            className="block rounded-xl px-3 py-2 text-sm text-muted hover:bg-field"
          >
            Все компании
          </Link>
        </div>
      )}
    </div>
  );
}
