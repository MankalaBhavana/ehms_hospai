"""No route is added without authentication: every endpoint either carries an auth decorator or is on the reviewed list below."""
import ast
import os
import re

ROOT = os.path.join(os.path.dirname(__file__), "..")
AUTH_DECORATORS = ("require_permissions", "admin_access_required", "require_session", "login_required")

# Reviewed: reachable without a session on purpose, and why.
PUBLIC = {
    "/api/health": "liveness probe", "/api/ready": "readiness probe", "/api/languages": "static list for the login screen",
    "/api/payments/razorpay/config": "public key id only",
    "/api/auth/login-summary": "counts shown on the login screen", "/api/auth/login-roles": "role names for the login screen",
    "/api/auth/login-specialties": "specialty names", "/api/auth/login": "the login itself",
    "/api/auth/session": "answers 'who am I' from the session cookie (in-function check)",
    "/api/auth/logout": "ends the caller's own session", "/api/auth/sessions": "own sessions (in-function session check)",
    "/api/auth/sessions/<int:session_id>": "own session (in-function session check)",
    "/api/auth/current-credentials": "own profile (in-function session check)", "/api/auth/update-credentials": "own profile (in-function session + current password)",
    "/api/auth/reset-admin-credentials": "in-function: signed-in administrator only",
    "/api/auth/setup-admin": "in-function: platform administrator credentials",
    "/api/messaging/status-callback": "Twilio delivery receipt, authenticated by its signature",
    "/api/public/patient-card/<token>": "card holder's unguessable token",
    "/webhook": "WhatsApp provider webhook: verify token / Twilio signature", "/media/<token>": "provider media fetch: unguessable token",
    "/api/<path:_path>": "CORS preflight",
}
PLATFORM_PREFIX = "/api/platform/"  # in-function require_platform_admin() (header credentials)
HR_V1_PREFIX = "/api/v1/"  # blueprint before_request: signed-in user + hr.read / employees.read


def _routes():
    found = []
    for dirpath, _dirs, files in os.walk(ROOT):
        if any(x in dirpath for x in ("tests", "__pycache__", "alembic", "venv", "site-packages")):
            continue
        for f in files:
            if not f.endswith(".py"):
                continue
            path = os.path.join(dirpath, f)
            try:
                tree = ast.parse(open(path, encoding="utf-8").read())
            except SyntaxError:
                continue
            for node in ast.walk(tree):
                if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                route, decs = None, []
                for d in node.decorator_list:
                    src = ast.unparse(d)
                    decs.append(src)
                    m = re.match(r"(\w+)\.(get|post|put|delete|patch|route)\((.*)\)$", src, re.S)
                    if m and "limiter" not in m.group(1):
                        route = re.match(r"\s*['\"]([^'\"]*)['\"]", m.group(3))
                if route:
                    found.append((route.group(1), node.name, os.path.relpath(path, ROOT), decs))
    return found


def test_every_route_is_protected_or_reviewed():
    problems = []
    for path, func, file, decs in _routes():
        protected = any(a in d for d in decs for a in AUTH_DECORATORS)
        if protected or path in PUBLIC or path.startswith(PLATFORM_PREFIX) or path.startswith(HR_V1_PREFIX):
            continue
        problems.append(f"{path}  ({file}::{func})")
    assert not problems, "routes without authentication that are not on the reviewed list:\n  " + "\n  ".join(sorted(set(problems)))


def test_whatsapp_settings_need_a_permission():
    src = open(os.path.join(ROOT, "modules", "whatsapp", "routes.py"), encoding="utf-8").read()
    for fn in ("get_whatsapp_business_settings", "update_whatsapp_business_settings"):
        head = src[: src.index(f"def {fn}(")].rsplit("@whatsapp_bp", 1)[1]
        assert "require_permissions" in head, fn


def test_hr_v1_endpoints_require_a_session_and_an_hr_grant():
    src = open(os.path.join(ROOT, "modules", "hr", "routes.py"), encoding="utf-8").read()
    assert "@hr_bp.before_request" in src and "hr.read" in src and "Authentication required" in src


def test_patient_lookup_by_umr_is_not_public():
    src = open(os.path.join(ROOT, "modules", "patients", "routes.py"), encoding="utf-8").read()
    head = src[: src.index("def public_patient_by_id(")].rsplit("@patients_bp", 1)[1]
    assert "require_permissions" in head


def test_login_screen_does_not_list_staff():
    src = open(os.path.join(ROOT, "modules", "auth", "routes.py"), encoding="utf-8").read()
    for fn in ("login_role_users", "check_username"):
        head = src[: src.index(f"def {fn}(")].rsplit("@auth_bp", 1)[1]
        assert "require_permissions" in head, fn


def test_changing_credentials_needs_the_current_password():
    src = open(os.path.join(ROOT, "modules", "auth", "routes.py"), encoding="utf-8").read()
    body = src[src.index("def update_credentials("):]
    assert "current_password" in body and "verify_password" in body and "delete_other_sessions" in body


def test_session_carries_the_role_key():
    """A page reload restores the user from the session: without role_key every account looked like plain 'staff'."""
    src = open(os.path.join(ROOT, "core", "auth.py"), encoding="utf-8").read()
    body = src[src.index("def get_session_user("):]
    body = body[: body.index("\ndef ", 10)]
    assert "u.role_key" in body and '"role_key": row["role_key"]' in body


def test_module_lists_cannot_grant_the_administrator_wildcards():
    import sys

    sys.path.insert(0, ROOT)
    from core.auth import normalize_module_access

    assert normalize_module_access(["*", "admin", "patients", "billing.invoices"], "normal") == ["patients", "billing.invoices"]
    assert normalize_module_access(["*"], "normal") == []
    assert normalize_module_access("*,admin", "normal") == []


def test_doctor_status_does_not_depend_on_how_a_username_starts():
    src = open(os.path.join(ROOT, "core", "auth.py"), encoding="utf-8").read()
    assert 'startswith("doc")' not in src and 'startswith("dr.")' not in src and 'startswith("dr_")' not in src
