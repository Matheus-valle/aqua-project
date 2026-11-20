import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { type ThreeEvent, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mulberry32, range } from '../scene/random'
import { REEF_CLUSTERS } from '../scene/obstacles'
import { groundY, SURFACE_Y } from '../scene/terrain'
import type { FeedRequest, SceneRuntime } from '../scene/types'

const dummy = new THREE.Object3D()
const tmpColor = new THREE.Color()

/** Raios de sol volumétricos: cones com blending aditivo e opacidade que pulsa. */
function GodRays() {
  const group = useRef<THREE.Group>(null)
  const cones = useRef<THREE.InstancedMesh>(null)
  const rng = useMemo(() => mulberry32(2024), [])

  const geometry = useMemo(() => {
    const geo = new THREE.ConeGeometry(1, 1, 12, 1, true)
    geo.translate(0, -0.5, 0)
    const pos = geo.attributes.position as THREE.BufferAttribute
    const colors = new Float32Array(pos.count * 4)
    for (let i = 0; i < pos.count; i++) {
      const depth = THREE.MathUtils.clamp(pos.getY(i) + 1, 0, 1)
      colors[i * 4] = 0.42 + depth * 0.58
      colors[i * 4 + 1] = 0.78 + depth * 0.19
      colors[i * 4 + 2] = 0.92 + depth * 0.06
      colors[i * 4 + 3] = Math.pow(depth, 1.7)
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 4))
    return geo
  }, [])
  useEffect(() => () => geometry.dispose(), [geometry])

  useLayoutEffect(() => {
    if (!cones.current) return
    const n = 16
    for (let i = 0; i < n; i++) {
      const x = range(rng, -24, 24)
      const z = range(rng, -26, 18)
      const height = range(rng, 13, 22)
      dummy.position.set(x, 11, z)
      dummy.rotation.set(range(rng, -0.12, 0.12), rng() * Math.PI, range(rng, -0.14, 0.14))
      dummy.scale.set(range(rng, 1.2, 3), height, range(rng, 1.2, 2.8))
      dummy.updateMatrix()
      cones.current.setMatrixAt(i, dummy.matrix)
    }
    cones.current.instanceMatrix.needsUpdate = true
  }, [rng])

  useFrame((state) => {
    if (group.current) group.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.06) * 0.05
    if (cones.current) {
      const mat = cones.current.material as THREE.MeshBasicMaterial
      mat.opacity = 0.05 + Math.sin(state.clock.elapsedTime * 0.4) * 0.008
    }
  })

  return (
    <group ref={group}>
      <instancedMesh ref={cones} args={[geometry, undefined, 16]} frustumCulled={false}>
        <meshBasicMaterial
          color="#fffcef"
          vertexColors
          transparent
          opacity={0.05}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
    </group>
  )
}

/**
 * Superfície oceânica: quatro trens de onda com normais analíticas, janela de
 * Snell vista de baixo, reflexo especular do sol e caustics de refração.
 * Posição, rotação e a atualização de uTime permanecem idênticas.
 */
