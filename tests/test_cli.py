import json
import os
import stat
from pathlib import Path

import httpx
import pytest
from typer.testing import CliRunner

from adoption_compass import __version__, cli
from adoption_compass.evals import OpenAICompatibleProvider
from adoption_compass.resources import read_data_text
from adoption_compass.safety import Policy

runner = CliRunner()
ENV = {"COMPASS_TODAY": "2026-10-24", "COLUMNS": "200"}
PHONE = "+7 912 345-67-89"


def run(*args: str, input: str | None = None, env: dict[str, str] | None = None):
    return runner.invoke(cli.app, list(args), input=input, env={**ENV, **(env or {})})


@pytest.fixture
def sample_csv(tmp_path: Path) -> Path:
    path = tmp_path / "processes.csv"
    path.write_text(read_data_text("samples/processes.csv"), encoding="utf-8")
    return path


def test_version_and_help():
    assert run("--version").stdout.strip() == f"compass {__version__}"
    result = run("--help")
    assert result.exit_code == 0
    for command in (
        "assess",
        "advise",
        "scan",
        "mask",
        "prompt",
        "eval",
        "catalog",
        "serve",
        "mcp",
    ):
        assert command in result.stdout


class TestAssess:
    def test_table_output(self, sample_csv):
        result = run("assess", str(sample_csv))
        assert result.exit_code == 0
        assert "Итоги портфеля" in result.stdout
        assert "Быстрая победа" in result.stdout

    def test_json_output_is_machine_readable(self, sample_csv):
        result = run("assess", str(sample_csv), "-f", "json", "--horizon", "6")
        data = json.loads(result.stdout)
        assert data["assumptions"]["horizon_months"] == 6
        assert len(data["processes"]) == 18

    def test_markdown_and_csv_files(self, sample_csv, tmp_path):
        md = tmp_path / "report.md"
        assert run("assess", str(sample_csv), "-f", "md", "-o", str(md)).exit_code == 0
        assert md.read_text(encoding="utf-8").startswith("# Оценка процессов")
        out_csv = tmp_path / "ranking.csv"
        assert run("assess", str(sample_csv), "-o", str(out_csv), "--workarounds").exit_code == 0
        assert out_csv.read_text(encoding="utf-8").startswith("\ufeffrank;id")

    def test_bad_file_fails_with_message(self, tmp_path):
        bad = tmp_path / "bad.csv"
        bad.write_text("a,b\n1,2\n", encoding="utf-8")
        result = run("assess", str(bad))
        assert result.exit_code == 1
        assert "обязательных колонок" in result.output

    def test_partial_errors_are_warned_but_not_fatal(self, tmp_path):
        path = tmp_path / "mixed.csv"
        path.write_text(
            "name,task_type,runs_per_month,minutes_per_run\nOK,drafting,5000,10\nBad,magic,1,1\n",
            encoding="utf-8",
        )
        result = run("assess", str(path))
        assert result.exit_code == 0
        assert "Строка 3" in result.stderr

    def test_file_without_valid_rows_fails(self, tmp_path):
        path = tmp_path / "none.csv"
        path.write_text(
            "name,task_type,runs_per_month,minutes_per_run\nBad,magic,1,1\n", encoding="utf-8"
        )
        assert run("assess", str(path)).exit_code == 1


class TestAdvise:
    ARGS = (
        "advise",
        "--task",
        "classification",
        "--requests",
        "20000",
        "--tokens-in",
        "700",
        "--tokens-out",
        "60",
        "--sensitivity",
        "personal",
    )

    def test_table(self):
        result = run(*self.ARGS)
        assert result.exit_code == 0
        assert "Российское облако" in result.stdout

    def test_json_and_top(self):
        data = json.loads(run(*self.ARGS, "--top", "2", "-f", "json").stdout)
        assert len(data["recommendations"]) == 2

    def test_excluded_models_are_explained_on_request(self):
        result = run(*self.ARGS, "--show-excluded")
        assert "Исключены" in result.stdout
        assert "Политика данных" in result.stdout

    def test_impossible_requirements_give_hints(self):
        result = run(
            "advise",
            "--task",
            "decision_support",
            "--requests",
            "100",
            "--sensitivity",
            "personal",
            "--min-quality",
            "5",
        )
        assert "Подходящих моделей нет" in result.stdout


