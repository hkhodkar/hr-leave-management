from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlmodel import Session, col, select

from .. import clock
from ..deps import CurrentUser, DbSession, HrUser
from ..models import Department, Employee, Role
from ..schemas import BalanceOut, EmployeeIn, EmployeeOut, Page
from ..services import Lookup, balances, can_view_leave, fail

router = APIRouter(prefix="/employees", tags=["employees"])

EmployeeSort = Literal["name", "-name", "department", "start_date", "-start_date"]


@router.get("", response_model=Page[EmployeeOut])
def list_employees(
    session: DbSession,
    _user: CurrentUser,
    search: str | None = None,
    department_id: int | None = None,
    role: Role | None = None,
    sort: EmployeeSort = "name",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 20,
) -> Page[EmployeeOut]:
    """The company directory. Everyone can browse it, only HR can change it."""
    query = select(Employee)
    if search and search.strip():
        term = f"%{search.strip().lower()}%"
        query = query.where(
            or_(
                func.lower(Employee.name).like(term),
                func.lower(Employee.email).like(term),
                func.lower(Employee.job_title).like(term),
            )
        )
    if department_id is not None:
        query = query.where(Employee.department_id == department_id)
    if role is not None:
        query = query.where(Employee.role == role)

    total = session.exec(select(func.count()).select_from(query.subquery())).one()
    if sort == "department":
        query = query.join(Department).order_by(col(Department.name), func.lower(Employee.name))
    else:
        column = func.lower(Employee.name) if sort.endswith("name") else col(Employee.start_date)
        query = query.order_by(column.desc() if sort.startswith("-") else column, col(Employee.id))
    rows = session.exec(query.offset((page - 1) * page_size).limit(page_size)).all()

    lookup = Lookup.load(session)
    return Page(
        items=[lookup.employee_out(e) for e in rows], total=total, page=page, page_size=page_size
    )


def get_employee_or_404(session: Session, employee_id: int) -> Employee:
    employee = session.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(404, f"Employee {employee_id} was not found")
    return employee


@router.get("/{employee_id}", response_model=EmployeeOut)
def get_employee(employee_id: int, session: DbSession, _user: CurrentUser) -> EmployeeOut:
    employee = get_employee_or_404(session, employee_id)
    return Lookup.load(session).employee_out(employee)


@router.get("/{employee_id}/balances", response_model=list[BalanceOut])
def get_balances(
    employee_id: int,
    session: DbSession,
    user: CurrentUser,
    year: Annotated[int | None, Query(ge=2000, le=2100)] = None,
) -> list[BalanceOut]:
    employee = get_employee_or_404(session, employee_id)
    if not can_view_leave(user, employee):
        raise HTTPException(403, "You can only see leave balances for yourself and your team")
    return balances(session, employee, year or clock.today().year)


def _check_payload(session: Session, payload: EmployeeIn, employee_id: int | None = None) -> None:
    if session.get(Department, payload.department_id) is None:
        raise fail(422, f"Unknown department {payload.department_id}")
    taken = session.exec(
        select(Employee).where(func.lower(Employee.email) == payload.email.lower())
    ).first()
    if taken is not None and taken.id != employee_id:
        raise fail(status.HTTP_409_CONFLICT, f"{payload.email} is already used by {taken.name}")
    if payload.manager_id is None:
        return
    manager = session.get(Employee, payload.manager_id)
    if manager is None:
        raise fail(422, f"Unknown manager {payload.manager_id}")
    # walk up the chain so nobody ends up managing their own manager
    seen: set[int] = set()
    while manager is not None and manager.id not in seen:
        if manager.id == employee_id:
            raise fail(422, "An employee can't report to themselves or to someone in their team")
        seen.add(manager.id)
        manager = session.get(Employee, manager.manager_id) if manager.manager_id else None


@router.post("", response_model=EmployeeOut, status_code=status.HTTP_201_CREATED)
def create_employee(payload: EmployeeIn, session: DbSession, _hr: HrUser) -> EmployeeOut:
    _check_payload(session, payload)
    employee = Employee(**payload.model_dump())
    session.add(employee)
    session.commit()
    session.refresh(employee)
    return Lookup.load(session).employee_out(employee)


@router.put("/{employee_id}", response_model=EmployeeOut)
def update_employee(
    employee_id: int, payload: EmployeeIn, session: DbSession, _hr: HrUser
) -> EmployeeOut:
    employee = get_employee_or_404(session, employee_id)
    _check_payload(session, payload, employee_id)
    for field, value in payload.model_dump().items():
        setattr(employee, field, value)
    session.add(employee)
    session.commit()
    session.refresh(employee)
    return Lookup.load(session).employee_out(employee)
