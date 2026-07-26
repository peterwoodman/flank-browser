/** Extracts `--space <name or id>` (or `--space=<value>`) from a command line. */
export function parseSpaceArg(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--space' && i + 1 < argv.length) return argv[i + 1];
    if (arg.startsWith('--space=')) return arg.slice('--space='.length);
  }
  return null;
}
