/* app.js — render a normalized provenance graph with D3 force layout. */

const COLORS = {
  file: getCss("--file"),
  analysis: getCss("--analysis"),
  geneset: getCss("--geneset"),
  unknown: getCss("--unknown"),
};
const EDGE_COLORS = {
  input: getCss("--edge-input"),
  "metadata-input": getCss("--edge-metadata"),
  output: getCss("--edge-output"),
  other: getCss("--unknown"),
};

function getCss(v) {
  return getComputedStyle(document.documentElement).getPropertyValue(v).trim();
}

const svg = d3.select("#graph");
let g, simulation, model;
let selectedId = null;

const els = {
  graphName: document.getElementById("graph-name"),
  status: document.getElementById("statusbar"),
  legend: document.getElementById("legend"),
  stats: document.getElementById("stats"),
  empty: document.getElementById("empty"),
  inspectorEmpty: document.getElementById("inspector-empty"),
  inspectorContent: document.getElementById("inspector-content"),
  fileInput: document.getElementById("file-input"),
  sampleSelect: document.getElementById("sample-select"),
  resetBtn: document.getElementById("reset-btn"),
};

// ---- zoom container ----
let zoomBehavior = d3.zoom().scaleExtent([0.15, 4]).on("zoom", (e) => {
  g.attr("transform", e.transform);
});
svg.call(zoomBehavior);
g = svg.append("g");

// arrow markers (one per edge color)
const defs = svg.append("defs");
Object.entries(EDGE_COLORS).forEach(([k, c]) => {
  defs
    .append("marker")
    .attr("id", `arrow-${k}`)
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 22)
    .attr("refY", 0)
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,-5L10,0L0,5")
    .attr("fill", c);
});

function setStatus(msg) {
  els.status.textContent = msg;
}

function nodeColor(d) {
  return COLORS[d.kind] || COLORS.unknown;
}
function nodeRadius(d) {
  if (d.kind === "analysis") return 16;
  if (d.kind === "geneset") return 13;
  // scale file nodes a bit by size
  if (d.size_bytes) {
    const mb = d.size_bytes / 1e6;
    return Math.max(7, Math.min(14, 7 + Math.log10(mb + 1) * 3));
  }
  return 9;
}

function render(rawJson, sourceLabel) {
  try {
    model = normalize(rawJson);
  } catch (err) {
    setStatus("Error: " + err.message);
    els.empty.textContent = "Could not parse: " + err.message;
    els.empty.classList.remove("hidden");
    return;
  }
  els.empty.classList.add("hidden");
  els.graphName.textContent = `${model.name} · ${sourceLabel || ""}`.trim();

  drawLegend();
  drawStats();
  draw();
  setStatus(
    `Loaded ${model.nodes.length} nodes, ${model.links.length} edges from ${sourceLabel}.`
  );
}

function drawStats() {
  const counts = {};
  model.nodes.forEach((n) => (counts[n.kind] = (counts[n.kind] || 0) + 1));
  const parts = Object.entries(counts).map(
    ([k, v]) => `<b>${v}</b> ${k}`
  );
  els.stats.innerHTML =
    parts.join(" · ") + ` · <b>${model.links.length}</b> edges`;
}

function drawLegend() {
  const kinds = [...new Set(model.nodes.map((n) => n.kind))];
  const edgeKinds = [...new Set(model.links.map((e) => e.kind))];
  let html = `<h3>Nodes</h3>`;
  kinds.forEach((k) => {
    html += `<div class="row"><span class="swatch" style="background:${
      COLORS[k] || COLORS.unknown
    }"></span>${k}</div>`;
  });
  html += `<h3 style="margin-top:10px">Edges</h3>`;
  edgeKinds.forEach((k) => {
    html += `<div class="row"><span class="line" style="border-color:${
      EDGE_COLORS[k] || EDGE_COLORS.other
    }"></span>${k}</div>`;
  });
  els.legend.innerHTML = html;
}

