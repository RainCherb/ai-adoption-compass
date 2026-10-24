"""Контейнерный launcher: публичный режим запускается без shell и подстановки кавычек хостинга."""

import os
import sys

import uvicorn

from .config import Settings


def main() -> None:
    if Settings.from_env().demo_mode:
        port = int(os.environ.get("PORT", "8000"))
        if not 1 <= port <= 65535:
            raise ValueError("PORT должен быть от 1 до 65535")
        # В публичном режиме CMD не может случайно запустить приложение без ограничений.
        uvicorn.run(
            "adoption_compass.api.app:create_app",
            factory=True,
            host="0.0.0.0",  # noqa: S104 — внешний интерфейс внутри контейнера хостинга
            port=port,
            limit_concurrency=32,
            access_log=False,
        )
        return
    if len(sys.argv) < 2:
        raise SystemExit("Укажите команду запуска контейнера")
    os.execvp(sys.argv[1], sys.argv[1:])  # noqa: S606 — только CMD оператора контейнера, не HTTP-ввод


if __name__ == "__main__":
    main()
