-- Names that stand for a combination of ingredients (co-trimoxazole = sulfamethoxazole + trimethoprim).
CREATE TABLE IF NOT EXISTS smartrx.drug_synonym (
    synonym VARCHAR(120) NOT NULL,
    moiety_identifier VARCHAR(100) NOT NULL,
    PRIMARY KEY (synonym, moiety_identifier)
);
