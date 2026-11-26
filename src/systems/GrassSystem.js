import * as THREE from 'three'
import { mulberry } from '../utils/noise'

const QUADRANTS = 4
const NEAR_RADIUS = 35
const MID_RADIUS = 85
const MAX_NEAR_PER_QUADRANT = 1050
const MAX_MID_PER_QUADRANT = 1450

function makeBladeGeometry(segments) {
  const positions = []
  const uvs = []
  const indices = []
  const halfWidth = 0.04
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments
    const width = halfWidth * (1 - t * 0.92)
    const curve = t * t * 0.16
    positions.push(-width + curve, t, 0, width + curve, t, 0)
    uvs.push(0, t, 1, t)
    if (i < segments) {
      const a = i * 2
      const b = a + 1
      const c = a + 2
      const d = a + 3
      indices.push(a, c, b, b, c, d)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function makeGrassMaterial({ side = THREE.DoubleSide, mid = false } = {}) {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.82,
    metalness: 0,
    side,
    dithering: true,
  })
  material.name = mid ? 'GrassMidLOD' : 'GrassNearLOD'
  material.customProgramCacheKey = () => `grass-${mid ? 'mid' : 'near'}-v2`

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 }
    shader.uniforms.uWindStrength = { value: 0.7 }
    shader.uniforms.uPlayerPos = { value: new THREE.Vector3() }
    shader.uniforms.uSunViewDir = { value: new THREE.Vector3(0, 1, 0) }
    shader.uniforms.uTipColor = { value: new THREE.Color(mid ? 0.34 : 0.46, mid ? 0.42 : 0.56, 0.12) }

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
uniform float uWindStrength;
uniform vec3 uPlayerPos;
varying float vBladeHeight;
varying vec3 vGrassWorld;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vBladeHeight = uv.y;
vec4 grassInstanceWorld = instanceMatrix * vec4(transformed, 1.0);
vec3 grassWorld = (modelMatrix * grassInstanceWorld).xyz;
float gustA = sin(grassWorld.x * 0.19 + grassWorld.z * 0.13 + uTime * 1.8);
float gustB = sin(grassWorld.x * 0.07 - grassWorld.z * 0.11 + uTime * 0.83);
float gust = 0.5 + 0.5 * (gustA * 0.65 + gustB * 0.35);
float bend = smoothstep(0.0, 1.0, position.y);
transformed.x += bend * bend * (0.06 + gust * 0.16) * uWindStrength;
transformed.z += bend * bend * (0.02 + gustA * 0.035) * uWindStrength;
vec2 away = grassWorld.xz - uPlayerPos.xz;
float awayDist = length(away);
float push = (1.0 - smoothstep(0.0, 1.4, awayDist)) * 0.34 * bend;
transformed.xz += normalize(away + vec2(0.0001)) * push;
vGrassWorld = (modelMatrix * (instanceMatrix * vec4(transformed, 1.0))).xyz;`,
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uSunViewDir;
uniform vec3 uTipColor;
varying float vBladeHeight;
varying vec3 vGrassWorld;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
diffuseColor.rgb *= mix(vec3(0.34, 0.30, 0.18), vec3(1.02, 1.04, 0.92), smoothstep(0.0, 0.7, vBladeHeight));`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
float grassBack = pow(clamp(dot(normalize(vViewPosition), uSunViewDir), 0.0, 1.0), 2.0);
totalEmissiveRadiance += uTipColor * grassBack * smoothstep(0.35, 1.0, vBladeHeight) * 0.7;`,
      )

    material.userData.shader = shader
  }

  return material
}

export default class GrassSystem {
  constructor({ scene, terrain, renderer }) {
    this.scene = scene
    this.terrain = terrain
    this.renderer = renderer
    this.group = new THREE.Group()
    this.group.name = 'Grass'
    this.group.frustumCulled = false
    this.nearGeometry = makeBladeGeometry(5)
    this.midGeometry = makeBladeGeometry(2)
    this.nearMaterial = makeGrassMaterial()
    this.midMaterial = makeGrassMaterial({ mid: true })
    this.nearMeshes = []
    this.midMeshes = []
    this.dummy = new THREE.Object3D()
    this.color = new THREE.Color()
    this.lastCenter = new THREE.Vector3(1e9, 0, 1e9)
    this.settings = {
      density: 1,
      bladeHeight: 1,
      windStrength: 0.7,
      lodDistance: MID_RADIUS,
    }
    this.time = 0
    this.build()
    this.scene.add(this.group)
  }

  build() {
    for (let q = 0; q < QUADRANTS; q += 1) {
      const near = new THREE.InstancedMesh(this.nearGeometry, this.nearMaterial, MAX_NEAR_PER_QUADRANT)
      near.name = `GrassNear-${q}`
      near.receiveShadow = true
      near.castShadow = false
      near.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      near.frustumCulled = true
      this.group.add(near)
      this.nearMeshes.push(near)

      const mid = new THREE.InstancedMesh(this.midGeometry, this.midMaterial, MAX_MID_PER_QUADRANT)
      mid.name = `GrassMid-${q}`
      mid.receiveShadow = true
      mid.castShadow = false
      mid.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mid.frustumCulled = true
      this.group.add(mid)
      this.midMeshes.push(mid)
    }
  }

  setSettings(next) {
    const needsRebuild =
      next.density !== this.settings.density ||
      next.bladeHeight !== this.settings.bladeHeight ||
      next.lodDistance !== this.settings.lodDistance
    this.settings = { ...this.settings, ...next }
    this.nearMaterial.uniformsNeedUpdate = true
    if (needsRebuild) this.lastCenter.set(1e9, 0, 1e9)
  }

  update(time, playerPos, camera, sunDirection, dt) {
    this.time = time
    const moved = this.lastCenter.distanceToSquared(playerPos) > 12 * 12
    if (moved) {
      this.rebuild(playerPos)
      this.lastCenter.copy(playerPos)
    }
    const sunView = sunDirection.clone().transformDirection(camera.matrixWorldInverse)
    for (const material of [this.nearMaterial, this.midMaterial]) {
      const shader = material.userData.shader
      if (!shader) continue
      shader.uniforms.uTime.value = time
      shader.uniforms.uWindStrength.value = this.settings.windStrength
      shader.uniforms.uPlayerPos.value.copy(playerPos)
      shader.uniforms.uSunViewDir.value.copy(sunView)
    }
  }

  rebuild(playerPos) {
    const seedBase =
      (Math.floor(playerPos.x / 12) * 73856093) ^
      (Math.floor(playerPos.z / 12) * 19349663) ^
      0x5f3759df
    const density = this.settings.density
    const heightScale = this.settings.bladeHeight
    const outer = Math.max(NEAR_RADIUS + 8, this.settings.lodDistance)

    for (let q = 0; q < QUADRANTS; q += 1) {
      const near = this.nearMeshes[q]
      const mid = this.midMeshes[q]
      const random = mulberry((seedBase ^ (q * 83492791)) >>> 0)
      const startAngle = (q * Math.PI) / 2
      const angleSpan = Math.PI / 2

      let nearCount = 0
      const nearTarget = Math.floor(MAX_NEAR_PER_QUADRANT * density)
      for (let i = 0; i < nearTarget; i += 1) {
        const angle = startAngle + random() * angleSpan
        const radius = Math.sqrt(1.2 * 1.2 + random() * (NEAR_RADIUS * NEAR_RADIUS - 1.44))
        const x = playerPos.x + Math.cos(angle) * radius
        const z = playerPos.z + Math.sin(angle) * radius
        if (Math.abs(x) > 194 || Math.abs(z) > 194) continue
        if (this.terrain.getPathMask(x, z) > 0.35) continue
        const y = this.terrain.getHeight(x, z)
        const height = (0.42 + random() * 0.58) * heightScale
        const width = 0.78 + random() * 0.55
        this.dummy.position.set(x, y + 0.015, z)
        this.dummy.rotation.set((random() - 0.5) * 0.26, random() * Math.PI * 2, (random() - 0.5) * 0.26)
        this.dummy.scale.set(width, height, 1)
        this.dummy.updateMatrix()
        near.setMatrixAt(nearCount, this.dummy.matrix)
        this.color.setHSL(0.19 + random() * 0.075, 0.42 + random() * 0.22, 0.29 + random() * 0.16)
        near.setColorAt(nearCount, this.color)
        nearCount += 1
      }
      near.count = nearCount
      near.instanceMatrix.needsUpdate = true
      if (near.instanceColor) near.instanceColor.needsUpdate = true
      near.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(
          playerPos.x + Math.cos(startAngle + angleSpan / 2) * 18,
          playerPos.y + 2,
          playerPos.z + Math.sin(startAngle + angleSpan / 2) * 18,
        ),
        19,
      )

      let midCount = 0
      const midTarget = Math.floor(MAX_MID_PER_QUADRANT * density)
      for (let i = 0; i < midTarget; i += 1) {
        const angle = startAngle + random() * angleSpan
        const radius = Math.sqrt(
          NEAR_RADIUS * NEAR_RADIUS + random() * (outer * outer - NEAR_RADIUS * NEAR_RADIUS),
        )
        const x = playerPos.x + Math.cos(angle) * radius
        const z = playerPos.z + Math.sin(angle) * radius
        if (Math.abs(x) > 196 || Math.abs(z) > 196) continue
        if (this.terrain.getPathMask(x, z) > 0.35) continue
        const y = this.terrain.getHeight(x, z)
        const edgeFade = 1 - THREE.MathUtils.smoothstep(radius, outer - 12, outer)
        const height = (0.28 + random() * 0.38) * heightScale * (0.35 + edgeFade * 0.65)
        const width = 0.9 + random() * 0.55
        this.dummy.position.set(x, y + 0.012, z)
        this.dummy.rotation.set((random() - 0.5) * 0.2, random() * Math.PI * 2, (random() - 0.5) * 0.2)
        this.dummy.scale.set(width, height, 1)
        this.dummy.updateMatrix()
        mid.setMatrixAt(midCount, this.dummy.matrix)
        this.color.setHSL(0.2 + random() * 0.05, 0.28 + random() * 0.16, 0.22 + random() * 0.1)
        mid.setColorAt(midCount, this.color)
        midCount += 1
      }
      mid.count = midCount
      mid.instanceMatrix.needsUpdate = true
      if (mid.instanceColor) mid.instanceColor.needsUpdate = true
      mid.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(
          playerPos.x + Math.cos(startAngle + angleSpan / 2) * ((NEAR_RADIUS + outer) / 2),
          playerPos.y + 2,
          playerPos.z + Math.sin(startAngle + angleSpan / 2) * ((NEAR_RADIUS + outer) / 2),
        ),
        (outer - NEAR_RADIUS) / 2 + 8,
      )
    }
  }
}
