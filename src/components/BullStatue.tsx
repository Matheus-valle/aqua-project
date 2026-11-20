import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { createBullStatueGeometry } from '../scene/bull'
import { mulberry32, range } from '../scene/random'
import { MONUMENT } from '../scene/obstacles'

const dummy = new THREE.Object3D()
const TAU = Math.PI * 2

function useDisposable<T extends { dispose: () => void }>(factory: () => T): T {
  const resource = useMemo(factory, [])
  useEffect(() => () => resource.dispose(), [resource])
  return resource
}

/** Mármore branco polido: veios frios, brilho acetinado e cáusticas de cima. */
function createBullStoneMaterial(time: { value: number }) {
  const mat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    vertexColors: true,
    roughness: 0.3,
    metalness: 0.02,
    emissive: new THREE.Color('#d5efeb'),
    emissiveIntensity: 0.07,
  })
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time
    shader.vertexShader = `varying vec3 vBullWorld;
${shader.vertexShader}`.replace(
      '#include <project_vertex>',
      /* glsl */ `#include <project_vertex>
        vBullWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
      `
    )
    shader.fragmentShader = `uniform float uTime;
varying vec3 vBullWorld;
${shader.fragmentShader}`.replace(
      '#include <dithering_fragment>',
      /* glsl */ `
        vec2 cp = vBullWorld.xz * 0.32 + vec2(uTime * 0.06, -uTime * 0.045);
        float caustic = pow(max(0.0, sin(cp.x * 2.4) * sin(cp.y * 2.1)), 4.0);
        float veinWave = vBullWorld.x * 1.25 + vBullWorld.y * 0.62 + sin(vBullWorld.z * 1.9) * 0.9;
        float vein = pow(max(0.0, sin(veinWave)), 16.0);
        gl_FragColor.rgb *= 1.0 - vein * 0.07;
        gl_FragColor.rgb += vec3(0.58, 0.96, 0.84) * caustic * 0.14;
        #include <dithering_fragment>
      `
    )
  }
  mat.customProgramCacheKey = () => 'bull-marble-caustics'
  return mat
}

/** Ouro e turquesa discretos, com brilho subaquático contido. */
function createInlayMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    vertexColors: true,
    roughness: 0.32,
    metalness: 0.5,
    emissive: new THREE.Color('#0aa79c'),
    emissiveIntensity: 0.35,
  })
  return mat
}

const BARNACLES = 26
const CORALS = 30
const SLIME = 12

/**
 * Touro de mármore branco no centro: pedestal circular com escadaria, músculos
 * esculpidos e chifres curvados, ampliado por MONUMENT_SCALE. Cracas, corais e
 * um limo bem claro na base; bounding box/sphere e colisão usam o mesmo volume.
 */
export function BullStatue() {
  const { stone, inlay } = useMemo(createBullStatueGeometry, [])
  useEffect(
    () => () => {
      stone.dispose()
      inlay.dispose()
    },
    [stone, inlay]
  )

  const time = useMemo(() => ({ value: 0 }), [])
  const stoneMaterial = useDisposable(() => createBullStoneMaterial(time))
  const inlayMaterial = useDisposable(createInlayMaterial)

  const barnacleRef = useRef<THREE.InstancedMesh>(null)
  const coralRef = useRef<THREE.InstancedMesh>(null)
  const slimeRef = useRef<THREE.InstancedMesh>(null)

  const barnacleGeo = useDisposable(() => {
    const geo = new THREE.ConeGeometry(0.09, 0.18, 6)
    geo.translate(0, 0.09, 0)
    geo.computeBoundingSphere()
    return geo
  })
  const coralGeo = useDisposable(() => {
    const geo = new THREE.ConeGeometry(0.075, 0.28, 5)
    geo.translate(0, 0.14, 0)
    geo.computeBoundingSphere()
    return geo
  })
  const slimeGeo = useDisposable(() => {
    const geo = new THREE.SphereGeometry(0.24, 8, 6)
    geo.scale(1, 0.22, 0.7)
    geo.computeBoundingSphere()
    return geo
  })

  const barnacleMat = useDisposable(
    () => new THREE.MeshStandardMaterial({ color: '#d9d6bd', roughness: 0.95 })
  )
  const coralMat = useDisposable(
    () => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.74 })
  )
  const slimeMat = useDisposable(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#86b49b',
        roughness: 1,
        transparent: true,
        opacity: 0.72,
      })
  )

  useFrame((state) => {
    time.value = state.clock.elapsedTime
  })

  useLayoutEffect(() => {
    const rng = mulberry32(3141)
    const color = new THREE.Color()

    for (let i = 0; i < BARNACLES; i++) {
      const a = rng() * TAU
      const radius = range(rng, 2.78, 3.62)
      dummy.position.set(
        Math.cos(a) * radius,
        radius > 3.3 ? range(rng, 0.1, 0.65) : range(rng, 0.68, 0.92),
        Math.sin(a) * radius
      )
      dummy.rotation.set(range(rng, -0.3, 0.3), a, range(rng, -0.3, 0.3))
      dummy.scale.setScalar(range(rng, 0.65, 1.35))
      dummy.updateMatrix()
      barnacleRef.current?.setMatrixAt(i, dummy.matrix)
      barnacleRef.current?.setColorAt(i, color.setHSL(0.11, 0.1, range(rng, 0.72, 0.9)))
    }

    for (let i = 0; i < CORALS; i++) {
      const a = (i / CORALS) * TAU + range(rng, -0.12, 0.12)
      const radius = range(rng, 3.05, 3.68)
      dummy.position.set(Math.cos(a) * radius, range(rng, 0.18, 0.82), Math.sin(a) * radius)
      dummy.rotation.set(range(rng, -0.45, 0.45), a, range(rng, -0.45, 0.45))
      dummy.scale.setScalar(range(rng, 0.7, 1.5))
      dummy.updateMatrix()
      coralRef.current?.setMatrixAt(i, dummy.matrix)
      coralRef.current?.setColorAt(i, color.set(i % 3 === 0 ? '#ff90ad' : '#6fe0ce'))
    }

    for (let i = 0; i < SLIME; i++) {
      const a = (i / SLIME) * TAU + range(rng, -0.2, 0.2)
      const radius = range(rng, 3.1, 3.66)
      dummy.position.set(Math.cos(a) * radius, range(rng, 0.12, 0.7), Math.sin(a) * radius)
      dummy.rotation.set(0, a, 0)
      dummy.scale.set(range(rng, 0.7, 1.5), 1, range(rng, 0.7, 1.3))
      dummy.updateMatrix()
      slimeRef.current?.setMatrixAt(i, dummy.matrix)
    }

    for (const mesh of [barnacleRef.current, coralRef.current, slimeRef.current]) {
      if (!mesh) continue
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }, [])

  return (
    <group position={[MONUMENT.x, MONUMENT.foundationY, MONUMENT.z]}>
      <mesh geometry={stone} material={stoneMaterial} castShadow receiveShadow frustumCulled={false} />
      <mesh geometry={inlay} material={inlayMaterial} castShadow frustumCulled={false} />

      <instancedMesh
        ref={barnacleRef}
        args={[barnacleGeo, barnacleMat, BARNACLES]}
        castShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={coralRef}
        args={[coralGeo, coralMat, CORALS]}
        castShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={slimeRef}
        args={[slimeGeo, slimeMat, SLIME]}
        frustumCulled={false}
      />
    </group>
  )
}
