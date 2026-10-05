export const ARCHIVE_RE = /^backup-\d{8}-\d{6}(-\d+)?\.zip$/;

export function archiveName(at: Date, timezone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return `backup-${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}.zip`;
}
