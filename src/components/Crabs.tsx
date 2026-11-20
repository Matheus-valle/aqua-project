import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { type ThreeEvent, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mulberry32, range } from '../scene/random'
import { createCrabParts } from '../scene/organic'
import { getTerrainHeight, SEABED_Y, terrainNormal } from '../scene/terrain'
import {
  REEF_CLUSTERS,
  RUIN_SITES,
  separateFromStructures,
  steerGroundAroundStructures,
} from '../scene/obstacles'
import type { SceneRuntime } from '../scene/types'

const AXIS_X = new THREE.Vector3(1, 0, 0)
const UP = new THREE.Vector3(0, 1, 0)

/** Altura real da malha do terreno em coordenadas de mundo. */
const floorAt = (x: number, z: number) => SEABED_Y + getTerrainHeight(x, z)
/** Offset positivo proporcional à altura das patas: carapaça nunca enterra. */
const LEG_CLEARANCE = 0.16
/** Inclinação máxima (≈18°) para não capotar em dunas íngremes. */
const MAX_TILT = 0.32
const ORIENT_DAMP = 5.5

function safeDelta(value: number) {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 0.05) : 1 / 60
}

function isFiniteVector(v: THREE.Vector3) {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)
}

interface CrabState {
  cx: number
  cz: number
  radius: number
  angle: number
  speed: number
  scale: number
  phase: number
  x: number
  z: number
  vx: number
  vz: number
  moving: boolean
  timer: number
  ease: number
  heading: number
  /** Orientação persistente: slerp suave em direção à normal do terreno. */
  orientation: THREE.Quaternion
}

interface CrabsProps {
  sceneRef: React.RefObject<SceneRuntime>
  onSelect: (id: string) => void
}

/**
 * Caranguejos com carapaça esculpida, 8 patas bi-articuladas, pinças que
 * abrem/fecham e olhos pedunculados. Caminham de lado, pausam, desviam das
 * ruínas e se apoiam exatamente na altura/normal do terreno a cada frame.
 */
export function Crabs({ sceneRef, onSelect }: CrabsProps) {
  const carapaceRef = useRef<THREE.InstancedMesh>(null)
  const upperRef = useRef<THREE.InstancedMesh>(null)
  const lowerRef = useRef<THREE.InstancedMesh>(null)
  const palmRef = useRef<THREE.InstancedMesh>(null)
  const fingerRef = useRef<THREE.InstancedMesh>(null)
  const stalkRef = useRef<THREE.InstancedMesh>(null)
  const eyeRef = useRef<THREE.InstancedMesh>(null)

  const parts = useMemo(createCrabParts, [])
  useEffect(
    () => () => Object.values(parts).forEach((geometry) => geometry.dispose()),
    [parts]
  )

  const shellMaterial = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.52,
      metalness: 0.06,
    })
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = `varying vec3 vShellPos;
varying vec3 vShellNormal;
varying vec3 vShellView;
${shader.vertexShader}`
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
            vShellPos = transformed;
          `
        )
        .replace(
          '#include <project_vertex>',
          /* glsl */ `#include <project_vertex>
            vShellNormal = normalize(normalMatrix * normal);
            vShellView = normalize(-mvPosition.xyz);
          `
        )
      shader.fragmentShader = `varying vec3 vShellPos;
