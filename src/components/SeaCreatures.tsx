import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { type ThreeEvent, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mulberry32, range } from '../scene/random'
import { groundY, terrainNormal, SURFACE_Y } from '../scene/terrain'
import { steerAroundStructures } from '../scene/obstacles'
import {
  createFinGeometry,
  createRingBody,
} from '../scene/organic'
import { Crabs } from './Crabs'
import { Shrimp } from './Shrimp'
import type { SceneRuntime } from '../scene/types'

const dummy = new THREE.Object3D()
const TAU = Math.PI * 2

function safeDelta(value: number) {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 0.05) : 1 / 60
}

function isFiniteVector(v: THREE.Vector3) {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)
}

function useDisposable<T extends { dispose: () => void }>(factory: () => T): T {
  const resource = useMemo(factory, [])
  useEffect(() => () => resource.dispose(), [resource])
  return resource
}

/**
 * Os modelos têm a frente em +X. A tangente de uma órbita (cos a, sen a) é
 * deslocada de -90° para +X apontar no sentido do movimento.
 */
function orbitHeading(angle: number, angularSpeed: number) {
  return -angle - (angularSpeed > 0 ? Math.PI / 2 : -Math.PI / 2)
}

interface CreatureProps {
  sceneRef: React.RefObject<SceneRuntime>
  onSelect: (id: string) => void
}

/* -------------------------------------------------------------------------- */
/*                                  GOLFINHOS                                 */
/* -------------------------------------------------------------------------- */

interface DolphinProps extends CreatureProps {
  index: number
}

/** Dorso azulado, flancos claros e ventre quase branco direto na malha do corpo. */
function paintDolphinBody(geo: THREE.BufferGeometry) {
  const pos = geo.attributes.position as THREE.BufferAttribute
  const colors = new Float32Array(pos.count * 3)
  const dorsal = new THREE.Color('#5f8ea6')
  const flank = new THREE.Color('#9ec6d7')
  const belly = new THREE.Color('#edf7f6')
  const tint = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const center = 0.02 + 0.06 * THREE.MathUtils.smoothstep(x, 1.1, 1.9)
    const y = pos.getY(i) - center
    tint.copy(flank).lerp(belly, 1 - THREE.MathUtils.smoothstep(y, -0.26, 0.12))
    tint.lerp(dorsal, THREE.MathUtils.smoothstep(y, 0.1, 0.44) * 0.75)
    // O pedúnculo caudal fica um tom mais escuro, como na pele real.
    tint.multiplyScalar(1 - (1 - THREE.MathUtils.smoothstep(x, -1.9, -0.5)) * 0.08)
    colors[i * 3] = tint.r
    colors[i * 3 + 1] = tint.g
    colors[i * 3 + 2] = tint.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geo
}

