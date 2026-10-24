import json
from dataclasses import replace
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from adoption_compass.api import create_app
from adoption_compass.resources import read_data_text

from .conftest import TODAY

SAMPLE_CSV = read_data_text("samples/demo-processes.csv").encode()
PROCESS = {
    "id": "X1",
    "name": "Ответы клиентам",
    "task_type": "drafting",
    "runs_per_month": 3000,
    "minutes_per_run": 8,
    "hourly_cost_rub": 700,
}
WORKLOAD = {
    "task_type": "classification",
    "data_sensitivity": "personal",
    "requests_per_month": 20000,
    "tokens_in": 700,
    "tokens_out": 60,
}


class TestService:
    def test_health(self, client):
        body = client.get("/api/health").json()
        assert body["status"] == "ok"
        assert body["database"] is True
        assert body["catalog"] == {"as_of": "2026-10-24", "data_status": "illustrative", "stale": 0}

    def test_health_reports_stale_catalog(self, settings):
        late = TestClient(create_app(replace(settings, today=TODAY + timedelta(days=200))))
        assert late.get("/api/health").json()["catalog"]["stale"] == 13

    def test_meta_exposes_enums_defaults_and_limits(self, client):
        meta = client.get("/api/meta").json()
        assert [t["value"] for t in meta["task_types"]][:2] == ["classification", "extraction"]
        assert len(meta["task_types"]) == 9
        assert len(meta["sensitivities"]) == 4
        assert meta["thresholds"] == {"impact": 50.0, "ease": 50.0}
        assert meta["default_assumptions"]["horizon_months"] == 12
        assert meta["catalog"]["data_status"] == "illustrative"
        assert meta["limits"]["max_text_chars"] == 200_000

    def test_catalog_lists_all_models(self, client):
        body = client.get("/api/catalog").json()
        assert len(body["models"]) == 13
        assert body["stale"] == []
        assert body["usd_rub"] == 90.0

    def test_openapi_and_docs_are_available(self, client):
        assert client.get("/api/openapi.json").status_code == 200
        assert client.get("/api/docs").status_code == 200

    def test_security_headers(self, client):
        response = client.get("/api/health")
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["x-frame-options"] == "DENY"
        assert response.headers["cache-control"] == "no-store"
        assert "default-src 'self'" in response.headers["content-security-policy"]
        assert "content-security-policy" not in client.get("/api/docs").headers

    def test_unknown_api_path_is_json_404(self, client):
        response = client.get("/api/nope")
        assert response.status_code == 404
        assert "detail" in response.json()


class TestAdvice:
    def test_returns_ranked_recommendations(self, client):
        response = client.post("/api/advice?top=3", json=WORKLOAD)
        body = response.json()
        assert response.status_code == 200
        assert len(body["recommendations"]) == 3
        assert [r["rank"] for r in body["recommendations"]] == [1, 2, 3]
        assert all(r["deployment"] != "foreign_cloud" for r in body["recommendations"])
        assert body["data_status"] == "illustrative"

    @pytest.mark.parametrize(
        "patch",
        [{"tokens_in": 0}, {"task_type": "magic"}, {"min_quality": 6}, {"requests_per_month": -1}],
    )
    def test_invalid_workload_is_rejected(self, client, patch):
        assert client.post("/api/advice", json={**WORKLOAD, **patch}).status_code == 422

    def test_top_is_bounded(self, client):
        assert client.post("/api/advice?top=0", json=WORKLOAD).status_code == 422
        assert client.post("/api/advice?top=21", json=WORKLOAD).status_code == 422