function WaterSurface() {
  const geometry = useMemo(() => new THREE.PlaneGeometry(180, 180, 96, 96), [])
  useEffect(() => () => geometry.dispose(), [geometry])

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uSky: { value: new THREE.Color('#dffaff') },
      uDeep: { value: new THREE.Color('#2aa7cf') },
      uSun: { value: new THREE.Vector3(-12, -28, -10).normalize() },
    }),
    []
  )

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: /* glsl */ `
          uniform float uTime;
          varying vec3 vWorld;
          varying vec3 vNormalW;

          void wave(vec2 p, vec2 dir, float freq, float speed, float amp, inout float h, inout vec2 grad) {
            float phase = dot(p, dir) * freq + uTime * speed;
            h += sin(phase) * amp;
            grad += dir * (freq * amp * cos(phase));
          }

          void main() {
            vec2 p = position.xy;
            float h = 0.0;
            vec2 grad = vec2(0.0);
            wave(p, normalize(vec2(1.0, 0.35)), 0.18, 0.85, 0.34, h, grad);
            wave(p, normalize(vec2(-0.4, 1.0)), 0.27, 1.15, 0.20, h, grad);
            wave(p, normalize(vec2(0.7, -0.7)), 0.52, 1.60, 0.07, h, grad);
            wave(p, normalize(vec2(-1.0, -0.2)), 0.95, 2.10, 0.03, h, grad);

            vec3 displaced = vec3(position.xy, position.z + h);
            vec3 localNormal = normalize(vec3(-grad, 1.0));
            vec4 world = modelMatrix * vec4(displaced, 1.0);
            vWorld = world.xyz;
            vNormalW = normalize(mat3(modelMatrix) * localNormal);
            gl_Position = projectionMatrix * viewMatrix * world;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform vec3 uSky;
          uniform vec3 uDeep;
          uniform vec3 uSun;
          varying vec3 vWorld;
          varying vec3 vNormalW;

          void main() {
            vec3 N = normalize(vNormalW);
            vec3 V = normalize(cameraPosition - vWorld);
            float cosI = clamp(dot(N, V), 0.0, 1.0);
            float theta = acos(cosI);

            // Janela de Snell (~48.8 graus): dentro, o ceu; fora, reflexao interna total.
            float window = 1.0 - smoothstep(0.92, 1.06, theta);

            vec3 mirrored = uDeep * (0.55 + 0.45 * abs(N.y));
            vec2 cp = vWorld.xz * 0.16 + vec2(uTime * 0.07, -uTime * 0.05);
            float a = sin(cp.x * 2.7) * sin(cp.y * 2.2);
            float b = sin(cp.x * 1.6 - cp.y * 2.9 + uTime * 0.4);
            float caustic = pow(max(0.0, a * b), 3.0);
            mirrored += vec3(0.34, 0.72, 0.86) * caustic * 0.34;

            float sunSpec = pow(max(dot(reflect(-uSun, N), V), 0.0), 46.0);
            float glow = pow(max(dot(uSun, V), 0.0), 180.0);
            vec3 sky = uSky * 0.82 + vec3(0.08, 0.07, 0.05);
            sky += vec3(1.0, 0.94, 0.78) * sunSpec * 0.55;

            vec3 col = mix(mirrored, sky, max(window, 0.35));
            col += vec3(1.0, 0.96, 0.84) * glow * 0.9;
            col += vec3(0.35, 0.8, 0.9) * pow(1.0 - cosI, 4.0) * 0.22;

            float r = length(vWorld.xz);
            float fade = 1.0 - smoothstep(58.0, 86.0, r);
            gl_FragColor = vec4(col, (0.66 + window * 0.28) * fade);
          }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [uniforms]
  )
  useEffect(() => () => material.dispose(), [material])

  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime
  })

  return <mesh geometry={geometry} material={material} rotation-x={Math.PI / 2} position-y={11.5} />
}

interface PlanktonProps {
  count?: number
}

/** Plâncton suspenso: pontos minúsculos que derivam devagar com a correnteza. */
function Plankton({ count = 900 }: PlanktonProps) {
  const pointsRef = useRef<THREE.Points>(null)
  const rng = useMemo(() => mulberry32(555), [])

  const { geometry, material, basePositions, phases } = useMemo(() => {
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const phaseArray = new Float32Array(count)
    const color = new THREE.Color()
    for (let i = 0; i < count; i++) {
      positions[i * 3] = range(rng, -30, 30)
      positions[i * 3 + 1] = range(rng, -4.5, 10)
      positions[i * 3 + 2] = range(rng, -30, 30)
      phaseArray[i] = rng() * Math.PI * 2
      const depth = THREE.MathUtils.smoothstep(positions[i * 3 + 1], -4, 10)
      const warm = i % 4 === 0
      color.setHSL(
        warm ? 0.1 : 0.53 - depth * 0.05,
        warm ? 0.55 : 0.5,
        (warm ? 0.7 : 0.62) + depth * 0.26
      )
      color.toArray(colors, i * 3)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const mat = new THREE.PointsMaterial({
      size: 0.065,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    return { geometry: geo, material: mat, basePositions: positions.slice(), phases: phaseArray }
  }, [count, rng])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  useFrame((state) => {
    if (!pointsRef.current) return
    const attr = geometry.attributes.position as THREE.BufferAttribute
    const arr = attr.array as Float32Array
    const t = state.clock.elapsedTime
    for (let i = 0; i < count; i++) {
      const i3 = i * 3
      arr[i3] = basePositions[i3] + Math.sin(t * 0.25 + phases[i]) * 0.6
      arr[i3 + 1] = basePositions[i3 + 1] + Math.cos(t * 0.3 + phases[i]) * 0.35
    }
    attr.needsUpdate = true
  })

  return <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />
}

interface BubblesProps {
  sceneRef: React.RefObject<SceneRuntime>
}

/** Bolhas que sobem; ao clicar na água, mais bolhas são liberadas no ponto do clique. */
function Bubbles({ sceneRef }: BubblesProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const rng = useMemo(() => mulberry32(808), [])
  const COUNT = 120

  interface Bubble {
    baseX: number
    baseZ: number
    y: number
    speed: number
    phase: number
    size: number
  }

  const bubbles = useMemo<Bubble[]>(
    () =>
      Array.from({ length: COUNT }, (_, i) => ({
        baseX: range(rng, -26, 26),
        baseZ: range(rng, -26, 26),
        y: i < 60 ? range(rng, -4, 10) : -20,
        speed: range(rng, 0.4, 1.2),
        phase: rng() * Math.PI * 2,
        size: range(rng, 0.04, 0.14),
      })),
    [rng]
  )

  const geometry = useMemo(() => new THREE.SphereGeometry(1, 8, 6), [])
  useEffect(() => () => geometry.dispose(), [geometry])

  useLayoutEffect(() => {
    if (!meshRef.current) return
    tmpColor.set('#dffaff')
    for (let i = 0; i < COUNT; i++) meshRef.current.setColorAt(i, tmpColor)
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true
  }, [])

  useFrame((state, rawDelta) => {
    if (!meshRef.current) return
    const dt = Math.min(rawDelta, 0.05)
    const foodCount = sceneRef.current.food.length
    const t = state.clock.elapsedTime

    for (let i = 0; i < COUNT; i++) {
      const b = bubbles[i]
      b.y += b.speed * dt * (1 + foodCount * 0.1)
      if (b.y > 11) b.y = -20
      dummy.position.set(
        b.baseX + Math.sin(t * 0.8 + b.phase) * 0.35,
        b.y,
        b.baseZ + Math.cos(t * 0.6 + b.phase) * 0.3
      )
      dummy.scale.setScalar(b.size)
      dummy.updateMatrix()
      meshRef.current.setMatrixAt(i, dummy.matrix)
    }
    meshRef.current.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={meshRef} args={[geometry, undefined, COUNT]} frustumCulled={false}>
      <meshStandardMaterial
        color="#f4ffff"
        transparent
        opacity={0.5}
        roughness={0.08}
        metalness={0.32}
        depthWrite={false}
      />
    </instancedMesh>
  )
}

interface BubbleStream {
  source: number
  ox: number
  oz: number
  y: number
  speed: number
  phase: number
  size: number
}

const REEF_STREAMS = REEF_CLUSTERS.length
const FISH_STREAMS = 4
const BUBBLES_PER_STREAM = 18
const BUBBLE_STREAM_COUNT = (REEF_STREAMS + FISH_STREAMS) * BUBBLES_PER_STREAM

/**
 * Colunas de bolhas: nascem no assoalho dos recifes e, ocasionalmente, na
 * posição de um peixe, sobem com wobble horizontal e reiniciam na superfície.
 */
function BubbleStreams({ sceneRef }: { sceneRef: React.RefObject<SceneRuntime> }) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const rng = useMemo(() => mulberry32(1607), [])

  const streams = useMemo<BubbleStream[]>(
    () =>
      Array.from({ length: BUBBLE_STREAM_COUNT }, (_, i) => {
        const source = Math.floor(i / BUBBLES_PER_STREAM)
        const cluster = REEF_CLUSTERS[source % REEF_CLUSTERS.length]
        const ox = range(rng, -1.4, 1.4)
        const oz = range(rng, -1.4, 1.4)
        const bottom = groundY(cluster.x + ox, cluster.z + oz) + 0.2
        return {
          source,
          ox,
          oz,
          y: bottom + range(rng, 0, Math.max(0.5, SURFACE_Y - bottom - 0.5)),
          speed: range(rng, 0.45, 1.15),
          phase: rng() * Math.PI * 2,
          size: range(rng, 0.035, 0.11),
        }
      }),
    [rng]
  )

  const geometry = useMemo(() => new THREE.SphereGeometry(1, 10, 7), [])
  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#eaffff',
      transparent: true,
      opacity: 0.48,
      roughness: 0.06,
      metalness: 0.38,
      depthWrite: false,
    })
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = `varying vec3 vBubbleNormal;
varying vec3 vBubbleView;
${shader.vertexShader}`.replace(
        '#include <project_vertex>',
        /* glsl */ `#include <project_vertex>
          vBubbleNormal = normalize(normalMatrix * normal);
          vBubbleView = normalize(-mvPosition.xyz);
        `
      )
      shader.fragmentShader = `varying vec3 vBubbleNormal;
