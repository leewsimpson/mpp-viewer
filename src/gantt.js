// Gantt view: task grid on the left, timeline on the right.
// Plain DOM + SVG, no external libraries, so it works fully offline.

const DAY = 86400000;
export const ROW = 28;
// Rows drawn above and below the visible area, so normal scrolling never
// shows a gap before the next frame fills it in.
const OVERSCAN = 40;

const ZOOMS = {
  day: { px: 30, minor: "day", major: "month" },
  week: { px: 11, minor: "week", major: "month" },
  month: { px: 3.4, minor: "month", major: "year" },
  quarter: { px: 1.3, minor: "quarter", major: "year" },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const parseDate = (s) => (s ? new Date(s) : null);

export function fmtDate(d) {
  if (!d) return "";
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "2-digit" });
}

// Builds an SVG element as markup. Rendering whole charts as one string and
// parsing it once is much faster than creating thousands of nodes one by one.
function svg(tag, attrs, inner = "") {
  let a = "";
  for (const k in attrs) a += ` ${k}="${attrs[k]}"`;
  return `<${tag}${a}>${inner}</${tag}>`;
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfUnit(d, unit) {
  const x = startOfDay(d);
  if (unit === "week") {
    const dow = (x.getDay() + 6) % 7; // Monday = 0
    x.setDate(x.getDate() - dow);
  } else if (unit === "month") x.setDate(1);
  else if (unit === "quarter") x.setMonth(Math.floor(x.getMonth() / 3) * 3, 1);
  else if (unit === "year") x.setMonth(0, 1);
  return x;
}

function addUnit(d, unit) {
  const x = new Date(d);
  if (unit === "day") x.setDate(x.getDate() + 1);
  else if (unit === "week") x.setDate(x.getDate() + 7);
  else if (unit === "month") x.setMonth(x.getMonth() + 1);
  else if (unit === "quarter") x.setMonth(x.getMonth() + 3);
  else if (unit === "year") x.setFullYear(x.getFullYear() + 1);
  return x;
}

function unitLabel(d, unit, width) {
  if (unit === "day") return width >= 18 ? String(d.getDate()) : "";
  if (unit === "week") return width >= 44 ? `${d.getDate()} ${MONTHS[d.getMonth()]}` : String(d.getDate());
  if (unit === "month") return width >= 60 ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : width >= 22 ? MONTHS[d.getMonth()] : "";
  if (unit === "quarter") return `Q${Math.floor(d.getMonth() / 3) + 1}`;
  if (unit === "year") return String(d.getFullYear());
  return "";
}

export class Gantt {
  constructor(opts) {
    this.gridBody = opts.gridBody;
    this.scaleSvg = opts.scaleSvg;
    this.barsSvg = opts.barsSvg;
    this.chartBody = opts.chartBody;
    this.onSelect = opts.onSelect || (() => {});
    this.tasks = [];
    this.vis = [];
    this.byUid = new Map();
    this.collapsed = new Set();
    this.selected = null;
    this.matches = new Set();
    this.workingDays = new Set([1, 2, 3, 4, 5]);
    this.options = { zoom: "week", critical: false, baseline: false, links: true };
    // Per drawn task: its grid row, chart row background and bar group, so
    // selection and search can update highlights without a full re-render.
    this.els = new Map();
    // Only the rows in and near the viewport are in the DOM; scrolling draws
    // the rest. Large plans would otherwise mean tens of thousands of nodes.
    this.drawn = null;
    let frame = 0;
    this.chartBody.addEventListener("scroll", () => {
      if (frame || !this.vis.length) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        this.renderRows();
      });
    });
  }

  load(data) {
    this.tasks = data.tasks.map((t) => ({
      ...t,
      startD: parseDate(t.start),
      finishD: parseDate(t.finish),
      bStartD: parseDate(t.baselineStart),
      bFinishD: parseDate(t.baselineFinish),
    }));
    this.byUid = new Map(this.tasks.map((t) => [t.uid, t]));
    this.children = new Map();
    this.successors = new Map();
    for (const t of this.tasks) {
      if (t.parent != null) {
        if (!this.children.has(t.parent)) this.children.set(t.parent, []);
        this.children.get(t.parent).push(t);
      }
      for (const p of t.predecessors || []) {
        if (!this.successors.has(p.uid)) this.successors.set(p.uid, []);
        this.successors.get(p.uid).push(t);
      }
    }
    // Treat any task with children as a summary, even if the file didn't flag it.
    for (const t of this.tasks) if (this.children.has(t.uid)) t.summary = true;
    const wd = data.project?.workingDays;
    this.workingDays = new Set(Array.isArray(wd) && wd.length ? wd : [1, 2, 3, 4, 5]);
    this.collapsed.clear();
    this.selected = null;
    this.matches.clear();
    this.computeRange();
    this.render();
  }

  computeRange() {
    let min = null;
    let max = null;
    for (const t of this.tasks) {
      for (const d of [t.startD, t.finishD, t.bStartD, t.bFinishD]) {
        if (!d) continue;
        if (!min || d < min) min = d;
        if (!max || d > max) max = d;
      }
    }
    const today = new Date();
    if (!min) {
      min = today;
      max = today;
    }
    this.dataMin = min;
    this.dataMax = max;
  }

  setOption(key, value) {
    this.options[key] = value;
    this.render();
  }

  isHidden(t) {
    let p = t.parent;
    while (p != null) {
      if (this.collapsed.has(p)) return true;
      const pt = this.byUid.get(p);
      p = pt ? pt.parent : null;
    }
    return false;
  }

  toggle(uid) {
    if (this.collapsed.has(uid)) this.collapsed.delete(uid);
    else this.collapsed.add(uid);
    this.render();
  }

  expandAll() {
    this.collapsed.clear();
    this.render();
  }

  collapseAll() {
    for (const t of this.tasks) if (t.summary) this.collapsed.add(t.uid);
    this.render();
  }

  // Expands any collapsed ancestors of a task. Returns true if anything changed.
  reveal(uid) {
    let changed = false;
    let p = this.byUid.get(uid)?.parent;
    while (p != null) {
      changed = this.collapsed.delete(p) || changed;
      p = this.byUid.get(p)?.parent;
    }
    return changed;
  }

  select(uid, scroll = false) {
    const prev = this.selected;
    this.selected = uid;
    if (uid != null && this.reveal(uid)) {
      this.render();
    } else {
      this.highlight(prev);
      this.highlight(uid);
    }
    this.onSelect(uid == null ? null : this.byUid.get(uid));
    if (scroll && uid != null) this.scrollToTask(uid);
  }

  // Brings one task's row and bar classes in line with the selection and matches.
  highlight(uid) {
    const e = uid == null ? null : this.els.get(uid);
    if (!e) return;
    const sel = uid === this.selected;
    const match = this.matches.has(uid);
    for (const n of [e.row, e.bg]) {
      n.classList.toggle("selected", sel);
      n.classList.toggle("match", match);
    }
    e.bar.classList.toggle("selected", sel);
  }

  moveSelection(delta) {
    const vis = this.vis;
    if (!vis.length) return;
    let i = vis.findIndex((t) => t.uid === this.selected);
    i = i < 0 ? 0 : Math.max(0, Math.min(vis.length - 1, i + delta));
    this.select(vis[i].uid, true);
  }

  search(text) {
    const old = this.matches;
    this.matches = new Set();
    const q = text.trim().toLowerCase();
    if (q) {
      for (const t of this.tasks) {
        if ((t.name || "").toLowerCase().includes(q) || (t.resources || []).some((r) => r.toLowerCase().includes(q))) {
          this.matches.add(t.uid);
        }
      }
    }
    for (const uid of old) if (!this.matches.has(uid)) this.highlight(uid);
    for (const uid of this.matches) if (!old.has(uid)) this.highlight(uid);
    return [...this.matches];
  }

  scrollToTask(uid) {
    const i = this.vis.findIndex((t) => t.uid === uid);
    if (i < 0) return;
    const t = this.vis[i];
    const body = this.chartBody;
    const top = i * ROW;
    if (top < body.scrollTop || top > body.scrollTop + body.clientHeight - ROW * 2) {
      body.scrollTop = Math.max(0, top - body.clientHeight / 3);
    }
    const d = t.startD || t.finishD;
    if (d) {
      const x = this.x(d);
      if (x < body.scrollLeft || x > body.scrollLeft + body.clientWidth - 80) {
        body.scrollLeft = Math.max(0, x - 60);
      }
    }
  }

  scrollToDate(d) {
    this.chartBody.scrollLeft = Math.max(0, this.x(d) - this.chartBody.clientWidth / 3);
  }

  x(d) {
    return ((d - this.origin) / DAY) * this.px;
  }

  render() {
    const z = ZOOMS[this.options.zoom];
    this.px = z.px;
    // Start a little before the first date, snapped to the start of a scale unit.
    const lead = { day: 3, week: 7, month: 20, quarter: 45 }[this.options.zoom] * DAY;
    this.origin = startOfUnit(new Date(this.dataMin.getTime() - lead), z.minor);
    const end = addUnit(addUnit(startOfUnit(this.dataMax, z.major), z.major), z.minor);
    this.width = Math.max(this.x(end), this.chartBody.clientWidth);

    this.vis = this.tasks.filter((t) => !this.isHidden(t));
    this.rowOf = new Map(this.vis.map((t, i) => [t.uid, i]));
    this.renderScale(z);
    this.renderChart(z);
    this.drawn = null;
    this.renderRows();
  }

  // Draws the grid rows, row backgrounds, bars and links for the rows in and
  // near the viewport. Cheap enough to run on every scroll frame.
  renderRows() {
    const body = this.chartBody;
    const n = this.vis.length;
    const first = Math.max(0, Math.floor(body.scrollTop / ROW) - OVERSCAN);
    const last = Math.min(n, Math.ceil((body.scrollTop + body.clientHeight) / ROW) + OVERSCAN);
    if (this.drawn && this.drawn.first === first && this.drawn.last === last) return;
    this.drawn = { first, last };
    const slice = this.vis.slice(first, last);

    this.renderGrid(slice, first);
    this.gRows.innerHTML = this.rowBackgrounds(slice, first);
    this.gBars.innerHTML = this.barMarkup(slice, first);
    this.gLinks.innerHTML = this.linkMarkup(first, last);

    this.els.clear();
    const rows = this.gridBody.querySelectorAll(".row");
    const bgs = this.gRows.children;
    const bars = this.gBars.children;
    slice.forEach((t, i) => this.els.set(t.uid, { row: rows[i], bg: bgs[i], bar: bars[i] }));
  }

  renderGrid(slice, first) {
    let html = `<div style="height:${first * ROW}px"></div>`;
    slice.forEach((t, k) => {
      let cls = (first + k) % 2 ? "row odd" : "row";
      if (t.summary) cls += " summary";
      if (t.uid === this.selected) cls += " selected";
      if (this.matches.has(t.uid)) cls += " match";
      if (this.options.critical && t.critical && !t.summary) cls += " critical";

      const caret = t.summary
        ? `<button class="caret" data-toggle="${t.uid}" aria-label="Toggle">${this.collapsed.has(t.uid) ? "▸" : "▾"}</button>`
        : `<span class="caret-space"></span>`;
      const indent = Math.max(0, (t.level || 1) - 1) * 14;
      const name = escapeHtml(t.name || "");
      html += `<div class="${cls}" data-uid="${t.uid}" title="${name}">` +
        `<div class="c-id">${t.id ?? ""}</div>` +
        `<div class="c-name" style="padding-left:${indent + 4}px">${caret}<span class="name">${name}</span>${t.milestone ? '<span class="ms-tag">◆</span>' : ""}</div>` +
        `<div class="c-dur">${escapeHtml(t.duration || "")}</div>` +
        `<div class="c-date">${fmtDate(t.startD)}</div>` +
        `<div class="c-date">${fmtDate(t.finishD)}</div>` +
        `<div class="c-pct">${t.percent != null ? Math.round(t.percent) + "%" : ""}</div>` +
        `</div>`;
    });
    // Space for the rows not drawn, plus 40px so grid and chart scroll to the
    // same height (the chart has a horizontal scrollbar).
    const below = (this.vis.length - first - slice.length) * ROW;
    this.gridBody.innerHTML = html + `<div style="height:${below + 40}px"></div>`;
  }

  renderScale(z) {
    const end = new Date(this.origin.getTime() + (this.width / this.px) * DAY);
    let out = "";

    // Top tier: months or years.
    for (let d = startOfUnit(this.origin, z.major); d < end; d = addUnit(d, z.major)) {
      const x1 = Math.max(0, this.x(d));
      const x2 = this.x(addUnit(d, z.major));
      out += svg("line", { x1: this.x(d), x2: this.x(d), y1: 0, y2: 22, class: "tick-major" });
      const label = z.major === "month" ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : String(d.getFullYear());
      if (x2 - x1 > 40) out += svg("text", { x: x1 + 6, y: 15, class: "scale-major" }, label);
    }
    out += svg("line", { x1: 0, x2: this.width, y1: 22, y2: 22, class: "tick-major" });

    // Bottom tier: days, weeks, months or quarters.
    for (let d = startOfUnit(this.origin, z.minor); d < end; d = addUnit(d, z.minor)) {
      const x1 = this.x(d);
      const w = this.x(addUnit(d, z.minor)) - x1;
      out += svg("line", { x1, x2: x1, y1: 22, y2: 44, class: "tick-minor" });
      const label = unitLabel(d, z.minor, w);
      if (label) {
        const day = z.minor === "day";
        out += svg("text", { x: day ? x1 + w / 2 : x1 + 4, y: 37, class: "scale-minor", "text-anchor": day ? "middle" : "start" }, label);
      }
    }
    out += svg("line", { x1: 0, x2: this.width, y1: 43.5, y2: 43.5, class: "tick-major" });

    this.scaleSvg.setAttribute("width", this.width);
    this.scaleSvg.setAttribute("height", 44);
    this.scaleSvg.innerHTML = out;
  }

  // Draws the parts of the chart that don't depend on scrolling (non-working
  // days, grid lines, today) and the empty layers renderRows() fills in.
  renderChart(z) {
    const height = Math.max(this.vis.length * ROW, this.chartBody.clientHeight - 16);
    const end = new Date(this.origin.getTime() + (this.width / this.px) * DAY);

    // Non-working days (from the project calendar) and vertical grid lines.
    let grid = "";
    if (z.minor === "day" || z.minor === "week") {
      let runStart = null;
      for (let d = new Date(this.origin); d <= end; d = addUnit(d, "day")) {
        const off = d < end && !this.workingDays.has(d.getDay());
        if (off && !runStart) runStart = d;
        if (!off && runStart) {
          grid += svg("rect", { x: this.x(runStart), y: 0, width: this.x(d) - this.x(runStart), height, class: "weekend" });
          runStart = null;
        }
      }
    }
    for (let d = startOfUnit(this.origin, z.minor); d < end; d = addUnit(d, z.minor)) {
      grid += svg("line", { x1: this.x(d), x2: this.x(d), y1: 0, y2: height, class: "grid-line" });
    }

    // Today marker.
    const today = new Date();
    if (today > this.origin && today < end) {
      const tx = this.x(today);
      grid += svg("line", { x1: tx, x2: tx, y1: 0, y2: height, class: "today" });
    }

    const defs = svg("defs", {}, svg("marker", { id: "arrow", viewBox: "0 0 8 8", refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" },
      svg("path", { d: "M0,0 L8,4 L0,8 z", class: "arrow-head" })));
    this.barsSvg.setAttribute("width", this.width);
    this.barsSvg.setAttribute("height", height);
    this.barsSvg.innerHTML = defs + svg("g", { class: "rows" }) + svg("g", {}, grid) +
      svg("g", { class: "links" }) + svg("g", { class: "bars" });
    this.gRows = this.barsSvg.querySelector(".rows");
    this.gLinks = this.barsSvg.querySelector(".links");
    this.gBars = this.barsSvg.querySelector(".bars");
  }

  // Row stripes, selection and search highlights.
  rowBackgrounds(slice, first) {
    let out = "";
    slice.forEach((t, k) => {
      const i = first + k;
      let cls = i % 2 ? "row-bg odd" : "row-bg";
      if (this.matches.has(t.uid)) cls += " match";
      if (t.uid === this.selected) cls += " selected";
      out += svg("rect", { x: 0, y: i * ROW, width: this.width, height: ROW, class: cls, "data-uid": t.uid });
    });
    return out;
  }

  // Every drawn task gets a group, even without dates, so groups line up with
  // rows by index.
  barMarkup(slice, first) {
    let out = "";
    slice.forEach((t, k) => {
      const top = (first + k) * ROW;
      let cls = "bar";
      if (this.options.critical && t.critical && !t.summary) cls += " critical";
      if (t.uid === this.selected) cls += " selected";
      const tip = `${t.name || ""}\n${fmtDate(t.startD)} → ${fmtDate(t.finishD)}${t.duration ? ` (${t.duration})` : ""}${t.percent ? `\n${Math.round(t.percent)}% complete` : ""}`;
      let inner = svg("title", {}, escapeHtml(tip));

      if (this.options.baseline && t.bStartD && t.bFinishD) {
        const bx = this.x(t.bStartD);
        const bw = Math.max(2, this.x(t.bFinishD) - bx);
        inner += svg("rect", { x: bx, y: top + 21, width: bw, height: 4, rx: 1, class: "baseline" });
      }

      if (t.startD && t.finishD) {
        const x1 = this.x(t.startD);
        const x2 = this.x(t.finishD);
        let labelX;

        if (t.milestone) {
          const cy = top + ROW / 2;
          inner += svg("path", { d: `M${x2},${cy - 7} L${x2 + 7},${cy} L${x2},${cy + 7} L${x2 - 7},${cy} Z`, class: "milestone" });
          labelX = x2 + 11;
        } else if (t.summary) {
          const w = Math.max(2, x2 - x1);
          const y = top + 9;
          inner += svg("path", {
            d: `M${x1},${y} H${x1 + w} V${y + 10} L${x1 + w - 5},${y + 5} H${x1 + 5} L${x1},${y + 10} Z`,
            class: "summary-bar",
          });
          if (t.percent > 0) inner += svg("rect", { x: x1, y: y + 1, width: (w * Math.min(100, t.percent)) / 100, height: 3, class: "summary-progress" });
          labelX = x1 + w + 6;
        } else {
          const w = Math.max(3, x2 - x1);
          inner += svg("rect", { x: x1, y: top + 7, width: w, height: 14, rx: 3, class: "task-bar" });
          if (t.percent > 0) {
            inner += svg("rect", { x: x1, y: top + 7, width: (w * Math.min(100, t.percent)) / 100, height: 14, rx: 3, class: "task-progress" });
          }
          labelX = x1 + w + 6;
        }

        const label = t.milestone ? fmtDate(t.finishD) : (t.resources || []).join(", ");
        if (label) inner += svg("text", { x: labelX, y: top + 18, class: "bar-label" }, escapeHtml(label));
      }
      out += svg("g", { class: cls, "data-uid": t.uid }, inner);
    });
    return out;
  }

  // Dependency links that pass through the drawn rows, including ones whose
  // other end is off screen.
  linkMarkup(first, last) {
    if (!this.options.links) return "";
    let out = "";
    for (let si = 0; si < this.vis.length; si++) {
      const t = this.vis[si];
      if (!t.startD) continue;
      for (const p of t.predecessors || []) {
        const pi = this.rowOf.get(p.uid);
        if (pi == null || Math.max(pi, si) < first || Math.min(pi, si) >= last) continue;
        const pt = this.byUid.get(p.uid);
        if (!pt || !pt.startD) continue;
        const d = linkPath(this, pt, pi, t, si, p.type);
        if (!d) continue;
        const crit = this.options.critical && pt.critical && t.critical;
        out += svg("path", { d, class: crit ? "link critical" : "link", "marker-end": "url(#arrow)" });
      }
    }
    return out;
  }
}

