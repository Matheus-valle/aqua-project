import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Bloom, EffectComposer, Noise, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import type { FeedRequest, SceneRuntime } from '../scene/types'
import { OceanEnvironment } from './OceanEnvironment'
import { MarineLife } from './MarineLife'
import { SeaCreatures } from './SeaCreatures'
import { WaterEffects } from './WaterEffects'

interface CameraRigProps {
  focusId: string | null
  focusTick: number
  sceneRef: React.RefObject<SceneRuntime>
}

/** Segue suavemente o peixe selecionado, magneticamente ancorado no OrbitControls. */
function CameraRig({ focusId, focusTick, sceneRef }: CameraRigProps) {
  const camera = useThree((state) => state.camera)
  const controls = useThree((state) => state.controls)
  const desired = useMemo(() => new THREE.Vector3(), [])
  const offset = useMemo(() => new THREE.Vector3(0, 2.4, 8.5), [])
  const lastTick = useRef(focusTick)
  const active = useRef(false)

  useEffect(() => {
    active.current = Boolean(focusId)
    if (focusId) lastTick.current = focusTick
  }, [focusId, focusTick])

  useFrame((_, rawDelta) => {
    if (!active.current || !focusId) return
    const fish = sceneRef.current.fish.find((item) => item.id === focusId)
    if (!fish) return

    const dt = Math.min(rawDelta, 0.05)
    const follow = 1 - Math.exp(-dt * 2.4)
    const orbit = controls as unknown as { target: THREE.Vector3 } | null

    if (orbit?.target) orbit.target.lerp(fish.position, follow)
    desired.copy(fish.position).add(offset)
    camera.position.lerp(desired, follow * 0.75)
  })

  return null
}

/**
 * Iluminação ABZÛ: sol quente atravessando a água, céu turquesa refletido
 * na areia e dois preenchimentos difusos — nenhuma luz pontual saturada.
 */
function Lighting() {
  return (
    <>
      <ambientLight intensity={0.68} color="#eafaff" />
      <hemisphereLight args={['#dffaff', '#e8d6a8', 1]} />
      <directionalLight
        position={[12, 28, 10]}
        intensity={1.5}
        color="#fff3d8"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
        shadow-camera-near={1}
        shadow-camera-far={70}
        shadow-bias={-0.0005}
      />
      <directionalLight position={[-14, 18, -10]} intensity={0.38} color="#bfefff" />
      <directionalLight position={[8, 5, -18]} intensity={0.16} color="#ffd9a8" />
    </>
  )
}

export interface AquariumCanvasProps {
  sceneRef: React.RefObject<SceneRuntime>
  feedRequests: FeedRequest[]
  onFeed: (point: [number, number, number]) => void
  onSelectFish: (id: string) => void
  focusId: string | null
  focusTick: number
}

/** Canvas principal: câmera, iluminação, névoa, cena e pós-processamento. */
export function AquariumCanvas({
  sceneRef,
  feedRequests,
  onFeed,
  onSelectFish,
  focusId,
  focusTick,
}: AquariumCanvasProps) {
  return (
    <Canvas
      className="aquarium-canvas"
      dpr={[1, 1.75]}
      shadows
      resize={{ scroll: false, debounce: 0 }}
      camera={{ position: [0, 2, 18], fov: 55, near: 0.1, far: 200 }}
      gl={{
        antialias: true,
        powerPreference: 'high-performance',
        alpha: false,
        preserveDrawingBuffer: import.meta.env.DEV,
      }}
    >
      <color attach="background" args={['#8fd4e6']} />
      <fogExp2 attach="fog" args={['#52bad6', 0.015]} />

      <Lighting />
      <OceanEnvironment />
      <MarineLife sceneRef={sceneRef} onSelectFish={onSelectFish} />
      <SeaCreatures sceneRef={sceneRef} onSelect={onSelectFish} />
      <WaterEffects sceneRef={sceneRef} feedRequests={feedRequests} onFeed={onFeed} />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.055}
        rotateSpeed={0.45}
        zoomSpeed={0.65}
        panSpeed={0.5}
        minDistance={4.5}
        maxDistance={30}
        minPolarAngle={0.35}
        maxPolarAngle={Math.PI / 2.05}
        target={[0, 0, 0]}
        enablePan={false}
      />
      <CameraRig focusId={focusId} focusTick={focusTick} sceneRef={sceneRef} />

      <EffectComposer multisampling={0}>
        <Bloom intensity={0.42} luminanceThreshold={0.8} luminanceSmoothing={0.28} mipmapBlur />
        <Vignette offset={0.4} darkness={0.18} eskil={false} />
        <Noise opacity={0.008} />
      </EffectComposer>
    </Canvas>
  )
}
