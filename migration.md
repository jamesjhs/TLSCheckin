# TLSCheckin Docker Migration Manual

This manual moves TLSCheckin from a direct Node/pm2 style deployment to a Docker Compose deployment exposed through Cloudflare Tunnel on a Debian server.

Target hostnames:

- Production: `https://tlscheckin.org.uk`
- Testing: `https://testing.tlscheckin.org.uk`

The pattern is based on the Docker setup in `C:\GitHub\Qglimpse`: GitHub Actions builds a GHCR image, writes a runtime `.env` from GitHub environment variables/secrets, copies only `.env` and `docker-compose.yml` to the server, then runs `docker compose pull` and `docker compose up -d --no-build`.

Authoritative docs checked for this guide:

- Docker Debian install: https://docs.docker.com/engine/install/debian/
- Traefik Docker provider and labels: https://doc.traefik.io/traefik/providers/docker/
- GitHub Actions variables: https://docs.github.com/en/actions/concepts/workflows-and-actions/variables
- GitHub Actions secrets: https://docs.github.com/en/actions/reference/security/secrets
- Cloudflare DNS records: https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/
- Cloudflare Tunnel routing: https://developers.cloudflare.com/tunnel/concepts/routing/
- Cloudflare Tunnel setup: https://developers.cloudflare.com/tunnel/get-started/
- Cloudflare Turnstile setup and validation: https://developers.cloudflare.com/turnstile/get-started/ and https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

## 1. Migration Overview

The final deployment flow should be:

```text
Push to main/testing
  -> GitHub Actions builds TLSCheckin image
  -> GitHub Actions pushes image to ghcr.io
  -> GitHub Actions creates runtime .env from GitHub environment secrets/variables
  -> GitHub Actions copies .env and docker-compose.yml to Debian over SSH
  -> Debian pulls the exact image tag
  -> Docker Compose restarts tlscheckin on the existing Docker `proxy` network
  -> Cloudflare Tunnel sends tlscheckin.org.uk or testing.tlscheckin.org.uk to Traefik
  -> Traefik routes by Host header to the TLSCheckin container
```

Production and testing must use separate GitHub Environments, separate persistent data directories, and separate Cloudflare Turnstile hostnames/secrets.

## 2. Add Docker Files To TLSCheckin

Create `Dockerfile` in the repository root:

```dockerfile
FROM node:22-bookworm-slim AS deps

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

FROM deps AS build

COPY tsconfig.json ./
COPY src src
COPY public public
COPY checkins.json checkins.json
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ARG APP_PORT=3110
ENV PORT=${APP_PORT}

WORKDIR /app

COPY package*.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/dist dist
COPY --from=build /app/public public
COPY --from=build /app/checkins.json checkins.json

EXPOSE ${APP_PORT}
CMD ["npm", "start"]
```

Create `.dockerignore`:

```text
node_modules
dist
data
persistent-data*
.git
.github
.env
npm-debug.log*
```

Create `docker-compose.yml`:

```yaml
services:
  tlscheckin:
    image: ${TLSCHECKIN_IMAGE:-tlscheckin:local}
    build: .
    container_name: tlscheckin-${BRANCH_NAME:-main}
    restart: unless-stopped

    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

    env_file:
      - .env

    volumes:
      - ./persistent-data-${BRANCH_NAME:-main}:/app/data

    networks:
      - proxy

    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=proxy"
      - "traefik.http.routers.tlscheckin-${BRANCH_NAME:-main}.rule=Host(`${TLSCHECKIN_HOST:?TLSCHECKIN_HOST must be set}`)"
      - "traefik.http.services.tlscheckin-${BRANCH_NAME:-main}.loadbalancer.server.port=${PORT:?PORT must be set}"

networks:
  proxy:
    external: true
```

No ports are published to the public Internet. TLSCheckin joins the same external `proxy` network as Qglimpse, and Traefik routes to the container through Docker labels.

## 3. Move `.env` Values To GitHub

Do not commit `.env`. Transfer the current `.env` keys into GitHub Environment secrets and variables.

Create two GitHub Environments:

- `production`
- `testing`

