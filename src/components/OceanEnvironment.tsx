import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { mulberry32, range } from '../scene/random'
import { ANEMONE_SITES } from '../scene/obstacles'
import { groundY, SEABED_Y, terrainEdge, terrainHeight } from '../scene/terrain'
import { SubmergedRuins } from './SubmergedRuins'

const WORLD = 120
/** Extensão apenas visual do terreno — os limites numéricos da lógica continuam os mesmos. */
const TERRAIN_SIZE = WORLD * 1.5
const dummy = new THREE.Object3D()

/** Cria um recurso Three e libera a GPU quando o componente desmonta. */
function useDisposable<T extends { dispose: () => void }>(factory: () => T): T {
  const resource = useMemo(factory, [])
  useEffect(() => () => resource.dispose(), [resource])
  return resource
}

/** Fundo em camadas: ciano luminoso no topo, turquesa no meio, azul profundo embaixo. */
function WaterColorLayers() {
  const geometry = useDisposable(() => new THREE.SphereGeometry(130, 40, 28))
  const material = useDisposable(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTop: { value: new THREE.Color('#e6fdff') },
          uMid: { value: new THREE.Color('#8fdcee') },
          uLow: { value: new THREE.Color('#2f96c2') },
          uDeep: { value: new THREE.Color('#0b3c66') },
        },
        vertexShader: /* glsl */ `
          varying vec3 vWorld;
          void main() {
            vec4 world = modelMatrix * vec4(position, 1.0);
            vWorld = world.xyz;
            gl_Position = projectionMatrix * viewMatrix * world;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop;
          uniform vec3 uMid;
          uniform vec3 uLow;
          uniform vec3 uDeep;
          varying vec3 vWorld;
          void main() {
            vec3 dir = normalize(vWorld);
            float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
            vec3 col = mix(uDeep, uLow, smoothstep(0.04, 0.42, h));
            col = mix(col, uMid, smoothstep(0.36, 0.66, h));
            col = mix(col, uTop, smoothstep(0.62, 0.98, h));
            float shaft = pow(max(0.0, 1.0 - abs(dir.x * 0.8 + dir.z * 0.35)), 5.0);
            col += vec3(0.16, 0.24, 0.22) * shaft * smoothstep(0.5, 1.0, h);
            gl_FragColor = vec4(col, 1.0);
          }
        `,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      })
  )

  return <mesh geometry={geometry} material={material} renderOrder={-10} frustumCulled={false} />
}

/** Assoalho com dunas esculpidas, ripples de areia e caustics animadas por cima. */
function Seabed() {
  const causticUniforms = useMemo(() => ({ uTime: { value: 0 } }), [])

  const geometry = useDisposable(() => {
    const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, 168, 168)
    const pos = geo.attributes.position as THREE.BufferAttribute
    const colors = new Float32Array(pos.count * 3)
    const tint = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      const r = Math.hypot(x, y)
      const outer = THREE.MathUtils.smoothstep(r, 26, terrainEdge(Math.atan2(y, x)))
      pos.setZ(i, terrainHeight(x, y))

      const tone = Math.sin(x * 0.42) * Math.cos(y * 0.37) * 0.5 + Math.sin((x + y) * 0.16) * 0.5
      tint.setHSL(
        0.105 + outer * 0.44 + tone * 0.005,
        0.4 - outer * 0.14,
        0.8 + tone * 0.035 - outer * 0.32
      )
      tint.toArray(colors, i * 3)
    }
    pos.needsUpdate = true
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geo.computeVertexNormals()
    return geo
  })

  // Caustics projetadas diretamente no relevo: sem plano sobreposto, sem z-fighting.
  const terrainMaterial = useDisposable(() => {
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.98,
      metalness: 0,
    })
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = causticUniforms.uTime
      shader.vertexShader = `uniform float uTime;
varying vec3 vCausticPos;
${shader.vertexShader}`.replace(
        '#include <project_vertex>',
        /* glsl */ `#include <project_vertex>
          vCausticPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        `
      )
      shader.fragmentShader = `uniform float uTime;
varying vec3 vCausticPos;
${shader.fragmentShader}`.replace(
        '#include <dithering_fragment>',
        /* glsl */ `
          vec2 cp = vCausticPos.xz * 0.34 + vec2(uTime * 0.07, -uTime * 0.05);
          float a = sin(cp.x * 1.02 + uTime * 0.72) * sin(cp.y - uTime * 0.5);
          float b = sin(cp.x * 0.68 - cp.y * 1.24 + uTime * 0.6);
          float c = sin(cp.x * 1.7 + cp.y * 0.9 - uTime * 0.85);
          float web = pow(max(0.0, a * b * b), 3.0);
          float fine = pow(max(0.0, b * c), 6.0) * 0.5;
          float radial = 1.0 - smoothstep(46.0, 68.0, length(vCausticPos.xz));
          gl_FragColor.rgb += vec3(0.72, 0.95, 0.86) * clamp(web + fine, 0.0, 1.0) * 0.22 * radial;
          #include <dithering_fragment>
        `
      )
    }
    mat.customProgramCacheKey = () => 'terrain-caustics-projected'
    return mat
  })

  useFrame((state) => {
    causticUniforms.uTime.value = state.clock.elapsedTime
  })

  return (
    <mesh
      geometry={geometry}
      material={terrainMaterial}
      rotation-x={-Math.PI / 2}
      position-y={SEABED_Y}
      receiveShadow
      frustumCulled={false}
    />
  )
}

