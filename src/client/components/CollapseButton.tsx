/**
 * Круглая кнопка с рамкой на правой границе левой панели, на уровне вкладок (§3.6 этапа 1.5): «‹» свернуть,
 * «›» развернуть. Одна и та же кнопка в обоих состояниях — фокус не теряется; состояние передаёт подпись.
 * Родитель — `relative`.
 */
export function CollapseButton(props: { collapsed: boolean; onToggle: () => void; collapseLabel: string; expandLabel: string }) {
  const label = props.collapsed ? props.expandLabel : props.collapseLabel;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={props.onToggle}
      className="absolute -right-4 top-8 z-10 grid h-8 w-8 place-items-center rounded-full border border-field bg-card text-ink shadow hover:bg-field focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <span aria-hidden="true">{props.collapsed ? '›' : '‹'}</span>
    </button>
  );
}
