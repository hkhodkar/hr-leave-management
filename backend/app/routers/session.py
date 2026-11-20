from fastapi import APIRouter
from sqlmodel import col, select

from ..deps import CurrentUser, DbSession
from ..models import Department, Employee, LeaveRequest, Status
from ..schemas import MeOut, SessionUser
from ..services import Lookup, is_approver

router = APIRouter(tags=["session"])


@router.get("/session/users", response_model=list[SessionUser])
def switchable_users(session: DbSession) -> list[SessionUser]:
    """Everyone the app can be viewed as, for the "View as" picker."""
    departments = {d.id: d.name for d in session.exec(select(Department)).all()}
    employees = session.exec(select(Employee).order_by(col(Employee.name))).all()
    return [
        SessionUser(
            id=e.id,
            name=e.name,
            role=e.role,
            job_title=e.job_title,
            department=departments[e.department_id],
        )
        for e in employees
    ]


@router.get("/me", response_model=MeOut)
def me(session: DbSession, user: CurrentUser) -> MeOut:
    lookup = Lookup.load(session)
    pending = session.exec(select(LeaveRequest).where(LeaveRequest.status == Status.PENDING)).all()
    return MeOut(
        user=lookup.employee_out(user),
        pending_approvals=sum(
            1 for r in pending if is_approver(user, lookup.employees[r.employee_id])
        ),
        my_pending=sum(1 for r in pending if r.employee_id == user.id),
    )
