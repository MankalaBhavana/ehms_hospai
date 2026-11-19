# Login and password security fix (2026-11-13)

Answer to the dev-team note "login code lets accounts be created or entered with default passwords".
Scope: application code only. Nothing here touches nginx, Cloudflare, Docker or compose.

## Analysis: the four findings, checked against the code

| # | Finding | Verdict | What the code did |
|---|---|---|---|
| 1 | Login creates an active account from `doctors` | **Confirmed, critical** | `authenticate()` (core/auth.py): when no `users` row matched, it searched `doctors` by username / staff id / name / e-mail and, if the typed password was `Doctor@123`, `password`, `Admin@123`, `12345678`, `doctor`, the staff id or the username, **INSERTed an active `ROLE_DOCTOR` user with that password** and signed the caller in. |
| 2 | `verify_password` accepts things that are not the password | **Confirmed, high** | Plain-text equality (`password == hashed`); `mock_` hashes accepted five default passwords; every check was also tried with `password.strip()`; werkzeug hashes; and **unsalted MD5 / SHA-256** hashes (not in the note, same class of problem). |
| 3 | Candidate selection bypass | **Not exploitable today, but fragile: fixed** | `if user is None and ordered: user = ordered[0]` kept an unverified candidate. The session was only issued inside `if pw_valid:` (the password is verified a second time), so no bypass existed, but one refactor away it would have been. Now a candidate is chosen only if its password verified; otherwise a dummy bcrypt check runs (same timing for "no such user" and "wrong password") and `None` is returned. |
| 4 | Weak passwords blocked only by length | **Confirmed, and wider** | `validate_password` only checked `len >= 8`. Also: user **edit** (`update_admin_user`) had **no check at all**; doctor create / edit used length 8 / **length 4**; admin create / reset-in-DB only length; the admin reset route called the policy but the DB layer did not. |

### Further problems found while checking (also fixed)
- **Passwords written to the audit trail.** `PUT /api/admin/users/<id>` and `PUT /api/admin/doctors/<id>` logged the whole request body, including the plain-text `password`, into `audit_logs`. `shared/audit.py` now redacts every password / secret / token field centrally.
- **Passwords silently trimmed on set** (`.strip()`), so what was stored differed from what was typed. Now a password with leading or trailing spaces is rejected, and the exact text is hashed and verified.
- **bcrypt's 72-byte limit** was not enforced (longer passwords were silently truncated or raised): now rejected.
- **`INITIAL_ADMIN_PASSWORD` accepted `Admin@123`.** It now goes through the same policy, but only when the administrator is actually being created (a stale weak value in the environment does not stop a server whose admin already exists). `start-team-test.ps1` no longer defaults to `Admin@123`: it generates a random password and prints it.
- **Frontend fallbacks to `password123`**: Administration user form ("minimum 4 characters", `|| "password123"`), credentials modal, the offline mock layer (`lib/api.ts`), the local admin in `roleDb.ts` (`password123`), `legacySeedPurge.ts` (`Admin@123`) and the unused `DOCTOR_LOCAL_PASSWORD`. Removed; the form now requires 8 characters.

### Noted, not changed (outside this request)
- The browser-side role store (`roleDb.ts`) still keeps user passwords in `localStorage` for the offline development mode (`LOCAL_MOCKS_ENABLED`, off in deployed builds).
- `frontend/server/app.mjs` (a development-only fallback server, not started by `prod.mjs` or the start script) answers any login as admin. Do not deploy it.
- The login query matches an identifier against username, e-mail, employee id, full name, phone and doctor name, and allows `hospital_id IS NULL` users in every hospital. It cannot bypass the password check now, but a stricter lookup (username / e-mail / employee id only) would be tidier.

## What changed
`backend/backend/core/auth.py`
- `verify_password`: bcrypt only, exact password. Plain text, `mock_`, werkzeug, MD5, SHA-256 and trimmed-password checks removed (there are no legacy hashes on staging; a legacy hash now simply fails and the account needs a reset).
- `authenticate`: the whole `doctors` bootstrap block deleted; login never creates an account; a user is returned only if a password verified; dummy bcrypt for equal timing; the second verification is gone (the account was selected because it verified).
- `validate_password(password, *identities)`: 8+ characters, at most 72 bytes, no leading / trailing space, not a known default (Doctor@123, Admin@123, password123, password, 12345678 ...), and not equal to the username, staff id, employee id or e-mail (or the part of the e-mail before `@`).
- `create_default_users`: the first administrator's password must pass the policy (no default).
- Call sites pass the account identities: `signup_employee`, `signup_hospital_admin`, `reset_hospital_admin_password`.

`backend/backend/utils/database.py`: one helper `_check_new_password` used by create doctor, edit doctor (synced login), create user, edit user, and admin reset (which looks up the account's username / employee id / e-mail first).
`backend/backend/modules/admin/routes.py`, `modules/auth/routes.py`: identities passed to the policy; reset route returns 400 (not 500) for a rejected password; the password is no longer trimmed.
`backend/backend/shared/audit.py`: `redact_secrets`.
Frontend: `Administration.tsx`, `lib/api.ts`, `roleDb.ts`, `legacySeedPurge.ts`, `doctorMaster.ts`. Script: `start-team-test.ps1`.

## Tests
`backend/backend/tests/test_auth_security.py` (runs in CI without a database: `core.auth.get_connection` is replaced by a fake that records every statement).

| Required test | Test |
|---|---|
| 1. Doctor without a login: default / staff id / username passwords fail and no `users` row is added | `test_doctor_without_login_cannot_sign_in_and_no_account_is_created` (7 passwords x 4 identifiers; asserts no INSERT and that `doctors` is not even queried) |
| 2. The stored hash as the password fails | `test_stored_hash_is_not_a_password` |
| 3. `mock_` hash + `Doctor@123` fails | `test_mock_hash_never_accepts_a_default_password` |
| 4. Wrong password never returns a user | `test_wrong_password_never_returns_a_user_but_the_right_one_does`, `..._with_several_candidates_returns_none` |
| 5. Spaces around the password are not accepted | `test_password_is_checked_exactly_no_trimming` |
| 6. Creating / resetting `Doctor@123` or the username is rejected | `test_known_default_passwords_are_rejected`, `test_password_equal_to_username_staff_id_or_email_is_rejected`, `test_every_path_that_sets_a_password_uses_the_policy` |

Extra: only bcrypt hashes verify (SHA-256 / MD5 / werkzeug / plain text do not); inactive account refused; first administrator must not use a default; an existing administrator is not blocked by a stale weak env value; audit redaction; `Doctor@123` appears once in `core/auth.py` (the reject list) and the login code contains no bootstrap block.
Result: **38 passed**.

Live check against the running backend (`scratchpad/live_auth_test.py`, run on 2026-11-13): existing admin (bcrypt) still signs in; creating a doctor with `Doctor@123` -> 400; password equal to the username -> 400; a normal admin-created doctor signs in with the password from the form; the same password with a leading space -> 401; resetting a password to the username or `Doctor@123` -> 400; a doctor whose login row was deleted: 32 attempts (default passwords, staff id, username, the real password) were all refused (401, or 429 from the login rate limiter) and the number of `users` rows did not change.

## Acceptance
- All six required tests pass (38 tests in total).
- A normal admin-created doctor signs in with the password set in the form.
- `grep -n "Doctor@123"` finds it only in the weak-password reject list (`core/auth.py`) and in the tests.
