import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import WorkflowEvidence, { nodeEvidence, statusTone } from "./WorkflowEvidence";
afterEach(cleanup);
it("keeps unknown and available evidence yellow, with explicit red and green states", () => {
  expect(statusTone("unknown")).toBe("yellow");
  expect(statusTone("evidence_available")).toBe("yellow");
  expect(statusTone("pending_submission")).toBe("yellow");
  expect(statusTone("blocked")).toBe("red");
  expect(statusTone("identified")).toBe("green");
});
it("opens the source page and exposes review status and original URL", async () => {
  const open = vi.fn();
  const document = {id:"d", title:"Application package", source_url:"https://example.com/original"};
  render(<WorkflowEvidence node={{id:"B1", title:"Building intake", status:"pending_submission"}} facts={[{id:"f", node_id:"B1", document_id:"d", page:4, value:"Application", source_quote:"Submitted package", review_status:"proposed"}]} documents={[document]} candidates={[]} revision={3} onOpen={open} onRecords={vi.fn()} />);
  expect(screen.getByText("Submitted package")).toBeInTheDocument();
  expect(screen.getByText(/Pending submission does not establish/)).toBeInTheDocument();
  expect(screen.getByRole("link", {name:/Original source/})).toHaveAttribute("href", "https://example.com/original");
  await userEvent.click(screen.getByRole("button", {name:/View source/}));
  expect(open).toHaveBeenCalledWith(document,4);
});
it("surfaces old PSE excerpts and unimported records without treating them as approvals", () => {
  const result = nodeEvidence({id:"X0"},[{id:"f",node_id:"C0",value:"PSE installed electrical lines",document_id:"d"}],[{id:"d",candidate_id:"imported"}],[{id:"missing",title:"PSE service plan",source:"Utility"},{id:"imported",title:"PSE old plan",source:"Utility"}]);
  expect(result.linkedFacts.map(f=>f.id)).toEqual(["f"]);
  expect(result.linkedDocuments.map(d=>d.id)).toEqual(["d"]);
  expect(result.linkedCandidates.map(c=>c.id)).toEqual(["missing"]);
});
it("shows a missing-evidence explanation for every node without supporting records", () => {
  render(<WorkflowEvidence node={{id:"L0", title:"Legal lot"}} facts={[]} documents={[]} candidates={[]} revision={1} onOpen={vi.fn()} onRecords={vi.fn()} />);
  expect(screen.getByText(/No supporting documents or excerpts/)).toBeInTheDocument();
});

it("recovers utility excerpts from retained pages when extraction missed them", () => {
  const result = nodeEvidence({id:"X0"}, [], [{id:"d", pages:[{page:17,text:"Electrical sign off (certification set up). Fees may apply."}]}], []);
  expect(result.linkedDocuments.map(d=>d.id)).toEqual(["d"]);
  expect(result.linkedFacts[0]).toMatchObject({page:17,review_status:"unreviewed_text_match", document_id:"d"});
  expect(result.linkedFacts[0].source_quote).toContain("Electrical sign off");
});
