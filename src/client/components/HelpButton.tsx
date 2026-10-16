import { Popover } from './Popover';

/**
 * «?» с пояснением (§2.1, §2.2, §4.1 спецификации «Аналитика»): круглая кнопка, по нажатию — всплывающий текст.
 * На телефоне вокруг кнопки 32 px невидимая область: нажимаемый размер 44 px.
 * Имя кнопки — «Подсказка: {о чём}»; Esc и щелчок мимо закрывают, фокус возвращается на кнопку.
 */
export function HelpButton(props: { about: string; text: string }) {
  return (
    <Popover
      label={<span aria-hidden="true">?</span>}
      ariaLabel={`Подсказка: ${props.about}`}
      panelLabel={props.about}
      align="right"
      buttonClassName="grid size-6 shrink-0 place-items-center rounded-full border border-muted/60 text-xs font-semibold text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-focus max-md:relative max-md:size-8 max-md:after:absolute max-md:after:-inset-[7px] max-md:after:content-['']"
      panelClassName="w-72 max-w-[calc(100vw-2rem)]"
    >
      {() => <p className="text-sm font-normal whitespace-normal">{props.text}</p>}
    </Popover>
  );
}
