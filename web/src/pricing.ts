/*
 * Beta pricing preview. These are hypotheses shown to beta testers for feedback; nobody is
 * charged during the beta. Change the numbers here only. See docs/PRODUCT_STRATEGY.md.
 */
export type Audience = "pro" | "homeowner";

export type Plan = { id: string; name: string; price: string; cadence: string; features: string[]; highlight?: boolean };

export const FREE_REPORTS = 1;

export const PLANS: Record<Audience, Plan[]> = {
  pro: [
    {
      id: "pro-report",
      name: "Single report",
      price: "$49",
      cadence: "per report",
      features: ["Full cited estimate for one parcel", "Agencies, studies and code excerpts", "Branded PDF and bid memo"],
    },
    {
      id: "pro-unlimited",
      name: "Pro",
      price: "$99",
      cadence: "per month",
      highlight: true,
      features: ["Unlimited reports", "Saved bids and collaborators", "Your business name on every report", "Founding listing in the pro directory when it launches"],
    },
  ],
  homeowner: [
    {
      id: "home-report",
      name: "Full report",
      price: "$29",
      cadence: "one time",
      highlight: true,
      features: ["Every agency, study and fee behind the range", "Links to the actual code and fee schedules", "A PDF to bring to builders and architects"],
    },
  ],
};
