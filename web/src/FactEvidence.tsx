import type { DocumentRecord, Fact } from "./types";
export function isVisualEvidence(fact: Fact) {
  return (
    fact.evidence_type === "visual" ||
    fact.evidence_type === "visual_observation"
  );
}
export default function FactEvidence({
  fact,
  document,
  onOpen,
}: {
  fact: Fact;
  document?: DocumentRecord;
  onOpen?: () => void;
}) {
  const visual = isVisualEvidence(fact);
  const page = fact.page ?? fact.page_number ?? fact.source_region?.page;
  const quote = (fact.source_quote || fact.quote || "").trim();
  const review = fact.review_status || "proposed";
  const title = document?.title || document?.filename || fact.source_title;
  const region =
    typeof fact.source_region?.region === "string"
      ? fact.source_region.region
      : null;
  return (
    <div className="fact-evidence">
      {visual && (
        <span
          className={`badge ${review === "proposed" ? "amber" : "neutral"}`}
        >
          {review === "accepted"
            ? "Reviewed"
            : review === "rejected"
              ? "Rejected"
              : "Proposed"}{" "}
          visual interpretation
        </span>
      )}
      {visual ? (
        <p className="visual-evidence-note">
          Interpretation of the page image, not verified geometry. Check the
          original source before relying on it.
        </p>
      ) : (
        <p>{quote || "Verify against the original document."}</p>
      )}
      {visual && quote && (
        <p className="visual-source-note">Source note: {quote}</p>
      )}
      {title && <small className="fact-source-title">Source: {title}</small>}
      <small>
        Page {page ?? "?"} · {review.replaceAll("_", " ")}
      </small>
      {visual && region && <small>Page region: {region}</small>}
      {visual && fact.source_region?.image_sha256 && (
        <small>Linked to the analyzed page image</small>
      )}
      {onOpen && (
        <button className="text-button" onClick={onOpen}>
          View source{page ? ` · page ${page}` : ""} ↗
        </button>
      )}
    </div>
  );
}
