import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  render,
  screen,
  waitFor,
  within,
  cleanup,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { resetDemo } from "./demo";
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe() {} } },
      }),
    },
  }),
}));
vi.mock("./ParcelMap", () => ({ default: () => <div>Parcel map</div> }));
vi.mock("./WorkflowGraph", () => ({
  default: () => <div>Workflow graph</div>,
}));
beforeEach(() => {
  cleanup();
  localStorage.clear();
  resetDemo();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
});
async function openSample() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(
    screen.getByRole("button", { name: /Explore the sample project/ }),
  );
  await screen.findByRole("heading", { name: "Cedar House · Concept study" });
  await waitFor(
    () =>
      expect(
        screen.getByRole("button", { name: "Find records" }),
      ).toBeEnabled(),
    { timeout: 4000 },
  );
  return user;
}
describe("project workspace", () => {
  it("keeps discovery separate from import and imports only explicitly selected records", async () => {
    const user = await openSample();
    await user.click(screen.getByRole("button", { name: "Find records" }));
    await screen.findByText(
      "Boundary & topographic survey",
      {},
      { timeout: 4000 },
    );
    const checks = screen.getAllByRole("checkbox");
    expect(checks.every((c) => !(c as HTMLInputElement).checked)).toBe(true);
    expect(
      screen.getByRole("button", { name: "Import selected" }),
    ).toBeDisabled();
    await user.click(
      screen.getByRole("checkbox", {
        name: "Select Boundary & topographic survey",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Import selected" }));
    await screen.findByRole(
      "button",
      { name: /Boundary & topographic survey.*needs review/ },
      { timeout: 4000 },
    );
    expect(
      screen.queryByRole("button", {
        name: /Wetland delineation report.*needs review/,
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("1 imported")).toBeInTheDocument();
  }, 15000);
  it("creates a design revision and attaches feedback to that revision", async () => {
    const user = await openSample();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog");
    const bedrooms = within(dialog).getByRole("spinbutton");
    await user.clear(bedrooms);
    await user.type(bedrooms, "4");
    await user.click(
      within(dialog).getByRole("button", { name: "Save new revision" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Revision 2")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Activity" }));
    await user.type(
      screen.getByLabelText("Add context for your team"),
      "Confirm septic capacity for four bedrooms.",
    );
    await user.click(screen.getByRole("button", { name: "Post comment" }));
    expect(
      await screen.findByText("Confirm septic capacity for four bedrooms."),
    ).toBeInTheDocument();
    expect(await screen.findByText(/· Revision 2/)).toBeInTheDocument();
  }, 15000);
  it("does not silently present a disconnected backend as a live workspace", async () => {
    render(<App />);
    await screen.findByText(
      "Live sign-in is awaiting the connected deployment.",
    );
    expect(
      screen.getByRole("button", { name: "Send sign-in link" }),
    ).toBeDisabled();
    expect(screen.queryByText("PRIVATE BETA")).not.toBeInTheDocument();
  });
  it("keeps email requests disabled until delivery is configured and reflects the server upload limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          mode: "supabase",
          supabase_url: "https://example.supabase.co",
          publishable_key: "test",
          email_delivery_enabled: false,
          max_pdf_bytes: 50 * 1024 * 1024,
        }),
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    expect(
      await screen.findByText(/Email delivery is not enabled yet/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send sign-in link" }),
    ).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: /Explore the sample project/ }),
    );
    await screen.findByRole("heading", { name: "Cedar House · Concept study" });
    await user.click(screen.getByRole("tab", { name: "Records" }));
    expect(screen.getByText("Upload PDF · 50 MiB max")).toBeInTheDocument();
  });
  it("shows a loading state rather than zero evidence while project details are pending", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const project = {
      id: "slow-project",
      name: "Delayed project",
      parcel_number: "123",
      parcel: {},
      jurisdiction: "kitsap_county",
      intent: {},
      current_revision: 1,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/config"))
          return { ok: true, json: async () => ({ mode: "demo" }) };
        if (url.endsWith("/projects"))
          return { ok: true, json: async () => ({ projects: [project] }) };
        await pending;
        return {
          ok: true,
          json: async () => ({
            candidates: [],
            coverage: [],
            documents: [],
            facts: [],
            comments: [],
            nodes: [],
            edges: [],
            actions: [],
            envelope: { status: "cannot_determine" },
            coverage_gaps: [],
          }),
        };
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole("button", {
        name: /Open local development workspace/,
      }),
    );
    expect(
      await screen.findByText("Loading Delayed project."),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("Project evidence")).not.toBeInTheDocument();
    release();
    expect(
      await screen.findByRole("heading", { name: "Delayed project" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Project evidence")).toBeInTheDocument();
  });
});
