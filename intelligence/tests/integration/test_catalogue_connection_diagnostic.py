from __future__ import annotations

from types import SimpleNamespace

from app.integration import catalogue_connection_diagnostic as diagnostic


class Cursor:
    def __init__(self) -> None:
        self.statements: list[tuple[str, tuple[object, ...]]] = []
        self._count = 0

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def execute(self, statement, parameters=()):
        self.statements.append((statement, parameters))

    def fetchone(self):
        self._count += 1
        return None if self._count == 1 else ("meddecode_catalogue_python_reader", "on")


class Connection:
    def __init__(self) -> None:
        self.cursor_value = Cursor()
        # psycopg3 exposes the libpq TLS state through pgconn, not info.
        self.pgconn = SimpleNamespace(ssl_in_use=True)
        self.rolled_back = False
        self.closed = False

    def cursor(self):
        return self.cursor_value

    def rollback(self):
        self.rolled_back = True

    def close(self):
        self.closed = True


def test_diagnostic_uses_parameterized_catalogue_read_and_closes(monkeypatch, capsys) -> None:
    connection = Connection()
    settings = SimpleNamespace(sslmode="verify-full")
    monkeypatch.setattr(diagnostic, "load_dotenv", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(diagnostic, "load_catalogue_connection_settings", lambda: settings)
    monkeypatch.setattr(diagnostic, "connect_catalogue", lambda: connection)

    assert diagnostic.main(["--dotenv-file", "unused.env"]) == 0

    output = capsys.readouterr().out
    assert "CATALOGUE_DIAGNOSTIC:OK" in output
    assert "tls_verify_full=true" in output
    assert connection.cursor_value.statements[0][1] == ("formulation",)
    assert connection.rolled_back and connection.closed


def test_diagnostic_classifies_connection_without_printing_exception(monkeypatch, capsys) -> None:
    monkeypatch.setattr(diagnostic, "load_dotenv", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(diagnostic, "load_catalogue_connection_settings", lambda: SimpleNamespace())
    monkeypatch.setattr(
        diagnostic,
        "connect_catalogue",
        lambda: (_ for _ in ()).throw(RuntimeError("connection failed: Permission denied secret")),
    )

    assert diagnostic.main(["--dotenv-file", "unused.env"]) == 3
    output = capsys.readouterr().out
    assert output.strip() == "CATALOGUE_DIAGNOSTIC:CONNECT_FAILED:TCP_ACCESS_DENIED"
    assert "secret" not in output
