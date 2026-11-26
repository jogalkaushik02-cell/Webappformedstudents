import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js'
import { PMREMGenerator } from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import './styles.css'

const TRAILER_SECONDS = 60
const canvas = document.querySelector('#world')
const captionEl = document.querySelector('#caption')
const progressEl = document.querySelector('#progress span')
const titleCard = document.querySelector('#title-card')

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.15
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x08101e)
scene.fog = new THREE.FogExp2(0x111827, 0.0038)
const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 500)
camera.position.set(0, 8, 30)

const pmrem = new PMREMGenerator(renderer)
const room = new RoomEnvironment()
scene.environment = pmrem.fromScene(room, 0.04).texture
room.dispose()
pmrem.dispose()

const hemi = new THREE.HemisphereLight(0x9fc7ff, 0x28221a, 1.2)
scene.add(hemi)
const sun = new THREE.DirectionalLight(0xffe1b5, 3.4)
sun.position.set(25, 42, 20)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.left = -45
sun.shadow.camera.right = 45
sun.shadow.camera.top = 45
sun.shadow.camera.bottom = -45
sun.shadow.camera.near = 1
sun.shadow.camera.far = 160
sun.shadow.bias = -0.00015
sun.shadow.normalBias = 0.02
scene.add(sun, sun.target)
const rim = new THREE.DirectionalLight(0x6f9cff, 1.5)
rim.position.set(-25, 22, -30)
scene.add(rim)

const mountain = createMountain()
scene.add(mountain)

function getMountainHeight(x, z) {
  const r = Math.hypot(x, z)
  const ridge = 24 * Math.exp(-(r * r) / 1400) + 9 * Math.exp(-((x - 12) ** 2 + (z + 8) ** 2) / 520)
  const noise = Math.sin(x * 0.18) * 0.9 + Math.cos(z * 0.16) * 0.8 + Math.sin((x + z) * 0.42) * 0.35
  return ridge + noise - 4
}

