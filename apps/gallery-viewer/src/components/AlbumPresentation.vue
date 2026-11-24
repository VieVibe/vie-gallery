<script setup lang="ts">
import { computed, ref } from 'vue'
import { galleryMediaUrl } from '@vie/gallery-contracts'
import type { PublicGalleryResponse, PublicPhoto } from '../types/api'
import { albumAspectRatio } from '../lib/albumRows'
import AlbumImage from './AlbumImage.vue'
import PhotoWall from './PhotoWall.vue'
import Icon from './Icon.vue'

const props = defineProps<{
  gallery: PublicGalleryResponse | null
  photos: PublicPhoto[]
  total: number
  loadingMore: boolean
  error: string | null
}>()
const emit = defineEmits<{
  start: []
  select: [index: number]
  'load-more': []
  'first-photo-rendered': []
}>()

const title = computed(() => props.gallery?.title?.trim() || '照片相册')
const cover = computed(() => props.gallery?.cover)
const coverSources = computed(() => {
  const first = props.photos[0]
  return [cover.value?.url ? galleryMediaUrl(cover.value.url) : null, first?.mediumUrl, first?.thumbnailUrl, first?.textureUrl]
})
const coverRatio = computed(() => {
  const dimensions = cover.value ?? props.photos[0]
  return albumAspectRatio(dimensions?.width, dimensions?.height)
})
const titleHeading = ref<HTMLElement | null>(null)
const photoHeading = ref<HTMLElement | null>(null)

function goTo(heading: HTMLElement | null) {
  heading?.focus({ preventScroll: true })
  heading?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
}
</script>

<template>
  <main class="album-main">
    <section class="album-opening" aria-labelledby="album-title">
      <div class="album-intro">
        <p class="album-count">{{ total }} 张照片</p>
        <h1 id="album-title" ref="titleHeading" tabindex="-1">{{ title }}</h1>
        <div class="album-actions">
          <button class="album-start" type="button" @click="emit('start')">开始浏览</button>
          <button v-if="photos.length > 1" type="button" class="album-index-link" @click="goTo(photoHeading)">查看全部</button>
        </div>
      </div>
      <figure class="album-cover" :style="{ '--cover-ratio': coverRatio }">
        <AlbumImage
          :sources="coverSources"
          :alt="`${title}的封面`"
          eager
          priority
          @settled="emit('first-photo-rendered')"
        >封面暂不可用</AlbumImage>
      </figure>
    </section>

    <section id="album-photos" class="album-photos" aria-labelledby="album-photos-title">
      <header class="album-photos-heading">
        <h2 id="album-photos-title" ref="photoHeading" tabindex="-1">全部照片</h2>
        <span v-if="photos.length < total">{{ photos.length }} / {{ total }}</span>
      </header>
      <PhotoWall :photos="photos" @select="emit('select', $event)" @first-photo-rendered="emit('first-photo-rendered')" />
      <p v-if="error" class="album-error" role="alert">{{ error }}</p>
      <button v-if="photos.length < total" type="button" class="album-more" :disabled="loadingMore" @click="emit('load-more')">
        {{ loadingMore ? '正在加载…' : error ? '重试加载照片' : `加载更多 · 还有 ${total - photos.length} 张` }}
      </button>
    </section>

    <footer class="album-footer">
      <span>阳光明媚</span>
      <button type="button" @click="goTo(titleHeading)">回到封面 <Icon name="chevron-up" :size="16" /></button>
    </footer>
  </main>
</template>

<style scoped>
.album-main {
  width: min(100% - clamp(40px, 9vw, 144px), 1280px);
  margin-inline: auto;
  padding: clamp(24px, 5vw, 76px) 0 24px;
}
.album-opening {
  display: grid;
  grid-template-columns: minmax(0, .88fr) minmax(0, 1.7fr);
  align-items: center;
  gap: clamp(28px, 5vw, 88px);
  margin-bottom: clamp(54px, 8.5vw, 128px);
}
.album-intro { min-width: 0; padding-block: 20px; }
.album-count {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #475b4b;
  font-size: .875rem;
  font-variant-numeric: tabular-nums;
}
.album-count::before { content: ''; width: 24px; height: 1px; background: #7a8c77; }
.album-intro h1 {
  margin: 18px 0 30px;
  color: #192d23;
  font: 500 clamp(2.5rem, 5.2vw, 5rem)/1.13 var(--font-serif);
  letter-spacing: -.04em;
  overflow-wrap: anywhere;
  text-wrap: balance;
}
.album-actions { display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: center; }
.album-start, .album-more {
  min-height: 46px;
  padding: 10px 20px;
  border: 1px solid #284c38;
  border-radius: 6px;
  background: #244b38;
  color: #fffefa;
  font-size: .9375rem;
  font-weight: 600;
}
.album-start:hover { background: #183827; }
.album-index-link { display: inline-flex; align-items: center; min-height: 44px; color: #43584b; font-size: .875rem; text-decoration: underline; text-underline-offset: .24em; }
.album-cover {
  position: relative;
  aspect-ratio: clamp(1.12, var(--cover-ratio), 2.4);
  outline: 1px solid #deded1;
  outline-offset: 7px;
  background: #e4e3d8;
}
.album-photos { scroll-margin-top: 16px; }
.album-photos-heading {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 16px;
  margin-bottom: clamp(22px, 4vw, 46px);
  padding-bottom: 14px;
  border-bottom: 1px solid #cfd5c8;
  color: #435245;
  font-size: .875rem;
}
.album-photos-heading h2 { color: #25392c; font: 500 clamp(1.375rem, 2.5vw, 2rem)/1.3 var(--font-serif); }
.album-error { margin: 24px 0 0; color: #943d2c; text-align: center; }
.album-more { display: block; margin: 32px auto 0; color: #284c38; background: transparent; }
.album-more:hover:not(:disabled) { background: #e4ebe1; }
.album-more:disabled { opacity: .65; }
.album-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: clamp(48px, 7vw, 96px);
  padding-top: 12px;
  border-top: 1px solid #cfd5c8;
  color: #536558;
  font-size: .875rem;
}
.album-footer button { display: inline-flex; gap: 6px; align-items: center; min-height: 44px; color: inherit; }
@media (max-width: 760px) {
  .album-opening { grid-template-columns: minmax(0, 1fr); gap: 26px; }
  .album-intro { padding-block: 4px 0; }
  .album-intro h1 { margin-block: 12px 20px; }
  .album-cover { outline-offset: 4px; }
}
</style>
