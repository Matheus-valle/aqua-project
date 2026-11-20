import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { createRingBody } from './organic'

const UP = new THREE.Vector3(0, 1, 0)

/** Fator de imponência aplicado a toda a estátua (malha + volume de colisão). */
export const MONUMENT_SCALE = 1.3

/**
 * Volume local da estátua + pedestal (já inclui chifres, patas e degraus).
 * Compartilhado com o registro de colisão para peixes, tubarões e fauna de fundo.
 */
export const BULL_LOCAL_BOUNDS = new THREE.Box3(
  new THREE.Vector3(-3.75, -0.05, -3.75),
  new THREE.Vector3(3.15, 5.0, 3.75)
).applyMatrix4(new THREE.Matrix4().makeScale(MONUMENT_SCALE, MONUMENT_SCALE, MONUMENT_SCALE))

/** Altura aproximada do topo dos chifres acima da fundação. */
export const BULL_HEIGHT = BULL_LOCAL_BOUNDS.max.y

function finish(parts: THREE.BufferGeometry[], label: string) {
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
  // A imponência entra na própria malha: bounding volumes e colisão
  // compartilhada passam a viver exatamente no espaço renderizado.
  merged.scale(MONUMENT_SCALE, MONUMENT_SCALE, MONUMENT_SCALE)
  merged.computeVertexNormals()
  merged.computeBoundingBox()
  merged.computeBoundingSphere()
  return merged
}

function paint(
  geo: THREE.BufferGeometry,
  shader: (x: number, y: number, z: number) => [number, number, number]
) {
  const pos = geo.attributes.position as THREE.BufferAttribute
  const colors = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const [r, g, b] = shader(pos.getX(i), pos.getY(i), pos.getZ(i))
    colors[i * 3] = THREE.MathUtils.clamp(r, 0, 1)
    colors[i * 3 + 1] = THREE.MathUtils.clamp(g, 0, 1)
    colors[i * 3 + 2] = THREE.MathUtils.clamp(b, 0, 1)
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geo
}

/** Segmento cônico entre dois pontos: usado em chifres, patas e cauda. */
function segment(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, radial = 10) {
  const dir = new THREE.Vector3().subVectors(b, a)
  const len = dir.length()
  if (len < 0.0001) return new THREE.BufferGeometry()
  const geo = new THREE.CylinderGeometry(r1, r0, len, radial, 1)
  geo.translate(0, len / 2, 0)
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.multiplyScalar(1 / len)))
  geo.translate(a.x, a.y, a.z)
  return geo
}

function v(x: number, y: number, z: number) {
  return new THREE.Vector3(x, y, z)
}

export interface BullStatueGeometry {
  stone: THREE.BufferGeometry
  inlay: THREE.BufferGeometry
}

/**
 * Touro submerso majestoso em mármore branco: corpo musculoso em anéis, cabeça
 * erguida, chifres curvados em segmentos cônicos, quatro patas firmes, cauda e
 * pedestal circular com escadaria. Toda a malha é ampliada por MONUMENT_SCALE;
 * incrustações discretas de ouro/turquesa voltam em malha separada.
 */
