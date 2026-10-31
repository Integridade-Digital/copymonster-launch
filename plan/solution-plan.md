# ARCHITECTURAL SOLUTION PLAN: Secure dsh-server-login + CopyMonster SaaS Integration
## Primary App Restoration (:3080), Edge Segregation (Cloudflare Tunnel), Desktop Suppression, and OS Hard Isolation (Linux Account Mode)

> **Status:** Architecture Proposal & Step-by-Step Execution Plan (Approved Direction with Conditional Direct Sign-Up Integration)  
> **Date:** October 31, 2026  
> **Scope:** Immediate restoration of `copymonster.service` on port 3080, relocation of `dsh-server-login` to loopback port 3081, suppression of raw file desktop, wildcard subdomain routing, inclusion of "Username / Subdomain" directly in initial sign-up, Supabase SSO session bridging, and hard Linux account isolation.  
> **Strict Rule:** No production code or VPS configuration changes will be executed until the pre-execution code components are audited and explicitly approved.

---

## 1. Executive Summary & Formal Retrospective on Planning Failure

CopyMonster is an enterprise SaaS platform (a dedicated fork under the MIT License of DeepSeek Harness / DSH) specializing in high-conversion copywriting automation, launch funnels, and persistent strategic brand memory (Brand DNA Engine). To safely unlock the plugin marketplace (**7,200+ community and internal plugins**) without endangering host system integrity or tenant data, the `dsh-server-login` supervisor was selected to provide Linux OS-level account isolation (`account` mode).

### Explicit Retrospective on the Architecture Breakdown
During the prior rollout proposal (`docs/roadmap/plano-isolamento-dsh-server-login.md`), a severe architectural collision occurred:
1. **Critical Port Collision (Port 3080):** The `dsh-server-login` process was bound to `127.0.0.1:3080`. This overlooked that the primary CopyMonster SaaS application (`copymonster.service`) historically binds to port `3080`.
2. **SaaS Outage & Dashboard Inaccessibility:** Starting `dsh-server-login` on port 3080 either triggered a fatal socket collision (`EADDRINUSE`) or hijacked the Cloudflare Tunnel ingress target. The core `copymonster.service` was knocked offline, rendering the customer dashboard inaccessible.
3. **Severe UX Degradation & Desktop Leak:** Traffic to `app.copymonster.co` was routed to the raw `dsh-server-login` interface, exposing an unbranded file manager desktop (`web/desktop.html`) with manual launch buttons ("Launch DSH"). This disrupted CopyMonster's proprietary onboarding flow, stripped away the Dark/Gold brand identity, and created user confusion.

### Target Architecture Commitment
The CopyMonster SaaS web application (`copymonster.service`) remains the **sole authoritative and visible entry point** of the product. The `dsh-server-login` instance must operate strictly as an **invisible headless infrastructure orchestrator** on an isolated internal loopback port (`127.0.0.1:3081`). It will never bind to port 3080, never serve an intermediate desktop, and will run entirely in the background.

---

## 2. Corrected Network & Routing Topology

The updated topology completely segregates the client-facing SaaS application from the tenant sandboxes:

