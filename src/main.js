import * as THREE from 'three'
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import GUI from 'lil-gui'
import './styles.css'
import TerrainSystem from './systems/TerrainSystem'
import GrassSystem from './systems/GrassSystem'
import TreeSystem from './systems/TreeSystem'
import PlayerPhysicsSystem from './systems/PlayerPhysicsSystem'
import WeatherLeafSystem from './systems/WeatherLeafSystem'

const loadingScreen = document.querySelector('#loading')
const loadingBar = document.querySelector('#loading-progress')
const loadingText = document.querySelector('#loading-text')
const hudFps = document.querySelector('#hud-fps')
const hudCalls = document.querySelector('#hud-calls')
const hudTris = document.querySelector('#hud-tris')

const manager = new THREE.LoadingManager()
manager.onProgress = (_url, loaded, total) => {
  if (loadingBar) loadingBar.style.width = `${Math.min(92, (loaded / Math.max(1, total)) * 92)}%`
  if (loadingText) loadingText.textContent = `Loading world assets · ${loaded}/${total}`
}

const textureLoader = new THREE.TextureLoader(manager)
const hdrLoader = new RGBELoader(manager)
const gltfLoader = new GLTFLoader(manager)

function loadTexture(url, color = false) {
  return new Promise((resolve, reject) => {
    textureLoader.load(
      url,
      (texture) => {
        texture.wrapS = THREE.RepeatWrapping
        texture.wrapT = THREE.RepeatWrapping
        texture.anisotropy = 8
        if (color) texture.colorSpace = THREE.SRGBColorSpace
        texture.needsUpdate = true
        resolve(texture)
      },
      undefined,
      reject,
    )
  })
}

function loadHdr(url) {
  return new Promise((resolve, reject) => {
    hdrLoader.load(
      url,
      (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping
        resolve(texture)
      },
      undefined,
      reject,
    )
  })
}

function loadGltf(url) {
  return new Promise((resolve, reject) => gltfLoader.load(url, resolve, undefined, reject))
}

