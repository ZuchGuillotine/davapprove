import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ParcelSearch from "./ParcelSearch";
import { request } from "./api";
vi.mock("./api", () => ({ request: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("searches an address and resolves only the selected identity", async () => {
  vi.mocked(request).mockResolvedValueOnce({ results: [{ parcel_number: "01220110052001", label: "602 ALDER AVE NE" }], truncated: false })
    .mockResolvedValueOnce({ parcel_number: "01220110052001", address: "602 ALDER AVE NE" });
  const selected = vi.fn();
  render(<ParcelSearch onSelected={selected} onChange={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Address or parcel number"), { target: { value: "602 Alder Avenue" } });
  fireEvent.submit(screen.getByRole("form"));
  fireEvent.click(await screen.findByRole("button", { name: /602 ALDER/ }));
  await waitFor(() => expect(selected).toHaveBeenCalledWith(expect.objectContaining({ parcel_number: "01220110052001" })));
  expect(request).toHaveBeenNthCalledWith(2, "/parcels/lookup", "POST", { parcel_number: "01220110052001" }, expect.any(AbortSignal));
});
it("ignores a late search after the user changes the address", async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(request).mockReturnValueOnce(new Promise(r => { resolve = r; }));
  render(<ParcelSearch onSelected={vi.fn()} onChange={vi.fn()} />);
  const input = screen.getByLabelText("Address or parcel number");
  fireEvent.change(input, { target: { value: "602 Alder" } }); fireEvent.submit(screen.getByRole("form"));
  fireEvent.change(input, { target: { value: "123 Main" } });
  resolve({ results: [{ parcel_number: "01220110052001", label: "OLD RESULT" }], truncated: false });
  await waitFor(() => expect(screen.getByRole("button", { name: "Look up property" })).toBeEnabled());
  expect(screen.queryByText(/OLD RESULT/)).not.toBeInTheDocument();
});
it("looks up a dashed tax ID directly and reports source failures", async () => {
  vi.mocked(request).mockRejectedValueOnce(new Error("County source unavailable"));
  render(<ParcelSearch onSelected={vi.fn()} onChange={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Address or parcel number"), { target: { value: "012201-1-005-2001" } });
  fireEvent.submit(screen.getByRole("form"));
  expect(await screen.findByRole("alert")).toHaveTextContent("County source unavailable");
  expect(request).toHaveBeenCalledWith("/parcels/lookup", "POST", { parcel_number: "012201-1-005-2001" }, expect.any(AbortSignal));
});
