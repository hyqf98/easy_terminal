<template>
  <AppModal
    :open="open"
    :title="title"
    subtitle="在画布上创建一个新的终端窗口"
    :icon="icon"
    size="sm"
    @close="onCancel"
    @update:open="onUpdateOpen"
  >
    <div class="terminal-modal-body">
      <div class="field">
        <div class="field-label">终端名称</div>
        <input
          class="input"
          type="text"
          v-model="formName"
          :placeholder="namePlaceholder"
          maxlength="40"
        />
      </div>

      <div class="field">
        <div class="field-label">工作目录</div>
        <div class="field-with-prefix">
          <span class="field-prefix">cd </span>
          <input
            class="input code with-prefix"
            type="text"
            v-model="formCwd"
            :placeholder="cwdPlaceholder"
            spellcheck="false"
          />
        </div>
      </div>

      <div class="field">
        <div class="field-label">Shell 类型</div>
        <div class="segmented">
          <button
            v-for="option in shellOptions"
            :key="option.value"
            type="button"
            :class="['segmented-item', { active: formShell === option.value }]"
            @click="formShell = option.value"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <div class="field">
        <div class="field-label">启动命令</div>
        <textarea
          class="textarea code"
          v-model="formStartupCommand"
          :placeholder="commandPlaceholder"
          rows="2"
          spellcheck="false"
        ></textarea>
        <div class="field-hint">可选，终端启动后自动执行该命令</div>
      </div>
    </div>

    <template #footer>
      <button class="btn btn-ghost" @click="onCancel">取消</button>
      <button class="btn btn-primary" @click="onCreate">
        <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
        创建终端
      </button>
    </template>
  </AppModal>
</template>
<script src="./TerminalModal.ts"></script>
<style src="./TerminalModal.css" scoped></style>
