<template>
  <div class="page ssh-page">
    <div class="page-header">
      <div>
        <div class="page-title">
          <div class="page-title-icon">
            <svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
          </div>
          {{ titleLabel }}
        </div>
        <div class="page-subtitle">{{ subtitleLabel }}</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost" @click="testSelected" :disabled="!selectedProfile">
          <svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-9-9" /><path d="M21 3v6h-6" /></svg>
          {{ testLabel }}
        </button>
        <button class="btn btn-primary" @click="openAdd">
          <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          {{ addLabel }}
        </button>
      </div>
    </div>

    <div class="ssh-layout">
      <aside class="ssh-list-pane">
        <div class="ssh-list-head">
          <h3>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
            SSH 连接
            <span class="tag tag-accent" style="margin-left:auto">{{ profiles.length }}</span>
          </h3>
          <div class="search-input">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
            <input v-model="searchKeyword" :placeholder="searchPlaceholder" />
          </div>
        </div>
        <div class="ssh-list-body">
          <div v-if="filteredGrouped.length === 0" class="ssh-empty">{{ emptyLabel }}</div>
          <div
            v-for="group in filteredGrouped"
            :key="group.name"
            class="ssh-group"
            :class="{ collapsed: !isGroupExpanded(group.name) }"
          >
            <div class="ssh-group-header" @click="toggleGroup(group.name)">
              <span class="ssh-chevron">
                <svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9" /></svg>
              </span>
              <span class="ssh-group-name">{{ group.name }}</span>
              <span class="ssh-group-count">{{ group.profiles.length }}</span>
            </div>
            <div class="ssh-group-list">
              <div
                v-for="profile in group.profiles"
                :key="profile.id"
                class="ssh-host"
                :class="{ selected: selectedProfileId === profile.id }"
                @click="selectProfile(profile)"
                @dblclick="connectProfile(profile)"
              >
                <div class="ssh-host-auth">
                  <svg v-if="profile.authType === 'key'" viewBox="0 0 24 24"><circle cx="8" cy="10" r="3" /><path d="M11 10h10v3h-3v3h-3v-3h-4z" /></svg>
                  <svg v-else viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                </div>
                <div class="ssh-host-info">
                  <div class="ssh-host-name">{{ profile.name || profile.host }}</div>
                  <div class="ssh-host-addr">{{ profile.user }}@{{ profile.host }}:{{ profile.port }}</div>
                </div>
                <span class="ssh-host-state offline" :title="stateLabel"></span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div class="ssh-detail-pane">
        <template v-if="selectedProfile">
          <div class="ssh-detail-head">
            <div class="ssh-detail-title">
              <span class="status-pulse" :class="statePulseClass"></span>
              {{ selectedProfile.name || selectedProfile.host }}
              <span class="tag tag-accent">{{ authTypeLabel }}</span>
            </div>
            <div class="ssh-detail-sub">
              {{ selectedProfile.user }}@{{ selectedProfile.host }}:{{ selectedProfile.port }}
            </div>
          </div>
          <div class="ssh-detail-body">
            <div class="ssh-info-grid">
              <div class="ssh-info-card">
                <div class="ssh-info-label">主机地址</div>
                <div class="ssh-info-value">{{ selectedProfile.host }}</div>
              </div>
              <div class="ssh-info-card">
                <div class="ssh-info-label">端口</div>
                <div class="ssh-info-value">{{ selectedProfile.port }}</div>
              </div>
              <div class="ssh-info-card">
                <div class="ssh-info-label">登录用户</div>
                <div class="ssh-info-value">{{ selectedProfile.user }}</div>
              </div>
              <div class="ssh-info-card">
                <div class="ssh-info-label">认证方式</div>
                <div class="ssh-info-value">{{ authTypeLabel }}</div>
              </div>
            </div>

            <div v-if="jumpChain.length > 0" class="ssh-jump-card">
              <div class="ssh-jump-title">跳板机链路 ProxyJump</div>
              <div class="ssh-jump-chain">
                <template v-for="(node, index) in jumpChain" :key="index">
                  <span class="ssh-jump-node">{{ node }}</span>
                  <span v-if="index < jumpChain.length - 1" class="ssh-jump-arrow">→</span>
                </template>
                <span class="ssh-jump-hop">{{ jumpChain.length }} 跳</span>
              </div>
            </div>

            <div class="ssh-detail-actions">
              <button class="btn btn-primary ssh-action-primary" @click="connectProfile(selectedProfile)">
                <svg viewBox="0 0 24 24"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>
                新建终端连接
              </button>
              <button class="btn btn-ghost" @click="testSelected" :disabled="testing">
                <svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-9-9" /><path d="M21 3v6h-6" /></svg>
                测试连接
              </button>
              <button class="btn btn-ghost" @click="editProfile(selectedProfile)">
                <svg viewBox="0 0 24 24"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                编辑
              </button>
              <button class="btn btn-ghost ssh-action-danger" @click="confirmDelete(selectedProfile)">
                <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                删除
              </button>
            </div>

            <div class="ssh-recent">
              <div class="ssh-recent-title">最近在此主机执行的命令</div>
              <div v-if="recentCommands.length === 0" class="ssh-recent-empty">{{ recentEmptyLabel }}</div>
              <div v-for="item in recentCommands" :key="item.id" class="ssh-recent-row">
                <span class="ssh-recent-cmd">{{ item.command }}</span>
                <span class="ssh-recent-time">{{ item.time }}</span>
              </div>
            </div>
          </div>
        </template>
        <div v-else class="ssh-detail-empty">
          <div class="ssh-detail-empty-icon">
            <svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
          </div>
          <div class="ssh-detail-empty-title">{{ detailEmptyTitle }}</div>
          <div class="ssh-detail-empty-desc">{{ detailEmptyDesc }}</div>
        </div>
      </div>
    </div>

    <SshHostModal
      :open="hostModalOpen"
      :profile="editingProfile"
      :groups="existingGroups"
      :jump-candidates="jumpCandidates"
      @close="closeHostModal"
      @update:open="hostModalOpen = $event"
      @save="onHostSave"
      @test="onHostTest"
    />

    <DeleteConfirmModal
      :open="deleteModalOpen"
      :message="deleteMessage"
      positive-text="永久删除"
      @close="deleteModalOpen = false"
      @update:open="deleteModalOpen = $event"
      @confirm="onConfirmDelete"
    />
  </div>
</template>
<script src="./SshPanel.ts"></script>
<style src="./SshPanel.css" scoped></style>
