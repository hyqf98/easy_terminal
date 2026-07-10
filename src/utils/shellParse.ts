export interface CommandToken {
  type: 'command' | 'flag' | 'argument' | 'path' | 'operator' | 'string' | 'variable' | 'number';
  start: number;
  end: number;
  text: string;
}

const SHELL_OPERATORS = ['|', '&&', '||', '>', '>>', '<', '<<', ';&', '&', ';'];
const PATH_PATTERN = /^(?:\.\/|\.\\|\/|\\|[A-Za-z]:\\)/;
const PATH_CHARS = /[\/\\]/;
// 匹配 shell 变量：$VAR、${VAR}、$?
const VAR_PATTERN = /^\$\{?\w*[\}?]/;
const NUMBER_PATTERN = /^\d+(?:\.\d+)?$/;

export function tokenizeCommand(input: string): CommandToken[] {
  const tokens: CommandToken[] = [];
  const trimmed = input;
  let i = 0;
  let isFirstToken = true;

  while (i < trimmed.length) {
    // Skip whitespace
    if (/\s/.test(trimmed[i])) {
      i++;
      continue;
    }

    const start = i;

    // Check for operators first
    const op = matchOperator(trimmed, i);
    if (op) {
      tokens.push({ type: 'operator', start, end: i + op.length, text: op });
      i += op.length;
      isFirstToken = true;
      continue;
    }

    // Check for shell variable at the start of a word: $VAR, ${VAR}, $?
    const remaining = trimmed.substring(i);
    const varMatch = remaining.match(VAR_PATTERN);
    if (varMatch && !trimmed[i].match(/["']/)) {
      // Read the full word including the variable (e.g. $HOME/path)
      let text = '';
      let hasPathChar = false;
      let j = i;
      while (j < trimmed.length && !/\s/.test(trimmed[j])) {
        const nextOp = matchOperator(trimmed, j);
        if (nextOp) break;
        if (trimmed[j] === '\\') {
          j++;
          if (j < trimmed.length) { text += trimmed[j]; j++; }
          continue;
        }
        if (PATH_CHARS.test(trimmed[j])) hasPathChar = true;
        text += trimmed[j];
        j++;
      }
      if (!text) continue;
      const type = hasPathChar ? 'path' : 'variable';
      tokens.push({ type, start, end: j, text });
      i = j;
      if (isFirstToken) isFirstToken = false;
      continue;
    }

    // Check for quoted strings
    if (trimmed[i] === '"' || trimmed[i] === "'") {
      const quote = trimmed[i];
      let text = quote;
      let j = i + 1;
      while (j < trimmed.length && trimmed[j] !== quote) {
        if (trimmed[j] === '\\') {
          text += trimmed[j];
          j++;
          if (j < trimmed.length) { text += trimmed[j]; j++; }
          continue;
        }
        text += trimmed[j];
        j++;
      }
      if (j < trimmed.length) { text += trimmed[j]; j++; } // closing quote
      // If followed by more non-whitespace (e.g. "abc"def), keep reading
      while (j < trimmed.length && !/\s/.test(trimmed[j])) {
        const nextOp = matchOperator(trimmed, j);
        if (nextOp) break;
        if (PATH_CHARS.test(trimmed[j])) { /* hasPathChar=true */ }
        text += trimmed[j];
        j++;
      }
      if (text) {
        tokens.push({ type: 'string', start, end: i + text.length, text });
        i += text.length;
        if (isFirstToken) isFirstToken = false;
      }
      continue;
    }

    // Read a word (respecting escapes)
    let text = '';
    let hasPathChar = false;
    while (i < trimmed.length && !/\s/.test(trimmed[i])) {
      // Check if next chars form an operator
      const nextOp = matchOperator(trimmed, i);
      if (nextOp) break;

      if (trimmed[i] === '\\') {
        i++;
        if (i < trimmed.length) {
          text += trimmed[i];
          i++;
        }
        continue;
      }

      if (PATH_CHARS.test(trimmed[i])) {
        hasPathChar = true;
      }

      text += trimmed[i];
      i++;
    }

    if (!text) continue;

    // Classify the token
    let type: CommandToken['type'];

    if (isFirstToken) {
      type = 'command';
      isFirstToken = false;
    } else if (text.startsWith('--') || text.startsWith('-')) {
      type = 'flag';
    } else if (NUMBER_PATTERN.test(text)) {
      type = 'number';
    } else if (hasPathChar || PATH_PATTERN.test(text) || text.includes('.')) {
      type = 'path';
    } else {
      type = 'argument';
    }

    tokens.push({ type, start, end: i, text });
  }

  return tokens;
}

function matchOperator(input: string, pos: number): string | null {
  for (const op of SHELL_OPERATORS) {
    if (input.substring(pos, pos + op.length) === op) {
      return op;
    }
  }
  return null;
}

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
