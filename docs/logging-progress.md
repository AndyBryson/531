# Logging and Drive sync: progress log

Tracks the build of `docs/logging-plan.md`. Work happens on the `dev` branch; `main` is not touched. Build order agreed with Andy: steps 1, 2, 3, 5, then 4 (Google) last.

## Done

### Step 1: Pages via Actions, dev at /531/dev/
- `.github/workflows/pages.yml` checks out `main` and `dev`, copies `main` to the site root and `dev` to `/dev/` (skipping tests, docs, `.github`, package files), and deploys with `actions/deploy-pages`. Runs on push to `main` or `dev`, and by hand (`workflow_dispatch`).
- `IS_DEV` in `index.html`: true when the path contains `/dev/` or the host is `localhost`/`127.0.0.1`. Shows a DEV banner and prefixes the tab title with `[DEV]`.
- Tests: `test/logging-test.js` (new file; `npm test` runs both test files). It has a `load()` helper that opens the page in jsdom at any URL, with optional fake IndexedDB and fake Google.

## Next
- Step 2: IndexedDB store and logging view.

## Decisions the plan did not cover
- The workflow file lives on `dev` only until `dev` is merged into `main`. Until then a push to `main` does not redeploy; a push to `dev` (or running the workflow by hand on `dev`) republishes both. Merging dev into main fixes this.
- The `github-pages` environment only allowed `main` and `gh-pages` to deploy; `dev` was added as an allowed branch.
