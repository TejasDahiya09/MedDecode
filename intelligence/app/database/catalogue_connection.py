"""Fail-closed PostgreSQL configuration for official catalogue reads."""

from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
from typing import Literal, Mapping, cast


CatalogueEnvironment = Literal["local", "hosted"]
_SSL_MODES = {"disable", "require", "verify-ca", "verify-full"}


class CatalogueConfigurationError(ValueError):
    """Raised when official catalogue connection configuration is unsafe."""


def classify_catalogue_connection_error(error: BaseException) -> str:
    """Return a stable, non-sensitive transport/authentication category.

    This is intentionally suitable only for local diagnostics and child stderr.
    It never returns libpq text, a host, role, certificate path, or credentials.
    HTTP callers continue to receive the existing generic processing failure.
    """

    message = str(error).casefold()
    if any(marker in message for marker in ("network is unreachable", "no route to host")):
        return "NETWORK_UNREACHABLE"
    if any(marker in message for marker in ("could not translate host name", "name or service not known")):
        return "DNS_FAILURE"
    if any(marker in message for marker in ("connection timed out", "connect timeout", "timeout expired")):
        return "TCP_TIMEOUT"
    if any(marker in message for marker in ("connection refused", "actively refused")):
        return "TCP_REFUSED"
    if any(marker in message for marker in ("certificate verify failed", "ssl certificate", "root certificate")):
        return "TLS_VALIDATION_FAILED"
    if "password authentication failed" in message or "authentication failed" in message:
        return "AUTHENTICATION_FAILED"
    # libpq reports OS/socket access denial without an SQLSTATE.  Do not
    # misreport that as a database ACL failure and invite an unsafe GRANT.
    if (
        getattr(error, "sqlstate", None) is None
        and "permission denied" in message
        and any(marker in message for marker in ("connection", "server at", "socket"))
    ):
        return "TCP_ACCESS_DENIED"
    if "permission denied" in message or "insufficient privilege" in message:
        return "PERMISSION_DENIED"
    if "too many connections" in message:
        return "CONNECTION_EXHAUSTED"
    return "CONNECTION_FAILED"


@dataclass(frozen=True)
class CatalogueConnectionSettings:
    environment: CatalogueEnvironment
    host: str
    port: int
    database: str
    user: str
    sslmode: str
    connect_timeout: int
    password: str | None = None
    passfile: str | None = None
    sslrootcert: str | None = None

    def psycopg_kwargs(self) -> dict[str, object]:
        kwargs: dict[str, object] = {
            "host": self.host,
            "port": self.port,
            "dbname": self.database,
            "user": self.user,
            "sslmode": self.sslmode,
            "connect_timeout": self.connect_timeout,
            # Defence in depth: the hosted identity is already column-scoped,
            # but every connection also starts transactions read-only.
            "options": "-c default_transaction_read_only=on",
        }
        if self.password is not None:
            kwargs["password"] = self.password
        if self.passfile is not None:
            kwargs["passfile"] = self.passfile
        if self.sslrootcert is not None:
            kwargs["sslrootcert"] = self.sslrootcert
        return kwargs


def _required(source: Mapping[str, str], name: str) -> str:
    value = source.get(name, "").strip()
    if not value:
        raise CatalogueConfigurationError(f"{name} is required.")
    return value


def _integer(source: Mapping[str, str], name: str, default: int, minimum: int, maximum: int) -> int:
    raw = source.get(name, str(default)).strip()
    try:
        value = int(raw)
    except ValueError as error:
        raise CatalogueConfigurationError(f"{name} must be an integer.") from error
    if not minimum <= value <= maximum:
        raise CatalogueConfigurationError(
            f"{name} must be between {minimum} and {maximum}."
        )
    return value


