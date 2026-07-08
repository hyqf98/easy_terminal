import { defineComponent, reactive, computed, watch } from 'vue';
import AppModal from '../AppModal.vue';
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
  scope: 'both' | 'local' | 'ssh';
  tags: string[];
  tagInput: string;
}

export default defineComponent({
  name: 'CommandModal',
  components: { AppModal },
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
      scope: 'both',
      tags: [],
      tagInput: '',
    });

    const modalTitle = computed(() => (props.command ? t('cmd.editCmd') : t('cmd.addCmd')));
    const subtitle = '保存到我的收藏分类';

    const scopeOptions = computed<Array<{ value: CommandFormState['scope']; label: string }>>(() => [
      { value: 'both', label: '本地 + SSH' },
      { value: 'local', label: '仅本地' },
      { value: 'ssh', label: '仅 SSH' },
    ]);

    const categoryOptions = computed(() => {
      const set = new Set<string>(props.categories);
      if (form.category) set.add(form.category);
      return [...set].sort();
    });

    function resetForm() {
      form.id = undefined;
      form.name = '';
      form.command = '';
      form.description = '';
      form.category = '';
      form.scope = 'both';
      form.tags = [];
      form.tagInput = '';
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
          form.scope = 'both';
          form.tags = [...(props.command.tags || [])];
          form.tagInput = '';
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
      scopeOptions,
      categoryOptions,
      close,
      onUpdateOpen,
      addTag,
      removeTag,
      onTagKeydown,
      onSave,
    };
  },
});
