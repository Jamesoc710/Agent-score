// Tiny CLI helpers, so the pipeline scripts don't each hand-roll argv parsing.
// Supports `--flag`, `--flag value` and `--flag=value`.

const VALUE_FLAGS = new Set(["--batch", "--agent-id"]);

export function hasFlag(name: string, argv: string[] = process.argv.slice(2)): boolean {
  return argv.includes(name);
}

export function flagValue(
  name: string,
  fallback: string,
  argv: string[] = process.argv.slice(2)
): string {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name) return argv[i + 1] ?? fallback;
    if (argv[i].startsWith(`${name}=`)) return argv[i].slice(name.length + 1);
  }
  return fallback;
}

// Non-flag arguments, with the values of VALUE_FLAGS skipped.
export function positionals(argv: string[] = process.argv.slice(2)): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      if (VALUE_FLAGS.has(argv[i])) i++;
      continue;
    }
    out.push(argv[i]);
  }
  return out;
}
