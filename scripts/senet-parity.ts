/**
 * Сверка разноски с эталоном владельца (спецификация 2026-11-02-senet-autopost, §12.3) — только на машине владельца.
 * Берёт xlsx из .superpowers/senet-local/senet_raw/, вызывает функции эталона senet_to_finmap.py (его CLI не работает на
 * новом pandas) и модуль разноски, сравнивает операции по ключу «время, счёт, категория, контрагент, сумма, комментарий»
 * и проверяет остаток кассы после каждой смены. Настоящие данные никуда не пишутся и в репозиторий не попадают.
 *
 * Запуск: npx tsx scripts/senet-parity.ts [--since 2026-10-08] [--until 2026-11-01] [--offset 88]
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { zoneOffsetMs } from '../src/shared/dates';
import { planShift } from '../src/server/modules/senet/posting/plan';
import { buildRuleSet, type MatchMode, type RuleRow, type RuleType } from '../src/server/modules/senet/posting/rules';
import { shiftWindows } from '../src/server/modules/senet/posting/windows';
import { parseReport } from '../src/server/modules/senet/xlsx-reports';

export const LOCAL_DIR = path.resolve('.superpowers/senet-local');
const TZ = 'Asia/Almaty';

interface Reference {
  ops: { when: string; amount: number; src: string | null; dst: string | null; category: string; counterparty: string | null; comment: string | null; review: boolean; shift: string }[];
  consts: {
    CASH: string;
    KASPI: string;
    SHIFT_INCOME: string;
    EMPLOYEES: Record<string, string>;
    TRAINEE_WORDS: string[];
    EXTRA_PAY_WORDS: string[];
    ISLAM_WORDS: string[];
    OWNER_FAMILY_WORDS: string[];
    DIVIDEND_ISLAM: string;
    DIVIDEND_DEFAULT: string;
    SANAT_WORDS: string[];
    BAR_SUPPLIERS: [string[], string][];
    BAR_DEFAULT_SUPPLIER: string;
    BAR_WORDS: string[];
    OTHER_RULES: [string, string, string | null, string | null][];
  };
}

const SHIM = `
import sys, json
sys.path.insert(0, sys.argv[1])
import pandas as pd, senet_to_finmap as m
raw = sys.argv[2]
s = m.read_sessions(raw + '/cashdesk_session.xlsx'); c = m.read_cash_ops(raw + '/income_outcome.xlsx')
since, until = pd.Timestamp(sys.argv[3]), pd.Timestamp(sys.argv[4])
s = s[s['end'] <= until]
ops = []
for sh in m.build_shifts(s, c):
    if sh.start < since: continue
    for o in m.shift_to_ops(sh):
        ops.append(dict(when=o.when.strftime('%Y-%m-%d %H:%M:%S'), amount=float(o.amount), src=o.src, dst=o.dst, category=o.category,
                        counterparty=o.counterparty, comment=o.comment, review=bool(o.needs_review), shift=o.shift))
names = ['CASH','KASPI','SHIFT_INCOME','EMPLOYEES','TRAINEE_WORDS','EXTRA_PAY_WORDS','ISLAM_WORDS','OWNER_FAMILY_WORDS','DIVIDEND_ISLAM',
         'DIVIDEND_DEFAULT','SANAT_WORDS','BAR_SUPPLIERS','BAR_DEFAULT_SUPPLIER','BAR_WORDS','OTHER_RULES']
print(json.dumps(dict(ops=ops, consts={n: getattr(m, n) for n in names}), ensure_ascii=False, default=list))
`;

function runReference(since: string, until: string): Reference {
  const res = spawnSync('python', ['-c', SHIM, LOCAL_DIR, path.join(LOCAL_DIR, 'senet_raw'), since, until], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`эталон не запустился: ${res.stderr || res.error?.message}`);
  return JSON.parse(res.stdout) as Reference;
}

/** Регэксп эталона из OTHER_RULES → слова и вид совпадения: ^(a|b)$ — фраза, ^(a|b)\\b — первое слово, ^(…) — начало, иначе — подстрока. */
function fromRegex(rx: string): { words: string[]; match: MatchMode } {
  const anchored = rx.startsWith('^');
  const match: MatchMode = !anchored ? 'contains' : rx.endsWith('$') ? 'phrase' : rx.endsWith('\\b') ? 'first' : 'prefix';
  const body = rx.replace(/^\^/, '').replace(/\$$|\\b$/, '').replace(/^\(|\)$/g, '');
  return { words: body.split('|'), match };
}

