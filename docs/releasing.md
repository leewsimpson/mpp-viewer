# Releasing

## Automatic releases

Releases are built by GitHub Actions (`.github/workflows/release.yml`), so no local developer tools are needed.

1. Change `version` in `src-tauri/tauri.conf.json`, and use the same number in `package.json` and `src-tauri/Cargo.toml`.
2. Merge to `main`.

If there's no release for that version yet, the workflow builds a signed, notarised Apple Silicon `.dmg`, tags `vX.Y.Z` and publishes the release.

To get a test build without publishing, open the **Actions** tab, choose **Build & Release → Run workflow**, then download the `.dmg` from the run's **Artifacts** section.

## CI secrets

Add these under **Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | base64 of the Developer ID Application `.p12` (`base64 -i cert.p12 \| pbcopy`) |
| `APPLE_CERTIFICATE_PASSWORD` | password used when exporting the `.p12` |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Lee Simpson (62NZPLH52Q)` |
| `APPLE_ID` | Apple ID email |
| `APPLE_PASSWORD` | app-specific password |
| `APPLE_TEAM_ID` | `62NZPLH52Q` |

Without them the build still runs, but it's ad-hoc signed and not notarised.

## Signing and notarising locally

You need a **Developer ID Application** certificate in your keychain. Set these in your shell (never commit them), then run `npm run app`:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="app-specific-password"   # from appleid.apple.com
export APPLE_TEAM_ID="TEAMID"
```

The bundled Java runtime is signed with the same identity and the entitlements in `src-tauri/Entitlements.plist`. Without these variables the build falls back to ad-hoc signing.

Check the result with:

```bash
codesign --verify --deep --strict --verbose=2 "MPP Viewer.app"
spctl -a -vv "MPP Viewer.app"
```
