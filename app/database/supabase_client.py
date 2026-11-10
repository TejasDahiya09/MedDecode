"""
Supabase client configuration for MedDecode.

This module is responsible only for:

    Environment configuration
        ↓
    Supabase client creation
        ↓
    Shared database client

Database business logic does not belong here.
"""

from __future__ import annotations

import os

from dotenv import load_dotenv
from supabase import Client, create_client


# Load environment variables from .env
load_dotenv()


def get_supabase_client() -> Client:
    """
    Create and return the configured Supabase client.

    Required environment variables:

        SUPABASE_URL
        SUPABASE_KEY
    """

    supabase_url = os.getenv(
        "SUPABASE_URL"
    )

    supabase_key = os.getenv(
        "SUPABASE_KEY"
    )

    if not supabase_url:
        raise RuntimeError(
            "SUPABASE_URL is not configured."
        )

    if not supabase_key:
        raise RuntimeError(
            "SUPABASE_KEY is not configured."
        )

    return create_client(
        supabase_url,
        supabase_key,
    )