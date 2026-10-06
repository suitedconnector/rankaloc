# rankaloc

Local business rank tracking. **Step 1:** a Cloudflare Worker that runs one local SEO grid scan
(5x5 points, 0.5 mile apart) through the DataForSEO Google Maps SERP API and stores the result in KV.

## How a scan works

1. `GET /` shows a form: place ID, keyword, center coordinates (`latitude,longitude`), and an optional zoom (3-21, default 15).
2. Submitting it (`POST /scan`) computes the 25 grid points and posts one DataForSEO Standard-queue task per point
   (`task_post`, one request, well inside the 100-task limit). Each task uses `search_this_area: true`,
   `language_code: "en"` and `location_coordinate: "lat,lng,15z"`. The scan is saved to KV as `pending`.
3. The Standard queue takes up to about 5 minutes, so the Worker does not wait inside one request.
   **Each `GET /scan/:id` checks the tasks still pending** (`task_get/advanced/{id}`), saves any finished ones,
   and returns the stored JSON. It calls DataForSEO at most once per 10 seconds per scan, and the progress page
   shown after submitting re-reads `/scan/:id` every 10 seconds until `status` is `complete`.
   Nothing runs in the background: if nobody reads the scan, nothing is checked (results stay available
   at DataForSEO for 30 days).
4. Per point, `rank` is the `rank_group` of the `maps_search` item whose `place_id` equals the entered place ID,
   or `null` if it is not among the results. `rank_group` ignores paid items; `rank_absolute` would count them.

## Setup

Requires Node 20+ and a DataForSEO account (API login and password from <https://app.dataforseo.com/api-access>).

```bash
npm install
```

### 1. KV namespace

```bash
npx wrangler kv namespace create SCANS
```

Paste the printed `id` into `wrangler.toml` (replace `REPLACE_WITH_KV_NAMESPACE_ID`). For `wrangler dev` the
placeholder is fine: local dev uses a simulated KV.

### 2. Secrets

Credentials are read from the Worker secrets `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` (grid scans) and `GOOGLE_PLACES_API_KEY` (the "Find business" lookup, Places API (New) Text Search). They are never in the repo.

For a deployed Worker:

```bash
npx wrangler secret put DATAFORSEO_LOGIN
npx wrangler secret put DATAFORSEO_PASSWORD
npx wrangler secret put GOOGLE_PLACES_API_KEY
```

For `wrangler dev`, copy the example file and fill it in (`.dev.vars` is gitignored):

```bash
cp .dev.vars.example .dev.vars
```

## Run locally

```bash
npx wrangler dev
```

Open <http://localhost:8787>, fill in the form, and submit. The scan JSON is at `http://localhost:8787/scan/<id>`.
Real scans spend DataForSEO credit, so check the `costUsd` field of the first scan before running more.

```bash
npm run typecheck
```

## Stored data

KV key `scan:<id>`, one JSON value:

```jsonc
{
  "id": "…", "timestamp": "2026-10-03T22:27:13.919Z",
  "status": "pending | complete",
  "inputs": { "placeId": "…", "keyword": "…", "center": { "lat": 0, "lng": 0 }, "zoom": 15, "languageCode": "en" },
  "points": [
    { "row": 0, "col": 0, "lat": 0, "lng": 0, "rank": 2, "state": "done | pending | error",
      "taskId": "…", "checked": 20, "error": null }
  ],
  "costUsd": 0,          // sum of the cost DataForSEO returned for task_post
  "lastPolledAt": null, "lastError": null
}
```

`points` run row by row, north to south, west to east. `checked` is how many `maps_search` results were looked at.
A point in `error` state has the DataForSEO message in `error`; the scan still completes.
Tasks not ready after 30 minutes are marked as errors.

## Out of scope for step 1

No cron or scheduling, no results viewer beyond the raw JSON, no auth on the Worker, no deployment.