```text
                               INTERNET (HTTPS Clients)
                                          │
                                          ▼
             ┌─────────────────────────────────────────────────────────┐
             │              Cloudflare Edge (Zero Trust / DNS)         │
             │   - Wildcard SSL Certificate (*.app.copymonster.co)     │
             │   - WAF Edge, TLS 1.3 Termination, DDoS Mitigation      │
             └────────────────────────────┬────────────────────────────┘
                                          │ (Encrypted cloudflared tunnel)
                                          ▼
             ┌─────────────────────────────────────────────────────────┐
             │                     Host VPS (Linux)                    │
             │                                                         │
             │  cloudflared tunnel daemon                              │
             │  ├── Ingress rule 1:                                    │
             │  │   Host: app.copymonster.co                           │
             │  │   Target: http://127.0.0.1:3080 (copymonster.service)│
             │  │                                                      │
             │  └── Ingress rule 2:                                    │
             │      Host: *.app.copymonster.co                         │
             │      Target: http://127.0.0.1:3081 (dsh-orchestrator)   │
             └────────────────────────────┬────────────────────────────┘
                                          │
             ┌────────────────────────────┴────────────────────────────┐
             │                                                         │
             ▼                                                         ▼
┌──────────────────────────┐                      ┌──────────────────────────┐
│   copymonster.service    │                      │ dsh-orchestrator.service │
│   Port: 127.0.0.1:3080   │                      │   Port: 127.0.0.1:3081   │
├──────────────────────────┤                      ├──────────────────────────┤
│ - Core SaaS Platform     │                      │ - Invisible Supervisor   │
│ - Brand DNA / Copy Engine│                      │ - Linux Account Sandbox  │
│ - Supabase Auth & DB     │                      │ - Subdomain Proxy & WS   │
│ - Direct Sign-Up & Subdom│                      │ - Auto-launch / Spin-up  │
└──────────────────────────┘                      └─────────────┬────────────┘
                                                                │
                                              Per-tenant sandboxes (UID 100000+)
                                                                ▼
                                                  ┌──────────────────────────┐
                                                  │ dsh child process        │
                                                  │ User: dsh_tenant_alpha   │
                                                  │ UID: 100042 / GID: 100000│
                                                  │ Home: /home/dsh_... (700)│
                                                  │ Port: 127.0.0.1:31042    │
                                                  └──────────────────────────┘
```

---

## 3. Direct Sign-Up: Username / Subdomain Field in Initial Registration

### 3.1 Initial Sign-Up Form Specification
Rather than deferring subdomain creation to a multi-step post-login onboarding wizard, the registration form on `app.copymonster.co/register` captures the **Username / Subdomain** directly during account creation.

The registration form contains:
1. **Full Name** (`name`): User's legal/display name.
2. **Work Email** (`email`): Valid email address used for Supabase Auth credentials.
3. **Password** (`password`): Strong password conforming to platform security standards.
4. **Workspace Subdomain / Username** (`username`): The unique tenant slug that defines their personal sandbox environment at `<username>.app.copymonster.co`.

```text
┌──────────────────────────────────────────────────────────┐
│                 CopyMonster Account Setup                │
│                                                          │
│  Full Name                                               │
│  [ John Doe                                            ] │
│                                                          │
│  Work Email                                              │
│  [ john@company.com                                    ] │
│                                                          │
│  Password                                                │
│  [ •••••••••••••••••                                   ] │
│                                                          │
│  Workspace Subdomain / Username                          │
│  [ johndoe                                             ] │
│  Your sandbox will live at: johndoe.app.copymonster.co   │
│  ✓ Subdomain available                                   │
│                                                          │
│  [ Create Account & Initialize Secure Workspace ]        │
└──────────────────────────────────────────────────────────┘
```

### 3.2 Real-Time Validation & Reserved Words
- **Formatting Constraint:** Strictly lowercase alphanumeric and hyphens: `^[a-z0-9]([a-z0-9-]{1,18}[a-z0-9])?$`.
- **Length Constraint:** 3 to 20 characters.
- **Reserved Subdomains (Blacklist):** `app`, `api`, `admin`, `auth`, `login`, `register`, `dashboard`, `mail`, `status`, `portal`, `docs`, `cdn`, `assets`, `webhook`, `stripe`, `supabase`, `static`, `staging`, `dev`, `test`, `copymonster`.
- **Instant Availability Feedback:** Debounced (300ms) check querying `public.tenants.slug` and `public.users.username` in Supabase to confirm uniqueness before submission.

### 3.3 Registration Execution Pipeline
1. Client submits form to Supabase Auth (`supabase.auth.signUp()`) with user metadata `{ username, full_name }`.
2. Database trigger or edge function populates `public.users` and assigns/creates a tenant record linking the chosen slug.
3. Upon confirmation/session grant, CopyMonster invokes the orchestrator session endpoint (`/api/auth/session-token`) providing the Supabase JWT.
4. The user is redirected to `https://<username>.app.copymonster.co/` with the wildcard cookie already active.

---

## 4. Four Pre-Execution Implementation Deliverables

Before executing any production commands or updating system services on the VPS, the following four concrete modules must be implemented and verified in the codebase.

---

### Deliverable 1: OS Provisioning Script (`/usr/local/bin/dsh-provision.sh`)
**Objective:** Deterministically create Linux system accounts for sandbox isolation, ensuring home directory security (`chmod 700`) and standard workspace scaffolding.

