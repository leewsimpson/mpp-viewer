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
(cd "$CONV" && mvn -q -B package)

echo "==> Preparing $DIST"
rm -rf "$DIST"
mkdir -p "$DIST"
cp "$CONV/target/mpp-converter.jar" "$DIST/"
cp -R "$CONV/target/lib" "$DIST/lib"

# Java modules MPXJ and its libraries use (found with jdeps), plus charsets for
# older/MPX files, locale data for date parsing and zipfs for zipped formats.
MODULES="java.base,java.compiler,java.desktop,java.logging,java.naming,java.net.http,java.prefs,java.scripting,java.sql,java.xml,jdk.charsets,jdk.localedata,jdk.zipfs"
echo "==> Java modules: $MODULES"

echo "==> Linking private runtime"
jlink \
  --add-modules "$MODULES" \
  --strip-debug \
  --no-header-files \
  --no-man-pages \
  --compress zip-6 \
  --output "$DIST/runtime"

# jlink output has read-only files; Tauri copies them on every build and
# can't overwrite its own read-only copies ("Permission denied").
chmod -R u+w "$DIST"

if [[ "$(uname)" == "Darwin" ]]; then
  if [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
    # Notarisation needs every nested binary signed with the hardened runtime
    # and a secure timestamp, using the same identity as the app.
    echo "==> Signing runtime binaries with: $APPLE_SIGNING_IDENTITY"
    find "$DIST/runtime" -type f \( -perm -u+x -o -name "*.dylib" \) -print0 \
      | xargs -0 codesign --force --options runtime --timestamp \
          --entitlements "$ROOT/src-tauri/Entitlements.plist" \
          --sign "$APPLE_SIGNING_IDENTITY"
  else
    echo "==> Ad-hoc signing runtime binaries (required on Apple Silicon)"
    find "$DIST/runtime" -type f \( -perm -u+x -o -name "*.dylib" \) -print0 \
      | xargs -0 codesign --force --sign - --timestamp=none 2>/dev/null || true
  fi
fi

echo "==> Smoke test"
SAMPLE="$ROOT/samples/office-fitout.xml"
if [[ -f "$SAMPLE" ]]; then
  # stdout must be pure JSON: stray library output there breaks the viewer's parser.
  FIRST="$("$DIST/runtime/bin/java" -jar "$DIST/mpp-converter.jar" "$SAMPLE" 2>/dev/null | head -c 1)"
  [[ "$FIRST" == "{" ]] || { echo "Converter stdout is not pure JSON" >&2; exit 1; }
  echo "    converted sample OK"
fi

du -sh "$DIST/runtime" "$DIST/lib" | sed 's/^/    /'
echo "==> Done"
