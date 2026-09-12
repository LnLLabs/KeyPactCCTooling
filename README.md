# BSP CC — Brothership Pool Constitutional Committee tooling

Vite + React app for Keypact cold registration and CIP-30 committee voting.

**Deploy / GitHub Pages:** see [DEPLOY.md](DEPLOY.md) (step-by-step manual setup for `cc.brothershipool.org`).

## Local development

```bash
npm install
npm run dev
```

Configure Blockfrost and DeepSeek in the in-app **Settings** page (stored in the browser). Optional `VITE_*` values in `.env` only seed non-secret URLs on first load — see `.env.example`.

## Build

```bash
npm run build
```

Output is `dist/` (static hosting).