export function createBullStatueGeometry(): BullStatueGeometry {
  const stone: THREE.BufferGeometry[] = []
  const inlay: THREE.BufferGeometry[] = []

  /* --------------------------- PEDESTAL E ESCADAS -------------------------- */
  const base = new THREE.CylinderGeometry(3.45, 3.72, 0.36, 40)
  base.translate(0, 0.18, 0)
  stone.push(base)

  const tier = new THREE.CylinderGeometry(3.02, 3.3, 0.3, 40)
  tier.translate(0, 0.5, 0)
  stone.push(tier)

  const platform = new THREE.CylinderGeometry(2.66, 2.9, 0.26, 40)
  platform.translate(0, 0.78, 0)
  stone.push(platform)

  for (let ring = 0; ring < 3; ring++) {
    const count = 16 + ring * 4
    const radius = 3.6 - ring * 0.3
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + ring * 0.14
      const step = new THREE.BoxGeometry(0.62 - ring * 0.06, 0.16, 0.3)
      step.rotateY(-a)
      step.translate(Math.cos(a) * radius, 0.1 + ring * 0.2, Math.sin(a) * radius)
      stone.push(step)
    }
  }

  const rim = new THREE.TorusGeometry(2.64, 0.09, 8, 48)
  rim.rotateX(Math.PI / 2)
  rim.translate(0, 0.92, 0)
  stone.push(rim)

  /* ------------------------------- CORPO ---------------------------------- */
  stone.push(
    createRingBody(
      [
        { x: -2.05, ry: 0.5, rz: 0.48, y: 2.25 },
        { x: -1.5, ry: 0.82, rz: 0.76, y: 2.22 },
        { x: -0.8, ry: 0.98, rz: 0.9, y: 2.28 },
        { x: 0.1, ry: 1.02, rz: 0.94, y: 2.35 },
        { x: 0.85, ry: 1.06, rz: 0.88, y: 2.45 },
        { x: 1.35, ry: 0.86, rz: 0.72, y: 2.68 },
        { x: 1.75, ry: 0.62, rz: 0.56, y: 2.95 },
        { x: 2.05, ry: 0.4, rz: 0.4, y: 3.2 },
      ],
      22
    )
  )

  // Massa muscular dos ombros e do quarto traseiro.
  for (const side of [-1, 1]) {
    const shoulder = new THREE.SphereGeometry(0.58, 14, 10)
    shoulder.scale(1, 1.05, 0.65)
    shoulder.translate(0.82, 2.62, side * 0.66)
    stone.push(shoulder)

    const rump = new THREE.SphereGeometry(0.56, 14, 10)
    rump.scale(1, 1, 0.68)
    rump.translate(-1.5, 2.3, side * 0.58)
    stone.push(rump)
  }

  const crest = new THREE.BoxGeometry(1.55, 0.24, 0.28)
  crest.rotateZ(0.34)
  crest.translate(1.18, 3.28, 0)
  stone.push(crest)

  const dewlap = new THREE.SphereGeometry(0.46, 14, 10)
  dewlap.scale(0.85, 1.15, 0.9)
  dewlap.translate(1.55, 2.3, 0)
  stone.push(dewlap)

  /* -------------------------------- CABEÇA -------------------------------- */
  const head = new THREE.SphereGeometry(0.68, 20, 14)
  head.scale(1.05, 0.92, 0.86)
  head.translate(2.32, 3.3, 0)
  stone.push(head)

  const brow = new THREE.SphereGeometry(0.4, 14, 10)
  brow.scale(1.1, 0.6, 1.05)
  brow.translate(2.45, 3.62, 0)
  stone.push(brow)

  const muzzle = new THREE.SphereGeometry(0.46, 16, 12)
  muzzle.scale(1.05, 0.72, 0.85)
  muzzle.translate(2.88, 3.02, 0)
  stone.push(muzzle)

  for (const side of [-1, 1]) {
    const nostril = new THREE.SphereGeometry(0.065, 8, 6)
    nostril.translate(3.18, 3.08, side * 0.2)
    stone.push(nostril)

    const ear = new THREE.SphereGeometry(0.24, 12, 8)
    ear.scale(1.1, 0.42, 0.7)
    ear.rotateZ(side * 0.24)
    ear.translate(2.02, 3.58, side * 0.62)
    stone.push(ear)

    /* Chifres: quatro segmentos cônicos com curvatura para cima e para dentro. */
    const horn = [
      v(2.08, 3.62, side * 0.44),
      v(1.96, 4.02, side * 0.82),
      v(1.82, 4.42, side * 1.14),
      v(2.18, 4.76, side * 1.1),
      v(2.62, 4.82, side * 0.78),
    ]
    const radii = [0.19, 0.155, 0.12, 0.085, 0.055]
    for (let i = 0; i < horn.length - 1; i++) {
      stone.push(segment(horn[i], horn[i + 1], radii[i], radii[i + 1], 12))
    }
    const tip = new THREE.SphereGeometry(0.06, 8, 6)
    tip.translate(horn[4].x, horn[4].y, horn[4].z)
    stone.push(tip)

    /* Patas dianteiras e traseiras, com joelho e casco assentados no pedestal. */
    const frontTop = v(0.92, 2.3, side * 0.66)
    const frontKnee = v(1.12, 1.55, side * 0.72)
    const frontHoof = v(1.02, 1.0, side * 0.72)
    stone.push(segment(frontTop, frontKnee, 0.32, 0.23, 12))
    stone.push(segment(frontKnee, frontHoof, 0.23, 0.18, 12))

    const hindTop = v(-1.38, 2.25, side * 0.62)
    const hindKnee = v(-1.62, 1.52, side * 0.7)
    const hindHoof = v(-1.42, 1.0, side * 0.7)
    stone.push(segment(hindTop, hindKnee, 0.34, 0.24, 12))
    stone.push(segment(hindKnee, hindHoof, 0.24, 0.18, 12))

    for (const hoof of [frontHoof, hindHoof]) {
      const foot = new THREE.CylinderGeometry(0.25, 0.28, 0.2, 10)
      foot.translate(hoof.x, 0.99, hoof.z)
      stone.push(foot)
    }
  }

  const tailA = v(-2.02, 2.42, 0)
  const tailB = v(-2.42, 1.9, 0)
  const tailC = v(-2.56, 1.36, 0)
  const tailD = v(-2.5, 1.02, 0)
  stone.push(segment(tailA, tailB, 0.16, 0.12, 10))
  stone.push(segment(tailB, tailC, 0.12, 0.09, 10))
  stone.push(segment(tailC, tailD, 0.09, 0.07, 10))
  const tuft = new THREE.ConeGeometry(0.18, 0.4, 9)
  tuft.rotateZ(Math.PI)
  tuft.translate(-2.5, 0.86, 0)
  stone.push(tuft)

  /* --------------------------- OURO E TURQUESA ----------------------------- */
  const medal = new THREE.OctahedronGeometry(0.27, 0)
  medal.scale(0.85, 1.2, 0.55)
  medal.translate(2.24, 3.72, 0)
  inlay.push(medal)

  const noseRing = new THREE.TorusGeometry(0.2, 0.05, 8, 20)
  noseRing.rotateY(Math.PI / 2)
  noseRing.translate(3.02, 2.92, 0)
  inlay.push(noseRing)

  const collar = new THREE.TorusGeometry(0.78, 0.07, 8, 32)
  collar.rotateY(Math.PI / 2)
  collar.translate(1.55, 2.85, 0)
  inlay.push(collar)

  const topBand = new THREE.TorusGeometry(2.66, 0.07, 8, 56)
  topBand.rotateX(Math.PI / 2)
  topBand.translate(0, 0.95, 0)
  inlay.push(topBand)

  const lowBand = new THREE.TorusGeometry(3.56, 0.06, 8, 56)
  lowBand.rotateX(Math.PI / 2)
  lowBand.translate(0, 0.22, 0)
  inlay.push(lowBand)

  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    const plaque = new THREE.BoxGeometry(0.3, 0.14, 0.07)
    plaque.rotateY(-a)
    plaque.translate(Math.cos(a) * 3.18, 0.55, Math.sin(a) * 3.18)
    inlay.push(plaque)
  }

  for (const side of [-1, 1]) {
    const eye = new THREE.SphereGeometry(0.095, 10, 8)
    eye.translate(2.62, 3.42, side * 0.42)
    inlay.push(eye)
  }

  const stoneGeo = paint(finish(stone, 'touro de mármore'), (x, y, z) => {
    // Mármore branco: veios frios e sutis, leve umidade escurecendo a base.
    const wave = x * 1.7 + y * 0.85 + Math.sin(z * 2.6 + y * 0.4) * 1.25
    const vein = Math.pow(Math.max(0, Math.sin(wave)), 12) * 0.13
    const damp = THREE.MathUtils.smoothstep(1.7 - y, 0, 1.7) * 0.045
    const glow = THREE.MathUtils.smoothstep(y, 3.6, 5) * 0.02
    const l = THREE.MathUtils.clamp(0.985 - vein - damp + glow, 0, 1)
    return [l, l - 0.006, l - 0.016 - damp * 0.3]
  })

  const inlayGeo = paint(finish(inlay, 'incrustações do touro'), (x, _y, z) => {
    // Ouro e turquesa mais contidos, para não competir com o branco do mármore.
    const turquoise = THREE.MathUtils.smoothstep(x, 2.3, 2.8) + Math.abs(z) * 0.04
    return [
      0.78 - turquoise * 0.58,
      0.66 - turquoise * 0.14,
      0.34 + turquoise * 0.42,
    ]
  })

  return { stone: stoneGeo, inlay: inlayGeo }
}
