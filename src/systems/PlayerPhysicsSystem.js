import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const UP = new THREE.Vector3(0, 1, 0)

function shortestAngle(from, to) {
  let delta = (to - from + Math.PI) % (Math.PI * 2)
  if (delta < 0) delta += Math.PI * 2
  return delta - Math.PI
}

export default class PlayerPhysicsSystem {
  constructor({ scene, camera, terrain, renderer, collisionCircles, loadingManager }) {
    this.scene = scene
    this.camera = camera
    this.terrain = terrain
    this.renderer = renderer
    this.collisionCircles = collisionCircles
    this.loadingManager = loadingManager
    this.position = new THREE.Vector3(0, 0, 0)
    this.velocity = new THREE.Vector3()
    this.yaw = 0
    this.orbitYaw = 0
    this.orbitPitch = 0.27
    this.distance = 7.4
    this.keys = new Set()
    this.touchInput = new THREE.Vector2()
    this.orbitPointer = null
    this.orbitLast = new THREE.Vector2()
    this.cameraTarget = new THREE.Vector3()
    this.cameraDesired = new THREE.Vector3()
    this.character = new THREE.Group()
    this.character.name = 'Player'
    this.bob = new THREE.Group()
    this.character.add(this.bob)
    this.scene.add(this.character)
    this.ready = false
    this.useGirl = true
    this.mixer = null
    this.actions = {}
    this.activeAction = null
    this.visualHeight = 1.72
    this.model = null
    this.setupInput()
    this.position.set(0, this.terrain.getHeight(0, 0), 0)
    this.character.position.copy(this.position)
    this.camera.position.set(0, this.position.y + 4.2, -7.5)
    this.camera.lookAt(0, this.position.y + 1.3, 0)
  }