class TestScan:
    def test_personal_data_is_denied_for_foreign_cloud_by_default(self):
        result = run("scan", "-", input=f"Звоните {PHONE}")
        assert result.exit_code == 2
        assert "запрещена" in result.stdout

    def test_allowed_target_exits_zero(self):
        assert run("scan", "-", "--target", "self_hosted", input=f"Звоните {PHONE}").exit_code == 0

    def test_fail_on_mask_makes_masking_a_failure_for_ci(self):
        args = ("scan", "-", "--target", "ru_cloud", "--declared", "internal")
        assert run(*args, input=f"Звоните {PHONE}").exit_code == 0
        assert run(*args, "--fail-on", "mask", input=f"Звоните {PHONE}").exit_code == 2
        assert (
            run(*args, "--fail-on", "never", "--target", "foreign_cloud", input=PHONE).exit_code
            == 0
        )

    def test_clean_text_passes(self):
        result = run("scan", "-", input="Обычный рабочий текст")
        assert result.exit_code == 0
        assert "не найдено" in result.stdout

    def test_json_output_never_contains_raw_values(self, tmp_path):
        path = tmp_path / "t.txt"
        path.write_text(f"Иванов Иван Иванович {PHONE}", encoding="utf-8")
        result = run("scan", str(path), "-f", "json", "--target", "self_hosted")
        data = json.loads(result.stdout)
        assert "masked_text" not in data
        assert PHONE not in result.stdout
        assert data["counts"] == {"PERSON_RU": 1, "PHONE_RU": 1}

    def test_secrets_fail_even_for_self_hosted(self):
        secret = "sk-" + "A1b2C3d4" * 4
        assert run("scan", "-", "--target", "self_hosted", input=secret).exit_code == 2

    def test_missing_file_is_a_usage_error(self):
        assert run("scan", "/no/such/file.txt").exit_code == 2


class TestMask:
    def test_mask_and_unmask_roundtrip_with_private_mapping(self, tmp_path):
        source = tmp_path / "in.txt"
        original = f"Клиент Иванов Иван Иванович, {PHONE}"
        source.write_text(original, encoding="utf-8")
        masked_file, mapping = tmp_path / "out.txt", tmp_path / "map.json"
        result = run("mask", str(source), "-o", str(masked_file), "--mapping", str(mapping))
        assert result.exit_code == 0
        assert "PERSON×1" in result.stderr
        assert masked_file.read_text(encoding="utf-8") == "Клиент [PERSON_1], [PHONE_1]"
        if os.name == "posix":  # Windows использует ACL вместо POSIX-прав.
            assert stat.S_IMODE(os.stat(mapping).st_mode) == 0o600
        restored = tmp_path / "back.txt"
        assert (
            run(
                "unmask", str(masked_file), "--mapping", str(mapping), "-o", str(restored)
            ).exit_code
            == 0
        )
        assert restored.read_text(encoding="utf-8") == original

    def test_stdout_and_stdin(self):
        assert run("mask", "-", input=f"Тел. {PHONE}").stdout.strip() == "Тел. [PHONE_1]"
        assert run("unmask", "-", "--mapping", "x.json", input="x").exit_code == 2