#### Specification:
- **Location on Host:** `/usr/local/bin/dsh-provision.sh` (owned by `root:root`, permissions `0750`).
- **Signature:** `dsh-provision.sh <username> <uid>`
- **Logic:**
  1. Validates username against regex `^[a-z0-9_-]{3,32}$`.
  2. Validates UID is an integer within the allocated range (`100000` to `200000`).
  3. Ensures shared system group `dshusers` exists (`groupadd -f -g 100000 dshusers`).
  4. Idempotently creates or updates the user account:
     `useradd -M -u <uid> -g dshusers -s /bin/bash -c "CopyMonster Sandbox <username>" <username>`
  5. Creates home root `/home/<username>` with permissions `0700` owned by `<username>:dshusers`.
  6. Creates subdirectories `/home/<username>/workspace` and `/home/<username>/.dsh` with permissions `0700`.
  7. Exits with code `0` on success or clean stderr message and non-zero code on error.

```bash
#!/usr/bin/env bash
# /usr/local/bin/dsh-provision.sh
# Provisioning script for CopyMonster dsh-server-login tenant isolation
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <username> <uid>" >&2
  exit 1
fi

USERNAME="$1"
UID_NUM="$2"

if ! [[ "${USERNAME}" =~ ^[a-z0-9_-]{3,32}$ ]]; then
  echo "Error: Invalid username format '${USERNAME}'" >&2
  exit 2
fi

if ! [[ "${UID_NUM}" =~ ^[0-9]+$ ]] || [[ "${UID_NUM}" -lt 100000 ]] || [[ "${UID_NUM}" -gt 300000 ]]; then
  echo "Error: Invalid UID '${UID_NUM}' (must be between 100000 and 300000)" >&2
  exit 3
fi

# Ensure primary isolation group exists
if ! getent group dshusers >/dev/null 2>&1; then
  groupadd -g 100000 dshusers
fi

# Create user if missing
if ! id -u "${USERNAME}" >/dev/null 2>&1; then
  useradd -M -u "${UID_NUM}" -g dshusers -s /bin/bash -c "CopyMonster Sandbox ${USERNAME}" "${USERNAME}"
fi

USER_HOME="/home/${USERNAME}"
mkdir -p "${USER_HOME}/workspace"
mkdir -p "${USER_HOME}/.dsh"

chown -R "${USERNAME}:dshusers" "${USER_HOME}"
chmod 700 "${USER_HOME}"
chmod 700 "${USER_HOME}/workspace"
chmod 700 "${USER_HOME}/.dsh"

echo "SUCCESS: Provisioned ${USERNAME} (UID ${UID_NUM}) at ${USER_HOME}"
exit 0
```

---

### Deliverable 2: Orchestrator Session Route (`/api/auth/session-token`)
**Objective:** Provide a secure Single Sign-On bridge between CopyMonster's Supabase Auth and the `dsh-server-login` orchestrator without exposing raw passwords.

#### Specification:
- **Route:** `POST /api/auth/session-token` on orchestrator (`127.0.0.1:3081`).
- **Payload:** `{ "supabaseJwt": "<raw_jwt>", "username": "<username>" }`
- **Validation:**
  1. Verifies the Supabase JWT using the configured `SUPABASE_JWT_SECRET` (HMAC SHA-256) or Supabase project JWKS.
  2. Confirms that `token.sub` corresponds to the authenticated user ID and email matches.
  3. Ensures or provisions the user record in orchestrator's database (SQLite `dsh-server-login.db`), calculating deterministic UID: `baseUid + user.row_id`.
  4. Triggers background/local execution of `dsh-provision.sh` if the Linux account does not exist yet.
  5. Generates an opaque session token (`newSessionToken()`) and registers it in `sessions` table.
  6. Returns `Set-Cookie` header for `sid=<token>` with:
     - `Domain=.app.copymonster.co`
     - `Path=/`
     - `HttpOnly`
     - `Secure`
     - `SameSite=None` (or `Lax` behind trusted edge)
     - `Max-Age=2592000` (30 days)
  7. Returns `{ ok: true, user: { id, username }, redirectUrl: "https://<username>.app.copymonster.co/" }`.

---

