import * as THREE from 'three'

const FIRE_POOL = 18

function hideMatrix(out) {
  return out.makeScale(0, 0, 0)
}

export default class DragonSystem {
  constructor({ scene, terrain, renderer, dragonGltf, villageCenter, loadingManager }) {
    this.scene = scene
    this.terrain = terrain
    this.renderer = renderer
    this.dragonGltf = dragonGltf
    this.loadingManager = loadingManager
    this.group = new THREE.Group()
    this.group.name = 'RideableFlyingDragon'
    this.seat = new THREE.Object3D()
    this.seat.name = 'DragonSaddleSeat'
    this.group.add(this.seat)
    this.scene.add(this.group)
    this.position = new THREE.Vector3()
    this.villageCenter = villageCenter ? villageCenter.clone() : new THREE.Vector3(0, 0, 42)
    this.flyRadius = 128
    this.flyHeight = 34
    this.flySpeed = 0.105
    this.flightTime = 0
    this.ready = false

    this.fireMesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.42, 8, 6),
      new THREE.MeshStandardMaterial({
        color: 0xff8a1f,
        emissive: 0xff4d00,
        emissiveIntensity: 2.4,
        roughness: 0.25,
        metalness: 0,
      }),
      FIRE_POOL,
    )
    this.fireMesh.name = 'DragonFireballPool'
    this.fireMesh.castShadow = false
    this.fireMesh.receiveShadow = false
    this.fireMesh.frustumCulled = false
    this.fireMesh.count = 0
    this.fireballs = []
    this.fireTimer = 0
    this.scene.add(this.fireMesh)
    this.fireLight = new THREE.PointLight(0xff7a2a, 0, 24, 2)
    this.scene.add(this.fireLight)
    this.tmpMatrix = new THREE.Matrix4()
    this.tmpQuat = new THREE.Quaternion()
    this.tmpScale = new THREE.Vector3()
    this.tmpPos = new THREE.Vector3()
    this.setup()
  }

  setup() {
    if (!this.dragonGltf?.scene) return
    const model = this.dragonGltf.scene
    model.name = 'LowPolyDragonCC0'
    model.traverse((object) => {
      if (!object.isMesh) return
      object.castShadow = true
      object.receiveShadow = false
      object.frustumCulled = false
      if (object.material) {
        object.material.metalness = 0
        object.material.roughness = 0.68
      }
    })
    model.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(model)
    const size = bounds.getSize(new THREE.Vector3())
    const longest = Math.max(size.x, size.y, size.z)
    if (longest > 0.001) model.scale.multiplyScalar(7.4 / longest)
    model.updateMatrixWorld(true)
    bounds.setFromObject(model)
    model.position.x -= (bounds.min.x + bounds.max.x) / 2
    model.position.z -= (bounds.min.z + bounds.max.z) / 2
    model.position.y -= bounds.min.y
    this.group.add(model)
    this.seat.position.set(0.34, 2.15, 0.12)
    this.ready = true
  }

  spawnFireball(origin, targetPos) {
    if (this.fireballs.length >= FIRE_POOL) return
    const position = origin.clone()
    const velocity = targetPos.clone().sub(position)
    const distance = Math.max(1, velocity.length())
    velocity.normalize().multiplyScalar(34 + distance * 0.12)
    this.fireballs.push({ position, velocity, life: 3.2, target: targetPos.clone(), radius: 1.15 })
  }

  updateFireballs(dt, targets, onNpcHit) {
    const remaining = []
    for (const fire of this.fireballs) {
      fire.life -= dt
      fire.position.addScaledVector(fire.velocity, dt)
      const ground = this.terrain.getHeight(fire.position.x, fire.position.z)
      let hit = fire.position.y <= ground + 0.45
      let hitNpc = null
      for (const target of targets) {
        if (!target.alive) continue
        if (fire.position.distanceToSquared(target.worldPosition) < fire.radius * fire.radius) {
          hit = true
          hitNpc = target
          break
        }
      }
      if (!hit && fire.life > 0) {
        remaining.push(fire)
      } else if (hitNpc && onNpcHit) {
        onNpcHit(hitNpc)
      }
    }
    this.fireballs = remaining

    this.fireMesh.count = Math.min(FIRE_POOL, this.fireballs.length)
    for (let i = 0; i < this.fireMesh.count; i += 1) {
      this.tmpPos.copy(this.fireballs[i].position)
      this.tmpQuat.identity()
      this.tmpScale.setScalar(0.75 + 0.25 * Math.sin(i * 12.989 + fireTime(this.fireballs[i]) * 18))
      this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale)
      this.fireMesh.setMatrixAt(i, this.tmpMatrix)
    }
    for (let i = this.fireMesh.count; i < FIRE_POOL; i += 1) this.fireMesh.setMatrixAt(i, hideMatrix(this.tmpMatrix))
    this.fireMesh.instanceMatrix.needsUpdate = true
    if (this.fireMesh.count > 0) {
      this.fireLight.position.copy(this.fireballs[0].position)
      this.fireLight.intensity = 8
    } else {
      this.fireLight.intensity = 0
    }
  }

  update(dt, time, targets = [], onNpcHit) {
    if (!this.ready) return
    this.flightTime += dt
    const angle = time * this.flySpeed + 0.7
    const cx = this.villageCenter.x * 0.45
    const cz = this.villageCenter.z * 0.45 + 20
    this.position.x = cx + Math.cos(angle) * this.flyRadius
    this.position.z = cz + Math.sin(angle) * this.flyRadius
    const ground = this.terrain.getHeight(this.position.x, this.position.z)
    this.position.y = Math.max(ground + 18, this.villageCenter.y + this.flyHeight + Math.sin(time * 0.72) * 2.5)
    this.group.position.copy(this.position)
    this.group.rotation.order = 'YXZ'
    this.group.rotation.y = angle + Math.PI / 2
    this.group.rotation.z = Math.sin(time * 1.1) * 0.09
    this.group.rotation.x = -0.08 + Math.sin(time * 1.8) * 0.025

    this.fireTimer += dt
    if (this.fireTimer > 2.35) {
      this.fireTimer = 0
      const alive = targets.filter((target) => target.alive)
      const target = alive.length ? alive[Math.floor(Math.random() * alive.length)] : null
      if (target) {
        const origin = this.group.position.clone().add(new THREE.Vector3(0, 3.2, 3.4).applyEuler(this.group.rotation))
        this.spawnFireball(origin, target.worldPosition.clone().add(new THREE.Vector3(0, 0.8, 0)))
      } else {
        const villageTarget = this.villageCenter.clone().add(new THREE.Vector3(2, 0.5, 2))
        this.spawnFireball(this.group.position.clone().add(new THREE.Vector3(0, 3.2, 3.4).applyEuler(this.group.rotation)), villageTarget)
      }
    }

    this.updateFireballs(dt, targets, onNpcHit)
  }
}

function fireTime(fire) {
  return Math.max(0, 3.2 - fire.life)
}
