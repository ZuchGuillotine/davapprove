import { useCallback, useState } from "react";
import { Layers, LogIn, ShieldCheck } from "lucide-react";
import AuthPanel from "../AuthPanel";
import type { ReportRequest } from "../bidEngine";
import type { Audience } from "../pricing";
import EstimateFlow from "./EstimateFlow";
import { EmailCapture, Modal, PricingDialog } from "./Dialogs";
import type { EstimateLink } from "./deepLink";

export function BrandMark({ suffix }: { suffix?: string }) {
  return <a className="brand landing-brand" href="/">
    <span className="brand-mark"><Layers size={21} /></span>
    davapprove<span className="brand-period">.</span>
    {suffix && <span className="brand-suffix">{suffix}</span>}
  </a>;
}

type LandingConfig = { authAvailable?: boolean; email_delivery_enabled?: boolean } | null;

/*
 * Signed-out landing: the address box is the product. The basic estimate is open; the full
 * report asks for an email. Used for professionals at "/" and homeowners at "/homeowner".
 */
export default function Landing({ audience, config, error, notice, initial = null }: { audience: Audience; config: LandingConfig; error?: string; notice?: string; initial?: EstimateLink | null }) {
  const [capture, setCapture] = useState<{ request: ReportRequest | null } | null>(() =>
    audience === "pro" && new URLSearchParams(window.location.search).has("listing") ? { request: null } : null);
  const [signInOpen, setSignInOpen] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);
  const pro = audience === "pro";
  const closeCapture = useCallback(() => setCapture(null), []);
  const closeSignIn = useCallback(() => setSignInOpen(false), []);
  const closePricing = useCallback(() => setPricingOpen(false), []);

  return <div className={`landing ${pro ? "pro" : "plain"}`}>
    <header className="landing-header">
      <BrandMark suffix={pro ? undefined : "for homeowners"} />
      <nav>
        <button className="text-link" onClick={() => setPricingOpen(true)}>Pricing</button>
        {pro ? <button className="secondary" onClick={() => setSignInOpen(true)}><LogIn size={16} /> Sign in</button>
          : <a className="text-link" href="/">For builders and architects</a>}
      </nav>
    </header>
    <main className="landing-main">
      <section className="landing-hero">
        <span className="eyebrow">{pro ? "FOR BUILDERS, ARCHITECTS AND INVESTORS" : "PLANNING A PROJECT?"}</span>
        <h1>{pro ? "Know the permits before you price the job." : "See what permits your project needs, and roughly what they cost."}</h1>
        <p>{pro
          ? "Enter an address and describe the build. Get a permitting and pre-construction range from every agency involved, then open the full report with the code and fee schedule behind each line."
          : "Enter your address and tell us what you want to build. We check the county, city, state and federal rules that apply to your lot and give you a plain-language range."}</p>
      </section>
      {error && <p role="alert" className="error landing-alert">{error}</p>}
      {notice && <p className="notice landing-alert">{notice}</p>}
      <EstimateFlow audience={audience} initial={initial} onFullReport={request => setCapture({ request })} onPricing={() => setPricingOpen(true)} />
      <footer className="landing-footer">
        <ShieldCheck size={16} />
        <span>Screening estimates from public maps and published fee schedules. Not an approval or a quote. We never ask for or show property owner names.</span>
        {pro && <button className="text-link" onClick={() => setCapture({ request: null })}>Join the founding pro directory</button>}
      </footer>
    </main>
    {capture && <EmailCapture audience={audience} request={capture.request} emailEnabled={!!config?.email_delivery_enabled} listingDefault={!capture.request}
      onClose={closeCapture} onPasswordSignIn={() => { setCapture(null); setSignInOpen(true); }} />}
    {signInOpen && <Modal title="Sign in" onClose={closeSignIn}>
      <AuthPanel available={!!config?.authAvailable} emailEnabled={!!config?.email_delivery_enabled} />
      {!pro && <p className="hint">After signing in, your estimate history and reports open in the Davapprove workspace.</p>}
    </Modal>}
    {pricingOpen && <PricingDialog audience={audience} mode="info" signedIn={false} onClose={closePricing} />}
  </div>;
}
