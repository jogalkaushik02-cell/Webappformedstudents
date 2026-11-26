import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { mulberry } from '../utils/noise'

const TREE_COUNT = 320
const ROCK_COUNT = 55
const MAX_NEAR_PER_VARIANT = 70
const CARD_CAPACITY = MAX_NEAR_PER_VARIANT * 128

function makeLeafCardGeometry(capacity = CARD_CAPACITY) {
  const geometry = new THREE.PlaneGeometry(1, 1)
  geometry.setAttribute(
    'aCanopyNormal',
    new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(
      THREE.DynamicDrawUsage,
    ),
  )
  return geometry
}

function makeTaperedTube(curve, radiusStart, radiusEnd, tubularSegments = 18, radialSegments = 7) {
  const positions = []
  const normals = []
  const uvs = []
  const indices = []
  const tangent = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)
  const side = new THREE.Vector3()
  const localUp = new THREE.Vector3()
  const point = new THREE.Vector3()
  for (let i = 0; i <= tubularSegments; i += 1) {
    const t = i / tubularSegments
    curve.getPointAt(t, point)
    curve.getTangentAt(t, tangent).normalize()
    const reference = Math.abs(tangent.y) > 0.92 ? new THREE.Vector3(1, 0, 0) : up
    side.crossVectors(tangent, reference).normalize()
    localUp.crossVectors(side, tangent).normalize()
    const radius = THREE.MathUtils.lerp(radiusStart, radiusEnd, t)
    for (let j = 0; j <= radialSegments; j += 1) {
      const angle = (j / radialSegments) * Math.PI * 2
      const nx = Math.cos(angle) * side.x + Math.sin(angle) * localUp.x
      const ny = Math.cos(angle) * side.y + Math.sin(angle) * localUp.y
      const nz = Math.cos(angle) * side.z + Math.sin(angle) * localUp.z
      positions.push(point.x + nx * radius, point.y + ny * radius, point.z + nz * radius)
      normals.push(nx, ny, nz)
      uvs.push(j / radialSegments, t * 4.5)
      if (i < tubularSegments && j < radialSegments) {
        const a = i * (radialSegments + 1) + j
        const b = a + 1
        const c = a + radialSegments + 1
        const d = c + 1
        indices.push(a, c, b, b, c, d)
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  return geometry
}

function makeBranch(start, end, bend, radiusStart, radiusEnd, seed) {
  const random = mulberry(seed)
  const mid = new THREE.Vector3().lerpVectors(start, end, 0.5)
  mid.x += (random() - 0.5) * bend
  mid.z += (random() - 0.5) * bend
  mid.y += random() * 0.5
  const upper = new THREE.Vector3().lerpVectors(mid, end, 0.55)
  upper.x += (random() - 0.5) * bend * 0.5
  upper.z += (random() - 0.5) * bend * 0.5
  const curve = new THREE.CatmullRomCurve3([start, mid, upper, end])
  return makeTaperedTube(curve, radiusStart, radiusEnd, 16, 7)
}

function buildTrunkGeometry(variant, seed) {
  const random = mulberry(seed)
  const parts = []
  const trunkCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3((random() - 0.5) * 0.7, variant.height * 0.24, (random() - 0.5) * 0.7),
    new THREE.Vector3((random() - 0.5) * 0.9, variant.height * 0.5, (random() - 0.5) * 0.9),
    new THREE.Vector3((random() - 0.5) * 0.7, variant.height * 0.76, (random() - 0.5) * 0.7),
    new THREE.Vector3((random() - 0.5) * 0.5, variant.height, (random() - 0.5) * 0.5),
  ])
  parts.push(makeTaperedTube(trunkCurve, variant.trunkRadius, variant.trunkRadius * 0.3, 22, 8))

  const branchCount = variant.id === 'green' ? 7 : 6
  for (let i = 0; i < branchCount; i += 1) {
    const t = 0.38 + (i / branchCount) * 0.46
    const start = trunkCurve.getPointAt(t)
    const angle = (i / branchCount) * Math.PI * 2 + random() * 0.8
    const reach = variant.canopyRadius * (0.62 + random() * 0.55)
    const end = new THREE.Vector3(
      start.x + Math.cos(angle) * reach,
      start.y + variant.height * (0.12 + random() * 0.2),
      start.z + Math.sin(angle) * reach,
    )
    parts.push(makeBranch(start, end, reach * 0.55, variant.trunkRadius * 0.42, 0.035, seed + i * 97))
  }

  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + random() * 0.5
    const start = new THREE.Vector3(0, variant.height * 0.06, 0)
    const end = new THREE.Vector3(
      Math.cos(angle) * (0.8 + random() * 1.2),
      0.05 + random() * 0.22,
      Math.sin(angle) * (0.8 + random() * 1.2),
    )
    parts.push(makeBranch(start, end, 0.7, variant.trunkRadius * 0.7, 0.06, seed + 400 + i))
  }

  const merged = mergeGeometries(parts, false)
  merged.computeVertexNormals()
  return merged
}

