import { beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";

const mocks = vi.hoisted(() => ({
  onChange: null as null | ((event: string, session: any) => void),
  getSession: vi.fn(),
  signOut: vi.fn(),
  updateUser: vi.fn(),
  request: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("./api", () => ({
  configure: async () => ({
    mode: "supabase",
    authAvailable: true,
    email_delivery_enabled: true,
  }),
  getAuth: () => ({
    auth: {
      getSession: mocks.getSession,
      signOut: mocks.signOut,
      updateUser: mocks.updateUser,
      onAuthStateChange: (cb: typeof mocks.onChange) => {
        mocks.onChange = cb;
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
  }),
  request: mocks.request,
  setSampleMode: vi.fn(),
  invalidateRequests: mocks.invalidate,
  safeUrl: (value: string) => value,
  documentUrl: vi.fn(),
}));
const session = {
  user: { id: "existing-beta-user", email: "beta@example.com" },
};
beforeEach(() => {
  cleanup();
  vi.resetAllMocks();
  mocks.onChange = null;
  window.history.replaceState(null, "", "/");
  mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
  mocks.request.mockResolvedValue({ projects: [] });
  mocks.updateUser.mockResolvedValue({ error: null });
  mocks.signOut.mockImplementation(async () => {
    mocks.onChange?.("SIGNED_OUT", null);
    return { error: null };
  });
});
async function event(name: string, value: any = session) {
  await waitFor(() => expect(mocks.onChange).toBeTypeOf("function"));
  await act(async () => {
    mocks.onChange!(name, value);
  });
}
it("restores a real session, lets existing link users set a password, and clears access on sign-out", async () => {
  const user = userEvent.setup();
  mocks.getSession.mockResolvedValue({ data: { session }, error: null });
  render(<App />);
  await user.click(
    await screen.findByRole("button", { name: "Account & password" }),
  );
  expect(screen.getByRole("dialog")).toHaveTextContent("beta@example.com");
  await user.type(
    screen.getByLabelText("New password", { exact: true }),
    "a-new-passphrase",
  );
  await user.type(
    screen.getByLabelText("Confirm new password"),
    "a-new-passphrase",
  );
  await user.click(screen.getByRole("button", { name: "Save password" }));
  expect(mocks.updateUser).toHaveBeenCalledWith({
    password: "a-new-passphrase",
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Leave workspace" }),
    ).toBeEnabled(),
  );
  await user.click(screen.getByRole("button", { name: "Leave workspace" }));
  expect(
    await screen.findByRole("button", { name: "Sign in to workspace" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Account & password" }),
  ).not.toBeInTheDocument();
  expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
});
it("routes recovery sessions to the password form before fetching any project", async () => {
  const user = userEvent.setup();
  render(<App />);
  await event("PASSWORD_RECOVERY");
  expect(
    screen.getByRole("form", { name: "Set password" }),
  ).toBeInTheDocument();
  expect(mocks.request).not.toHaveBeenCalled();
  await user.type(
    screen.getByLabelText("New password", { exact: true }),
    "a-new-passphrase",
  );
  await user.type(
    screen.getByLabelText("Confirm new password"),
    "a-new-passphrase",
  );
  await user.click(screen.getByRole("button", { name: "Save password" }));
  await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/projects"));
  expect(
    await screen.findByRole("button", { name: "Account & password" }),
  ).toBeInTheDocument();
});
it("keeps a recovery redirect in the recovery flow even when INITIAL_SESSION arrives first", async () => {
  window.history.replaceState(null, "", "/?auth=recovery");
  mocks.getSession.mockResolvedValue({ data: { session }, error: null });
  render(<App />);
  expect(
    await screen.findByRole("form", { name: "Set password" }),
  ).toBeInTheDocument();
  expect(mocks.request).not.toHaveBeenCalled();
  await event("INITIAL_SESSION");
  expect(mocks.request).not.toHaveBeenCalled();
});
it("explains expired recovery links without presenting a password update or workspace", async () => {
  window.history.replaceState(null, "", "/?auth=recovery");
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "invalid or expired",
  );
  expect(
    screen.queryByRole("form", { name: "Set password" }),
  ).not.toBeInTheDocument();
  expect(window.location.search).toBe("");
  expect(mocks.request).not.toHaveBeenCalled();
});
it("discards a previous user's in-flight project response after sign-out", async () => {
  let resolve!: (value: any) => void;
  mocks.request.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  render(<App />);
  await event("SIGNED_IN");
  await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/projects"));
  await event("SIGNED_OUT", null);
  await act(async () =>
    resolve({ projects: [{ id: "old-project", name: "Private old project" }] }),
  );
  await event("SIGNED_IN", {
    user: { id: "different-user", email: "new@example.com" },
  });
  expect(
    await screen.findByRole("button", { name: "Account & password" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Private old project")).not.toBeInTheDocument();
  expect(mocks.request).not.toHaveBeenCalledWith(
    expect.stringContaining("old-project"),
  );
});
