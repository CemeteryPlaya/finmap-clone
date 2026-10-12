import { FINMAP_COLUMNS, type FinmapField } from '../../../shared/finmap-format';
import { buildXlsx, type XlsxCell, type XlsxSheet } from '../../http/xlsx';
import { excelDate } from '../operations/journal-export';

/** Шаблон импорта (§5.2 спецификации импорта): лист «Шаблон» — заголовки; «Инструкция» — примеры и правила. */
export const TEMPLATE_FILE_NAME = 'Шаблон импорта.xlsx';

/** Ширина колонок A–P. */
const WIDTH: Record<FinmapField, number> = {
  paidAt: 17,
  accrualDate: 16,
  periodFrom: 18,
  periodTo: 18,
  amount: 16,
  baseAmount: 16,
  fromAccount: 18,
  toAccount: 18,
  category: 20,
  subcategory: 20,
  counterparty: 22,
  subcounterparty: 20,
  project: 16,
  subproject: 16,
  tags: 16,
  comment: 30,
};

const COLUMNS = FINMAP_COLUMNS.map((c) => ({ header: c.header, width: WIDTH[c.field] }));

/** Строка A–P по полям; незаданные — пустые. */
function line(v: Partial<Record<FinmapField, XlsxCell>>): XlsxCell[] {
  return FINMAP_COLUMNS.map((c) => v[c.field] ?? null);
}
const text = (value: string): XlsxCell => ({ kind: 'text', value });
const at = (date: string, hours: number): XlsxCell => ({ kind: 'datetime', value: excelDate(date) + hours / 24 });
const money = (value: string): XlsxCell => ({ kind: 'number', value, decimals: 2 });

/** Правила §4 по-русски — под примерами, в колонке A. */
export const TEMPLATE_RULES: readonly string[] = [
  'Строки 2–4 — примеры: доход, расход и перевод. Этот лист не импортируется — заполняйте лист «Шаблон».',
  '1. Импортируется только первый лист. Строка заголовков — первая из строк 1–10, где есть «Дата платежа» и «Сумма в валюте счета».',
  '2. «Со счета» — для расхода, «На счет» — для дохода, обе колонки — перевод. Счёт, которого нет в компании, можно создать при импорте.',
  '3. Дата платежа — дата Excel или текст «дд.мм.гггг чч:мм». Строки с датой в будущем (плановые операции) пропускаются.',
  '4. Сумма в валюте счета — положительное число, копейки через точку или запятую; лишние знаки после запятой округляются.',
  '5. Сумма в валюте компании нужна счетам не в валюте компании; если пусто — берётся курс на дату платежа.',
  '6. Дата начисления или Период начисления (дата "с") — дата сделки; у перевода её нет.',
  '7. Новые категории, подкатегории, контрагенты, проекты и теги создаются автоматически. Теги — через запятую.',
  '8. Комментарий — до 2 000 символов.',
  '9. Если хоть одна строка с ошибкой, импорт не проходит: исправьте файл и загрузите его снова.',
];

/** Листы шаблона: «Шаблон» (только заголовки) и «Инструкция» (три примера и правила). */
export function templateSheets(): XlsxSheet[] {
  return [
    { name: 'Шаблон', columns: COLUMNS, rows: [] },
    {
      name: 'Инструкция',
      columns: COLUMNS,
      rows: [
        line({ paidAt: at('2026-10-05', 10), amount: money('15000.00'), toAccount: text('Касса'), category: text('Выручка'), counterparty: text('Клиент'), comment: text('Пример дохода') }),
        line({
          paidAt: at('2026-10-05', 12.5),
          accrualDate: { kind: 'date', value: excelDate('2026-10-01') },
          amount: money('8500.50'),
          fromAccount: text('Касса'),
          category: text('Зарплата'),
          subcategory: text('Администраторы'),
          counterparty: text('Сотрудник'),
          tags: text('Смена, Ночь'),
        }),
        line({ paidAt: at('2026-10-06', 9), amount: money('50000.00'), fromAccount: text('Касса'), toAccount: text('Банк'), comment: text('Инкассация') }),
        [],
        ...TEMPLATE_RULES.map((rule) => [text(rule)]),
      ],
    },
  ];
}

/** Книга шаблона: тексты — общими строками, как у выгрузки «Excel» (§8.2). */
export function buildTemplate(): Buffer {
  return buildXlsx(templateSheets(), { strings: 'shared' });
}
