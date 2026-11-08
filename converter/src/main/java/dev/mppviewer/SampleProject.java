package dev.mppviewer;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;

import org.mpxj.Duration;
import org.mpxj.ProjectFile;
import org.mpxj.Relation;
import org.mpxj.RelationType;
import org.mpxj.Resource;
import org.mpxj.Task;
import org.mpxj.TimeUnit;
import org.mpxj.mspdi.MSPDIWriter;

/**
 * Writes a small demo plan as Microsoft Project XML (MSPDI), which MS Project
 * and this viewer can both open. Used for testing without a real .mpp file.
 *
 * Usage: java -cp mpp-converter.jar dev.mppviewer.SampleProject out.xml
 */
public final class SampleProject {

    private SampleProject() {}

    public static void main(String[] args) throws Exception {
        String out = args.length > 0 ? args[0] : "sample.xml";
        ProjectFile p = new ProjectFile();
        p.addDefaultBaseCalendar();
        p.getProjectProperties().setProjectTitle("Office Fit-out (sample)");
        p.getProjectProperties().setAuthor("MPP Viewer");

        Resource pm = res(p, "Alex (PM)");
        Resource arch = res(p, "Sam (Architect)");
        Resource build = res(p, "BuildCo");
        Resource it = res(p, "IT Team");

        LocalDate d0 = LocalDate.of(2026, 1, 12);

        Task plan = summary(p, null, "Planning");
        Task brief = task(p, plan, "Agree brief and budget", d0, 3, 100, true, pm);
        Task design = task(p, plan, "Concept design", d0.plusDays(3), 8, 100, true, arch);
        Task approve = milestone(p, plan, "Design approved", d0.plusDays(15), true);
        link(brief, design); link(design, approve);

        Task works = summary(p, null, "Construction");
        Task strip = task(p, works, "Strip out", d0.plusDays(17), 5, 60, true, build);
        Task walls = task(p, works, "Partitions and ceilings", d0.plusDays(24), 10, 20, true, build);
        Task power = task(p, works, "Electrical and data cabling", d0.plusDays(28), 8, 10, false, build, it);
        Task paint = task(p, works, "Painting and finishes", d0.plusDays(38), 6, 0, true, build);
        link(approve, strip); link(strip, walls); link(walls, paint);
        Relation.Builder ss = new Relation.Builder().predecessorTask(walls)
                .type(RelationType.START_START).lag(Duration.getInstance(4, TimeUnit.DAYS));
        power.addPredecessor(ss);

        Task fitout = summary(p, null, "Move in");
        Task furniture = task(p, fitout, "Furniture install", d0.plusDays(46), 4, 0, true, build);
        Task tech = task(p, fitout, "IT setup and testing", d0.plusDays(46), 5, 0, false, it);
        Task move = milestone(p, fitout, "Team moves in", d0.plusDays(53), true);
        link(paint, furniture); link(power, tech); link(furniture, move); link(tech, move);
        tech.setNotes("Allow a day for the network switch configuration.");

        // Baselines: construction was originally planned to start a week earlier.
        for (Task t : new Task[] {brief, design, approve}) {
            t.setBaselineStart(t.getStart());
            t.setBaselineFinish(t.getFinish());
        }
        for (Task t : new Task[] {strip, walls, power, paint, furniture, tech, move}) {
            t.setBaselineStart(t.getStart().minusDays(7));
            t.setBaselineFinish(t.getFinish().minusDays(7));
        }

        rollUp(plan); rollUp(works); rollUp(fitout);
        new MSPDIWriter().write(p, out);
        System.out.println("Wrote " + out);
    }

    private static Resource res(ProjectFile p, String name) {
        Resource r = p.addResource();
        r.setName(name);
        return r;
    }

    private static Task summary(ProjectFile p, Task parent, String name) {
        Task t = parent == null ? p.addTask() : parent.addTask();
        t.setName(name);
        t.setSummary(true);
        return t;
    }

    private static Task task(ProjectFile p, Task parent, String name, LocalDate start, int workDays,
                             int pct, boolean critical, Resource... who) {
        Task t = parent.addTask();
        t.setName(name);
        LocalDate s = weekday(start);
        LocalDate f = s;
        for (int i = 1; i < workDays; i++) f = weekday(f.plusDays(1));
        t.setStart(LocalDateTime.of(s, LocalTime.of(8, 0)));
        t.setFinish(LocalDateTime.of(f, LocalTime.of(17, 0)));
        t.setDuration(Duration.getInstance(workDays, TimeUnit.DAYS));
        t.setPercentageComplete(pct);
        t.setCritical(critical);
        for (Resource r : who) t.addResourceAssignment(r);
        return t;
    }

    private static Task milestone(ProjectFile p, Task parent, String name, LocalDate on, boolean critical) {
        Task t = parent.addTask();
        t.setName(name);
        LocalDateTime when = LocalDateTime.of(weekday(on), LocalTime.of(17, 0));
        t.setStart(when);
        t.setFinish(when);
        t.setDuration(Duration.getInstance(0, TimeUnit.DAYS));
        t.setMilestone(true);
        t.setCritical(critical);
        return t;
    }

    private static void link(Task pred, Task succ) {
        succ.addPredecessor(new Relation.Builder().predecessorTask(pred).type(RelationType.FINISH_START));
    }

    private static void rollUp(Task summary) {
        LocalDateTime s = null, f = null;
        double done = 0, total = 0;
        for (Task c : summary.getChildTasks()) {
            if (s == null || c.getStart().isBefore(s)) s = c.getStart();
            if (f == null || c.getFinish().isAfter(f)) f = c.getFinish();
            double days = c.getDuration().getDuration();
            total += days;
            Number pct = c.getPercentageComplete();
            done += days * (pct == null ? 0 : pct.doubleValue()) / 100.0;
        }
        summary.setStart(s);
        summary.setFinish(f);
        int workDays = 0;
        for (LocalDate d = s.toLocalDate(); !d.isAfter(f.toLocalDate()); d = d.plusDays(1)) {
            if (d.getDayOfWeek().getValue() < 6) workDays++;
        }
        summary.setDuration(Duration.getInstance(workDays, TimeUnit.DAYS));
        summary.setPercentageComplete(total == 0 ? 0 : Math.round(done / total * 100));
    }

    private static LocalDate weekday(LocalDate d) {
        while (d.getDayOfWeek().getValue() >= 6) d = d.plusDays(1);
        return d;
    }
}
