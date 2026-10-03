// Constants. Each documented value cites the DataForSEO page it comes from.

export const DFS_BASE_URL = "https://api.dataforseo.com";

/** Grid: 5x5 = 25 points, 0.5 mile between adjacent points. */
export const GRID_SIZE = 5;
export const SPACING_MILES = 0.5;

/**
 * location_coordinate is "latitude,longitude,zoom" and zoom defaults to 17z, range 3z-21z
 * (task_post docs). The docs do not say what area each zoom covers, so this default is a
 * starting point to judge from a test scan; the form lets you override it per scan.
 */
export const DEFAULT_ZOOM = 17;
export const MIN_ZOOM = 3;
export const MAX_ZOOM = 21;

/** language_code is required by task_post; the docs' example is "en". */
export const LANGUAGE_CODE = "en";

/** task_post accepts up to 100 tasks per POST (error 40006 above that). */
export const MAX_TASKS_PER_POST = 100;

/** Max simultaneous task_get calls. Cloudflare allows 6 open connections per invocation. */
export const CONCURRENCY = 6;

/** GET /scan/:id will not call DataForSEO again if the last poll was this recent. */
export const POLL_MIN_INTERVAL_MS = 10_000;

/**
 * Standard queue is "up to 5 minutes" (DataForSEO Maps SERP pricing page). Tasks still
 * not ready after this long are marked as errors instead of being polled forever.
 */
export const MAX_WAIT_MS = 30 * 60 * 1000;
