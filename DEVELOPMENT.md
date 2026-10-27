# Development

This guide is for contributors and maintainers. End users should open the hosted app at <https://sheet-merger-80c7.onrender.com/>.

## Architecture

The active application is a static React and TypeScript frontend built with Vite. Spreadsheet parsing, conversion, merging, and export run in a browser Web Worker. Templates, rules, uploaded files, processing rows, and the current workspace are stored in the browser's IndexedDB for the current site origin.

The frontend makes no API requests. Render serves the production files from `frontend/dist` through its CDN. The `backend/` directory contains the earlier FastAPI implementation, retained for compatibility checks and local reference; the browser app and Render deployment do not use it.

## Local setup

Install Node.js 22.18+ with npm, then run from the repository root:

```sh
npm --prefix frontend ci
npm --prefix frontend run dev
```

Vite serves the development app at <http://127.0.0.1:5173>.

On macOS, `./setup.sh` installs frontend dependencies and creates a production build. `./start.command` serves that build locally at <http://127.0.0.1:4173> and opens it in the browser.

## Render deployment

The root `render.yaml` defines one Render static site:

| Setting | Value |
| --- | --- |
| Runtime | Static |
| Build command | `npm --prefix frontend ci && npm --prefix frontend run build` |
| Publish directory | `frontend/dist` |

The Blueprint does not require Python, a start command, a persistent disk, a database, or environment variables. Changes pushed to `main` are deployed through the connected Render Blueprint.

Templates and rules are stored per browser and site origin. The default Render domain and a future custom domain therefore use separate browser data; export the rule library before changing domains when data needs to be migrated.

## Checks

Run from the repository root:

```sh
npm --prefix frontend run build
npm --prefix frontend run format:check
npm --prefix frontend test
npm --prefix frontend run test:browser -- --project=chromium
```

Install the Playwright Chromium browser first if needed:

```sh
npm --prefix frontend exec playwright install chromium
```

The full browser suite covers offline processing after initial page load, downloads, refresh and tab restoration, template JSON fallback, 100,000-row processing, and the single-workspace tab lock.

When changing the retained Python backend, also run:

```sh
.venv/bin/python -m pytest -q -s
```

Shared English and Chinese messages live in `shared/locales/`. Keep message keys and interpolation placeholders consistent between both catalogs. See `VALIDATION.md` for test coverage and practical limitations.
