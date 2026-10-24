import asyncio
import json
import os
import stat
import sys
from pathlib import Path

import pytest
from mcp import Client, StdioServerParameters

from adoption_compass.config import Settings
from adoption_compass.mcp_server import _inside, create_mcp_server
from adoption_compass.services import build_services

from .conftest import TODAY

PHONE = "+7 912 345-67-89"
PROCESSES = [
    {
        "name": "Ответы клиентам",
        "task_type": "drafting",
        "runs_per_month": 4000,
        "minutes_per_run": 6,
    },
    {
        "name": "Скрининг резюме",
        "task_type": "classification",
        "runs_per_month": 1500,
        "minutes_per_run": 5,
        "data_sensitivity": "personal",
    },
]


@pytest.fixture
def root(tmp_path: Path) -> Path:
    folder = tmp_path / "workspace"
    folder.mkdir()
    (folder / "client.txt").write_text(
        f"Клиент Иванов Иван Иванович, тел. {PHONE}", encoding="utf-8"
    )
    return folder


@pytest.fixture
def server(tmp_path: Path, root: Path):
    settings = Settings(db_path=tmp_path / "x.db", today=TODAY, mcp_root=root)
    return create_mcp_server(build_services(settings, with_storage=False), root)


def call(server, name: str, arguments: dict | None = None):
    async def go():
        async with Client(server) as client:
            return await client.call_tool(name, arguments or {})

    return asyncio.run(go())


def data(result):
    """Структурированный ответ инструмента (списки SDK оборачивает в {"result": [...]})."""
    assert not result.is_error, result.content[0].text
    payload = result.structured_content
    if payload is None:
        payload = json.loads(result.content[0].text)
    return payload["result"] if set(payload) == {"result"} else payload


def error_text(result) -> str:
    assert result.is_error
    return result.content[0].text


def test_server_advertises_all_tools_and_instructions(server):
    async def go():
        async with Client(server) as client:
            return await client.list_tools()

    tools = {t.name: t for t in asyncio.run(go()).tools}
    assert set(tools) == {
        "assess_ai_use_cases",
        "recommend_models",
        "scan_sensitive_data",
        "mask_sensitive_data",
        "scan_file",
        "mask_file",
        "lint_prompt",
        "list_prompt_templates",
        "render_prompt_template",
        "check_catalog_freshness",
    }
    assert all(t.description for t in tools.values())


def test_recommend_models_respects_data_policy(server):
    result = data(
        call(
            server,
            "recommend_models",
            {
                "task_type": "classification",
                "requests_per_month": 20000,
                "tokens_in": 700,
                "tokens_out": 60,
                "data_sensitivity": "personal",
                "top": 3,
            },
        )
    )
    assert len(result["recommendations"]) == 3
    assert all(r["deployment"] != "foreign_cloud" for r in result["recommendations"])
    assert result["recommendations"][0]["requires_masking"] in (True, False)
    assert result["data_status"] == "illustrative"


def test_recommend_models_rejects_unknown_enum(server):
    assert "magic" in error_text(
        call(
            server,
            "recommend_models",
            {"task_type": "magic", "requests_per_month": 1, "tokens_in": 1, "tokens_out": 1},
        )
    )


def test_assess_ai_use_cases_accepts_plain_dicts_and_assigns_ids(server):
    result = data(call(server, "assess_ai_use_cases", {"processes": PROCESSES, "top": 5}))
    assert result["summary"]["processes_total"] == 2
    assert {row["id"] for row in result["top"]} == {"P01", "P02"}
    assert all("quadrant" in row for row in result["top"])


def test_assess_ai_use_cases_reports_validation_errors(server):
    bad = [{"name": "X", "task_type": "drafting", "runs_per_month": 0, "minutes_per_run": 1}]
    assert "runs_per_month" in error_text(call(server, "assess_ai_use_cases", {"processes": bad}))


def test_scan_and_mask_text_never_return_raw_values(server):
    text = f"Иванов Иван Иванович {PHONE}"
    scan = call(server, "scan_sensitive_data", {"text": text})
    assert PHONE not in json.dumps(data(scan), ensure_ascii=False)
    assert data(scan)["effective_sensitivity"] == "personal"
    assert "masked_text" not in data(scan)
    masked = data(call(server, "mask_sensitive_data", {"text": text}))
    assert masked == {"masked_text": "[PERSON_1] [PHONE_1]", "counts": {"PERSON": 1, "PHONE": 1}}


