# TLSCheckin

Very quick and easy status checker.

## Project Description

TLSCheckin is a self-hosted Node.js TypeScript app that provides a rapid, simple way for multiple users to set an "I'm alive" status and view the latest status for the users they follow. The public-facing flow uses a single text entry box, Cloudflare Turnstile verification, and a minimal plain HTML/JavaScript front end.

The app is intentionally small and direct. Users do not have persistent public sessions. A successful public submission records the user's check-in immediately, then displays the latest status for the users they follow.

## Technology

- Node.js with TypeScript.
- SQLCipher for encrypted local database storage.
- Simple HTML and JavaScript front end.
- Cloudflare Turnstile for bot protection.
- Debian server target.
- pm2 process manager.
- Plain HTTP app server, intended to sit behind Cloudflare Tunnel or nginx.
- Browser cache and autocomplete disabled for app pages.

## Environment Variables

A `.env.example` file shall be created for setup by future users.

Required and configurable values:

- `PORT`: app port, default `9110`.
- `DB_PATH`: SQLCipher database location, within the site root by default.
- `DB_ENCRYPTION_KEY`: SQLCipher encryption key.
- `ADMIN_INITIAL_PASSWORD`: initial admin password, used only on first server startup.
- `SESSION_SECRET`: secret used for admin session cookies.
- `TURNSTILE_SITE_KEY`: Cloudflare Turnstile site key.
- `TURNSTILE_SECRET_KEY`: Cloudflare Turnstile secret key.

Turnstile shall follow the simpler environment-driven pattern used by the local `C:\GitHub\tasker` project:

- Turnstile is enabled only when both `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are present.
- The public config endpoint may expose only whether Turnstile is enabled and the site key.
- The secret key must never be sent to the browser.
- Server-side Turnstile verification must happen before credential or public check-in validation.

## Time And Date Rules

All dates and times on the site shall use the local server timezone. Do not use UTC for app-visible date validation or display unless a future requirement explicitly changes this.

The public home screen footer shall include the local server time next to the `jahosi.co.uk` link:

```text
jahosi.co.uk    Local server time hh:mm dd/mm/yyyy
```

The admin date endpoint shall also use local server date. For example, on 15 September 2026 local server time, the admin endpoint is:

```text
/260915
```

## User Identity And Public Check-In

Users are created by the administrator. A user identity is stored as the user's birth day/month plus two-letter initials, for example:

```text
0612jr
```

Rules:

- User identity matching is case-insensitive.
- User identities must be unique case-insensitively, so `0612jr`, `0612JR`, and `0612Jr` are the same identity.
- Users may share initials if their birth day/month differs.
- The stored identity string is the only user display identity required.

The public submission is the current local server date in `ddmmyy` format plus the user identity. A hyphen separator may be used but is not required.

Valid examples for 15 September 2026:

```text
150926-0612jr
1509260612jr
```

On successful submission:

- Verify Turnstile first.
- Validate the submitted local server date.
- Resolve the user identity case-insensitively.
- Immediately update that user's `last_seen`.
- Record the successful public check-in in the audit trail.
- Show a simple result page.

On invalid submission or blank submission:

- Blank the page to white.
- Best-effort prevent browser back navigation.
- Redirect to `https://www.google.com/`.
- Record a failed/invalid public submission event in the audit trail without storing the raw invalid submitted code.

## Public-Facing Page

The default page shall be a white page with:

- A horizontally centered and vertically middle-aligned text box.
- A submit button.
- A Turnstile check when Turnstile is configured.
- A plain grey `jahosi.co.uk` link centered at the bottom.
- The local server time displayed next to the footer link.

The page shall disable browser cache and autocomplete.

## User Result Page

Users do not receive a persistent session. The successful submission returns a result page only.

If the user follows one or more users, show each followed user on its own line:

```text
JR Last seen: 14:02 15/09/26
AB Last seen: Never logged in
```

If the user follows nobody, show:

```text
Login noted
```

The result page shall include an `Exit` button. Pressing `Exit` shall blank the screen, best-effort clear/prevent browser history back navigation, and redirect to `https://www.google.com/`.

## Admin Page

The admin page shall be reached via the endpoint defined by the current local server date in `yymmdd` format, for example:

```text
/260915
```

The admin login page shall be a blank white page with:

- A horizontally centered username text box.
- A password text box below it.
- A submit button below that.
- Turnstile protection when Turnstile is configured.

Admin login requirements:

- Username is `admin`.
- Initial password is defined by `ADMIN_INITIAL_PASSWORD` in `.env`.
- The initial admin account/password is created on first server startup, not during build.
- The admin must change the initial password after first login.
- Admin passwords shall be hashed with bcrypt.
- Admin sessions shall remain active if the local date changes after login.

When logged in, the administrator can:

- Create users.
- Delete users.
- Assign each user to follow multiple users.
- Edit follow relationships.
- Change the admin password.
- View the audit trail.

Deleting a user shall delete related records, including follow relationships for that user. Audit retention for delete events should keep enough non-sensitive information for the administrator to understand what happened.

## Audit Trail

Keep an administrator-visible audit trail.

Audit events shall include:

- Admin login success.
- Admin login failure.
- Admin password change.
- User creation.
- User deletion.
- User identity update, if supported.
- Follow relationship creation/removal/update.
- Public successful check-in.
- Public failed/invalid submission, without storing the raw invalid submitted code.

The audit trail should record timestamps in local server time for display. Internal storage may use a stable timestamp format, but displayed audit dates must follow the site's local server time rule.

## Installation And Operations Manual Requirements

