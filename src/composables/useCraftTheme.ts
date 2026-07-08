import { computed, ref, watch } from 'vue';
import type { GlobalThemeOverrides } from 'naive-ui';
import { darkTheme } from 'naive-ui';

export type CraftThemeId = 'craft-light' | 'craft-dark' | 'system';

const currentThemeId = ref<CraftThemeId>('craft-light');
const resolvedDark = ref(false);

/** 将旧主题 ID 迁移为 Craft 主题 */
export function migrateThemeId(theme: string): CraftThemeId {
  if (theme === 'craft-light' || theme === 'craft-dark' || theme === 'system') {
    return theme;
  }
  if (theme === 'dark' || theme === 'warm') {
    return 'craft-dark';
  }
  return 'craft-light';
}

function applyDocumentTheme(isDark: boolean) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', isDark ? 'craft-dark' : 'craft-light');
}

function resolveSystemDark(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function buildCraftThemeOverrides(isDark: boolean): GlobalThemeOverrides {
  return {
    common: {
      primaryColor: isDark ? '#D4956A' : '#C17F59',
      primaryColorHover: isDark ? '#E8A87A' : '#A86B47',
      primaryColorPressed: isDark ? '#C17F59' : '#8F5A3A',
      borderRadius: '8px',
      fontFamily: 'Manrope, "PingFang SC", "Microsoft YaHei", sans-serif',
      fontSize: '13px',
      fontSizeMini: '11px',
      fontSizeSmall: '12px',
      fontSizeMedium: '13px',
      fontSizeLarge: '15px',
      textColor1: isDark ? '#E8E0D4' : '#3D3832',
      textColor2: isDark ? '#C4BCB0' : '#5C554C',
      textColor3: isDark ? '#9A8F82' : '#9A8F82',
      bodyColor: isDark ? '#1E1C1A' : '#FAF7F2',
      cardColor: isDark ? '#2A2724' : '#FFFFFF',
      modalColor: isDark ? '#2A2724' : '#FFFFFF',
      popoverColor: isDark ? '#2A2724' : '#FFFFFF',
      dividerColor: isDark ? '#3D3832' : '#E8E0D4',
      borderColor: isDark ? '#3D3832' : '#E8E0D4',
    },
    Card: {
      borderRadius: '12px',
      color: isDark ? '#2A2724' : '#FFFFFF',
    },
    Button: {
      borderRadiusMedium: '6px',
      borderRadiusSmall: '6px',
    },
    Input: {
      borderRadius: '6px',
    },
    Drawer: {
      borderRadius: '0px',
    },
    Menu: {
      borderRadius: '8px',
    },
  };
}

let systemMediaQuery: MediaQueryList | null = null;
let systemListener: ((e: MediaQueryListEvent) => void) | null = null;

function setupSystemListener() {
  if (typeof window === 'undefined') return;
  systemMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  systemListener = () => {
    if (currentThemeId.value === 'system') {
      resolvedDark.value = systemMediaQuery!.matches;
      applyDocumentTheme(resolvedDark.value);
    }
  };
  systemMediaQuery.addEventListener('change', systemListener);
}

function teardownSystemListener() {
  if (systemMediaQuery && systemListener) {
    systemMediaQuery.removeEventListener('change', systemListener);
  }
}

export function useCraftTheme() {
  const isDark = computed(() => {
    if (currentThemeId.value === 'system') {
      return resolvedDark.value;
    }
    return currentThemeId.value === 'craft-dark';
  });

  const naiveTheme = computed(() => (isDark.value ? darkTheme : null));
  const themeOverrides = computed(() => buildCraftThemeOverrides(isDark.value));

  function setTheme(themeId: CraftThemeId | string) {
    const migrated = migrateThemeId(themeId);
    currentThemeId.value = migrated;
    if (migrated === 'system') {
      resolvedDark.value = resolveSystemDark();
      applyDocumentTheme(resolvedDark.value);
    } else {
      applyDocumentTheme(migrated === 'craft-dark');
    }
  }

  function initTheme(themeId?: string) {
    const migrated = migrateThemeId(themeId || 'craft-light');
    currentThemeId.value = migrated;
    if (migrated === 'system') {
      resolvedDark.value = resolveSystemDark();
      setupSystemListener();
    }
    applyDocumentTheme(
      migrated === 'craft-dark' || (migrated === 'system' && resolvedDark.value)
    );
  }

  watch(currentThemeId, (id) => {
    if (id === 'system') {
      resolvedDark.value = resolveSystemDark();
      setupSystemListener();
    } else {
      teardownSystemListener();
    }
  });

  return {
    currentThemeId,
    isDark,
    naiveTheme,
    themeOverrides,
    setTheme,
    initTheme,
    migrateThemeId,
  };
}
