import { defineComponent, ref, computed, watch } from 'vue';
import AppModal from '../AppModal.vue';
import { t } from '../../i18n';
import { showMessage } from '../../composables/useAppMessage';
import type { CommandMapping } from '../../types';

/** 链接图标，表达「自然语言 → 真实命令」的映射关系 */
const LINK_ICON = '<svg viewBox="0 0 24 24"><path d="M7 8l-4 4 4 4"/><path d="M17 8l4 4-4 4"/><path d="M14 4l-4 16"/></svg>';

export default defineComponent({
  name: 'MappingModal',
  components: { AppModal },
  props: {
    open: { type: Boolean, default: false },
    mapping: { type: Object as () => CommandMapping | null, default: null },
  },
  emits: ['close', 'update:open', 'save'],
  setup(props, { emit }) {
    const trigger = ref('');
    const command = ref('');
    const description = ref('');
    const tags = ref<string[]>([]);
    const enabled = ref(true);
    const tagInputValue = ref('');
    const tagInputEl = ref<HTMLInputElement | null>(null);

    const isEditing = computed(() => !!props.mapping);

    // 打开时根据传入映射初始化表单
    watch(
      () => props.open,
      (open) => {
        if (!open) return;
        const source = props.mapping;
        if (source) {
          trigger.value = source.trigger;
          command.value = source.command;
          description.value = source.description;
          tags.value = [...source.tags];
          enabled.value = source.enabled;
        } else {
          trigger.value = '';
          command.value = '';
          description.value = '';
          tags.value = [];
          enabled.value = true;
        }
        tagInputValue.value = '';
      }
    );

    function addTag() {
      const value = tagInputValue.value.trim().replace(/,+$/, '').trim();
      if (!value) return;
      if (!tags.value.includes(value)) tags.value.push(value);
      tagInputValue.value = '';
    }

    function removeTag(index: number) {
      tags.value.splice(index, 1);
    }

    function onTagKeydown(event: KeyboardEvent) {
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        addTag();
      } else if (event.key === 'Backspace' && !tagInputValue.value && tags.value.length) {
        tags.value.pop();
      }
    }

    function focusTagInput() {
      tagInputEl.value?.focus();
    }

    function close() {
      emit('close');
      emit('update:open', false);
    }

    function onUpdateOpen(value: boolean) {
      if (!value) close();
    }

    function save() {
      if (!trigger.value.trim() || !command.value.trim()) {
        showMessage(t('mapping.required'), 'warning');
        return;
      }
      const base = props.mapping;
      const draft: CommandMapping = {
        id: base?.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        trigger: trigger.value.trim(),
        command: command.value.trim(),
        description: description.value.trim(),
        tags: [...tags.value],
        examples: base?.examples || [],
        platforms: base?.platforms || [],
        hint: base?.hint,
        enabled: enabled.value,
        sourceType: base?.sourceType || 'user',
      };
      emit('save', draft);
      close();
    }

    return {
      trigger, command, description, tags, enabled,
      tagInputValue, tagInputEl,
      isEditing, linkIcon: LINK_ICON,
      addTag, removeTag, onTagKeydown, focusTagInput, close, save, onUpdateOpen,
      titleLabel: computed(() => (isEditing.value ? t('mapping.edit') : t('mapping.new'))),
      subtitleLabel: t('mapping.modalSubtitle'),
      triggerLabel: computed(() => t('mapping.triggerPhrase')),
      triggerHint: t('mapping.triggerHint'),
      triggerPlaceholder: t('mapping.triggerPlaceholder'),
      commandLabel: computed(() => t('mapping.realCommand')),
      commandHint: t('mapping.commandHint'),
      commandPlaceholder: t('mapping.commandPlaceholder'),
      descriptionLabel: computed(() => t('cmd.description')),
      descriptionPlaceholder: t('mapping.descriptionPlaceholder'),
      tagsLabel: computed(() => t('cmd.tags')),
      tagsPlaceholder: t('mapping.tagsPlaceholder'),
      enabledLabel: computed(() => t('mapping.enabled')),
      disabledLabel: computed(() => t('mapping.disabled')),
      cancelLabel: computed(() => t('cmd.cancel')),
      saveLabel: computed(() => t('mapping.saveMapping')),
    };
  },
});
