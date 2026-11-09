package dev.mppviewer;

import java.io.File;
import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.io.PrintStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.time.DayOfWeek;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

import org.mpxj.Duration;
import org.mpxj.ProjectCalendar;
import org.mpxj.ProjectFile;
import org.mpxj.ProjectProperties;
import org.mpxj.Relation;
import org.mpxj.Resource;
import org.mpxj.ResourceAssignment;
import org.mpxj.Task;
import org.mpxj.reader.UniversalProjectReader;

/**
 * Reads a schedule file (MPP, MPT, MSPDI XML, MPX, Primavera, etc.) with MPXJ
 * and prints a compact JSON description of it to stdout for the viewer UI.
 *
 * Usage: java -jar mpp-converter.jar &lt;path-to-file&gt;
 * Exit codes: 0 ok, 1 bad usage, 2 unreadable file.
 */
public final class Convert {

    private Convert() {}

    public static void main(String[] args) {
        // stdout carries only the JSON, and the app shows stderr to the user when a
        // file can't be read. Libraries print status noise to both (Log4j's "could
        // not find a logging provider", which POI triggers on every .mpp file), so
        // keep the real streams for our own output and discard everything else.
        PrintStream jsonOut = new PrintStream(new FileOutputStream(FileDescriptor.out), false, StandardCharsets.UTF_8);
        PrintStream errOut = new PrintStream(new FileOutputStream(FileDescriptor.err), true, StandardCharsets.UTF_8);
        PrintStream discard = new PrintStream(OutputStream.nullOutputStream());
        System.setOut(discard);
        System.setErr(discard);

        if (args.length != 1) {
            errOut.println("Usage: mpp-converter <file.mpp>");
            System.exit(1);
        }
        File file = new File(args[0]);
        if (!file.isFile()) {
            errOut.println("File not found: " + file);
            System.exit(2);
        }
        try {
            ProjectFile project = new UniversalProjectReader().read(file);
            if (project == null) {
                errOut.println("Unsupported or unrecognised file format: " + file.getName());
                System.exit(2);
            }
            jsonOut.print(toJson(project, file.getName()));
            jsonOut.flush();
        } catch (LinkageError e) {
            // A reader needs a library the app leaves out (see converter/pom.xml),
            // e.g. Primavera or Asta SQLite databases.
            errOut.println(file.getName() + " is in a format MPP Viewer doesn't support.");
            System.exit(2);
        } catch (OutOfMemoryError e) {
            errOut.println(file.getName() + " is too large to open.");
            System.exit(2);
        } catch (Exception e) {
            String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            errOut.println("Could not read " + file.getName() + ": " + msg);
            System.exit(2);
        }
    }

    static String toJson(ProjectFile project, String fileName) {
        ProjectProperties props = project.getProjectProperties();
        Json j = new Json();
        j.beginObject();
        j.key("fileName").value(fileName);

        j.key("project").beginObject();
        j.key("title").value(props.getProjectTitle());
        j.key("author").value(props.getAuthor());
        j.key("start").value(props.getStartDate());
        j.key("finish").value(props.getFinishDate());
        // Working days of the project calendar, as JavaScript day numbers
        // (0 = Sunday), so the chart can shade the right days as non-working.
        ProjectCalendar cal = project.getDefaultCalendar();
        j.key("workingDays").beginArray();
        for (DayOfWeek day : DayOfWeek.values()) {
            boolean working = cal == null
                    ? day != DayOfWeek.SATURDAY && day != DayOfWeek.SUNDAY
                    : cal.isWorkingDay(day);
            if (working) j.value(day.getValue() % 7);
        }
        j.endArray();
        j.endObject();

        j.key("tasks").beginArray();
        for (Task task : project.getTasks()) {
            // Skip the hidden project-summary row (ID 0) and blank rows.
            Integer id = task.getID();
            if (id != null && id == 0) continue;
            if (task.getName() == null && task.getStart() == null) continue;
            writeTask(j, task);
        }
        j.endArray();

        j.endObject();
        return j.toString();
    }

