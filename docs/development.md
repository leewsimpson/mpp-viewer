# Development

## How it works

```
 .mpp file ──► bundled Java runtime + MPXJ ──► JSON ──► Tauri window (Gantt UI)
```

- **[MPXJ](https://github.com/joniles/mpxj)** (LGPL) reads Microsoft's binary `.mpp` format. It also reads Primavera, Asta, GanttProject and other schedule formats.
- **`converter/`** is a small Java program that uses MPXJ to turn a plan into JSON.
- **`scripts/build-converter.sh`** uses `jlink` to build a trimmed private Java runtime, so users don't need Java installed.
- **`src-tauri/`** is the Rust/Tauri app shell. It runs the converter locally and handles "Open With" from Finder.
- **`src/`** is the viewer UI: plain JavaScript and SVG with no network access.

## Requirements

- JDK 21+ (with `jlink`)
- Maven
- Node 22+
- Rust (stable)

## Building locally

```bash
npm install
npm run converter        # builds converter/dist (jar + Java runtime)
npm run tauri dev        # run the app in development mode
npm run app              # build a release .app and .dmg into src-tauri/target/release/bundle
```

## UI-only work

You can work on the UI without Tauri. Run `npm run dev` and open `http://localhost:1420/?sample` in a browser. It loads `samples/office-fitout.json`, a plan made with the converter.

To regenerate the sample plan:

```bash
java -cp converter/dist/mpp-converter.jar dev.mppviewer.SampleProject samples/office-fitout.xml
java -jar converter/dist/mpp-converter.jar samples/office-fitout.xml > samples/office-fitout.json
```

## Signing and notarising

See [releasing.md](releasing.md).

## Third-party software

MPXJ is licensed under the LGPL. It and its dependencies are bundled unmodified as separate jars in the app's `converter/lib` folder.
