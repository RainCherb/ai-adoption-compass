"""Настройки приложения из переменных окружения."""

import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    """Параметры запуска. Все значения имеют безопасные значения по умолчанию."""

    db_path: Path = Path("compass.db")
    data_dir: Path | None = None
    static_dir: Path | None = None
    mcp_root: Path = field(default_factory=Path.cwd)
    usd_rub: float | None = None
    today: date | None = None
    max_text_chars: int = 200_000
    max_upload_bytes: int = 2_000_000

    @property
    def current_date(self) -> date:
        return self.today or date.today()

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "Settings":
        """COMPASS_DB, COMPASS_DATA_DIR, COMPASS_STATIC_DIR, COMPASS_MCP_ROOT, COMPASS_USD_RUB,
        COMPASS_TODAY (ГГГГ-ММ-ДД — зафиксировать «сегодня» для воспроизводимых проверок)."""
        source = os.environ if env is None else env
        usd_rub = source.get("COMPASS_USD_RUB")
        today = source.get("COMPASS_TODAY")
        return cls(
            db_path=Path(source.get("COMPASS_DB", "compass.db")),
            data_dir=Path(source["COMPASS_DATA_DIR"]) if source.get("COMPASS_DATA_DIR") else None,
            static_dir=(
                Path(source["COMPASS_STATIC_DIR"]) if source.get("COMPASS_STATIC_DIR") else None
            ),
            mcp_root=Path(source.get("COMPASS_MCP_ROOT") or Path.cwd()),
            usd_rub=float(usd_rub) if usd_rub else None,
            today=date.fromisoformat(today) if today else None,
        )
