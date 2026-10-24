"""Скриншоты веб-интерфейса для README: запускает API, открывает страницы в Chrome и сохраняет PNG.

Нужен собранный фронтенд (`make web`) и Playwright (`pip install -e ".[docs]"`). Браузер — системный Chrome/Chromium
(путь можно задать в CHROME_PATH), скачивать его отдельно не нужно.
"""

import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

from playwright.sync_api import Page, expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "assets" / "screenshots"
PORT = 8765
BASE = f"http://127.0.0.1:{PORT}"
WIDTH = 1440


def find_chrome() -> str:
    candidates = [
        os.environ.get("CHROME_PATH"),
        shutil.which("google-chrome"),
        shutil.which("chromium"),
    ]
    for candidate in candidates:
        if candidate:
            return candidate
    raise SystemExit("Не найден Chrome/Chromium: задайте CHROME_PATH")


def wait_for_api(timeout: float = 30.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"{BASE}/api/health", timeout=2):
                return
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            time.sleep(0.3)
    raise SystemExit("API не запустился")


def settle(page: Page) -> None:
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(350)  # дорисовка анимаций и графиков


def shot(page: Page, name: str, height: int = 900) -> None:
    page.set_viewport_size({"width": WIDTH, "height": height})
    page.evaluate("window.scrollTo(0, 0)")
    settle(page)
    extension = "jpg" if name in {"advisor", "evals", "cashflow"} else "png"
    path = OUT / f"{name}.{extension}"
    page.screenshot(path=str(path))
    print(f"Записано: {path.relative_to(ROOT)}")


def capture(page: Page) -> None:
    # 1. Оценка процессов: демо-портфель
    page.goto(f"{BASE}/#/assessment")
    page.get_by_role("button", name="Загрузить демо-данные").first.click()
    expect(page.get_by_test_id("quadrant-chart")).to_be_visible()
    shot(page, "assessment", height=1500)

    # 2. Карточка процесса
    page.get_by_test_id("process-row").first.click()
    expect(page.get_by_test_id("money-steps")).to_be_visible()
    shot(page, "assessment-detail", height=1000)
    page.keyboard.press("Escape")

    # 3. Подбор моделей: персональные данные
    page.goto(f"{BASE}/#/advisor")
    page.get_by_text("Персональные", exact=False).first.click()
    expect(page.get_by_test_id("recommendation").first).to_be_visible()
    shot(page, "advisor", height=1500)

    # 4. Безопасность данных
    page.goto(f"{BASE}/#/safety")
    page.get_by_role("button", name="Вставить пример").click()
    page.get_by_role("button", name="Проверить").first.click()
    expect(page.get_by_test_id("analysis-result")).to_be_visible()
    shot(page, "safety", height=1400)

    # 5. Промпты
    page.goto(f"{BASE}/#/prompts")
    page.get_by_text("Классификация и приоритизация обращения").first.click()
    page.get_by_role("button", name="Подставить пример").click()
    expect(page.get_by_test_id("rendered-prompt")).to_be_visible()
    shot(page, "prompts", height=1400)

    # 6. Качество моделей
    page.goto(f"{BASE}/#/evals")
    expect(page.get_by_test_id("eval-table")).to_be_visible()
    page.get_by_test_id("eval-row").nth(2).click()
    expect(page.get_by_test_id("provider-detail")).to_be_visible()
    shot(page, "evals", height=1500)


def main() -> None:
    if not (ROOT / "src" / "adoption_compass" / "static" / "index.html").exists():
        raise SystemExit("Сначала соберите интерфейс: make web")
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        env = {**os.environ, "COMPASS_DB": f"{tmp}/shots.db", "COMPASS_TODAY": "2026-10-24"}
        server = subprocess.Popen(
            [sys.executable, "-m", "adoption_compass", "serve", "--port", str(PORT)],
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            wait_for_api()
            with sync_playwright() as p:
                browser = p.chromium.launch(executable_path=find_chrome(), args=["--no-sandbox"])
                context = browser.new_context(
                    viewport={"width": WIDTH, "height": 900}, color_scheme="dark"
                )
                page = context.new_page()
                errors: list[str] = []
                page.on("pageerror", lambda exc: errors.append(str(exc)))
                page.on(
                    "console", lambda msg: errors.append(msg.text) if msg.type == "error" else None
                )
                capture(page)

                # светлая тема
                light = browser.new_context(
                    viewport={"width": WIDTH, "height": 900}, color_scheme="light"
                )
                light.add_init_script("localStorage.setItem('compass-theme', 'light')")
                light_page = light.new_page()
                light_page.goto(f"{BASE}/#/assessment")
                light_page.get_by_role("button", name="Загрузить демо-данные").first.click()
                expect(light_page.get_by_test_id("quadrant-chart")).to_be_visible()
                shot(light_page, "assessment-light", height=1500)
                browser.close()
                if errors:
                    raise SystemExit("Ошибки в консоли браузера:\n" + "\n".join(errors))
        finally:
            server.terminate()
            server.wait(timeout=10)


if __name__ == "__main__":
    main()
