import itertools
import random

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from adoption_compass.domain import Action, Deployment, Sensitivity
from adoption_compass.safety import Policy, SafetyGuard, mask_text, unmask_text
from adoption_compass.safety.detectors import (
    inn_valid,
    ipv4_valid,
    luhn_valid,
    make_preview,
    phone_ru_valid,
    snils_valid,
)
from tests.factories import (
    format_card,
    format_snils,
    make_card,
    make_inn10,
    make_inn12,
    make_snils,
)


@pytest.fixture(scope="module")
def guard() -> SafetyGuard:
    return SafetyGuard(Policy.load())


# Секреты собираются в рантайме: в исходниках нет токеноподобных литералов.
SECRETS = {
    "API_KEY": "sk-" + "A1b2C3d4" * 4,
    "GITHUB_TOKEN": "gh" + "p_" + "Z9y8X7w6" * 5,
    "AWS_KEY": "AK" + "IA" + "ABCDEFGHIJKLMNOP",
    "GOOGLE_KEY": "AI" + "za" + "A" * 35,
    "SLACK_TOKEN": "xo" + "xb-" + "1234567890-abcdefghij",
    "JWT": "eyJ" + "hbGciOiJIUzI1NiJ9" + ".eyJ" + "zdWIiOiIxMjM0NTY3ODkwIn0" + ".abcdefghij1234",
    "PRIVATE_KEY": "-----BEGIN "
    + "RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK\n-----END "
    + "RSA PRIVATE KEY-----",
    "URL_CREDENTIALS": "https://admin:pa55word@db.example.com/main",
    "PASSWORD": "password = Qwerty12345!",
}


def kinds(guard: SafetyGuard, text: str) -> list[str]:
    return [f.kind for f in guard.scan(text)]


class TestChecksums:
    def test_generated_identifiers_pass_validation(self, rng):
        for _ in range(50):
            assert luhn_valid(make_card(rng))
            assert inn_valid(make_inn10(rng))
            assert inn_valid(make_inn12(rng))
            assert snils_valid(make_snils(rng))

    def test_corrupted_identifiers_fail_validation(self, rng):
        card, inn, snils = make_card(rng), make_inn12(rng), make_snils(rng)

        def bump(value: str) -> str:
            return value[:-1] + str((int(value[-1]) + 1) % 10)

        assert not luhn_valid(bump(card))
        assert not inn_valid(bump(inn))
        assert not snils_valid(bump(snils))
        assert not inn_valid("12345")
        assert not snils_valid("123")
        assert not luhn_valid("1234")

    def test_phone_and_ip_validators(self):
        assert phone_ru_valid("+7 912 345-67-89")
        assert phone_ru_valid("8 (495) 123-45-67")
        assert not phone_ru_valid("+7 123 456-78-90")
        assert ipv4_valid("10.0.0.255")
        assert not ipv4_valid("10.0.0.256")


