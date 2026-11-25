-- Clinical audit trail: what the engine showed, and what the prescriber did about critical alerts.
-- Holds identifiers and alert metadata only: no names, allergies, lab values or free-text prescription content.

CREATE TABLE IF NOT EXISTS smartrx.evaluation_log (
    id BIGSERIAL PRIMARY KEY,
    evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    hospital_id INTEGER,
    user_id TEXT,
    patient_id TEXT,
    encounter_id TEXT,
    rule_set_version VARCHAR(40),
    engine_version VARCHAR(20),
    check_status VARCHAR(12),
    item_count INTEGER NOT NULL DEFAULT 0,
    alert_count INTEGER NOT NULL DEFAULT 0,
    critical_count INTEGER NOT NULL DEFAULT 0,
    warning_count INTEGER NOT NULL DEFAULT 0,
    alerts JSONB NOT NULL DEFAULT '[]'::jsonb,        -- [{id, check, severity, drug_name, provenance, source_ref}]
    input_sha256 VARCHAR(64)
);
CREATE INDEX IF NOT EXISTS idx_eval_log_patient ON smartrx.evaluation_log (hospital_id, patient_id, evaluated_at DESC);

CREATE TABLE IF NOT EXISTS smartrx.alert_override (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    hospital_id INTEGER,
    user_id TEXT,
    user_name TEXT,
    patient_id TEXT NOT NULL,
    encounter_id TEXT,
    alert_id VARCHAR(160) NOT NULL,
    check_name VARCHAR(30),
    severity VARCHAR(10),
    drug_name VARCHAR(300),
    rule_set_version VARCHAR(40),
    reason_code VARCHAR(40) NOT NULL,
    reason_text VARCHAR(500)
);
CREATE INDEX IF NOT EXISTS idx_alert_override_patient ON smartrx.alert_override (hospital_id, patient_id, encounter_id, created_at DESC);
