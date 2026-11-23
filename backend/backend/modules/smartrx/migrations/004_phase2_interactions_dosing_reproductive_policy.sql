-- Phase 2: drug-drug interactions, dose limits, pregnancy/lactation, antibiotic policy, hospital formulary.
-- Global knowledge tables are reloaded by the ingest pipeline; hospital_* tables hold runtime data and are never truncated.

CREATE TABLE IF NOT EXISTS smartrx.drug_interaction (
    id SERIAL PRIMARY KEY,
    a_kind VARCHAR(10) NOT NULL CHECK (a_kind IN ('substance','class')),
    a_ref VARCHAR(100) NOT NULL,
    b_kind VARCHAR(10) NOT NULL CHECK (b_kind IN ('substance','class')),
    b_ref VARCHAR(100) NOT NULL,
    severity VARCHAR(10) NOT NULL CHECK (severity IN ('critical','warning','info')),
    mechanism TEXT,
    message TEXT NOT NULL,
    recommendation TEXT,
    source TEXT,
    evidence VARCHAR(20) NOT NULL DEFAULT 'curated' CHECK (evidence IN ('curated','label_text')),
    evidence_excerpt TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','retired')),
    reviewed_by VARCHAR(200),
    reviewed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_interaction_a ON smartrx.drug_interaction (a_kind, a_ref);
CREATE INDEX IF NOT EXISTS idx_interaction_b ON smartrx.drug_interaction (b_kind, b_ref);

CREATE TABLE IF NOT EXISTS smartrx.dose_limit (
    id SERIAL PRIMARY KEY,
    moiety_identifier VARCHAR(100) NOT NULL,
    population VARCHAR(10) NOT NULL CHECK (population IN ('adult','child')),
    max_single_mg NUMERIC,
    max_daily_mg NUMERIC,
    max_mg_per_kg_day NUMERIC,
    max_doses_per_week NUMERIC,
    note TEXT,
    source TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','retired')),
    reviewed_by VARCHAR(200),
    reviewed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_dose_limit_moiety ON smartrx.dose_limit (moiety_identifier);

CREATE TABLE IF NOT EXISTS smartrx.reproductive_risk (
    id SERIAL PRIMARY KEY,
    target_kind VARCHAR(10) NOT NULL CHECK (target_kind IN ('substance','class')),
    target_ref VARCHAR(100) NOT NULL,
    context VARCHAR(10) NOT NULL CHECK (context IN ('pregnancy','lactation')),
    severity VARCHAR(10) NOT NULL CHECK (severity IN ('critical','warning','info')),
    message TEXT NOT NULL,
    recommendation TEXT,
    source TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','retired')),
    reviewed_by VARCHAR(200),
    reviewed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_repro_target ON smartrx.reproductive_risk (target_kind, target_ref);

-- Antibiotic stewardship tiers. hospital_id NULL = global default; a hospital row overrides it for that hospital.
CREATE TABLE IF NOT EXISTS smartrx.antibiotic_policy (
    id SERIAL PRIMARY KEY,
    hospital_id INTEGER,
    moiety_identifier VARCHAR(100) NOT NULL,
    tier VARCHAR(10) NOT NULL CHECK (tier IN ('access','watch','reserve','unrestricted')),
    restricted_to TEXT,
    requires_justification BOOLEAN NOT NULL DEFAULT TRUE,
    message TEXT,
    source TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','retired')),
    updated_by VARCHAR(200),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_antibiotic_policy ON smartrx.antibiotic_policy (COALESCE(hospital_id, 0), moiety_identifier);

-- Per-hospital formulary overrides (runtime data).
CREATE TABLE IF NOT EXISTS smartrx.hospital_formulary (
    id SERIAL PRIMARY KEY,
    hospital_id INTEGER NOT NULL,
    moiety_identifier VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('formulary','restricted','non_formulary')),
    note TEXT,
    alternative TEXT,
    updated_by VARCHAR(200),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (hospital_id, moiety_identifier)
);
