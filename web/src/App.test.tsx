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
        screen.getAllByRole("button", { name: "Find records" })[0],
      ).toBeEnabled(),
    { timeout: 4000 },
  );
  return user;
}
describe("project workspace", () => {
  it("opens the separate bid workspace and preserves the selected project", async () => {
    const user = await openSample();
    await user.click(screen.getByRole("button", { name: "Bids & assessments" }));
    expect(screen.getByTitle("Early bid assessment workspace")).toHaveAttribute("src", "/bid-assistant/index.html");
    expect(screen.getByText("EARLY BID · PUBLIC MAPS")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import selected" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Projects/ }));
    expect(screen.getByRole("heading", { name: "Cedar House · Concept study" })).toBeInTheDocument();
    expect(screen.getByText("Revision 1")).toBeInTheDocument();
  });

  it("renames the project without changing its design revision", async () => {
    const user = await openSample();
    await user.click(screen.getByRole("button", { name: "Edit project name" }));
    const input = screen.getByRole("textbox", { name: "Project name" });
    await user.clear(input);
    expect(screen.getByRole("button", { name: "Save name" })).toBeDisabled();
    await user.type(input, "Smith residence");
    await user.click(screen.getByRole("button", { name: "Save name" }));
    await screen.findByRole("heading", { name: "Smith residence" });
    expect(screen.getByText("Revision 1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Refresh project" }));
    await screen.findByRole("heading", { name: "Smith residence" });
  });
  it("keeps discovery separate from import and imports only explicitly selected records", async () => {
    const user = await openSample();
    await user.click(screen.getAllByRole("button", { name: "Find records" })[0]);
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
    const reviewFocus = screen.getByRole("combobox", { name: "Review focus" });
    await user.selectOptions(reviewFocus, "all");
    const accept = await screen.findAllByRole("button", { name: "Accept" });
    await user.click(accept[0]);
    await screen.findByText("Revision 2");
    expect(screen.getByRole("combobox", { name: "Review focus" })).toBe(reviewFocus);
    expect(screen.queryByText("OPENING PROJECT WORKSPACE")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh project" })).toBeEnabled());
    expect(screen.getByRole("combobox", { name: "Review focus" })).toHaveValue("all");
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
      screen.getByRole("button", { name: "Sign in to workspace" }),
    ).toBeDisabled();
    expect(screen.queryByText("PRIVATE BETA")).not.toBeInTheDocument();
  });
  it("allows password sign-in without email delivery and reflects the server upload limit", async () => {
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
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign in to workspace" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByRole("button", { name: "Create beta account" })).toBeDisabled();
    expect(screen.getByText(/Email confirmation and recovery are being set up/)).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /Explore the sample project/ }),
    );
    await screen.findByRole("heading", { name: "Cedar House · Concept study" });
    await user.click(screen.getByRole("tab", { name: /^Records/ }));
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
  it("refreshes document coverage while a job runs without resetting the project view", async () => {
    const project = {
      id: "progress-project",
      name: "Processing project",
      parcel_number: "123",
      parcel: {},
      jurisdiction: "kitsap_county",
      intent: {},
      current_revision: 1,
    };
    let polls = 0;
    const fetcher = vi.fn(async (url: string) => {
      let result: any = {};
      if (url.endsWith("/config")) result = { mode: "demo" };
      else if (url.endsWith("/projects")) result = { projects: [project] };
      else if (url.endsWith("/projects/progress-project")) result = project;
      else if (url.endsWith("/process"))
        result = { id: "running-job", status: "queued" };
      else if (url.endsWith("/jobs/running-job"))
        result = {
          id: "running-job",
          status: ++polls > 1 ? "completed" : "running",
        };
      else if (url.endsWith("/documents"))
        result = {
          documents: [
            {
              id: "doc-1",
              title: "Survey.pdf",
              page_count: 4,
              ai_processing: {
                status: polls ? "running" : "partial",
                total_pages: 4,
                processed_pages: polls ? 1 : 0,
                total_chunks: 4,
                completed_chunks: polls ? 1 : 0,
              },
            },
          ],
        };
      else if (url.endsWith("/assessment"))
        result = {
          nodes: [],
          edges: [],
          actions: [],
          envelope: { status: "cannot_determine" },
          coverage_gaps: [],
        };
      return { ok: true, json: async () => result };
    });
    vi.stubGlobal("fetch", fetcher);
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole("button", {
        name: /Open local development workspace/,
      }),
    );
    await screen.findByRole("heading", { name: "Processing project" });
    await user.click(screen.getByRole("tab", { name: /^Records/ }));
    await user.click(screen.getByRole("button", { name: "Resume processing" }));
    expect(await screen.findByText("Analysis in progress")).toBeInTheDocument();
    expect(screen.getAllByText("1 / 4")).toHaveLength(2);
    expect(
      screen.queryByText("Loading Processing project."),
    ).not.toBeInTheDocument();
    expect(
      fetcher.mock.calls.some(([url]) =>
        url.endsWith("/projects/progress-project"),
      ),
    ).toBe(false);
    await waitFor(
      () =>
        expect(
          fetcher.mock.calls.some(([url]) =>
            url.endsWith("/projects/progress-project"),
          ),
        ).toBe(true),
      { timeout: 4000 },
    );
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "Find records" })[0],
      ).toBeEnabled(),
    );
  });
});

it("lets users inspect a workflow item below the graph", async () => {
  const user = await openSample();
  await user.click(screen.getByRole("tab", {name:"Workflow"}));
  await user.click(screen.getByRole("button", {name:"Electrical service & trade permits"}));
  expect(screen.getByRole("heading", {name:"X0 · Electrical service & trade permits"})).toBeInTheDocument();
  expect(screen.getByText(/No supporting documents or excerpts/)).toBeInTheDocument();
});
