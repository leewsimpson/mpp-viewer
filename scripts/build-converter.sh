#!/usr/bin/env bash
# Builds the MPXJ converter jar and a trimmed, private Java runtime for it.
# Output: converter/dist/mpp-converter.jar and converter/dist/runtime/
# The Tauri build bundles converter/dist into the app, so the finished
# app needs no Java installed and works fully offline.
#
# Requires JDK 21+ (with jlink/jdeps) and Maven on the build machine only.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONV="$ROOT/converter"
DIST="$CONV/dist"

echo "==> Building converter jar"
# clean, so jars from an older dependency set never end up in the app.
(cd "$CONV" && mvn -q -B clean package)

echo "==> Preparing $DIST"
rm -rf "$DIST"
mkdir -p "$DIST"
cp "$CONV/target/mpp-converter.jar" "$DIST/"
cp -R "$CONV/target/lib" "$DIST/lib"
# License texts the bundled libraries require us to ship (see the notices file).
cp -R "$CONV/licenses" "$DIST/licenses"

# Java modules the bundled jars use (checked with jdeps and a scan of the class
# files), plus charsets for older/MPX files, locale data for date parsing and
# zipfs for zipped formats. java.desktop is needed: MPXJ uses java.awt.Color.
MODULES="java.base,java.compiler,java.desktop,java.logging,java.net.http,java.prefs,java.scripting,java.sql,java.xml,jdk.charsets,jdk.localedata,jdk.zipfs"
# Locale data for every language is about 9 MB; these cover most users. Others
# fall back to English formats, which only affects the rare locale-dependent
# formats such as MPX.
LOCALES="en,de,fr,es,it,pt,nl,sv,da,nb,fi,pl,cs,ru,ja,zh,ko"
# Baked into the runtime so the app and the smoke test below use the same
# settings. The converter is a short-lived process, so the C1 compiler and the
# serial GC start faster. JVM logging is limited to errors and goes to stderr,
# never stdout, which must stay pure JSON.
JVM_OPTIONS="-Xss8m -XX:TieredStopAtLevel=1 -XX:+UseSerialGC -Djava.awt.headless=true -Xlog:disable -Xlog:all=error:stderr"
echo "==> Java modules: $MODULES"

echo "==> Linking private runtime"
# --generate-cds-archive adds the JDK's class-data-sharing archive. It's what
# lets the app keep a per-user archive of the converter's classes (see
# open_project in src-tauri/src/lib.rs), which makes opening a file about 40%
# faster.
jlink \
  --add-modules "$MODULES" \
  --include-locales "$LOCALES" \
  --add-options "$JVM_OPTIONS" \
  --generate-cds-archive \
  --strip-debug \
  --no-header-files \
  --no-man-pages \
  --compress zip-6 \
  --output "$DIST/runtime"

# The JVM only uses the "no compressed oops" archive with heaps over 32 GB.
rm -f "$DIST"/runtime/lib/server/classes_nocoops.jsa

# jlink output has read-only files; Tauri copies them on every build and
# can't overwrite its own read-only copies ("Permission denied").
chmod -R u+w "$DIST"

