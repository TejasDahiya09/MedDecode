# Contract v1 schema notes

These schemas transcribe the normative structures in the authoritative Contract
v1.0 PDF. They intentionally allow additional properties so Member 1 can add
backward-compatible optional response fields.

Contract ambiguities are not converted into invented requirements:

- The binary representation of `direct_upload` is unspecified.
- The names inside the per-medicine `confidence` object are examples, not an
  exhaustive required list.
- Defaults for omitted requested-analysis flags are unspecified.
- The representation of unavailable dataset/model versions is unspecified.

The Phase 5.2 synthetic adapter supports only `authorized_url`, never fetches
the URL, requires all four feature flags as a local adapter restriction, and
uses non-empty synthetic version labels.
