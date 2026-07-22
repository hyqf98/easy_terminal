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
    <div class="field">
      <div class="field-label">
        {{ t('vpn.modal.name') }}<span class="req">*</span>
      </div>
      <input
        class="input"
        v-model="form.name"
        :placeholder="t('vpn.modal.name')"
      />
    </div>
    <div class="field-row">
      <div class="field">
        <div class="field-label">{{ t('vpn.modal.group') }}</div>
        <AppSelect
          :model-value="form.group"
          :options="groupSelectOptions"
          @update:model-value="onGroupChange"
        />
      </div>
      <div class="field">
        <div class="field-label">{{ t('vpn.modal.auth_mode') }}</div>
        <div class="segmented">
          <button
            v-for="mode in authModes"
            :key="mode.value"
            type="button"
            class="segmented-item"
            :class="{ active: form.authMode === mode.value }"
            @click="form.authMode = mode.value"
          >
            {{ mode.label }}
          </button>
        </div>
      </div>
    </div>

    <hr class="section-divider" />
    <div class="section-label">服务器</div>
    <div class="field-row">
      <div class="field">
        <div class="field-label">
          {{ t('vpn.modal.server') }}<span class="req">*</span>
        </div>
        <input
          class="input code"
          v-model="form.serverHost"
          placeholder="vpn.example.com"
        />
      </div>
      <div class="field">
        <div class="field-label">{{ t('vpn.modal.port') }}</div>
        <input
          class="input code"
          type="number"
          min="1"
          max="65535"
          v-model.number="form.serverPort"
          placeholder="1194"
        />
      </div>
    </div>

    <template v-if="form.authMode === 'password'">
      <hr class="section-divider" />
      <div class="section-label">认证</div>
      <div class="field-row">
        <div class="field">
          <div class="field-label">{{ t('vpn.modal.username') }}</div>
          <input class="input" v-model="form.username" />
        </div>
        <div class="field">
          <div class="field-label">{{ t('vpn.modal.password') }}</div>
          <input
            class="input code"
            type="password"
            v-model="form.password"
          />
        </div>
      </div>
    </template>

    <hr class="section-divider" />
    <div class="section-label">{{ t('vpn.modal.ovpn_config') }}</div>
    <div class="field">
      <div class="vpn-ovpn-toolbar">
        <button class="btn btn-ghost vpn-import-btn" @click="importOvpnFile">
          <svg viewBox="0 0 24 24"><path d="M12 16V4M5 11l7-7 7 7" /><path d="M5 20h14" /></svg>
          {{ t('vpn.modal.import') }}
        </button>
      </div>
      <textarea
        class="textarea vpn-ovpn-textarea"
        v-model="form.ovpnConfig"
        :placeholder="t('vpn.modal.ovpn_placeholder')"
        rows="8"
      ></textarea>
    </div>

    <div class="field">
      <label class="vpn-checkbox-row">
        <input type="checkbox" v-model="form.autoConnect" />
        <span>{{ t('vpn.modal.auto_connect') }}</span>
      </label>
    </div>

    <template #footer>
      <button class="btn btn-ghost" @click="close">取消</button>
      <div class="spacer" />
      <button class="btn btn-primary" @click="onSave">保存配置</button>
    </template>
  </AppModal>
</template>
<script src="./VpnTunnelModal.ts"></script>
<style src="./VpnTunnelModal.css" scoped></style>
