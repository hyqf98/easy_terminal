<template>
  <div class="page settings-view">
    <div class="page-header">
      <div>
        <div class="page-title">
          <div class="page-title-icon">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>
          </div>
          {{ titleLabel }}
        </div>
        <div class="page-subtitle">{{ aboutDesc }}</div>
      </div>
    </div>

    <!-- 外观 -->
    <div class="settings-section">
      <div class="section-label">{{ appearanceLabel }}</div>
      <div class="settings-card">
        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-label">{{ themeLabel }}</div>
            <div class="settings-row-desc">Craft 亮色 / 暗色 / 跟随系统</div>
          </div>
          <div class="settings-control">
            <div class="theme-picker">
              <div
                :class="['theme-swatch preview-light', { active: currentTheme === 'craft-light' }]"
                @click="setTheme('craft-light')"
              >
                <div class="theme-swatch-preview"></div>
                <div class="theme-swatch-name">{{ craftLightLabel }}</div>
              </div>
              <div
                :class="['theme-swatch preview-dark', { active: currentTheme === 'craft-dark' }]"
                @click="setTheme('craft-dark')"
              >
                <div class="theme-swatch-preview"></div>
                <div class="theme-swatch-name">{{ craftDarkLabel }}</div>
              </div>
              <div
                :class="['theme-swatch preview-auto', { active: currentTheme === 'system' }]"
                @click="setTheme('system')"
              >
                <div class="theme-swatch-preview"></div>
                <div class="theme-swatch-name">{{ systemThemeLabel }}</div>
              </div>
            </div>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-label">{{ uiFontSizeLabel }}</div>
            <div class="settings-row-desc">基准字号，影响整体 UI 缩放</div>
          </div>
          <div class="settings-control">
            <div class="slider-row">
              <n-slider :value="uiFontSize" :min="11" :max="16" :step="1" @update:value="applyFontSize" />
              <span class="slider-value">{{ uiFontSize }}px</span>
            </div>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-label">{{ termFontSizeLabel }}</div>
            <div class="settings-row-desc">{{ terminalHint }}</div>
          </div>
          <div class="settings-control">
            <div class="slider-row">
              <n-slider :value="termFontSize" :min="11" :max="18" :step="1" @update:value="applyTermFontSize" />
              <span class="slider-value">{{ termFontSize }}px</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 语言 -->
    <div class="settings-section">
      <div class="section-label">{{ t('settings.language') }}</div>
      <div class="settings-card">
        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-label">{{ t('settings.language') }}</div>
            <div class="settings-row-desc">切换界面语言</div>
          </div>
          <div class="settings-control">
            <div class="segmented">
              <button
                :class="['segmented-item', { active: currentLang === 'zh-CN' }]"
                @click="setLanguage('zh-CN')"
              >中文</button>
              <button
                :class="['segmented-item', { active: currentLang === 'en-US' }]"
                @click="setLanguage('en-US')"
              >English</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 通用 -->
    <div class="settings-section">
      <div class="section-label">{{ t('settings.session') }}</div>
      <div class="settings-card">
        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-label">{{ restoreSessionLabel }}</div>
            <div class="settings-row-desc">{{ restoreSessionHint }}</div>
          </div>
          <div class="settings-control">
            <n-switch :value="restoreSession" @update:value="onRestoreChange" />
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-label">{{ autoCheckLabel }}</div>
            <div class="settings-row-desc">从 GitHub Releases 拉取最新版本</div>
          </div>
          <div class="settings-control">
            <n-switch :value="autoCheckUpdate" @update:value="onAutoCheckChange" />
          </div>
        </div>
      </div>
    </div>

    <!-- 关于 -->
    <div class="settings-section">
      <div class="section-label">{{ aboutLabel }}</div>
      <div class="settings-card">
        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-label">Easy Terminal v{{ currentVersion }}</div>
            <div class="settings-row-desc">上次检查：{{ lastCheckedLabel }}</div>
          </div>
          <div class="settings-control">
            <button class="btn btn-soft" :disabled="updateChecking" @click="checkUpdate">
              {{ updateChecking ? '检查中…' : checkUpdateLabel }}
            </button>
          </div>
        </div>
        <div v-if="updateStatus" class="settings-status">{{ updateStatus }}</div>
        <div v-if="updateProgress !== null" class="settings-progress">
          <n-progress type="line" :percentage="updateProgress" />
        </div>
        <div v-if="updateAvailable" class="settings-row settings-row-sub">
          <div class="settings-row-info">
            <div class="settings-row-label">发现新版本 v{{ latestVersion }}</div>
            <div class="settings-row-desc">下载并安装后重启应用</div>
          </div>
          <div class="settings-control">
            <button class="btn btn-primary" @click="installUpdate">{{ installUpdateLabel }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
<script src="./SettingsPanel.ts"></script>
<style src="./SettingsPanel.css" scoped></style>
