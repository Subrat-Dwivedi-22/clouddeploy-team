# CloudDeploy on AWS for a college demo

## Cost and end date

Choose the AWS **Free account plan** only if your account is eligible. New customers receive $100 in credits and can earn up to another $100. The plan ends at six months or credit exhaustion, whichever comes first. Check remaining credits and days in the AWS Console before launch and weekly thereafter. An existing or paid account has different billing rules. Use local k3s on hardware you already have if uninterrupted zero-cost operation is required after the trial. [AWS Free Tier](https://aws.amazon.com/free/) · [Free Tier FAQ](https://aws.amazon.com/free/free-tier-faqs/)

## GitHub build setup

1. Create a dedicated public builder repository (for example, `clouddeploy-builder`) and copy `.github/workflows/source-build.yml` to its main branch. Set `GITHUB_BUILD_REPOSITORY` to its owner/name. Keep the demo website in a separate source repository. Enable Actions and allow the source-build workflow to publish packages. The platform uses standard Linux runners. Public repositories receive free standard-runner minutes. Keep the demo behind SSH access to control who can submit builds. [Actions billing](https://docs.github.com/en/actions/concepts/billing-and-usage)
2. Create a fine-grained GitHub token scoped to this builder repository with Actions read and write permission. Store it in the backend secret. Students paste a public source repository URL and do not need to share tokens. The platform sends the token only to the builder repository's Actions API. [Workflow dispatch permissions](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)
3. Each public source repository can contain a static website, an npm app with a start script, or a Dockerfile. For a Dockerfile, build for Linux AMD64 and support UID 101 and a port from 1024 through 65535. To try the included sample, put the contents of `sample-app/` at the root of a public repository you own. Its port is 8080.
4. The first successful build creates a GHCR package named `<builder-repo>-apps`. Open its package settings and set its visibility to public so the cluster can pull images. A pending rollout retries the pull. Publish only code intended for public distribution. [Container registry permissions](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)

## Launch one server

In the AWS console, manually launch an eligible x86-64 Ubuntu EC2 instance in the Free account plan. Select a size with at least 2 vCPUs and preferably 4 GiB memory for a small demo, subject to your account's available choices and credits. Use a modest EBS boot disk with space for container images, PostgreSQL, and k3s. Restrict inbound SSH to your IP. Keep all Kubernetes, database, and dashboard ports private. Compute, storage, and public IPv4 consume credits. Skip paid-plan upgrades when capacity or credits are insufficient.

On the instance, install single-node k3s and clone your platform repository. Use a supported Linux kernel with cgroups and pod networking enabled. [k3s quick start](https://docs.k3s.io/quick-start)

```sh
curl -fsSL https://get.k3s.io -o install-k3s.sh
less install-k3s.sh
sudo sh install-k3s.sh server --disable traefik --disable servicelb
sudo k3s kubectl get nodes
git clone https://github.com/YOUR-ACCOUNT/YOUR-PLATFORM.git clouddeploy
cd clouddeploy
sudo k3s kubectl apply -f infrastructure/kubernetes/access.yaml
sudo k3s kubectl apply -k infrastructure/preview
```

Build and push the API and web images using the Docker commands in the README on an AMD64 development machine. Use a public registry and a distinct version tag for every release. Replace both API image references and the web image in `infrastructure/kubernetes/platform.yaml`. The web image's default API address matches the cluster Service.

Create a private settings file on the VM **outside the repository**. Use `umask 077` before creating it and generate separate random hex values for the database password and JWT secret with `openssl rand -hex 32`. Substitute the same database password in both places.

```dotenv
POSTGRES_PASSWORD=YOUR_RANDOM_HEX_PASSWORD
DATABASE_URL=postgresql://clouddeploy:YOUR_RANDOM_HEX_PASSWORD@postgres:5432/clouddeploy
JWT_SECRET=YOUR_OTHER_RANDOM_HEX_VALUE
COOKIE_SECURE=false
ALLOWED_IMAGES=docker.io/nginxinc/nginx-unprivileged:stable-alpine
GITHUB_BUILD_REPOSITORY=your-account/clouddeploy-builder
GITHUB_BUILD_REF=main
GITHUB_BUILD_TOKEN=YOUR_FINE_GRAINED_TOKEN
```

```sh
sudo k3s kubectl -n clouddeploy-system create secret generic clouddeploy-settings --from-env-file="$HOME/clouddeploy-settings.env"
sudo k3s kubectl apply -f infrastructure/kubernetes/postgres.yaml
sudo k3s kubectl -n clouddeploy-system rollout status statefulset/postgres
sudo k3s kubectl apply -f infrastructure/kubernetes/platform.yaml
sudo k3s kubectl -n clouddeploy-system rollout status deploy/clouddeploy-api
sudo k3s kubectl -n clouddeploy-system rollout status deploy/clouddeploy-web
```

## Access and acceptance test

### Public presentation walkthrough

1. Open the CloudDeploy HTTPS dashboard while the EC2 instance is running.
2. Choose **GitHub repository** and paste `https://github.com/Subrat-Dwivedi-22/clouddeploy-demo-source`.
3. Choose **Simple website**. Set the website folder to `.`, the homepage to `index.html`, and replicas to `1`. The port is set automatically to `8080`.
4. Create the project and select **Deploy**. Open **History** to show the source commit and the Actions run in `clouddeploy-builder`.
5. Wait for **Running**, then choose **Open app**. Confirm the Fieldtone landscape palette website loads over HTTPS. [Example build run](https://github.com/Subrat-Dwivedi-22/clouddeploy-builder/actions/runs/44667212258)

Use the EC2 console to stop the instance between presentations if you want to preserve the demo. Its disk retains the database and configuration. After restarting, check whether its public IP changed and update the dashboard and app DNS settings if needed. Terminate it only when you are finished with the host and have exported any data you need.

### Private access over SSH

From your laptop, open the SSH tunnel below and keep it running. Replace the hostname and key path. Browse to http://localhost:3100. The same procedure works after each server restart.

```sh
ssh -i /path/to/key -L 3100:127.0.0.1:3100 -L 3102:127.0.0.1:3102 ubuntu@YOUR_EC2_HOST "sudo k3s kubectl -n clouddeploy-system port-forward svc/web 3100:3000"
```

On the VM, install the loopback preview forwarder once with `sudo install -m 644 infrastructure/preview/clouddeploy-preview.service /etc/systemd/system/`, then run `sudo systemctl daemon-reload` and `sudo systemctl enable --now clouddeploy-preview`.

Register, choose **GitHub repository**, paste the sample repo URL, enter a project name, set port 8080 and one replica, then create the project and select **Deploy**. History records the GitHub run and commit. Once the status is Running, choose **Open app** to load the actual app through SSH. Check Logs, scale to two, and select Redeploy to apply saved runtime settings. Remove the deployment when finished.

## Management and exit

### Public presentation mode

Serve the dashboard through an HTTPS reverse proxy on the VM. Use a dashboard hostname and a separate DNS suffix for workload sites; point both at the existing VM. Allow inbound TCP 443 and keep SSH restricted to the operator. The dashboard upstream is the loopback web forward on port 3100.

Set `PUBLIC_APP_DOMAIN` to the workload DNS suffix on both the API and preview Deployments. Set `COOKIE_SECURE=true` on the API. In this mode the status API returns an HTTPS hostname for every running project and enforces six GitHub build admissions per UTC hour across the installation. The counter is stored in PostgreSQL independently of project deletion.

Configure on-demand TLS for workload hostnames with the authorization URL `http://127.0.0.1:3102/certificate`. Route only UUID project hosts under the configured suffix to port 3102, rewriting the upstream Host to `<uuid>.localhost`. Preserve the dashboard's separate origin. The presentation directory contains the active Caddyfile and the host-specific restart instructions.

Use the dashboard for app releases and logs. Inspect platform health with `sudo k3s kubectl -n clouddeploy-system get pods,pvc`. For build failures see the Actions run in History. For image pull failures check GHCR package visibility and node architecture. Keep the settings file private and rotate the build token before expiry.

Before updates or trial expiry, export the database on the VM, copy the dump to your laptop over SSH, and keep your deployment settings securely. To move to local k3s, deploy the same platform version on an x86-64 machine, restore to an empty database before starting the API, and redeploy the desired projects. Single-node storage depends on the VM disk.

```sh
umask 077
sudo k3s kubectl -n clouddeploy-system exec postgres-0 -- pg_dump -U clouddeploy -Fc clouddeploy > clouddeploy.dump
# Restore on a fresh cluster with the database ready and the API stopped
sudo k3s kubectl -n clouddeploy-system exec -i postgres-0 -- pg_restore --exit-on-error -U clouddeploy -d clouddeploy < clouddeploy.dump
```

After validating your backup and ending the demo, terminate the EC2 instance, review any retained EBS volumes, snapshots and allocated IPs, and confirm the final resource list in the AWS Console.
