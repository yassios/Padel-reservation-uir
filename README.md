# UIR Padel

A three-tier court reservation application for the Université Internationale de Rabat. Students book their weekly hour on one of two courts; administrators manage reservations, student accounts, and maintenance closures.

## Run with Docker Compose

Requirements: Docker Engine or Docker Desktop running, and Docker Compose v2.

```sh
cp .env.example .env
docker compose up --build -d
docker compose ps
```

Open **http://localhost:8080**. The frontend becomes ready after PostgreSQL is healthy and the backend has migrated and seeded the database. The first build needs internet access to download images and packages.

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@uir.ac.ma` | `Admin123!` |
| Student | `amine@uir.ac.ma` | `Student123!` |
| Student | `sara@uir.ac.ma` | `Student123!` |
| Student | `youssef@uir.ac.ma` | `Student123!` |

These are demonstration credentials. The login screen also provides buttons that fill the admin and first student credentials. There is no public signup.

```sh
docker compose logs -f backend        # API and initialization logs
docker compose stop                  # stop, keeping containers and data
docker compose start                 # resume
docker compose down                  # remove containers, keeping database volume
```

**Resetting demo data:** `docker compose down -v` deletes the database volume and all reservations. Start the application again to recreate the sample accounts.

To change the frontend port, set `PORT` in `.env`. Backend port 3000 and database port 5432 are internal to the Compose network and are not published to the host. Database credentials and the session secret are configurable in `.env`; use URL-safe characters for the database password because it is embedded in `DATABASE_URL`.

## Run locally with Kubernetes (kind)

This setup targets the existing **learning** kind cluster (`kind-learning` context), with PostgreSQL storage pinned to **learning-worker**. It creates the `mini-projet` namespace, three Deployments and ClusterIP Services, a ConfigMap, a Secret, and an explicit 2 GiB PV/PVC. No ingress controller or image registry is required. Docker, kind, kubectl, and Node.js 22 must be installed.

Create local secrets once (the resulting file is ignored by Git):

```sh
umask 077
# Run only if k8s/.env does not already exist.
node --input-type=module -e 'import {randomBytes} from "node:crypto"; import {writeFileSync} from "node:fs"; writeFileSync("k8s/.env", `POSTGRES_PASSWORD=${randomBytes(24).toString("hex")}\nSESSION_SECRET=${randomBytes(32).toString("hex")}\n`, {flag:"wx",mode:0o600});'
```

Alternatively, copy `k8s/.env.example` to `k8s/.env` and replace both placeholders. Keep the password URL-safe (hexadecimal is suitable) and the session secret at least 32 characters long. Keep this file for future deployments. Do not print or commit rendered manifests: they contain the Secret values.

Build, load, and deploy:

```sh
npm run kind:images
kubectl --context kind-learning apply -f k8s/namespace.yaml
kubectl --context kind-learning apply --dry-run=server -k k8s
kubectl --context kind-learning apply -k k8s
kubectl --context kind-learning -n mini-projet rollout status deployment/db --timeout=180s
kubectl --context kind-learning -n mini-projet rollout status deployment/backend --timeout=180s
kubectl --context kind-learning -n mini-projet rollout status deployment/frontend --timeout=180s
kubectl --context kind-learning -n mini-projet get pods,services,pvc
kubectl --context kind-learning -n mini-projet port-forward service/frontend 8080:80
```

Leave port-forward running and open **http://localhost:8080**. Use the same demo accounts listed above. If port 8080 is occupied by Compose, stop its frontend or use `8081:80`. Only the frontend is forwarded; Nginx proxies `/api` to the backend Service. Restart port-forward if its frontend pod is replaced.

The backend waits for PostgreSQL, then runs its existing migrations and demo seeding. Readiness checks keep unavailable pods out of Service endpoints. PostgreSQL uses one replica and `Recreate` updates to avoid concurrent database processes on its volume. The database readiness check and API health check are separate from application liveness checks.

### Updates and verification

For code updates, change both image `newTag` entries in `k8s/kustomization.yaml` to a fresh tag such as `local-v2`, then build/load that tag and reapply:

```sh
IMAGE_TAG=local-v2 npm run kind:images
kubectl --context kind-learning apply -k k8s
kubectl --context kind-learning -n mini-projet rollout status deployment/backend --timeout=180s
kubectl --context kind-learning -n mini-projet rollout status deployment/frontend --timeout=180s
```

Use a new tag for each build; reusing a tag with `IfNotPresent` can leave existing pods running old images. ConfigMap and Secret names include content hashes, so configuration changes also update pod templates. Changing `POSTGRES_PASSWORD` in the file does **not** change an initialized database's password; change it in PostgreSQL first, then update the file and reapply. Changing the database name/user also requires database administration or an intentional data reset.

```sh
npm run test:k8s
```

This smoke test starts its own temporary port-forward on a free port, verifies the SPA and API, logs in, creates a dedicated student, replaces all three pods, and checks that accounts and database-backed sessions persist. It also books, verifies, and cancels a reservation if a slot is available; outside bookable hours that part is skipped. It removes its student's records afterward. The test interrupts this local demo while pods restart; run it when nobody else is using it. It always targets `mini-projet`; `KUBE_CONTEXT` can override the default `kind-learning` context.

### Storage, troubleshooting, and cleanup

The PV uses `/var/local/mini-projet/postgres` **inside the learning-worker Docker container**, with node affinity so a replacement database pod returns to the same storage. Data survives pod replacement and reapplying manifests, but deleting the kind node/cluster deletes the data. The 2 GiB capacity describes the PV/PVC binding; hostPath does not impose a disk quota. `Retain` preserves data after claim deletion; it is not a backup.

```sh
kubectl --context kind-learning -n mini-projet logs deployment/backend
kubectl --context kind-learning -n mini-projet logs deployment/db
kubectl --context kind-learning -n mini-projet get events --sort-by=.lastTimestamp
kubectl --context kind-learning -n mini-projet describe pods
kubectl --context kind-learning get pv mini-projet-postgres
```

For `ImagePullBackOff`, confirm the image tags match and rerun the image load command. For a pending database pod, check that `learning-worker` exists and the PVC is Bound. For initialization failures, check database credentials and backend logs. Adapt the PV node affinity before first deployment if using a differently named cluster/node.

To stop the app while retaining configuration and data:

```sh
kubectl --context kind-learning -n mini-projet scale deployment frontend backend db --replicas=0
# Resume with the replicas declared in the manifests:
kubectl --context kind-learning apply -k k8s
```

If you delete the PVC or namespace, the retained PV becomes `Released`. To recover the same data, first ensure the old database pod is gone, reapply the manifests to recreate the claim, then clear the PV's obsolete claim reference and wait for rebinding:

```sh
kubectl --context kind-learning apply -k k8s
kubectl --context kind-learning patch pv mini-projet-postgres --type=json -p='[{"op":"remove","path":"/spec/claimRef"}]'
kubectl --context kind-learning -n mini-projet get pvc --watch
```

For an **intentional permanent data reset**, scale all three Deployments to zero and wait for their pods to disappear, then delete only this app's database directory inside the node. Keep the existing claim and secrets:

```sh
kubectl --context kind-learning -n mini-projet scale deployment frontend backend db --replicas=0
kubectl --context kind-learning -n mini-projet wait --for=delete pod -l 'app in (frontend,backend,db)' --timeout=120s
docker exec learning-worker rm -rf /var/local/mini-projet/postgres/pgdata
kubectl --context kind-learning apply -k k8s
```

PostgreSQL initializes a new database and the backend recreates the demo accounts. Do not run the reset command if you need to keep reservations or accounts.

## How bookings work

- Two fixed outdoor courts: Court 1 and Court 2.
- Monday–Friday, **16:00–22:00**, with one-hour slots starting at 16:00 through 21:00. Closed on weekends.
- All times and Monday–Sunday week boundaries use **Africa/Casablanca**, including Morocco's seasonal offset changes.
- Each student gets **one confirmed reservation per calendar week across both courts**. A completed reservation still uses that week's allowance.
- Bookings are limited to the **current week**, and a slot must not have started. On weekends or after Friday's final start time, there are no bookable slots until Monday.
- Students may reschedule or cancel their own future reservations. Cancellation immediately releases their allowance; history is preserved.
- Administrators can reserve on behalf of active students under the same limits, reschedule future reservations, and cancel any reservation.
- Administrators create and edit students, reset their passwords, and deactivate/reactivate accounts. Deactivation is blocked until future reservations have been cancelled. Inactive accounts cannot log in or use an existing session; historical records remain.
- Administrators can close future weekday slots, including dates beyond the current week. A closure must not overlap another closure or an existing reservation. Cancel the affected reservation before closing its slot. Removing a closure releases its slots.

## Architecture

```mermaid
flowchart LR
    Browser -->|HTTP :8080| Frontend[React / Nginx]
    Frontend -->|/api — internal :3000| Backend[Express / TypeScript]
    Backend -->|internal :5432| Database[(PostgreSQL)]
    Database --- Volume[Persistent Docker volume]
