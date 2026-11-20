from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app import clock
from app.config import Settings
from app.main import create_app
from app.models import Department, Employee
from app.seed import seed_reference_data

# a Monday in early March, so most of the leave year is still ahead
TODAY = date(2026, 3, 2)

HR, MANAGER, EVE, BOB, OTHER_MANAGER, NINA = 1, 2, 3, 4, 5, 6


def as_user(user_id: int) -> dict[str, str]:
    return {"X-User-Id": str(user_id)}


@pytest.fixture(autouse=True)
def fixed_clock(monkeypatch):
    monkeypatch.setattr(clock, "today", lambda: TODAY)
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 3, 2, 10, 0, tzinfo=UTC))


@pytest.fixture
def client():
    app = create_app(Settings(database_url="sqlite://", seed_demo_data=False))
    with TestClient(app) as test_client:
        with Session(app.state.engine) as session:
            seed_reference_data(session, [2026, 2027])
            session.add(Department(name="Engineering"))
            session.add(Department(name="People"))
            people = [
                ("Hana Hart", "Head of People", 2, None, "hr", date(2018, 1, 8)),
                ("Max Moreno", "Engineering Manager", 1, None, "manager", date(2019, 4, 1)),
                ("Eve Evans", "Engineer", 1, MANAGER, "employee", date(2020, 2, 3)),
                ("Bob Brown", "Engineer", 1, MANAGER, "employee", date(2021, 9, 6)),
                ("Olga Owens", "Operations Manager", 2, HR, "manager", date(2019, 5, 6)),
                ("Nina Novak", "Recruiter", 2, OTHER_MANAGER, "employee", date(2026, 7, 1)),
            ]
            for name, title, department_id, manager_id, role, start in people:
                first, last = name.lower().split()
                session.add(
                    Employee(
                        name=name,
                        email=f"{first}.{last}@example.com",
                        job_title=title,
                        department_id=department_id,
                        manager_id=manager_id,
                        role=role,
                        start_date=start,
                    )
                )
            session.commit()
        yield test_client


@pytest.fixture
def book(client):
    """Submit a leave request as someone and return the response."""

    def _book(user_id: int, start: str, end: str | None = None, leave_type_id: int = 1, **extra):
        payload = {"leave_type_id": leave_type_id, "start_date": start, "end_date": end or start}
        return client.post("/api/leave-requests", json=payload | extra, headers=as_user(user_id))

    return _book


@pytest.fixture
def balance(client):
    def _balance(user_id: int, code: str = "annual", viewer: int | None = None) -> dict:
        response = client.get(
            f"/api/employees/{user_id}/balances", headers=as_user(viewer or user_id)
        )
        assert response.status_code == 200, response.text
        return next(b for b in response.json() if b["leave_type"]["code"] == code)

    return _balance