class TestPersonalData:
    @pytest.mark.parametrize(
        "text",
        [
            "Пишите на ivan.petrov+work@example.ru",
            "Почта info@компания.рф для связи",
        ],
    )
    def test_email(self, guard, text):
        assert kinds(guard, text) == ["EMAIL"]

    @pytest.mark.parametrize(
        "phone",
        [
            "+7 (912) 345-67-89",
            "8 912 345 67 89",
            "89123456789",
            "+7-495-123-45-67",
            "7 495 1234567",
        ],
    )
    def test_russian_phone_formats(self, guard, phone):
        assert kinds(guard, f"Звоните: {phone}.") == ["PHONE_RU"]

    @pytest.mark.parametrize(
        "text", ["Заказ 12345678901 принят", "Код +7 123 456-78-90", "Счёт 1 234 567"]
    )
    def test_numbers_that_are_not_phones(self, guard, text):
        assert kinds(guard, text) == []

    def test_inn_requires_context_and_valid_checksum(self, guard, rng):
        inn12, inn10 = make_inn12(rng), make_inn10(rng)
        assert kinds(guard, f"ИНН {inn12}") == ["INN"]
        assert kinds(guard, f"ИНН организации: {inn10}") == ["INN"]
        assert kinds(guard, f"Номер {inn12}") == []  # без слова «ИНН» — это просто число
        assert kinds(guard, "ИНН 7707083894") == []  # неверная контрольная цифра

    def test_snils_formatted_and_with_context(self, guard, rng):
        digits = make_snils(rng)
        assert kinds(guard, f"Номер {format_snils(digits)}") == ["SNILS"]
        assert kinds(guard, f"СНИЛС: {digits}") == ["SNILS"]
        assert kinds(guard, f"Номер {digits}") == []

    def test_bank_card_with_and_without_separators(self, guard, rng):
        digits = make_card(rng)
        assert kinds(guard, f"Карта {format_card(digits)}") == ["BANK_CARD"]
        assert kinds(guard, f"Карта {digits}") == ["BANK_CARD"]
        assert kinds(guard, "Карта 1234 5678 9012 3456") == []  # не проходит проверку Луна

    @pytest.mark.parametrize(
        "text",
        [
            "Паспорт 45 10 123456",
            "паспорт: 4510 123456",
            "Паспорт РФ № 4510-123456",
            "серия 4510 № 123456",
        ],
    )
    def test_passport(self, guard, text):
        assert kinds(guard, text) == ["PASSPORT_RU"]

    def test_bank_account_needs_context(self, guard):
        assert kinds(guard, "Расчётный счёт 40702810123456789012") == ["BANK_ACCOUNT"]
        assert kinds(guard, "Идентификатор 40702810123456789012") == []

    @pytest.mark.parametrize(
        "text", ["Родился 12.05.1985", "дата рождения: 01/02/1990", "д.р. 7.7.77"]
    )
    def test_birth_date_requires_context(self, guard, text):
        assert kinds(guard, text) == ["BIRTH_DATE"]
        assert kinds(guard, "Встреча 12.05.1985 в офисе") == []

    @pytest.mark.parametrize(
        "text",
        [
            "г. Москва, ул. Тверская, д. 7, кв. 12",
            "проспект Мира дом 15 корп. 2",
            "ул. Ленина, д. 15",
        ],
    )
    def test_address(self, guard, text):
        assert "ADDRESS_RU" in kinds(guard, text)

    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            ("Иванов Иван Иванович", "Иванов Иван Иванович"),
            ("Анна Сергеевна", "Анна Сергеевна"),
            ("передать Смирновой Ольге Петровне", "Смирновой Ольге Петровне"),
            ("Здравствуйте Анна Сергеевна", "Анна Сергеевна"),
            ("Клиент Иванов Иван Иванович", "Иванов Иван Иванович"),
            ("Владимир Ильич", "Владимир Ильич"),
        ],
    )
    def test_person_names_with_patronymics(self, guard, text, expected):
        found = [f.value for f in guard.scan(text) if f.kind == "PERSON_RU"]
        assert expected in found

    @pytest.mark.parametrize(
        "text", ["Спасибо за помощь", "Добрый день, Анна", "Москва Россия Европа"]
    )
    def test_ordinary_text_is_not_a_person(self, guard, text):
        assert kinds(guard, text) == []

    def test_ip_address_even_before_a_full_stop(self, guard):
        assert kinds(guard, "Сервер 192.168.10.5.") == ["IP_ADDRESS"]
        assert kinds(guard, "Адрес 999.1.1.1 неверный") == []


class TestSecrets:
    @pytest.mark.parametrize(("kind", "secret"), list(SECRETS.items()))
    def test_each_secret_type_is_detected_and_marked(self, guard, kind, secret):
        findings = guard.scan(f"Вот конфиг:\n{secret}\nконец")
        assert [f.kind for f in findings] == [kind]
        assert findings[0].is_secret
        assert findings[0].implied is Sensitivity.CONFIDENTIAL

    @pytest.mark.parametrize(
        "text",
        ["пароль: ********", "token=<your-token>", "password: [SECRET_1]", "secret = ${SECRET}"],
    )
    def test_placeholders_are_not_secrets(self, guard, text):
        assert kinds(guard, text) == []

    def test_secret_wins_over_overlapping_email_like_credentials(self, guard):
        assert kinds(guard, "postgres://user:pass1234@host.example.com/db") == ["URL_CREDENTIALS"]


class TestPreview:
    def test_preview_never_exposes_the_value(self):
        assert make_preview("+7 912 345-67-89", "PHONE_RU") == "+7••••••••89"
        assert make_preview("4111111111111111", "BANK_CARD") == "•••• •••• •••• 1111"
        assert make_preview("ivan@example.ru", "EMAIL") == "i•••@e•••"
        assert make_preview("abc", "X") == "•••"

    def test_finding_repr_hides_raw_value(self, guard):
        (finding,) = guard.scan("Звоните +7 912 345-67-89")
        assert "345-67-89" not in repr(finding)


class TestMasking:
    def test_same_value_gets_same_placeholder(self, guard):
        text = "Анна Сергеевна и Иван Иванович. Анна Сергеевна просила перезвонить."
        masked = guard.mask(text)
        assert masked.text == "[PERSON_1] и [PERSON_2]. [PERSON_1] просила перезвонить."
        assert masked.counts == {"PERSON": 2}
        assert masked.mapping == {"[PERSON_1]": "Анна Сергеевна", "[PERSON_2]": "Иван Иванович"}

    def test_existing_placeholders_in_text_are_not_reused(self, guard):
        text = "Был [PHONE_1] в логе, а номер +7 912 345-67-89 новый"
        masked = guard.mask(text)
        assert "[PHONE_2]" in masked.text
        assert masked.mapping == {"[PHONE_2]": "+7 912 345-67-89"}
        assert unmask_text(masked.text, masked.mapping) == text

    def test_unmask_leaves_unknown_placeholders(self):
        assert unmask_text("[PHONE_1] и [EMAIL_7]", {"[PHONE_1]": "+7 900"}) == "+7 900 и [EMAIL_7]"

    def test_text_without_findings_is_unchanged(self, guard):
        masked = guard.mask("Обычный рабочий текст без данных.")
        assert masked.text == "Обычный рабочий текст без данных."
        assert masked.mapping == {}

    def test_mask_text_ignores_overlapping_findings(self, guard):
        findings = guard.scan("Иван Иванович")
        assert mask_text("Иван Иванович", findings + findings).text == "[PERSON_1]"


