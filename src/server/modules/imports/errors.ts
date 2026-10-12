import { AppError } from '../../errors';

/** Ошибки файла (§4.10 спецификации импорта): предпросмотра нет, панель показывает сообщение. */
export type FileErrorCode = 'F1' | 'F2' | 'F3' | 'F5' | 'F6' | 'F7' | 'F8' | 'F9';

/** 400 IMPORT_FILE; код F* — в `details.fileCode`. */
export function fileError(code: FileErrorCode, message: string): AppError {
  return new AppError(400, 'IMPORT_FILE', message, undefined, { fileCode: code });
}

/** F3: файл повреждён или небезопасен (ZIP, XML, пределы распаковки). */
export function damaged(reason: string): AppError {
  return fileError('F3', `Файл повреждён или небезопасен: ${reason}`);
}

/** Не больше строк данных в файле (§2.3) — столько же, сколько выгрузка журнала (JOURNAL_EXPORT_MAX). */
export const IMPORT_MAX_ROWS = 50_000;
/** Непустых строк, которые читатель листа ещё принимает: данные, заголовки и до 9 строк над ними (§2.2). */
export const IMPORT_READ_MAX_ROWS = IMPORT_MAX_ROWS + 10;

/** F5: больше 50 000 строк данных. */
export function tooManyRows(): AppError {
  return fileError('F5', 'В файле больше 50 000 строк — разбейте его по годам');
}

/** F9: разных счетов в «Со счета» и «На счет» больше IMPORT_ACCOUNTS_MAX — карточки и сопоставление не помещаются в ответ и запрос (§6.3). */
export function tooManyAccounts(): AppError {
  return fileError('F9', 'В файле больше 1 000 разных счетов в колонках «Со счета» и «На счет» — проверьте эти колонки');
}

/** Ошибки строк R* блокируют импорт; предупреждения W* — нет (§4.10). */
export type RowErrorCode = 'R01' | 'R02' | 'R03' | 'R04' | 'R05' | 'R06' | 'R07' | 'R08' | 'R09' | 'R10' | 'R11' | 'R12' | 'R13' | 'R14' | 'R15' | 'R16' | 'R17' | 'R18';
export type WarningCode = 'W1' | 'W2' | 'W3' | 'W4' | 'W5' | 'W6' | 'W7' | 'W8' | 'W9' | 'W10';
/** Ошибки счетов — в карточке счёта (§5.4). */
export type AccountErrorCode = 'A1' | 'A2' | 'A3' | 'A4' | 'A5';

/** Замечание к строке файла; row — номер строки Excel (у W8 — 0: замечание ко всему файлу). */
export interface RowIssue {
  code: RowErrorCode | WarningCode;
  message: string;
  row: number;
}

/** Группа замечаний в ответе: один код и текст, число строк и до 20 первых номеров (§4.10 «Объём ответа»). */
export interface IssueGroup {
  code: string;
  message: string;
  count: number;
  rows: number[];
}

export const ISSUE_ROWS_MAX = 20;
/** Не больше групп в ответе: тексты с значениями (R02, R16, R17) не раздувают ответ на большом файле. */
export const ISSUE_GROUPS_MAX = 100;

export const isRowError = (i: RowIssue) => i.code.startsWith('R');

/** Значение в тексте сообщения: не длиннее 50 символов. */
const clip = (v: string) => (v.length > 50 ? `${v.slice(0, 50)}…` : v);

