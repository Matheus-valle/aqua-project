import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mulberry32, range } from '../scene/random'
import {
  createAntennaGeometry,
  createShrimpSegment,
  createSwimmeretGeometry,
} from '../scene/organic'
import { getTerrainHeight, SEABED_Y, terrainNormal } from '../scene/terrain'
import {
  REEF_CLUSTERS,
  separateFromStructures,
  steerGroundAroundStructures,
} from '../scene/obstacles'
import type { SceneRuntime } from '../scene/types'

const UP = new THREE.Vector3(0, 1, 0)
const SEGMENTS = 7
const SWIMMERETS = 4

/** Altura real da malha do terreno em coordenadas de mundo. */
const floorAt = (x: number, z: number) => SEABED_Y + getTerrainHeight(x, z)
/** Margens que impedem afundar no relevo ou subir na coluna d'água. */
const MIN_CLEARANCE = 0.32
const MAX_CLEARANCE = 1.1
const MAX_TILT = 0.28
const ORIENT_DAMP = 4.5

function safeDelta(value: number) {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 0.05) : 1 / 60
}

function isFiniteVector(v: THREE.Vector3) {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)
}

interface ShrimpState {
  cx: number
  cz: number
  radius: number
  angle: number
  speed: number
  scale: number
  phase: number
  x: number
  z: number
  y: number
  vx: number
  vz: number
  pulse: number
  timer: number
  heading: number
  /** Orientação persistente suavizada contra a normal do terreno. */
  orientation: THREE.Quaternion
}

interface ShrimpProps {
  sceneRef: React.RefObject<SceneRuntime>
}

/** Camarões-limpadores: corpo segmentado translúcido, antenas e nado em impulsos. */
export function Shrimp({ sceneRef }: ShrimpProps) {
  const bodyRef = useRef<THREE.InstancedMesh>(null)
  const antennaRef = useRef<THREE.InstancedMesh>(null)
  const legRef = useRef<THREE.InstancedMesh>(null)

  const segmentGeo = useMemo(createShrimpSegment, [])
  const antennaGeo = useMemo(createAntennaGeometry, [])
  const swimmeretGeo = useMemo(createSwimmeretGeometry, [])
  useEffect(
    () => () => {
      segmentGeo.dispose()
      antennaGeo.dispose()
      swimmeretGeo.dispose()
    },
    [segmentGeo, antennaGeo, swimmeretGeo]
  )

  const bodyMaterial = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.3,
      metalness: 0.04,
      transparent: true,
      opacity: 0.86,
      emissive: '#5fd8d0',
      emissiveIntensity: 0.12,
      depthWrite: false,
    })
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = `varying vec3 vShrimpPos;
varying vec3 vShrimpNormal;
varying vec3 vShrimpView;
${shader.vertexShader}`
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
            vShrimpPos = transformed;
          `
        )
        .replace(
          '#include <project_vertex>',
          /* glsl */ `#include <project_vertex>
            vShrimpNormal = normalize(normalMatrix * normal);
            vShrimpView = normalize(-mvPosition.xyz);
          `
        )
      shader.fragmentShader = `varying vec3 vShrimpPos;
