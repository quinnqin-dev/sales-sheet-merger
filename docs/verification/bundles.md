# Bundle and first-use measurements

Both revisions built locally with the same dependencies and compressed using Node Brotli quality 11. Decimal KB (1 KB = 1,000 bytes). These compression settings differ from the supplied baseline; raw sizes match that baseline. Raw measured bytes are in bundle-before.json and bundle-after.json.

| Asset | Before raw / br KB | After raw / br KB |
|---|---:|---:|
| Main JS | 357.55 / 92.74 | 345.65 / 91.77 |
| CSS | 28.49 / 6.20 | 33.38 / 6.60 |
| Processing worker | 1,956.47 / 458.32 | 176.95 / 48.71 |
| Reader | included in worker | 835.18 / 195.46 |
| Writer | included in worker | 5.20 / 1.75 |
| Shared ZIP module | included in worker | 14.77 / 6.06 |
| Service worker | absent | 1,921.87 / 464.69 |

The UI also loads the template editor and guide only when used. Reader imports are scheduled with requestIdleCallback. The writer module is imported when Start merge is clicked. Cold preview interactive timing is in interactive.json (Chromium, fresh browser context).

To keep connect-src 'none' on **every response including sw.js**, immutable build resources are embedded in the service worker for installation using Cache.put. This adds an offline installation payload; it includes the writer's bytes, although the separate writer chunk is neither imported nor requested by the page before merge. Offline availability and avoiding all initial download of writer bytes cannot both be guaranteed. No spreadsheet data is stored in Cache Storage; it remains in IndexedDB.
