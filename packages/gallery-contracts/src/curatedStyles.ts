import { mergeViewerConfig, type ViewerConfig } from './viewerConfig'
import { PHOTO_ARRANGEMENTS, photoPresentationPatch, resolvePhotoArrangement, type PhotoArrangement } from './photoEffects'

/** Composition changes preserve the gallery's background, lighting and effects. */
export const CURATED_STYLES = [
  { id: 'helix', label: '螺旋', caption: '让回忆沿光线生长', color: '#657eab' },
  { id: 'carousel', label: '环幕', caption: '置身照片的怀抱', color: '#bd906d' },
  { id: 'grid', label: '波浪', caption: '光影如潮汐展开', color: '#689d9a' },
  { id: 'filmstrip', label: '胶片', caption: '沿着画格，回看每段故事', color: '#b6b9b4' },
  { id: 'book', label: '翻页', caption: '把光阴，翻成一本书', color: '#c7b68e' },
  { id: 'tunnel', label: '穿行', caption: '穿过光影，走进下一段回忆', color: '#93a7c0' }
] as const
export type CuratedStyle = typeof CURATED_STYLES[number]['id']

export const SPATIAL_PRESETS = [
  { id: 'tide', label: '潮汐', caption: '整面照片随波起伏' },
  { id: 'fold', label: '折廊', caption: '沿廊道穿过两侧作品' },
  { id: 'space', label: '空间', caption: '多层照片围成开合的光圈' }
] as const satisfies readonly { id: PhotoArrangement; label: string; caption: string }[]
export type SpatialPreset = typeof SPATIAL_PRESETS[number]['id']

export const SPATIAL_PALETTE = { mode: 'gradient', color: '#f5f8f1', secondaryColor: '#dcebdd', angle: 135, motion: false } as const

export function resolveSpatialPreset(config?: ViewerConfig | null): SpatialPreset | undefined {
  if (config?.layout.params?.composition !== 'curated') return undefined
  return SPATIAL_PRESETS.find(preset => preset.id === config.layout.params?.arrangement)?.id
}

/** The collection scenes use a shared daylight palette and keep artwork colors neutral. */
export function applySpatialTheme(config: ViewerConfig): ViewerConfig {
  const next = mergeViewerConfig(config, {
    particles: { enabled: false },
    effects: {
      photo: { style: 'none', intensity: 0, speed: 0 }, photoFloat: false, photoEntrance: 'none',
      bloom: { enabled: false }, fog: { enabled: false },
      postGrade: { enabled: false }, vignette: { enabled: false }
    },
    lighting: { timeOfDay: 'noon', autoColorAdapt: false },
    interaction: { clickRipple: false, cursorTrail: false }
  })
  next.background = { ...SPATIAL_PALETTE }
  return next
}

export function applySpatialPreset(config: ViewerConfig, preset: SpatialPreset): ViewerConfig {
  return applySpatialTheme(mergeViewerConfig(applyPhotoArrangement(config, preset), {
    layout: { transition: { style: 'smooth', duration: 1.2 } },
    camera: { autoRotate: true, introFlight: false }
  }))
}

const CURATED_STYLE_ARRANGEMENTS = {
  helix: 'ribbon', carousel: 'arc', grid: 'wave', filmstrip: 'filmstrip', book: 'book', tunnel: 'tunnel'
} as const satisfies Record<CuratedStyle, PhotoArrangement>

/** Apply one visual composition without changing the authored atmosphere or photo treatment. */
export function applyPhotoArrangement(current: ViewerConfig, arrangement: PhotoArrangement): ViewerConfig {
  const definition = PHOTO_ARRANGEMENTS.find(item => item.id === arrangement)!
  return mergeViewerConfig(mergeViewerConfig(current, photoPresentationPatch(current)), {
    customized: true,
    layout: { mode: definition.mode, params: { composition: 'curated', arrangement },
      transition: { style: current.layout.transition?.style === 'none' ? 'none' : 'smooth' } }
  })
}

export function applyCuratedStyle(current: ViewerConfig, mode: CuratedStyle): ViewerConfig {
  return applyPhotoArrangement(current, CURATED_STYLE_ARRANGEMENTS[mode])
}

/** Selection is based on the rendered arrangement; book and tunnel share the helix geometry mode. */
export function resolveCuratedStyle(config: ViewerConfig): CuratedStyle | undefined {
  if (config.layout.params?.composition !== 'curated') return undefined
  const arrangement = resolvePhotoArrangement(config)
  return CURATED_STYLES.find(item => CURATED_STYLE_ARRANGEMENTS[item.id] === arrangement)?.id
}
