import { matchesQuery } from '../../shared/search';

/** Поле «Поиск» в панели «Компании» — только если компаний больше пяти (§3.2 этапа 1.5). */
export const SEARCH_FROM = 5;

/** Формы собственности: в инициалы не идут. */
const LEGAL_FORMS = new Set(['тоо', 'ип', 'ао', 'оао', 'зао', 'ооо', 'llp', 'llc', 'ltd', 'inc']);

/** Инициалы для аватара: первые буквы двух первых слов без формы собственности и кавычек: «ТОО «Демо Клубы»» → «ДК». */
export function companyInitials(name: string): string {
  const words = name.replace(/[«»"'“”„()]/g, ' ').split(/\s+/).filter(Boolean);
  const meaningful = words.filter((w) => !LEGAL_FORMS.has(w.toLowerCase().replace(/\./g, '')));
  const source = meaningful.length > 0 ? meaningful : words;
  const letters = source
    .slice(0, 2)
    .map((w) => [...w][0]!.toUpperCase())
    .join('');
  return letters || '?';
}

/** Компании под запрос (без учёта регистра и «ё»); пустой запрос — все. */
export function filterCompanies<T extends { name: string }>(companies: readonly T[], query: string): T[] {
  return query.trim() === '' ? [...companies] : companies.filter((c) => matchesQuery(c.name, query));
}
