import { defineComponent, computed, onMounted } from 'vue';
import { NConfigProvider, NMessageProvider, NNotificationProvider, NDialogProvider, zhCN, enUS, dateZhCN, dateEnUS } from 'naive-ui';
import { invoke } from '@tauri-apps/api/core';
import AppLayout from './views/layout/AppLayout.vue';
import { useCraftTheme, migrateThemeId } from './composables/useCraftTheme';
import { setLang, type Lang } from './i18n';

export default defineComponent({
  name: 'App',
  components: { AppLayout, NConfigProvider, NMessageProvider, NNotificationProvider, NDialogProvider },
  setup() {
    const { naiveTheme, themeOverrides, initTheme } = useCraftTheme();
    const currentLang = computed(() => {
      const lang = document.documentElement.getAttribute('data-lang') || 'zh-CN';
      return lang === 'en-US' ? 'en-US' : 'zh-CN';
    });

    const locale = computed(() => (currentLang.value === 'en-US' ? enUS : zhCN));
    const dateLocale = computed(() => (currentLang.value === 'en-US' ? dateEnUS : dateZhCN));

    onMounted(async () => {
      try {
        const settings = await invoke<{ theme: string; language: string; uiFontSize?: number; termFontSize?: number }>('get_settings');
        initTheme(migrateThemeId(settings.theme));
        document.documentElement.style.setProperty('--font-size-md', `${settings.uiFontSize ?? 13}px`);
        document.documentElement.style.setProperty('--term-font-size', `${settings.termFontSize ?? 15}px`);
        if (settings.language) {
          setLang(settings.language as Lang);
          document.documentElement.setAttribute('data-lang', settings.language);
        }
      } catch {
        initTheme('craft-light');
      }
    });

    return { naiveTheme, themeOverrides, locale, dateLocale };
  },
});
