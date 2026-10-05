const LINE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/;

function unquote(v: string): string {
  const m = v.match(/^"(.*)"$/) ?? v.match(/^'(.*)'$/);
  return m ? m[1]! : v;
}

export function parseEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = line.match(LINE);
    if (m) out.set(m[1]!, unquote(m[2]!));
  }
  return out;
}

export function updateEnvText(text: string, updates: Record<string, string>): string {
  const pending = new Map(Object.entries(updates));
  const lines = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  const result = lines.map((line) => {
    const m = line.match(LINE);
    if (m && !/^\s*#/.test(line) && pending.has(m[1]!)) {
      const v = pending.get(m[1]!)!;
      pending.delete(m[1]!);
      return `${m[1]}=${v}`;
    }
    return line;
  });
  for (const [k, v] of pending) result.push(`${k}=${v}`);
  return result.filter((l, i) => !(i === 0 && l === '' && result.length === 1)).join('\n') + '\n';
}
