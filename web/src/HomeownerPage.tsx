import type { ReportRequest } from "./bidEngine";
import EstimateFlow from "./estimate/EstimateFlow";

export default function HomeownerPage({ onFullReport, onPricing }: {
  onFullReport: (request: ReportRequest) => void;
  onPricing: () => void;
}) {
  return <section className="estimate-workspace plain" aria-label="Homeowner estimate">
    <div className="estimate-workspace-heading">
      <h1>What permits might your project need?</h1>
      <p>Enter the property address and describe your project for an early estimate.</p>
    </div>
    <EstimateFlow audience="homeowner" onFullReport={onFullReport} onPricing={onPricing} />
  </section>;
}
