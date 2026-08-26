# Multi-Auth Attendance System — Restructured

Rebuilt as a **real HTML/CSS/JS frontend talking to a PHP JSON API backend**, instead of
server-rendered PHP templates. Nothing about the app's features changed — same QR + GPS +
Face + Fingerprint check-in, same admin dashboard — only *how the frontend and backend
talk to each other* changed.

## Folder structure

```
frontend/
  html/    Pure .html pages — no PHP, no server-side logic
    index.html              Sign in
    register.html           Registration + face enrollment
    portal.html             Personal dashboard (logs, absence requests, QR badge)
    checkin.html            Multi-factor check-in flow
    admin-dashboard.html    Admin dashboard (logs, users, geofences, leave)
  css/
    style.css               Unchanged dark/green theme
  js/
    common.js                Shared fetch() wrapper, session/auth guard, navbar renderer
    login.js / register.js / portal.js / checkin.js / admin.js   Page-specific logic
    face.js / register-face.js   face-api.js camera helpers (unchanged)

backend/
  config/database.php        DB connection settings (edit host/user/pass)
  includes/
    auth.php                  Session helpers — require_login()/require_admin() now
                               respond with JSON (401/403) instead of redirecting a page
    functions.php              GPS distance, status logic, badge helpers
    seed_helper.php             Run once to fix demo account passwords
  api/
    auth/login.php, logout.php, register.php, session.php
    portal/data.php             Stats + logs + leave requests for the logged-in user
    portal/leave.php            Submit an absence request
    checkin.php                  Records an attendance log server-side
    admin/dashboard-data.php    All admin dashboard data in one call
    admin/actions.php            Settings, geofences, leave review, user enrollment

database/schema.sql           Full schema + seed data (5 demo users, 3 geofences)
```

Every `frontend/html/*.html` page loads `../js/common.js` first, which exposes:
- `apiFetch(path, options)` — fetch wrapper that talks to `backend/api/...` (relative
  path, so it works no matter what subfolder you install this under) and auto-parses JSON.
- `requireAuth({ adminOnly })` — calls `auth/session.php`, redirects to `index.html` if
  not logged in (or to `portal.html` if a non-admin hits an admin-only page).
- `renderNavbar(user, active)` — injects the shared top nav into `<div id="navbar"></div>`.

Each page's own `.js` file then fetches its data (e.g. `portal.js` calls
`portal/data.php`) and renders it into the page — nothing is rendered server-side anymore.

## Setup (XAMPP)

1. Copy this whole folder into `htdocs/` (e.g. `C:\xampp\htdocs\multi-auth-attendance`).
2. Start Apache + MySQL in the XAMPP control panel.
3. Open phpMyAdmin → Import → select `database/schema.sql`.
4. In your browser, visit
   `http://localhost/multi-auth-attendance/backend/includes/seed_helper.php` **once** —
   this sets working passwords on the seeded demo accounts (`schema.sql` ships with
   placeholder hashes that cannot log in until this runs). Delete `seed_helper.php`
   afterward.
5. Visit `http://localhost/multi-auth-attendance/frontend/html/index.html` and sign in:
   - **Admin:** `admin@tech.com` / `admin`
   - Employee (demo): `alex.rivera@omniauth.test` / `Password123!`

⚠️ Serve the site over `http://localhost/...` (not `file://`) — camera and geolocation
access require a secure context, and `localhost` counts as one even without HTTPS. Also,
API calls use cookie-based PHP sessions, which also require a real HTTP origin.

## Why the admin login wasn't working before

`database/schema.sql` ships with a **placeholder** password hash
(`$2y$10$abcdefghijklmnopqrstuv`) for every seeded user, including `admin@tech.com`. It
is not a real bcrypt hash of any password, so `password_verify()` can never match it.
Running `backend/includes/seed_helper.php` once (step 4 above) overwrites it with a real
hash for `admin` / `Password123!`. If you were also seeing "server not responding",
that's almost always MySQL not running, or `DB_NAME` in `backend/config/database.php` not
matching the database name you imported the schema under.

## What's real

Unchanged from the original build — see the code comments in `backend/api/checkin.php`,
`frontend/js/checkin.js`, and `frontend/js/face.js`:
- **QR check-in** — live camera scan via `jsQR`, verified server-side against `qr_secret`.
- **Face recognition** — `face-api.js` 128-point descriptor captured at sign-up and at
  check-in; Euclidean distance compared server-side in `backend/api/checkin.php`.
- **GPS geofence** — real `navigator.geolocation`, checked server-side with the Haversine
  formula against geofences in `database/schema.sql`.
- **Fingerprint** — real WebAuthn prompt where supported, but not yet verified against a
  stored server-side challenge (would need `backend/api/webauthn_challenge.php` +
  `web-auth/webauthn-lib` for production).

## Next steps to harden for submission

- Add CSRF tokens (e.g. a per-session token returned by `auth/session.php` and required
  on every POST to `backend/api/...`).
- Rate-limit / lock login after repeated failures.
- Add a "re-enroll face" flow on the portal page for existing users.
- Add pagination to the admin logs table once data grows.
- Self-host `face-api.js` model weights and the `jsQR`/`QRCode.js` libraries under
  `frontend/js/vendor/` if you need the app to work fully offline (they currently load
  from CDNs).
