import { defineComponent, watch, nextTick, onBeforeUnmount } from 'vue';

export type ModalSize = 'sm' | 'md' | 'lg';
export type ModalVariant = 'default' | 'danger';

export default defineComponent({
  name: 'AppModal',
  props: {
    open: { type: Boolean, default: false },
    title: { type: String, required: true },
    subtitle: { type: String, default: '' },
    icon: { type: String, default: '' },
    size: { type: String as () => ModalSize, default: 'md' },
    variant: { type: String as () => ModalVariant, default: 'default' },
  },
  emits: ['close', 'update:open'],
  setup(props, { emit }) {
    let overlayMouseDownTarget: EventTarget | null = null;

    function close() {
      emit('close');
      emit('update:open', false);
    }

    function onOverlayMouseDown(event: MouseEvent) {
      overlayMouseDownTarget = event.target;
    }

    function onOverlayMouseUp(event: MouseEvent) {
      if (event.target === overlayMouseDownTarget && event.target === event.currentTarget) {
        close();
      }
      overlayMouseDownTarget = null;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && props.open) {
        event.preventDefault();
        close();
      }
    }

    watch(
      () => props.open,
      (isOpen) => {
        if (isOpen) {
          document.addEventListener('keydown', onKeyDown);
          void nextTick(() => {
            const modal = document.querySelector('.modal-overlay .modal');
            const firstInput = modal?.querySelector<HTMLElement>('input, textarea, select');
            firstInput?.focus();
          });
        } else {
          document.removeEventListener('keydown', onKeyDown);
        }
      }
    );

    onBeforeUnmount(() => {
      document.removeEventListener('keydown', onKeyDown);
    });

    return { onOverlayMouseDown, onOverlayMouseUp };
  },
});