```

The frontend is a Vite build served by Nginx, which also proxies `/api` to the backend. Express owns authentication, authorization, input validation, and booking transactions. PostgreSQL stores users, courts, reservations, closures, slot allocations, and sessions.

A partial unique index on `(student_id, week_start)` enforces the weekly limit for confirmed reservations. The generated `week_start` column is derived from the local reservation date. Reservations and closures share a `court_slots` primary key on `(court_id, date, hour)`, preventing double occupancy. Each booking, reschedule, cancellation, and closure range runs in a transaction, so a failed reschedule retains its original slot. Student-row locks serialize booking with account deactivation. Database conflicts return HTTP 409.

Versioned SQL migrations run on API startup under a PostgreSQL advisory lock. Demo accounts are inserted only if their email is absent; normal restarts do not reset passwords or reservations. Backend shutdown closes its HTTP server and database pool.

Sessions use PostgreSQL storage, eight-hour HTTP-only SameSite cookies, and regeneration on login. The API checks account activity on every authenticated request, limits login attempts, rejects cross-origin browser writes, validates JSON inputs, and hashes passwords with bcrypt. The browser and API use one origin, so no CORS configuration is required. Availability refreshes every minute and when the browser regains focus; the API always revalidates a submitted booking.

## API overview

JSON request and response bodies; session authentication through the `uir.sid` cookie. Errors use `{ "error": "Readable message", "code": "ERROR_CODE" }`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Database readiness |
| POST | `/api/auth/login` | `{email, password}` → user and session cookie |
| POST | `/api/auth/logout` | End session |
| GET | `/api/auth/me` | Current active user |
| GET | `/api/availability` | Current week's 60 court slots, local date/time and timezone |
| GET | `/api/reservations` | Own history, or all reservations for admin |
| POST | `/api/reservations` | `{courtId, date, hour, studentId?}`; studentId required for admin |
| PATCH | `/api/reservations/:id` | Reschedule with `{courtId, date, hour}` |
| DELETE | `/api/reservations/:id` | Cancel while preserving history |
| GET/POST | `/api/admin/students` | List/create students; creation uses `{name, email, password}` |
| PATCH | `/api/admin/students/:id` | `{name, email, active, password?}` |
| GET/POST | `/api/admin/closures` | List/create closures; creation uses `{courtId, date, startHour, endHour, reason}` |
| DELETE | `/api/admin/closures/:id` | Remove closure |

Dates use `YYYY-MM-DD`; hour fields are integers in Morocco local time, and closure end hours are exclusive. Creation returns 201; cancellation, closure deletion, and logout return 204. Common errors: 400 invalid input, 401 unauthenticated, 403 forbidden, 404 missing record, 409 conflict, 429 too many login attempts.

## Development and checks

Use Node.js 22 (Node 20.18+ also works).

```sh
npm ci
npm ci --prefix backend
npm ci --prefix frontend
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

