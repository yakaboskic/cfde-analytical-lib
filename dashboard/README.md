# Provenance Graph Dashboard

A self-contained, static dashboard for visualizing CFDE / C2M2-style provenance
graphs like the ones emitted by
[`dig-gene-set-extractors`](https://github.com/flannick/dig-gene-set-extractors)
(e.g. `deg_long.provenance_graph.json`).

No build step, no server-side code — just open `index.html` (D3.js is loaded
from a CDN). Works as a published static portal.

## Features

- **Top-to-bottom layered (DAG) layout**: inputs on top, analysis/process steps
  in the middle, outputs at the bottom — so data flow reads top→down. Each node
  is ranked by its longest path from a source; edges are drawn as downward
  curves with arrowheads.
- **Color-coded nodes** by kind (file / analysis / geneset) and **directional,
  color-coded edges** by relationship (`data input`, `metadata input`,
  `data output`).
- **Click-to-inspect**: any node or edge opens a panel with its full provenance
  details — C2M2 properties (md5, size, UUID, `local_id`), DCC/DRC URLs, and for
  analysis nodes the **command, environment, parameters, and version**.
- **Neighbor highlighting**, drag, zoom/pan, and a "Reset view" control.
- **Load your own** graph via the *Load JSON* button, or switch between built-in
  samples.

## Run locally

```bash
cd dashboard
python3 -m http.server 8000
# open http://localhost:8000
```

> Use a local server (not `file://`) so the dashboard can `fetch` the graphs in
> `data/`. The **Load JSON** button works under `file://` too.

## Render your own provenance graph

Two ways:

**A. Drop it into `data/` (persistent, appears in the dropdown)**

1. Copy your raw provenance JSON into [`data/`](data/), e.g.
   `data/my_graph.provenance_graph.json`.
2. Add an entry to [`data/manifest.json`](data/manifest.json):

   ```json
   [
     { "file": "data/deg_long.provenance_graph.json", "label": "sample: deg_long (GTEx adipose / HZ1)" },
     { "file": "data/my_graph.provenance_graph.json",  "label": "my graph" }
   ]
   ```

   `file` is relative to `dashboard/` (always starts with `data/`); `label` is
   the dropdown text. Reload — your graph is now selectable. No code changes.

**B. One-off**: click **Load JSON** in the top bar and pick any file. Nothing is
saved.

See [`data/README.md`](data/README.md) for the full drop-in guide and the
expected JSON shape.

## Schema

The dashboard targets the C2M2 / DCC-DRC provenance format. The full inferred
schema is documented at the top of [`js/schema.js`](js/schema.js). Summary:

**Wrapper** — a single top-level key (e.g. `"deg_long"`) whose value is the
graph `{ "nodes": [...], "edges": [...] }`.

**Node**

| field             | notes                                                    |
| ----------------- | -------------------------------------------------------- |
| `id`              | unique, `"<kind>:<role>:<uuid>"`                          |
| `type`            | `"File"` \| `"AnalysisType"`                              |
| `name`            | display name                                             |
| `description`     |                                                          |
| `dcc_url`/`drc_url` | Data Coordinating / Resource Center URLs               |
| `c2m2_properties` | `_uuid, filename, local_id, md5, persistent_id, size_in_bytes, …` |
| `analysis`        | (analysis nodes) `command, environment, parameters, version, script_url` |

**Edge**

| field         | notes                                                |
| ------------- | ---------------------------------------------------- |
| `id`          |                                                      |
| `label`       | `"data input"` \| `"metadata input"` \| `"data output"` |
| `source`/`target` | node ids                                         |
| `description` |                                                      |

The normalizer in `js/schema.js` is also tolerant of the sibling `kind`-based
[`geneset_provenance.schema.json`](https://github.com/flannick/dig-gene-set-extractors/blob/main/src/geneset_extractors/schemas/geneset_provenance.schema.json)
format (node `kind`, edge `kind`), so either flavor renders.

## Files

```
dashboard/
├── index.html                     # entry point
├── css/style.css                  # styling
├── js/schema.js                   # schema inference + normalization
├── js/app.js                      # D3 force-graph + inspector
└── data/
    └── deg_long.provenance_graph.json   # sample (GTEx adipose / HZ1)
```
