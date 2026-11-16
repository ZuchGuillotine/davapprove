import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AuthPanel, { PasswordForm } from "./AuthPanel";

const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  resend: vi.fn(),
}));
vi.mock("./api", () => ({ getAuth: () => ({ auth }) }));
beforeEach(() => {
  cleanup();
  vi.resetAllMocks();
  localStorage.clear();
  for (const method of Object.values(auth))
    method.mockResolvedValue({ data: { session: null }, error: null });
});
async function credentials(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Email address"), "beta@example.com");
  await user.type(
    screen.getByLabelText("Password", { exact: true }),
    "a-test-passphrase",
  );
}
it("signs in with a password when email delivery is unavailable, without persisting credentials", async () => {
  const user = userEvent.setup();
  render(<AuthPanel available emailEnabled={false} />);
  await credentials(user);
  await user.click(
    screen.getByRole("button", { name: "Sign in to workspace" }),
  );
  expect(auth.signInWithPassword).toHaveBeenCalledWith({
    email: "beta@example.com",
    password: "a-test-passphrase",
  });
  expect(screen.getByLabelText("Password", { exact: true })).toHaveValue("");
  expect(localStorage.length).toBe(0);
});
it("registers a real account through Supabase and explains confirmation without claiming immediate access", async () => {
  const user = userEvent.setup();
  render(<AuthPanel available emailEnabled />);
  await user.click(screen.getByRole("button", { name: "Create account" }));
  await credentials(user);
  await user.type(
    screen.getByLabelText("Confirm password"),
    "a-test-passphrase",
  );
  await user.click(screen.getByRole("button", { name: "Create beta account" }));
  expect(auth.signUp).toHaveBeenCalledWith({
    email: "beta@example.com",
    password: "a-test-passphrase",
    options: { emailRedirectTo: window.location.origin + "/" },
  });
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Check your email to confirm",
  );
  expect(auth.signInWithPassword).not.toHaveBeenCalled();
});
it("does not submit mismatched passwords or claim email delivery when disabled", async () => {
  const user = userEvent.setup();
  const { rerender } = render(<AuthPanel available emailEnabled />);
  await user.click(screen.getByRole("button", { name: "Create account" }));
  await credentials(user);
  await user.type(
    screen.getByLabelText("Confirm password"),
    "different-passphrase",
  );
  await user.click(screen.getByRole("button", { name: "Create beta account" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Passwords do not match",
  );
  expect(auth.signUp).not.toHaveBeenCalled();
  rerender(<AuthPanel available emailEnabled={false} />);
  expect(
    screen.getByRole("button", { name: "Create beta account" }),
  ).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Forgot password?" }));
  expect(
    screen.getByRole("button", { name: "Send reset link" }),
  ).toBeDisabled();
});
it("shows rejected credentials and keeps sign-in available to retry", async () => {
  auth.signInWithPassword.mockResolvedValue({
    error: { code: "invalid_credentials" },
  });
  const user = userEvent.setup();
  render(<AuthPanel available emailEnabled />);
  await credentials(user);
  await user.click(
    screen.getByRole("button", { name: "Sign in to workspace" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Email or password is incorrect",
  );
  expect(
    screen.getByRole("button", { name: "Sign in to workspace" }),
  ).toBeEnabled();
});
it("requests recovery with the dedicated recovery route and a non-enumerating confirmation", async () => {
  const user = userEvent.setup();
  render(<AuthPanel available emailEnabled />);
  await user.click(screen.getByRole("button", { name: "Forgot password?" }));
  await user.type(screen.getByLabelText("Email address"), "beta@example.com");
  await user.click(screen.getByRole("button", { name: "Send reset link" }));
  expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("beta@example.com", {
    redirectTo: window.location.origin + "/?auth=recovery",
  });
  expect(await screen.findByRole("status")).toHaveTextContent(
    "If this email has an account",
  );
});
it("only completes a password update after Supabase accepts it", async () => {
  const saved = vi.fn();
  const user = userEvent.setup();
  auth.updateUser.mockResolvedValueOnce({
    error: Error("Recovery session expired"),
  });
  render(<PasswordForm onSaved={saved} />);
  await user.type(
    screen.getByLabelText("New password", { exact: true }),
    "a-new-passphrase",
  );
  await user.type(
    screen.getByLabelText("Confirm new password"),
    "a-new-passphrase",
  );
  await user.click(screen.getByRole("button", { name: "Save password" }));
  expect(saved).not.toHaveBeenCalled();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Recovery session expired",
  );
  await user.click(screen.getByRole("button", { name: "Save password" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(auth.updateUser).toHaveBeenLastCalledWith({
    password: "a-new-passphrase",
  });
});

it("resends confirmation without a password and throttles repeat email requests", async () => {
  const user = userEvent.setup();
  render(<AuthPanel available emailEnabled />);
  await user.click(
    screen.getByRole("button", { name: "Resend confirmation email" }),
  );
  await user.type(screen.getByLabelText("Email address"), "beta@example.com");
  expect(
    screen.queryByLabelText("Password", { exact: true }),
  ).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Resend confirmation link" }),
  );
  expect(auth.resend).toHaveBeenCalledWith({
    type: "signup",
    email: "beta@example.com",
    options: { emailRedirectTo: window.location.origin + "/" },
  });
  expect(await screen.findByRole("status")).toHaveTextContent(
    "If this email has an unconfirmed account",
  );
  expect(
    screen.getByRole("button", { name: "Resend confirmation link" }),
  ).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Forgot password?" }));
  expect(
    screen.getByRole("button", { name: "Send reset link" }),
  ).toBeDisabled();
  expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Back to sign in" }));
  expect(
    screen.getByRole("button", { name: "Sign in to workspace" }),
  ).toBeEnabled();
});
it("keeps recovery retry available after a rejected email hook without claiming delivery", async () => {
  auth.resetPasswordForEmail.mockResolvedValue({
    error: { code: "hook_timeout" },
  });
  const user = userEvent.setup();
  render(<AuthPanel available emailEnabled />);
  await user.click(screen.getByRole("button", { name: "Forgot password?" }));
  await user.type(screen.getByLabelText("Email address"), "beta@example.com");
  await user.click(screen.getByRole("button", { name: "Send reset link" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "could not complete email delivery",
  );
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Send reset link" })).toBeEnabled();
});
it("stores optional business branding as signup metadata without changing credentials", async () => {
  const user = userEvent.setup();
  render(<AuthPanel available emailEnabled />);
  await user.click(screen.getByRole("button", { name: "Create account" }));
  await credentials(user);
  await user.type(
    screen.getByLabelText("Confirm password"),
    "a-test-passphrase",
  );
  await user.type(
    screen.getByLabelText("Business / agency name (optional)"),
    "Davin Designs LLC",
  );
  await user.click(screen.getByRole("button", { name: "Create beta account" }));
  expect(auth.signUp).toHaveBeenCalledWith(
    expect.objectContaining({
      options: {
        emailRedirectTo: window.location.origin + "/",
        data: { business_name: "Davin Designs LLC" },
      },
    }),
  );
});
