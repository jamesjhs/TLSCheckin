# TLSCheckin Docker Migration Manual

This manual moves TLSCheckin from a direct Node/pm2 style deployment to a Docker Compose deployment behind Traefik on a Debian server.

Target hostnames:

- Production: `https://tlscheckin.org.uk`
- Testing: `https://testing.tlscheckin.org.uk`

The pattern is based on the Docker setup in `C:\GitHub\Qglimpse`: GitHub Actions builds a GHCR image, writes a runtime `.env` from GitHub environment variables/secrets, copies only `.env` and `docker-compose.yml` to the server, then runs `docker compose pull` and `docker compose up -d --no-build`.

Authoritative docs checked for this guide:

- Docker Debian install: https://docs.docker.com/engine/install/debian/
- Traefik Docker provider and labels: https://doc.traefik.io/traefik/providers/docker/
- Traefik TLS routers/certificate resolvers: https://doc.traefik.io/traefik/reference/routing-configuration/http/tls/overview/
- GitHub Actions variables: https://docs.github.com/en/actions/concepts/workflows-and-actions/variables
- GitHub Actions secrets: https://docs.github.com/en/actions/reference/security/secrets
- Cloudflare DNS records: https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/
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
  -> Docker Compose restarts tlscheckin on the external proxy network
  -> Traefik routes tlscheckin.org.uk or testing.tlscheckin.org.uk to the container
```

Production and testing must use separate GitHub Environments, separate persistent data directories, and separate Cloudflare Turnstile hostnames/secrets.

## 2. Add Docker Files To TLSCheckin

Create `Dockerfile` in the repository root:

```dockerfile
FROM node:20-alpine AS deps

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

FROM deps AS build

COPY tsconfig.json ./
COPY src src
COPY public public
COPY checkins.json checkins.json
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-alpine AS runtime

ENV NODE_ENV=production
ARG APP_PORT=9110
ENV PORT=${APP_PORT}

WORKDIR /app

RUN apk add --no-cache libstdc++

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
      - "traefik.http.routers.tlscheckin-${BRANCH_NAME:-main}.rule=Host(`${TLSCHECKIN_DOMAIN:?TLSCHECKIN_DOMAIN must be set}`)"
      - "traefik.http.routers.tlscheckin-${BRANCH_NAME:-main}.entrypoints=websecure"
      - "traefik.http.routers.tlscheckin-${BRANCH_NAME:-main}.tls=true"
      - "traefik.http.routers.tlscheckin-${BRANCH_NAME:-main}.tls.certresolver=${TRAEFIK_CERT_RESOLVER:-letsencrypt}"
      - "traefik.http.services.tlscheckin-${BRANCH_NAME:-main}.loadbalancer.server.port=${PORT:?PORT must be set}"

networks:
  proxy:
    external: true
```

If your existing Traefik applies `websecure`, TLS, and certificate resolver defaults globally, those three router labels may be redundant. Keeping them explicit makes this service portable and easier to inspect in the Traefik dashboard.

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
| `GHCR_USERNAME` | GitHub user/bot that can pull the image. | Same. |
| `GHCR_TOKEN` | Token with GHCR package read access. | Same. |

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
| `PORT` | `9110` | `9110` |
| `NODE_ENV` | `production` | `production` |
| `DB_PATH` | `/app/data/tlscheckin.db` | `/app/data/tlscheckin.db` |
| `CHECKINS_PATH` | `/app/data/checkins.json` | `/app/data/checkins.json` |
| `APP_TIMEZONE` | `Europe/London` | `Europe/London` |
| `TURNSTILE_SITE_KEY` | Site key for `tlscheckin.org.uk`. | Site key for `testing.tlscheckin.org.uk`. |
| `TURNSTILE_HOSTNAMES` | `tlscheckin.org.uk` | `testing.tlscheckin.org.uk` |
| `TLSCHECKIN_BASE_URL` | `https://tlscheckin.org.uk` | `https://testing.tlscheckin.org.uk` |
| `TRAEFIK_CERT_RESOLVER` | Your Traefik resolver name, for example `letsencrypt`. | Same. |

