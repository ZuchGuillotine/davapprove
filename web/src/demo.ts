import type { Assessment, Candidate, Project, Json } from "./types";
const geometry = {
  type: "Polygon",
  coordinates: [
    [
      [-122.646, 47.747],
      [-122.643, 47.747],
      [-122.643, 47.749],
      [-122.646, 47.749],
      [-122.646, 47.747],
    ],
  ],
};
const initial: Project = {
  id: "sample-project",
  name: "Cedar House · Concept study",
  parcel_number: "DEMO-001",
  parcel: {
    address: "Illustrative Kitsap site",
    geometry,
    area_acres: 1.24,
    jurisdiction: "kitsap_county",
    source: "Synthetic demonstration",
  },
  jurisdiction: "kitsap_county",
  intent: {
    project_type: "new_house",
    bedrooms: 3,
    units: 1,
    wastewater: "septic",
  },
  current_revision: 1,
  created_at: "2026-11-07T12:00:00Z",
};
const candidates: Candidate[] = [
  {
    id: "survey",
    title: "Boundary & topographic survey",
    source: "Sample recorded survey",
    category: "Survey & title",
    record_date: "2023-04-18",
    match_reason: "Synthetic example — exact parcel match",
    access_method: "download",
    document_url: "demo://survey",
    status: "recorded",
    size_bytes: 2400000,
  },
  {
    id: "wetland",
    title: "Wetland delineation report",
    source: "Sample environmental record",
    category: "Environment",
    record_date: "2018-06-12",
    match_reason: "Synthetic example — referenced in site review",
    access_method: "download",
    document_url: "demo://wetland",
    status: "historical",
    size_bytes: 8100000,
  },
  {
    id: "septic",
    title: "Septic record drawing",
    source: "Sample health district record",
    category: "Septic & water",
    record_date: "2021-09-03",
    match_reason: "Synthetic example — tax account match",
    access_method: "download",
    document_url: "demo://septic",
    status: "record on file",
    size_bytes: 1200000,
  },
  {
    id: "civil",
    title: "Prior site development permit",
    source: "Sample permit history",
    category: "Permits & civil",
    record_date: "2022-02-15",
    match_reason: "Synthetic example — prior proposal",
    access_method: "download",
    document_url: "demo://civil",
    status: "closed",
  },
  {
    id: "water",
    title: "Water availability letter",
    source: "Utility provider",
    category: "Utilities & access",
    match_reason: "Request a project-specific letter",
    access_method: "manual",
    url: "https://www.kitsappublichealth.org/publicrecords",
    status: "manual access",
  },
];
function seed() {
  return {
    projects: [structuredClone(initial)],
    candidates: [] as Candidate[],
    documents: [] as Json[],
    facts: [] as Json[],
    comments: [] as Json[],
    jobs: [] as Json[],
  };
}
let state = load();
function load() {
  try {
    return (
      JSON.parse(localStorage.getItem("davapprove-demo-v1") || "null") || seed()
    );
  } catch {
    return seed();
  }
}
function save() {
  localStorage.setItem("davapprove-demo-v1", JSON.stringify(state));
}
export function resetDemo() {
  state = seed();
  save();
}
function assessment(p: Project): Assessment {
  const accepted = state.facts.filter(
    (f: Json) => f.review_status === "accepted",
  );
  const nodes = [
    {
      id: "J0",
      title: "Jurisdiction & parcel",
      state: "review_required",
      reason: "Synthetic demonstration; confirm live parcel jurisdiction.",
    },
    {
      id: "B0",
      title: "Survey & property rights",
      state: accepted.some((f: Json) => f.key === "survey_date")
        ? "review_required"
        : "unknown",
      reason: "Verify boundary and recorded access before relying on layout.",
    },
    {
      id: "E0",
      title: "Environmental evidence",
      state: "unknown",
      reason: "A historical report needs a relevance and currency review.",
    },
    {
      id: "S0",
      title: "Wastewater & water",
      state: "unknown",
      reason: "Confirm capacity for the proposed bedroom count.",
    },
    {
      id: "D0",
      title: "Coordinated site plan",
      state: "blocked",
      reason:
        "Resolve geometry and evidence gaps before relying on an envelope.",
    },
    {
      id: "B1",
      title: "Building intake",
      state: "unknown",
      reason: "No intake readiness determination has been made.",
    },
  ];
  return {
    revision: p.current_revision,
    nodes,
    edges: [
      { source: "J0", target: "B0", type: "INPUT" },
      { source: "B0", target: "D0", type: "INPUT" },
      { source: "E0", target: "D0", type: "INPUT" },
      { source: "S0", target: "D0", type: "INPUT" },
      { source: "D0", target: "B1", type: "RECOMMENDED" },
    ],
    actions: nodes
      .slice(1, 4)
      .map((n, i) => ({
        id: n.id,
        title: n.title,
        reason: n.reason,
        owner: [
          "Surveyor / architect",
          "Environmental specialist",
          "Septic designer / water provider",
        ][i],
        milestone: "Design coordination",
        kind: "recommended",
      })),
    envelope: {
      status: "cannot_determine",
      geometry: null,
      reason:
        "Accepted boundaries, applicable setbacks and constraint geometry are still needed.",
    },
    coverage_gaps: [
      "Parcel boundaries are illustrative, not a survey.",
      "Unselected records are not project evidence.",
      "No numerical zoning or environmental rule is evaluated in this sample.",
    ],
    summary: "Research workspace — further evidence is needed.",
  };
}
export async function demoRequest(
  path: string,
  method = "GET",
  body?: any,
): Promise<any> {
  await new Promise((r) => setTimeout(r, 160));
  const parts = path.split("/").filter(Boolean);
  const id = parts[1];
  const p = state.projects.find((x: Project) => x.id === id) || initial;
  let result: any;
  if (path === "/projects" && method === "GET")
    return { projects: state.projects };
  if (path === "/parcels/lookup")
    return {
      ...initial.parcel,
      parcel_number: body.parcel_number,
      address: "Illustrative parcel — not a live lookup",
    };
  if (path === "/projects" && method === "POST") {
    result = {
      ...initial,
      ...body,
      id: crypto.randomUUID(),
      current_revision: 1,
      created_at: new Date().toISOString(),
    };
    state.projects.push(result);
  } else if (parts[0] === "projects" && parts.length === 2 && method === "GET")
    return p;
  else if (parts[2] === "discover") {
    state.candidates = candidates.map((c) => ({ ...c, project_id: id }));
    result = {
      id: crypto.randomUUID(),
      status: "completed",
      stage: "Discovery complete",
    };
    state.jobs.push(result);
  } else if (parts[2] === "candidates")
    return {
      candidates: state.candidates.filter((c: Json) => c.project_id === id),
      coverage: [
        {
          source: "Illustrative source set",
          status: "complete_for_query",
          message: "All records in this view are synthetic examples.",
        },
      ],
    };
  else if (parts[2] === "imports") {
    result = {
      jobs: body.candidate_ids.map((cid: string) => {
        const c = state.candidates.find((x: Candidate) => x.id === cid);
        if (!c) throw Error("Unknown candidate");
        if (
          !state.documents.some(
            (d: Json) => d.id === cid && d.project_id === id,
          )
        ) {
          state.documents.push({
            id: cid,
            project_id: id,
            title: c.title,
            source: c.source,
            status: "needs_review",
            page_count: 6,
            created_at: new Date().toISOString(),
          });
          state.facts.push({
            id: "fact-" + cid,
            project_id: id,
            key: cid + "_date",
            value: c.record_date || "Unknown",
            review_status: "proposed",
            document_id: cid,
            page: 1,
            source_quote: "Illustrative extracted date, not a real document.",
          });
        }
        const job = {
          id: crypto.randomUUID(),
          status: "completed",
          stage: "Sample imported",
        };
        state.jobs.push(job);
        return job;
      }),
    };
  } else if (parts[0] === "jobs")
    return (
      state.jobs.find((j: Json) => j.id === parts[1]) || {
        id: parts[1],
        status: "completed",
      }
    );
  else if (parts[2] === "documents")
    return {
      documents: state.documents.filter((d: Json) => d.project_id === id),
    };
  else if (parts[2] === "review")
    return { facts: state.facts.filter((f: Json) => f.project_id === id) };
  else if (parts[2] === "assessment") return assessment(p);
  else if (parts[2] === "revisions") {
    if (p.current_revision !== body.expected_revision)
      throw Error("Revision changed. Refresh before saving.");
    if (body.intent) p.intent = { ...p.intent, ...body.intent };
    for (const f of body.facts || []) {
      const existing = state.facts.find(
        (x: Json) => x.id === f.id && x.project_id === id,
      );
      if (existing) Object.assign(existing, f);
    }
    p.current_revision++;
    result = p;
  } else if (parts[2] === "comments") {
    if (method === "GET")
      return {
        comments: state.comments.filter((c: Json) => c.project_id === id),
      };
    result = {
      ...body,
      id: crypto.randomUUID(),
      project_id: id,
      created_at: new Date().toISOString(),
      author: "Demo reviewer",
    };
    state.comments.push(result);
  } else
    throw Error(
      "This action needs the connected application. Sample mode does not upload real files.",
    );
  save();
  return structuredClone(result);
}