varying vec3 vBubbleView;
${shader.fragmentShader}`.replace(
        '#include <dithering_fragment>',
        /* glsl */ `
          float rim = pow(1.0 - clamp(dot(normalize(vBubbleNormal), normalize(vBubbleView)), 0.0, 1.0), 3.0);
          gl_FragColor.rgb += vec3(0.72, 1.0, 1.0) * rim * 0.55;
          #include <dithering_fragment>
        `
      )
    }
    mat.customProgramCacheKey = () => 'bubble-stream-specular'
    return mat
  }, [])

  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material]
  )

  const origin = useMemo(() => new THREE.Vector3(), [])

  useLayoutEffect(() => {
    if (!meshRef.current) return
    tmpColor.set('#eaffff')
    for (let i = 0; i < BUBBLE_STREAM_COUNT; i++) meshRef.current.setColorAt(i, tmpColor)
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true
  }, [])

  useFrame((state, rawDelta) => {
    if (!meshRef.current) return
    const dt = Number.isFinite(rawDelta) ? Math.min(Math.max(rawDelta, 0), 0.05) : 1 / 60
    const t = state.clock.elapsedTime
    const fish = sceneRef.current.fish

    for (let i = 0; i < BUBBLE_STREAM_COUNT; i++) {
      const bubble = streams[i]
      if (bubble.source < REEF_STREAMS) {
        const cluster = REEF_CLUSTERS[bubble.source]
        origin.set(
          cluster.x + bubble.ox,
          groundY(cluster.x + bubble.ox, cluster.z + bubble.oz) + 0.2,
          cluster.z + bubble.oz
        )
      } else {
        const index = bubble.source - REEF_STREAMS + Math.floor(t * 0.2)
        const animal = fish.length ? fish[((index % fish.length) + fish.length) % fish.length] : null
        if (animal) {
          origin.set(
            animal.position.x + bubble.ox * 0.3,
            animal.position.y - 0.2,
            animal.position.z + bubble.oz * 0.3
          )
        } else {
          const cluster = REEF_CLUSTERS[bubble.source % REEF_CLUSTERS.length]
          origin.set(
            cluster.x + bubble.ox,
            groundY(cluster.x + bubble.ox, cluster.z + bubble.oz) + 0.2,
            cluster.z + bubble.oz
          )
        }
      }

      if (bubble.y < origin.y) bubble.y = origin.y
      bubble.y += bubble.speed * dt
      if (bubble.y > SURFACE_Y - 0.15) bubble.y = origin.y + Math.sin(bubble.phase + t) * 0.1

      dummy.position.set(
        origin.x + Math.sin(t * 1.1 + bubble.phase + bubble.y * 0.35) * 0.22,
        bubble.y,
        origin.z + Math.cos(t * 0.9 + bubble.phase) * 0.2
      )
      dummy.scale.setScalar(bubble.size)
      dummy.updateMatrix()
      meshRef.current.setMatrixAt(i, dummy.matrix)
    }
    meshRef.current.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, BUBBLE_STREAM_COUNT]}
      frustumCulled={false}
    />
  )
}

interface FoodProps {
  sceneRef: React.RefObject<SceneRuntime>
  requests: FeedRequest[]
}

/** Comida: partículas que caem devagar e são removidas quando a vida acaba. */
function Food({ sceneRef, requests }: FoodProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const MAX = 64
  const geometry = useMemo(() => new THREE.SphereGeometry(0.09, 6, 5), [])
  useEffect(() => () => geometry.dispose(), [geometry])

  useEffect(() => {
    sceneRef.current.food = []
    const now = performance.now()
    for (const request of requests) {
      if (now - request.id > 8000) continue
      sceneRef.current.food.push({
        position: new THREE.Vector3(...request.position),
        life: 1,
      })
    }
  }, [requests, sceneRef])

  useFrame((_, rawDelta) => {
    if (!meshRef.current) return
    const dt = Math.min(rawDelta, 0.05)
    const food = sceneRef.current.food
    for (let i = food.length - 1; i >= 0; i--) {
      food[i].position.y -= dt * 0.65
      food[i].life -= dt * 0.12
      if (food[i].life <= 0) food.splice(i, 1)
    }
    const count = Math.min(food.length, MAX)
    for (let i = 0; i < count; i++) {
      dummy.position.copy(food[i].position)
      dummy.scale.setScalar(0.6 + food[i].life * 0.6)
      dummy.updateMatrix()
      meshRef.current.setMatrixAt(i, dummy.matrix)
    }
    meshRef.current.count = count
    meshRef.current.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={meshRef} args={[geometry, undefined, MAX]} frustumCulled={false}>
      <meshStandardMaterial color="#ffb45c" emissive="#ff7a1a" emissiveIntensity={0.4} roughness={0.8} />
    </instancedMesh>
  )
}

/** Poeira aquática: micropartículas douradas suspensas na água. */
function AquaticDust() {
  const { geometry, material } = useMemo(() => {
    const rng = mulberry32(9090)
    const COUNT = 700
    const positions = new Float32Array(COUNT * 3)
    const colors = new Float32Array(COUNT * 3)
    const color = new THREE.Color()
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3] = range(rng, -34, 34)
      positions[i * 3 + 1] = range(rng, -3.5, 10)
      positions[i * 3 + 2] = range(rng, -34, 34)
      const depth = THREE.MathUtils.smoothstep(positions[i * 3 + 1], -3.5, 10)
      color.setHSL(0.12 - depth * 0.02, 0.5, 0.66 + depth * 0.3 + range(rng, -0.03, 0.03))
      color.toArray(colors, i * 3)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const mat = new THREE.PointsMaterial({
      size: 0.045,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    return { geometry: geo, material: mat }
  }, [])

  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material]
  )

  return <points geometry={geometry} material={material} frustumCulled={false} />
}

interface WaterEffectsProps {
  sceneRef: React.RefObject<SceneRuntime>
  feedRequests: FeedRequest[]
  onFeed: (point: [number, number, number]) => void
}

/** Efeitos de água: raios, superfície, plâncton, bolhas e comida. */
export function WaterEffects({ sceneRef, feedRequests, onFeed }: WaterEffectsProps) {
  const handleWaterClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    onFeed([event.point.x, Math.min(event.point.y, 9.5), event.point.z])
  }

  return (
    <group>
      <GodRays />
      <WaterSurface />
      <AquaticDust />
      <Plankton />
      <Bubbles sceneRef={sceneRef} />
      <BubbleStreams sceneRef={sceneRef} />
      <Food sceneRef={sceneRef} requests={feedRequests} />

      {/* Esfera transparente (BackSide) que captura cliques na água de qualquer ângulo. */}
      <mesh position={[0, 3, 0]} onClick={handleWaterClick}>
        <sphereGeometry args={[34, 16, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.BackSide} />
      </mesh>
    </group>
  )
}