def load_catalogue_connection_settings(
    source: Mapping[str, str] | None = None,
    *,
    environment_override: CatalogueEnvironment | None = None,
) -> CatalogueConnectionSettings:
    values = os.environ if source is None else source
    environment = (
        environment_override
        if environment_override is not None
        else _required(values, "MEDDECODE_CATALOGUE_ENV").casefold()
    )
    if environment not in {"local", "hosted"}:
        raise CatalogueConfigurationError(
            "MEDDECODE_CATALOGUE_ENV must be local or hosted."
        )

    host = values.get(
        "MEDDECODE_CATALOGUE_HOST",
        "127.0.0.1" if environment == "local" else "",
    ).strip()
    database = values.get(
        "MEDDECODE_CATALOGUE_DATABASE",
        "meddecode_job_test" if environment == "local" else "",
    ).strip()
    user = values.get(
        "MEDDECODE_CATALOGUE_USER",
        "postgres" if environment == "local" else "",
    ).strip()
    if not host:
        raise CatalogueConfigurationError("MEDDECODE_CATALOGUE_HOST is required.")
    if not database:
        raise CatalogueConfigurationError("MEDDECODE_CATALOGUE_DATABASE is required.")
    if not user:
        raise CatalogueConfigurationError("MEDDECODE_CATALOGUE_USER is required.")

    port = _integer(values, "MEDDECODE_CATALOGUE_PORT", 5433 if environment == "local" else 5432, 1, 65535)
    connect_timeout = _integer(values, "MEDDECODE_CATALOGUE_CONNECT_TIMEOUT_SECONDS", 10, 1, 120)
    sslmode = values.get(
        "MEDDECODE_CATALOGUE_SSLMODE",
        "disable" if environment == "local" else "",
    ).strip().casefold()
    if sslmode not in _SSL_MODES:
        raise CatalogueConfigurationError(
            "MEDDECODE_CATALOGUE_SSLMODE must be disable, require, verify-ca, or verify-full."
        )
    if environment == "hosted" and sslmode != "verify-full":
        raise CatalogueConfigurationError(
            "Hosted catalogue connections require MEDDECODE_CATALOGUE_SSLMODE=verify-full."
        )
    if environment == "hosted" and host.casefold() in {"localhost", "127.0.0.1", "::1"}:
        raise CatalogueConfigurationError(
            "Hosted catalogue connections cannot use a loopback host."
        )
    if environment == "hosted" and user.casefold() in {
        "postgres",
        "service_role",
        "authenticated",
        "anon",
        "meddecode_worker",
    }:
        raise CatalogueConfigurationError(
            "Hosted catalogue connections require a dedicated restricted read-only user."
        )

    sslrootcert = values.get("MEDDECODE_CATALOGUE_SSLROOTCERT", "").strip() or None
    if environment == "hosted":
        if sslrootcert is None or not Path(sslrootcert).is_file():
            raise CatalogueConfigurationError(
                "Hosted catalogue connections require an existing SSL root certificate."
            )

    raw_password = values.get("MEDDECODE_CATALOGUE_PASSWORD")
    password = raw_password if raw_password else None
    passfile = values.get("MEDDECODE_CATALOGUE_PASSFILE", "").strip() or None
    if environment == "hosted" and password is None and passfile is None:
        raise CatalogueConfigurationError(
            "Hosted catalogue connections require MEDDECODE_CATALOGUE_PASSWORD or MEDDECODE_CATALOGUE_PASSFILE."
        )
    if passfile is not None and not Path(passfile).is_file():
        raise CatalogueConfigurationError("MEDDECODE_CATALOGUE_PASSFILE does not exist.")

    return CatalogueConnectionSettings(
        environment=cast(CatalogueEnvironment, environment),
        host=host,
        port=port,
        database=database,
        user=user,
        sslmode=sslmode,
        connect_timeout=connect_timeout,
        password=password,
        passfile=passfile,
        sslrootcert=sslrootcert,
    )


def connect_catalogue(
    *,
    environment_override: CatalogueEnvironment | None = None,
):
    """Open a configured read-only catalogue connection."""

    settings = load_catalogue_connection_settings(
        environment_override=environment_override
    )
    import psycopg

    return psycopg.connect(**settings.psycopg_kwargs())
