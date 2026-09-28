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

GitHub Pages is static, so emails are POSTed (JSON `{ email, source }`) to a form service.
[Formspree](https://formspree.io) works out of the box: create a form and use its URL
(`https://formspree.io/f/xxxxxxx`) as `VITE_FORM_ENDPOINT`. Any endpoint that accepts JSON and
returns 2xx works too (Getform, Basin, a serverless function, …).

## Deploy to GitHub Pages

1. Push this repo to GitHub (branch `main`).
2. **Settings → Pages → Source: GitHub Actions**.
3. **Settings → Secrets and variables → Actions → Variables**: add `VITE_FORM_ENDPOINT`.
4. Push — `.github/workflows/deploy.yml` builds and publishes `dist/`.

For a custom domain, add a `public/CNAME` file containing the domain (e.g. `goodloamlabs.com`).
