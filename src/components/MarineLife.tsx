import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { type ThreeEvent, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mulberry32, range } from '../scene/random'
import { steerAroundStructures } from '../scene/obstacles'
import {
  applyWaterColumnSteering,
  clampToHabitat,
  SURFACE_Y,
  terrainHeight,
} from '../scene/terrain'
import {
  createFinGeometry,
  createFishGeometry,
  createSharkGeometry,
} from '../scene/organic'
import type { FishRuntime, SceneRuntime, SpeciesConfig } from '../scene/types'

const dummy = new THREE.Object3D()

/** True somente quando os tres eixos são números finitos. */
function isFiniteVector(v: THREE.Vector3) {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)
}

/** Absorve picos de delta trocando de aba e valores inválidos do relógio. */
function safeDelta(rawDelta: number) {
  return Number.isFinite(rawDelta) ? Math.min(Math.max(rawDelta, 0), 0.05) : 1 / 60
}

/** Cria um recurso Three e libera a GPU quando o componente desmonta. */
function useDisposable<T extends { dispose: () => void }>(factory: () => T): T {
  const resource = useMemo(factory, [])
  useEffect(() => () => resource.dispose(), [resource])
  return resource
}

const SPECIES: SpeciesConfig[] = [
  {
    id: 'clownfish',
    name: 'Peixe-palhaço',
    color: '#ff8a34',
    accent: '#fff6e8',
    count: 26,
    size: 0.42,
    speed: 2.2,
    home: [-14, -2.6, 8],
  },
  {
    id: 'surgeon',
    name: 'Cirurgião-patela',
    color: '#2f8fe8',
    accent: '#ffd34d',
    count: 34,
    size: 0.4,
    speed: 2.8,
    home: [8, -1.5, -6],
  },
  {
    id: 'angelfish',
    name: 'Peixe-anjo',
    color: '#ffe08a',
    accent: '#3a7fd5',
    count: 30,
    size: 0.5,
    speed: 2.0,
    home: [18, -2.8, 12],
  },
  {
    id: 'butterfly',
    name: 'Peixe-borboleta',
    color: '#ffd23f',
    accent: '#ff6b4a',
    count: 32,
    size: 0.42,
    speed: 2.5,
    home: [-6, 1.5, -14],
  },
  {
    id: 'neon',
    name: 'Neon iridescente',
    color: '#6ff2ff',
    accent: '#ffd166',
    count: 54,
    size: 0.24,
    speed: 3.2,
    home: [0, 1.2, 4],
  },
]

interface Boid {
  position: THREE.Vector3
  velocity: THREE.Vector3
  phase: number
  /** Último heading válido: evita salto/NaN quando a velocidade se anula no eixo XZ. */
  heading: number
  /** Contador de recuperação após um fail-safe; guia o retorno suave ao cardume. */
  recovery: number
}

/**Índice do padrão de pele passado ao shader por espécie. */
function patternId(id: string) {
  if (id === 'clownfish') return 1
  if (id === 'surgeon') return 2
  if (id === 'butterfly') return 3
  if (id === 'neon') return 4
  return 0
}

