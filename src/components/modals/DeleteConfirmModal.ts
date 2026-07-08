import { defineComponent, computed } from 'vue';
import AppModal from '../AppModal.vue';

export default defineComponent({
  name: 'DeleteConfirmModal',
  components: { AppModal },
  props: {
    open: { type: Boolean, default: false },
    title: { type: String, default: '删除确认' },
    /** 富文本提示文案，支持 HTML（用于强调名称等）；若留空则使用 message slot */
    message: { type: String, default: '' },
    positiveText: { type: String, default: '永久删除' },
    negativeText: { type: String, default: '取消' },
    /** 是否禁用确认按钮（如未输入确认名称） */
    confirmDisabled: { type: Boolean, default: false },
  },
  emits: ['close', 'update:open', 'confirm'],
  setup(_, { emit }) {
    const icon = computed(
      () =>
        '<svg viewBox="0 0 24 24"><path d="M10.3 3.86l-8.6 14.94A2 2 0 0 0 3.42 21h17.16a2 2 0 0 0 1.72-3.2L13.7 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>'
    );

    function onConfirm() {
      emit('confirm');
    }

    return { icon, onConfirm };
  },
});
