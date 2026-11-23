-- Phase 1: moiety-level matching, drug classes, structured allergies, typed rules, rule-set versioning.

-- Moiety = the active ingredient with salt/hydrate forms folded in (amoxicillin trihydrate -> amoxicillin).
ALTER TABLE smartrx.substance_master ADD COLUMN IF NOT EXISTS moiety_identifier VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_substance_moiety ON smartrx.substance_master (moiety_identifier);

ALTER TABLE smartrx.medication_catalog_items ADD COLUMN IF NOT EXISTS moiety_identifiers VARCHAR(500);
ALTER TABLE smartrx.medication_catalog_items ADD COLUMN IF NOT EXISTS route_hint VARCHAR(50);
ALTER TABLE smartrx.medication_catalog_items ADD COLUMN IF NOT EXISTS name_norm TEXT;
CREATE INDEX IF NOT EXISTS idx_catalog_name_norm ON smartrx.medication_catalog_items (name_norm text_pattern_ops);

-- Drug classes (allergy classes, therapeutic groups). Members are moiety identifiers.
CREATE TABLE IF NOT EXISTS smartrx.drug_class (
    class_code VARCHAR(60) PRIMARY KEY,
    class_name VARCHAR(200) NOT NULL,
    kind VARCHAR(30) NOT NULL DEFAULT 'allergy',
    source TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','retired')),
    reviewed_by VARCHAR(200),
    reviewed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS smartrx.drug_class_alias (
    class_code VARCHAR(60) NOT NULL REFERENCES smartrx.drug_class(class_code) ON DELETE CASCADE,
    alias VARCHAR(120) NOT NULL,
    PRIMARY KEY (class_code, alias)
);
CREATE INDEX IF NOT EXISTS idx_class_alias ON smartrx.drug_class_alias (alias);
CREATE TABLE IF NOT EXISTS smartrx.drug_class_member (
    class_code VARCHAR(60) NOT NULL REFERENCES smartrx.drug_class(class_code) ON DELETE CASCADE,
    moiety_identifier VARCHAR(100) NOT NULL,
    PRIMARY KEY (class_code, moiety_identifier)
);
CREATE INDEX IF NOT EXISTS idx_class_member_moiety ON smartrx.drug_class_member (moiety_identifier);

CREATE TABLE IF NOT EXISTS smartrx.cross_reactivity (
    id SERIAL PRIMARY KEY,
    from_class VARCHAR(60) NOT NULL REFERENCES smartrx.drug_class(class_code) ON DELETE CASCADE,
    to_class VARCHAR(60) NOT NULL REFERENCES smartrx.drug_class(class_code) ON DELETE CASCADE,
    severity VARCHAR(20) NOT NULL DEFAULT 'warning',
    message TEXT NOT NULL,
    recommendation TEXT,
    source TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','retired')),
    reviewed_by VARCHAR(200),
    reviewed_at TIMESTAMPTZ
);

-- Structured patient allergies (replaces matching on free text).
CREATE TABLE IF NOT EXISTS smartrx.patient_allergy (
    id BIGSERIAL PRIMARY KEY,
    hospital_id INTEGER,
    patient_id TEXT NOT NULL,
    allergen_kind VARCHAR(12) NOT NULL CHECK (allergen_kind IN ('substance','class','unmapped')),
    allergen_code VARCHAR(100),
    allergen_text VARCHAR(300) NOT NULL,
    reaction VARCHAR(300),
    severity VARCHAR(10) NOT NULL DEFAULT 'unknown' CHECK (severity IN ('mild','moderate','severe','unknown')),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','entered_in_error')),
    source VARCHAR(40) NOT NULL DEFAULT 'manual',
    recorded_by VARCHAR(200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (allergen_kind = 'unmapped' OR allergen_code IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_patient_allergy_lookup ON smartrx.patient_allergy (hospital_id, patient_id, status);
-- One active entry per patient and allergen; re-adding the same allergen updates it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_patient_allergy_active
    ON smartrx.patient_allergy (COALESCE(hospital_id, 0), patient_id, allergen_kind, COALESCE(allergen_code, LOWER(allergen_text)))
    WHERE status = 'active';

-- Rules: typed, tied to moieties, individually reviewable.
ALTER TABLE smartrx.clinical_rules ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'approved';
ALTER TABLE smartrx.clinical_rules ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(200);
ALTER TABLE smartrx.clinical_rules ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS smartrx.rule_moiety (
    rule_id INTEGER NOT NULL REFERENCES smartrx.clinical_rules(id) ON DELETE CASCADE,
    moiety_identifier VARCHAR(100) NOT NULL,
    PRIMARY KEY (rule_id, moiety_identifier)
);
CREATE INDEX IF NOT EXISTS idx_rule_moiety ON smartrx.rule_moiety (moiety_identifier);

-- Single-row pointer to the loaded knowledge version; changes whenever rules/classes change.
CREATE TABLE IF NOT EXISTS smartrx.rule_set_state (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    version VARCHAR(40) NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    built_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes TEXT
);
