// 命令文本 token 高亮：将命令字符串拆为带语义的 span，输出 HTML 字符串
// 用法：在列表/预览中以 v-html 渲染，已先做 HTML 转义，安全

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 将命令文本切分为 token span，返回可直接 v-html 的字符串
 * 分类规则：
 *  - 以 - 或 -- 开头的 token 视为 flag
 *  - 形如 {xxx} 的占位符视为 path
 *  - 双引号包裹的字符串视为 string
 *  - 其余首段命令词视为 command（仅前 2 个单词，避免参数被误判）
 */
export function tokenizeCommandHtml(command: string): string {
  if (!command) return '';
  const tokens = command.match(/"[^"]*"|\{[^}]+\}|[^\s]+/g) || [];
  let commandWordCount = 0;
  const parts: string[] = [];
  for (const token of tokens) {
    if (token.startsWith('"') && token.endsWith('"')) {
      parts.push(`<span class="tok-string">${escapeHtml(token)}</span>`);
    } else if (token.startsWith('{') && token.endsWith('}')) {
      parts.push(`<span class="tok-path">${escapeHtml(token)}</span>`);
    } else if (token.startsWith('-')) {
      parts.push(`<span class="tok-flag">${escapeHtml(token)}</span>`);
    } else if (commandWordCount < 2 && /^[a-zA-Z][\w-]*$/.test(token)) {
      parts.push(`<span class="tok-command">${escapeHtml(token)}</span>`);
      commandWordCount += 1;
    } else if (/^\d+$/.test(token)) {
      parts.push(`<span class="tok-path">${escapeHtml(token)}</span>`);
    } else {
      parts.push(escapeHtml(token));
    }
  }
  return parts.join(' ');
}