    private static void writeTask(Json j, Task t) {
        Task parent = t.getParentTask();
        Integer parentUid = (parent == null || (parent.getID() != null && parent.getID() == 0))
                ? null : parent.getUniqueID();

        j.beginObject();
        j.key("uid").value(t.getUniqueID());
        j.key("id").value(t.getID());
        j.key("wbs").value(t.getWBS());
        j.key("name").value(t.getName());
        j.key("level").value(t.getOutlineLevel());
        j.key("parent").value(parentUid);
        j.key("summary").value(t.getSummary());
        j.key("milestone").value(t.getMilestone());
        j.key("critical").value(t.getCritical());
        j.key("start").value(t.getStart());
        j.key("finish").value(t.getFinish());
        j.key("duration").value(formatDuration(t.getDuration()));
        Number pct = t.getPercentageComplete();
        j.key("percent").value(pct == null ? 0 : pct.doubleValue());
        j.key("baselineStart").value(t.getBaselineStart());
        j.key("baselineFinish").value(t.getBaselineFinish());
        j.key("notes").value(t.getNotes());

        j.key("resources").beginArray();
        List<ResourceAssignment> assignments = t.getResourceAssignments();
        if (assignments != null) {
            for (ResourceAssignment a : assignments) {
                Resource r = a.getResource();
                if (r != null && r.getName() != null) j.value(r.getName());
            }
        }
        j.endArray();

        j.key("predecessors").beginArray();
        List<Relation> preds = t.getPredecessors();
        if (preds != null) {
            for (Relation rel : preds) {
                Task p = rel.getPredecessorTask();
                if (p == null) continue;
                j.beginObject();
                j.key("uid").value(p.getUniqueID());
                j.key("type").value(rel.getType() == null ? "FS" : shortType(rel.getType().toString()));
                j.key("lag").value(formatDuration(rel.getLag()));
                j.endObject();
            }
        }
        j.endArray();

        j.endObject();
    }

    private static String shortType(String type) {
        switch (type.toUpperCase()) {
            case "FINISH_START": return "FS";
            case "START_START": return "SS";
            case "FINISH_FINISH": return "FF";
            case "START_FINISH": return "SF";
            default: return type;
        }
    }

    private static String formatDuration(Duration d) {
        if (d == null) return null;
        double v = d.getDuration();
        // Up to two decimals, no trailing zeros, independent of the Mac's locale
        // (2.999 -> "3", 2.5 -> "2.5").
        String num = Double.isFinite(v)
                ? BigDecimal.valueOf(v).setScale(2, RoundingMode.HALF_UP).stripTrailingZeros().toPlainString()
                : "0";
        String unit;
        switch (d.getUnits()) {
            case MINUTES: case ELAPSED_MINUTES: unit = "m"; break;
            case HOURS: case ELAPSED_HOURS: unit = "h"; break;
            case DAYS: case ELAPSED_DAYS: unit = "d"; break;
            case WEEKS: case ELAPSED_WEEKS: unit = "w"; break;
            case MONTHS: case ELAPSED_MONTHS: unit = "mo"; break;
            case YEARS: case ELAPSED_YEARS: unit = "y"; break;
            default: unit = ""; break;
        }
        String elapsed = d.getUnits().name().startsWith("ELAPSED") ? "e" : "";
        return num + elapsed + unit;
    }

    /** Minimal streaming JSON writer, so the converter has no extra dependencies. */
    static final class Json {
        private final StringBuilder sb = new StringBuilder(64 * 1024);
        private final List<Boolean> first = new ArrayList<>();
        private boolean afterKey;

        Json beginObject() { prefix(); sb.append('{'); first.add(true); return this; }
        Json endObject() { sb.append('}'); first.remove(first.size() - 1); return this; }
        Json beginArray() { prefix(); sb.append('['); first.add(true); return this; }
        Json endArray() { sb.append(']'); first.remove(first.size() - 1); return this; }

        Json key(String k) {
            prefix();
            string(k);
            sb.append(':');
            afterKey = true;
            return this;
        }

        Json value(Object v) {
            prefix();
            if (v == null) sb.append("null");
            else if (v instanceof Boolean || v instanceof Integer || v instanceof Long) sb.append(v);
            else if (v instanceof Number) {
                double d = ((Number) v).doubleValue();
                sb.append(Double.isFinite(d) ? stripZero(d) : "null");
            } else if (v instanceof LocalDateTime) string(v.toString());
            else string(v.toString());
            return this;
        }

        private static String stripZero(double d) {
            return d == Math.rint(d) ? String.valueOf((long) d) : String.valueOf(d);
        }

        private void prefix() {
            if (afterKey) { afterKey = false; return; }
            if (first.isEmpty()) return;
            int top = first.size() - 1;
            if (first.get(top)) first.set(top, false);
            else sb.append(',');
        }

        private void string(String s) {
            sb.append('"');
            for (int i = 0; i < s.length(); i++) {
                char c = s.charAt(i);
                switch (c) {
                    case '"': sb.append("\\\""); break;
                    case '\\': sb.append("\\\\"); break;
                    case '\n': sb.append("\\n"); break;
                    case '\r': sb.append("\\r"); break;
                    case '\t': sb.append("\\t"); break;
                    default:
                        if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                        else sb.append(c);
                }
            }
            sb.append('"');
        }

        @Override public String toString() { return sb.toString(); }
    }
}
