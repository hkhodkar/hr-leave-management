"""Working-day math: public holidays, day counts and half-day aware overlaps."""

from collections.abc import Collection
from datetime import date, timedelta


def easter_sunday(year: int) -> date:
    # anonymous Gregorian algorithm
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    m = (32 + 2 * e + 2 * i - h - k) % 7
    n = (a + 11 * h + 22 * m) // 451
    month, day = divmod(h + m - 7 * n + 114, 31)
    return date(year, month, day + 1)


def _first_monday(year: int, month: int) -> date:
    day = date(year, month, 1)
    return day + timedelta(days=(7 - day.weekday()) % 7)


def _last_monday(year: int, month: int) -> date:
    next_month = date(year + month // 12, month % 12 + 1, 1)
    last = next_month - timedelta(days=1)
    return last - timedelta(days=last.weekday())


def public_holidays(year: int) -> list[tuple[date, str]]:
    """Bank holidays for England and Wales, moved to the next free weekday when needed."""
    easter = easter_sunday(year)
    holidays: list[tuple[date, str]] = []
    taken: set[date] = set()

    def observed(day: date, name: str) -> None:
        while day.weekday() >= 5 or day in taken:
            day += timedelta(days=1)
        taken.add(day)
        holidays.append((day, name))

    observed(date(year, 1, 1), "New Year's Day")
    holidays.append((easter - timedelta(days=2), "Good Friday"))
    holidays.append((easter + timedelta(days=1), "Easter Monday"))
    holidays.append((_first_monday(year, 5), "Early May bank holiday"))
    holidays.append((_last_monday(year, 5), "Spring bank holiday"))
    holidays.append((_last_monday(year, 8), "Summer bank holiday"))
    observed(date(year, 12, 25), "Christmas Day")
    observed(date(year, 12, 26), "Boxing Day")
    return sorted(holidays)


def is_working_day(day: date, holidays: Collection[date]) -> bool:
    return day.weekday() < 5 and day not in holidays


def working_days(
    start: date,
    end: date,
    holidays: Collection[date],
    half_day_start: bool = False,
    half_day_end: bool = False,
) -> float:
    """Days of leave a request costs: weekdays minus holidays, halves counted as 0.5."""
    if end < start:
        return 0.0
    total = 0.0
    day = start
    while day <= end:
        if is_working_day(day, holidays):
            total += 1
        day += timedelta(days=1)
    if start == end:
        return 0.5 if total and (half_day_start or half_day_end) else total
    if half_day_start and is_working_day(start, holidays):
        total -= 0.5
    if half_day_end and is_working_day(end, holidays):
        total -= 0.5
    return total


def add_working_days(start: date, count: int, holidays: Collection[date]) -> date:
    """Move `count` working days forward (or back when negative) from `start`."""
    step = timedelta(days=1 if count >= 0 else -1)
    remaining = abs(count)
    day = start
    while remaining > 0:
        day += step
        if is_working_day(day, holidays):
            remaining -= 1
    return day


def next_working_day(day: date, holidays: Collection[date]) -> date:
    while not is_working_day(day, holidays):
        day += timedelta(days=1)
    return day


def half_day_span(
    start: date, end: date, half_day_start: bool, half_day_end: bool
) -> tuple[int, int]:
    """The request as an inclusive range of half-day slots (morning, afternoon)."""
    first = start.toordinal() * 2 + (1 if half_day_start else 0)
    last = end.toordinal() * 2 + (0 if half_day_end else 1)
    return first, last


def spans_overlap(a: tuple[int, int], b: tuple[int, int]) -> bool:
    return a[0] <= b[1] and b[0] <= a[1]
