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

if [[ "$(uname)" == "Darwin" ]]; then
  echo "==> Ad-hoc signing runtime binaries (required on Apple Silicon)"
  find "$DIST/runtime" -type f \( -perm -u+x -o -name "*.dylib" \) -print0 \
    | xargs -0 codesign --force --sign - --timestamp=none 2>/dev/null || true
fi

echo "==> Smoke test"
SAMPLE="$ROOT/samples/office-fitout.xml"
if [[ -f "$SAMPLE" ]]; then
  "$DIST/runtime/bin/java" -jar "$DIST/mpp-converter.jar" "$SAMPLE" > /dev/null
  echo "    converted sample OK"
fi

du -sh "$DIST/runtime" "$DIST/lib" | sed 's/^/    /'
echo "==> Done"
