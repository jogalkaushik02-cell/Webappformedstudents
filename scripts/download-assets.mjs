#!/usr/bin/env node
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(process.cwd(), 'public/assets')
const UA = 'ELITTrailerBuilder/1.0'
const assets = [
  ['https://grab3d.com/dl/samurai-rigged/samurai-rigged.glb', 'samurai-rigged.glb'],
  ['https://grab3d.com/dl/dragon/dragon.glb', 'dragon.glb'],
]

async function fetchAsset(url, out) {
  const response = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, redirect: 'follow' })
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length < 1024) throw new Error(`too small: ${url}`)
  if (buffer.subarray(0, 4).toString('ascii') !== 'glTF') throw new Error(`not GLB: ${url}`)
  if (buffer.subarray(0, 512).toString('utf8').toLowerCase().includes('<html')) throw new Error(`HTML response: ${url}`)
  await writeFile(path.join(ROOT, out), buffer)
  console.log(`OK ${out} ${(buffer.length / 1024 / 1024).toFixed(2)} MB`)
}

await mkdir(ROOT, { recursive: true })
await rm(path.join(ROOT, 'girl.glb'), { force: true })
for (const [url, out] of assets) await fetchAsset(url, out)
