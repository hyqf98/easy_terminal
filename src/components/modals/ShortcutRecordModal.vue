<template>
  <AppModal
    :open="open"
    title="录制快捷键"
    :subtitle="actionName"
    :icon="icon"
    size="sm"
    @close="close"
    @update:open="(value: boolean) => $emit('update:open', value)"
  >
    <div class="keycapture recording shortcut-record-capture">
      <div class="keycapture-icon">
        <svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h0M10 10h0M14 10h0M18 10h0M6 14h12"/></svg>
      </div>
      <div class="keycapture-text">{{ hintLabel }}</div>
      <div class="keycapture-keys">
        <template v-for="(token, index) in displayTokens" :key="index">
          <span v-if="index > 0" class="keycap-plus">+</span>
          <span class="keycap">{{ token }}</span>
        </template>
        <span v-if="displayTokens.length === 0" class="shortcut-record-placeholder">···</span>
      </div>
      <div class="keycapture-hint">Esc 取消 · Enter 确认</div>
    </div>
    <template #footer>
      <button class="btn btn-ghost" @click="close">取消</button>
      <button class="btn btn-soft" :disabled="!hasCombo" @click="clearCombo">清除</button>
      <button class="btn btn-primary" :disabled="!hasCombo" @click="onConfirm">确认</button>
    </template>
  </AppModal>
</template>
<script src="./ShortcutRecordModal.ts"></script>
<style src="./ShortcutRecordModal.css" scoped></style>
