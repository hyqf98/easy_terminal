// 命令文本 token 高亮：将命令字符串拆为带语义的 span，输出 HTML 字符串
// 用法：在列表/预览中以 v-html 渲染，已先做 HTML 转义，安全
// 统一入口：内部委托 shellParse.tokenizeCommand 做解析，保证全项目分类规则一致

import { tokenizeCommand } from '../../utils/shellParse';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 将命令文本切分为 token span，返回可直接 v-html 的字符串。
 * 使用 shellParse.tokenizeCommand 做解析，统一全项目分类规则：
 *  - command  首个词（命令名）
 *  - flag     以 - 或 -- 开头
 *  - string   引号包裹
 *  - variable $VAR / ${VAR}
 *  - number   纯数字
 *  - path     含 / \ . 或以 ~/ 开头
 *  - operator | && || > >> 等
 *  - argument 其余普通参数（无着色）
 */
export function tokenizeCommandHtml(command: string): string {
  if (!command) return '';
  const tokens = tokenizeCommand(command);
  const parts: string[] = [];
  let lastEnd = 0;
  for (const token of tokens) {
    // 补回 token 之间的原始字符（主要是空白），保持原始间距
    if (token.start > lastEnd) {
      parts.push(escapeHtml(command.substring(lastEnd, token.start)));
    }
    const cls = tokenClass(token.type);
    const escaped = escapeHtml(token.text);
    parts.push(cls ? `<span class="${cls}">${escaped}</span>` : escaped);
    lastEnd = token.end;
  }
  // 补回尾部
  if (lastEnd < command.length) {
    parts.push(escapeHtml(command.substring(lastEnd)));
  }
  return parts.join('');
}

/** token 类型 → CSS 类名映射（argument 无着色） */
function tokenClass(type: string): string {
  switch (type) {
    case 'command': return 'tok-command';
    case 'flag': return 'tok-flag';
    case 'string': return 'tok-string';
    case 'variable': return 'tok-variable';
    case 'number': return 'tok-number';
    case 'path': return 'tok-path';
    case 'operator': return 'tok-operator';
    default: return ''; // argument 无着色
  }
}
