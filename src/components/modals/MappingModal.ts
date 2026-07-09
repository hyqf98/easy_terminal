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
    const triggers = ref<string[]>([]);
    const command = ref('');
    const description = ref('');
    const tags = ref<string[]>([]);
    const enabled = ref(true);
    const tagInputValue = ref('');
    const tagInputEl = ref<HTMLInputElement | null>(null);
    const triggerInputValue = ref('');
    const triggerInputEl = ref<HTMLInputElement | null>(null);

    const isEditing = computed(() => !!props.mapping);

    // 打开时根据传入映射初始化表单（兼容旧版单 trigger 字段）
    watch(
      () => props.open,
      (open) => {
        if (!open) return;
        const source = props.mapping;
        if (source) {
          triggers.value = source.triggers && source.triggers.length
            ? [...source.triggers]
            : [];
          command.value = source.command;
          description.value = source.description;
          tags.value = [...source.tags];
          enabled.value = source.enabled;
        } else {
          triggers.value = [];
          command.value = '';
          description.value = '';
          tags.value = [];
          enabled.value = true;
        }
        tagInputValue.value = '';
        triggerInputValue.value = '';
      }
    );

    /** 提交一个触发短语为 chip */
    function addTrigger() {
      const value = triggerInputValue.value.trim().replace(/,+$/, '').trim();
      if (!value) return;
      if (!triggers.value.includes(value)) triggers.value.push(value);
      triggerInputValue.value = '';
    }

    /** 移除指定触发短语 */
    function removeTrigger(index: number) {
      triggers.value.splice(index, 1);
    }

    /** 触发短语输入键盘控制：Enter/逗号确认，空输入 Backspace 删除末项 */
    function onTriggerKeydown(event: KeyboardEvent) {
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        addTrigger();
      } else if (event.key === 'Backspace' && !triggerInputValue.value && triggers.value.length) {
        triggers.value.pop();
      }
    }

    function focusTriggerInput() {
      triggerInputEl.value?.focus();
    }

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
      // 提交输入框中残留的触发短语，避免遗漏
      addTrigger();
      if (!triggers.value.length || !command.value.trim()) {
        showMessage(t('mapping.required'), 'warning');
        return;
      }
      const base = props.mapping;
      const draft: CommandMapping = {
        id: base?.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        triggers: [...triggers.value],
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
      triggers, command, description, tags, enabled,
      tagInputValue, tagInputEl,
      triggerInputValue, triggerInputEl,
      isEditing, linkIcon: LINK_ICON,
      addTrigger, removeTrigger, onTriggerKeydown, focusTriggerInput,
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