def test_scan_file_returns_metadata_only(server, root):
    result = data(call(server, "scan_file", {"path": "client.txt"}))
    assert result["path"] == "client.txt"
    assert result["counts"] == {"PERSON_RU": 1, "PHONE_RU": 1}
    assert PHONE not in json.dumps(result, ensure_ascii=False)


def test_mask_file_writes_masked_copy_and_private_mapping(server, root):
    result = data(call(server, "mask_file", {"path": "client.txt"}))
    assert result["masked_file"] == "client.masked.txt"
    assert (root / "client.masked.txt").read_text(
        encoding="utf-8"
    ) == "Клиент [PERSON_1], тел. [PHONE_1]"
    mapping = root / result["mapping_file"]
    assert json.loads(mapping.read_text(encoding="utf-8"))["[PHONE_1]"] == PHONE
    if os.name == "posix":  # Windows использует ACL вместо POSIX-прав.
        assert stat.S_IMODE(os.stat(mapping).st_mode) == 0o600
    assert PHONE not in json.dumps(result, ensure_ascii=False)


def test_mask_file_does_not_overwrite_without_flag(server):
    assert not call(server, "mask_file", {"path": "client.txt"}).is_error
    assert "overwrite" in error_text(call(server, "mask_file", {"path": "client.txt"}))
    assert not call(server, "mask_file", {"path": "client.txt", "overwrite": True}).is_error


@pytest.mark.parametrize(
    "path", ["../outside.txt", "../../etc/passwd", "/etc/passwd", "sub/../../x"]
)
def test_file_tools_refuse_paths_outside_the_root(server, path):
    for tool in ("scan_file", "mask_file"):
        assert "вне разрешённой папки" in error_text(call(server, tool, {"path": path}))


def test_symlink_escape_is_refused(server, root, tmp_path):
    outside = tmp_path / "outside.txt"
    outside.write_text(f"секрет {PHONE}", encoding="utf-8")
    (root / "link.txt").symlink_to(outside)
    assert "вне разрешённой папки" in error_text(call(server, "scan_file", {"path": "link.txt"}))


def test_missing_and_oversized_files_are_rejected(server, root):
    assert "не найден" in error_text(call(server, "scan_file", {"path": "nope.txt"}))
    (root / "big.txt").write_text("я" * 3_000_000, encoding="utf-8")
    assert "КБ" in error_text(call(server, "scan_file", {"path": "big.txt"}))


def test_output_path_cannot_escape_the_root(server):
    assert "вне разрешённой папки" in error_text(
        call(server, "mask_file", {"path": "client.txt", "output_path": "../leak.txt"})
    )


def test_inside_helper_accepts_nested_paths(root):
    (root / "a").mkdir()
    assert _inside(root.resolve(), "a/b.txt") == root.resolve() / "a" / "b.txt"


def test_lint_and_templates(server):
    lint = data(call(server, "lint_prompt", {"text": "Напиши про ИИ"}))
    assert lint["grade"] == "D"
    templates = data(call(server, "list_prompt_templates", {"department": "Поддержка"}))
    assert {t["id"] for t in templates} >= {"ticket-triage", "customer-reply"}
    rendered = data(
        call(
            server,
            "render_prompt_template",
            {"template_id": "ticket-triage", "values": {"ticket_text": "Не работает вход"}},
        )
    )
    assert "Не работает вход" in rendered["text"]
    assert rendered["lint_score"] >= 80
    assert "не найден" in error_text(
        call(server, "render_prompt_template", {"template_id": "x", "values": {}})
    )
    assert "Не заполнено" in error_text(
        call(server, "render_prompt_template", {"template_id": "ticket-triage", "values": {}})
    )


def test_catalog_freshness(server):
    result = data(call(server, "check_catalog_freshness", {"max_age_days": 30}))
    assert result["stale"] == []
    assert result["data_status"] == "illustrative"


def test_policy_handout_is_exposed_as_a_resource(server):
    async def go():
        async with Client(server) as client:
            return await client.read_resource("compass://policy/handout")

    contents = asyncio.run(go()).contents[0]
    assert contents.text.startswith("# Памятка")


def test_real_stdio_process_serves_tools(tmp_path):
    """Сквозной тест: тот же процесс, который запускают Claude Code / Codex / Kiro."""
    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "adoption_compass", "mcp", "--root", str(tmp_path)],
        env={**os.environ, "COMPASS_TODAY": "2026-10-24"},
    )

    async def go():
        async with Client(params) as client:
            tools = await client.list_tools()
            result = await client.call_tool("check_catalog_freshness", {})
            return {t.name for t in tools.tools}, result

    names, result = asyncio.run(asyncio.wait_for(go(), timeout=60))
    assert "recommend_models" in names
    assert not result.is_error
