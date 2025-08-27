import React, { useMemo } from 'react';
import { PictureInPictureViewer } from '@hms-dbmi/viv';
import { getDefaultInitialViewState } from '@hms-dbmi/viv';

// Custom PixelSource implementation for our HTTP-served simulation data
class SimulationPixelSource {
  public shape: number[];
  public dtype: string;
  public baseUrl: string;
  public tileSize: number;
  public labels: string[];

  constructor(
    shape: number[], // [C, Z, Y, X]
    dtype: string = 'float32',
    baseUrl: string = 'http://localhost:8000'
  ) {
    this.shape = shape;
    this.dtype = dtype;
    this.baseUrl = baseUrl;
    this.labels = ['c', 'z', 'y', 'x'];
    this.tileSize = 512; // Fixed tile size
    console.log('SimulationPixelSource created with shape:', shape);
  }

  async getRaster({ selection }: { selection: any }) {
    const { c = 0, z = 0 } = selection;
    
    console.log(`Fetching raster data for c=${c}, z=${z}`);
    
    if (c >= this.shape[0] || z >= this.shape[1] || c < 0 || z < 0) {
      console.error(`Invalid selection: c=${c}, z=${z} for shape ${this.shape}`);
      // Return empty data instead of throwing
      return {
        data: new Float32Array(this.shape[2] * this.shape[3]),
        width: this.shape[3],
        height: this.shape[2],
      };
    }

    try {
      // Fetch the chunk from our backend
      const url = `${this.baseUrl}/data/chunk/${c}/${z}`;
      console.log('Fetching from URL:', url);
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const arrayBuffer = await response.arrayBuffer();
      let data = new Float32Array(arrayBuffer);
      
      console.log(`Received data: ${data.length} floats, expected: ${this.shape[3] * this.shape[2]}`);
      console.log(`Data sample: [${Array.from(data.slice(0, 10)).join(', ')}...]`);
      console.log(`Data range: min=${Math.min(...data)}, max=${Math.max(...data)}`);
      
      // Normalize data to 0-1 range for testing
      const min = Math.min(...data);
      const max = Math.max(...data);
      if (max > min) {
        data = data.map(val => (val - min) / (max - min));
        console.log('Normalized data to 0-1 range');
      }
      
      return {
        data,
        width: this.shape[3],
        height: this.shape[2],
      };
    } catch (error) {
      console.error('Error fetching raster data:', error);
      // Return test pattern on error
      const size = this.shape[2] * this.shape[3];
      const data = new Float32Array(size);
      for (let i = 0; i < size; i++) {
        data[i] = Math.sin(i / 100) * 0.5 + 0.5; // Test pattern
      }
      console.log('Returning test pattern data');
      return {
        data,
        width: this.shape[3],
        height: this.shape[2],
      };
    }
  }

  async getTile({ x, y, z: tileZ, selection }: any) {
    console.log(`getTile called with x=${x}, y=${y}, tileZ=${tileZ}, selection=`, selection);
    // For simplicity, return the full raster for any tile request
    return this.getRaster({ selection });
  }

  onTileError(err: Error) {
    console.error('Tile error:', err);
  }
}

interface VivViewerProps {
  result: {
    shape: number[];
    zarr: { data: number[][][][] };
    stats: Array<{
      min: number;
      max: number;
      mean: number;
      std: number;
      p1: number;
      p5: number;
      p95: number;
      p99: number;
    }>;
  };
  channelSettings: Array<{
    enabled: boolean;
    lut: number;
    contrast: [number, number];
    visible: boolean;
  }>;
  defaultLuts: Array<{ name: string; color: [number, number, number] }>;
  width: number;
  height: number;
}

export const SimulationVivViewer: React.FC<VivViewerProps> = ({
  result,
  channelSettings,
  defaultLuts,
  width,
  height,
}) => {
  const { loader, contrastLimits, colors, channelsVisible, selections, viewStates } = useMemo(() => {
    if (!result) {
      console.log('No result data available');
      return { loader: null, contrastLimits: [], colors: [], channelsVisible: [], selections: [], viewStates: [] };
    }

    console.log('Processing result data:', result);
    const [C, Z, Y, X] = result.shape;
    
    // Create pixel source that fetches data via HTTP
    const pixelSource = new SimulationPixelSource(result.shape, 'float32');
    const loader = [pixelSource]; // Single scale for now

    // Convert channel settings to Viv format
    const contrastLimits: [number, number][] = [];
    const colors: [number, number, number][] = [];
    const channelsVisible: boolean[] = [];

    for (let c = 0; c < C; c++) {
      const settings = channelSettings[c];
      const stats = result.stats[c];
      
      if (settings) {
        // Convert percentage-based contrast to actual values
        const range = stats.max - stats.min;
        const minVal = Math.max(0, stats.min + (settings.contrast[0] / 100) * range);
        const maxVal = Math.min(1, stats.min + (settings.contrast[1] / 100) * range);
        contrastLimits.push([minVal, maxVal]);
        
        // Get color from LUT
        const lutIndex = settings.lut % defaultLuts.length;
        const color = defaultLuts[lutIndex].color;
        colors.push([color[0] / 255, color[1] / 255, color[2] / 255]);
        
        channelsVisible.push(settings.visible && settings.enabled);
      } else {
        // Default settings - use more visible contrast limits
        contrastLimits.push([0, 1]); // Full range for normalized data
        colors.push([1, 1, 1]); // White
        channelsVisible.push(true);
      }
    }

    // Create selections for all available channels (Viv will handle Z navigation)
    const selections = [];
    for (let c = 0; c < C; c++) {
      selections.push({ c, z: 0 }); // Start with first z-slice
    }

    // Create proper view states
    const viewStates = [getDefaultInitialViewState(loader, { width, height }, 0.5)];

    console.log('Viv loader setup:', {
      loader: loader.length,
      contrastLimits: contrastLimits.length,
      colors: colors.length,
      channelsVisible: channelsVisible.length,
      selections: selections.length,
      viewStates: viewStates.length
    });

    return { loader, contrastLimits, colors, channelsVisible, selections, viewStates };
  }, [result, channelSettings, defaultLuts, width, height]);

  if (!loader) {
    return (
      <div style={{ 
        width, 
        height, 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        backgroundColor: '#f5f5f5',
        border: '1px solid #ddd'
      }}>
        <p style={{ color: '#666' }}>No image data available</p>
      </div>
    );
  }

  console.log('Rendering PictureInPictureViewer with:', {
    loader: loader.length,
    contrastLimits,
    colors,
    channelsVisible,
    selections,
    viewStates
  });

  return (
    <div style={{ width, height, position: 'relative' }}>
      <PictureInPictureViewer
        loader={loader}
        contrastLimits={contrastLimits}
        colors={colors}
        channelsVisible={channelsVisible}
        selections={selections}
        height={height}
        width={width}
        viewStates={viewStates}
        overview={{}}
        overviewOn={false}
      />
      <div style={{
        position: 'absolute',
        top: 10,
        left: 10,
        background: 'rgba(0,0,0,0.7)',
        color: 'white',
        padding: '5px 10px',
        borderRadius: '3px',
        fontSize: '12px',
        zIndex: 1000
      }}>
        Shape: {result.shape.join('×')} | Channels: {channelsVisible.filter(Boolean).length}/{channelsVisible.length}
      </div>
    </div>
  );
};
