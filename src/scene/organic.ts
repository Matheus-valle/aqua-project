import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const TAU = Math.PI * 2

interface Ring {
  x: number
  ry: number
  rz: number
  y?: number
}

/**
 * Corpo elíptico construído em anéis ao longo de +X. Substitui primitivas
 * simples por uma malha subdividida com UVs e normais recalculadas — base
 * para peixes, tubarões e segmentos de camarão.
 */
export function createRingBody(rings: Ring[], radial = 14) {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const row = radial + 1

  rings.forEach((ring, i) => {
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU
      positions.push(ring.x, Math.cos(a) * ring.ry + (ring.y ?? 0), Math.sin(a) * ring.rz)
      uvs.push(i / (rings.length - 1), j / radial)
    }
  })

  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * row + j
      const b = (i + 1) * row + j
      const c = (i + 1) * row + j + 1
      const d = i * row + j + 1
      indices.push(a, d, c, a, c, b)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setIndex(indices)
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.computeVertexNormals()
  geo.computeBoundingBox()
  geo.computeBoundingSphere()
  return geo
}

/** Nadadeira esculpida por um contorno de curvas, com espessura real. */
export function createFinGeometry(
  points: Array<[number, number]>,
  depth = 0.05,
  curve = true
) {
  const shape = new THREE.Shape()
  shape.moveTo(points[0][0], points[0][1])
  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i]
    if (curve) {
      const [px, py] = points[i - 1]
      shape.quadraticCurveTo((px + x) / 2 + (x - px) * 0.18, (py + y) / 2, x, y)
    } else {
      shape.lineTo(x, y)
    }
  }
  shape.closePath()
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: depth * 0.3,
    bevelSize: depth * 0.3,
    bevelSegments: 2,
    curveSegments: 5,
  })
  geo.translate(0, 0, -depth / 2)
  geo.computeVertexNormals()
  return geo
}

/**
 * Marca cada parte da malha com (tipo, peso da ponta, fase extra, 1).
 * O shader usa isso para mover o corpo e cada nadadeira com fases próprias,
 * em vez de aplicar uma única onda rígida a todo o peixe.
 */
export const FIN_BODY = 0
export const FIN_CAUDAL = 1
export const FIN_DORSAL = 2
export const FIN_PECTORAL = 3

function tagFin(geo: THREE.BufferGeometry, kind: number, rootX: number, rootY: number) {
  const pos = geo.attributes.position as THREE.BufferAttribute
  const tags = new Float32Array(pos.count * 4)
  let maxDist = 0.0001
  for (let i = 0; i < pos.count; i++) {
    maxDist = Math.max(maxDist, Math.hypot(pos.getX(i) - rootX, pos.getY(i) - rootY))
  }
  for (let i = 0; i < pos.count; i++) {
    const dist = Math.hypot(pos.getX(i) - rootX, pos.getY(i) - rootY)
    tags[i * 4] = kind
    tags[i * 4 + 1] = THREE.MathUtils.clamp(dist / maxDist, 0, 1)
    tags[i * 4 + 2] = 0
    tags[i * 4 + 3] = 1
  }
  geo.setAttribute('aFin', new THREE.BufferAttribute(tags, 4))
  return geo
}

/** Corpo: o peso cresce suavemente da cabeça até o pedúnculo caudal. */
function tagBody(geo: THREE.BufferGeometry, headX: number, tailX: number) {
  const pos = geo.attributes.position as THREE.BufferAttribute
  const tags = new Float32Array(pos.count * 4)
  const span = Math.max(0.0001, headX - tailX)
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp((headX - pos.getX(i)) / span, 0, 1)
    tags[i * 4] = FIN_BODY
    tags[i * 4 + 1] = t * t * (3 - 2 * t)
    tags[i * 4 + 2] = 0
    tags[i * 4 + 3] = 1
  }
  geo.setAttribute('aFin', new THREE.BufferAttribute(tags, 4))
  return geo
}

/** Aplica uma paleta por vértice após a mesclagem das peças. */
function paintGeometry(
  geo: THREE.BufferGeometry,
  shader: (x: number, y: number, z: number) => [number, number, number]
) {
  const pos = geo.attributes.position as THREE.BufferAttribute
  const colors = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const [r, g, b] = shader(pos.getX(i), pos.getY(i), pos.getZ(i))
    colors[i * 3] = r
    colors[i * 3 + 1] = g
    colors[i * 3 + 2] = b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geo
}

