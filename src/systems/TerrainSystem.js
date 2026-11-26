import * as THREE from 'three'
import { createNoise2D, fbm2, smoothstep } from '../utils/noise'

const noise = createNoise2D(9127)
export const TERRAIN_SIZE = 400

export function getPathCenter(z) {
  return Math.sin(z * 0.029) * 24 + Math.sin(z * 0.071 + 1.4) * 7.5 + Math.sin(z * 0.013 - 0.6) * 11
}

export function getPathMask(x, z) {
  const center = getPathCenter(z)
  const edgeNoise = noise(x * 0.24, z * 0.24) * 0.85 + noise(x * 0.8, z * 0.8) * 0.22
  const distance = Math.abs(x - center) + edgeNoise
  return 1 - smoothstep(3.2, 8.8, distance)
}

export function getTerrainHeight(x, z) {
  const broad = fbm2(noise, x * 0.009, z * 0.009, 5)
  const mid = fbm2(noise, x * 0.035, z * 0.035, 3)
  const fine = noise(x * 0.13, z * 0.13)
  let height = broad * 11.5 + mid * 2.1 + fine * 0.35
  height += Math.sin(x * 0.021 + 1.1) * 1.8 + Math.cos(z * 0.018) * 2.0
  const edge = smoothstep(135, 198, Math.max(Math.abs(x), Math.abs(z)))
  height += edge * edge * 27
  const path = getPathMask(x, z)
  height = height * (1 - path * 0.12) + path * (broad * 10.2 + mid * 1.7)
  return height
}

export function getTerrainNormal(x, z, target = new THREE.Vector3()) {
  const e = 0.35
  const hL = getTerrainHeight(x - e, z)
  const hR = getTerrainHeight(x + e, z)
  const hD = getTerrainHeight(x, z - e)
  const hU = getTerrainHeight(x, z + e)
  return target.set(hL - hR, 2 * e, hD - hU).normalize()
}

function setTextureDefaults(texture, isColor = false) {
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 8
  if (isColor) texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

export default class TerrainSystem {
  constructor({ scene, renderer, textures }) {
    this.scene = scene
    this.renderer = renderer
    this.textures = textures
    this.group = new THREE.Group()
    this.group.name = 'Terrain'
    this.uniforms = null
    this.build()
  }

  getHeight(x, z) {
    return getTerrainHeight(x, z)
  }

  getNormal(x, z, target) {
    return getTerrainNormal(x, z, target)
  }

  getPathMask(x, z) {
    return getPathMask(x, z)
  }

  getPathCenter(z) {
    return getPathCenter(z)
  }

  build() {
    const geometry = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, 256, 256)
    geometry.rotateX(-Math.PI / 2)
    const position = geometry.attributes.position
    const pathMask = new Float32Array(position.count)
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i)
      const z = position.getZ(i)
      position.setY(i, getTerrainHeight(x, z))
      pathMask[i] = getPathMask(x, z)
    }
    geometry.setAttribute('aPathMask', new THREE.BufferAttribute(pathMask, 1))
    geometry.computeVertexNormals()

    const grassColor = setTextureDefaults(this.textures.grassColor.clone(), true)
    const grassNormal = setTextureDefaults(this.textures.grassNormal.clone(), false)
    const grassRough = setTextureDefaults(this.textures.grassRough.clone(), false)
    const dirtColor = setTextureDefaults(this.textures.dirtColor.clone(), true)
    const dirtNormal = setTextureDefaults(this.textures.dirtNormal.clone(), false)
    const dirtRough = setTextureDefaults(this.textures.dirtRough.clone(), false)
    const maxAnisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
    for (const texture of [grassColor, grassNormal, grassRough, dirtColor, dirtNormal, dirtRough]) {
      texture.anisotropy = maxAnisotropy
    }

    const material = new THREE.MeshStandardMaterial({
      map: grassColor,
      normalMap: grassNormal,
      roughnessMap: grassRough,
      roughness: 1,
      metalness: 0,
      normalScale: new THREE.Vector2(0.9, 0.9),
      dithering: true,
    })
    material.name = 'TerrainSplatPBR'
    material.customProgramCacheKey = () => 'terrain-splat-v2'

    material.onBeforeCompile = (shader) => {
      shader.uniforms.uDirtColorMap = { value: dirtColor }
      shader.uniforms.uDirtNormalMap = { value: dirtNormal }
      shader.uniforms.uDirtRoughMap = { value: dirtRough }
      shader.uniforms.uWetness = { value: 0 }

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float aPathMask;\nvarying float vPathMask;\nvarying vec3 vTerrainWorld;',
        )
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvPathMask = aPathMask;\nvTerrainWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        )

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform sampler2D uDirtColorMap;
uniform sampler2D uDirtNormalMap;
uniform sampler2D uDirtRoughMap;
uniform float uWetness;
varying float vPathMask;
varying vec3 vTerrainWorld;
float gSplat = 0.0;`,
        )
        .replace(
          '#include <map_fragment>',
          `#ifdef USE_MAP
  vec2 grassUv = vTerrainWorld.xz * 0.055;
  vec2 dirtUv = vTerrainWorld.xz * 0.074;
  float edgeNoiseA = sin(vTerrainWorld.x * 0.91 + vTerrainWorld.z * 0.37) * 0.5 + 0.5;
  float edgeNoiseB = sin(vTerrainWorld.x * 0.31 - vTerrainWorld.z * 1.13) * 0.5 + 0.5;
  float path = smoothstep(0.18, 0.82, vPathMask + (edgeNoiseA - 0.5) * 0.13 + (edgeNoiseB - 0.5) * 0.07);
  gSplat = path;
  vec4 grassTex = texture2D(map, grassUv);
  vec4 dirtTex = texture2D(uDirtColorMap, dirtUv);
  vec4 sampledDiffuseColor = mix(grassTex, dirtTex, path);
  sampledDiffuseColor.rgb *= mix(vec3(1.0), vec3(0.50, 0.43, 0.36), uWetness * path);
  diffuseColor *= sampledDiffuseColor;
#endif`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
  vec4 grassRough = texture2D(roughnessMap, vTerrainWorld.xz * 0.055);
  vec4 dirtRough = texture2D(uDirtRoughMap, vTerrainWorld.xz * 0.074);
  roughnessFactor *= mix(grassRough.g, dirtRough.g, gSplat);
  roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.45, uWetness * gSplat);
#endif`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#ifdef USE_NORMALMAP_TANGENTSPACE
  vec3 grassN = texture2D(normalMap, vTerrainWorld.xz * 0.055).xyz * 2.0 - 1.0;
  vec3 dirtN = texture2D(uDirtNormalMap, vTerrainWorld.xz * 0.074).xyz * 2.0 - 1.0;
  vec3 mapN = normalize(mix(grassN, dirtN, gSplat));
  mapN.xy *= normalScale;
  normal = normalize(tbn * mapN);
#endif`,
        )

      this.uniforms = shader.uniforms
      material.userData.shader = shader
    }

    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = 'RollingValleyTerrain'
    mesh.receiveShadow = true
    mesh.castShadow = false
    this.group.add(mesh)
    this.mesh = mesh
    this.material = material
    this.scene.add(this.group)
  }

  setWetness(value) {
    if (this.uniforms?.uWetness) this.uniforms.uWetness.value = value
  }
}
