"""Safety controls for the default offline intelligence test suite.

This file is loaded only by pytest. It prevents accidental network access and
environment-file loading while the reviewed offline tests run. Production and
manual diagnostic behavior is unchanged outside pytest.
"""

from __future__ import annotations

import os
import socket
from typing import Any

import dotenv


_ORIGINAL_CREATE_CONNECTION = socket.create_connection
_ORIGINAL_SOCKET_CONNECT = socket.socket.connect
_ORIGINAL_SOCKET_CONNECT_EX = socket.socket.connect_ex
_ORIGINAL_LOAD_DOTENV = dotenv.load_dotenv


def _deny_network(*args: Any, **kwargs: Any) -> None:
    raise RuntimeError("Network access is disabled during offline intelligence tests.")


def _skip_dotenv(*args: Any, **kwargs: Any) -> bool:
    return False


def pytest_configure() -> None:
    os.environ.pop("SUPABASE_URL", None)
    os.environ.pop("SUPABASE_KEY", None)
    dotenv.load_dotenv = _skip_dotenv
    socket.create_connection = _deny_network
    socket.socket.connect = _deny_network
    socket.socket.connect_ex = _deny_network


def pytest_unconfigure() -> None:
    socket.create_connection = _ORIGINAL_CREATE_CONNECTION
    socket.socket.connect = _ORIGINAL_SOCKET_CONNECT
    socket.socket.connect_ex = _ORIGINAL_SOCKET_CONNECT_EX
    dotenv.load_dotenv = _ORIGINAL_LOAD_DOTENV
