import { useState, type KeyboardEvent } from 'react';

/** Строка подсказки колонки: цвет ряда (класс фона), название, сумма. */
export interface TipLine {
  swatch: string;
  label: string;
  value: string;
}

/**
 * Колонки графика для мыши и клавиатуры (§4.2 спецификации «Аналитика»): прозрачные кнопки поверх области построения,
 * одна на колонку шага. Одна точка Tab: стрелки влево и вправо, Home и End двигают фокус; наведение и фокус показывают
 * подсказку (период и суммы), щелчок, Enter и пробел выбирают колонку — под графиками её операции (§2.5). Имя кнопки
 * содержит те же суммы, что подсказка: сама подсказка от программ чтения скрыта. Рисунок (SVG с role="img") — отдельно:
 * внутри изображения кнопок быть не может.
 */
export function ChartColumns(props: {
  label: string;
  count: number;
  left: number;
  top: number;
  width: number;
  height: number;
  names: readonly string[];
  tip: (index: number) => { title: string; lines: TipLine[] };
  selected: number | null;
  onSelect: (index: number) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  // точка Tab — колонка, где был фокус (если она ещё есть), иначе выбранная, иначе первая
  const [last, setLast] = useState<number | null>(null);
  const step = props.count > 0 ? props.width / props.count : 0;
  const stop = last !== null && last < props.count ? last : (props.selected ?? 0);
  const shown = hover ?? focus;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const from = focus ?? stop;
    const to = e.key === 'ArrowRight' ? from + 1 : e.key === 'ArrowLeft' ? from - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? props.count - 1 : null;
    if (to === null) return;
    e.preventDefault();
    if (to < 0 || to >= props.count) return;
    e.currentTarget.querySelector<HTMLElement>(`[data-chart-column="${to}"]`)?.focus();
  };

  const tip = shown === null ? null : props.tip(shown);
  // подсказка над колонкой, но не за краем графика
  const tipLeft = shown === null ? 0 : Math.min(Math.max((shown + 0.5) * step, 96), Math.max(96, props.width - 96));
  return (
    <div role="group" aria-label={props.label} onKeyDown={onKeyDown} onMouseLeave={() => setHover(null)} className="absolute" style={{ left: props.left, top: props.top, width: props.width, height: props.height }}>
      {Array.from({ length: props.count }, (_, i) => (
        <button
          key={i}
          type="button"
          data-chart-column={i}
          tabIndex={i === stop ? 0 : -1}
          aria-label={props.names[i]}
          aria-pressed={props.selected === i}
          onMouseEnter={() => setHover(i)}
          onFocus={() => {
            setFocus(i);
            setLast(i);
          }}
          onBlur={() => setFocus(null)}
          onClick={() => props.onSelect(i)}
          className="absolute top-0 h-full rounded-sm hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-focus aria-pressed:ring-1 aria-pressed:ring-income"
          style={{ left: i * step, width: step }}
        />
      ))}
      {tip && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-2 z-10 min-w-44 -translate-x-1/2 rounded-lg bg-card px-3 py-2 text-xs shadow-lg ring-1 ring-field"
          style={{ left: tipLeft }}
        >
          <p className="mb-1 font-semibold text-ink">{tip.title}</p>
          {tip.lines.map((l) => (
            <p key={l.label} className="flex items-center gap-2 whitespace-nowrap text-ink">
              <span className={`size-2.5 shrink-0 rounded-full ${l.swatch}`} />
              <span className="flex-1 text-muted">{l.label}</span>
              <span className="tabular-nums">{l.value}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
