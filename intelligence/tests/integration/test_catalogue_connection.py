from pathlib import Path

import pytest

from app.database.catalogue_connection import (
    CatalogueConfigurationError,
    classify_catalogue_connection_error,
    load_catalogue_connection_settings,
)


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("connection failed: Network is unreachable", "NETWORK_UNREACHABLE"),
        ("could not translate host name", "DNS_FAILURE"),
        ("connection timed out", "TCP_TIMEOUT"),
        ("server certificate verify failed", "TLS_VALIDATION_FAILED"),
        ("password authentication failed", "AUTHENTICATION_FAILED"),
        ("connection to server failed: Permission denied", "TCP_ACCESS_DENIED"),
        ("permission denied for table official_catalogue", "PERMISSION_DENIED"),
        ("too many connections for role", "CONNECTION_EXHAUSTED"),
        ("unrecognized provider response", "CONNECTION_FAILED"),
    ],
)
def test_catalogue_connection_diagnostics_are_stable_and_non_sensitive(message: str, expected: str) -> None:
    assert classify_catalogue_connection_error(RuntimeError(message)) == expected


def test_local_catalogue_configuration_is_explicit_and_backward_compatible() -> None:
    settings = load_catalogue_connection_settings(
        {"MEDDECODE_CATALOGUE_ENV": "local"}
    )
    assert settings.host == "127.0.0.1"
    assert settings.port == 5433
    assert settings.database == "meddecode_job_test"
    assert settings.sslmode == "disable"


def test_hosted_catalogue_requires_verified_tls_and_credentials(tmp_path: Path) -> None:
    root_certificate = tmp_path / "root.crt"
    root_certificate.write_text("test certificate", encoding="ascii")
    values = {
        "MEDDECODE_CATALOGUE_ENV": "hosted",
        "MEDDECODE_CATALOGUE_HOST": "db.example.invalid",
        "MEDDECODE_CATALOGUE_DATABASE": "postgres",
        "MEDDECODE_CATALOGUE_USER": "catalogue_reader",
        "MEDDECODE_CATALOGUE_SSLMODE": "verify-full",
        "MEDDECODE_CATALOGUE_SSLROOTCERT": str(root_certificate),
        "MEDDECODE_CATALOGUE_PASSWORD": "not-printed",
    }
    settings = load_catalogue_connection_settings(values)
    assert settings.psycopg_kwargs()["sslmode"] == "verify-full"
    assert settings.psycopg_kwargs()["sslrootcert"] == str(root_certificate)
    assert settings.psycopg_kwargs()["options"] == "-c default_transaction_read_only=on"


def test_hosted_catalogue_rejects_privileged_or_client_roles(tmp_path: Path) -> None:
    root_certificate = tmp_path / "root.crt"
    root_certificate.write_text("test certificate", encoding="ascii")

    with pytest.raises(CatalogueConfigurationError, match="dedicated restricted"):
        load_catalogue_connection_settings(
            {
                "MEDDECODE_CATALOGUE_ENV": "hosted",
                "MEDDECODE_CATALOGUE_HOST": "db.example.invalid",
                "MEDDECODE_CATALOGUE_DATABASE": "postgres",
                "MEDDECODE_CATALOGUE_USER": "postgres",
                "MEDDECODE_CATALOGUE_SSLMODE": "verify-full",
                "MEDDECODE_CATALOGUE_SSLROOTCERT": str(root_certificate),
                "MEDDECODE_CATALOGUE_PASSWORD": "not-printed",
            }
        )


@pytest.mark.parametrize(
    "overrides",
    [
        {"MEDDECODE_CATALOGUE_ENV": "production"},
        {
            "MEDDECODE_CATALOGUE_ENV": "hosted",
            "MEDDECODE_CATALOGUE_HOST": "db.example.invalid",
            "MEDDECODE_CATALOGUE_DATABASE": "postgres",
            "MEDDECODE_CATALOGUE_USER": "reader",
            "MEDDECODE_CATALOGUE_SSLMODE": "require",
            "MEDDECODE_CATALOGUE_PASSWORD": "secret",
        },
    ],
)
def test_invalid_catalogue_configuration_fails_closed(overrides: dict[str, str]) -> None:
    with pytest.raises(CatalogueConfigurationError):
        load_catalogue_connection_settings(overrides)
