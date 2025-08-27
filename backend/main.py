from __future__ import annotations

import io
import time
from typing import Any
import base64

import numpy as np
import xarray as xr
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from microsim import schema as ms
from PIL import Image
from pydantic import BaseModel
from starlette.responses import JSONResponse

app = FastAPI(title="Microsim Simulation API", version="0.1.0")

# CORS for local dev (vite on 5173, docs maybe on 8000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/schema/simulation")
def get_simulation_schema() -> dict[str, Any]:
    """Return the JSON schema for the Simulation model for dynamic form building."""
    schema = ms.Simulation.model_json_schema()
    return schema


class SimulationRequest(BaseModel):
    simulation: dict[str, Any]


@app.post("/simulate")
def simulate(req: SimulationRequest):
    """Run a simulation from provided JSON and return a comprehensive representation.

    Returns a JSON dict with:
    - shape: (C, Z, Y, X)
    - zarr: Nested dict structure with .zarray metadata + chunks encoded as base64
    - preview_png: base64 PNG for first Z slice composite (simple gray or per-channel color)
    - stats: per-channel statistics for histogram/contrast visualization
    """
    t0 = time.perf_counter()
    try:
        sim = ms.Simulation.model_validate(req.simulation)
    except Exception as exc:  # broad for user feedback; refine later
        raise HTTPException(status_code=400, detail=f"Invalid simulation parameters: {str(exc)}") from exc

    try:
        data = sim.run()  # (C, Z, Y, X)
        arr: xr.DataArray = data
        xp = np  # ensure host memory
        a = xp.asarray(arr.data)

        # Ensure data is float32 for consistent processing
        if a.dtype != np.float32:
            a = a.astype(np.float32)

        # Build a minimal in-memory zarr-like structure
        zarr_struct = {
            "zarray": {
                "shape": list(a.shape),
                "chunks": list(a.shape),  # Single chunk for simplicity
                "dtype": str(a.dtype),
                "order": "C",
                "fill_value": 0,
                "filters": None,
                "compressor": None,
                "dimension_separator": ".",
            },
            "data": a.tolist(),  # Convert to nested lists for JSON serialization
        }

        # Compute per-channel statistics for contrast controls
        stats = []
        for c in range(a.shape[0]):
            channel_data = a[c].flatten()
            channel_data = channel_data[np.isfinite(channel_data)]  # Remove inf/nan
            if len(channel_data) > 0:
                stats.append({
                    "min": float(np.min(channel_data)),
                    "max": float(np.max(channel_data)),
                    "mean": float(np.mean(channel_data)),
                    "std": float(np.std(channel_data)),
                    "p1": float(np.percentile(channel_data, 1)),
                    "p5": float(np.percentile(channel_data, 5)),
                    "p95": float(np.percentile(channel_data, 95)),
                    "p99": float(np.percentile(channel_data, 99)),
                })
            else:
                stats.append({
                    "min": 0.0, "max": 1.0, "mean": 0.0, "std": 0.0,
                    "p1": 0.0, "p5": 0.0, "p95": 1.0, "p99": 1.0
                })

        # Create an enhanced preview PNG (mid Z slice with better coloring)
        z_mid = a.shape[1] // 2
        z_slice = a[:, z_mid, :, :]  # Shape: (C, Y, X)
        
        # Enhanced color mapping
        colors = [
            (1.0, 0.2, 0.2),  # Red
            (0.2, 1.0, 0.2),  # Green  
            (0.2, 0.2, 1.0),  # Blue
            (1.0, 0.2, 1.0),  # Magenta
            (1.0, 1.0, 0.2),  # Yellow
            (0.2, 1.0, 1.0),  # Cyan
            (1.0, 1.0, 1.0),  # White
        ]
        
        # Create composite image
        composite = np.zeros((z_slice.shape[1], z_slice.shape[2], 3), dtype=np.float32)
        
        for ci in range(min(z_slice.shape[0], len(colors))):
            ch = z_slice[ci].astype(np.float32)
            if np.max(ch) > 0:
                # Use percentile-based normalization for better contrast
                p1, p99 = np.percentile(ch, [1, 99])
                if p99 > p1:
                    ch_norm = np.clip((ch - p1) / (p99 - p1), 0, 1)
                else:
                    ch_norm = ch / np.max(ch) if np.max(ch) > 0 else ch
            else:
                ch_norm = ch
            
            color = np.array(colors[ci])
            composite += ch_norm[..., None] * color
        
        # Clip and convert to image
        composite = np.clip(composite, 0, 1)
        img_array = (composite * 255).astype(np.uint8)
        img = Image.fromarray(img_array)
        
        # Save to base64
        bio = io.BytesIO()
        img.save(bio, format="PNG")
        preview_png_b64 = base64.b64encode(bio.getvalue()).decode('utf-8')

        elapsed = time.perf_counter() - t0
        
        return JSONResponse({
            "shape": list(a.shape),
            "dims": ["C", "Z", "Y", "X"],
            "dtype": str(a.dtype),
            "zarr": zarr_struct,
            "preview_png_b64": preview_png_b64,
            "stats": stats,
            "elapsed_s": elapsed,
            "z_slice_used": int(z_mid),
        })

    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Simulation failed: {str(exc)}") from exc


@app.get("/health")
def health():
    return {"status": "ok", "message": "Microsim API is running"}


@app.get("/")
def root():
    return {
        "message": "Microsim Simulation API", 
        "version": "0.1.0",
        "docs": "/docs",
        "health": "/health"
    }
