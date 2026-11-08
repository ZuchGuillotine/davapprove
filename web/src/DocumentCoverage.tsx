import type { AiProcessing } from "./types";

const statusLabels: Record<string, string> = {
  running: "Analysis in progress",
  complete: "Analysis complete",
  partial: "Analysis incomplete",
  budget_paused: "Analysis paused · allowance reached",
  unavailable: "Analysis unavailable",
  failed: "Analysis failed",
};
const words = (value: string) => value.replaceAll("_", " ");
function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}
export default function DocumentCoverage({
  processing,
  onResume,
  resuming = false,
}: {
  processing?: AiProcessing | null;
  onResume?: () => void;
  resuming?: boolean;
}) {
  if (!processing) return null;
  const pages = count(processing.processed_pages);
  const totalPages = count(processing.total_pages);
  const chunks = count(processing.completed_chunks);
  const totalChunks = count(processing.total_chunks);
  const failures = count(processing.failed_chunks) ?? 0;
  const paused = count(processing.budget_paused_chunks) ?? 0;
  const partial = count(processing.partial_pages) ?? 0;
  const unreadable = count(processing.unreadable_pages) ?? 0;
  const pending = count(processing.pending_pages) ?? 0;
  const incomplete =
    failures > 0 ||
    paused > 0 ||
    partial > 0 ||
    unreadable > 0 ||
    pending > 0 ||
    (pages !== undefined && totalPages !== undefined && pages < totalPages) ||
    (chunks !== undefined && totalChunks !== undefined && chunks < totalChunks);
  const status =
    processing.status === "complete" && incomplete
      ? "partial"
      : processing.status;
  return (
    <div className="document-coverage" aria-label="Document analysis coverage">
      <div className="analysis-status">
        <span className={`badge ${status === "complete" ? "green" : "amber"}`}>
          {statusLabels[status] ||
            `Analysis status: ${words(status || "unknown")}`}
        </span>
      </div>
      <div className="analysis-counts">
        <span>
          <strong>
            {pages ?? "—"} / {totalPages ?? "—"}
          </strong>{" "}
          pages fully analyzed
        </span>
        <span>
          <strong>
            {chunks ?? "—"} / {totalChunks ?? "—"}
          </strong>{" "}
          chunks completed
        </span>
      </div>
      {!!totalChunks && chunks !== undefined && (
        <progress
          aria-label="Completed analysis chunks"
          max={totalChunks}
          value={Math.min(chunks, totalChunks)}
        />
      )}
      <div className="analysis-exceptions">
        {partial > 0 && (
          <span>
            {partial} partially analyzed {partial === 1 ? "page" : "pages"}
          </span>
        )}
        {pending > 0 && (
          <span>
            {pending} pending {pending === 1 ? "page" : "pages"}
          </span>
        )}
        {unreadable > 0 && (
          <span>
            {unreadable} unreadable {unreadable === 1 ? "page" : "pages"}
          </span>
        )}
        {failures > 0 && (
          <span>
            {failures} failed {failures === 1 ? "chunk" : "chunks"}
          </span>
        )}
        {paused > 0 && (
          <span>
            {paused} {paused === 1 ? "chunk" : "chunks"} paused at allowance
          </span>
        )}
      </div>
      {processing.warning && (
        <p className="analysis-warning">{processing.warning}</p>
      )}
      {status !== "complete" && (
        <p>
          Available facts cover only the processed portions. Missing analysis
          does not mean no constraints.
        </p>
      )}
      {status === "complete" && (
        <p>
          Processing is complete; extracted facts still need evidence review.
        </p>
      )}
      {onResume &&
        ["partial", "budget_paused", "unavailable", "failed"].includes(
          status,
        ) && (
          <div className="analysis-resume">
            <button
              className="secondary"
              disabled={resuming}
              onClick={onResume}
            >
              Resume processing
            </button>
            <small>
              Retries unfinished work within the available allowance.
            </small>
          </div>
        )}
      {!!processing.page_manifest?.length && (
        <details className="page-coverage">
          <summary>View page coverage</summary>
          <ul>
            {processing.page_manifest.map((page) => (
              <li key={page.page}>
                <div>
                  <strong>Page {page.page}</strong>
                  <span>{words(page.status || "unknown")}</span>
                </div>
                <small>
                  {page.completed_text_chunks ?? "—"} /{" "}
                  {page.text_chunks ?? "—"} text chunks · visual review:{" "}
                  {words(
                    page.vision_status ||
                      (page.vision_required ? "pending" : "not required"),
                  )}
                </small>
                {page.issues?.map((issue, i) => (
                  <p key={i}>{issue}</p>
                ))}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