/** Golfinho anatômico: melão, rostro com mandíbula, dorso falcado e fluke bifurcado. */
function Dolphin({ index, sceneRef, onSelect }: DolphinProps) {
  const group = useRef<THREE.Group>(null)
  const tail = useRef<THREE.Group>(null)
  const leftFin = useRef<THREE.Group>(null)
  const rightFin = useRef<THREE.Group>(null)

  const bodyGeo = useDisposable(() =>
    paintDolphinBody(
      createRingBody(
        [
          { x: -2.15, ry: 0.05, rz: 0.04 },
          { x: -1.85, ry: 0.09, rz: 0.075 },
          { x: -1.45, ry: 0.18, rz: 0.14 },
          { x: -1.0, ry: 0.31, rz: 0.24, y: -0.02 },
          { x: -0.5, ry: 0.45, rz: 0.36, y: -0.03 },
          { x: 0.0, ry: 0.55, rz: 0.45, y: -0.02 },
          { x: 0.5, ry: 0.56, rz: 0.44, y: 0.0 },
          { x: 0.95, ry: 0.49, rz: 0.38, y: 0.03 },
          { x: 1.3, ry: 0.4, rz: 0.3, y: 0.05 },
          { x: 1.6, ry: 0.3, rz: 0.22, y: 0.06 },
          { x: 1.85, ry: 0.19, rz: 0.14, y: 0.05 },
          { x: 2.05, ry: 0.1, rz: 0.08, y: 0.04 },
        ],
        22
      )
    )
  )
  const rostrumGeo = useDisposable(() =>
    createRingBody(
      [
        { x: 1.92, ry: 0.1, rz: 0.1, y: 0.035 },
        { x: 2.3, ry: 0.08, rz: 0.078, y: 0.03 },
        { x: 2.65, ry: 0.052, rz: 0.05, y: 0.025 },
        { x: 2.98, ry: 0.014, rz: 0.016, y: 0.02 },
      ],
      14
    )
  )
  const mandibleGeo = useDisposable(() =>
    createRingBody(
      [
        { x: 1.95, ry: 0.065, rz: 0.088, y: -0.05 },
        { x: 2.32, ry: 0.045, rz: 0.066, y: -0.045 },
        { x: 2.66, ry: 0.026, rz: 0.04, y: -0.035 },
        { x: 2.9, ry: 0.01, rz: 0.014, y: -0.025 },
      ],
      12
    )
  )
  const dorsalGeo = useDisposable(() =>
    createFinGeometry(
      [
        [0.46, 0],
        [0.3, 0.4],
        [-0.04, 0.86],
        [-0.62, 1.05],
        [-0.38, 0.42],
        [-0.58, 0],
      ],
      0.075,
      false
    )
  )
  const finGeo = useDisposable(() =>
    createFinGeometry(
      [
        [0.46, 0.04],
        [0.08, -0.1],
        [-0.48, -0.3],
        [-0.98, -0.56],
        [-0.7, -0.14],
        [-0.12, 0.14],
      ],
      0.055
    )
  )
  const flukeGeo = useDisposable(() => {
    const geo = createFinGeometry(
      [
        [0.16, 0],
        [-0.16, 0.2],
        [-0.8, 0.66],
        [-0.54, 0.19],
        [-0.28, 0],
        [-0.54, -0.19],
        [-0.8, -0.66],
        [-0.16, -0.2],
      ],
      0.065,
      false
    )
    geo.rotateX(Math.PI / 2)
    geo.computeBoundingSphere()
    return geo
  })

  const motion = useMemo(() => {
    const rng = mulberry32(310 + index)
    return {
      radius: range(rng, 13, 23),
      speed: range(rng, 0.075, 0.12) * (index % 2 ? -1 : 1),
      angle: rng() * TAU,
      y: range(rng, 2.2, 5.2),
      phase: rng() * TAU,
      scale: range(rng, 0.85, 1.15),
    }
  }, [index])

  const runtime = useMemo(
    () => ({
      id: `dolphin-${index}`,
      species: 'turtle' as const,
      position: new THREE.Vector3(),
      size: 2.2 * motion.scale,
      color: '#9fd6e8',
    }),
    [index, motion.scale]
  )

  useEffect(() => {
    sceneRef.current.fish.push(runtime)
    return () => {
      sceneRef.current.fish = sceneRef.current.fish.filter((fish) => fish.id !== runtime.id)
    }
  }, [runtime, sceneRef])

  const steer = useMemo(() => new THREE.Vector3(), [])

  useFrame((state, rawDelta) => {
    const dt = safeDelta(rawDelta)
    motion.angle += motion.speed * dt
    const t = state.clock.elapsedTime + motion.phase
    const x = Math.cos(motion.angle) * motion.radius
    const z = Math.sin(motion.angle) * motion.radius
    const desiredY = motion.y + Math.sin(t * 1.1) * 0.65
    const y = THREE.MathUtils.clamp(desiredY, groundY(x, z) + 2, SURFACE_Y - 2)

    if (group.current) {
      if (!isFiniteVector(group.current.position)) group.current.position.set(x, y, z)
      group.current.position.set(x, y, z)
      const heading = orbitHeading(motion.angle, motion.speed)
      if (Number.isFinite(heading)) group.current.rotation.y = heading
      group.current.rotation.z = Math.sin(t * 0.8) * 0.08
      runtime.position.copy(group.current.position)
    }
    if (tail.current) {
      tail.current.rotation.y = Math.sin(t * 5.8) * 0.44
      tail.current.rotation.x = Math.sin(t * 2.9 + 0.7) * 0.06
    }
    if (leftFin.current) leftFin.current.rotation.z = -0.16 + Math.sin(t * 3.6) * 0.16
    if (rightFin.current) rightFin.current.rotation.z = 0.16 - Math.sin(t * 3.6) * 0.16

    // Desvio das ruínas: ajusta o raio da órbita quando há uma coluna por perto.
    steer.set(x, y, z)
    const before = motion.radius
    steerAroundStructures(steer, new THREE.Vector3(), 2.2, 0)
    motion.radius = THREE.MathUtils.clamp(before, 12, 24)
  })

  return (
    <group
      ref={group}
      scale={motion.scale}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation()
        onSelect(runtime.id)
      }}
      onPointerOver={() => (document.body.style.cursor = 'pointer')}
      onPointerOut={() => (document.body.style.cursor = 'auto')}
    >
      <mesh geometry={bodyGeo} castShadow frustumCulled={false}>
        <meshStandardMaterial color="#ffffff" vertexColors roughness={0.38} metalness={0.06} />
      </mesh>
      <mesh geometry={rostrumGeo} castShadow frustumCulled={false}>
        <meshStandardMaterial color="#a8cddb" roughness={0.42} metalness={0.05} />
      </mesh>
      <mesh geometry={mandibleGeo} castShadow frustumCulled={false}>
        <meshStandardMaterial color="#dceced" roughness={0.48} metalness={0.04} />
      </mesh>

      {/* Melão, soquete dos olhos com brilho e blowhole no topo da cabeça. */}
      <mesh position={[1.7, 0.13, 0]} scale={[0.44, 0.34, 0.35]} castShadow frustumCulled={false}>
        <sphereGeometry args={[1, 18, 12]} />
        <meshStandardMaterial color="#a8cddb" roughness={0.4} metalness={0.05} />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={`eye-${side}`}>
          <mesh position={[1.68, 0.16, side * 0.3]} scale={[1, 0.9, 0.5]} frustumCulled={false}>
            <sphereGeometry args={[0.095, 10, 8]} />
            <meshStandardMaterial color="#29404b" roughness={0.5} />
          </mesh>
          <mesh position={[1.69, 0.16, side * 0.35]} frustumCulled={false}>
            <sphereGeometry args={[0.055, 10, 8]} />
            <meshStandardMaterial color="#08151b" roughness={0.25} />
          </mesh>
          <mesh position={[1.71, 0.19, side * 0.39]} frustumCulled={false}>
            <sphereGeometry args={[0.016, 6, 5]} />
            <meshBasicMaterial color="#eaf9ff" />
          </mesh>
        </group>
      ))}
      <mesh position={[1.18, 0.53, 0]} scale={[0.12, 0.022, 0.075]} frustumCulled={false}>
        <sphereGeometry args={[1, 12, 8]} />
        <meshStandardMaterial color="#263b45" roughness={0.7} />
      </mesh>

      <mesh geometry={dorsalGeo} position={[-0.14, 0.5, 0]} rotation={[0, 0, 0.06]} castShadow frustumCulled={false}>
        <meshStandardMaterial color="#628fa5" roughness={0.52} side={THREE.DoubleSide} />
      </mesh>
      {([leftFin, rightFin] as const).map((ref, i) => (
        <group
          key={`fin-${i}`}
          ref={ref}
          position={[0.32, -0.2, i === 0 ? 0.38 : -0.38]}
          rotation={[0, i === 0 ? Math.PI / 2 : -Math.PI / 2, 0]}
        >
          <mesh geometry={finGeo} castShadow frustumCulled={false}>
            <meshStandardMaterial color="#7ba6b8" roughness={0.55} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
      <group ref={tail} position={[-2.15, 0, 0]}>
        <mesh scale={[0.42, 0.12, 0.11]} frustumCulled={false}>
          <sphereGeometry args={[1, 12, 8]} />
          <meshStandardMaterial color="#7ba6b8" roughness={0.5} />
        </mesh>
        <mesh geometry={flukeGeo} position={[-0.42, 0, 0]} castShadow frustumCulled={false}>
          <meshStandardMaterial color="#628fa5" roughness={0.52} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  )
}

/* -------------------------------------------------------------------------- */
/*                                 ARRAIAS                                    */
/* -------------------------------------------------------------------------- */

interface MantaRayProps extends CreatureProps {
  index: number
}

/** Arraia-manta com asas orgânicas batendo e cauda longa. */
function MantaRay({ index, sceneRef, onSelect }: MantaRayProps) {
  const group = useRef<THREE.Group>(null)
  const leftWing = useRef<THREE.Group>(null)
  const rightWing = useRef<THREE.Group>(null)

  const bodyGeo = useDisposable(() => {
    const geo = new THREE.SphereGeometry(1, 20, 12)
    geo.scale(1.2, 0.18, 0.85)
    geo.computeVertexNormals()
    geo.computeBoundingSphere()
    return geo
  })
  const wingGeo = useDisposable(() => {
    const geo = createFinGeometry(
      [
        [0.7, 0.1],
        [0.1, 0.45],
        [-1.1, 1.9],
        [-1.3, 0.2],
        [-1.4, -0.2],
        [-1.1, -1.9],
        [0.1, -0.45],
      ],
      0.12,
      false
    )
    geo.rotateX(Math.PI / 2)
    geo.translate(0, -0.06, 0)
    return geo
  })
  const tailGeo = useDisposable(() => {
    const geo = new THREE.CylinderGeometry(0.012, 0.05, 2.8, 6)
    geo.rotateZ(Math.PI / 2)
    geo.translate(-2.3, -0.02, 0)
    geo.computeBoundingSphere()
    return geo
  })

  const motion = useMemo(() => {
    const rng = mulberry32(820 + index)
    return {
      radius: range(rng, 16, 26),
      speed: range(rng, 0.04, 0.07) * (index % 2 ? -1 : 1),
      angle: rng() * TAU,
      y: range(rng, 0.5, 3.5),
      phase: rng() * TAU,
      scale: range(rng, 0.9, 1.35),
    }
  }, [index])

  const runtime = useMemo(
    () => ({
      id: `ray-${index}`,
      species: 'turtle' as const,
      position: new THREE.Vector3(),
      size: 2.6 * motion.scale,
      color: '#5b8fa8',
    }),
    [index, motion.scale]
  )

  useEffect(() => {
    sceneRef.current.fish.push(runtime)
    return () => {
      sceneRef.current.fish = sceneRef.current.fish.filter((fish) => fish.id !== runtime.id)
    }
  }, [runtime, sceneRef])

  useFrame((state, rawDelta) => {
    const dt = safeDelta(rawDelta)
    motion.angle += motion.speed * dt
    const t = state.clock.elapsedTime * 1.4 + motion.phase
    const x = Math.cos(motion.angle) * motion.radius
    const z = Math.sin(motion.angle) * motion.radius
    const y = THREE.MathUtils.clamp(motion.y + Math.sin(t * 0.55) * 0.4, groundY(x, z) + 1.4, SURFACE_Y - 1.8)
    if (group.current) {
      group.current.position.set(x, y, z)
      const heading = orbitHeading(motion.angle, motion.speed)
      if (Number.isFinite(heading)) group.current.rotation.y = heading
      runtime.position.copy(group.current.position)
    }
    const flap = Math.sin(t) * 0.32
    if (leftWing.current) leftWing.current.rotation.z = flap
    if (rightWing.current) rightWing.current.rotation.z = -flap
  })

  return (
    <group
      ref={group}
      scale={motion.scale}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation()
        onSelect(runtime.id)
      }}
      onPointerOver={() => (document.body.style.cursor = 'pointer')}
      onPointerOut={() => (document.body.style.cursor = 'auto')}
    >
      <mesh geometry={bodyGeo} castShadow frustumCulled={false}>
        <meshStandardMaterial color="#668fa3" roughness={0.58} />
      </mesh>
      <mesh position={[0.15, -0.1, 0]} scale={[0.8, 0.06, 0.6]} frustumCulled={false}>
        <sphereGeometry args={[1, 14, 8]} />
        <meshStandardMaterial color="#d9eaec" roughness={0.6} />
      </mesh>
      {([leftWing, rightWing] as const).map((ref, i) => (
        <group key={i} ref={ref} position={[0, 0, i === 0 ? 0.5 : -0.5]}>
          <mesh geometry={wingGeo} castShadow frustumCulled={false}>
            <meshStandardMaterial color="#5c8398" roughness={0.6} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
      <mesh geometry={tailGeo} frustumCulled={false}>
        <meshStandardMaterial color="#3c5f73" roughness={0.7} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[0.78, 0.14, side * 0.32]} frustumCulled={false}>
          <sphereGeometry args={[0.07, 8, 6]} />
          <meshStandardMaterial color="#0b1c24" />
        </mesh>
      ))}
    </group>
  )
}

