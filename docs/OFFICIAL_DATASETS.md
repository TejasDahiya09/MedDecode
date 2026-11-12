# Official dataset ingestion

## Current supported source

The current source-specific ingestion path supports NLM RxNorm RXNCONSO data. Its offline stages are:

1. `official_sources.py` parses RXNCONSO CSV extracts or pipe-delimited RRF, checks source/term/suppression fields, and retains source identifiers, release metadata, and raw fields.
2. `dry_run.py` runs the existing mapper, transformer, normalizer, and validator. It emits accepted, rejected, ambiguous, and duplicate records without database access.
3. `rxnorm_enrichment.py` enriches accepted records using official RXNREL relationships and RXNSAT BOSS strength attributes, resolving related English RXNORM atoms from RXNCONSO. Output includes the release, relationship evidence, field provenance, conflicts, and unknown reasons.

The enrichment path deliberately leaves unsupported or conflicting form/strength information unknown. It does not derive strength or dosage form from free-text drug names. Precise-ingredient relationships are preferred when unambiguous while base-ingredient identifiers are retained. The source rows and provenance remain distinct from the normalized record; this pipeline does not write to Supabase.

These are separate callable stages today, not one end-to-end CLI: produce the offline accepted-record export with `run_official_dry_run()`, then pass that export and the three local RRF paths to `enrich_rxnorm_dry_run_export()`. The reported local result was produced for a bounded input, but no single checked-in command currently reproduces both stages. Do not treat the separately tested functions as proof that a production ingestion workflow is fully wired.

## Recorded local result

The verified local run reported:

- 290 accepted RxNorm records enriched.
- 305 ingredient links, including 15 multi-ingredient formulations.
- Ingredient, strength, and dosage-form coverage for all 290 records.
- 14 focused ingestion/enrichment tests passed.

These are results for the bounded local input used in that run, not a claim that the full RxNorm release was ingested. The counts are not a clinical-accuracy or production-readiness assessment. The focused tests use deterministic fixtures; they do not prove hosted database compatibility or validate every RxNorm relationship shape.

## Data retention and Git policy

The local source ZIP, RXNCONSO/RXNREL/RXNSAT RRF files, and normalized/enriched JSON exports under root `datasets/` are excluded by `.gitignore`. Keep all of them out of commits, staging lists, pull-request attachments, logs, and screenshots. Do not copy the files into source or test fixtures. The repository should contain the adapter, deterministic test code, and safe documentation only.

The current local directory inventory includes the RxNorm source package/RRF files and normalized JSON exports, including a `first-10000-enriched` export. File names and sizes are local inventory details; the data contents are not required for code review or Git publication. `git status --ignored` may show these files, but ignored status is not permission to force-add them.

The unused `intelligence/data/raw/sample_medicines.csv` contained illustrative brand/manufacturer names, prices, and clinical-looking fields without authoritative provenance. Repository code and tests did not reference that file; the general CSV runner requires an explicit input path. It is absent from this publication snapshot and is ignored to prevent accidental reintroduction. The original source branch still has the old blob in its history; pushing that branch would upload those commits. This publication branch is based on `origin/main`, which did not contain the file, and does not inherit the source branch history. An external backup remains untouched, but its contents were not verified against the historical file.

## Scope and gaps

- RxNorm is the only official source adapter currently implemented. WHO EML, India NLEM, CDSCO, DailyMed, NPPA, ICMR, and other source names remain unavailable until their source-specific schema, provenance, licensing, and mapping are verified.
- The ingestion output is not automatically equivalent to the Layer 4 database schema. Existing medicine-table DDL and persistence of enrichment provenance require owner review.
- The base dry-run path materializes adapted records and groups them in memory. The enrichment stage scans the RRF inputs and retains target indexes; large-release memory/runtime characteristics have not been independently benchmarked.
- There is no multi-source conflict-resolution or source-precedence policy. Do not overwrite one source record with another or treat a fuzzy match as identity.
- Pricing, manufacturer, indications, warnings, contraindications, regulatory approval, and therapeutic equivalence are not supplied by this enrichment result.
- No live API download, hosted database import, or cloud operation is part of this workflow.

## Official references

- [NLM RxNorm](https://www.nlm.nih.gov/research/umls/rxnorm/index.html) — normalized clinical-drug names, relationships, and release documentation.
- [WHO Model Lists of Essential Medicines](https://www.who.int/groups/expert-committee-on-selection-and-use-of-essential-medicines/essential-medicines-lists)
- [CDSCO](https://cdsco.gov.in/opencms/opencms/en/Home/)
- [NPPA](https://nppa.gov.in/en)

The additional candidate organizations and source limitations are documented in [data sources and provenance](DATA_SOURCES.md). Verify source terms and the exact release before any future ingestion.
