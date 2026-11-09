# Development

## How it works

```
 .mpp file ──► bundled Java runtime + MPXJ ──► JSON ──► Tauri window (Gantt UI)
```

- **[MPXJ](https://github.com/joniles/mpxj)** (LGPL) reads Microsoft's binary `.mpp` format. It also reads Primavera, Asta, GanttProject and other schedule formats.
- **`converter/`** is a small Java program that uses MPXJ to turn a plan into JSON.
- **`scripts/build-converter.sh`** uses `jlink` to build a trimmed private Java runtime, so users don't need Java installed. The runtime includes the JDK's class-data-sharing archive; the app keeps a per-user archive of the converter's classes in `~/Library/Caches/com.leewsimpson.mppviewer`, which makes opening a file about 40% faster.
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

## Tests

Every pull request runs these on GitHub Actions (`.github/workflows/ci.yml`), and a release is only built once they pass.

| Command | What it checks |
| --- | --- |
| `npm run test:converter` | JUnit tests in `converter/src/test`: converts each file in `converter/src/test/resources/fixtures` (Project 98 to 2019 `.mpp`, XML, MPD, a password-protected file) and compares the result with the checked-in `.expected.json` |
| `npm run converter` | Builds the bundled Java runtime, runs the JUnit tests, then converts every fixture with that runtime (catches a Java module missing from it) |
| `npm run test:app` | Rust tests: how the app runs the converter, its class-data-sharing cache and error handling. Needs `npm run converter` and `npm run build` first |
| `npm run test:ui` | Playwright tests of the viewer in Chromium and WebKit (the engine the Mac app uses), including a 5,000-task plan. Run `npx playwright install chromium webkit` once first. `npx playwright test --project=chromium` runs just one browser |

`npm test` runs all of them.

If the converter's output changes on purpose, or after an MPXJ upgrade, regenerate the expected files and review the diff:

```bash
mvn -f converter/pom.xml test -Dgolden.update=true
git diff converter/src/test/resources/fixtures
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

MPXJ is licensed under the LGPL. It and its dependencies are bundled unmodified as separate jars in the app's `converter/lib` folder, with their license texts in `converter/licenses` (see [THIRD-PARTY-NOTICES.md](../converter/licenses/THIRD-PARTY-NOTICES.md)).

`converter/pom.xml` leaves out MPXJ dependencies that only serve formats or features the viewer doesn't use, such as SQLite (Primavera and Asta databases) and Jackson (MPXJ's JSON writer). When upgrading MPXJ, check that list against its new dependencies, then open a few `.mpp` files of different Project versions. MPXJ's [test files](https://github.com/joniles/mpxj/tree/master/junit/data) are useful for this.
