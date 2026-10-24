import random
from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from adoption_compass.api import create_app
from adoption_compass.config import Settings
from adoption_compass.services import Services, build_services

TODAY = date(2026, 10, 24)


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        db_path=tmp_path / "compass.db",
        today=TODAY,
        mcp_root=tmp_path,
        static_dir=tmp_path / "no-frontend",
    )


@pytest.fixture
def services(settings: Settings) -> Services:
    return build_services(settings)


@pytest.fixture
def client(settings: Settings) -> TestClient:
    return TestClient(create_app(settings))


@pytest.fixture
def rng() -> random.Random:
    return random.Random(20261024)
