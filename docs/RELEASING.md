# Releasing TorrentDeck

Releases are built **locally for macOS & Windows** and **by CI for Linux**, then published
to a single GitHub Release. The in-app auto-updater (electron-updater) consumes each
release's `latest*.yml`, so there is **no separate update server** — the public GitHub
release *is* the update backend.

Why the split: macOS code-signing needs the Developer ID identity in your login keychain,
and importing the `.p12` into a keychain **fails on the GitHub macOS runners** (see
[Gotchas](#gotchas)). Windows NSIS builds fine locally (no wine needed). Linux AppImage +
deb need a Linux host, so CI builds those.

## One-time setup

1. **Tools**
   - Node 22 (`nvm use`), and the GitHub CLI: `brew install gh`.
   - macOS signing identity: **"Developer ID Application: Pramod Butte (3U86H8PJF6)"** must
     be in your login keychain (`security find-identity -v -p codesigning`). Signing uses
     it automatically — no `.p12` needed locally.

2. **GitHub auth** — `gh auth login` (token stored in the OS keychain). The release script
   reads it via `gh auth token`, so you never put it in a file.

3. **Apple notarization creds** — copy the template and fill in the two Apple values once:
   ```sh
   cp .env.release.example .env.release      # git-ignored; persists
   # set APPLE_ID and APPLE_APP_SPECIFIC_PASSWORD (APPLE_TEAM_ID is already 3U86H8PJF6)
   ```
   - `APPLE_APP_SPECIFIC_PASSWORD` comes from
     [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security →
     **App-Specific Passwords**.
   - You can also put `GH_TOKEN` here instead of using `gh auth login`.

`.env.release` is git-ignored (`.gitignore` has `.env.*` + `!.env.release.example`) and is
meant to **persist** — don't delete it.

## Cutting a release

```sh
# 1. Bump the version and commit
npm version <new-version> --no-git-tag-version     # e.g. 0.1.2  → edits package.json
git commit -am "chore(release): <new-version>"
git push

# 2. Build + publish macOS and Windows locally (each attaches to one draft release)
scripts/release.sh mac      # signed + notarized dmg/zip  → draft GitHub release
scripts/release.sh win      # NSIS x64/arm64
#   (or: scripts/release.sh all)

# 3. Build + publish Linux via CI (needs a Linux host)
git tag v<new-version> && git push origin v<new-version>
#   — or, without moving the tag:  gh workflow run "Release (Linux)" --repo pramodbutte/torrentdeck
#   — dry run (build only, no release touched; artifacts attached to the run):
#       gh workflow run "Release (Linux)" --repo pramodbutte/torrentdeck -f publish=false

# 4. Review the draft, then publish it as the latest release
gh release edit v<new-version> --repo pramodbutte/torrentdeck --draft=false --latest
#   (add notes with --notes-file first if you like)
```

`scripts/release.sh`:
- sources `.env.release` and resolves the GitHub token (`.env.release` → else `gh auth token`),
- **pre-creates the draft release** so the multi-arch publishers don't each create one (the
  [duplicate-draft race](#gotchas)),
- runs `npm run build` then `electron-builder --<platform> --publish always`.

After step 4, existing installs auto-update on their next launch (or via **Settings → Check
for updates…**).

## What each platform ships

| Platform | Artifacts | Signing | Auto-update |
| --- | --- | --- | --- |
| macOS (arm64 only — Apple Silicon) | `.dmg`, `.zip` (+ blockmaps), `latest-mac.yml` | Developer ID **signed + notarized** | ✅ (updates from the `.zip`) |
| Windows (x64 + arm64) | `TorrentDeck-Setup-*.exe` (+ blockmap), `latest.yml` | unsigned (SmartScreen warns) | ✅ |
| Linux (x64) | `.AppImage` (+ `.AppImage.zsync`), `.deb`, `latest-linux.yml` | unsigned | AppImage ✅ (electron-updater, and AppImageUpdate via the zsync) · **deb: manual** (apt/dpkg) |

## Auto-update

- Config: the `publish` block in `electron-builder.yml` (`provider: github`,
  `owner: pramodbutte`, `repo: torrentdeck`) is baked into `app-update.yml` in the packaged
  app. Public repo → clients need no token.
- Behavior (`src/main/updater.ts`): checks **on launch**, **every 6 h**, and **manually**
  from the Settings menu. Background checks are silent unless an update is found; a downloaded
  update is a **Pending Update** — a one-time notification per version plus a badge on the
  Settings menu, installed only when the user explicitly picks *Restart to install* (quitting
  or restarting never applies it). All stages are logged to the app
  log (`~/Library/Logs/TorrentDeck/main.log`, etc.).
- macOS auto-update requires the app be **signed** (it is) and the release contain the
  **`.zip`** (electron-updater updates from the zip, not the dmg) — both are shipped.

## Linux AppImage

- **Static runtime** — `toolsets.appimage: "1.0.3"` in `electron-builder.yml` builds the
  AppImage on AppImage's static type2 runtime (20251108), so it runs without `libfuse2`
  (Ubuntu 22.04+ and Fedora no longer ship it). Unset, electron-builder falls back to the
  legacy FUSE2 runtime that the AppImage catalog flagged.
- **AppImageUpdate support** — `build/appimageUpdateInfo.cjs` (hooked in as
  `artifactBuildCompleted` + `afterAllArtifactBuild`) writes the update string
  `gh-releases-zsync|<owner>|<repo>|latest|TorrentDeck-*.AppImage.zsync` into the runtime's
  `.upd_info` ELF section, rebuilds the embedded blockmap so `latest-linux.yml` and
  electron-updater's differential download stay correct, and publishes
  `TorrentDeck-<ver>.AppImage.zsync` next to the AppImage. `zsyncmake` must be on PATH: CI
  installs the `zsync` apt package; a local build without it fails only when `CI` is set,
  otherwise it just skips the `.zsync`. `latest` in the update string means the latest
  **non-draft, non-prerelease** release, so step 4 above is what makes a new version visible
  to AppImageUpdate.
- **AppImage catalog** — TorrentDeck is listed at https://appimage.github.io (entry
  `data/TorrentDeck` in AppImage/appimage.github.io, added by PR #6455). Its checker always
  flags Electron AppImages as "not self-contained" (they link the system glibc); that is
  expected and not fixable.

## Gotchas (all hit and worked around)

- **CI macOS signing is broken** — `security import` of the `.p12` fails on the
  macos-latest (Sequoia) runners: electron-builder's own import gives *"SecKeychainItemImport:
  parameters not valid"*, and `apple-actions/import-codesign-certs` gives *"Unable to decode"*
  for a legacy (RC2) `.p12` (Sequoia dropped RC2). **Resolution: build macOS locally.**
- **base64 `CSC_LINK` is misread as a file path** by electron-builder (base64 can contain
  `/`). Irrelevant now (local signing uses the keychain), but don't reintroduce it.
- **Duplicate-draft race** — when no release exists, the mac dmg + zip publishers can each
  create a draft → two releases. **Resolution:** `scripts/release.sh` pre-creates the draft
  first. If you ever see two drafts, delete one with
  `gh api -X DELETE repos/pramodbutte/torrentdeck/releases/<id>`.
- **Linux `.deb` needs a maintainer** — `package.json` must have `author.email` (it does).
- **CI publish 403** — the workflow sets `permissions: contents: write` so `GITHUB_TOKEN`
  can create/upload the release.
- **CI secrets** (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_*`) exist in the repo but are
  **unused** now that CI is Linux-only — harmless; safe to remove if desired.

## Windows code-signing (optional, future)

The Windows installer is unsigned, so SmartScreen shows a warning. To remove it you'd need
an Authenticode (EV or OV) certificate and would set `CSC_LINK`/`CSC_KEY_PASSWORD` for the
`win` build. Not required for functionality or auto-update.
