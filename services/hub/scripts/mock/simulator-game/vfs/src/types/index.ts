// 模拟器核心类型定义

export interface SimulationConfig {
  worldName: string;
  tickRate: number;
  entityLimit: number;
  physicsEnabled: boolean;
}

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  position: Vector3;
  velocity: Vector3;
  properties: Record<string, unknown>;
}

export type EntityType = 'character' | 'object' | 'vehicle' | 'structure' | 'effect';

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface SimulationState {
  running: boolean;
  paused: boolean;
  tickCount: number;
  entities: Entity[];
  lastUpdate: number;
}

export interface SimulationActions {
  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  reset: () => void;
  addEntity: (entity: Omit<Entity, 'id'>) => string;
  removeEntity: (id: string) => void;
  updateEntity: (id: string, updates: Partial<Entity>) => void;
}

export interface Simulation extends SimulationState, SimulationActions {}

export interface WorldConfig {
  name: string;
  description: string;
  initialEntities: Omit<Entity, 'id'>[];
  rules: SimulationRule[];
  environment: EnvironmentConfig;
}

export interface SimulationRule {
  id: string;
  name: string;
  condition: string;
  action: string;
  priority: number;
}

export interface EnvironmentConfig {
  gravity: Vector3;
  timeScale: number;
  bounds: {
    min: Vector3;
    max: Vector3;
  };
}
