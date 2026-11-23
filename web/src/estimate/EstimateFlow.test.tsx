import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EstimateFlow from "./EstimateFlow";
import { fakeEstimator, summary } from "./test-fixtures";

beforeEach(() => cleanup());

async function pickParcel(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByRole("combobox"), "1 synth");
  await user.click(await screen.findByRole("option", { name: /1 SYNTHETIC RD/ }));
}

it("goes from address to a basic range without granular report content, then requests the full report", async () => {
  const user = userEvent.setup();
  const estimator = fakeEstimator();
  const onFullReport = vi.fn();
  render(<EstimateFlow audience="pro" loader={async () => estimator} onFullReport={onFullReport} onPricing={vi.fn()} />);

  await user.type(await screen.findByRole("combobox"), "1 synth");
  expect(await screen.findByText(/King County, Washington could not be searched/)).toBeInTheDocument();
  await user.click(screen.getByRole("option", { name: /1 SYNTHETIC RD/ }));

  // Friendly description: tiles, choices and chips, no spreadsheet.
  await user.click(screen.getByRole("radio", { name: /Accessory dwelling unit/ }));
  await user.click(within(screen.getByRole("radiogroup", { name: "Wastewater" })).getByRole("radio", { name: "Public sewer" }));
  await user.click(screen.getByRole("button", { name: /Solar panels/ }));
  await user.click(screen.getByRole("button", { name: /Get estimate/ }));

  expect(await screen.findByText("$12,345 – $23,457")).toBeInTheDocument();
  expect(screen.getByText(/2 items need quotes · not included/)).toBeInTheDocument();
  expect(screen.getByText(/1 map layer could not be read · range may be low/)).toBeInTheDocument();
  expect(screen.getByText(/Not separately estimated yet: Solar panels/)).toBeInTheDocument();
  expect(screen.getByText(/Plus up to \$4,000 in possible allowances/)).toBeInTheDocument();
  // Agency names, roles and findings stay in the full report for professionals.
  expect(screen.queryByText("Synthetic County Permit Center")).not.toBeInTheDocument();

  const project = estimator.estimate.mock.calls[0][1];
  expect(project).toMatchObject({ type: "adu", new_sqft: 800, wastewater: "sewer", scope_items: ["solar"] });

  await user.click(screen.getByRole("button", { name: /Open the full report/ }));
  expect(onFullReport).toHaveBeenCalledWith(expect.objectContaining({ county: "wa-kitsap", parcel: "123", label: "1 SYNTHETIC RD", audience: "pro", project: expect.objectContaining({ type: "adu", scope_items: ["solar"] }) }));
});

it("will not open a report for a range that no longer matches the project", async () => {
  const user = userEvent.setup();
  render(<EstimateFlow audience="pro" loader={async () => fakeEstimator()} onFullReport={vi.fn()} onPricing={vi.fn()} />);
  await pickParcel(user);
  await user.click(screen.getByRole("button", { name: /Get estimate/ }));
  await screen.findByText("$12,345 – $23,457");
  await user.click(screen.getByRole("button", { name: /Change project details/ }));
  await user.click(screen.getByRole("button", { name: /Heat pump/ }));
  expect(screen.getByText(/Project details changed/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Open the full report/ })).toBeDisabled();
});

it("reports a clean map screen only when every layer was read", async () => {
  const user = userEvent.setup();
  render(<EstimateFlow audience="pro" loader={async () => fakeEstimator(summary({ coverage: { complete: true, unread_layers: [] }, quotes_needed: 0, possible: null }))} onFullReport={vi.fn()} onPricing={vi.fn()} />);
  await pickParcel(user);
  await user.click(screen.getByRole("button", { name: /Get estimate/ }));
  expect(await screen.findByText("All map layers read")).toBeInTheDocument();
  expect(screen.queryByText(/need quotes/)).not.toBeInTheDocument();
});

it("gives homeowners plain language, who is involved and the directory teaser", async () => {
  const user = userEvent.setup();
  const onFullReport = vi.fn();
  render(<EstimateFlow audience="homeowner" loader={async () => fakeEstimator()} onFullReport={onFullReport} onPricing={vi.fn()} />);
  await user.type(await screen.findByRole("combobox", { name: "Where is the property?" }), "1 synth");
  await user.click(await screen.findByRole("option", { name: /1 SYNTHETIC RD/ }));
  expect(screen.getByRole("radio", { name: /Add an ADU or backyard cottage/ })).toBeInTheDocument();
  expect(screen.queryByText("Adjust site numbers")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /See what it might cost/ }));

  expect(await screen.findByText("Who's involved")).toBeInTheDocument();
  expect(screen.getByText("Synthetic County Permit Center")).toBeInTheDocument();
  expect(screen.getByText("Will be involved")).toBeInTheDocument();
  expect(screen.getByText("May be involved")).toBeInTheDocument();
  expect(screen.getByText(/couldn't be read, so the range may be low/)).toBeInTheDocument();
  expect(screen.getByText(/This is not construction cost/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Join the founding directory/ })).toHaveAttribute("href", "/?listing=1");
  await user.click(screen.getByRole("button", { name: /Get the full report · \$29/ }));
  await waitFor(() => expect(onFullReport).toHaveBeenCalledWith(expect.objectContaining({ audience: "homeowner" })));
});