function createMountain() {
  const geometry = new THREE.PlaneGeometry(260, 260, 256, 256)
  geometry.rotateX(-Math.PI / 2)
  const p = geometry.attributes.position
  for (let i = 0; i < p.count; i += 1) {
    const x = p.getX(i)
    const z = p.getZ(i)
    p.setY(i, getMountainHeight(x, z))
  }
  geometry.computeVertexNormals()
  const material = new THREE.MeshStandardMaterial({
    color: 0x3b4238,
    roughness: 0.94,
    metalness: 0,
    flatShading: true,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.receiveShadow = true
  mesh.castShadow = true
  return mesh
}

const samuraiSlots = [
  { x: -5.8, z: 4.5, rotation: 0.18, armor: 0x9d1f2b, accent: 0xd8b45c },
  { x: -2.1, z: 5.8, rotation: 0.05, armor: 0x1f3f68, accent: 0xd8b45c },
  { x: 2.1, z: 5.8, rotation: -0.05, armor: 0x2f5a3a, accent: 0xd8b45c },
  { x: 5.8, z: 4.5, rotation: -0.18, armor: 0x171a22, accent: 0xd8b45c },
]
const samuraiRoots = []
const mixers = []
let samuraiLoaded = false

async function loadGltf(url) {
  const loader = new GLTFLoader()
  return loader.loadAsync(url)
}

function cloneMaterial(material, color) {
  const clones = (Array.isArray(material) ? material : [material]).map((m) => {
    const c = m.clone()
    if (c.color && color !== undefined) c.color.set(color)
    if ('roughness' in c) c.roughness = Math.max(0.35, Math.min(0.9, c.roughness ?? 0.7))
    if ('metalness' in c) c.metalness = Math.min(c.metalness ?? 0, 0.35)
    return c
  })
  return Array.isArray(material) ? clones : clones[0]
}

function fitModel(model, targetHeight) {
  model.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(model)
  const size = bounds.getSize(new THREE.Vector3())
  if (size.y > 0.001) model.scale.multiplyScalar(targetHeight / size.y)
  model.updateMatrixWorld(true)
  bounds.setFromObject(model)
  model.position.x -= (bounds.min.x + bounds.max.x) / 2
  model.position.z -= (bounds.min.z + bounds.max.z) / 2
  model.position.y -= bounds.min.y
  model.updateMatrixWorld(true)
}

async function setupSamurai() {
  try {
    const gltf = await loadGltf('/assets/samurai-rigged.glb')
    const source = gltf.scene
    for (let i = 0; i < 4; i += 1) {
      const model = SkeletonUtils.clone(source)
      const slot = samuraiSlots[i]
      model.traverse((object) => {
        if (!object.isMesh) return
        object.castShadow = true
        object.receiveShadow = true
        object.material = cloneMaterial(object.material)
      })
      fitModel(model, 1.85)
      const root = new THREE.Group()
      root.add(model)
      root.position.set(slot.x, getMountainHeight(slot.x, slot.z + 4.5) + 10.2, slot.z + 4.5)
      root.rotation.y = slot.rotation
      scene.add(root)
      samuraiRoots.push(root)
      if (gltf.animations?.length) {
        const mixer = new THREE.AnimationMixer(model)
        const idle = gltf.animations.find((a) => a.name.toLowerCase().includes('idle')) ?? gltf.animations[0]
        const action = mixer.clipAction(idle)
        action.play()
        mixers.push(mixer)
      }
    }
    samuraiLoaded = true
  } catch (error) {
    console.warn('Samurai model failed to load', error)
  }
}

function createKrishna() {
  const root = new THREE.Group()
  root.name = 'OriginalKrishnaInspiredMan'
  const blue = new THREE.MeshStandardMaterial({ color: 0x1d4f8f, roughness: 0.52, metalness: 0.12 })
  const skin = new THREE.MeshStandardMaterial({ color: 0x6a3c24, roughness: 0.58 })
  const gold = new THREE.MeshStandardMaterial({ color: 0xe1b34a, roughness: 0.36, metalness: 0.45 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x101827, roughness: 0.68 })
  const yellow = new THREE.MeshStandardMaterial({ color: 0xffd46a, roughness: 0.5 })

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.95, 8, 16), blue)
  body.position.y = 1.15
  body.castShadow = true
  root.add(body)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.29, 24, 16), skin)
  head.position.y = 1.95
  head.castShadow = true
  root.add(head)
  const hair = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.055, 8, 24), dark)
  hair.position.y = 2.15
  hair.rotation.x = Math.PI / 2
  root.add(hair)
  const crown = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.025, 8, 24), gold)
  crown.position.y = 2.23
  crown.rotation.x = Math.PI / 2
  root.add(crown)
  const sash = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.045, 8, 28), yellow)
  sash.position.y = 1.28
  sash.rotation.x = Math.PI / 2
  root.add(sash)
  const feather = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.72, 8), gold)
  feather.position.set(0.2, 2.38, 0)
  feather.rotation.z = -0.45
  root.add(feather)
  root.position.set(0, getMountainHeight(0, 0) + 10.2, 0)
  return root
}

const krishna = createKrishna()
krishna.visible = false
scene.add(krishna)

const spell = new THREE.Group()
spell.visible = false
const spellLight = new THREE.PointLight(0xffd16a, 0, 45, 2)
const ring = new THREE.Mesh(
  new THREE.TorusGeometry(0.8, 0.045, 12, 64),
  new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.9 }),
)
ring.rotation.x = Math.PI / 2
spell.add(ring, spellLight)
scene.add(spell)
const particleTexture = makeRadialTexture('#fff4cf')
const spellParticles = createParticleCloud(180, 0xffd16a, particleTexture, 8)
spell.add(spellParticles)

