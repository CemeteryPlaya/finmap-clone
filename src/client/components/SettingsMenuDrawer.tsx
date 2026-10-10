import { useMutation } from '@tanstack/react-query';
import { useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../lib/api';
import { focusHeadingSoon, isPlainLeftClick, pathOf } from '../lib/focus-heading';
import { queryClient, useMe } from '../lib/query';
import { Drawer } from './Drawer';
import { GearIcon } from './icons';
import { headerIconClass } from './ui';

const itemClass = 'flex items-center justify-between gap-3 rounded-xl px-3 py-3 text-sm hover:bg-field';

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-4">
      <p className="mb-1 truncate px-3 text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
      {children}
    </div>
  );
}

/**
 * Шестерёнка в шапке и правая панель «Настройки» (§3.3 этапа 1.5): в шапке панели — имя и логин пользователя;
 * «Мой аккаунт» и «Моя компания: …» — ссылки в зону настроек; «Выйти» красным последним, без подтверждения.
 * companyId — компания для ссылок (на странице без компании — последняя открытая; нет компаний — ссылок нет);
 * companyName — только на странице компании (группа «Моя компания»).
 */
export function SettingsMenuButton({ companyId, companyName }: { companyId: number | null; companyName: string | null }) {
  const [open, setOpen] = useState(false);
  const navigated = useRef(false);
  const me = useMe();
  const navigate = useNavigate();
  const logout = useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      queryClient.clear();
      navigate('/login', { replace: true });
    },
  });
  // переход: фокус на <h1> новой страницы запускается здесь, до перехода (панель может исчезнуть вместе с шапкой
  // страницы без компании, и её close не наступит)
  const go = (e: MouseEvent, to: string) => {
    if (!isPlainLeftClick(e)) return; // новая вкладка и т. п.: панель и фокус остаются
    navigated.current = true;
    focusHeadingSoon(pathOf(to));
    setOpen(false);
  };
  const item = (to: string, label: string) => (
    <Link to={to} onClick={(e) => go(e, to)} className={itemClass}>
      <span>{label}</span>
      <span aria-hidden="true" className="text-muted">
        ›
      </span>
    </Link>
  );

  return (
    <>
      <button type="button" aria-label="Настройки" title="Настройки" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} className={headerIconClass}>
        <GearIcon />
      </button>
      <Drawer
        open={open}
        side="right"
        title={me.data?.user.name ?? 'Настройки'}
        subtitle={me.data?.user.login}
        onClose={() => setOpen(false)}
        afterClose={() => {
          const handled = navigated.current;
          navigated.current = false;
          return handled;
        }}
      >
        {companyId !== null && (
          <Group title="Мой аккаунт">
            {item(`/c/${companyId}/settings/profile`, 'Профиль')}
            {item(`/c/${companyId}/settings/companies`, 'Мои компании')}
          </Group>
        )}
        {companyId !== null && companyName !== null && (
          <Group title={`Моя компания: ${companyName}`}>
            {item(`/c/${companyId}/settings/users`, 'Пользователи')}
            {item(`/c/${companyId}/settings/counterparties`, 'Настройки компании')}
          </Group>
        )}
        <div className="border-t border-field pt-3">
          <button
            type="button"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
            className="w-full rounded-xl px-3 py-3 text-left text-sm font-semibold text-expense hover:bg-field disabled:opacity-50"
          >
            Выйти
          </button>
        </div>
      </Drawer>
    </>
  );
}