### Deliverable 3: CopyMonster Auto-Launch Transition Screen
**Objective:** Completely eliminate and suppress `desktop.html`. When a user navigates to `https://<username>.app.copymonster.co/` and their DSH instance is currently stopped or spinning up, render a branded Dark/Gold launch screen that automatically starts the instance and redirects upon readiness.

#### Specification:
- **Location:** `web/launching.html` in `copymonster-dsh-server-login`.
- **Trigger:** Subdomain reverse proxy hook in `src/supervisor/proxy.ts`. If `resolveSubdomainAccess()` detects the instance is not running, instead of returning raw `404 not_running`, it:
  1. Asynchronously invokes `app.supervisor.launch(user.id, userWorkspaceFolder)`.
  2. Serves `launching.html` (HTTP 200) with dynamic injection or polling.
- **UX & Branding:**
  - Background: Deep obsidian/slate (`#0A0A0C` to `#121216`).
  - Accents: Metallic gold gradients (`#D4AF37`, `#F2D06B`, `#997D26`).
  - Copy: *"Initializing your secure CopyMonster workspace..."*
  - Live Status Indicator: Animated gold spinner and step progress bar (*"Allocating Linux sandbox" -> "Loading Brand DNA engine" -> "Connecting secure workspace"*).
  - Client Polling: Every 1.5 seconds queries `/api/dsh/status`. As soon as status returns `running: true`, `window.location.reload()` hands control over to the child DSH interface.

---

### Deliverable 4: Inactivity Idle Timeout (30-Minute Automatic Spin-down)
**Objective:** Prevent server memory and process exhaustion by automatically terminating dormant child DSH instances when no active user sessions or WebSockets are present.

#### Specification:
- **Location:** `src/supervisor/orchestrator.ts` and `src/supervisor/proxy.ts`.
- **Implementation:**
  1. Orchestrator tracks active WebSocket tunnels per user ID in `activeSockets: Map<string, Set<Socket>>`.
  2. When the count of active WebSockets for a user drops to zero, an idle timer is armed for **30 minutes** (`1800000ms`).
  3. If a new request or WebSocket upgrade arrives before timeout, the timer is cleared.
  4. Upon timer expiration:
     - Sends clean termination signal (`SIGTERM`) to the child DSH process.
     - Waits up to 10 seconds for graceful exit, then escalates to `SIGKILL`.
     - Logs event: `[supervisor] Idle timeout reached for user <id> (<username>). Process shut down.`
     - Reclaims assigned loopback port for the port pool.

---

## 5. Five-Phase Implementation & Rollout Sequence

```text
┌───────────────────────────────────────────────────────────────────────────┐
│                           ROLLOUT EXECUTION ROADMAP                       │
├───────────────────────────────────────────────────────────────────────────┤
│ Phase 1: RESTORE copymonster.service ON 3080                              │
│          - Halt any rogue process on 3080                                 │
│          - Restart & verify copymonster.service                           │
│          - Confirm app.copymonster.co returns primary SaaS                │
├───────────────────────────────────────────────────────────────────────────┤
│ Phase 2: CLOUDFLARE TUNNEL INGRESS SEGREGATION                            │
│          - Update cloudflared config.yml                                  │
│          - Rule 1: app.copymonster.co -> http://127.0.0.1:3080            │
│          - Rule 2: *.app.copymonster.co -> http://127.0.0.1:3081          │
│          - Restart cloudflared and validate split routing                 │
├───────────────────────────────────────────────────────────────────────────┤
│ Phase 3: ORCHESTRATOR CONFIGURATION ON LOOPBACK 3081                      │
│          - Deploy systemd unit dsh-orchestrator.service on port 3081      │
│          - Configure environment: BASE_DOMAIN, COOKIE_DOMAIN, PORT_GUARD  │
│          - Deploy /usr/local/bin/dsh-provision.sh                         │
├───────────────────────────────────────────────────────────────────────────┤
│ Phase 4: PRIMARY APP INTEGRATION & SSO BRIDGE                             │
│          - Incorporate Subdomain field in RegisterPage.tsx                │
│          - Add backend bridge invoking /api/auth/session-token on login   │
│          - Set wildcard session cookie (.app.copymonster.co)              │
├───────────────────────────────────────────────────────────────────────────┤
│ Phase 5: END-TO-END VERIFICATION & HARD ISOLATION AUDIT                   │
│          - Verify User A cannot access /home/User_B                       │
│          - Verify loopback port guard blocks cross-process port sniffing  │
│          - Verify idle spin-down after 30 minutes                         │
└───────────────────────────────────────────────────────────────────────────┘
```

