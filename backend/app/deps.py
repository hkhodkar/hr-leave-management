from typing import Annotated

from fastapi import Depends, Header, HTTPException
from sqlmodel import Session

from .database import get_session
from .models import Employee, Role

DbSession = Annotated[Session, Depends(get_session)]


def current_user(
    session: DbSession,
    x_user_id: Annotated[
        int | None,
        Header(description="The employee the request is made as (the demo has no real login)"),
    ] = None,
) -> Employee:
    if x_user_id is None:
        raise HTTPException(401, "Pick who you are acting as with the X-User-Id header")
    user = session.get(Employee, x_user_id)
    if user is None:
        raise HTTPException(401, f"No employee with id {x_user_id}")
    return user


CurrentUser = Annotated[Employee, Depends(current_user)]


def require_hr(user: CurrentUser) -> Employee:
    if user.role != Role.HR:
        raise HTTPException(403, "Only HR admins can do this")
    return user


HrUser = Annotated[Employee, Depends(require_hr)]
