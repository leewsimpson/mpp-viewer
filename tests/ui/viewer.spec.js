import { test, expect } from "@playwright/test";
import { bigPlan, openPlan } from "./plans.js";

const ROW = 28;
const rows = (page) => page.locator("#grid-body .row");
const row = (page, name) => rows(page).filter({ has: page.locator(".name", { hasText: new RegExp(`^${name}$`) }) });
const selectedRows = (page) => page.locator("#grid-body .row.selected");

test.describe("sample plan", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?sample");
    await expect(rows(page)).toHaveCount(13);
  });

  test("shows the project and its tasks", async ({ page }) => {
    await expect(page.locator("#project-title")).toHaveText("Office Fit-out (sample)");
    await expect(page.locator("#project-meta")).toContainText("13 tasks");
    await expect(page.locator("#bars .bars > g")).toHaveCount(13);
  });

  test("selecting a task highlights it in both panes and shows its details", async ({ page }) => {
    await row(page, "Partitions and ceilings").locator(".name").click();
    const uid = await row(page, "Partitions and ceilings").getAttribute("data-uid");
    await expect(row(page, "Partitions and ceilings")).toHaveClass(/selected/);
    await expect(page.locator(`#bars .row-bg[data-uid="${uid}"]`)).toHaveClass(/selected/);
    await expect(page.locator(`#bars .bar[data-uid="${uid}"]`)).toHaveClass(/selected/);
    const details = page.locator("#details");
    await expect(details).toBeVisible();
    await expect(details.locator("h2")).toHaveText("Partitions and ceilings");
    await expect(details).toContainText("Predecessors");
    await expect(details).toContainText("Strip out");
    await expect(details).toContainText("Successors");
    await expect(details).toContainText("Electrical and data cabling");
    await expect(details).toContainText("Painting and finishes");
  });

  test("clicking a bar selects its task", async ({ page }) => {
    const uid = await row(page, "Strip out").getAttribute("data-uid");
    await page.locator(`#bars .bar[data-uid="${uid}"]`).click();
    await expect(row(page, "Strip out")).toHaveClass(/selected/);
  });

  test("arrow keys move the selection", async ({ page }) => {
    await row(page, "Planning").locator(".name").click();
    await page.keyboard.press("ArrowDown");
    await expect(row(page, "Agree brief and budget")).toHaveClass(/selected/);
    await expect(selectedRows(page)).toHaveCount(1);
    await page.keyboard.press("ArrowUp");
    await expect(row(page, "Planning")).toHaveClass(/selected/);
    await expect(selectedRows(page)).toHaveCount(1);
  });

  test("left and right arrows collapse and expand the selected summary", async ({ page }) => {
    await row(page, "Construction").locator(".name").click();
    await page.keyboard.press("ArrowLeft");
    await expect(rows(page)).toHaveCount(9);
    await page.keyboard.press("ArrowRight");
    await expect(rows(page)).toHaveCount(13);
  });

  test("arrow keys don't move the selection while the zoom menu has focus", async ({ page }) => {
    await page.locator("#zoom").focus();
    await page.keyboard.press("ArrowDown");
    await expect(selectedRows(page)).toHaveCount(0);
  });

  test("search highlights matches, Enter steps through them and Escape clears", async ({ page }) => {
    await page.locator("#search").fill("design");
    await expect(page.locator("#grid-body .row.match")).toHaveCount(2);
    await expect(page.locator("#bars .row-bg.match")).toHaveCount(2);
    await page.locator("#search").press("Enter");
    await expect(row(page, "Concept design")).toHaveClass(/selected/);
    await page.locator("#search").press("Enter");
    await expect(row(page, "Design approved")).toHaveClass(/selected/);
    await page.locator("#search").press("Escape");
    await expect(page.locator("#grid-body .row.match")).toHaveCount(0);
    await expect(page.locator("#search")).toHaveValue("");
  });

  test("search finds tasks by resource", async ({ page }) => {
    await page.locator("#search").fill("it team");
    await expect(page.locator("#grid-body .row.match")).toHaveCount(2);
  });

  test("collapse all, expand all and the summary caret", async ({ page }) => {
    await page.locator("#btn-collapse").click();
    await expect(rows(page)).toHaveCount(3);
    await page.locator("#btn-expand").click();
    await expect(rows(page)).toHaveCount(13);
    await row(page, "Planning").locator(".caret").click();
    await expect(rows(page)).toHaveCount(10);
  });

  test("selecting a hidden task through search expands its summary", async ({ page }) => {
    await page.locator("#btn-collapse").click();
    await expect(rows(page)).toHaveCount(3);
    await page.locator("#search").fill("strip");
    await page.locator("#search").press("Enter");
    await expect(row(page, "Strip out")).toHaveClass(/selected/);
  });

  test("Escape clears the selection and closes the details", async ({ page }) => {
    await row(page, "Strip out").locator(".name").click();
    await expect(page.locator("#details")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#details")).toBeHidden();
    await expect(selectedRows(page)).toHaveCount(0);
  });

  test("options: links, critical path, baseline and zoom", async ({ page }) => {
    await expect(page.locator("#bars .links path")).toHaveCount(10);
    await page.locator("#opt-links").uncheck();
    await expect(page.locator("#bars .links path")).toHaveCount(0);

    await expect(page.locator("#grid-body .row.critical")).toHaveCount(0);
    await page.locator("#opt-critical").check();
    expect(await page.locator("#grid-body .row.critical").count()).toBeGreaterThan(0);

    await expect(page.locator("#bars .baseline")).toHaveCount(0);
    await page.locator("#opt-baseline").check();
    expect(await page.locator("#bars .baseline").count()).toBeGreaterThan(0);

    const width = async () => Number(await page.locator("#bars").getAttribute("width"));
    const weekWidth = await width();
    await page.locator("#zoom").selectOption("day");
    expect(await width()).toBeGreaterThan(weekWidth);
    await page.locator("#zoom").selectOption("quarter");
    expect(await width()).toBeLessThanOrEqual(weekWidth);
  });

  test("weekends are shaded at day zoom", async ({ page }) => {
    await page.locator("#zoom").selectOption("day");
    expect(await page.locator("#bars .weekend").count()).toBeGreaterThan(0);
  });
});

