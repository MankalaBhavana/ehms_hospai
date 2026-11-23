-- Step 1 of the guideline-sourcing plan: every piece of clinical advice must carry a citation.
--   unsourced       never active (not even in shadow mode); a worklist item only
--   cited           has a source citation (legacy / label-level) but the quote is not yet verified against the document
--   verified        exact source + page + verbatim quote, extracted and approved by two different people
--   hospital_policy hospital-authored rule (antibiotic_policy rows with a hospital_id)

-- Register of guideline documents (loaded from HospAI_Clinical_Knowledge/Source_Log.csv by the ingest).
CREATE TABLE IF NOT EXISTS smartrx.guideline_source (
    source_id VARCHAR(40) PRIMARY KEY,
    source_name TEXT NOT NULL,
    publisher TEXT,
    url TEXT,
    version_or_date VARCHAR(100),
    downloaded_on VARCHAR(30),
    filename TEXT,
    sha256 VARCHAR(64),
    licence TEXT
);

ALTER TABLE smartrx.antibiotic_policy ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(200);
ALTER TABLE smartrx.antibiotic_policy ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE smartrx.clinical_rules ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(200);

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['clinical_rules','cross_reactivity','drug_interaction','dose_limit',
                             'reproductive_risk','antibiotic_policy','drug_class']
    LOOP
        EXECUTE format('ALTER TABLE smartrx.%I ADD COLUMN IF NOT EXISTS provenance VARCHAR(16) NOT NULL DEFAULT ''unsourced''', t);
        EXECUTE format('ALTER TABLE smartrx.%I ADD COLUMN IF NOT EXISTS source_id VARCHAR(40)', t);
        EXECUTE format('ALTER TABLE smartrx.%I ADD COLUMN IF NOT EXISTS source_page VARCHAR(40)', t);
        EXECUTE format('ALTER TABLE smartrx.%I ADD COLUMN IF NOT EXISTS source_section TEXT', t);
        EXECUTE format('ALTER TABLE smartrx.%I ADD COLUMN IF NOT EXISTS source_quote TEXT', t);
        EXECUTE format('ALTER TABLE smartrx.%I ADD COLUMN IF NOT EXISTS extracted_by VARCHAR(200)', t);
        EXECUTE format('ALTER TABLE smartrx.%I ADD COLUMN IF NOT EXISTS approved_by VARCHAR(200)', t);
        EXECUTE format('ALTER TABLE smartrx.%I ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ', t);
    END LOOP;
END $$;

-- Rows that were already approved before this migration carry a section-level citation from the original data
-- (clinical_rules.source). They stay active but are explicitly NOT verified.
UPDATE smartrx.clinical_rules SET provenance = 'cited' WHERE provenance = 'unsourced' AND COALESCE(source, '') <> '';
UPDATE smartrx.antibiotic_policy SET provenance = 'hospital_policy' WHERE hospital_id IS NOT NULL;
-- Anything else approved without a citation is demoted to draft.
UPDATE smartrx.cross_reactivity SET status = 'draft' WHERE status = 'approved' AND provenance = 'unsourced';
UPDATE smartrx.drug_interaction SET status = 'draft' WHERE status = 'approved' AND provenance = 'unsourced';
UPDATE smartrx.dose_limit SET status = 'draft' WHERE status = 'approved' AND provenance = 'unsourced';
UPDATE smartrx.reproductive_risk SET status = 'draft' WHERE status = 'approved' AND provenance = 'unsourced';
UPDATE smartrx.antibiotic_policy SET status = 'draft' WHERE status = 'approved' AND provenance = 'unsourced';
UPDATE smartrx.clinical_rules SET status = 'draft' WHERE status = 'approved' AND provenance = 'unsourced';

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['clinical_rules','cross_reactivity','drug_interaction','dose_limit',
                             'reproductive_risk','antibiotic_policy','drug_class']
    LOOP
        EXECUTE format($f$ALTER TABLE smartrx.%I ADD CONSTRAINT %I CHECK (provenance IN ('unsourced','cited','verified','hospital_policy'))$f$,
                       t, 'chk_' || t || '_prov_values');
        EXECUTE format($f$ALTER TABLE smartrx.%I ADD CONSTRAINT %I CHECK (provenance <> 'verified' OR (
                           source_id IS NOT NULL AND source_page IS NOT NULL AND source_quote IS NOT NULL AND
                           reviewed_by IS NOT NULL AND approved_by IS NOT NULL AND reviewed_by <> approved_by))$f$,
                       t, 'chk_' || t || '_prov_verified');
    END LOOP;
    -- Clinical advice can never be approved without a citation. (drug_class is taxonomy; it is reported, not blocked.)
    FOREACH t IN ARRAY ARRAY['clinical_rules','cross_reactivity','drug_interaction','dose_limit',
                             'reproductive_risk','antibiotic_policy']
    LOOP
        EXECUTE format($f$ALTER TABLE smartrx.%I ADD CONSTRAINT %I CHECK (status <> 'approved' OR provenance <> 'unsourced')$f$,
                       t, 'chk_' || t || '_approved_needs_source');
    END LOOP;
END $$;
ALTER TABLE smartrx.antibiotic_policy ADD CONSTRAINT chk_antibiotic_policy_hospital_prov
    CHECK (provenance <> 'hospital_policy' OR hospital_id IS NOT NULL);
