import { useState } from 'react';
import { SimulatorCanvas } from './components/SimulatorCanvas';
import { ControlPanel } from './components/ControlPanel';
import { useSimulation } from './hooks/useSimulation';
import type { SimulationConfig } from './types';

const defaultConfig: SimulationConfig = {
  worldName: '默认世界',
  tickRate: 60,
  entityLimit: 1000,
  physicsEnabled: true,
};

function App() {
  const [config, setConfig] = useState<SimulationConfig>(defaultConfig);
  const simulation = useSimulation(config);

  return (
    <div className="app">
      <header className="app-header">
        <h1>万界模拟器</h1>
        <span className="subtitle">Universal Simulator</span>
      </header>

      <main className="app-main">
        <SimulatorCanvas simulation={simulation} />
        <ControlPanel
          config={config}
          onConfigChange={setConfig}
          simulation={simulation}
        />
      </main>

      <footer className="app-footer">
        <p>© 2024 PubWiki - 万界模拟器 v1.0.0</p>
      </footer>
    </div>
  );
}

export default App;
