import { useEffect, type ReactNode } from 'react';
import { useMeta } from '../lib/query';
import { SettingsMenuButton } from './SettingsMenuDrawer';

/**
 * Шапка (§3.1, §8.1–8.2 этапа 1.5) — одна сетка на обе ширины.
 * Компьютер: слева — блок компании (на страницах без компании — название продукта), по центру — «+ Доход», «\u2212 Расход»,
 * «⇄ Перевод» (actions), справа — иконка «История действий» (tools) и шестерёнка «Настройки».
 * Телефон: ☰ «Счета» слева (menuButton, только на телефоне), название компании ▾ по центру, шестерёнка справа; кнопки
 * операций — второй строкой во всю ширину. Имени пользователя и «Выйти» в шапке нет — они в панели «Настройки».
 * Название продукта всегда в document.title. В PWA на iPhone шапка начинается ниже выреза экрана.
 */
export function AppHeader(props: {
  menuButton?: ReactNode;
  company?: ReactNode;
  actions?: ReactNode;
  tools?: ReactNode;
  menu: { companyId: number | null; companyName: string | null };
}) {
  const meta = useMeta();

  useEffect(() => {
    if (meta.data) document.title = meta.data.appName;
  }, [meta.data]);

  return (
    <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-3 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white md:grid-cols-[minmax(12rem,1fr)_auto_auto] md:gap-4 md:px-6 md:pb-4 md:pt-[max(1rem,env(safe-area-inset-top))] lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
      {props.menuButton && <div className="col-start-1 row-start-1 md:hidden">{props.menuButton}</div>}
      <div className="col-start-2 row-start-1 flex min-w-0 items-center justify-center md:col-start-1 md:justify-start">
        {props.company ?? <span className="truncate text-lg font-bold">{meta.data?.appName}</span>}
      </div>
      {props.actions ? (
        // телефон — второй строкой во всю ширину (§8.2); компьютер — средняя колонка
        <div className="col-span-full row-start-2 min-w-0 md:row-start-1 md:[grid-column:2]">{props.actions}</div>
      ) : (
        <span aria-hidden="true" className="hidden md:row-start-1 md:block md:[grid-column:2]" />
      )}
      <div className="col-start-3 row-start-1 flex shrink-0 items-center justify-end gap-2">
        {props.tools}
        <SettingsMenuButton companyId={props.menu.companyId} companyName={props.menu.companyName} />
      </div>
    </header>
  );
}
