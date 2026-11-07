# Davapprove project handoff

Updated: November 7, 2026. Research baseline: November 5, 2026.

## Objective

Help owners, architects, engineers and developers identify site constraints and coordinate approvals early enough to avoid expensive redesign. Kitsap County is the first target, with separate routing for incorporated cities, tribes, utilities, state and federal authorities.

The key problem identified in this conversation is the disjointed septic–civil–wetland–shoreline–designer loop: disciplines optimize their own plans while shared geometry, capacity and conditions remain inconsistent.

## Completed work

- A source-backed interactive HTML reference with 43 node templates, four diagrams, three synthetic blocker demonstrations and 60 source references.
- A JSON export of the node register and source index. It does not yet contain the complete typed edge register; the report's dependency table and model expressions are the current reference for those relationships.
- A portable report generator and logic/consistency checks.

The graph distinguishes inputs, hard prerequisites, consultations, conditions, property rights, change propagation and recommended coordination gates. Approval should be tied to a specific design revision, scope and work stage. Septic design approval and septic installation authorization are separate nodes.

## Status and limits

This is research and a workflow specification, not a deployed application. At the time of this sync, GitHub main contained only the initial README. Any application code, local changes or additional decisions in the desktop checkout were not visible from this session and have not been reconciled.

The original checks covered gate behavior, unique IDs, citations and internal links, plus visual inspection of the four diagrams. Full browser layout testing could not run in the research environment because browser process creation was restricted. The JS checks use a DOM stub and are not a substitute for browser testing.

The report flags unresolved city-specific code, parcel-specific jurisdiction, professional exceptions, vesting, expiry and special-project modules. Do not infer a universal buffer or permitting rule from the graph. No production technology stack was selected in this thread.

## Suggested next work (not yet implemented)

1. Inspect the desktop code and reconcile it with this research baseline.
2. Encode typed edges, stage predicates, conditions and revision invalidation with provenance.
3. Validate against actual rural-house, ADU, shoreline, wetland and city-subdivision permit files.
4. Connect parcel records and existing documents to a coordinated site-envelope workflow.

## Continuity

Use this repository for versioned files and project guidance. This handoff summarizes the relevant work; it is not a transcript export or a merger of ChatGPT and Codex chat histories. It does not configure a background sync service.

Remote: https://github.com/ZuchGuillotine/davapprove.git

For the desktop checkout: verify its remote and working-tree state, fetch origin, then integrate main without discarding local work. If main is clean and only behind, a fast-forward pull is appropriate. If there are local commits or modifications, inspect and reconcile them first. Keep the desktop project pointed at that existing checkout.
