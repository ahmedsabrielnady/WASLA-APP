#!/usr/bin/env python3
"""Parse every Supabase migration with PostgreSQL's SQL grammar.

This validates the outer SQL statements (DDL, policies, grants, triggers, and
function declarations). PostgreSQL/PLpgSQL function bodies still require
execution against a disposable Supabase-compatible database for full validation.
"""
from pathlib import Path
import sys

from pglast import parse_sql


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    migration_dir = root / "supabase" / "migrations"
    files = sorted(migration_dir.glob("*.sql"))
    if not files:
        print("No Supabase SQL migrations found.", file=sys.stderr)
        return 1

    failures = 0
    for path in files:
        try:
            parse_sql(path.read_text(encoding="utf-8"))
            print(f"PASS {path.relative_to(root)}")
        except Exception as exc:  # parser exposes detailed line/column diagnostics
            failures += 1
            print(f"FAIL {path.relative_to(root)}: {exc}", file=sys.stderr)

    print(f"\nParsed {len(files)} migration file(s); {failures} failure(s).")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
