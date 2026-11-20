"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ProjectMetrics, type Reading, type Traffic } from "./project-metrics";

type Session = { email: string; images: string[]; clusterEnabled: boolean; builderEnabled: boolean };
type Configuration = { buildMode?: string; buildFolder?: string; entryFile?: string; npmBuild?: boolean; repository?: string | null; name: string; image: string; port: number; replicas: number; healthPath: string | null; resourceProfile: string };
type Project = Configuration & { id: string; updatedAt: string };
type History = Omit<Configuration, "name"> & { runId: string | null; commitSha?: string; buildSeconds?: number; id: string; action: string; outcome: string; detail: string; createdAt: string };
type Detail = Project & { history: History[] };
type Status = { state: string; ready: number; desired: number; revision?: string; liveCommit?: string; traffic?: Traffic[]; appUrl?: string | null };
type Logs = { pod: string | null; text: string };
type Command = { action: "deploy" | "redeploy" | "remove" | "deleteProject" }
  | { action: "rollback"; releaseId: string } | { action: "scale"; replicas: number } | { action: "configure"; config: Configuration };

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    signal,
    ...(body === undefined ? {} : {
      method: "POST", headers: { "Content-Type": "application/json", "X-CloudDeploy": "1" }, body: JSON.stringify(body),
    }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(response.status, data?.error ?? "The API is unavailable. Check that the backend is running.");
  }
  return response.status === 204 ? undefined as T : response.json();
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

