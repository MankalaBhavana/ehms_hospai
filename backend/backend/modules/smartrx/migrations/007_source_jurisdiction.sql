-- Where a guideline comes from. Indian sources decide treatment content; foreign sources inform universal pharmacology only.
ALTER TABLE smartrx.guideline_source ADD COLUMN IF NOT EXISTS jurisdiction VARCHAR(14) NOT NULL DEFAULT 'Unknown';
ALTER TABLE smartrx.guideline_source ADD CONSTRAINT chk_guideline_source_jurisdiction
    CHECK (jurisdiction IN ('India','WHO','US','International','Unknown'));
