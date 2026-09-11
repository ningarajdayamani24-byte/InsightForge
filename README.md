# InsightForge

A personal résumé and project portfolio with two experiences:

- **Public site** — presents the profile, selected work, contact links, profile image, and downloadable CV.
- **Private `/admin` dashboard** — password-protected space for the portfolio owner to update profile details, upload files, and add, edit, or remove projects.

It deliberately uses only Node's standard library. That keeps the project lightweight, easy to inspect, and straightforward to deploy without a long dependency chain.

## Run it locally

1. Copy `.env.example` to `.env`.
2. Set a secure admin password and session secret in `.env`.
3. Run `npm start`.
4. Open `http://localhost:3000`; the private workspace is at `http://localhost:3000/admin`.

`npm run check` performs a basic syntax check before you publish.

## Before deployment

- Set `NODE_ENV=production`.
- Set a long, random `SESSION_SECRET`.
- Generate and set `ADMIN_PASSWORD_HASH` using the command in `.env.example`; remove `ADMIN_PASSWORD` afterwards.
- Use a host with persistent disk storage. The uploads folder and `data/content.json` change through the dashboard, so a purely static host such as GitHub Pages will not support admin uploads.

The included `Dockerfile` deploys directly to a Docker-capable host such as Render, Railway, Fly.io, or a VPS. Mount persistent storage at `/app/data` and `/app/uploads` when the provider supports volumes.

## Publishing to GitHub

Create an empty GitHub repository, then in this project directory run:

```bash
git add .
git commit -m "Build InsightForge portfolio and admin dashboard"
git branch -M main
git remote add origin https://github.com/YOUR-ACCOUNT/YOUR-REPOSITORY.git
git push -u origin main
```

Do not commit `.env` or uploaded private documents.
