from datetime import date, datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints

from .models import Role, Status

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Comment = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]


class Ref(BaseModel):
    id: int
    name: str


class DepartmentOut(BaseModel):
    id: int
    name: str
    headcount: int


class EmployeeRef(BaseModel):
    id: int
    name: str
    job_title: str
    department_id: int


class EmployeeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    email: str
    job_title: str
    role: Role
    start_date: date
    department_id: int
    department: Ref
    manager_id: int | None
    manager: Ref | None
    report_count: int
    created_at: datetime


class EmployeeIn(BaseModel):
    name: Name
    email: EmailStr
    job_title: Name
    department_id: int
    manager_id: int | None = None
    role: Role = Role.EMPLOYEE
    start_date: date


class SessionUser(BaseModel):
    id: int
    name: str
    role: Role
    job_title: str
    department: str


class MeOut(BaseModel):
    user: EmployeeOut
    pending_approvals: int
    my_pending: int


class LeaveTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    color: str
    yearly_allowance: float | None


class LeaveTypeRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    color: str


class HolidayOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    date: date
    name: str


class BalanceOut(BaseModel):
    leave_type: LeaveTypeRef
    year: int
    entitled: float | None
    used: float
    pending: float
    remaining: float | None


class LeaveRequestIn(BaseModel):
    leave_type_id: int
    start_date: date
    end_date: date
    half_day_start: bool = False
    half_day_end: bool = False
    reason: Comment | None = None


class DecisionIn(BaseModel):
    comment: Comment | None = None


class EventOut(BaseModel):
    id: int
    action: str
    actor: Ref
    comment: str | None
    created_at: datetime


class LeaveRequestOut(BaseModel):
    id: int
    employee: EmployeeRef
    leave_type: LeaveTypeRef
    start_date: date
    end_date: date
    half_day_start: bool
    half_day_end: bool
    days: float
    reason: str | None
    status: Status
    created_at: datetime
    decided_at: datetime | None
    decided_by: Ref | None
    decision_comment: str | None
    can_cancel: bool
    can_decide: bool


class LeaveRequestDetail(LeaveRequestOut):
    events: list[EventOut]


class Absence(BaseModel):
    request_id: int
    employee: EmployeeRef
    # hidden (None) when the viewer may not see why someone is away
    leave_type: LeaveTypeRef | None
    start_date: date
    end_date: date
    half_day_start: bool
    half_day_end: bool
    days: float
    status: Status


class CalendarOut(BaseModel):
    year: int
    month: int
    holidays: list[HolidayOut]
    absences: list[Absence]


class DepartmentUsage(BaseModel):
    id: int
    name: str
    headcount: int
    days: dict[str, float]


class UsageOut(BaseModel):
    year: int
    leave_types: list[LeaveTypeRef]
    departments: list[DepartmentUsage]


class DashboardOut(BaseModel):
    date: date
    off_today: list[Absence]
    off_this_week: list[Absence]
    pending_approvals: int
    my_pending: int
    next_holidays: list[HolidayOut]
    my_balances: list[BalanceOut]
    usage: UsageOut


class Page[T](BaseModel):
    items: list[T]
    total: int
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)
