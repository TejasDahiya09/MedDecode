"""
Simple MedDecode Supabase connection test.

This script verifies that the configured Supabase
credentials can communicate with the database.
"""

from app.database.supabase_client import (
    get_supabase_client,
)


def main() -> None:

    print()
    print("=" * 60)
    print("MedDecode Supabase Connection Test")
    print("=" * 60)
    print()

    database = get_supabase_client()

    print(
        "Supabase client initialized successfully."
    )

    try:

        response = (
            database
            .table("medicines")
            .select("id")
            .limit(1)
            .execute()
        )

        print(
            "PASS: Successfully connected to Supabase."
        )

        print(
            f"Medicine rows returned: "
            f"{len(response.data or [])}"
        )

    except Exception as exc:

        print()
        print("SUPABASE CONNECTION TEST FAILED")
        print(
            f"{type(exc).__name__}: {exc}"
        )

        raise


if __name__ == "__main__":
    main()