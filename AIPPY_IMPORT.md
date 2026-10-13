# Import into the existing Aippy Engagement Tester

The currently published tester already contains its React UI and Aippy Vite configuration. Apply this repository as an **incremental overlay**.

Manifest:

`https://raw.githubusercontent.com/benryaus-cmd/test2/main/updates/account-activity-13oct2026.json`

It lists four source/target replacements: `src/App.tsx`, `src/components/AccountActivityPanel.tsx`, `src/lib/accountActivityClient.mjs`, and `src/lib/parseProjectInput.ts`.

Aippy's chat cannot directly run Node, but its **normal Vite build** can. Add an import plugin in `vite.config.ts` with a `buildStart` hook calling `importEngagementOverlay()` from `scripts/import-engagement-overlay.mjs`, or implement the same code inline from that published file. It fetches every manifest-listed file using Node's `fetch`, then writes the four exact targets using `fs` and builds the app. The rest of the Aippy host stays in place.

The new UI appears below the existing tester as **My likes and projects**. It uses the current player's `getAuthTokenAsync()` session automatically, tests favourites pagination, and lists both published and unpublished owned projects.

Aippy browser origins (`*.aippy.live`) may require the optional relay at `relay/worker.mjs` because the Aippy API's captured browser response allowed `https://aippy.ai`. The relay is a separate runtime component; Vite build-time Node is not running in the published game. After deploying the Cloudflare Worker, open **Authenticated request route** in the new panel and enter its HTTPS origin. Direct browser requests remain available for testing.

Verification: `node --test tests/accountActivity.test.mjs` and a live Aippy-shell check of project `7102340` under the signed-in account. The Chrome capture for that account showed the project in the user's favourites, so a successful authenticated query should report **YES**.
