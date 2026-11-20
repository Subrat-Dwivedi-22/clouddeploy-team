export type Reading = { time: number; ready: number; desired: number };
type Action = { id: string; action: string; outcome: string; createdAt: string };
const timeLabel = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export type Traffic = { time: number; requests: number; errors: number; meanMs: number | null };

function TrafficChart({ rows, latency }: { rows: Traffic[]; latency: boolean }) {
  const label = latency ? "Mean response time" : "Requests per minute";
  const peak = Math.max(1, ...rows.map(r => latency ? r.meanMs ?? 0 : r.requests));
  return <figure><figcaption>{label}</figcaption>
    <svg viewBox="0 0 320 86" role="img" aria-label={label + ", one bar per minute"}>
      <text x="0" y="10">{peak}{latency ? "ms" : ""}</text>
      <line x1="40" x2="319" y1="80" y2="80" stroke="#c7d1cd"/>
      {rows.map((r,i) => {
        const h = 68 * (latency ? r.meanMs ?? 0 : r.requests) / peak;
        return <g key={r.time}><title>{`${timeLabel(r.time)} · ${r.requests} requests · ${r.errors} errors · ${r.meanMs ?? "—"} ms`}</title>
          <rect x={42+i*18} y={80-h} width="14" height={h} fill={latency ? "#6552a0" : "#15775a"}/>
          {!latency && <rect x={42+i*18} y={80-68*r.errors/peak} width="14" height={68*r.errors/peak} fill="#b45330"/>}
        </g>;
      })}
    </svg><small>{latency ? "Gateway time per request" : "Orange indicates errors"} · {timeLabel(rows[0].time)} – now</small></figure>;
}

export function ProjectMetrics({ readings, history, available, traffic }: { readings: Reading[]; history: Action[]; available: boolean; traffic?: Traffic[] }) {
  const releases = history.filter(item => item.action === "deploy" || item.action === "redeploy");
  const last = readings.at(-1);
  const end = last?.time ?? 0;
  const peak = Math.max(3, ...readings.map(item => Math.max(item.ready, item.desired)));
  const y = (count: number) => 78 - 72 * count / peak;
  return <section className="panel insights"><h2>Project metrics</h2>
    <div className="insight-grid"><figure>
      <figcaption>Replica readiness</figcaption>
      <small>{available && last ? `${last.ready} ready of ${last.desired} desired · updated ${timeLabel(end)}` : "Waiting for cluster readings"}</small>
      {last && <><svg viewBox="0 0 306 88" role="img" aria-label="Observed ready and desired replica counts across a five-minute window">
        {[0, peak].map(value => <g key={value}><text x="0" y={y(value)+4}>{value}</text><line x1="16" x2="302" y1={y(value)} y2={y(value)} stroke="#c7d1cd"/></g>)}
        {readings.map(r => {
          const x = 18 + 280 * (1 - (end - r.time) / 300000);
          return <g key={r.time}><title>{`${timeLabel(r.time)} · ${r.ready} ready / ${r.desired} desired`}</title>
            <circle cx={x} cy={y(r.desired)} r="4" fill="white" stroke="#6552a0" strokeWidth="1.5"/>
            <circle cx={x} cy={y(r.ready)} r="2" fill="#15775a"/></g>;
        })}
      </svg><small>○ Desired · <span className="ready-dot">●</span> Ready · last 5 min while open</small></>}
    </figure><figure><figcaption>Release activity</figcaption>
      <small>Deploys and redeploys in the latest {history.length} recorded actions</small>
      {releases.length ? <div className="outcomes">{["Accepted", "Failed", "Building", "Cancelled"].map(label => {
        const count = releases.filter(r => r.outcome === label).length;
        return <div key={label}><span>{label}</span><meter aria-label={label} value={count} min={0} max={releases.length}/><strong>{count}</strong></div>;
      })}</div> : <p className="muted mt-3">Your first deployment will appear here.</p>}
    </figure></div>
    {traffic?.length ? <><p className="mt-5"><strong>Gateway traffic</strong> · {traffic.reduce((n,r)=>n+r.requests,0)} requests · {traffic.reduce((n,r)=>n+r.errors,0)} errors</p>
      <div className="insight-grid"><TrafficChart rows={traffic} latency={false}/><TrafficChart rows={traffic} latency/></div></>
      : <p className="muted mt-5">Gateway traffic readings unavailable.</p>}
    </section>;
}