/* -------------------------------------------------------------------------- */
/*                                ÁGUAS-VIVAS                                */
/* -------------------------------------------------------------------------- */

/** Águas-vivas translúcidas com sino pulsante e tentáculos (instanciadas). */
function Jellyfish({ sceneRef, onSelect }: CreatureProps) {
  const bellRef = useRef<THREE.InstancedMesh>(null)
  const tentacleRef = useRef<THREE.InstancedMesh>(null)
  const COUNT = 10
  const TENTACLES = 6

  const state = useMemo(() => {
    const rng = mulberry32(616)
    return Array.from({ length: COUNT }, () => ({
      center: new THREE.Vector3(range(rng, -24, 24), range(rng, -1, 7), range(rng, -24, 24)),
      phase: rng() * TAU,
      speed: range(rng, 0.22, 0.42),
      size: range(rng, 0.55, 1.15),
    }))
  }, [])

  const bellGeo = useDisposable(
    () => new THREE.SphereGeometry(0.55, 12, 8, 0, TAU, 0, Math.PI / 2)
  )
  const tentacleGeo = useDisposable(() => new THREE.CylinderGeometry(0.012, 0.025, 1.6, 5))
  useEffect(
    () => () => {
      bellGeo.dispose()
      tentacleGeo.dispose()
    },
    [bellGeo, tentacleGeo]
  )

  const runtime = useMemo<SceneRuntime['fish']>(
    () =>
      state.map(
        (_, i) =>
          ({
            id: `jelly-${i}`,
            species: 'turtle' as const,
            position: new THREE.Vector3(),
            size: state[i].size,
            color: '#c9a7ff',
          }) satisfies SceneRuntime['fish'][number]
      ),
    [state]
  )

  useEffect(() => {
    sceneRef.current.fish.push(...runtime)
    return () => {
      const ids = new Set(runtime.map((item) => item.id))
      sceneRef.current.fish = sceneRef.current.fish.filter((fish) => !ids.has(fish.id))
    }
  }, [runtime, sceneRef])

  useLayoutEffect(() => {
    if (!tentacleRef.current) return
    const tint = new THREE.Color('#d9c2ff')
    for (let i = 0; i < COUNT * TENTACLES; i++) tentacleRef.current.setColorAt(i, tint)
    if (tentacleRef.current.instanceColor) tentacleRef.current.instanceColor.needsUpdate = true
  }, [])

  useFrame((threeState, rawDelta) => {
    const dt = safeDelta(rawDelta)
    const t = threeState.clock.elapsedTime
    if (!bellRef.current || !tentacleRef.current) return

    for (let i = 0; i < COUNT; i++) {
      const jelly = state[i]
      if (!isFiniteVector(jelly.center)) jelly.center.set(0, 2, 0)
      jelly.center.y += jelly.speed * dt
      if (jelly.center.y > 9) jelly.center.y = -3.5
      const pulse = 1 + Math.sin(t * 2.2 + jelly.phase) * 0.14
      const x = jelly.center.x + Math.sin(t * 0.4 + jelly.phase) * 0.5
      const y = jelly.center.y
      const z = jelly.center.z + Math.cos(t * 0.35 + jelly.phase) * 0.5

      dummy.position.set(x, y, z)
      dummy.rotation.set(0, jelly.phase, 0)
      dummy.scale.set(jelly.size * pulse, jelly.size / pulse, jelly.size * pulse)
      dummy.updateMatrix()
      if (dummy.matrix.elements.every(Number.isFinite)) bellRef.current.setMatrixAt(i, dummy.matrix)
      runtime[i].position.set(x, y, z)

      for (let j = 0; j < TENTACLES; j++) {
        const a = (j / TENTACLES) * TAU + jelly.phase
        dummy.position.set(
          x + Math.cos(a) * 0.32 * jelly.size,
          y - 0.95 * jelly.size,
          z + Math.sin(a) * 0.32 * jelly.size
        )
        dummy.rotation.set(Math.sin(t * 2 + a) * 0.12, 0, Math.cos(t * 1.7 + a) * 0.12)
        dummy.scale.set(jelly.size, jelly.size * (0.9 + Math.sin(t * 2.2 + jelly.phase) * 0.1), jelly.size)
        dummy.updateMatrix()
        if (dummy.matrix.elements.every(Number.isFinite)) {
          tentacleRef.current.setMatrixAt(i * TENTACLES + j, dummy.matrix)
        }
      }
    }
    bellRef.current.instanceMatrix.needsUpdate = true
    tentacleRef.current.instanceMatrix.needsUpdate = true
  })

  return (
    <group
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation()
        if (event.instanceId !== undefined) onSelect(runtime[event.instanceId].id)
      }}
    >
      <instancedMesh ref={bellRef} args={[bellGeo, undefined, COUNT]} frustumCulled={false}>
        <meshStandardMaterial
          color="#cfa9ff"
          emissive="#6f3fb0"
          emissiveIntensity={0.35}
          transparent
          opacity={0.62}
          roughness={0.25}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
      <instancedMesh ref={tentacleRef} args={[tentacleGeo, undefined, COUNT * TENTACLES]} frustumCulled={false}>
        <meshBasicMaterial color="#e0ccff" transparent opacity={0.45} depthWrite={false} />
      </instancedMesh>
    </group>
  )
}

