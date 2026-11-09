package dev.mppviewer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.mpxj.Duration;
import org.mpxj.MPXJException;
import org.mpxj.ProjectFile;
import org.mpxj.TimeUnit;
import org.mpxj.reader.UniversalProjectReader;

/**
 * Runs on the same, trimmed set of libraries the app ships (see the
 * exclusions in pom.xml), so a reader that needs a dropped library fails here.
 */
class ConvertTest {

    private static final Path FIXTURES = Paths.get("src/test/resources/fixtures");
    private static final boolean UPDATE = Boolean.getBoolean("golden.update");

    static Stream<String> readableFixtures() throws IOException {
        try (Stream<Path> files = Files.list(FIXTURES)) {
            return files.map(p -> p.getFileName().toString())
                    .filter(n -> !n.endsWith(".json") && !n.endsWith(".md"))
                    .filter(n -> !n.startsWith("readpassword"))
                    .sorted()
                    .toList()
                    .stream();
        }
    }

    /** Compares the converter's output with the checked-in expected JSON. */
    @ParameterizedTest
    @MethodSource("readableFixtures")
    void matchesExpectedOutput(String name) throws Exception {
        ProjectFile project = new UniversalProjectReader().read(FIXTURES.resolve(name).toFile());
        if (project == null) fail("MPXJ did not recognise " + name);
        // One task per line keeps diffs readable. "},{\"uid\":" can't occur
        // inside a JSON string, where quotes are escaped.
        String actual = Convert.toJson(project, name).replace("},{\"uid\":", "},\n{\"uid\":") + "\n";

        Path expectedFile = FIXTURES.resolve(name + ".expected.json");
        if (UPDATE) {
            Files.writeString(expectedFile, actual, StandardCharsets.UTF_8);
            return;
        }
        if (!Files.exists(expectedFile)) {
            fail("No " + expectedFile.getFileName() + ". Run: mvn test -Dgolden.update=true");
        }
        String[] expected = Files.readString(expectedFile, StandardCharsets.UTF_8).split("\n", -1);
        String[] lines = actual.split("\n", -1);
        for (int i = 0; i < Math.max(expected.length, lines.length); i++) {
            String e = i < expected.length ? expected[i] : "<end of file>";
            String a = i < lines.length ? lines[i] : "<end of file>";
            if (!e.equals(a)) {
                fail(name + " output changed at line " + (i + 1) + " of " + expectedFile.getFileName()
                        + ".\n  expected: " + e + "\n  actual:   " + a
                        + "\nIf that's intended, run: mvn test -Dgolden.update=true");
            }
        }
    }

    @Test
    void passwordProtectedFileGetsAClearMessage() {
        Path file = FIXTURES.resolve("readpassword9.mpp");
        MPXJException e = assertThrows(MPXJException.class, () -> new UniversalProjectReader().read(file.toFile()));
        assertEquals("readpassword9.mpp is password protected. MPP Viewer can't open password-protected files.",
                Convert.errorMessage(e, "readpassword9.mpp"));
    }

    @Test
    void otherErrorsIncludeTheReason() {
        assertEquals("Could not read a.mpp: broken", Convert.errorMessage(new IOException("broken"), "a.mpp"));
        assertEquals("Could not read a.mpp: IOException", Convert.errorMessage(new IOException(), "a.mpp"));
    }

    @Test
    void formatsDurations() {
        assertEquals("3d", Convert.formatDuration(Duration.getInstance(2.999, TimeUnit.DAYS)));
        assertEquals("2.5h", Convert.formatDuration(Duration.getInstance(2.5, TimeUnit.HOURS)));
        assertEquals("10d", Convert.formatDuration(Duration.getInstance(10, TimeUnit.DAYS)));
        assertEquals("1.25w", Convert.formatDuration(Duration.getInstance(1.25, TimeUnit.WEEKS)));
        assertEquals("0d", Convert.formatDuration(Duration.getInstance(0.001, TimeUnit.DAYS)));
        assertEquals("4ed", Convert.formatDuration(Duration.getInstance(4, TimeUnit.ELAPSED_DAYS)));
        assertEquals("30em", Convert.formatDuration(Duration.getInstance(30, TimeUnit.ELAPSED_MINUTES)));
        assertEquals(null, Convert.formatDuration(null));
    }

    @Test
    void escapesJsonStrings() {
        Convert.Json j = new Convert.Json();
        j.beginObject().key("s").value("quote \" backslash \\ newline \n tab \t bell \u0007 é").endObject();
        assertEquals("{\"s\":\"quote \\\" backslash \\\\ newline \\n tab \\t bell \\u0007 é\"}", j.toString());
    }

    @Test
    void writesNumbersAndNulls() {
        Convert.Json j = new Convert.Json();
        j.beginArray().value(1).value(2.5).value(3.0).value(Double.NaN).value(null).value(true).endArray();
        assertEquals("[1,2.5,3,null,null,true]", j.toString());
    }

    @Test
    void sampleHasTheFieldsTheViewerShows() throws Exception {
        ProjectFile project = new UniversalProjectReader().read(FIXTURES.resolve("sample.mpp").toFile());
        String json = Convert.toJson(project, "sample.mpp");
        assertTrue(json.contains("\"workingDays\":[1,2,3,4,5]"), "working days");
        assertTrue(json.contains("\"milestone\":true"), "a milestone");
        assertTrue(json.contains("\"critical\":true"), "a critical task");
        assertTrue(json.matches("(?s).*\"notes\":\"[^\"]+\".*"), "a task with notes");
        assertTrue(json.matches("(?s).*\"resources\":\\[\"[^\"]+\".*"), "a task with resources");
        assertTrue(json.matches("(?s).*\"predecessors\":\\[\\{\"uid\".*"), "a dependency link");
    }
}
