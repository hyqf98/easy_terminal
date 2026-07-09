import { defineComponent, ref, computed, onMounted, onUnmounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { t, setLang, onLangChange, type Lang } from '../../i18n';
import { useCraftTheme, migrateThemeId, type CraftThemeId } from '../../composables/useCraftTheme';
import { showMessage } from '../../composables/useAppMessage';
import { AppUpdater, type UpdateState } from './appUpdate';
import AppSelect from '../../components/AppSelect.vue';
import type { SelectOption } from '../../components/AppSelect';

interface AppSettings {
  theme: string;
  language: string;
  autoCheckUpdate: boolean;
  restoreSession: boolean;
  lastUpdateCheck: string;
  uiFontSize?: number;
  termFontSize?: number;
}

type SettingsSection =
  | 'general'
  | 'appearance'
  | 'terminal'
  | 'session'
  | 'update'
  | 'data'
  | 'about';

interface NavItem {
  id: SettingsSection;
  label: string;
  icon: string;
}

const FLAGS_STORAGE_KEY = 'et:settings:flags';

interface LocalFlags {
  commandSuggest: boolean;
  ghostText: boolean;
  alignGuides: boolean;
  autoInstall: boolean;
  uiFontFamily: string;
  termFontFamily: string;
  radiusStyle: string;
}

function loadLocalFlags(): LocalFlags {
  const fallback: LocalFlags = {
    commandSuggest: true,
    ghostText: true,
    alignGuides: true,
    autoInstall: false,
    uiFontFamily: 'Manrope',
    termFontFamily: 'JetBrains Mono Nerd Font',
    radiusStyle: '8',
  };
  try {
    const raw = localStorage.getItem(FLAGS_STORAGE_KEY);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<LocalFlags>) };
  } catch {
    return fallback;
  }
}