Use GitHub environment-level entries so production and testing can have different values. GitHub documents variables as non-sensitive configuration and secrets as masked sensitive values; use secrets for credentials, encryption keys, and passwords.

### 3.1 Environment Secrets

Add these to both `production` and `testing`, with different values where noted:

| Secret | Production value | Testing value |
| --- | --- | --- |
| `DB_ENCRYPTION_KEY` | Existing production key if migrating the current database; otherwise a new random key. | New random key. |
| `SESSION_SECRET` | Existing or new strong random value. | New strong random value. |
| `ADMIN_INITIAL_PASSWORD` | Temporary strong bootstrap password. | Temporary strong bootstrap password. |
| `TURNSTILE_SECRET` | Production Turnstile secret for `tlscheckin.org.uk`. | Testing Turnstile secret for `testing.tlscheckin.org.uk`. |
| `SSH_PRIVATE_KEY` | Private deploy key for the Debian deploy user. | Same or a separate testing deploy key. |
| `CF_ACCESS_CLIENT_ID` | Cloudflare Access service token ID if SSH is protected by Access. | Same or testing-specific token. |
| `CF_ACCESS_CLIENT_SECRET` | Cloudflare Access service token secret. | Same or testing-specific token. |

Generate random values:

```bash
openssl rand -base64 32
```

or in PowerShell:

```powershell
[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Important database rule: if you copy an existing encrypted database into Docker, keep the original `DB_ENCRYPTION_KEY`. Changing it makes the existing database unreadable.

### 3.2 Environment Variables

Add these to both environments:

| Variable | Production value | Testing value |
| --- | --- | --- |
| `PORT` | `3110` | `3111` |
| `NODE_ENV` | `production` | `production` |
| `DB_PATH` | `/app/data/tlscheckin.db` | `/app/data/tlscheckin.db` |
| `CHECKINS_PATH` | `/app/data/checkins.json` | `/app/data/checkins.json` |
| `APP_TIMEZONE` | `Europe/London` | `Europe/London` |
| `TURNSTILE_SITE_KEY` | Site key for `tlscheckin.org.uk`. | Site key for `testing.tlscheckin.org.uk`. |
| `TLSCHECKIN_BASE_URL` | `https://tlscheckin.org.uk` | `https://testing.tlscheckin.org.uk` |

`TLSCHECKIN_BASE_URL` is the only domain-bearing GitHub Environment variable. The current app does not read it directly, but the workflow validates it so `main` cannot accidentally deploy with the testing URL, and `testing` cannot accidentally deploy with the production URL. The workflow derives both runtime `TURNSTILE_HOSTNAMES` and Traefik `TLSCHECKIN_HOST` from this URL.

`PORT` must be defined as a GitHub Environment variable in both `production` and `testing`. Use `3110` for production and `3111` for testing. The workflow passes it into the Docker build as `APP_PORT`, writes it into the runtime `.env`, and Traefik uses the same value in its `loadbalancer.server.port` label.

`CHECKINS_PATH` is deliberately placed in `/app/data` so admin-edited preset SMS messages survive image replacement. If there is no existing `checkins.json` in the mounted directory, TLSCheckin creates one with built-in defaults at startup.

## 4. Add GitHub Actions Deployment Workflow

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Debian

on:
  push:
    branches: [ main, testing ]

permissions:
  contents: read
  packages: write

concurrency:
  group: deploy-${{ github.ref_name }}
  cancel-in-progress: true

