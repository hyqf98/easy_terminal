<template>
  <div class="page vpn-page">
    <div class="vpn-layout">
      <!-- ===== 左侧：配置列表 ===== -->
      <aside class="vpn-list-pane">
        <div class="vpn-list-head">
          <h3>
            <span class="vpn-list-icon">
              <Icon :size="16"><ShieldLock /></Icon>
            </span>
            <span class="page-title">{{ titleLabel }}</span>
            <span class="tag tag-accent vpn-count-tag">{{ filteredGrouped.length }}</span>
            <button class="vpn-add-btn" type="button" :data-tooltip="addLabel" :aria-label="addLabel" @click="openAdd">
              <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            </button>
          </h3>
          <div class="search-input">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
            <input v-model="searchKeyword" :placeholder="searchPlaceholder" />
          </div>
        </div>
        <div class="vpn-list-body">
          <div v-if="filteredGrouped.length === 0" class="vpn-empty">{{ emptyLabel }}</div>
          <div
            v-for="group in filteredGrouped"
            :key="group.name"
            class="vpn-group"
            :class="{ collapsed: !isGroupExpanded(group.name) }"
          >
            <div class="vpn-group-header" @click="toggleGroup(group.name)">
              <span class="vpn-chevron">
                <svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9" /></svg>
              </span>
              <span class="vpn-group-name">{{ group.name || ungroupedLabel }}</span>
              <span class="tag tag-muted vpn-group-count">{{ group.profiles.length }}</span>
            </div>
            <div class="vpn-group-list">
              <div
                v-for="profile in group.profiles"
                :key="profile.id"
                class="vpn-tunnel"
                :class="{ selected: profile.id === selectedProfileId }"
                @click="selectProfile(profile)"
                @dblclick="connectProfile(profile)"
              >
                <div class="vpn-tunnel-auth" :class="profile.authMode">
                  <svg v-if="profile.authMode === 'cert'" viewBox="0 0 24 24"><path d="M12 2l9 4v6c0 5-3.5 8.5-9 10-5.5-1.5-9-5-9-10V6l9-4z" /><path d="M9 12l2 2 4-4" /></svg>
                  <svg v-else-if="profile.authMode === 'password'" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                  <svg v-else viewBox="0 0 24 24"><circle cx="8" cy="10" r="3" /><path d="M11 10h10v3h-3v3h-3v-3h-4z" /></svg>
                </div>
                <div class="vpn-tunnel-info">
                  <div class="vpn-tunnel-name">{{ profile.name || profile.serverHost }}</div>
                  <div class="vpn-tunnel-addr">{{ profile.serverHost }}:{{ profile.serverPort }}</div>
                </div>
                <span class="vpn-tunnel-state" :class="getTunnelStateClass(profile.id)" :data-tooltip="getTunnelStateText(profile.id)"></span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <!-- ===== 右侧：详情面板 ===== -->
      <div class="vpn-detail-pane">
        <template v-if="selectedProfile">
          <div class="vpn-detail-head">
            <div class="vpn-detail-title">
              <span class="status-pulse" :class="getStatusPulseClass(selectedProfile.id)"></span>
              <span class="page-title">{{ selectedProfile.name || selectedProfile.serverHost }}</span>
              <span class="tag" :class="getStatusTagClass(selectedProfile.id)">{{ getStatusText(selectedProfile.id) }}</span>
            </div>
            <div class="vpn-detail-sub">
              {{ selectedProfile.serverHost }}:{{ selectedProfile.serverPort }} · {{ authModeText(selectedProfile.authMode) }}
            </div>
          </div>
          <div class="vpn-detail-body">
            <!-- 信息卡网格 -->
            <div class="section-label">{{ serverSectionLabel }}</div>
            <div class="vpn-info-grid">
              <div class="vpn-info-card">
                <div class="vpn-info-label">{{ serverLabel }}</div>
                <div class="vpn-info-value">{{ selectedProfile.serverHost || '--' }}</div>
              </div>
              <div class="vpn-info-card">
                <div class="vpn-info-label">PORT</div>
                <div class="vpn-info-value">{{ selectedProfile.serverPort }}</div>
              </div>
              <div class="vpn-info-card">
                <div class="vpn-info-label">AUTH</div>
                <div class="vpn-info-value">{{ authModeText(selectedProfile.authMode) }}</div>
              </div>
              <div class="vpn-info-card">
                <div class="vpn-info-label">{{ assignedIpLabel }}</div>
                <div class="vpn-info-value">{{ currentTunnelStatus?.ip || '--' }}</div>
              </div>
            </div>

            <!-- 流量统计（连接时显示） -->
            <template v-if="showTraffic">
              <div class="section-label">{{ trafficLabel }}</div>
              <div class="vpn-traffic">
                <div class="vpn-stat">
                  <span class="vpn-stat-label">↓ {{ trafficInLabel }}</span>
                  <span class="vpn-stat-value">{{ formatBytes(currentTunnelStatus?.bytesIn ?? 0) }}</span>
                </div>
                <div class="vpn-stat">
                  <span class="vpn-stat-label">↑ {{ trafficOutLabel }}</span>
                  <span class="vpn-stat-value">{{ formatBytes(currentTunnelStatus?.bytesOut ?? 0) }}</span>
                </div>
              </div>
            </template>

            <!-- 操作按钮 -->
            <div class="vpn-detail-actions">
              <button v-if="!isConnected(selectedProfile.id)" class="btn btn-primary vpn-action-primary" @click="connectProfile(selectedProfile)">
                <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                {{ connectLabel }}
              </button>
              <button v-else class="btn btn-danger vpn-action-primary" @click="disconnectProfile(selectedProfile)">
                <svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1.5" /></svg>
                {{ disconnectLabel }}
              </button>
              <button class="btn btn-ghost" @click="testSelected" :disabled="testing">
                <svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-9-9" /><path d="M21 3v6h-6" /></svg>
                {{ testing ? '...' : testLabel }}
              </button>
              <button class="btn btn-ghost" @click="editProfile(selectedProfile)">
                <svg viewBox="0 0 24 24"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                {{ editLabel }}
              </button>
              <button class="btn btn-ghost vpn-action-danger" @click="confirmDelete(selectedProfile)">
                <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                {{ deleteLabel }}
              </button>
            </div>

            <!-- 实时日志 -->
            <div class="vpn-logs-head">
              <div class="section-label vpn-logs-title">{{ logsLabel }}</div>
              <button v-if="currentLogs.length > 0" class="vpn-logs-clear" @click="clearCurrentLogs">清空</button>
            </div>
            <div class="vpn-log-pane">
              <div v-for="(log, i) in currentLogs" :key="i" class="vpn-log-line" :class="log.level">
                <span class="vpn-log-time">{{ formatTime(log.timestamp) }}</span>
                <span class="vpn-log-msg">{{ log.message }}</span>
              </div>
              <div v-if="currentLogs.length === 0" class="vpn-log-empty">{{ logsEmptyLabel }}</div>
            </div>
          </div>
        </template>
        <div v-else class="vpn-detail-empty">
          <div class="vpn-detail-empty-icon">
            <Icon :size="26"><ShieldLock /></Icon>
          </div>
          <div class="vpn-detail-empty-title">{{ emptyTitle }}</div>
          <div class="vpn-detail-empty-desc">{{ emptyDesc }}</div>
        </div>
      </div>
    </div>

    <!-- ===== 弹窗（VpnTunnelModal 由其他 Agent 创建，此处仅引用） ===== -->
    <VpnTunnelModal
      :open="tunnelModalOpen"
      :profile="editingProfile"
      :groups="availableGroups"
      @close="closeTunnelModal"
      @update:open="tunnelModalOpen = $event"
      @save="onTunnelSave"
      @test="onTunnelTest"
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
<script src="./VpnPanel.ts"></script>
<style src="./VpnPanel.css" scoped></style>
