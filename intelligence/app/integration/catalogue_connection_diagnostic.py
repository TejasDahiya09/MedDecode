"""Read-only, non-secret local diagnostic for the restricted catalogue path."""

from __future__ import annotations

import argparse
from pathlib import Path

from dotenv import load_dotenv

from app.database.catalogue_connection import (
    CatalogueConfigurationError,
    classify_catalogue_connection_error,
    connect_catalogue,
    load_catalogue_connection_settings,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument("--dotenv-file", type=Path, default=Path(__file__).resolve().parents[2] / ".env")
    args = parser.parse_args(argv)
    # ``override=False`` permits an operator's protected process environment to
    # win without echoing or persisting any credential value.
    load_dotenv(args.dotenv_file, override=False)
    try:
        settings = load_catalogue_connection_settings()
    except CatalogueConfigurationError:
        print("CATALOGUE_DIAGNOSTIC:CONFIGURATION_INVALID")
        return 2
    connection = None
    try:
        connection = connect_catalogue()
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT entity_id FROM official_catalogue.catalogue_entities "
                "WHERE entity_type = %s LIMIT 1",
                ("formulation",),
            )
            cursor.fetchone()
            cursor.execute("SELECT current_user, current_setting('transaction_read_only')")
            role, read_only = cursor.fetchone()
        tls_active = bool(connection.pgconn.ssl_in_use)
        # Successful connection with sslmode=verify-full establishes hostname
        # and CA validation at libpq level; no certificate material is printed.
        print(
            "CATALOGUE_DIAGNOSTIC:OK:"
            f"role={role}:readonly={read_only}:tls_verify_full="
            f"{str(settings.sslmode == 'verify-full' and tls_active).lower()}:"
            "parameterized_query=ok"
        )
        return 0
    except Exception as error:
        print(f"CATALOGUE_DIAGNOSTIC:CONNECT_FAILED:{classify_catalogue_connection_error(error)}")
        return 3
    finally:
        if connection is not None:
            connection.rollback()
            connection.close()


if __name__ == "__main__":
    raise SystemExit(main())
