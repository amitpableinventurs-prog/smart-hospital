# MediCare – Hospital Management ERP

Smart hospital automation built with **Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · MongoDB (Mongoose)**.

Every department has its **own panel**. A **Super Admin** creates admins, allocates the modules each one manages, and monitors everything they do.

## Quick start

```bash
npm install
cp .env.example .env.local        # then edit values (a ready .env.local already exists locally)
npm run create-super-admin        # creates / resets the super admin from .env.local
npm run dev                       # http://localhost:3000
```

MongoDB must be running (`MONGODB_URI`, default `mongodb://127.0.0.1:27017/medicare_erp`).

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB connection string |
| `AUTH_SECRET` | Session signing key (≥ 32 random chars) |
| `SUPER_ADMIN_NAME` / `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` | Used only by `npm run create-super-admin` |

Other scripts: `npm run build`, `npm start`, `npm run lint`, `npm run typecheck`.

## Roles

| Role | Can do |
| --- | --- |
| **Super Admin** | Everything. Creates admins, allocates/revokes modules, activates/deactivates accounts, resets passwords, sees the monitoring dashboard and the full activity log. Can open every module panel. |
| **Admin** | Signs in and sees only the module panels allocated to them. Every API call is checked server-side; unassigned modules return `403`. |

Access changes apply **immediately**: every request re-reads the account from the database, and deactivation / password reset invalidates existing sessions.

## Modules (one panel each)

Patients · OPD/IPD (visits, admissions) · Doctors (doctors, appointments) · Nursing (duty roster, care notes) · Laboratory (orders, test catalog) · Inventory (stock items, suppliers) · Billing & Payments (invoices) · Human Resources (staff, leave requests) · Insurance (claims, providers) · Ambulance (trips, vehicles).

All modules are declared in **`src/lib/modules.ts`**. That single registry drives the database models, validation (client + server), API routes, forms, tables and permissions — add a field or a whole module there.

The Patients module has bespoke pages (summary cards, registration form, details page with linked visits/appointments/lab orders/invoices/claims, filtered by the viewer's module access).

## Monitoring & audit

The Super Admin overview (`/super-admin`, auto-refreshes every 30 s) shows admins online, operations per day, failed sign-ins, per-module record counts / allocated admins / recent operations, and a live activity feed. The activity log (`/super-admin/activity`) records sign-ins (including failures and lockouts), every create / update / delete with changed fields, every patient record view, and all admin-management changes — filterable by user, module, action and date.

## API

All responses follow `{ success: true, data, pagination? }` or `{ success: false, error: { message, fields? } }`.

| Endpoint | Notes |
| --- | --- |
| `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` · `POST /api/auth/password` | Session cookie (httpOnly JWT). 5 failed sign-ins → 15 min lock. |
| `GET/POST /api/patients?search=&type=OPD&page=1&limit=10` · `GET/PATCH/DELETE /api/patients/:id` | Patient ID auto-generated (`MC-2026-000001`); duplicate registrations rejected. |
| `GET /api/patients/summary` · `GET /api/patients/:id/related` | Listing summary; linked records from modules the viewer may access. |
| `GET/POST /api/m/:module/:resource` · `GET/PATCH/DELETE /api/m/:module/:resource/:id` | Generic CRUD for every other module. Supports `search`, `page`, `limit`, `sort`, `order`, and filtering by any select/ref field. |
| `GET /api/lookup/:module/:resource?q=` | id/label search for reference pickers (patients, doctors, tests, …). |
| `GET/POST /api/admins` · `GET/PATCH /api/admins/:id` · `POST /api/admins/:id/password` | Super admin only. |
| `GET /api/activity` · `GET /api/monitoring` | Super admin only. |

Records that are still referenced elsewhere (e.g. a patient with invoices) cannot be deleted.

## Project layout

```
src/
  proxy.ts                 redirects signed-out visitors to /login
  lib/modules.ts           module registry (fields, rules, refs)
  lib/validation.ts        shared validation
  lib/records.ts           generic record service (CRUD, search, audit)
  lib/session.ts, auth.ts  session + permission checks
  lib/audit.ts             activity logging
  models/                  User, ActivityLog, Counter, per-resource models
  app/api/...              REST route handlers
  app/(app)/...            authenticated pages (dashboard, patients, m/[module], super-admin, account)
  components/              shell, forms, tables, charts, UI kit
scripts/create-super-admin.mjs
```
