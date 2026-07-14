<template>
  <Teleport to="body">
    <Transition name="isp-fade">
      <div v-if="visible" class="isp-overlay" @click.self="close">
        <div
          class="isp-panel"
          role="dialog"
          aria-modal="true"
          aria-label="索引设置"
          @click.stop
        >
          <!-- ═══ 标题区 ═══ -->
          <header class="isp-header">
            <div class="isp-title">
              <h2>索引设置</h2>
              <p class="isp-subtitle">配置扫描范围与文件类型，保存后自动重建索引</p>
            </div>
            <button class="isp-close" @click="close" aria-label="关闭">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </header>

          <!-- ═══ 加载态 ═══ -->
          <div v-if="loading" class="isp-loading">
            <svg class="isp-spin" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            <span>加载配置…</span>
          </div>

          <!-- ═══ 内容区 ═══ -->
          <div v-else class="isp-body">
            <!-- 扫描范围 -->
            <section class="isp-section">
              <h3 class="isp-section-title">扫描范围</h3>
              <p class="isp-section-hint">索引这些根目录下的文件</p>
              <div class="isp-tag-list">
                <span v-for="r in config.roots" :key="r" class="isp-tag isp-tag-mono">
                  <span class="isp-tag-text">{{ r }}</span>
                  <button class="isp-tag-x" @click="removeRoot(r)" aria-label="移除">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                  </button>
                </span>
                <span v-if="config.roots.length === 0" class="isp-empty-inline">未设置扫描根路径</span>
              </div>
              <div class="isp-input-row">
                <input
                  v-model="newRoot"
                  class="isp-input isp-input-mono"
                  type="text"
                  placeholder="如 /Users/you/Projects"
                  @keydown.enter="addRoot"
                />
                <button class="isp-add-btn" @click="addRoot">添加</button>
              </div>
            </section>

            <!-- 排除目录 -->
            <section class="isp-section">
              <h3 class="isp-section-title">排除目录</h3>
              <p class="isp-section-hint">这些路径将被跳过，不进入索引</p>
              <div class="isp-tag-list">
                <span v-for="p in config.excludedPaths" :key="p" class="isp-tag isp-tag-mono">
                  <span class="isp-tag-text">{{ p }}</span>
                  <button class="isp-tag-x" @click="removeExcluded(p)" aria-label="移除">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                  </button>
                </span>
                <span v-if="config.excludedPaths.length === 0" class="isp-empty-inline">未排除任何目录</span>
              </div>
              <div class="isp-input-row">
                <input
                  v-model="newExcluded"
                  class="isp-input isp-input-mono"
                  type="text"
                  placeholder="如 /node_modules 或 /System"
                  @keydown.enter="addExcluded"
                />
                <button class="isp-add-btn" @click="addExcluded">添加</button>
              </div>
            </section>

            <!-- 文件类型 -->
            <section class="isp-section">
              <h3 class="isp-section-title">文件类型</h3>
              <p class="isp-section-hint">选择需要纳入索引的文件类别</p>
              <div class="isp-check-grid">
                <label
                  v-for="cat in FILE_CATEGORIES"
                  :key="cat.key"
                  class="isp-check"
                  :class="{ checked: isCategoryEnabled(cat.key) }"
                >
                  <input
                    type="checkbox"
                    :checked="isCategoryEnabled(cat.key)"
                    @change="toggleCategory(cat.key)"
                  />
                  <span class="isp-check-box">
                    <svg v-if="isCategoryEnabled(cat.key)" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                  </span>
                  <span class="isp-check-label">
                    <span class="isp-check-name">{{ cat.label }}</span>
                    <span class="isp-check-desc">{{ cat.desc }}</span>
                  </span>
                </label>
              </div>
            </section>

            <!-- 自定义扩展名 -->
            <section class="isp-section">
              <h3 class="isp-section-title">自定义扩展名</h3>
              <p class="isp-section-hint">额外纳入索引的扩展名，逗号分隔（如 txt, log, conf）</p>
              <input
                v-model="customExtText"
                class="isp-input isp-input-mono"
                type="text"
                placeholder="txt, log, conf"
              />
            </section>

            <!-- 排除扩展名 -->
            <section class="isp-section">
              <h3 class="isp-section-title">排除扩展名</h3>
              <p class="isp-section-hint">这些扩展名将不被索引，逗号分隔</p>
              <input
                v-model="excludeExtText"
                class="isp-input isp-input-mono"
                type="text"
                placeholder="exe, dll, tmp"
              />
            </section>
          </div>

          <!-- ═══ 底部操作区 ═══ -->
          <footer class="isp-footer">
            <button class="isp-btn isp-btn-ghost" :disabled="saving" @click="close">取消</button>
            <button class="isp-btn isp-btn-primary" :disabled="saving || loading" @click="save">
              <svg
                v-if="saving"
                class="isp-spin"
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
              ><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
              <span>{{ saving ? '保存中…' : '保存并重建索引' }}</span>
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script src="./IndexSettingsPanel.ts"></script>

<style src="./IndexSettingsPanel.css"></style>