env:
  SSH_HOST: sshjhs.jahosi.co.uk
  SSH_USER: dockertunnel

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ github.ref_name == 'main' && 'production' || 'testing' }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Prepare Image Name
        run: |
          set -euo pipefail
          REF_SLUG="${GITHUB_REF_NAME//[^A-Za-z0-9_.-]/-}"
          IMAGE_REPOSITORY="ghcr.io/${GITHUB_REPOSITORY,,}"
          APP_PORT="${{ vars.PORT }}"
          test -n "$APP_PORT"
          TLSCHECKIN_BASE_URL="${{ vars.TLSCHECKIN_BASE_URL }}"
          test -n "$TLSCHECKIN_BASE_URL"

          if [ "$REF_SLUG" = "main" ] && [ "$TLSCHECKIN_BASE_URL" != "https://tlscheckin.org.uk" ]; then
            echo "::error::main must deploy to https://tlscheckin.org.uk"
            exit 1
          fi

          if [ "$REF_SLUG" = "testing" ] && [ "$TLSCHECKIN_BASE_URL" != "https://testing.tlscheckin.org.uk" ]; then
            echo "::error::testing must deploy to https://testing.tlscheckin.org.uk"
            exit 1
          fi

          DEPLOY_PATH="/home/${SSH_USER}/tlscheckin.${REF_SLUG}-${APP_PORT}"
          echo "REF_SLUG=${REF_SLUG}" >> "$GITHUB_ENV"
          echo "APP_PORT=${APP_PORT}" >> "$GITHUB_ENV"
          echo "DEPLOY_PATH=${DEPLOY_PATH}" >> "$GITHUB_ENV"
          echo "IMAGE_REPOSITORY=${IMAGE_REPOSITORY}" >> "$GITHUB_ENV"
          echo "IMAGE_REF=${IMAGE_REPOSITORY}:${GITHUB_SHA}" >> "$GITHUB_ENV"
          echo "IMAGE_LATEST=${IMAGE_REPOSITORY}:${REF_SLUG}" >> "$GITHUB_ENV"

      - name: Set Up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log In to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and Push Image
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          build-args: |
            APP_PORT=${{ vars.PORT }}
          tags: |
            ${{ env.IMAGE_REF }}
            ${{ env.IMAGE_LATEST }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Install Cloudflared on Runner
        run: |
          set -euo pipefail
          curl -fL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
          chmod +x cloudflared
          sudo mv cloudflared /usr/local/bin/
          cloudflared --version

      - name: Configure SSH over Cloudflare
        env:
          SSH_PRIVATE_KEY: ${{ secrets.SSH_PRIVATE_KEY }}
        run: |
          set -euo pipefail
          test -n "$SSH_PRIVATE_KEY"
          mkdir -p ~/.ssh
          echo "$SSH_PRIVATE_KEY" > ~/.ssh/id_ed25519
          chmod 600 ~/.ssh/id_ed25519

          cat > ~/.ssh/config << EOF
          Host ${SSH_HOST}
            HostName ${SSH_HOST}
            StrictHostKeyChecking no
            User ${SSH_USER}
            IdentityFile ~/.ssh/id_ed25519
            ProxyCommand /usr/local/bin/cloudflared access ssh --hostname %h --loglevel debug
          EOF
          chmod 600 ~/.ssh/config

      - name: Build Secure .env File
        env:
          DB_ENCRYPTION_KEY: ${{ secrets.DB_ENCRYPTION_KEY }}
          SESSION_SECRET: ${{ secrets.SESSION_SECRET }}
          ADMIN_INITIAL_PASSWORD: ${{ secrets.ADMIN_INITIAL_PASSWORD }}
          TURNSTILE_SECRET: ${{ secrets.TURNSTILE_SECRET }}
          PORT: ${{ vars.PORT }}
          NODE_ENV: ${{ vars.NODE_ENV }}
          DB_PATH: ${{ vars.DB_PATH }}
          CHECKINS_PATH: ${{ vars.CHECKINS_PATH }}
          APP_TIMEZONE: ${{ vars.APP_TIMEZONE }}
          TURNSTILE_SITE_KEY: ${{ vars.TURNSTILE_SITE_KEY }}
          TLSCHECKIN_BASE_URL: ${{ vars.TLSCHECKIN_BASE_URL }}
        run: |
          set -euo pipefail
          PORT="${APP_PORT}"
          BRANCH_NAME="${REF_SLUG:-${GITHUB_REF_NAME}}"
          test -n "$TLSCHECKIN_BASE_URL"
          test -n "$PORT"
          test -n "$DB_ENCRYPTION_KEY"
          test -n "$SESSION_SECRET"
          test -n "$ADMIN_INITIAL_PASSWORD"
          TLSCHECKIN_HOST="$(node -e 'console.log(new URL(process.argv[1]).hostname)' "$TLSCHECKIN_BASE_URL")"
          TURNSTILE_HOSTNAMES="$TLSCHECKIN_HOST"
          test -n "$TLSCHECKIN_HOST"
          test -n "$TURNSTILE_HOSTNAMES"

          {
            echo "BRANCH_NAME=$BRANCH_NAME"
            echo "TLSCHECKIN_BASE_URL=$TLSCHECKIN_BASE_URL"
            echo "TLSCHECKIN_HOST=$TLSCHECKIN_HOST"
            echo "TLSCHECKIN_IMAGE=$IMAGE_REF"
            echo "PORT=$PORT"
            echo "NODE_ENV=${NODE_ENV:-production}"
            echo "DB_PATH=${DB_PATH:-/app/data/tlscheckin.db}"
            echo "CHECKINS_PATH=${CHECKINS_PATH:-/app/data/checkins.json}"
            echo "DB_ENCRYPTION_KEY=$DB_ENCRYPTION_KEY"
            echo "SESSION_SECRET=$SESSION_SECRET"
            echo "ADMIN_INITIAL_PASSWORD=$ADMIN_INITIAL_PASSWORD"
            echo "APP_TIMEZONE=${APP_TIMEZONE:-Europe/London}"
            echo "TURNSTILE_SITE_KEY=$TURNSTILE_SITE_KEY"
            echo "TURNSTILE_SECRET=$TURNSTILE_SECRET"
            echo "TURNSTILE_HOSTNAMES=$TURNSTILE_HOSTNAMES"
          } > .env

          echo ".env created with $(wc -l < .env) lines."

      - name: Deploy to Server via Tunnel
        env:
          TUNNEL_SERVICE_TOKEN_ID: ${{ secrets.CF_ACCESS_CLIENT_ID }}
          TUNNEL_SERVICE_TOKEN_SECRET: ${{ secrets.CF_ACCESS_CLIENT_SECRET }}
        run: |
          set -euo pipefail
          ssh -v ${SSH_HOST} "mkdir -p ${DEPLOY_PATH}"
          scp -v .env docker-compose.yml ${SSH_HOST}:${DEPLOY_PATH}/

          ssh -v ${SSH_HOST} "cd ${DEPLOY_PATH} && sh -s" <<'REMOTE_DEPLOY'
          set -eu

          BRANCH_NAME="$(awk -F= '$1 == "BRANCH_NAME" { print $2 }' .env | tail -n 1)"
          CONTAINER_NAME="tlscheckin-${BRANCH_NAME:-main}"
          EXISTING_CONTAINER="$(docker ps -aq --filter "name=^/${CONTAINER_NAME}$" | head -n 1)"
          if [ -n "${EXISTING_CONTAINER}" ]; then
            docker rm -f "${EXISTING_CONTAINER}"
          fi

          mkdir -p "persistent-data-${BRANCH_NAME:-main}"
          docker network inspect proxy >/dev/null 2>&1 || docker network create proxy

          docker compose pull tlscheckin
          docker compose up -d --no-build --remove-orphans tlscheckin
          docker image prune -f
          REMOTE_DEPLOY
```

Update `SSH_HOST` and `SSH_USER` if your existing remote server uses different values. If you do not use Cloudflare Access for SSH, remove the `cloudflared` install and `ProxyCommand` parts and use ordinary SSH.

## 5. Prepare Traefik And Cloudflare Routes

TLSCheckin should be routed by Traefik, not directly by Cloudflare Tunnel. The request path is:

```text
Browser -> Cloudflare -> cloudflared -> Traefik -> tlscheckin-main:3110
Browser -> Cloudflare -> cloudflared -> Traefik -> tlscheckin-testing:3111
```

In Cloudflare Zero Trust, the public hostname route should point to your existing Traefik service, using the same pattern that already works for Qglimpse. For example, if the Traefik container is named `traefik` and is attached to the `proxy` network:

| Public hostname | Cloudflare Tunnel service URL |
| --- | --- |
| `tlscheckin.org.uk` | `http://traefik:80` |
| `testing.tlscheckin.org.uk` | `http://traefik:80` |

Use the actual Traefik container name and port from your existing server. Do not set the Cloudflare Tunnel service URL to `https://tlscheckin.org.uk`; that would point the tunnel back to itself. Do not point Cloudflare directly at `http://tlscheckin-main:3110` if you want Traefik to own routing.

SSH for deployment is separate from the TLSCheckin public hostnames. This guide assumes GitHub Actions connects through:

```text
sshjhs.jahosi.co.uk
```

If you also use Cloudflare Access for SSH, keep that SSH public hostname routing to:

```text
ssh://localhost:22
```

## 6. Prepare Cloudflare Turnstile

Create separate Turnstile widgets, or at least separate hostname entries, for production and testing.

Production widget:

- Hostname: `tlscheckin.org.uk`
- GitHub variable: `TURNSTILE_SITE_KEY`
- GitHub secret: `TURNSTILE_SECRET`
- Runtime app variable: `TURNSTILE_HOSTNAMES=tlscheckin.org.uk`, derived from `TLSCHECKIN_BASE_URL` by the deployment workflow.

Testing widget:

- Hostname: `testing.tlscheckin.org.uk`
- GitHub variable: `TURNSTILE_SITE_KEY`
- GitHub secret: `TURNSTILE_SECRET`
- Runtime app variable: `TURNSTILE_HOSTNAMES=testing.tlscheckin.org.uk`, derived from `TLSCHECKIN_BASE_URL` by the deployment workflow.

Cloudflare requires server-side validation through Siteverify. TLSCheckin already validates Turnstile server-side; the migration task is to make sure the Docker runtime receives the secret and hostname list. Do not put `TURNSTILE_SECRET` in repository files or browser code.

## 7. Prepare Debian, Docker, Traefik, And Cloudflare Tunnel

Run on the remote Debian server.

### 7.1 Install Docker

Follow Docker's current Debian documentation. At the time this manual was written, Debian 12 Bookworm and Debian 13 Trixie are supported.

```bash
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

docker --version
docker compose version
```

### 7.2 Create The Deploy User

```bash
sudo adduser dockertunnel
sudo usermod -aG docker dockertunnel
sudo -u dockertunnel mkdir -p /home/dockertunnel/.ssh
sudo chmod 700 /home/dockertunnel/.ssh
```

Add the public half of `SSH_PRIVATE_KEY` to:

```text
/home/dockertunnel/.ssh/authorized_keys
```

Then:

```bash
sudo chmod 600 /home/dockertunnel/.ssh/authorized_keys
```

### 7.3 Create Docker Network

The Compose file expects the existing external Docker network named `proxy`, matching Qglimpse:

```bash
docker network ls | grep proxy || docker network create proxy
```

Traefik must be attached to this network so it can discover and route to `tlscheckin-main:3110` and `tlscheckin-testing:3111`. If `cloudflared` routes to Traefik by container name, `cloudflared` must also be attached to this network.

### 7.4 Confirm Traefik And Cloudflare Tunnel Configuration

Your existing routing stack should have:

- A healthy `cloudflared` connector on the Debian server.
- Traefik attached to the `proxy` Docker network. This is the same external network used by Qglimpse.
- The TLSCheckin containers attached to the `proxy` network.
- Cloudflare Tunnel public hostname routes pointing to Traefik, not directly to TLSCheckin.
- Traefik labels on TLSCheckin for `Host(\`tlscheckin.org.uk\`)` and `Host(\`testing.tlscheckin.org.uk\`)`.
- Optional Cloudflare Access protection for the SSH hostname used by GitHub Actions.

A minimal Traefik network shape is:

```yaml
services:
  traefik:
    image: traefik:v3
    restart: unless-stopped
    networks:
      - proxy

networks:
  proxy:
    external: true
```

If your `cloudflared` connector runs in Docker and points to Traefik by container name, it also needs to be on `proxy`. If it points to Traefik through a host port, it does not need to share the Docker network.

### 7.5 Create Deployment Directories

```bash
sudo -u dockertunnel mkdir -p /home/dockertunnel/tlscheckin.main-3110/persistent-data-main
sudo -u dockertunnel mkdir -p /home/dockertunnel/tlscheckin.testing-3111/persistent-data-testing
```

If migrating existing local data:

```bash
# Run from the old app location or upload files first.
sudo -u dockertunnel cp tlscheckin.db /home/dockertunnel/tlscheckin.main-3110/persistent-data-main/tlscheckin.db
sudo -u dockertunnel cp checkins.json /home/dockertunnel/tlscheckin.main-3110/persistent-data-main/checkins.json
```

Keep file ownership writable by the deploy user:

```bash
sudo chown -R dockertunnel:dockertunnel /home/dockertunnel/tlscheckin.main-3110
sudo chown -R dockertunnel:dockertunnel /home/dockertunnel/tlscheckin.testing-3111
```

## 8. First Test Deployment

1. Create and push a `testing` branch.
2. Confirm the GitHub Actions workflow uses the `testing` environment.
3. Confirm `TLSCHECKIN_BASE_URL` is `https://testing.tlscheckin.org.uk`.
4. Confirm the testing GitHub Environment variable `PORT` is `3111`.
5. Confirm the server directory is `/home/dockertunnel/tlscheckin.testing-3111`.
6. After deployment, run:

```bash
cd /home/dockertunnel/tlscheckin.testing-3111
docker compose ps
docker compose logs --tail=100 tlscheckin
```

7. Open:

```text
https://testing.tlscheckin.org.uk/
https://testing.tlscheckin.org.uk/api/server-time
```

8. Confirm `/api/server-time` returns `Europe/London` and the current admin path.
9. Confirm Turnstile loads and validates against `testing.tlscheckin.org.uk`.

## 9. First Production Deployment

1. Confirm production GitHub Environment values are present.
2. Confirm `TLSCHECKIN_BASE_URL` is `https://tlscheckin.org.uk`; the workflow derives runtime `TURNSTILE_HOSTNAMES=tlscheckin.org.uk` from this value.
3. Confirm existing production database files are copied, if migrating current data.
4. Confirm the existing production `DB_ENCRYPTION_KEY` is used if keeping the old database.
5. Push to `main`.
6. Watch `Actions -> Deploy to Debian`.
7. On the server:

```bash
cd /home/dockertunnel/tlscheckin.main-3110
docker compose ps
docker compose logs --tail=100 tlscheckin
```

8. Open:

```text
https://tlscheckin.org.uk/
https://tlscheckin.org.uk/api/server-time
```

## 10. Post-Deployment Verification

Check the following:

- `docker compose ps` shows the container as `Up`.
- Production logs show `TLSCheckin listening on http://localhost:3110`.
- Testing logs show `TLSCheckin listening on http://localhost:3111`.
- Logs show the correct app timezone.
- Logs show Turnstile enabled with the expected hostname.
- The admin URL from `/api/server-time` works.
- New/edited check-in presets persist after container restart.
- The database file exists under `persistent-data-main` or `persistent-data-testing`.
- Cloudflare Tunnel is healthy.
- Cloudflare Tunnel public hostname routes point to Traefik.
- Traefik has routers for `tlscheckin.org.uk` and `testing.tlscheckin.org.uk`.

Restart test:

```bash
docker compose restart tlscheckin
docker compose logs --tail=100 tlscheckin
```

Image traceability:

```bash
grep TLSCHECKIN_IMAGE .env
docker inspect tlscheckin-main --format '{{.Config.Image}}'
```

## 11. Rollback

Each deployment pins `TLSCHECKIN_IMAGE` to a commit SHA.

To roll back:

```bash
cd /home/dockertunnel/tlscheckin.main-3110
nano .env
```

Change:

```text
TLSCHECKIN_IMAGE=ghcr.io/<owner>/<repo>:<previous-good-sha>
```

Then:

```bash
docker compose pull tlscheckin
docker compose up -d --no-build tlscheckin
docker compose logs --tail=100 tlscheckin
```

Rollback changes the app image. It does not roll back database changes, so back up `/home/dockertunnel/tlscheckin.main-3110/persistent-data-main` before risky releases.

## 12. Troubleshooting

### Container Exits Immediately

Run:

```bash
docker compose logs --tail=200 tlscheckin
```

Common causes:

- Missing `DB_ENCRYPTION_KEY`.
- Missing `SESSION_SECRET`.
- Missing `ADMIN_INITIAL_PASSWORD` on first startup.
- Wrong `DB_ENCRYPTION_KEY` for an existing encrypted database.
- `/app/data` is not writable.

### Container Restarts With `SIGSEGV`

If logs show `npm error signal SIGSEGV` shortly after `node dist/server.js`, check that the image is built from `node:22-bookworm-slim`, not an older Node or Alpine image. TLSCheckin uses `better-sqlite3-multiple-ciphers`, a native SQLite/SQLCipher module; Alpine's musl-based runtime can crash native modules that expect glibc-compatible behavior.

Confirm the Dockerfile starts with:

```dockerfile
FROM node:22-bookworm-slim AS deps
...
FROM node:22-bookworm-slim AS runtime
```

Then commit, push, and rerun the GitHub Actions deployment so GHCR gets a newly built Debian-based image.

### Turnstile Fails

Check:

- `TURNSTILE_SECRET` is present as a GitHub Environment secret.
- `TURNSTILE_SITE_KEY` matches the Cloudflare widget.
- `TURNSTILE_HOSTNAMES` is `tlscheckin.org.uk` or `testing.tlscheckin.org.uk`, not `localhost`.
- The Cloudflare widget allows the same hostname.
- The app logs do not show Siteverify errors.

### Traefik Or Cloudflare Route Fails

Check:

```bash
docker network inspect proxy
docker compose config
docker compose ps
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

Common causes:

- The app container is not on the `proxy` network.
- Traefik is not on the `proxy` network.
- The Cloudflare Tunnel route points directly at TLSCheckin instead of Traefik.
- The Cloudflare Tunnel route points to the public URL instead of the local Traefik service URL.
- `TLSCHECKIN_HOST` is missing from the server `.env`.
- Traefik has stale labels from an older deployment.
- The tunnel connector is not healthy in the Cloudflare dashboard.

Useful checks:

```bash
cd /home/dockertunnel/tlscheckin.main-3110
grep -n "TLSCHECKIN_HOST\|traefik" .env docker-compose.yml
docker compose config
docker network inspect proxy --format '{{range .Containers}}{{.Name}}{{"\n"}}{{end}}' | sort
```

### Compose Still Asks For `TLSCHECKIN_DOMAIN`

This is a stale early Traefik compose file. TLSCheckin now uses `TLSCHECKIN_HOST`, which is derived from `TLSCHECKIN_BASE_URL` by the workflow. Confirm the server copy of `docker-compose.yml` references `TLSCHECKIN_HOST`, not `TLSCHECKIN_DOMAIN`:

```bash
cd /home/dockertunnel/tlscheckin.main-3110
grep -n "TLSCHECKIN_DOMAIN" docker-compose.yml || true
grep -n "TLSCHECKIN_HOST\|traefik\|proxy" docker-compose.yml
```

If the stale labels are present, rerun the GitHub Actions deployment after committing the current `docker-compose.yml`, or manually copy the updated file to the deploy directory.

### GitHub Actions Cannot Pull Or Push GHCR

Check:

- Workflow has `packages: write`.
- If the GHCR package is private, the server is already logged in with `docker login ghcr.io`.
- The image name is `ghcr.io/<owner>/<repo>:<sha>`.
- The server can run `docker compose pull tlscheckin`.

## 13. Cutover Checklist

- Dockerfile added.
- `.dockerignore` added.
- `docker-compose.yml` added.
- `.github/workflows/deploy.yml` added.
- GitHub Environments `production` and `testing` created.
- All `.env` values moved to GitHub variables/secrets.
- No secret values committed.
- Cloudflare Tunnel public hostname routes point to Traefik for `tlscheckin.org.uk` and `testing.tlscheckin.org.uk`.
- Traefik labels are present in `docker-compose.yml`.
- Cloudflare Turnstile configured for both hostnames.
- Debian Docker Engine and Compose plugin installed.
- Traefik attached to the `proxy` network.
- Persistent data directories created and backed up.
- Testing deployment verified.
- Production deployment verified.
