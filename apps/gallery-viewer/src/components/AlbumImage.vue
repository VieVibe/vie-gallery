<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{
  sources: (string | null | undefined)[]
  alt: string
  eager?: boolean
  priority?: boolean
}>()
const emit = defineEmits<{ settled: [] }>()
const failed = ref(new Set<string>())
const src = computed(() => props.sources.find(url => url && !failed.value.has(url)))

function fallback(event: Event) {
  const url = (event.currentTarget as HTMLImageElement).getAttribute('src')
  if (url) failed.value.add(url)
  if (!src.value) emit('settled')
}
</script>

<template>
  <img
    v-if="src"
    :key="src"
    :src="src"
    :alt="alt"
    :loading="eager ? 'eager' : 'lazy'"
    :fetchpriority="priority ? 'high' : 'auto'"
    decoding="async"
    @load="emit('settled')"
    @error="fallback"
  />
  <span v-else class="album-image-placeholder"><slot>照片预览暂不可用</slot></span>
</template>

<style scoped>
img, .album-image-placeholder { position: absolute; inset: 0; width: 100%; height: 100%; }
img { display: block; object-fit: contain; }
.album-image-placeholder { display: grid; place-items: center; padding: 12px; color: #5c665d; font-size: .875rem; text-align: center; }
</style>
