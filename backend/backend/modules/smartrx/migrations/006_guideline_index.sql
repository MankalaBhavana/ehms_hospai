-- Step 2 of guideline sourcing: a page-level text index of every registered guideline document.
-- Used to (a) find the passages a reviewer needs and (b) mechanically verify that a cited quote really appears on the cited page.

CREATE TABLE IF NOT EXISTS smartrx.guideline_document (
    source_id VARCHAR(40) PRIMARY KEY,
    file_sha256 VARCHAR(64) NOT NULL,
    hash_matches_log BOOLEAN,                 -- file on disk equals the hash recorded in Source_Log.csv
    pages INTEGER NOT NULL,
    text_pages INTEGER NOT NULL DEFAULT 0,    -- pages with a real text layer (or structured text for html/nxml)
    ocr_pages INTEGER NOT NULL DEFAULT 0,     -- pages recovered by OCR (lower trust)
    empty_pages INTEGER NOT NULL DEFAULT 0,   -- pages with no usable text (OCR pending or blank)
    status VARCHAR(10) NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','partial','error')),
    error TEXT,
    extractor_version VARCHAR(20) NOT NULL,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS smartrx.guideline_passage (
    source_id VARCHAR(40) NOT NULL,
    page VARCHAR(60) NOT NULL,                -- '12' for PDFs; a record id (e.g. 'LM416') for LactMed
    method VARCHAR(8) NOT NULL CHECK (method IN ('text','ocr','html','nxml','none')),
    text TEXT NOT NULL,
    char_count INTEGER NOT NULL,
    text_sha256 VARCHAR(64) NOT NULL,
    ocr_confidence REAL,
    tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED,
    PRIMARY KEY (source_id, page)
);
CREATE INDEX IF NOT EXISTS idx_guideline_passage_tsv ON smartrx.guideline_passage USING gin (tsv);
CREATE INDEX IF NOT EXISTS idx_guideline_passage_method ON smartrx.guideline_passage (source_id, method);
