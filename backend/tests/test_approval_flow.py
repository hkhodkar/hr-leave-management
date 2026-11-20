"""Approving, rejecting and cancelling requests, with the audit trail."""

from .conftest import BOB, EVE, HR, MANAGER, OTHER_MANAGER, as_user


def _post(client, request_id, action, user, comment=None):
    body = {"comment": comment} if comment is not None else None
    return client.post(
        f"/api/leave-requests/{request_id}/{action}", json=body, headers=as_user(user)
    )


def test_manager_approves_a_team_request(client, book, balance):
    request = book(EVE, "2026-03-09", "2026-03-11").json()
    assert balance(EVE)["pending"] == 3

    response = _post(client, request["id"], "approve", MANAGER, "Enjoy")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "approved"
    assert body["decided_by"]["id"] == MANAGER
    assert [(e["action"], e["actor"]["id"]) for e in body["events"]] == [
        ("submitted", EVE),
        ("approved", MANAGER),
    ]
    annual = balance(EVE)
    assert (annual["used"], annual["pending"], annual["remaining"]) == (3, 0, 22)


def test_rejecting_needs_a_comment(client, book, balance):
    request = book(EVE, "2026-03-09").json()
    assert _post(client, request["id"], "reject", MANAGER).status_code == 422
    assert _post(client, request["id"], "reject", MANAGER, "  ").status_code == 422

    response = _post(client, request["id"], "reject", MANAGER, "Release week, sorry")
    assert response.json()["status"] == "rejected"
    assert response.json()["decision_comment"] == "Release week, sorry"
    assert balance(EVE)["pending"] == 0


def test_only_the_manager_or_hr_can_decide(client, book):
    request = book(EVE, "2026-03-09").json()
    assert _post(client, request["id"], "approve", BOB).status_code == 403
    assert _post(client, request["id"], "approve", OTHER_MANAGER).status_code == 403
    assert _post(client, request["id"], "approve", HR).status_code == 200


def test_nobody_approves_their_own_leave(client, book):
    request = book(MANAGER, "2026-03-09").json()
    assert request["can_decide"] is False
    assert _post(client, request["id"], "approve", MANAGER).status_code == 403
    assert _post(client, request["id"], "approve", HR).status_code == 200


def test_a_decided_request_can_not_be_decided_again(client, book):
    request = book(EVE, "2026-03-09").json()
    _post(client, request["id"], "approve", MANAGER)
    response = _post(client, request["id"], "reject", MANAGER, "Changed my mind")
    assert response.status_code == 409


def test_employee_cancels_a_pending_request(client, book):
    request = book(EVE, "2026-03-09").json()
    assert request["can_cancel"] is True
    assert _post(client, request["id"], "cancel", BOB).status_code == 403

    response = _post(client, request["id"], "cancel", EVE, "Plans changed")
    body = response.json()
    assert body["status"] == "cancelled"
    assert (body["events"][-1]["action"], body["events"][-1]["comment"]) == (
        "cancelled",
        "Plans changed",
    )


def test_future_approved_leave_can_be_cancelled(client, book, balance):
    request = book(EVE, "2026-03-09").json()
    _post(client, request["id"], "approve", MANAGER)
    assert _post(client, request["id"], "cancel", EVE).status_code == 200
    assert balance(EVE)["used"] == 0


def test_leave_that_already_started_can_not_be_cancelled(client, book):
    request = book(EVE, "2026-02-27", leave_type_id=2).json()
    approved = _post(client, request["id"], "approve", MANAGER).json()
    assert approved["can_cancel"] is False
    response = _post(client, request["id"], "cancel", EVE)
    assert response.status_code == 409
    assert "already started" in response.json()["detail"]


def test_badge_counts(client, book):
    book(EVE, "2026-03-09")
    book(BOB, "2026-03-10")
    book(MANAGER, "2026-03-11")
    me = client.get("/api/me", headers=as_user(MANAGER)).json()
    assert me["pending_approvals"] == 2
    assert me["my_pending"] == 1
    assert client.get("/api/me", headers=as_user(HR)).json()["pending_approvals"] == 3


def test_dashboard_shows_who_is_off(client, book):
    today = book(EVE, "2026-03-02", "2026-03-03").json()
    _post(client, today["id"], "approve", MANAGER)
    later = book(BOB, "2026-03-05").json()
    _post(client, later["id"], "approve", MANAGER)

    dashboard = client.get("/api/dashboard", headers=as_user(BOB)).json()
    assert [a["employee"]["id"] for a in dashboard["off_today"]] == [EVE]
    assert [a["employee"]["id"] for a in dashboard["off_this_week"]] == [EVE, BOB]
    engineering = next(d for d in dashboard["usage"]["departments"] if d["name"] == "Engineering")
    assert engineering["days"]["annual"] == 3
