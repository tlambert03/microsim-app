# Microsim Web App

A web application for interactive microscopy simulation using the [microsim](https://github.com/pymmcore-plus/microsim) library. This app consists of a FastAPI backend server and a React frontend that allows users to configure microscopy simulation parameters through an interactive web interface and visualize the resulting simulated images.

## Architecture

- **Backend**: FastAPI server that exposes the microsim simulation API
- **Frontend**: React + TypeScript + Vite application for the user interface
- **Communication**: REST API with JSON payloads for simulation configuration

## Features

- Interactive form-based configuration of simulation parameters
- Real-time preview of simulated microscopy images
- Multi-channel image support with customizable color lookup tables (LUTs)
- Z-stack navigation with sliders
- Nearest-neighbor upscaling for small images
- Channel enable/disable controls
- Responsive web interface

## Prerequisites

- Python 3.13+
- Node.js 18+
- [uv](https://docs.astral.sh/uv/) for Python package management

## Setup & Development

### Backend Setup

1. Navigate to the backend directory:

   ```bash
   cd backend
   ```

2. Install dependencies using uv:

   ```bash
   uv sync
   ```

3. Start the FastAPI development server:

   ```bash
   uv run uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

   The API will be available at `http://localhost:8000` with automatic docs at `http://localhost:8000/docs`

### Frontend Setup

1. Navigate to the frontend directory:

   ```bash
   cd frontend
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Start the development server:

   ```bash
   npm run dev
   ```

   The web app will be available at `http://localhost:5173`

### Running Both Services

For development, you'll need to run both the backend and frontend simultaneously in separate terminals:

Terminal 1 (Backend):

```bash
cd backend
uv run uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Terminal 2 (Frontend):

```bash
cd frontend
npm run dev
```

## API Endpoints

### `GET /schema/simulation`

Returns the JSON schema for the Simulation model to enable dynamic form building.

### `POST /simulate`

Accepts a simulation configuration and returns simulated image data:

**Request Body:**

```json
{
  "simulation": {
    "truth_space": { "shape": [32, 128, 128], "scale": [0.1, 0.05, 0.05] },
    "sample": { "labels": [...] },
    "modality": { "type": "confocal", "pinhole_au": 0.75 },
    "detector": { "camera_type": "CCD", "qe": 0.8, "read_noise": 2, "bit_depth": 12 },
    "exposure_ms": 150,
    "settings": { "random_seed": 1 }
  }
}
```

**Response:**

```json
{
  "shape": [1, 32, 128, 128],
  "dims": ["C", "Z", "Y", "X"],
  "dtype": "float64",
  "zarr": { "zarray": {...}, "data": [...] },
  "preview_png_hex": "...",
  "elapsed_s": 1.23
}
```

### `GET /health`

Health check endpoint.

## Usage

1. Start both the backend and frontend servers
2. Open your browser to `http://localhost:5173`
3. Configure simulation parameters using the form controls:
   - **Truth Space**: Define the 3D volume dimensions (Z, Y, X)
   - **Sample**: Configure fluorophore concentration and distribution
   - **Modality**: Set microscopy parameters (e.g., confocal pinhole)
   - **Detector**: Configure camera properties (QE, read noise, etc.)
   - **Acquisition**: Set exposure time
4. Click "Simulate" to generate the image
5. Use the viewer controls to:
   - Navigate through Z-slices with the slider
   - Enable/disable channels with checkboxes
   - Change channel colors using the LUT dropdowns

## Current Limitations

- Simple form interface (more advanced schema-driven forms coming soon)
- Basic zarr-like data structure (not full zarr specification)
- Limited to small image sizes for performance
- No persistent storage of simulations

## Future Enhancements

- Integration with [Viv](https://github.com/hms-dbmi/viv) for advanced image visualization
- Full zarr file generation for larger datasets
- More sophisticated form generation from JSON schema
- Contrast/brightness controls
- Export functionality for simulated images
- Preset simulation configurations
- Performance optimizations for larger images

## Development Notes

- The backend uses the microsim library to generate simulated microscopy images
- Images are returned as nested arrays with shape [C, Z, Y, X] (Channels, Z-slices, Y, X)
- The frontend composites multi-channel images using configurable color lookup tables
- Small images are upscaled using nearest-neighbor interpolation for better visibility
- CORS is configured to allow local development with Vite's dev server

## Troubleshooting

**Backend Issues:**

- Ensure microsim is properly installed: `uv run python -c "import microsim; print('OK')"`
- Check that the server is running on port 8000: `curl http://localhost:8000/health`

**Frontend Issues:**

- Verify Node.js version: `node --version` (should be 18+)
- Clear npm cache if installation fails: `npm cache clean --force`
- Check that the frontend can reach the backend: open browser dev tools and check for CORS errors

**Simulation Errors:**

- Start with small image dimensions (32x32 or 64x64) for faster iteration
- Check the browser console for detailed error messages
- Verify simulation parameters are within valid ranges