/* -------------------------------------------------------------------------- */
/*                       ESTRELAS DO MAR E CONCHAS                            */
/* -------------------------------------------------------------------------- */

/** Estrela-do-mar com cinco braços esculpidos em uma única malha orgânica. */
function createStarfishGeometry() {
  const geo = new THREE.SphereGeometry(0.5, 24, 8)
  const pos = geo.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const a = Math.atan2(z, x)
    const arm = 0.55 + 0.75 * Math.pow(Math.max(0, Math.cos(a * 5)), 4)
    const wobble = 1 + Math.sin(a * 10) * 0.03
    pos.setXYZ(i, x * arm * wobble, y * 0.24, z * arm * wobble)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  geo.computeBoundingBox()
  geo.computeBoundingSphere()
  return geo
}

/** Concha em perfil de lathe: espiral orgânica em vez de cone primitivo. */
function createShellGeometry() {
  const points = [
    new THREE.Vector2(0.02, 0),
    new THREE.Vector2(0.1, 0.06),
    new THREE.Vector2(0.2, 0.16),
    new THREE.Vector2(0.26, 0.3),
    new THREE.Vector2(0.24, 0.42),
    new THREE.Vector2(0.16, 0.5),
    new THREE.Vector2(0.05, 0.54),
  ]
  const geo = new THREE.LatheGeometry(points, 12)
  geo.rotateZ(0.28)
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}

