<template>
  <AppModal
    :open="open"
    :title="modalTitle"
    :subtitle="subtitle"
    :icon="icon"
    size="md"
    @close="close"
    @update:open="onUpdateOpen"
  >
    <div class="field">
      <div class="field-label">
        命令名称<span class="req">*</span>
      </div>
      <input class="input" v-model="form.name" placeholder="例如：快速提交" />
    </div>
    <div class="field">
      <div class="field-label">
        命令内容<span class="req">*</span>
        <span class="field-hint">支持 {占位符} Tab 跳转</span>
      </div>
      <textarea class="textarea" v-model="form.command" rows="4" placeholder="git add -A && git commit -m &quot;{msg}&quot;"></textarea>
    </div>
    <div class="field">
      <div class="field-label">描述</div>
      <input class="input" v-model="form.description" placeholder="简要说明命令用途" />
    </div>
    <div class="field-row">
      <div class="field">
        <div class="field-label">分类</div>
        <select class="select" v-model="form.category">
          <option value="">我的收藏</option>
          <option v-for="name in categoryOptions" :key="name" :value="name">{{ name }}</option>
        </select>
      </div>
      <div class="field">
        <div class="field-label">执行范围</div>
        <select class="select" v-model="form.scope">
          <option v-for="item in scopeOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
      </div>
    </div>
    <div class="field">
      <div class="field-label">标签</div>
      <div class="tag-input">
        <span v-for="(tag, index) in form.tags" :key="tag" class="tag-pill">
          {{ tag }}
          <span class="x" @click="removeTag(index)">×</span>
        </span>
        <input
          v-model="form.tagInput"
          placeholder="输入后回车添加"
          @keydown="onTagKeydown"
        />
      </div>
    </div>

    <template #footer>
      <button class="btn btn-ghost" @click="close">取消</button>
      <button class="btn btn-primary" @click="onSave">保存命令</button>
    </template>
  </AppModal>
</template>
<script src="./CommandModal.ts"></script>
<style src="./CommandModal.css" scoped></style>
