# Pages snapshot

Static copy of the public İnecek Var web for the GitHub Pages demo at
`https://ayberkaarda.github.io/Mobiles-5in-One/inecekvar/`. It is taken from the production SSR
build reading a local API with the sample city, so every page shows `[ÖRNEK]` data and stays
`noindex`.

`snapshot.mjs` crawls the running SSR server from the home page, the city hub, the guides and the
fixed content pages, follows the line and stop links, and writes one `index.html` per page plus
`404.html`. It removes every script (JSON-LD stays), so sign-in, the admin area, the deletion
panel, the interactive map and all API calls are off; it rewrites links and assets to the Pages
base path, turns links into the app or the API into plain text, disables buttons and adds a notice
bar at the top of each page.

`check.mjs` serves a checkout of the Pages branch under `/Mobiles-5in-One/` and checks that every
link and asset in the folder resolves and that no `localhost`, `127.0.0.1` or local port is left.

## Steps

1. Start the local stack with its own compose project and ports outside 57277-57776, as in
   ADR-0058 (`INECEKVAR_ENV=local`, `INECEKVAR_HIBP_ENABLED=false`), run the migrations and
   `uv run python -m app.seed`, and start uvicorn on 127.0.0.1 with `--no-proxy-headers`.
2. `pnpm nx run web:build --configuration=production`, then start the server with
   `INECEKVAR_ENV=production IV_WEB_CANONICAL_ORIGIN=https://inecekvar.app`
   `IV_WEB_API_INTERNAL_URL=http://127.0.0.1:<api port>/v1 PORT=<ssr port>`
   `node dist/apps/web/server/server.mjs`.
3. Add a worktree of the Pages branch on a new local branch and run, from the repository root:

   ```sh
   node inecekvar/ops/pages/snapshot.mjs --server http://127.0.0.1:<ssr port> --out <worktree>/inecekvar
   node inecekvar/ops/pages/check.mjs --root <worktree>
   ```

4. List the project in the landing `index.html` of the worktree, commit there, and push the branch
   to `gh-pages` only after the owner has looked at it.

Stop the server, uvicorn and the compose project (`docker compose -p <project> down -v`) afterwards.
