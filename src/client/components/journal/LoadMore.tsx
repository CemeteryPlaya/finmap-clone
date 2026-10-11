import { useEffect, useRef } from 'react';
import { btnSecondary } from '../ui';

/**
 * Бесконечная прокрутка: когда низ списка подходит к экрану (запас 400 px), грузится следующая страница.
 * Наблюдатель пересоздаётся после каждой загрузки — если низ всё ещё виден, сразу грузится следующая.
 * После ошибки загрузки наблюдатель отключается (иначе запросы шли бы по кругу): продолжение — кнопкой.
 * Кнопка «Показать ещё» — и для клавиатуры, и на случай, если наблюдатель не сработал.
 */
export function LoadMore(props: { hasNext: boolean; loading: boolean; failed: boolean; onLoad: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const onLoad = useRef(props.onLoad);
  onLoad.current = props.onLoad;

  useEffect(() => {
    const el = ref.current;
    if (!el || !props.hasNext || props.loading || props.failed || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onLoad.current();
    }, { rootMargin: '400px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [props.hasNext, props.loading, props.failed]);

  if (!props.hasNext) return null;
  return (
    <div ref={ref} className="mt-4 flex flex-col items-center gap-2">
      {props.failed && !props.loading && (
        <p role="alert" className="text-sm text-expense-strong">
          Не удалось загрузить продолжение списка.
        </p>
      )}
      {/* aria-disabled, а не disabled: фокус клавиатуры не теряется, повторные нажатия игнорируются */}
      <button
        type="button"
        onClick={() => {
          if (!props.loading) props.onLoad();
        }}
        aria-disabled={props.loading}
        className={`${btnSecondary} ${props.loading ? 'cursor-wait opacity-60' : ''}`}
      >
        {props.loading ? 'Загрузка…' : 'Показать ещё'}
      </button>
    </div>
  );
}
