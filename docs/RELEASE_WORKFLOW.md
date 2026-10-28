# Release workflow

The maintained executable release contract is
[release.yml](../.github/workflows/release.yml). A merge to `main` runs CI but
**does not publish**. Pushing a new `v<package-version>` tag triggers npm
publication; `vscode-v<extension-version>` is the separate VSIX channel.

## Integrate and version

1. Read `AGENTS.md` and `CLAUDE.md`, preserve local changes, fetch the current
   principal branch and inspect related PRs/commit ancestry. Integrate relevant
   unmerged changes without merging unrelated dependency proposals.
2. Select an unused SemVer version: compatible new features require a minor
   release, fixes a patch, and incompatible public contracts a major version.
   Update `package.json` and `CHANGELOG.md`. The lockfile contains no root package
   version; update it only when dependency metadata actually changes.
3. Install with `pnpm install --frozen-lockfile`. Run `pnpm check:release` and
   `pnpm -r --filter './apps/*' --if-present typecheck`. The release gate runs
   types, lint, format, coverage, the separate REPL suite and build.
   CI also packs the build and installs it with `--engine-strict` in a clean
   consumer at the declared minimum Node 22.13.0 before running the package smoke.
   Keep that CI runtime aligned with `engines.node`. Coverage
   thresholds are defined in `vitest.config.ts`; do not weaken them for release.
4. Review the integrated diff, push, create/update a PR and wait for checks on
   its current SHA. Merge with an allowed repository method after they pass.
   Never bypass branch protections. Verify that all intended changes are in
   the resulting principal-branch commit before tagging it.

## Publish through GitHub Actions

Create one new annotated tag at the verified merged commit, matching the npm
package version exactly, then push that tag. Do not tag an unmerged feature
branch. `scripts/release-metadata.mjs` validates package/tag identity and routes
stable versions to `latest`, prereleases to `next`.

The npm job uses the Node 24 LTS version in `.node-version`, pnpm 12.15.0, npm 12.2.1, npm trusted publishing through GitHub OIDC, and
`id-token: write`. It does not need a local npm token. It performs these steps:

1. Install the frozen dependencies and run the release gate, building once.
2. Pack with scripts disabled and record integrity/checksums of the candidate.
3. Install that tarball in an isolated consumer and smoke CLI, package exports
   and a real file-tool round trip plus durable conversation reopen/continuation with a scripted provider.
4. Preserve the candidate as a workflow artifact before publication.
5. Publish that exact tarball with `scripts/publish-npm.mjs`, without rebuilding.
6. Verify registry integrity equals the candidate, install from npm in a new
   consumer and repeat the smoke test.
7. Upload release assets and create the GitHub Release only after successful
   publication and verification. The other product channel is skipped.

Follow the run for the exact tag/commit. A successful merge or a queued workflow
is not proof of publication. Do not launch a competing manual `npm publish`.
The workflow smoke test is deterministic; it does not certify live provider
quality or general product parity.

## Verify the delivered artifact

Check the official registry for the exact version, `dist-tags`, publication time
and `dist.integrity`. Compare integrity against the run's `pack.json` and the
published GitHub release tarball. Trace the run and tag back to the merged
commit; `gitHead` may be absent when publishing a previously packed tarball.
OIDC provenance, when present, supplies additional source/build evidence.

Install the exact registry version in a temporary consumer, without changing a
global installation, and run:

```bash
node scripts/smoke-package.mjs /absolute/path/to/consumer <expected-version>
```

Also inspect the installed runtime/tools for the new public APIs and exercise
critical new behavior. Remove task-only consumers, tarballs and logs after the
results have been recorded.

## Recover a failed or interrupted release

Inspect the failing step and query npm **before retrying**: publication can have
succeeded before a later verification/upload step failed. The publisher accepts
an already-published version only if its integrity and requested dist-tag match
exactly. Unknown registry/auth states stop publication. An acknowledged publish
has a bounded visibility wait; expiry means uncertain outcome, not permission to
publish again blindly.

If a version exists with different integrity, stop and investigate. Never move
or delete a released tag, overwrite an immutable npm version, or change `latest`
to hide a failure. A source/build fix needs a new version and tag. Infrastructure
retries must reconcile and preserve the original verified artifact.

For OIDC rejection, inspect the configured trusted publisher's repository,
workflow identity and npm account policy. Do not print credentials or replace
OIDC with a token merely to circumvent the configured policy. Report external
approval/credential blockers if they cannot be resolved within authorization.

A critical shipped defect should be corrected with a new patch release; any
npm deprecation or dist-tag rollback requires a separately justified decision.