async function boot() {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    alpha: false,
    stencil: false,
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  document.body.appendChild(renderer.domElement)
  renderer.domElement.id = 'world-canvas'

  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0xb8c9c1, 0.006)

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 500)
  camera.position.set(0, 4, -8)

  const sun = new THREE.DirectionalLight(0xfff1cf, 3.1)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -55
  sun.shadow.camera.right = 55
  sun.shadow.camera.top = 55
  sun.shadow.camera.bottom = -55
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 160
  sun.shadow.bias = -0.00018
  sun.shadow.normalBias = 0.025
  scene.add(sun)
  scene.add(sun.target)

  const hemi = new THREE.HemisphereLight(0xc8dcff, 0x2b2418, 0.75)
  scene.add(hemi)
  const ambient = new THREE.AmbientLight(0x94a7b8, 0.22)
  scene.add(ambient)

  const [skySunny, skyOvercast, grassColor, grassNormal, grassRough, dirtColor, dirtNormal, dirtRough, barkColor, barkNormal, barkRough, rockGltf] =
    await Promise.all([
      loadHdr('/assets/sky_sunny.hdr'),
      loadHdr('/assets/sky_overcast.hdr'),
      loadTexture('/assets/grass_color.jpg', true),
      loadTexture('/assets/grass_normal.jpg'),
      loadTexture('/assets/grass_rough.jpg'),
      loadTexture('/assets/dirt_color.jpg', true),
      loadTexture('/assets/dirt_normal.jpg'),
      loadTexture('/assets/dirt_rough.jpg'),
      loadTexture('/assets/bark_color.jpg', true),
      loadTexture('/assets/bark_normal.jpg'),
      loadTexture('/assets/bark_rough.jpg'),
      loadGltf('/assets/rocks/rock_moss_set_01_1k.gltf'),
    ])

  const pmrem = new THREE.PMREMGenerator(renderer)
  pmrem.compileEquirectangularShader()
  const envSunny = pmrem.fromEquirectangular(skySunny).texture
  const envOvercast = pmrem.fromEquirectangular(skyOvercast).texture
  pmrem.dispose()
  scene.environment = envSunny

  const skyMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uSkyA: { value: skySunny },
      uSkyB: { value: skyOvercast },
      uSkyMix: { value: 0 },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D uSkyA;
      uniform sampler2D uSkyB;
      uniform float uSkyMix;
      varying vec3 vWorldPosition;
      #include <common>
      #include <tonemapping_pars_fragment>
      #include <colorspace_pars_fragment>
      void main() {
        vec3 dir = normalize(vWorldPosition - cameraPosition);
        vec2 uv = vec2(atan(dir.z, dir.x) / 6.28318530718 + 0.5, asin(clamp(dir.y, -1.0, 1.0)) / 3.14159265359 + 0.5);
        vec3 a = texture2D(uSkyA, uv).rgb;
        vec3 b = texture2D(uSkyB, uv).rgb;
        vec3 color = mix(a, b, uSkyMix);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  })
  const sky = new THREE.Mesh(new THREE.SphereGeometry(240, 32, 16), skyMaterial)
  sky.name = 'HDRISkyDome'
  sky.frustumCulled = false
  sky.renderOrder = -1000
  scene.add(sky)

  const terrain = new TerrainSystem({
    scene,
    renderer,
    textures: {
      grassColor,
      grassNormal,
      grassRough,
      dirtColor,
      dirtNormal,
      dirtRough,
      barkColor,
      barkNormal,
      barkRough,
    },
  })
  const grass = new GrassSystem({ scene, terrain, renderer })
  const trees = new TreeSystem({
    scene,
    renderer,
    terrain,
    textures: { barkColor, barkNormal, barkRough },
    rockGltf,
  })
  const player = new PlayerPhysicsSystem({
    scene,
    camera,
    terrain,
    renderer,
    collisionCircles: trees.collisionCircles,
    loadingManager: manager,
  })
  await player.load()

  const weather = new WeatherLeafSystem({
    scene,
    camera,
    terrain,
    renderer,
    sun,
    hemi,
    fog: scene.fog,
    skyUniforms: skyMaterial.uniforms,
  })

  const gui = new GUI({ title: 'WORLD / WEATHER' })
  gui.add(weather, 'presetName', ['Sunny Morning', 'Golden Hour', 'Misty Rain'])
    .name('Weather Preset')
    .onChange((name) => weather.setPreset(name))
  const grassFolder = gui.addFolder('Grass')
  const grassState = { density: 1, bladeHeight: 1, windStrength: 0.6, lodDistance: 85 }
  grassFolder.add(grassState, 'density', 0.35, 1.35, 0.05).name('Density').onChange(() => grass.setSettings(grassState))
  grassFolder.add(grassState, 'bladeHeight', 0.55, 1.55, 0.05).name('Blade Height').onChange(() => grass.setSettings(grassState))
  grassFolder.add(grassState, 'windStrength', 0, 2, 0.05).name('Wind Strength').onChange(() => grass.setSettings(grassState))
  grassFolder.add(grassState, 'lodDistance', 55, 120, 1).name('LOD Distance').onChange(() => grass.setSettings(grassState))
  const treeFolder = gui.addFolder('Trees')
  const treeState = { billboardDistance: 65, leafSway: 0.65 }
  treeFolder.add(treeState, 'billboardDistance', 45, 140, 1).name('Billboard Switch').onChange(() => trees.setSettings(treeState))
  treeFolder.add(treeState, 'leafSway', 0, 1.5, 0.05).name('Leaf Sway').onChange(() => trees.setSettings(treeState))
  const weatherFolder = gui.addFolder('Weather')
  const weatherState = { leafCount: 450, rainIntensity: 0, fogDensity: 0.006 }
  weatherFolder.add(weatherState, 'leafCount', 0, 450, 1).name('Leaf Count').onChange((value) => {
    weather.current.leaves = value / 450
    weather.target.leaves = value / 450
  })
  weatherFolder.add(weatherState, 'rainIntensity', 0, 1, 0.01).name('Rain Intensity').onChange((value) => {
    weather.current.rain = value
    weather.target.rain = value
  })
  weatherFolder.add(weatherState, 'fogDensity', 0.002, 0.04, 0.001).name('Fog Density').onChange((value) => {
    weather.current.fogDensity = value
    weather.target.fogDensity = value
  })
  if (window.innerWidth < 1024) gui.close()

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(window.innerWidth, window.innerHeight)
  })

  const clock = new THREE.Clock()
  let elapsed = 0
  let fpsSmoothed = 60
  let hudTimer = 0
  let currentEnv = 'sunny'
  const shadowTexel = (55 * 2) / 2048
  const shadowCenter = new THREE.Vector3()

  function animate() {
    const dt = Math.min(clock.getDelta(), 0.05)
    elapsed += dt
    player.update(dt, elapsed)
    weather.update(dt, elapsed, player.position)
    grass.update(elapsed, player.position, camera, weather.sunDirection, dt)
    trees.update(elapsed, player.position)

    if (weather.current.skyMix > 0.5 && currentEnv !== 'overcast') {
      scene.environment = envOvercast
      currentEnv = 'overcast'
    } else if (weather.current.skyMix <= 0.5 && currentEnv !== 'sunny') {
      scene.environment = envSunny
      currentEnv = 'sunny'
    }

    shadowCenter.copy(player.position)
    shadowCenter.x = Math.round(shadowCenter.x / shadowTexel) * shadowTexel
    shadowCenter.z = Math.round(shadowCenter.z / shadowTexel) * shadowTexel
    sun.target.position.copy(shadowCenter)
    sun.position.copy(shadowCenter).addScaledVector(weather.sunDirection, 80)
    sun.target.updateMatrixWorld()
    sky.position.copy(camera.position)

    renderer.render(scene, camera)

    fpsSmoothed += (1 / Math.max(dt, 0.0001) - fpsSmoothed) * 0.08
    hudTimer += dt
    if (hudTimer > 0.35) {
      hudTimer = 0
      if (hudFps) hudFps.textContent = Math.round(fpsSmoothed)
      if (hudCalls) hudCalls.textContent = renderer.info.render.calls
      if (hudTris) hudTris.textContent = (renderer.info.render.triangles / 1000).toFixed(0) + 'k'
    }
  }

  renderer.setAnimationLoop(animate)
  if (loadingBar) loadingBar.style.width = '100%'
  if (loadingText) loadingText.textContent = 'Entering the valley…'
  window.setTimeout(() => {
    loadingScreen?.classList.add('loaded')
    window.setTimeout(() => loadingScreen?.remove(), 900)
  }, 450)
}

boot().catch((error) => {
  console.error(error)
  if (loadingText) loadingText.textContent = 'Failed to load the world. Check the console.'
  if (loadingScreen) loadingScreen.classList.add('error')
})