class TestAssessments:
    def test_stateless_assess_does_not_persist(self, client):
        response = client.post("/api/assess", json={"processes": [PROCESS]})
        assert response.status_code == 200
        assert response.json()["summary"]["processes_total"] == 1
        assert client.get("/api/assessments").json() == []

    def test_create_get_list_and_delete(self, client):
        created = client.post(
            "/api/assessments",
            json={"name": "Пилот", "processes": [PROCESS], "assumptions": {"horizon_months": 24}},
        )
        assert created.status_code == 201
        body = created.json()
        assert body["name"] == "Пилот"
        assert body["result"]["assumptions"]["horizon_months"] == 24
        fetched = client.get(f"/api/assessments/{body['id']}").json()
        assert fetched["processes"][0]["id"] == "X1"
        assert fetched["assumptions"] == {"horizon_months": 24}
        listing = client.get("/api/assessments").json()
        assert [a["id"] for a in listing] == [body["id"]]
        assert listing[0]["processes_count"] == 1
        assert client.delete(f"/api/assessments/{body['id']}").status_code == 204
        assert client.get(f"/api/assessments/{body['id']}").status_code == 404
        assert client.delete(f"/api/assessments/{body['id']}").status_code == 404

    def test_stored_processes_allow_what_if_recalculation(self, client):
        stored = client.post("/api/assessments/demo").json()["assessment"]
        what_if = client.post(
            "/api/assess",
            json={
                "processes": stored["processes"],
                "assumptions": {"supported_region": True, "horizon_months": 24},
            },
        ).json()

        def sql_helper(
            result,
        ):  # P12 — учебный SQL: качество 5 требует API в поддерживаемом регионе
            return next(p for p in result["processes"] if p["id"] == "P12")

        before, after = sql_helper(stored["result"]), sql_helper(what_if)
        assert before["model"] is None
        assert after["model"]["deployment"] == "foreign_cloud"
        assert after["net_horizon_rub"] > before["net_horizon_rub"]

    def test_demo_assessment(self, client):
        body = client.post("/api/assessments/demo").json()
        assert body["parse_errors"] == []
        assert len(body["assessment"]["processes"]) == 18
        assert body["assessment"]["result"]["summary"]["recommended_count"] >= 8

    def test_duplicate_ids_and_empty_lists_are_rejected(self, client):
        assert client.post("/api/assess", json={"processes": [PROCESS, PROCESS]}).status_code == 422
        assert client.post("/api/assess", json={"processes": []}).status_code == 422

    def test_reports_and_exports(self, client):
        assessment_id = client.post("/api/assessments/demo").json()["assessment"]["id"]
        report = client.get(f"/api/assessments/{assessment_id}/report.md")
        assert report.status_code == 200
        assert report.text.startswith("# Оценка процессов: Демо")
        assert f"assessment-{assessment_id}.md" in report.headers["content-disposition"]
        export = client.get(f"/api/assessments/{assessment_id}/export.csv")
        assert export.text.startswith("\ufeffrank;id;name")
        assert "text/csv" in export.headers["content-type"]
        assert client.get("/api/assessments/missing/report.md").status_code == 404
        assert client.get("/api/assessments/missing/export.csv").status_code == 404

    def test_template_download(self, client):
        response = client.get("/api/samples/processes.csv")
        assert response.status_code == 200
        assert response.content.decode().startswith("id,name,department")


class TestUpload:
    def upload(self, client, content: bytes, **data):
        return client.post(
            "/api/assessments/upload", files={"file": ("p.csv", content, "text/csv")}, data=data
        )

    def test_uploads_csv_and_applies_assumptions(self, client):
        response = self.upload(
            client, SAMPLE_CSV, name="Из файла", assumptions=json.dumps({"horizon_months": 6})
        )
        body = response.json()
        assert response.status_code == 201
        assert body["assessment"]["name"] == "Из файла"
        assert body["assessment"]["result"]["assumptions"]["horizon_months"] == 6

    def test_name_defaults_to_file_name(self, client):
        assert self.upload(client, SAMPLE_CSV).json()["assessment"]["name"] == "p"

    def test_bad_rows_are_reported_but_good_rows_are_used(self, client):
        csv = b"name,task_type,runs_per_month,minutes_per_run\nOK,drafting,100,5\nBad,magic,1,1\n"
        body = self.upload(client, csv).json()
        assert len(body["assessment"]["processes"]) == 1
        assert body["parse_errors"][0]["line"] == 3

    def test_file_without_valid_rows_is_rejected_with_details(self, client):
        csv = b"name,task_type,runs_per_month,minutes_per_run\nBad,magic,1,1\n"
        response = self.upload(client, csv)
        assert response.status_code == 422
        assert response.json()["detail"]["errors"][0]["line"] == 2

    def test_wrong_format_and_bad_assumptions_are_rejected(self, client):
        assert self.upload(client, b"a,b\n1,2\n").status_code == 422
        assert self.upload(client, SAMPLE_CSV, assumptions="{not json").status_code == 422
        assert (
            self.upload(client, SAMPLE_CSV, assumptions='{"horizon_months": 0}').status_code == 422
        )

    def test_oversized_file_is_rejected(self, settings):
        small = TestClient(create_app(replace(settings, max_upload_bytes=100)))
        assert self.upload(small, SAMPLE_CSV).status_code == 413


