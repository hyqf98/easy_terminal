<template>
  <AppModal
    :open="open"
    :title="titleLabel"
    :subtitle="subtitleLabel"
    :icon="linkIcon"
    size="md"
    @close="close"
    @update:open="onUpdateOpen"
  >
    <div class="field">
      <div class="field-label">
        {{ triggerLabel }}<span class="req">*</span>
        <span class="field-hint">{{ triggerHint }}</span>
      </div>
      <div class="tag-input" @click="focusTriggerInput">
        <span v-for="(trigger, index) in triggers" :key="trigger" class="tag-pill">
          {{ trigger }}
          <button class="x" type="button" @click.stop="removeTrigger(index)" aria-label="移除触发短语">×</button>
        </span>
        <input
          ref="triggerInputEl"
          v-model="triggerInputValue"
          :placeholder="triggerPlaceholder"
          @keydown="onTriggerKeydown"
          @blur="addTrigger"
        />
      </div>
    </div>

    <div class="field">
      <div class="field-label">
        {{ commandLabel }}<span class="req">*</span>
        <span class="field-hint">{{ commandHint }}</span>
      </div>
      <textarea
        class="textarea code"
        v-model="command"
        rows="4"
        :placeholder="commandPlaceholder"
      ></textarea>
    </div>

    <div class="field">
      <div class="field-label">{{ descriptionLabel }}</div>
      <input class="input" v-model="description" :placeholder="descriptionPlaceholder" />
    </div>

    <div class="field">
      <div class="field-label">{{ tagsLabel }}</div>
      <div class="tag-input" @click="focusTagInput">
        <span v-for="(tag, index) in tags" :key="tag" class="tag-pill">
          {{ tag }}
          <button class="x" type="button" @click.stop="removeTag(index)" aria-label="移除标签">×</button>
        </span>
        <input
          ref="tagInputEl"
          v-model="tagInputValue"
          :placeholder="tagsPlaceholder"
          @keydown="onTagKeydown"
          @blur="addTag"
        />
      </div>
    </div>

    <div class="field">
      <div class="field-label">{{ enabledLabel }}</div>
      <div class="segmented">
        <button
          type="button"
          class="segmented-item"
          :class="{ active: enabled }"
          @click="enabled = true"
        >{{ enabledLabel }}</button>
        <button
          type="button"
          class="segmented-item"
          :class="{ active: !enabled }"
          @click="enabled = false"
        >{{ disabledLabel }}</button>
      </div>
    </div>

    <template #footer>
      <button class="btn btn-ghost" @click="close">{{ cancelLabel }}</button>
      <button class="btn btn-primary" @click="save">{{ saveLabel }}</button>
    </template>
  </AppModal>
</template>
<script src="./MappingModal.ts"></script>
<style src="./MappingModal.css" scoped></style>
