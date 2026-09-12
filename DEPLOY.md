# Deploy BSP CC to GitHub Pages

This app is a static Vite build (`dist/`). Production secrets stay in **browser Settings** (localStorage) — nothing secret goes into GitHub Actions.

**Live target:** `https://cc.brothershipool.org`  
**Repo:** https://github.com/LnLLabs/KeyPactCCTooling

---

## What the automation does

On every push to `main` (and when you run the workflow manually):

1. `npm ci` + `npm run build`
2. Copies `dist/index.html` → `dist/404.html` so React Router paths (`/vote`, `/settings`, …) work on refresh
3. Uploads `dist/` as a Pages artifact and deploys it

Workflow file: [`.github/workflows/pages.yml`](.github/workflows/pages.yml)  
Custom domain file: [`public/CNAME`](public/CNAME) (becomes `dist/CNAME` after build)

---

## A. Enable Pages in the GitHub UI (do this once)

1. Open https://github.com/LnLLabs/KeyPactCCTooling
2. Click **Settings** (repo settings, not your profile)
3. In the left sidebar, open **Pages**
4. Under **Build and deployment → Source**, choose **GitHub Actions**  
   (Do **not** choose “Deploy from a branch” / `gh-pages`.)
5. Leave this tab open; the site URL appears after the first green deploy

---

## B. Push the deploy files

1. Ensure `main` includes the workflow, `public/CNAME`, and this doc
2. Push to GitHub:
   ```bash
   git push origin main
   ```
3. Open the **Actions** tab
4. Click the latest **Deploy GitHub Pages** run
5. Wait until both **build** and **deploy** jobs are green
6. Return to **Settings → Pages**
7. Confirm **Custom domain** shows `cc.brothershipool.org` (from the `CNAME` file)
8. Note **DNS check** / **HTTPS** status (may say pending until DNS is set)

### Manual re-deploy (learning)

1. **Actions** → **Deploy GitHub Pages**
2. **Run workflow** → branch `main` → **Run workflow**
3. Watch the new run complete

---

## C. DNS for `cc.brothershipool.org`

Wherever you manage DNS for `brothershipool.org`:

1. Add a **CNAME** record:
   - **Name / host:** `cc`
   - **Target / value:** `lnllabs.github.io`  
     Org Pages hostname is `{org}.github.io`. With a custom domain, do **not** append the repo name.
2. Save and wait (often a few minutes; sometimes longer)
3. Check from a terminal:
   ```bash
   dig +short cc.brothershipool.org CNAME
   ```
   You want a result that points at `lnllabs.github.io` (or a chain that ends there).
4. Back in **Settings → Pages**, click **Check again** if DNS is still pending
5. When GitHub offers it, enable **Enforce HTTPS** (certificate can take a short while after DNS is correct)

---

## D. Verify the live site

1. Open https://cc.brothershipool.org/ — BSP branding should load
2. Open https://cc.brothershipool.org/settings and **refresh** the page — must not show a GitHub 404 (SPA `404.html` fallback)
3. In **Settings** inside the app, paste your Blockfrost project id and DeepSeek API key  
   (stored only in that browser; not in the Pages deploy)

Temporary URL before DNS works: GitHub also shows a `*.github.io` Pages URL under **Settings → Pages**. Prefer the custom domain once HTTPS is ready.

---

## E. Optional learning checks

- In **Actions**, open a successful run → expand **Upload Pages artifact** / **Deploy to GitHub Pages** and read what each step did
- Open the workflow file on GitHub (**Actions** → workflow name → **Workflow file**) and match it to the YAML in the repo
- Temporarily break `npm run build` locally, push, watch Actions fail, then fix — confirms CI is what publishes the site

---

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Actions never runs | Pages **Source** must be **GitHub Actions**; workflow must live under `.github/workflows/` on `main` |
| Deploy job waits / blocked | Approve the **github-pages** environment if the org requires environment protection rules |
| Custom domain DNS error | CNAME target must be `lnllabs.github.io`; wait for propagation; use `dig` |
| `/settings` 404 on refresh | Confirm the workflow copied `404.html`; re-run the workflow |
| Site old after push | Hard-refresh; check the latest Actions run finished after your commit |

No GitHub Secrets are required for Blockfrost or DeepSeek for this app.
