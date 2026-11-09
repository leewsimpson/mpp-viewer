import { Gantt, fmtDate, escapeHtml } from "./gantt.js";

const isTauri = "__TAURI_INTERNALS__" in window;
const $ = (id) => document.getElementById(id);

const FILE_TYPES = ["mpp", "mpt", "mpd", "xml", "mpx", "xer", "pmxml", "planner", "gan", "pp", "pod", "fts"];

const gantt = new Gantt({
  gridBody: $("grid-body"),
  scaleSvg: $("scale"),
  barsSvg: $("bars"),
  chartBody: $("chart-body"),
  onSelect: showDetails,
});

let currentFile = null;

// ---------- Opening files ----------

async function pickFile() {
  if (!isTauri) {
    $("dev-file").click();
    return;
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const path = await open({
    multiple: false,
    directory: false,
    filters: [
      { name: "Project files", extensions: FILE_TYPES },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (path) openPath(path);
}

// Only the most recently requested file is shown, even if an earlier, slower
// one finishes after it.
let openRequest = 0;

async function openPath(path) {
  const request = ++openRequest;
  setLoading(true);
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    // The backend passes the converter's JSON through, so this is already parsed.
    const data = await invoke("open_project", { path });
    if (request === openRequest) showProject(data);
  } catch (e) {
    if (request === openRequest) showError(String(e));
  } finally {
    if (request === openRequest) setLoading(false);
  }
}

function showProject(data) {
  currentFile = data;
  $("empty").hidden = true;
  $("main").hidden = false;
  const title = data.project?.title || data.fileName || "Untitled";
  $("project-title").textContent = title;
  const p = data.project || {};
  const range = p.start || p.finish ? `${fmtDate(p.start && new Date(p.start))} – ${fmtDate(p.finish && new Date(p.finish))}` : "";
  $("project-meta").textContent = [data.fileName !== title ? data.fileName : "", `${data.tasks.length} tasks`, range]
    .filter(Boolean)
    .join(" · ");
  document.title = `${title} — MPP Viewer`;
  if (isTauri) {
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().setTitle(document.title)).catch(() => {});
  }
  $("search").value = "";
  gantt.load(data);
  showDetails(null);
  // Start the view at the project's first task.
  requestAnimationFrame(() => {
    $("chart-body").scrollTop = 0;
    gantt.scrollToDate(gantt.dataMin);
  });
}

// ---------- Details panel ----------

function showDetails(t) {
  const panel = $("details");
  if (!t) {
    panel.hidden = true;
    return;
  }
  const preds = (t.predecessors || [])
    .map((p) => {
      const pt = gantt.byUid.get(p.uid);
      const lag = p.lag && !/^0[a-z]*$/.test(p.lag) ? ` +${p.lag}` : "";
      return `<li>${escapeHtml(pt ? `${pt.id ?? ""} ${pt.name ?? ""}` : `#${p.uid}`)} <span class="muted">${p.type}${lag}</span></li>`;
    })
    .join("");
  const succs = (gantt.successors.get(t.uid) || [])
    .map((s) => `<li>${escapeHtml(`${s.id ?? ""} ${s.name ?? ""}`)}</li>`)
    .join("");
  const row = (label, value) => (value ? `<dt>${label}</dt><dd>${value}</dd>` : "");

  panel.innerHTML = `
    <div class="details-head">
      <h2>${escapeHtml(t.name || "Untitled task")}</h2>
      <button class="close" id="details-close" aria-label="Close">×</button>
    </div>
    <div class="details-body">
      <dl>
        ${row("ID", escapeHtml(String(t.id ?? "")) + (t.wbs ? ` <span class="muted">WBS ${escapeHtml(t.wbs)}</span>` : ""))}
        ${row("Start", fmtDate(t.startD))}
        ${row("Finish", fmtDate(t.finishD))}
        ${row("Duration", escapeHtml(t.duration || ""))}
        ${row("Complete", t.percent != null ? `${Math.round(t.percent)}%` : "")}
        ${row("Baseline", t.bStartD ? `${fmtDate(t.bStartD)} – ${fmtDate(t.bFinishD)}` : "")}
        ${row("Resources", escapeHtml((t.resources || []).join(", ")))}
        ${row("Type", [t.summary && "Summary", t.milestone && "Milestone", t.critical && "Critical"].filter(Boolean).join(", "))}
      </dl>
      ${preds ? `<h3>Predecessors</h3><ul>${preds}</ul>` : ""}
      ${succs ? `<h3>Successors</h3><ul>${succs}</ul>` : ""}
      ${t.notes ? `<h3>Notes</h3><p class="notes">${escapeHtml(t.notes)}</p>` : ""}
    </div>`;
  panel.hidden = false;
  $("details-close").onclick = () => gantt.select(null);
}

// ---------- UI helpers ----------

function setLoading(on) {
  $("loading").hidden = !on;
}

let errorTimer;
function showError(msg) {
  const box = $("error");
  box.textContent = msg;
  box.hidden = false;
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => (box.hidden = true), 8000);
}
$("error").onclick = () => ($("error").hidden = true);

// ---------- Toolbar ----------

$("btn-open").onclick = pickFile;
$("btn-open-empty").onclick = pickFile;
$("zoom").onchange = (e) => {
  const body = $("chart-body");
  // Keep the date in the middle of the view steady while zooming.
  const midDate = new Date(gantt.origin.getTime() + ((body.scrollLeft + body.clientWidth / 2) / gantt.px) * 86400000);
  gantt.setOption("zoom", e.target.value);
  body.scrollLeft = Math.max(0, gantt.x(midDate) - body.clientWidth / 2);
};
$("opt-critical").onchange = (e) => gantt.setOption("critical", e.target.checked);
$("opt-baseline").onchange = (e) => gantt.setOption("baseline", e.target.checked);
$("opt-links").onchange = (e) => gantt.setOption("links", e.target.checked);
$("btn-expand").onclick = () => gantt.expandAll();
$("btn-collapse").onclick = () => gantt.collapseAll();
$("btn-today").onclick = () => gantt.scrollToDate(new Date());

let matchList = [];
let matchIndex = -1;
$("search").addEventListener("input", (e) => {
  matchList = gantt.search(e.target.value);
  matchIndex = -1;
});
$("search").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && matchList.length) {
    matchIndex = (matchIndex + (e.shiftKey ? -1 : 1) + matchList.length) % matchList.length;
    gantt.select(matchList[matchIndex], true);
  } else if (e.key === "Escape") {
    e.target.value = "";
    matchList = gantt.search("");
    matchIndex = -1;
  }
});

