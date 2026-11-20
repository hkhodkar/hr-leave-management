"""What each role may see and do."""

from .conftest import BOB, EVE, HR, MANAGER, NINA, OTHER_MANAGER, as_user


def test_requests_need_an_acting_user(client):
    assert client.get("/api/leave-requests").status_code == 401
    assert client.get("/api/leave-requests", headers=as_user(999)).status_code == 401


def test_user_list_for_the_switcher_is_public(client):
    users = client.get("/api/session/users").json()
    assert {u["role"] for u in users} == {"employee", "manager", "hr"}


def test_employees_only_see_their_own_requests(client, book):
    book(EVE, "2026-03-09")
    book(BOB, "2026-03-10")
    items = client.get("/api/leave-requests", headers=as_user(EVE)).json()["items"]
    assert {r["employee"]["id"] for r in items} == {EVE}


def test_employees_can_not_open_a_teammates_request_or_balance(client, book):
    request = book(BOB, "2026-03-10").json()
    assert (
        client.get(f"/api/leave-requests/{request['id']}", headers=as_user(EVE)).status_code == 403
    )
    assert client.get(f"/api/employees/{BOB}/balances", headers=as_user(EVE)).status_code == 403
    response = client.get("/api/leave-requests", params={"employee_id": BOB}, headers=as_user(EVE))
    assert response.status_code == 403


def test_managers_see_their_team_but_not_other_teams(client, book):
    book(EVE, "2026-03-09")
    book(NINA, "2026-08-03")
    items = client.get("/api/leave-requests", headers=as_user(MANAGER)).json()["items"]
    assert {r["employee"]["id"] for r in items} == {EVE}
    assert (
        client.get(f"/api/employees/{NINA}/balances", headers=as_user(MANAGER)).status_code == 403
    )


def test_hr_sees_everyone(client, book):
    book(EVE, "2026-03-09")
    book(NINA, "2026-08-03")
    items = client.get("/api/leave-requests", headers=as_user(HR)).json()["items"]
    assert {r["employee"]["id"] for r in items} == {EVE, NINA}


def test_approvals_scope_lists_what_the_user_decides(client, book):
    book(EVE, "2026-03-09")
    book(MANAGER, "2026-03-10")
    book(NINA, "2026-08-03")

    def ids(user):
        params = {"scope": "approvals", "status": "pending"}
        items = client.get("/api/leave-requests", params=params, headers=as_user(user)).json()
        return {r["employee"]["id"] for r in items["items"]}

    assert ids(MANAGER) == {EVE}
    assert ids(OTHER_MANAGER) == {NINA}
    assert ids(HR) == {EVE, MANAGER, NINA}
    assert ids(EVE) == set()


def test_only_hr_can_add_or_edit_employees(client):
    payload = {
        "name": "New Person",
        "email": "new.person@example.com",
        "job_title": "Engineer",
        "department_id": 1,
        "manager_id": MANAGER,
        "start_date": "2026-04-01",
    }
    assert client.post("/api/employees", json=payload, headers=as_user(MANAGER)).status_code == 403
    created = client.post("/api/employees", json=payload, headers=as_user(HR))
    assert created.status_code == 201
    assert created.json()["manager"]["name"] == "Max Moreno"

    update = payload | {"job_title": "Senior Engineer"}
    url = f"/api/employees/{created.json()['id']}"
    assert client.put(url, json=update, headers=as_user(EVE)).status_code == 403
    assert (
        client.put(url, json=update, headers=as_user(HR)).json()["job_title"] == "Senior Engineer"
    )


def test_employee_emails_are_unique(client):
    payload = {
        "name": "Eve Again",
        "email": "EVE.EVANS@example.com",
        "job_title": "Engineer",
        "department_id": 1,
        "start_date": "2026-04-01",
    }
    response = client.post("/api/employees", json=payload, headers=as_user(HR))
    assert response.status_code == 409


def test_nobody_can_report_to_their_own_report(client):
    max_moreno = client.get(f"/api/employees/{MANAGER}", headers=as_user(HR)).json()
    payload = {
        "name": max_moreno["name"],
        "email": max_moreno["email"],
        "job_title": max_moreno["job_title"],
        "department_id": 1,
        "manager_id": EVE,
        "role": "manager",
        "start_date": max_moreno["start_date"],
    }
    response = client.put(f"/api/employees/{MANAGER}", json=payload, headers=as_user(HR))
    assert response.status_code == 422


def test_directory_is_searchable_and_paged(client):
    page = client.get(
        "/api/employees", params={"search": "engineer", "page_size": 2}, headers=as_user(EVE)
    ).json()
    assert page["total"] == 3
    assert len(page["items"]) == 2
    by_department = client.get(
        "/api/employees", params={"department_id": 2}, headers=as_user(EVE)
    ).json()
    assert {e["name"] for e in by_department["items"]} == {"Hana Hart", "Olga Owens", "Nina Novak"}


def test_calendar_hides_leave_types_from_coworkers(client, book):
    request = book(BOB, "2026-03-10", leave_type_id=2).json()
    client.post(f"/api/leave-requests/{request['id']}/approve", headers=as_user(MANAGER))
    pending = book(BOB, "2026-03-20").json()

    def absences(user):
        params = {"year": 2026, "month": 3}
        return client.get("/api/calendar", params=params, headers=as_user(user)).json()["absences"]

    seen_by_eve = absences(EVE)
    assert [a["request_id"] for a in seen_by_eve] == [request["id"]]
    assert seen_by_eve[0]["leave_type"] is None
    seen_by_manager = absences(MANAGER)
    assert [a["request_id"] for a in seen_by_manager] == [request["id"], pending["id"]]
    assert seen_by_manager[0]["leave_type"]["code"] == "sick"
