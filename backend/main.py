from __future__ import annotations

import io
import time
from typing import Any

import numpy as np
import xarray as xr
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from starlette.responses import JSONResponse
from PIL import Image

from microsim import schema as ms

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
    """Run a simulation from provided JSON and return a basic representation.

    Returns a JSON dict with:
    - shape: (C, Z, Y, X)
    - zarr: Nested dict structure with .zarray metadata + chunks encoded as base64 (MVP)
        - preview_png: base64 PNG for first Z slice composite (simple gray or
            per-channel color)
    """
    t0 = time.perf_counter()
    try:
        sim = ms.Simulation.model_validate(req.simulation)
    except Exception as exc:  # broad for user feedback; refine later
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    data = sim.run()  # (C, Z, Y, X)
    arr: xr.DataArray = data
    xp = np  # ensure host memory
    a = xp.asarray(arr.data)

    # Build a minimal in-memory zarr-like structure (not a full spec)
    # For now, single chunk
    zarr_struct = {
        "zarray": {
            "shape": list(a.shape),
            "chunks": list(a.shape),
            "dtype": str(a.dtype),
            "order": "C",
            "fill_value": 0,
            "filters": None,
            "compressor": None,
            "dimension_separator": ".",
        },
        "data": a.tolist(),  # naive; large arrays will be heavy
    }

    # Create a simple preview PNG (Z max projection per channel with naive coloring)
    z0 = a[:, a.shape[1] // 2, :, :]  # mid Z slice
    # Normalize per channel
    colors = [
        (255, 0, 0),
        (0, 255, 0),
        (0, 0, 255),
        (255, 255, 0),
        (255, 0, 255),
    ]
    composite = np.zeros((z0.shape[1], z0.shape[2], 3), dtype=np.float32)
    for ci in range(min(z0.shape[0], len(colors))):
        ch = z0[ci].astype(np.float32)
        if ch.max() > 0:
            ch /= ch.max()
        color = np.array(colors[ci]) / 255.0
        composite += ch[..., None] * color
    composite = np.clip(composite, 0, 1)
    img = (composite * 255).astype(np.uint8)
    im = Image.fromarray(img)
    bio = io.BytesIO()
    im.save(bio, format="PNG")
    preview_png_b64 = bio.getvalue().hex()  # hex for simplicity

    elapsed = time.perf_counter() - t0
    return JSONResponse(
        {
            "shape": list(a.shape),
            "dims": ["C", "Z", "Y", "X"],
            "dtype": str(a.dtype),
            "zarr": zarr_struct,
            "preview_png_hex": preview_png_b64,
            "elapsed_s": elapsed,
        }
    )


@app.get("/health")
def health():
    return {"status": "ok"}
