from collections import defaultdict
from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Query
from sqlmodel import col, select

from .. import clock
from ..deps import CurrentUser, DbSession
from ..models import LeaveRequest, LeaveType, PublicHoliday, Status
from ..schemas import (
    Absence,
    CalendarOut,
    DashboardOut,
    DepartmentUsage,
    HolidayOut,
    LeaveTypeRef,
    UsageOut,
)
from ..services import Lookup, balances, can_view_leave, is_approver

router = APIRouter(tags=["overview"])


def _absences(
    session, lookup: Lookup, user, start: date, end: date, include_pending: bool
) -> list[Absence]:
    statuses = [Status.APPROVED, Status.PENDING] if include_pending else [Status.APPROVED]
    rows = session.exec(
        select(LeaveRequest).where(
            col(LeaveRequest.status).in_(statuses),
            LeaveRequest.start_date <= end,
            LeaveRequest.end_date >= start,
        )
    ).all()
    # pending requests only show up for people who could see the request itself
    visible = [
        r
        for r in rows
        if r.status == Status.APPROVED or can_view_leave(user, lookup.employees[r.employee_id])
    ]
    visible.sort(key=lambda r: (r.start_date, lookup.employees[r.employee_id].name))
    return [lookup.absence(r, user) for r in visible]


@router.get("/calendar", response_model=CalendarOut)
def calendar(
    session: DbSession,
    user: CurrentUser,
    year: Annotated[int, Query(ge=2000, le=2100)],
    month: Annotated[int, Query(ge=1, le=12)],
    department_id: int | None = None,
) -> CalendarOut:
    """Who is away in a month. Leave types stay private to the person, their manager and HR."""
    first = date(year, month, 1)
    last = date(year + month // 12, month % 12 + 1, 1) - timedelta(days=1)
    lookup = Lookup.load(session)
    absences = _absences(session, lookup, user, first, last, include_pending=True)
    if department_id is not None:
        absences = [a for a in absences if a.employee.department_id == department_id]
    holidays = session.exec(
        select(PublicHoliday)
        .where(PublicHoliday.date >= first, PublicHoliday.date <= last)
        .order_by(col(PublicHoliday.date))
    ).all()
    return CalendarOut(
        year=year,
        month=month,
        holidays=[HolidayOut.model_validate(h) for h in holidays],
        absences=absences,
    )


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(session: DbSession, user: CurrentUser) -> DashboardOut:
    today = clock.today()
    monday = today - timedelta(days=today.weekday())
    lookup = Lookup.load(session)

    off_today = _absences(session, lookup, user, today, today, include_pending=False)
    off_week = _absences(
        session, lookup, user, monday, monday + timedelta(days=6), include_pending=False
    )

    pending = session.exec(select(LeaveRequest).where(LeaveRequest.status == Status.PENDING)).all()
    next_holidays = session.exec(
        select(PublicHoliday)
        .where(PublicHoliday.date >= today)
        .order_by(col(PublicHoliday.date))
        .limit(3)
    ).all()

    leave_types = session.exec(select(LeaveType).order_by(col(LeaveType.id))).all()
    approved = session.exec(
        select(LeaveRequest).where(
            LeaveRequest.status == Status.APPROVED,
            LeaveRequest.start_date >= date(today.year, 1, 1),
            LeaveRequest.start_date <= date(today.year, 12, 31),
        )
    ).all()
    usage: dict[int, dict[str, float]] = defaultdict(lambda: {t.code: 0.0 for t in leave_types})
    for r in approved:
        department_id = lookup.employees[r.employee_id].department_id
        usage[department_id][lookup.leave_types[r.leave_type_id].code] += r.days
    headcount: dict[int, int] = defaultdict(int)
    for e in lookup.employees.values():
        headcount[e.department_id] += 1

    return DashboardOut(
        date=today,
        off_today=off_today,
        off_this_week=off_week,
        pending_approvals=sum(
            1 for r in pending if is_approver(user, lookup.employees[r.employee_id])
        ),
        my_pending=sum(1 for r in pending if r.employee_id == user.id),
        next_holidays=[HolidayOut.model_validate(h) for h in next_holidays],
        my_balances=balances(session, user, today.year),
        usage=UsageOut(
            year=today.year,
            leave_types=[LeaveTypeRef.model_validate(t) for t in leave_types],
            departments=[
                DepartmentUsage(
                    id=d.id,
                    name=d.name,
                    headcount=headcount[d.id],
                    days=usage[d.id],
                )
                for d in sorted(lookup.departments.values(), key=lambda d: d.name)
            ],
        ),
    )
