# Test releases

Live testing uses a manually deployed build of one reviewed commit. Nothing deploys automatically: `.github/workflows/deploy.yml` only runs when started by hand.

## One-time setup

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

## Deploying a commit

1. Make sure the commit passed review and CI.
2. Go to **Actions → Deploy test build to GitHub Pages → Run workflow**, and enter:
   - `ref`: the full commit SHA;
   - `base_path`: the path chosen above.
3. The workflow checks out that commit and runs `npm ci` and `npm test`. That covers the type check, lint, tests and the production build with the base path.
4. It then writes `build-info.json`: commit, requested ref, base path, build time and workflow run.
5. Before uploading, the job summary records the currently live `build-info.json`. That is the rollback reference. The deploy job only runs after the build job succeeds.

## Checks after deploying (before inviting testers)

Run these against the deployed URL in a desktop and a mobile browser:

- [ ] `<site>/build-info.json` shows the commit you meant to deploy.
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

## Rolling back

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
  - the source commit (from `build-info.json`);
  - the result.

  Keep message plaintext, private keys and other credentials out of the record.
