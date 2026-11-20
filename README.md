# CloudDeploy

CloudDeploy is a college-project dashboard for building public GitHub repositories and deploying their images to one shared Kubernetes cluster. It uses Next.js and Tailwind CSS for the dashboard, Express for the API, and Prisma with PostgreSQL for accounts, project configuration, and deployment history.

## GitHub to Kubernetes

For a first rollout, paste `https://github.com/Subrat-Dwivedi-22/clouddeploy-demo-source` as the repository URL. Choose **Simple website**, keep the default folder `.` and homepage `index.html`, and use one replica. The deployed URL opens Fieldtone, an interactive landscape palette website. The shared workflow runs in [clouddeploy-builder](https://github.com/Subrat-Dwivedi-22/clouddeploy-builder/actions).

After entering a public GitHub URL, open **Choose deployment type**.

| Type | Project inputs | What the builder does |
| --- | --- | --- |
| Simple website | Website folder (default `.`) and HTML homepage (default `index.html`) | Packages browser-ready files from the folder and serves the selected homepage at `/` on port 8080. |
| Dockerfile app | Dockerfile location relative to the repository root and the app's container port | Builds the selected Dockerfile using the repository root as the Docker build context. |
| Node.js app | Folder containing `package.json` and an optional `npm run build` step | Uses Node 22 with npm, installs dependencies (uses `npm ci` for lockfiles), then serves with `npm start`. Listen on `0.0.0.0` and `process.env.PORT` (8080). |

Deploy validates the selected file against the pinned default-branch commit before dispatching the GitHub workflow. Existing projects keep automatic detection until their build type is changed. The public gateway serves GET and HEAD requests. Apps needing writable forms, uploads, WebSockets, external network services or a custom runtime may require additional platform changes.


For AWS Free plan eligibility, the operator setup, a sample repository walkthrough and an exit plan, see [the AWS deployment guide](DEPLOYMENT.md).

## Team contributions

| Teammate | Main folders or files | Final contribution |
| --- | --- | --- |
| 1 · Frontend and backend | `frontend/` and most of `backend/` | Own the dashboard, API, login, database and project history. |
| 2 · Kubernetes | `infrastructure/` and `backend/src/kube.ts` | Own the cluster setup, app deployment, scaling and logs. |
| 3 · CI/CD | `.github/workflows/` and `backend/src/github.ts` | Own GitHub Actions, the separate builder repo and publishing container images. |
| 4 · AWS and demo setup | `DEPLOYMENT.md`, Compose files and `sample-app/` | Own AWS hosting, local setup instructions and the sample website used in the demo. |

Each teammate clones this repo, creates a branch from `main`, and commits the changes or verification notes they personally worked on. Push the branch using your own GitHub account and open a pull request to `main`. Keep each pull request focused on its area, then merge the four reviewed pull requests.

## Run locally with Docker Compose

Install Docker with Compose v2. From the repository root, run:

```sh
docker compose up --build
```

Open http://localhost:3000, register an account, and create a project. Select **Container image** to try the provided image on port **8080**, or enter a repository URL to save a GitHub project. Compose applies the database migration automatically and starts with Kubernetes disabled. Project creation, editing, listing, viewing, deletion, and authentication work in this mode. PostgreSQL data persists in the named volume. Stop the stack with `docker compose down`.

Set `JWT_SECRET` and `ALLOWED_IMAGES` in a root `.env` copied from `.env.example` to override the demo defaults.

### Run real Kubernetes deployments on your laptop

From the repository root run:

```sh
docker compose -f docker-compose.yml -f compose.k3s.yml up -d --build
```

This local demo starts a dedicated privileged k3s node inside Docker Desktop, keeps its Kubernetes endpoint inside the Compose network, and gives Express a rotating namespace-scoped token. The existing Compose database volume stores your projects. Refresh http://localhost:3000 and try **Container image** with port 8080 and one replica. Deploy, inspect logs, scale, and remove it.

For GitHub builds, complete the GitHub setup in [DEPLOYMENT.md](DEPLOYMENT.md), put `GITHUB_BUILD_REPOSITORY`, `GITHUB_BUILD_REF`, and `GITHUB_BUILD_TOKEN` in the root ignored `.env` file, and rerun the same command. Choose **GitHub repository** and enter a public Dockerized app. Stop this setup with `docker compose -f docker-compose.yml -f compose.k3s.yml down`. Named volumes preserve the database and cluster state.

## Develop with Node.js

Use Node.js 22.12 or newer, npm, and PostgreSQL 16. Start the Compose database if you do not already have PostgreSQL:

```sh
docker compose up -d db
npm ci
```

Copy `backend/.env.example` to `backend/.env` and `frontend/.env.example` to `frontend/.env.local`. Adjust the database URL if you use an existing PostgreSQL instance.

```sh
npm run generate -w backend
npm run migrate -w backend
npm run dev
```

Open http://localhost:3000. The Next.js server forwards browser API requests to Express. The API listens on loopback by default. Restart the dev servers after changing environment variables.

## Deploy a project

1. Choose a public GitHub repository or an approved image, the container's listening port, and 0–3 replicas.
2. Select **Deploy**. The API submits a namespaced Deployment and shows rollout progress separately from request acceptance.
3. To change the image or port, save the configuration and select **Redeploy**. Redeploy also forces a fresh rollout for an unchanged tag. Use **Apply scale** to change the running deployment's replica count immediately.
4. Use **Logs** to read up to 100 recent lines from the newest running pod with the project's label. Use **History** to see the latest 30 deployment actions and their request outcomes.
5. **Remove deployment** requests background cleanup and keeps the project and its history. **Delete project** requests workload cleanup and then removes the project and its history.

Project configurations are saved before rollout. The dashboard reports the persisted configuration and the cluster's available/desired replicas separately. A network interruption can leave an accepted Kubernetes request without matching database history. Refresh status and retry the action to reconcile.

## Build and run the sample image

```sh
docker build -t clouddeploy-sample:local sample-app
docker run --rm -p 127.0.0.1:8080:8080 clouddeploy-sample:local
curl http://localhost:8080
```

For Kubernetes, tag the sample with a registry name and version, push it, then add the full pullable reference to `ALLOWED_IMAGES`. The cluster needs pull access. For a hosted demo, use immutable digests for approved images. Images must run using UID/GID 101 and listen on an unprivileged port. The sample uses port 8080.

## Deploy CloudDeploy on k3s

Use an existing k3s or Kubernetes cluster with Pod Security Admission and NetworkPolicy enforcement, an accessible PostgreSQL database, and a container registry readable by the cluster. Use an operator account to apply infrastructure manifests.

1. Build and push the API and dashboard images. Replace `REGISTRY` with your real repository path. Authenticate to the registry beforehand.
   ```sh
   docker build -f backend/Dockerfile -t REGISTRY/clouddeploy-api:v1 .
   docker build -f frontend/Dockerfile -t REGISTRY/clouddeploy-web:v1 .
   docker push REGISTRY/clouddeploy-api:v1
   docker push REGISTRY/clouddeploy-web:v1
   ```
2. Apply the namespaces, scoped service account, workload policy, and quota.
   ```sh
   kubectl apply -f infrastructure/kubernetes/access.yaml
   kubectl apply -k infrastructure/preview
   ```
3. Create the `clouddeploy-settings` Secret in `clouddeploy-system`. Keep this file outside the repository and set the values before running the command.
   ```dotenv
   DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/clouddeploy?sslmode=require
   JWT_SECRET=REPLACE_WITH_RANDOM_SECRET
   ALLOWED_IMAGES=docker.io/nginxinc/nginx-unprivileged:stable-alpine
   COOKIE_SECURE=false
   ```
   Generate a random secret with `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"`. URL-encode credentials in the database URL and set its TLS options according to your database provider. Set `COOKIE_SECURE=true` when browsing over HTTPS.
   ```sh
   kubectl -n clouddeploy-system create secret generic clouddeploy-settings --from-env-file=/path/to/clouddeploy-settings.env
   ```
4. Replace both API image references and the web image reference in `infrastructure/kubernetes/platform.yaml`. For a private registry, configure platform image pull credentials with your cluster operator. The dashboard image forwards to `http://api:4000` by default, which matches both Compose and the included Kubernetes Service.
   ```sh
   kubectl apply -f infrastructure/kubernetes/platform.yaml
   kubectl -n clouddeploy-system rollout status deployment/clouddeploy-api
   kubectl -n clouddeploy-system rollout status deployment/clouddeploy-web
   kubectl -n clouddeploy-system port-forward svc/web 3000:3000
   ```
5. Open http://localhost:3000 for the demo. For network access, expose only the web Service through an HTTPS ingress managed by the operator. The included manifest uses an internal Service for each platform component.

### Open a running app

For standalone Kubernetes, run `kubectl -n clouddeploy-system port-forward svc/clouddeploy-preview 3102:8080` on the presentation computer. Local Compose with k3s publishes its own preview port 3002 automatically. In either setup, open a running project and click **Open app** in Chrome or Edge. Each project has a stable address under `*.localhost`. Anyone with that address and access to the tunnel can read the app. These links support HTTP GET and HEAD, including HTML, assets and JSON. App sign-in, uploads and WebSockets are outside the read-only preview.

The gateway's service account can list pods only in the workload namespace. It selects a ready replica by project ID, connects to its declared container port, and omits incoming credentials. Each project runs on a separate browser origin. Scaling to zero or removing a deployment makes the saved link unavailable.

Under **Runtime settings**, choose Compact (0.1 CPU, 64 MiB) or Standard (0.25 CPU, 128 MiB) per replica. Set an optional health-check path such as `/health` for HTTP readiness. Leave it empty for TCP readiness. Save and deploy again to apply these settings. Older projects retain their original limits and TCP checks.

### Run the backend outside the cluster

Use a reachable HTTPS Kubernetes URL and the cluster's CA certificate. With admin privileges, an operator can issue a temporary token using `kubectl -n clouddeploy-system create token clouddeploy-api --duration=1h`. Store the token in a private file outside the repository. In `backend/.env`, set `KUBE_MODE=api`, `KUBE_NAMESPACE=clouddeploy-workloads`, `KUBE_API_URL`, `KUBE_CA_FILE`, and `KUBE_TOKEN_FILE`. The API rereads those files for each Kubernetes request. Kubernetes may issue a token with a shorter lifetime. The in-cluster manifest uses the automatically rotated runtime token and CA instead.

### Shared-cluster controls

- Express validates JWTs in HTTP-only cookies, requires a custom header for writes, and scopes every project operation to its owner.
- The service account can manage Deployments and replica counts and read pod logs in one workload namespace. The API uses fixed Kubernetes HTTPS endpoints.
- The workload namespace applies restricted Pod Security, a resource quota, and default-deny networking. The workloads receive no service account token and use either operator-approved images or images generated by the configured builder.
- Keep the demo behind operator-controlled access. Registration is open, the quota is shared, and app account boundaries do not provide dedicated Kubernetes tenant isolation. The demo has no public workload routing or infrastructure provisioning.

## Checks

In **Release history**, GitHub releases show a commit and the workflow duration reported by GitHub. The project header shows the commit after Kubernetes confirms that release is running. Older builds can show a shortened commit and an unavailable duration. Use **Roll back…** beside the deployment controls, or **Roll back here…** on an eligible release. Confirm **Restore release** to reapply a previous GitHub release or approved digest-pinned image with its original runtime settings. It records a rollback in History and preserves saved configuration for the next deploy. Data stored by the app is outside the rollback.

Gateway traffic shows up to 15 one-minute buckets for the selected project, including the current partial minute. Requests include individual page assets. Errors count HTTP 4xx/5xx responses and interrupted responses. Mean response time includes gateway lookup and response transfer. Charts start over when the single gateway restarts. On standalone Kubernetes the API reads the internal preview Service on port 8081. Keep this metrics port private.

Open a project to view **Project metrics**. The readiness chart samples the current Kubernetes status every five seconds while the project is open. It shows up to five minutes of observed ready and desired replicas and starts fresh when you reopen the project. The release chart counts deploy and redeploy outcomes among the latest 30 project actions. Accepted means Kubernetes accepted the rollout request; readiness is reported separately.

```sh
npm test
npm run build
docker compose config --quiet
```

To run the PostgreSQL-backed smoke test, export `DATABASE_URL`, `JWT_SECRET`, and `ALLOWED_IMAGES` in the current shell, apply the migration, and run `node --test backend/test/api-smoke.mjs` from the repository root. Use a disposable database for the test accounts. GitHub Actions runs these checks and builds all three container images on pushes and pull requests. Hosting requires your cluster access, registry access, PostgreSQL connection, and deployment secrets.
