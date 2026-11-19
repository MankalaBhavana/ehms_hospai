"""Hospital mailbox for the insurance desk: send to insurers / TPAs over SMTP and pull their
replies over IMAP into the matching insurance case.

Privacy rules:
  * the mailbox password is stored encrypted (Fernet, key derived from SESSION_PEPPER) and is
    never returned by any endpoint;
  * the inbox is read-only and only messages that belong to a case are kept: a message is
    stored only if its subject carries a case tag like [CLM-2026-E12345] or it replies to a
    message this system sent. Everything else is counted and ignored, never saved.
"""
import base64
import email
import hashlib
import imaplib
import json
import os
import re
import smtplib
import ssl
from email import policy
from email.message import EmailMessage
from email.utils import formatdate, make_msgid, parsedate_to_datetime

from cryptography.fernet import Fernet, InvalidToken
from flask import g, jsonify, request

from shared.audit import log_audit_event
from shared.hospital import current_hospital_id
from shared.session_auth import require_permissions
from utils.database import get_connection

CASE_TAG = re.compile(r"\[(CLM-[A-Za-z0-9-]+)\]")
MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024
_ready = False


# ---------------------------------------------------------------- storage
def ensure_mail_tables():
    global _ready
    if _ready:
        return
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS insurance_mail_settings (
                hospital_id INTEGER PRIMARY KEY,
                config JSONB NOT NULL,
                password_enc TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_by TEXT
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS insurance_mails (
                id BIGSERIAL PRIMARY KEY,
                hospital_id INTEGER NOT NULL,
                case_id TEXT NOT NULL,
                direction TEXT NOT NULL,
                message_id TEXT NOT NULL,
                in_reply_to TEXT,
                from_addr TEXT,
                to_addr TEXT,
                cc_addr TEXT,
                subject TEXT,
                body TEXT,
                attachments JSONB,
                sent_at TIMESTAMP,
                created_by TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (hospital_id, message_id)
            )
            """
        )
        cur.execute("CREATE INDEX IF NOT EXISTS ix_ins_mail_case ON insurance_mails (hospital_id, case_id)")
        conn.commit()
    _ready = True


def _fernet():
    pepper = (os.getenv("SESSION_PEPPER") or "dev-only-pepper").encode()
    key = base64.urlsafe_b64encode(hashlib.sha256(b"insurance-mail|" + pepper).digest())
    return Fernet(key)


def _encrypt(plain):
    return _fernet().encrypt(plain.encode()).decode()


def _decrypt(token):
    try:
        return _fernet().decrypt(token.encode()).decode()
    except (InvalidToken, AttributeError):
        return ""


def _load_settings(hospital_id):
    ensure_mail_tables()
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT config, password_enc FROM insurance_mail_settings WHERE hospital_id = ?", (hospital_id,))
        row = cur.fetchone()
    if not row:
        return None, ""
    cfg = row[0] if isinstance(row[0], dict) else json.loads(row[0])
    return cfg, _decrypt(row[1] or "")


def _public(cfg, has_password):
    if not cfg:
        return {"configured": False}
    return {
        "configured": True,
        "fromAddress": cfg.get("fromAddress"),
        "fromName": cfg.get("fromName"),
        "username": cfg.get("username"),
        "smtpHost": cfg.get("smtpHost"),
        "smtpPort": cfg.get("smtpPort"),
        "smtpSecurity": cfg.get("smtpSecurity"),
        "imapHost": cfg.get("imapHost"),
        "imapPort": cfg.get("imapPort"),
        "imapSecurity": cfg.get("imapSecurity"),
        "imapFolder": cfg.get("imapFolder", "INBOX"),
        "passwordSet": bool(has_password),
        "lastTest": cfg.get("lastTest"),
    }


# ---------------------------------------------------------------- SMTP / IMAP
def _smtp_connect(cfg, password):
    host, port = cfg["smtpHost"], int(cfg.get("smtpPort") or 587)
    security = (cfg.get("smtpSecurity") or "starttls").lower()
    ctx = ssl.create_default_context()
    if security == "ssl":
        server = smtplib.SMTP_SSL(host, port, timeout=20, context=ctx)
    else:
        server = smtplib.SMTP(host, port, timeout=20)
        server.ehlo()
        if security == "starttls":
            server.starttls(context=ctx)
            server.ehlo()
    if cfg.get("username") and password:
        server.login(cfg["username"], password)
    return server


def _imap_connect(cfg, password):
    host, port = cfg["imapHost"], int(cfg.get("imapPort") or 993)
    security = (cfg.get("imapSecurity") or "ssl").lower()
    if security == "ssl":
        box = imaplib.IMAP4_SSL(host, port, ssl_context=ssl.create_default_context(), timeout=20)
    else:
        box = imaplib.IMAP4(host, port, timeout=20)
        if security == "starttls":
            box.starttls(ssl.create_default_context())
    box.login(cfg.get("username") or cfg["fromAddress"], password)
    return box


def _body_text(msg):
    part = msg.get_body(preferencelist=("plain", "html"))
    if part is None:
        return ""
    text = part.get_content()
    if part.get_content_type() == "text/html":
        text = re.sub(r"<(script|style).*?</\1>", "", text, flags=re.S | re.I)
        text = re.sub(r"<br\s*/?>|</p>|</div>", "\n", text, flags=re.I)
        text = re.sub(r"<[^>]+>", "", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def parse_inbound(raw_bytes, known_outbound_ids):
    """Turn one raw RFC822 message into a record, or None when it does not belong to a case."""
    msg = email.message_from_bytes(raw_bytes, policy=policy.default)
    subject = str(msg.get("Subject") or "")
    refs = " ".join(filter(None, [str(msg.get("In-Reply-To") or ""), str(msg.get("References") or "")]))
    case_id = None
    tag = CASE_TAG.search(subject)
    if tag:
        case_id = tag.group(1)
    else:
        for mid in re.findall(r"<[^>]+>", refs):
            if mid in known_outbound_ids:
                case_id = known_outbound_ids[mid]
                break
    if not case_id:
        return None
    try:
        sent_at = parsedate_to_datetime(str(msg.get("Date"))).replace(tzinfo=None)
    except Exception:
        sent_at = None
    return {
        "case_id": case_id,
        "message_id": str(msg.get("Message-ID") or "").strip() or "<noid-%s>" % hashlib.sha1(raw_bytes).hexdigest(),
        "in_reply_to": str(msg.get("In-Reply-To") or "").strip() or None,
        "from": str(msg.get("From") or ""),
        "to": str(msg.get("To") or ""),
        "cc": str(msg.get("Cc") or ""),
        "subject": subject,
        "body": _body_text(msg),
        "attachments": [a.get_filename() or "attachment" for a in msg.iter_attachments()],
        "sent_at": sent_at,
    }


def _actor():
    return (getattr(g, "current_user", None) or {}).get("username")


def _row_to_mail(r):
    d = dict(r)
    return {
        "id": d["message_id"],
        "caseId": d["case_id"],
        "direction": d["direction"],
        "from": d["from_addr"],
        "to": d["to_addr"],
        "cc": d["cc_addr"],
        "subject": d["subject"],
        "body": d["body"],
        "attachments": d["attachments"] if isinstance(d["attachments"], list) else json.loads(d["attachments"] or "[]"),
        "at": d["sent_at"].isoformat() if d.get("sent_at") else None,
        "by": d.get("created_by"),
    }


# ---------------------------------------------------------------- routes
def register_mail_routes(bp):
    @bp.get("/api/insurance-mail/settings")
    @require_permissions("billing.read")
    def mail_settings_get():
        cfg, pw = _load_settings(current_hospital_id())
        return jsonify(_public(cfg, bool(pw)))

    @bp.put("/api/insurance-mail/settings")
    @require_permissions("billing.claims.write")
    def mail_settings_put():
        body = request.get_json(force=True, silent=True) or {}
        required = ["fromAddress", "smtpHost"]
        missing = [k for k in required if not str(body.get(k) or "").strip()]
        if missing:
            return jsonify({"error": "Required: " + ", ".join(missing)}), 400
        if not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", body["fromAddress"].strip()):
            return jsonify({"error": "From address is not a valid email address"}), 400
        hospital_id = current_hospital_id()
        old_cfg, old_pw = _load_settings(hospital_id)
        cfg = {
            "fromAddress": body["fromAddress"].strip(),
            "fromName": (body.get("fromName") or "Insurance Desk").strip(),
            # Omitted -> the from address; explicitly blank -> no login (internal relay).
            "username": (str(body["username"]).strip() if "username" in body else body["fromAddress"].strip()),
            "smtpHost": body["smtpHost"].strip(),
            "smtpPort": int(body.get("smtpPort") or 587),
            "smtpSecurity": (body.get("smtpSecurity") or "starttls").lower(),
            "imapHost": (body.get("imapHost") or "").strip(),
            "imapPort": int(body.get("imapPort") or 993),
            "imapSecurity": (body.get("imapSecurity") or "ssl").lower(),
            "imapFolder": (body.get("imapFolder") or "INBOX").strip(),
        }
        if cfg["smtpSecurity"] not in ("ssl", "starttls", "none") or cfg["imapSecurity"] not in ("ssl", "starttls", "none"):
            return jsonify({"error": "security must be ssl, starttls or none"}), 400
        new_pw = body.get("password")
        password = new_pw if new_pw else old_pw  # blank keeps the stored password
        ensure_mail_tables()
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                """INSERT INTO insurance_mail_settings (hospital_id, config, password_enc, updated_by)
                   VALUES (?, ?::jsonb, ?, ?)
                   ON CONFLICT (hospital_id) DO UPDATE
                   SET config = EXCLUDED.config, password_enc = EXCLUDED.password_enc,
                       updated_at = CURRENT_TIMESTAMP, updated_by = EXCLUDED.updated_by""",
                (hospital_id, json.dumps(cfg), _encrypt(password) if password else None, _actor()),
            )
            conn.commit()
        log_audit_event("update", "insurance_mail_settings", str(hospital_id), {"host": cfg["smtpHost"], "from": cfg["fromAddress"]})
        return jsonify(_public(cfg, bool(password)))

    @bp.post("/api/insurance-mail/test")
    @require_permissions("billing.claims.write")
    def mail_test():
        """Checks the saved settings: SMTP login, and IMAP login if an IMAP host is set. Sends nothing."""
        hospital_id = current_hospital_id()
        cfg, password = _load_settings(hospital_id)
        if not cfg:
            return jsonify({"error": "Save the mailbox settings first"}), 400
        result = {"smtp": {"ok": False}, "imap": {"ok": None}}
        try:
            server = _smtp_connect(cfg, password)
            server.quit()
            result["smtp"] = {"ok": True}
        except Exception as e:  # noqa: BLE001 - report any connection problem to the user
            result["smtp"] = {"ok": False, "error": str(e)[:300]}
        if cfg.get("imapHost"):
            try:
                box = _imap_connect(cfg, password)
                status, _ = box.select(cfg.get("imapFolder") or "INBOX", readonly=True)
                box.logout()
                result["imap"] = {"ok": status == "OK"}
            except Exception as e:  # noqa: BLE001
                result["imap"] = {"ok": False, "error": str(e)[:300]}
        # Optionally prove delivery end to end by sending a short test message to an address.
        test_to = str((request.get_json(silent=True) or {}).get("to") or "").strip()
        if test_to and result["smtp"]["ok"]:
            if not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", test_to):
                result["smtp"] = {"ok": False, "error": "The test address is not a valid email address"}
            else:
                try:
                    msg = EmailMessage()
                    msg["From"] = '"%s" <%s>' % (cfg.get("fromName") or "Insurance Desk", cfg["fromAddress"])
                    msg["To"] = test_to
                    msg["Subject"] = "Test email from the hospital insurance desk"
                    msg["Date"] = formatdate(localtime=False)
                    msg["Message-ID"] = make_msgid(domain=cfg["fromAddress"].split("@")[-1])
                    msg.set_content("This is a test message. The insurance mailbox is linked and can send email.")
                    server = _smtp_connect(cfg, password)
                    try:
                        server.send_message(msg, to_addrs=[test_to])
                    finally:
                        server.quit()
                    result["testSent"] = test_to
                except Exception as e:  # noqa: BLE001
                    result["smtp"] = {"ok": False, "error": "Connected, but the test email was refused: %s" % str(e)[:300]}
        cfg["lastTest"] = {"at": formatdate(localtime=False), "smtp": result["smtp"]["ok"], "imap": result["imap"]["ok"]}
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute("UPDATE insurance_mail_settings SET config = ?::jsonb WHERE hospital_id = ?", (json.dumps(cfg), hospital_id))
            conn.commit()
        return jsonify(result)

    @bp.post("/api/insurance-mail/send")
    @require_permissions("billing.claims.write")
    def mail_send():
        body = request.get_json(force=True, silent=True) or {}
        case_id = str(body.get("caseId") or "").strip()
        to = [a.strip() for a in re.split(r"[;,]", str(body.get("to") or "")) if a.strip()]
        cc = [a.strip() for a in re.split(r"[;,]", str(body.get("cc") or "")) if a.strip()]
        subject = str(body.get("subject") or "").strip()
        text = str(body.get("body") or "")
        if not case_id or not CASE_TAG.fullmatch("[" + case_id + "]"):
            return jsonify({"error": "caseId is required (like CLM-2026-12345)"}), 400
        addr = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
        if not to or not all(addr.match(a) for a in to + cc):
            return jsonify({"error": "Enter valid recipient email addresses"}), 400
        if not subject or not text.strip():
            return jsonify({"error": "Subject and message are required"}), 400
        hospital_id = current_hospital_id()
        cfg, password = _load_settings(hospital_id)
        if not cfg:
            return jsonify({"error": "The hospital mailbox is not connected"}), 409
        # The case tag is what lets the insurer's reply find its way back to this case.
        if "[" + case_id + "]" not in subject:
            subject = "[%s] %s" % (case_id, subject)
        msg = EmailMessage()
        msg["From"] = '"%s" <%s>' % (cfg.get("fromName") or "Insurance Desk", cfg["fromAddress"])
        msg["To"] = ", ".join(to)
        if cc:
            msg["Cc"] = ", ".join(cc)
        msg["Subject"] = subject
        msg["Date"] = formatdate(localtime=False)
        domain = cfg["fromAddress"].split("@")[-1]
        message_id = make_msgid(domain=domain)
        msg["Message-ID"] = message_id
        msg["X-HospAI-Case"] = case_id
        msg.set_content(text)
        total, names = 0, []
        for att in body.get("attachments") or []:
            try:
                data = base64.b64decode(att.get("contentBase64") or "", validate=True)
            except Exception:  # noqa: BLE001
                return jsonify({"error": "Attachment %s is not valid" % att.get("name")}), 400
            total += len(data)
            if total > MAX_ATTACHMENT_BYTES:
                return jsonify({"error": "Attachments are over 15 MB in total"}), 413
            name = os.path.basename(str(att.get("name") or "attachment"))
            ctype = str(att.get("type") or "application/octet-stream")
            maintype, _, subtype = ctype.partition("/")
            msg.add_attachment(data, maintype=maintype or "application", subtype=subtype or "octet-stream", filename=name)
            names.append(name)
        try:
            server = _smtp_connect(cfg, password)
            try:
                server.send_message(msg, to_addrs=to + cc)
            finally:
                server.quit()
        except Exception as e:  # noqa: BLE001
            return jsonify({"error": "The mail server refused the message: %s" % str(e)[:300]}), 502
        ensure_mail_tables()
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                """INSERT INTO insurance_mails
                   (hospital_id, case_id, direction, message_id, from_addr, to_addr, cc_addr, subject, body, attachments, sent_at, created_by)
                   VALUES (?, ?, 'out', ?, ?, ?, ?, ?, ?, ?::jsonb, CURRENT_TIMESTAMP, ?)
                   ON CONFLICT (hospital_id, message_id) DO NOTHING""",
                (hospital_id, case_id, message_id, cfg["fromAddress"], ", ".join(to), ", ".join(cc), subject, text, json.dumps(names), _actor()),
            )
            conn.commit()
        log_audit_event("send", "insurance_mail", case_id, {"to": to, "subject": subject, "attachments": names})
        return jsonify({"ok": True, "messageId": message_id, "subject": subject, "from": cfg["fromAddress"], "attachments": names})

    @bp.post("/api/insurance-mail/sync")
    @require_permissions("billing.claims.write")
    def mail_sync():
        """Read the inbox (read-only) and keep only replies that belong to an insurance case."""
        hospital_id = current_hospital_id()
        cfg, password = _load_settings(hospital_id)
        if not cfg or not cfg.get("imapHost"):
            return jsonify({"error": "Add the IMAP server in the mailbox settings to receive replies"}), 409
        days = max(1, min(60, int((request.get_json(silent=True) or {}).get("days") or 14)))
        ensure_mail_tables()
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT message_id, case_id FROM insurance_mails WHERE hospital_id = ? AND direction = 'out'", (hospital_id,))
            outbound = {r[0]: r[1] for r in cur.fetchall()}
            cur.execute("SELECT message_id FROM insurance_mails WHERE hospital_id = ?", (hospital_id,))
            have = {r[0] for r in cur.fetchall()}
        scanned = ignored = 0
        new_rows = []
        try:
            box = _imap_connect(cfg, password)
            box.select(cfg.get("imapFolder") or "INBOX", readonly=True)
            since = (__import__("datetime").date.today() - __import__("datetime").timedelta(days=days)).strftime("%d-%b-%Y")
            status, data = box.search(None, "SINCE", since)
            ids = (data[0].split() if status == "OK" and data and data[0] else [])[-200:]
            for num in ids:
                status, parts = box.fetch(num, "(BODY.PEEK[])")  # PEEK: never marks mail as read
                if status != "OK" or not parts or not isinstance(parts[0], tuple):
                    continue
                scanned += 1
                rec = parse_inbound(parts[0][1], outbound)
                if not rec:
                    ignored += 1
                    continue
                if rec["message_id"] in have:
                    continue
                new_rows.append(rec)
                have.add(rec["message_id"])
            box.logout()
        except Exception as e:  # noqa: BLE001
            return jsonify({"error": "Could not read the mailbox: %s" % str(e)[:300]}), 502
        saved = []
        if new_rows:
            with get_connection() as conn:
                cur = conn.cursor()
                for r in new_rows:
                    cur.execute(
                        """INSERT INTO insurance_mails
                           (hospital_id, case_id, direction, message_id, in_reply_to, from_addr, to_addr, cc_addr, subject, body, attachments, sent_at, created_by)
                           VALUES (?, ?, 'in', ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, 'mailbox-sync')
                           ON CONFLICT (hospital_id, message_id) DO NOTHING""",
                        (hospital_id, r["case_id"], r["message_id"], r["in_reply_to"], r["from"], r["to"], r["cc"],
                         r["subject"], r["body"], json.dumps(r["attachments"]), r["sent_at"]),
                    )
                    saved.append({"id": r["message_id"], "caseId": r["case_id"], "from": r["from"], "subject": r["subject"],
                                  "body": r["body"], "attachments": r["attachments"], "at": r["sent_at"].isoformat() if r["sent_at"] else None})
                conn.commit()
        log_audit_event("sync", "insurance_mail", None, {"scanned": scanned, "new": len(saved), "ignored": ignored})
        return jsonify({"scanned": scanned, "ignored": ignored, "new": saved})

    @bp.get("/api/insurance-mail/messages")
    @require_permissions("billing.read")
    def mail_messages():
        case_id = request.args.get("caseId")
        ensure_mail_tables()
        clauses, params = ["hospital_id = ?"], [current_hospital_id()]
        if case_id:
            clauses.append("case_id = ?")
            params.append(case_id)
        with get_connection() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT * FROM insurance_mails WHERE %s ORDER BY COALESCE(sent_at, created_at) DESC LIMIT 500" % " AND ".join(clauses),
                tuple(params),
            )
            rows = cur.fetchall()
        return jsonify({"messages": [_row_to_mail(r) for r in rows]})