/** Rochas esculpidas por ruído e seixos claros espalhados pelo assoalho. */
function Rocks() {
  const rocks = useRef<THREE.InstancedMesh>(null)
  const pebbles = useRef<THREE.InstancedMesh>(null)

  const rockGeo = useDisposable(() => {
    const geo = new THREE.IcosahedronGeometry(1, 2)
    const pos = geo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      const z = pos.getZ(i)
      const n =
        1 +
        Math.sin(x * 3.1 + y * 2.3) * 0.09 +
        Math.cos(z * 2.7 - x * 1.9) * 0.07 +
        Math.sin(y * 5.3 + z * 4.1) * 0.035
      pos.setXYZ(i, x * n, y * n * 0.84, z * n)
    }
    pos.needsUpdate = true
    geo.computeVertexNormals()
    geo.computeBoundingSphere()
    return geo
  })
  const pebbleGeo = useDisposable(() => new THREE.IcosahedronGeometry(0.16, 1))

  useLayoutEffect(() => {
    const rng = mulberry32(42)
    const color = new THREE.Color()
    if (rocks.current) {
      for (let i = 0; i < 46; i++) {
        const angle = rng() * Math.PI * 2
        const radius = range(rng, 8, 52)
        const scale = range(rng, 0.6, 2.4)
        const x = Math.cos(angle) * radius
        const z = Math.sin(angle) * radius
        dummy.position.set(x, SEABED_Y + terrainHeight(x, z) + scale * 0.35, z)
        dummy.rotation.set(rng() * 3, rng() * 3, rng() * 3)
        dummy.scale.set(scale, scale * range(rng, 0.5, 0.9), scale)
        dummy.updateMatrix()
        rocks.current.setMatrixAt(i, dummy.matrix)
        color.setHSL(range(rng, 0.1, 0.14), 0.18, range(rng, 0.56, 0.76))
        rocks.current.setColorAt(i, color)
      }
      rocks.current.instanceMatrix.needsUpdate = true
      if (rocks.current.instanceColor) rocks.current.instanceColor.needsUpdate = true
    }

    if (pebbles.current) {
      for (let i = 0; i < 90; i++) {
        const angle = rng() * Math.PI * 2
        const radius = range(rng, 6, 48)
        const x = Math.cos(angle) * radius
        const z = Math.sin(angle) * radius
        dummy.position.set(x, SEABED_Y + terrainHeight(x, z) + 0.12, z)
        dummy.rotation.set(rng() * 3, rng() * 3, rng() * 3)
        dummy.scale.setScalar(range(rng, 0.5, 1.6))
        dummy.updateMatrix()
        pebbles.current.setMatrixAt(i, dummy.matrix)
        color.setHSL(range(rng, 0.1, 0.14), 0.32, range(rng, 0.72, 0.9))
        pebbles.current.setColorAt(i, color)
      }
      pebbles.current.instanceMatrix.needsUpdate = true
      if (pebbles.current.instanceColor) pebbles.current.instanceColor.needsUpdate = true
    }
  }, [])

  return (
    <group>
      <instancedMesh ref={rocks} args={[rockGeo, undefined, 46]} castShadow receiveShadow frustumCulled={false}>
        <meshStandardMaterial roughness={0.92} metalness={0.02} />
      </instancedMesh>
      <instancedMesh ref={pebbles} args={[pebbleGeo, undefined, 90]} receiveShadow frustumCulled={false}>
        <meshStandardMaterial roughness={0.85} metalness={0.02} />
      </instancedMesh>
    </group>
  )
}