function linkPath(g, pred, pi, succ, si, type) {
  const y1 = pi * ROW + ROW / 2;
  const y2 = si * ROW + ROW / 2;
  const edge = (t, atEnd) => {
    if (t.milestone) return g.x(t.finishD) + (atEnd ? 7 : -7);
    return g.x(atEnd ? t.finishD : t.startD);
  };
  const fromEnd = type !== "SS" && type !== "SF";
  const toStart = type !== "FF" && type !== "SF";
  const x1 = edge(pred, fromEnd);
  const x2 = edge(succ, !toStart);
  const d1 = fromEnd ? 1 : -1;
  const d2 = toStart ? 1 : -1; // direction the arrow travels as it enters
  const ax = x1 + 8 * d1;
  const bx = x2 - 8 * d2;
  const between = y2 > y1 ? si * ROW : si * ROW + ROW;

  if (d1 === d2) {
    if ((d1 === 1 && bx >= ax) || (d1 === -1 && bx <= ax)) {
      return `M${x1},${y1} H${ax} V${y2} H${x2}`;
    }
    return `M${x1},${y1} H${ax} V${between} H${bx} V${y2} H${x2}`;
  }
  const mx = d1 === 1 ? Math.max(ax, bx) : Math.min(ax, bx);
  return `M${x1},${y1} H${mx} V${y2} H${x2}`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
