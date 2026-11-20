"""Leave rules shared by the routes: permissions, balances and request validation."""

import math
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, timedelta

from fastapi import HTTPException, status
from sqlmodel import Session, col, select

from .models import (
    ACTIVE_STATUSES,
    Department,
    Employee,
    LeaveEvent,
    LeaveRequest,
    LeaveType,
    PublicHoliday,
    Role,
    Status,
)
from .schemas import (
    Absence,
    BalanceOut,
    EmployeeOut,
    EmployeeRef,
    EventOut,
    LeaveRequestDetail,
    LeaveRequestIn,
    LeaveRequestOut,
    LeaveTypeRef,
    Ref,
)
from .workdays import half_day_span, spans_overlap, working_days

SICK_BACKDATE_DAYS = 30


def fail(code: int, message: str) -> HTTPException:
    return HTTPException(status_code=code, detail=message)


# --- permissions ---


def is_approver(actor: Employee, employee: Employee) -> bool:
    """Managers decide for their direct reports, HR for everyone but themselves."""
    if actor.id == employee.id:
        return False
    return actor.role == Role.HR or employee.manager_id == actor.id


def can_view_leave(actor: Employee, employee: Employee) -> bool:
    return actor.id == employee.id or is_approver(actor, employee)


def can_decide(actor: Employee, employee: Employee, request: LeaveRequest) -> bool:
    return request.status == Status.PENDING and is_approver(actor, employee)


def can_cancel(actor: Employee, request: LeaveRequest, today: date) -> bool:
    if actor.id != request.employee_id and actor.role != Role.HR:
        return False
    if request.status == Status.PENDING:
        return True
    return request.status == Status.APPROVED and request.start_date > today


def visible_employee_ids(session: Session, actor: Employee) -> set[int] | None:
    """Whose leave the actor may see. None means everyone."""
    if actor.role == Role.HR:
        return None
    reports = session.exec(select(Employee.id).where(Employee.manager_id == actor.id)).all()
    return {actor.id, *reports}


# --- lookups ---


@dataclass
class Lookup:
    """Small reference tables loaded once per request to build responses."""

    employees: dict[int, Employee]
    departments: dict[int, Department]
    leave_types: dict[int, LeaveType]

    @classmethod
    def load(cls, session: Session) -> "Lookup":
        return cls(
            employees={e.id: e for e in session.exec(select(Employee)).all()},
            departments={d.id: d for d in session.exec(select(Department)).all()},
            leave_types={t.id: t for t in session.exec(select(LeaveType)).all()},
        )

    def ref(self, employee_id: int | None) -> Ref | None:
        employee = self.employees.get(employee_id) if employee_id is not None else None
        return Ref(id=employee.id, name=employee.name) if employee else None

    def employee_ref(self, employee_id: int) -> EmployeeRef:
        e = self.employees[employee_id]
        return EmployeeRef(
            id=e.id, name=e.name, job_title=e.job_title, department_id=e.department_id
        )

    def type_ref(self, leave_type_id: int) -> LeaveTypeRef:
        return LeaveTypeRef.model_validate(self.leave_types[leave_type_id])

    def employee_out(self, e: Employee) -> EmployeeOut:
        department = self.departments[e.department_id]
        reports = sum(1 for other in self.employees.values() if other.manager_id == e.id)
        return EmployeeOut(
            id=e.id,
            name=e.name,
            email=e.email,
            job_title=e.job_title,
            role=e.role,
            start_date=e.start_date,
            department_id=e.department_id,
            department=Ref(id=department.id, name=department.name),
            manager_id=e.manager_id,
            manager=self.ref(e.manager_id),
            report_count=reports,
            created_at=e.created_at,
        )

    def request_out(self, r: LeaveRequest, actor: Employee, today: date) -> LeaveRequestOut:
        employee = self.employees[r.employee_id]
        return LeaveRequestOut(
            id=r.id,
            employee=self.employee_ref(r.employee_id),
            leave_type=self.type_ref(r.leave_type_id),
            start_date=r.start_date,
            end_date=r.end_date,
            half_day_start=r.half_day_start,
            half_day_end=r.half_day_end,
            days=r.days,
            reason=r.reason,
            status=r.status,
            created_at=r.created_at,
            decided_at=r.decided_at,
            decided_by=self.ref(r.decided_by_id),
            decision_comment=r.decision_comment,
            can_cancel=can_cancel(actor, r, today),
            can_decide=can_decide(actor, employee, r),
        )

    def absence(self, r: LeaveRequest, actor: Employee) -> Absence:
        employee = self.employees[r.employee_id]
        return Absence(
            request_id=r.id,
            employee=self.employee_ref(r.employee_id),
            leave_type=self.type_ref(r.leave_type_id) if can_view_leave(actor, employee) else None,
            start_date=r.start_date,
            end_date=r.end_date,
            half_day_start=r.half_day_start,
            half_day_end=r.half_day_end,
            days=r.days,
            status=r.status,
        )