/** Material de peixe: ondulação progressiva, escamas, padrão da espécie e rim light. */
function createFishMaterial(
  config: SpeciesConfig,
  swimTime: { value: number },
  swimFreq: { value: number },
  swimAmp: { value: number }
) {
  const mat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    vertexColors: true,
    roughness: 0.34,
    metalness: 0.14,
    emissive: new THREE.Color(config.color).multiplyScalar(0.12),
  })
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = swimTime
    shader.uniforms.uSwimFreq = swimFreq
    shader.uniforms.uSwimAmp = swimAmp
    shader.uniforms.uPattern = { value: patternId(config.id) }
    shader.vertexShader = `attribute vec4 aFin;
uniform float uTime;
uniform float uSwimFreq;
uniform float uSwimAmp;
varying vec3 vRimNormal;
varying vec3 vRimView;
varying vec3 vCausticPos;
varying vec3 vLocalPos;
${shader.vertexShader}`
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
          float swimPhase = instanceMatrix[3].x * 0.73 + instanceMatrix[3].z * 0.41;
          float wave = uTime * uSwimFreq + swimPhase;
          float bodyAmp = aFin.y * aFin.y * uSwimAmp;

          // Onda progressiva do corpo: duas senoides suaves, sem degraus.
          float bodyWave = sin(wave - transformed.x * 2.35) * 0.24
                         + sin(wave * 0.5 - transformed.x * 1.1) * 0.06;
          transformed.z += bodyWave * bodyAmp;
          transformed.y += sin(wave * 0.62 - transformed.x * 1.3) * 0.03 * aFin.y * uSwimAmp;

          // Cada nadadeira tem fase própria: a ponta atrasa em relação à raiz.
          float finType = aFin.x;
          float tip = aFin.y;
          float lag = wave - tip * 1.45;
          float soft = sin(lag) * 0.78 + sin(lag * 0.5 + 1.1) * 0.22;
          float finAmp = uSwimAmp * (0.35 + 0.65 * tip);

          if (finType > 0.5 && finType < 1.5) {
            // Caudal: oscilação lateral ampla e contínua até a ponta.
            transformed.z += soft * 0.42 * finAmp;
            transformed.y += sin(lag * 0.7 + 0.8) * 0.08 * tip * uSwimAmp;
          } else if (finType > 1.5 && finType < 2.5) {
            // Dorsal / anal: leque lateral suave.
            transformed.z += soft * 0.14 * finAmp;
            transformed.y += sin(lag * 0.6) * 0.05 * tip * uSwimAmp;
          } else if (finType > 2.5) {
            // Peitorais: remada defasada do corpo.
            float row = sin(lag * 0.85 + 1.4) * 0.8 + sin(lag * 0.42) * 0.2;
            transformed.z += row * 0.12 * finAmp;
            transformed.y += row * 0.09 * finAmp;
          }
          vLocalPos = transformed;
        `
      )
      .replace(
        '#include <project_vertex>',
        /* glsl */ `#include <project_vertex>
          vRimNormal = normalize(normalMatrix * normal);
          vRimView = normalize(-mvPosition.xyz);
          vCausticPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        `
      )
    shader.fragmentShader = `uniform float uTime;
