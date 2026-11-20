import datetime as dt
from datetime import date, datetime
from enum import StrEnum

from sqlmodel import Field, SQLModel

from . import clock


class Role(StrEnum):
    EMPLOYEE = "employee"
    MANAGER = "manager"
    HR = "hr"


class Status(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    CANCELLED = "cancelled"


ACTIVE_STATUSES = (Status.PENDING, Status.APPROVED)


class Department(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(unique=True, max_length=80)


class Employee(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(max_length=100)
    email: str = Field(unique=True, index=True, max_length=200)
    job_title: str = Field(max_length=100)
    department_id: int = Field(foreign_key="department.id", index=True)
    manager_id: int | None = Field(default=None, foreign_key="employee.id", index=True)
    role: str = Field(default=Role.EMPLOYEE, max_length=20)
    start_date: date
    created_at: datetime = Field(default_factory=lambda: clock.now())


class LeaveType(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    code: str = Field(unique=True, max_length=20)
    name: str = Field(max_length=60)
    color: str = Field(max_length=9)
    # None means no yearly limit (unpaid leave)
    yearly_allowance: float | None = None


class PublicHoliday(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    date: dt.date = Field(unique=True, index=True)
    name: str = Field(max_length=80)


class LeaveRequest(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    employee_id: int = Field(foreign_key="employee.id", index=True)
    leave_type_id: int = Field(foreign_key="leavetype.id")
    start_date: date = Field(index=True)
    end_date: date = Field(index=True)
    # start in the afternoon / finish at midday
    half_day_start: bool = False
    half_day_end: bool = False
    days: float
    reason: str | None = Field(default=None, max_length=500)
    status: str = Field(default=Status.PENDING, index=True, max_length=20)
    created_at: datetime = Field(default_factory=lambda: clock.now())
    decided_at: datetime | None = None
    decided_by_id: int | None = Field(default=None, foreign_key="employee.id")
    decision_comment: str | None = Field(default=None, max_length=500)


class LeaveEvent(SQLModel, table=True):
    """Audit trail of a request: submitted, approved, rejected, cancelled."""

    id: int | None = Field(default=None, primary_key=True)
    request_id: int = Field(foreign_key="leaverequest.id", index=True)
    action: str = Field(max_length=20)
    actor_id: int = Field(foreign_key="employee.id")
    comment: str | None = Field(default=None, max_length=500)
    created_at: datetime = Field(default_factory=lambda: clock.now())
