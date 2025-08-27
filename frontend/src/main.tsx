import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import axios from 'axios';

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
  truth_space: { shape: [32, 128, 128], scale: [0.1, 0.05, 0.05] },
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

interface SimResult {
  shape: number[]; // [C,Z,Y,X]
  dims: string[];
  zarr: { data: number[][][][] };
  elapsed_s: number;
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
];

function App() {
  const [schema, setSchema] = useState<any>(null);
  const [sim, setSim] = useState<SimulationState>(defaultState);
  const [result, setResult] = useState<SimResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [zIndex, setZIndex] = useState(0);
  const [channelEnabled, setChannelEnabled] = useState<boolean[]>([true, true, true, true]);
  const [channelLuts, setChannelLuts] = useState<number[]>([0, 1, 2, 3]);

  useEffect(() => {
    axios.get(`${API}/schema/simulation`).then(r => setSchema(r.data));
  }, []);

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

  const runSimulation = async () => {
    setLoading(true);
    try {
      const payload = { ...sim, output_space: { downscale: 4 } };
      const r = await axios.post(`${API}/simulate`, { simulation: payload });
      setResult(r.data as SimResult);
      setZIndex(0);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  };

  // derive numeric array for current Z slice and composite
  const compositeUrl = useMemo(() => {
    if (!result) return null;
    const [C, Z, Y, X] = result.shape;
    if (zIndex >= Z) return null;
    // allocate composite
    const comp = new Float32Array(Y * X * 3);
    for (let c = 0; c < C; c++) {
      if (!channelEnabled[c]) continue;
      const plane = result.zarr.data[c][zIndex];
      // compute max for channel normalization
      let maxv = 0;
      for (let y = 0; y < Y; y++) {
        const row = plane[y];
        for (let x = 0; x < X; x++) if (row[x] > maxv) maxv = row[x];
      }
      const lut = DEFAULT_LUTS[channelLuts[c] % DEFAULT_LUTS.length].color.map(v => v / 255);
      const scale = maxv > 0 ? 1 / maxv : 1;
      for (let y = 0; y < Y; y++) {
        const row = plane[y];
        for (let x = 0; x < X; x++) {
          const v = row[x] * scale;
          const idx = (y * X + x) * 3;
            comp[idx] += v * lut[0];
            comp[idx + 1] += v * lut[1];
            comp[idx + 2] += v * lut[2];
        }
      }
    }
    // clamp & convert to png
    for (let i = 0; i < comp.length; i++) comp[i] = Math.min(1, comp[i]);
    const u8 = new Uint8ClampedArray(comp.length);
    for (let i = 0; i < comp.length; i++) u8[i] = Math.round(comp[i] * 255);
    // build canvas
    const canvas = document.createElement('canvas');
    canvas.width = result.shape[3];
    canvas.height = result.shape[2];
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const imageData = ctx.createImageData(canvas.width, canvas.height);
    for (let p = 0, q = 0; p < u8.length; p += 3, q += 4) {
      imageData.data[q] = u8[p];
      imageData.data[q + 1] = u8[p + 1];
      imageData.data[q + 2] = u8[p + 2];
      imageData.data[q + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  }, [result, zIndex, channelEnabled, channelLuts]);

  const channelControls = () => {
    if (!result) return null;
    return (
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {Array.from({ length: result.shape[0] }).map((_, c) => (
          <div key={c} style={{ border: '1px solid #ccc', padding: '0.25rem 0.5rem' }}>
            <label>
              <input
                type="checkbox"
                checked={channelEnabled[c] ?? false}
                onChange={e => {
                  setChannelEnabled(prev => {
                    const copy = [...prev];
                    copy[c] = e.target.checked;
                    return copy;
                  });
                }}
              /> C{c}
            </label>
            <select
              value={channelLuts[c] ?? 0}
              onChange={e => {
                const idx = parseInt(e.target.value);
                setChannelLuts(p => {
                  const copy = [...p];
                  copy[c] = idx;
                  return copy;
                });
              }}
            >
              {DEFAULT_LUTS.map((l, i) => (
                <option value={i} key={l.name}>{l.name}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div>
      <h1>Microsim Prototype</h1>
      <fieldset>
        <legend>Truth Space</legend>
        <div className="row">
          <label>
            Shape Z
            <input
              type="number"
              value={sim.truth_space.shape[0]}
              onChange={e => update('truth_space.shape.0', parseInt(e.target.value))}
            />
          </label>
          <label>
            Shape Y
            <input
              type="number"
              value={sim.truth_space.shape[1]}
              onChange={e => update('truth_space.shape.1', parseInt(e.target.value))}
            />
          </label>
          <label>
            Shape X
            <input
              type="number"
              value={sim.truth_space.shape[2]}
              onChange={e => update('truth_space.shape.2', parseInt(e.target.value))}
            />
          </label>
        </div>
      </fieldset>
      <fieldset>
        <legend>Sample (First Label)</legend>
        <label>
          Concentration
          <input
            type="number"
            value={sim.sample.labels[0].concentration}
            onChange={e => {
              const v = parseFloat(e.target.value);
              setSim(prev => ({ ...prev, sample: { labels: [{ ...prev.sample.labels[0], concentration: v }] } }));
            }}
          />
        </label>
      </fieldset>
      <fieldset>
        <legend>Modality</legend>
        <label>
          Pinhole AU
          <input
            type="number"
            value={sim.modality.pinhole_au}
            step={0.05}
            onChange={e => update('modality.pinhole_au', parseFloat(e.target.value))}
          />
        </label>
      </fieldset>
      <fieldset>
        <legend>Detector</legend>
        <label>
          QE
          <input
            type="number"
            value={sim.detector.qe}
            step={0.01}
            onChange={e => update('detector.qe', parseFloat(e.target.value))}
          />
        </label>
        <label>
          Read Noise
          <input
            type="number"
            value={sim.detector.read_noise}
            onChange={e => update('detector.read_noise', parseFloat(e.target.value))}
          />
        </label>
      </fieldset>
      <fieldset>
        <legend>Acquisition</legend>
        <label>
          Exposure (ms)
          <input
            type="number"
            value={sim.exposure_ms}
            onChange={e => update('exposure_ms', parseFloat(e.target.value))}
          />
        </label>
      </fieldset>
      <button onClick={runSimulation} disabled={loading}>{loading ? 'Simulating...' : 'Simulate'}</button>
      <div className="viewer">
        <h2>Viewer</h2>
        {result && (
          <>
            <div style={{ margin: '0.5rem 0' }}>
              <label>
                Z: {zIndex}
                <input
                  type="range"
                  min={0}
                  max={result.shape[1] - 1}
                  value={zIndex}
                  onChange={e => setZIndex(parseInt(e.target.value))}
                  style={{ width: '300px', marginLeft: '0.5rem' }}
                />
              </label>
            </div>
            {channelControls()}
            {compositeUrl && (
              <div>
                <img src={compositeUrl} alt="slice" style={{ maxWidth: '512px', imageRendering: 'pixelated' }} />
              </div>
            )}
            <pre style={{ maxHeight: '160px', overflow: 'auto', background: '#f9f9f9', padding: '0.5rem' }}>
              shape {JSON.stringify(result.shape)} elapsed {result.elapsed_s.toFixed(2)}s
            </pre>
          </>
        )}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />);
