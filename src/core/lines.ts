/**
 * Split text into lines. Accept both LF (`\n`) and CRLF (`\r\n`) line
 * endings, so no line keeps a trailing `\r`. Files can have CRLF endings
 * on Windows, with `core.autocrlf=true`, or after an external tool edits
 * them. Join the result with `\n` to get LF-normalized text.
 */
export function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}