test.describe("project calendar", () => {
  test("a seven-day calendar has no shaded days", async ({ page }) => {
    await openPlan(page, bigPlan(20, { workingDays: [0, 1, 2, 3, 4, 5, 6] }));
    await page.locator("#zoom").selectOption("day");
    await expect(page.locator("#bars .weekend")).toHaveCount(0);
  });

  test("shaded days follow the calendar's working days", async ({ page }) => {
    // Sunday to Thursday working week: Friday and Saturday are shaded, so each
    // shaded run is two days wide, as with a normal weekend, but starts on a Friday.
    await openPlan(page, bigPlan(20, { workingDays: [0, 1, 2, 3, 4] }));
    await page.locator("#zoom").selectOption("day");
    const shaded = page.locator("#bars .weekend");
    expect(await shaded.count()).toBeGreaterThan(0);
    // The day scale labels each day with its date; find the label under the
    // first shaded run and check that it's a Friday in January 2026.
    const x = Number(await shaded.first().getAttribute("x"));
    const label = await page.evaluate((x) => {
      const texts = [...document.querySelectorAll("#scale .scale-minor")];
      const t = texts.find((t) => Math.abs(Number(t.getAttribute("x")) - (x + 15)) < 1);
      return t && t.textContent;
    }, x);
    expect(label).not.toBeUndefined();
    const fridays = [2, 9, 16, 23, 30].map(String);
    expect(fridays).toContain(label);
  });
});

test.describe("large plan", () => {
  const COUNT = 5000;
  test.beforeEach(async ({ page }) => {
    await openPlan(page, bigPlan(COUNT));
    await expect(rows(page).first()).toBeVisible();
  });

  test("draws only the rows near the viewport", async ({ page }) => {
    const drawn = await rows(page).count();
    expect(drawn).toBeGreaterThan(10);
    expect(drawn).toBeLessThan(200);
    expect(await page.locator("#bars .bars > g").count()).toBe(drawn);
    expect(Number(await page.locator("#bars").getAttribute("height"))).toBe(COUNT * ROW);
  });

  test("scrolling draws later rows and keeps the grid in step", async ({ page }) => {
    await page.locator("#chart-body").evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(row(page, `Task ${COUNT}`)).toBeInViewport();
    const [chart, grid] = await page.evaluate(() => [
      document.querySelector("#chart-body").scrollTop,
      document.querySelector("#grid-body").scrollTop,
    ]);
    expect(Math.abs(chart - grid)).toBeLessThan(2);
    expect(await rows(page).count()).toBeLessThan(200);
  });

  test("scrolling the grid scrolls the chart", async ({ page }) => {
    await page.locator("#grid-body").evaluate((el) => (el.scrollTop = 50000));
    await expect.poll(() => page.locator("#chart-body").evaluate((el) => el.scrollTop)).toBeGreaterThan(49000);
    await expect(row(page, `Task ${Math.floor(50000 / ROW) + 5}`)).toBeVisible();
  });

  test("the selection survives scrolling away and back", async ({ page }) => {
    await row(page, "Task 3").locator(".name").click();
    await page.locator("#chart-body").evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(row(page, `Task ${COUNT}`)).toBeVisible();
    await page.locator("#chart-body").evaluate((el) => (el.scrollTop = 0));
    await expect(row(page, "Task 3")).toHaveClass(/selected/);
  });

  test("arrow keys scroll the selection into view", async ({ page }) => {
    await row(page, "Task 1").locator(".name").click();
    for (let i = 0; i < 60; i++) await page.keyboard.press("ArrowDown");
    await expect(row(page, "Task 61")).toHaveClass(/selected/);
    await expect(row(page, "Task 61")).toBeInViewport();
  });

  test("collapse all and expand all", async ({ page }) => {
    await page.locator("#btn-collapse").click();
    expect(Number(await page.locator("#bars").getAttribute("height"))).toBe((COUNT / 10) * ROW);
    await page.locator("#btn-expand").click();
    expect(Number(await page.locator("#bars").getAttribute("height"))).toBe(COUNT * ROW);
  });
});