varying vec3 vShellNormal;
varying vec3 vShellView;
${shader.fragmentShader}`.replace(
        '#include <dithering_fragment>',
        /* glsl */ `
          float mottle = sin(vShellPos.x * 21.0 + sin(vShellPos.z * 16.0) * 1.7) * sin(vShellPos.z * 19.0);
          gl_FragColor.rgb *= 1.0 + mottle * 0.075;
          float rim = pow(1.0 - clamp(dot(normalize(vShellNormal), normalize(vShellView)), 0.0, 1.0), 2.5);
          gl_FragColor.rgb += vec3(0.5, 0.85, 0.95) * rim * 0.22;
          #include <dithering_fragment>
        `
      )
    }
    mat.customProgramCacheKey = () => 'crab-shell-mottle'
    return mat
  }, [])
  useEffect(() => () => shellMaterial.dispose(), [shellMaterial])

  const crabs = useMemo<CrabState[]>(() => {
    const rng = mulberry32(404)
    const sites = [
      ...RUIN_SITES.map((s) => ({ x: s.x + 5, z: s.z + 3 })),
      ...REEF_CLUSTERS.slice(0, 5).map((s) => ({ x: s.x - 3, z: s.z + 2 })),
    ]
    return sites.map((site) => {
      const angle = rng() * Math.PI * 2
      const radius = range(rng, 1.6, 3.4)
      const scale = range(rng, 0.85, 1.25)
      return {
        cx: site.x,
        cz: site.z,
        radius,
        angle,
        speed: range(rng, 0.32, 0.62) * (rng() > 0.5 ? 1 : -1),
        scale,
        phase: rng() * Math.PI * 2,
        x: site.x + Math.cos(angle) * radius,
        z: site.z + Math.sin(angle) * radius,
        vx: 0,
        vz: 0,
        moving: true,
        timer: range(rng, 1.4, 3.6),
        ease: 1,
        heading: -angle + Math.PI / 2,
        orientation: new THREE.Quaternion(),
      }
    })
  }, [])

  const runtime = useMemo<SceneRuntime['fish']>(
    () =>
      crabs.map((_, i) => ({
        id: `crab-${i}`,
        species: 'crab' as const,
        position: new THREE.Vector3(),
        size: 0.9,
        color: '#e4603c',
      })),
    [crabs]
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
    if (!carapaceRef.current || !palmRef.current || !eyeRef.current) return
    crabs.forEach((_, i) => {
      color.setHSL(0.025 + (i % 3) * 0.009, 0.66, 0.5 + (i % 2) * 0.06)
      carapaceRef.current!.setColorAt(i, color)
      color.offsetHSL(0, 0.04, -0.06)
      palmRef.current!.setColorAt(i * 2, color)
      palmRef.current!.setColorAt(i * 2 + 1, color)
      eyeRef.current!.setColorAt(i * 2, color.set('#0b1418'))
      eyeRef.current!.setColorAt(i * 2 + 1, color)
    })
    for (const mesh of [carapaceRef.current, palmRef.current, eyeRef.current]) {
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }, [crabs, color])

  const scratch = useMemo(
    () => ({
      root: new THREE.Object3D(),
      part: new THREE.Object3D(),
      matrix: new THREE.Matrix4(),
      normal: new THREE.Vector3(),
      steer: new THREE.Vector3(),
      probe: new THREE.Vector3(),
      pos: new THREE.Vector3(),
      from: new THREE.Vector3(),
      knee: new THREE.Vector3(),
      foot: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      tiltNormal: new THREE.Vector3(),
      target: new THREE.Vector3(),
      inverse: new THREE.Matrix4(),
      tiltQuat: new THREE.Quaternion(),
      yawQuat: new THREE.Quaternion(),
      targetQuat: new THREE.Quaternion(),
    }),
    []
  )
  const rng = useMemo(() => mulberry32(997), [])

  useFrame((state, rawDelta) => {
    const carapace = carapaceRef.current
    const upper = upperRef.current
    const lower = lowerRef.current
    const palm = palmRef.current
    const finger = fingerRef.current
    const stalk = stalkRef.current
    const eyes = eyeRef.current
    if (!carapace || !upper || !lower || !palm || !finger || !stalk || !eyes) return

    const dt = safeDelta(rawDelta)
    const t = state.clock.elapsedTime
    const {
      root, part, matrix, normal, steer, probe, pos, from, knee, foot, dir,
      tiltNormal, target, inverse, tiltQuat, yawQuat, targetQuat,
    } = scratch

    const placeSegment = (
      mesh: THREE.InstancedMesh,
      index: number,
      a: THREE.Vector3,
      b: THREE.Vector3
    ) => {
      dir.subVectors(b, a)
      const len = dir.length()
      if (len < 0.0001 || !Number.isFinite(len)) return
      part.position.copy(a)
      part.quaternion.setFromUnitVectors(AXIS_X, dir.multiplyScalar(1 / len))
      part.scale.set(len, 1, 1)
      part.updateMatrix()
      matrix.multiplyMatrices(root.matrix, part.matrix)
      if (matrix.elements.every(Number.isFinite)) mesh.setMatrixAt(index, matrix)
    }

    const placePart = (
      mesh: THREE.InstancedMesh,
      index: number,
      x: number,
      y: number,
      z: number,
      rx: number,
      ry: number,
      rz: number
    ) => {
      part.position.set(x, y, z)
      part.rotation.set(rx, ry, rz)
      part.scale.setScalar(1)
      part.updateMatrix()
      matrix.multiplyMatrices(root.matrix, part.matrix)
      if (matrix.elements.every(Number.isFinite)) mesh.setMatrixAt(index, matrix)
    }

    crabs.forEach((c, i) => {
      c.timer -= dt
      if (c.timer <= 0) {
        c.moving = !c.moving
        c.timer = c.moving ? range(rng, 1.4, 3.6) : range(rng, 0.5, 1.6)
      }
      c.ease = THREE.MathUtils.damp(c.ease, c.moving ? 1 : 0, 5, dt)
      c.angle += c.speed * c.ease * dt

      pos.set(c.x, floorAt(c.x, c.z) + 0.3, c.z)
      steer.set(c.cx + Math.cos(c.angle) * c.radius - c.x, 0, c.cz + Math.sin(c.angle) * c.radius - c.z)
      const dist = Math.hypot(steer.x, steer.z)
      if (dist > 0.0001) {
        steer.x /= dist
        steer.z /= dist
      }
      steerGroundAroundStructures(pos, steer, 0.95 * c.scale, 4.4)
      if (!isFiniteVector(steer)) steer.set(0, 0, 0)
      c.vx = THREE.MathUtils.clamp(c.vx + steer.x * dt, -0.9 * c.scale, 0.9 * c.scale)
      c.vz = THREE.MathUtils.clamp(c.vz + steer.z * dt, -0.9 * c.scale, 0.9 * c.scale)
      const speed = Math.hypot(c.vx, c.vz)
      if (speed > 0.85 * c.scale) {
        c.vx *= (0.85 * c.scale) / speed
        c.vz *= (0.85 * c.scale) / speed
      }
      c.x = THREE.MathUtils.clamp(c.x + c.vx * dt, -34, 34)
      c.z = THREE.MathUtils.clamp(c.z + c.vz * dt, -34, 34)

      // Correção dura: nunca atravessa pedestal, rochas ou bases de coral.
      pos.set(c.x, floorAt(c.x, c.z) + LEG_CLEARANCE, c.z)
      separateFromStructures(pos, 0.95 * c.scale)
      c.x = THREE.MathUtils.clamp(pos.x, -34, 34)
      c.z = THREE.MathUtils.clamp(pos.z, -34, 34)
      if (!Number.isFinite(c.x) || !Number.isFinite(c.z)) {
        c.x = c.cx
        c.z = c.cz
        c.vx = 0
        c.vz = 0
      }
      if (Math.hypot(c.vx, c.vz) > 0.05) {
        // Frente do corpo perpendicular à velocidade: caminhada lateral natural.
        const heading = Math.atan2(-c.vz, c.vx) + Math.PI / 2
        if (Number.isFinite(heading)) c.heading = heading
      }

      // Y travado no relevo: offset positivo conforme a altura das patas.
      const floor = floorAt(c.x, c.z) + LEG_CLEARANCE
      runtime[i].position.set(c.x, floor + 0.14, c.z)

      terrainNormal(c.x, c.z, normal)
      if (!isFiniteVector(normal)) normal.copy(UP)
      // Limita a inclinação antes de interpolar: sem capotagens em dunas íngremes.
      const cosine = THREE.MathUtils.clamp(normal.dot(UP), -1, 1)
      const tiltAngle = Math.acos(cosine)
      if (tiltAngle > MAX_TILT && tiltAngle > 0.0001) {
        tiltNormal.copy(normal)
        normal.copy(UP).lerp(tiltNormal, Math.min(1, MAX_TILT / tiltAngle)).normalize()
      }
      tiltQuat.setFromUnitVectors(UP, normal)
      yawQuat.setFromAxisAngle(UP, c.heading)
      targetQuat.copy(tiltQuat).multiply(yawQuat)
      c.orientation.slerp(targetQuat, 1 - Math.exp(-ORIENT_DAMP * dt))
      root.quaternion.copy(c.orientation)
      root.position.set(c.x, floor, c.z)
      root.scale.setScalar(c.scale)
      root.updateMatrix()

      placePart(carapace, i, 0, 0, 0, 0, 0, 0)

      for (let k = 0; k < 8; k++) {
        const side = k < 4 ? 1 : -1
        const j = k % 4
        const gait = Math.sin(t * 7 * c.ease + c.phase + (side > 0 ? 0 : Math.PI) + j * 0.95)
        const lift = Math.max(0, gait) * 0.11
        from.set(0.34 - j * 0.24, 0.21, side * 0.3)
        dir.set(0.35 + j * 0.12, 0, side).normalize()
        knee.copy(from).addScaledVector(dir, 0.34)
        knee.y += 0.05 + lift * 0.5
        foot.copy(knee).addScaledVector(dir, 0.32)
        foot.y -= 0.25 - lift

        // A ponta do pé toca exatamente a malha do terreno, mesmo com a raiz
        // inclinada: converte o alvo mundial de volta para o espaço local.
        probe.copy(foot).applyMatrix4(root.matrix)
        target.set(probe.x, floorAt(probe.x, probe.z) + 0.03, probe.z)
        inverse.copy(root.matrix).invert()
        const det = inverse.determinant()
        if (Number.isFinite(det) && Math.abs(det) > 0.000001 && isFiniteVector(target)) {
          foot.copy(target.applyMatrix4(inverse))
        }

        placeSegment(upper, i * 8 + k, from, knee)
        placeSegment(lower, i * 8 + k, knee, foot)
      }

      for (let s = 0; s < 2; s++) {
        const side = s === 0 ? 1 : -1
        const wave = Math.sin(t * 1.5 + c.phase + s * 1.3)
        const open = Math.max(0, Math.sin(t * 2.8 + c.phase + s * 0.7)) * 0.5
        const cy = 0.16 + wave * 0.02
        const cz = side * 0.36
        placePart(palm, i * 2 + s, 0.5, cy, cz, 0, side * 0.32, wave * 0.12)
        placePart(finger, i * 2 + s, 0.58, cy, cz, 0, side * 0.32 - open, wave * 0.12)
        placePart(stalk, i * 2 + s, 0.44, 0.3, side * 0.14, 0, 0, -0.18 + wave * 0.06)
        placePart(eyes, i * 2 + s, 0.44, 0.3, side * 0.14, 0, 0, -0.18 + wave * 0.06)
      }
    })

    for (const mesh of [carapace, upper, lower, palm, finger, stalk, eyes]) {
      mesh.instanceMatrix.needsUpdate = true
    }
  })

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    if (event.instanceId !== undefined) onSelect(runtime[event.instanceId].id)
  }

  return (
    <group>
      <instancedMesh
        ref={carapaceRef}
        args={[parts.carapace, shellMaterial, crabs.length]}
        onClick={handleClick}
        onPointerOver={() => (document.body.style.cursor = 'pointer')}
        onPointerOut={() => (document.body.style.cursor = 'auto')}
        castShadow
        receiveShadow
        frustumCulled={false}
      />
      <instancedMesh ref={upperRef} args={[parts.legUpper, undefined, crabs.length * 8]} castShadow frustumCulled={false}>
        <meshStandardMaterial color="#a83d28" roughness={0.72} />
      </instancedMesh>
      <instancedMesh ref={lowerRef} args={[parts.legLower, undefined, crabs.length * 8]} castShadow frustumCulled={false}>
        <meshStandardMaterial color="#8e3323" roughness={0.75} />
      </instancedMesh>
      <instancedMesh ref={palmRef} args={[parts.clawPalm, undefined, crabs.length * 2]} castShadow frustumCulled={false}>
        <meshStandardMaterial color="#ffffff" roughness={0.5} metalness={0.05} />
      </instancedMesh>
      <instancedMesh ref={fingerRef} args={[parts.clawFinger, undefined, crabs.length * 2]} castShadow frustumCulled={false}>
        <meshStandardMaterial color="#d85538" roughness={0.55} />
      </instancedMesh>
      <instancedMesh ref={stalkRef} args={[parts.eyeStalk, undefined, crabs.length * 2]} frustumCulled={false}>
        <meshStandardMaterial color="#c95335" roughness={0.7} />
      </instancedMesh>
      <instancedMesh ref={eyeRef} args={[parts.eyeBall, undefined, crabs.length * 2]} frustumCulled={false}>
        <meshStandardMaterial color="#ffffff" roughness={0.18} metalness={0.1} />
      </instancedMesh>
    </group>
  )
}
