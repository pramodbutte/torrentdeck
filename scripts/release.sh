#!/usr/bin/env bash
#
# Build + publish a signed/notarized release to GitHub.
#
#   scripts/release.sh [mac|win|all]     # default: mac
#
# Credentials are read once from a git-ignored .env.release in the repo root
# (see .env.release.example), and/or from `gh auth` for the GitHub token — so
# you never have to re-enter them. macOS signs with the Developer ID identity
# in your login keychain (no .p12 needed); notarization uses the APPLE_* vars.
#
# Linux (AppImage + deb) is built by CI — push the tag or run the
# "Release (Linux)" workflow — because it needs a Linux host.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO=pramodbutte/torrentdeck

# 1) Load creds from the persistent, git-ignored file (if present).
if [ -f .env.release ]; then
  set -a; . ./.env.release; set +a
fi

# 2) GitHub token: prefer gh's keychain-stored login, fall back to .env.release.
if [ -z "${GH_TOKEN:-}" ] && command -v gh >/dev/null 2>&1; then
  GH_TOKEN="$(gh auth token 2>/dev/null || true)"
fi
export GH_TOKEN
if [ -z "${GH_TOKEN:-}" ]; then
  echo "✗ No GitHub token. Put GH_TOKEN in .env.release, or run 'gh auth login'." >&2
  exit 1
fi

PLATFORM="${1:-mac}"
VERSION="$(node -p "require('./package.json').version")"
TAG="v$VERSION"

if [ "$PLATFORM" = mac ] || [ "$PLATFORM" = all ]; then
  : "${APPLE_ID:?Set APPLE_ID in .env.release (needed to notarize macOS)}"
  : "${APPLE_APP_SPECIFIC_PASSWORD:?Set APPLE_APP_SPECIFIC_PASSWORD in .env.release}"
  : "${APPLE_TEAM_ID:?Set APPLE_TEAM_ID in .env.release}"
fi

# 3) Pre-create the draft release so multi-arch publishers attach to one release
#    instead of each racing to create a duplicate draft.
if command -v gh >/dev/null 2>&1; then
  if ! gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
    echo "▸ creating draft release $TAG"
    gh release create "$TAG" --repo "$REPO" --draft \
      --title "TorrentDeck $VERSION" --notes "Release $VERSION" \
      --target "$(git rev-parse HEAD)"
  fi
fi

echo "▶ building + publishing '$PLATFORM' for $TAG …"
npm run build
case "$PLATFORM" in
  all) npx electron-builder --mac --win --publish always ;;
  *)   npx electron-builder --"$PLATFORM" --publish always ;;
esac

# 4) macOS: Electron 44+ needs macOS 13 (Darwin 22). electron-builder does not put
#    that into latest-mac.yml, and electron-updater only skips an update when the
#    manifest carries `minimumSystemVersion` (a Darwin kernel version, per
#    os.release()), so patch it in after publishing — otherwise Monterey installs
#    would download a 0.1.9+ update that cannot launch.
MAC_MIN_DARWIN="${MAC_MIN_DARWIN:-22.0.0}"
if [ "$PLATFORM" = mac ] || [ "$PLATFORM" = all ]; then
  tmp="$(mktemp -d)"
  gh release download "$TAG" --repo "$REPO" --pattern latest-mac.yml --dir "$tmp"
  node -e '
    const fs = require("node:fs"), yaml = require("js-yaml")
    const [file, min] = process.argv.slice(1)
    const doc = yaml.load(fs.readFileSync(file, "utf8"))
    doc.minimumSystemVersion = min
    fs.writeFileSync(file, yaml.dump(doc, { lineWidth: -1 }))
  ' "$tmp/latest-mac.yml" "$MAC_MIN_DARWIN"
  gh release upload "$TAG" "$tmp/latest-mac.yml" --repo "$REPO" --clobber
  echo "▸ latest-mac.yml: minimumSystemVersion=$MAC_MIN_DARWIN (macOS 13+)"
fi

echo
echo "✓ '$PLATFORM' published to the $TAG draft release. Review + publish it:"
echo "  https://github.com/$REPO/releases/tag/$TAG"
echo "  Linux: push the tag or run  gh workflow run 'Release (Linux)' --repo $REPO"