/** Настройки эталона → правила модуля с выдуманными id (категории и контрагенты — по именам). */
function rulesFrom(k: Reference['consts']) {
  const ids = new Map<string, number>();
  const idOf = (name: string) => ids.get(name) ?? (ids.set(name, ids.size + 1), ids.size);
  let n = 0;
  const rows: RuleRow[] = [];
  const add = (type: RuleType, pattern: string, match: MatchMode, o: Partial<RuleRow> = {}) =>
    rows.push({ id: ++n, officeId: null, type, pattern, match, priority: n, categoryId: null, counterpartyId: null, commentTemplate: null, flags: {}, archived: false, ...o });
  for (const w of ['kaspi', 'каспи']) add('kaspi', w, 'phrase');
  add('salary_word', '', 'word', { categoryId: idOf('cat:Зарплата') });
  for (const w of ['zp', 'зп']) add('salary_word', w, 'word');
  for (const w of ['зарплата', 'аванс']) add('salary_word', w, 'first');
  for (const w of k.EXTRA_PAY_WORDS) add('extra_pay_word', w, 'word');
  for (const w of k.TRAINEE_WORDS) add('trainee', w, 'contains');
  for (const [alias, name] of Object.entries(k.EMPLOYEES)) add('employee_alias', alias, 'word', { counterpartyId: idOf(`cp:${name}`), flags: { mistaken: k.ISLAM_WORDS.includes(alias) } });
  for (const w of k.SANAT_WORDS) add('master', w, 'word', { categoryId: idOf('cat:Строительство и ремонт'), counterpartyId: idOf('cp:Санат') });
  add('owner_word', '', 'word', { categoryId: idOf('cat:Дивиденды'), counterpartyId: idOf(`cp:${k.DIVIDEND_DEFAULT}`) });
  for (const w of k.OWNER_FAMILY_WORDS.filter((x) => !k.ISLAM_WORDS.includes(x))) add('owner_word', w, 'word');
  add('owner_a_alias', '', 'word', { counterpartyId: idOf(`cp:${k.DIVIDEND_ISLAM}`) });
  for (const w of k.ISLAM_WORDS) add('owner_a_alias', w, 'word');
  for (const [rx, category, cp, comment] of k.OTHER_RULES) {
    const { words, match } = fromRegex(rx);
    if (category === 'Обед') {
      add('lunch', '', 'word', { categoryId: idOf(`cat:${category}`) });
      for (const w of words) add('lunch', w, match);
    } else for (const w of words) add('keyword', w, match, { categoryId: idOf(`cat:${category}`), counterpartyId: cp ? idOf(`cp:${cp}`) : null, commentTemplate: comment });
  }
  add('bar_item', '', 'contains', { categoryId: idOf('cat:Бар') });
  for (const w of k.BAR_WORDS) add('bar_item', w, 'contains', { flags: { defect: w === 'brak' || w === 'брак' } });
  add('bar_supplier', '', 'contains', { counterpartyId: idOf(`cp:${k.BAR_DEFAULT_SUPPLIER}`) });
  for (const [keys, cp] of k.BAR_SUPPLIERS) for (const w of keys) add('bar_supplier', w, 'contains', { counterpartyId: idOf(`cp:${cp}`) });
  const all = new Set(ids.values());
  const nameOf = (id: number) => {
    const name = [...ids].find(([, v]) => v === id)?.[0] ?? '';
    return name.slice(name.indexOf(':') + 1);
  };
  return { rules: buildRuleSet(rows, 1, { categories: all, counterparties: all }), idOf, nameOf };
}

const local = (iso: string) => {
  const t = Date.parse(iso);
  return new Date(t + zoneOffsetMs(t, TZ)).toISOString().slice(0, 19).replace('T', ' ');
};

export interface ParityResult {
  shifts: number;
  matched: number;
  reference: number;
  ours: number;
  onlyReference: string[];
  onlyOurs: string[];
  reviews: { reference: number; ours: number };
  balanceMismatches: string[];
}

