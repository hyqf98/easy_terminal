<template>
  <n-config-provider :theme="naiveTheme" :theme-overrides="themeOverrides" :locale="locale" :date-locale="dateLocale">
    <n-dialog-provider>
      <n-message-provider>
        <n-notification-provider>
          <AppLayout />
        </n-notification-provider>
      </n-message-provider>
    </n-dialog-provider>
  </n-config-provider>
</template>
<script src="./App.ts"></script>
<style src="./App.css"></style>