### Phase 1: Restoration of `copymonster.service` on Port 3080
*Pre-condition: Nothing else touches production until the SaaS is verified healthy.*
1. Inspect running processes on port 3080: `ss -tulpn | grep :3080`
2. Stop legacy or misplaced `dsh-server-login` services.
3. Restart `copymonster.service`: `systemctl restart copymonster.service`
4. Confirm HTTP response: `curl -I http://127.0.0.1:3080/`
5. Verify public accessibility at `https://app.copymonster.co/`.

### Phase 2: Cloudflare Tunnel Configuration (`cloudflared/config.yml`)
Configure split routing at the edge:
```yaml
tunnel: <TUNNEL_UUID>
credentials-file: /etc/cloudflared/<TUNNEL_UUID>.json

ingress:
  # Primary CopyMonster SaaS Platform
  - hostname: app.copymonster.co
    service: http://127.0.0.1:3080
    originRequest:
      httpHostHeader: app.copymonster.co
      connectTimeout: 30s

  # Isolated Tenant Sandboxes (Wildcard)
  - hostname: "*.app.copymonster.co"
    service: http://127.0.0.1:3081
    originRequest:
      connectTimeout: 60s
      noChunkedEncoding: true

  # Default Fallback
  - service: http_status:404
```

### Phase 3: Orchestrator Service on Loopback Port 3081
Create `/etc/systemd/system/dsh-orchestrator.service`:
```ini
[Unit]
Description=CopyMonster DSH Headless Orchestrator
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/copymonster-dsh-server-login
Environment=NODE_ENV=production
Environment=PORT=3081
Environment=HOST=127.0.0.1
Environment=DSH_SERVER_LOGIN_ISOLATION_MODE=account
Environment=DSH_SERVER_LOGIN_PORT_GUARD=true
Environment=DSH_SERVER_LOGIN_BASE_DOMAIN=app.copymonster.co
Environment=DSH_SERVER_LOGIN_COOKIE_DOMAIN=.app.copymonster.co
Environment=DSH_SERVER_LOGIN_BASE_UID=100000
Environment=DSH_SERVER_LOGIN_DATA_ROOT=/var/lib/copymonster-dsh
EnvironmentFile=-/opt/copymonster-dsh-server-login/.env
ExecStart=/usr/bin/node dist/src/cli.js serve
Restart=always
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

---

## 6. Security Verification & Isolation Testing Protocol

### 6.1 Test A: Filesystem Hard Isolation
```bash
# Executed as User A (UID 100001)
su - dsh_tenant_a -c "ls -la /home/dsh_tenant_b"
# Expected outcome: Permission denied (Exit code 1)
```

### 6.2 Test B: Network & Port Guard Isolation
```bash
# Executed as User A (UID 100001) attempting to reach User B's internal DSH port
su - dsh_tenant_a -c "curl -I http://127.0.0.1:31002"
# Expected outcome: Connection refused / Operation not permitted (blocked by iptables OUTPUT owner-match guard)
```

### 6.3 Test C: Marketplace Plugin Isolation
Install an untrusted community plugin from Market (7.2k ecosystem) inside Tenant A's workspace.
- The plugin executes under UID `100001`.
- Any attempt to write to `/etc`, `/var`, `/root`, or `/home/dsh_tenant_b` fails immediately with `EACCES`.
- Host system and neighboring tenants remain completely intact.

---

## 7. Approval & Governance Sign-Off

- [x] **Direction Approved:** Hard Linux account isolation (`setpriv`, UID 100000+).
- [x] **Port Separation:** Primary SaaS strictly on `3080`; Orchestrator strictly on `3081`.
- [x] **Sign-Up Integration:** Username / Subdomain field placed directly into initial registration form.
- [x] **Language Standard:** Full architectural and execution documentation maintained in English.
- [ ] **Implementation Phase Gate:** Review code for deliverables 1–4 before applying production changes.
