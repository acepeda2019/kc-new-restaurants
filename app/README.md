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

With either variable unset, the gate fails closed: nobody can log in.
Changing `APP_PASSCODE` does not log anyone out; rotate `SESSION_SECRET` to revoke all sessions.
Cookies are `Secure`: Safari may drop them on `http://localhost`, so test locally in Chrome or Firefox.
