import { defineComponent, ref, computed, onMounted, onUnmounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { t, setLang, onLangChange, type Lang } from '../../i18n';
import { useCraftTheme, migrateThemeId, type CraftThemeId } from '../../composables/useCraftTheme';
import { showMessage } from '../../composables/useAppMessage';
import { AppUpdater, type UpdateState } from './appUpdate';

interface AppSettings {
  theme: string;
  language: string;
  autoCheckUpdate: boolean;
  restoreSession: boolean;
  lastUpdateCheck: string;
  uiFontSize?: number;
  termFontSize?: number;
}

export default defineComponent({
  name: 'SettingsPanel',
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
      currentTheme,
      currentLang,
      autoCheckUpdate,
      restoreSession,
      uiFontSize,
      termFontSize,
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
      applyFontSize,
      applyTermFontSize,
      checkUpdate,
      installUpdate,
    };
  },
});
