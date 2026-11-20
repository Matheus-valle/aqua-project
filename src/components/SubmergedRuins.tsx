import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { mulberry32, range } from '../scene/random'
import { COLUMN_HEIGHT, RUIN_COLUMNS, RUIN_SITES, type StructureSite } from '../scene/obstacles'
import { foundationY, groundY } from '../scene/terrain'
import { BullStatue } from './BullStatue'

const dummy = new THREE.Object3D()
const TAU = Math.PI * 2

function useDisposable<T extends { dispose: () => void }>(factory: () => T): T {
  const resource = useMemo(factory, [])
  useEffect(() => () => resource.dispose(), [resource])
  return resource
}

/** Estrias e desgaste aplicados diretamente nos vértices, antes do computeVertexNormals. */
function flute(geo: THREE.BufferGeometry, count = 12, depth = 0.028) {
  const pos = geo.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const a = Math.atan2(z, x)
    const scale = 1 + Math.sin(a * count) * depth + Math.sin(y * 6.5 + a * 3) * depth * 0.35
    pos.setXYZ(i, x * scale, y, z * scale)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  return geo
}

/** Fecha uma peça mesclada com normais e volumes válidos para culling preciso. */
function finish(parts: THREE.BufferGeometry[], label: string) {
  // Uma peça pode vir sem índice (Octahedron, Extrude); o merge exige consistência.
  const needsFlatten = parts.some((part) => !part.index)
  const sources = needsFlatten
    ? parts.map((part) => (part.index ? part.toNonIndexed() : part))
    : parts
  const merged = mergeGeometries(sources, false)
  parts.forEach((part) => part.dispose())
  sources.forEach((source) => {
    if (!parts.includes(source)) source.dispose()
  })
  if (!merged) throw new Error(`Falha ao montar ${label}`)
  merged.computeVertexNormals()
  merged.computeBoundingBox()
  merged.computeBoundingSphere()
  return merged
}

/** Coluna inteira ou partida: a base local fica exatamente em y = 0. */
function createColumnGeometry(broken: boolean) {
  const parts: THREE.BufferGeometry[] = []
  const shaftHeight = broken ? 1.45 : COLUMN_HEIGHT - 0.72
  const shaftBottom = 0.32

  const shaft = new THREE.CylinderGeometry(0.46, 0.56, shaftHeight, 18, 8)
  shaft.translate(0, shaftBottom + shaftHeight / 2, 0)
  parts.push(flute(shaft, 12, 0.03))

  if (broken) {
    // Topo fraturado irregular e núcleo interno exposto.
    const pos = parts[0].attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i)
      if (y < shaftBottom + shaftHeight - 0.18) continue
      const a = Math.atan2(pos.getZ(i), pos.getX(i))
      pos.setY(i, y + Math.sin(a * 5 + 0.6) * 0.2 + Math.cos(a * 9) * 0.07)
    }
    pos.needsUpdate = true
    parts[0].computeVertexNormals()

    const coreTop = shaftBottom + shaftHeight
    const radii = [0.29, 0.19, 0.1]
    radii.forEach((radius, i) => {
      const core = new THREE.CylinderGeometry(radius * 0.86, radius, 0.1, 12)
      core.translate(0, coreTop + 0.03 + i * 0.085, 0)
      parts.push(core)
    })
    for (const side of [-1, 1]) {
      const chunk = new THREE.BoxGeometry(0.34, 0.16, 0.28)
      chunk.rotateY(side * 0.7)
      chunk.translate(side * 0.72, 0.1, side * 0.28)
      parts.push(chunk)
    }
  } else {
    const capital = new THREE.CylinderGeometry(0.8, 0.56, 0.3, 18)
    capital.translate(0, COLUMN_HEIGHT - 0.29, 0)
    parts.push(flute(capital, 12, 0.012))
    const abacus = new THREE.BoxGeometry(1.52, 0.14, 1.52)
    abacus.translate(0, COLUMN_HEIGHT - 0.07, 0)
    parts.push(abacus)
  }

  const plinth = new THREE.CylinderGeometry(0.76, 0.92, 0.32, 18)
  plinth.translate(0, 0.16, 0)
  parts.push(plinth)
  const torus = new THREE.CylinderGeometry(0.66, 0.7, 0.1, 18)
  torus.translate(0, 0.37, 0)
  parts.push(torus)

  return finish(parts, broken ? 'coluna partida' : 'coluna estriada')
}

