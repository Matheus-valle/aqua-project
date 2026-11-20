import * as THREE from 'three'

/** Altura nominal do assoalho. Tudo que apoia no solo usa esta referência. */
export const SEABED_Y = -5

/** Altura da superfície oceânica (a mesma do WaterSurface). */
export const SURFACE_Y = 11.5

/** Borda orgânica do relevo: varia com o ângulo para não formar um círculo perfeito. */
export function terrainEdge(angle: number) {
  return 62 + Math.sin(angle * 3 + 0.7) * 7 + Math.sin(angle * 7 - 1.2) * 3.5
}

/**
 * Altura do terreno no ponto (x, z), identica à usada para esculpir o PlaneGeometry.
 * Compartilhar esta funcao evita que corais, ruinas e criaturas fiquem flutuando
 * ou enterrados — e elimina o z-fighting contra o assoalho.
 */
export function terrainHeight(x: number, z: number) {
  const r = Math.hypot(x, z)
  const angle = Math.atan2(z, x)
  const edge = terrainEdge(angle)
  const outer = THREE.MathUtils.smoothstep(r, 26, edge)

  const rippleA = Math.sin(x * 0.92 + Math.cos(z * 0.15) * 1.6) * 0.06
  const rippleB = Math.cos(z * 1.08 + Math.sin(x * 0.12) * 1.3) * 0.05
  const rippleC = Math.sin((x + z) * 2.1) * 0.018
  const dunes =
    Math.sin(x * 0.16) * 0.36 +
    Math.cos(z * 0.21) * 0.3 +
    Math.sin((x + z) * 0.08) * 0.44
  const ridges =
    Math.sin(x * 0.042 + Math.cos(z * 0.055) * 2.2) * 1.5 +
    Math.cos(z * 0.048 - Math.sin(x * 0.037) * 1.8) * 1.2
  const canyon = -Math.pow(Math.max(0, Math.sin(angle * 4 + r * 0.06)), 4) * 1.1
  const cliff = Math.pow(THREE.MathUtils.smoothstep(r, edge - 18, edge + 6), 2) * 6.5
  const abyss = Math.pow(THREE.MathUtils.smoothstep(r, edge, edge + 14), 1.4) * 24

  return dunes + rippleA + rippleB + rippleC + outer * (ridges + canyon) + cliff - abyss
}

/** Nome público usado pela lógica de cenário e animação. */
export const getTerrainHeight = terrainHeight

/** Altura do chão em coordenadas de mundo. */
export const groundY = (x: number, z: number) => SEABED_Y + terrainHeight(x, z)

/**
 * Base de uma construção: exatamente no terreno, com a fundação enterrada
 * o suficiente para nunca aparecer flutuando ou cortada de forma estranha.
 */
export const foundationY = (x: number, z: number, bury = 0.35) => groundY(x, z) - bury

/** Normal aproximada do terreno por diferencas finitas (usada para alinhar criaturas). */
export function terrainNormal(x: number, z: number, target: THREE.Vector3) {
  const step = 0.35
  const dx = terrainHeight(x + step, z) - terrainHeight(x - step, z)
  const dz = terrainHeight(x, z + step) - terrainHeight(x, z - step)
  return target.set(-dx, 2 * step, -dz).normalize()
}

/**
 * Contenção vertical contínua: mantém o animal entre o relevo (com margem) e
 * a superfície (com margem) usando forças suaves em vez de teleportes.
 */
export function applyWaterColumnSteering(
  position: THREE.Vector3,
  steer: THREE.Vector3,
  clearance: number
) {
  const floor = groundY(position.x, position.z) + clearance
  const ceiling = SURFACE_Y - clearance
  if (position.y < floor) steer.y += (floor - position.y) * 5.5
  if (position.y > ceiling) steer.y -= (position.y - ceiling) * 5.5
}

/** Trava de segurança final, sem alterar os limites originais do cardume. */
export function clampToHabitat(
  position: THREE.Vector3,
  clearance: number,
  xzLimit = 28,
  originalMinY = -4.2,
  originalMaxY = 7.8
) {
  const floorY = Math.max(originalMinY, groundY(position.x, position.z) + clearance)
  const ceilingY = Math.min(originalMaxY, SURFACE_Y - clearance)
  position.x = THREE.MathUtils.clamp(position.x, -xzLimit, xzLimit)
  position.z = THREE.MathUtils.clamp(position.z, -xzLimit, xzLimit)
  position.y = THREE.MathUtils.clamp(position.y, floorY, ceilingY)
  return position
}
