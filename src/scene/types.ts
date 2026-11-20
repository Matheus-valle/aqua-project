import type * as THREE from 'three'

export type SpeciesId =
  | 'clownfish'
  | 'surgeon'
  | 'angelfish'
  | 'butterfly'
  | 'neon'
  | 'shark'
  | 'shrimp'
  | 'crab'
  | 'turtle'

export interface FishRuntime {
  id: string
  species: SpeciesId
  position: THREE.Vector3
  size: number
  color: string
}

export interface FoodRuntime {
  position: THREE.Vector3
  life: number
}

export interface SceneRuntime {
  fish: FishRuntime[]
  food: FoodRuntime[]
}

export interface FeedRequest {
  id: number
  position: [number, number, number]
}

export interface SpeciesConfig {
  id: Exclude<SpeciesId, 'turtle'>
  name: string
  color: string
  accent: string
  count: number
  size: number
  speed: number
  home: [number, number, number]
}
