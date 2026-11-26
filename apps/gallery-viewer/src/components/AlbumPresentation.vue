<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
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
const coverDisplayUrl = computed(() => cover.value?.displayUrl ? galleryMediaUrl(cover.value.displayUrl) : null)
const coverPreviewUrl = computed(() => cover.value?.previewUrl ? galleryMediaUrl(cover.value.previewUrl) : null)
const responsiveCover = computed(() => {
  const previewWidth = cover.value?.previewWidth
  const displayWidth = cover.value?.displayWidth
  const preview = coverPreviewUrl.value
  const display = coverDisplayUrl.value
  if (!preview || !display || !previewWidth || !displayWidth || previewWidth >= displayWidth) return null
  return {
    src: display,
    preview,
    srcset: [preview + ' ' + previewWidth + 'w', display + ' ' + displayWidth + 'w'].join(', '),
    sizes: `min(calc(100vw - 64px), calc(clamp(260px, 52svh, 580px) * ${coverRatio.value}))`
  }
})
const coverSources = computed(() => {
  const first = props.photos[0]
  return [coverDisplayUrl.value, coverPreviewUrl.value, cover.value?.url ? galleryMediaUrl(cover.value.url) : null,
    first?.previewUrl, first?.mediumUrl, first?.thumbnailUrl, first?.textureUrl]
})
const coverRatio = computed(() => {
  const dimensions = cover.value ?? props.photos[0]
  return albumAspectRatio(dimensions?.width, dimensions?.height)
})
const titleHeading = ref<HTMLElement | null>(null)
const photoHeading = ref<HTMLElement | null>(null)

const compact = defineModel<boolean>('compact', { default: false })
const moreButton = ref<HTMLButtonElement | null>(null)
const photoWall = ref<InstanceType<typeof PhotoWall> | null>(null)

function scrollBehavior() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
}

function showIndex() {
  photoHeading.value?.focus({ preventScroll: true })
  photoHeading.value?.scrollIntoView({ behavior: scrollBehavior() })
}

function showCover() {
  titleHeading.value?.focus({ preventScroll: true })
  window.scrollTo({ top: 0, behavior: scrollBehavior() })
}

function loadMore() {
  if (props.loadingMore) return
  emit('load-more')
}

watch(() => props.photos.length, async (count, firstNew) => {
  if (count <= firstNew || document.activeElement !== moreButton.value) return
  await nextTick()
  photoWall.value?.focusPhoto(firstNew)
})
</script>

<template>
  <main class="album-main">
    <section class="album-opening" aria-labelledby="album-title">
      <figure class="album-cover" :style="{ '--cover-ratio': coverRatio }">
        <div class="album-print">
          <AlbumImage
            :sources="coverSources"
            :alt="`${title}的封面`"
            :responsive="responsiveCover"
            eager
            priority
            @loaded="emit('first-photo-rendered')"
          >封面暂不可用</AlbumImage>
        </div>
      </figure>
      <div class="album-intro">
        <div class="album-title-block">
          <h1 id="album-title" ref="titleHeading" tabindex="-1">{{ title }}</h1>
          <p class="album-count">{{ total }} 张照片</p>
        </div>
        <div class="album-actions">
          <button class="album-start" type="button" :disabled="!photos.length" @click="emit('start')">
            开始浏览 <Icon name="arrow-right" :size="17" />
          </button>
          <button v-if="photos.length > 1" type="button" class="album-index-link" @click="showIndex">
            <Icon name="grid" :size="15" /> 查看全部
          </button>
        </div>
      </div>
    </section>

    <section v-if="photos.length" id="album-photos" class="album-photos" aria-labelledby="album-photos-title">
      <header class="album-photos-heading">
        <h2 id="album-photos-title" ref="photoHeading" tabindex="-1">全部照片</h2>
        <div v-if="total > 1" class="album-layout" role="group" aria-label="照片排列方式" :class="{ compact }">
          <button type="button" :aria-pressed="!compact" aria-controls="album-wall" @click="compact = false">
            <Icon name="photo" :size="16" />画册
          </button>
          <button type="button" :aria-pressed="compact" aria-controls="album-wall" @click="compact = true">
            <Icon name="grid" :size="16" />缩略图
          </button>
        </div>
      </header>
      <PhotoWall id="album-wall" ref="photoWall" :photos="photos" :compact="compact" @select="emit('select', $event)" @first-photo-rendered="emit('first-photo-rendered')" />
      <p v-if="error" class="album-error" role="alert">{{ error }}</p>
      <button v-if="photos.length < total" ref="moreButton" type="button" class="album-more" :aria-disabled="loadingMore" @click="loadMore">
        {{ loadingMore ? '正在加载…' : error ? '重试加载照片' : `加载更多 · 还有 ${total - photos.length} 张` }}
      </button>
    </section>

    <footer v-if="photos.length" class="album-footer">
      <span role="status">已显示 {{ photos.length }} / {{ total }} 张</span>
      <button type="button" @click="showCover">回到封面 <Icon name="arrow-left" :size="16" /></button>
    </footer>
  </main>