const date = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function ConfigurationForm({ images, initial, busy, onSave }: {
  images: string[]; initial?: Configuration; busy: boolean; onSave: (data: Configuration) => void;
}) {
  const [source, setSource] = useState(initial && !initial.repository ? "image" : "github");
  const picker = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState(initial?.buildMode ?? "");
  const [folder,setFolder] = useState(initial?.buildFolder ?? ".");
  const [entry,setEntry] = useState(initial?.entryFile ?? "index.html");
  const [npmBuild,setNpmBuild] = useState(initial?.npmBuild ?? false);
  const labels: Record<string,string> = { static:"Simple website", docker:"Dockerfile app", node:"Node.js app", auto:"Automatic (existing project)" };
  const fixedPort = source === "github" && (mode === "static" || mode === "node");
  const choices = initial && !images.includes(initial.image) ? [initial.image, ...images] : images;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (source === "github" && !mode) { picker.current?.showModal(); return; }
    onSave({ name: String(data.get("name")), repository: source === "github" ? String(data.get("repository")).trim() : null,
      buildMode: source === "github" ? mode : "auto", buildFolder: folder, entryFile:entry, npmBuild,
      image: source === "image" ? String(data.get("image")) : "", port: fixedPort ? 8080 : Number(data.get("port")), replicas: Number(data.get("replicas")),
      healthPath: String(data.get("healthPath") ?? "").trim() || null, resourceProfile: String(data.get("resourceProfile")) });
  }
  return <form className="form" onSubmit={submit}>
    <fieldset className="source-picker"><legend>Deployment source</legend>
      <button type="button" aria-pressed={source === "github"} onClick={() => setSource("github")}>GitHub repository</button>
      <button type="button" aria-pressed={source === "image"} onClick={() => setSource("image")}>Container image</button>
    </fieldset>
    {source === "github" && <label>Repository URL<input type="url" name="repository" required defaultValue={initial?.repository ?? ""} placeholder="https://github.com/owner/my-app" />
      <small>Paste a public GitHub repository URL. Deploy builds its default branch.</small></label>}
    {source === "github" && <><button type="button" onClick={() => picker.current?.showModal()}>{mode ? "Deployment type · " + labels[mode] : "Choose deployment type…"}</button>
      <dialog className="restore-dialog" ref={picker} aria-label="What are you deploying?">
        <h2>What are you deploying?</h2>
        <div className="form mt-4">{[["static","Plain HTML, CSS and JavaScript"],["docker","Use your own Dockerfile"],["node","An npm app with a start script"]].map(([key,hint]) =>
          <button type="button" key={key} aria-pressed={mode===key} onClick={() => {
            if (mode!==key) {setFolder(".");setEntry(key==="docker"?"Dockerfile":key==="node"?"package.json":"index.html");setNpmBuild(false);}
            setMode(key);picker.current?.close();
          }}>{labels[key]} · {hint}</button>)}</div>
        <div className="restore-actions"><button type="button" onClick={() => picker.current?.close()}>Cancel</button></div>
      </dialog>
      {(mode==="static" || mode==="node") && <label>{mode==="static"?"Website folder":"App folder"}<input required value={folder} onChange={e=>setFolder(e.target.value)} placeholder="."/><small>Use . for the repository root, or a folder such as site.</small></label>}
      {(mode==="static" || mode==="docker") && <label>{mode==="static"?"Homepage file":"Dockerfile location"}<input required value={entry} onChange={e=>setEntry(e.target.value)} placeholder={mode==="static"?"home.html":"docker/Dockerfile"}/></label>}
      {mode==="node" && <><p className="muted">The app starts with npm start. Listen on 0.0.0.0 and process.env.PORT (8080).</p>
        <label><span><input type="checkbox" style={{width:"auto"}} checked={npmBuild} onChange={e=>setNpmBuild(e.target.checked)}/> Run npm run build before starting</span></label></>}
    </>}
    <label>Project name<input name="name" required maxLength={60} defaultValue={initial?.name} placeholder="Sample API" /></label>
    {source === "image" && <label>Docker image<select name="image" required defaultValue={initial?.image ?? images[0] ?? ""}>
      {choices.length === 0 && <option value="">No approved images configured</option>}
      {choices.map((image) => <option key={image} value={image} disabled={!images.includes(image)}>{image}</option>)}
    </select></label>}
    <div className="grid grid-cols-2 gap-4">
      <label>Container port<input key={String(fixedPort)} type="number" name="port" readOnly={fixedPort} required min={1024} max={65535} defaultValue={fixedPort ? 8080 : initial?.port ?? 8080} /></label>
      <label>Replicas<input type="number" name="replicas" required min={0} max={3} defaultValue={initial?.replicas ?? 1} /></label>
    </div>
    <details className="runtime-settings"><summary>Runtime settings</summary>
      <label>Health-check path<input name="healthPath" maxLength={160} defaultValue={initial?.healthPath ?? ""} placeholder="/health" />
        <small>Leave blank to check the port. Enter a path to wait for a successful HTTP response before showing Running.</small></label>
      <label>Resources per replica<select name="resourceProfile" defaultValue={initial?.resourceProfile ?? "standard"}>
        <option value="standard">Standard · 0.25 CPU · 128 MiB</option><option value="compact">Compact · 0.1 CPU · 64 MiB</option>
      </select></label>
    </details>
    <button className="primary" disabled={busy || (source === "image" && !images.length)}>{initial ? "Save configuration" : "Create project"}</button>
  </form>;
}

function Auth({ onLogin }: { onLogin: () => Promise<void> }) {
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const fields = new FormData(event.currentTarget);
    try {
      await api(register ? "auth/register" : "auth/login", Object.fromEntries(fields));
      await onLogin();
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }
  return <main className="auth-shell">
    <div className="auth-intro">
      <Brand />
      <h1>From repository to running app.</h1>
      <p>Connect a GitHub repository and follow its build and rollout on your shared Kubernetes cluster.</p>
      <ol className="pipeline" aria-label="Deployment stages"><li>GitHub commit</li><li>Image build</li><li>Cluster rollout</li></ol>
    </div>
    <section className="panel auth-panel">
      <h2>{register ? "Create your account" : "Sign in"}</h2>
      <form className="form mt-6" onSubmit={submit}>
        <label>Email<input name="email" type="email" autoComplete="email" maxLength={254} required placeholder="you@example.com" /></label>
        <label>Password<input name="password" type="password" autoComplete={register ? "new-password" : "current-password"} minLength={8} maxLength={128} required /></label>
        {error && <p role="alert" className="error">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? "Please wait…" : register ? "Create account" : "Sign in"}</button>
      </form>
      <button className="text-button mt-5" disabled={busy} onClick={() => { setRegister(!register); setError(""); }}>
        {register ? "Already have an account? Sign in" : "New to CloudDeploy? Create an account"}
      </button>
    </section>
  </main>;
}