class TestGuardAnalysis:
    SAMPLE = "Клиент Иванов Иван Иванович, тел. +7 912 345-67-89, ivan@example.ru"

    def test_detected_data_raises_declared_sensitivity(self, guard):
        report = guard.analyze(self.SAMPLE, Sensitivity.INTERNAL).report
        assert report.declared_sensitivity is Sensitivity.INTERNAL
        assert report.detected_sensitivity is Sensitivity.PERSONAL
        assert report.effective_sensitivity is Sensitivity.PERSONAL

    def test_declared_sensitivity_is_kept_when_nothing_is_found(self, guard):
        report = guard.analyze("Обычный текст", Sensitivity.CONFIDENTIAL).report
        assert report.detected_sensitivity is None
        assert report.effective_sensitivity is Sensitivity.CONFIDENTIAL
        assert report.findings == []

    def test_personal_data_decisions_per_deployment(self, guard):
        report = guard.analyze(self.SAMPLE).report
        actions = {d.target: d.action for d in report.decisions}
        assert actions == {
            Deployment.RU_CLOUD: Action.MASK,
            Deployment.FOREIGN_CLOUD: Action.DENY,
            Deployment.SELF_HOSTED: Action.ALLOW,
        }
        assert "телефон ×1" in report.decision_for(Deployment.RU_CLOUD).reasons[0]

    def test_secrets_are_denied_everywhere_even_self_hosted(self, guard):
        report = guard.analyze(f"Ключ {SECRETS['API_KEY']}", Sensitivity.PUBLIC).report
        assert report.has_secrets
        assert {d.action for d in report.decisions} == {Action.DENY}
        assert "перевыпустите" in report.decision_for(Deployment.SELF_HOSTED).reasons[0]

    def test_public_text_is_allowed_everywhere(self, guard):
        report = guard.analyze("Описание продукта для сайта", Sensitivity.PUBLIC).report
        assert {d.action for d in report.decisions} == {Action.ALLOW}

    def test_report_never_contains_raw_values(self, guard):
        analysis = guard.analyze(self.SAMPLE)
        dumped = analysis.report.model_dump_json()
        for raw in ("+7 912 345-67-89", "ivan@example.ru", "Иванов Иван Иванович"):
            assert raw not in dumped
        assert "[PERSON_1]" in analysis.report.masked_text

    def test_findings_are_sorted_and_non_overlapping(self, guard):
        report = guard.analyze(self.SAMPLE).report
        spans = [(f.start, f.end) for f in report.findings]
        assert spans == sorted(spans)
        assert all(a_end <= b_start for (_, a_end), (b_start, _) in itertools.pairwise(spans))


FRAGMENTS = [
    "Иванов Иван Иванович",
    "+7 912 345-67-89",
    "ivan.petrov@example.ru",
    format_card(make_card(random.Random(1))),
    "ИНН " + make_inn12(random.Random(2)),
    "СНИЛС " + make_snils(random.Random(3)),
    "Паспорт 45 10 123456",
    "ул. Ленина, д. 15, кв. 7",
    "обычный текст",
    "Привет, мир",
    "[PHONE_1]",
    "12.05.1985",
    "",
]


@settings(max_examples=80, deadline=None)
@given(st.lists(st.sampled_from(FRAGMENTS), max_size=12), st.sampled_from([" ", ", ", "\n", " — "]))
def test_masking_removes_pii_and_roundtrips(parts, separator):
    guard = SafetyGuard(Policy.load())
    text = separator.join(parts)
    masked = guard.mask(text)
    for secret in FRAGMENTS[:3] + FRAGMENTS[6:7]:
        assert secret not in masked.text
    assert unmask_text(masked.text, masked.mapping) == text


@settings(max_examples=120, deadline=None)
@given(st.text(max_size=300))
def test_scanner_is_total_and_consistent_for_arbitrary_text(text):
    guard = SafetyGuard(Policy.load())
    findings = guard.scan(text)
    previous_end = 0
    for finding in findings:
        assert previous_end <= finding.start < finding.end <= len(text)
        assert text[finding.start : finding.end] == finding.value
        previous_end = finding.end
    masked = guard.mask(text)
    assert unmask_text(masked.text, masked.mapping) == text
