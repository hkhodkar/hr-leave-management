from datetime import date

from app.services import entitlement, round_half
from app.workdays import (
    add_working_days,
    half_day_span,
    public_holidays,
    spans_overlap,
    working_days,
)

HOLIDAYS_2026 = {day for day, _ in public_holidays(2026)}


def test_bank_holidays_for_2026():
    assert [(d.isoformat(), name) for d, name in public_holidays(2026)] == [
        ("2026-01-01", "New Year's Day"),
        ("2026-04-03", "Good Friday"),
        ("2026-04-06", "Easter Monday"),
        ("2026-05-04", "Early May bank holiday"),
        ("2026-05-25", "Spring bank holiday"),
        ("2026-08-31", "Summer bank holiday"),
        ("2026-12-25", "Christmas Day"),
        # the 26th is a Saturday
        ("2026-12-28", "Boxing Day"),
    ]


def test_christmas_on_a_saturday_moves_both_days():
    december = [d for d, _ in public_holidays(2027) if d.month == 12]
    assert december == [date(2027, 12, 27), date(2027, 12, 28)]


def test_new_year_on_a_weekend_moves_to_monday():
    assert public_holidays(2028)[0][0] == date(2028, 1, 3)


def test_working_days_skip_weekends_and_holidays():
    # two weeks around Easter: 10 weekdays minus Good Friday and Easter Monday
    assert working_days(date(2026, 3, 30), date(2026, 4, 10), HOLIDAYS_2026) == 8


def test_weekend_only_costs_nothing():
    assert working_days(date(2026, 3, 7), date(2026, 3, 8), HOLIDAYS_2026) == 0


def test_end_before_start_costs_nothing():
    assert working_days(date(2026, 3, 9), date(2026, 3, 6), HOLIDAYS_2026) == 0


def test_half_days():
    monday, wednesday = date(2026, 3, 2), date(2026, 3, 4)
    assert working_days(monday, monday, HOLIDAYS_2026, half_day_end=True) == 0.5
    assert working_days(monday, monday, HOLIDAYS_2026, half_day_start=True) == 0.5
    assert working_days(monday, wednesday, HOLIDAYS_2026, True, True) == 2


def test_half_day_on_a_weekend_is_not_subtracted():
    saturday, tuesday = date(2026, 3, 7), date(2026, 3, 10)
    assert working_days(saturday, tuesday, HOLIDAYS_2026, half_day_start=True) == 2


def test_add_working_days_both_ways():
    # the Thursday before Easter, the next working day is Tuesday
    thursday = date(2026, 4, 2)
    assert add_working_days(thursday, 1, HOLIDAYS_2026) == date(2026, 4, 7)
    assert add_working_days(date(2026, 4, 7), -1, HOLIDAYS_2026) == thursday


def test_morning_and_afternoon_do_not_overlap():
    day = date(2026, 3, 10)
    morning = half_day_span(day, day, False, True)
    afternoon = half_day_span(day, day, True, False)
    assert not spans_overlap(morning, afternoon)
    assert spans_overlap(morning, half_day_span(day, day, False, False))


def test_ending_at_midday_leaves_the_afternoon_free():
    first = half_day_span(date(2026, 3, 9), date(2026, 3, 11), False, True)
    second = half_day_span(date(2026, 3, 11), date(2026, 3, 13), True, False)
    assert not spans_overlap(first, second)


def test_round_half_goes_up_on_quarters():
    assert round_half(18.75) == 19
    assert round_half(18.25) == 18.5
    assert round_half(12.5) == 12.5


def test_entitlement_is_prorated_in_the_first_year():
    joined = date(2026, 4, 14)
    assert entitlement(25, joined, 2026) == 19  # 9 of 12 months
    assert entitlement(25, joined, 2027) == 25
    assert entitlement(25, joined, 2025) == 0
    assert entitlement(None, joined, 2026) is None