function finish(parts: THREE.BufferGeometry[], label: string) {
  // ExtrudeGeometry não tem índice; as malhas em anéis, esferas e cilindros têm.
  // Sem essa normalização o mergeGeometries falha e o canvas inteiro cai.
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

/* -------------------------------------------------------------------------- */
/*                               PEIXES TROPICAIS                             */
/* -------------------------------------------------------------------------- */

/** Corpo hidrodinâmico, cauda bifurcada, nadadeiras articuladas e olhos. */
export function createFishGeometry() {
  const body = createRingBody(
    [
      { x: -1.06, ry: 0.045, rz: 0.035 },
      { x: -0.88, ry: 0.1, rz: 0.075 },
      { x: -0.6, ry: 0.22, rz: 0.15 },
      { x: -0.2, ry: 0.34, rz: 0.22 },
      { x: 0.2, ry: 0.36, rz: 0.24 },
      { x: 0.55, ry: 0.28, rz: 0.2 },
      { x: 0.78, ry: 0.16, rz: 0.13 },
      { x: 0.92, ry: 0.02, rz: 0.02 },
    ],
    16
  )

  const tail = createFinGeometry(
    [
      [-0.96, 0.02],
      [-1.44, 0.5],
      [-1.3, 0.03],
      [-1.44, -0.46],
    ],
    0.05
  )

  const dorsal = createFinGeometry(
    [
      [-0.34, 0.3],
      [0.02, 0.78],
      [0.32, 0.3],
    ],
    0.06
  )

  const anal = createFinGeometry(
    [
      [-0.3, -0.28],
      [-0.04, -0.6],
      [0.24, -0.26],
    ],
    0.05
  )

  const parts: THREE.BufferGeometry[] = [
    tagBody(body, 0.92, -1.06),
    tagFin(tail, FIN_CAUDAL, -0.96, 0.02),
    tagFin(dorsal, FIN_DORSAL, -0.34, 0.3),
    tagFin(anal, FIN_DORSAL, -0.3, -0.28),
  ]

  for (const side of [-1, 1]) {
    const fin = tagFin(
      createFinGeometry(
        [
          [0.36, -0.04],
          [0.02, -0.12],
          [-0.16, -0.44],
        ],
        0.04
      ),
      FIN_PECTORAL,
      0.36,
      -0.04
    )
    fin.rotateY(side * (Math.PI / 2 + 0.28))
    fin.translate(0.18, -0.12, side * 0.2)
    parts.push(fin)

    const eye = new THREE.SphereGeometry(0.075, 10, 7)
    eye.translate(0.68, 0.11, side * 0.17)
    parts.push(tagBody(eye, 0.92, -1.06))

    const pupil = new THREE.SphereGeometry(0.038, 8, 6)
    pupil.translate(0.706, 0.11, side * 0.216)
    parts.push(tagBody(pupil, 0.92, -1.06))
  }

  const geo = finish(parts, 'peixe tropical')
  paintGeometry(geo, (x, y) => {
    const belly = THREE.MathUtils.smoothstep(-y, -0.05, 0.32)
    const back = 0.68 + belly * 0.5
    const shade = x < -1.15 ? 0.82 : back
    return [shade, shade * 0.97, shade * 0.92]
  })
  return geo
}

/* -------------------------------------------------------------------------- */
/*                                   TUBARÕES                                 */
/* -------------------------------------------------------------------------- */

/** Tubarão: corpo alongado, fendas branquiais, dorsal imponente e cauda heterocerca. */
export function createSharkGeometry() {
  const body = createRingBody(
    [
      { x: -2.2, ry: 0.06, rz: 0.045 },
      { x: -1.8, ry: 0.14, rz: 0.11 },
      { x: -1.2, ry: 0.27, rz: 0.21 },
      { x: -0.4, ry: 0.44, rz: 0.36 },
      { x: 0.35, ry: 0.48, rz: 0.4 },
      { x: 0.95, ry: 0.39, rz: 0.34 },
      { x: 1.35, ry: 0.25, rz: 0.24 },
      { x: 1.66, ry: 0.11, rz: 0.12 },
      { x: 1.8, ry: 0.02, rz: 0.025 },
    ],
    18
  )

  const parts: THREE.BufferGeometry[] = [tagBody(body, 1.8, -2.2)]

  const dorsal = createFinGeometry(
    [
      [-0.45, 0.36],
      [-0.05, 1.32],
      [0.42, 0.34],
    ],
    0.1
  )
  parts.push(tagFin(dorsal, FIN_DORSAL, -0.45, 0.36))

  const dorsal2 = createFinGeometry(
    [
      [-1.32, 0.18],
      [-1.18, 0.55],
      [-0.98, 0.16],
    ],
    0.06
  )
  parts.push(tagFin(dorsal2, FIN_DORSAL, -1.32, 0.18))

  const caudal = createFinGeometry(
    [
      [-2.12, 0.04],
      [-2.95, 1.02],
      [-2.55, 0.06],
      [-2.86, -0.6],
    ],
    0.09
  )
  parts.push(tagFin(caudal, FIN_CAUDAL, -2.12, 0.04))

  const analFin = createFinGeometry(
    [
      [-1.34, -0.18],
      [-1.2, -0.46],
      [-0.98, -0.16],
    ],
    0.05
  )
  parts.push(tagFin(analFin, FIN_DORSAL, -1.34, -0.18))

  for (const side of [-1, 1]) {
    const pectoral = tagFin(
      createFinGeometry(
        [
          [0.62, 0.02],
          [-0.1, -0.12],
          [-0.62, -1.18],
          [0.16, -0.34],
        ],
        0.07
      ),
      FIN_PECTORAL,
      0.62,
      0.02
    )
    pectoral.rotateY(side * (Math.PI / 2 + 0.15))
    pectoral.translate(0.15, -0.18, side * 0.34)
    parts.push(pectoral)

    const pelvic = tagFin(
      createFinGeometry(
        [
          [-0.72, -0.12],
          [-1.06, -0.52],
          [-0.5, -0.2],
        ],
        0.05
      ),
      FIN_PECTORAL,
      -0.72,
      -0.12
    )
    pelvic.rotateY(side * (Math.PI / 2 + 0.1))
    pelvic.translate(-0.7, -0.28, side * 0.22)
    parts.push(pelvic)

    for (let g = 0; g < 5; g++) {
      const slit = new THREE.BoxGeometry(0.035, 0.34 - g * 0.015, 0.022)
      slit.rotateZ(0.22)
      slit.translate(1.02 - g * 0.14, 0.02, side * 0.34)
      parts.push(tagBody(slit, 1.8, -2.2))
    }

    const eye = new THREE.SphereGeometry(0.085, 10, 7)
    eye.translate(1.42, 0.17, side * 0.235)
    parts.push(tagBody(eye, 1.8, -2.2))
    const pupil = new THREE.SphereGeometry(0.045, 8, 6)
    pupil.translate(1.47, 0.17, side * 0.29)
    parts.push(tagBody(pupil, 1.8, -2.2))
  }

  const mouth = new THREE.BoxGeometry(0.12, 0.045, 0.34)
  mouth.translate(1.68, -0.19, 0)
  parts.push(tagBody(mouth, 1.8, -2.2))

  const geo = finish(parts, 'tubarão')
  paintGeometry(geo, (x, y, z) => {
    const belly = THREE.MathUtils.smoothstep(-y, -0.1, 0.42)
    const gill = x > 0.75 && x < 1.15 && Math.abs(z) > 0.3 ? 0.5 : 1
    const base = 0.24 + belly * 0.66
    return [base * gill, (base + 0.035) * gill, (base + 0.08) * gill]
  })
  return geo
}

/* -------------------------------------------------------------------------- */
/*                                   ARRAIAS                                  */
/* -------------------------------------------------------------------------- */

/** Arraia-manta: disco achatado com asas largas, cauda longa e olhos expressivos. */
export function createRayGeometry() {
  const wing = createFinGeometry(
    [
      [1.25, 0],
      [0.2, 0.55],
      [-0.85, 2.0],
      [-1.05, 0.22],
      [-1.15, -0.22],
      [-0.85, -2.0],
      [0.2, -0.55],
    ],
    0.14,
    false
  )
  wing.rotateX(Math.PI / 2)
  wing.translate(0, -0.07, 0)

  const body = new THREE.SphereGeometry(0.62, 18, 10)
  body.scale(1.5, 0.2, 0.85)
  body.translate(0.1, 0.03, 0)

  const belly = new THREE.SphereGeometry(0.55, 14, 8)
  belly.scale(1.45, 0.12, 0.72)
  belly.translate(0.12, -0.1, 0)

  const tail = new THREE.CylinderGeometry(0.012, 0.055, 2.8, 6)
  tail.rotateZ(Math.PI / 2)
  tail.translate(-2.25, -0.02, 0)

  const parts: THREE.BufferGeometry[] = [wing, body, belly, tail]

  for (const side of [-1, 1]) {
    const cephalic = createFinGeometry(
      [
        [1.05, 0],
        [1.42, 0.16],
        [1.0, 0.28],
      ],
      0.06
    )
    cephalic.rotateX(Math.PI / 2)
    cephalic.translate(0, -0.04, side * 0.32)
    parts.push(cephalic)

    const eye = new THREE.SphereGeometry(0.07, 9, 6)
    eye.translate(0.68, 0.15, side * 0.3)
    parts.push(eye)
  }

  const geo = finish(parts, 'arraia')
  paintGeometry(geo, (_x, y) => {
    const belly = THREE.MathUtils.smoothstep(-y, -0.05, 0.18)
    const base = 0.4 + belly * 0.55
    return [base * 0.92, base, base * 1.02]
  })
  return geo
}

/* -------------------------------------------------------------------------- */
/*                                CARANGUEJOS                                */
/* -------------------------------------------------------------------------- */

export interface CrabParts {
  carapace: THREE.BufferGeometry
  legUpper: THREE.BufferGeometry
  legLower: THREE.BufferGeometry
  clawPalm: THREE.BufferGeometry
  clawFinger: THREE.BufferGeometry
  eyeStalk: THREE.BufferGeometry
  eyeBall: THREE.BufferGeometry
}

/** Carapaça esculpida e membros articulados para caranguejos realistas. */
export function createCrabParts(): CrabParts {
  const carapace = new THREE.SphereGeometry(0.5, 18, 12)
  const pos = carapace.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const bump = 1 + Math.sin(x * 11 + z * 7) * 0.035 + Math.cos(z * 13 - x * 5) * 0.025
    const ridge = y > 0.1 ? 1 + Math.sin(x * 8) * 0.05 : 1
    pos.setXYZ(i, x * 1.18 * bump, y * 0.52 * ridge + 0.2, z * 0.96 * bump)
  }
  pos.needsUpdate = true
  carapace.computeVertexNormals()
  carapace.computeBoundingBox()
  carapace.computeBoundingSphere()

  // Segmentos unitários ao longo de +X: basta escalar X pela distância entre
  // as articulações para obter joelhos/dobras reais sem distorcer a malha.
  const legUpper = new THREE.CapsuleGeometry(0.05, 0.9, 3, 6)
  legUpper.rotateZ(Math.PI / 2)
  legUpper.translate(0.5, 0, 0)
  legUpper.computeBoundingSphere()

  const legLower = new THREE.CapsuleGeometry(0.035, 0.93, 3, 6)
  legLower.rotateZ(Math.PI / 2)
  legLower.translate(0.5, 0, 0)
  legLower.computeBoundingSphere()

  const clawPalm = new THREE.SphereGeometry(0.16, 12, 8)
  clawPalm.scale(1.45, 0.85, 0.95)
  clawPalm.translate(0.16, 0, 0)
  clawPalm.computeBoundingSphere()

  const clawFinger = new THREE.ConeGeometry(0.06, 0.3, 7)
  clawFinger.rotateZ(-Math.PI / 2)
  clawFinger.translate(0.15, 0, 0)
  clawFinger.computeBoundingSphere()

  const eyeStalk = new THREE.CylinderGeometry(0.025, 0.038, 0.22, 6)
  eyeStalk.translate(0, 0.11, 0)
  eyeStalk.computeBoundingSphere()

  const eyeBall = new THREE.SphereGeometry(0.07, 9, 7)
  eyeBall.translate(0, 0.24, 0)
  eyeBall.computeBoundingSphere()

  return { carapace, legUpper, legLower, clawPalm, clawFinger, eyeStalk, eyeBall }
}