/** Arquitrave assentada sobre os capitéis das duas colunas principais. */
function createArchitraveGeometry() {
  const parts: THREE.BufferGeometry[] = []
  const beam = new THREE.BoxGeometry(4.9, 0.42, 1.06)
  parts.push(beam)
  for (const side of [-1, 1]) {
    const band = new THREE.BoxGeometry(5.02, 0.1, 1.18)
    band.translate(0, side * 0.25, 0)
    parts.push(band)
  }
  for (let i = -2; i <= 2; i++) {
    const relief = new THREE.BoxGeometry(0.26, 0.09, 0.12)
    relief.translate(i * 0.92, 0, 0.56)
    parts.push(relief)
  }
  return finish(parts, 'arquitrave')
}

/** Arco monumentais em blocos independentes, com pilastras e pedra de fecho. */
function createArchGeometry() {
  const parts: THREE.BufferGeometry[] = []
  const radius = 2.1
  const spring = 1.35

  for (const side of [-1, 1]) {
    const pier = new THREE.BoxGeometry(0.86, spring, 1.08)
    pier.translate(side * radius, spring / 2, 0)
    parts.push(pier)
    const base = new THREE.BoxGeometry(1.16, 0.28, 1.36)
    base.translate(side * radius, 0.14, 0)
    parts.push(base)
  }

  const blocks = 14
  for (let i = 0; i < blocks; i++) {
    const a = (i / (blocks - 1)) * Math.PI
    const wear = Math.sin(i * 2.7) * 0.035
    const block = new THREE.BoxGeometry(0.5, 0.64 + Math.cos(i * 1.7) * 0.05, 1.02)
    block.rotateZ(a - Math.PI / 2)
    block.translate(
      Math.cos(a) * (radius + wear),
      spring + Math.sin(a) * (radius + wear),
      Math.sin(i * 3.1) * 0.02
    )
    parts.push(block)
  }

  const keystone = new THREE.BoxGeometry(0.72, 0.76, 1.22)
  keystone.translate(0, spring + radius + 0.04, 0)
  parts.push(keystone)

  return finish(parts, 'arco monumental')
}

/** Totem estilizado: perfil torneado, ombros angulares e cabeça facetada. */
function createTotemGeometry() {
  const profile = [
    new THREE.Vector2(0.62, 0),
    new THREE.Vector2(0.68, 0.18),
    new THREE.Vector2(0.52, 0.44),
    new THREE.Vector2(0.44, 0.78),
    new THREE.Vector2(0.54, 1.12),
    new THREE.Vector2(0.36, 1.48),
    new THREE.Vector2(0.42, 1.82),
    new THREE.Vector2(0.3, 2.18),
    new THREE.Vector2(0.12, 2.42),
  ]
  const parts: THREE.BufferGeometry[] = [new THREE.LatheGeometry(profile, 16)]
  for (const side of [-1, 1]) {
    const shoulder = new THREE.BoxGeometry(0.32, 0.22, 0.3)
    shoulder.rotateZ(side * 0.24)
    shoulder.translate(side * 0.46, 1.4, 0)
    parts.push(shoulder)
  }
  const head = new THREE.OctahedronGeometry(0.38, 0)
  head.scale(0.9, 1.1, 0.8)
  head.translate(0, 2.68, 0)
  parts.push(head)
  return finish(parts, 'totem')
}

/** Duna de areia que cobre parcialmente os degraus. */
function createDuneGeometry() {
  const geo = new THREE.SphereGeometry(1, 12, 8)
  geo.scale(1, 0.26, 0.82)
  geo.computeVertexNormals()
  geo.computeBoundingBox()
  geo.computeBoundingSphere()
  return geo
}

/** Craca cônica com anel calcário. */
function createBarnacleGeometry() {
  const cone = new THREE.ConeGeometry(0.085, 0.17, 6)
  cone.translate(0, 0.085, 0)
  const lip = new THREE.TorusGeometry(0.08, 0.028, 4, 7)
  lip.rotateX(Math.PI / 2)
  lip.translate(0, 0.02, 0)
  return finish([cone, lip], 'craca')
}

