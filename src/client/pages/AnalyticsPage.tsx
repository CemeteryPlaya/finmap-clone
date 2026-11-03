import { Link, useOutletContext } from 'react-router';
import { HelpButton } from '../components/HelpButton';
import { ANALYTICS_CARDS, analyticsGroups, useClubScope, type AnalyticsCard, type CardGroup, type CardIcon } from '../lib/analytics';
import { useAnalyticsSettings } from '../lib/analytics-settings';
import type { CompanyOutletContext } from './CompanyLayout';

/** Рисунок карточки 24 px; имя даёт заголовок карточки. */
function Icon({ name }: { name: CardIcon }) {
  const paths: Record<CardIcon, string> = {
    wallet: 'M3 7a2 2 0 0 1 2-2h12v4M3 7v10a2 2 0 0 0 2 2h14V9H5a2 2 0 0 1-2-2zM16 14h.01',
    profit: 'M3 17l6-6 4 4 8-8M15 7h6v6',
    statement: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7',
    projects: 'M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6',
    indicators: 'M4 20h16M7 16v-5M12 16V6M17 16v-8M5 9l5-4 4 3 5-4',
    history: 'M3 12a9 9 0 1 0 3-6.7M3 3v6h6M12 7v5l3 2',
    plan: 'M4 19V9M10 19V5M16 19v-7M22 19H2',
    in: 'M10 17l5-5-5-5M15 12H3M21 4v16',
    out: 'M14 7l-5 5 5 5M9 12h12M3 4v16',
    scale: 'M12 3v18M5 7h14M5 7l-3 7h6zM19 7l-3 7h6zM8 21h8',
    gauge: 'M4 18a8 8 0 1 1 16 0M12 18l4-6M8 8l.01 0M16 8l.01 0M6 13l.01 0',
    coins: 'M8 6c0-1.1 1.8-2 4-2s4 .9 4 2-1.8 2-4 2-4-.9-4-2zM8 6v4c0 1.1 1.8 2 4 2s4-.9 4-2V6M4 12c0-1.1 1.8-2 4-2M4 12v4c0 1.1 1.8 2 4 2s4-.9 4-2M12 16v-2',
  };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name]} />
    </svg>
  );
}

/** Карточка-ссылка на отчёт; неактивная — пунктир и подпись, ссылки нет. «?» — подсказка поверх карточки (вне ссылки). */
function Card({ card, companyId }: { card: AnalyticsCard; companyId: number }) {
  const body = (
    <>
      {/* у неактивной карточки приглушены рисунок и рамка, а не текст: подпись остаётся читаемой (AA) */}
      <span className={`mb-4 block text-ink ${card.href ? '' : 'opacity-50'}`}>
        <Icon name={card.icon} />
      </span>
      <span className="block text-base font-bold text-ink">{card.title}</span>
      <span className="mt-1 block text-sm text-muted">{card.inactive ?? card.description}</span>
    </>
  );
  return (
    <li className={`relative min-h-40 rounded-2xl bg-card ${card.href ? 'shadow-sm ring-1 ring-field' : 'border border-dashed border-muted/40'}`}>
      {card.href ? (
        <Link
          to={card.href(companyId)}
          className="block h-full rounded-2xl p-6 pr-12 hover:bg-field/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {body}
        </Link>
      ) : (
        <div className="h-full p-6 pr-12">{body}</div>
      )}
      <div className="absolute top-4 right-4">
        <HelpButton about={card.title} text={card.help} />
      </div>
    </li>
  );
}

/**
 * Раздел «Аналитика» (§2.1 спецификации «Аналитика»; спецификация «Аналитика клуба», §2.1, §10.1): группы карточек по
 * настройкам компании — финансовая и группы шаблонов проектов; сетка 3 в ряд на компьютере, 1 на телефоне. Пока
 * настройки не пришли (или не пришли вовсе) — финансовые карточки по умолчанию.
 */
export function AnalyticsPage() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const settings = useAnalyticsSettings(company.id);
  const hasClub = (settings.data?.groups.length ?? 0) > 1;
  const scope = useClubScope(company.id, hasClub);
  const groups: CardGroup[] = settings.data ? analyticsGroups(settings.data, scope.data ?? null) : [{ key: 'finance', title: null, cards: [...ANALYTICS_CARDS] }];
  return (
    <section key={company.id}>
      {/* заголовок дублировал бы вкладку «Аналитика»: виден только программам чтения, на него встаёт фокус после перехода */}
      <h1 tabIndex={-1} className="sr-only">
        Аналитика
      </h1>
      {groups.map((g) => (
        <div key={g.key} className="mb-8">
          {g.title && <h2 className="mb-4 text-lg font-bold">{g.title}</h2>}
          <ul aria-label={g.title ?? 'Отчёты'} className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {g.cards.map((card) => (
              <Card key={card.key} card={card} companyId={company.id} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