</template>

<style scoped>
.album-main {
  width: min(100%, 1660px);
  margin-inline: auto;
  padding: clamp(14px, 2.1vw, 32px) clamp(16px, 3.4vw, 56px) 24px;
}
.album-cover {
  --print-height: clamp(260px, 52svh, 580px);
  display: grid;
  place-items: center;
  padding: clamp(18px, 3vw, 46px);
  background: linear-gradient(105deg, #e4e8df, #d4dcd1 66%, #cbd5c9);
}
.album-print {
  position: relative;
  width: min(100%, calc(var(--print-height) * var(--cover-ratio)));
  aspect-ratio: var(--cover-ratio);
  background: #e5e8df;
  box-shadow: 0 1px 3px #26332926, 0 8px 17px -7px #24352754;
}
.album-intro {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  padding: clamp(20px, 2.8vw, 40px) 0;
  border-bottom: 1px solid #bdc8b9;
}
.album-title-block { min-width: 0; }
.album-intro h1 {
  color: #20392a;
  font: 500 clamp(2.35rem, 4.5vw, 4.6rem)/1.15 var(--font-serif);
  letter-spacing: -.045em;
  overflow-wrap: anywhere;
  text-wrap: balance;
}
.album-count { margin-top: 10px; color: #526354; font-size: .875rem; font-variant-numeric: tabular-nums; }
.album-actions { display: flex; flex-shrink: 0; align-items: center; gap: 10px; }
.album-start, .album-index-link, .album-more, .album-footer button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 44px;
  font-size: .875rem;
  font-weight: 550;
}
.album-start { padding: 0 19px; border-radius: 100px; color: #fffefa; background: #254d38; }
.album-start:disabled { opacity: .58; }
.album-start:hover:enabled { background: #193927; }
.album-start svg { transition: transform .22s var(--ease-smooth); }
.album-start:hover:enabled svg { transform: translateX(3px); }
.album-index-link { padding: 0 16px; border: 1px solid #b7c3b5; border-radius: 100px; color: #344e3c; }
.album-index-link:hover, .album-more:hover:not([aria-disabled='true']) { background: #e4ebe1; }
.album-photos { margin-top: clamp(36px, 5vw, 76px); }
.album-photos-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-bottom: clamp(20px, 2.8vw, 42px);
}
.album-photos-heading h2 { color: #25392c; font: 500 clamp(1.45rem, 2.4vw, 2.3rem)/1.3 var(--font-serif); }
.album-layout {
  position: relative;
  isolation: isolate;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  border-radius: 8px;
  background: #e1e7dd;
}
.album-layout::before {
  content: '';
  position: absolute;
  z-index: -1;
  inset: 3px auto 3px 3px;
  width: calc(50% - 3px);
  background: #fcfdf8;
  border: 1px solid #becab9;
  border-radius: 5px;
  transition: transform .24s var(--ease-smooth);
}
.album-layout.compact::before { transform: translateX(100%); }
.album-layout button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 44px;
  padding: 0 12px;
  color: #4a5e4d;
  font-size: .8125rem;
  border-radius: 7px;
}
.album-layout button[aria-pressed='true'] { color: #193c29; font-weight: 650; }
.album-error { margin-top: 24px; color: #943d2c; text-align: center; }
.album-more { display: flex; width: fit-content; margin: 32px auto 0; padding: 0 20px; border: 1px solid #a7b7a6; border-radius: 100px; color: #284c38; }
.album-more[aria-disabled='true'] { opacity: .65; cursor: wait; }
.album-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: clamp(40px, 6vw, 88px);
  padding-top: 12px;
  border-top: 1px solid #c5cec1;
  color: #536558;
  font-size: .8125rem;
  font-variant-numeric: tabular-nums;
}
.album-footer button { color: #314b39; }
.album-footer button svg { transform: rotate(90deg); }
@media (max-width: 680px) {
  .album-intro { display: grid; gap: 18px; }
  .album-cover { padding: 15px; }
  .album-actions { gap: 8px; }
  .album-layout button { padding: 0 9px; }
}
@media (prefers-reduced-motion: reduce) {
  .album-layout::before, .album-start svg { transition: none; }
  .album-start:hover:enabled svg { transform: none; }
}
</style>
