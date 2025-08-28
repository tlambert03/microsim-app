from __future__ import annotations

import base64
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pytest
import xarray as xr
from fastapi.testclient import TestClient

sys.path.append(str(Path(__file__).parent.parent))
import main


@pytest.fixture()
def client() -> TestClient:
    """Return a TestClient bound to the FastAPI app under test."""
    return TestClient(main.app)


def test_health(client: TestClient) -> None:
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "message": "Microsim API is running"}


def test_root(client: TestClient) -> None:
    r = client.get("/")
    assert r.status_code == 200
    j = r.json()
    assert j["message"] == "Microsim Simulation API"
    assert j["version"] == "0.1.0"
    assert j["docs"] == "/docs"
    assert j["health"] == "/health"


def test_get_simulation_schema_uses_ms(
    monkeypatch: pytest.MonkeyPatch, client: TestClient
) -> None:
    class _DummySim:
        @staticmethod
        def model_json_schema() -> dict[str, Any]:  # minimal sentinel response
            return {"title": "Simulation", "type": "object"}

    monkeypatch.setattr(main.ms, "Simulation", _DummySim)  # type: ignore[arg-type]

    r = client.get("/schema/simulation")
    assert r.status_code == 200
    assert r.json() == {"title": "Simulation", "type": "object"}


def test_simulate_validation_error(
    monkeypatch: pytest.MonkeyPatch, client: TestClient
) -> None:
    class _DummySim:
        @staticmethod
        def model_validate(_: dict[str, Any]) -> Any:
            raise ValueError("bad sim params")

    monkeypatch.setattr(main.ms, "Simulation", _DummySim)  # type: ignore[arg-type]

    r = client.post("/simulate", json={"simulation": {"foo": "bar"}})
    assert r.status_code == 400
    j = r.json()
    assert j["detail"].startswith("Invalid simulation parameters:")


def _fake_simulated_data(
    c: int = 2, z: int = 3, y: int = 8, x: int = 10
) -> xr.DataArray:
    """Create a small, nontrivial (C, Z, Y, X) float32 array wrapped in xarray.

    The content is constructed to have a spread so that percentile logic is exercised.
    """
    arr = np.zeros((c, z, y, x), dtype=np.float32)
    for ci in range(c):
        for zi in range(z):
            yy, xx = np.meshgrid(
                np.linspace(0, 1, y, dtype=np.float32),
                np.linspace(0, 1, x, dtype=np.float32),
                indexing="ij",
            )
            # channel- and z-dependent ramps to get distinct stats per channel
            arr[ci, zi] = (ci + 1) * (0.3 + 0.7 * (0.4 * yy + 0.6 * xx)) + 0.1 * zi
    return xr.DataArray(arr, dims=("C", "Z", "Y", "X"))


def test_simulate_success(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    class _FakeSim:
        def run(self) -> xr.DataArray:
            return _fake_simulated_data()

    class _DummySim:
        @staticmethod
        def model_validate(_: dict[str, Any]) -> _FakeSim:
            return _FakeSim()

    monkeypatch.setattr(main.ms, "Simulation", _DummySim)  # type: ignore[arg-type]

    r = client.post("/simulate", json={"simulation": {"whatever": 1}})
    assert r.status_code == 200
    j = r.json()

    # Top-level structure assertions
    assert j["dims"] == ["C", "Z", "Y", "X"]
    assert j["shape"] == [2, 3, 8, 10]
    assert j["dtype"].lower() in {"float32", "float32"}

    # zarr struct looks sane
    zarr = j["zarr"]
    assert zarr["zarray"]["shape"] == [2, 3, 8, 10]
    assert zarr["zarray"]["chunks"] == [2, 3, 8, 10]
    assert zarr["zarray"]["dtype"].lower() == "float32"
    assert "data" in zarr and isinstance(zarr["data"], list)

    # preview exists and is base64-decodable PNG
    b64 = j["preview_png_b64"]
    assert isinstance(b64, str) and len(b64) > 0
    # Should decode without error; we do not verify PNG header bytes here to stay lightweight
    base64.b64decode(b64)

    # stats per channel present and sensible
    stats = j["stats"]
    assert isinstance(stats, list) and len(stats) == 2
    for s in stats:
        for key in ("min", "max", "mean", "std", "p1", "p5", "p95", "p99"):
            assert key in s
            assert isinstance(s[key], float)
        assert s["max"] > s["min"]
        assert s["p99"] >= s["p95"] >= s["mean"] >= s["p5"] >= s["p1"]

    # z-slice selection is the midpoint of 3 -> index 1
    assert j["z_slice_used"] == 1

    # elapsed is nonnegative
    assert j["elapsed_s"] >= 0.0
