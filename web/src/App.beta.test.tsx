import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fakeEstimator } from "./estimate/test-fixtures";

/* Beta build: project management hidden, the estimate is the product. */
const mocks = vi.hoisted(() => ({
  onChange: null as null | ((event: string, session: any) => void),
  getSession: vi.fn(),
  signOut: vi.fn(),
  updateUser: vi.fn(),
  signInWithOtp: vi.fn(),
  request: vi.fn(),
  ownedCount: 0,
  estimator: null as any,
}));
vi.mock("./api", () => ({
  configure: async () => ({ mode: "supabase", authAvailable: true, email_delivery_enabled: true }),
  getAuth: () => ({
    auth: {
      getSession: mocks.getSession,
      signOut: mocks.signOut,
      updateUser: mocks.updateUser,
      signInWithOtp: mocks.signInWithOtp,
      onAuthStateChange: (cb: typeof mocks.onChange) => {
        mocks.onChange = cb;
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
    from: () => ({ select: () => ({ eq: async () => ({ count: mocks.ownedCount, error: null }) }) }),
  }),
  request: mocks.request,
  setSampleMode: vi.fn(),
  invalidateRequests: vi.fn(),
  safeUrl: (value: string) => value,
  documentUrl: vi.fn(),
}));
vi.mock("./bidEngine", async original => ({ ...(await original<typeof import("./bidEngine")>()), loadEstimator: async () => mocks.estimator }));

const user1 = { id: "beta-user", email: "beta@example.com", user_metadata: { business_name: "Synthetic Builders" } };
const pending = { county: "wa-kitsap", parcel: "123", label: "1 SYNTHETIC RD", audience: "pro", project: { type: "adu", new_sqft: 800, scope_items: ["solar"] }, at: Date.now() };

beforeEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.stubEnv("VITE_FEATURE_PROJECTS", "false");
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  mocks.onChange = null;
  mocks.ownedCount = 0;
  mocks.estimator = fakeEstimator();
  mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
  mocks.signInWithOtp.mockResolvedValue({ error: null });
  mocks.updateUser.mockResolvedValue({ error: null });
  mocks.request.mockResolvedValue({ projects: [] });
});
afterEach(() => vi.unstubAllEnvs());

async function renderApp() {
  const { default: App } = await import("./App");
  render(<App />);
}
async function signIn(session: any = { user: user1 }) {
  await waitFor(() => expect(mocks.onChange).toBeTypeOf("function"));
  mocks.getSession.mockResolvedValue({ data: { session }, error: null });
  await act(async () => { mocks.onChange!("SIGNED_IN", session); });
}
async function estimate(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByRole("combobox"), "1 synth");
  await user.click(await screen.findByRole("option", { name: /1 SYNTHETIC RD/ }));
  await user.click(screen.getByRole("button", { name: /Get estimate/ }));
  await screen.findByText("$12,345 – $23,457");
}

it("opens on the address box, with no project workspace or sample project", async () => {
  await renderApp();
  expect(await screen.findByRole("heading", { name: "Know the permits before you price the job." })).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Property address or parcel number" })).toBeInTheDocument();
  expect(screen.queryByText(/Explore the sample project/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Start a bid assessment/)).not.toBeInTheDocument();
  expect(mocks.request).not.toHaveBeenCalled();
});

it("captures an email for the full report and remembers which report to open", async () => {
  const user = userEvent.setup();
  await renderApp();
  await estimate(user);
  await user.click(screen.getByRole("button", { name: /Open the full report/ }));
  const dialog = screen.getByRole("dialog", { name: "Get the full report" });
  await user.type(within(dialog).getByLabelText("Email"), "pro@example.com");
  await user.type(within(dialog).getByLabelText(/Business name/), "Synthetic Builders");
  await user.click(within(dialog).getByLabelText(/founding pro directory/));
  await user.click(within(dialog).getByRole("button", { name: /Email me the link/ }));
  expect(await screen.findByRole("dialog", { name: "Check your email" })).toBeInTheDocument();
  expect(mocks.signInWithOtp).toHaveBeenCalledWith({
    email: "pro@example.com",
    options: { shouldCreateUser: true, emailRedirectTo: window.location.origin + "/?report=pending", data: { signup_source: "estimate", audience: "pro", business_name: "Synthetic Builders", founding_listing_interest: true } },
  });
  const saved = JSON.parse(window.localStorage.getItem("davapprove.pending-report")!);
  expect(saved).toMatchObject({ county: "wa-kitsap", parcel: "123", project: { type: "new_sfr" }, audience: "pro" });
});

it("opens the pending report after the email link, in a workspace without projects", async () => {
  window.localStorage.setItem("davapprove.pending-report", JSON.stringify(pending));
  window.history.replaceState(null, "", "/?report=pending");
  await renderApp();
  await signIn();
  const frame = await screen.findByTitle("Early bid assessment workspace");
  const src = decodeURIComponent(frame.getAttribute("src")!);
  expect(src).toContain("#county=wa-kitsap&parcel=123&type=adu&project=");
  expect(src).toContain('"scope_items":["solar"]');
  expect(src).toContain("agency=Synthetic Builders");
  expect(window.location.search).toBe("?workspace=bids");
  expect(window.localStorage.getItem("davapprove.pending-report")).toBeNull();
  expect(screen.getAllByRole("button", { name: /Saved reports/ }).length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: /^Projects/ })).not.toBeInTheDocument();
  expect(screen.queryByText("YOUR PROJECTS")).not.toBeInTheDocument();
  expect(mocks.request).not.toHaveBeenCalled();
});

it("shows the beta pricing prompt from the second report, continues free and saves feedback", async () => {
  const user = userEvent.setup();
  mocks.ownedCount = 1;
  await renderApp();
  await signIn();
  expect(await screen.findByRole("heading", { name: "New estimate" })).toBeInTheDocument();
  await estimate(user);
  await user.click(screen.getByRole("button", { name: /Open the full report/ }));
  const dialog = await screen.findByRole("dialog", { name: "You've used your free report" });
  expect(within(dialog).getByText("$49")).toBeInTheDocument();
  expect(within(dialog).getByText("$99")).toBeInTheDocument();
  await user.click(within(dialog).getByRole("radio", { name: "Too high" }));
  await user.type(within(dialog).getByLabelText(/What would you pay/), "Per report is fine at $25");
  await user.click(within(dialog).getByRole("button", { name: "Send feedback" }));
  expect(await within(dialog).findByText(/feedback is saved/)).toBeInTheDocument();
  expect(mocks.updateUser).toHaveBeenCalledWith({ data: { pricing_feedback: [expect.objectContaining({ audience: "pro", response: "too_high", note: "Per report is fine at $25" })] } });
  await user.click(within(dialog).getByRole("button", { name: "Continue free (beta)" }));
  const frame = await screen.findByTitle("Early bid assessment workspace");
  expect(decodeURIComponent(frame.getAttribute("src")!)).toContain("parcel=123");
});

it("keeps the first report free", async () => {
  const user = userEvent.setup();
  await renderApp();
  await signIn();
  await estimate(user);
  await user.click(screen.getByRole("button", { name: /Open the full report/ }));
  expect(await screen.findByTitle("Early bid assessment workspace")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