// ---------- Grid / chart interaction ----------

$("grid-body").addEventListener("click", (e) => {
  const toggle = e.target.closest("[data-toggle]");
  if (toggle) {
    gantt.toggle(Number(toggle.dataset.toggle));
    return;
  }
  const row = e.target.closest(".row[data-uid]");
  if (row) gantt.select(Number(row.dataset.uid));
});

$("bars").addEventListener("click", (e) => {
  const hit = e.target.closest("[data-uid]");
  gantt.select(hit ? Number(hit.dataset.uid) : null);
});

// Keep the grid and chart scrolled together.
const gridBody = $("grid-body");
const chartBody = $("chart-body");
const chartHead = $("chart-head");
let syncing = false;
chartBody.addEventListener("scroll", () => {
  chartHead.scrollLeft = chartBody.scrollLeft;
  if (syncing) return;
  syncing = true;
  gridBody.scrollTop = chartBody.scrollTop;
  requestAnimationFrame(() => (syncing = false));
});
gridBody.addEventListener("scroll", () => {
  if (syncing) return;
  syncing = true;
  chartBody.scrollTop = gridBody.scrollTop;
  requestAnimationFrame(() => (syncing = false));
});

// Draggable splitter between grid and chart.
const splitter = $("splitter");
splitter.addEventListener("pointerdown", (e) => {
  splitter.setPointerCapture(e.pointerId);
  const startX = e.clientX;
  const startW = $("grid").getBoundingClientRect().width;
  const move = (ev) => {
    const w = Math.max(240, Math.min(window.innerWidth - 200, startW + ev.clientX - startX));
    document.documentElement.style.setProperty("--grid-width", `${w}px`);
  };
  const up = () => {
    splitter.removeEventListener("pointermove", move);
    splitter.removeEventListener("pointerup", up);
    splitter.removeEventListener("pointercancel", up);
    // The chart is now a different width; redraw so its rows fill it.
    if (currentFile) gantt.render();
  };
  splitter.addEventListener("pointermove", move);
  splitter.addEventListener("pointerup", up);
  splitter.addEventListener("pointercancel", up);
});

// Keyboard shortcuts.
document.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === "o") {
    e.preventDefault();
    pickFile();
  } else if (mod && e.key.toLowerCase() === "f") {
    e.preventDefault();
    $("search").focus();
  } else if (!["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName) && currentFile) {
    if (e.key === "ArrowDown") (e.preventDefault(), gantt.moveSelection(1));
    else if (e.key === "ArrowUp") (e.preventDefault(), gantt.moveSelection(-1));
    else if (e.key === "Escape") gantt.select(null);
    else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && gantt.selected != null) {
      const t = gantt.byUid.get(gantt.selected);
      if (t?.summary) {
        const collapsed = gantt.collapsed.has(t.uid);
        if ((e.key === "ArrowLeft") !== collapsed) gantt.toggle(t.uid);
      }
    }
  }
});

// Re-render at most once per frame while the window is being resized.
let resizeFrame = 0;
window.addEventListener("resize", () => {
  if (!currentFile || resizeFrame) return;
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0;
    gantt.render();
  });
});

// ---------- Drag and drop / OS "Open With" ----------

if (isTauri) {
  (async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const { listen } = await import("@tauri-apps/api/event");
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");

    await getCurrentWebview().onDragDropEvent((ev) => {
      const p = ev.payload;
      document.body.classList.toggle("dragging", p.type === "enter" || p.type === "over");
      if (p.type === "drop" && p.paths?.length) openPath(p.paths[0]);
    });

    await listen("open-file", async (ev) => {
      await invoke("take_pending_file");
      openPath(ev.payload);
    });

    const pending = await invoke("take_pending_file");
    if (pending) openPath(pending);
  })();
} else {
  // Browser dev mode: load JSON produced by the converter.
  const loadJsonFile = async (file) => {
    try {
      showProject(JSON.parse(await file.text()));
    } catch (e) {
      showError(`Not a converter JSON file: ${e.message}`);
    }
  };
  $("dev-file").onchange = (e) => e.target.files[0] && loadJsonFile(e.target.files[0]);
  window.addEventListener("dragover", (e) => {
    e.preventDefault();
    document.body.classList.add("dragging");
  });
  window.addEventListener("dragleave", () => document.body.classList.remove("dragging"));
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    document.body.classList.remove("dragging");
    if (e.dataTransfer.files[0]) loadJsonFile(e.dataTransfer.files[0]);
  });
  // ?sample loads the bundled demo for quick UI work.
  if (new URLSearchParams(location.search).has("sample")) {
    fetch("/samples/office-fitout.json").then((r) => r.json()).then(showProject).catch(() => {});
  }
}
