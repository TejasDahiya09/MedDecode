# Medicine data sources and provenance

## Current implementation

The existing general CSV ingestion package remains the foundation. The working tree adds an RxNorm-specific adapter, offline dry-run path, and relationship/attribute enrichment. See [official dataset ingestion](OFFICIAL_DATASETS.md) for the recorded local results and data exclusion requirements.

- Inputs: official RXNCONSO CSV extracts with named columns, or pipe-delimited `RXNCONSO.RRF`.
- Required fields: `RXCUI`, `RXAUI`, `STR`, `TTY`, `SAB`, `CODE`, and `SUPPRESS`.
- Source identity: dataset `nlm_rxnorm_rxnconso`, row/atom ID `RXAUI`, supplied release, optional source URL, and a record hash.
- Retained raw values: the complete source row plus selected RxNorm identifiers/term type and source metadata.
- Accepted term types currently include `SCD`, `SBD`, `GPCK`, and `BPCK`; suppressed and non-RxNorm records are not accepted as ordinary canonical candidates.
- A dry run reports accepted, rejected, ambiguous, and duplicate records and may export normalized output. It does not write to a database.

`RXNCONSO.RRF` exposes a streaming iterator, but the current `load()`/dry-run path materializes records and groups them in memory. A `max_records` option bounds selection but the CSV loader may still read the source before slicing. Treat large full-release runs as unverified and memory-sensitive.

The base adapter maps the normalized RxNorm `STR` to a canonical display name and retains other values as source metadata. The enrichment stage uses RXNREL relationships and RXNSAT BOSS attributes to attach supported ingredient, ingredient-strength, and dosage-form fields to accepted records. It does not establish manufacturer, indications, warnings, or pricing. Do not infer missing fields from the display string or use one source's claims to overwrite another.

The adapter factory explicitly rejects WHO EML, India NLEM, CDSCO, DailyMed, NPPA, ICMR, and unknown sources until an official schema and mapping are verified. There is no multi-source ingestion workflow that safely reconciles conflicting data yet.

## Official source references

These links are official organization/service pages, not evidence that an extract is licensed, downloadable, complete, or already integrated:

### Global

- [U.S. National Library of Medicine RxNorm](https://www.nlm.nih.gov/research/umls/rxnorm/index.html) — normalized clinical-drug names and vocabulary links; check current release and terms before obtaining data.
- [WHO Model Lists of Essential Medicines](https://www.who.int/groups/expert-committee-on-selection-and-use-of-essential-medicines/essential-medicines-lists) — periodically updated model essential-medicine lists, not a full market-product register.
- [NLM DailyMed](https://dailymed.nlm.nih.gov/dailymed/) — published drug labeling; label claims and product identity need source-aware mapping.
- [European Medicines Agency medicines](https://www.ema.europa.eu/en/medicines) — information on medicines authorized through EMA procedures; not a universal global product catalogue.
- [Health Canada Drug Product Database](https://health-products.canada.ca/dpd-bdpp/index-eng.jsp) — Canadian product information searchable by DIN, ingredient, company, and other attributes.
- [UK MHRA](https://www.gov.uk/government/organisations/medicines-and-healthcare-products-regulatory-agency) — UK medicine/device regulator and official product/safety information entry points.

### India

- [CDSCO](https://cdsco.gov.in/opencms/opencms/en/Home/) — India's national drug regulatory authority; any specific product extract requires an identified official dataset and schema.
- [ICMR](https://www.icmr.gov.in/) — biomedical research organization; research publications are not automatically authoritative product-registration data.
- [NPPA](https://nppa.gov.in/en) — pharmaceutical pricing authority and official price-information services; price records need jurisdiction, effective date, pack, and source context.
- [Pradhan Mantri Bhartiya Janaushadhi Pariyojana](https://janaushadhi.gov.in/) — official scheme site; a machine-readable catalogue, license, and field schema have not been verified here.

The NLEM page/source and all candidate data-download endpoints should be verified from the current official Ministry of Health and Family Welfare site before ingestion. The links above were checked as organization/service pages only; no datasets were downloaded in this audit.

## Required source governance before combining datasets

For each dataset, record the issuing authority, exact source URL, release/effective date, jurisdiction, license/terms, schema version, checksum, extraction method, and known omissions. Keep source records immutable and separate from any canonical medicine entity. Resolve matches by verified identifiers and review ambiguous/conflicting records rather than overwriting them. Preserve each field's provenance and the reason for any accepted reconciliation.

No scraped marketplace, crowdsourced, Kaggle, or otherwise unofficial dataset should be labeled authoritative. Prices require explicit official provenance and effective-date context. Local raw source files and normalized/enriched exports are excluded from Git.