function makeRadialTexture(color) {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, color)
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  const texture = new THREE.CanvasTexture(c)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function createParticleCloud(count, color, texture, size) {
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array(count * 3)
  const velocities = []
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2
    const radius = Math.random() * 1.4
    positions[i * 3] = Math.cos(angle) * radius
    positions[i * 3 + 1] = Math.random() * 1.4
    positions[i * 3 + 2] = Math.sin(angle) * radius
    velocities.push(new THREE.Vector3(Math.cos(angle) * 1.2, 0.8 + Math.random() * 1.6, Math.sin(angle) * 1.2))
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.PointsMaterial({
    color,
    map: texture,
    size,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  })
  const points = new THREE.Points(geometry, material)
  points.userData.velocities = velocities
  return points
}

const dragonColors = [0xc62b3a, 0x3d9dff, 0x36d39a, 0xffcf5c]
const dragonLabels = [
  'JAMNAGAR · DWARKA · KUTCH',
  'JUNAGADH · PORBANDAR · GIR · SOMNATH',
  'WHOLE SAURASHTRA TOGETHER',
  'WELCOME TO ELIT',
]
const blastTimes = [25, 33, 41, 49]
const dragonRoots = []
let dragonSource = null

async function setupDragons() {
  try {
    const gltf = await loadGltf('/assets/dragon.glb')
    dragonSource = gltf.scene
    for (let i = 0; i < 4; i += 1) {
      const model = SkeletonUtils.clone(dragonSource)
      model.traverse((object) => {
        if (!object.isMesh) return
        object.castShadow = true
        object.receiveShadow = false
        object.material = cloneMaterial(object.material, dragonColors[i])
      })
      fitModel(model, 5.2)
      const root = new THREE.Group()
      root.add(model)
      root.userData.baseColor = dragonColors[i]
      root.visible = false
      scene.add(root)
      dragonRoots.push(root)
    }
  } catch (error) {
    console.warn('Dragon model failed to load', error)
  }
}

const blasts = []

function makeSkyText(text, color) {
  const canvasText = document.createElement('canvas')
  canvasText.width = 2048
  canvasText.height = 512
  const ctx = canvasText.getContext('2d')
  ctx.clearRect(0, 0, canvasText.width, canvasText.height)
  ctx.font = 'bold 92px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 10
  ctx.strokeStyle = 'rgba(0,0,0,.55)'
  ctx.strokeText(text, canvasText.width / 2, canvasText.height / 2)
  ctx.fillStyle = color
  ctx.fillText(text, canvasText.width / 2, canvasText.height / 2)
  const texture = new THREE.CanvasTexture(canvasText)
  texture.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false, fog: false })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(46, 11.5, 1)
  sprite.renderOrder = 100
  return sprite
}

function spawnBlast(index, time) {
  const root = dragonRoots[index]
  const group = new THREE.Group()
  const color = dragonColors[index]
  const light = new THREE.PointLight(color, 0, 70, 2)
  group.add(light)
  const fire = createParticleCloud(140, color, particleTexture, 1.2)
  group.add(fire)
  const text = makeSkyText(dragonLabels[index], '#ffffff')
  text.position.set(0, 18 + index * 2.5, -30 - index * 4)
  text.visible = false
  scene.add(text)
  const origin = root ? root.position.clone().add(new THREE.Vector3(0, 2, 0)) : new THREE.Vector3(0, 35, -25)
  group.position.copy(origin)
  scene.add(group)
  blasts.push({ group, text, light, fire, time, index, duration: 3.2 })
}

let lastCaption = ''
function setCaption(text) {
  if (lastCaption !== text) {
    captionEl.textContent = text
    lastCaption = text
  }
}

