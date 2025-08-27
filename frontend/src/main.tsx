import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import axios from 'axios';
import { SimulationVivViewer } from './VivIntegration';

const API = 'http://localhost:8000';

interface SimulationState {
  truth_space: { shape: number[]; scale: number[] };
  sample: { labels: any[] };
  modality: any;
  detector: any;
  exposure_ms: number;
  settings: any;
}

const defaultState: SimulationState = {
  truth_space: { shape: [16, 64, 64], scale: [0.1, 0.05, 0.05] },
  sample: {
    labels: [
      {
        distribution: { type: 'matslines', density: 0.5, length: 20, azimuth: 5, max_r: 1.0 },
        fluorophore: 'EGFP',
        concentration: 5,
      },
    ],
  },
  modality: { type: 'confocal', pinhole_au: 0.75 },
  detector: { camera_type: 'CCD', qe: 0.8, read_noise: 2, bit_depth: 12 },
  exposure_ms: 150,
  settings: { random_seed: 1 },
};

const presets = {
  'Fast Test': {
    truth_space: { shape: [8, 32, 32], scale: [0.1, 0.05, 0.05] },
    sample: {
      labels: [
        {
          distribution: { type: 'matslines', density: 0.3, length: 15, azimuth: 5, max_r: 1.0 },
          fluorophore: 'EGFP',
          concentration: 3,
        },
      ],
    },
    modality: { type: 'confocal', pinhole_au: 1.0 },
    detector: { camera_type: 'CCD', qe: 0.8, read_noise: 2, bit_depth: 12 },
    exposure_ms: 100,
    settings: { random_seed: 1 },
  },
  'High Quality': {
    truth_space: { shape: [32, 128, 128], scale: [0.05, 0.025, 0.025] },
    sample: {
      labels: [
        {
          distribution: { type: 'matslines', density: 0.8, length: 30, azimuth: 5, max_r: 1.0 },
          fluorophore: 'EGFP',
          concentration: 8,
        },
      ],
    },
    modality: { type: 'confocal', pinhole_au: 0.5 },
    detector: { camera_type: 'CCD', qe: 0.9, read_noise: 1, bit_depth: 16 },
    exposure_ms: 300,
    settings: { random_seed: 42 },
  },
  'Dense Sample': {
    truth_space: { shape: [20, 96, 96], scale: [0.08, 0.04, 0.04] },
    sample: {
      labels: [
        {
          distribution: { type: 'matslines', density: 1.2, length: 25, azimuth: 5, max_r: 1.0 },
          fluorophore: 'EGFP',
          concentration: 12,
        },
      ],
    },
    modality: { type: 'confocal', pinhole_au: 0.6 },
    detector: { camera_type: 'CCD', qe: 0.85, read_noise: 2.5, bit_depth: 12 },
    exposure_ms: 200,
    settings: { random_seed: 123 },
  },
};

interface ChannelStats {
  min: number;
  max: number;
  mean: number;
  std: number;
  p1: number;
  p5: number;
  p95: number;
  p99: number;
}

interface SimResult {
  shape: number[]; // [C,Z,Y,X]
  dims: string[];
  zarr: { data: number[][][][] };
  preview_png_b64: string;
  stats: ChannelStats[];
  elapsed_s: number;
  z_slice_used: number;
}

type Lut = { name: string; color: [number, number, number] };
const DEFAULT_LUTS: Lut[] = [
  { name: 'Red', color: [255, 0, 0] },
  { name: 'Green', color: [0, 255, 0] },
  { name: 'Blue', color: [0, 0, 255] },
  { name: 'Magenta', color: [255, 0, 255] },
  { name: 'Yellow', color: [255, 255, 0] },
  { name: 'Cyan', color: [0, 255, 255] },
  { name: 'White', color: [255, 255, 255] },
  { name: 'Gray', color: [128, 128, 128] },
];

interface ChannelSettings {
  enabled: boolean;
  lut: number;
  contrast: [number, number]; // [min, max] as percentages
  visible: boolean;
}

