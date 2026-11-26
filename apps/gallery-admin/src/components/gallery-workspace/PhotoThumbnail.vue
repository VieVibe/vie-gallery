<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { WorkspacePhoto } from '../../composables/useGalleryWorkspace'
import Icon from '../Icon.vue'

const props = defineProps<{ photo: WorkspacePhoto; compact?: boolean }>()
const failed = ref(false)
watch(() => props.photo.thumbnailUrl, () => { failed.value = false })
const label = computed(() => {
  if (props.photo.status === 'PROCESSING') return '正在生成预览'
  if (props.photo.status === 'FAILED') return '照片处理失败'
  return '缩略图不可用'
})
</script>

<template>
  <span class="thumbnail" :class="{ compact }">
    <img v-if="photo.thumbnailUrl && !failed" :key="photo.thumbnailUrl" :src="photo.thumbnailUrl"
      :alt="compact ? '' : photo.title || '照片'" loading="lazy" decoding="async" @error="failed = true" />
    <span v-else class="unavailable" :title="label">
      <Icon :name="photo.status === 'PROCESSING' ? 'clock' : 'photo'" :size="compact ? 16 : 26" />
      <span v-if="!compact">{{ label }}</span>
    </span>
  </span>
</template>

<style scoped>
.thumbnail, .thumbnail img, .unavailable { display: block; width: 100%; height: 100%; }
.thumbnail { background: #e8ece2; }
.thumbnail img { object-fit: cover; }
.unavailable {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  color: #596a59;
  font-size: .75rem;
}
</style>
