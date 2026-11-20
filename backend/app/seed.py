"""Demo data: a small company with a year of leave around today's date.

The frontend mock (src/app/core/mock/seed.ts) follows the same steps with the
same random generator, so the live demo shows the same kind of data.
"""

import math
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta

from sqlmodel import Session, select

from . import clock
from .models import (
    ACTIVE_STATUSES,
    Department,
    Employee,
    LeaveEvent,
    LeaveRequest,
    LeaveType,
    PublicHoliday,
    Status,
)
from .services import entitlement
from .workdays import (
    add_working_days,
    half_day_span,
    next_working_day,
    public_holidays,
    spans_overlap,
    working_days,
)

DEPARTMENTS = ["Engineering", "Product & Design", "Sales", "Marketing", "People & Operations"]

LEAVE_TYPES = [
    ("annual", "Annual leave", "#2563eb", 25.0),
    ("sick", "Sick leave", "#e5484d", 10.0),
    ("parental", "Parental & family", "#8b5cf6", 15.0),
    ("unpaid", "Unpaid leave", "#d97706", None),
]

# name, job title, department, manager id, role, start date ("{Y}" is the current year)
EMPLOYEES = [
    ("Olivia Bennett", "Head of People", 5, None, "hr", "2019-03-04"),
    ("Daniel Kim", "Engineering Manager", 1, None, "manager", "2018-06-11"),
    ("Priya Raman", "Head of Product", 2, None, "manager", "2020-01-13"),
    ("Marcus Johnson", "Sales Director", 3, None, "manager", "2019-09-02"),
    ("Sofia Martinez", "Marketing Lead", 4, None, "manager", "2021-02-01"),
    ("Liam O'Connor", "Senior Backend Engineer", 1, 2, "employee", "2020-05-18"),
    ("Aisha Rahman", "Frontend Engineer", 1, 2, "employee", "2022-08-01"),
    ("Tomás Silva", "DevOps Engineer", 1, 2, "employee", "2021-11-15"),
    ("Hannah Weber", "QA Engineer", 1, 2, "employee", "2023-03-06"),
    ("Kenji Watanabe", "Backend Engineer", 1, 2, "employee", "2024-01-08"),
    ("Emma Lindqvist", "Junior Frontend Engineer", 1, 2, "employee", "{Y}-04-14"),
    ("Noah Fischer", "Product Manager", 2, 3, "employee", "2021-06-21"),
    ("Chloe Dubois", "Product Designer", 2, 3, "employee", "2022-02-14"),
    ("Ravi Patel", "UX Researcher", 2, 3, "employee", "2023-09-04"),
    ("Isabella Rossi", "UI Designer", 2, 3, "employee", "2024-05-20"),
    ("Ethan Clarke", "Account Executive", 3, 4, "employee", "2020-10-05"),
    ("Mia Novak", "Account Executive", 3, 4, "employee", "2022-04-25"),
    ("Lucas Moreau", "Sales Development Rep", 3, 4, "employee", "2024-07-01"),
    ("Grace Okafor", "Customer Success Manager", 3, 4, "employee", "2021-03-15"),
    ("Ava Thompson", "Content Marketer", 4, 5, "employee", "2022-10-10"),
    ("Mateo García", "Growth Marketer", 4, 5, "employee", "2023-01-16"),
    ("Zoe Andersson", "Brand Designer", 4, 5, "employee", "2023-06-12"),
    ("James Whitaker", "HR Generalist", 5, 1, "hr", "2022-01-10"),
    ("Leah Cohen", "Office Manager", 5, 1, "employee", "2021-08-23"),
    ("Samuel Adeyemi", "Finance Analyst", 5, 1, "employee", "2023-11-06"),
]

EMAIL_DOMAIN = "northpeak.example"

# employee id, leave type, working days from the next working day, length, half day end, status
# so the dashboard always has someone off today and a few requests waiting for approval
PLANNED = [
    (7, "annual", 0, 3, False, Status.APPROVED),
    (13, "annual", -2, 5, False, Status.APPROVED),
    (17, "sick", 0, 1, False, Status.APPROVED),
    (21, "annual", 2, 2, False, Status.APPROVED),
    (10, "annual", 3, 1, True, Status.PENDING),
    (24, "parental", 1, 3, False, Status.PENDING),
    (19, "annual", 6, 5, False, Status.PENDING),
    (8, "annual", 8, 4, False, Status.PENDING),
    (3, "annual", 10, 3, False, Status.PENDING),
    (16, "unpaid", 12, 3, False, Status.PENDING),
]

