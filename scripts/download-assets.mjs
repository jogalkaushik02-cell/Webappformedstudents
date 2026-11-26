#!/usr/bin/env node
/**
 * Tsushima Explorer — deterministic CC0 asset fetcher.
 *
 * All remote files are resolved through the Poly Haven files API (or the
 * Three.js example CDN for the rigged character). No CDN paths are guessed.
 * Every download is validated before it is accepted.
 */
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const API = 'https://api.polyhaven.com'
const USER_AGENT = 'TsushimaWorldBuilder/1.0'
const ROOT = path.resolve(process.cwd(), 'public/assets')
const MIN_BYTES = 1024

const manifest = {
  generatedAt: new Date().toISOString(),
  credit: 'Assets via Poly Haven (CC0)',
  hdri: {},
  textures: {},
  rocks: {},
  character: {},
}

function log(message) {
  process.stdout.write(`${message}\n`)
}

function bytes(n) {
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`
}

async function request(url, { as = 'buffer', tries = 3 } = {}) {
  let lastError
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
        redirect: 'follow',
      })
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
      if (as === 'json') return await response.json()
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      lastError = error
      if (attempt < tries) await new Promise((resolve) => setTimeout(resolve, 700 * attempt))
    }
  }
  throw lastError
}

async function api(pathname) {
  return request(`${API}${pathname}`, { as: 'json' })
}

async function ensureDir(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true })
}

function assertPayload(buffer, { kind, label }) {
  if (!buffer || buffer.length < MIN_BYTES) {
    throw new Error(`${label}: file is too small (${buffer?.length ?? 0} bytes)`)
  }
  const head = buffer.subarray(0, 512).toString('utf8').trim().toLowerCase()
  if (head.startsWith('<!doctype html') || head.startsWith('<html') || head.includes('<body')) {
    throw new Error(`${label}: received HTML instead of an asset`)
  }
  if (kind === 'hdr' && !head.includes('#?radiance') && !head.includes('#?rgbe')) {
    throw new Error(`${label}: missing Radiance HDR signature`)
  }
  if (kind === 'jpg' && !(buffer[0] === 0xff && buffer[1] === 0xd8)) {
    throw new Error(`${label}: missing JPEG signature`)
  }
  if (kind === 'glb' && buffer.subarray(0, 4).toString('ascii') !== 'glTF') {
    throw new Error(`${label}: missing GLB signature`)
  }
  if (kind === 'gltf') {
    try {
      JSON.parse(buffer.toString('utf8'))
    } catch {
      throw new Error(`${label}: invalid glTF JSON`)
    }
  }
}

async function download(url, relativePath, kind = 'binary', label = relativePath) {
  const target = path.join(ROOT, relativePath)
  await ensureDir(target)
  const buffer = await request(url)
  assertPayload(buffer, { kind, label })
  await writeFile(target, buffer)
  log(`  ✓ ${relativePath} — ${bytes(buffer.length)}`)
  return { path: target, bytes: buffer.length, url }
}

async function filesFor(slug) {
  return api(`/files/${encodeURIComponent(slug)}`)
}

async function firstWorkingSlug(preferred, fallbacks = []) {
  for (const slug of [preferred, ...fallbacks]) {
    if (!slug) continue
    try {
      const data = await filesFor(slug)
      if (data && typeof data === 'object' && Object.keys(data).length) return { slug, data }
    } catch {
      log(`  ! ${slug} unavailable, trying next candidate`)
    }
  }
  return null
}

async function findAsset(type, terms, preferred = []) {
  const assets = await api(`/assets?type=${type}`)
  const slugs = Object.keys(assets)
  for (const term of terms) {
    const match = slugs.find((slug) => slug.includes(term))
    if (match) return match
  }
  return preferred[0] ?? slugs[0]
}

async function resolveHdri({ label, preferred, fallbackTerms, output }) {
  log(`\n[HDRI] ${label}`)
  const found = await firstWorkingSlug(preferred)
  let slug = found?.slug
  let data = found?.data
  if (!slug) {
    slug = await findAsset('hdris', fallbackTerms)
    data = await filesFor(slug)
  }
  const url = data?.hdri?.['1k']?.hdr?.url
  if (!url) throw new Error(`No 1K HDR URL for ${slug}`)
  const result = await download(url, output, 'hdr', label)
  manifest.hdri[label] = { slug, ...result, path: undefined }
  return { slug, ...result }
}

async function resolveTextureSet({ label, preferred, fallbacks, terms, prefix }) {
  log(`\n[Texture] ${label}`)
  const found = await firstWorkingSlug(preferred, fallbacks)
  let slug = found?.slug
  let data = found?.data
  if (!slug) {
    slug = await findAsset('textures', terms)
    data = await filesFor(slug)
  }
  const channels = [
    ['color', 'Diffuse', 'diff'],
    ['normal', 'nor_gl', 'nor_gl'],
    ['rough', 'Rough', 'rough'],
  ]
  const result = {}
  for (const [suffix, channel, fileSuffix] of channels) {
    const url = data?.[channel]?.['1k']?.jpg?.url
    if (!url) throw new Error(`${slug} has no 1K JPG ${channel} channel`)
    const out = `${prefix}_${suffix}.jpg`
    result[suffix] = await download(url, out, 'jpg', out)
  }
  manifest.textures[label] = { slug, ...result }
  return { slug, ...result }
}

async function downloadRockSet() {
  log('\n[Model] Mossy boulder set')
  const found = await firstWorkingSlug('rock_moss_set_01', ['rock_moss_set_02'])
  let slug = found?.slug
  let data = found?.data
  if (!slug) {
    slug = await findAsset('models', ['rock_moss', 'rock'])
    data = await filesFor(slug)
  }
  const entry = data?.gltf?.['1k']?.gltf
  if (!entry?.url) throw new Error(`No 1K glTF entry for ${slug}`)

  const gltfName = `${slug}_1k.gltf`
  const gltfResult = await download(entry.url, `rocks/${gltfName}`, 'gltf', gltfName)
  const gltf = JSON.parse(await readFile(gltfResult.path, 'utf8'))
  const includes = entry.include ?? {}
  for (const [relative, info] of Object.entries(includes)) {
    if (!info?.url) continue
    const cleanRelative = relative.replaceAll('\\', '/').replace(/^\.\//, '')
    const kind = /\.jpe?g$/i.test(cleanRelative) ? 'jpg' : /\.gltf$/i.test(cleanRelative) ? 'gltf' : 'binary'
    await download(info.url, `rocks/${cleanRelative}`, kind, cleanRelative)
  }
  manifest.rocks = { slug, gltf: `rocks/${gltfName}`, ...gltfResult }
  return { slug, gltf: `rocks/${gltfName}` }
}

async function downloadCharacter() {
  log('\n[Character] Rigged humanoid')
  const url = 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Soldier.glb'
  const result = await download(url, 'character_rig.glb', 'glb', 'character_rig.glb')
  manifest.character = {
    source: 'Three.js examples (MIT)',
    ...result,
  }
  return result
}

async function downloadSamurai() {
  log('\n[Character] CC0 rigged samurai')
  const url = 'https://grab3d.com/dl/samurai-rigged/samurai-rigged.glb'
  const result = await download(url, 'samurai-rigged.glb', 'glb', 'samurai-rigged.glb')
  manifest.samurai = {
    source: 'Grab3D (CC0 1.0)',
    ...result,
  }
  return result
}

async function downloadDragon() {
  log('\n[Model] CC0 low-poly flying mount dragon')
  const url = 'https://grab3d.com/dl/low-poly-dragon/low-poly-dragon.glb'
  const result = await download(url, 'low-poly-dragon.glb', 'glb', 'low-poly-dragon.glb')
  manifest.dragon = {
    source: 'Grab3D (CC0 1.0)',
    ...result,
  }
  return result
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(full)))
    else {
      const info = await stat(full)
      files.push({ path: path.relative(ROOT, full), size: info.size })
    }
  }
  return files
}

async function verifyTree() {
  const files = await walk(ROOT)
  if (!files.length) throw new Error('Asset tree is empty')
  const suspicious = files.filter((file) => file.size < MIN_BYTES)
  if (suspicious.length) {
    throw new Error(`Suspiciously small files: ${suspicious.map((f) => f.path).join(', ')}`)
  }
  const required = [
    'sky_sunny.hdr',
    'sky_overcast.hdr',
    'grass_color.jpg',
    'grass_normal.jpg',
    'grass_rough.jpg',
    'dirt_color.jpg',
    'dirt_normal.jpg',
    'dirt_rough.jpg',
    'bark_color.jpg',
    'bark_normal.jpg',
    'bark_rough.jpg',
    'character_rig.glb',
    'samurai-rigged.glb',
    'low-poly-dragon.glb',
  ]
  for (const name of required) {
    if (!files.some((file) => file.path === name)) throw new Error(`Missing required asset: ${name}`)
  }
  log('\n[Verification] All assets present:')
  for (const file of files.sort((a, b) => a.path.localeCompare(b.path))) {
    log(`  ${file.path.padEnd(48)} ${bytes(file.size)}`)
  }
  await writeFile(path.join(ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2))
  log(`\nTotal: ${files.length} files, ${bytes(files.reduce((sum, file) => sum + file.size, 0))}`)
}

async function main() {
  await mkdir(ROOT, { recursive: true })
  log('Tsushima Explorer — CC0 asset downloader')
  log(`Target: ${ROOT}`)

  await resolveHdri({
    label: 'sky_sunny',
    preferred: 'kloofendal_48d_partly_cloudy_puresky',
    fallbackTerms: ['partly_cloudy', 'sunny', 'clear'],
    output: 'sky_sunny.hdr',
  })
  await resolveHdri({
    label: 'sky_overcast',
    preferred: 'kloofendal_overcast_puresky',
    fallbackTerms: ['overcast', 'cloudy', 'rain'],
    output: 'sky_overcast.hdr',
  })
  await resolveTextureSet({
    label: 'grass',
    preferred: 'aerial_grass_rock',
    fallbacks: ['forest_ground_04'],
    terms: ['grass', 'forest_ground', 'meadow'],
    prefix: 'grass',
  })
  await resolveTextureSet({
    label: 'dirt',
    preferred: 'brown_mud_leaves_01',
    fallbacks: ['forest_ground_04', 'rocky_terrain_02'],
    terms: ['mud', 'dirt', 'gravel'],
    prefix: 'dirt',
  })
  await resolveTextureSet({
    label: 'bark',
    preferred: 'bark_brown_01',
    fallbacks: ['bark_willow'],
    terms: ['bark'],
    prefix: 'bark',
  })
  await downloadRockSet()
  await downloadCharacter()
  await downloadSamurai()
  await downloadDragon()
  await verifyTree()
  log('\nDone. Start the app with: npm run dev')
}

main().catch(async (error) => {
  console.error('\nAsset download failed:', error?.stack ?? error)
  process.exitCode = 1
})
