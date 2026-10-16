import { useOutletContext } from 'react-router';
import type { CompanyOutletContext } from '../CompanyLayout';
import { ReportScreen, type ReportConfig } from './ReportScreen';

const PNL: ReportConfig = {
  report: 'pnl',
  title: 'Прибыль',
  subtitle: 'Отчёт о прибыли и убытках (P&L)',
  help: 'Отчёт «Прибыль» формируется по дате сделки. В него не входят переводы, инвестиции, дивиденды, займы и кредиты.',
  dateHeading: 'По дате сделки',
  names: { income: 'Доходы', expense: 'Расходы', line: 'Прибыль' },
  stock: true,
  dealDates: true,
  banner: {
    title: 'Бывает, деньги есть — а прибыли нет',
    text: '«Деньги» — когда пришёл платёж, «Прибыль» — когда заработали. Чтобы операция попала в нужный месяц, укажите в ней «Дату сделки».',
    note: 'Это управленческая прибыль, не бухгалтерский отчёт.',
  },
};

/** «Прибыль / P&L» (§5 спецификации «Аналитика»): по дате сделки, без переводов и исключённых категорий, склад по себестоимости. */
export function PnlPage() {
  const { company } = useOutletContext<CompanyOutletContext>();
  return <ReportScreen key={company.id} company={company} config={PNL} />;
}
