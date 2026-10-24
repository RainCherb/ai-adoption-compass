import pytest

from adoption_compass.prompts import (
    PromptDocument,
    PromptLibrary,
    PromptLinter,
    PromptRenderError,
    scaffold_prompt,
)
from adoption_compass.prompts.linter import RULES
from adoption_compass.safety import Policy, SafetyGuard

from .test_safety import SECRETS


@pytest.fixture(scope="module")
def guard() -> SafetyGuard:
    return SafetyGuard(Policy.load())


@pytest.fixture(scope="module")
def linter(guard) -> PromptLinter:
    return PromptLinter(guard)


@pytest.fixture(scope="module")
def library(guard, linter) -> PromptLibrary:
    return PromptLibrary.load(guard, linter)


def example_values(template) -> dict[str, str]:
    return {v.name: v.example or v.default or "значение" for v in template.variables}


def template_ids() -> list[str]:
    guard = SafetyGuard(Policy.load())
    return list(PromptLibrary.load(guard, PromptLinter(guard)).templates)


GOOD_PROMPT = """Ты — опытный аналитик. Твоя задача — подготовить краткую сводку продаж.
Контекст: данные за неделю ниже.
<data>
неделя 41, выручка 1,2 млн
</data>
Формат ответа: таблица и три пункта выводов, не более 120 слов.
Ограничения: только факты из данных, не придумывай цифры.
Пример: «Выручка выросла на 4%».
Если данных недостаточно, скажи об этом и укажи допущения."""


class TestLibrary:
    def test_bundled_library_covers_main_departments(self, library):
        assert len(library.templates) == 12
        assert {"Поддержка", "Бухгалтерия", "Юристы", "HR", "Маркетинг", "Аналитика"} <= set(
            library.departments()
        )

    @pytest.mark.parametrize("template_id", template_ids())
    def test_every_template_renders_with_examples_and_keeps_a_high_score(
        self, library, template_id
    ):
        rendered = library.render(template_id, example_values(library.get(template_id)))
        assert rendered.text
        assert "{{" not in rendered.text
        assert "{%" not in rendered.text
        assert rendered.lint_score >= 80, rendered.template_id

    @pytest.mark.parametrize("template_id", template_ids())
    def test_every_template_teaches_verification_and_safety(self, library, template_id):
        template = library.get(template_id)
        assert template.checklist
        assert template.safety_notes

    def test_filters_by_department_and_task_type(self, library):
        assert [t.id for t in library.list_templates(department="hr")] == ["job-description"]
        assert {t.task_type.value for t in library.list_templates(task_type="drafting")} == {
            "drafting"
        }

    def test_unknown_template_raises_key_error(self, library):
        with pytest.raises(KeyError):
            library.get("nope")


class TestRendering:
    def test_defaults_fill_optional_fields(self, library):
        rendered = library.render("ticket-triage", {"ticket_text": "Не работает вход"})
        assert "оплата, техническая проблема" in rendered.text

    def test_missing_required_unknown_and_bad_choice_are_reported_together(self, library):
        with pytest.raises(PromptRenderError) as info:
            library.render("product-card", {"marketplace": "Avito", "foo": "1"})
        errors = " | ".join(info.value.errors)
        assert "Неизвестные поля: foo" in errors
        assert "Название товара" in errors
        assert "Площадка" in errors

    def test_value_length_is_limited(self, library):
        with pytest.raises(PromptRenderError, match="слишком длинное"):
            library.render("ticket-triage", {"ticket_text": "я" * 60_000})

    def test_template_syntax_inside_values_is_inert(self, library):
        payload = "{{ ''.__class__.__mro__ }} {% for x in y %}{{ 7*7 }}"
        rendered = library.render("meeting-summary", {"transcript": payload})
        assert payload in rendered.text
        assert "49" not in rendered.text.replace(payload, "")

    def test_personal_data_in_values_produces_warning(self, library):
        rendered = library.render(
            "customer-reply",
            {"customer_message": "Звоните +7 912 345-67-89", "facts": "Возврат 14 дней"},
        )
        assert rendered.sensitive == {"PHONE_RU": 1}
        assert "персональные данные" in rendered.warnings[0]

    def test_secret_in_values_produces_stronger_warning(self, library):
        rendered = library.render(
            "sql-helper",
            {"task_description": f"ключ {SECRETS['API_KEY']}", "schema": "t(a)"},
        )
        assert "секреты" in rendered.warnings[0]

    def test_clean_values_have_no_warnings(self, library):
        rendered = library.render("ticket-triage", {"ticket_text": "Не работает вход"})
        assert rendered.warnings == []
        assert rendered.sensitive == {}


