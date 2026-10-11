import { Link } from 'react-router';
import { btnSecondary } from './ui';

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="p-8">
      <p role="alert" className="mb-4 text-expense-strong">
        {message}
      </p>
      <div className="flex items-center gap-4">
        <button type="button" onClick={onRetry} className={btnSecondary}>
          Повторить
        </button>
        <Link to="/" className="text-sm font-semibold underline">
          На главную
        </Link>
      </div>
    </div>
  );
}