`npm test` runs deterministic booking/timezone checks and API integration tests using **PGlite**, an in-process PostgreSQL engine. It needs no Docker and writes no production data. It covers authorization, ownership, weekly limits, slot conflicts, reschedule rollback, closure rollback, student management, session invalidation, and competing requests. PGlite has a single connection; its adapter serializes transactions.

To test real simultaneous PostgreSQL connections, use a **disposable test database** whose user can create schemas:

```sh
TEST_DATABASE_URL=postgres://user:password@localhost:5432/test_db npm test
```

The test suite creates an isolated schema and drops it afterward. Application time is fixed during API tests, so the scenarios do not depend on the current date. The browser suite starts its own disposable PGlite API and Vite frontend; ports **3000** and **5173** must be free. Both test server and browser use a fixed weekday clock. It exercises student booking/rescheduling/cancellation, admin management and closures, and a mobile layout check. To use an existing Chrome installation instead of downloading Chromium, run `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e`.

With the local Compose stack running, `npm run test:compose` verifies the Nginx proxy, database-backed login sessions, and data persistence across a restart of all three containers. It creates a dedicated test student, books and cancels a slot if one is available, and removes that student's records afterward. This check restarts the local demo, so run it when no one else is using it.

For application development against a local PostgreSQL instance:

```sh
cd backend
DATABASE_URL=postgres://user:password@localhost:5432/uir_padel SESSION_SECRET=local-development-secret npm run dev
```

In a second terminal, run `npm run dev --prefix frontend` from the project root. Vite proxies `/api` to `localhost:3000`.

## Deployment notes

This configuration targets a local classroom demonstration over HTTP. Before public hosting, replace demo credentials and the session secret, terminate HTTPS at your reverse proxy, and set `COOKIE_SECURE=true` for the backend. The interface uses Google Fonts when available and falls back to local sans-serif fonts offline. University SSO, payments, notifications, and public signup are outside this version.
# Padel-reservation-uir
# Padel-reservation-uir
# Padel-reservation-uir
