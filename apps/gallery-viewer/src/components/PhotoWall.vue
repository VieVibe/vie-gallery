<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PublicPhoto } from '../types/api'
import { albumRows } from '../lib/albumRows'
import { exhibitionTitle, photoLabel } from '../lib/photoTitle'
import AlbumImage from './AlbumImage.vue'
import Icon from './Icon.vue'

const props = defineProps<{ photos: PublicPhoto[]; prioritizeFirstPhotos?: boolean; compact?: boolean }>()
const emit = defineEmits<{ select: [index: number]; firstPhotoRendered: [] }>()
const rows = computed(() => albumRows(props.photos))
const wall = ref<HTMLElement | null>(null)

function focusPhoto(index: number) {
  wall.value?.querySelectorAll<HTMLButtonElement>('.photo-card')[index]?.focus()
}
defineExpose({ focusPhoto })
</script>

<template>
  <div ref="wall" class="photo-wall" :class="{ compact }">
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
        <span class="photo-frame" :style="{ '--photo-ratio': ratio }">
          <AlbumImage
            :sources="[photo.previewUrl, photo.thumbnailUrl, photo.mediumUrl, photo.textureUrl]"
            :alt="photoLabel(photo.title, index)"
            :eager="prioritizeFirstPhotos && index < 2"
            :priority="prioritizeFirstPhotos && index === 0"
            @loaded="index === 0 && emit('firstPhotoRendered')"
          />
          <span class="open-photo" aria-hidden="true"><Icon name="maximize" :size="15" /></span>
        </span>
        <span class="photo-credit">
          <span class="photo-number" aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</span>
          <span v-if="exhibitionTitle(photo.title)" class="photo-caption">{{ exhibitionTitle(photo.title) }}</span>
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.photo-wall { display: grid; gap: clamp(28px, 4.5vw, 68px); }
.photo-row {
  display: grid;
  grid-template-columns: var(--columns);
  align-items: start;
  gap: clamp(14px, 2vw, 30px);
  width: min(100%, var(--row-width));
  margin-inline: auto;
}
.photo-card { min-width: 0; padding: 0; color: var(--text-main); text-align: left; }
.photo-frame {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: var(--photo-ratio);
  outline: 1px solid transparent;
  outline-offset: 4px;
  overflow: hidden;
  background: #e4e8df;
  transition: outline-color .25s ease;
}
.open-photo {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: grid;
  place-items: center;
  width: 29px;
  height: 29px;
  border-radius: 50%;
  color: #274533;
  background: #fffefa;
  opacity: 0;
  transform: translateY(4px);
  transition: opacity .18s, transform .2s var(--ease-smooth);
}
@media (hover: hover) {
  .photo-card:hover .photo-frame { outline-color: #9ca897; }
  .photo-card:hover .open-photo { opacity: 1; transform: none; }
}
.photo-card:focus-visible .open-photo { opacity: 1; transform: none; }
.photo-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 5px; }
.photo-credit { display: flex; align-items: baseline; gap: 10px; padding-top: 9px; color: #344637; line-height: 1.45; }
.photo-number { color: #58685b; font: .75rem/1.5 var(--font-mono); }
.photo-caption { font-size: .9375rem; overflow-wrap: anywhere; }
.photo-wall.compact { grid-template-columns: repeat(auto-fill, minmax(min(155px, 100%), 1fr)); align-items: start; gap: 20px clamp(10px, 1.5vw, 22px); }
.compact .photo-row { display: contents; }
.compact .photo-frame { aspect-ratio: 4/3; }
.compact .photo-caption { font-size: .8125rem; }
.compact .photo-credit { gap: 6px; }
@media (max-width: 640px) {
  .photo-row { grid-template-columns: minmax(0, 1fr); gap: 28px; width: 100%; }
  .photo-frame { max-height: 78svh; }
  .photo-wall.compact { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (prefers-reduced-motion: reduce) {
  .photo-frame, .open-photo { transition: none; }
  .open-photo { transform: none; }
}
</style>