function App() {
  const [schema, setSchema] = useState<any>(null);
  const [sim, setSim] = useState<SimulationState>(defaultState);
  const [result, setResult] = useState<SimResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [channelSettings, setChannelSettings] = useState<ChannelSettings[]>([
    { enabled: true, lut: 0, contrast: [0, 100], visible: true },
    { enabled: true, lut: 1, contrast: [0, 100], visible: true },
    { enabled: true, lut: 2, contrast: [0, 100], visible: true },
    { enabled: true, lut: 3, contrast: [0, 100], visible: true },
  ]);
  const [showStats, setShowStats] = useState(false);

  useEffect(() => {
    axios.get(`${API}/schema/simulation`).then(r => setSchema(r.data));
    // Load test data for Viv viewer
    loadTestData();
  }, []);

  const loadTestData = async () => {
    try {
      const response = await axios.get(`${API}/test-data`);
      setResult(response.data);
      console.log('Loaded test data for Viv:', response.data);
    } catch (error) {
      console.error('Failed to load test data:', error);
    }
  };

  const update = (path: string, value: any) => {
    setSim(prev => {
      const copy: any = { ...prev };
      const parts = path.split('.');
      let obj = copy;
      for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
      obj[parts[parts.length - 1]] = value;
      return copy;
    });
  };

  const updateChannelSetting = (channelIndex: number, setting: keyof ChannelSettings, value: any) => {
    setChannelSettings(prev => {
      const copy = [...prev];
      if (!copy[channelIndex]) {
        copy[channelIndex] = { enabled: true, lut: channelIndex, contrast: [0, 100], visible: true };
      }
      copy[channelIndex] = { ...copy[channelIndex], [setting]: value };
      return copy;
    });
  };

  const loadPreset = (presetName: string) => {
    if (presetName in presets) {
      setSim(presets[presetName as keyof typeof presets]);
    }
  };

  const runSimulation = async () => {
    setLoading(true);
    try {
      const payload = { ...sim, output_space: { downscale: 4 } };
      const r = await axios.post(`${API}/simulate`, { simulation: payload });
      setResult(r.data as SimResult);
      // Reset channel settings for new result
      const numChannels = r.data.shape[0];
      setChannelSettings(Array.from({ length: numChannels }, (_, i) => ({
        enabled: true,
        lut: i % DEFAULT_LUTS.length,
        contrast: [5, 95], // Start with 5-95 percentile for better contrast
        visible: true,
      })));
    } catch (e: any) {
      const errorMsg = e.response?.data?.detail || e.message;
      alert(`Simulation failed: ${errorMsg}`);
    } finally {
      setLoading(false);
    }
  };

  const renderChannelControls = () => {
    if (!result) return null;
    
    return (
      <div className="viewer-controls">
        <h3 style={{ margin: '0 0 1rem 0', fontSize: '1rem', fontWeight: '600' }}>Channel Controls</h3>
        <div className="channel-controls">
          {Array.from({ length: result.shape[0] }).map((_, c) => {
            const settings = channelSettings[c] || { enabled: true, lut: c, contrast: [5, 95], visible: true };
            const stats = result.stats[c];
            return (
              <div key={c} className="channel-control" style={{ flexDirection: 'column', alignItems: 'stretch', minWidth: '200px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={settings.enabled}
                    onChange={e => updateChannelSetting(c, 'enabled', e.target.checked)}
                  />
                  <strong>Channel {c}</strong>
                  <select
                    value={settings.lut}
                    onChange={e => updateChannelSetting(c, 'lut', parseInt(e.target.value))}
                    style={{ marginLeft: 'auto', fontSize: '0.75rem' }}
                  >
                    {DEFAULT_LUTS.map((l, i) => (
                      <option value={i} key={l.name}>{l.name}</option>
                    ))}
                  </select>
                </div>
                
                <div style={{ fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                  Contrast: {settings.contrast[0]}% - {settings.contrast[1]}%
                </div>
                
                <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.75rem' }}>Min</span>
                  <input
                    type="range"
                    min="0"
                    max="99"
                    value={settings.contrast[0]}
                    onChange={e => {
                      const newMin = parseInt(e.target.value);
                      const newMax = Math.max(newMin + 1, settings.contrast[1]);
                      updateChannelSetting(c, 'contrast', [newMin, newMax]);
                    }}
                    style={{ flex: 1 }}
                  />
                  <span style={{ fontSize: '0.75rem' }}>Max</span>
                  <input
                    type="range"
                    min="1"
                    max="100"
                    value={settings.contrast[1]}
                    onChange={e => {
                      const newMax = parseInt(e.target.value);
                      const newMin = Math.min(newMax - 1, settings.contrast[0]);
                      updateChannelSetting(c, 'contrast', [newMin, newMax]);
                    }}
                    style={{ flex: 1 }}
                  />
                </div>
                
                {showStats && (
                  <div style={{ fontSize: '0.65rem', color: '#666', marginTop: '0.5rem' }}>
                    Range: {stats.min.toFixed(2)} - {stats.max.toFixed(2)}<br/>
                    Mean: {stats.mean.toFixed(2)} ± {stats.std.toFixed(2)}<br/>
                    P1-P99: {stats.p1.toFixed(2)} - {stats.p99.toFixed(2)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        
        <button 
          onClick={() => setShowStats(!showStats)}
          style={{ 
            marginTop: '0.5rem', 
            padding: '0.25rem 0.5rem', 
            fontSize: '0.75rem',
            background: '#f3f4f6',
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          {showStats ? 'Hide' : 'Show'} Channel Stats
        </button>
      </div>
    );
  };

  return (
    <div>
      <h1>🔬 Microsim Web App</h1>
      
      <div className="app-layout">
        <div className="controls-panel">
          <h2>Simulation Parameters</h2>
          
          <div style={{ marginBottom: '1rem', padding: '1rem', background: '#f0f9ff', border: '1px solid #0ea5e9', borderRadius: '6px' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
              Quick Presets
              <select 
                onChange={e => e.target.value && loadPreset(e.target.value)}
                defaultValue=""
                style={{ marginLeft: '0.5rem', padding: '0.25rem' }}
              >
                <option value="">Choose a preset...</option>
                {Object.keys(presets).map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
            <div style={{ fontSize: '0.75rem', color: '#0369a1' }}>
              Select a preset to quickly configure parameters for different scenarios
            </div>
          </div>
          
          <fieldset>
            <legend>Truth Space</legend>
            <div className="row">
              <label>
                Z Slices
                <input
                  type="number"
                  value={sim.truth_space.shape[0]}
                  min="1"
                  max="100"
                  onChange={e => update('truth_space.shape.0', parseInt(e.target.value))}
                />
              </label>
              <label>
                Height (Y)
                <input
                  type="number"
                  value={sim.truth_space.shape[1]}
                  min="16"
                  max="512"
                  onChange={e => update('truth_space.shape.1', parseInt(e.target.value))}
                />
              </label>
              <label>
                Width (X)
                <input
                  type="number"
                  value={sim.truth_space.shape[2]}
                  min="16"
                  max="512"
                  onChange={e => update('truth_space.shape.2', parseInt(e.target.value))}
                />
              </label>
            </div>
          </fieldset>
          
          <fieldset>
            <legend>Sample Properties</legend>
            <div className="row">
              <label>
                Fluorophore Concentration
                <input
                  type="number"
                  value={sim.sample.labels[0].concentration}
                  min="0.1"
                  max="50"
                  step="0.5"
                  onChange={e => {
                    const v = parseFloat(e.target.value);
                    setSim(prev => ({ 
                      ...prev, 
                      sample: { 
                        labels: [{ ...prev.sample.labels[0], concentration: v }] 
                      } 
                    }));
                  }}
                />
              </label>
              <label>
                Density
                <input
                  type="number"
                  value={sim.sample.labels[0].distribution.density}
                  min="0.1"
                  max="2"
                  step="0.1"
                  onChange={e => {
                    const v = parseFloat(e.target.value);
                    setSim(prev => ({
                      ...prev,
                      sample: {
                        labels: [{
                          ...prev.sample.labels[0],
                          distribution: { ...prev.sample.labels[0].distribution, density: v }
                        }]
                      }
                    }));
                  }}
                />
              </label>
            </div>
          </fieldset>
          
          <fieldset>
            <legend>Microscopy Settings</legend>
            <div className="row">
              <label>
                Pinhole (AU)
                <input
                  type="number"
                  value={sim.modality.pinhole_au}
                  min="0.1"
                  max="2"
                  step="0.05"
                  onChange={e => update('modality.pinhole_au', parseFloat(e.target.value))}
                />
              </label>
              <label>
                Exposure (ms)
                <input
                  type="number"
                  value={sim.exposure_ms}
                  min="10"
                  max="1000"
                  step="10"
                  onChange={e => update('exposure_ms', parseFloat(e.target.value))}
                />
              </label>
            </div>
          </fieldset>
          
          <fieldset>
            <legend>Detector</legend>
            <div className="row">
              <label>
                Quantum Efficiency
                <input
                  type="number"
                  value={sim.detector.qe}
                  min="0.1"
                  max="1"
                  step="0.01"
                  onChange={e => update('detector.qe', parseFloat(e.target.value))}
                />
              </label>
              <label>
                Read Noise
                <input
                  type="number"
                  value={sim.detector.read_noise}
                  min="0.1"
                  max="10"
                  step="0.1"
                  onChange={e => update('detector.read_noise', parseFloat(e.target.value))}
                />
              </label>
            </div>
          </fieldset>
          
          <button 
            className="simulate-btn" 
            onClick={runSimulation} 
            disabled={loading}
          >
            {loading ? '🔄 Simulating...' : '▶️ Run Simulation'}
          </button>
        </div>

        <div className="viewer-panel">
          <h2>Image Viewer</h2>
          
          {result ? (
            <>
              <div className="viewer-controls">
                {renderChannelControls()}
              </div>
              
              <div className="image-display">
                <SimulationVivViewer
                  result={result}
                  channelSettings={channelSettings}
                  defaultLuts={DEFAULT_LUTS}
                  width={800}
                  height={600}
                />
              </div>
              
              <div className="status-info">
                Shape: {JSON.stringify(result.shape)} ({result.dims.join(', ')})<br/>
                Simulation time: {result.elapsed_s.toFixed(3)}s<br/>
                Channels: {result.shape[0]}, Size: {result.shape[3]}×{result.shape[2]}px<br/>
                Use mouse controls and scroll wheel to navigate the 3D volume
              </div>
            </>
          ) : (
            <div className="image-display">
              <p style={{ color: '#6b7280', textAlign: 'center' }}>
                {loading ? '🔄 Generating simulation...' : '🔬 Configure parameters and click "Run Simulation" to generate an image'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />);
