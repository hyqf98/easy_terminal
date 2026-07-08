import { defineComponent, ref, computed, watch } from 'vue';
import AppModal from '../AppModal.vue';
import { t } from '../../i18n';

export interface FileModalCreatePayload {
  name: string;
  type: 'file' | 'folder';
  content?: string;
}

export default defineComponent({
  name: 'FileModal',
  components: { AppModal },
  props: {
    open: { type: Boolean, default: false },
    /** 创建目标的父目录绝对路径 */
    parentPath: { type: String, default: '' },
    /** 默认类型：文件 / 文件夹 */
    mode: { type: String as () => 'file' | 'folder', default: 'file' },
  },
  emits: ['close', 'update:open', 'create'],
  setup(props, { emit }) {
    const subtitle = '在当前目录下创建文件或文件夹';
    const icon =
      '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';

    const formType = ref<'file' | 'folder'>('file');
    const formName = ref('');
    const formContent = ref('');

    watch(
      () => props.open,
      (isOpen) => {
        if (isOpen) {
          formType.value = props.mode;
          formName.value = '';
          formContent.value = '';
        }
      }
    );
    watch(
      () => props.mode,
      (mode) => {
        formType.value = mode;
      }
    );

    const modalTitle = computed(() =>
      formType.value === 'file' ? t('file.newFile') : t('file.newFolder')
    );
    const fileLabel = computed(() => t('file.newFile'));
    const folderLabel = computed(() => t('file.newFolder'));
    const fileNameLabel = computed(() => t('file.fileName'));
    const folderNameLabel = computed(() => t('file.folderName'));
    const parentDirLabel = computed(() => '父目录');
    const contentLabel = computed(() => '初始内容');
    const contentHint = computed(() => '可选');
    const cancelLabel = computed(() => '取消');
    const createLabel = computed(() => '创建');

    const namePlaceholder = computed(() =>
      formType.value === 'file' ? 'main.ts' : 'components'
    );
    const contentPlaceholder = computed(() => '输入文件初始内容...');

    const canCreate = computed(() => formName.value.trim().length > 0);

    function close() {
      emit('close');
      emit('update:open', false);
    }

    function onUpdateOpen(value: boolean) {
      emit('update:open', value);
      if (!value) emit('close');
    }

    function onCreate() {
      const name = formName.value.trim();
      if (!name) return;
      const payload: FileModalCreatePayload =
        formType.value === 'file'
          ? { name, type: 'file', content: formContent.value }
          : { name, type: 'folder' };
      emit('create', payload);
      close();
    }

    return {
      subtitle,
      icon,
      formType,
      formName,
      formContent,
      modalTitle,
      fileLabel,
      folderLabel,
      fileNameLabel,
      folderNameLabel,
      parentDirLabel,
      contentLabel,
      contentHint,
      namePlaceholder,
      contentPlaceholder,
      cancelLabel,
      createLabel,
      canCreate,
      close,
      onUpdateOpen,
      onCreate,
    };
  },
});
