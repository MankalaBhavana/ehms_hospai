-- Baseline: tables previously created ad hoc by smartrx_pipeline/step2_ingest_db.py.
CREATE TABLE IF NOT EXISTS smartrx.knowledge_sources (
    id SERIAL PRIMARY KEY,
    source_code VARCHAR(100) NOT NULL UNIQUE,
    source_name VARCHAR(255) NOT NULL,
    source_version VARCHAR(100),
    publisher VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS smartrx.substance_master (
    identifier VARCHAR(100) PRIMARY KEY,
    substance_name VARCHAR(500) NOT NULL,
    cas_number VARCHAR(100),
    unii VARCHAR(100),
    description TEXT,
    molecular_weight VARCHAR(50),
    toxicity TEXT,
    smiles TEXT,
    iupac_name TEXT,
    molecular_formula VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_substance_name ON smartrx.substance_master (LOWER(substance_name));

CREATE TABLE IF NOT EXISTS smartrx.generic_master (
    identifier VARCHAR(100) PRIMARY KEY,
    generic_name VARCHAR(500) NOT NULL,
    substance_identifier VARCHAR(500),
    route VARCHAR(255),
    dose_form VARCHAR(255),
    therapeutic_role TEXT,
    indication TEXT,
    contra_indication TEXT,
    drug_interaction TEXT,
    classification TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_generic_name ON smartrx.generic_master (LOWER(generic_name));
CREATE INDEX IF NOT EXISTS idx_generic_substance ON smartrx.generic_master (substance_identifier);

CREATE TABLE IF NOT EXISTS smartrx.lab_test_catalog (
    loinc_code VARCHAR(50) PRIMARY KEY,
    general_name VARCHAR(500) NOT NULL,
    fsn_name TEXT,
    long_common_name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lab_name ON smartrx.lab_test_catalog (LOWER(general_name));

CREATE TABLE IF NOT EXISTS smartrx.nlem_catalog (
    id SERIAL PRIMARY KEY,
    category VARCHAR(255),
    medicine_name VARCHAR(255) NOT NULL,
    level VARCHAR(50),
    form_strength TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_nlem_name ON smartrx.nlem_catalog (LOWER(medicine_name));

CREATE TABLE IF NOT EXISTS smartrx.clinical_rules (
    id SERIAL PRIMARY KEY,
    drug_name VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL,
    parameter VARCHAR(100) NOT NULL,
    operator VARCHAR(20) NOT NULL,
    threshold VARCHAR(100) NOT NULL,
    unit VARCHAR(50),
    severity VARCHAR(50) NOT NULL DEFAULT 'warning',
    is_blocking BOOLEAN NOT NULL DEFAULT FALSE,
    message TEXT NOT NULL,
    recommendation TEXT,
    source TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rules_drug ON smartrx.clinical_rules (LOWER(drug_name));

CREATE TABLE IF NOT EXISTS smartrx.medication_catalog_items (
    id SERIAL PRIMARY KEY,
    brand_identifier VARCHAR(100) NOT NULL UNIQUE,
    brand_name VARCHAR(500) NOT NULL,
    generic_identifier VARCHAR(100),
    generic_name VARCHAR(500),
    substance_identifiers VARCHAR(500),
    dose_form VARCHAR(255),
    route VARCHAR(255),
    nlem_level VARCHAR(50),
    is_high_alert BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_catalog_search ON smartrx.medication_catalog_items
    USING gin (to_tsvector('simple', brand_name || ' ' || COALESCE(generic_name, '')));
CREATE INDEX IF NOT EXISTS idx_catalog_brand ON smartrx.medication_catalog_items (LOWER(brand_name));
CREATE INDEX IF NOT EXISTS idx_catalog_generic ON smartrx.medication_catalog_items (LOWER(generic_name));