`TLSCHECKIN_BASE_URL` is used by the deployment workflow to derive `TLSCHECKIN_DOMAIN`; the current app does not read it directly.

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
  SSH_HOST: ssh.tlscheckin.org.uk
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
          APP_PORT="${{ vars.PORT || '9110' }}"
          TLSCHECKIN_BASE_URL="${{ vars.TLSCHECKIN_BASE_URL }}"
          test -n "$TLSCHECKIN_BASE_URL"
          TLSCHECKIN_DOMAIN="$(node -e "console.log(new URL(process.argv[1]).hostname)" "$TLSCHECKIN_BASE_URL")"

          if [ "$REF_SLUG" = "main" ] && [ "$TLSCHECKIN_DOMAIN" != "tlscheckin.org.uk" ]; then
            echo "::error::main must deploy to https://tlscheckin.org.uk"
            exit 1
          fi

          if [ "$REF_SLUG" = "testing" ] && [ "$TLSCHECKIN_DOMAIN" != "testing.tlscheckin.org.uk" ]; then
            echo "::error::testing must deploy to https://testing.tlscheckin.org.uk"
            exit 1
          fi

          DEPLOY_PATH="/home/${SSH_USER}/tlscheckin.${REF_SLUG}-${APP_PORT}"
          echo "REF_SLUG=${REF_SLUG}" >> "$GITHUB_ENV"
          echo "APP_PORT=${APP_PORT}" >> "$GITHUB_ENV"
          echo "TLSCHECKIN_DOMAIN=${TLSCHECKIN_DOMAIN}" >> "$GITHUB_ENV"
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
            APP_PORT=${{ vars.PORT || '9110' }}
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
          TURNSTILE_HOSTNAMES: ${{ vars.TURNSTILE_HOSTNAMES }}
          TRAEFIK_CERT_RESOLVER: ${{ vars.TRAEFIK_CERT_RESOLVER }}
        run: |
          set -euo pipefail
          PORT="${APP_PORT:-${PORT:-9110}}"
          BRANCH_NAME="${REF_SLUG:-${GITHUB_REF_NAME}}"
          test -n "$TLSCHECKIN_DOMAIN"
          test -n "$PORT"
          test -n "$DB_ENCRYPTION_KEY"
          test -n "$SESSION_SECRET"
          test -n "$ADMIN_INITIAL_PASSWORD"

          {
            echo "BRANCH_NAME=$BRANCH_NAME"
            echo "TLSCHECKIN_DOMAIN=$TLSCHECKIN_DOMAIN"
            echo "TLSCHECKIN_IMAGE=$IMAGE_REF"
            echo "TRAEFIK_CERT_RESOLVER=${TRAEFIK_CERT_RESOLVER:-letsencrypt}"
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
          GHCR_USERNAME: ${{ secrets.GHCR_USERNAME }}
          GHCR_TOKEN: ${{ secrets.GHCR_TOKEN }}
        run: |
          set -euo pipefail
          ssh -v ${SSH_HOST} "mkdir -p ${DEPLOY_PATH}"
          scp -v .env docker-compose.yml ${SSH_HOST}:${DEPLOY_PATH}/

          REMOTE_GHCR_USERNAME=$(printf '%q' "$GHCR_USERNAME")
          REMOTE_GHCR_TOKEN=$(printf '%q' "$GHCR_TOKEN")
          ssh -v ${SSH_HOST} "cd ${DEPLOY_PATH} && GHCR_USERNAME=${REMOTE_GHCR_USERNAME} GHCR_TOKEN=${REMOTE_GHCR_TOKEN} sh -s" <<'REMOTE_DEPLOY'
          set -eu
          if [ -n "${GHCR_USERNAME}" ] && [ -n "${GHCR_TOKEN}" ]; then
            echo "${GHCR_TOKEN}" | docker login ghcr.io -u "${GHCR_USERNAME}" --password-stdin
          fi

          BRANCH_NAME="$(awk -F= '$1 == "BRANCH_NAME" { print $2 }' .env | tail -n 1)"
          CONTAINER_NAME="tlscheckin-${BRANCH_NAME:-main}"
          EXISTING_CONTAINER="$(docker ps -aq --filter "name=^/${CONTAINER_NAME}$" | head -n 1)"
          if [ -n "${EXISTING_CONTAINER}" ]; then
            docker rm -f "${EXISTING_CONTAINER}"
          fi

          mkdir -p "persistent-data-${BRANCH_NAME:-main}"

          docker compose pull tlscheckin
          docker compose up -d --no-build --remove-orphans tlscheckin
          docker image prune -f
          REMOTE_DEPLOY
```

Update `SSH_HOST` and `SSH_USER` if your existing remote server uses different values. If you do not use Cloudflare Access for SSH, remove the `cloudflared` install and `ProxyCommand` parts and use ordinary SSH.

## 5. Prepare Cloudflare DNS

In Cloudflare DNS for `tlscheckin.org.uk`, create records for:

| Type | Name | Target | Proxy status |
| --- | --- | --- | --- |
| `A` | `@` | Your Debian server IPv4 address | Proxied if Traefik is reachable on 443 from Cloudflare |
| `AAAA` | `@` | Your Debian server IPv6 address, if used | Proxied |
| `A` or `CNAME` | `testing` | Same server IP, or CNAME to `tlscheckin.org.uk` | Proxied |
| `A` or `CNAME` | `ssh` | Server IP or tunnel hostname, if using SSH over Cloudflare Access | Usually proxied/Access-managed |

Cloudflare's DNS documentation notes that `A`, `AAAA`, and `CNAME` records can be proxied; when proxied, Cloudflare intercepts HTTP(S) requests before they reach your origin.

Recommended SSL/TLS mode in Cloudflare:

1. Go to `SSL/TLS`.
2. Use `Full (strict)` if Traefik has valid Let's Encrypt certificates.
3. Keep HTTP to HTTPS redirection either in Cloudflare or Traefik, not both if it creates loops.

## 6. Prepare Cloudflare Turnstile

Create separate Turnstile widgets, or at least separate hostname entries, for production and testing.

Production widget:

- Hostname: `tlscheckin.org.uk`
- GitHub variable: `TURNSTILE_SITE_KEY`
- GitHub secret: `TURNSTILE_SECRET`
- App variable: `TURNSTILE_HOSTNAMES=tlscheckin.org.uk`

Testing widget:

- Hostname: `testing.tlscheckin.org.uk`
- GitHub variable: `TURNSTILE_SITE_KEY`
- GitHub secret: `TURNSTILE_SECRET`
- App variable: `TURNSTILE_HOSTNAMES=testing.tlscheckin.org.uk`

Cloudflare requires server-side validation through Siteverify. TLSCheckin already validates Turnstile server-side; the migration task is to make sure the Docker runtime receives the secret and hostname list. Do not put `TURNSTILE_SECRET` in repository files or browser code.

## 7. Prepare Debian, Docker, And Traefik

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

The Compose file expects an external Traefik network named `proxy`:

```bash
docker network ls | grep proxy || docker network create proxy
```

Traefik must also be attached to this network.

### 7.4 Confirm Traefik Static Configuration

Your existing Traefik container should have:

- Docker provider enabled.
- An entrypoint named `websecure` on port `443`.
- A certificate resolver matching `TRAEFIK_CERT_RESOLVER`, for example `letsencrypt`.
- Access to `/var/run/docker.sock`.
- Membership in the `proxy` Docker network.

A minimal Traefik compose shape is:

```yaml
services:
  traefik:
    image: traefik:v3
    restart: unless-stopped
    command:
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.letsencrypt.acme.email=you@example.com"
      - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge=true"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./letsencrypt:/letsencrypt
    networks:
      - proxy

networks:
  proxy:
    external: true
```

If Cloudflare orange-cloud proxy is enabled and port 80 validation is blocked in your setup, use a DNS challenge resolver instead of HTTP challenge.

### 7.5 Create Deployment Directories

```bash
sudo -u dockertunnel mkdir -p /home/dockertunnel/tlscheckin.main-9110/persistent-data-main
sudo -u dockertunnel mkdir -p /home/dockertunnel/tlscheckin.testing-9110/persistent-data-testing
```

If migrating existing local data:

```bash
# Run from the old app location or upload files first.
sudo -u dockertunnel cp tlscheckin.db /home/dockertunnel/tlscheckin.main-9110/persistent-data-main/tlscheckin.db
sudo -u dockertunnel cp checkins.json /home/dockertunnel/tlscheckin.main-9110/persistent-data-main/checkins.json
```

Keep file ownership writable by the deploy user:

```bash
sudo chown -R dockertunnel:dockertunnel /home/dockertunnel/tlscheckin.main-9110
sudo chown -R dockertunnel:dockertunnel /home/dockertunnel/tlscheckin.testing-9110
```

## 8. First Test Deployment

1. Create and push a `testing` branch.
2. Confirm the GitHub Actions workflow uses the `testing` environment.
3. Confirm the generated domain is `testing.tlscheckin.org.uk`.
4. Confirm the server directory is `/home/dockertunnel/tlscheckin.testing-9110`.
5. After deployment, run:

```bash
cd /home/dockertunnel/tlscheckin.testing-9110
docker compose ps
docker compose logs --tail=100 tlscheckin
```

6. Open:

```text
https://testing.tlscheckin.org.uk/
https://testing.tlscheckin.org.uk/api/server-time
```

7. Confirm `/api/server-time` returns `Europe/London` and the current admin path.
8. Confirm Turnstile loads and validates against `testing.tlscheckin.org.uk`.

## 9. First Production Deployment

1. Confirm production GitHub Environment values are present.
2. Confirm `TURNSTILE_HOSTNAMES` is exactly `tlscheckin.org.uk`.
3. Confirm existing production database files are copied, if migrating current data.
4. Confirm the existing production `DB_ENCRYPTION_KEY` is used if keeping the old database.
5. Push to `main`.
6. Watch `Actions -> Deploy to Debian`.
7. On the server:

```bash
cd /home/dockertunnel/tlscheckin.main-9110
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
- Logs show `TLSCheckin listening on http://localhost:9110`.
- Logs show the correct app timezone.
- Logs show Turnstile enabled with the expected hostname.
- The admin URL from `/api/server-time` works.
- New/edited check-in presets persist after container restart.
- The database file exists under `persistent-data-main` or `persistent-data-testing`.
- Cloudflare DNS is proxied as intended.
- Traefik has a router for the correct hostname and service port.

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
cd /home/dockertunnel/tlscheckin.main-9110
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

Rollback changes the app image. It does not roll back database changes, so back up `/home/dockertunnel/tlscheckin.main-9110/persistent-data-main` before risky releases.

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

### Turnstile Fails

Check:

- `TURNSTILE_SECRET` is present as a GitHub Environment secret.
- `TURNSTILE_SITE_KEY` matches the Cloudflare widget.
- `TURNSTILE_HOSTNAMES` is `tlscheckin.org.uk` or `testing.tlscheckin.org.uk`, not `localhost`.
- The Cloudflare widget allows the same hostname.
- The app logs do not show Siteverify errors.

### Traefik Returns 404

Check:

```bash
docker network inspect proxy
docker compose config
docker compose ps
```

Common causes:

- The app container is not on the `proxy` network.
- Traefik is not on the `proxy` network.
- `TLSCHECKIN_DOMAIN` was not written to `.env`.
- The router entrypoint name is not `websecure` on your Traefik install.
- The certificate resolver name does not match your Traefik static config.

### Cloudflare Shows 525 Or 526

Check:

- Traefik has issued a valid certificate.
- Cloudflare SSL/TLS mode is compatible with the origin certificate.
- Port `443` reaches Traefik on the server.
- If using `Full (strict)`, the Traefik certificate must be valid for the requested hostname.

### GitHub Actions Cannot Pull Or Push GHCR

Check:

- Workflow has `packages: write`.
- The server-side `GHCR_TOKEN` has package read access.
- The image name is `ghcr.io/<owner>/<repo>:<sha>`.
- The server can run `docker login ghcr.io`.

## 13. Cutover Checklist

- Dockerfile added.
- `.dockerignore` added.
- `docker-compose.yml` added.
- `.github/workflows/deploy.yml` added.
- GitHub Environments `production` and `testing` created.
- All `.env` values moved to GitHub variables/secrets.
- No secret values committed.
- Cloudflare DNS records created for `tlscheckin.org.uk` and `testing.tlscheckin.org.uk`.
- Cloudflare Turnstile configured for both hostnames.
- Debian Docker Engine and Compose plugin installed.
- Traefik attached to the `proxy` network.
- Persistent data directories created and backed up.
- Testing deployment verified.
- Production deployment verified.