/* -------------------------------------------------------------------------- */
/*                                  CAMARÕES                                 */
/* -------------------------------------------------------------------------- */

/** Segmento translúcido de camarão; repetido com escalas decrescentes. */
export function createShrimpSegment() {
  const geo = createRingBody(
    [
      { x: -0.13, ry: 0.1, rz: 0.11 },
      { x: -0.06, ry: 0.15, rz: 0.16 },
      { x: 0.04, ry: 0.16, rz: 0.17 },
      { x: 0.13, ry: 0.1, rz: 0.11 },
    ],
    10
  )
  paintGeometry(geo, (y) => {
    const light = 0.78 + THREE.MathUtils.smoothstep(y, -0.1, 0.16) * 0.22
    return [light, light * 0.96, light * 0.9]
  })
  return geo
}

/** Antena longa e fina, levemente curva. */
export function createAntennaGeometry() {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.35, 0.14, 0.12),
    new THREE.Vector3(0.8, 0.1, 0.34),
    new THREE.Vector3(1.25, -0.12, 0.58),
  ])
  const geo = new THREE.TubeGeometry(curve, 10, 0.012, 4, false)
  geo.computeBoundingSphere()
  return geo
}

/** Pata natatória achatada. */
export function createSwimmeretGeometry() {
  const geo = new THREE.SphereGeometry(0.06, 7, 5)
  geo.scale(0.7, 0.25, 1.5)
  geo.computeBoundingSphere()
  return geo
}
