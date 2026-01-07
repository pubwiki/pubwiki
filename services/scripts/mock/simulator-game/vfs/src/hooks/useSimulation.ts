import { useState, useCallback, useRef, useEffect } from 'react';
import type { SimulationConfig, Simulation, Entity, SimulationState } from '../types';

const initialState: SimulationState = {
  running: false,
  paused: false,
  tickCount: 0,
  entities: [],
  lastUpdate: 0,
};

export function useSimulation(config: SimulationConfig): Simulation {
  const [state, setState] = useState<SimulationState>(initialState);
  const intervalRef = useRef<number | null>(null);

  const tick = useCallback(() => {
    setState((prev) => ({
      ...prev,
      tickCount: prev.tickCount + 1,
      lastUpdate: Date.now(),
      // TODO: 实现实际的物理模拟逻辑
      entities: prev.entities.map((entity) => ({
        ...entity,
        position: config.physicsEnabled
          ? {
              x: entity.position.x + entity.velocity.x,
              y: entity.position.y + entity.velocity.y,
              z: entity.position.z + entity.velocity.z,
            }
          : entity.position,
      })),
    }));
  }, [config.physicsEnabled]);

  const start = useCallback(() => {
    setState((prev) => ({ ...prev, running: true, paused: false }));
  }, []);

  const pause = useCallback(() => {
    setState((prev) => ({ ...prev, paused: true }));
  }, []);

  const resume = useCallback(() => {
    setState((prev) => ({ ...prev, paused: false }));
  }, []);

  const stop = useCallback(() => {
    setState((prev) => ({ ...prev, running: false, paused: false }));
  }, []);

  const reset = useCallback(() => {
    setState(initialState);
  }, []);

  const addEntity = useCallback((entity: Omit<Entity, 'id'>): string => {
    const id = crypto.randomUUID();
    setState((prev) => {
      if (prev.entities.length >= config.entityLimit) {
        console.warn('Entity limit reached');
        return prev;
      }
      return {
        ...prev,
        entities: [...prev.entities, { ...entity, id }],
      };
    });
    return id;
  }, [config.entityLimit]);

  const removeEntity = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      entities: prev.entities.filter((e) => e.id !== id),
    }));
  }, []);

  const updateEntity = useCallback((id: string, updates: Partial<Entity>) => {
    setState((prev) => ({
      ...prev,
      entities: prev.entities.map((e) =>
        e.id === id ? { ...e, ...updates } : e
      ),
    }));
  }, []);

  // 模拟循环
  useEffect(() => {
    if (state.running && !state.paused) {
      intervalRef.current = window.setInterval(tick, 1000 / config.tickRate);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [state.running, state.paused, config.tickRate, tick]);

  return {
    ...state,
    start,
    pause,
    resume,
    stop,
    reset,
    addEntity,
    removeEntity,
    updateEntity,
  };
}
