import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import BidWorkspace from "./BidWorkspace";

afterEach(cleanup);
const draft = "f50376d2-420f-4df0-a425-e38fe1eac459";
function setup(hash: string) {
  render(<BidWorkspace agencyName="Account studio" />);
  const frame = screen.getByTitle("Early bid assessment workspace");
  Object.defineProperty(frame, "contentWindow", { configurable: true, value: { location: { hash } } });
  const link = screen.getByRole("link", { name: /Open full workspace/ });
  return { frame, link };
}
function destination(link: HTMLElement) {
  return new URL(link.getAttribute("href")!, window.location.origin);
}
describe("opening the full bid workspace", () => {
  it("reopens the selected saved draft without forwarding unrelated fragment data", () => {
    const { frame, link } = setup(`#draft=${draft}&access_token=do-not-copy&agency=Account`);
    fireEvent.click(link);
    const url = destination(link);
    expect(url.pathname).toBe("/");
    expect(url.search).toBe("?workspace=bids");
    expect(url.hash).toBe(`#draft=${draft}`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener");
    expect(screen.getByTitle("Early bid assessment workspace")).toBe(frame);
  });
  it("keeps a fresh assessment's current company default", () => {
    const { link } = setup("#agency=Coates%20Design&access_token=do-not-copy");
    fireEvent.click(link);
    expect(destination(link).hash).toBe("#agency=Coates%20Design");
    expect(destination(link).hash).not.toContain("access_token");
  });
  it("rejects non-draft fragment values and uses the account company", () => {
    const { link } = setup("#draft=https%3A%2F%2Fother.test%2F&access_token=do-not-copy");
    fireEvent.click(link);
    const params = new URLSearchParams(destination(link).hash.slice(1));
    expect(params.get("draft")).toBeNull();
    expect(params.get("agency")).toBe("Account studio");
  });
  it("preserves an explicitly blank company for a fresh assessment", () => {
    const { link } = setup("#agency=");
    fireEvent.click(link);
    expect(destination(link).hash).toBe("");
  });
  it("prepares the selected draft for the browser's context-menu open action", () => {
    const { link } = setup(`#draft=${draft}`);
    fireEvent.contextMenu(link);
    expect(destination(link).hash).toBe(`#draft=${draft}`);
  });
  it("keeps the full-workspace link usable when the frame cannot be read", () => {
    const { frame, link } = setup("");
    Object.defineProperty(frame, "contentWindow", { get() { throw new DOMException("Blocked", "SecurityError"); } });
    fireEvent.click(link);
    expect(new URLSearchParams(destination(link).hash.slice(1)).get("agency")).toBe("Account studio");
  });
});
