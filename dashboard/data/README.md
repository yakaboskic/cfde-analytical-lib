# `data/` — raw provenance graph files

Put your raw provenance graph JSON files **in this directory**, then register
them in [`manifest.json`](manifest.json) so they appear in the dashboard's
sample dropdown.

## How to add a graph

1. **Drop the file here**, e.g.:

   ```
   dashboard/data/my_graph.provenance_graph.json
   ```

2. **Add an entry to `manifest.json`** (an array of `{ file, label }`):

   ```json
   [
     {
       "file": "data/deg_long.provenance_graph.json",
       "label": "sample: deg_long (GTEx adipose / HZ1)"
     },
     {
       "file": "data/my_graph.provenance_graph.json",
       "label": "my graph"
     }
   ]
   ```

   - `file` is the path **relative to `dashboard/`** (always starts with `data/`).
   - `label` is what shows in the dropdown.

3. **Reload** the dashboard — your graph is now in the dropdown.

> No code changes needed. If you just want a one-off view without editing the
> manifest, use the **Load JSON** button in the top bar instead.

## Expected JSON shape

A single top-level key wrapping `nodes` + `edges` (C2M2 / DCC-DRC style):

```json
{
  "deg_long": {
    "nodes": [
      {
        "id": "file:expression_gct:<uuid>",
        "type": "File",
        "name": "…",
        "c2m2_properties": { "md5": "…", "size_in_bytes": 123, "local_id": "s3://…" }
      },
      {
        "id": "analysis:…:<uuid>",
        "type": "AnalysisType",
        "analysis": { "command": "…", "parameters": { }, "version": "…" }
      }
    ],
    "edges": [
      { "source": "file:expression_gct:<uuid>", "target": "analysis:…:<uuid>", "label": "data input" }
    ]
  }
}
```

The full inferred schema (and the alternate `kind`-based format that's also
supported) is documented at the top of [`../js/schema.js`](../js/schema.js) and
in the [dashboard README](../README.md#schema).