function makeVariantBase(id, name, palette, config) {
  const random = mulberry(config.seed)
  const variant = {
    id,
    name,
    palette,
    height: config.height,
    canopyRadius: config.canopyRadius,
    trunkRadius: config.trunkRadius,
    canopyY: config.canopyY,
    cardCount: config.cardCount,
    cardSize: config.cardSize,
    seed: config.seed,
    cards: [],
    leafTexture: null,
    trunkGeometry: null,
    leafMaterial: null,
  }
  variant.trunkGeometry = buildTrunkGeometry(variant, config.seed)

  const canopyCenter = new THREE.Vector3(0, variant.canopyY, 0)
  const forward = new THREE.Vector3(0, 0, 1)
  const q = new THREE.Quaternion()
  const tilt = new THREE.Quaternion()
  const roll = new THREE.Quaternion()
  for (let i = 0; i < variant.cardCount; i += 1) {
    const y = -0.9 + random() * 1.8
    const angle = random() * Math.PI * 2
    const horizontal = Math.sqrt(Math.max(0.001, 1 - y * y))
    const direction = new THREE.Vector3(
      Math.cos(angle) * horizontal,
      y,
      Math.sin(angle) * horizontal,
    ).normalize()
    const shell = 0.45 + random() * 0.58
    const position = canopyCenter
      .clone()
      .addScaledVector(direction, variant.canopyRadius * shell)
      .add(
        new THREE.Vector3(
          (random() - 0.5) * variant.canopyRadius * 0.24,
          (random() - 0.5) * variant.canopyRadius * 0.18,
          (random() - 0.5) * variant.canopyRadius * 0.24,
        ),
      )
    q.setFromUnitVectors(forward, direction)
    tilt.setFromAxisAngle(new THREE.Vector3(1, 0, 0), (random() - 0.5) * 0.65)
    q.multiply(tilt)
    roll.setFromAxisAngle(forward, random() * Math.PI * 2)
    q.multiply(roll)
    const scale = variant.cardSize * (0.72 + random() * 0.58)
    const localMatrix = new THREE.Matrix4().compose(
      position,
      q.clone(),
      new THREE.Vector3(scale, scale, 1),
    )
    const localNormal = direction.clone().applyQuaternion(q.clone().invert()).normalize()
    variant.cards.push({ localMatrix, localNormal, direction: direction.clone() })
  }

  variant.leafTexture = createLeafClusterTexture(variant)
  variant.leafMaterial = createLeafMaterial(variant)
  return variant
}

function createLeafMaterial(variant) {
  const material = new THREE.MeshStandardMaterial({
    map: variant.leafTexture,
    color: 0xffffff,
    roughness: 0.76,
    metalness: 0,
    alphaTest: 0.45,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
    dithering: true,
  })
  material.name = `Leaves-${variant.id}`
  material.customProgramCacheKey = () => `leaf-cards-${variant.id}-v3`
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 }
    shader.uniforms.uLeafSway = { value: 0.65 }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec3 aCanopyNormal;