uniform int uPattern;
varying vec3 vRimNormal;
varying vec3 vRimView;
varying vec3 vCausticPos;
varying vec3 vLocalPos;
float band(float x, float center, float width) {
  return 1.0 - smoothstep(width, width + 0.055, abs(x - center));
}
${shader.fragmentShader}`.replace(
      '#include <dithering_fragment>',
      /* glsl */ `
        float rim = pow(1.0 - clamp(dot(normalize(vRimNormal), normalize(vRimView)), 0.0, 1.0), 2.6);
        gl_FragColor.rgb += vec3(0.38, 0.92, 1.0) * rim * 0.36;

        // Escamas sutis e reflexo úmido.
        float scales = sin(vLocalPos.x * 42.0 + sin(vLocalPos.y * 24.0) * 1.2) * sin(vLocalPos.z * 30.0);
        gl_FragColor.rgb *= 1.0 + scales * 0.035;
        float wet = pow(max(0.0, dot(normalize(vRimNormal), vec3(0.3, 0.9, 0.25))), 12.0);
        gl_FragColor.rgb += vec3(0.9, 1.0, 1.0) * wet * 0.12;

        if (uPattern == 1) {
          float white = max(band(vLocalPos.x, 0.42, 0.085), band(vLocalPos.x, -0.3, 0.07));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0, 0.96, 0.9), white * 0.88);
        } else if (uPattern == 2) {
          float tail = 1.0 - smoothstep(-0.92, -0.52, vLocalPos.x);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0, 0.81, 0.14), tail * 0.9);
        } else if (uPattern == 3) {
          float eyeBand = band(vLocalPos.x, 0.54, 0.06);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.05, 0.08, 0.14), eyeBand * 0.85);
        } else if (uPattern == 4) {
          float stripe = 1.0 - smoothstep(0.015, 0.06, abs(vLocalPos.y - 0.01));
          vec3 irid = mix(vec3(0.22, 0.85, 1.0), vec3(0.72, 0.4, 1.0), 0.5 + 0.5 * sin(vLocalPos.x * 3.0 + uTime));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, irid, stripe * 0.9);
          float tail = 1.0 - smoothstep(-1.05, -0.6, vLocalPos.x);
          gl_FragColor.rgb += vec3(0.4, 0.7, 0.5) * tail * 0.25;
        }

        vec2 cp = vCausticPos.xz * 0.42 + vec2(uTime * 0.11, -uTime * 0.08);
        float ca = sin(cp.x * 3.1) * sin(cp.y * 2.7);
        float cb = sin((cp.x + cp.y) * 2.3 + uTime * 0.45);
        float caustic = pow(max(0.0, ca * cb), 4.0);
        gl_FragColor.rgb += vec3(0.72, 1.0, 0.88) * caustic * 0.16;
        #include <dithering_fragment>
      `
    )
  }
  mat.customProgramCacheKey = () => `fish-abzu-${config.id}`
  return mat
}

interface SchoolProps {
  config: SpeciesConfig
  sceneRef: React.RefObject<SceneRuntime>
  onSelect: (id: string) => void
}

/** Cardume Boids renderizado com instancedMesh (uma única chamada de desenho por espécie). */
function School({ config, sceneRef, onSelect }: SchoolProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const geometry = useDisposable(createFishGeometry)
  const swimTime = useMemo(() => ({ value: 0 }), [])
  const swimFreq = useMemo(() => ({ value: 6 }), [])
  const swimAmp = useMemo(() => ({ value: 0.8 }), [])
  const material = useDisposable(() => createFishMaterial(config, swimTime, swimFreq, swimAmp))

  const boids = useMemo<Boid[]>(() => {
    const rng = mulberry32(config.id.length * 91 + config.count)
    return Array.from({ length: config.count }, () => {
      const angle = rng() * Math.PI * 2
      const velocity = new THREE.Vector3(
        Math.cos(angle),
        range(rng, -0.1, 0.1),
        Math.sin(angle)
      ).multiplyScalar(config.speed)
      return {
        position: new THREE.Vector3(
          config.home[0] + range(rng, -5, 5),
          config.home[1] + range(rng, -2, 2),
          config.home[2] + range(rng, -5, 5)
        ),
        velocity,
        phase: rng() * Math.PI * 2,
        heading: Math.atan2(-velocity.z, velocity.x),
        recovery: 0,
      }
    })
  }, [config])

  const runtime = useMemo<FishRuntime[]>(
    () =>
      boids.map((_, index) => ({
        id: `${config.id}-${index}`,
        species: config.id,
        position: new THREE.Vector3(),
        size: config.size,
        color: config.color,
      })),
    [boids, config]
  )

  const scratch = useMemo(
    () => ({
      separation: new THREE.Vector3(),
      alignment: new THREE.Vector3(),
      cohesion: new THREE.Vector3(),
      steer: new THREE.Vector3(),
      diff: new THREE.Vector3(),
      home: new THREE.Vector3(),
    }),
    []
  )

  useEffect(() => {
    sceneRef.current.fish.push(...runtime)
    return () => {
      const ids = new Set(runtime.map((fish) => fish.id))
      sceneRef.current.fish = sceneRef.current.fish.filter((fish) => !ids.has(fish.id))
    }
  }, [runtime, sceneRef])

  useLayoutEffect(() => {
    if (!meshRef.current) return
    const base = new THREE.Color(config.color)
    const accent = new THREE.Color(config.accent)
    const mixed = new THREE.Color()
    for (let i = 0; i < boids.length; i++) {
      mixed.copy(base).lerp(accent, (i % 5) / 8)
      meshRef.current.setColorAt(i, mixed)
    }
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true
  }, [boids, config])

  useFrame((state, rawDelta) => {
    const mesh = meshRef.current
    if (!mesh) return
    const dt = safeDelta(rawDelta)
    const time = state.clock.elapsedTime
    swimTime.value = time
    const food = sceneRef.current.food
    const perceptionSq = 3.4 * 3.4
    const separationSq = 1.1 * 1.1
    let totalSpeed = 0

    // Saneamento global antes das forças: um único NaN contaminaria todos os vizinhos.
    for (const boid of boids) {
      if (!isFiniteVector(boid.position) || !isFiniteVector(boid.velocity)) {
        boid.position.set(
          config.home[0] + Math.cos(boid.phase) * 2,
          config.home[1] + Math.sin(boid.phase * 1.7) * 1.2,
          config.home[2] + Math.sin(boid.phase) * 2
        )
        boid.velocity
          .set(Math.cos(boid.phase), 0, Math.sin(boid.phase))
          .multiplyScalar(config.speed)
        boid.heading = Math.atan2(-boid.velocity.z, boid.velocity.x)
        boid.recovery = 1
      }
      // Trava de segurança: nunca deixa um frame de lag lançar o peixe ao infinito.
      boid.position.x = THREE.MathUtils.clamp(boid.position.x, -28, 28)
      boid.position.y = THREE.MathUtils.clamp(boid.position.y, -4.2, 7.8)
      boid.position.z = THREE.MathUtils.clamp(boid.position.z, -28, 28)
    }

    for (let i = 0; i < boids.length; i++) {
      const boid = boids[i]
      const { separation, alignment, cohesion, steer, diff, home } = scratch
      separation.set(0, 0, 0)
      alignment.set(0, 0, 0)
      cohesion.set(0, 0, 0)
      steer.set(0, 0, 0)
      let neighbors = 0

      for (let j = 0; j < boids.length; j++) {
        if (i === j) continue
        const other = boids[j]
        diff.subVectors(other.position, boid.position)
        const distSq = diff.lengthSq()
        if (!Number.isFinite(distSq) || distSq > perceptionSq) continue
        alignment.add(other.velocity)
        cohesion.add(other.position)
        neighbors++
        // distSq === 0 é ignorado: peixes sobrepostos não geram força infinita.
        if (distSq < separationSq && distSq > 0.0001) {
          separation.addScaledVector(diff, -1 / distSq)
        }
      }

      if (neighbors > 0) {
        alignment.divideScalar(neighbors).sub(boid.velocity).multiplyScalar(0.9)
        cohesion.divideScalar(neighbors).sub(boid.position).multiplyScalar(0.55)
        steer.add(alignment).add(cohesion)
      }
      steer.addScaledVector(separation, 1.8)

      // Comida: atrai os peixes próximos, sem dividir por vetor nulo.
      for (const particle of food) {
        diff.subVectors(particle.position, boid.position)
        const distSq = diff.lengthSq()
        if (distSq < 64 && distSq > 0.01) {
          const len = Math.sqrt(distSq)
          if (len > 0.0001) steer.addScaledVector(diff.multiplyScalar(1 / len), 3.2 * particle.life)
        }
      }

      // Peixes-palhaço ficam perto das anêmonas.
      home.set(...config.home)
      diff.subVectors(home, boid.position)
      const homeDist = diff.length()
      if (homeDist > 6 && homeDist > 0.0001) {
        steer.addScaledVector(diff.multiplyScalar(1 / homeDist), 0.45)
      }
      // Retorno suave ao centro após um fail-safe.
      if (boid.recovery > 0) {
        diff.subVectors(home, boid.position)
        const len = diff.length()
        if (len > 0.0001) steer.addScaledVector(diff.multiplyScalar(1 / len), 1.1 * boid.recovery)
        boid.recovery = Math.max(0, boid.recovery - dt * 1.6)
      }

      // Limites originais preservados.
      const p = boid.position
      if (Math.abs(p.x) > 26) steer.x -= Math.sign(p.x) * 1.6
      if (Math.abs(p.z) > 26) steer.z -= Math.sign(p.z) * 1.6
      if (p.y < -3.9) steer.y += 1.8
      if (p.y > 7.5) steer.y -= 1.8

      // Contenção contínua no assoalho, na superfície e nas construções.
      const clearance = 0.55 + config.size
      applyWaterColumnSteering(p, steer, clearance)
      steerAroundStructures(p, steer, config.size * 0.9, 3.6)

      if (!isFiniteVector(steer)) steer.set(0, 0.4, 0)
      boid.velocity.addScaledVector(steer, dt)
      const speed = boid.velocity.length()
      if (Number.isFinite(speed) && speed > 0.0001) {
        boid.velocity.setLength(THREE.MathUtils.clamp(speed, config.speed * 0.65, config.speed * 1.35))
        totalSpeed += speed
      } else {
        boid.velocity.set(Math.cos(boid.phase), 0, Math.sin(boid.phase)).multiplyScalar(config.speed)
      }
      boid.position.addScaledVector(boid.velocity, dt)
      clampToHabitat(boid.position, clearance)
      runtime[i].position.copy(boid.position)

      // Heading persistente: atan2 nunca recebe um vetor nulo.
      if (Math.abs(boid.velocity.x) + Math.abs(boid.velocity.z) > 0.0001) {
        const next = Math.atan2(-boid.velocity.z, boid.velocity.x)
        if (Number.isFinite(next)) boid.heading = next
      }

      dummy.position.copy(boid.position)
      dummy.rotation.set(
        Math.sin(time * 7 + boid.phase) * 0.09,
        boid.heading,
        Math.sin(time * 5 + boid.phase) * 0.05
      )
      dummy.scale.setScalar(config.size * (0.9 + (i % 4) * 0.05))
      dummy.updateMatrix()
      // Última barreira: uma matriz inválida nunca chega à GPU.
      if (dummy.matrix.elements.every(Number.isFinite)) mesh.setMatrixAt(i, dummy.matrix)
    }
    // Frequência e amplitude amortecidas pelo delta: deslizar devagar fica
    // macio, acelerar aumenta o batimento sem saltar de um frame para outro.
    const avgSpeed = totalSpeed / Math.max(1, boids.length)
    const cruise = THREE.MathUtils.clamp(avgSpeed / Math.max(0.1, config.speed), 0, 1.6)
    swimFreq.value = THREE.MathUtils.damp(swimFreq.value, 3.8 + avgSpeed * 1.9, 2.2, dt)
    swimAmp.value = THREE.MathUtils.damp(swimAmp.value, 0.62 + cruise * 0.26, 2.6, dt)
    mesh.instanceMatrix.needsUpdate = true
  })

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    if (event.instanceId === undefined) return
    onSelect(runtime[event.instanceId].id)
  }

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, boids.length]}
      onClick={handleClick}
      onPointerOver={() => (document.body.style.cursor = 'pointer')}
      onPointerOut={() => (document.body.style.cursor = 'auto')}
      castShadow
      frustumCulled={false}
    />
  )
}

/* -------------------------------------------------------------------------- */
/*                                 TUBARÕES                                   */
/* -------------------------------------------------------------------------- */

interface SharkState {
  position: THREE.Vector3
  velocity: THREE.Vector3
  target: THREE.Vector3
  heading: number
  phase: number
  scale: number
  recovery: number
  orbit: number
}

interface SharksProps {
  sceneRef: React.RefObject<SceneRuntime>
  onSelect: (id: string) => void
}

/** Dois tubarões de nado lento e majestoso na meia-água. */
function Sharks({ sceneRef, onSelect }: SharksProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const geometry = useDisposable(createSharkGeometry)
  const swimTime = useMemo(() => ({ value: 0 }), [])
  const swimFreq = useMemo(() => ({ value: 3 }), [])
  const swimAmp = useMemo(() => ({ value: 0.8 }), [])

  const material = useDisposable(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      vertexColors: true,
      roughness: 0.42,
      metalness: 0.08,
      emissive: '#0b2a3a',
      emissiveIntensity: 0.08,
    })
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = swimTime
      shader.uniforms.uSwimFreq = swimFreq
      shader.uniforms.uSwimAmp = swimAmp
      shader.vertexShader = `attribute vec4 aFin;
