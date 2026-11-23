import { getAuth } from "./api";
import type { ReportRequest } from "./bidEngine";
import type { Audience } from "./pricing";

const PENDING_KEY = "davapprove.pending-report";
const PENDING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function savePendingReport(request: ReportRequest) {
  try {
    window.localStorage.setItem(PENDING_KEY, JSON.stringify({ ...request, at: Date.now() }));
  } catch {
    /* Private browsing: the emailed link still signs in; the user can re-run the estimate. */
  }
}

export function takePendingReport(): ReportRequest | null {
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    window.localStorage.removeItem(PENDING_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!value || Date.now() - Number(value.at) > PENDING_MAX_AGE_MS) return null;
    if (typeof value.county !== "string" || typeof value.parcel !== "string" || !value.project || typeof value.project.type !== "string") return null;
    return { county: value.county, parcel: value.parcel, label: String(value.label || ""), project: value.project, audience: value.audience === "homeowner" ? "homeowner" : "pro" };
  } catch {
    return null;
  }
}

export function hasPendingReport() {
  try {
    return !!window.localStorage.getItem(PENDING_KEY);
  } catch {
    return false;
  }
}

/** Fragment for the full report workspace. Only these keys cross into the assessment frame. */
export function reportHash(request: ReportRequest, agency = "") {
  // The workspace decodes each value with decodeURIComponent, so encode the same way ("+" stays literal).
  const pairs: [string, string][] = [["county", request.county], ["parcel", request.parcel], ["type", request.project.type], ["project", JSON.stringify(request.project)], ["estimate", "1"]];
  if (agency.trim()) pairs.push(["agency", agency.trim().slice(0, 160)]);
  return "#" + pairs.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
}

/** Full reports this account created (saved bids it owns). Shared bids do not count. */
export async function ownedReportCount(): Promise<number> {
  const client = getAuth();
  if (!client) return 0;
  const { data } = await client.auth.getSession();
  const user = data.session?.user;
  if (!user) return 0;
  const { count, error } = await client.from("bids").select("id", { count: "exact", head: true }).eq("owner_id", user.id);
  if (error) throw error;
  return count || 0;
}

export type CaptureDetails = { email: string; businessName?: string; listingInterest?: boolean; audience: Audience };

/** Send a one-time sign-in link for an existing invited account. */
export async function sendReportLink(details: CaptureDetails) {
  const client = getAuth();
  if (!client) throw new Error("Sign-in is not available on this deployment yet.");
  const metadata: Record<string, string | boolean> = { signup_source: "estimate", audience: details.audience };
  if (details.businessName?.trim()) metadata.business_name = details.businessName.trim().slice(0, 160);
  if (details.listingInterest) metadata.founding_listing_interest = true;
  const { error } = await client.auth.signInWithOtp({
    email: details.email.trim(),
    options: { shouldCreateUser: false, emailRedirectTo: window.location.origin + "/?report=pending", data: metadata },
  });
  if (error) throw error;
}

export type PricingFeedback = { audience: Audience; plan: string; response: string; note?: string };

/** Beta pricing feedback is stored on the tester's own account record; no extra table needed. */
export async function savePricingFeedback(feedback: PricingFeedback) {
  const client = getAuth();
  if (!client) return false;
  const { data } = await client.auth.getSession();
  if (!data.session) return false;
  const previous = Array.isArray(data.session.user.user_metadata?.pricing_feedback) ? data.session.user.user_metadata.pricing_feedback : [];
  const entry = { ...feedback, note: feedback.note?.slice(0, 500), at: new Date().toISOString() };
  const { error } = await client.auth.updateUser({ data: { pricing_feedback: [...previous, entry].slice(-20) } });
  if (error) throw error;
  return true;
}