class TestValidation:
    @staticmethod
    def document(**template_overrides) -> PromptDocument:
        template = {
            "id": "t1",
            "title": "T",
            "department": "D",
            "task_type": "drafting",
            "sensitivity": "internal",
            "description": "d",
            "variables": [{"name": "a", "label": "A"}],
            "body": "Привет, {{ a }}",
        }
        return PromptDocument.model_validate({"templates": [{**template, **template_overrides}]})

    def test_undeclared_variable_is_rejected(self, guard, linter):
        with pytest.raises(ValueError, match="не объявлены"):
            PromptLibrary(self.document(body="{{ a }} {{ b }}"), guard, linter)

    def test_unused_variable_is_rejected(self, guard, linter):
        with pytest.raises(ValueError, match="не используются"):
            PromptLibrary(self.document(body="без переменных"), guard, linter)

    def test_duplicate_ids_are_rejected(self, guard, linter):
        document = self.document()
        document.templates.append(document.templates[0])
        with pytest.raises(ValueError, match="Повторяющийся"):
            PromptLibrary(document, guard, linter)


class TestLinter:
    def test_well_formed_prompt_gets_top_grade(self, linter):
        result = linter.lint(GOOD_PROMPT)
        assert result.score == 100
        assert result.grade == "A"
        assert not result.capped
        assert all(check.passed for check in result.checks)

    def test_vague_prompt_gets_low_grade_with_concrete_hints(self, linter):
        result = linter.lint("Напиши про ИИ")
        assert result.grade == "D"
        assert result.score < 50
        assert any("роли" in s for s in result.suggestions)
        assert any("формат" in s.lower() for s in result.suggestions)

    def test_weights_sum_to_one_hundred(self):
        assert sum(rule.weight for rule in RULES) == 100

    @pytest.mark.parametrize(
        ("rule_id", "sentence"),
        [
            ("role", "Ты — опытный редактор."),
            ("role", "You are an expert translator."),
            ("task", "Составь план внедрения."),
            ("task", "Please summarize the report."),
            ("context", "Исходные данные приведены ниже."),
            ("format", "Ответ дай в виде таблицы."),
            ("constraints", "Не используй жаргон."),
            ("examples", "Например: «Привет!»."),
            ("verification", "Если данных недостаточно, скажи об этом."),
            ("delimiters", "<text>что-то</text>"),
        ],
    )
    def test_each_rule_recognises_typical_phrases(self, linter, rule_id, sentence):
        checks = {c.id: c.passed for c in linter.lint(sentence).checks}
        assert checks[rule_id], (rule_id, sentence)

    def test_length_rule_penalises_too_short_and_too_long_prompts(self, linter):
        short = {c.id: c.passed for c in linter.lint("Привет").checks}
        long = {c.id: c.passed for c in linter.lint("слово " * 1600).checks}
        assert not short["length"]
        assert not long["length"]

    def test_personal_data_caps_the_score(self, linter):
        result = linter.lint(GOOD_PROMPT + "\nКлиент: +7 912 345-67-89")
        assert result.capped
        assert result.score <= 69
        assert result.sensitive == {"PHONE_RU": 1}
        assert "персональные данные" in result.suggestions[0]

    def test_secrets_cap_the_score_even_harder(self, linter):
        result = linter.lint(GOOD_PROMPT + f"\nключ: {SECRETS['API_KEY']}")
        assert result.capped
        assert result.score <= 30
        assert result.grade == "D"
        assert "Критично" in result.suggestions[0]

    def test_scaffold_is_itself_a_good_prompt(self, linter):
        text = scaffold_prompt("подготовить резюме встречи", role="руководитель проектов")
        assert text.startswith("Ты — руководитель проектов.")
        assert "подготовить резюме встречи" in text
        assert linter.lint(text).score >= 85

    def test_scaffold_uses_defaults_for_empty_input(self):
        assert "опытный специалист" in scaffold_prompt("")