class TestSafety:
    TEXT = "Клиент Иванов Иван Иванович, +7 912 345-67-89"

    def test_analyze_returns_decisions_and_masked_text_without_mapping_by_default(self, client):
        body = client.post("/api/safety/analyze", json={"text": self.TEXT}).json()
        assert body["effective_sensitivity"] == "personal"
        assert body["mapping"] is None
        assert {d["target"]: d["action"] for d in body["decisions"]} == {
            "ru_cloud": "mask",
            "foreign_cloud": "deny",
        }
        assert body["masked_text"] == "Клиент [PERSON_1], [PHONE_1]"
        assert self.TEXT not in json.dumps(body, ensure_ascii=False)

    def test_mapping_roundtrip_through_unmask(self, client):
        analysis = client.post(
            "/api/safety/analyze", json={"text": self.TEXT, "include_mapping": True}
        ).json()
        restored = client.post(
            "/api/safety/unmask",
            json={"text": analysis["masked_text"], "mapping": analysis["mapping"]},
        ).json()
        assert restored["text"] == self.TEXT

    def test_declared_sensitivity_is_respected(self, client):
        body = client.post(
            "/api/safety/analyze",
            json={"text": "Обычный текст", "declared_sensitivity": "confidential"},
        ).json()
        assert body["effective_sensitivity"] == "confidential"
        assert body["findings"] == []

    def test_policy_endpoint(self, client):
        body = client.get("/api/safety/policy").json()
        assert body["matrix"]["personal"]["foreign_cloud"] == "deny"
        assert body["handout_markdown"].startswith("# Памятка")
        assert body["do"]
        assert body["dont"]

    def test_long_text_is_rejected_with_413(self, settings):
        short = TestClient(create_app(replace(settings, max_text_chars=50)))
        assert short.post("/api/safety/analyze", json={"text": "я" * 51}).status_code == 413
        assert short.post("/api/prompts/lint", json={"text": "я" * 51}).status_code == 413
        assert (
            short.post("/api/safety/unmask", json={"text": "я" * 51, "mapping": {}}).status_code
            == 413
        )


class TestPrompts:
    def test_list_get_and_filter(self, client):
        everything = client.get("/api/prompts").json()
        assert len(everything["templates"]) == 12
        assert "Поддержка" in everything["departments"]
        hr = client.get("/api/prompts?department=HR").json()["templates"]
        assert [t["id"] for t in hr] == ["job-description"]
        assert (
            client.get("/api/prompts?task_type=code").json()["templates"][0]["id"] == "sql-helper"
        )
        assert client.get("/api/prompts/ticket-triage").json()["id"] == "ticket-triage"
        assert client.get("/api/prompts/nope").status_code == 404

    def test_render_success_and_errors(self, client):
        ok = client.post(
            "/api/prompts/ticket-triage/render",
            json={"values": {"ticket_text": "Не работает вход"}},
        )
        assert ok.status_code == 200
        assert ok.json()["lint_score"] >= 80
        bad = client.post("/api/prompts/ticket-triage/render", json={"values": {}})
        assert bad.status_code == 422
        assert bad.json()["detail"]["errors"] == ["Не заполнено поле «Текст обращения»"]
        assert client.post("/api/prompts/nope/render", json={"values": {}}).status_code == 404

    def test_lint_and_scaffold(self, client):
        lint = client.post("/api/prompts/lint", json={"text": "Напиши про ИИ"}).json()
        assert lint["grade"] == "D"
        assert lint["suggestions"]
        scaffold = client.post("/api/prompts/scaffold", json={"task": "подготовить отчёт"}).json()
        assert "подготовить отчёт" in scaffold["text"]
        assert client.post("/api/prompts/scaffold", json={"task": "ab"}).status_code == 422