function sampleCamera(t, outPos, outTarget) {
  const peakY = getMountainHeight(0, 0) + 10.2
  if (t < 5) {
    outPos.set(0, peakY + 12, 32)
    outTarget.set(0, peakY, 4)
  } else if (t < 8) {
    outPos.set(-7, peakY + 3.2, 13)
    outTarget.set(samuraiSlots[0].x, peakY + 1.2, samuraiSlots[0].z + 4.5)
  } else if (t < 15) {
    outPos.set(12, peakY + 5, 18)
    outTarget.set(0, peakY + 1.4, 0)
  } else if (t < 18) {
    outPos.set(7, peakY + 3.4, 10)
    outTarget.set(0, peakY + 1.8, 0)
  } else if (t < 22) {
    outPos.set(5, peakY + 3, 8)
    outTarget.set(0, peakY + 2.1, 0)
  } else if (t < 25) {
    outPos.set(0, peakY + 5, 15)
    outTarget.set(0, peakY + 14, 0)
  } else if (t < 54) {
    const p = (t - 25) / 29
    const angle = p * Math.PI * 1.5
    outPos.set(Math.cos(angle) * 34, peakY + 25 + Math.sin(p * Math.PI) * 8, Math.sin(angle) * 34 + 8)
    outTarget.set(0, peakY + 15, 0)
  } else {
    const p = Math.min(1, (t - 54) / 6)
    outPos.set(24 - p * 8, peakY + 30 - p * 7, 30 - p * 12)
    outTarget.set(0, peakY + 10, 0)
  }
}

function updateSamurai(t, dt) {
  const speaking = t >= 8 && t < 11
  const chorus = t >= 15 && t < 18
  const casting = t >= 18 && t < 25
  for (let i = 0; i < samuraiRoots.length; i += 1) {
    const root = samuraiRoots[i]
    const slot = samuraiSlots[i]
    const baseY = getMountainHeight(slot.x, slot.z + 4.5) + 10.2
    root.position.y = baseY + Math.sin(t * 1.4 + i) * 0.02
    if (speaking && i === 0) root.rotation.y = -0.25
    else if (chorus || casting) root.rotation.y = Math.PI + slot.rotation
    else root.rotation.y = Math.PI + slot.rotation
    root.rotation.z = chorus ? Math.sin(t * 6 + i) * 0.015 : 0
  }
  for (const mixer of mixers) mixer.update(dt)
}

function updateKrishna(t, dt) {
  krishna.visible = t >= 11
  if (!krishna.visible) return
  const baseY = getMountainHeight(0, 0) + 10.2
  const p = Math.min(1, (t - 11) / 4)
  krishna.position.y = baseY + (1 - p) * -2.5
  krishna.position.z = 0
  krishna.rotation.y = Math.sin(t * 0.4) * 0.05
  const hand = t >= 18 && t < 25 ? 1 : 0
  krishna.rotation.x = hand * -0.05
}

function updateSpell(t, dt) {
  spell.visible = t >= 18 && t < 25
  if (!spell.visible) return
  const p = (t - 18) / 7
  spell.position.set(0, krishna.position.y + 2.2 + p * 14, 0)
  spellLight.intensity = 12 + Math.sin(t * 18) * 4
  ring.rotation.z += dt * 2.2
  ring.scale.setScalar(1 + p * 4)
  spellParticles.rotation.y += dt * 1.6
}

function updateDragons(t) {
  for (let i = 0; i < dragonRoots.length; i += 1) {
    const root = dragonRoots[i]
    root.visible = t >= blastTimes[i] - 1.4
    if (!root.visible) continue
    const p = Math.min(1, (t - (blastTimes[i] - 1.4)) / 4)
    const angle = (i / 4) * Math.PI * 2 + t * 0.12
    const radius = 32 - p * 8
    root.position.set(Math.cos(angle) * radius, 26 + i * 3 + Math.sin(t + i) * 1.2, Math.sin(angle) * radius - 8)
    root.rotation.y = angle + Math.PI / 2
    root.rotation.z = Math.sin(t * 1.1 + i) * 0.08
    root.rotation.x = -0.08
  }
}

