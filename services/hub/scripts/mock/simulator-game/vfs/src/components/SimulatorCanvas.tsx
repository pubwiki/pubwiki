import type { Simulation } from '../types';

interface SimulatorCanvasProps {
  simulation: Simulation;
}

export function SimulatorCanvas({ simulation }: SimulatorCanvasProps) {
  const { running, paused, tickCount, entities } = simulation;

  return (
    <div className="simulator-canvas">
      {!running ? (
        <div className="canvas-placeholder">
          <h3>🌌 万界模拟器</h3>
          <p>点击"开始模拟"以启动</p>
        </div>
      ) : (
        <div className="canvas-content">
          <div className="simulation-info">
            <span>Tick: {tickCount}</span>
            <span>实体: {entities.length}</span>
            <span>状态: {paused ? '暂停' : '运行中'}</span>
          </div>
          {/* 实际的模拟渲染逻辑 */}
          <canvas id="simulation-canvas" width={800} height={600} />
        </div>
      )}
    </div>
  );
}
