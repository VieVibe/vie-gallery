<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{
  sources: (string | null | undefined)[]
  alt: string
  eager?: boolean
  priority?: boolean
  responsive?: { src: string; preview: string; srcset: string; sizes: string } | null
}>()
const emit = defineEmits<{ loaded: [] }>()
const failed = ref(new Set<string>())
const failedResponsive = ref<string>()
const src = computed(() => props.sources.find(url => url && !failed.value.has(url)))
const responsive = computed(() => props.responsive?.src === src.value && src.value !== failedResponsive.value ? props.responsive : null)

function fallback(event: Event) {
  const image = event.currentTarget as HTMLImageElement
  const url = image.getAttribute('src')
  if (!url) return
  if (responsive.value && image.currentSrc && image.currentSrc !== image.src) {
    failed.value.add(responsive.value.preview)
    failedResponsive.value = url
  } else {
    failed.value.add(url)
  }
}
</script>

<template>
  <img
    v-if="src"
    :key="responsive?.srcset ?? src"
    :src="src"
    :srcset="responsive?.srcset"
    :sizes="responsive?.sizes"
    :alt="alt"
    :loading="eager ? 'eager' : 'lazy'"
    :fetchpriority="priority ? 'high' : 'auto'"
    decoding="async"
    @load="emit('loaded')"
    @error="fallback"
  />
  <span v-else class="album-image-placeholder"><slot>照片预览暂不可用</slot></span>
</template>

<style scoped>
img, .album-image-placeholder { position: absolute; inset: 0; width: 100%; height: 100%; }
img { display: block; object-fit: contain; }
.album-image-placeholder { display: grid; place-items: center; padding: 12px; color: #5c665d; font-size: .875rem; text-align: center; }
</style>
