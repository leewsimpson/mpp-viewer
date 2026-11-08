// Gantt view: task grid on the left, timeline on the right.
// Plain DOM + SVG, no external libraries, so it works fully offline.

const SVG = "http://www.w3.org/2000/svg";
const DAY = 86400000;
export const ROW = 28;

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

function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
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
    this.byUid = new Map();
    this.collapsed = new Set();
    this.selected = null;
    this.matches = new Set();
    this.options = { zoom: "week", critical: false, baseline: false, links: true };
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
    for (const t of this.tasks) {
      if (t.parent != null) {
        if (!this.children.has(t.parent)) this.children.set(t.parent, []);
        this.children.get(t.parent).push(t);
      }
    }
    // Treat any task with children as a summary, even if the file didn't flag it.
    for (const t of this.tasks) if (this.children.has(t.uid)) t.summary = true;
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

  visible() {
    return this.tasks.filter((t) => !this.isHidden(t));
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

  reveal(uid) {
    let p = this.byUid.get(uid)?.parent;
    while (p != null) {
      this.collapsed.delete(p);
      p = this.byUid.get(p)?.parent;
    }
  }

  select(uid, scroll = false) {
    this.selected = uid;
    if (uid != null) this.reveal(uid);
    this.render();
    this.onSelect(uid == null ? null : this.byUid.get(uid));
    if (scroll && uid != null) this.scrollToTask(uid);
  }

  moveSelection(delta) {
    const vis = this.visible();
    if (!vis.length) return;
    let i = vis.findIndex((t) => t.uid === this.selected);
    i = i < 0 ? 0 : Math.max(0, Math.min(vis.length - 1, i + delta));
    this.select(vis[i].uid, true);
  }

  search(text) {
    this.matches.clear();
    const q = text.trim().toLowerCase();
    if (q) {
      for (const t of this.tasks) {
        if ((t.name || "").toLowerCase().includes(q) || (t.resources || []).some((r) => r.toLowerCase().includes(q))) {
          this.matches.add(t.uid);
        }
      }
    }
    this.render();
    return [...this.matches];
  }

  scrollToTask(uid) {
    const vis = this.visible();
    const i = vis.findIndex((t) => t.uid === uid);
    if (i < 0) return;
    const t = vis[i];
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

    const vis = this.visible();
    this.renderGrid(vis);
    this.renderScale(z);
    this.renderBars(vis, z);
  }

  renderGrid(vis) {
    const frag = document.createDocumentFragment();
    for (const t of vis) {
      const row = document.createElement("div");
      row.className = "row";
      if (t.summary) row.classList.add("summary");
      if (t.uid === this.selected) row.classList.add("selected");
      if (this.matches.has(t.uid)) row.classList.add("match");
      if (this.options.critical && t.critical && !t.summary) row.classList.add("critical");
      row.dataset.uid = t.uid;

      const caret = t.summary
        ? `<button class="caret" data-toggle="${t.uid}" aria-label="Toggle">${this.collapsed.has(t.uid) ? "▸" : "▾"}</button>`
        : `<span class="caret-space"></span>`;
      const indent = Math.max(0, (t.level || 1) - 1) * 14;
      row.innerHTML = `
        <div class="c-id">${t.id ?? ""}</div>
        <div class="c-name" style="padding-left:${indent + 4}px">${caret}<span class="name">${escapeHtml(t.name || "")}</span>${t.milestone ? '<span class="ms-tag">◆</span>' : ""}</div>
        <div class="c-dur">${escapeHtml(t.duration || "")}</div>
        <div class="c-date">${fmtDate(t.startD)}</div>
        <div class="c-date">${fmtDate(t.finishD)}</div>
        <div class="c-pct">${t.percent != null ? Math.round(t.percent) + "%" : ""}</div>`;
      row.title = t.name || "";
      frag.appendChild(row);
    }
    this.gridBody.replaceChildren(frag);
    // Spacer so grid and chart scroll to the same height (chart has a horizontal scrollbar).
    const pad = document.createElement("div");
    pad.style.height = "40px";
    this.gridBody.appendChild(pad);
  }

  renderScale(z) {
    const svg = this.scaleSvg;
    svg.replaceChildren();
    svg.setAttribute("width", this.width);
    svg.setAttribute("height", 44);
    const end = new Date(this.origin.getTime() + (this.width / this.px) * DAY);

    // Top tier: months or years.
    for (let d = startOfUnit(this.origin, z.major); d < end; d = addUnit(d, z.major)) {
      const x1 = Math.max(0, this.x(d));
      const x2 = this.x(addUnit(d, z.major));
      el("line", { x1: this.x(d), x2: this.x(d), y1: 0, y2: 22, class: "tick-major" }, svg);
      const label = z.major === "month" ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : String(d.getFullYear());
      if (x2 - x1 > 40) el("text", { x: x1 + 6, y: 15, class: "scale-major" }, svg).textContent = label;
    }
    el("line", { x1: 0, x2: this.width, y1: 22, y2: 22, class: "tick-major" }, svg);

    // Bottom tier: days, weeks, months or quarters.
    for (let d = startOfUnit(this.origin, z.minor); d < end; d = addUnit(d, z.minor)) {
      const x1 = this.x(d);
      const w = this.x(addUnit(d, z.minor)) - x1;
      el("line", { x1, x2: x1, y1: 22, y2: 44, class: "tick-minor" }, svg);
      const label = unitLabel(d, z.minor, w);
      if (label) {
        const anchor = z.minor === "day" ? "middle" : "start";
        el("text", { x: z.minor === "day" ? x1 + w / 2 : x1 + 4, y: 37, class: "scale-minor", "text-anchor": anchor }, svg).textContent = label;
      }
    }
    el("line", { x1: 0, x2: this.width, y1: 43.5, y2: 43.5, class: "tick-major" }, svg);
  }

  renderBars(vis, z) {
    const svg = this.barsSvg;
    svg.replaceChildren();
    const height = Math.max(vis.length * ROW, this.chartBody.clientHeight - 16);
    svg.setAttribute("width", this.width);
    svg.setAttribute("height", height);

    const defs = el("defs", {}, svg);
    const marker = el("marker", { id: "arrow", viewBox: "0 0 8 8", refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, defs);
    el("path", { d: "M0,0 L8,4 L0,8 z", class: "arrow-head" }, marker);

    const bg = el("g", {}, svg);
    const grid = el("g", {}, svg);
    const links = el("g", { class: "links" }, svg);
    const bars = el("g", {}, svg);

    // Row stripes + selection.
    vis.forEach((t, i) => {
      const cls = t.uid === this.selected ? "row-bg selected" : this.matches.has(t.uid) ? "row-bg match" : i % 2 ? "row-bg odd" : "row-bg";
      el("rect", { x: 0, y: i * ROW, width: this.width, height: ROW, class: cls, "data-uid": t.uid }, bg);
    });

    // Weekend shading and vertical grid lines.
    const end = new Date(this.origin.getTime() + (this.width / this.px) * DAY);
    if (z.minor === "day" || z.minor === "week") {
      for (let d = new Date(this.origin); d < end; d = addUnit(d, "day")) {
        const dow = d.getDay();
        if (dow === 6) el("rect", { x: this.x(d), y: 0, width: this.px * 2, height, class: "weekend" }, grid);
      }
    }
    for (let d = startOfUnit(this.origin, z.minor); d < end; d = addUnit(d, z.minor)) {
      el("line", { x1: this.x(d), x2: this.x(d), y1: 0, y2: height, class: "grid-line" }, grid);
    }

    // Today marker.
    const today = new Date();
    if (today > this.origin && today < end) {
      const tx = this.x(today);
      el("line", { x1: tx, x2: tx, y1: 0, y2: height, class: "today" }, grid);
    }

    const rowOf = new Map(vis.map((t, i) => [t.uid, i]));

    // Bars.
    vis.forEach((t, i) => {
      const top = i * ROW;
      const g = el("g", { class: "bar", "data-uid": t.uid }, bars);
      const crit = this.options.critical && t.critical && !t.summary;
      if (crit) g.classList.add("critical");
      if (t.uid === this.selected) g.classList.add("selected");
      const tip = el("title", {}, g);
      tip.textContent = `${t.name || ""}\n${fmtDate(t.startD)} → ${fmtDate(t.finishD)}${t.duration ? ` (${t.duration})` : ""}${t.percent ? `\n${Math.round(t.percent)}% complete` : ""}`;

      if (this.options.baseline && t.bStartD && t.bFinishD) {
        const bx = this.x(t.bStartD);
        const bw = Math.max(2, this.x(t.bFinishD) - bx);
        el("rect", { x: bx, y: top + 21, width: bw, height: 4, rx: 1, class: "baseline" }, g);
      }

      if (!t.startD || !t.finishD) return;
      const x1 = this.x(t.startD);
      const x2 = this.x(t.finishD);
      let labelX;

      if (t.milestone) {
        const cy = top + ROW / 2;
        el("path", { d: `M${x2},${cy - 7} L${x2 + 7},${cy} L${x2},${cy + 7} L${x2 - 7},${cy} Z`, class: "milestone" }, g);
        labelX = x2 + 11;
      } else if (t.summary) {
        const w = Math.max(2, x2 - x1);
        const y = top + 9;
        el("path", {
          d: `M${x1},${y} H${x1 + w} V${y + 10} L${x1 + w - 5},${y + 5} H${x1 + 5} L${x1},${y + 10} Z`,
          class: "summary-bar",
        }, g);
        if (t.percent > 0) el("rect", { x: x1, y: y + 1, width: (w * Math.min(100, t.percent)) / 100, height: 3, class: "summary-progress" }, g);
        labelX = x1 + w + 6;
      } else {
        const w = Math.max(3, x2 - x1);
        el("rect", { x: x1, y: top + 7, width: w, height: 14, rx: 3, class: "task-bar" }, g);
        if (t.percent > 0) {
          el("rect", { x: x1, y: top + 7, width: (w * Math.min(100, t.percent)) / 100, height: 14, rx: 3, class: "task-progress" }, g);
        }
        labelX = x1 + w + 6;
      }

      const label = t.milestone ? fmtDate(t.finishD) : (t.resources || []).join(", ");
      if (label) el("text", { x: labelX, y: top + 18, class: "bar-label" }, g).textContent = label;
    });

    // Dependency links.
    if (this.options.links) {
      for (const t of vis) {
        const si = rowOf.get(t.uid);
        for (const p of t.predecessors || []) {
          const pi = rowOf.get(p.uid);
          const pt = this.byUid.get(p.uid);
          if (pi == null || !pt || !pt.startD || !t.startD) continue;
          const d = linkPath(this, pt, pi, t, si, p.type);
          if (!d) continue;
          const crit = this.options.critical && pt.critical && t.critical;
          el("path", { d, class: crit ? "link critical" : "link", "marker-end": "url(#arrow)" }, links);
        }
      }
    }
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
