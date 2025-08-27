from __future__ import annotations

import base64
import io
import time
from typing import Any

import numpy as np
import xarray as xr
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from microsim import schema as ms
from PIL import Image
from pydantic import BaseModel
from starlette.responses import JSONResponse, Response

app = FastAPI(title="Microsim Simulation API", version="0.1.0")

# CORS for local dev (vite on 5173, docs maybe on 8000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "*",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Store the last simulation result for Viv access
_last_result = None


# Create dummy test data for Viv testing
def create_test_data():
    """Create a simple test image for Viv testing"""
    # Create a simple 2-channel, 4-slice, 64x64 test image
    shape = (2, 4, 64, 64)  # C, Z, Y, X
    data = np.zeros(shape, dtype=np.float32)

    # Channel 0: Gradient pattern
    for z in range(shape[1]):
        for y in range(shape[2]):
            for x in range(shape[3]):
                data[0, z, y, x] = (x + y + z * 10) / 200.0

    # Channel 1: Circular pattern
    center_y, center_x = shape[2] // 2, shape[3] // 2
    for z in range(shape[1]):
        for y in range(shape[2]):
            for x in range(shape[3]):
                dist = np.sqrt((y - center_y) ** 2 + (x - center_x) ** 2)
                data[1, z, y, x] = np.exp(-dist / 10.0) * (1 + z * 0.2)

    return data


# Initialize with test data
_test_data = create_test_data()


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
        raise HTTPException(
            status_code=400, detail=f"Invalid simulation parameters: {str(exc)}"
        ) from exc

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
                stats.append(
                    {
                        "min": float(np.min(channel_data)),
                        "max": float(np.max(channel_data)),
                        "mean": float(np.mean(channel_data)),
                        "std": float(np.std(channel_data)),
                        "p1": float(np.percentile(channel_data, 1)),
                        "p5": float(np.percentile(channel_data, 5)),
                        "p95": float(np.percentile(channel_data, 95)),
                        "p99": float(np.percentile(channel_data, 99)),
                    }
                )
            else:
                stats.append(
                    {
                        "min": 0.0,
                        "max": 1.0,
                        "mean": 0.0,
                        "std": 0.0,
                        "p1": 0.0,
                        "p5": 0.0,
                        "p95": 1.0,
                        "p99": 1.0,
                    }
                )

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
        preview_png_b64 = base64.b64encode(bio.getvalue()).decode("utf-8")

        # Store the result for Viv access
        global _last_result
        _last_result = {"data": a, "shape": list(a.shape), "dtype": str(a.dtype)}

        elapsed = time.perf_counter() - t0

        return JSONResponse(
            {
                "shape": list(a.shape),
                "dims": ["C", "Z", "Y", "X"],
                "dtype": str(a.dtype),
                "zarr": zarr_struct,
                "preview_png_b64": preview_png_b64,
                "stats": stats,
                "elapsed_s": elapsed,
                "z_slice_used": int(z_mid),
            }
        )

    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Simulation failed: {str(exc)}"
        ) from exc


@app.get("/data/chunk/{c}/{z}")
def get_chunk(c: int, z: int):
    """Return a chunk of simulation data for Viv to consume."""
    global _last_result, _test_data

    # Use test data if no simulation result is available
    if _last_result is None:
        data = _test_data
        shape = data.shape
    else:
        data = _last_result["data"]
        shape = _last_result["shape"]

    if c >= shape[0] or z >= shape[1]:
        raise HTTPException(
            status_code=400, detail=f"Invalid indices: c={c}, z={z} for shape {shape}"
        )

    # Extract the 2D slice
    slice_data = data[c, z, :, :].astype(np.float32)

    return Response(
        content=slice_data.tobytes(),
        media_type="application/octet-stream",
        headers={
            "Content-Length": str(slice_data.nbytes),
            "Access-Control-Allow-Origin": "*",
        },
    )


@app.get("/data/info")
def get_data_info():
    """Return metadata about the current simulation data."""
    global _last_result, _test_data

    # Use test data if no simulation result is available
    if _last_result is None:
        shape = _test_data.shape
        dtype = str(_test_data.dtype)
    else:
        shape = _last_result["shape"]
        dtype = _last_result["dtype"]

    return {
        "shape": shape,
        "dtype": dtype,
        "chunks": shape,  # Single chunk for simplicity
    }


@app.get("/test-data")
def get_test_data():
    """Return test simulation data for Viv testing."""
    global _test_data

    shape = _test_data.shape  # (C, Z, Y, X)

    # Generate fake stats for each channel
    stats = []
    for c in range(shape[0]):
        channel_data = _test_data[c, :, :, :]
        stats.append(
            {
                "min": float(channel_data.min()),
                "max": float(channel_data.max()),
                "mean": float(channel_data.mean()),
                "std": float(channel_data.std()),
                "p1": float(np.percentile(channel_data, 1)),
                "p5": float(np.percentile(channel_data, 5)),
                "p95": float(np.percentile(channel_data, 95)),
                "p99": float(np.percentile(channel_data, 99)),
            }
        )

    return {
        "shape": shape,
        "dims": ["C", "Z", "Y", "X"],
        "elapsed_s": 0.1,
        "stats": stats,
        "zarr": {"data": []},  # Empty for now, not needed for HTTP-based access
    }


@app.get("/health")
def health():
    return {"status": "ok", "message": "Microsim API is running"}


@app.get("/")
def root():
    return {
        "message": "Microsim Simulation API",
        "version": "0.1.0",
        "docs": "/docs",
        "health": "/health",
    }
