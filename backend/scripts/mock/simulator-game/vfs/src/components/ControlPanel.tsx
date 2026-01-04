import type { SimulationConfig, Simulation } from '../types';

interface ControlPanelProps {
  config: SimulationConfig;
  onConfigChange: (config: SimulationConfig) => void;
  simulation: Simulation;
}

export function ControlPanel({ config, onConfigChange, simulation }: ControlPanelProps) {
  const { running, paused, start, pause, resume, stop, reset } = simulation;

  const getStatusClass = () => {
    if (!running) return 'stopped';
    if (paused) return 'paused';
    return '';
  };

  const getStatusText = () => {
    if (!running) return '已停止';
    if (paused) return '已暂停';
    return '运行中';
  };

  return (
    <div className="control-panel">
      <h2>控制面板</h2>

      <div className="status-indicator">
        <span className={`status-dot ${getStatusClass()}`} />
        <span>{getStatusText()}</span>
      </div>

      <div className="control-group">
        <label>世界名称</label>
        <input
          type="text"
          value={config.worldName}
          onChange={(e) => onConfigChange({ ...config, worldName: e.target.value })}
          disabled={running}
        />
      </div>

      <div className="control-group">
        <label>刷新率 (Tick/s)</label>
        <input
          type="number"
          min={1}
          max={120}
          value={config.tickRate}
          onChange={(e) => onConfigChange({ ...config, tickRate: Number(e.target.value) })}
          disabled={running}
        />
      </div>

      <div className="control-group">
        <label>实体上限</label>
        <input
          type="number"
          min={10}
          max={10000}
          value={config.entityLimit}
          onChange={(e) => onConfigChange({ ...config, entityLimit: Number(e.target.value) })}
          disabled={running}
        />
      </div>

      <div className="control-group">
        <label>
          <input
            type="checkbox"
            checked={config.physicsEnabled}
            onChange={(e) => onConfigChange({ ...config, physicsEnabled: e.target.checked })}
            disabled={running}
          />
          {' '}启用物理模拟
        </label>
      </div>

      <div className="control-buttons">
        {!running ? (
          <button className="control-button" onClick={start}>
            ▶ 开始模拟
          </button>
        ) : (
          <>
            {paused ? (
              <button className="control-button" onClick={resume}>
                ▶ 继续
              </button>
            ) : (
              <button className="control-button secondary" onClick={pause}>
                ⏸ 暂停
              </button>
            )}
            <button className="control-button secondary" onClick={stop}>
              ⏹ 停止
            </button>
          </>
        )}
        <button className="control-button secondary" onClick={reset}>
          🔄 重置
        </button>
      </div>
    </div>
  );
}
