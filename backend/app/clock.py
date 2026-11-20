"""Single place to ask for the current date, so tests can pin it."""

from datetime import UTC, date, datetime


def today() -> date:
    return date.today()


def now() -> datetime:
    return datetime.now(UTC).replace(microsecond=0)
