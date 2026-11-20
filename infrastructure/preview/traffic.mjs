const buckets = new Map();
const started = Math.floor(Date.now() / 60000);
const minuteNow = () => Math.floor(Date.now() / 60000);

export function recordTraffic(id, failed, duration) {
  const minute = minuteNow();
  let projects = buckets.get(minute);
  if (!projects) {
    for (const old of buckets.keys()) if (old <= minute - 15) buckets.delete(old);
    projects = new Map();
    buckets.set(minute, projects);
  }
  if (!projects.has(id) && projects.size >= 512) return;
  const row = projects.get(id) ?? { requests: 0, errors: 0, milliseconds: 0 };
  row.requests++;
  if (failed) row.errors++;
  row.milliseconds += duration;
  projects.set(id, row);
}

export function readTraffic(id) {
  const now = minuteNow();
  const rows = [];
  for (let minute = Math.max(started, now - 14); minute <= now; minute++) {
    const row = buckets.get(minute)?.get(id);
    rows.push({ time: minute * 60000, requests: row?.requests ?? 0, errors: row?.errors ?? 0,
      meanMs: row ? Math.round(row.milliseconds / row.requests) : null });
  }
  return rows;
}