export function runParity(o: { since: string; until: string; offset: number }): ParityResult {
  const ref = runReference(o.since, o.until);
  const { rules, idOf, nameOf } = rulesFrom(ref.consts);
  const raw = path.join(LOCAL_DIR, 'senet_raw');
  const sessions = parseReport('sessions', fs.readFileSync(path.join(raw, 'cashdesk_session.xlsx')), TZ)
    .rows.filter((s) => s.closedAt !== null)
    .sort((a, b) => (a.openedAt < b.openedAt ? -1 : 1));
  const moves = parseReport('cashMoves', fs.readFileSync(path.join(raw, 'income_outcome.xlsx')), TZ).rows;
  const accounts = { cashAccountId: -1, kaspiAccountId: -2, incomeCategoryId: idOf(`cat:${ref.consts.SHIFT_INCOME}`) };
  const accountName = (id: number) => (id === -1 ? ref.consts.CASH : ref.consts.KASPI);
  const utc = (d: string) => new Date((d.length === 10 ? `${d}T00:00:00` : d.replace(' ', 'T')) + '+05:00').toISOString();
  const since = utc(o.since);
  const until = utc(o.until);

  const ours: string[] = [];
  const balanceMismatches: string[] = [];
  let ourReviews = 0;
  let shifts = 0;
  let balance: number | null = null;
  let prevEnd: number | null = null;
  for (const { shift, moves: own } of shiftWindows(sessions.filter((s) => s.closedAt! <= until), moves)) {
    const p = planShift({ shift: { openedAt: shift.openedAt, closedAt: shift.closedAt!, endBalance: shift.endBalance }, moves: own, prevEndBalance: prevEnd, revenueTx: null, rules, accounts });
    if (shift.openedAt >= since) {
      shifts++;
      ourReviews += p.reviews.length;
      for (const op of p.ops) {
        const income = op.ref.kind === 'income';
        const src = income ? '' : accountName(op.accountId);
        const dst = income ? accountName(op.accountId) : '';
        ours.push([local(op.paidAt), `${src}>${dst}`, nameOf(op.categoryId), op.counterpartyId ? nameOf(op.counterpartyId) : '', op.amount / 100, op.comment ?? ''].join('|'));
      }
      // касса после смены: учёт = Senet + постоянная разница
      balance ??= (prevEnd ?? 0) + o.offset * 100;
      balance += p.ops.reduce((s, op) => (op.accountId !== -1 ? s : op.ref.kind === 'income' ? s + op.amount : s - op.amount), 0);
      if (balance !== shift.endBalance + o.offset * 100) balanceMismatches.push(`${local(shift.openedAt)}: учёт ${balance / 100}, Senet ${shift.endBalance / 100} + ${o.offset}`);
    }
    prevEnd = shift.endBalance;
  }

  const theirs = ref.ops.filter((r) => !r.review).map((r) => [r.when, `${r.src ?? ''}>${r.dst ?? ''}`, r.category, r.counterparty ?? '', r.amount, r.comment ?? ''].join('|'));
  const pool = new Map<string, number>();
  for (const k of theirs) pool.set(k, (pool.get(k) ?? 0) + 1);
  const onlyOurs: string[] = [];
  for (const k of ours) {
    const left = pool.get(k) ?? 0;
    if (left > 0) pool.set(k, left - 1);
    else onlyOurs.push(k);
  }
  const onlyReference = [...pool].flatMap(([k, n]) => Array<string>(n).fill(k));
  return {
    shifts,
    matched: ours.length - onlyOurs.length,
    reference: theirs.length,
    ours: ours.length,
    onlyReference,
    onlyOurs,
    reviews: { reference: ref.ops.filter((r) => r.review).length, ours: ourReviews },
    balanceMismatches,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const arg = (name: string, d: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1]! : d;
  };
  const r = runParity({ since: arg('since', '2026-10-08'), until: arg('until', '2026-11-01 23:59:59'), offset: Number(arg('offset', '88')) });
  console.log(`Смен: ${r.shifts}; операций: эталон ${r.reference}, модуль ${r.ours}, совпало ${r.matched}; на проверку: эталон ${r.reviews.reference}, модуль ${r.reviews.ours}`);
  for (const k of r.onlyReference) console.log(`  только в эталоне: ${k}`);
  for (const k of r.onlyOurs) console.log(`  только в модуле:  ${k}`);
  for (const b of r.balanceMismatches) console.log(`  касса: ${b}`);
  console.log(`Расхождений: ${r.onlyReference.length + r.onlyOurs.length}; касса после смены не сходится: ${r.balanceMismatches.length}`);
}
