<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { SPATIAL_PRESETS, applySpatialPreset, resolveSpatialPreset, serializeViewerConfig, type SpatialPreset } from '@vie/gallery-contracts'
import { useViewerConfigEditor } from '../../composables/useViewerConfigEditor'
import Icon from '../Icon.vue'
const props = defineProps<{ galleryId: string; canWrite: boolean; photos: { thumbnailUrl?: string | null }[] }>()
const emit = defineEmits<{ busy: [value: boolean]; saved: []; ready: [value: boolean] }>()
const editor = useViewerConfigEditor(props.galleryId, { canWrite: () => props.canWrite })
const loaded = ref(false), message = ref('')
const selected = computed(() => resolveSpatialPreset(editor.config.value))
async function load() {
  emit('busy', true); message.value = ''
  try { await editor.load(); loaded.value = true; emit('ready', true) }
  catch { loaded.value = false; emit('ready', false); message.value = '风格没有载入，请重试。' }
  finally { emit('busy', false) }
}
async function choose(mode: SpatialPreset) {
  if (!loaded.value || editor.saving.value || !props.canWrite || selected.value === mode) return
  emit('busy', true); message.value = ''
  const previous = serializeViewerConfig(editor.config.value)
  editor.replace(serializeViewerConfig(applySpatialPreset(editor.config.value, mode)))
  try {
    if (await editor.save()) { message.value = '风格已保存'; emit('saved') }
    else { editor.replace(previous, true); message.value = '风格没有保存，请重新选择。' }
  } finally { emit('busy', false) }
}
onMounted(load)
</script>

<template>
  <section class="quick-styles" aria-label="选择展示风格">
    <div class="style-heading"><h2>默认展示效果</h2><span class="style-autosave"><Icon name="check" :size="13" /> 选好即保存</span></div>
    <p class="style-intro">访客进入空间漫游时将看到发布的场景。</p>
    <div class="style-choices">
      <button v-for="style in SPATIAL_PRESETS" :key="style.id" type="button" :class="style.id" :aria-pressed="loaded && selected === style.id" :disabled="!loaded || editor.saving.value || !canWrite" @click="choose(style.id)">
        <span class="style-miniature" aria-hidden="true">
          <span v-for="i in 8" :key="i" class="mini-photo" :style="{
            '--step': Math.floor((i - 1) / 2), '--side': i % 2 ? -1 : 1,
            '--col': (i - 1) % 4 - 1.5, '--row': i > 4 ? .5 : -.5,
            '--orbit-x': Math.cos(i * Math.PI / 4), '--orbit-y': Math.sin(i * Math.PI / 4)
          }"><img v-if="photos[(i - 1) % Math.max(1, photos.length)]?.thumbnailUrl" :src="photos[(i - 1) % photos.length]?.thumbnailUrl || ''" alt="" /></span>
        </span>
        <span class="style-name">{{ style.label }} <span v-if="loaded && selected === style.id" class="style-check"><Icon name="check" :size="12" /></span></span>
        <small>{{ style.caption }}</small>
      </button>
    </div>
    <p v-if="editor.saving.value || message || !loaded" class="style-feedback" :class="{ 'is-error': !loaded && message }" role="status">{{ editor.saving.value ? '正在保存风格…' : message || '正在载入展示效果…' }}</p>
    <button v-if="!loaded && message" class="retry-style" type="button" @click="load">重试载入</button>
  </section>
</template>

<style scoped>
.quick-styles {
  padding:24px;
  border:1px solid var(--border-strong);
  border-radius:12px;
  background:var(--bg-surface)
}

.style-heading {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:14px
}

.style-heading>div>span {
  font-size:10px;
  letter-spacing:.12em;
  color:var(--brand-deep)
}

.style-heading h2 {
  margin:7px 0 0;
  font-size:21px;
  font-weight:650;
  letter-spacing:-.03em;
  color:var(--text-primary)
}

.style-autosave {
  display:inline-flex;
  align-items:center;
  gap:5px;
  color:var(--text-secondary);
  font-size:11px;
  white-space:nowrap
}

