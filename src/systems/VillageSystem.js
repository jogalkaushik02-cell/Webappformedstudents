import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { mulberry } from '../utils/noise'

const NPC_COUNT = 14

function place(geometry, x, y, z, yaw = 0) {
  const g = geometry.clone()
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    new THREE.Vector3(1, 1, 1),
  )
  g.applyMatrix4(m)
  return g
}

function boxParts(parts, w, h, d, x, y, z, yaw = 0) {
  parts.push(place(new THREE.BoxGeometry(w, h, d), x, y, z, yaw))
}

function cylinderParts(parts, rt, rb, h, x, y, z, segments = 8, yaw = 0) {
  parts.push(place(new THREE.CylinderGeometry(rt, rb, h, segments), x, y, z, yaw))
}

function coneParts(parts, radius, h, x, y, z, segments = 4, yaw = 0) {
  parts.push(place(new THREE.ConeGeometry(radius, h, segments), x, y, z, yaw))
}

export default class VillageSystem {
  constructor({ scene, terrain }) {
    this.scene = scene
    this.terrain = terrain
    this.group = new THREE.Group()
    this.group.name = 'WorkingMedievalVillage'
    this.collisionCircles = []
    this.npcs = []
    this.random = mulberry(42211)

    const px = terrain.getPathCenter(48)
    this.center = new THREE.Vector3(px + 54, terrain.getHeight(px + 54, 48), 48)
    this.group.position.copy(this.center)

    this.buildVillage()
    this.buildNpcs()
    scene.add(this.group)
  }

  buildVillage() {
    const stone = []
    const wood = []
    const roof = []
    const earth = []
    const market = []

    const groundY = 0
    // Square + lanes
    for (let i = -5; i <= 5; i += 1) {
      boxParts(earth, 1.2, 0.04, 1.2, i * 1.25, 0.015, 0)
      boxParts(earth, 1.2, 0.04, 1.2, 0, 0.015, i * 1.25)
    }

    const house = (x, z, w, d, h, yaw) => {
      boxParts(wood, w, h, d, x, h / 2, z, yaw)
      boxParts(stone, w + 0.18, 0.28, d + 0.18, x, 0.14, z, yaw)
      boxParts(roof, w + 0.75, 0.35, d + 0.75, x, h + 0.18, z, yaw)
      // simple gabled roof as two slanted boxes
      const roofSlope = place(new THREE.BoxGeometry(w + 0.8, 0.16, d * 0.62), 0, h + 0.55, d * 0.18, yaw)
      roofSlope.rotateX(-0.42)
      roofSlope.translate(x, 0, z)
      roof.push(roofSlope)
      const roofSlopeB = place(new THREE.BoxGeometry(w + 0.8, 0.16, d * 0.62), 0, h + 0.55, -d * 0.18, yaw)
      roofSlopeB.rotateX(0.42)
      roofSlopeB.translate(x, 0, z)
      roof.push(roofSlopeB)
      // window + door recesses
      boxParts(market, 0.42, 0.46, 0.05, x + Math.sin(yaw) * (d / 2 + 0.03), h * 0.48, z + Math.cos(yaw) * (d / 2 + 0.03), yaw)
      this.collisionCircles.push({ x, z, radius: Math.max(w, d) * 0.58 })
    }

    house(-11, -7, 4.2, 4.8, 3.1, 0.15)
    house(11, -7, 4.2, 4.8, 3.1, -0.15)
    house(-11, 8, 4.5, 4.4, 2.8, -0.1)
    house(11, 8, 4.5, 4.4, 2.8, 0.1)
    house(0, -12, 5.2, 4.6, 3.2, 0)
    house(0, 13, 4.8, 4.4, 2.9, 0)

    // Blacksmith workshop
    boxParts(stone, 4.8, 3.0, 4.4, -17, 1.5, 0)
    boxParts(roof, 5.4, 0.35, 5.0, -17, 3.15, 0)
    cylinderParts(stone, 0.32, 0.38, 2.4, -18.4, 4.0, -1.4, 8)
    boxParts(market, 1.2, 0.55, 0.75, -15.2, 0.55, 1.8)
    this.collisionCircles.push({ x: -17, z: 0, radius: 2.8 })

    // Well (functional visual center; usable safe point for NPCs)
    cylinderParts(stone, 1.05, 1.18, 0.55, 0, 0.275, 0, 12)
    cylinderParts(stone, 0.82, 0.82, 0.12, 0, 0.58, 0, 12)
    boxParts(wood, 2.2, 0.18, 0.18, 0, 1.65, -0.75)
    boxParts(wood, 2.2, 0.18, 0.18, 0, 1.65, 0.75)
    cylinderParts(wood, 0.05, 0.05, 1.25, -0.85, 1.1, 0, 6)
    cylinderParts(wood, 0.05, 0.05, 1.25, 0.85, 1.1, 0, 6)
    this.collisionCircles.push({ x: 0, z: 0, radius: 1.25 })

    // Market stalls + cart
    for (const [x, z, yaw] of [[6, 3, 0.3], [-6, 4, -0.25], [5, -4, 0.9], [-5, -4, -0.8]]) {
      boxParts(wood, 2.0, 0.55, 1.2, x, 0.45, z, yaw)
      boxParts(market, 2.2, 0.12, 1.5, x, 1.15, z, yaw)
      boxParts(roof, 2.4, 0.12, 1.8, x, 1.85, z, yaw)
      this.collisionCircles.push({ x, z, radius: 1.15 })
    }
    boxParts(wood, 2.4, 0.75, 1.4, 16, 0.55, 4)
    cylinderParts(wood, 0.32, 0.32, 0.18, 15.3, 0.32, 4.5, 10, Math.PI / 2)
    cylinderParts(wood, 0.32, 0.32, 0.18, 16.7, 0.32, 4.5, 10, Math.PI / 2)

    // Farm plots + crops (working fields)
    for (let i = -2; i <= 2; i += 1) {
      boxParts(earth, 3.2, 0.08, 1.0, 20, 0.02, i * 1.2)
      for (let j = -1; j <= 1; j += 1) boxParts(market, 0.12, 0.32, 0.12, 19.2 + j * 0.8, 0.18, i * 1.2)
    }

    // Church/clock tower silhouette for village identity
    boxParts(stone, 3.0, 4.4, 3.0, 17, 2.2, -12)
    coneParts(roof, 2.4, 1.5, 17, 5.1, -12, 4)
    boxParts(wood, 0.7, 0.7, 0.08, 17, 3.3, -10.45)

    this.addMesh(mergeGeometries(stone, false), new THREE.MeshStandardMaterial({ color: 0x7b7569, roughness: 0.92, metalness: 0.02 }), 'VillageStone')
    this.addMesh(mergeGeometries(wood, false), new THREE.MeshStandardMaterial({ color: 0x6b4528, roughness: 0.86, metalness: 0.02 }), 'VillageTimber')
    this.addMesh(mergeGeometries(roof, false), new THREE.MeshStandardMaterial({ color: 0x3a2a24, roughness: 0.9, metalness: 0.02 }), 'VillageRoofs')
    this.addMesh(mergeGeometries(earth, false), new THREE.MeshStandardMaterial({ color: 0x4c3a28, roughness: 0.96, metalness: 0 }), 'VillageLanesAndFarms')
    this.addMesh(mergeGeometries(market, false), new THREE.MeshStandardMaterial({ color: 0x9a4a2f, roughness: 0.78, metalness: 0.02 }), 'VillageMarketAndWindows')

    // offset collisions into world space
    for (const c of this.collisionCircles) {
      c.x += this.center.x
      c.z += this.center.z
    }
  }

