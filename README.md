# Aippy Engagement Tester

Code and import overlay for the existing Aippy Engagement Tester. The runtime uses the Aippy shell's signed-in Bearer token to read two verified account APIs: `/api/project` for **owned projects including unpublished drafts**, and `/api/template/favorites/list` for **liked projects**. A liked game is matched by `projectId`, with `id` on a favourites entry being the separate template ID.

The full current Aippy project is maintained as a local import ZIP; the files in this repository are the incremental updates for importing into that existing project.

## Browser request route

Aippy's API returned `Access-Control-Allow-Origin: https://aippy.ai` in Chrome, while published games run on `.aippy.live`. The optional `relay/worker.mjs` performs account-specific GET requests server-side. It uses each player's runtime Bearer token supplied at request time. Deploy the Worker and enter its HTTPS URL in the account panel. Direct browser calls remain available as diagnostics. Node at Vite build time cannot serve as an authenticated relay once a published game is running.

## Tests

Run `node --test tests/accountActivity.test.mjs` after checking out the code.

## Import

See `updates/account-activity-13oct2026.json` and `README-ACCOUNT-INTEGRATION.md`. An Aippy build-time importer can download and replace the exact listed paths using `manifest.baseUrl` and each file's `source`/`target`.