.style-intro {
  margin:9px 0 20px;
  color:var(--text-secondary);
  font-size:12px;
  line-height:1.6
}

.style-choices {
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:12px
}

.style-choices button {
  min-width:0;
  padding:5px 5px 16px;
  text-align:left;
  border:1px solid var(--border-strong);
  background:var(--bg-surface);
  border-radius:9px;
  transition:border-color .18s,background .18s
}

.style-choices button[aria-pressed=true] {
  border-color:var(--brand-accent);
  background:var(--mint-soft)
}

.style-choices button:hover:not(:disabled) {
  border-color:var(--brand-accent)
}

.style-choices button:disabled {
  cursor:not-allowed;
  opacity:.65
}

.style-choices button:focus-visible {
  outline:2px solid var(--brand-accent);
  outline-offset:3px
}

.style-miniature {
  --tile-step: clamp(14px, 3vw, 39px);
  --orbit-radius: clamp(27px, 6vw, 79px);
  display:block;
  position:relative;
  height:146px;
  border-radius:5px;
  background:radial-gradient(ellipse at 53% 100%, #cde4d0, #f2f7ef 82%);
  overflow:hidden;
  perspective:500px
}

.mini-photo {
  position:absolute;
  top:50%;
  left:50%;
  width:36px;
  height:26px;
  border:1px solid #f9fdf6;
  background:linear-gradient(150deg,#eef3e6,#b5cdb9 62%,#769982);
  box-shadow:1px 5px 9px #4a6b5030
}

.mini-photo img {
  width:100%;
  height:100%;
  object-fit:cover
}

.tide .mini-photo {
  transform: translate(calc(-50% + var(--col) * var(--tile-step)), calc(-50% + var(--row) * 35px + var(--col) * 5px))
    rotateY(calc(var(--col) * -17deg)) rotate(calc(var(--col) * -6deg));
}
.fold .mini-photo {
  transform: translate(calc(-50% + var(--side) * (var(--orbit-radius) - var(--step) * 9px)), calc(-50% + var(--step) * 5px))
    translateZ(calc((1 - var(--step)) * 70px)) rotateY(calc(var(--side) * -40deg));
}
.space .mini-photo {
  transform: translate(calc(-50% + var(--orbit-x) * var(--orbit-radius)), calc(-50% + var(--orbit-y) * 39px))
    translateZ(calc(var(--orbit-y) * 27px)) rotateY(calc(var(--orbit-x) * -19deg));
}

.style-name {
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:5px;
  margin:14px 10px 6px;
  font-size:14px;
  font-weight:600;
  color:var(--text-primary)
}

.style-check {
  display:grid;
  place-items:center;
  width:18px;
  height:18px;
  border-radius:50%;
  background:var(--brand-accent);
  color:white
}

.style-choices small {
  display:block;
  margin:0 10px;
  color:var(--text-secondary);
  font-size:11px;
  line-height:1.6
}

.style-feedback {
  margin:16px 0 0;
  font-size:12px;
  color:var(--text-secondary)
}

.style-feedback.is-error {
  color:#a43730
}

.retry-style {
  border:1px solid var(--border-strong);
  background:var(--bg-surface);
  padding:10px 18px;
  margin-top:12px;
  border-radius:8px;
  font-size:12px;
  color:var(--brand-deep)
}

@media(max-width:640px) {
  .quick-styles {
    padding:20px 14px
  }
  .style-heading h2 {
    font-size:19px
  }
  .style-autosave {
    font-size:10px
  }
  .style-choices {
    gap:7px
  }
  .style-miniature {
    --tile-step: clamp(13px, 4vw, 23px);
    --orbit-radius: clamp(20px, 5.4vw, 36px);
    height:92px
  }
  .mini-photo {
    width:21px;
    height:16px
  }
  .style-name {
    font-size:12px;
    margin:12px 6px 5px
  }
  .style-choices small {
    margin:0 6px;
    font-size:11px
  }
  .style-check {
    width:15px;
    height:15px
  }
}

@media(prefers-reduced-motion:reduce) {
  .style-choices button {
    transition:none
  }
}
</style>