uniform float uTime;
uniform float uSwimFreq;
uniform float uSwimAmp;
varying vec3 vRimNormal;
varying vec3 vRimView;
varying vec3 vCausticPos;
${shader.vertexShader}`
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
            float phase = instanceMatrix[3].x * 0.19 + instanceMatrix[3].z * 0.13;
            float wave = uTime * uSwimFreq + phase;
            float bodyAmp = aFin.y * aFin.y * uSwimAmp;
            transformed.z += (sin(wave - transformed.x * 1.7) * 0.34
                            + sin(wave * 0.5 - transformed.x * 0.85) * 0.08) * bodyAmp;
            transformed.y += sin(wave * 0.55 - transformed.x * 1.1) * 0.03 * aFin.y * uSwimAmp;

            float finType = aFin.x;
            float tip = aFin.y;
            float lag = wave - tip * 1.6;
            float soft = sin(lag) * 0.8 + sin(lag * 0.5 + 1.0) * 0.2;
            float finAmp = uSwimAmp * (0.35 + 0.65 * tip);
            if (finType > 0.5 && finType < 1.5) {
              transformed.z += soft * 0.5 * finAmp;
              transformed.y += sin(lag * 0.75 + 0.7) * 0.1 * tip * uSwimAmp;
            } else if (finType > 1.5 && finType < 2.5) {
              transformed.z += soft * 0.15 * finAmp;
            } else if (finType > 2.5) {
              float row = sin(lag * 0.8 + 1.3) * 0.8 + sin(lag * 0.4) * 0.2;
              transformed.z += row * 0.12 * finAmp;
              transformed.y += row * 0.08 * finAmp;
            }
          `
        )
        .replace(
          '#include <project_vertex>',
          /* glsl */ `#include <project_vertex>
            vRimNormal = normalize(normalMatrix * normal);
            vRimView = normalize(-mvPosition.xyz);
            vCausticPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          `
        )
      shader.fragmentShader = `uniform float uTime;
varying vec3 vRimNormal;
varying vec3 vRimView;
varying vec3 vCausticPos;
${shader.fragmentShader}`.replace(
        '#include <dithering_fragment>',
        /* glsl */ `
          float rim = pow(1.0 - clamp(dot(normalize(vRimNormal), normalize(vRimView)), 0.0, 1.0), 2.8);
          gl_FragColor.rgb += vec3(0.36, 0.8, 1.0) * rim * 0.28;
          vec2 cp = vCausticPos.xz * 0.35 + vec2(uTime * 0.09, -uTime * 0.06);
          float web = pow(max(0.0, sin(cp.x * 2.6) * sin(cp.y * 2.2)), 4.0);
          gl_FragColor.rgb += vec3(0.7, 0.95, 0.88) * web * 0.13;
          #include <dithering_fragment>
        `
      )
    }
    mat.customProgramCacheKey = () => 'shark-abzu-spine'
    return mat
  })

  const sharks = useMemo<SharkState[]>(() => {
    const rng = mulberry32(4811)
    return [0, 1].map((i) => {
      const centerX = i === 0 ? -8 : 10
      const centerZ = i === 0 ? -6 : 9
      const orbit = rng() * Math.PI * 2
      const velocity = new THREE.Vector3(Math.cos(orbit), 0, Math.sin(orbit)).multiplyScalar(0.8)
      return {
        position: new THREE.Vector3(centerX + Math.cos(orbit) * 10, 1.8 + i, centerZ + Math.sin(orbit) * 10),
        velocity,
        target: new THREE.Vector3(),
        heading: Math.atan2(-velocity.z, velocity.x),
        phase: rng() * Math.PI * 2,
        scale: i === 0 ? 1.15 : 0.9,
        recovery: 0,
        orbit,
      }
    })
  }, [])

  const runtime = useMemo<FishRuntime[]>(
    () =>
      sharks.map((shark, index) => ({
        id: `shark-${index}`,
        species: 'shark' as const,
        position: shark.position.clone(),
        size: 3.6 * shark.scale,
        color: '#6c8fa0',
      })),
    [sharks]
  )

  const scratch = useMemo(
    () => ({ steer: new THREE.Vector3(), diff: new THREE.Vector3() }),
    []
  )

  useEffect(() => {
    sceneRef.current.fish.push(...runtime)
    return () => {
      const ids = new Set(runtime.map((fish) => fish.id))
      sceneRef.current.fish = sceneRef.current.fish.filter((fish) => !ids.has(fish.id))
    }
  }, [runtime, sceneRef])

  const color = useMemo(() => new THREE.Color('#dfeaf0'), [])
  useLayoutEffect(() => {
    if (!meshRef.current) return
    meshRef.current.setColorAt(0, color)
    meshRef.current.setColorAt(1, color.clone().offsetHSL(0.02, 0.05, -0.04))
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true
  }, [color])

  useFrame((state, rawDelta) => {
    if (!meshRef.current) return
    const dt = safeDelta(rawDelta)
    const t = state.clock.elapsedTime
    swimTime.value = t
    const { steer, diff } = scratch
    let cruise = 0
    const centers = [
      [-8, -6],
      [10, 9],
    ]

    sharks.forEach((shark, i) => {
      if (!isFiniteVector(shark.position) || !isFiniteVector(shark.velocity)) {
        shark.position.set(centers[i][0], 2, centers[i][1])
        shark.velocity.set(0.8, 0, 0)
        shark.recovery = 1
      }
      shark.orbit += dt * (i === 0 ? 0.16 : -0.13)
      steer.set(0, 0, 0)
      shark.target.set(
        centers[i][0] + Math.cos(shark.orbit) * 11,
        2.2 + Math.sin(t * 0.32 + shark.phase) * 1.3,
        centers[i][1] + Math.sin(shark.orbit) * 11
      )
      diff.subVectors(shark.target, shark.position)
      const dist = diff.length()
      if (dist > 0.0001) steer.addScaledVector(diff.multiplyScalar(1 / dist), 0.75)
      steer.addScaledVector(shark.velocity, -0.18)
      if (shark.recovery > 0) {
        diff.set(centers[i][0], 2, centers[i][1]).sub(shark.position)
        const len = diff.length()
        if (len > 0.0001) steer.addScaledVector(diff.multiplyScalar(1 / len), 1.2 * shark.recovery)
        shark.recovery = Math.max(0, shark.recovery - dt * 1.5)
      }

      applyWaterColumnSteering(shark.position, steer, 2.2)
      steerAroundStructures(shark.position, steer, 2.1, 3.2)
      if (!isFiniteVector(steer)) steer.set(0, 0.2, 0)
      shark.velocity.addScaledVector(steer, dt)
      const speed = shark.velocity.length()
      if (speed > 0.0001 && Number.isFinite(speed)) cruise += speed
      if (speed > 0.0001 && Number.isFinite(speed)) shark.velocity.setLength(THREE.MathUtils.clamp(speed, 0.55, 1.05))
      else shark.velocity.set(0.8, 0, 0)
      shark.position.addScaledVector(shark.velocity, dt)
      clampToHabitat(shark.position, 1.4, 26, -1.2, 6.4)
      runtime[i].position.copy(shark.position)

      if (Math.abs(shark.velocity.x) + Math.abs(shark.velocity.z) > 0.0001) {
        const heading = Math.atan2(-shark.velocity.z, shark.velocity.x)
        if (Number.isFinite(heading)) shark.heading = heading
      }
      dummy.position.copy(shark.position)
      dummy.rotation.set(
        Math.sin(t * 0.7 + shark.phase) * 0.045,
        shark.heading,
        Math.sin(t * 0.5 + shark.phase) * 0.05
      )
      dummy.scale.setScalar(shark.scale)
      dummy.updateMatrix()
      if (dummy.matrix.elements.every(Number.isFinite)) meshRef.current!.setMatrixAt(i, dummy.matrix)
    })
    // Mesmo amortecimento dos cardumes: batimento lento e amplitude contida.
    cruise = cruise / Math.max(1, sharks.length)
    swimFreq.value = THREE.MathUtils.damp(swimFreq.value, 3.2 + cruise * 1.4, 1.8, dt)
    swimAmp.value = THREE.MathUtils.damp(swimAmp.value, 0.66 + cruise * 0.2, 2, dt)
    meshRef.current.instanceMatrix.needsUpdate = true
  })

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    if (event.instanceId !== undefined) onSelect(runtime[event.instanceId].id)
  }

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, sharks.length]}
      onClick={handleClick}
      onPointerOver={() => (document.body.style.cursor = 'pointer')}
      onPointerOut={() => (document.body.style.cursor = 'auto')}
      castShadow
      frustumCulled={false}
    />
  )
}

