import test from 'node:test'
import assert from 'node:assert/strict'
import { applySpatialPreset, normalizeViewerConfig, resolvePhotoArrangement, resolveSpatialPreset, serializeViewerConfig } from '../src'

test('the three approved scenes are valid published arrangements', () => {
  for (const arrangement of ['tide', 'fold', 'space']) {
    const result = normalizeViewerConfig({ layout: { params: { composition: 'curated', arrangement } } })
    assert.deepEqual(result.issues, [])
    assert.equal(resolvePhotoArrangement(result.config), arrangement)
  }
})

test('choosing a spatial scene applies daylight and preserves the download permission', () => {
  const previous = normalizeViewerConfig({ visitorAllowDownload: true, background: { mode: 'solid', color: '#18251f' } }).config
  const next = applySpatialPreset(previous, 'space')
  assert.equal(next.visitorAllowDownload, true)
  assert.equal(next.background?.color, '#f5f8f1')
  assert.equal(next.effects.photo?.style, 'none')
  assert.equal(previous.background?.color, '#18251f')
})

test('each photo choreography round-trips as a saved spatial preset', () => {
  for (const arrangement of ['burst', 'domino', 'fans']) {
    const result = normalizeViewerConfig({ layout: { params: { composition: 'curated', arrangement } } })
    assert.deepEqual(result.issues, [])
    assert.equal(resolveSpatialPreset(normalizeViewerConfig(JSON.parse(serializeViewerConfig(result.config))).config), arrangement)
  }
})
