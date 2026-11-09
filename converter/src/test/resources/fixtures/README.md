# Test fixtures

Project files used by the converter tests (`ConvertTest`). They come from
MPXJ's own test data, commit `4982974b2594ffc7146cdb9ebdf2ae46186737ca` of
<https://github.com/joniles/mpxj> (`junit/data/`), and are distributed under
MPXJ's license, the GNU LGPL 2.1 or later.

| File | Covers |
| --- | --- |
| `task-links-project2003-mpp8.mpp` | Project 98 format (MPP8) |
| `task-links-project2003-mpp9.mpp` | Project 2000–2003 format (MPP9) |
| `task-links-project2007-mpp12.mpp` | Project 2007 format (MPP12) |
| `task-links-project2019-mpp14.mpp` | Project 2010+ format (MPP14) |
| `task-links-project2003-mspdi.xml` | Project XML |
| `task-links-project2000-mpd9.mpd` | Project database (MPD) |
| `task-text-project2019-mpp14.mpp` | Many tasks with text fields |
| `assignment-assignments-project2019-mpp14.mpp` | Resource assignments |
| `task-baselines-project2019-mpp14.mpp` | Baselines |
| `sample.mpp` | Notes, critical tasks, resources, milestones |
| `empty.mpp` | A plan with no tasks |
| `readpassword9.mpp` | Password protection (must fail with a clear message) |

Each readable file has a `.expected.json` next to it: the converter's output,
one task per line. The tests fail if the output changes. After a deliberate
change (or an MPXJ upgrade), regenerate them and review the diff:

```bash
mvn -f converter/pom.xml test -Dgolden.update=true
git diff converter/src/test/resources/fixtures
```