let lastBlast = -1
function updateBlasts(t, dt) {
  for (let i = 0; i < blastTimes.length; i += 1) {
    if (t >= blastTimes[i] && lastBlast < blastTimes[i] && dragonRoots.length) {
      spawnBlast(i, blastTimes[i])
      lastBlast = blastTimes[i]
    }
  }
  for (let i = blasts.length - 1; i >= 0; i -= 1) {
    const b = blasts[i]
    const age = t - b.time
    b.light.intensity = Math.max(0, 30 * (1 - age / b.duration))
    b.text.visible = age >= 0.35 && age < b.duration
    b.text.material.opacity = Math.max(0, Math.min(1, (age - 0.35) / 0.4, (b.duration - age) / 0.8))
    b.fire.visible = age < b.duration
    b.group.position.y += dt * 1.2
    const positions = b.fire.geometry.attributes.position
    const velocities = b.fire.userData.velocities
    for (let j = 0; j < velocities.length; j += 1) {
      positions.setXYZ(
        j,
        positions.getX(j) + velocities[j].x * dt,
        positions.getY(j) + velocities[j].y * dt,
        positions.getZ(j) + velocities[j].z * dt,
      )
    }
    positions.needsUpdate = true
    if (age > b.duration + 1.5) {
      scene.remove(b.group, b.text)
      b.group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.() })
      b.text.material.map?.dispose?.()
      b.text.material.dispose()
      blasts.splice(i, 1)
    }
  }
}

function updateCaption(t) {
  if (t < 5) setCaption('FOUR SAMURAI · HIGHEST PEAK · SAURASHTRA')
  else if (t < 8) setCaption('WHAT COMES NEXT…?')
  else if (t < 11) setCaption('[BHARI AAWAZ · BOOMING VOICE]')
  else if (t < 15) setCaption('HERE IS THE MAN.')
  else if (t < 18) setCaption('HERE IS THE MAN. · HERE IS THE MAN. · HERE IS THE MAN. · HERE IS THE MAN.')
  else if (t < 22) setCaption('A DIVINE SPELL · FOUR LIGHTS RISE')
  else if (t < 25) setCaption('SAMURAI, WITNESS…')
  else if (t < 33) setCaption('CRIMSON DRAGON · JAMNAGAR · DWARKA · KUTCH')
  else if (t < 41) setCaption('AZURE DRAGON · JUNAGADH · PORBANDAR · GIR · SOMNATH')
  else if (t < 49) setCaption('EMERALD DRAGON · WHOLE SAURASHTRA TOGETHER')
  else if (t < 54) setCaption('GOLDEN DRAGON · WELCOME TO ELIT')
  else setCaption('FOUR SAMURAI · ONE MAN · FOUR DRAGONS')
}

function restart() {
  for (const b of blasts.splice(0)) {
    scene.remove(b.group, b.text)
    b.group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.() })
    b.text.material.map?.dispose?.()
    b.text.material.dispose()
  }
  lastBlast = -1
  elapsed = 0
  titleCard.hidden = true
  setCaption('')
}

let elapsed = 0
let previous = performance.now()
const desiredPos = new THREE.Vector3()
const desiredTarget = new THREE.Vector3()
const currentTarget = new THREE.Vector3(0, 14, 0)

function animate(now) {
  const dt = Math.min(0.05, (now - previous) / 1000)
  previous = now
  elapsed = Math.min(TRAILER_SECONDS, elapsed + dt)
  const t = elapsed
  updateSamurai(t, dt)
  updateKrishna(t, dt)
  updateSpell(t, dt)
  updateDragons(t)
  updateBlasts(t, dt)
  updateCaption(t)
  sampleCamera(t, desiredPos, desiredTarget)
  camera.position.lerp(desiredPos, 1 - Math.exp(-dt * 4.5))
  currentTarget.lerp(desiredTarget, 1 - Math.exp(-dt * 5))
  camera.lookAt(currentTarget)
  progressEl.style.width = `${(t / TRAILER_SECONDS) * 100}%`
  titleCard.hidden = t < TRAILER_SECONDS
  if (t >= TRAILER_SECONDS) titleCard.hidden = false
  renderer.render(scene, camera)
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
})
window.addEventListener('keydown', (event) => {
  if (event.code === 'Space') { event.preventDefault(); restart() }
})
canvas.addEventListener('pointerdown', restart)

async function start() {
  await setupSamurai()
  await setupDragons()
  renderer.setAnimationLoop(animate)
}

start().catch((error) => console.error('Trailer boot failed', error))
