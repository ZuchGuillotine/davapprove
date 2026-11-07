# Adding a municipality

County and city permitting rules are separate authorities. A new city starts as unsupported for calculations, even when county GIS supplies its parcel geometry. Do not copy county setbacks into a city pack.

1. Confirm the municipal boundary source, date and jurisdiction identifier. Include an inside/outside boundary fixture, a boundary ambiguity case, and a mailing-address mismatch. Utility service areas do not determine municipal jurisdiction.
2. Inventory the official code publisher, adopted amendments, effective dates, permit portal, zoning/overlay layers, engineering standards, water/sewer providers and relevant fire/road authorities. Record automated versus assisted access in `docs/research/source-access-matrix.md`.
3. Map local terminology to the shared fact and research node IDs. Reuse statewide or KPHD relationships only where their jurisdiction and applicability are supported. Keep city-only code and workflow relationships separately identified.
4. For each implemented rule, supply a section-level citation, effective date, project-type applicability, required facts, milestone, deterministic predicate and expected outputs. If any are missing, the rule returns unknown or remains inactive. A numeric setback needs lot-edge classification, not just a zoning label.
5. Test at least a simple residence, ADU and constrained parcel against sponsor-reviewed records, plus unavailable sources, unknown water/wastewater, conflicting facts and a parcel outside the city. Public GIS remains screening evidence.
6. Review with the architect before enabling the pack. Publish its supported project types and explicit gaps. Preserve the prior version so existing project assessments remain reproducible.

## Poulsbo example

Use the [city code/maps index](https://poulsbo.gov/codes-amendments-maps/), [municipal code](https://ecode360.com/PO4596/home), [engineering guidance](https://poulsbo.gov/engineering/) and [city permit portal](https://ci-poulsbo-wa.smartgovcommunity.com/Public/Home). County parcel geometry may locate a Poulsbo property, but city zoning and local engineering rules govern their respective checks. A county PREP result does not establish city intake readiness.

The MVP supports Poulsbo parcel research and evidence coordination. Numerical rules should only be activated when the source matrix and rule fixtures document their review. No municipality is fully supported merely because a label and a portal link exist.

## Change review

When code or boundaries change, add a new version and test it. Compare affected projects against that version, present the impact and request reviewer acceptance before changing project reliance. Preserve agency decision history and any unresolved vesting question. Update only the applicable rules; do not treat a newly published manual as proof that every prior approval is invalid.
