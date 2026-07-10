import { defineComponent, computed } from 'vue';
import { useCraftTheme } from '../../composables/useCraftTheme';

export default defineComponent({
  name: 'Titlebar',
  emits: ['minimize', 'maximize', 'close', 'cmdk'],
  setup(_, { emit }) {
    const minimizeLabel = computed(() => 'Minimize');
    const maximizeLabel = computed(() => 'Maximize');
    const closeLabel = computed(() => 'Close');

    const { isDark, setTheme } = useCraftTheme();
    const themeLabel = computed(() => (isDark.value ? '暗色' : '亮色'));

    function toggleTheme() {
      setTheme(isDark.value ? 'craft-light' : 'craft-dark');
    }

    function onCmdk() {
      emit('cmdk');
    }

    return {
      minimizeLabel,
      maximizeLabel,
      closeLabel,
      isDark,
      themeLabel,
      toggleTheme,
      onCmdk,
    };
  },
});
