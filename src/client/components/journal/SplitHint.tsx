import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFloating } from '../useFloating';

/**
 * Подпись разбитой операции («2 проекта») с подсказкой по строкам (WCAG 1.4.13): видна при наведении
 * и при фокусе с клавиатуры, на неё можно навести указатель, Esc её прячет. Подсказка рисуется порталом
 * (position: fixed) — обёртка таблицы с прокруткой её не обрезает. Программа чтения с экрана получает
 * текст строк как описание (aria-describedby на скрытый элемент).
 */
export function SplitHint({ label, lines }: { label: string; lines: string[] }) {
  const id = useId();
  const [show, setShow] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const style = useFloating(show, anchorRef, tipRef);

  const open = () => {
    window.clearTimeout(hideTimer.current);
    setShow(true);
  };
  // небольшая задержка: указатель успевает перейти с подписи на подсказку
  const closeSoon = () => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setShow(false), 150);
  };
  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  return (
    <>
      <span
        ref={anchorRef}
        tabIndex={0}
        aria-describedby={id}
        onMouseEnter={open}
        onMouseLeave={closeSoon}
        onFocus={open}
        onBlur={() => setShow(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && show) {
            e.stopPropagation();
            setShow(false);
          }
        }}
        className="cursor-help rounded underline decoration-dotted underline-offset-4 outline-none focus:ring-2 focus:ring-focus"
      >
        {label}
      </span>
      <span id={id} hidden>
        {lines.join('; ')}
      </span>
      {show &&
        createPortal(
          <span
            ref={tipRef}
            role="tooltip"
            style={style}
            onMouseEnter={open}
            onMouseLeave={closeSoon}
            className="z-40 w-max max-w-xs rounded-xl bg-ink px-3 py-2 text-xs text-white shadow-lg"
          >
            {lines.map((line, i) => (
              <span key={i} className="block">
                {line}
              </span>
            ))}
          </span>,
          document.body,
        )}
    </>
  );
}