/** Coral ramificado orgânico: tronco curvo e cinco galhos de espessuras diferentes. */
function createBranchGeometry() {
  const parts: THREE.BufferGeometry[] = []
  const trunk = new THREE.CylinderGeometry(0.055, 0.2, 1.05, 6)
  trunk.translate(0, 0.52, 0)
  parts.push(trunk)

  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    const height = 0.5 + (i % 3) * 0.14
    const branch = new THREE.CylinderGeometry(0.022, 0.075, height, 5)
    branch.rotateZ(0.48 + (i % 2) * 0.16)
    branch.rotateY(a)
    branch.translate(Math.cos(a) * 0.2, 0.72 + i * 0.07, Math.sin(a) * 0.2)
    parts.push(branch)
  }

  const merged = mergeGeometries(parts, false)
  parts.forEach((part) => part.dispose())
  if (!merged) throw new Error('Falha ao montar coral ramificado')
  merged.computeVertexNormals()
  merged.computeBoundingSphere()
  return merged
}

/** Coral tubular: quatro tubos com bordas orgânicas, mesclados em uma instância. */
function createTubeGeometry() {
  const parts: THREE.BufferGeometry[] = []
  const heights = [1, 0.78, 0.58, 0.42]
  const offsets: Array<[number, number]> = [
    [0, 0],
    [0.25, 0.12],
    [-0.21, 0.18],
    [0.08, -0.24],
  ]
  heights.forEach((h, i) => {
    const radius = 0.085 + i * 0.011
    const tube = new THREE.CylinderGeometry(radius, 0.16, h, 8, 1, true)
    tube.translate(offsets[i][0], h / 2, offsets[i][1])
    parts.push(tube)
    const lip = new THREE.TorusGeometry(radius, 0.028, 5, 9)
    lip.rotateX(Math.PI / 2)
    lip.translate(offsets[i][0], h, offsets[i][1])
    parts.push(lip)
  })
  const merged = mergeGeometries(parts, false)
  parts.forEach((part) => part.dispose())
  if (!merged) throw new Error('Falha ao montar coral tubular')
  merged.computeVertexNormals()
  merged.computeBoundingSphere()
  return merged
}

/** Coral em leque: silhueta recortada por curvas e veios ondulados. */
function createFanGeometry() {
  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  shape.quadraticCurveTo(-0.78, 0.45, -0.72, 1.55)
  shape.quadraticCurveTo(0, 1.22, 0.72, 1.55)
  shape.quadraticCurveTo(0.78, 0.45, 0, 0)

  const geo = new THREE.ShapeGeometry(shape, 14)
  const pos = geo.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    pos.setZ(i, Math.sin(x * 5.2) * 0.075 + Math.sin(y * 3.1) * 0.04)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}

/** Coral-cérebro com sulcos esculpidos. */
function createBrainGeometry() {
  const geo = new THREE.SphereGeometry(0.64, 18, 14)
  const pos = geo.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const groove = Math.sin(x * 13) * Math.cos(y * 11) * 0.045 + Math.sin(z * 15) * 0.03
    const n = 1 + groove
    pos.setXYZ(i, x * n, y * n * 0.8, z * n)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}