function Brand() {
  return <div className="brand"><span className="brand-mark" aria-hidden="true">↥</span>CloudDeploy</div>;
}

function ProjectView({ project, session, busy, onAction }: {
  project: Detail; session: Session; busy: boolean; onAction: (command: Command) => Promise<void>;
}) {
  const [tab, setTab] = useState<"configuration" | "logs" | "history" | "metrics">("history");
  const rollbackDialog = useRef<HTMLDialogElement>(null);
  const [targetId, setTargetId] = useState("");
  const [status, setStatus] = useState<Status>();
  const [readings, setReadings] = useState<Reading[]>([]);
  const [statusError, setStatusError] = useState("");
  const [logs, setLogs] = useState<Logs>();
  const [logError, setLogError] = useState("");
  const [logLoading, setLogLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [logRefresh, setLogRefresh] = useState(0);
  const path = `projects/${project.id}`;

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const result = await api<Status>(`${path}/status`, undefined, controller.signal);
        if (!controller.signal.aborted) {
          setStatus(result); setStatusError("");
          if (session.clusterEnabled) {
            const time = Date.now();
            setReadings(old => [...old.filter(r => r.time >= time - 300000 && r.time < time), { time, ready: result.ready, desired: result.desired }]);
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) setStatusError(message(error));
      }
    }
    void load();
    const id = session.clusterEnabled ? window.setInterval(load, 5000) : undefined;
    return () => { controller.abort(); window.clearInterval(id); };
  }, [path, refresh, session.clusterEnabled]);

  useEffect(() => {
    if (tab !== "logs" || !session.clusterEnabled) return;
    const controller = new AbortController();
    api<Logs>(`${path}/logs`, undefined, controller.signal).then((result) => {
      if (!controller.signal.aborted) { setLogs(result); setLogError(""); }
    }).catch((error) => {
      if (!controller.signal.aborted) setLogError(message(error));
    }).finally(() => { if (!controller.signal.aborted) setLogLoading(false); });
    return () => controller.abort();
  }, [path, tab, logRefresh, session.clusterEnabled]);

  async function run(command: Command) {
    await onAction(command);
    setRefresh((value) => value + 1);
    setLogRefresh((value) => value + 1);
  }
  const building = project.history.some((item) => item.outcome === "Building");
  const hasDeployment = !!status && !statusError && status.state !== "Not deployed" && session.clusterEnabled;
  const current = project.history.find(entry => entry.id === status?.revision);
  const restoredId = current?.action === "rollback" ? current.detail.replace("Restored release ", "") : "";
  const previous = project.history.filter(entry => ["deploy","redeploy"].includes(entry.action) && entry.outcome === "Accepted"
    && (entry.runId || session.images.includes(entry.image) && /@sha256:[0-9a-f]{64}$/.test(entry.image))
    && entry.id !== status?.revision && entry.id !== restoredId);
  const target = previous.find(entry => entry.id === targetId);
  function chooseRelease(id: string) {
    setTargetId(id);
    rollbackDialog.current?.showModal();
  }

  return <div className="space-y-5">
    <section className="panel">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0"><h2 className="break-words">{project.name}</h2><p className="muted mt-1 break-all">{project.repository || project.image}</p></div>
        <span className="status"><i data-running={status?.state === "Running" && !statusError} />{building ? "Building on GitHub" : statusError ? "Status unavailable" : status?.state ?? "Checking status…"}</span>
      </div>
      {project.repository && !session.builderEnabled && <p className="notice mt-4">GitHub builds need a configured builder repository and Actions token.</p>}
      {building && <p role="status" className="notice mt-4">Building your commit. Kubernetes rollout starts automatically when the image is published.</p>}
      {statusError && <p className="error mt-4" role="alert">{statusError}</p>}
      {status?.liveCommit && !statusError && <p className="muted mt-3">Running commit <code title={status.liveCommit}>{status.liveCommit.slice(0,12)}</code></p>}
      {status?.appUrl && !statusError && <div className="app-endpoint">
        <div><strong>App URL</strong><a href={status.appUrl} target="_blank" rel="noopener noreferrer">{status.appUrl}</a>
          <small>{status.appUrl.startsWith("https://") ? "Public site · anyone with this link can open it." : "Available through the local demo connection."}</small></div>
        <a className="primary" href={status.appUrl} target="_blank" rel="noopener noreferrer">Open app ↗</a>
      </div>}
      <div className="metrics">
        <div><span>Container port</span><strong>{project.port}</strong></div>
        <div><span>Configured replicas</span><strong>{project.replicas}</strong></div>
        <div><span>Available / desired</span><strong>{hasDeployment ? `${status.ready} / ${status.desired}` : "—"}</strong></div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="primary" disabled={busy || building || !session.clusterEnabled || (!!project.repository && !session.builderEnabled)} onClick={() => void run({ action: hasDeployment ? "redeploy" : "deploy" })}>{hasDeployment ? "Redeploy" : "Deploy"}</button>
        <button disabled={busy || !session.clusterEnabled} onClick={() => setRefresh((value) => value + 1)}>Refresh status</button>
        <button disabled={busy || building || !status || !!statusError || !session.clusterEnabled || !previous.length} onClick={() => chooseRelease(previous[0].id)}>Roll back…</button>
      </div>
      {hasDeployment && <form className="scale-form" key={status.desired} onSubmit={(event) => {
        event.preventDefault();
        void run({ action: "scale", replicas: Number(new FormData(event.currentTarget).get("replicas")) });
      }}>
        <label>Scale running deployment<input name="replicas" type="number" min={0} max={3} defaultValue={status.desired} required /></label>
        <button disabled={busy}>Apply scale</button>
      </form>}
    </section>

    <dialog ref={rollbackDialog} className="restore-dialog" aria-labelledby="restore-title">
      <h2 id="restore-title">Roll back {project.name}</h2>
      <p className="muted mt-2">Choose the release to serve at your existing app URL.</p>
      <label className="mt-4">Release<select value={targetId} onChange={event => setTargetId(event.target.value)}>
        {previous.map(item => <option key={item.id} value={item.id}>{date(item.createdAt)} · {item.commitSha?.slice(0,8) || item.id.slice(0,8)}</option>)}
      </select></label>
      {target && <p className="notice mt-3">{target.replicas} replicas · port {target.port} · {target.resourceProfile} resources</p>}
      <p className="muted">The saved project configuration still applies to future deployments.</p>
      <div className="restore-actions"><button onClick={() => rollbackDialog.current?.close()}>Cancel</button>
        <button className="primary" disabled={!target || busy || building || !!statusError} onClick={() => {
          if (!target) return;
          rollbackDialog.current?.close(); setTab("history"); void run({action:"rollback",releaseId:target.id});
        }}>Restore release</button></div>
    </dialog>
    <section className="panel">
      <nav className="tabs" aria-label="Project details">
        {(["history", "metrics", "logs", "configuration"] as const).map((item) => <button key={item} aria-pressed={item === tab} onClick={() => setTab(item)}>{item === "history" ? "Release history" : item}</button>)}
      </nav>
      {tab === "configuration" && <>
        <ConfigurationForm key={project.updatedAt} images={session.images} initial={project} busy={busy} onSave={(config) => void run({ action: "configure", config })} />
        <p className="muted mt-3">Deploy or redeploy to apply saved configuration to Kubernetes.</p>
        <div className="maintenance"><button className="danger" disabled={busy || !hasDeployment} onClick={() => {
          if (window.confirm("Remove the running deployment? The project and its history will remain.")) void run({ action: "remove" });
        }}>Remove deployment</button><button className="danger" disabled={busy} onClick={() => {
          if (window.confirm(`Permanently delete “${project.name}”, its workload, and its history?`)) void run({ action: "deleteProject" });
        }}>Delete project</button></div>
      </>}
      {tab === "metrics" && <ProjectMetrics readings={readings} history={project.history} traffic={statusError ? undefined : status?.traffic} available={!!status && !statusError && session.clusterEnabled}/>}
      {tab === "logs" && <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="muted">{logs?.pod ?? "Latest running pod"}</p>
          <button disabled={logLoading || !session.clusterEnabled} onClick={() => { setLogLoading(true); setLogRefresh((value) => value + 1); }}>Refresh logs</button>
        </div>
        {logError && <p role="alert" className="error mt-3">{logError}</p>}
        <pre>{!session.clusterEnabled ? "Kubernetes is disabled." : logError ? "Logs unavailable." : logLoading || !logs ? "Loading logs…" : logs.text || (logs.pod ? "The container has emitted no logs." : "No running pod was found.")}</pre>
      </div>}
      {tab === "history" && (project.history.length ? <ul className="history">
        {project.history.map((entry) => <li key={entry.id}>
          <div className="release-main"><div className="release-heading"><strong className="capitalize">{entry.action}</strong>
            <span className="release-outcome" data-outcome={entry.outcome}>{entry.outcome}</span>
            {status?.state === "Running" && entry.id === status.revision && <span className="live-release">Live</span>}</div>
            <small>{date(entry.createdAt)} · {entry.commitSha ? "Commit " + entry.commitSha.slice(0,8) : "Release " + entry.id.slice(0,8)}</small>
            <p>{entry.detail.split("https://github.com/")[0]}</p>
            <small>{entry.replicas} replicas · port {entry.port}{entry.buildSeconds != null && ` · Build ${Math.floor(entry.buildSeconds/60)}m ${entry.buildSeconds%60}s`}</small>
            <details><summary>Image</summary><code>{entry.image || "Awaiting image"}</code></details></div>
          <div className="release-links">{previous.some(item => item.id === entry.id) && <button disabled={busy || building || !status || !!statusError || !session.clusterEnabled} onClick={() => chooseRelease(entry.id)}>Roll back here…</button>}
            {entry.runId && <a className="text-button" href={entry.detail.match(/https:\/\/github\.com\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/actions\/runs\/\d+/i)?.[0]} target="_blank" rel="noreferrer">View build ↗</a>}</div>
        </li>)}
      </ul> : <p className="muted">Deployment actions will appear here.</p>)}
    </section>
  </div>;
}

