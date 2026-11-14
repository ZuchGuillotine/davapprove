import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DocumentCoverage from "./DocumentCoverage";
import FactEvidence from "./FactEvidence";
afterEach(cleanup);
describe("document processing coverage", () => {
  it("shows partial counts and page-level gaps without implying completeness", async () => {
    render(
      <DocumentCoverage
        processing={{
          status: "partial",
          total_pages: 10,
          processed_pages: 6,
          partial_pages: 1,
          pending_pages: 2,
          unreadable_pages: 1,
          total_chunks: 15,
          completed_chunks: 9,
          failed_chunks: 1,
          page_manifest: [
            {
              page: 7,
              status: "partial",
              text_chunks: 2,
              completed_text_chunks: 1,
              vision_required: true,
              vision_status: "failed",
              issues: ["Page image analysis failed."],
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Analysis incomplete")).toBeInTheDocument();
    expect(screen.getByText("6 / 10")).toBeInTheDocument();
    expect(screen.getByText("9 / 15")).toBeInTheDocument();
    expect(screen.getByText("1 unreadable page")).toBeInTheDocument();
    expect(screen.getByText("1 failed chunk")).toBeInTheDocument();
    expect(
      screen.getByText(/Missing analysis does not mean no constraints/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByText("View page coverage"));
    expect(screen.getByText("Page image analysis failed.")).toBeVisible();
  });
  it("labels budget-paused work and lets users retry the unfinished portion", async () => {
    const resume = vi.fn();
    render(
      <DocumentCoverage
        processing={{
          status: "budget_paused",
          total_pages: 4,
          processed_pages: 1,
          total_chunks: 4,
          completed_chunks: 1,
          budget_paused_chunks: 3,
          warning: "Monthly allowance reached.",
        }}
        onResume={resume}
      />,
    );
    expect(
      screen.getByText("Analysis paused · allowance reached"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("3 chunks paused at allowance"),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Resume processing" }),
    );
    expect(resume).toHaveBeenCalledOnce();
  });
  it("does not call contradictory complete coverage finished", () => {
    render(
      <DocumentCoverage
        processing={{
          status: "complete",
          total_pages: 3,
          processed_pages: 2,
          total_chunks: 3,
          completed_chunks: 2,
          failed_chunks: 1,
        }}
      />,
    );
    expect(screen.queryByText("Analysis complete")).not.toBeInTheDocument();
    expect(screen.getByText("Analysis incomplete")).toBeInTheDocument();
  });
  it("leaves documents without processing metadata unchanged", () => {
    const { container } = render(<DocumentCoverage />);
    expect(container).toBeEmptyDOMElement();
  });
});
describe("visual and textual evidence", () => {
  it("identifies proposed visual observations without fabricating an exact quote", () => {
    render(
      <FactEvidence
        fact={{
          id: "visual",
          value: "Possible easement corridor",
          evidence_type: "visual_observation",
          quote: "",
          page: 3,
          review_status: "proposed",
          source_region: {
            page: 3,
            image_sha256: "hash",
            region: "lower right",
          },
        }}
        document={{ id: "survey", title: "Recorded survey.pdf" }}
      />,
    );
    expect(
      screen.getByText("Proposed visual interpretation"),
    ).toBeInTheDocument();
    expect(screen.getByText(/not verified geometry/)).toBeInTheDocument();
    expect(screen.getByText("Source: Recorded survey.pdf")).toBeInTheDocument();
    expect(screen.getByText("Page 3 · proposed")).toBeInTheDocument();
    expect(screen.queryByText(/Source note:/)).not.toBeInTheDocument();
  });
  it("preserves an existing fact quote and review state", () => {
    render(
      <FactEvidence
        fact={{
          id: "legacy",
          value: "2020",
          source_quote: "Approved on 12 May 2020",
          page: 1,
          review_status: "accepted",
        }}
      />,
    );
    expect(screen.getByText("Approved on 12 May 2020")).toBeInTheDocument();
    expect(screen.getByText("Page 1 · accepted")).toBeInTheDocument();
    expect(screen.queryByText(/visual interpretation/)).not.toBeInTheDocument();
  });
});
