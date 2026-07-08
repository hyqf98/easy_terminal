<template>
  <AppModal
    :open="open"
    :title="modalTitle"
    :subtitle="subtitle"
    :icon="icon"
    size="lg"
    @close="close"
    @update:open="onUpdateOpen"
  >
    <div class="section-label">基本信息</div>
    <div class="field-row">
      <div class="field">
        <div class="field-label">显示名称<span class="req">*</span></div>
        <input
          class="input"
          v-model="form.name"
          :placeholder="namePlaceholder"
        />
      </div>
      <div class="field">
        <div class="field-label">分组</div>
        <select class="select" v-model="form.group">
          <option value="">未分组</option>
          <option v-for="groupName in groupOptions" :key="groupName" :value="groupName">
            {{ groupName }}
          </option>
        </select>
      </div>
    </div>
    <div class="field-row-3">
      <div class="field">
        <div class="field-label">主机地址<span class="req">*</span></div>
        <input class="input code" v-model="form.host" placeholder="10.0.1.21" />
      </div>
      <div class="field">
        <div class="field-label">端口</div>
        <input
          class="input code"
          type="number"
          min="1"
          max="65535"
          v-model.number="form.port"
          placeholder="22"
        />
      </div>
      <div class="field">
        <div class="field-label">登录用户<span class="req">*</span></div>
        <input class="input code" v-model="form.user" placeholder="deployer" />
      </div>
    </div>

    <hr class="section-divider" />
    <div class="section-label">认证方式</div>
    <div class="field">
      <div class="segmented">
        <button
          type="button"
          class="segmented-item"
          :class="{ active: form.authType === 'key' }"
          @click="form.authType = 'key'"
        >
          <svg viewBox="0 0 24 24"><circle cx="8" cy="10" r="3" /><path d="M11 10h10v3h-3v3h-3v-3h-4z" /></svg>
          SSH 密钥
        </button>
        <button
          type="button"
          class="segmented-item"
          :class="{ active: form.authType === 'password' }"
          @click="form.authType = 'password'"
        >
          <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
          密码
        </button>
      </div>
    </div>
    <div v-if="form.authType === 'key'" class="field">
      <div class="field-label">密钥文件路径</div>
      <div class="field-with-prefix">
        <span class="field-prefix">~/</span>
        <input
          class="input code with-prefix"
          v-model="privateKeyTail"
          :placeholder="keyPathPlaceholder"
        />
      </div>
    </div>
    <div v-else class="field">
      <div class="field-label">登录密码</div>
      <input
        class="input code"
        type="password"
        v-model="form.password"
        :placeholder="passwordPlaceholder"
      />
    </div>

    <hr class="section-divider" />
    <div class="section-label">跳板机 (ProxyJump)</div>
    <div class="field">
      <div class="field-label">跳板主机</div>
      <select class="select" v-model="form.jumpProfileId">
        <option value="">不使用跳板</option>
        <option
          v-for="candidate in jumpCandidates"
          :key="candidate.id"
          :value="candidate.id"
        >
          {{ candidate.name }} ({{ candidate.user }}@{{ candidate.host }})
        </option>
      </select>
    </div>
    <div class="field">
      <div class="field-label">备注</div>
      <input class="input" v-model="form.note" placeholder="主机用途、注意事项等" />
    </div>

    <template #footer>
      <button class="btn btn-ghost" :disabled="testing" @click="onTest">
        <svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-9-9" /><path d="M21 3v6h-6" /></svg>
        {{ testing ? '测试中...' : testLabel }}
      </button>
      <div class="spacer" />
      <button class="btn btn-ghost" @click="close">取消</button>
      <button class="btn btn-primary" @click="onSave">保存主机</button>
    </template>
  </AppModal>
</template>
<script src="./SshHostModal.ts"></script>
<style src="./SshHostModal.css" scoped></style>
