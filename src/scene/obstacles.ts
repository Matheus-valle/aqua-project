import * as THREE from 'three'
import { BULL_LOCAL_BOUNDS } from './bull'
import { mulberry32, range } from './random'
import { foundationY, groundY } from './terrain'

/** Altura de uma coluna inteira, da base (y=0) ao topo. Usada por ruínas e colisão. */
export const COLUMN_HEIGHT = 3.4

export interface StructureSite {
  x: number
  z: number
  rotation: number
}

/** Arcos monumentais: positions originais preservadas. */
export const RUIN_SITES: StructureSite[] = [
  { x: -22, z: -14, rotation: 0.3 },
  { x: 20, z: -18, rotation: -0.5 },
  { x: 2, z: 26, rotation: 0.9 },
]

/** Núcleos dos bancos de coral. O recife é semeado ao redor destes pontos. */
export const REEF_CLUSTERS: Array<{ x: number; z: number }> = Array.from(
  { length: 8 },
  (_, i) => {
    const angle = (i / 8) * Math.PI * 2 + 0.2
    const radius = 15 + (i % 3) * 7
    return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius }
  }
)

export const ANEMONE_SITES: Array<{ x: number; z: number }> = [
  { x: -14, z: 8 },
  { x: 12, z: 16 },
  { x: 0, z: -18 },
  { x: 24, z: -8 },
]

export interface RuinColumn extends StructureSite {
  main: boolean
  broken: boolean
  scale: number
}

/** Colunas compartilhadas entre a malha das ruínas e a IA de desvio. */
export const RUIN_COLUMNS: RuinColumn[] = (() => {
  const result: RuinColumn[] = []
  for (const site of RUIN_SITES) {
    for (const side of [-1, 1]) {
      result.push({
        x: site.x + Math.cos(site.rotation) * side * 2,
        z: site.z - Math.sin(site.rotation) * side * 2,
        rotation: site.rotation,
        main: true,
        broken: false,
        scale: 1,
      })
    }
  }
  const rng = mulberry32(555)
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 + 0.4
    const radius = range(rng, 23, 39)
    result.push({
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      rotation: range(rng, 0, Math.PI * 2),
      main: false,
      broken: i % 3 !== 0,
      scale: range(rng, 0.75, 1.15),
    })
  }
  return result
})()

export interface Obstacle {
  x: number
  z: number
  radius: number
  /** Coordenada Y aproximada do topo da estrutura, em mundo. */
  top: number
  /** BoundingBox real da peça, quando disponível (monumento central). */
  bounds?: THREE.Box3
}

/** Monumento central: usado por ruínas, colisão e posicionamento da estátua. */
export const MONUMENT = {
  x: 0,
  z: 0,
  foundationY: foundationY(0, 0, 0.35),
  // Acompanha o pedestal ampliado (MONUMENT_SCALE) com folga para a fauna.
  radius: 5.2,
  bounds: BULL_LOCAL_BOUNDS.clone().translate(
    new THREE.Vector3(0, foundationY(0, 0, 0.35), 0)
  ),
}

/** Volumes de colisão usados por peixes, tubarões, caranguejos e camarões. */
export const OBSTACLES: Obstacle[] = [
  ...RUIN_COLUMNS.map((c) => ({
    x: c.x,
    z: c.z,
    radius: 1.05 * c.scale,
    top: foundationY(c.x, c.z) + (c.broken ? 1.9 : COLUMN_HEIGHT) * c.scale,
  })),
  ...RUIN_SITES.map((s) => ({
    x: s.x,
    z: s.z,
    radius: 2.4,
    top: groundY(s.x, s.z) + COLUMN_HEIGHT + 2.5,
  })),
  {
    x: MONUMENT.x,
    z: MONUMENT.z,
    radius: MONUMENT.radius,
    top: MONUMENT.bounds.max.y,
    bounds: MONUMENT.bounds,
  },
  { x: RUIN_SITES[0].x + 3.5, z: RUIN_SITES[0].z, radius: 5.4, top: groundY(RUIN_SITES[0].x + 3.5, RUIN_SITES[0].z) + 1.4 },
  ...REEF_CLUSTERS.map((c) => ({ x: c.x, z: c.z, radius: 5.2, top: groundY(c.x, c.z) + 2.6 })),
  ...ANEMONE_SITES.map((s) => ({ x: s.x, z: s.z, radius: 1.8, top: groundY(s.x, s.z) + 1.5 })),
]

