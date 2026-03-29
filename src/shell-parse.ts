export function parseCommandLine(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | '' = '';
  let escaped = false;

  for (const char of input.trim()) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = '';
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (escaped) current += '\\';
  if (current) args.push(current);
  return args;
}

export function getCommandToken(input: string): string {
  return parseCommandLine(input)[0] || '';
}