/* -------------------------------------------------------------------------- */
/*                                TARTARUGAS                                 */
/* -------------------------------------------------------------------------- */

interface TurtleProps {
  index: number
  sceneRef: React.RefObject<SceneRuntime>
  onSelect: (id: string) => void
}

/** Tartaruga com casco esculpido e nadadeiras em leque, totalmente blindada. */
function SeaTurtle({ index, sceneRef, onSelect }: TurtleProps) {
  const group = useRef<THREE.Group>(null)
  const leftFlipper = useRef<THREE.Mesh>(null)
  const rightFlipper = useRef<THREE.Mesh>(null)
  const rng = useMemo(() => mulberry32(700 + index), [index])

  const shell = useDisposable(() => {
    const geo = new THREE.SphereGeometry(1, 24, 14)
    const pos = geo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      const z = pos.getZ(i)
      const a = Math.atan2(z, x)
      const scute = Math.sin(a * 6) * 0.035 + Math.cos(y * 9) * 0.02
      const n = 1 + scute
      pos.setXYZ(i, x * 1.35 * n, y * 0.55 * n, z * n)
    }
    pos.needsUpdate = true
    geo.computeVertexNormals()
    geo.computeBoundingBox()
    geo.computeBoundingSphere()
    return geo
  })
  const flipper = useDisposable(() => createFinGeometry(
    [
      [0.7, 0.1],
      [0.1, 0.22],
      [-0.8, 0.06],
      [-0.6, -0.2],
      [0.2, -0.18],
    ],
    0.08
  ))

  const start = useMemo(
    () =>
      new THREE.Vector3(
        range(rng, -18, 18),
        range(rng, -2.5, 3.5),
        range(rng, -20, 20)
      ),
    [rng]
  )
  const velocity = useMemo(
    () => new THREE.Vector3(range(rng, -0.45, 0.45), 0, range(rng, 0.35, 0.7)),
    [rng]
  )

  const runtime = useMemo<FishRuntime>(
    () => ({
      id: `turtle-${index}`,
      species: 'turtle',
      position: start.clone(),
      size: 1.6,
      color: '#4f9a72',
    }),
    [index, start]
  )
  const steer = useMemo(() => new THREE.Vector3(), [])

  useEffect(() => {
    sceneRef.current.fish.push(runtime)
    return () => {
      sceneRef.current.fish = sceneRef.current.fish.filter((fish) => fish.id !== runtime.id)
    }
  }, [runtime, sceneRef])

  useFrame((state, rawDelta) => {
    const dt = safeDelta(rawDelta)
    const flap = Math.sin(state.clock.elapsedTime * 1.5 + index) * 0.5
    if (leftFlipper.current) leftFlipper.current.rotation.z = -0.35 + flap
    if (rightFlipper.current) rightFlipper.current.rotation.z = 0.35 - flap
    if (!group.current) return

    if (!isFiniteVector(start) || !isFiniteVector(velocity)) {
      start.set(index % 2 ? 12 : -12, 0, index % 2 ? -12 : 12)
      velocity.set(0, 0, 0.5)
    }
    if ((start.x > 24 && velocity.x > 0) || (start.x < -24 && velocity.x < 0)) velocity.x *= -1
    if ((start.z > 24 && velocity.z > 0) || (start.z < -24 && velocity.z < 0)) velocity.z *= -1

    steer.set(0, 0, 0)
    applyWaterColumnSteering(start, steer, 1.5)
    steerAroundStructures(start, steer, 1.4, 2.4)
    velocity.addScaledVector(steer, dt)
    const speed = velocity.length()
    if (speed > 0.0001 && Number.isFinite(speed)) velocity.setLength(THREE.MathUtils.clamp(speed, 0.35, 0.85))
    else velocity.set(0, 0, 0.5)
    start.addScaledVector(velocity, dt)
    start.x = THREE.MathUtils.clamp(start.x, -28, 28)
    start.z = THREE.MathUtils.clamp(start.z, -28, 28)
    start.y = THREE.MathUtils.clamp(
      start.y,
      Math.max(-3.2, -5 + terrainHeight(start.x, start.z) + 1.2),
      Math.min(5.5, SURFACE_Y - 1.5)
    )
    group.current.position.copy(start)
    if (Math.abs(velocity.x) + Math.abs(velocity.z) > 0.0001) {
      const heading = Math.atan2(-velocity.z, velocity.x)
      if (Number.isFinite(heading)) group.current.rotation.y = heading
    }
    group.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.6 + index) * 0.06
    runtime.position.copy(start)
  })

  return (
    <group
      ref={group}
      onClick={(event) => {
        event.stopPropagation()
        onSelect(runtime.id)
      }}
      onPointerOver={() => (document.body.style.cursor = 'pointer')}
      onPointerOut={() => (document.body.style.cursor = 'auto')}
    >
      <mesh geometry={shell} scale={[1, 1, 1]} castShadow frustumCulled={false}>
        <meshStandardMaterial color="#2f6b4f" roughness={0.72} vertexColors={false} />
      </mesh>
      <mesh position={[0, 0.22, 0]} scale={[1.1, 0.45, 0.82]} frustumCulled={false}>
        <sphereGeometry args={[1, 14, 10]} />
        <meshStandardMaterial color="#5ba77a" roughness={0.7} />
      </mesh>
      <mesh position={[1.25, 0, 0]} scale={[0.48, 0.42, 0.42]} castShadow frustumCulled={false}>
        <sphereGeometry args={[1, 12, 9]} />
        <meshStandardMaterial color="#6cb98a" roughness={0.7} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[1.52, 0.12, side * 0.2]} frustumCulled={false}>
          <sphereGeometry args={[0.07, 8, 6]} />
          <meshStandardMaterial color="#0b1c22" />
        </mesh>
      ))}
      <mesh ref={leftFlipper} geometry={flipper} position={[0.1, -0.1, 0.9]} rotation={[0, Math.PI / 2, -0.35]} scale={[1, 1, 0.75]} castShadow frustumCulled={false}>
        <meshStandardMaterial color="#4f9a72" roughness={0.8} side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={rightFlipper} geometry={flipper} position={[0.1, -0.1, -0.9]} rotation={[0, -Math.PI / 2, 0.35]} scale={[1, 1, 0.75]} castShadow frustumCulled={false}>
        <meshStandardMaterial color="#4f9a72" roughness={0.8} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

interface MarineLifeProps {
  sceneRef: React.RefObject<SceneRuntime>
  onSelectFish: (id: string) => void
}

/** Gerencia toda a vida marinha: cardumes, tubarões e tartarugas. */
export function MarineLife({ sceneRef, onSelectFish }: MarineLifeProps) {
  return (
    <group>
      {SPECIES.map((config) => (
        <School key={config.id} config={config} sceneRef={sceneRef} onSelect={onSelectFish} />
      ))}
      <Sharks sceneRef={sceneRef} onSelect={onSelectFish} />
      <SeaTurtle index={0} sceneRef={sceneRef} onSelect={onSelectFish} />
      <SeaTurtle index={1} sceneRef={sceneRef} onSelect={onSelectFish} />
    </group>
  )
}
