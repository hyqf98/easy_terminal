import { invoke } from '@tauri-apps/api/core';

export interface CommandEntry {
  name: string;
  alias: string[];
  description: string;
  usage: string;
  category: string;
}

interface CommandConfig {
  platform: string;
  commands: CommandEntry[];
}

export class CommandSuggest {
  private commands: CommandEntry[] = [];
  private popup: HTMLDivElement | null = null;
  private activeIndex = 0;
  private filteredItems: CommandEntry[] = [];
  private visible = false;
  private currentInput = '';
  private currentPlatform = '';

  // Callback: when user selects a command, return the command text to insert
  public onSelect?: (commandName: string) => void;

  async init() {
    try {
      this.currentPlatform = await invoke<string>('get_platform');
      const configs = await invoke<CommandConfig[]>('load_commands');
      // Merge all commands, but prioritize current platform
      for (const config of configs) {
        if (config.platform === this.currentPlatform) {
          this.commands = config.commands;
          break;
        }
      }
      // If no platform match, use first config
      if (this.commands.length === 0 && configs.length > 0) {
        this.commands = configs[0].commands;
      }
    } catch (e) {
      console.error('Failed to load commands:', e);
    }
  }

  getCommands(): CommandEntry[] {
    return this.commands;
  }

  getPlatform(): string {
    return this.currentPlatform;
  }

  /** Feed current terminal input line, show suggestions if applicable */
  update(input: string): boolean {
    this.currentInput = input;
    // Extract the command part (first word or partial)
    const trimmed = input.trimStart();
    if (!trimmed) {
      this.hide();
      return false;
    }
    // Only suggest at the beginning of a command line (first word)
    const firstWord = trimmed.split(/\s/)[0].toLowerCase();
    if (!firstWord || firstWord.length < 1) {
      this.hide();
      return false;
    }

    this.filteredItems = this.matchCommands(firstWord);
    if (this.filteredItems.length === 0) {
      this.hide();
      return false;
    }

    this.activeIndex = 0;
    this.show();
    return true;
  }

  private matchCommands(query: string): CommandEntry[] {
    const results: { cmd: CommandEntry; score: number }[] = [];

    for (const cmd of this.commands) {
      const nameLower = cmd.name.toLowerCase();
      let score = 0;

      // Exact match
      if (nameLower === query) {
        score = 100;
      }
      // Starts with query
      else if (nameLower.startsWith(query)) {
        score = 80 + query.length;
      }
      // Contains query
      else if (nameLower.includes(query)) {
        score = 50 + query.length;
      }
      // Alias match
      else {
        for (const alias of cmd.alias) {
          const aliasLower = alias.toLowerCase();
          if (aliasLower === query) {
            score = 90;
            break;
          }
          if (aliasLower.startsWith(query)) {
            score = 70 + query.length;
            break;
          }
          if (aliasLower.includes(query)) {
            score = 40 + query.length;
            break;
          }
        }
      }

      // Description match (lower priority)
      if (score === 0 && cmd.description.toLowerCase().includes(query)) {
        score = 20;
      }

      if (score > 0) {
        results.push({ cmd, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 8).map((r) => r.cmd);
  }

  private show() {
    if (!this.popup) {
      this.popup = document.createElement('div');
      this.popup.className = 'cmd-suggest-popup';
      document.body.appendChild(this.popup);
    }
    this.visible = true;
    this.render();
  }

  hide() {
    if (this.popup) {
      this.popup.remove();
      this.popup = null;
    }
    this.visible = false;
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** Position the popup relative to the terminal cursor */
  positionAt(terminalEl: HTMLElement, cursorX: number, cursorY: number) {
    if (!this.popup) return;

    const rect = terminalEl.getBoundingClientRect();
    let left = rect.left + cursorX;
    let top = rect.top + cursorY;

    // Ensure popup stays within viewport
    const popupWidth = 340;
    const popupHeight = Math.min(this.filteredItems.length * 48 + 30, 280);

    if (left + popupWidth > window.innerWidth) {
      left = window.innerWidth - popupWidth - 8;
    }
    if (top + popupHeight > window.innerHeight) {
      top = top - popupHeight - 20;
    }

    this.popup.style.left = `${left}px`;
    this.popup.style.top = `${top}px`;
  }

  /** Handle keyboard navigation. Returns true if the event was consumed */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.visible) return false;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.activeIndex = Math.min(this.activeIndex + 1, this.filteredItems.length - 1);
        this.render();
        return true;
      case 'ArrowUp':
        e.preventDefault();
        this.activeIndex = Math.max(this.activeIndex - 1, 0);
        this.render();
        return true;
      case 'Enter':
      case 'Tab':
        e.preventDefault();
        if (this.filteredItems[this.activeIndex]) {
          this.selectItem(this.filteredItems[this.activeIndex]);
        }
        return true;
      case 'Escape':
        this.hide();
        return true;
    }
    return false;
  }

  private selectItem(cmd: CommandEntry) {
    this.onSelect?.(cmd.name);
    this.hide();
  }

  private render() {
    if (!this.popup) return;

    const query = this.currentInput.trimStart().split(/\s/)[0].toLowerCase();

    // Group by category
    const categories = new Map<string, CommandEntry[]>();
    for (const item of this.filteredItems) {
      const cat = item.category || '其他';
      if (!categories.has(cat)) categories.set(cat, []);
      categories.get(cat)!.push(item);
    }

    let html = '';
    let globalIdx = 0;

    for (const [cat, items] of categories) {
      html += `<div class="cmd-suggest-category">${escapeHtml(cat)}</div>`;
      for (const cmd of items) {
        const isActive = globalIdx === this.activeIndex;
        const highlightedName = highlightMatch(cmd.name, query);
        html += `
          <div class="cmd-suggest-item${isActive ? ' active' : ''}" data-index="${globalIdx}">
            <div class="cmd-suggest-icon" style="background:${categoryColor(cmd.category)}22;color:${categoryColor(cmd.category)}">${cmd.name.charAt(0).toUpperCase()}</div>
            <div class="cmd-suggest-info">
              <div class="cmd-suggest-name">${highlightedName}${cmd.alias.length ? `<span style="color:var(--text-muted);font-size:11px;font-weight:400"> (${cmd.alias.join(', ')})</span>` : ''}</div>
              <div class="cmd-suggest-desc">${escapeHtml(cmd.description)}</div>
            </div>
            ${cmd.usage ? `<div class="cmd-suggest-usage">${escapeHtml(cmd.usage)}</div>` : ''}
          </div>
        `;
        globalIdx++;
      }
    }

    this.popup.innerHTML = html;

    // Bind click events
    this.popup.querySelectorAll('.cmd-suggest-item').forEach((el) => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const idx = parseInt((el as HTMLElement).dataset.index || '0');
        if (this.filteredItems[idx]) {
          this.selectItem(this.filteredItems[idx]);
        }
      });
    });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightMatch(name: string, query: string): string {
  const lower = name.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return escapeHtml(name);
  const before = name.slice(0, idx);
  const match = name.slice(idx, idx + query.length);
  const after = name.slice(idx + query.length);
  return `${escapeHtml(before)}<span class="highlight">${escapeHtml(match)}</span>${escapeHtml(after)}`;
}

function categoryColor(cat: string): string {
  const colors: Record<string, string> = {
    '文件操作': '#89b4fa',
    '终端操作': '#a6e3a1',
    '系统管理': '#f9e2af',
    '网络': '#94e2d5',
    '开发工具': '#cba6f7',
  };
  return colors[cat] || '#6c7086';
}
