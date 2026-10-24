import sys
from unittest.mock import patch

import pytest

from adoption_compass.container import main


def test_demo_uses_port_and_cannot_execute_an_unrestricted_cmd(monkeypatch):
    monkeypatch.setenv("COMPASS_DEMO_MODE", "1")
    monkeypatch.setenv("PORT", "10000")
    monkeypatch.setattr(sys, "argv", ["launcher", "sh", "-c", "unsafe-command"])
    with patch("adoption_compass.container.uvicorn.run") as run, patch("os.execvp") as execute:
        main()
    assert run.call_args.kwargs["port"] == 10000
    assert run.call_args.kwargs["access_log"] is False
    assert run.call_args.kwargs["limit_concurrency"] == 32
    execute.assert_not_called()


def test_normal_mode_preserves_container_commands(monkeypatch):
    monkeypatch.delenv("COMPASS_DEMO_MODE", raising=False)
    monkeypatch.setattr(sys, "argv", ["launcher", "compass", "--version"])
    with patch("os.execvp") as execute:
        main()
    execute.assert_called_once_with("compass", ["compass", "--version"])


@pytest.mark.parametrize("port", ["-1", "0", "65536", "invalid"])
def test_bad_container_port_is_rejected(monkeypatch, port):
    monkeypatch.setenv("COMPASS_DEMO_MODE", "1")
    monkeypatch.setenv("PORT", port)
    with pytest.raises(ValueError, match=r"PORT|invalid literal"):
        main()
