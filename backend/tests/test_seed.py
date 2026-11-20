"""The demo data has to obey the same rules as requests made through the API."""

from collections import defaultdict
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.config import Settings
from app.main import create_app
from app.models import ACTIVE_STATUSES, Employee, LeaveRequest, PublicHoliday
from app.services import balances
from app.workdays import half_day_span, spans_overlap, working_days


@pytest.fixture
def seeded():
    app = create_app(Settings(database_url="sqlite://", seed_demo_data=True))
    with TestClient(app):
        with Session(app.state.engine) as session:
            yield session


def test_seed_has_a_realistic_company(seeded):
    employees = seeded.exec(select(Employee)).all()
    assert len(employees) == 25
    assert {e.role for e in employees} == {"employee", "manager", "hr"}
    assert len(seeded.exec(select(LeaveRequest)).all()) > 80


def test_seeded_requests_follow_the_rules(seeded):
    holidays = set(seeded.exec(select(PublicHoliday.date)).all())
    active = defaultdict(list)
    for r in seeded.exec(select(LeaveRequest)).all():
        assert r.end_date >= r.start_date
        expected = working_days(
            r.start_date, r.end_date, holidays, r.half_day_start, r.half_day_end
        )
        assert r.days == expected > 0
        if r.status in ACTIVE_STATUSES:
            active[r.employee_id].append(r)

    for requests in active.values():
        spans = [
            half_day_span(r.start_date, r.end_date, r.half_day_start, r.half_day_end)
            for r in requests
        ]
        for i, a in enumerate(spans):
            assert not any(spans_overlap(a, b) for b in spans[i + 1 :])

    year = date.today().year
    for employee in seeded.exec(select(Employee)).all():
        for balance in balances(seeded, employee, year):
            assert balance.remaining is None or balance.remaining >= 0