/**
 * Força de desvio suave ao redor de colunas, arcos, corais e degraus.
 * Nunca normaliza vetores nulos: usa um ângulo derivado do próprio obstáculo.
 */
export function steerAroundStructures(
  position: THREE.Vector3,
  steer: THREE.Vector3,
  bodyRadius: number,
  strength = 3.4
) {
  for (const obstacle of OBSTACLES) {
    // Animais acima da estrutura não precisam contorná-la.
    if (position.y > obstacle.top + 1.5) continue
    const dx = position.x - obstacle.x
    const dz = position.z - obstacle.z
    const distSq = dx * dx + dz * dz
    const reach = obstacle.radius + bodyRadius + 1.8
    if (!Number.isFinite(distSq) || distSq > reach * reach) continue

    const dist = Math.sqrt(distSq)
    if (dist < 0.0001) {
      const angle = obstacle.x * 0.37 + obstacle.z * 0.61
      steer.x += Math.cos(angle) * strength
      steer.z += Math.sin(angle) * strength
      continue
    }
    const push = (1 - dist / reach) * strength
    steer.x += (dx / dist) * push
    steer.z += (dz / dist) * push
    if (position.y < obstacle.top + 0.5) steer.y += push * 0.22
  }
}

/**
 * Repulsão específica da fauna rastejante: pedestal, rochas e bases de coral.
 * Nunca empurra no eixo Y — caranguejos e camarões permanecem presos ao fundo.
 */
export function steerGroundAroundStructures(
  position: THREE.Vector3,
  steer: THREE.Vector3,
  bodyRadius: number,
  strength = 4.4
) {
  for (const obstacle of OBSTACLES) {
    if (position.y > obstacle.top + 2) continue
    const dx = position.x - obstacle.x
    const dz = position.z - obstacle.z
    const distSq = dx * dx + dz * dz
    const reach = obstacle.radius + bodyRadius + 1.2
    if (!Number.isFinite(distSq) || distSq > reach * reach) continue

    const dist = Math.sqrt(distSq)
    if (dist < 0.0001) {
      const angle = obstacle.x * 0.37 + obstacle.z * 0.61 + Math.PI / 4
      steer.x += Math.cos(angle) * strength
      steer.z += Math.sin(angle) * strength
      continue
    }
    const push = (1 - dist / reach) * strength
    steer.x += (dx / dist) * push
    steer.z += (dz / dist) * push
  }
}

/** Correção dura de posição: impede que o animal atravesse a malha mesmo em baixa velocidade. */
export function separateFromStructures(position: THREE.Vector3, bodyRadius: number) {
  let corrected = false
  for (const obstacle of OBSTACLES) {
    if (position.y > obstacle.top + 2) continue
    const dx = position.x - obstacle.x
    const dz = position.z - obstacle.z
    const minDist = obstacle.radius + bodyRadius
    const distSq = dx * dx + dz * dz
    if (!Number.isFinite(distSq) || distSq >= minDist * minDist) continue

    const dist = Math.sqrt(distSq)
    if (dist < 0.0001) {
      const angle = obstacle.x * 0.37 + obstacle.z * 0.61 + Math.PI / 4
      position.x = obstacle.x + Math.cos(angle) * minDist
      position.z = obstacle.z + Math.sin(angle) * minDist
    } else {
      position.x = obstacle.x + (dx / dist) * minDist
      position.z = obstacle.z + (dz / dist) * minDist
    }
    corrected = true
  }
  return corrected
}