/**
 * Material de recife: rim light e bioluminescência na cor da própria instância,
 * com uma leve correnteza no vertex shader. Cada modelo recebe uma chave de cache
 * própria para não reaproveitar o programa de outro material.
 */
function createReefMaterial(time: { value: number }, doubleSided: boolean, cacheKey: string) {
  const mat = new THREE.MeshStandardMaterial({
    roughness: 0.72,
    metalness: 0.02,
    side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  })
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time
    shader.vertexShader = `uniform float uTime;
varying vec3 vReefNormal;
varying vec3 vReefView;
varying vec3 vReefTint;
${shader.vertexShader}`
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
          float h = max(0.0, transformed.y);
          float phase = instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.19;
          transformed.x += sin(uTime * 0.55 + h * 0.6 + phase) * h * 0.012;
          transformed.z += cos(uTime * 0.42 + h * 0.5 + phase) * h * 0.01;
        `
      )
      .replace(
        '#include <project_vertex>',
        /* glsl */ `#include <project_vertex>
          vReefNormal = normalize(normalMatrix * normal);
          vReefView = normalize(-mvPosition.xyz);
          #ifdef USE_INSTANCING_COLOR
            vReefTint = instanceColor;
          #else
            vReefTint = vec3(1.0);
          #endif
        `
      )
    shader.fragmentShader = `uniform float uTime;
varying vec3 vReefNormal;
varying vec3 vReefView;
varying vec3 vReefTint;
${shader.fragmentShader}`.replace(
      '#include <dithering_fragment>',
      /* glsl */ `
        float rim = pow(1.0 - clamp(dot(normalize(vReefNormal), normalize(vReefView)), 0.0, 1.0), 2.4);
        float breathe = 0.5 + 0.5 * sin(uTime * 1.15 + vReefView.x * 2.4 + vReefView.y);
        gl_FragColor.rgb += vReefTint * rim * 0.3;
        gl_FragColor.rgb += vReefTint * (0.025 + breathe * 0.035);
        #include <dithering_fragment>
      `
    )
  }
  mat.customProgramCacheKey = () => cacheKey
  return mat
}

/** Recife vibrante: cérebro, ramificado, leque e tubular em paleta ABZÛ. */
function CoralReef() {
  const brainRef = useRef<THREE.InstancedMesh>(null)
  const branchRef = useRef<THREE.InstancedMesh>(null)
  const fanRef = useRef<THREE.InstancedMesh>(null)
  const tubeRef = useRef<THREE.InstancedMesh>(null)
  const groupRef = useRef<THREE.Group>(null)

  const brainGeo = useDisposable(createBrainGeometry)
  const branchGeo = useDisposable(createBranchGeometry)
  const fanGeo = useDisposable(createFanGeometry)
  const tubeGeo = useDisposable(createTubeGeometry)
  const time = useMemo(() => ({ value: 0 }), [])
  const solidMaterial = useDisposable(() => createReefMaterial(time, false, 'reef-solid-rim'))
  const sheetMaterial = useDisposable(() => createReefMaterial(time, true, 'reef-sheet-rim'))

  useLayoutEffect(() => {
    if (!brainRef.current || !branchRef.current || !fanRef.current || !tubeRef.current) return
    const rng = mulberry32(7)
    const color = new THREE.Color()
    const palette = [
      '#ff7fa8', '#ff9b52', '#ffd166', '#4fd8ae',
      '#7fe3f5', '#c08bff', '#ff6f91', '#f5c26b',
    ]
    const place = (mesh: THREE.InstancedMesh, index: number, yLift: number, variant: number) => {
      const cluster = index % 8
      const angle = (cluster / 8) * Math.PI * 2 + range(rng, -0.42, 0.42)
      const radius = range(rng, 10, 36)
      const x = Math.cos(angle) * radius + range(rng, -5, 5)
      const z = Math.sin(angle) * radius + range(rng, -5, 5)
      dummy.position.set(x, SEABED_Y + terrainHeight(x, z) + 0.08 + yLift, z)
      dummy.rotation.set(range(rng, -0.12, 0.12), rng() * Math.PI * 2, range(rng, -0.12, 0.12))
      const s = range(rng, 0.65, 1.45)
      dummy.scale.set(s, s * range(rng, 0.85, 1.3), s)
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)
      color.set(palette[(index + variant) % palette.length]).offsetHSL(0, 0, range(rng, -0.03, 0.04))
      mesh.setColorAt(index, color)
    }

    for (let i = 0; i < 110; i++) place(brainRef.current, i, range(rng, 0, 0.4), 0)
    for (let i = 0; i < 80; i++) place(branchRef.current, i, 0, 2)
    for (let i = 0; i < 46; i++) place(fanRef.current, i, 0.05, 4)
    for (let i = 0; i < 42; i++) place(tubeRef.current, i, 0, 6)

    for (const mesh of [brainRef.current, branchRef.current, fanRef.current, tubeRef.current]) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }, [])

  useFrame((state) => {
    time.value = state.clock.elapsedTime
    if (!groupRef.current) return
    groupRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.28) * 0.004
  })

  return (
    <group ref={groupRef}>
      <instancedMesh
        ref={brainRef}
        args={[brainGeo, solidMaterial, 110]}
        castShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={branchRef}
        args={[branchGeo, solidMaterial, 80]}
        castShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={fanRef}
        args={[fanGeo, sheetMaterial, 46]}
        castShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={tubeRef}
        args={[tubeGeo, sheetMaterial, 42]}
        castShadow
        frustumCulled={false}
      />
    </group>
  )
}

/** Corais moles com deformação procedural: balançam como se fossem vivos. */
function SoftCorals() {
  const ref = useRef<THREE.InstancedMesh>(null)
  const time = useMemo(() => ({ value: 0 }), [])
  const geometry = useDisposable(() => {
    const geo = new THREE.SphereGeometry(0.28, 10, 8)
    geo.scale(0.55, 1.7, 0.55)
    geo.translate(0, 1.7, 0)
    geo.computeVertexNormals()
    geo.computeBoundingSphere()
    return geo
  })
  const material = useDisposable(() => {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.7, side: THREE.DoubleSide })
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time
      shader.vertexShader = `uniform float uTime;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
          float h = max(0.0, transformed.y - 0.35);
          float phase = instanceMatrix[3].x * 0.4 + instanceMatrix[3].z * 0.27;
          transformed.x += sin(uTime * 1.15 + h * 0.9 + phase) * h * 0.045;
          transformed.z += cos(uTime * 0.85 + h * 0.7 + phase) * h * 0.035;
        `
      )
    }
    mat.customProgramCacheKey = () => 'soft-coral-sway'
    return mat
  })

  useLayoutEffect(() => {
    if (!ref.current) return
    const rng = mulberry32(1337)
    const color = new THREE.Color()
    const palette = ['#ff85b3', '#ffb15c', '#ffe08a', '#63e0b4', '#8ae6f7', '#bf9bff']
    for (let i = 0; i < 60; i++) {
      const angle = rng() * Math.PI * 2
      const radius = range(rng, 9, 40)
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius
      dummy.position.set(x, SEABED_Y + terrainHeight(x, z) + 0.05, z)
      dummy.rotation.set(0, rng() * Math.PI * 2, 0)
      dummy.scale.setScalar(range(rng, 0.55, 1.35))
      dummy.updateMatrix()
      ref.current.setMatrixAt(i, dummy.matrix)
      ref.current.setColorAt(i, color.set(palette[i % palette.length]))
    }
    ref.current.instanceMatrix.needsUpdate = true
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true
  }, [])

  useFrame((state) => {
    time.value = state.clock.elapsedTime
  })

  return <instancedMesh ref={ref} args={[geometry, material, 60]} castShadow frustumCulled={false} />
}

/** Grama marinha que cobre os vãos do recife com ondulação suave. */
function SeaGrass() {
  const ref = useRef<THREE.InstancedMesh>(null)
  const time = useMemo(() => ({ value: 0 }), [])
  const geometry = useDisposable(() => {
    const geo = new THREE.PlaneGeometry(0.24, 1.5, 1, 6)
    geo.translate(0, 0.75, 0)
    geo.computeBoundingSphere()
    return geo
  })
  const material = useDisposable(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#69dca5',
      side: THREE.DoubleSide,
      roughness: 0.9,
    })
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time
      shader.vertexShader = `uniform float uTime;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
          float h = max(0.0, transformed.y);
          float phase = instanceMatrix[3].x * 0.6 + instanceMatrix[3].z * 0.44;
          transformed.x += sin(uTime * 1.6 + h * 1.5 + phase) * h * 0.07;
          transformed.z += cos(uTime * 1.1 + h * 1.1 + phase) * h * 0.05;
        `
      )
    }
    mat.customProgramCacheKey = () => 'sea-grass-sway'
    return mat
  })

  useLayoutEffect(() => {
    if (!ref.current) return
    const rng = mulberry32(2718)
    const color = new THREE.Color()
    for (let i = 0; i < 150; i++) {
      const angle = rng() * Math.PI * 2
      const radius = range(rng, 6, 46)
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius
      dummy.position.set(x, SEABED_Y + terrainHeight(x, z) + 0.04, z)
      dummy.rotation.set(0, rng() * Math.PI, 0)
      dummy.scale.setScalar(range(rng, 0.7, 1.6))
      dummy.updateMatrix()
      ref.current.setMatrixAt(i, dummy.matrix)
      color.setHSL(range(rng, 0.32, 0.43), 0.45, range(rng, 0.55, 0.72))
      ref.current.setColorAt(i, color)
    }
    ref.current.instanceMatrix.needsUpdate = true
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true
  }, [])

  useFrame((state) => {
    time.value = state.clock.elapsedTime
  })

  return <instancedMesh ref={ref} args={[geometry, material, 150]} frustumCulled={false} />
}

/** Algas (kelp) com ondulação procedural injetada no vertex shader. */
function KelpForest() {
  const ref = useRef<THREE.InstancedMesh>(null)
  const time = useMemo(() => ({ value: 0 }), [])
  const geometry = useDisposable(() => {
    const geo = new THREE.PlaneGeometry(0.42, 7, 1, 12)
    geo.translate(0, 3.5, 0)
    geo.computeBoundingSphere()
    return geo
  })

  const material = useDisposable(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#6fe0a8',
      side: THREE.DoubleSide,
      roughness: 0.85,
    })
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time
      shader.vertexShader = `uniform float uTime;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
          float h = max(0.0, transformed.y);
          float phase = instanceMatrix[3].x * 0.35 + instanceMatrix[3].z * 0.21;
          transformed.x += sin(uTime * 0.9 + h * 0.55 + phase) * h * 0.055;
          transformed.z += cos(uTime * 0.65 + h * 0.42 + phase) * h * 0.035;
        `
      )
    }
    mat.customProgramCacheKey = () => 'kelp-current-sway'
    return mat
  })

  useLayoutEffect(() => {
    if (!ref.current) return
    const rng = mulberry32(99)
    const color = new THREE.Color()
    for (let i = 0; i < 110; i++) {
      const angle = rng() * Math.PI * 2
      const radius = range(rng, 14, 46)
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius
      dummy.position.set(x, SEABED_Y + terrainHeight(x, z) + 0.05, z)
      dummy.rotation.set(0, rng() * Math.PI, 0)
      dummy.scale.setScalar(range(rng, 0.7, 1.8))
      dummy.updateMatrix()
      ref.current.setMatrixAt(i, dummy.matrix)
      color.setHSL(range(rng, 0.34, 0.44), 0.52, range(rng, 0.5, 0.7))
      ref.current.setColorAt(i, color)
    }
    ref.current.instanceMatrix.needsUpdate = true
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true
  }, [])

  useFrame((state) => {
    time.value = state.clock.elapsedTime
  })

  return <instancedMesh ref={ref} args={[geometry, material, 110]} castShadow frustumCulled={false} />
}

/** Anêmonas: casa dos peixes-palhaço, com tentáculos em cápsula e boca central. */
function Anemones() {
  const ref = useRef<THREE.InstancedMesh>(null)
  const geometry = useDisposable(() => {
    const geo = new THREE.CapsuleGeometry(0.09, 0.42, 3, 6)
    geo.computeBoundingSphere()
    return geo
  })
  const groupRef = useRef<THREE.Group>(null)

  useLayoutEffect(() => {
    if (!ref.current) return
    const rng = mulberry32(123)
    const color = new THREE.Color()
    let i = 0
    for (const { x: cx, z: cz } of ANEMONE_SITES) {
      const baseY = groundY(cx, cz)
      for (let t = 0; t < 26; t++) {
        const a = rng() * Math.PI * 2
        const r = range(rng, 0.1, 1.5)
        dummy.position.set(
          cx + Math.cos(a) * r,
          baseY + range(rng, 0.2, 1.4),
          cz + Math.sin(a) * r
        )
        dummy.rotation.set(range(rng, -0.4, 0.4), rng() * 3, range(rng, -0.4, 0.4))
        dummy.scale.set(range(rng, 0.6, 1.4), range(rng, 1.4, 3.2), range(rng, 0.6, 1.4))
        dummy.updateMatrix()
        ref.current.setMatrixAt(i, dummy.matrix)
        color.set(t % 3 === 0 ? '#fff0f7' : '#ff9ecb')
        ref.current.setColorAt(i, color)
        i++
      }
    }
    ref.current.instanceMatrix.needsUpdate = true
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true
  }, [])

  useFrame((state) => {
    if (!groupRef.current) return
    groupRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.3) * 0.03
  })

  return (
    <group ref={groupRef}>
      {ANEMONE_SITES.map(({ x, z }, i) => (
        <mesh key={i} position={[x, groundY(x, z), z]} receiveShadow>
          <cylinderGeometry args={[0.5, 0.65, 0.24, 14]} />
          <meshStandardMaterial color="#ffb9d8" roughness={0.7} />
        </mesh>
      ))}
      <instancedMesh
        ref={ref}
        args={[geometry, undefined, ANEMONE_SITES.length * 26]}
        frustumCulled={false}
      >
        <meshStandardMaterial roughness={0.62} emissive="#ff9ac8" emissiveIntensity={0.07} />
      </instancedMesh>
    </group>
  )
}

/**
 * Emoldura o horizonte com falésias estratificadas, agulhas de cânion e
 * bancos de corais frios. Tudo é estático e fica fora da área jogável
 * (raio >= 46), apenas camuflagem visual do fim do cenário.
 */
function PerimeterFormations() {
  const cliffRef = useRef<THREE.InstancedMesh>(null)
  const spireRef = useRef<THREE.InstancedMesh>(null)
  const bankRef = useRef<THREE.InstancedMesh>(null)

  const cliffGeo = useDisposable(() => {
    const geo = new THREE.IcosahedronGeometry(1, 2)
    const pos = geo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      const z = pos.getZ(i)
      const strata = 1 + Math.sin(y * 9) * 0.06 + Math.cos(x * 4 + z * 3) * 0.1
      pos.setXYZ(i, x * strata, y * strata * 0.9, z * strata)
    }
    pos.needsUpdate = true
    geo.computeVertexNormals()
    geo.computeBoundingBox()
    geo.computeBoundingSphere()
    return geo
  })

  const spireGeo = useDisposable(() => {
    const geo = new THREE.ConeGeometry(1, 1, 7, 3)
    const pos = geo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      const z = pos.getZ(i)
      const n = 1 + Math.sin(y * 7 + x * 3) * 0.09
      pos.setXYZ(i, x * n, y, z * n)
    }
    pos.needsUpdate = true
    geo.computeVertexNormals()
    geo.computeBoundingBox()
    geo.computeBoundingSphere()
    return geo
  })

  const bankGeo = useDisposable(createBranchGeometry)

  useLayoutEffect(() => {
    if (!cliffRef.current || !spireRef.current || !bankRef.current) return
    const rng = mulberry32(314159)
    const color = new THREE.Color()
    const tau = Math.PI * 2

    for (let i = 0; i < 54; i++) {
      const angle = (i / 54) * tau + range(rng, -0.045, 0.045)
      const radius =
        60 + Math.sin(angle * 3 + 0.7) * 7 + Math.sin(angle * 7 - 1.2) * 3.5 + range(rng, -3, 3)
      const height = range(rng, 5, 13)
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius
      dummy.position.set(x, groundY(x, z) + height * 0.62, z)
      dummy.rotation.set(
        range(rng, -0.07, 0.07),
        angle + range(rng, -0.6, 0.6),
        range(rng, -0.07, 0.07)
      )
      dummy.scale.set(range(rng, 3.6, 7.5), height, range(rng, 3.6, 7.5))
      dummy.updateMatrix()
      cliffRef.current.setMatrixAt(i, dummy.matrix)
      color.setHSL(range(rng, 0.5, 0.56), range(rng, 0.16, 0.3), range(rng, 0.48, 0.64))
      cliffRef.current.setColorAt(i, color)
    }

    for (let i = 0; i < 38; i++) {
      const angle = (i / 38) * tau + 0.12 + range(rng, -0.08, 0.08)
      const radius = 52 + Math.sin(angle * 5 - 0.4) * 5 + range(rng, -4, 4)
      const height = range(rng, 7, 17)
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius
      dummy.position.set(x, groundY(x, z) + height * 0.32, z)
      dummy.rotation.set(range(rng, -0.16, 0.16), rng() * tau, range(rng, -0.16, 0.16))
      dummy.scale.set(range(rng, 1.4, 3.2), height, range(rng, 1.4, 3.2))
      dummy.updateMatrix()
      spireRef.current.setMatrixAt(i, dummy.matrix)
      color.setHSL(range(rng, 0.5, 0.55), 0.22, range(rng, 0.52, 0.7))
      spireRef.current.setColorAt(i, color)
    }

    const bankHues = [0.93, 0.06, 0.12, 0.48]
    for (let i = 0; i < 72; i++) {
      const angle = (i / 72) * tau + range(rng, -0.2, 0.2)
      const radius = range(rng, 46, 58)
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius
      dummy.position.set(x, groundY(x, z) - 0.08, z)
      dummy.rotation.set(0, rng() * tau, 0)
      dummy.scale.setScalar(range(rng, 1.4, 3))
      dummy.updateMatrix()
      bankRef.current.setMatrixAt(i, dummy.matrix)
      color.setHSL(
        bankHues[i % bankHues.length] + range(rng, -0.012, 0.012),
        range(rng, 0.4, 0.65),
        range(rng, 0.52, 0.7)
      )
      bankRef.current.setColorAt(i, color)
    }

    for (const mesh of [cliffRef.current, spireRef.current, bankRef.current]) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }, [])

  return (
    <group>
      <instancedMesh
        ref={cliffRef}
        args={[cliffGeo, undefined, 54]}
        castShadow
        receiveShadow
        frustumCulled={false}
      >
        <meshStandardMaterial roughness={0.96} metalness={0} />
      </instancedMesh>
      <instancedMesh
        ref={spireRef}
        args={[spireGeo, undefined, 38]}
        castShadow
        receiveShadow
        frustumCulled={false}
      >
        <meshStandardMaterial roughness={0.93} />
      </instancedMesh>
      <instancedMesh ref={bankRef} args={[bankGeo, undefined, 72]} castShadow frustumCulled={false}>
        <meshStandardMaterial roughness={0.8} side={THREE.DoubleSide} />
      </instancedMesh>
    </group>
  )
}

/** Fundo do oceano: camadas de água, areia, recife, ruínas e vida bentônica. */
export function OceanEnvironment() {
  return (
    <group>
      <WaterColorLayers />
      <Seabed />
      <Rocks />
      <CoralReef />
      <SoftCorals />
      <SeaGrass />
      <SubmergedRuins />
      <KelpForest />
      <Anemones />
      <PerimeterFormations />
    </group>
  )
}
