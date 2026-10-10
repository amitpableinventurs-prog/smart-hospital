# MediCare – Hospital Management ERP

Smart hospital automation built with **Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · MongoDB (Mongoose)**.

Every department has its **own panel**. A **Super Admin** creates admins, allocates the modules each one manages, and monitors everything they do.

## Quick start

```bash
npm install
cp .env.example .env.local        # then edit values (a ready .env.local already exists locally)
npm run create-super-admin        # creates / resets the super admin from .env.local
npm run create-demo-admins        # optional: one test login per module (password Medicare@123)
npm run dev                       # http://localhost:3000
```

MongoDB must be running (`MONGODB_URI`, default `mongodb://127.0.0.1:27017/medicare_erp`).

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB connection string |
| `AUTH_SECRET` | Session signing key (≥ 32 random chars) |
| `SUPER_ADMIN_NAME` / `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` | Used only by `npm run create-super-admin` |

`HOSPITAL_NAME`, `HOSPITAL_ADDRESS`, `HOSPITAL_PHONE`, `HOSPITAL_GSTIN` and `PHARMACY_DL_NO` are printed on pharmacy bills.

### Demo logins (testing only)

`npm run create-demo-admins` creates `<name>@medicare.local` accounts, all with password `Medicare@123`:
`patients`, `opd`, `doctors`, `nursing`, `lab`, `inventory`, `billing`, `hr`, `insurance`, `ambulance`, `bloodbank`, `pharmacy`, `reports`, plus combined `frontdesk` (Patients, OPD/IPD, Doctors, Billing) and `store` (Pharmacy, Inventory, Reports). Deactivate them before going live.

Other scripts: `npm run build`, `npm start`, `npm run lint`, `npm run typecheck`.

## Roles

| Role | Can do |
| --- | --- |
| **Super Admin** | Everything. Creates admins, allocates/revokes modules, activates/deactivates accounts, resets passwords, sees the monitoring dashboard and the full activity log. Can open every module panel. |
| **Admin** | Signs in and sees only the module panels allocated to them. Every API call is checked server-side; unassigned modules return `403`. |

Access changes apply **immediately**: every request re-reads the account from the database, and deactivation / password reset invalidates existing sessions.

## Modules (one panel each)

Patients · OPD/IPD (visits, admissions) · Doctors (doctors, appointments) · Nursing (duty roster, care notes) · Laboratory (orders, test catalog) · Inventory (item master, batch stock, suppliers) · Billing & Payments (invoices) · Human Resources (staff, leave requests) · Insurance (claims, providers) · Ambulance (trips, vehicles) · **Blood Bank** (requests, issues, bags, donors) · **Pharmacy** (Marg-style sale bills and purchase entries) · **Reports** (day book, sales register, stock, expiry, outstanding).

### How modules work together

- **Inventory → Pharmacy → Reports.** Items are created in Inventory. A Pharmacy *purchase entry* adds stock batch-wise (batch no., expiry month, qty + free, rate, MRP, GST). A *sale bill* picks batches earliest-expiry first, blocks expired or short batches, takes MRP/GST from stock (never from the browser) and deducts stock atomically. Cancelling a bill returns stock; cancelling a purchase is only allowed while its stock is still on hand. Item stock-in-hand is read-only — only these entries change it.
- **Patients / Doctors → everything.** Visits, appointments, lab orders, invoices, claims, ambulance trips, blood requests and pharmacy bills link to patients; the patient page shows them (only from modules the viewer is assigned to).
- **Blood Bank.** Bag group must match its donor; collecting a bag updates the donor's last-donation date. Issuing a bag checks screening, expiry, component and ABO/Rh compatibility, claims the bag atomically, and moves the request to Partially Issued / Issued. Deleting an issue returns the bag. Expired bags are marked automatically. The panel shows stock by group × component against pending demand. (Compatibility follows standard rules; the cross-match remains a clinical responsibility.)
- Records still referenced elsewhere cannot be deleted.

### Keyboard shortcuts (Marg-style)

| Key | Where | Action |
| --- | --- | --- |
| F2 | lists, pharmacy | New record / new sale bill |
| F3 | lists, bills | Focus search / item search |
| F4 | pharmacy | New purchase entry (home) · customer field (bill) |
| ↑ ↓ Enter | item search | Pick batch / item and add a line |
| Enter | bill & purchase grid | Next field |
| F10 / Ctrl+S | forms, bills | Save |
| Ctrl+P | bill, reports | Print |
| Alt+1…5 | reports | Switch report |
| Esc | dialogs, search | Close |

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
| `GET /api/pharmacy/stock?q=` | Items with sellable batches (FEFO) for the billing screen. |
| `GET/POST /api/pharmacy/sales` · `GET/PATCH /api/pharmacy/sales/:id` · `POST …/:id/cancel` | Sale bills; PATCH records a payment `{ amount, paymentMode }`. |
| `GET/POST /api/pharmacy/purchases` · `GET /api/pharmacy/purchases/:id` · `POST …/:id/cancel` | Purchase entries (stock in). |
| `GET /api/reports/{daybook,sales-register,stock,expiry,outstanding}` | Reports module. |
| `GET /api/blood-bank/stock` | Available bags by group × component vs demand. |
| `GET /api/activity` · `GET /api/monitoring` | Super admin only. |

Records that are still referenced elsewhere (e.g. a patient with invoices) cannot be deleted.

## Project layout

```
src/
  proxy.ts                 redirects signed-out visitors to /login
  lib/modules.ts           module registry (fields, rules, refs)
  lib/validation.ts        shared validation
  lib/records.ts           generic record service (CRUD, search, audit)
  lib/rules.ts             cross-module business rules (blood bank, delete guards, duplicates)
  lib/pharmacy.ts          sale / purchase service with batch stock movements
  lib/billing-math.ts      GST-inclusive bill arithmetic (shared by UI and API)
  lib/reports.ts           report queries
  lib/session.ts, auth.ts  session + permission checks
  lib/audit.ts             activity logging
  models/                  User, ActivityLog, Counter, per-resource models
  app/api/...              REST route handlers
  app/(app)/...            authenticated pages (dashboard, patients, m/[module], super-admin, account)
  components/              shell, forms, tables, charts, UI kit
scripts/create-super-admin.mjs, scripts/create-demo-admins.mjs
```
