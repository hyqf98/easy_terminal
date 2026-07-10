import { defineComponent, reactive, computed, watch } from 'vue';
import AppModal from '../AppModal.vue';
import AppSelect from '../AppSelect.vue';
import type { SelectOption } from '../AppSelect';
import { showMessage } from '../../composables/useAppMessage';
import { t } from '../../i18n';
import type { CommandEntry } from '../../types';

/** 表单内部结构：CommandEntry 加上 scope 这个仅 UI 用的执行范围字段 */
interface CommandFormState {
  id?: number;
  name: string;
  command: string;
  description: string;
  category: string;
  tags: string[];
  tagInput: string;
  triggers: string[];
  triggerInput: string;
}

export default defineComponent({
  name: 'CommandModal',
  components: { AppModal, AppSelect },
  props: {
    open: { type: Boolean, default: false },
    /** 编辑时传入已有命令；新建时传 null */
    command: { type: Object as () => CommandEntry | null, default: null },
    /** 可选分类列表 */
    categories: { type: Array as () => string[], default: () => [] },
  },
  emits: ['close', 'update:open', 'save'],
  setup(props, { emit }) {
    // 书本 SVG 图标
    const icon =
      '<svg viewBox="0 0 24 24"><path d="M4 4h6v16H4z"/><path d="M10 4h4v16h-4z"/><path d="M14 4l6 1-3 15-6-1z"/></svg>';

    const form = reactive<CommandFormState>({
      name: '',
      command: '',
      description: '',
      category: '',
      tags: [],
      tagInput: '',
      triggers: [],
      triggerInput: '',
    });

    const modalTitle = computed(() => (props.command ? t('cmd.editCmd') : t('cmd.addCmd')));
    const subtitle = '保存到我的收藏分类';

    const categoryOptions = computed(() => {
      const set = new Set<string>(props.categories);
      if (form.category) set.add(form.category);
      return [...set].sort();
    });

    // AppSelect 所需的 options：固定“我的收藏”置顶 + 动态分类
    const categorySelectOptions = computed<SelectOption[]>(() => [
      { label: '我的收藏', value: '' },
      ...categoryOptions.value.map((name) => ({ label: name, value: name })),
    ]);

    function resetForm() {
      form.id = undefined;
      form.name = '';
      form.command = '';
      form.description = '';
      form.category = '';
      form.tags = [];
      form.tagInput = '';
      form.triggers = [];
      form.triggerInput = '';
    }

    /** 打开时根据 command 初始化表单 */
    watch(
      () => props.open,
      (isOpen) => {
        if (!isOpen) return;
        if (props.command) {
          form.id = props.command.id;
          form.name = props.command.name;
          form.command = props.command.command;
          form.description = props.command.description || '';
          form.category = props.command.category || '';
          form.tags = [...(props.command.tags || [])];
          form.tagInput = '';
          form.triggers = [...(props.command.triggers || [])];
          form.triggerInput = '';
        } else {
          resetForm();
        }
      },
      { immediate: true }
    );

    function close() {
      emit('close');
      emit('update:open', false);
    }

    function onUpdateOpen(value: boolean) {
      emit('update:open', value);
      if (!value) emit('close');
    }

    function addTag() {
      const value = form.tagInput.trim();
      if (!value) return;
      if (!form.tags.includes(value)) {
        form.tags.push(value);
      }
      form.tagInput = '';
    }

    function removeTag(index: number) {
      form.tags.splice(index, 1);
    }

    function onTagKeydown(event: KeyboardEvent) {
      if (event.key === 'Enter') {
        event.preventDefault();
        addTag();
      } else if (event.key === 'Backspace' && !form.tagInput && form.tags.length > 0) {
        form.tags.pop();
      }
    }

    function addTrigger() {
      const value = form.triggerInput.trim();
      if (!value) return;
      if (!form.triggers.includes(value)) {
        form.triggers.push(value);
      }
      form.triggerInput = '';
    }

    function removeTrigger(index: number) {
      form.triggers.splice(index, 1);
    }

    function onTriggerKeydown(event: KeyboardEvent) {
      if (event.key === 'Enter') {
        event.preventDefault();
        addTrigger();
      } else if (event.key === 'Backspace' && !form.triggerInput && form.triggers.length > 0) {
        form.triggers.pop();
      }
    }

    // AppSelect 值回调（模板中无法使用 as 类型断言，故在此做类型收窄）
    function onCategoryChange(value: unknown) {
      form.category = String(value ?? '');
    }

    function buildEntry(): CommandEntry {
      return {
        id: form.id,
        name: form.name.trim(),
        command: form.command.trim(),
        name_cn: '',
        description: form.description.trim(),
        usage: form.command.trim(),
        category: form.category.trim() || '我的收藏',
        alias: [],
        tags: [...form.tags],
        triggers: [...form.triggers],
        examples: [],
        hint: '',
        enabled: true,
      };
    }

    function onSave() {
      if (!form.name.trim() || !form.command.trim()) {
        showMessage(t('cmd.nameRequired'), 'warning');
        return;
      }
      emit('save', buildEntry());
    }

    return {
      icon,
      form,
      modalTitle,
      subtitle,
      categoryOptions,
      categorySelectOptions,
      close,
      onUpdateOpen,
      onCategoryChange,
      addTag,
      removeTag,
      onTagKeydown,
      addTrigger,
      removeTrigger,
      onTriggerKeydown,
      onSave,
    };
  },
});
