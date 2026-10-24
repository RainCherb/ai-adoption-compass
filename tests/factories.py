"""Генераторы синтетических, но валидных по контрольным суммам идентификаторов."""

import random


def _digits(rng: random.Random, n: int) -> str:
    return "".join(str(rng.randint(0, 9)) for _ in range(n))


def luhn_check_digit(body: str) -> str:
    total = 0
    for index, char in enumerate(reversed(body)):
        digit = int(char)
        if index % 2 == 0:
            digit *= 2
            if digit > 9:
                digit -= 9
        total += digit
    return str((10 - total % 10) % 10)


def make_card(rng: random.Random, prefix: str = "4") -> str:
    body = prefix + _digits(rng, 15 - len(prefix))
    return body + luhn_check_digit(body)


def make_inn10(rng: random.Random) -> str:
    body = _digits(rng, 9)
    weights = (2, 4, 10, 3, 5, 9, 4, 6, 8)
    return body + str(sum(int(d) * w for d, w in zip(body, weights, strict=True)) % 11 % 10)


def make_inn12(rng: random.Random) -> str:
    body = _digits(rng, 10)
    w11 = (7, 2, 4, 10, 3, 5, 9, 4, 6, 8)
    w12 = (3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8)
    body += str(sum(int(d) * w for d, w in zip(body, w11, strict=True)) % 11 % 10)
    return body + str(sum(int(d) * w for d, w in zip(body, w12, strict=True)) % 11 % 10)


def make_snils(rng: random.Random) -> str:
    body = _digits(rng, 9)
    total = sum(int(body[i]) * (9 - i) for i in range(9))
    if total < 100:
        control = total
    elif total in (100, 101):
        control = 0
    else:
        control = total % 101
        if control == 100:
            control = 0
    return body + f"{control:02d}"


def format_snils(digits: str) -> str:
    return f"{digits[0:3]}-{digits[3:6]}-{digits[6:9]} {digits[9:]}"


def format_card(digits: str) -> str:
    return " ".join(digits[i : i + 4] for i in range(0, 16, 4))
