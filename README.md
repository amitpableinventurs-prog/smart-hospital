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

Patients · OPD/IPD (visits, admissions) · Doctors (doctors, appointments) · Nursing (duty roster, care notes) · Laboratory (orders, test catalog) · Inventory (item master, batch stock, suppliers) · Billing & Payments (invoices) · **Human Resources** (employees, attendance, leave, payroll) · **Insurance** (policies, pre-auths, claims, settlements) · **Ambulance** (dispatch, trips, fleet, fuel, service) · **Blood Bank** (requests, issues, bags, donors) · **Pharmacy** (Marg-style sale bills and purchase entries) · **Reports** (day book, sales register, stock, expiry, outstanding).

### How modules work together

- **Inventory → Pharmacy → Reports.** Items are created in Inventory. A Pharmacy *purchase entry* adds stock batch-wise (batch no., expiry month, qty + free, rate, MRP, GST). A *sale bill* picks batches earliest-expiry first, blocks expired or short batches, takes MRP/GST from stock (never from the browser) and deducts stock atomically. Cancelling a bill returns stock; cancelling a purchase is only allowed while its stock is still on hand. Item stock-in-hand is read-only — only these entries change it.
- **Patients / Doctors → everything.** Visits, appointments, lab orders, invoices, claims, ambulance trips, blood requests and pharmacy bills link to patients; the patient page shows them (only from modules the viewer is assigned to).
- **Blood Bank.** Bag group must match its donor; collecting a bag updates the donor's last-donation date. Issuing a bag checks screening, expiry, component and ABO/Rh compatibility, claims the bag atomically, and moves the request to Partially Issued / Issued. Deleting an issue returns the bag. Expired bags are marked automatically. The panel shows stock by group × component against pending demand. (Compatibility follows standard rules; the cross-match remains a clinical responsibility.)
- Records still referenced elsewhere cannot be deleted.
- **Human Resources.** The employee master holds the salary structure (basic, DA, HRA, allowances), statutory numbers and bank details. *Daily Attendance* marks each day against the employee's shift (late arrivals and overtime are recorded); approved leave, holidays and weekly offs fill in automatically. *Leave Applications* count working days only, enforce the Leave Policy (yearly quota, pro-rata for joiners, carry-forward, half days, gender, service period) and cannot be approved while the person is on the nursing duty roster or marked present. *Payroll Runs* build a month from attendance, leave and advances: loss-of-pay days, overtime, PF (12% of basic + DA up to ₹15,000), ESI (0.75% up to ₹21,000 gross), professional tax and advance recovery; finalising locks that month's attendance, leave and holidays and recovers advances (reopening reverses them). Payslips print one per page; the register and a bank-advice file export as CSV.
- **HR → Nursing & Ambulance.** Nursing duty shifts pick nurses from HR; ambulance drivers and crew are HR staff. Staff on approved leave, not yet joined or already left cannot be rostered or dispatched, and staff with future shifts or an active trip cannot be marked as left.
- **Insurance.** Patient policies link the insurer and TPA. A cashless *pre-authorisation* goes Draft → Submitted → (Query ↔ Reply) → Approved / Rejected, with enhancements for longer stays. The approved amount becomes the insurer's limit on the admission's IPD bill (an IPD bill opened later starts as an insurance bill automatically). Finalising an insurance bill in Billing raises the *claim* with a document checklist; it cannot be submitted until required documents are in. Recording a settlement posts a payer receipt on the bill: TDS and deductions are written off and disallowed amounts move to the patient's due. Claim reports show ageing by insurer, overdue amounts and deduction rates.
- **Ambulance.** Calls are logged on the *Dispatch Board* and dispatched to an available vehicle (expired insurance / fitness / permit blocks dispatch; mortuary vans only carry dead-body transfers) with a free driver and crew. Each step (at pickup, patient on board, arrived, completed) is time-stamped for response-time reporting. On arrival an Emergency OPD visit can be opened. Completion charges the trip from the *Tariff* (base fare, extra km, waiting, night surcharge, oxygen / ventilator) to the patient's hospital bill, or collects it on the trip. Fuel and service records keep the odometer and next-service date current; a vehicle in the workshop is off the road.

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

## Online payments (Razorpay)

- **Hospital account** — the super admin saves the hospital's Razorpay Key ID / Key Secret under **Super Admin → Payment Gateway**, and chooses whether admins without their own keys may collect into it.
- **Per-admin accounts** — each admin can save their own keys under **Account & Razorpay**; the super admin can also set or remove them on the admin's page while allocating modules. An admin's online collections go to their own account, otherwise to the shared hospital account.
- Keys are checked with Razorpay before saving. The secret is stored AES-256-GCM encrypted (key from `PAYMENT_KEYS_SECRET`, else `AUTH_SECRET`) and never sent to the browser.
- **Pay online** appears next to the manual payment button on lab orders, pharmacy bills and completed ambulance trips. The server raises a Razorpay order, verifies the checkout signature, confirms the payment with Razorpay, and records it through the module's normal payment logic (mode UPI / Card / Bank Transfer, reference `Razorpay pay_…`).
- If the browser closes after paying, or a captured payment cannot be recorded (e.g. the balance was settled in cash meanwhile), the attempt stays listed; **Check** asks Razorpay again. Payments needing attention are flagged on the Payment Gateway page.