  async load() {
    const loader = new GLTFLoader(this.loadingManager)
    const loadUrl = (url) =>
      new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject))

    let gltf = null
    try {
      gltf = await loadUrl('/assets/girl.glb')
      this.useGirl = true
    } catch (error) {
      console.warn('girl.glb failed, trying character_rig.glb', error)
      try {
        gltf = await loadUrl('/assets/character_rig.glb')
        this.useGirl = false
      } catch (fallbackError) {
        console.error('No player model loaded', fallbackError)
        return
      }
    }

    const model = gltf.scene
    model.traverse((object) => {
      if (!object.isMesh) return
      object.castShadow = true
      object.receiveShadow = true
      object.frustumCulled = true
      if (object.material) {
        object.material.envMapIntensity = 0.6
      }
    })

    model.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(model)
    const size = bounds.getSize(new THREE.Vector3())
    if (size.y > 0.001) {
      const scale = this.visualHeight / size.y
      model.scale.multiplyScalar(scale)
    }
    model.updateMatrixWorld(true)
    bounds.setFromObject(model)
    model.position.x -= (bounds.min.x + bounds.max.x) / 2
    model.position.z -= (bounds.min.z + bounds.max.z) / 2
    model.position.y -= bounds.min.y
    this.bob.add(model)
    this.model = model

    if (gltf.animations?.length) {
      this.mixer = new THREE.AnimationMixer(model)
      for (const clip of gltf.animations) {
        const action = this.mixer.clipAction(clip)
        const name = clip.name.toLowerCase()
        if (name.includes('idle')) this.actions.idle = action
        else if (name.includes('run')) this.actions.run = action
        else if (name.includes('walk')) this.actions.walk = action
      }
      if (this.actions.idle) {
        this.actions.idle.play()
        this.activeAction = this.actions.idle
      }
    }

    if (this.useGirl) this.addSamuraiAccents()
    this.ready = true
  }

  addSamuraiAccents() {
    // A restrained nod to the samurai brief: a red sash and a lacquered
    // scabbard, sized in metres and attached to the static girl model.
    const red = new THREE.MeshStandardMaterial({
      color: 0x8f1d1d,
      roughness: 0.58,
      metalness: 0.05,
    })
    const dark = new THREE.MeshStandardMaterial({
      color: 0x17151a,
      roughness: 0.4,
      metalness: 0.35,
    })
    const sash = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.035, 6, 24), red)
    sash.rotation.x = Math.PI / 2
    sash.position.set(0, 0.99, 0.02)
    sash.castShadow = true
    this.bob.add(sash)

    const scabbard = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.86, 8), dark)
    scabbard.position.set(0.23, 0.82, -0.04)
    scabbard.rotation.z = -0.24
    scabbard.rotation.x = 0.12
    scabbard.castShadow = true
    this.bob.add(scabbard)
    const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.023, 0.023, 0.23, 8), red)
    hilt.position.set(0.28, 1.25, -0.07)
    hilt.rotation.z = -0.24
    hilt.rotation.x = 0.12
    hilt.castShadow = true
    this.bob.add(hilt)
  }

  setupInput() {
    const onKey = (event, down) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return
      const key = event.key.toLowerCase()
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(key)) {
        event.preventDefault()
        if (down) this.keys.add(key)
        else this.keys.delete(key)
      }
    }
    window.addEventListener('keydown', (event) => onKey(event, true))
    window.addEventListener('keyup', (event) => onKey(event, false))

    const canvas = this.renderer.domElement
    canvas.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'touch' && event.clientX < window.innerWidth * 0.45) return
      this.orbitPointer = event.pointerId
      this.orbitLast.set(event.clientX, event.clientY)
      canvas.setPointerCapture?.(event.pointerId)
    })
    canvas.addEventListener('pointermove', (event) => {
      if (this.orbitPointer !== event.pointerId) return
      const dx = event.clientX - this.orbitLast.x
      const dy = event.clientY - this.orbitLast.y
      this.orbitLast.set(event.clientX, event.clientY)
      this.orbitYaw -= dx * 0.006
      this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + dy * 0.004, -0.08, 1.05)
    })
    const releaseOrbit = (event) => {
      if (this.orbitPointer === event.pointerId) this.orbitPointer = null
    }
    canvas.addEventListener('pointerup', releaseOrbit)
    canvas.addEventListener('pointercancel', releaseOrbit)
    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault()
        this.distance = THREE.MathUtils.clamp(this.distance + event.deltaY * 0.006, 3.2, 13)
      },
      { passive: false },
    )

    const base = document.createElement('div')
    base.className = 'touch-joystick'
    base.setAttribute('aria-hidden', 'true')
    const knob = document.createElement('div')
    knob.className = 'touch-joystick-knob'
    base.appendChild(knob)
    document.body.appendChild(base)
    this.joystickBase = base
    this.joystickKnob = knob
    let joystickPointer = null
    let center = new THREE.Vector2()
    const reset = () => {
      joystickPointer = null
      this.touchInput.set(0, 0)
      knob.style.transform = 'translate(-50%, -50%)'
      base.classList.remove('active')
    }
    base.addEventListener('pointerdown', (event) => {
      joystickPointer = event.pointerId
      const rect = base.getBoundingClientRect()
      center.set(rect.left + rect.width / 2, rect.top + rect.height / 2)
      base.classList.add('active')
      base.setPointerCapture?.(event.pointerId)
      event.preventDefault()
    })
    base.addEventListener('pointermove', (event) => {
      if (joystickPointer !== event.pointerId) return
      const dx = event.clientX - center.x
      const dy = event.clientY - center.y
      const max = 44
      const length = Math.hypot(dx, dy)
      const scale = length > max ? max / length : 1
      const nx = (dx * scale) / max
      const ny = (dy * scale) / max
      this.touchInput.set(nx, -ny)
      knob.style.transform = `translate(calc(-50% + ${dx * scale}px), calc(-50% + ${dy * scale}px))`
      event.preventDefault()
    })
    base.addEventListener('pointerup', reset)
    base.addEventListener('pointercancel', reset)
    base.addEventListener('pointerleave', (event) => {
      if (event.buttons === 0) reset()
    })
  }

  fadeAction(next, duration = 0.2) {
    if (!next || next === this.activeAction) return
    if (this.activeAction) this.activeAction.fadeOut(duration)
    next.reset().fadeIn(duration).play()
    this.activeAction = next
  }

  resolveCollisions(next) {
    for (const circle of this.collisionCircles) {
      const dx = next.x - circle.x
      const dz = next.z - circle.z
      const min = circle.radius + 0.38
      const d2 = dx * dx + dz * dz
      if (d2 < min * min && d2 > 0.000001) {
        const d = Math.sqrt(d2)
        const push = (min - d) / d
        next.x += dx * push
        next.z += dz * push
      }
    }
    next.x = THREE.MathUtils.clamp(next.x, -194, 194)
    next.z = THREE.MathUtils.clamp(next.z, -194, 194)
    return next
  }

  update(dt, time) {
    if (!this.ready) return
    const inputX =
      (this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0) -
      (this.keys.has('a') || this.keys.has('arrowleft') ? 1 : 0) +
      this.touchInput.x
    const inputZ =
      (this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0) -
      (this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0) +
      this.touchInput.y
    const input = new THREE.Vector2(inputX, inputZ)
    if (input.lengthSq() > 1) input.normalize()
    const forward = new THREE.Vector3(Math.sin(this.orbitYaw), 0, Math.cos(this.orbitYaw))
    const right = new THREE.Vector3(Math.cos(this.orbitYaw), 0, -Math.sin(this.orbitYaw))
    const move = forward.multiplyScalar(input.y).add(right.multiplyScalar(input.x))
    const running = this.keys.has('shift') || Math.hypot(this.touchInput.x, this.touchInput.y) > 0.75
    const normal = this.terrain.getNormal(this.position.x, this.position.z)
    const slope = THREE.MathUtils.clamp(normal.y, 0.45, 1)
    const speed = (running ? 6.4 : 3.1) * (0.62 + slope * 0.38)
    if (move.lengthSq() > 0.0001) {
      move.normalize()
      const targetYaw = Math.atan2(move.x, move.z)
      this.yaw += shortestAngle(this.yaw, targetYaw) * Math.min(1, dt * 12)
      this.position.x += move.x * speed * dt
      this.position.z += move.z * speed * dt
      this.resolveCollisions(this.position)
    }
    const ground = this.terrain.getHeight(this.position.x, this.position.z)
    this.position.y += (ground - this.position.y) * Math.min(1, dt * 14)
    this.character.position.copy(this.position)
    this.character.rotation.y = this.yaw

    const speedNow = move.lengthSq() > 0.0001 ? speed : 0
    if (this.mixer) {
      this.mixer.update(dt)
      if (speedNow > 4.4) this.fadeAction(this.actions.run)
      else if (speedNow > 0.1) this.fadeAction(this.actions.walk)
      else this.fadeAction(this.actions.idle)
    } else {
      const walkPhase = time * (running ? 10.5 : 6.4)
      const stride = speedNow > 0.1 ? 1 : 0
      this.bob.position.y = Math.abs(Math.sin(walkPhase)) * 0.035 * stride
      this.bob.rotation.z = Math.sin(walkPhase * 0.5) * 0.018 * stride
      this.bob.rotation.x = stride * 0.035 + Math.sin(time * 1.4) * 0.006
    }

    const cosPitch = Math.cos(this.orbitPitch)
    const target = new THREE.Vector3(this.position.x, this.position.y + 1.35, this.position.z)
    this.cameraTarget.lerp(target, 1 - Math.exp(-dt * 10))
    const desired = this.cameraTarget.clone().add(
      new THREE.Vector3(
        -Math.sin(this.orbitYaw) * this.distance * cosPitch + Math.cos(this.orbitYaw) * 0.42,
        1.2 + Math.sin(this.orbitPitch) * this.distance,
        -Math.cos(this.orbitYaw) * this.distance * cosPitch - Math.sin(this.orbitYaw) * 0.42,
      ),
    )
    const cameraGround = this.terrain.getHeight(desired.x, desired.z)
    desired.y = Math.max(desired.y, cameraGround + 1.15)
    this.cameraDesired.lerp(desired, 1 - Math.exp(-dt * 9))
    this.camera.position.copy(this.cameraDesired)
    this.camera.lookAt(this.cameraTarget.clone().add(new THREE.Vector3(0, 0.05, 0)))
  }
}
