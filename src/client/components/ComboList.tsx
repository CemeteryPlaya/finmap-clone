import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { initialActive, pickerItems, pickQuery, type PickerItem, type PickerOption } from '../lib/picker';
import { PickerListbox, pickerItemId } from './SearchPicker';
import { useFloating } from './useFloating';

export interface ComboListOptions {
  /** Название списка для программ чтения с экрана: «Категории». */
  listLabel: string;
  options: readonly PickerOption[];
  /** Выбранный пункт: активен при открытии, отмечен aria-selected. */
  selectedId: number | null;
  /** Текст поля при закрытом списке — название выбранного (у поля тегов — пусто). */
  text: string;
  onPick: (id: number) => void;
  /** «+ Создать»: с ним в списке есть пункт создания. */
  /** Вернувший обещание с `false` (создать не удалось) — поле снова открывается с набранным названием. */
  onCreate?: (name: string) => void | Promise<boolean>;
  /** Что создаёт «+ Создать»: «категорию». Обязательно вместе с onCreate. */
  createNoun?: string;
}

/** Атрибуты и обработчики `<input role="combobox">`. */
export interface ComboInputProps {
  ref: RefObject<HTMLInputElement | null>;
  role: 'combobox';
  'aria-expanded': boolean;
  /** Всегда id списка — и у свёрнутого (ARIA 1.2 это допускает). */
  'aria-controls': string;
  'aria-autocomplete': 'list';
  'aria-activedescendant': string | undefined;
  autoComplete: 'off';
  value: string;
  placeholder: string | undefined;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onClick: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onBlur: () => void;
}

export interface ComboList {
  open: boolean;
  inputProps: ComboInputProps;
  /** Рамка поля: от неё список получает место и ширину. */
  anchorRef: RefObject<HTMLDivElement | null>;
  /** Открытый список — порталом в окно (`<dialog>`, иначе он был бы недоступен) или в body; закрыт — null. */
  list: ReactNode;
}

/**
 * Поле со списком (§6.6, §11 этапа 1.5; ARIA 1.2 combobox): поле — само поле ввода. Печать открывает список
 * и фильтрует его (без учёта регистра и «ё»); ↓ и нажатие открывают; Enter выбирает активный пункт, а в закрытом
 * поле открывает список (форму не отправляет); Esc закрывает только список (окно клавишу не видит); Tab, нажатие
 * вне поля и списка и уход из поля закрывают список без смены значения; нажатие внутри открытого поля его не закрывает. При открытом списке поле пустое, выбранное — в подсказке поля:
 * печатают с чистого поля. Правка закрытого поля с выбранным значением начинает новый запрос (введённое, если всё название выделено, иначе разница с показанным названием). Активный пункт при открытии — выбранный, после печати — первый найденный.
 * «+ Создать категорию» без названия оставляет список открытым, фокус — в поле с подсказкой «Введите название».
 */
export function useComboList(o: ComboListOptions): ComboList {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [naming, setNaming] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const anchorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // всё ли название было выделено перед вводом (Tab в поле): тогда введённое — запрос целиком
  const allSelected = useRef(false);
  const style = useFloating(open, anchorRef, listRef, 'left', true);
  const noun = o.onCreate ? (o.createNoun ?? '') : undefined;
  const items = pickerItems(o.options, open ? query : '', noun);
  const current = open && items.length > 0 ? items[Math.min(active, items.length - 1)] : undefined;

  const show = () => {
    setOpen(true);
    setQuery('');
    setActive(initialActive(pickerItems(o.options, '', noun), o.selectedId));
  };
  const close = () => {
    setOpen(false);
    setQuery('');
    setNaming(false);
  };
  const search = (q: string) => {
    setOpen(true);
    setQuery(q);
    setActive(initialActive(pickerItems(o.options, q, noun), undefined));
  };
  const choose = (it: PickerItem) => {
    if (it.kind === 'create') {
      if (it.name === '') {
        setNaming(true);
        inputRef.current?.focus();
        return;
      }
      close();
      const name = it.name;
      const created = o.onCreate?.(name);
      // не удалось создать — набранное название остаётся в поле, чтобы его поправить
      if (created instanceof Promise) {
        void created.then((ok) => {
          if (ok === false) {
            search(name);
            inputRef.current?.focus();
          }
        });
      }
      return;
    }
    close();
    o.onPick(it.option.id);
  };

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const remember = () => {
      allSelected.current = input.value !== '' && input.selectionStart === 0 && input.selectionEnd === input.value.length;
    };
    input.addEventListener('beforeinput', remember);
    return () => input.removeEventListener('beforeinput', remember);
  });

  // нажатие мышью вне поля и списка закрывает список (уход фокуса закрывает его через onBlur)
  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => {
      const target = ev.target as Node;
      if (anchorRef.current?.contains(target) || listRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) show();
      else setActive((a) => (e.key === 'ArrowDown' ? Math.max(0, Math.min(a + 1, items.length - 1)) : Math.max(a - 1, 0)));
    } else if (e.key === 'Enter') {
      // Enter в поле списка не отправляет форму
      e.preventDefault();
      if (!open) show();
      else if (current) choose(current);
    } else if (e.key === 'Escape' && open) {
      // закрывается только список: preventDefault — `<dialog>` не закроется сам, stopPropagation — Modal не спросит
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab' && open) {
      close();
    }
  };

  const inputProps: ComboInputProps = {
    ref: inputRef,
    role: 'combobox',
    'aria-expanded': open,
    'aria-controls': listId,
    'aria-autocomplete': 'list',
    'aria-activedescendant': current ? pickerItemId(listId, current) : undefined,
    autoComplete: 'off',
    value: open ? query : o.text,
    placeholder: open ? (naming ? 'Введите название' : o.text || undefined) : undefined,
    onChange: (e) => {
      // закрытое поле с выбранным значением: запрос — правка относительно показанного названия, а не название со вставкой
      const ev = e.nativeEvent as InputEvent;
      search(!open && o.text !== '' ? pickQuery({ shown: o.text, next: e.target.value, data: ev.data ?? null, inputType: ev.inputType ?? '', selectedAll: allSelected.current }) : e.target.value);
    },
    // нажатие только открывает: нажатие внутри открытого поля (поставить курсор) не закрывает список и не сбрасывает набранное
    onClick: () => {
      if (!open) show();
    },
    onKeyDown,
    onBlur: close,
  };

  const list = open
    ? createPortal(
        <div
          ref={listRef}
          style={style}
          // щелчок по заголовку группы, пустому месту или полосе прокрутки не уводит фокус из поля
          onMouseDown={(e) => e.preventDefault()}
          className="z-40 overflow-y-auto rounded-2xl bg-card p-2 text-ink shadow-xl ring-1 ring-field"
        >
          <PickerListbox
            id={listId}
            label={o.listLabel}
            items={items}
            active={active}
            selectedId={o.selectedId}
            createNoun={o.createNoun}
            onChoose={choose}
            onHover={setActive}
          />
          {items.length === 0 && <p className="px-3 py-2 text-sm text-muted">Ничего не найдено</p>}
        </div>,
        anchorRef.current?.closest('dialog') ?? document.body,
      )
    : null;

  return { open, inputProps, anchorRef, list };
}
