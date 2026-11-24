<script setup lang="ts">
import { computed } from 'vue'
import type { PublicPhoto } from '../types/api'
import { albumRows } from '../lib/albumRows'
import { exhibitionTitle, photoLabel } from '../lib/photoTitle'
import AlbumImage from './AlbumImage.vue'

const props = defineProps<{ photos: PublicPhoto[]; prioritizeFirstPhotos?: boolean }>()
const emit = defineEmits<{ select: [index: number]; firstPhotoRendered: [] }>()
const rows = computed(() => albumRows(props.photos))
</script>

<template>
  <div class="photo-wall">
    <div
      v-for="row in rows"
      :key="row.items[0].index"
      class="photo-row"
      :style="{ '--columns': row.items.map(item => `minmax(0, ${item.ratio}fr)`).join(' '), '--row-width': `${row.ratio * 490}px` }"
    >
      <button
        v-for="{ photo, index, ratio } in row.items"
        :key="index"
        type="button"
        class="photo-card"
        :aria-label="`查看照片 ${index + 1}：${photoLabel(photo.title, index)}`"
        @click="emit('select', index)"
      >
        <span class="photo-frame" :style="{ aspectRatio: ratio }">
          <AlbumImage
            :sources="[photo.thumbnailUrl, photo.mediumUrl, photo.textureUrl]"
            :alt="photoLabel(photo.title, index)"
            :eager="prioritizeFirstPhotos && index < 2"
            :priority="prioritizeFirstPhotos && index === 0"
            @settled="index === 0 && emit('firstPhotoRendered')"
          />
        </span>
        <span v-if="exhibitionTitle(photo.title)" class="photo-caption">{{ exhibitionTitle(photo.title) }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.photo-wall { display: grid; gap: clamp(30px, 5.5vw, 82px); }
.photo-row {
  display: grid;
  grid-template-columns: var(--columns);
  align-items: start;
  gap: clamp(16px, 2.4vw, 36px);
  width: min(100%, var(--row-width));
  margin-inline: auto;
}
.photo-card { min-width: 0; padding: 0; color: var(--text-main); text-align: left; }
.photo-frame {
  position: relative;
  display: block;
  width: 100%;
  outline: 1px solid transparent;
  outline-offset: 4px;
  overflow: hidden;
  background: #e4e3d8;
  transition: outline-color .25s ease;
}
.photo-frame :deep(img) { transition: filter .25s ease; }
.photo-card:hover .photo-frame { outline-color: #9ca897; }
.photo-card:hover .photo-frame :deep(img) { filter: brightness(1.03); }
.photo-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 5px; }
.photo-caption { display: block; padding-top: 12px; color: #394c3f; font-size: .9375rem; line-height: 1.5; overflow-wrap: anywhere; }
@media (max-width: 640px) {
  .photo-row { grid-template-columns: minmax(0, 1fr); gap: 28px; width: 100%; }
  .photo-frame { max-height: 78svh; }
}
@media (prefers-reduced-motion: reduce) {
  .photo-frame, .photo-frame :deep(img) { transition: none; }
}
</style>
