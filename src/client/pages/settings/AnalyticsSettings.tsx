import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { Pending } from '../../components/QueryState';
import { alertClass, btnSecondary, btnSmall, noticeClass } from '../../components/ui';
import { BUILT_CLUB_REPORTS, TILE_SOON, TILES_MAX, type SavedDashboards, type SavedTiles, type TileDef } from '../../../shared/analytics-catalog';
import { ANALYTICS_CARDS } from '../../lib/analytics';
import {
  moveCard,
  moveTile,
  resetAnalyticsSetting,
  saveAnalyticsSetting,
  toggleCard,
  toggleGroup,
  toggleTile,
  useAnalyticsSettings,
  visibleTileCount,
  type AnalyticsSettingKey,
  type AnalyticsSettingsView,
} from '../../lib/analytics-settings';
import { ApiError } from '../../lib/api';
import { queryClient } from '../../lib/query';
import type { CompanyOutletContext } from '../CompanyLayout';

const rowClass = 'flex items-center gap-3 border-b border-field py-2.5 text-sm';
const arrowClass = `${btnSmall} px-2 aria-disabled:opacity-40`;

/** Пометка плитки, отчёт которой ещё не построен (§15 спецификации «Аналитика клуба»). */
export function tileSoon(t: TileDef): string | null {
  return BUILT_CLUB_REPORTS.has(t.report) ? null : TILE_SOON[t.report as keyof typeof TILE_SOON];
}

const message = (e: unknown) => (e instanceof ApiError ? e.message : 'Ошибка сервера');

/**
 * «Настройки → Аналитика» (спецификация «Аналитика клуба», §10): какие группы и карточки показывать на главной
 * «Аналитики» и в каком порядке, какие плитки — в «Обзоре». Сохраняется сразу; настройки общие для компании.
 */
export function AnalyticsSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const settings = useAnalyticsSettings(company.id);
  const [error, setError] = useState<string | null>(null);
  if (!settings.data) return <Pending queries={[settings]} />;
  const view = settings.data;
  const readOnly = company.archivedAt !== null;

  /** Оптимистично: экран меняется сразу; при ошибке — правда с сервера и сообщение. */
  const save = async (key: AnalyticsSettingKey, next: SavedDashboards | SavedTiles) => {
    setError(null);
    queryClient.setQueryData<AnalyticsSettingsView>(['analytics-settings', company.id], optimistic(view, key, next));
    try {
      await saveAnalyticsSetting(company.id, key, next);
    } catch (e) {
      setError(message(e));
      await queryClient.invalidateQueries({ queryKey: ['analytics-settings', company.id] });
    }
  };
  const reset = (key: AnalyticsSettingKey) => {
    setError(null);
    resetAnalyticsSetting(company.id, key).catch((e: unknown) => setError(message(e)));
  };
  const groupTitle = (key: string) => view.groups.find((g) => g.key === key)?.title ?? key;

  return (
    <section>
      <h1 className="mb-2 text-2xl font-bold">Аналитика</h1>
      <p className="mb-6 text-sm text-muted">Что показывать в «Аналитике». Настройки общие для всех пользователей компании. Скрытый отчёт по-прежнему открывается по ссылке.</p>
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      {error && (
        <p role="alert" className={alertClass}>
          {error}
        </p>
      )}
      <DashboardsBlock view={view} groupTitle={groupTitle} readOnly={readOnly} onChange={(d) => void save('dashboards', d)} onReset={() => reset('dashboards')} />
      {Object.entries(view.tiles).map(([template, tiles]) => (
        <TilesBlock
          key={template}
          title={groupTitle(template)}
          tiles={tiles}
          catalog={view.catalog[template]?.tiles ?? []}
          readOnly={readOnly}
          onChange={(next) => void save(`tiles.${template}`, next)}
          onReset={() => reset(`tiles.${template}`)}
        />
      ))}
    </section>
  );
}

/** Состояние экрана сразу после правки, до ответа сервера. */
function optimistic(view: AnalyticsSettingsView, key: AnalyticsSettingKey, next: SavedDashboards | SavedTiles): AnalyticsSettingsView {
  if (key === 'dashboards') return { ...view, dashboards: next as SavedDashboards };
  return { ...view, tiles: { ...view.tiles, [key.slice('tiles.'.length)]: next as SavedTiles } };
}

/** «Выше» и «Ниже» строки списка; у края кнопка недоступна. */
function Arrows(props: { label: string; index: number; count: number; onMove: (dir: -1 | 1) => void }) {
  const first = props.index === 0;
  const last = props.index === props.count - 1;
  return (
    <>
      <button type="button" className={arrowClass} aria-label={`Выше: ${props.label}`} aria-disabled={first} onClick={() => !first && props.onMove(-1)}>
        ↑
      </button>
      <button type="button" className={arrowClass} aria-label={`Ниже: ${props.label}`} aria-disabled={last} onClick={() => !last && props.onMove(1)}>
        ↓
      </button>
    </>
  );
}

