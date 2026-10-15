import { createInterface } from 'node:readline';

/**
 * Interactive terminal prompts for CLI commands.
 *
 * Prompts are written to stderr (never stdout, so `-o json`/`-o yaml` output
 * stays machine-readable), and commands only prompt when stdin is a terminal:
 * agents and scripts get a clear error instead of a hidden question. Bun's
 * global `prompt` function writes to stdout, so don't use it.
 */

/** Whether stdin is an interactive terminal (so a command may ask). */
export function stdinIsTTY(): boolean {
  return Boolean(process.stdin.isTTY);
}

/** Streams a prompt reads from / writes to (injectable for tests). */
export interface PromptStreams {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

/**
 * Ask `question` (followed by a space) on stderr and read one line from
 * stdin. Resolves to the line (without the newline), or `null` on EOF
 * (e.g. Ctrl-D) before a line was entered. Call it outside the repo lock.
 */
export function promptLine(
  question: string,
  streams: PromptStreams = {},
): Promise<string | null> {
  const input = streams.input ?? process.stdin;
  const output = streams.output ?? process.stderr;
  return new Promise((resolve) => {
    const rl = createInterface({ input, output, terminal: false });
    let answered = false;
    rl.once('line', (line) => {
      answered = true;
      rl.close();
      resolve(line);
    });
    rl.once('close', () => {
      if (answered) return;
      // EOF without an answer: end the prompt line so later output (the
      // error) starts on its own line.
      output.write('\n');
      resolve(null);
    });
    output.write(`${question} `);
  });
}
