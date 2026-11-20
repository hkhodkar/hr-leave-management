from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query
from sqlmodel import col, func, select

from .. import clock
from ..deps import DbSession
from ..models import Department, Employee, LeaveType, PublicHoliday
from ..schemas import DepartmentOut, HolidayOut, LeaveTypeOut

router = APIRouter(tags=["reference data"])


@router.get("/departments", response_model=list[DepartmentOut])
def list_departments(session: DbSession) -> list[DepartmentOut]:
    counts = dict(
        session.exec(
            select(Employee.department_id, func.count()).group_by(col(Employee.department_id))
        ).all()
    )
    departments = session.exec(select(Department).order_by(col(Department.name))).all()
    return [DepartmentOut(id=d.id, name=d.name, headcount=counts.get(d.id, 0)) for d in departments]


@router.get("/leave-types", response_model=list[LeaveTypeOut])
def list_leave_types(session: DbSession) -> list[LeaveType]:
    return list(session.exec(select(LeaveType).order_by(col(LeaveType.id))).all())


@router.get("/holidays", response_model=list[HolidayOut])
def list_holidays(
    session: DbSession,
    year: Annotated[int | None, Query(ge=2000, le=2100)] = None,
) -> list[PublicHoliday]:
    year = year or clock.today().year
    return list(
        session.exec(
            select(PublicHoliday)
            .where(PublicHoliday.date >= date(year, 1, 1), PublicHoliday.date <= date(year, 12, 31))
            .order_by(col(PublicHoliday.date))
        ).all()
    )
