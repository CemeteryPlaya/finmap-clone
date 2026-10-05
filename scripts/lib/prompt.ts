import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

export function createPrompt() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  return {
    async ask(question: string, def?: string): Promise<string> {
      const answer = (await rl.question(def ? `${question} [${def}]: ` : `${question}: `)).trim();
      return answer || def || '';
    },
    async askSecret(question: string): Promise<string> {
      const out = stdout as NodeJS.WriteStream & { _origWrite?: typeof stdout.write };
      const orig = out.write.bind(out);
      let muted = false;
      out.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
        if (muted && typeof chunk === 'string' && chunk !== '\n' && chunk !== '\r\n') return true;
        return orig(chunk as string, ...(rest as []));
      }) as typeof stdout.write;
      const p = rl.question(`${question}: `);
      muted = true;
      const answer = await p;
      muted = false;
      out.write = orig;
      orig('\n');
      return answer;
    },
    close() {
      rl.close();
    },
  };
}
