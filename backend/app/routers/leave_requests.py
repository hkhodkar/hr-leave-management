from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func
from sqlmodel import Session, col, select

from .. import clock
from ..deps import CurrentUser, DbSession
from ..models import Employee, LeaveEvent, LeaveRequest, Status
from ..schemas import DecisionIn, LeaveRequestDetail, LeaveRequestIn, LeaveRequestOut, Page
from ..services import (
    Lookup,
    can_cancel,
    can_decide,
    can_view_leave,
    is_approver,
    request_detail,
    validate_request,
    visible_employee_ids,
)

router = APIRouter(prefix="/leave-requests", tags=["leave requests"])

Scope = Literal["all", "mine", "team", "approvals"]
RequestSort = Literal["start_date", "-start_date", "created_at", "-created_at"]


@router.get("", response_model=Page[LeaveRequestOut])
def list_requests(
    session: DbSession,
    user: CurrentUser,
    scope: Scope = "all",
    status_: Annotated[list[Status] | None, Query(alias="status")] = None,
    employee_id: int | None = None,
    department_id: int | None = None,
    leave_type_id: int | None = None,
    year: Annotated[int | None, Query(ge=2000, le=2100)] = None,
    sort: RequestSort = "-start_date",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 20,
) -> Page[LeaveRequestOut]:
    """Requests the acting user may see: their own, their team's, or everyone's for HR.

    `scope=approvals` narrows the list to requests the user decides on.
    """
    lookup = Lookup.load(session)
    visible = visible_employee_ids(session, user)
    if scope == "mine":
        ids = {user.id}
    elif scope == "team":
        ids = {e.id for e in lookup.employees.values() if e.manager_id == user.id}
    elif scope == "approvals":
        ids = {e.id for e in lookup.employees.values() if is_approver(user, e)}
    else:
        ids = visible

    if employee_id is not None:
        if visible is not None and employee_id not in visible:
            raise HTTPException(403, "You can only see leave for yourself and your team")
        ids = {employee_id} if ids is None or employee_id in ids else set()
    if department_id is not None:
        in_department = {
            e.id for e in lookup.employees.values() if e.department_id == department_id
        }
        ids = in_department if ids is None else ids & in_department

    query = select(LeaveRequest)
    if ids is not None:
        query = query.where(col(LeaveRequest.employee_id).in_(ids))
    if status_:
        query = query.where(col(LeaveRequest.status).in_(status_))
    if leave_type_id is not None:
        query = query.where(LeaveRequest.leave_type_id == leave_type_id)
    if year is not None:
        query = query.where(
            LeaveRequest.start_date >= date(year, 1, 1),
            LeaveRequest.start_date <= date(year, 12, 31),
        )

    total = session.exec(select(func.count()).select_from(query.subquery())).one()
    column = col(getattr(LeaveRequest, sort.lstrip("-")))
    descending = sort.startswith("-")
    query = query.order_by(
        column.desc() if descending else column,
        col(LeaveRequest.id).desc() if descending else col(LeaveRequest.id),
    )
    rows = session.exec(query.offset((page - 1) * page_size).limit(page_size)).all()
    today = clock.today()
    return Page(
        items=[lookup.request_out(r, user, today) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("", response_model=LeaveRequestDetail, status_code=status.HTTP_201_CREATED)
def create_request(payload: LeaveRequestIn, session: DbSession, user: CurrentUser):
    """Book leave for the acting user. It starts as pending until a manager decides."""
    today = clock.today()
    _leave_type, days = validate_request(session, user, payload, today)
    request = LeaveRequest(**payload.model_dump(), employee_id=user.id, days=days)
    session.add(request)
    session.flush()
    session.add(LeaveEvent(request_id=request.id, action="submitted", actor_id=user.id))
    session.commit()
    session.refresh(request)
    return request_detail(session, Lookup.load(session), request, user, today)


def _load(session: Session, request_id: int, user: Employee) -> tuple[LeaveRequest, Lookup]:
    request = session.get(LeaveRequest, request_id)
    if request is None:
        raise HTTPException(404, f"Leave request {request_id} was not found")
    lookup = Lookup.load(session)
    if not can_view_leave(user, lookup.employees[request.employee_id]):
        raise HTTPException(403, "You can only see leave for yourself and your team")
    return request, lookup


@router.get("/{request_id}", response_model=LeaveRequestDetail)
def get_request(request_id: int, session: DbSession, user: CurrentUser):
    request, lookup = _load(session, request_id, user)
    return request_detail(session, lookup, request, user, clock.today())


def _decide(
    session: Session, request_id: int, user: Employee, new_status: Status, comment: str | None
) -> LeaveRequestDetail:
    request, lookup = _load(session, request_id, user)
    employee = lookup.employees[request.employee_id]
    if request.status != Status.PENDING:
        raise HTTPException(409, f"This request is already {request.status}")
    if not can_decide(user, employee, request):
        if user.id == employee.id:
            raise HTTPException(403, "You can't approve or reject your own request")
        raise HTTPException(403, "Only their manager or HR can decide on this request")
    now = clock.now()
    request.status = new_status
    request.decided_at = now
    request.decided_by_id = user.id
    request.decision_comment = comment or None
    session.add(request)
    session.add(
        LeaveEvent(
            request_id=request.id,
            action=new_status.value,
            actor_id=user.id,
            comment=comment or None,
            created_at=now,
        )
    )
    session.commit()
    session.refresh(request)
    return request_detail(session, lookup, request, user, clock.today())


@router.post("/{request_id}/approve", response_model=LeaveRequestDetail)
def approve_request(
    request_id: int, session: DbSession, user: CurrentUser, payload: DecisionIn | None = None
):
    comment = payload.comment if payload else None
    return _decide(session, request_id, user, Status.APPROVED, comment)


@router.post("/{request_id}/reject", response_model=LeaveRequestDetail)
def reject_request(request_id: int, payload: DecisionIn, session: DbSession, user: CurrentUser):
    if not payload.comment:
        raise HTTPException(422, "Please add a comment explaining why the request is rejected")
    return _decide(session, request_id, user, Status.REJECTED, payload.comment)


@router.post("/{request_id}/cancel", response_model=LeaveRequestDetail)
def cancel_request(
    request_id: int, session: DbSession, user: CurrentUser, payload: DecisionIn | None = None
):
    """Pending requests can always be cancelled, approved ones until the leave starts."""
    request, lookup = _load(session, request_id, user)
    today = clock.today()
    if not can_cancel(user, request, today):
        if user.id != request.employee_id and user.role != "hr":
            raise HTTPException(403, "Only the employee or HR can cancel this request")
        if request.status == Status.APPROVED:
            raise HTTPException(409, "This leave has already started and can't be cancelled")
        raise HTTPException(409, f"A {request.status} request can't be cancelled")
    comment = payload.comment if payload else None
    request.status = Status.CANCELLED
    session.add(request)
    session.add(
        LeaveEvent(
            request_id=request.id,
            action="cancelled",
            actor_id=user.id,
            comment=comment or None,
            created_at=clock.now(),
        )
    )
    session.commit()
    session.refresh(request)
    return request_detail(session, lookup, request, user, today)
