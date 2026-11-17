# Transform (dbt on DuckDB)

Turns the raw layer into the app's tables. Models, grains and rules: `../ARCHITECTURE.md` §4–6.

```bash
cd transform
uv run --python 3.12 dbt build --profiles-dir . --vars '{raw_root: data/sample/raw}'   # local, real sample data
uv run --python 3.12 dbt build --profiles-dir . --target prod                          # daily job: S3 (RAW_BUCKET + AWS creds)
uv run --python 3.12 python export.py --db kcne.duckdb --out ../app/data                 # JSON for the app (+ S3 copy if RAW_BUCKET)
uv run --python 3.12 pytest                                                             # export tests (tests_py/)
```

- **Publish guard:** `export.py` refuses (exit 1, nothing written) on 0 openings or fewer than
  half of the previous export, so a bad pull never replaces a good site.

- Sources read raw files directly (`meta.external_location`); the latest KC pull wins.
- `data/sample/raw/` is a small real cut of the raw layer (see its README).
- `kcne.duckdb` is a local build artefact (git-ignored); every run rebuilds from raw.
