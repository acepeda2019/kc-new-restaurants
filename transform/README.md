# Transform (dbt on DuckDB)

Turns the raw layer into the app's tables. Models, grains and rules: `../ARCHITECTURE.md` §4–6.

```bash
cd transform
uv run --python 3.12 dbt build --profiles-dir . --vars '{raw_root: data/sample/raw}'   # local, real sample data
uv run --python 3.12 dbt build --profiles-dir . --target prod                          # daily job: S3 (RAW_BUCKET + AWS creds)
```

- Sources read raw files directly (`meta.external_location`); the latest KC pull wins.
- `data/sample/raw/` is a small real cut of the raw layer (see its README).
- `kcne.duckdb` is a local build artefact (git-ignored); every run rebuilds from raw.