/** Группы и карточки главной «Аналитики» (§10.1). */
function DashboardsBlock(props: { view: AnalyticsSettingsView; groupTitle: (key: string) => string; readOnly: boolean; onChange: (d: SavedDashboards) => void; onReset: () => void }) {
  const { view } = props;
  const cardTitle = (group: string, key: string) =>
    (group === 'finance' ? ANALYTICS_CARDS.find((c) => c.key === key)?.title : view.catalog[group]?.dashboards.find((c) => c.key === key)?.title) ?? key;
  return (
    <fieldset disabled={props.readOnly} className="max-w-xl">
      <legend className="mb-3 text-lg font-bold">Дашборды</legend>
      {view.dashboards.groups.map((g) => (
        <div key={g.key} className="mb-5">
          <label className="flex items-center gap-3 py-2 font-semibold">
            <input type="checkbox" checked={g.visible} onChange={() => props.onChange(toggleGroup(view.dashboards, g.key))} />
            {props.groupTitle(g.key)}
          </label>
          <ul aria-label={`Карточки: ${props.groupTitle(g.key)}`} className={g.visible ? '' : 'opacity-60'}>
            {g.cards.map((c, i) => (
              <li key={c.key} className={rowClass}>
                <label className="flex flex-1 items-center gap-3">
                  <input type="checkbox" checked={c.visible} onChange={() => props.onChange(toggleCard(view.dashboards, g.key, c.key))} />
                  {cardTitle(g.key, c.key)}
                </label>
                <Arrows label={cardTitle(g.key, c.key)} index={i} count={g.cards.length} onMove={(dir) => props.onChange(moveCard(view.dashboards, g.key, c.key, dir))} />
              </li>
            ))}
          </ul>
        </div>
      ))}
      <button type="button" className={btnSecondary} onClick={props.onReset}>
        Вернуть как было
      </button>
    </fieldset>
  );
}

/** Плитки «Обзора» шаблона (§10.2): не больше 12 видимых, предпросмотр справа на компьютере. */
function TilesBlock(props: { title: string; tiles: SavedTiles; catalog: readonly TileDef[]; readOnly: boolean; onChange: (t: SavedTiles) => void; onReset: () => void }) {
  const def = (key: string) => props.catalog.find((t) => t.key === key);
  const count = visibleTileCount(props.tiles);
  const shown = props.tiles.items.filter((i) => i.visible).map((i) => def(i.key)?.label ?? i.key);
  return (
    <fieldset disabled={props.readOnly} className="mt-8">
      <legend className="mb-1 text-lg font-bold">Плитки «Обзора» — {props.title}</legend>
      <div className="grid gap-6 md:grid-cols-[minmax(0,36rem)_1fr]">
        <div>
          <p className="mb-3 text-sm text-muted" aria-live="polite">
            {count} из {TILES_MAX}
          </p>
          <ul aria-label="Плитки">
            {props.tiles.items.map((item, i) => (
              <TileRow key={item.key} item={item} tile={def(item.key)} full={!item.visible && count >= TILES_MAX} onToggle={() => props.onChange(toggleTile(props.tiles, item.key))}>
                <Arrows label={def(item.key)?.label ?? item.key} index={i} count={props.tiles.items.length} onMove={(dir) => props.onChange(moveTile(props.tiles, item.key, dir))} />
              </TileRow>
            ))}
          </ul>
          <button type="button" className={`${btnSecondary} mt-4`} onClick={props.onReset}>
            Вернуть как было
          </button>
        </div>
        {/* предпросмотр «Обзора» — на компьютере справа (§10.2) */}
        <div aria-hidden="true" className="max-md:hidden">
          <p className="mb-2 text-sm text-muted">Так будет в «Обзоре»</p>
          <div className="grid grid-cols-2 gap-2">
            {shown.map((label) => (
              <div key={label} className="rounded-xl bg-field px-3 py-4 text-sm">
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </fieldset>
  );
}

/** Строка плитки: при 12 видимых невидимую включить нельзя (флажок aria-disabled). */
function TileRow(props: { item: { key: string; visible: boolean }; tile: TileDef | undefined; full: boolean; onToggle: () => void; children: React.ReactNode }) {
  const soon = props.tile ? tileSoon(props.tile) : null;
  return (
    <li className={rowClass}>
      <label className="flex flex-1 items-center gap-3">
        <input type="checkbox" checked={props.item.visible} aria-disabled={props.full} onChange={() => !props.full && props.onToggle()} />
        <span>
          {props.tile?.label ?? props.item.key}
          {soon && <span className="block text-xs text-muted">{soon}</span>}
        </span>
      </label>
      {props.children}
    </li>
  );
}
