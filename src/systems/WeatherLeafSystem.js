import * as THREE from 'three'
import { mulberry } from '../utils/noise'

const LEAF_COUNT = 450
const RAIN_COUNT = 1600

function makeLeafSprite() {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, 128, 128)
  ctx.save()
  ctx.translate(64, 64)
  ctx.rotate(-0.22)
  ctx.beginPath()
  ctx.moveTo(0, 52)
  ctx.bezierCurveTo(40, 28, 40, -28, 0, -54)
  ctx.bezierCurveTo(-40, -28, -40, 28, 0, 52)
  ctx.fillStyle = '#e7ad35'
  ctx.fill()
  ctx.strokeStyle = 'rgba(88, 45, 12, 0.5)'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(0, 48)
  ctx.lineTo(0, -46)
  ctx.strokeStyle = 'rgba(255, 247, 218, 0.5)'
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.restore()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

function createInstancedQuadGeometry(count) {
  const base = new THREE.PlaneGeometry(1, 1)
  const geometry = new THREE.InstancedBufferGeometry()
  geometry.index = base.index
  geometry.attributes.position = base.attributes.position
  geometry.attributes.uv = base.attributes.uv
  geometry.instanceCount = count
  return geometry
}

function buildLeaves() {
  const geometry = createInstancedQuadGeometry(LEAF_COUNT)
  const offsets = new Float32Array(LEAF_COUNT * 3)
  const phases = new Float32Array(LEAF_COUNT)
  const speeds = new Float32Array(LEAF_COUNT)
  const tints = new Float32Array(LEAF_COUNT * 3)
  const random = mulberry(8812)
  const autumn = new THREE.Color('#e7ad35')
  const sakura = new THREE.Color('#ffe0ea')
  const green = new THREE.Color('#a6a04c')
  for (let i = 0; i < LEAF_COUNT; i += 1) {
    offsets[i * 3] = (random() - 0.5) * 40
    offsets[i * 3 + 1] = random() * 18
    offsets[i * 3 + 2] = (random() - 0.5) * 40
    phases[i] = random() * Math.PI * 2
    speeds[i] = 0.35 + random() * 0.85
    const color = random() < 0.52 ? autumn : random() < 0.78 ? sakura : green
    tints[i * 3] = color.r
    tints[i * 3 + 1] = color.g
    tints[i * 3 + 2] = color.b
  }
  geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3))
  geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1))
  geometry.setAttribute('aSpeed', new THREE.InstancedBufferAttribute(speeds, 1))
  geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(tints, 3))
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPlayerPos: { value: new THREE.Vector3() },
      uWind: { value: 0.6 },
      uMap: { value: makeLeafSprite() },
      uFogColor: { value: new THREE.Color('#b7c7bf') },
      uFogDensity: { value: 0.006 },
      uOpacity: { value: 1 },
    },
    vertexShader: `
      attribute vec3 aOffset;
      attribute float aPhase;
      attribute float aSpeed;
      attribute vec3 aTint;
      uniform float uTime;
      uniform vec3 uPlayerPos;
      uniform float uWind;
      varying vec2 vUv;
      varying vec3 vTint;
      varying float vFogDepth;
      mat3 rotateX(float a) { float c = cos(a); float s = sin(a); return mat3(1.0,0.0,0.0, 0.0,c,-s, 0.0,s,c); }
      mat3 rotateY(float a) { float c = cos(a); float s = sin(a); return mat3(c,0.0,s, 0.0,1.0,0.0, -s,0.0,c); }
      mat3 rotateZ(float a) { float c = cos(a); float s = sin(a); return mat3(c,-s,0.0, s,c,0.0, 0.0,0.0,1.0); }
      void main() {
        vUv = uv;
        vTint = aTint;
        vec3 p = aOffset;
        p.x = mod(p.x + uTime * aSpeed * 0.8 + uWind * 2.0 + uPlayerPos.x + 20.0, 40.0) - 20.0 + uPlayerPos.x;
        p.z = mod(p.z + uTime * aSpeed * 0.35 + uPlayerPos.z + 20.0, 40.0) - 20.0 + uPlayerPos.z;
        p.y = mod(p.y - uTime * (0.45 + aSpeed * 0.35) + uPlayerPos.y + 9.0, 18.0) - 9.0 + uPlayerPos.y + 7.0;
        float angle = uTime * aSpeed * 2.5 + aPhase;
        mat3 tumble = rotateX(angle * 0.7) * rotateY(angle) * rotateZ(angle * 0.43);
        vec3 local = tumble * vec3(position.xy * 0.23, 0.0);
        vec3 world = p + local;
        vec4 mv = modelViewMatrix * vec4(world, 1.0);
        vFogDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform float uOpacity;
      varying vec2 vUv;
      varying vec3 vTint;
      varying float vFogDepth;
      void main() {
        vec4 tex = texture2D(uMap, vUv);
        if (tex.a < 0.3) discard;
        float fog = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
        vec3 color = tex.rgb * vTint;
        gl_FragColor = vec4(mix(color, uFogColor, fog), tex.a * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.renderOrder = 5
  return mesh
}

function buildRain() {
  const geometry = createInstancedQuadGeometry(RAIN_COUNT)
  const offsets = new Float32Array(RAIN_COUNT * 3)
  const speeds = new Float32Array(RAIN_COUNT)
  const random = mulberry(4411)
  for (let i = 0; i < RAIN_COUNT; i += 1) {
    offsets[i * 3] = (random() - 0.5) * 30
    offsets[i * 3 + 1] = random() * 22
    offsets[i * 3 + 2] = (random() - 0.5) * 30
    speeds[i] = 8 + random() * 10
  }
  geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3))
  geometry.setAttribute('aSpeed', new THREE.InstancedBufferAttribute(speeds, 1))
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPlayerPos: { value: new THREE.Vector3() },
      uWind: { value: 0.6 },
      uOpacity: { value: 0 },
      uFogColor: { value: new THREE.Color('#8fa5a8') },
      uFogDensity: { value: 0.02 },
    },
    vertexShader: `
      attribute vec3 aOffset;
      attribute float aSpeed;
      uniform float uTime;
      uniform vec3 uPlayerPos;
      uniform float uWind;
      varying float vFogDepth;
      void main() {
        vec3 p = aOffset;
        p.x = mod(p.x + uTime * uWind * 1.3 + uPlayerPos.x + 15.0, 30.0) - 15.0 + uPlayerPos.x;
        p.z = mod(p.z + uTime * uWind * 0.4 + uPlayerPos.z + 15.0, 30.0) - 15.0 + uPlayerPos.z;
        p.y = mod(p.y - uTime * aSpeed + uPlayerPos.y + 11.0, 22.0) - 11.0 + uPlayerPos.y + 8.0;
        vec3 local = vec3(position.x * 0.018, position.y * 0.72, 0.0);
        local.x += local.y * uWind * 0.08;
        vec3 world = p + local;
        vec4 mv = modelViewMatrix * vec4(world, 1.0);
        vFogDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      varying float vFogDepth;
      void main() {
        float fog = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
        gl_FragColor = vec4(mix(vec3(0.72, 0.84, 0.9), uFogColor, fog), uOpacity * 0.4);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.visible = false
  mesh.renderOrder = 6
  return mesh
}

const PRESETS = {
  'Sunny Morning': {
    sunElevation: 34,
    sunAzimuth: 40,
    sunColor: '#fff1cf',
    sunIntensity: 3.1,
    hemiIntensity: 0.75,
    fogColor: '#b8c9c1',
    fogDensity: 0.0058,
    exposure: 1.05,
    wind: 0.6,
    wetness: 0,
    rain: 0,
    leaves: 1,
    skyMix: 0,
  },
  'Golden Hour': {
    sunElevation: 9,
    sunAzimuth: 104,
    sunColor: '#ffb15c',
    sunIntensity: 2.9,
    hemiIntensity: 0.58,
    fogColor: '#d69a66',
    fogDensity: 0.0085,
    exposure: 1.12,
    wind: 0.95,
    wetness: 0.12,
    rain: 0,
    leaves: 1,
    skyMix: 0.18,
  },
  'Misty Rain': {
    sunElevation: 46,
    sunAzimuth: 212,
    sunColor: '#b8c8d8',
    sunIntensity: 1.05,
    hemiIntensity: 0.52,
    fogColor: '#8fa5a8',
    fogDensity: 0.023,
    exposure: 0.95,
    wind: 1.65,
    wetness: 1,
    rain: 1,
    leaves: 0.35,
    skyMix: 1,
  },
}

function clonePreset(preset) {
  return { ...preset, sunColor: new THREE.Color(preset.sunColor), fogColor: new THREE.Color(preset.fogColor) }
}

export default class WeatherLeafSystem {
  constructor({ scene, camera, terrain, renderer, sun, hemi, fog, skyUniforms }) {
    this.scene = scene
    this.camera = camera
    this.terrain = terrain
    this.renderer = renderer
    this.sun = sun
    this.hemi = hemi
    this.fog = fog
    this.skyUniforms = skyUniforms
    this.presetName = 'Sunny Morning'
    this.current = clonePreset(PRESETS[this.presetName])
    this.target = clonePreset(PRESETS[this.presetName])
    this.sunDirection = new THREE.Vector3()
    this.leaves = buildLeaves()
    this.rain = buildRain()
    scene.add(this.leaves, this.rain)
    this.apply()
  }

  setPreset(name) {
    if (!PRESETS[name]) return
    this.presetName = name
    this.target = clonePreset(PRESETS[name])
  }

  update(dt, time, playerPos) {
    const blend = Math.min(1, dt / 1.5)
    for (const key of ['sunElevation', 'sunAzimuth', 'sunIntensity', 'hemiIntensity', 'fogDensity', 'exposure', 'wind', 'wetness', 'rain', 'leaves', 'skyMix']) {
      this.current[key] = THREE.MathUtils.lerp(this.current[key], this.target[key], blend)
    }
    this.current.sunColor.lerp(this.target.sunColor, blend)
    this.current.fogColor.lerp(this.target.fogColor, blend)
    this.apply()

    const elevation = THREE.MathUtils.degToRad(this.current.sunElevation)
    const azimuth = THREE.MathUtils.degToRad(this.current.sunAzimuth)
    this.sunDirection.set(
      Math.cos(elevation) * Math.sin(azimuth),
      Math.sin(elevation),
      Math.cos(elevation) * Math.cos(azimuth),
    ).normalize()

    this.leaves.material.uniforms.uTime.value = time
    this.leaves.material.uniforms.uPlayerPos.value.copy(playerPos)
    this.leaves.material.uniforms.uWind.value = this.current.wind
    this.leaves.material.uniforms.uFogColor.value.copy(this.current.fogColor)
    this.leaves.material.uniforms.uFogDensity.value = this.current.fogDensity
    this.leaves.material.uniforms.uOpacity.value = 0.8
    this.leaves.geometry.instanceCount = Math.floor(LEAF_COUNT * this.current.leaves)
    this.leaves.visible = this.current.leaves > 0.02

    this.rain.material.uniforms.uTime.value = time
    this.rain.material.uniforms.uPlayerPos.value.copy(playerPos)
    this.rain.material.uniforms.uWind.value = this.current.wind
    this.rain.material.uniforms.uFogColor.value.copy(this.current.fogColor)
    this.rain.material.uniforms.uFogDensity.value = this.current.fogDensity
    this.rain.material.uniforms.uOpacity.value = this.current.rain
    this.rain.visible = this.current.rain > 0.01
  }

  apply() {
    this.sun.color.copy(this.current.sunColor)
    this.sun.intensity = this.current.sunIntensity
    this.hemi.intensity = this.current.hemiIntensity
    this.fog.color.copy(this.current.fogColor)
    this.fog.density = this.current.fogDensity
    this.renderer.toneMappingExposure = this.current.exposure
    this.terrain.setWetness(this.current.wetness)
    if (this.skyUniforms?.uSkyMix) this.skyUniforms.uSkyMix.value = this.current.skyMix
  }
}
