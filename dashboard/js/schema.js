/**
 * schema.js — Provenance graph schema inference & normalization.
 *
 * The dashboard targets the C2M2 / DCC-DRC style provenance graph emitted by
 * dig-gene-set-extractors (e.g. deg_long.provenance_graph.json):
 *
 *   {
 *     "<graph_name>": {                  // single top-level key, e.g. "deg_long"
 *       "nodes": [ ... ],
 *       "edges": [ ... ]
 *     }
 *   }
 *
 * NODE schema (inferred from the sample + extractor conventions):
 *   id            string   unique, "<kind>:<role>:<uuid>" e.g. "file:expression_gct:<uuid>"
 *   type          string   "File" | "AnalysisType"
 *   name          string   display name
 *   description   string
 *   dcc_url       string   Data Coordinating Center URL (often s3:// or repo URL)
 *   drc_url       string   Data Resource Center URL
 *   c2m2_properties object {
 *       _uuid, id, name, filename, local_id, md5,
 *       persistent_id, size_in_bytes, description, synonyms
 *   }
 *   analysis      object   (AnalysisType nodes only) {
 *       command, observed_command, script_url, version,
 *       environment { mode, module, entrypoint, repo_url,
 *                     container_image, workspace_template_url },
 *       parameters { ...arbitrary key/value }
 *   }
 *
 * EDGE schema:
 *   id            string
 *   label         string   "data input" | "metadata input" | "data output" (extensible)
 *   source        string   node id
 *   target        string   node id
 *   description   string
 *
 * The normalizer is also tolerant of the sibling `kind`-based provenance schema
 * (geneset_provenance.schema.json: node.kind, edge.kind) so either format renders.
 */

const NODE_KINDS = {
  FILE: "file",
  ANALYSIS: "analysis",
  GENESET: "geneset",
  UNKNOWN: "unknown",
};

// Map raw type/kind strings onto a canonical node kind used for styling.
function canonicalNodeKind(node) {
  const t = (node.type || node.kind || "").toLowerCase();
  if (t.includes("analysis") || t === "operation") return NODE_KINDS.ANALYSIS;
  if (t.includes("geneset") || t.includes("gene_set")) return NODE_KINDS.GENESET;
  if (t.includes("file")) return NODE_KINDS.FILE;
  // Fall back to id prefix, e.g. "analysis:..." / "file:..."
  const prefix = (node.id || "").split(":")[0].toLowerCase();
  if (prefix === "analysis" || prefix === "operation") return NODE_KINDS.ANALYSIS;
  if (prefix === "file") return NODE_KINDS.FILE;
  if (prefix === "geneset") return NODE_KINDS.GENESET;
  return NODE_KINDS.UNKNOWN;
}

// Canonical edge category, used for color + direction semantics.
function canonicalEdgeKind(edge) {
  const l = (edge.label || edge.kind || "").toLowerCase();
  if (l.includes("output") || l.includes("generated") || l.includes("materialized"))
    return "output";
  if (l.includes("metadata")) return "metadata-input";
  if (l.includes("input") || l.includes("used")) return "input";
  return "other";
}

// Human-readable bytes.
function fmtBytes(n) {
  if (n == null || isNaN(n)) return null;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = Number(n);
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

/**
 * Find the graph object inside the top-level wrapper.
 * Returns { name, graph } where graph has {nodes, edges}.
 */
function extractGraph(raw) {
  if (raw && Array.isArray(raw.nodes)) {
    return { name: raw.name || raw.file_type || "graph", graph: raw };
  }
  // Wrapped: single (or first) key whose value has nodes/edges.
  for (const [k, v] of Object.entries(raw || {})) {
    if (v && (Array.isArray(v.nodes) || Array.isArray(v.edges))) {
      return { name: k, graph: v };
    }
  }
  throw new Error("No {nodes, edges} graph found in JSON.");
}

/**
 * Normalize into a render model:
 *   { name, nodes:[{id, kind, type, label, raw, ...}], links:[{source,target,kind,label,raw}] }
 */
function normalize(raw) {
  const { name, graph } = extractGraph(raw);
  const rawNodes = graph.nodes || [];
  const rawEdges = graph.edges || graph.links || [];

  const nodes = rawNodes.map((n) => {
    const kind = canonicalNodeKind(n);
    const c2m2 = n.c2m2_properties || {};
    const size = n.size_bytes ?? c2m2.size_in_bytes ?? null;
    return {
      id: n.id,
      kind,
      type: n.type || n.kind || "",
      label: n.name || n.label || c2m2.filename || n.id,
      description: n.description || c2m2.description || "",
      role: roleFromId(n.id),
      size_bytes: size,
      size_human: fmtBytes(size),
      md5: c2m2.md5 || (n.hashes && n.hashes.md5) || null,
      uuid: c2m2._uuid || c2m2.persistent_id || null,
      local_id: c2m2.local_id || null,
      dcc_url: n.dcc_url || null,
      drc_url: n.drc_url || null,
      analysis: n.analysis || null,
      raw: n,
    };
  });

  const nodeIds = new Set(nodes.map((n) => n.id));
  const links = rawEdges
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      kind: canonicalEdgeKind(e),
      label: e.label || e.kind || "",
      description: e.description || "",
      raw: e,
    }))
    // Drop dangling edges that reference missing nodes.
    .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

  return { name, nodes, links };
}

// Extract the "role" segment from "file:<role>:<uuid>" style ids.
function roleFromId(id) {
  if (!id) return "";
  const parts = id.split(":");
  return parts.length >= 3 ? parts[1] : "";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    normalize,
    extractGraph,
    canonicalNodeKind,
    canonicalEdgeKind,
    fmtBytes,
    NODE_KINDS,
  };
}
