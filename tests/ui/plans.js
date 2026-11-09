// Synthetic plans in the converter's JSON format, for tests that need more
// tasks or a different calendar than the sample.

const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 16);

// Groups of ten: a summary task followed by nine linked subtasks.
export function bigPlan(count, project = {}) {
  const tasks = [];
  const base = Date.UTC(2026, 0, 5, 8);
  for (let i = 0; i < count; i++) {
    const uid = i + 1;
    const summary = i % 10 === 0;
    const start = new Date(base + (i % 400) * DAY);
    tasks.push({
      uid,
      id: uid,
      name: `Task ${uid}`,
      level: summary ? 1 : 2,
      parent: summary ? null : uid - (i % 10),
      summary,
      milestone: false,
      critical: i % 7 === 0,
      start: iso(start),
      finish: iso(new Date(start.getTime() + 10 * DAY)),
      duration: "10d",
      percent: 30,
      resources: ["Alice"],
      predecessors: !summary && i % 10 > 1 ? [{ uid: uid - 1, type: "FS", lag: "0d" }] : [],
    });
  }
  return { fileName: "big.mpp", project: { title: "Big plan", ...project }, tasks };
}

// Serves a plan in place of the sample that /?sample loads.
export async function openPlan(page, plan) {
  await page.route("**/samples/office-fitout.json", (route) => route.fulfill({ json: plan }));
  await page.goto("/?sample");
}