REASONS = {
    "annual": [
        "Family holiday",
        "Long weekend away",
        "Visiting family",
        "Friend's wedding",
        "Moving house",
        "Summer trip",
        None,
        None,
    ],
    "sick": ["Flu", "Doctor's appointment", "Migraine", None],
    "parental": ["School holiday cover", "Childcare", "Family appointment"],
    "unpaid": ["Extended trip", "Personal matters"],
}
APPROVE_COMMENTS = ["Enjoy!", "Have a good break", None, None, None]
REJECT_COMMENTS = [
    "Too many people are off in the team that week",
    "That's our release week, could you move it by a week?",
    "Overlaps with quarterly planning, let's find another date",
    "We need cover for the client workshop, can we talk?",
]
CANCEL_COMMENTS = ["Plans changed", "Trip postponed", None]

_MASK = 0xFFFFFFFF


class Rng:
    """mulberry32, a tiny seeded generator that is easy to reproduce in TypeScript."""

    def __init__(self, seed: int) -> None:
        self.state = seed & _MASK

    def next(self) -> float:
        self.state = (self.state + 0x6D2B79F5) & _MASK
        t = self.state
        t = ((t ^ (t >> 15)) * (t | 1)) & _MASK
        t = ((t + (((t ^ (t >> 7)) * (t | 61)) & _MASK)) & _MASK) ^ t
        return ((t ^ (t >> 14)) & _MASK) / 4294967296

    def int(self, low: int, high: int) -> int:
        return low + math.floor(self.next() * (high - low + 1))

    def pick[T](self, items: list[T]) -> T:
        return items[math.floor(self.next() * len(items))]


@dataclass
class PlannedRequest:
    employee_id: int
    code: str
    start: date
    end: date
    half_day_start: bool
    half_day_end: bool
    days: float
    status: Status
    events: list[tuple[str, int, datetime, str | None]] = field(default_factory=list)
    reason: str | None = None
    created_at: datetime | None = None
    decided_at: datetime | None = None
    decided_by: int | None = None
    decision_comment: str | None = None


@dataclass
class SeedPerson:
    id: int
    manager_id: int | None
    start_date: date


def plan_requests(
    today: date,
    now: datetime,
    people: list[SeedPerson],
    allowances: dict[str, float | None],
    holidays: set[date],
) -> list[PlannedRequest]:
    rng = Rng(2026)
    year_start = date(today.year, 1, 1)
    first_day = next_working_day(today, holidays)
    horizon = today + timedelta(days=100)
    by_person: dict[int, list[PlannedRequest]] = {p.id: [] for p in people}
    people_by_id = {p.id: p for p in people}
    planned: list[PlannedRequest] = []

    def add(person_id, code, start, end, half_start, half_end, status) -> bool:
        if end.year != start.year:
            return False
        days = working_days(start, end, holidays, half_start, half_end)
        if days <= 0:
            return False
        span = half_day_span(start, end, half_start, half_end)
        for other in by_person[person_id]:
            other_span = half_day_span(
                other.start, other.end, other.half_day_start, other.half_day_end
            )
            if spans_overlap(span, other_span):
                return False
        if status in ACTIVE_STATUSES and allowances[code] is not None:
            person = people_by_id[person_id]
            entitled = entitlement(allowances[code], person.start_date, start.year)
            taken = sum(
                r.days
                for r in by_person[person_id]
                if r.code == code and r.status in ACTIVE_STATUSES and r.start.year == start.year
            )
            if days > entitled - taken:
                return False
        request = PlannedRequest(person_id, code, start, end, half_start, half_end, days, status)
        by_person[person_id].append(request)
        planned.append(request)
        return True

    for person_id, code, offset, length, half_end, status in PLANNED:
        start = add_working_days(first_day, offset, holidays)
        end = add_working_days(start, length - 1, holidays)
        add(person_id, code, start, end, False, half_end, status)

    for person in people:
        cursor = max(year_start, person.start_date) + timedelta(days=rng.int(2, 30))
        while True:
            cursor = next_working_day(cursor, holidays)
            if cursor > horizon:
                break
            r = rng.next()
            if r < 0.14 and cursor < today:
                code, length = "sick", rng.pick([1, 1, 1, 2, 3])
            elif 0.14 <= r < 0.19:
                code, length = "unpaid", rng.pick([1, 2, 3])
            elif 0.19 <= r < 0.24:
                code, length = "parental", rng.pick([1, 2, 3, 5])
            else:
                code, length = "annual", rng.pick([1, 1, 2, 3, 4, 5, 5, 10])
            half_start = half_end = False
            h = rng.next()
            if length == 1 and h < 0.25:
                if rng.next() < 0.5:
                    half_end = True
                else:
                    half_start = True
            elif length > 1 and h < 0.12:
                half_end = True
            end = add_working_days(cursor, length - 1, holidays)
            s = rng.next()
            if end < today:
                status = (
                    Status.APPROVED
                    if s < 0.82
                    else Status.REJECTED
                    if s < 0.9
                    else Status.CANCELLED
                )
            elif cursor <= today:
                status = Status.APPROVED
            else:
                status = (
                    Status.PENDING if s < 0.4 else Status.APPROVED if s < 0.92 else Status.CANCELLED
                )
            if add(person.id, code, cursor, end, half_start, half_end, status):
                cursor = end + timedelta(days=rng.int(18, 60))
            else:
                cursor = cursor + timedelta(days=rng.int(4, 12))

    # second pass: who did what and when
    def at(day: date, minutes: int) -> datetime:
        return min(
            datetime(day.year, day.month, day.day, 8, 0, tzinfo=UTC) + timedelta(minutes=minutes),
            now,
        )

    for request in planned:
        person = people_by_id[request.employee_id]
        approver = person.manager_id or (23 if person.id == 1 else 1)
        if request.code == "sick":
            created_day = min(request.start, today)
        else:
            created_day = request.start - timedelta(days=rng.int(5, 40))
            if created_day > today:
                # leave booked well ahead, spread over the last few weeks
                created_day = today - timedelta(days=(created_day - today).days % 21)
        request.created_at = at(created_day, rng.int(0, 540))
        request.reason = rng.pick(REASONS[request.code])
        request.events.append(("submitted", person.id, request.created_at, None))
        if request.status in (Status.APPROVED, Status.REJECTED):
            decided_day = min(created_day + timedelta(days=rng.int(0, 3)), today)
            decided = max(at(decided_day, 60 + rng.int(0, 480)), request.created_at)
            comments = APPROVE_COMMENTS if request.status == Status.APPROVED else REJECT_COMMENTS
            comment = rng.pick(comments)
            request.decided_at = decided
            request.decided_by = approver
            request.decision_comment = comment
            request.events.append((request.status.value, approver, decided, comment))
        elif request.status == Status.CANCELLED:
            cancelled_day = min(created_day + timedelta(days=rng.int(1, 10)), today)
            cancelled = max(at(cancelled_day, 60 + rng.int(0, 480)), request.created_at)
            request.events.append(("cancelled", person.id, cancelled, rng.pick(CANCEL_COMMENTS)))
    return planned


