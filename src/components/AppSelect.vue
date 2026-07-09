<template>
  <NSelect
    class="app-select"
    :class="[size, { 'fit-content': fitContent }]"
    :value="modelValue"
    :options="options"
    :placeholder="placeholder"
    :size="nSelectSize"
    :disabled="disabled"
    :theme-overrides="themeOverrides"
    placement="bottom-start"
    :consistent-menu-width="!fitContent"
    @update:value="onUpdateValue"
  />
</template>
<script src="./AppSelect.ts"></script>
<style src="./AppSelect.css" scoped></style>