function draw() {
  g.selectAll("*").remove();
  const { width, height } = svg.node().getBoundingClientRect();

  // fresh copies so D3 can mutate x/y
  const nodes = model.nodes.map((d) => ({ ...d }));
  const links = model.links.map((d) => ({ ...d }));

  // ---- layered top→bottom DAG layout ----
  const ranks = computeRanks(nodes, links);
  const maxRank = Math.max(0, ...nodes.map((n) => ranks.get(n.id)));
  const topPad = 70;
  const bottomPad = 50;
  const usableH = Math.max(height - topPad - bottomPad, 200);
  const rowH = maxRank > 0 ? usableH / maxRank : 0;

  // Group nodes by rank to spread them evenly across the width.
  const byRank = d3.group(nodes, (n) => ranks.get(n.id));
  byRank.forEach((rowNodes, r) => {
    const y = topPad + r * rowH;
    const n = rowNodes.length;
    rowNodes.forEach((node, i) => {
      // even horizontal spacing, centered
      node.targetX = ((i + 1) / (n + 1)) * width;
      node.targetY = y;
      node.rank = r;
      // seed positions so the sim converges fast & stable
      node.x = node.targetX;
      node.y = y;
    });
  });

  // Force sim: Y is locked to the rank row; X relaxes to reduce edge crossings
  // and node overlap while staying near the evenly-spaced target.
  simulation = d3
    .forceSimulation(nodes)
    .force(
      "link",
      d3
        .forceLink(links)
        .id((d) => d.id)
        .distance(rowH || 120)
        .strength(0.15)
    )
    .force("xTarget", d3.forceX((d) => d.targetX).strength(0.25))
    .force("collide", d3.forceCollide().radius((d) => nodeRadius(d) + 26))
    .force("yRow", d3.forceY((d) => d.targetY).strength(1));

  const link = g
    .append("g")
    .selectAll("path")
    .data(links)
    .join("path")
    .attr("class", "link")
    .attr("fill", "none")
    .attr("stroke", (d) => EDGE_COLORS[d.kind] || EDGE_COLORS.other)
    .attr("stroke-width", 1.8)
    .attr("marker-end", (d) => `url(#arrow-${d.kind})`)
    .on("click", (e, d) => {
      e.stopPropagation();
      selectEdge(d);
    });

  const linkLabel = g
    .append("g")
    .selectAll("text")
    .data(links)
    .join("text")
    .attr("class", "link-label")
    .text((d) => d.label);

  const node = g
    .append("g")
    .selectAll("g")
    .data(nodes)
    .join("g")
    .attr("class", "node")
    .call(drag(simulation))
    .on("click", (e, d) => {
      e.stopPropagation();
      selectNode(d);
    });

  node
    .append("circle")
    .attr("r", nodeRadius)
    .attr("fill", nodeColor);

  node
    .append("text")
    .attr("class", "node-label")
    .attr("text-anchor", "middle")
    .attr("y", (d) => nodeRadius(d) + 14)
    .text((d) => truncate(d.label, 30));

  node.append("title").text((d) => `${d.type}\n${d.label}`);

  // click empty space clears selection
  svg.on("click", clearSelection);

  // Vertical cubic path between source (bottom) and target (top).
  function linkPath(d) {
    const x1 = d.source.x,
      y1 = d.source.y,
      x2 = d.target.x,
      y2 = d.target.y;
    const my = (y1 + y2) / 2;
    return `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
  }

  simulation.on("tick", () => {
    link.attr("d", linkPath);
    linkLabel
      .attr("x", (d) => (d.source.x + d.target.x) / 2)
      .attr("y", (d) => (d.source.y + d.target.y) / 2 - 3);
    node.attr("transform", (d) => `translate(${d.x},${d.y})`);
  });

  // store selections for highlight
  draw._link = link;
  draw._linkLabel = linkLabel;
  draw._node = node;
  draw._nodes = nodes;
  draw._links = links;
}

/**
 * Assign each node a rank (row) for a top→bottom layered layout:
 * rank = longest path length from any source (in-degree 0) node.
 * Handles cycles defensively by capping iterations.
 */
function computeRanks(nodes, links) {
  const id = (x) => (typeof x === "object" ? x.id : x);
  const incoming = new Map(nodes.map((n) => [n.id, 0]));
  const outAdj = new Map(nodes.map((n) => [n.id, []]));
  links.forEach((l) => {
    const s = id(l.source),
      t = id(l.target);
    if (incoming.has(t)) incoming.set(t, incoming.get(t) + 1);
    if (outAdj.has(s)) outAdj.get(s).push(t);
  });

  const rank = new Map(nodes.map((n) => [n.id, 0]));
  // Kahn-style longest-path: process in topological order.
  let queue = nodes.filter((n) => incoming.get(n.id) === 0).map((n) => n.id);
  const indeg = new Map(incoming);
  let guard = nodes.length * nodes.length + 10;

  // If everything has incoming (pure cycle), seed with all nodes.
  if (queue.length === 0) queue = nodes.map((n) => n.id);

  while (queue.length && guard-- > 0) {
    const u = queue.shift();
    for (const v of outAdj.get(u) || []) {
      if (rank.get(v) < rank.get(u) + 1) rank.set(v, rank.get(u) + 1);
      indeg.set(v, indeg.get(v) - 1);
      if (indeg.get(v) === 0) queue.push(v);
    }
  }
  return rank;
}

function drag(sim) {
  return d3
    .drag()
    .on("start", (e, d) => {
      if (!e.active) sim.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    })
    .on("drag", (e, d) => {
      d.fx = e.x;
      d.fy = e.y;
    })
    .on("end", (e, d) => {
      if (!e.active) sim.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    });
}

// ---- selection & highlight ----
function neighborsOf(id) {
  const set = new Set([id]);
  draw._links.forEach((l) => {
    const s = l.source.id || l.source;
    const t = l.target.id || l.target;
    if (s === id) set.add(t);
    if (t === id) set.add(s);
  });
  return set;
}

function selectNode(d) {
  selectedId = d.id;
  const keep = neighborsOf(d.id);
  draw._node.classed("dim", (n) => !keep.has(n.id));
  draw._node.classed("selected", (n) => n.id === d.id);
  draw._link.classed("dim", (l) => {
    const s = l.source.id || l.source;
    const t = l.target.id || l.target;
    return !(s === d.id || t === d.id);
  });
  draw._link.classed("selected", (l) => {
    const s = l.source.id || l.source;
    const t = l.target.id || l.target;
    return s === d.id || t === d.id;
  });
  draw._linkLabel.classed("dim", (l) => {
    const s = l.source.id || l.source;
    const t = l.target.id || l.target;
    return !(s === d.id || t === d.id);
  });
  showNodeInspector(d);
}

function selectEdge(d) {
  selectedId = null;
  draw._node.classed("dim", false).classed("selected", false);
  draw._link.classed("dim", (l) => l !== d).classed("selected", (l) => l === d);
  draw._linkLabel.classed("dim", (l) => l !== d);
  showEdgeInspector(d);
}

function clearSelection() {
  selectedId = null;
  if (!draw._node) return;
  draw._node.classed("dim", false).classed("selected", false);
  draw._link.classed("dim", false).classed("selected", false);
  draw._linkLabel.classed("dim", false);
  els.inspectorContent.classList.add("hidden");
  els.inspectorEmpty.classList.remove("hidden");
}

// ---- inspector rendering ----
function field(k, v, isLink) {
  if (v == null || v === "") return "";
  const val = isLink
    ? `<a href="${v}" target="_blank" rel="noopener">${escapeHtml(v)}</a>`
    : escapeHtml(String(v));
  return `<div class="field"><div class="k">${k}</div><div class="v">${val}</div></div>`;
}

function isUrl(s) {
  return typeof s === "string" && /^(https?|s3|gs):\/\//.test(s);
}

function showNodeInspector(d) {
  const color = nodeColor(d);
  let html = `
    <div class="insp-head">
      <span class="insp-badge" style="background:${color}">${escapeHtml(
    d.type || d.kind
  )}</span>
    </div>
    <h2 class="insp-title">${escapeHtml(d.label)}</h2>
    ${d.description ? `<p class="insp-desc">${escapeHtml(d.description)}</p>` : ""}
    ${field("ID", d.id)}
    ${field("Role", d.role)}
    ${field("Size", d.size_human)}
    ${field("MD5", d.md5)}
    ${field("UUID", d.uuid)}
    ${field("Local ID", d.local_id, isUrl(d.local_id))}
    ${field("DCC URL", d.dcc_url, isUrl(d.dcc_url))}
    ${field("DRC URL", d.drc_url, isUrl(d.drc_url))}
  `;

  // Edges touching this node
  const ins = [];
  const outs = [];
  draw._links.forEach((l) => {
    const s = l.source.id || l.source;
    const t = l.target.id || l.target;
    if (t === d.id) ins.push(l);
    if (s === d.id) outs.push(l);
  });
  if (ins.length || outs.length) {
    html += `<div class="section-title">Connections</div>`;
    html += `<table class="kv-table">`;
    ins.forEach((l) => {
      const s = nodeLabelById(l.source.id || l.source);
      html += `<tr><td class="k">← ${escapeHtml(l.label)}</td><td class="v">${escapeHtml(
        s
      )}</td></tr>`;
    });
    outs.forEach((l) => {
      const t = nodeLabelById(l.target.id || l.target);
      html += `<tr><td class="k">${escapeHtml(l.label)} →</td><td class="v">${escapeHtml(
        t
      )}</td></tr>`;
    });
    html += `</table>`;
  }

  // Analysis details
  if (d.analysis) {
    const a = d.analysis;
    html += `<div class="section-title">Analysis</div>`;
    html += field("Version", a.version);
    html += field("Script URL", a.script_url, isUrl(a.script_url));
    if (a.environment) {
      html += `<div class="field"><div class="k">Environment</div><div class="v">`;
      html += kvTable(a.environment);
      html += `</div></div>`;
    }
    if (a.parameters && Object.keys(a.parameters).length) {
      html += `<div class="field"><div class="k">Parameters</div><div class="v">`;
      html += kvTable(a.parameters);
      html += `</div></div>`;
    }
    if (a.command) {
      html += `<div class="field"><div class="k">Command</div></div>`;
      html += `<pre class="code">${escapeHtml(a.command)}</pre>`;
    }
  }

  html += `<div class="section-title">Raw node</div>`;
  html += `<pre class="code">${escapeHtml(JSON.stringify(d.raw, null, 2))}</pre>`;

  els.inspectorContent.innerHTML = html;
  els.inspectorContent.classList.remove("hidden");
  els.inspectorEmpty.classList.add("hidden");
}

function showEdgeInspector(d) {
  const color = EDGE_COLORS[d.kind] || EDGE_COLORS.other;
  const s = nodeLabelById(d.source.id || d.source);
  const t = nodeLabelById(d.target.id || d.target);
  let html = `
    <div class="insp-head">
      <span class="insp-badge" style="background:${color}">edge · ${escapeHtml(
    d.kind
  )}</span>
    </div>
    <h2 class="insp-title">${escapeHtml(d.label)}</h2>
    ${d.description ? `<p class="insp-desc">${escapeHtml(d.description)}</p>` : ""}
    ${field("Source", s)}
    ${field("Target", t)}
    ${field("Edge ID", d.id)}
    <div class="section-title">Raw edge</div>
    <pre class="code">${escapeHtml(JSON.stringify(d.raw, null, 2))}</pre>
  `;
  els.inspectorContent.innerHTML = html;
  els.inspectorContent.classList.remove("hidden");
  els.inspectorEmpty.classList.add("hidden");
}

function kvTable(obj) {
  let h = `<table class="kv-table">`;
  for (const [k, v] of Object.entries(obj)) {
    const val = v == null ? "—" : isUrl(v) ? `<a href="${v}" target="_blank" rel="noopener">${escapeHtml(String(v))}</a>` : escapeHtml(String(v));
    h += `<tr><td class="k">${escapeHtml(k)}</td><td class="v">${val}</td></tr>`;
  }
  return h + `</table>`;
}

function nodeLabelById(id) {
  const n = model.nodes.find((x) => x.id === id);
  return n ? n.label : id;
}

// ---- utils ----
function truncate(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---- loading ----
async function loadSample(url) {
  setStatus("Loading " + url + " …");
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();
    render(json, url.split("/").pop());
  } catch (err) {
    setStatus("Failed to load sample: " + err.message);
    els.empty.textContent =
      "Failed to load sample (" + err.message + "). Try loading a JSON file manually.";
    els.empty.classList.remove("hidden");
  }
}

els.fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      render(JSON.parse(reader.result), file.name);
    } catch (err) {
      setStatus("Invalid JSON: " + err.message);
    }
  };
  reader.readAsText(file);
});

els.sampleSelect.addEventListener("change", (e) => loadSample(e.target.value));
els.resetBtn.addEventListener("click", () => {
  svg.transition().duration(400).call(zoomBehavior.transform, d3.zoomIdentity);
  if (simulation) simulation.alpha(0.6).restart();
  clearSelection();
});

window.addEventListener("resize", () => {
  if (model) draw();
});

/**
 * Populate the dropdown from data/manifest.json so users can render their own
 * graphs without touching code: drop a *.json into data/ and add an entry to
 * data/manifest.json (see dashboard README). The manifest is an array of
 * { "file": "data/<name>.json", "label": "<display name>" }.
 *
 * Falls back to whatever <option>s are already in index.html if the manifest
 * is missing (e.g. opened via file:// without the manifest present).
 */
async function init() {
  let options = [];
  try {
    const res = await fetch("data/manifest.json", { cache: "no-store" });
    if (res.ok) {
      const manifest = await res.json();
      if (Array.isArray(manifest)) options = manifest;
    }
  } catch (_) {
    /* no manifest — fall back to static <option>s below */
  }

  if (options.length) {
    els.sampleSelect.innerHTML = options
      .map(
        (o) =>
          `<option value="${o.file}">${(o.label || o.file).replace(
            /</g,
            "&lt;"
          )}</option>`
      )
      .join("");
  }

  const first = els.sampleSelect.value;
  if (first) {
    loadSample(first);
  } else {
    els.empty.textContent = "No graphs in data/manifest.json. Use Load JSON to render a file.";
    els.empty.classList.remove("hidden");
    setStatus("No built-in graphs found. Load a JSON file to begin.");
  }
}

init();