def seed_reference_data(session: Session, years: list[int]) -> None:
    """Leave types and public holidays, which every database needs."""
    if session.exec(select(LeaveType)).first() is None:
        for code, name, color, allowance in LEAVE_TYPES:
            session.add(LeaveType(code=code, name=name, color=color, yearly_allowance=allowance))
    existing = set(session.exec(select(PublicHoliday.date)).all())
    for year in years:
        for day, name in public_holidays(year):
            if day not in existing:
                session.add(PublicHoliday(date=day, name=name))
    session.commit()


def seed_demo_data(session: Session, today: date | None = None) -> None:
    today = today or clock.today()
    now = clock.now()
    if today != clock.today():
        now = datetime(today.year, today.month, today.day, 18, 0, tzinfo=UTC)
    seed_reference_data(session, [today.year, today.year + 1])

    for name in DEPARTMENTS:
        session.add(Department(name=name))
    session.flush()

    for name, title, department_id, manager_id, role, start in EMPLOYEES:
        local = name.lower().replace("'", "").replace("á", "a").replace("í", "i").split()
        session.add(
            Employee(
                name=name,
                email=f"{local[0]}.{local[-1]}@{EMAIL_DOMAIN}",
                job_title=title,
                department_id=department_id,
                manager_id=manager_id,
                role=role,
                start_date=date.fromisoformat(start.replace("{Y}", str(today.year))),
                created_at=datetime(2026, 1, 5, 9, 0, tzinfo=UTC),
            )
        )
    session.flush()

    people = [
        SeedPerson(e.id, e.manager_id, e.start_date)
        for e in session.exec(select(Employee).order_by(Employee.id)).all()
    ]
    types = {t.code: t for t in session.exec(select(LeaveType)).all()}
    holidays = set(session.exec(select(PublicHoliday.date)).all())
    planned = plan_requests(
        today, now, people, {code: t.yearly_allowance for code, t in types.items()}, holidays
    )
    for p in planned:
        request = LeaveRequest(
            employee_id=p.employee_id,
            leave_type_id=types[p.code].id,
            start_date=p.start,
            end_date=p.end,
            half_day_start=p.half_day_start,
            half_day_end=p.half_day_end,
            days=p.days,
            reason=p.reason,
            status=p.status,
            created_at=p.created_at,
            decided_at=p.decided_at,
            decided_by_id=p.decided_by,
            decision_comment=p.decision_comment,
        )
        session.add(request)
        session.flush()
        for action, actor, when, comment in p.events:
            session.add(
                LeaveEvent(
                    request_id=request.id,
                    action=action,
                    actor_id=actor,
                    comment=comment,
                    created_at=when,
                )
            )
    session.commit()


def seed_if_empty(session: Session) -> bool:
    today = clock.today()
    seed_reference_data(session, [today.year, today.year + 1])
    if session.exec(select(Employee)).first() is not None:
        return False
    seed_demo_data(session, today)
    return True
