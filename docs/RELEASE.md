# Test releases

Live testing uses a manually deployed build of one checked commit. Use Shakespeare's preview/deploy controls for a Shakespeare-hosted site, or the GitHub Actions workflow for GitHub Pages. Nothing deploys automatically: `.github/workflows/deploy.yml` only runs when started by hand.

## Shakespeare preview and deployment

1. Import or pull `https://github.com/ERP-FTW/village_vibe` with branch **`almost`**. Export any unsynced local changes before reconciling an existing Shakespeare project. A working local preview does not mean its edits reached GitHub.
2. Use Shakespeare's **Build** action, then open the preview. Its browser builder uses esbuild, not this project's Vite configuration or npm scripts. It defines `import.meta.env` as `{}`, so `BASE_URL` is absent. The app defaults both routing and generated share/QR URLs to `/` in that case.
3. For a Shakespeare subdomain or a custom domain served at its root, use **`/`**, not `/village_vibe/`. Do not hardcode the Pages prefix into the router. The `/village_vibe/` setting belongs to the separate GitHub Pages build below.
4. Check the home page, Tribes, Village, About, and the mobile menu. Directly open and reload `/tribes` and a real event/tribe link. Check a generated share/QR link; it must use the deployed origin with no `undefined` or unwanted `/village_vibe/` prefix.
5. In the preview pane's menu, choose **Deploy**, select the Shakespeare deployment provider and site/subdomain, and complete its deployment flow. Check the resulting live URL separately from the preview. Record the source commit you pulled, any local edits, and the live URL.

The GitHub Actions workflow creates `build-info.json`; Shakespeare's builder does not run that workflow or create that receipt. Do not use its absence on a Shakespeare deployment as evidence of a failed build. Similarly, `npm run deploy` targets the existing Nostr deployment CLI, not Shakespeare's preview-pane deployment flow.

If the GitHub connection is still unavailable, export your local project and import a fresh copy of `almost` once access is restored. The repository repair does not change Shakespeare's GitHub credentials or local project history. Avoid overwriting unrelated unsynced work while reconciling the two copies.

### Why the preview was blank

The reported `Cannot read properties of undefined (reading 'replace')` happened while importing the router, before React rendered. `routerBasename()` assumed Vite's `BASE_URL` always existed. The same assumption in URL generation could produce malformed share and QR links. Both now pass through `normalizeBasePath()`, which uses `/` when the value is missing or empty and preserves explicit subpaths.

The transcript's relay/config edits were diagnostic attempts. `AppProvider` already validates stored settings and `useLocalStorage` catches malformed JSON/schema failures and returns the default config. Adding a blank-screen guard or different fallback relays in each component is not needed for this failure. No debug page, debug logging, or speculative relay changes are included in the repair.

References: [Shakespeare's builder](https://github.com/soapbox-pub/shakespeare/blob/75f3d6caebd29ae4d8b9c9a87df3797b556c0df4/src/lib/build/index.ts), [official deployment guide](https://soapbox.pub/blog/shakespeare-deploying-sharing-projects).

## GitHub Pages

### One-time setup

1. Choose the host and path the test site is served from:
   - **GitHub Pages project site:** `https://erp-ftw.github.io/village_vibe/`, so the base path is `/village_vibe/`.
   - **Custom domain at its root:** for example `https://test.example.org/`, so the base path is `/`. Configure the domain in the repository's Pages settings first.
2. In the repository's **Settings → Pages**, set the source to **GitHub Actions**.
3. Optionally, add required reviewers to the `github-pages` environment, so each deployment waits for approval.

The base path drives everything that depends on where the app lives:

- Vite's asset base, from `VITE_BASE_PATH`;
- the router's basename;
- share and QR links (`src/lib/appUrl.ts`);
- the manifest, which uses relative paths.

`npm run build` writes `dist/404.html`, a copy of `index.html`. GitHub Pages serves it for unknown paths, so direct links and reloads of client-side routes load the app.

### Deploying a commit

1. Make sure the commit passed review and CI.
2. Go to **Actions → Deploy test build to GitHub Pages → Run workflow**, and enter:
   - `ref`: the full commit SHA;
   - `base_path`: the path chosen above.
3. The workflow checks out that commit and runs `npm ci` and `npm test`. That covers the type check, lint, tests and the production build with the base path.
4. It then writes `build-info.json`: commit, requested ref, base path, build time and workflow run.
5. Before uploading, the job summary records the currently live `build-info.json`. That is the rollback reference. The deploy job only runs after the build job succeeds.

## Checks after deploying (before inviting testers)

Run these against the deployed URL in a desktop and a mobile browser:

- [ ] For a GitHub Actions deployment, `<site>/build-info.json` shows the commit you meant to deploy. For Shakespeare, record the pulled commit and any local changes before building.
- [ ] The root URL loads.
- [ ] Direct loads and reloads work for each route type:
  - `/tribes`;
  - a tribe `/tribe/<pubkey>:<d>`;
  - an event `/event/<pubkey>:<d>`;
  - a story `/story/<pubkey>:<d>`;
  - a profile or NIP-19 link (`/npub1…`, `/naddr1…`);
  - a hashtag `/t/<tag>`;
  - `/messages`.
- [ ] All assets load from under the base path (no 404s in the network panel).
- [ ] The mobile menu opens and its links keep the base path.
- [ ] Share links and the tribe services QR point at the deployed base path.

The same route, asset and navigation checks can be run locally before deploying:

1. Build with `VITE_BASE_PATH=/village_vibe/ npm run build`.
2. Serve `dist/` under `/village_vibe/`, with unknown paths answered by `404.html`.

## Rolling back a GitHub Pages deployment

Re-run the workflow with the previous commit SHA, which is shown in the job summary of the deployment that replaced it. Pages deployments are also listed under the `github-pages` environment.

## Live test plan

- **Identities and content.** Use dedicated test identities, and mark test content clearly (for example a `[TEST]` title prefix).
- **Flows to exercise:**
  - member-created tribe content;
  - an event with an RSVP and a check-in;
  - a service response;
  - a story;
  - trusted promotion and hiding;
  - two-way encrypted direct messages.
- **Forced relay failure.** Block a relay, for example with browser devtools request blocking or offline mode. Check that drafts survive and that no success message appears before a relay accepts the event.
- **Second account.** Verify each published item from a second browser and account.
- **Independent client.** Check direct messages with an independent NIP-17 client.
- **Record for each check:**
  - relay URLs;
  - event IDs;
  - browser and signer;
  - the source commit (from `build-info.json` for GitHub Actions, or the recorded Shakespeare project revision and local changes);
  - the result.

  Keep message plaintext, private keys and other credentials out of the record.