  addMesh(geometry, material, name) {
    if (!geometry) return
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = name
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.group.add(mesh)
  }

  buildNpcs() {
    const geometry = new THREE.CapsuleGeometry(0.28, 0.82, 4, 8)
    const material = new THREE.MeshStandardMaterial({ color: 0x7d6548, roughness: 0.88, metalness: 0 })
    this.npcMesh = new THREE.InstancedMesh(geometry, material, NPC_COUNT)
    this.npcMesh.name = 'WorkingVillagers'
    this.npcMesh.castShadow = true
    this.npcMesh.receiveShadow = true
    this.npcMesh.frustumCulled = false
    this.npcMesh.count = NPC_COUNT
    this.group.add(this.npcMesh)

    const jobs = ['farmer', 'blacksmith', 'market', 'well', 'guard', 'carpenter']
    for (let i = 0; i < NPC_COUNT; i += 1) {
      const angle = (i / NPC_COUNT) * Math.PI * 2
      const home = new THREE.Vector3(Math.cos(angle) * (7 + (i % 3) * 1.5), 0, Math.sin(angle) * (7 + (i % 3) * 1.5))
      const work = new THREE.Vector3(
        jobs[i % jobs.length] === 'blacksmith' ? -15 : jobs[i % jobs.length] === 'farmer' ? 19 : Math.cos(angle + 0.6) * 3.5,
        0,
        jobs[i % jobs.length] === 'farmer' ? -2 + (i % 5) * 1.1 : jobs[i % jobs.length] === 'blacksmith' ? 1 : Math.sin(angle + 0.6) * 3.5,
      )
      const npc = {
        index: i,
        alive: true,
        position: home.clone(),
        worldPosition: home.clone().add(this.center),
        home: home.clone(),
        work,
        phase: this.random() * Math.PI * 2,
        speed: 0.75 + this.random() * 0.45,
        job: jobs[i % jobs.length],
        working: true,
        deathTimer: 0,
      }
      this.npcs.push(npc)
    }
  }

  killNpc(npc) {
    if (!npc || !npc.alive) return
    npc.alive = false
    npc.deathTimer = 2.8
    npc.working = false
  }

  getTargets() {
    return this.npcs.filter((npc) => npc.alive)
  }

  update(dt, time) {
    const matrix = new THREE.Matrix4()
    const quat = new THREE.Quaternion()
    const scale = new THREE.Vector3(1, 1, 1)
    for (const npc of this.npcs) {
      if (!npc.alive) {
        npc.deathTimer -= dt
        if (npc.deathTimer <= 0) {
          npc.alive = true
          npc.position.copy(npc.home)
          npc.worldPosition.copy(npc.position).add(this.center)
          npc.working = true
        } else {
          matrix.makeScale(0, 0, 0)
          this.npcMesh.setMatrixAt(npc.index, matrix)
          continue
        }
      }

      const phase = Math.sin(time * 0.32 + npc.phase)
      npc.working = phase > -0.15
      const target = npc.working ? npc.work : npc.home
      const to = target.clone().sub(npc.position)
      to.y = 0
      const distance = to.length()
      if (distance > 0.18) {
        to.normalize()
        const step = Math.min(distance, npc.speed * dt)
        npc.position.x += to.x * step
        npc.position.z += to.z * step
        quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(to.x, to.z))
      } else {
        quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), npc.phase)
      }
      npc.position.y = this.terrain.getHeight(npc.position.x + this.center.x, npc.position.z + this.center.z) - this.center.y + 0.55
      npc.worldPosition.copy(npc.position).add(this.center)
      matrix.compose(npc.position, quat, scale)
      this.npcMesh.setMatrixAt(npc.index, matrix)
    }
    this.npcMesh.instanceMatrix.needsUpdate = true
  }
}