if [[ "$(uname)" == "Darwin" ]]; then
  # Executables get the JIT entitlements; libraries don't take entitlements.
  EXECUTABLES=()
  while IFS= read -r -d '' f; do EXECUTABLES+=("$f"); done \
    < <(find "$DIST/runtime" -type f -perm -u+x ! -name "*.dylib" -print0)
  LIBRARIES=()
  while IFS= read -r -d '' f; do LIBRARIES+=("$f"); done \
    < <(find "$DIST/runtime" -type f -name "*.dylib" -print0)

  if [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
    # Notarisation needs every nested binary signed with the hardened runtime
    # and a secure timestamp, using the same identity as the app.
    echo "==> Signing runtime binaries with: $APPLE_SIGNING_IDENTITY"
    SIGN=(codesign --force --options runtime --timestamp --sign "$APPLE_SIGNING_IDENTITY")
    "${SIGN[@]}" "${LIBRARIES[@]}"
    "${SIGN[@]}" --entitlements "$CONV/java-runtime.entitlements" "${EXECUTABLES[@]}"
  else
    echo "==> Ad-hoc signing runtime binaries (required on Apple Silicon)"
    codesign --force --sign - --timestamp=none "${LIBRARIES[@]}" "${EXECUTABLES[@]}" 2>/dev/null || true
  fi

  # Apple's notary service also scans inside jars. None of the bundled jars
  # should contain native code (sqlite-jdbc did, and is now excluded); fail
  # loudly if a dependency update brings some back.
  for JAR in "$DIST"/lib/*.jar; do
    if unzip -Z1 "$JAR" | grep -qE '\.(dylib|jnilib)$'; then
      echo "$(basename "$JAR") contains native libraries, which would need signing for notarisation." >&2
      exit 1
    fi
  done
fi

echo "==> Smoke test"
JAVA="$DIST/runtime/bin/java"
CDS_DIR="$(mktemp -d)"
trap 'rm -rf "$CDS_DIR"' EXIT
# Same class-data-sharing flags the app uses.
CDS=(-XX:+AutoCreateSharedArchive "-XX:SharedArchiveFile=$CDS_DIR/converter.jsa")
SAMPLE="$ROOT/samples/office-fitout.xml"
if [[ -f "$SAMPLE" ]]; then
  # stdout must be pure JSON: stray library or JVM output there breaks the
  # viewer's parser. Run twice: the first run writes the archive, the second
  # uses it.
  for RUN in 1 2; do
    "$JAVA" "${CDS[@]}" -jar "$DIST/mpp-converter.jar" "$SAMPLE" > "$CDS_DIR/out.json" 2>/dev/null
    node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$CDS_DIR/out.json" \
      || { echo "Converter stdout is not pure JSON (run $RUN)" >&2; exit 1; }
  done
  [[ -s "$CDS_DIR/converter.jsa" ]] || { echo "Class-data-sharing archive was not created" >&2; exit 1; }
  echo "    converted sample OK"
fi
# Every test fixture through the bundled runtime (the Maven tests run on the
# full JDK, so they can't catch a module missing from the trimmed runtime).
for FIXTURE in "$CONV"/src/test/resources/fixtures/*; do
  case "$FIXTURE" in *.json|*.md|*/readpassword*) continue ;; esac
  "$JAVA" "${CDS[@]}" -jar "$DIST/mpp-converter.jar" "$FIXTURE" > "$CDS_DIR/out.json" 2> "$CDS_DIR/err.txt" \
    || { echo "Could not convert $(basename "$FIXTURE"): $(cat "$CDS_DIR/err.txt")" >&2; exit 1; }
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$CDS_DIR/out.json" \
    || { echo "Converter stdout is not pure JSON for $(basename "$FIXTURE")" >&2; exit 1; }
  [[ ! -s "$CDS_DIR/err.txt" ]] || { echo "Unexpected stderr for $(basename "$FIXTURE"): $(cat "$CDS_DIR/err.txt")" >&2; exit 1; }
done
echo "    converted all test fixtures OK"
# Errors must reach the user as one readable line, without library noise.
echo "not a project" > "$CDS_DIR/bad.mpp"
if ERR="$("$JAVA" -jar "$DIST/mpp-converter.jar" "$CDS_DIR/bad.mpp" 2>&1 >/dev/null)"; then
  echo "Converter accepted an invalid file" >&2; exit 1
fi
[[ "$(printf '%s\n' "$ERR" | wc -l)" -eq 1 ]] || { echo "Unexpected converter error output: $ERR" >&2; exit 1; }
ERR="$("$JAVA" -jar "$DIST/mpp-converter.jar" "$CONV/src/test/resources/fixtures/readpassword9.mpp" 2>&1 >/dev/null || true)"
[[ "$ERR" == *"can't open password-protected files"* ]] || { echo "Unexpected password-protected error: $ERR" >&2; exit 1; }
echo "    error output OK"

du -sh "$DIST/runtime" "$DIST/lib" | sed 's/^/    /'
echo "==> Done"
