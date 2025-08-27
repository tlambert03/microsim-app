# Microsim Web App

This `app` directory contains a prototype interactive web application for running `microsim` simulations.

Components:

- `backend/`: A FastAPI server exposing endpoints to:
  - fetch the JSON Schema for `Simulation` (and referenced models) for dynamic form generation
  - submit a simulation specification (as JSON) and receive a rendered image (currently returns an in-memory Zarr store description and a small preview PNG for convenience)
- `frontend/`: A Vite + React TS single-page app that:
  - fetches the schema and builds a simple dynamic form for a subset of fields
  - lets user submit and then displays a simple viewer with Z + Channel controls

This is an MVP focusing on:

- Core `Simulation` fields: `truth_space.shape`, `truth_space.scale`, basic `sample.labels[0].distribution` (MatsLines), `fluorophore` (string), `concentration`, `modality` (Confocal pinhole_au), `detector` (CameraCCD minimal fields), `exposure_ms`.
- Returns: a 4D array (C, Z, Y, X) stored in an in-memory Zarr structure serialized to JSON (for now) plus a quick PNG per selected Z slice & channel composite.

Future enhancements (see code comments):
- Full recursive form generation for anyOf/oneOf branches
- Switch to proper Zarr HTTP range requests + Viv viewer integration
- LUT selection and channel coloring
- Asynchronous job queue for long simulations

## Running (dev)

Backend:

```bash
uv pip install 'fastapi[standard]' pydantic-core uvicorn[standard] pillow
uvicorn app.backend.main:app --reload
```

Frontend:

```bash
cd app/frontend
npm install
npm run dev
```

Then open the browser at the printed dev server URL (default `http://localhost:5173`). The frontend expects the API at `http://localhost:8000` (configure via `.env` or Vite env if needed).

This is intentionally minimal and can be iterated further.
