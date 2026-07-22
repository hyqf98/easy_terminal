<template>
  <Teleport to="body">
    <div class="transfer-overlay" @click.self="$emit('close')">
      <section class="transfer-modal" role="dialog" aria-modal="true" aria-label="SFTP 文件传输">
        <header class="transfer-header">
          <div class="transfer-heading">
            <span class="transfer-kicker">SFTP FILE MANAGER</span>
            <h2>远程文件传输</h2>
            <p>{{ profile.name || profile.host }} · 远端与本机目录保持独立浏览</p>
          </div>
          <button class="transfer-close" aria-label="关闭" @click="$emit('close')">×</button>
        </header>
        <p class="transfer-guidance">选择文件或目录后，在中间选择传输方向。⌘/Ctrl 点击可多选，双击目录进入。</p>
        <main class="transfer-workbench">
          <section class="transfer-pane remote" aria-label="远程 SSH 目录">
            <div class="transfer-pane-title">
              <div><span class="transfer-pane-eyebrow">REMOTE SSH</span><strong>{{ profile.name || profile.host }}</strong></div>
              <button @click="loadRemote(parentOf(remotePath))">上级</button>
            </div>
            <div class="transfer-path">{{ remotePath }}</div>
            <div class="transfer-list">
              <button v-for="entry in remoteEntries" :key="entry.path" :class="{ selected: selectedRemote.includes(entry.path) }" @click="goRemote(entry, $event)">
                <span>{{ entry.is_dir ? '▸' : '·' }}</span>{{ entry.name }}
              </button>
              <p v-if="remoteEntries.length === 0" class="transfer-empty">此目录为空</p>
            </div>
            <div class="transfer-selection">已选 {{ selectedRemote.length }} 项</div>
          </section>
          <aside class="transfer-bridge" aria-label="传输方向和冲突处理">
            <span class="transfer-bridge-title">传输方向</span>
            <button class="transfer-direction transfer-download" :class="{ active: direction === 'download' }" @click="direction = 'download'">
              <span class="transfer-arrow" aria-hidden="true">←</span>
              <span>下载到本机</span>
              <small>远程 → 本机</small>
            </button>
            <button class="transfer-direction transfer-upload" :class="{ active: direction === 'upload' }" @click="direction = 'upload'">
              <span class="transfer-arrow" aria-hidden="true">→</span>
              <span>上传到远端</span>
              <small>本机 → 远程</small>
            </button>
            <div class="transfer-target">
              <span>当前目标</span>
              <code :title="targetPath">{{ targetPath }}</code>
            </div>
            <label class="transfer-conflict"><span>同名项处理</span>
              <AppSelect v-model="conflictPolicy" :options="conflictOptions" />
            </label>
          </aside>
          <section class="transfer-pane local">
            <div class="transfer-pane-title">
              <div><span class="transfer-pane-eyebrow">LOCAL COMPUTER</span><strong>本机目录</strong></div>
              <button @click="loadLocal(parentOf(localPath))">上级</button>
            </div>
            <div class="transfer-path">{{ localPath }}</div>
            <div class="transfer-list">
              <button v-for="entry in localEntries" :key="entry.path" :class="{ selected: selectedLocal.includes(entry.path) }" @click="goLocal(entry, $event)">
                <span>{{ entry.is_dir ? '▸' : '·' }}</span>{{ entry.name }}
              </button>
              <p v-if="localEntries.length === 0" class="transfer-empty">此目录为空</p>
            </div>
            <div class="transfer-selection">已选 {{ selectedLocal.length }} 项</div>
          </section>
        </main>
        <footer class="transfer-footer">
          <div class="transfer-status" aria-live="polite">
            <template v-if="progress"><strong>{{ progress.progressPercent }}%</strong> {{ progress.detail || progress.fileName }}</template>
            <span v-else-if="error" class="transfer-error">{{ error }}</span>
            <span v-else>{{ directionHint }}</span>
          </div>
          <button class="btn btn-ghost" :disabled="busy" @click="$emit('close')">关闭</button>
          <button class="btn btn-primary" :disabled="primaryDisabled" @click="transfer">{{ busy ? '传输中…' : primaryLabel }}</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
<script src="./FileTransferModal.ts"></script>
<style src="./FileTransferModal.css"></style>