uniform float uTime;
uniform float uLeafSway;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\nobjectNormal = normalize(aCanopyNormal);',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vec4 leafInstanceWorld = instanceMatrix * vec4(transformed, 1.0);
float leafPhase = dot(leafInstanceWorld.xyz, vec3(0.21, 0.37, 0.17));
float leafWave = sin(uTime * 1.35 + leafPhase) + 0.45 * sin(uTime * 2.17 + leafPhase * 1.7);
transformed.x += leafWave * 0.045 * uLeafSway * uv.y;
transformed.z += cos(uTime * 1.13 + leafPhase * 0.8) * 0.03 * uLeafSway * uv.y;`,
      )
    material.userData.shader = shader
  }
  return material
}

function drawSerratedLeaf(ctx, kind, x, y, size, rotation, fill, edge) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rotation)
  ctx.scale(size, size)
  ctx.beginPath()
  if (kind === 'maple') {
    const lobes = 7
    for (let i = 0; i <= lobes * 2; i += 1) {
      const a = (i / (lobes * 2)) * Math.PI * 2 - Math.PI / 2
      const lobe = i % 2 === 0 ? 1 : 0.54
      const r = 0.52 * lobe
      const px = Math.cos(a) * r
      const py = Math.sin(a) * r
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
  } else if (kind === 'ginkgo') {
    ctx.moveTo(0, 0.58)
    ctx.bezierCurveTo(0.72, 0.46, 0.58, -0.34, 0, -0.58)
    ctx.bezierCurveTo(-0.58, -0.34, -0.72, 0.46, 0, 0.58)
    for (let i = 0; i < 9; i += 1) {
      const a = Math.PI * (0.12 + (i / 9) * 0.76)
      const r = 0.47
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r - 0.05)
    }
  } else {
    ctx.moveTo(0, 0.58)
    ctx.bezierCurveTo(0.58, 0.45, 0.52, -0.2, 0, -0.58)
    ctx.bezierCurveTo(-0.52, -0.2, -0.58, 0.45, 0, 0.58)
    for (let i = 0; i < 8; i += 1) {
      const a = Math.PI * (0.12 + (i / 8) * 0.76)
      ctx.lineTo(Math.cos(a) * 0.46, Math.sin(a) * 0.46)
    }
  }
  ctx.closePath()
  const gradient = ctx.createLinearGradient(-0.4, -0.4, 0.4, 0.4)
  gradient.addColorStop(0, fill)
  gradient.addColorStop(1, edge)
  ctx.fillStyle = gradient
  ctx.fill()
  ctx.strokeStyle = 'rgba(42, 32, 17, 0.22)'
  ctx.lineWidth = 0.025
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(0, 0.5)
  ctx.lineTo(0, -0.48)
  ctx.strokeStyle = 'rgba(255, 247, 220, 0.22)'
  ctx.lineWidth = 0.018
  ctx.stroke()
  ctx.restore()
}

function createLeafClusterTexture(variant) {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, 512, 512)
  const random = mulberry(variant.seed + 771)
  const palette =
    variant.id === 'autumn'
      ? [
          ['#e3a52e', '#8f4d18'],
          ['#c77924', '#6e3514'],
          ['#f0c554', '#a96b20'],
          ['#a94b20', '#5c2816'],
          ['#d88e2e', '#7f4219'],
        ]
      : variant.id === 'sakura'
        ? [
            ['#ffe2ec', '#d88ba8'],
            ['#f7c6d8', '#c87798'],
            ['#fff2f5', '#e4a9bf'],
            ['#eeb0c7', '#b76185'],
            ['#f9d3e0', '#d28ca8'],
          ]
        : [
            ['#71924b', '#2f522e'],
            ['#5c8141', '#28482a'],
            ['#87a45a', '#3e6134'],
            ['#476d38', '#203e24'],
            ['#6f8e48', '#31532c'],
          ]

  ctx.lineCap = 'round'
  const twigs = 5
  for (let t = 0; t < twigs; t += 1) {
    const startX = 256 + (random() - 0.5) * 90
    const startY = 470
    const endX = 90 + random() * 332
    const endY = 30 + random() * 150
    ctx.beginPath()
    ctx.moveTo(startX, startY)
    ctx.quadraticCurveTo(
      startX + (random() - 0.5) * 170,
      250 + random() * 100,
      endX,
      endY,
    )
    ctx.strokeStyle = variant.id === 'sakura' ? 'rgba(87, 48, 46, 0.75)' : 'rgba(61, 44, 25, 0.78)'
    ctx.lineWidth = 3.5 + random() * 3
    ctx.stroke()
    const leavesOnTwig = 4 + Math.floor(random() * 2)
    for (let i = 0; i < leavesOnTwig; i += 1) {
      const u = 0.18 + (i / leavesOnTwig) * 0.72 + random() * 0.08
      const ix = (1 - u) * (1 - u) * startX + 2 * (1 - u) * u * (startX + (endX - startX) * 0.55) + u * u * endX
      const iy = (1 - u) * (1 - u) * startY + 2 * (1 - u) * u * (260 + (endY - 260) * 0.4) + u * u * endY
      const color = palette[Math.floor(random() * palette.length)]
      const kind = variant.id === 'autumn' ? 'maple' : variant.id === 'sakura' ? 'sakura' : random() > 0.55 ? 'ginkgo' : 'oak'
      drawSerratedLeaf(
        ctx,
        kind,
        ix + (random() - 0.5) * 34,
        iy + (random() - 0.5) * 34,
        34 + random() * 22,
        random() * Math.PI * 2,
        color[0],
        color[1],
      )
    }
  }

  for (let i = 0; i < 9; i += 1) {
    const color = palette[Math.floor(random() * palette.length)]
    drawSerratedLeaf(
      ctx,
      variant.id === 'autumn' ? 'maple' : variant.id === 'sakura' ? 'sakura' : 'oak',
      70 + random() * 372,
      70 + random() * 370,
      25 + random() * 20,
      random() * Math.PI * 2,
      color[0],
      color[1],
    )
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}

function createCrossGeometry() {
  const front = new THREE.PlaneGeometry(1, 1)
  front.translate(0, 0.5, 0)
  const side = new THREE.PlaneGeometry(1, 1)
  side.rotateY(Math.PI / 2)
  side.translate(0, 0.5, 0)
  const setHalfUv = (geometry, offset) => {
    const uv = geometry.attributes.uv
    for (let i = 0; i < uv.count; i += 1) {
      uv.setX(i, uv.getX(i) * 0.5 + offset)
    }
    uv.needsUpdate = true
  }
  setHalfUv(front, 0)
  setHalfUv(side, 0.5)
  return mergeGeometries([front, side], false)
}

function makeBox(w, h, d, x, y, z, matrix, parts) {
  const geometry = new THREE.BoxGeometry(w, h, d)
  geometry.applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z))
  if (matrix) geometry.applyMatrix4(matrix)
  parts.push(geometry)
}

function makeCylinder(rt, rb, h, x, y, z, matrix, parts, segments = 10) {
  const geometry = new THREE.CylinderGeometry(rt, rb, h, segments)
  geometry.applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z))
  if (matrix) geometry.applyMatrix4(matrix)
  parts.push(geometry)
}

function makeCone(radius, h, x, y, z, matrix, parts, segments = 4) {
  const geometry = new THREE.ConeGeometry(radius, h, segments)
  geometry.applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z))
  if (matrix) geometry.applyMatrix4(matrix)
  parts.push(geometry)
}

export default class TreeSystem {
  constructor({ scene, renderer, terrain, textures, rockGltf }) {
    this.scene = scene
    this.renderer = renderer
    this.terrain = terrain
    this.textures = textures
    this.rockGltf = rockGltf
    this.group = new THREE.Group()
    this.group.name = 'ForestAndShrines'
    this.collisionCircles = []
    this.trees = []
    this.variants = []
    this.leafMeshes = []
    this.trunkMeshes = []
    this.impostorMeshes = []
    this.billboardDistance = 65
    this.leafSway = 0.65
    this.lastPlayer = new THREE.Vector3(1e9, 0, 1e9)
    this.dirty = true
    this.time = 0
    this.barkMaterial = this.createBarkMaterial()
    this.buildVariants()
    this.bakeImpostorAtlases()
    this.buildTrees()
    this.buildRocks()
    this.buildTorii()
    this.buildLanterns()
    this.scene.add(this.group)
  }

  createBarkMaterial() {
    const map = this.textures.barkColor.clone()
    const normalMap = this.textures.barkNormal.clone()
    const roughnessMap = this.textures.barkRough.clone()
    for (const texture of [map, normalMap, roughnessMap]) {
      texture.wrapS = THREE.RepeatWrapping
      texture.wrapT = THREE.RepeatWrapping
      texture.anisotropy = 8
    }
    map.colorSpace = THREE.SRGBColorSpace
    const material = new THREE.MeshStandardMaterial({
      map,
      normalMap,
      roughnessMap,
      roughness: 0.92,
      metalness: 0,
      color: 0xd8c7b2,
      normalScale: new THREE.Vector2(0.8, 0.8),
    })
    material.name = 'BarkPBR'
    return material
  }

  buildVariants() {
    this.variants = [
      makeVariantBase(
        'autumn',
        'Golden Autumn Maple',
        ['#d98b2b', '#e5a83c', '#b55d24', '#f0c35a'],
        {
          seed: 121,
          height: 11.5,
          canopyRadius: 4.9,
          canopyY: 7.2,
          trunkRadius: 0.48,
          cardCount: 118,
          cardSize: 3.05,
        },
      ),
      makeVariantBase(
        'sakura',
        'White Blossom Sakura',
        ['#f6c7d8', '#f3b0c8', '#ffe3ec', '#e58fb0'],
        {
          seed: 283,
          height: 8.6,
          canopyRadius: 5.4,
          canopyY: 5.7,
          trunkRadius: 0.43,
          cardCount: 124,
          cardSize: 3.25,
        },
      ),
      makeVariantBase(
        'green',
        'Deep Forest Cedar',
        ['#3f6b38', '#4e7d3e', '#2d5230', '#6b8f4a'],
        {
          seed: 449,
          height: 14.2,
          canopyRadius: 4.1,
          canopyY: 8.8,
          trunkRadius: 0.52,
          cardCount: 108,
          cardSize: 2.75,
        },
      ),
    ]
  }

  bakeImpostorAtlases() {
    const previousTarget = this.renderer.getRenderTarget()
    const previousToneMapping = this.renderer.toneMapping
    const previousOutput = this.renderer.outputColorSpace
    const previousShadow = this.renderer.shadowMap.enabled
    const previousClear = this.renderer.getClearColor(new THREE.Color())
    const previousAlpha = this.renderer.getClearAlpha()
    this.renderer.toneMapping = THREE.NoToneMapping
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.shadowMap.enabled = false
    this.renderer.setClearColor(0x000000, 0)

    const size = 512
    const rt = new THREE.WebGLRenderTarget(size, size, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
    })
    rt.texture.colorSpace = THREE.SRGBColorSpace
    const pixels = new Uint8Array(size * size * 4)

    for (const variant of this.variants) {
      const bakeScene = new THREE.Scene()
      const tree = new THREE.Group()
      const trunk = new THREE.Mesh(variant.trunkGeometry, this.barkMaterial)
      tree.add(trunk)
      const leafGeometry = makeLeafCardGeometry(variant.cards.length)
      const leaves = new THREE.InstancedMesh(leafGeometry, variant.leafMaterial, variant.cards.length)
      for (let i = 0; i < variant.cards.length; i += 1) {
        const card = variant.cards[i]
        leaves.setMatrixAt(i, card.localMatrix)
        leafGeometry.attributes.aCanopyNormal.setXYZ(i, card.localNormal.x, card.localNormal.y, card.localNormal.z)
      }
      leaves.instanceMatrix.needsUpdate = true
      leafGeometry.attributes.aCanopyNormal.needsUpdate = true
      leaves.frustumCulled = false
      tree.add(leaves)
      bakeScene.add(tree)
      bakeScene.add(new THREE.AmbientLight(0xffffff, 2.1))
      const sun = new THREE.DirectionalLight(0xfff0d8, 2.5)
      sun.position.set(7, 14, 9)
      bakeScene.add(sun)
      const rim = new THREE.DirectionalLight(0x9bb8ff, 0.7)
      rim.position.set(-8, 6, -6)
      bakeScene.add(rim)

      tree.updateMatrixWorld(true)
      const bounds = new THREE.Box3().setFromObject(tree)
      const center = bounds.getCenter(new THREE.Vector3())
      const dimensions = bounds.getSize(new THREE.Vector3())
      const fov = 30
      const distance =
        Math.max(
          dimensions.y / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2))),
          dimensions.x / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2))),
          dimensions.z / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2))),
        ) * 1.18
      const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 100)
      const canvas = document.createElement('canvas')
      canvas.width = size * 2
      canvas.height = size
      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      for (let view = 0; view < 2; view += 1) {
        if (view === 0) camera.position.set(center.x, center.y + 0.2, center.z + distance)
        else camera.position.set(center.x + distance, center.y + 0.2, center.z)
        camera.lookAt(center)
        this.renderer.setRenderTarget(rt)
        this.renderer.clear()
        this.renderer.render(bakeScene, camera)
        this.renderer.readRenderTargetPixels(rt, 0, 0, size, size, pixels)
        const image = ctx.createImageData(size, size)
        for (let y = 0; y < size; y += 1) {
          const srcRow = (size - 1 - y) * size * 4
          const dstRow = y * size * 4
          image.data.set(pixels.subarray(srcRow, srcRow + size * 4), dstRow)
        }
        ctx.putImageData(image, view * size, 0)
      }

      const atlas = new THREE.CanvasTexture(canvas)
      atlas.colorSpace = THREE.SRGBColorSpace
      atlas.minFilter = THREE.LinearMipmapLinearFilter
      atlas.magFilter = THREE.LinearFilter
      atlas.generateMipmaps = true
      atlas.anisotropy = 8
      atlas.needsUpdate = true
      variant.impostorTexture = atlas
      variant.impostorMaterial = new THREE.MeshBasicMaterial({
        map: atlas,
        alphaTest: 0.45,
        side: THREE.DoubleSide,
        transparent: false,
        depthWrite: true,
        toneMapped: false,
        fog: true,
      })
      variant.impostorMaterial.name = `Impostor-${variant.id}`
      bakeScene.remove(tree)
    }

    rt.dispose()
    this.renderer.setRenderTarget(previousTarget)
    this.renderer.toneMapping = previousToneMapping
    this.renderer.outputColorSpace = previousOutput
    this.renderer.shadowMap.enabled = previousShadow
    this.renderer.setClearColor(previousClear, previousAlpha)
  }

  buildTrees() {
    const random = mulberry(99173)
    const groves = []
    for (let i = 0; i < 13; i += 1) {
      groves.push({
        x: -170 + random() * 340,
        z: -170 + random() * 340,
        radius: 13 + random() * 22,
      })
    }
    const spawnX = 0
    const spawnZ = 0
    while (this.trees.length < TREE_COUNT) {
      let x
      let z
      if (this.trees.length < 250) {
        const grove = groves[Math.floor(random() * groves.length)]
        const angle = random() * Math.PI * 2
        const radius = Math.sqrt(random()) * grove.radius
        x = grove.x + Math.cos(angle) * radius
        z = grove.z + Math.sin(angle) * radius
      } else {
        x = -185 + random() * 370
        z = -185 + random() * 370
      }
      if (Math.abs(x) > 185 || Math.abs(z) > 185) continue
      if (this.terrain.getPathMask(x, z) > 0.22) continue
      if (Math.hypot(x - spawnX, z - spawnZ) < 9) continue
      const roll = random()
      const variant = roll < 0.39 ? this.variants[0] : roll < 0.7 ? this.variants[1] : this.variants[2]
      const scale = 0.78 + random() * 0.48
      const yaw = random() * Math.PI * 2
      const y = this.terrain.getHeight(x, z)
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
        new THREE.Vector3(scale, scale, scale),
      )
      const cardMatrices = variant.cards.map((card) => matrix.clone().multiply(card.localMatrix))
      const tree = {
        variant,
        x,
        z,
        y,
        scale,
        yaw,
        matrix,
        cardMatrices,
        far: true,
        impostorMatrix: new THREE.Matrix4().compose(
          new THREE.Vector3(x, y, z),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
          new THREE.Vector3(
            variant.canopyRadius * 2.65 * scale,
            variant.height * 1.08 * scale,
            variant.canopyRadius * 2.65 * scale,
          ),
        ),
      }
      this.trees.push(tree)
      this.collisionCircles.push({ x, z, radius: 0.45 + scale * 0.32 })
    }

    const crossGeometry = createCrossGeometry()
    for (const variant of this.variants) {
      const trunk = new THREE.InstancedMesh(
        variant.trunkGeometry,
        this.barkMaterial,
        MAX_NEAR_PER_VARIANT,
      )
      trunk.name = `Trunks-${variant.id}`
      trunk.castShadow = true
      trunk.receiveShadow = true
      trunk.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      trunk.count = 0
      this.group.add(trunk)
      this.trunkMeshes.push({ variant, mesh: trunk })

      const leafGeometry = makeLeafCardGeometry(CARD_CAPACITY)
      const leaves = new THREE.InstancedMesh(leafGeometry, variant.leafMaterial, CARD_CAPACITY)
      leaves.name = `LeafCards-${variant.id}`
      leaves.castShadow = true
      leaves.receiveShadow = true
      leaves.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      leaves.frustumCulled = false
      leaves.count = 0
      this.group.add(leaves)
      this.leafMeshes.push({ variant, mesh: leaves, geometry: leafGeometry })

      const impostors = new THREE.InstancedMesh(crossGeometry, variant.impostorMaterial, TREE_COUNT)
      impostors.name = `Impostors-${variant.id}`
      impostors.castShadow = false
      impostors.receiveShadow = false
      impostors.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      impostors.frustumCulled = false
      impostors.count = 0
      this.group.add(impostors)
      this.impostorMeshes.push({ variant, mesh: impostors })
    }
  }

  buildRocks() {
    let geometry
    let material
    if (this.rockGltf?.scene) {
      const meshes = []
      this.rockGltf.scene.updateMatrixWorld(true)
      this.rockGltf.scene.traverse((object) => {
        if (!object.isMesh) return
        const clone = object.geometry.clone()
        clone.applyMatrix4(object.matrixWorld)
        meshes.push(clone)
        if (!material) material = object.material
      })
      geometry = meshes.length > 1 ? mergeGeometries(meshes, false) : meshes[0]
    }
    if (!geometry) {
      geometry = new THREE.DodecahedronGeometry(1.3, 1)
      material = new THREE.MeshStandardMaterial({ color: 0x66705d, roughness: 0.95 })
    }
    if (material?.map) material.map.colorSpace = THREE.SRGBColorSpace
    if (material) {
      material.roughness = Math.max(0.78, material.roughness ?? 1)
      material.metalness = 0
    }
    const mesh = new THREE.InstancedMesh(geometry, material, ROCK_COUNT)
    mesh.name = 'MossyBoulders'
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    const random = mulberry(31007)
    const dummy = new THREE.Object3D()
    let count = 0
    let attempts = 0
    while (count < ROCK_COUNT && attempts < ROCK_COUNT * 12) {
      attempts += 1
      const z = -170 + random() * 340
      const center = this.terrain.getPathCenter(z)
      const side = random() > 0.5 ? 1 : -1
      const x = center + side * (5.5 + random() * 18) + (random() - 0.5) * 8
      if (Math.abs(x) > 188 || this.terrain.getPathMask(x, z) > 0.42) continue
      if (Math.hypot(x, z) < 8) continue
      const scale = 1.05 + random() * 2.4
      const y = this.terrain.getHeight(x, z) - scale * 0.38
      dummy.position.set(x, y, z)
      dummy.rotation.set((random() - 0.5) * 0.18, random() * Math.PI * 2, (random() - 0.5) * 0.18)
      dummy.scale.set(scale * (0.75 + random() * 0.5), scale * (0.7 + random() * 0.35), scale)
      dummy.updateMatrix()
      mesh.setMatrixAt(count, dummy.matrix)
      count += 1
      this.collisionCircles.push({ x, z, radius: scale * 0.72 })
    }
    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
    this.group.add(mesh)
    this.rockMesh = mesh
  }

  buildTorii() {
    const redParts = []
    const darkParts = []
    const gatePositions = [-58, 92]
    for (const z of gatePositions) {
      const center = this.terrain.getPathCenter(z)
      const y = this.terrain.getHeight(center, z)
      const slope = this.terrain.getPathCenter(z + 1) - this.terrain.getPathCenter(z - 1)
      const rotation = Math.atan2(slope, 2)
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(center, y, z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation),
        new THREE.Vector3(1, 1, 1),
      )
      makeCylinder(0.28, 0.36, 6.2, -3.5, 3.1, 0, matrix, redParts, 12)
      makeCylinder(0.28, 0.36, 6.2, 3.5, 3.1, 0, matrix, redParts, 12)
      makeBox(9.2, 0.45, 0.65, 0, 6.15, 0, matrix, redParts)
      makeBox(7.4, 0.34, 0.5, 0, 5.2, 0, matrix, redParts)
      makeBox(1.1, 0.72, 0.28, 0, 5.55, 0, matrix, darkParts)
      makeBox(1.5, 0.16, 0.7, 0, 6.42, 0, matrix, darkParts)
      const leftPillar = new THREE.Vector3(-3.5, 0, 0).applyMatrix4(matrix)
      const rightPillar = new THREE.Vector3(3.5, 0, 0).applyMatrix4(matrix)
      this.collisionCircles.push(
        { x: leftPillar.x, z: leftPillar.z, radius: 0.52 },
        { x: rightPillar.x, z: rightPillar.z, radius: 0.52 },
      )
    }
    const redMaterial = new THREE.MeshStandardMaterial({
      color: 0xa72c1e,
      roughness: 0.58,
      metalness: 0.04,
    })
    const darkMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a1512,
      roughness: 0.72,
      metalness: 0.12,
    })
    const redMesh = new THREE.Mesh(mergeGeometries(redParts, false), redMaterial)
    redMesh.name = 'VermilionTorii'
    redMesh.castShadow = true
    redMesh.receiveShadow = true
    const darkMesh = new THREE.Mesh(mergeGeometries(darkParts, false), darkMaterial)
    darkMesh.name = 'ToriiCaps'
    darkMesh.castShadow = true
    darkMesh.receiveShadow = true
    this.group.add(redMesh, darkMesh)
  }

  buildLanterns() {
    const stoneParts = []
    const coreParts = []
    const positions = []
    const zs = [-155, -118, -80, -34, 18, 58, 104, 148]
    for (let i = 0; i < zs.length; i += 1) {
      const z = zs[i]
      const center = this.terrain.getPathCenter(z)
      const side = i % 2 === 0 ? 1 : -1
      const x = center + side * (5.2 + (i % 3) * 0.8)
      const y = this.terrain.getHeight(x, z)
      const matrix = new THREE.Matrix4().makeTranslation(x, y, z)
      makeBox(0.95, 0.28, 0.95, 0, 0.14, 0, matrix, stoneParts)
      makeCylinder(0.17, 0.22, 1.15, 0, 0.86, 0, matrix, stoneParts, 8)
      makeBox(0.74, 0.55, 0.74, 0, 1.62, 0, matrix, stoneParts)
      makeCone(0.58, 0.42, 0, 2.1, 0, matrix, stoneParts, 4)
      makeBox(0.4, 0.36, 0.4, 0, 1.62, 0, matrix, coreParts)
      positions.push(new THREE.Vector3(x, y, z))
      this.collisionCircles.push({ x, z, radius: 0.58 })
    }
    const stoneMaterial = new THREE.MeshStandardMaterial({
      color: 0x6f7065,
      roughness: 0.93,
      metalness: 0.02,
    })
    const coreMaterial = new THREE.MeshStandardMaterial({
      color: 0xffc16c,
      emissive: 0xff8c33,
      emissiveIntensity: 2.2,
      roughness: 0.32,
      metalness: 0,
    })
    const stone = new THREE.Mesh(mergeGeometries(stoneParts, false), stoneMaterial)
    stone.name = 'StoneLanterns'
    stone.castShadow = true
    stone.receiveShadow = true
    const cores = new THREE.Mesh(mergeGeometries(coreParts, false), coreMaterial)
    cores.name = 'LanternCores'
    cores.castShadow = false
    cores.receiveShadow = false
    this.group.add(stone, cores)
    const lightA = new THREE.PointLight(0xffa34e, 13, 13, 2)
    lightA.position.copy(positions[3]).add(new THREE.Vector3(0, 1.8, 0))
    const lightB = new THREE.PointLight(0xffa34e, 13, 13, 2)
    lightB.position.copy(positions[4]).add(new THREE.Vector3(0, 1.8, 0))
    this.group.add(lightA, lightB)
  }

  setSettings({ billboardDistance, leafSway }) {
    if (billboardDistance !== undefined) {
      this.billboardDistance = THREE.MathUtils.clamp(billboardDistance, 45, 140)
      this.dirty = true
    }
    if (leafSway !== undefined) this.leafSway = leafSway
  }

  update(time, playerPos) {
    this.time = time
    for (const variant of this.variants) {
      const shader = variant.leafMaterial.userData.shader
      if (shader) {
        shader.uniforms.uTime.value = time
        shader.uniforms.uLeafSway.value = this.leafSway
      }
    }

    const moved = this.lastPlayer.distanceToSquared(playerPos) > 1.5 * 1.5
    if (!moved && !this.dirty) return
    this.lastPlayer.copy(playerPos)
    this.dirty = false

    const nearByVariant = new Map(this.variants.map((variant) => [variant, []]))
    const farByVariant = new Map(this.variants.map((variant) => [variant, []]))
    const switchDistance = this.billboardDistance
    for (const tree of this.trees) {
      const distance = Math.hypot(tree.x - playerPos.x, tree.z - playerPos.z)
      if (distance < switchDistance - 2) tree.far = false
      else if (distance > switchDistance + 3) tree.far = true
      if (tree.far) farByVariant.get(tree.variant).push(tree)
      else nearByVariant.get(tree.variant).push(tree)
    }

    for (const { variant, mesh } of this.trunkMeshes) {
      const trees = nearByVariant.get(variant)
      const count = Math.min(trees.length, MAX_NEAR_PER_VARIANT)
      for (let i = 0; i < count; i += 1) mesh.setMatrixAt(i, trees[i].matrix)
      mesh.count = count
      mesh.instanceMatrix.needsUpdate = true
    }

    for (const { variant, mesh, geometry } of this.leafMeshes) {
      const trees = nearByVariant.get(variant)
      const cardCount = variant.cards.length
      let instance = 0
      const maxInstances = CARD_CAPACITY
      for (let t = 0; t < trees.length && instance + cardCount <= maxInstances; t += 1) {
        const tree = trees[t]
        for (let c = 0; c < cardCount; c += 1) {
          mesh.setMatrixAt(instance, tree.cardMatrices[c])
          const normal = variant.cards[c].localNormal
          geometry.attributes.aCanopyNormal.setXYZ(instance, normal.x, normal.y, normal.z)
          instance += 1
        }
      }
      mesh.count = instance
      mesh.instanceMatrix.needsUpdate = true
      geometry.attributes.aCanopyNormal.needsUpdate = true
    }

    for (const { variant, mesh } of this.impostorMeshes) {
      const trees = farByVariant.get(variant)
      const count = Math.min(trees.length, TREE_COUNT)
      for (let i = 0; i < count; i += 1) mesh.setMatrixAt(i, trees[i].impostorMatrix)
      mesh.count = count
      mesh.instanceMatrix.needsUpdate = true
    }
  }
}
