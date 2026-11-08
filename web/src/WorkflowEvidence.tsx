import type { Candidate, DocumentRecord, Fact, Json } from "./types";
import FactEvidence from "./FactEvidence";
import { safeUrl } from "./api";

export function statusTone(status: string) {
  if (/blocked|rejected|expired|conflict|failed/.test(status)) return "red";
  if (["identified", "approved", "complete", "completed", "not_applicable"].includes(status)) return "green";
  return "yellow";
}
const utility = /\b(pse|puget sound energy|electrical|electric service|power lines?|energization)\b/i;
export function nodeEvidence(node: Json, facts: Fact[], documents: DocumentRecord[], candidates: Candidate[]) {
  const ids = new Set([...(node.evidence_ids || []), ...(node.related_evidence_ids || [])]);
  const linkedFacts = facts.filter(f => f.node_id === node.id || ids.has(f.id) ||
    (node.id === "X0" && utility.test(JSON.stringify([f.value, f.quote, f.source_quote]))));
  // Search retained text as a fallback; these excerpts are not accepted facts.
  if (node.id === "X0") {
    for (const document of documents) {
      for (const page of (Array.isArray(document.pages) ? document.pages : [])) {
        if (typeof page.text !== "string") continue;
        const match = utility.exec(page.text);
        if (!match || linkedFacts.some(f => f.document_id === document.id && f.page === page.page)) continue;
        const quote = page.text.slice(Math.max(0, match.index - 160), match.index + match[0].length + 300);
        linkedFacts.push({ id: `text-match-${document.id}-${page.page}`, node_id: "X0",
          document_id: document.id, page: page.page, source_quote: quote,
          value: "Potential utility reference found in retained document text; verify context.",
          review_status: "unreviewed_text_match" });
      }
    }
  }
  const documentIds = new Set([...(node.document_ids || []), ...linkedFacts.map(f => f.document_id)]);
  const linkedDocuments = documents.filter(d => documentIds.has(d.id) || d.node_id === node.id ||
    (node.id === "X0" && utility.test([d.title, d.filename, d.source].join(" "))));
  const imported = new Set(documents.map(d => d.candidate_id));
  const linkedCandidates = candidates.filter(c => !imported.has(c.id) &&
    (node.id === "X0" && utility.test([c.title, c.category, c.source].join(" "))));
  return { linkedFacts, linkedDocuments, linkedCandidates };
}
export default function WorkflowEvidence({ node, facts, documents, candidates, revision, onOpen, onRecords }:
  { node?: Json; facts: Fact[]; documents: DocumentRecord[]; candidates: Candidate[]; revision: number;
    onOpen: (d: DocumentRecord, page?: number) => void; onRecords: () => void }) {
  if (!node) return <section className="panel workflow-evidence"><h2>Inspect workflow evidence</h2><p>Select any graph node or work item to see its documents, excerpts and original sources.</p></section>;
  const { linkedFacts, linkedDocuments, linkedCandidates } = nodeEvidence(node, facts, documents, candidates);
  const status = String(node.state || node.status || "unknown");
  return <section className="panel workflow-evidence" aria-label="Selected workflow evidence" aria-live="polite">
    <h2>{node.id} · {node.title || node.label}</h2>
    <span className={`workflow-status status-${statusTone(status)}`}>{status.replaceAll("_", " ")}</span>
    <p>{node.reason || node.description}</p>
    <p>Revision {revision} · Stage: {node.stage || "feasibility"} · Applicability: {node.applicability || "unknown"} · Agency decision: {node.decision || "unknown"}</p>
    {status === "pending_submission" && <p>Pending submission does not establish that a package was submitted. Inspect the application package and submission receipt; imported files alone are not proof of submission.</p>}
    {node.id === "X0" && <p>Review PSE correspondence, service plans, installation records, permits and inspections separately. Installed lines do not establish approval or capacity for the current design. Utility records may require a direct upload; automatic PSE record discovery is not available.</p>}
    <h3>Associated documents and excerpts</h3>
    {!linkedDocuments.length && !linkedFacts.length && <p>No supporting documents or excerpts are linked to this item. Its status is not evidence of submission or approval.</p>}
    {linkedDocuments.map(d => {
      const excerpts = linkedFacts.filter(f => f.document_id === d.id);
      const source = safeUrl(d.source_url || d.url);
      return <article className="workflow-document" key={d.id}>
        <h4>{d.title || d.filename || "Document"}</h4>
        <p>{d.source || "Project upload"} · {d.record_date || "Document date unknown"} · Processing: {d.status || "unknown"}</p>
        <button className="text-button" onClick={() => onOpen(d)}>Open imported document ↗</button>
        {source && <a href={source} target="_blank" rel="noreferrer">Original source ↗</a>}
        {!source && <p>No original source URL recorded; inspect the retained upload.</p>}
        {!excerpts.length && <p>Potentially related by document metadata; no linked excerpts. Inspect the original and review its relevance.</p>}
        {excerpts.map(f => <div key={f.id}><p>{typeof f.value === "string" ? f.value : JSON.stringify(f.value)}</p><FactEvidence fact={f} document={d} onOpen={() => onOpen(d, f.page ?? f.page_number ?? f.source_region?.page)} /></div>)}
      </article>;
    })}
    {linkedFacts.filter(f => !linkedDocuments.some(d => d.id === f.document_id)).map(f => <article className="workflow-document" key={f.id}><FactEvidence fact={f} /><p>The associated original is unavailable in the loaded project records.</p></article>)}
    {linkedCandidates.map(c => <article className="workflow-document" key={c.id}><h4>{c.title}</h4><p>Discovered record — not imported or reviewed. Source-reported status: {c.status || "unknown"}.</p>{safeUrl(c.url || c.document_url) && <a href={safeUrl(c.url || c.document_url)!} target="_blank" rel="noreferrer">Original record ↗</a>}</article>)}
    <button className="text-button" onClick={onRecords}>Review or import project records →</button>
    {safeUrl(node.source_url) && <p><a href={safeUrl(node.source_url)!} target="_blank" rel="noreferrer">Workflow reference ↗</a> · General guidance, not proof of a parcel decision.</p>}
  </section>;
}
