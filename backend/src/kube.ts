import { readFile } from "node:fs/promises";
import { request } from "node:https";

export type Workload = { id: string; image: string; port: number; replicas: number; healthPath?: string | null; resourceProfile?: string };

export class ClusterError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function deploymentManifest(project: Workload, revision: string) {
  const name = `cd-${project.id}`;
  const labels = { "app.kubernetes.io/name": name, "app.kubernetes.io/managed-by": "clouddeploy" };
  return {
    apiVersion: "apps/v1", kind: "Deployment", metadata: { name, labels },
    spec: {
      replicas: project.replicas,
      selector: { matchLabels: labels },
      template: {
        metadata: { labels, annotations: { "clouddeploy.dev/revision": revision } },
        spec: {
          automountServiceAccountToken: false,
          enableServiceLinks: false,
          securityContext: { runAsNonRoot: true, runAsUser: 101, runAsGroup: 101, seccompProfile: { type: "RuntimeDefault" } },
          containers: [{
            name: "app", image: project.image, imagePullPolicy: "Always",
            ports: [{ containerPort: project.port }],
            readinessProbe: { ...(project.healthPath ? { httpGet: { path: project.healthPath, port: project.port } }
              : { tcpSocket: { port: project.port } }), periodSeconds: 3 },
            securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] } },
            resources: { requests: { cpu: "25m", memory: "32Mi" }, limits: project.resourceProfile === "compact"
              ? { cpu: "100m", memory: "64Mi" } : { cpu: "250m", memory: "128Mi" } },
          }],
        },
      },
    },
  };
}

type DeploymentStatus = {
  metadata: { generation: number };
  spec: { replicas: number; template?: { metadata?: { annotations?: Record<string, string> } } };
  status?: { observedGeneration?: number; replicas?: number; updatedReplicas?: number; availableReplicas?: number;
    conditions?: { type: string; status: string; reason: string }[] };
};
type Pods = { items: { metadata: { name: string; creationTimestamp: string }; status?: { phase: string } }[] };

export class Kubernetes {
  private namespace = process.env.KUBE_NAMESPACE || "clouddeploy-workloads";
  private deployments = `/apis/apps/v1/namespaces/${this.namespace}/deployments`;
  private core = `/api/v1/namespaces/${this.namespace}`;
  readonly enabled = process.env.KUBE_MODE === "api";

  private async call(method: string, path: string, body?: unknown, contentType = "application/json"): Promise<string> {
    if (!this.enabled) throw new ClusterError(503, "Kubernetes is disabled for this instance.");
    try {
      const endpoint = new URL(process.env.KUBE_API_URL || "https://kubernetes.default.svc");
      if (endpoint.protocol !== "https:") throw new Error("HTTPS required");
      const mount = "/var/run/secrets/kubernetes.io/serviceaccount";
      const [token, ca] = await Promise.all([
        readFile(process.env.KUBE_TOKEN_FILE || `${mount}/token`, "utf8"),
        readFile(process.env.KUBE_CA_FILE || `${mount}/ca.crt`),
      ]);
      const payload = body === undefined ? undefined : JSON.stringify(body);
      return await new Promise<string>((resolve, reject) => {
        const req = request(new URL(path, endpoint), {
          method, ca, headers: { Authorization: `Bearer ${token.trim()}`, "Content-Type": contentType,
            ...(payload === undefined ? {} : { "Content-Length": Buffer.byteLength(payload) }) },
        }, (res) => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => {
            data += chunk;
            if (data.length > 2_000_000) req.destroy(new Error("Response too large"));
          });
          res.on("error", reject);
          res.on("end", () => {
            const status = res.statusCode ?? 502;
            if (status >= 200 && status < 300) resolve(data);
            else reject(new ClusterError(status, `Kubernetes returned HTTP ${status}.`));
          });
        });
        const deadline = setTimeout(() => req.destroy(new Error("Kubernetes timeout")), 4500);
        req.on("close", () => clearTimeout(deadline));
        req.on("error", reject);
        req.end(payload);
      });
    } catch (error) {
      if (error instanceof ClusterError) throw error;
      throw new ClusterError(503, "Could not reach Kubernetes. Check the API address, CA and service account token.");
    }
  }

  async deploy(project: Workload, revision: string) {
    const manifest = deploymentManifest(project, revision);
    const path = `${this.deployments}/${manifest.metadata.name}`;
    await this.call("PATCH", path + "?fieldManager=clouddeploy&force=true", manifest, "application/apply-patch+yaml");
  }

  async scale(id: string, replicas: number) {
    await this.call("PATCH", `${this.deployments}/cd-${id}/scale`, { spec: { replicas } }, "application/merge-patch+json");
  }

  async remove(id: string) {
    if (!this.enabled) return;
    try {
      await this.call("DELETE", `${this.deployments}/cd-${id}`, { propagationPolicy: "Background" });
    } catch (error) {
      if (!(error instanceof ClusterError && error.status === 404)) throw error;
    }
  }

  async status(id: string) {
    if (!this.enabled) return { state: "Kubernetes disabled", ready: 0, desired: 0 };
    try {
      const result: DeploymentStatus = JSON.parse(await this.call("GET", `${this.deployments}/cd-${id}`));
      const desired = result.spec.replicas;
      const ready = result.status?.availableReplicas ?? 0;
      const observed = (result.status?.observedGeneration ?? 0) >= result.metadata.generation;
      const stalled = result.status?.conditions?.some(
        (condition) => condition.type === "Progressing" && condition.reason === "ProgressDeadlineExceeded",
      );
      const current = (result.status?.updatedReplicas ?? 0) === desired && (result.status?.replicas ?? 0) === desired;
      const state = observed && stalled ? "Rollout stalled"
        : observed && current && ready === desired ? (desired === 0 ? "Scaled to zero" : "Running")
        : "Progressing";
      return { state, ready, desired, revision: result.spec.template?.metadata?.annotations?.["clouddeploy.dev/revision"] };
    } catch (error) {
      if (error instanceof ClusterError && error.status === 404) return { state: "Not deployed", ready: 0, desired: 0 };
      throw error;
    }
  }

  async logs(id: string) {
    const query = new URLSearchParams({ labelSelector: `app.kubernetes.io/name=cd-${id}` });
    const pods: Pods = JSON.parse(await this.call("GET", `${this.core}/pods?${query}`));
    const pod = pods.items.sort((a, b) => b.metadata.creationTimestamp.localeCompare(a.metadata.creationTimestamp))
      .find((candidate) => candidate.status?.phase === "Running");
    if (!pod) return { pod: null, text: "" };
    const path = `${this.core}/pods/${encodeURIComponent(pod.metadata.name)}/log?container=app&tailLines=100&limitBytes=65536`;
    return { pod: pod.metadata.name, text: await this.call("GET", path) };
  }
}
