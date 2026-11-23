import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Check, LoaderCircle, Mail, X } from "lucide-react";
import type { ReportRequest } from "../bidEngine";
import { PLANS, type Audience } from "../pricing";
import { savePendingReport, savePricingFeedback, sendReportLink } from "../reportAccess";

/** Accessible modal shell: focus moves in, Escape and Tab stay inside, focus returns on close. */
export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea, a[href]') || []);
    (focusable().find(el => el.tagName === "INPUT") || focusable()[0])?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const items = focusable(), first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", handle);
    return () => { document.removeEventListener("keydown", handle); previous?.focus?.(); };
  }, [onClose]);
  const id = title.replace(/\W+/g, "-").toLowerCase();
  return <div className="modal-backdrop">
    <section ref={dialog} className={`modal estimate-modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={id}>
      <button className="close" aria-label="Close" onClick={onClose}><X /></button>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  </div>;
}

/*
 * Email capture: sends a one-time sign-in link that opens the full report. With no report
 * (request null) it is a founding-directory sign-up only.
 */
export function EmailCapture({ audience, request, emailEnabled, listingDefault = false, onClose, onPasswordSignIn }: {
  audience: Audience;
  request: ReportRequest | null;
  emailEnabled: boolean;
  listingDefault?: boolean;
  onClose: () => void;
  onPasswordSignIn: () => void;
}) {
  const [email, setEmail] = useState("");
  const [business, setBusiness] = useState("");
  const [listing, setListing] = useState(listingDefault);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const pro = audience === "pro";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      if (request) savePendingReport(request);
      await sendReportLink({ email, businessName: business, listingInterest: listing, audience });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const title = request ? (pro ? "Get the full report" : "Get your full report") : "Join the founding pro directory";
  if (sent) return <Modal title="Check your email" onClose={onClose}>
    <p className="capture-sent"><Mail size={22} /> We sent a one-time link to <b>{email}</b>. {request ? "Open it on this device and your full report for " : "Open it to confirm your listing interest."}{request && <b>{request.label}</b>}{request ? " opens right away." : ""}</p>
    <p className="hint">The link expires in an hour. No password needed. Check spam if it hasn't arrived in a few minutes.</p>
    <button className="secondary full" onClick={onClose}>Done</button>
  </Modal>;

  return <Modal title={title} onClose={onClose}>
    <p>{request
      ? (pro ? "Every agency, study and fee behind the range, with the code sections and fee schedules, plus a branded PDF. Your first report is free." : "Every agency, study and fee behind the range, with links to the actual rules, as a PDF you can bring to builders.")
      : "Builders and architects in the directory will be matched to homeowners by project type, jurisdiction and site conditions. Founding listings are free during the beta."}</p>
    {emailEnabled ? <form className="capture-form" onSubmit={submit}>
      <label>Email<input type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@company.com" /></label>
      {pro && <label>Business name <span className="hint">(optional, shown on your reports)</span><input autoComplete="organization" maxLength={160} value={business} onChange={event => setBusiness(event.target.value)} /></label>}
      {pro && <label className="check"><input type="checkbox" checked={listing} onChange={event => setListing(event.target.checked)} /> List my business in the founding pro directory when it launches</label>}
      {error && <p role="alert" className="error">{error}</p>}
      <button className="primary full" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Mail size={17} />} Email me the link</button>
    </form> : <p className="notice">Email links are not enabled on this deployment yet. Sign in with a password to open the full report.</p>}
    <button className="text-button" onClick={onPasswordSignIn}>Already have an account? Sign in with a password</button>
    <p className="fine-print">We use your email to send the report and beta updates. We never ask for or show property owner names.</p>
  </Modal>;
}

const RESPONSES: [string, string][] = [["fair", "Seems fair"], ["too_high", "Too high"], ["would_pay_more", "I'd pay more"], ["would_not_pay", "Wouldn't pay for this"]];

/*
 * Pricing preview. In "limit" mode it is the second-report paywall; during the beta its only
 * action is "Continue free", and testers can tell us what they think of the price.
 */
export function PricingDialog({ audience, mode, signedIn, onContinue, onClose }: {
  audience: Audience;
  mode: "limit" | "info";
  signedIn: boolean;
  onContinue?: () => void;
  onClose: () => void;
}) {
  const plans = PLANS[audience];
  const [response, setResponse] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");
  async function sendFeedback(event: FormEvent) {
    event.preventDefault();
    if (!response) return;
    try {
      const saved = await savePricingFeedback({ audience, plan: plans.map(plan => plan.id).join(","), response, note });
      setStatus(saved ? "Thanks. Your feedback is saved with your beta account." : "Sign in to send pricing feedback.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
  }
  return <Modal title={mode === "limit" ? "You've used your free report" : "Pricing"} onClose={onClose} wide>
    <p>{mode === "limit" ? "After the first report, full reports are a paid feature. During the beta they stay free: we'd value your honest reaction to the price." : "The address estimate is always free. Full cited reports are paid after your first one. Everything is free during the beta."}</p>
    <div className="plan-grid">
      {plans.map(plan => <article key={plan.id} className={`plan ${plan.highlight ? "highlight" : ""}`}>
        <h3>{plan.name}</h3>
        <p className="plan-price"><b>{plan.price}</b> {plan.cadence}</p>
        <ul>{plan.features.map(feature => <li key={feature}><Check size={14} /> {feature}</li>)}</ul>
        <span className="beta-tag">Free beta</span>
      </article>)}
    </div>
    {onContinue && <button className="primary full" onClick={onContinue}>Continue free (beta)</button>}
    {signedIn ? <form className="pricing-feedback" onSubmit={sendFeedback}>
      <span className="brief-label">How does this pricing feel?</span>
      <div className="chip-row" role="radiogroup" aria-label="Pricing feedback">
        {RESPONSES.map(([key, label]) => <button key={key} type="button" role="radio" aria-checked={response === key} className={`chip ${response === key ? "on" : ""}`} onClick={() => setResponse(key)}>{label}</button>)}
      </div>
      <label>What would you pay, or how would you rather pay? <span className="hint">(optional)</span><textarea rows={2} maxLength={500} value={note} onChange={event => setNote(event.target.value)} /></label>
      <button className="secondary" disabled={!response}>Send feedback</button>
      {status && <p role="status" className="hint">{status}</p>}
    </form> : <p className="hint">Beta testers can leave pricing feedback after signing in.</p>}
  </Modal>;
}