def request_detail(
    session: Session, lookup: Lookup, r: LeaveRequest, actor: Employee, today: date
) -> LeaveRequestDetail:
    events = session.exec(
        select(LeaveEvent)
        .where(LeaveEvent.request_id == r.id)
        .order_by(col(LeaveEvent.created_at), col(LeaveEvent.id))
    ).all()
    return LeaveRequestDetail(
        **lookup.request_out(r, actor, today).model_dump(),
        events=[
            EventOut(
                id=e.id,
                action=e.action,
                actor=lookup.ref(e.actor_id),
                comment=e.comment,
                created_at=e.created_at,
            )
            for e in events
        ],
    )


def holiday_dates(session: Session, years: Iterable[int]) -> set[date]:
    years = sorted(set(years))
    if not years:
        return set()
    rows = session.exec(
        select(PublicHoliday.date).where(
            PublicHoliday.date >= date(years[0], 1, 1),
            PublicHoliday.date <= date(years[-1], 12, 31),
        )
    ).all()
    return set(rows)


# --- balances ---


def round_half(value: float) -> float:
    """Round to the nearest half day, halves going up."""
    return math.floor(value * 2 + 0.5) / 2


def entitlement(allowance: float | None, start_date: date, year: int) -> float | None:
    """Yearly allowance, prorated by month for people who join during the year."""
    if allowance is None:
        return None
    if start_date.year > year:
        return 0.0
    if start_date.year < year:
        return allowance
    months = 12 - start_date.month + 1
    return round_half(allowance * months / 12)


def balances(
    session: Session, employee: Employee, year: int, exclude_request_id: int | None = None
) -> list[BalanceOut]:
    leave_types = session.exec(select(LeaveType).order_by(col(LeaveType.id))).all()
    requests = session.exec(
        select(LeaveRequest).where(
            LeaveRequest.employee_id == employee.id,
            col(LeaveRequest.status).in_(ACTIVE_STATUSES),
            LeaveRequest.start_date >= date(year, 1, 1),
            LeaveRequest.start_date <= date(year, 12, 31),
        )
    ).all()
    result = []
    for leave_type in leave_types:
        mine = [
            r for r in requests if r.leave_type_id == leave_type.id and r.id != exclude_request_id
        ]
        used = sum(r.days for r in mine if r.status == Status.APPROVED)
        pending = sum(r.days for r in mine if r.status == Status.PENDING)
        entitled = entitlement(leave_type.yearly_allowance, employee.start_date, year)
        result.append(
            BalanceOut(
                leave_type=LeaveTypeRef.model_validate(leave_type),
                year=year,
                entitled=entitled,
                used=used,
                pending=pending,
                remaining=None if entitled is None else entitled - used - pending,
            )
        )
    return result


# --- request validation ---


def format_days(days: float) -> str:
    text = f"{days:g}"
    return f"{text} day" if days == 1 else f"{text} days"


def validate_request(
    session: Session, employee: Employee, payload: LeaveRequestIn, today: date
) -> tuple[LeaveType, float]:
    """Checks a new request and returns its leave type and cost in working days."""
    leave_type = session.get(LeaveType, payload.leave_type_id)
    if leave_type is None:
        raise fail(422, f"Unknown leave type {payload.leave_type_id}")
    start, end = payload.start_date, payload.end_date
    if end < start:
        raise fail(422, "The end date can't be before the start date")
    if start.year != end.year:
        raise fail(422, "A request can't span two leave years, please split it in two")
    if start == end and payload.half_day_start and payload.half_day_end:
        raise fail(422, "For a single day pick either the morning or the afternoon")
    if start < today:
        if leave_type.code != "sick":
            raise fail(422, "Only sick leave can be booked for past dates")
        if start < today - timedelta(days=SICK_BACKDATE_DAYS):
            raise fail(422, f"Sick leave can be backdated by up to {SICK_BACKDATE_DAYS} days")

    holidays = holiday_dates(session, [start.year])
    days = working_days(start, end, holidays, payload.half_day_start, payload.half_day_end)
    if days <= 0:
        raise fail(422, "The selected dates contain no working days")

    span = half_day_span(start, end, payload.half_day_start, payload.half_day_end)
    others = session.exec(
        select(LeaveRequest).where(
            LeaveRequest.employee_id == employee.id,
            col(LeaveRequest.status).in_(ACTIVE_STATUSES),
            LeaveRequest.start_date <= end,
            LeaveRequest.end_date >= start,
        )
    ).all()
    for other in others:
        other_span = half_day_span(
            other.start_date, other.end_date, other.half_day_start, other.half_day_end
        )
        if spans_overlap(span, other_span):
            raise fail(
                status.HTTP_409_CONFLICT,
                f"This overlaps with your {other.status} request from "
                f"{other.start_date:%d %b} to {other.end_date:%d %b %Y}",
            )

    balance = next(
        b for b in balances(session, employee, start.year) if b.leave_type.id == leave_type.id
    )
    if balance.remaining is not None and days > balance.remaining:
        raise fail(
            422,
            f"Not enough {leave_type.name.lower()} left: {format_days(days)} requested, "
            f"{format_days(max(balance.remaining, 0))} remaining",
        )
    return leave_type, days