class TestPrompt:
    def test_list_show_scaffold(self):
        assert "ticket-triage" in run("prompt", "list").stdout
        assert "job-description" in run("prompt", "list", "--department", "HR").stdout
        shown = run("prompt", "show", "ticket-triage").stdout
        assert "ticket_text" in shown
        assert "Как проверить ответ" in shown
        assert run("prompt", "show", "nope").exit_code == 1
        assert "Ты —" in run("prompt", "scaffold", "подготовить отчёт").stdout

    def test_render_with_values_and_files(self, tmp_path):
        result = run("prompt", "render", "ticket-triage", "-s", "ticket_text=Не работает вход")
        assert result.exit_code == 0
        assert "Не работает вход" in result.stdout
        text = tmp_path / "ticket.txt"
        text.write_text("Письмо не приходит", encoding="utf-8")
        assert (
            "Письмо не приходит"
            in run("prompt", "render", "ticket-triage", "--file", f"ticket_text={text}").stdout
        )

    def test_render_errors(self):
        missing = run("prompt", "render", "ticket-triage")
        assert missing.exit_code == 1
        assert "Не заполнено" in missing.stderr
        assert run("prompt", "render", "nope").exit_code == 1
        assert run("prompt", "render", "ticket-triage", "-s", "без-равно").exit_code == 2

    def test_render_warns_about_personal_data(self):
        result = run("prompt", "render", "ticket-triage", "-s", f"ticket_text=Звоните {PHONE}")
        assert result.exit_code == 0
        assert "персональные данные" in result.stderr

    def test_lint_scores_and_threshold(self):
        good = run("prompt", "lint", "-", input=cli_good_prompt(), env=None)
        assert good.exit_code == 0
        assert "(A)" in good.stdout
        assert run("prompt", "lint", "-", "--min-score", "90", input="Напиши про ИИ").exit_code == 1


def cli_good_prompt() -> str:
    from adoption_compass.prompts import PromptLibrary, PromptLinter
    from adoption_compass.safety import SafetyGuard

    guard = SafetyGuard(Policy.load())
    library = PromptLibrary.load(guard, PromptLinter(guard))
    return library.render("ticket-triage", {"ticket_text": "Не работает вход"}).text


class TestEval:
    def test_demo(self):
        result = run("eval", "demo")
        assert result.exit_code == 0
        assert "sim:flagship" in result.stdout

    def test_run_json_with_baseline_lift(self):
        data = json.loads(
            run("eval", "run", "-p", "baseline", "-p", "sim:flagship", "-f", "json").stdout
        )
        assert [r["provider"] for r in data] == ["baseline:keywords", "sim:flagship"]
        assert data[1]["accuracy_lift"] > 0

    def test_run_markdown_to_file(self, tmp_path):
        out = tmp_path / "eval.md"
        assert run("eval", "run", "-f", "md", "-o", str(out)).exit_code == 0
        assert out.read_text(encoding="utf-8").startswith("# Оценка качества")

    def test_custom_dataset(self, tmp_path):
        data = tmp_path / "d.jsonl"
        data.write_text(
            '{"id":"1","text":"Не пришёл счёт на оплату","label":"billing"}\n', encoding="utf-8"
        )
        result = run("eval", "run", "-p", "baseline", "--dataset", str(data), "-f", "json")
        assert json.loads(result.stdout)[0]["n"] == 1

    @pytest.mark.parametrize("args", [["-p", "nope"], ["-p", "sim:genius"], ["-p", "api"]])
    def test_bad_provider_arguments_are_usage_errors(self, args):
        assert run("eval", "run", *args).exit_code == 2

    def test_api_provider_with_catalog_pricing(self, monkeypatch):
        def handler(request: httpx.Request) -> httpx.Response:
            assert request.headers["authorization"] == "Bearer secret-for-test"
            body = {
                "choices": [{"message": {"content": '{"label": "billing"}'}}],
                "usage": {"prompt_tokens": 100, "completion_tokens": 5},
            }
            return httpx.Response(200, json=body)

        def factory(*args, **kwargs):
            return OpenAICompatibleProvider(
                *args, **kwargs, transport=httpx.MockTransport(handler), sleep=lambda _s: None
            )

        monkeypatch.setattr(cli, "OpenAICompatibleProvider", factory)
        result = run(
            "eval",
            "run",
            "-p",
            "api",
            "--base-url",
            "https://api.test/v1",
            "--model",
            "m1",
            "--catalog-id",
            "openai-mini",
            "-f",
            "json",
            env={"OPENAI_API_KEY": "secret-for-test"},
        )
        report = json.loads(result.stdout)[0]
        assert result.exit_code == 0
        assert report["provider"] == "api:m1"
        assert report["tokens_in"] == 100 * 72
        assert report["cost_rub"] > 0
        assert "secret-for-test" not in result.stdout


