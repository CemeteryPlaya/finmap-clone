import { Link } from 'react-router';
import { coverageNote, type ClubCoverage } from '../../lib/club-analytics';

/** Ссылка к подключению Senet: там «Загрузить за период». */
function LoadLink({ companyId }: { companyId: number }) {
  return (
    <>
      Загрузить:{' '}
      <Link to={`/c/${companyId}/settings/integrations`} className="font-semibold underline">
        Настройки → Интеграции → «Загрузить за период»
      </Link>
    </>
  );
}

/**
 * Дни периода без данных Senet (спецификация «Аналитика клуба», §3.3): полоса над отчётом «За N дней периода нет данных
 * Senet — суммы неполные» или, если данных нет ни за один день, пустое состояние. Обе — со ссылкой на «Загрузить за период».
 */
export function CoverageBanner(props: { coverage: ClubCoverage; companyId: number; today: string }) {
  const note = coverageNote(props.coverage, props.today);
  if (!note) return null;
  if (note.kind === 'empty') {
    return (
      <div className="rounded-2xl bg-field px-6 py-10 text-center text-sm text-ink">
        <p className="text-base font-semibold">{note.text}</p>
        <p className="mt-2">
          <LoadLink companyId={props.companyId} />
        </p>
      </div>
    );
  }
  return (
    <p role="note" className="mb-4 rounded-lg bg-expense-soft px-3 py-2 text-sm text-ink">
      {note.text} <LoadLink companyId={props.companyId} />
    </p>
  );
}
