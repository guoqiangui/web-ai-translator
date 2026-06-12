<script setup lang="ts">
function openOptionsPage() {
  browser.runtime.openOptionsPage()
}
</script>

<template>
  <main class="w-full px-4 py-5 text-center text-gray-700">
    <div class="text-base font-bold mb-3">
      Web AI Translator
    </div>
    <button class="btn mt-2" @click="openOptionsPage">
      设置
    </button>
  </main>
</template>