class TestCatalogAndPolicy:
    def test_check_is_green_today_and_red_when_stale(self):
        assert run("catalog", "check", "--strict").exit_code == 0
        stale = run("catalog", "check", "--strict", env={"COMPASS_TODAY": "2027-08-01"})
        assert stale.exit_code == 1
        assert "дн. назад" in stale.stdout
        assert run("catalog", "check", env={"COMPASS_TODAY": "2027-08-01"}).exit_code == 0

    def test_list(self):
        assert "gigachat-max" in run("catalog", "list").stdout

    def test_handout_to_file_and_stdout(self, tmp_path):
        target = tmp_path / "docs" / "handout.md"
        assert run("policy", "handout", "-o", str(target)).exit_code == 0
        assert target.read_text(encoding="utf-8") == Policy.load().handout_markdown()
        assert run("policy", "handout").stdout.startswith("# Памятка")


class TestServerCommands:
    def test_serve_binds_to_localhost_by_default(self, monkeypatch, tmp_path):
        import uvicorn

        captured = {}
        monkeypatch.setattr(uvicorn, "run", lambda app, **kw: captured.update(app=app, **kw))
        result = run(
            "serve", "--port", "9123", "--db", str(tmp_path / "c.db"), "--static-dir", str(tmp_path)
        )
        assert result.exit_code == 0
        assert (captured["host"], captured["port"]) == ("127.0.0.1", 9123)
        assert captured["app"].title == "AI Adoption Compass API"

    def test_mcp_passes_root_to_server(self, monkeypatch, tmp_path):
        from adoption_compass import mcp_server

        calls = {}

        class Dummy:
            def run(self):
                calls["ran"] = True

        def fake_create(services):
            calls["root"] = services.settings.mcp_root
            return Dummy()

        monkeypatch.setattr(mcp_server, "create_mcp_server", fake_create)
        assert run("mcp", "--root", str(tmp_path)).exit_code == 0
        assert calls == {"root": tmp_path, "ran": True}

    def test_demo_runs_all_sections(self):
        result = run("demo")
        assert result.exit_code == 0
        for section in (
            "1. Где ИИ даст эффект",
            "2. Безопасность",
            "3. Качество запроса",
            "4. Оценка качества",
        ):
            assert section in result.stdout
        assert "[PERSON_1]" in result.stdout


class TestDataExport:
    def test_export_copies_files_and_custom_data_is_used(self, tmp_path):
        target = tmp_path / "my-data"
        result = run("data", "export", str(target))
        assert result.exit_code == 0
        assert "COMPASS_DATA_DIR" in result.stdout
        for name in cli.DATA_FILES:
            assert (target / name).read_text(encoding="utf-8") == read_data_text(name)

        catalog = (target / "catalog.yaml").read_text(encoding="utf-8")
        (target / "catalog.yaml").write_text(
            catalog.replace("id: gigachat-max", "id: my-custom-model"), encoding="utf-8"
        )
        listing = run("catalog", "list", env={"COMPASS_DATA_DIR": str(target)})
        assert "my-custom-model" in listing.stdout
        assert "gigachat-max" not in listing.stdout

    def test_existing_files_are_protected_unless_forced(self, tmp_path):
        target = tmp_path / "d"
        assert run("data", "export", str(target)).exit_code == 0
        (target / "policy.yaml").write_text("# изменено", encoding="utf-8")
        blocked = run("data", "export", str(target))
        assert blocked.exit_code == 1
        assert "--force" in blocked.output
        assert (target / "policy.yaml").read_text(encoding="utf-8") == "# изменено"
        assert run("data", "export", str(target), "--force").exit_code == 0
        assert (target / "policy.yaml").read_text(encoding="utf-8") == read_data_text("policy.yaml")