/** Estrelas e conchas assentadas exatamente no relevo do assoalho. */
function BottomFauna() {
  const stars = useRef<THREE.InstancedMesh>(null)
  const shells = useRef<THREE.InstancedMesh>(null)
  const starGeo = useDisposable(createStarfishGeometry)
  const shellGeo = useDisposable(createShellGeometry)

  const placements = useMemo(() => {
    const rng = mulberry32(404)
    const star = Array.from({ length: 18 }, () => ({
      x: range(rng, -30, 30),
      z: range(rng, -30, 30),
      rot: rng() * TAU,
      scale: range(rng, 0.7, 1.5),
    }))
    const shell = Array.from({ length: 44 }, () => ({
      x: range(rng, -34, 34),
      z: range(rng, -34, 34),
      rot: rng() * TAU,
      scale: range(rng, 0.5, 1.1),
    }))
    return { star, shell }
  }, [])

  const normal = useMemo(() => new THREE.Vector3(), [])

  useLayoutEffect(() => {
    if (!stars.current || !shells.current) return
    const color = new THREE.Color()
    placements.star.forEach((item, i) => {
      terrainNormal(item.x, item.z, normal)
      dummy.position.set(item.x, groundY(item.x, item.z) + 0.06, item.z)
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal)
      dummy.rotateY(item.rot)
      dummy.scale.setScalar(item.scale)
      dummy.updateMatrix()
      stars.current!.setMatrixAt(i, dummy.matrix)
      color.setHSL(0.03 + (i % 5) * 0.01, 0.55, 0.58)
      stars.current!.setColorAt(i, color)
    })
    placements.shell.forEach((item, i) => {
      terrainNormal(item.x, item.z, normal)
      dummy.position.set(item.x, groundY(item.x, item.z) - 0.03, item.z)
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal)
      dummy.rotateY(item.rot)
      dummy.scale.setScalar(item.scale)
      dummy.updateMatrix()
      shells.current!.setMatrixAt(i, dummy.matrix)
      color.setHSL(0.09 + (i % 4) * 0.02, 0.6, 0.75)
      shells.current!.setColorAt(i, color)
    })
    for (const mesh of [stars.current, shells.current]) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }, [placements, normal])

  return (
    <group>
      <instancedMesh ref={stars} args={[starGeo, undefined, placements.star.length]} receiveShadow frustumCulled={false}>
        <meshStandardMaterial color="#ffffff" roughness={0.85} />
      </instancedMesh>
      <instancedMesh ref={shells} args={[shellGeo, undefined, placements.shell.length]} receiveShadow frustumCulled={false}>
        <meshStandardMaterial color="#ffffff" roughness={0.6} metalness={0.08} side={THREE.DoubleSide} />
      </instancedMesh>
    </group>
  )
}

/** Todas as criaturas adicionais da cena. */
export function SeaCreatures({ sceneRef, onSelect }: CreatureProps) {
  return (
    <group>
      {[0, 1, 2].map((index) => (
        <Dolphin key={`dolphin-${index}`} index={index} sceneRef={sceneRef} onSelect={onSelect} />
      ))}
      {[0, 1].map((index) => (
        <MantaRay key={`ray-${index}`} index={index} sceneRef={sceneRef} onSelect={onSelect} />
      ))}
      <Jellyfish sceneRef={sceneRef} onSelect={onSelect} />
      <Crabs sceneRef={sceneRef} onSelect={onSelect} />
      <Shrimp sceneRef={sceneRef} />
      <BottomFauna />
    </group>
  )
}
