import { Link } from 'react-router';
import { BankIcon, InfoIcon } from './icons';

export interface SubmenuItem<K extends string> {
  key: K;
  label: string;
  /** «банк» — системное, «i» — своё (как в Finmap). */
  icon: 'bank' | 'info';
  /** Счётчик у пункта (наш). */
  count?: number;
}

/**
 * Подменю раздела слева в карточке (§7.2, §7.3 этапа 1.5): вертикальный список ссылок, выбор — параметр адреса
 * (`?type=`, `?tab=`), текущий — `aria-current="page"`. На телефоне — строкой с переносом.
 */
export function SettingsSubmenu<K extends string>(props: { label: string; param: string; current: K; items: readonly SubmenuItem<K>[] }) {
  return (
    <nav aria-label={props.label} className="flex flex-wrap gap-1 self-start md:grid md:gap-0.5 md:border-r md:border-field md:pr-4">
      {props.items.map((item) => {
        const active = item.key === props.current;
        return (
          <Link
            key={item.key}
            to={{ search: `?${props.param}=${item.key}` }}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm ${active ? 'bg-field font-semibold text-ink' : 'text-ink hover:bg-field/60'}`}
          >
            <span className="min-w-0">
              {item.label}
              {item.count !== undefined && (
                <span className="ml-1.5 font-normal text-muted">
                  <span className="sr-only">, </span>
                  {item.count}
                </span>
              )}
            </span>
            <span aria-hidden="true" className="shrink-0 text-muted">
              {item.icon === 'bank' ? <BankIcon /> : <InfoIcon />}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
