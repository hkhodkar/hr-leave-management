"""Validation of new leave requests and the balances they draw from."""

from .conftest import EVE, MANAGER, NINA, as_user


def test_new_request_is_pending_and_counts_working_days(book):
    response = book(EVE, "2026-03-30", "2026-04-10")
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["status"] == "pending"
    assert body["days"] == 8  # Good Friday and Easter Monday are free
    assert [e["action"] for e in body["events"]] == ["submitted"]


def test_end_before_start_is_rejected(book):
    response = book(EVE, "2026-03-12", "2026-03-10")
    assert response.status_code == 422
    assert "end date" in response.json()["detail"]


def test_weekend_only_request_is_rejected(book):
    response = book(EVE, "2026-03-07", "2026-03-08")
    assert response.status_code == 422
    assert "no working days" in response.json()["detail"]


def test_single_day_needs_one_half(book):
    response = book(EVE, "2026-03-10", half_day_start=True, half_day_end=True)
    assert response.status_code == 422


def test_requests_can_not_cross_the_leave_year(book):
    assert book(EVE, "2026-12-30", "2027-01-05").status_code == 422


def test_only_sick_leave_can_be_backdated(book):
    assert book(EVE, "2026-02-25").status_code == 422
    assert book(EVE, "2026-02-25", leave_type_id=2).status_code == 201
    # but not by more than a month
    assert book(EVE, "2026-01-12", leave_type_id=2).status_code == 422


def test_overlapping_requests_are_rejected(book):
    assert book(EVE, "2026-03-09", "2026-03-13").status_code == 201
    response = book(EVE, "2026-03-12", "2026-03-16")
    assert response.status_code == 409
    assert "overlaps" in response.json()["detail"]


def test_morning_off_then_afternoon_off_is_fine(book):
    assert book(EVE, "2026-03-09", "2026-03-11", half_day_end=True).status_code == 201
    assert book(EVE, "2026-03-11", "2026-03-12", half_day_start=True).status_code == 201
    assert book(EVE, "2026-03-11").status_code == 409


def test_other_peoples_leave_does_not_overlap(book):
    assert book(EVE, "2026-03-09").status_code == 201
    assert book(MANAGER, "2026-03-09").status_code == 201


def test_cancelled_requests_free_the_dates(client, book):
    first = book(EVE, "2026-03-09").json()
    client.post(f"/api/leave-requests/{first['id']}/cancel", headers=as_user(EVE))
    assert book(EVE, "2026-03-09").status_code == 201


def test_balance_counts_used_and_pending(client, book, balance):
    approved = book(EVE, "2026-03-09", "2026-03-13").json()
    client.post(f"/api/leave-requests/{approved['id']}/approve", headers=as_user(MANAGER))
    book(EVE, "2026-04-14", "2026-04-15", half_day_end=True)

    annual = balance(EVE)
    assert [annual[k] for k in ("entitled", "used", "pending", "remaining")] == [25, 5, 1.5, 18.5]


def test_request_larger_than_balance_is_rejected(book, balance):
    # five full weeks use up the whole allowance
    assert book(EVE, "2026-06-01", "2026-07-03").status_code == 201
    assert balance(EVE)["remaining"] == 0
    response = book(EVE, "2026-07-06")
    assert response.status_code == 422
    assert "1 day requested, 0 days remaining" in response.json()["detail"]


def test_new_joiners_get_a_prorated_allowance(book, balance):
    assert balance(NINA)["entitled"] == 12.5  # joins in July
    assert book(NINA, "2026-08-03", "2026-08-21").status_code == 422  # 15 days


def test_unpaid_leave_has_no_limit(book, balance):
    assert book(EVE, "2026-06-01", "2026-07-31", leave_type_id=4).status_code == 201
    unpaid = balance(EVE, "unpaid")
    assert unpaid["entitled"] is None and unpaid["remaining"] is None
    assert unpaid["pending"] == 45