varying vec3 vShrimpNormal;
varying vec3 vShrimpView;
${shader.fragmentShader}`.replace(
        '#include <dithering_fragment>',
        /* glsl */ `
          float stripe = smoothstep(0.42, 0.62, sin(vShrimpPos.x * 46.0) * 0.5 + 0.5);
          gl_FragColor.rgb *= mix(0.82, 1.18, stripe);
          float rim = pow(1.0 - clamp(dot(normalize(vShrimpNormal), normalize(vShrimpView)), 0.0, 1.0), 2.2);
          gl_FragColor.rgb += vec3(0.42, 0.92, 1.0) * rim * 0.35;
          #include <dithering_fragment>
        `
      )
    }
    mat.customProgramCacheKey = () => 'shrimp-stripes-rim'
    return mat
  }, [])
  useEffect(() => () => bodyMaterial.dispose(), [bodyMaterial])

  const shrimp = useMemo<ShrimpState[]>(() => {
    const rng = mulberry32(1313)
    return REEF_CLUSTERS.slice(0, 7).map((site, i) => {
      const angle = rng() * Math.PI * 2
      const radius = range(rng, 2, 5)
      const scale = range(rng, 0.7, 1.15)
      return {
        cx: site.x + range(rng, -2, 2),
        cz: site.z + range(rng, -2, 2),
        radius,
        angle,
        speed: range(rng, 0.25, 0.48) * (i % 2 ? -1 : 1),
        scale,
        phase: rng() * Math.PI * 2,
        x: site.x + Math.cos(angle) * radius,
        z: site.z + Math.sin(angle) * radius,
        y: 0,
        vx: 0,
        vz: 0,
        pulse: 0,
        timer: range(rng, 0.4, 2.4),
        heading: -angle,
        orientation: new THREE.Quaternion(),
      }
    })
  }, [])

  const runtime = useMemo<SceneRuntime['fish']>(
    () =>
      shrimp.map((_, i) => ({
        id: `shrimp-${i}`,
        species: 'shrimp' as const,
        position: new THREE.Vector3(),
        size: 0.6,
        color: '#ff9b6b',
      })),
    [shrimp]
  )

  useEffect(() => {
    sceneRef.current.fish.push(...runtime)
    return () => {
      const ids = new Set(runtime.map((item) => item.id))
      sceneRef.current.fish = sceneRef.current.fish.filter((item) => !ids.has(item.id))
    }
  }, [runtime, sceneRef])

  const color = useMemo(() => new THREE.Color(), [])
  useLayoutEffect(() => {
    if (!bodyRef.current) return
    const palette = ['#ffffff', '#ff8d5e', '#ffe0b8', '#6fe4dc', '#ffffff', '#ff7a52', '#f5d76e']
    shrimp.forEach((_, s) => {
      for (let seg = 0; seg < SEGMENTS; seg++) {
        const base = new THREE.Color(palette[(seg + s) % palette.length])
        bodyRef.current!.setColorAt(s * SEGMENTS + seg, base)
      }
    })
    if (bodyRef.current.instanceColor) bodyRef.current.instanceColor.needsUpdate = true
  }, [shrimp, color])

  const scratch = useMemo(
    () => ({
      root: new THREE.Object3D(),
      part: new THREE.Object3D(),
      matrix: new THREE.Matrix4(),
      normal: new THREE.Vector3(),
      tiltNormal: new THREE.Vector3(),
      steer: new THREE.Vector3(),
      pos: new THREE.Vector3(),
      tiltQuat: new THREE.Quaternion(),
      yawQuat: new THREE.Quaternion(),
      targetQuat: new THREE.Quaternion(),
    }),
    []
  )
  const rng = useMemo(() => mulberry32(271), [])

  useFrame((state, rawDelta) => {
    if (!bodyRef.current || !antennaRef.current || !legRef.current) return
    const dt = safeDelta(rawDelta)
    const t = state.clock.elapsedTime
    const { root, part, matrix, normal, tiltNormal, steer, pos, tiltQuat, yawQuat, targetQuat } =
      scratch

    shrimp.forEach((s, i) => {
      s.timer -= dt
      if (s.timer <= 0) {
        s.timer = range(rng, 1.1, 2.7)
        s.pulse = 1
      }
      s.pulse = Math.max(0, s.pulse - dt * 1.6)
      s.angle += s.speed * dt * (0.5 + s.pulse * 1.4)

      pos.set(s.x, floorAt(s.x, s.z) + 0.8, s.z)
      steer.set(
        s.cx + Math.cos(s.angle) * s.radius - s.x,
        0,
        s.cz + Math.sin(s.angle) * s.radius - s.z
      )
      const dist = Math.hypot(steer.x, steer.z)
      if (dist > 0.0001) {
        steer.x /= dist
        steer.z /= dist
      }
      steerGroundAroundStructures(pos, steer, 0.6 * s.scale, 3.8)
      if (!isFiniteVector(steer)) steer.set(0, 0, 0)
      const thrust = 0.5 + s.pulse * 2.4
      s.vx = THREE.MathUtils.clamp(s.vx + steer.x * thrust * dt, -1.4, 1.4)
      s.vz = THREE.MathUtils.clamp(s.vz + steer.z * thrust * dt, -1.4, 1.4)
      s.x = THREE.MathUtils.clamp(s.x + s.vx * dt, -36, 36)
      s.z = THREE.MathUtils.clamp(s.z + s.vz * dt, -36, 36)

      // Repulsão suave + correção dura contra pedestal, rochas e corais.
      pos.set(s.x, floorAt(s.x, s.z) + 0.5, s.z)
      separateFromStructures(pos, 0.6 * s.scale)
      s.x = THREE.MathUtils.clamp(pos.x, -36, 36)
      s.z = THREE.MathUtils.clamp(pos.z, -36, 36)
      if (!Number.isFinite(s.x) || !Number.isFinite(s.z)) {
        s.x = s.cx
        s.z = s.cz
        s.vx = 0
        s.vz = 0
      }
      const speed = Math.hypot(s.vx, s.vz)
      if (speed > 0.05) {
        const heading = Math.atan2(-s.vz, s.vx)
        if (Number.isFinite(heading)) s.heading = heading
      }

      // Y preso ao relevo: nunca afunda nem sobe pela coluna d'água.
      const floor = floorAt(s.x, s.z)
      const targetY = THREE.MathUtils.clamp(
        floor + 0.5 + Math.sin(t * 2.4 + s.phase) * 0.12 + s.pulse * 0.16,
        floor + MIN_CLEARANCE,
        floor + MAX_CLEARANCE
      )
      s.y = Number.isFinite(s.y) && s.y !== 0 ? THREE.MathUtils.damp(s.y, targetY, 6, dt) : targetY
      if (!Number.isFinite(s.y)) s.y = targetY
      runtime[i].position.set(s.x, s.y, s.z)

      terrainNormal(s.x, s.z, normal)
      if (!isFiniteVector(normal)) normal.copy(UP)
      const cosine = THREE.MathUtils.clamp(normal.dot(UP), -1, 1)
      const tiltAngle = Math.acos(cosine)
      if (tiltAngle > MAX_TILT && tiltAngle > 0.0001) {
        tiltNormal.copy(normal)
        normal.copy(UP).lerp(tiltNormal, Math.min(1, MAX_TILT / tiltAngle)).normalize()
      }
      tiltQuat.setFromUnitVectors(UP, normal)
      yawQuat.setFromAxisAngle(UP, s.heading)
      targetQuat.copy(tiltQuat).multiply(yawQuat)
      s.orientation.slerp(targetQuat, 1 - Math.exp(-ORIENT_DAMP * dt))
      root.position.set(s.x, s.y, s.z)
      root.quaternion.copy(s.orientation)
      root.scale.setScalar(s.scale * (1 - speed * 0.04))
      root.updateMatrix()

      for (let seg = 0; seg < SEGMENTS; seg++) {
        const wave = Math.sin(t * (6 + s.pulse * 5) + s.phase - seg * 0.62) * 0.04 * seg
        part.position.set(0.34 - seg * 0.15, wave, 0)
        part.rotation.set(0, Math.sin(t * 4 + s.phase - seg * 0.4) * 0.05, 0)
        part.scale.setScalar(1 - seg * 0.075)
        part.updateMatrix()
        matrix.multiplyMatrices(root.matrix, part.matrix)
        if (matrix.elements.every(Number.isFinite)) bodyRef.current!.setMatrixAt(i * SEGMENTS + seg, matrix)
      }

      for (let a = 0; a < 2; a++) {
        const side = a === 0 ? 1 : -1
        part.position.set(0.42, 0.06, side * 0.06)
        part.rotation.set(
          Math.sin(t * 2.2 + s.phase + a) * 0.16,
          side * (0.22 + Math.sin(t * 1.5 + s.phase) * 0.18),
          -0.1 + Math.sin(t * 1.9 + s.phase + a) * 0.12
        )
        part.scale.setScalar(1)
        part.updateMatrix()
        matrix.multiplyMatrices(root.matrix, part.matrix)
        if (matrix.elements.every(Number.isFinite)) antennaRef.current!.setMatrixAt(i * 2 + a, matrix)
      }

      for (let l = 0; l < SWIMMERETS; l++) {
        part.position.set(0.16 - l * 0.16, -0.14, 0)
        part.rotation.set(0, 0, Math.sin(t * 9 + s.phase + l * 0.7) * 0.5)
        part.scale.setScalar(1)
        part.updateMatrix()
        matrix.multiplyMatrices(root.matrix, part.matrix)
        if (matrix.elements.every(Number.isFinite)) legRef.current!.setMatrixAt(i * SWIMMERETS + l, matrix)
      }
    })

    bodyRef.current.instanceMatrix.needsUpdate = true
    antennaRef.current.instanceMatrix.needsUpdate = true
    legRef.current.instanceMatrix.needsUpdate = true
  })

  return (
    <group>
      <instancedMesh
        ref={bodyRef}
        args={[segmentGeo, bodyMaterial, shrimp.length * SEGMENTS]}
        castShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={antennaRef}
        args={[antennaGeo, undefined, shrimp.length * 2]}
        frustumCulled={false}
      >
        <meshBasicMaterial color="#ffd9c0" transparent opacity={0.7} depthWrite={false} />
      </instancedMesh>
      <instancedMesh
        ref={legRef}
        args={[swimmeretGeo, undefined, shrimp.length * SWIMMERETS]}
        frustumCulled={false}
      >
        <meshStandardMaterial color="#ffb08a" roughness={0.6} transparent opacity={0.85} depthWrite={false} />
      </instancedMesh>
    </group>
  )
}