/** Pequeno coral crescendo nas frestas das pedras. */
function createCreviceCoralGeometry() {
  const parts: THREE.BufferGeometry[] = []
  const trunk = new THREE.CylinderGeometry(0.025, 0.06, 0.34, 5)
  trunk.translate(0, 0.17, 0)
  parts.push(trunk)
  for (const side of [-1, 1]) {
    const branch = new THREE.CylinderGeometry(0.014, 0.035, 0.25, 5)
    branch.rotateZ(side * 0.7)
    branch.translate(side * 0.11, 0.36, 0)
    parts.push(branch)
  }
  return finish(parts, 'coral de fresta')
}

/** Alga curva e achatada, presa à base das colunas. */
function createAlgaeGeometry() {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.12, 0.24, 0.05),
    new THREE.Vector3(0.05, 0.5, -0.04),
    new THREE.Vector3(0.2, 0.72, 0.02),
  ])
  const blade = new THREE.TubeGeometry(curve, 8, 0.022, 4, false)
  const leaf = new THREE.SphereGeometry(0.08, 7, 5)
  leaf.scale(0.6, 1.5, 0.25)
  leaf.translate(0.18, 0.66, 0.02)
  return finish([blade, leaf], 'alga de fresta')
}

/** Material de pedra com limo esverdeado no topo e caustics suaves. */
function createStoneMaterial(time: { value: number }) {
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.91, metalness: 0.02 })
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time
    shader.vertexShader = `varying vec3 vStoneLocal;
varying vec3 vStoneWorld;
${shader.vertexShader}`
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
          vStoneLocal = transformed;
        `
      )
      .replace(
        '#include <project_vertex>',
        /* glsl */ `#include <project_vertex>
          #ifdef USE_INSTANCING
            vStoneWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          #else
            vStoneWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
          #endif
        `
      )
    shader.fragmentShader = `uniform float uTime;
varying vec3 vStoneLocal;
varying vec3 vStoneWorld;
${shader.fragmentShader}`.replace(
      '#include <dithering_fragment>',
      /* glsl */ `
        float weathering = sin(vStoneLocal.x * 17.0 + vStoneLocal.z * 11.0) * sin(vStoneLocal.y * 9.0);
        gl_FragColor.rgb *= 1.0 + weathering * 0.045;
        float moss = smoothstep(1.6, 3.3, vStoneLocal.y);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * vec3(0.52, 0.88, 0.62), moss * 0.3);
        vec2 cp = vStoneWorld.xz * 0.3 + vec2(uTime * 0.06, -uTime * 0.045);
        float caustic = pow(max(0.0, sin(cp.x * 2.1) * sin(cp.y * 1.8)), 4.0);
        gl_FragColor.rgb += vec3(0.62, 0.9, 0.82) * caustic * 0.1;
        #include <dithering_fragment>
      `
    )
  }
  mat.customProgramCacheKey = () => 'ruin-stone-weathered'
  return mat
}

/** Incrustações douradas/turquesa com brilho suave e offset contra z-fighting. */
function createInlayMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.32,
    metalness: 0.55,
    emissive: '#000000',
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  })
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = `varying vec3 vInlayTint;
${shader.vertexShader}`.replace(
      '#include <project_vertex>',
      /* glsl */ `#include <project_vertex>
        #ifdef USE_INSTANCING_COLOR
          vInlayTint = instanceColor;
        #else
          vInlayTint = vec3(1.0);
        #endif
      `
    )
    shader.fragmentShader = `varying vec3 vInlayTint;