export default defineComponent({
  name: 'SettingsPanel',
  components: { AppSelect },
  emits: ['theme-change'],
  setup(_, { emit }) {
    const { setTheme: applyCraftTheme } = useCraftTheme();
    const updater = new AppUpdater();

    const currentTheme = ref<CraftThemeId>('craft-light');
    const currentLang = ref<Lang>('zh-CN');
    const autoCheckUpdate = ref(true);
    const restoreSession = ref(true);
    const uiFontSize = ref(13);
    const termFontSize = ref(13);
    const updateState = ref<UpdateState>(updater.getState());
    const langTick = ref(0);
    const activeSection = ref<SettingsSection>('appearance');

    // 本地偏好（无需后端持久化，存 localStorage）
    const initialFlags = loadLocalFlags();
    const commandSuggest = ref(initialFlags.commandSuggest);
    const ghostText = ref(initialFlags.ghostText);
    const alignGuides = ref(initialFlags.alignGuides);
    const autoInstall = ref(initialFlags.autoInstall);
    const uiFontFamily = ref(initialFlags.uiFontFamily);
    const termFontFamily = ref(initialFlags.termFontFamily);
    const radiusStyle = ref(initialFlags.radiusStyle);

    const tick = () => { void langTick.value; };
    const titleLabel = computed(() => { tick(); return t('settings.title'); });
    const appearanceLabel = computed(() => { tick(); return t('settings.appearance'); });
    const themeLabel = computed(() => { tick(); return t('settings.theme'); });
    const craftLightLabel = computed(() => { tick(); return t('settings.craftLight'); });
    const craftDarkLabel = computed(() => { tick(); return t('settings.craftDark'); });
    const systemThemeLabel = computed(() => { tick(); return t('settings.systemTheme'); });
    const uiFontSizeLabel = computed(() => { tick(); return t('settings.uiFontSize'); });
    const termFontSizeLabel = computed(() => { tick(); return t('settings.termFontSize'); });
    const terminalHint = computed(() => { tick(); return t('settings.terminalHint'); });
    const restoreSessionLabel = computed(() => { tick(); return t('settings.restoreSession'); });
    const restoreSessionHint = computed(() => { tick(); return t('settings.restoreSessionHint'); });
    const autoCheckLabel = computed(() => { tick(); return t('settings.updateAutoCheck'); });
    const checkUpdateLabel = computed(() => { tick(); return t('settings.updateCheck'); });
    const installUpdateLabel = computed(() => { tick(); return t('settings.updateInstall'); });
    const aboutLabel = computed(() => { tick(); return t('settings.section.about'); });
    const aboutDesc = computed(() => { tick(); return t('settings.aboutDesc'); });

    const currentVersion = computed(() => updateState.value.currentVersion);
    const latestVersion = computed(() => updateState.value.latestVersion);
    const updateChecking = computed(() => updateState.value.status === 'checking');
    const updateAvailable = computed(() => updateState.value.status === 'available');
    const updateProgress = computed(() => updateState.value.progressPercent);
    const lastCheckedLabel = computed(() => {
      const value = updateState.value.lastChecked;
      if (!value) return '--';
      return value;
    });
    const updateStatus = computed(() => {
      tick();
      const state = updateState.value;
      switch (state.status) {
        case 'checking':
          return t('settings.updateChecking');
        case 'up-to-date':
          return t('settings.updateUpToDate');
        case 'available':
          return t('settings.updateAvailable', state.latestVersion);
        case 'downloading':
          return t('settings.updateDownloading');
        case 'installing':
          return t('settings.updateInstalling');
        case 'completed':
          return t('settings.updateReady');
        case 'error':
          return t('settings.updateFailed', state.error);
        case 'unsupported':
          return t('settings.updateUnsupported');
        default:
          return '';
      }
    });

    const navItems: NavItem[] = [
      { id: 'general', label: '通用', icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>' },
      { id: 'appearance', label: '外观', icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18M3 12h18"/></svg>' },
      { id: 'terminal', label: '终端', icon: '<svg viewBox="0 0 24 24"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>' },
      { id: 'session', label: '会话恢复', icon: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>' },
      { id: 'update', label: '自动更新', icon: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-9-9"/><path d="M21 3v6h-6"/></svg>' },
      { id: 'data', label: '数据与同步', icon: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>' },
      { id: 'about', label: '关于', icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>' },
    ];

    // 字体选项：AppSelect 需要 { label, value } 结构
    const uiFontOptions: SelectOption[] = [
      { label: 'Manrope', value: 'Manrope' },
      { label: 'Inter', value: 'Inter' },
      { label: 'System UI', value: 'System UI' },
    ];
    const termFontOptions: SelectOption[] = [
      { label: 'JetBrains Mono Nerd Font', value: 'JetBrains Mono Nerd Font' },
      { label: 'MesloLGS NF', value: 'MesloLGS NF' },
      { label: 'Menlo', value: 'Menlo' },
    ];
    const uiFontSizeOptions: SelectOption[] = [
      { value: 12, label: '12px' },
      { value: 13, label: '13px（默认）' },
      { value: 14, label: '14px' },
      { value: 15, label: '15px' },
    ];
    const termFontSizeOptions: SelectOption[] = [
      { value: 12, label: '12px' },
      { value: 13, label: '13px（默认）' },
      { value: 14, label: '14px' },
      { value: 15, label: '15px' },
      { value: 16, label: '16px' },
    ];
    const radiusOptions: SelectOption[] = [
      { value: '0', label: '方形 (0px)' },
      { value: '8', label: '柔和 (8px)' },
      { value: '12', label: '圆润 (12px)' },
    ];
    const langOptions: Array<{ value: Lang; label: string }> = [
      { value: 'zh-CN', label: '简体中文' },
      { value: 'en-US', label: 'English' },
    ];

    function persistLocalFlags() {
      try {
        const payload: LocalFlags = {
          commandSuggest: commandSuggest.value,
          ghostText: ghostText.value,
          alignGuides: alignGuides.value,
          autoInstall: autoInstall.value,
          uiFontFamily: uiFontFamily.value,
          termFontFamily: termFontFamily.value,
          radiusStyle: radiusStyle.value,
        };
        localStorage.setItem(FLAGS_STORAGE_KEY, JSON.stringify(payload));
      } catch { /* 静默 */ }
    }

    function applyFontSize(size: number) {
      uiFontSize.value = size;
      document.documentElement.style.setProperty('--font-size-md', `${size}px`);
      void saveSettings();
    }

    function applyTermFontSize(size: number) {
      termFontSize.value = size;
      document.documentElement.style.setProperty('--term-font-size', `${size}px`);
      window.dispatchEvent(new CustomEvent('term-font-size-change', { detail: size }));
      void saveSettings();
    }

    // ===== AppSelect（Naive UI）值变化处理：直接接收选中值，无需读取 event.target =====
    function onUiFontSizeChange(value: string | number) {
      const size = Number(value);
      if (size) applyFontSize(size);
    }

    function onTermFontSizeChange(value: string | number) {
      const size = Number(value);
      if (size) applyTermFontSize(size);
    }

    function onUiFontFamilyChange(value: string | number) {
      uiFontFamily.value = String(value);
      onLocalFlagChange();
    }

    function onTermFontFamilyChange(value: string | number) {
      termFontFamily.value = String(value);
      onLocalFlagChange();
    }

    function onRadiusStyleChange(value: string | number) {
      radiusStyle.value = String(value);
      onLocalFlagChange();
    }

    function onLanguageChange(value: string | number) {
      const lang = value as Lang;
      if (lang) setLanguage(lang);
    }

    function setTheme(theme: CraftThemeId) {
      currentTheme.value = theme;
      applyCraftTheme(theme);
      emit('theme-change', theme);
      void saveSettings();
    }

    function setLanguage(lang: Lang) {
      currentLang.value = lang;
      setLang(lang);
      document.documentElement.setAttribute('data-lang', lang);
      void saveSettings();
    }

    function onRestoreChange(value: boolean) {
      restoreSession.value = value;
      void saveSettings();
    }

    function onAutoCheckChange(value: boolean) {
      autoCheckUpdate.value = value;
      void saveSettings();
    }

    function onLocalFlagChange() {
      persistLocalFlags();
    }

    async function saveSettings() {
      try {
        await invoke('save_settings', {
          settings: {
            theme: currentTheme.value,
            language: currentLang.value,
            autoCheckUpdate: autoCheckUpdate.value,
            restoreSession: restoreSession.value,
            lastUpdateCheck: updateState.value.lastChecked,
            uiFontSize: uiFontSize.value,
            termFontSize: termFontSize.value,
          },
        });
      } catch { /* 静默 */ }
    }

    async function checkUpdate() {
      await updater.checkForUpdates(false);
      await saveSettings();
    }

    async function installUpdate() {
      try {
        await updater.installUpdate();
        showMessage(t('settings.updateReady'), 'success');
      } catch (error) {
        showMessage(String(error), 'error');
      }
    }

    let unsubUpdater: (() => void) | null = null;
    let unsubLang: (() => void) | null = null;

    onMounted(async () => {
      try {
        const settings = await invoke<AppSettings>('get_settings');
        currentTheme.value = migrateThemeId(settings.theme) as CraftThemeId;
        currentLang.value = (settings.language as Lang) || 'zh-CN';
        autoCheckUpdate.value = settings.autoCheckUpdate ?? true;
        restoreSession.value = settings.restoreSession ?? true;
        uiFontSize.value = settings.uiFontSize ?? 13;
        termFontSize.value = settings.termFontSize ?? 13;
        setLang(currentLang.value);
        applyCraftTheme(currentTheme.value);
        document.documentElement.style.setProperty('--font-size-md', `${uiFontSize.value}px`);
        document.documentElement.style.setProperty('--term-font-size', `${termFontSize.value}px`);
        window.dispatchEvent(new CustomEvent('term-font-size-change', { detail: termFontSize.value }));
        emit('theme-change', currentTheme.value);
      } catch {
        applyCraftTheme('craft-light');
      }
      unsubUpdater = updater.onChange((state) => {
        updateState.value = state;
      });
      void updater.init(autoCheckUpdate.value);
      unsubLang = onLangChange(() => { langTick.value++; });
    });

    onUnmounted(() => {
      unsubUpdater?.();
      unsubLang?.();
    });

    return {
      t,
      navItems,
      activeSection,
      currentTheme,
      currentLang,
      autoCheckUpdate,
      restoreSession,
      uiFontSize,
      termFontSize,
      commandSuggest,
      ghostText,
      alignGuides,
      autoInstall,
      uiFontFamily,
      termFontFamily,
      radiusStyle,
      uiFontOptions,
      termFontOptions,
      uiFontSizeOptions,
      termFontSizeOptions,
      radiusOptions,
      langOptions,
      titleLabel,
      appearanceLabel,
      themeLabel,
      craftLightLabel,
      craftDarkLabel,
      systemThemeLabel,
      uiFontSizeLabel,
      termFontSizeLabel,
      terminalHint,
      restoreSessionLabel,
      restoreSessionHint,
      autoCheckLabel,
      checkUpdateLabel,
      installUpdateLabel,
      aboutLabel,
      aboutDesc,
      currentVersion,
      latestVersion,
      updateChecking,
      updateAvailable,
      updateProgress,
      updateStatus,
      lastCheckedLabel,
      setTheme,
      setLanguage,
      onRestoreChange,
      onAutoCheckChange,
      onLocalFlagChange,
      onUiFontSizeChange,
      onTermFontSizeChange,
      onUiFontFamilyChange,
      onTermFontFamilyChange,
      onRadiusStyleChange,
      onLanguageChange,
      applyFontSize,
      applyTermFontSize,
      checkUpdate,
      installUpdate,
    };
  },
});