class TestEvalsAndAudit:
    def test_eval_demo(self, client):
        body = client.get("/api/evals/demo").json()
        assert body["task"]["items"] == 72
        assert len(body["task"]["labels"]) == 8
        assert next(r["provider"] for r in body["reports"]) == "baseline:keywords"
        assert body["markdown"].startswith("# Оценка качества")
        confusion = body["reports"][0]["metrics"]["confusion"]
        assert len(confusion) == 8
        assert sum(map(sum, confusion)) == 72

    def test_audit_log_keeps_metadata_only_never_texts(self, client):
        marker = "СЕКРЕТНЫЙ-МАРКЕР-98765"
        client.post("/api/safety/analyze", json={"text": f"{marker} +7 912 345-67-89"})
        client.post("/api/prompts/lint", json={"text": f"Ты — аналитик. {marker}"})
        raw = client.get("/api/audit").text
        assert marker not in raw
        assert "345-67-89" not in raw
        events = client.get("/api/audit").json()["events"]
        assert {"safety.analyze", "prompt.lint"} <= {e["kind"] for e in events}
        analyze = next(e for e in events if e["kind"] == "safety.analyze")
        assert analyze["payload"]["counts"] == {"PHONE_RU": 1}

    def test_audit_filter_and_limit(self, client):
        for _ in range(3):
            client.post("/api/prompts/lint", json={"text": "Напиши"})
        client.post("/api/assessments/demo")
        only = client.get("/api/audit?kind=assessment.created").json()["events"]
        assert [e["kind"] for e in only] == ["assessment.created"]
        assert len(client.get("/api/audit?limit=2").json()["events"]) == 2
        assert client.get("/api/audit?limit=0").status_code == 422


class TestFrontendServing:
    def test_landing_page_without_frontend_build(self, client):
        response = client.get("/")
        assert response.status_code == 200
        assert "Веб-интерфейс не собран" in response.text

    @pytest.fixture
    def with_frontend(self, settings, tmp_path):
        static = tmp_path / "dist"
        (static / "assets").mkdir(parents=True)
        (static / "index.html").write_text("<html>SPA-INDEX</html>", encoding="utf-8")
        (static / "assets" / "app.js").write_text("console.log('app')", encoding="utf-8")
        (static / "favicon.svg").write_text("<svg/>", encoding="utf-8")
        (tmp_path / "secret.txt").write_text("TOP-SECRET", encoding="utf-8")
        return TestClient(create_app(replace(settings, static_dir=static)))

    def test_serves_index_assets_and_deep_links(self, with_frontend):
        assert "SPA-INDEX" in with_frontend.get("/").text
        assert with_frontend.get("/assets/app.js").text == "console.log('app')"
        assert with_frontend.get("/favicon.svg").text == "<svg/>"
        assert "SPA-INDEX" in with_frontend.get("/advisor/deep/link").text

    @pytest.mark.parametrize(
        "path",
        ["/../secret.txt", "/%2e%2e/secret.txt", "/..%2fsecret.txt", "/assets/../../secret.txt"],
    )
    def test_path_traversal_never_leaks_files_outside_static_dir(self, with_frontend, path):
        response = with_frontend.get(path)
        assert "TOP-SECRET" not in response.text

    def test_api_still_wins_over_the_catch_all(self, with_frontend):
        assert with_frontend.get("/api/health").json()["status"] == "ok"
        assert with_frontend.get("/api/nope").status_code == 404