${shader.fragmentShader}`.replace(
      '#include <dithering_fragment>',
      /* glsl */ `
        gl_FragColor.rgb += vInlayTint * 0.22;
        #include <dithering_fragment>
      `
    )
  }
  mat.customProgramCacheKey = () => 'ruin-inlay-glow'
  return mat
}

const TOTEMS = [
  { x: -5, z: 7, rotation: 0.4 },
  { x: 13, z: 2, rotation: -0.7 },
  { x: -17, z: -3, rotation: 1.1 },
]

const INTEGRAS = RUIN_COLUMNS.filter((column) => !column.broken)
const PARTIDAS = RUIN_COLUMNS.filter((column) => column.broken)
const GLYPH_COUNT = RUIN_SITES.length * 3 + RUIN_COLUMNS.length * 2 + TOTEMS.length
const MOSS_COUNT = RUIN_COLUMNS.length * 2 + RUIN_SITES.length + 2
const STEP_COUNT = RUIN_SITES.length * 6
const DUNE_COUNT = RUIN_SITES.length * 3

/** Altura da arquitrave: média das fundações das duas colunas que a sustentam. */
function architraveY(site: StructureSite) {
  const dx = Math.cos(site.rotation) * 2
  const dz = -Math.sin(site.rotation) * 2
  return (
    (foundationY(site.x + dx, site.z + dz, 0.35) +
      foundationY(site.x - dx, site.z - dz, 0.35)) /
      2 +
    COLUMN_HEIGHT
  )
}

/**
 * Ruínas ABZÛ reconstruídas: fundações enterradas, colunas estriadas inteiras e
 * partidas, arquitraves, arcos em blocos, terraços com dunas, totens, incrustações
 * e vida orgânica nas frestas. Todas as bases usam getTerrainHeight via foundationY.
 */
export function SubmergedRuins() {
  const wholeRef = useRef<THREE.InstancedMesh>(null)
  const brokenRef = useRef<THREE.InstancedMesh>(null)
  const architraveRef = useRef<THREE.InstancedMesh>(null)
  const archRef = useRef<THREE.InstancedMesh>(null)
  const stepRef = useRef<THREE.InstancedMesh>(null)
  const duneRef = useRef<THREE.InstancedMesh>(null)
  const glyphRef = useRef<THREE.InstancedMesh>(null)
  const mossRef = useRef<THREE.InstancedMesh>(null)
  const barnacleRef = useRef<THREE.InstancedMesh>(null)
  const coralRef = useRef<THREE.InstancedMesh>(null)
  const algaeRef = useRef<THREE.InstancedMesh>(null)

  const wholeGeo = useDisposable(() => createColumnGeometry(false))
  const brokenGeo = useDisposable(() => createColumnGeometry(true))
  const architraveGeo = useDisposable(createArchitraveGeometry)
  const archGeo = useDisposable(createArchGeometry)
  const totemGeo = useDisposable(createTotemGeometry)
  const duneGeo = useDisposable(createDuneGeometry)
  const glyphGeo = useDisposable(() => new THREE.OctahedronGeometry(0.15, 0))
  const mossGeo = useDisposable(() => new THREE.SphereGeometry(0.32, 8, 6))
  const barnacleGeo = useDisposable(createBarnacleGeometry)
  const coralGeo = useDisposable(createCreviceCoralGeometry)
  const algaeGeo = useDisposable(createAlgaeGeometry)
  const stepGeo = useDisposable(() => {
    const geo = new THREE.BoxGeometry(1, 1, 1)
    geo.computeBoundingBox()
    geo.computeBoundingSphere()
    return geo
  })

  const time = useMemo(() => ({ value: 0 }), [])
  const stoneMaterial = useDisposable(() => createStoneMaterial(time))
  const inlayMaterial = useDisposable(createInlayMaterial)
  const mossMaterial = useDisposable(
    () => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 })
  )
  const barnacleMaterial = useDisposable(
    () => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.94 })
  )
  const coralMaterial = useDisposable(
    () => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.72 })
  )
  const algaeMaterial = useDisposable(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#ffffff',
        roughness: 0.88,
        side: THREE.DoubleSide,
      })
  )

  useFrame((state) => {
    time.value = state.clock.elapsedTime
  })

  useLayoutEffect(() => {
    const rng = mulberry32(555)
    const color = new THREE.Color()

    const setInstance = (
      mesh: THREE.InstancedMesh | null,
      index: number,
      x: number,
      y: number,
      z: number,
      rx: number,
      ry: number,
      rz: number,
      sx: number,
      sy: number,
      sz: number
    ) => {
      if (!mesh) return
      dummy.position.set(x, y, z)
      dummy.rotation.set(rx, ry, rz)
      dummy.scale.set(sx, sy, sz)
      dummy.updateMatrix()
      if (dummy.matrix.elements.every(Number.isFinite)) mesh.setMatrixAt(index, dummy.matrix)
    }

    INTEGRAS.forEach((column, i) => {
      setInstance(
        wholeRef.current,
        i,
        column.x,
        foundationY(column.x, column.z, 0.35),
        column.z,
        range(rng, -0.02, 0.02),
        column.rotation,
        range(rng, -0.02, 0.02),
        column.scale,
        column.scale,
        column.scale
      )
      wholeRef.current?.setColorAt(i, color.setHSL(0.12, 0.14, 0.75 + (i % 3) * 0.025))
    })

    PARTIDAS.forEach((column, i) => {
      setInstance(
        brokenRef.current,
        i,
        column.x,
        foundationY(column.x, column.z, 0.35),
        column.z,
        range(rng, -0.04, 0.04),
        column.rotation,
        range(rng, -0.05, 0.05),
        column.scale,
        column.scale,
        column.scale
      )
      brokenRef.current?.setColorAt(i, color.setHSL(0.12, 0.12, 0.71 + (i % 2) * 0.04))
    })

    RUIN_SITES.forEach((site, i) => {
      setInstance(
        architraveRef.current,
        i,
        site.x,
        architraveY(site) - 0.04,
        site.z,
        0,
        site.rotation,
        0,
        1,
        1,
        1
      )
      architraveRef.current?.setColorAt(i, color.set('#ded6bd'))

      setInstance(
        archRef.current,
        i,
        site.x,
        foundationY(site.x, site.z, 0.4),
        site.z,
        0,
        site.rotation,
        0,
        1,
        1,
        1
      )
      archRef.current?.setColorAt(i, color.set(i === 1 ? '#d7dcc0' : '#e2d9bf'))
    })

    // Escadarias e terraços: cada degrau é assentado na altura exata do terreno.
    RUIN_SITES.forEach((site, s) => {
      for (let step = 0; step < 6; step++) {
        const localX = 1.1 + step * 0.92
        const x = site.x + Math.cos(site.rotation) * localX
        const z = site.z - Math.sin(site.rotation) * localX
        const height = 0.34 + step * 0.13
        setInstance(
          stepRef.current,
          s * 6 + step,
          x,
          groundY(x, z) + height / 2 - 0.18,
          z,
          0,
          site.rotation,
          0,
          1.12,
          height,
          3.5 - step * 0.24
        )
        stepRef.current?.setColorAt(s * 6 + step, color.setHSL(0.12, 0.14, 0.74 - step * 0.02))
      }
      for (let d = 0; d < 3; d++) {
        const localX = 2.3 + d * 1.1
        const localZ = [-0.75, 0.85, 0.1][d]
        const x =
          site.x + Math.cos(site.rotation) * localX - Math.sin(site.rotation) * localZ
        const z =
          site.z - Math.sin(site.rotation) * localX + Math.cos(site.rotation) * localZ
        setInstance(
          duneRef.current,
          s * 3 + d,
          x,
          groundY(x, z) + 0.42 + d * 0.1,
          z,
          0,
          site.rotation + rng(),
          0,
          range(rng, 0.7, 1.25),
          range(rng, 0.7, 1.1),
          range(rng, 0.65, 1.1)
        )
        duneRef.current?.setColorAt(s * 3 + d, color.setHSL(0.11, 0.34, 0.8))
      }
    })

    const meshes = [
      wholeRef.current,
      brokenRef.current,
      architraveRef.current,
      archRef.current,
      stepRef.current,
      duneRef.current,
    ]
    for (const mesh of meshes) {
      if (!mesh) continue
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }, [])

  useLayoutEffect(() => {
    const rng = mulberry32(909)
    const color = new THREE.Color()

    let g = 0
    RUIN_COLUMNS.forEach((column) => {
      const base = foundationY(column.x, column.z, 0.35)
      for (let k = 0; k < 2; k++) {
        const a = column.rotation + (k === 0 ? 0.45 : Math.PI + 0.45)
        const r = 0.6 * column.scale
        const x = column.x + Math.cos(a) * r
        const z = column.z + Math.sin(a) * r
        const y = base + (1.15 + k * 0.6) * column.scale
        if (g >= GLYPH_COUNT) break
        dummy.position.set(x, y, z)
        dummy.rotation.set(0, a + Math.PI / 2, Math.PI / 4)
        dummy.scale.setScalar((0.85 + rng() * 0.4) * column.scale)
        dummy.updateMatrix()
        glyphRef.current?.setMatrixAt(g, dummy.matrix)
        glyphRef.current?.setColorAt(g, color.set(k % 2 ? '#4fd8d0' : '#f5c96b'))
        g++
      }
    })
    RUIN_SITES.forEach((site) => {
      for (let k = 0; k < 3; k++) {
        const localX = (k - 1) * 1.45
        const x = site.x + Math.cos(site.rotation) * localX + Math.sin(site.rotation) * 0.55
        const z = site.z - Math.sin(site.rotation) * localX + Math.cos(site.rotation) * 0.55
        if (g >= GLYPH_COUNT) break
        dummy.position.set(x, architraveY(site), z)
        dummy.rotation.set(0, site.rotation, Math.PI / 4)
        dummy.scale.setScalar(0.8 + rng() * 0.35)
        dummy.updateMatrix()
        glyphRef.current?.setMatrixAt(g, dummy.matrix)
        glyphRef.current?.setColorAt(g, color.set(k === 1 ? '#f5c96b' : '#4fd8d0'))
        g++
      }
    })
    TOTEMS.forEach((totem) => {
      if (g >= GLYPH_COUNT) return
      dummy.position.set(totem.x, foundationY(totem.x, totem.z, 0.35) + 2.45, totem.z)
      dummy.rotation.set(0, totem.rotation + Math.PI / 4, 0)
      dummy.scale.setScalar(1.15)
      dummy.updateMatrix()
      glyphRef.current?.setMatrixAt(g, dummy.matrix)
      glyphRef.current?.setColorAt(g, color.set('#4fd8d0'))
      g++
    })

    let m = 0
    RUIN_COLUMNS.forEach((column) => {
      const base = foundationY(column.x, column.z, 0.35)
      for (let k = 0; k < 2; k++) {
        const a = rng() * TAU
        const r = k === 0 ? 0.75 : 0.3
        const x = column.x + Math.cos(a) * r * column.scale
        const z = column.z + Math.sin(a) * r * column.scale
        const y =
          k === 0
            ? groundY(x, z) + 0.12
            : base + (column.broken ? 1.85 : COLUMN_HEIGHT) * column.scale - 0.05
        if (m >= MOSS_COUNT) break
        dummy.position.set(x, y, z)
        dummy.rotation.set(0, a, 0)
        dummy.scale.set(
          range(rng, 0.6, 1.3),
          range(rng, 0.18, 0.4),
          range(rng, 0.6, 1.3)
        )
        dummy.updateMatrix()
        mossRef.current?.setMatrixAt(m, dummy.matrix)
        mossRef.current?.setColorAt(m, color.setHSL(range(rng, 0.28, 0.4), 0.48, range(rng, 0.38, 0.56)))
        m++
      }
    })
    RUIN_SITES.forEach((site) => {
      if (m >= MOSS_COUNT) return
      const y = foundationY(site.x, site.z, 0.4) + 3.5
      dummy.position.set(site.x, y, site.z)
      dummy.rotation.set(0, site.rotation, 0)
      dummy.scale.set(1.4, 0.22, 0.5)
      dummy.updateMatrix()
      mossRef.current?.setMatrixAt(m, dummy.matrix)
      mossRef.current?.setColorAt(m, color.setHSL(0.34, 0.45, 0.44))
      m++
    })
    for (let k = m; k < MOSS_COUNT; k++) {
      const site = RUIN_SITES[0]
      const x = site.x + range(rng, 2, 6)
      const z = site.z + range(rng, -1.5, 1.5)
      dummy.position.set(x, groundY(x, z) + 0.1, z)
      dummy.rotation.set(0, rng() * TAU, 0)
      dummy.scale.set(range(rng, 0.5, 1), 0.18, range(rng, 0.5, 1))
      dummy.updateMatrix()
      mossRef.current?.setMatrixAt(k, dummy.matrix)
      mossRef.current?.setColorAt(k, color.setHSL(0.32, 0.5, 0.45))
    }

    RUIN_COLUMNS.forEach((column, i) => {
      for (let k = 0; k < 3; k++) {
        const a = rng() * TAU
        const r = range(rng, 0.62, 0.88) * column.scale
        const x = column.x + Math.cos(a) * r
        const z = column.z + Math.sin(a) * r
        dummy.position.set(x, groundY(x, z) + range(rng, 0.05, 0.32), z)
        dummy.rotation.set(range(rng, -0.3, 0.3), a, range(rng, -0.3, 0.3))
        dummy.scale.setScalar(range(rng, 0.7, 1.3) * column.scale)
        dummy.updateMatrix()
        barnacleRef.current?.setMatrixAt(i * 3 + k, dummy.matrix)
        barnacleRef.current?.setColorAt(i * 3 + k, color.setHSL(0.11, 0.12, range(rng, 0.75, 0.9)))
      }
      for (let k = 0; k < 2; k++) {
        const a = column.rotation + (k === 0 ? 1.9 : 4.1)
        const r = 0.52 * column.scale
        const x = column.x + Math.cos(a) * r
        const z = column.z + Math.sin(a) * r
        dummy.position.set(x, foundationY(column.x, column.z, 0.35) + range(rng, 0.6, 1.3), z)
        dummy.rotation.set(0, a, 0)
        dummy.scale.setScalar(range(rng, 0.65, 1.1) * column.scale)
        dummy.updateMatrix()
        coralRef.current?.setMatrixAt(i * 2 + k, dummy.matrix)
        coralRef.current?.setColorAt(
          i * 2 + k,
          color.set(k === 0 ? '#ff8fa8' : '#7fe3d0')
        )

        const ax = column.x + Math.cos(a + 1.2) * 0.78
        const az = column.z + Math.sin(a + 1.2) * 0.78
        dummy.position.set(ax, groundY(ax, az) + 0.04, az)
        dummy.rotation.set(0, a + rng(), 0)
        dummy.scale.setScalar(range(rng, 0.7, 1.25) * column.scale)
        dummy.updateMatrix()
        algaeRef.current?.setMatrixAt(i * 2 + k, dummy.matrix)
        algaeRef.current?.setColorAt(i * 2 + k, color.setHSL(range(rng, 0.3, 0.42), 0.5, 0.5))
      }
    })

    for (const mesh of [
      glyphRef.current,
      mossRef.current,
      barnacleRef.current,
      coralRef.current,
      algaeRef.current,
    ]) {
      if (!mesh) continue
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }, [])

  return (
    <group>
      <instancedMesh
        ref={wholeRef}
        args={[wholeGeo, stoneMaterial, INTEGRAS.length]}
        castShadow
        receiveShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={brokenRef}
        args={[brokenGeo, stoneMaterial, PARTIDAS.length]}
        castShadow
        receiveShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={architraveRef}
        args={[architraveGeo, stoneMaterial, RUIN_SITES.length]}
        castShadow
        receiveShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={archRef}
        args={[archGeo, stoneMaterial, RUIN_SITES.length]}
        castShadow
        receiveShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={stepRef}
        args={[stepGeo, undefined, STEP_COUNT]}
        castShadow
        receiveShadow
        frustumCulled={false}
      >
        <meshStandardMaterial color="#ffffff" roughness={0.94} />
      </instancedMesh>
      <instancedMesh
        ref={duneRef}
        args={[duneGeo, undefined, DUNE_COUNT]}
        castShadow
        receiveShadow
        frustumCulled={false}
      >
        <meshStandardMaterial color="#ffffff" roughness={1} />
      </instancedMesh>
      <instancedMesh
        ref={glyphRef}
        args={[glyphGeo, inlayMaterial, GLYPH_COUNT]}
        castShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={mossRef}
        args={[mossGeo, mossMaterial, MOSS_COUNT]}
        receiveShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={barnacleRef}
        args={[barnacleGeo, barnacleMaterial, RUIN_COLUMNS.length * 3]}
        castShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={coralRef}
        args={[coralGeo, coralMaterial, RUIN_COLUMNS.length * 2]}
        castShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={algaeRef}
        args={[algaeGeo, algaeMaterial, RUIN_COLUMNS.length * 2]}
        frustumCulled={false}
      />

      {TOTEMS.map((totem, i) => (
        <mesh
          key={i}
          geometry={totemGeo}
          material={stoneMaterial}
          position={[totem.x, foundationY(totem.x, totem.z, 0.35), totem.z]}
          rotation-y={totem.rotation}
          castShadow
          receiveShadow
          frustumCulled={false}
        />
      ))}

      {/* Monumento central: touro submerso sobre pedestal e escadaria circular. */}
      <BullStatue />
    </group>
  )
}
