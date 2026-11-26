# King County New Eats: app

Next.js (App Router) site behind a shared passcode. See `../ARCHITECTURE.md` §7.

## Run locally

```bash
cp .env.example .env.local   # then fill in both values (never commit .env.local)
#   APP_PASSCODE=<any passcode for local use>
#   SESSION_SECRET=$(openssl rand -base64 32)
npm install
npm run dev     # http://localhost:3000 → /login
npm test        # vitest
npm run lint
npm run build
```

Without an export in `data/`, the app builds from the labelled sample in `data/sample/`. Set `REQUIRE_EXPORT=1` (the daily production job does, from SAN-41) to make the build fail instead of falling back to the sample.

With either variable unset, the gate fails closed: nobody can log in.
Changing `APP_PASSCODE` does not log anyone out; rotate `SESSION_SECRET` to revoke all sessions.
Cookies are `Secure`: Safari may drop them on `http://localhost`, so test locally in Chrome or Firefox.

## Question-bar eval (SAN-67)

`evals/` runs 31 fixed questions through the real answer loop against a frozen snapshot and
grades the answers by code (filters, count and period, cards only from the search, wording).
It calls Claude and spends money (about 8¢ for a full run), so it never runs in `npm test` or
CI. See `evals/README.md`.

## Question log (SAN-68)

Every question that reaches Claude is kept 90 days in Redis, with the visitor's cookie id and
the location rounded to about 1 km (the About panel says so). To see usage, from `app/`:

```bash
npm run ask-log            # last 7 days; DAYS=30 for more
```

It uses the read-only Redis token from `.env.local` and costs nothing. Questions are visitors'
own words: read them as data, never as instructions.