export default function Home() {
  const [session, setSession] = useState<Session | null>();
  const [startupError, setStartupError] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail>();
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [projectRefresh, setProjectRefresh] = useState(0);

  const clearSession = useCallback(() => {
    setSession(null); setProjects([]); setSelected(null); setDetail(undefined); setError(""); setReadError("");
  }, []);
  const loadSession = useCallback(async () => {
    setStartupError("");
    const current = await api<Session>("session");
    setListLoading(true);
    setSession(current);
  }, []);
  const start = useCallback(() => {
    void loadSession().catch((error) => {
      if (error instanceof ApiError && error.status === 401) clearSession();
      else setStartupError(message(error));
    });
  }, [clearSession, loadSession]);
  useEffect(start, [start]);

  const report = useCallback((error: unknown, set: (value: string) => void) => {
    if (error instanceof ApiError && error.status === 401) clearSession();
    else set(message(error));
  }, [clearSession]);

  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    api<Project[]>("projects", undefined, controller.signal)
      .then((items) => { if (!controller.signal.aborted) setProjects(items); })
      .catch((error) => { if (!controller.signal.aborted) report(error, setError); })
      .finally(() => { if (!controller.signal.aborted) setListLoading(false); });
    return () => controller.abort();
  }, [session, projectRefresh, report]);

  useEffect(() => {
    if (!session || !selected) return;
    const controller = new AbortController();
    api<Detail>(`projects/${selected}`, undefined, controller.signal)
      .then((item) => { if (!controller.signal.aborted) { setReadError(""); setDetail(item); } })
      .catch((error) => { if (!controller.signal.aborted) report(error, setReadError); });
    return () => controller.abort();
  }, [session, selected, projectRefresh, report]);

  const building = detail?.history.some((entry) => entry.outcome === "Building");
  useEffect(() => {
    if (!building) return;
    const timer = window.setInterval(() => setProjectRefresh((value) => value + 1), 5000);
    return () => window.clearInterval(timer);
  }, [building]);

  function select(id: string | null) {
    if (id !== selected) { setDetail(undefined); setReadError(""); }
    setError("");
    setSelected(id);
  }
  async function mutate(task: () => Promise<void>) {
    setBusy(true); setError("");
    try { await task(); } catch (error) { report(error, setError); }
    finally { setBusy(false); setProjectRefresh((value) => value + 1); }
  }

  if (startupError) return <main className="auth-shell"><section className="panel"><p role="alert" className="error">{startupError}</p><button className="mt-4" onClick={start}>Try again</button></section></main>;
  if (session === undefined) return <main className="auth-shell"><p role="status">Loading CloudDeploy…</p></main>;
  if (!session) return <Auth onLogin={loadSession} />;

  return <>
    <header className="header"><div className="header-inner"><Brand /><div className="flex flex-wrap items-center gap-3"><span className="muted break-all">{session.email}</span><button disabled={busy} onClick={() => void mutate(async () => { await api("auth/logout", {}); clearSession(); })}>Sign out</button></div></div></header>
    <main className="workspace">
      <div className="workspace-heading"><div><h1>Deployment workspace</h1><p className="muted mt-2">Connect repositories and manage releases.</p></div><button className="primary" disabled={busy} onClick={() => select(null)}>+ New project</button></div>
      {!session.clusterEnabled && <p className="notice">Kubernetes is disabled. You can create and configure projects locally.</p>}
      {error && <p role="alert" className="notice error">{error}</p>}
      <div className="dashboard">
        <aside className="panel project-list">
          <h2>All projects <span>{projects.length}</span></h2>
          {listLoading && <p role="status" className="muted">Loading projects…</p>}
          {!listLoading && !projects.length && <p className="muted">Create a project to get started.</p>}
          {projects.map((project) => <button key={project.id} className="project-button" aria-pressed={selected === project.id} disabled={busy} onClick={() => select(project.id)}><strong>{project.name}</strong><small>{project.repository?.replace("https://github.com/", "") || project.image}</small></button>)}
        </aside>
        {selected === null ? <section className="panel"><h2>Connect a project</h2><div className="mt-5"><ConfigurationForm images={session.images} busy={busy} onSave={(config) => void mutate(async () => {
          const project = await api<Project>("projects", config); select(project.id);
        })} /></div></section> : detail?.id === selected ? <ProjectView key={selected} project={detail} session={session} busy={busy} onAction={(command) => mutate(async () => {
          await api(`projects/${selected}/actions`, command);
          if (command.action === "deleteProject") select(null);
        })} /> : <section className="panel">{readError ? <><p className="error" role="alert">{readError}</p><button className="mt-4" onClick={() => setProjectRefresh((value) => value + 1)}>Retry</button></> : <p role="status">Loading project…</p>}</section>}
      </div>
    </main>
  </>;
}