## API

All responses follow `{ success: true, data, pagination? }` or `{ success: false, error: { message, fields? } }`.

| Endpoint | Notes |
| --- | --- |
| `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` · `POST /api/auth/password` | Session cookie (httpOnly JWT). 5 failed sign-ins → 15 min lock. |
| `GET/POST /api/patients?search=&type=OPD&page=1&limit=10` · `GET/PATCH/DELETE /api/patients/:id` | Patient ID auto-generated (`MC-2026-000001`); duplicate registrations rejected. |
| `GET /api/patients/summary` · `GET /api/patients/:id/related` | Listing summary; linked records from modules the viewer may access. |
| `GET/POST /api/m/:module/:resource` · `GET/PATCH/DELETE /api/m/:module/:resource/:id` | Generic CRUD for every other module. Supports `search`, `page`, `limit`, `sort`, `order`, and filtering by any select/ref field. |
| `GET /api/lookup/:module/:resource?q=&f.<field>=A|B` | id/label search for reference pickers (patients, doctors, tests, …); `f.` narrows by a select field, e.g. only nurses. |
| `GET/POST /api/admins` · `GET/PATCH /api/admins/:id` · `POST /api/admins/:id/password` | Super admin only. |
| `GET /api/pharmacy/stock?q=` | Items with sellable batches (FEFO) for the billing screen. |
| `GET/POST /api/pharmacy/sales` · `GET/PATCH /api/pharmacy/sales/:id` · `POST …/:id/cancel` | Sale bills; PATCH records a payment `{ amount, paymentMode }`. |
| `GET/POST /api/pharmacy/purchases` · `GET /api/pharmacy/purchases/:id` · `POST …/:id/cancel` | Purchase entries (stock in). |
| `GET /api/reports/{daybook,sales-register,stock,expiry,outstanding}` | Reports module. |
| `GET /api/blood-bank/stock` | Available bags by group × component vs demand. |
| `GET/POST /api/hr/attendance` · `GET /api/hr/leave-balances` · `GET /api/hr/reports` | Daily register (`?date=`), saving marks `{ date, entries }`, leave balances by year, HR reports. |
| `GET/POST /api/hr/payroll` · `GET/DELETE /api/hr/payroll/:id` · `POST …/:id/action` | Prepare / regenerate a month; actions `adjust`, `finalise`, `reopen`, `pay`. |
| `GET/POST /api/insurance/preauths` · `GET /api/insurance/preauths/:id` · `POST …/:id/action` | Cashless pre-auths; actions `submit`, `query`, `respond`, `approve`, `reject`, `enhance`, `decide-enhancement`, `link-admission`, `sync-bill`, `cancel`. |
| `GET/POST /api/insurance/claims` · `GET /api/insurance/claims/:id` · `POST …/:id/action` | Claims; actions `document`, `submit`, `review`, `query`, `respond`, `approve`, `settle`, `reject`, `cancel`, `note`. |
| `GET /api/insurance/patient-cover?patient=` · `GET /api/insurance/reports` | A patient's policies, admissions and insurance bills; claim ageing and settlement reports. |
| `GET /api/ambulance/board` · `GET/POST /api/ambulance/trips` · `GET /api/ambulance/trips/:id` · `POST …/:id/action` · `GET /api/ambulance/reports` | Dispatch board; trips (POST may include `dispatch`); actions `dispatch`, `on-scene`, `transport`, `arrive`, `complete`, `pay`, `update`, `cancel`. |
| `GET/PUT/DELETE /api/payments/razorpay/account` · `GET/PUT/DELETE /api/admins/:id/razorpay` | Own Razorpay keys (super admin: the hospital account); super admin manages an admin's keys. `PUT { keyId, keySecret?, displayName?, enabled?, shared? }` — blank secret keeps the saved one. |
| `GET /api/payments/razorpay/config` · `GET /api/payments/razorpay/overview` | Which account the caller collects into; super admin overview of all accounts. |
| `POST /api/payments/razorpay/orders` · `POST /api/payments/razorpay/verify` | `{ kind: lab_order \| pharmacy_sale \| ambulance_trip, id, amount }` → checkout options; verify `{ txnId, razorpay_order_id, razorpay_payment_id, razorpay_signature }`. |
| `GET /api/payments/razorpay/transactions?kind=&id=&status=&q=` · `POST …/transactions/:id/sync` | Online payments (admins see their own); sync re-checks an order with Razorpay. |
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
  lib/hr.ts                attendance, leave balances, payroll
  lib/insurance.ts         pre-authorisations, claims, settlements (posts to Billing)
  lib/ambulance.ts         dispatch, trip lifecycle, trip billing; ambulance-math.ts tariff arithmetic
  lib/session.ts, auth.ts  session + permission checks
  lib/audit.ts             activity logging
  models/                  User, ActivityLog, Counter, per-resource models
  app/api/...              REST route handlers
  app/(app)/...            authenticated pages (dashboard, patients, m/[module], super-admin, account)
  components/              shell, forms, tables, charts, UI kit
scripts/create-super-admin.mjs, scripts/create-demo-admins.mjs
```
