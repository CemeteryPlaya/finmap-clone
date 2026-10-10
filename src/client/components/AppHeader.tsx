import { useEffect, type ReactNode } from 'react';
import { useMeta } from '../lib/query';
import { SettingsMenuButton } from './SettingsMenuDrawer';

/**
 * Шапка (§3.1 этапа 1.5). Слева — блок компании (на телефоне перед ним «Счета»); на страницах без компании —
 * название продукта. По центру — «+ Доход», «\u2212 Расход», «⇄ Перевод» (только компьютер). Справа — иконки:
 * «История действий» (tools) и шестерёнка «Настройки». Имени пользователя и «Выйти» в шапке нет — они в панели
 * «Настройки». Название продукта всегда в document.title. В PWA на iPhone шапка начинается ниже выреза экрана.
 */
export function AppHeader(props: {
  left?: ReactNode;
  actions?: ReactNode;
  tools?: ReactNode;
  menu: { companyId: number | null; companyName: string | null };
}) {
  const meta = useMeta();

  useEffect(() => {
    if (meta.data) document.title = meta.data.appName;
  }, [meta.data]);

  return (
    <header className="flex items-center gap-3 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white md:grid md:grid-cols-[minmax(12rem,1fr)_auto_auto] lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-4 md:px-6 md:pb-4 md:pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-3">
        {props.left ?? <span className="truncate text-lg font-bold">{meta.data?.appName}</span>}
      </div>
      {props.actions ?? <span aria-hidden="true" className="hidden md:block" />}
      <div className="flex shrink-0 items-center justify-end gap-2">
        {props.tools}
        <SettingsMenuButton companyId={props.menu.companyId} companyName={props.menu.companyName} />
      </div>
    </header>
  );
}