/** Тексты ошибок и предупреждений (§4.10). */
export const MESSAGES = {
  R01: 'Нет даты платежа',
  R02: (v: string) => `Не удалось прочитать дату платежа «${clip(v)}»`,
  R03: 'Дата платежа раньше 1990 года',
  R04: 'Нет суммы',
  R05: (v: string) => `Не удалось прочитать сумму «${clip(v)}»`,
  R06: 'Сумма равна нулю',
  R06_TO: 'Сумма зачисления после пересчёта по курсу равна нулю — заполните «Сумму в валюте компании»',
  R07: 'Слишком большая сумма',
  R08: 'Не указан счёт: заполните «Со счета», «На счет» или обе колонки',
  R09: 'Счета перевода совпадают',
  R10: 'Отрицательная сумма у дохода',
  R11: (what: string, v: string) => `Не удалось прочитать ${what} «${clip(v)}»`,
  R11_PERIOD: 'Конец периода раньше начала',
  R12: 'Подкатегория без категории',
  R13: (what: string, max: number) => `${what} длиннее ${max} символов`,
  R14: 'Больше 20 тегов',
  R15: 'Комментарий длиннее 2 000 символов',
  R16: (currency: string, date: string) =>
    `Нет курса ${currency} на ${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)} — заполните «Сумму в валюте компании» или добавьте курс на дату`,
  R17: (what: string, name: string) => `${what} «${clip(name)}» в архиве — верните из архива`,
  R18_LONG: 'Ячейка длиннее 32 767 символов',
  R18_EXCEL: (v: string, column: string) => `Ошибка Excel ${clip(v)} в колонке «${column}»`,
  W1: 'Дата платежа в будущем — плановые операции появятся позже, строки пропущены',
  W2: 'У перевода нет категории и контрагента — они не перенесены',
  W3: 'У перевода нет даты начисления — она не перенесена',
  W4: 'Подконтрагент стал контрагентом',
  W5: 'Подпроект не переносится',
  W6: 'Есть и дата начисления, и период — взята дата начисления',
  W7: (title: string) => `Колонка «${clip(title)}» не распознана — пропущена`,
  W8: (when: string, user: string) => `Этот файл уже импортирован ${when} (${user}) — совпадение по SHA-256, импорт не отменён`,
  W9: 'У счёта в валюте компании «Сумма в валюте компании» отличается от суммы — взята сумма счёта',
  W10: (digits: number) => `Больше ${digits} знаков после запятой — сумма округлена`,
  A1: (name: string) => `Выберите счёт для «${clip(name)}» — подходит несколько`,
  A1_MISSING: (name: string) => `Выберите счёт для «${clip(name)}»`,
  A2: 'Неизвестная валюта',
  A3: 'Название счёта: от 1 до 120 символов',
  A4: 'Неверная сумма остатка',
  A4_OVERFLOW: 'Слишком большие суммы: остаток счёта после импорта вне допустимого диапазона',
  A4_TARGETS: 'Этот счёт выбран для нескольких названий с разными «Остатками после импорта» — оставьте одно значение',
  A5: (name: string) => `Счёт «${clip(name)}» в архиве — выберите другой`,
} as const;

/**
 * Замечания по группам «код + текст» в порядке первой строки: число разных строк и до 20 первых номеров.
 * Групп — не больше ISSUE_GROUPS_MAX; группы ошибок занимают места раньше предупреждений, поэтому не вытесняются ими.
 */
export function groupIssues(issues: RowIssue[]): IssueGroup[] {
  const sorted = [...issues].sort((a, b) => a.row - b.row);
  const groups = new Map<string, IssueGroup>();
  const seen = new Map<string, Set<number>>();
  const add = (i: RowIssue) => {
    const key = `${i.code}\u0000${i.message}`;
    let g = groups.get(key);
    if (!g) {
      g = { code: i.code, message: i.message, count: 0, rows: [] };
      groups.set(key, g);
      seen.set(key, new Set());
    }
    const rows = seen.get(key)!;
    if (rows.has(i.row)) return;
    rows.add(i.row);
    g.count++;
    if (i.row > 0 && g.rows.length < ISSUE_ROWS_MAX) g.rows.push(i.row);
  };
  const errorKeys = new Set<string>();
  const warningKeys = new Set<string>();
  const admitted = new Set<string>();
  for (const i of sorted.filter(isRowError)) {
    const key = `${i.code}\u0000${i.message}`;
    if (!errorKeys.has(key) && errorKeys.size < ISSUE_GROUPS_MAX) errorKeys.add(key);
    if (errorKeys.has(key)) admitted.add(key);
  }
  for (const i of sorted.filter((x) => !isRowError(x))) {
    const key = `${i.code}\u0000${i.message}`;
    if (!warningKeys.has(key) && errorKeys.size + warningKeys.size < ISSUE_GROUPS_MAX) warningKeys.add(key);
    if (warningKeys.has(key)) admitted.add(key);
  }
  for (const i of sorted) if (admitted.has(`${i.code}\u0000${i.message}`)) add(i);
  return [...groups.values()];
}
