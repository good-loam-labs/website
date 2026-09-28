# GoodLoamLabs website

Single-page landing site: animated ASCII-wave background with an email field for demo requests.
Built with [Vite](https://vite.dev), deployed to GitHub Pages.

## Develop

```sh
npm install
cp .env.example .env   # set VITE_FORM_ENDPOINT
npm run dev
```

## Collecting emails

The site posts JSON `{ email, source }` to a Cloudflare Worker. The Worker validates addresses,
deduplicates them, and stores them in a Cloudflare D1 database.

### Set up the Worker

1. Install dependencies with `npm install` (includes [Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/)).
2. Create the D1 database with `npm run emails:db:create`. Copy the returned database ID into `database_id` in `wrangler.jsonc`.
3. Apply the schema locally with `npm run emails:db:migrate:local` and remotely with `npm run emails:db:migrate:remote`.
4. Set `ALLOWED_ORIGINS` in `wrangler.jsonc` to the site origins that may submit emails (comma separated if needed). The default allows `https://goodloam.com`.
5. For local development, temporarily add `http://localhost:5173` to `ALLOWED_ORIGINS` and set `VITE_FORM_ENDPOINT=http://localhost:8787/subscribe` in `.env`. Start `npm run worker:dev` and `npm run dev` in separate terminals. Remove the localhost origin before deploying.
6. Deploy with `npm run worker:deploy`. The current endpoint is `https://goodloam-email-api.kozminski.workers.dev/subscribe`; set it as `VITE_FORM_ENDPOINT` in `.env` and the GitHub Actions repository variable, then rebuild and deploy the site.

The endpoint accepts `POST /subscribe` with `Content-Type: application/json` and returns `{ "ok": true }` after storing the address. Duplicate addresses return the same success response. To review collected emails, run:

```sh
npx wrangler d1 execute goodloam-emails --remote --command "SELECT email, source, created_at FROM email_signups ORDER BY created_at DESC"
```

For local development, `npm run emails:db:migrate:local` creates the local D1 schema used by `npm run worker:dev`.

## Deploy to GitHub Pages

1. Push this repo to GitHub (branch `main`).
2. **Settings → Pages → Source: GitHub Actions**.
3. **Settings → Secrets and variables → Actions → Variables**: add `VITE_FORM_ENDPOINT`.
4. Push — `.github/workflows/deploy.yml` builds and publishes `dist/`.

For a custom domain, add a `public/CNAME` file containing the domain (e.g. `goodloamlabs.com`).
