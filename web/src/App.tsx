import { useEffect, useState, lazy, Suspense, type FormEvent } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Compass,
  FileText,
  FolderOpen,
  GitBranch,
  Layers,
  Leaf,
  LoaderCircle,
  LogOut,
  MapPin,
  MessageSquare,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  X,
  Printer,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
} from "lucide-react";
import {
  configure,
  getAuth,
  request,
  safeUrl,
  setSampleMode,
  documentUrl,
} from "./api";
import { Upload as TusUpload } from "tus-js-client";
import type {
  Assessment,
  Candidate,
  DocumentRecord,
  Fact,
  Job,
  Json,
  Project,
} from "./types";
const ParcelMap = lazy(() => import("./ParcelMap"));
const WorkflowGraph = lazy(() => import("./WorkflowGraph"));
const tabs = [
  "Overview",
  "Records",
  "Site envelope",
  "Workflow",
  "Activity",
] as const;
type Tab = (typeof tabs)[number];
function human(v: any) {
  return typeof v === "string"
    ? v.replaceAll("_", " ")
    : v == null
      ? "Unknown"
      : JSON.stringify(v);
}
function labelJurisdiction(s: string) {
  return /poulsbo/i.test(s)
    ? "City of Poulsbo"
    : /kitsap|county|unincorporated/i.test(s)
      ? "Unincorporated Kitsap"
      : "Jurisdiction to confirm";
}
function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function Empty({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="empty">
      <FolderOpen size={28} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export default function App() {
  const [config, setConfig] = useState<Json | null>(null),
    [entered, setEntered] = useState(false),
    [sample, setSample] = useState(false),
    [email, setEmail] = useState(""),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  const [projects, setProjects] = useState<Project[]>([]),
    [project, setProject] = useState<Project | null>(null),
    [tab, setTab] = useState<Tab>("Overview"),
    [newOpen, setNewOpen] = useState(false),
    [projectLoading, setProjectLoading] = useState(false),
    [loadingProjectName, setLoadingProjectName] = useState("your workspace");
  const [candidates, setCandidates] = useState<Candidate[]>([]),
    [coverage, setCoverage] = useState<Json[]>([]),
    [documents, setDocuments] = useState<DocumentRecord[]>([]),
    [facts, setFacts] = useState<Fact[]>([]),
    [assessment, setAssessment] = useState<Assessment | null>(null),
    [comments, setComments] = useState<Json[]>([]),
    [jobs, setJobs] = useState<Job[]>([]),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [comment, setComment] = useState("");
  const [editIntent, setEditIntent] = useState(false),
    [bedrooms, setBedrooms] = useState(3),
    [viewDoc, setViewDoc] = useState<{ title: string; url: string } | null>(
      null,
    ),
    [geometryOpen, setGeometryOpen] = useState(false),
    [editingFact, setEditingFact] = useState<Fact | null>(null);
  useEffect(() => {
    let active = true;
    let cleanup = () => {};
    configure().then(async (c) => {
      if (!active) return;
      setConfig(c);
      const auth = getAuth();
      if (auth) {
        let openedUser: string | null = null;
        const openSession = (session: { user: { id: string } } | null) => {
          if (!active || !session || openedUser === session.user.id) return;
          openedUser = session.user.id;
          setEntered(true);
          setProjectLoading(true);
          setTimeout(() => {
            if (active) void run("Opening workspace", loadProjects);
          }, 0);
        };
        const { data } = auth.auth.onAuthStateChange((event, session) => {
          if (event === "SIGNED_OUT") {
            openedUser = null;
            return;
          }
          openSession(session);
        });
        cleanup = () => data.subscription.unsubscribe();
        const session = await auth.auth.getSession();
        openSession(session.data.session);
      }
    });
    return () => {
      active = false;
      cleanup();
    };
  }, []);
  useEffect(() => {
    if (!newOpen && !editIntent && !viewDoc && !geometryOpen && !editingFact)
      return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea, select, a[href], [tabindex="0"]',
        ) || [],
      );
    focusable()[0]?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNewOpen(false);
        setEditIntent(false);
        setGeometryOpen(false);
        setEditingFact(null);
        setViewDoc(null);
      }
      if (event.key === "Tab") {
        const controls = focusable(),
          first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      previous?.focus();
    };
  }, [newOpen, editIntent, viewDoc, geometryOpen, editingFact]);
  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }
  async function loadProjects() {
    setProjectLoading(true);
    setLoadingProjectName("your workspace");
    try {
      const r = await request<{ projects: Project[] }>("/projects");
      setProjects(r.projects);
      if (r.projects.length) await loadProject(r.projects[0]);
    } finally {
      setProjectLoading(false);
    }
  }
  async function loadProject(p: Project) {
    setProjectLoading(true);
    setLoadingProjectName(p.name);
    setSelected(new Set());
    try {
      const base = `/projects/${p.id}`;
      const [c, d, f, a, m] = await Promise.all([
        request(base + "/candidates"),
        request(base + "/documents"),
        request(base + "/review"),
        request(base + "/assessment"),
        request(base + "/comments"),
      ]);
      setCandidates(c.candidates || []);
      setCoverage(c.coverage || []);
      setDocuments(d.documents || []);
      setFacts(f.facts || []);
      setAssessment(a);
      setComments(m.comments || []);
      setProject(p);
    } finally {
      setProjectLoading(false);
    }
  }
  function enterDemo() {
    setSampleMode(true);
    setSample(true);
    setEntered(true);
    run("Opening sample", loadProjects);
  }
  function enterLocal() {
    setSampleMode(false);
    setSample(false);
    setEntered(true);
    run("Opening workspace", loadProjects);
  }
  async function signin(e: FormEvent) {
    e.preventDefault();
    if (!config?.email_delivery_enabled) {
      setNotice(
        "Beta access is provided by the project owner through a one-time invitation link. Email link requests are not enabled yet.",
      );
      return;
    }
    await run("Sending sign-in link", async () => {
      const auth = getAuth();
      if (!auth)
        throw Error(
          "The live workspace is not connected yet. You can explore the clearly labeled sample.",
        );
      const { error } = await auth.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: window.location.origin,
        },
      });
      if (error) throw error;
      setNotice(
        "Check your email for a secure sign-in link. Beta access is by invitation.",
      );
    });
  }
  async function poll(p: Project, queued: Job[]) {
    setJobs(queued);
    for (let attempt = 0; attempt < 180; attempt++) {
      const current = await Promise.all(
        queued.map((j) => request<Job>("/jobs/" + j.id)),
      );
      setJobs(current);
      if (
        current.every((j) =>
          ["completed", "failed", "cancelled", "manual_access"].includes(
            j.status,
          ),
        )
      ) {
        await loadProject(await request("/projects/" + p.id));
        return;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    setNotice(
      "Processing continues in the background. Refresh this project to see the latest results.",
    );
  }
  async function discover() {
    if (!project) return;
    await run("Searching public records", async () => {
      const j = await request<Job>(
        `/projects/${project.id}/discover`,
        "POST",
        {},
      );
      setTab("Records");
      await poll(project, [j]);
    });
  }
  async function importSelected() {
    if (!project || !selected.size) return;
    await run("Importing selected records", async () => {
      const r = await request(
        ` /projects/${project.id}/imports`.trim(),
        "POST",
        { candidate_ids: [...selected], idempotency_key: crypto.randomUUID() },
      );
      setSelected(new Set());
      await poll(project, r.jobs || []);
    });
  }
  async function reviewFact(f: Fact, status: string) {
    if (!project) return;
    await run("Saving evidence review", async () => {
      const p = await request(`/projects/${project.id}/revisions`, "POST", {
        expected_revision: project.current_revision,
        facts: [{ id: f.id, value: f.value, review_status: status }],
        notes: `${status}: ${f.key || f.name}`,
      });
      await loadProject(p);
    });
  }
  async function upload(file: File) {
    if (!project) return;
    await run("Uploading document", async () => {
      if (sample)
        throw Error(
          "Sample mode does not store real files. Connect the workspace to upload.",
        );
      const maxBytes = Number(config?.max_pdf_bytes) || 250 * 1024 * 1024;
      if (file.size > maxBytes)
        throw Error(
          `This workspace supports PDFs up to ${Math.floor(maxBytes / (1024 * 1024))} MiB.`,
        );
      if (!file.name.toLowerCase().endsWith(".pdf"))
        throw Error("Choose a PDF document.");
      if (config?.mode === "supabase") {
        const session = await getAuth()?.auth.getSession();
        const token = session?.data.session?.access_token;
        if (!token) throw Error("Sign in again to upload.");
        const uploadKey = `davapprove-upload:${session!.data.session!.user.id}:${project.id}:${file.name}:${file.size}:${file.lastModified}`;
        const saved = localStorage.getItem(uploadKey);
        const init = saved
          ? JSON.parse(saved)
          : await request(`/projects/${project.id}/upload-init`, "POST", {
              filename: file.name,
              size: file.size,
            });
        localStorage.setItem(uploadKey, JSON.stringify(init));
        await new Promise<void>((resolve, reject) => {
          const task = new TusUpload(file, {
            endpoint: init.resumable_endpoint,
            fingerprint: async () => uploadKey,
            headers: { Authorization: `Bearer ${token}` },
            metadata: {
              bucketName: init.bucket,
              objectName: init.path,
              contentType: "application/pdf",
              cacheControl: "3600",
            },
            chunkSize: 6 * 1024 * 1024,
            retryDelays: [0, 3000, 5000, 10000],
            uploadDataDuringCreation: true,
            removeFingerprintOnSuccess: true,
            onProgress: (sent, total) =>
              setBusy(`Uploading PDF · ${Math.round((sent / total) * 100)}%`),
            onError: reject,
            onSuccess: () => resolve(),
          });
          task
            .findPreviousUploads()
            .then((prior) => {
              if (prior.length) task.resumeFromPreviousUpload(prior[0]);
              task.start();
            })
            .catch(reject);
        });
        await request(`/projects/${project.id}/upload-complete`, "POST", {
          id: init.id,
          filename: file.name,
        });
        localStorage.removeItem(uploadKey);
      } else {
        const form = new FormData();
        form.append("file", file);
        await request(`/projects/${project.id}/uploads`, "POST", form);
      }
      await loadProject(project);
      setNotice(
        "Document uploaded. Processing status will appear in your records.",
      );
    });
  }
  async function openDocument(d: DocumentRecord) {
    await run("Opening private document", async () => {
      if (sample)
        throw Error(
          "This is a synthetic sample record; no real PDF is attached.",
        );
      const url = await documentUrl(project!.id, d.id);
      setViewDoc({ title: d.title || d.filename || "Document", url });
    });
  }
  const loading = (
    <div className="loading">
      <LoaderCircle className="spin" /> Loading view…
    </div>
  );
  const activeJobs = jobs.filter(
    (j) =>
      !["completed", "failed", "cancelled", "manual_access"].includes(j.status),
  );
  const importable = candidates.filter(
    (c) =>
      (c.document_url || c.access === "automated") &&
      c.access_method !== "manual",
  );
  const knownBytes = candidates
    .filter((c) => selected.has(c.id))
    .reduce((n, c) => n + (c.size_bytes || 0), 0);
  const unreviewed = facts.filter(
    (f) => f.review_status !== "accepted" && f.review_status !== "rejected",
  );
  if (!entered)
    return (
      <div className="welcome">
        <div className="welcome-art">
          <Brand />
          <div className="contours" />
          <div className="welcome-copy">
            <span className="eyebrow">
              A clearer path from parcel to project
            </span>
            <h1>
              Understand your site.
              <br />
              Plan your next move.
            </h1>
            <p>
              Bring property records, site constraints and permitting
              dependencies into one considered workspace.
            </p>
            <div className="welcome-features">
              <span>
                <Layers size={18} /> Evidence, in context
              </span>
              <span>
                <GitBranch size={18} /> A connected workflow
              </span>
            </div>
          </div>
          <div className="welcome-bottom">
            KITSAP COUNTY + POULSBO <span>RESIDENTIAL PILOT</span>
          </div>
        </div>
        <div className="welcome-form">
          <Badge tone="green">Private beta</Badge>
          <h2>
            Welcome to your
            <br />
            project workspace.
          </h2>
          <p>
            Beta invitations are supplied by the project owner. Open your
            one-time invitation link to access your workspace.
          </p>
          <form onSubmit={signin}>
            <label>
              Email address
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@yourstudio.com"
              />
            </label>
            <button
              className="primary full"
              disabled={
                !!busy ||
                !config?.authAvailable ||
                !config?.email_delivery_enabled
              }
            >
              {busy || "Send sign-in link"}
              <ArrowRight size={17} />
            </button>
          </form>
          {notice && <p className="notice">{notice}</p>}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {config && !config.authAvailable && (
            <p className="small muted">
              Live sign-in is awaiting the connected deployment.
            </p>
          )}
          {config?.authAvailable && !config.email_delivery_enabled && (
            <p className="small muted">
              Email delivery is not enabled yet. Ask the project owner for a
              one-time sign-in link; existing invitation links still work.
            </p>
          )}
          <div className="or">
            <span />
            or explore first
            <span />
          </div>
          <button className="secondary full" onClick={enterDemo}>
            Explore the sample project
            <ArrowUpRight size={17} />
          </button>
          <p className="small muted">
            A clearly labeled, interactive example. No real property assessment.
          </p>
          {config?.mode === "demo" && (
            <button className="text-button" onClick={enterLocal}>
              Open local development workspace →
            </button>
          )}
          <div className="privacy">
            <ShieldCheck size={17} /> Project documents stay private to your
            team.
          </div>
        </div>
      </div>
    );
  return (
    <div className="app">
      <aside className="sidebar">
        <Brand />
        <div className="workspace-name">
          <span className="avatar">D</span>
          <div>
            Project workspace
            <small>{sample ? "Sample studio" : "Your studio"}</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <div className="sidebar-label">WORKSPACE</div>
        <button className="nav-item active" onClick={() => setTab("Overview")}>
          <FolderOpen size={18} />
          Projects<span>{projects.length}</span>
        </button>
        <button className="nav-item" onClick={() => setNewOpen(true)}>
          <Plus size={18} />
          New project
        </button>
        <div className="sidebar-label project-label">YOUR PROJECTS</div>
        {projects.map((p) => (
          <button
            key={p.id}
            className={`project-nav ${project?.id === p.id ? "selected" : ""}`}
            disabled={!!busy}
            onClick={() => run("Loading project", () => loadProject(p))}
          >
            <span className="project-dot" />
            <span>
              {p.name}
              <small>{labelJurisdiction(p.jurisdiction)}</small>
            </span>
          </button>
        ))}
        <div className="sidebar-footer">
          <div className="pilot-label">
            <Leaf size={16} />
            <span>
              Built for a better
              <br />
              starting point.
            </span>
          </div>
          <button
            className="nav-item"
            onClick={async () => {
              if (!sample) await getAuth()?.auth.signOut();
              setEntered(false);
              setSampleMode(false);
              setSample(false);
            }}
          >
            <LogOut size={16} />
            Leave workspace
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div>
            <span className="muted">Workspace</span>
            <ChevronRight size={14} />
            <span>{project?.name || "Projects"}</span>
          </div>
          <div>
            <Badge tone={sample ? "amber" : "green"}>
              {sample
                ? "SAMPLE · SYNTHETIC DATA"
                : config?.mode === "demo"
                  ? "LOCAL DEVELOPMENT"
                  : "PRIVATE BETA"}
            </Badge>
            <span className="user-avatar">{sample ? "DS" : "You"}</span>
          </div>
        </header>
        {sample && (
          <div className="sample-strip">
            You’re exploring an illustrative project. Records, geometry and
            results are synthetic; changes stay in this browser.
          </div>
        )}
        <main className="content">
          {error && (
            <div role="alert" className="alert error">
              <AlertCircle size={18} />
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="alert notice">
              <CheckCircle2 size={18} />
              {notice}
              <button
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {projectLoading ? (
            <section
              className="project-loading panel"
              role="status"
              aria-live="polite"
              aria-busy="true"
            >
              <span className="loading-symbol">
                <LoaderCircle className="spin" size={24} />
              </span>
              <span className="eyebrow">OPENING PROJECT WORKSPACE</span>
              <h2>Loading {loadingProjectName}.</h2>
              <p>
                Gathering your records, evidence reviews and current assessment.
                Counts and results will appear together when ready.
              </p>
              <div className="loading-skeleton" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
            </section>
          ) : project ? (
            <>
              <div className="project-heading">
                <div>
                  <div className="eyebrow">
                    <MapPin size={14} />
                    {labelJurisdiction(project.jurisdiction)}
                  </div>
                  <h1>{project.name}</h1>
                  <div className="project-meta">
                    <span>Parcel {project.parcel_number}</span>
                    <i />{" "}
                    <span>
                      {human(project.intent?.project_type || "Residential")}
                    </span>
                    <i />
                    <span>Revision {project.current_revision}</span>
                  </div>
                </div>
                <div className="heading-actions">
                  <button className="secondary" onClick={() => window.print()}>
                    <Printer size={16} />
                    Briefing
                  </button>
                  <button
                    className="primary"
                    disabled={!!busy}
                    onClick={discover}
                  >
                    {busy ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <Search size={16} />
                    )}
                    Find records
                  </button>
                </div>
              </div>
              <div className="tabs" role="tablist" aria-label="Project views">
                {tabs.map((t) => (
                  <button
                    role="tab"
                    aria-selected={tab === t}
                    className={tab === t ? "active" : ""}
                    onClick={() => setTab(t)}
                    key={t}
                  >
                    {t}
                    {t === "Records" && documents.length > 0 && (
                      <span>{documents.length}</span>
                    )}
                  </button>
                ))}
                <button
                  className="refresh"
                  aria-label="Refresh project"
                  disabled={!!busy}
                  onClick={() => run("Refreshing", () => loadProject(project))}
                >
                  <RefreshCw size={15} />
                </button>
              </div>
              {activeJobs.length > 0 && (
                <div className="job-progress">
                  <LoaderCircle className="spin" size={16} />
                  {busy || "Processing"}
                  <span>
                    {activeJobs
                      .map((j) => human(j.stage || j.status))
                      .join(" · ")}
                  </span>
                  {!sample && (
                    <button
                      className="text-button"
                      onClick={() =>
                        Promise.all(
                          activeJobs.map((j) =>
                            request("/jobs/" + j.id + "/cancel", "POST", {}),
                          ),
                        ).catch((e) => setError(e.message))
                      }
                    >
                      Cancel
                    </button>
                  )}
                </div>
              )}
              {jobs
                .filter((j) => ["failed", "manual_access"].includes(j.status))
                .map((j) => (
                  <div className="alert error" key={j.id}>
                    <AlertCircle size={17} />
                    <span>{human(j.error || j.stage || j.status)}</span>
                    {!sample && (
                      <button
                        className="text-button"
                        disabled={!!busy}
                        onClick={() =>
                          run("Retrying", async () => {
                            const next = await request(
                              "/jobs/" + j.id + "/retry",
                              "POST",
                              {},
                            );
                            await poll(project, [next]);
                          })
                        }
                      >
                        Retry
                      </button>
                    )}
                  </div>
                ))}
              {tab === "Overview" && (
                <>
                  <div className="summary-cards">
                    <div>
                      <span className="stat-icon">
                        <FileText size={19} />
                      </span>
                      <p>
                        Project evidence
                        <strong>
                          {documents.length}
                          <small>documents imported</small>
                        </strong>
                      </p>
                    </div>
                    <div>
                      <span className="stat-icon amber-icon">
                        <Clock size={19} />
                      </span>
                      <p>
                        Needs your attention
                        <strong>
                          {unreviewed.length}
                          <small>facts to review</small>
                        </strong>
                      </p>
                    </div>
                    <div>
                      <span className="stat-icon">
                        <GitBranch size={19} />
                      </span>
                      <p>
                        Next steps
                        <strong>
                          {assessment?.actions?.length || 0}
                          <small>coordination actions</small>
                        </strong>
                      </p>
                    </div>
                  </div>
                  <div className="overview-grid">
                    <section className="panel site-panel">
                      <div className="panel-heading">
                        <div>
                          <span className="eyebrow">YOUR SITE AT A GLANCE</span>
                          <h2>A place to start designing.</h2>
                        </div>
                        <button
                          className="text-button"
                          onClick={() => setTab("Site envelope")}
                        >
                          Explore site
                          <ArrowUpRight size={16} />
                        </button>
                      </div>
                      <Suspense fallback={loading}>
                        <ParcelMap
                          parcel={project.parcel}
                          envelope={assessment?.envelope}
                          sample={sample}
                        />
                      </Suspense>
                      <div className="site-status">
                        <span className="status-dot amber-dot" />
                        <div>
                          <strong>
                            {human(
                              assessment?.envelope?.status ||
                                "Cannot determine",
                            )}
                          </strong>
                          <p>
                            {assessment?.envelope?.reason ||
                              "Gather and review site evidence before relying on an envelope."}
                          </p>
                        </div>
                      </div>
                    </section>
                    <section className="panel next-panel">
                      <div className="panel-heading">
                        <div>
                          <span className="eyebrow">THE PATH AHEAD</span>
                          <h2>What to resolve next</h2>
                        </div>
                        <Compass size={22} />
                      </div>
                      <Actions
                        items={(assessment?.actions || []).slice(0, 3)}
                      />
                      <button
                        className="text-button bottom-link"
                        onClick={() => setTab("Workflow")}
                      >
                        See the connected workflow
                        <ArrowRight size={16} />
                      </button>
                    </section>
                  </div>
                  <div className="bottom-grid">
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>Project intent</h2>
                        <button
                          className="text-button"
                          onClick={() => {
                            setBedrooms(project.intent.bedrooms || 3);
                            setEditIntent(true);
                          }}
                        >
                          <SlidersHorizontal size={15} />
                          Edit
                        </button>
                      </div>
                      <dl className="intent-grid">
                        <div>
                          <dt>Project type</dt>
                          <dd>{human(project.intent.project_type)}</dd>
                        </div>
                        <div>
                          <dt>Bedrooms</dt>
                          <dd>{project.intent.bedrooms ?? "Unknown"}</dd>
                        </div>
                        <div>
                          <dt>Dwelling units</dt>
                          <dd>{project.intent.units ?? "Unknown"}</dd>
                        </div>
                        <div>
                          <dt>Wastewater</dt>
                          <dd>
                            {human(project.intent.wastewater || "unknown")}
                          </dd>
                        </div>
                      </dl>
                      <p className="small muted">
                        Changes create a new revision and identify work that
                        needs another look.
                      </p>
                    </section>
                    <section className="panel research-prompt">
                      <div className="round-icon">
                        <Search size={22} />
                      </div>
                      <div>
                        <h2>Your records. Your scope.</h2>
                        <p>
                          Discover what’s available, then choose which documents
                          to bring into the project.
                        </p>
                        <button
                          className="text-button"
                          onClick={discover}
                          disabled={!!busy}
                        >
                          Discover existing records
                          <ArrowRight size={16} />
                        </button>
                      </div>
                    </section>
                  </div>
                </>
              )}
              {tab === "Records" && (
                <>
                  <div className="section-heading">
                    <div>
                      <h2>Build your project’s evidence.</h2>
                      <p>
                        Find the records that matter. Import only what you
                        choose.
                      </p>
                    </div>
                    <label className="secondary upload">
                      <Upload size={16} />
                      Upload PDF ·{" "}
                      {Math.floor(
                        (Number(config?.max_pdf_bytes) || 250 * 1024 * 1024) /
                          (1024 * 1024),
                      )}{" "}
                      MiB max
                      <input
                        type="file"
                        accept="application/pdf"
                        onChange={(e) =>
                          e.target.files?.[0] && upload(e.target.files[0])
                        }
                      />
                    </label>
                  </div>
                  <div className="record-layout">
                    <div>
                      <section className="panel">
                        <div className="panel-heading">
                          <h2>
                            Discovered records{" "}
                            <span className="count">{candidates.length}</span>
                          </h2>
                          <button
                            className="text-button"
                            disabled={!importable.length}
                            onClick={() =>
                              setSelected(
                                selected.size === importable.length
                                  ? new Set()
                                  : new Set(importable.map((c) => c.id)),
                              )
                            }
                          >
                            {selected.size === importable.length &&
                            importable.length
                              ? "Clear selection"
                              : "Select all available"}
                          </button>
                        </div>
                        {!candidates.length ? (
                          <Empty title="Start with a record search">
                            Find existing information across public sources. No
                            documents are imported until you select them.
                            <button
                              className="primary"
                              onClick={discover}
                              disabled={!!busy}
                            >
                              <Search size={16} />
                              Find records
                            </button>
                          </Empty>
                        ) : (
                          candidates.map((c) => (
                            <div
                              className={`record-row ${selected.has(c.id) ? "checked" : ""}`}
                              key={c.id}
                            >
                              <input
                                type="checkbox"
                                aria-label={`Select ${c.title}`}
                                disabled={
                                  (!c.document_url &&
                                    c.access !== "automated") ||
                                  c.access_method === "manual"
                                }
                                checked={selected.has(c.id)}
                                onChange={(e) =>
                                  setSelected((prev) => {
                                    const next = new Set(prev);
                                    if (e.target.checked) next.add(c.id);
                                    else next.delete(c.id);
                                    return next;
                                  })
                                }
                              />
                              <span className="file-icon">
                                <FileText size={21} />
                              </span>
                              <div className="record-info">
                                <strong>{c.title}</strong>
                                <div>
                                  {c.source} · {c.record_date || "Date unknown"}
                                </div>
                                <p>
                                  {c.match_reason ||
                                    "Parcel association needs review"}
                                </p>
                                <Badge
                                  tone={
                                    c.access_method === "manual"
                                      ? "amber"
                                      : "neutral"
                                  }
                                >
                                  {human(
                                    c.status || c.access_method || "candidate",
                                  )}
                                </Badge>
                              </div>
                              {safeUrl(c.url) && (
                                <a
                                  className="icon-button"
                                  href={safeUrl(c.url)}
                                  target="_blank"
                                  rel="noreferrer"
                                  aria-label={`Open source for ${c.title}`}
                                >
                                  <ExternalLink size={16} />
                                </a>
                              )}
                            </div>
                          ))
                        )}
                        {candidates.length > 0 && (
                          <div className="import-bar">
                            <div>
                              <strong>{selected.size} selected</strong>
                              <small>
                                {(knownBytes / 1000000).toFixed(1)} MB known ·{" "}
                                {
                                  candidates.filter(
                                    (c) => selected.has(c.id) && !c.size_bytes,
                                  ).length
                                }{" "}
                                size unknown
                              </small>
                            </div>
                            <button
                              className="primary"
                              disabled={!selected.size || !!busy}
                              onClick={importSelected}
                            >
                              Import selected
                              <ArrowRight size={16} />
                            </button>
                          </div>
                        )}
                      </section>
                      <section className="panel imported-panel">
                        <div className="panel-heading">
                          <h2>Project documents</h2>
                          <Badge>{documents.length} imported</Badge>
                        </div>
                        {!documents.length ? (
                          <p className="muted pad">
                            Selected imports and uploaded PDFs will appear here.
                          </p>
                        ) : (
                          documents.map((d) => (
                            <button
                              key={d.id}
                              className="document-row"
                              onClick={() => openDocument(d)}
                            >
                              <FileText size={19} />
                              <span>
                                <strong>{d.title || d.filename}</strong>
                                <small>
                                  {human(d.status || "imported")} ·{" "}
                                  {d.page_count || "?"} pages
                                </small>
                              </span>
                              <ArrowUpRight size={16} />
                            </button>
                          ))
                        )}
                      </section>
                    </div>
                    <aside className="records-aside">
                      <section className="panel">
                        <div className="panel-heading">
                          <h2>Source coverage</h2>
                          <Layers size={18} />
                        </div>
                        {coverage.length ? (
                          coverage.map((c, i) => (
                            <div className="coverage-item" key={i}>
                              <span className="status-dot amber-dot" />
                              <div>
                                <strong>{human(c.source || c.name)}</strong>
                                <small>{human(c.status)}</small>
                                <p>
                                  {c.detail ||
                                    c.message ||
                                    c.reason ||
                                    "Results reflect this source and query only."}
                                </p>
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="muted pad">
                            Run discovery to see which sources were searched and
                            where assisted research is needed.
                          </p>
                        )}
                        <p className="coverage-note">
                          No results does not mean no requirements. Unselected
                          records remain gaps in your project evidence.
                        </p>
                      </section>
                      <section className="panel">
                        <div className="panel-heading">
                          <h2>Evidence review</h2>
                          <Badge tone="amber">
                            {unreviewed.length} pending
                          </Badge>
                        </div>
                        {!facts.length ? (
                          <p className="muted pad">
                            Extracted facts appear after documents are imported
                            and processed.
                          </p>
                        ) : (
                          facts.map((f) => (
                            <div className="fact" key={f.id}>
                              <strong>
                                {human(f.key || f.name || "Extracted fact")}
                              </strong>
                              <div className="fact-value">{human(f.value)}</div>
                              <p>
                                {f.source_quote ||
                                  f.quote ||
                                  "Verify against the original document."}
                              </p>
                              <small>
                                Page {f.page || f.page_number || "?"} ·{" "}
                                {human(f.review_status || "proposed")}
                              </small>
                              {!["accepted", "rejected"].includes(
                                f.review_status || "",
                              ) && (
                                <div className="fact-actions">
                                  <button
                                    className="secondary"
                                    disabled={!!busy}
                                    onClick={() => reviewFact(f, "accepted")}
                                  >
                                    <Check size={14} />
                                    Accept
                                  </button>
                                  <button
                                    className="text-button"
                                    disabled={!!busy}
                                    onClick={() => setEditingFact(f)}
                                  >
                                    Correct
                                  </button>
                                  <button
                                    className="text-button"
                                    disabled={!!busy}
                                    onClick={() => reviewFact(f, "rejected")}
                                  >
                                    Reject
                                  </button>
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </section>
                    </aside>
                  </div>
                </>
              )}
              {tab === "Site envelope" && (
                <>
                  <div className="section-heading">
                    <div>
                      <h2>Understand the opportunity. See the unknowns.</h2>
                      <p>
                        Preliminary screening for the current revision—not a
                        determination of buildability.
                      </p>
                    </div>
                    <Badge tone="amber">
                      {human(
                        assessment?.envelope?.status || "Cannot determine",
                      )}
                    </Badge>
                  </div>
                  <div className="envelope-layout">
                    <section className="panel large-map">
                      <Suspense fallback={loading}>
                        <ParcelMap
                          parcel={project.parcel}
                          envelope={assessment?.envelope}
                          sample={sample}
                        />
                      </Suspense>
                    </section>
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>What the map can tell you</h2>
                      </div>
                      <p className="pad">
                        {assessment?.envelope?.reason ||
                          "A reliable envelope requires reviewed boundaries, setbacks and constraint geometry."}
                      </p>
                      <button
                        className="secondary geometry-button"
                        onClick={() => setGeometryOpen(true)}
                      >
                        <Plus size={15} />
                        Add reviewed geometry
                      </button>
                      <div className="legend">
                        <span>
                          <i className="boundary" />
                          Parcel boundary · GIS screening
                        </span>
                        <span>
                          <i className="envelope-key" />
                          Reviewed exclusions / preliminary remainder
                        </span>
                      </div>
                      <h3 className="pad">Unresolved evidence</h3>
                      {[
                        ...(assessment?.envelope?.gaps || []),
                        ...(assessment?.coverage_gaps || []),
                      ].map((g, i) => (
                        <div className="gap" key={i}>
                          <AlertCircle size={16} />
                          <span>
                            {typeof g === "string" ? g : g.reason || g.title}
                          </span>
                        </div>
                      ))}
                      <div className="coverage-note">
                        Missing geometry is not assumed clear. Front, rear and
                        side lot lines require confirmation before applying
                        setbacks.
                      </div>
                    </section>
                  </div>
                </>
              )}
              {tab === "Workflow" && (
                <>
                  <div className="section-heading">
                    <div>
                      <h2>A connected plan of action.</h2>
                      <p>
                        Evidence informs design. Legal prerequisites and
                        coordination recommendations remain distinct.
                      </p>
                    </div>
                    <Badge>Revision {project.current_revision}</Badge>
                  </div>
                  <div className="workflow-layout">
                    <section className="panel">
                      {assessment && (
                        <Suspense fallback={loading}>
                          <WorkflowGraph assessment={assessment} />
                        </Suspense>
                      )}
                      <div className="coverage-note">
                        This graph supports feasibility and coordination. It
                        does not authorize construction.
                      </div>
                    </section>
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>Next actions</h2>
                      </div>
                      <Actions items={assessment?.actions || []} />
                    </section>
                  </div>
                  <section className="panel node-list">
                    {assessment?.nodes.map((n) => (
                      <div key={n.id}>
                        <span className="node-id">{n.id}</span>
                        <div>
                          <strong>{n.title || n.label}</strong>
                          <p>{n.reason || n.description}</p>
                        </div>
                        <Badge
                          tone={
                            /unknown|blocked|review/.test(n.state || n.status)
                              ? "amber"
                              : "neutral"
                          }
                        >
                          {human(n.state || n.status || "unknown")}
                        </Badge>
                      </div>
                    ))}
                  </section>
                </>
              )}
              {tab === "Activity" && (
                <div className="activity-layout">
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>Project conversation</h2>
                      <MessageSquare size={19} />
                    </div>
                    <form
                      className="comment-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        run("Posting comment", async () => {
                          await request(
                            `/projects/${project.id}/comments`,
                            "POST",
                            {
                              body: comment,
                              revision: project.current_revision,
                            },
                          );
                          setComment("");
                          await loadProject(project);
                        });
                      }}
                    >
                      <label htmlFor="comment">Add context for your team</label>
                      <textarea
                        id="comment"
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder="A question, a design decision, or something to verify…"
                        required
                      />
                      <div>
                        <small>
                          Attached to revision {project.current_revision}
                        </small>
                        <button
                          className="primary"
                          disabled={!comment.trim() || !!busy}
                        >
                          Post comment
                          <ArrowRight size={16} />
                        </button>
                      </div>
                    </form>
                    {comments.length ? (
                      comments.map((c) => (
                        <div className="comment" key={c.id}>
                          <span className="user-avatar">
                            {sample ? "DS" : "•"}
                          </span>
                          <div>
                            <strong>
                              {c.author || "Project member"}{" "}
                              <small>· Revision {c.revision || 1}</small>
                            </strong>
                            <p>{c.body}</p>
                            <small>
                              {new Date(c.created_at).toLocaleString()}
                            </small>
                          </div>
                        </div>
                      ))
                    ) : (
                      <Empty title="Make the work easier to follow">
                        Keep questions and decisions alongside the revision they
                        refer to.
                      </Empty>
                    )}
                  </section>
                  <section className="panel">
                    <div className="panel-heading">
                      <h2>Current revision</h2>
                      <GitBranch size={18} />
                    </div>
                    <div className="revision-card">
                      <span>R{project.current_revision}</span>
                      <h3>A shared starting point.</h3>
                      <p>
                        Accepted inputs and design changes are recorded as
                        revisions. Historical documents and agency decisions
                        stay intact.
                      </p>
                    </div>
                  </section>
                </div>
              )}
            </>
          ) : (
            <div className="no-project">
              <Compass size={44} />
              <h1>
                Every good project starts
                <br />
                with understanding the site.
              </h1>
              <p>
                Create a project to begin researching a parcel in Kitsap County
                or Poulsbo.
              </p>
              <button className="primary" onClick={() => setNewOpen(true)}>
                <Plus size={16} />
                Start a project
              </button>
            </div>
          )}
          <footer className="content-footer">
            <span>DAVAPPROVE · RESEARCH & COORDINATION</span>
            <span>Evidence first. Decisions with context.</span>
          </footer>
        </main>
      </div>
      {newOpen && (
        <NewProject
          onClose={() => setNewOpen(false)}
          sample={sample}
          onCreated={async (p) => {
            setNewOpen(false);
            setProjects((prev) => [p, ...prev]);
            await loadProject(p);
            setTab("Overview");
          }}
        />
      )}
      {editIntent && project && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-title"
          >
            <button
              className="close"
              aria-label="Close"
              onClick={() => setEditIntent(false)}
            >
              <X />
            </button>
            <span className="eyebrow">DESIGN REVISION</span>
            <h2 id="edit-title">Adjust the project intent.</h2>
            <p>
              A bedroom change can affect wastewater capacity and related design
              work. Prior approvals are preserved.
            </p>
            <label>
              Proposed bedrooms
              <input
                type="number"
                min="0"
                max="30"
                value={bedrooms}
                onChange={(e) => setBedrooms(Number(e.target.value))}
              />
            </label>
            <button
              className="primary full"
              disabled={!!busy}
              onClick={() =>
                run("Saving revision", async () => {
                  const p = await request(
                    `/projects/${project.id}/revisions`,
                    "POST",
                    {
                      expected_revision: project.current_revision,
                      intent: { ...project.intent, bedrooms },
                      notes: "Updated proposed bedroom count",
                    },
                  );
                  await loadProject(p);
                  setEditIntent(false);
                  setNotice(
                    "New revision saved. Review the workflow for affected work.",
                  );
                })
              }
            >
              Save new revision
              <ArrowRight size={16} />
            </button>
          </section>
        </div>
      )}
      {editingFact && (
        <FactEditor
          fact={editingFact}
          onClose={() => setEditingFact(null)}
          onSave={async (f) => {
            await reviewFact(f, "accepted");
            setEditingFact(null);
          }}
        />
      )}
      {geometryOpen && project && (
        <GeometryEditor
          project={project}
          onClose={() => setGeometryOpen(false)}
          onSaved={async (p) => {
            await loadProject(p);
            setGeometryOpen(false);
            setNotice(
              "Reviewed geometry saved in a new revision. The envelope remains preliminary.",
            );
          }}
        />
      )}
      {viewDoc && (
        <div className="modal-backdrop">
          <section
            className="modal document-modal"
            role="dialog"
            aria-modal="true"
            aria-label={viewDoc.title}
          >
            <button
              className="close"
              aria-label="Close document"
              onClick={() => {
                if (viewDoc.url.startsWith("blob:"))
                  URL.revokeObjectURL(viewDoc.url);
                setViewDoc(null);
              }}
            >
              <X />
            </button>
            <h2>{viewDoc.title}</h2>
            <a href={viewDoc.url} target="_blank" rel="noreferrer">
              Open original PDF ↗
            </a>
            <iframe
              title={viewDoc.title}
              src={viewDoc.url}
              sandbox="allow-same-origin"
            />
          </section>
        </div>
      )}
    </div>
  );
}
function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Layers size={21} />
      </span>
      davapprove<span className="brand-period">.</span>
    </div>
  );
}
function Actions({ items }: { items: Json[] }) {
  return items.length ? (
    <div className="actions-list">
      {items.map((a, i) => (
        <div className="action-item" key={a.id || i}>
          <span className="action-number">
            {String(i + 1).padStart(2, "0")}
          </span>
          <div>
            <h3>{a.title || a.action || a.node_id}</h3>
            <p>{a.reason || a.description}</p>
            <div className="action-owner">
              {a.owner || a.discipline || "Project team"}
              <span>· {human(a.kind || a.type || "Review")}</span>
            </div>
            {safeUrl(a.source_url) && (
              <a href={safeUrl(a.source_url)} target="_blank" rel="noreferrer">
                View requirement ↗
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  ) : (
    <Empty title="Your next steps will appear here">
      Add parcel information and reviewed evidence to begin the workflow.
    </Empty>
  );
}
function NewProject({
  onClose,
  onCreated,
  sample,
}: {
  onClose: () => void;
  onCreated: (p: Project) => Promise<void>;
  sample: boolean;
}) {
  const [number, setNumber] = useState(""),
    [name, setName] = useState(""),
    [type, setType] = useState("new_house"),
    [bedrooms, setBedrooms] = useState("3"),
    [parcel, setParcel] = useState<Json | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function lookup(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setParcel(
        await request("/parcels/lookup", "POST", { parcel_number: number }),
      );
      if (!name) setName("New residential project");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    setBusy(true);
    setError("");
    try {
      await onCreated(
        await request("/projects", "POST", {
          name,
          parcel_number: number,
          parcel,
          intent: { project_type: type, bedrooms: Number(bedrooms), units: 1 },
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-title"
      >
        <button
          className="close"
          aria-label="Close new project"
          onClick={onClose}
        >
          <X />
        </button>
        <span className="eyebrow">A NEW STARTING POINT</span>
        <h2 id="new-title">Let’s find your property.</h2>
        <p>
          Start with a parcel number. We’ll confirm the site before creating
          your workspace.
        </p>
        {sample && (
          <div className="alert notice">
            Sample mode: lookup returns illustrative geometry only.
          </div>
        )}
        <form onSubmit={lookup}>
          <label>
            Parcel number
            <input
              autoFocus
              value={number}
              required
              placeholder="Enter your tax parcel number"
              onChange={(e) => {
                setNumber(e.target.value);
                setParcel(null);
              }}
            />
          </label>
          <button className="secondary full" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Search size={16} />
            )}
            Look up parcel
          </button>
        </form>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {parcel && (
          <>
            <div className="parcel-confirmation">
              <MapPin size={21} />
              <div>
                <strong>
                  {parcel.address || parcel.site_address || number}
                </strong>
                <small>
                  {labelJurisdiction(parcel.jurisdiction || "unknown")}
                </small>
                <p>
                  Confirm this is the intended parcel. Public GIS does not
                  establish legal boundaries.
                </p>
              </div>
            </div>
            <label>
              Project name
              <input
                value={name}
                required
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <div className="form-row">
              <label>
                Project type
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="new_house">New house</option>
                  <option value="adu">Accessory dwelling unit</option>
                  <option value="addition">Addition</option>
                </select>
              </label>
              <label>
                Bedrooms
                <input
                  type="number"
                  min="0"
                  max="30"
                  value={bedrooms}
                  onChange={(e) => setBedrooms(e.target.value)}
                />
              </label>
            </div>
            <button
              className="primary full"
              disabled={busy || !name.trim()}
              onClick={create}
            >
              Confirm parcel & create project
              <ArrowRight size={16} />
            </button>
          </>
        )}
      </section>
    </div>
  );
}
function GeometryEditor({
  project,
  onClose,
  onSaved,
}: {
  project: Project;
  onClose: () => void;
  onSaved: (p: Project) => Promise<void>;
}) {
  const [kind, setKind] = useState("constraint"),
    [label, setLabel] = useState(""),
    [source, setSource] = useState(""),
    [geometry, setGeometry] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      let value = JSON.parse(geometry);
      if (value.type === "Feature") value = value.geometry;
      if (!["Polygon", "MultiPolygon"].includes(value.type))
        throw Error(
          "Provide a Polygon or MultiPolygon GeoJSON geometry in longitude/latitude.",
        );
      if (!safeUrl(source))
        throw Error("Add an HTTPS or HTTP source reference.");
      const changes: Json = {
        expected_revision: project.current_revision,
        notes: `Reviewer supplied ${kind}: ${label}`,
      };
      if (kind === "sketch") changes.geometry = value;
      else
        changes.constraints = [
          ...((project as any).constraints || []),
          {
            label,
            geometry: value,
            source_url: source,
            review_status: "accepted",
            accuracy: "reviewer_supplied",
            review_note: "User confirmed source and coordinate system",
          },
        ];
      await onSaved(
        await request(`/projects/${project.id}/revisions`, "POST", changes),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="geometry-title"
      >
        <button
          className="close"
          aria-label="Close geometry editor"
          onClick={onClose}
        >
          <X />
        </button>
        <span className="eyebrow">REVIEWED SITE INPUT</span>
        <h2 id="geometry-title">Add geometry with context.</h2>
        <p>
          Use a surveyor or specialist’s GeoJSON. Coordinate order must be
          longitude, latitude (EPSG:4326). This does not verify a code
          requirement.
        </p>
        <form onSubmit={save}>
          <label>
            Geometry purpose
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="constraint">Known exclusion area</option>
              <option value="sketch">Proposed footprint sketch</option>
            </select>
          </label>
          <label>
            Description
            <input
              required
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Reviewed septic reserve area"
            />
          </label>
          <label>
            Source reference URL
            <input
              required
              type="url"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="https://…"
            />
          </label>
          <label>
            GeoJSON geometry
            <textarea
              required
              className="geo-input"
              value={geometry}
              onChange={(e) => setGeometry(e.target.value)}
              placeholder={'{"type":"Polygon","coordinates":[…]}'}
            />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I have reviewed the source, location and coordinate system.
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button className="primary full" disabled={!confirmed || busy}>
            Save geometry revision
            <ArrowRight size={16} />
          </button>
        </form>
      </section>
    </div>
  );
}
function FactEditor({
  fact,
  onClose,
  onSave,
}: {
  fact: Fact;
  onClose: () => void;
  onSave: (f: Fact) => Promise<void>;
}) {
  const [value, setValue] = useState(
      typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value),
    ),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fact-title"
      >
        <button
          className="close"
          aria-label="Close fact correction"
          onClick={onClose}
        >
          <X />
        </button>
        <span className="eyebrow">EVIDENCE REVIEW</span>
        <h2 id="fact-title">Correct an extracted fact.</h2>
        <p>
          Check the original source before accepting a correction. A new
          revision will retain the prior value.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            try {
              let parsed: any = value;
              if (typeof fact.value !== "string") parsed = JSON.parse(value);
              await onSave({ ...fact, value: parsed });
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        >
          <label>
            {human(fact.key || fact.name || "Fact value")}
            <input
              required
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          <p className="small muted">
            Source page {fact.page || fact.page_number || "?"} ·{" "}
            {fact.source_quote ||
              fact.quote ||
              "Refer to the original document."}
          </p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button className="primary full" disabled={saving}>
            Accept corrected value
            <Check size={16} />
          </button>
        </form>
      </section>
    </div>
  );
}
