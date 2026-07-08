<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="open" class="modal-overlay" @mousedown="onOverlayMouseDown" @mouseup="onOverlayMouseUp">
        <div class="modal" :class="size" @mousedown.stop>
          <header class="modal-header">
            <div class="modal-title">
              <div v-if="icon" class="modal-title-icon" :class="{ danger: variant === 'danger' }" v-html="icon"></div>
              <div>
                <div>{{ title }}</div>
                <div v-if="subtitle" class="modal-title-sub">{{ subtitle }}</div>
              </div>
            </div>
            <button class="modal-close" @click="$emit('close')" aria-label="关闭">
              <svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </header>
          <div class="modal-body"><slot /></div>
          <footer v-if="$slots.footer" class="modal-footer"><slot name="footer" /></footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
<script src="./AppModal.ts"></script>
