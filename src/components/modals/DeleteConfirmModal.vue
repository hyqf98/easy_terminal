<template>
  <AppModal
    :open="open"
    :title="title"
    :icon="icon"
    size="sm"
    variant="danger"
    @close="$emit('close')"
    @update:open="(value) => $emit('update:open', value)"
  >
    <div class="danger-banner">
      <div class="danger-banner-icon">
        <svg viewBox="0 0 24 24"><path d="M10.3 3.86l-8.6 14.94A2 2 0 0 0 3.42 21h17.16a2 2 0 0 0 1.72-3.2L13.7 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>
      </div>
      <div class="danger-banner-text" v-if="message" v-html="message"></div>
      <div class="danger-banner-text" v-else>
        <slot name="message">
          <span>此操作不可撤销，请确认后继续。</span>
        </slot>
      </div>
    </div>
    <slot />
    <template #footer>
      <slot name="footer">
        <button class="btn btn-ghost" @click="$emit('close')">{{ negativeText }}</button>
        <button class="btn btn-danger" :disabled="confirmDisabled" @click="onConfirm">{{ positiveText }}</button>
      </slot>
    </template>
  </AppModal>
</template>
<script src="./DeleteConfirmModal.ts"></script>
<style src="./DeleteConfirmModal.css" scoped></style>