The README shall include full npm/pm2 installation and debug guidance as implementation progresses. The deployment documentation should assume:

- Debian 12.
- Node.js LTS.
- npm.
- pm2 required for runtime.
- nginx optional.
- Cloudflare Tunnel optional.
- App runs on HTTP locally, usually behind Cloudflare Tunnel or nginx.

The installation/debug manual should cover:

- Installing Node.js LTS.
- Installing build dependencies needed for SQLCipher/bcrypt if required.
- Installing app dependencies with npm.
- Creating `.env` from `.env.example`.
- Generating strong `DB_ENCRYPTION_KEY` and `SESSION_SECRET` values.
- Building the TypeScript app.
- Starting the app with pm2.
- Saving pm2 process list.
- Enabling pm2 startup on Debian.
- Viewing logs with pm2.
- Restarting after `.env` changes.
- Testing the local HTTP endpoint.
- Optional nginx reverse proxy setup.
- Optional Cloudflare Tunnel setup notes.
- Common debug checks for port conflicts, missing env vars, SQLCipher startup errors, Turnstile failures, and admin login problems.

## Closed Clarifications To Prevent Hallucinated Implementation

These decisions are explicit and should not be guessed differently during development:

- All app-visible dates use local server time, not UTC and not browser-local time.
- Public submission accepts both hyphenated and non-hyphenated forms.
- User identity is case-insensitive and must be unique.
- Users can follow multiple users.
- A successful public submission always updates `last_seen` immediately.
- Public users do not get sessions.
- Admin users do get sessions.
- Admin sessions remain valid across date changes.
- The admin initial password is initialized on first server startup.
- The admin must change the initial password after first login.
- Password hashing uses bcrypt.
- Turnstile verification happens before public check-in validation and before admin credential checks.
- Invalid public submissions redirect before any user lookup result is shown.
- Browser history prevention is best-effort client-side behavior, not a security boundary.
- Raw invalid submitted public codes must not be stored in the audit trail.

## Four-Step Development Phase

### Phase 1: Project Scaffold, Configuration, And Security Baseline

Implement the TypeScript Node.js project skeleton according to Technology, Environment Variables, Time And Date Rules, and Installation And Operations Manual Requirements.

Detailed instructions:

- Create npm scripts for development, build, start, and any checks/tests.
- Create `.env.example` with all variables listed in Environment Variables.
- Implement central configuration loading and validation.
- Set the default port to `9110`.
- Ensure app pages send headers to disable browser cache.
- Ensure form fields use autocomplete-disabled markup where applicable.
- Add local-server-time formatting helpers for `hh:mm dd/mm/yyyy`, `ddmmyy`, and `yymmdd`.
- Add README install/debug content for npm, pm2, Debian 12, Node LTS, optional nginx, and optional Cloudflare Tunnel.
- Do not implement browser-local or UTC date behavior.

### Phase 2: Database, Admin Account, Sessions, And Audit Trail

Implement SQLCipher persistence according to User Identity And Public Check-In, Admin Page, and Audit Trail.

Detailed instructions:

- Initialize the encrypted SQLCipher database at `DB_PATH`.
- Create schema for users, follow relationships, admin/session support if needed, and audit events.
- Enforce case-insensitive uniqueness for user identity strings.
- Store user identity as a string like `0612jr`.
- Create the admin account on first server startup using `ADMIN_INITIAL_PASSWORD`.
- Hash admin passwords with bcrypt.
- Force admin password change after first login with the initial password.
- Implement admin session handling with `SESSION_SECRET`.
- Ensure admin sessions remain active across local date changes.
- Implement audit event recording for all events listed in Audit Trail.
- Avoid storing raw invalid public submitted codes.

### Phase 3: Turnstile, Public Check-In, And Result Flow

Implement the public-facing flow according to Environment Variables, Public-Facing Page, User Result Page, and Closed Clarifications.

Detailed instructions:

- Add a public Turnstile config endpoint that exposes only enabled status and site key.
- Verify Turnstile server-side before validating public check-in submissions.
- Accept both `ddmmyy-ddmmii` and `ddmmyyddmmii` formats.
- Validate the date portion against local server date.
- Resolve user identity case-insensitively.
- On success, update `last_seen` immediately and record the audit event.
- Render followed users with `Last seen: hh:mm dd/mm/yy`.
- Render `Never logged in` for followed users with no prior check-in.
- Render `Login noted` if the submitting user follows nobody.
- Implement the `Exit` button behavior as best-effort page blanking, history handling, and redirect to Google.
- For blank or invalid submissions, blank the page, best-effort handle history, redirect to Google, and record a non-sensitive audit event.

### Phase 4: Admin UI, Deployment Hardening, And Verification

Implement the admin interface and complete operational verification according to Admin Page and Installation And Operations Manual Requirements.

Detailed instructions:

- Serve the admin login page only at the local-server-date `yymmdd` endpoint.
- Protect admin login with Turnstile when configured.
- Verify Turnstile before checking admin credentials.
- Build admin screens for creating users, deleting users, assigning multiple followed users, changing admin password, and viewing audit events.
- Ensure deleting users deletes related records and relationships.
- Add focused tests or manual verification notes for date parsing, case-insensitive identity uniqueness, successful check-in, invalid check-in redirect, followed-user display, no-follow display, admin password change, and Turnstile-enabled/disabled behavior.
- Complete pm2, nginx, Cloudflare Tunnel, and troubleshooting documentation in this README.
- Verify that no Turnstile secret, database encryption key, session secret, or raw invalid submitted public code is exposed to the browser or logs.
