# MPP Viewer

A free, offline viewer for Microsoft Project files on macOS.

Open `.mpp`, `.mpt` or Project `.xml` files and see the task list and Gantt chart: outline levels, dates, progress, resources, dependency links, critical path and baselines. Everything runs on your Mac; nothing is uploaded.

## Download

Get `MPP-Viewer-<version>.dmg` from the [Releases page](../../releases). It's built for Apple Silicon Macs (M1 or later).

Open the `.dmg` and drag **MPP Viewer** to Applications. The app isn't notarised by Apple, so macOS will block it the first time. Run this once in Terminal:

```bash
xattr -dr com.apple.quarantine "/Applications/MPP Viewer.app"
```

Then open it normally. You can also double-click `.mpp` files or drag them onto the window.

## Features

- Task grid with outline (expand/collapse), duration, start, finish and % complete
- Gantt chart with day, week, month and quarter zoom
- Dependency arrows for all link types (FS, SS, FF, SF), with lag
- Critical path and baseline overlays
- Task details: resources, predecessors, successors and notes
- Search by task or resource name (Enter / Shift+Enter to step through matches)
- Light and dark mode
- Keyboard: ⌘O open, ⌘F find, ↑/↓ move, ←/→ collapse/expand

## How it works

```
 .mpp file ──► bundled Java runtime + MPXJ ──► JSON ──► Tauri window (Gantt UI)
```

- **[MPXJ](https://github.com/joniles/mpxj)** (LGPL) does the hard part: reading Microsoft's binary `.mpp` format. It also reads Primavera, Asta, GanttProject and other schedule formats.
- **`converter/`** is a small Java program that uses MPXJ to turn a plan into JSON.
- **`scripts/build-converter.sh`** uses `jlink` to build a trimmed private Java runtime, so users don't need Java installed.
- **`src-tauri/`** is the Rust/Tauri app shell. It runs the converter locally and handles "Open With" from Finder.
- **`src/`** is the viewer UI: plain JavaScript and SVG with no network access.

## Releasing a new version

Builds run on GitHub Actions (`.github/workflows/release.yml`), so you don't need any developer tools installed.

1. Update `version` in `src-tauri/tauri.conf.json` and `package.json`.
2. Create and push a tag:
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
3. About 10 minutes later, the `.dmg` appears on the Releases page.

You can also create the tag from GitHub's web UI: **Releases → Draft a new release → Choose a tag → type `v0.1.0` → Create new tag**, then publish. The workflow attaches the disk image to that release.

To build without publishing, use the **Actions** tab (**Build & Release → Run workflow**) and download the image from the run's **Artifacts** section.

## Building locally

Requirements: JDK 21+ (with `jlink`), Maven, Node 22+, Rust (stable).

```bash
npm install
npm run converter        # builds converter/dist (jar + Java runtime)
npm run tauri dev        # run the app in development mode
npm run app              # build a release .app and .dmg into src-tauri/target/release/bundle
```

### Signing and notarising (macOS)

Needs a **Developer ID Application** certificate in your keychain. Set these in your shell (never commit them), then run `npm run app`:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="app-specific-password"   # from appleid.apple.com
export APPLE_TEAM_ID="TEAMID"
```

The bundled Java runtime is signed with the same identity and the entitlements in `src-tauri/Entitlements.plist`. Without these variables the build falls back to ad-hoc signing. Check the result with `codesign --verify --deep --strict --verbose=2 "MPP Viewer.app"` and `spctl -a -vv "MPP Viewer.app"`.

### Releasing

Releases are automatic. Change `version` in `src-tauri/tauri.conf.json` (and the same number in `package.json` and `src-tauri/Cargo.toml`) and merge to `main`. If there's no release for that version yet, GitHub Actions builds a signed, notarised Apple Silicon `.dmg`, tags `vX.Y.Z` and publishes the release. Run the workflow by hand from the Actions tab to get a test build without publishing.

CI needs these repository secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | base64 of the Developer ID Application `.p12` (`base64 -i cert.p12 \| pbcopy`) |
| `APPLE_CERTIFICATE_PASSWORD` | password used when exporting the `.p12` |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Lee Simpson (62NZPLH52Q)` |
| `APPLE_ID` | Apple ID email |
| `APPLE_PASSWORD` | app-specific password |
| `APPLE_TEAM_ID` | `62NZPLH52Q` |

Without them the build still runs, ad-hoc signed and not notarised.

For UI-only work you can run `npm run dev` and open `http://localhost:1420/?sample` in a browser. It loads `samples/office-fitout.json` (made with the converter) without needing Tauri.

To regenerate the sample plan:

```bash
java -cp converter/dist/mpp-converter.jar dev.mppviewer.SampleProject samples/office-fitout.xml
java -jar converter/dist/mpp-converter.jar samples/office-fitout.xml > samples/office-fitout.json
```

## Limitations

- Read-only. MPXJ can't write `.mpp` files (it can write Project XML, which MS Project opens, if editing is ever added).
- Password-protected `.mpp` files can't be opened.
- The app is about 100 MB because it includes its own Java runtime.

## Third-party software

MPXJ is licensed under the LGPL. It and its dependencies are bundled unmodified as separate jars in the app's `converter/lib` folder.
