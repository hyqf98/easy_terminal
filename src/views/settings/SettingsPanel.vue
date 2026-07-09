<template>
  <div class="settings-layout">
    <!-- 左侧导航 -->
    <aside class="settings-nav">
      <div
        v-for="item in navItems"
        :key="item.id"
        :class="['settings-nav-item', { active: activeSection === item.id }]"
        @click="activeSection = item.id"
      >
        <span class="settings-nav-icon" v-html="item.icon"></span>
        <span>{{ item.label }}</span>
      </div>
    </aside>

    <!-- 右侧内容 -->
    <div class="settings-content">
      <!-- 外观 -->
      <div v-if="activeSection === 'appearance'" class="settings-section">
        <div class="settings-section-title">{{ appearanceLabel }}</div>
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
              <div class="settings-row-label">界面字体</div>
              <div class="settings-row-desc">用于 UI 控件、菜单、面板</div>
            </div>
            <div class="settings-control">
              <AppSelect
                :model-value="uiFontFamily"
                :options="uiFontOptions"
                @update:model-value="onUiFontFamilyChange"
              />
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">终端字体</div>
              <div class="settings-row-desc">用于 xterm 渲染</div>
            </div>
            <div class="settings-control">
              <AppSelect
                :model-value="termFontFamily"
                :options="termFontOptions"
                @update:model-value="onTermFontFamilyChange"
              />
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">{{ uiFontSizeLabel }}</div>
              <div class="settings-row-desc">基准字号，影响整体 UI 缩放</div>
            </div>
            <div class="settings-control">
              <AppSelect
                :model-value="uiFontSize"
                :options="uiFontSizeOptions"
                @update:model-value="onUiFontSizeChange"
              />
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">圆角风格</div>
              <div class="settings-row-desc">6 / 8 / 12px 阶梯</div>
            </div>
            <div class="settings-control">
              <AppSelect
                :model-value="radiusStyle"
                :options="radiusOptions"
                @update:model-value="onRadiusStyleChange"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- 通用 -->
      <div v-else-if="activeSection === 'general'" class="settings-section">
        <div class="settings-section-title">通用</div>
        <div class="settings-card">
          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">{{ restoreSessionLabel }}</div>
              <div class="settings-row-desc">{{ restoreSessionHint }}</div>
            </div>
            <div class="settings-control">
              <div
                :class="['toggle-switch', { on: restoreSession }]"
                role="switch"
                :aria-checked="restoreSession"
                @click="onRestoreChange(!restoreSession)"
              ></div>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">命令智能补全</div>
              <div class="settings-row-desc">聚合系统/历史/映射/SSH 提供建议</div>
            </div>
            <div class="settings-control">
              <div
                :class="['toggle-switch', { on: commandSuggest }]"
                role="switch"
                :aria-checked="commandSuggest"
                @click="commandSuggest = !commandSuggest; onLocalFlagChange()"
              ></div>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">Ghost Text 预览</div>
              <div class="settings-row-desc">输入时显示灰色建议命令</div>
            </div>
            <div class="settings-control">
              <div
                :class="['toggle-switch', { on: ghostText }]"
                role="switch"
                :aria-checked="ghostText"
                @click="ghostText = !ghostText; onLocalFlagChange()"
              ></div>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">对齐辅助线</div>
              <div class="settings-row-desc">拖拽终端时显示吸附辅助线</div>
            </div>
            <div class="settings-control">
              <div
                :class="['toggle-switch', { on: alignGuides }]"
                role="switch"
                :aria-checked="alignGuides"
                @click="alignGuides = !alignGuides; onLocalFlagChange()"
              ></div>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">{{ t('settings.language') }}</div>
              <div class="settings-row-desc">切换界面语言</div>
            </div>
            <div class="settings-control">
              <AppSelect
                :model-value="currentLang"
                :options="langOptions"
                @update:model-value="onLanguageChange"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- 终端 -->
      <div v-else-if="activeSection === 'terminal'" class="settings-section">
        <div class="settings-section-title">{{ t('settings.section.terminal') }}</div>
        <div class="settings-card">
          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">{{ termFontSizeLabel }}</div>
              <div class="settings-row-desc">{{ terminalHint }}</div>
            </div>
            <div class="settings-control">
              <AppSelect
                :model-value="termFontSize"
                :options="termFontSizeOptions"
                @update:model-value="onTermFontSizeChange"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- 会话恢复 -->
      <div v-else-if="activeSection === 'session'" class="settings-section">
        <div class="settings-section-title">{{ t('settings.session') }}</div>
        <div class="settings-card">
          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">{{ restoreSessionLabel }}</div>
              <div class="settings-row-desc">{{ restoreSessionHint }}</div>
            </div>
            <div class="settings-control">
              <div
                :class="['toggle-switch', { on: restoreSession }]"
                role="switch"
                :aria-checked="restoreSession"
                @click="onRestoreChange(!restoreSession)"
              ></div>
            </div>
          </div>
        </div>
      </div>

      <!-- 自动更新 -->
      <div v-else-if="activeSection === 'update'" class="settings-section">
        <div class="settings-section-title">{{ t('settings.update') }}</div>
        <div class="settings-card">
          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">{{ autoCheckLabel }}</div>
              <div class="settings-row-desc">从 GitHub Releases 拉取最新版本</div>
            </div>
            <div class="settings-control">
              <div
                :class="['toggle-switch', { on: autoCheckUpdate }]"
                role="switch"
                :aria-checked="autoCheckUpdate"
                @click="onAutoCheckChange(!autoCheckUpdate)"
              ></div>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">下载后自动安装</div>
              <div class="settings-row-desc">下载完成立即重启应用</div>
            </div>
            <div class="settings-control">
              <div
                :class="['toggle-switch', { on: autoInstall }]"
                role="switch"
                :aria-checked="autoInstall"
                @click="autoInstall = !autoInstall; onLocalFlagChange()"
              ></div>
            </div>
          </div>
          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">当前版本</div>
              <div class="settings-row-desc">Easy Terminal v{{ currentVersion }} · 检查于 {{ lastCheckedLabel }}</div>
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

      <!-- 数据与同步 -->
      <div v-else-if="activeSection === 'data'" class="settings-section">
        <div class="settings-section-title">数据与同步</div>
        <div class="settings-card">
          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">本地配置</div>
              <div class="settings-row-desc">命令、映射、SSH 主机、快捷键均存储于本机</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 关于 -->
      <div v-else-if="activeSection === 'about'" class="settings-section">
        <div class="settings-section-title">{{ aboutLabel }}</div>
        <div class="settings-card">
          <div class="settings-row">
            <div class="settings-row-info">
              <div class="settings-row-label">{{ titleLabel }} v{{ currentVersion }}</div>
              <div class="settings-row-desc">{{ aboutDesc }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
<script src="./SettingsPanel.ts"></script>
<style src="./SettingsPanel.css" scoped></style>
