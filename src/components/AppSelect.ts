import { defineComponent, computed, type PropType } from 'vue';
import { NSelect } from 'naive-ui';
import type { SelectProps, GlobalThemeOverrides } from 'naive-ui';

export interface SelectOption {
  label: string;
  value: string | number;
}

export type AppSelectSize = 'small' | 'medium' | 'large';

/**
 * Craft 主题下的下拉选择器：
 * - 对 Naive UI n-select 做薄封装，通过 :theme-overrides 适配 Craft 配色。
 * - 颜色一律使用 CSS 变量字符串，跟随全局亮 / 暗主题切换。
 */
export default defineComponent({
  name: 'AppSelect',
  components: { NSelect },
  props: {
    modelValue: { type: [String, Number, Boolean] as PropType<unknown>, default: null },
    options: { type: Array as PropType<SelectOption[]>, default: () => [] },
    placeholder: { type: String, default: '' },
    size: {
      type: String as PropType<AppSelectSize>,
      default: 'small',
    },
    disabled: { type: Boolean, default: false },
    /** 自适应宽度：false 时撑满父容器，true 时按内容收缩 */
    fitContent: { type: Boolean, default: false },
  },
  emits: ['update:modelValue', 'change'],
  setup(props, { emit }) {
    // small 对齐现有 .settings-select 的 12px / 28px；medium 13px / 默认高度
    const fontSize = computed(() => (props.size === 'medium' ? '13px' : '12px'));

    // Naive UI Select 主题结构：self { menuBoxShadow } + peers { InternalSelection, InternalSelectMenu }
    const themeOverrides = computed<GlobalThemeOverrides>(() => ({
      Select: {
        menuBoxShadow: 'var(--shadow-lg)',
        peers: {
          InternalSelection: {
            color: 'var(--surface-muted)',
            colorActive: 'var(--surface)',
            border: '1px solid var(--border)',
            borderHover: '1px solid var(--accent)',
            borderFocus: '1px solid var(--accent)',
            borderActive: '1px solid var(--accent)',
            borderRadius: 'var(--radius-sm)',
            textColor: 'var(--text)',
            caretColor: 'var(--accent)',
            arrowColor: 'var(--text-muted)',
            fontSize: fontSize.value,
          },
          InternalSelectMenu: {
            color: 'var(--surface)',
            borderRadius: 'var(--radius-md)',
            optionTextColor: 'var(--text)',
            optionTextColorActive: 'var(--accent)',
            optionColorPending: 'color-mix(in srgb, var(--accent) 6%, transparent)',
            optionColorActive: 'var(--accent-soft)',
            optionColorActivePending: 'var(--accent-soft)',
          },
        },
      },
    }));

    const nSelectSize = computed<SelectProps['size']>(() =>
      props.size === 'medium' ? 'medium' : props.size === 'large' ? 'large' : 'small'
    );

    function onUpdateValue(value: unknown) {
      emit('update:modelValue', value);
      emit('change', value);
    }

    return { themeOverrides, nSelectSize, onUpdateValue };
  },
});
