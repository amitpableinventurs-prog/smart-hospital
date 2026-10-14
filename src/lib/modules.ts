/**
 * Central registry of ERP modules.
 *
 * Every panel, permission check, API route and validation rule is driven from
 * this file, so adding a field or a whole module only needs a change here.
 * This file is imported by both client and server code — keep it free of
 * server-only imports.
 */

export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "datetime"
  | "time"
  | "select"
  | "email"
  | "tel"
  | "ref"
  /** Several references to the same resource (stored as an array of ids). */
  | "multiref"
  /** Several of `options`, stored as a comma-separated string (e.g. "Mon,Wed,Fri"). */
  | "multiselect"
  /** A small picture, resized in the browser and stored as a data URL. */
  | "image";

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: readonly string[];
  min?: number;
  max?: number;
  maxLength?: number;
  placeholder?: string;
  /** For `ref` / `multiref` fields: the "module.resource" key of the referenced resource. */
  ref?: string;
  /** Narrows the reference picker by select fields of the target, e.g. { staffCategory: "Nurse" } ("A|B" = either). */
  refFilter?: Record<string, string>;
  /** Show this field as a column in the listing table. */
  list?: boolean;
  /** Include this field in free-text search. */
  search?: boolean;
  /** Default value for new records. */
  default?: string | number;
  /** Span both columns in the form grid. */
  wide?: boolean;
  /** Date may not be in the future. */
  past?: boolean;
  /** Shown in forms but never accepted from input (maintained by the system). */
  readOnly?: boolean;
  /** Helper text under the input. */
  hint?: string;
  /** Starts a titled group of fields in forms. */
  section?: string;
}

/** Normalised record values as produced by validation (dates are Date objects). */
export type RecordValues = Record<string, string | number | Date | string[] | null | undefined>;

export interface ResourceDef {
  key: string;
  label: string;
  singular: string;
  /** Prefix for an auto-generated, unique human-readable code (e.g. INV-2026-000001). */
  codePrefix?: string;
  /** Field used as the display label when this resource is referenced elsewhere. */
  labelField: string;
  /** Field holding a status value, used for the filter dropdown. */
  statusField?: string;
  /** Allow other modules to look this resource up in `ref` fields. */
  lookup?: boolean;
  /** Extra fields shown under each option in reference pickers. */
  lookupFields?: string[];
  /** Only records matching these values are offered in reference pickers. */
  lookupFilter?: Record<string, string>;
  /** Sidebar group this tab is listed under (modules with many tabs). */
  group?: string;
  /** Records are created by other workflows (e.g. purchase entries); the panel is view-only. */
  readOnly?: boolean;
  /** Fields that must be unique together. */
  unique?: string[];
  fields: FieldDef[];
  /** Cross-field rules; return a map of field name -> error message. */
  check?: (v: RecordValues) => Record<string, string>;
}

function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}
function time(v: unknown): number | null {
  return v instanceof Date ? v.getTime() : null;
}
function notBefore(later: string, earlier: string, message: string) {
  return (v: RecordValues) => {
    const a = time(v[later]);
    const b = time(v[earlier]);
    return a !== null && b !== null && a < b ? { [later]: message } : {};
  };
}

export interface ModuleDef {
  key: ModuleKey;
  label: string;
  description: string;
  icon: string;
  /** Module has bespoke pages instead of the generic panel. */
  custom?: boolean;
  resources: ResourceDef[];
  /** Order of the sidebar groups (defaults to first appearance). */
  groups?: string[];
  /** Bespoke tabs shown before the generic resource tabs (e.g. the lab worklists). */
  sections?: { key: string; label: string; group?: string }[];
  /** Collections owned by bespoke pages, counted on the monitoring dashboard. */
  collections?: { name: string; label: string }[];
}

export const MODULE_KEYS = [
  "patients",
  "opd_ipd",
  "doctors",
  "nursing",
  "laboratory",
  "inventory",
  "billing",
  "hr",
  "insurance",
  "ambulance",
  "blood_bank",
  "pharmacy",
  "reports",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export const GENDERS = ["Male", "Female", "Other"] as const;
export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export const PATIENT_TYPES = ["OPD", "IPD"] as const;
export const GST_RATES = ["0", "5", "12", "18", "28"] as const;
export const BLOOD_COMPONENTS = ["Whole Blood", "Packed RBC", "Platelets", "Fresh Frozen Plasma", "Cryoprecipitate"] as const;
export const PAYMENT_MODES = ["Cash", "Card", "UPI", "Bank Transfer", "Credit"] as const;
/** Index matches Date#getUTCDay(). */
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const WORK_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const DEPARTMENTS = [
  "General Medicine",
  "Cardiology",
  "Orthopedics",
  "Pediatrics",
  "Gynecology",
  "Neurology",
  "Dermatology",
  "ENT",
  "Ophthalmology",
  "Emergency",
  "Surgery",
  "Pathology",
  "Radiology",
  "Other",
] as const;
export const SAMPLE_TYPES = ["Blood", "Serum", "Plasma", "Urine", "Stool", "Sputum", "Swab", "CSF", "Body Fluid", "Tissue", "Semen", "Other"] as const;
export const CONTAINERS = ["EDTA (Lavender)", "Plain (Red)", "SST (Gold)", "Fluoride (Grey)", "Citrate (Blue)", "Heparin (Green)", "Sterile Container", "Swab Tube", "Slide", "Formalin Jar", "Other"] as const;
export const RATE_PLANS = ["General", "Corporate", "Insurance", "Staff", "Senior Citizen", "Concession"] as const;
const ACTIVE = ["Active", "Inactive"] as const;
export const STORE_TYPES = ["Main Store", "Pharmacy", "Laboratory", "OT", "ICU", "Ward", "Department", "Other"] as const;
export const BILL_TYPES = ["OPD", "IPD", "Emergency", "Day Care"] as const;
/** Billing heads: every charge on a hospital bill falls under one of these. */
export const SERVICE_CATEGORIES = [
  "Registration",
  "Consultation",
  "Emergency",
  "Procedure",
  "Surgery / OT",
  "Room / Bed",
  "ICU",
  "Nursing",
  "Laboratory",
  "Radiology",
  "Pharmacy / Consumables",
  "Equipment",
  "Ambulance",
  "Package",
  "Other",
] as const;
export const CHARGE_UNITS = ["Per service", "Per day", "Per hour", "Per visit"] as const;
/** Modes a hospital bill receipt can be split across ("Credit" is a payer, not a mode). */
export const BILL_PAYMENT_MODES = ["Cash", "Card", "UPI", "Bank Transfer", "Cheque"] as const;
export const PAYER_TYPES = ["Self", "Corporate", "Insurance"] as const;
export const DOCTOR_FEE_TYPES = ["Consultation", "Follow-up", "Emergency", "IPD Visit", "Surgeon", "Assistant Surgeon", "Anaesthetist", "Procedure"] as const;

/* ---------- Human resources ---------- */
export const STAFF_CATEGORIES = ["Doctor", "Nurse", "Paramedic / EMT", "Technician", "Pharmacist", "Administration", "Accounts", "Support", "Housekeeping", "Security", "Driver"] as const;
export const STAFF_DEPARTMENTS = [...DEPARTMENTS, "Nursing", "Laboratory", "Pharmacy", "Ambulance", "Administration", "Accounts", "Front Office", "Stores", "Housekeeping", "Security"] as const;
export const EMPLOYMENT_TYPES = ["Permanent", "Probation", "Contract", "Trainee", "Visiting / Consultant"] as const;
export const LEAVE_TYPES = ["Casual", "Sick", "Earned", "Maternity", "Paternity", "Compensatory Off", "Unpaid"] as const;
/** Attendance marks; "Leave" and "Holiday" are also derived from approved leave and the holiday list. */
export const ATTENDANCE_STATUSES = ["Present", "Absent", "Half Day", "On Duty", "Week Off", "Holiday", "Leave"] as const;

/* ---------- Ambulance ---------- */
export const VEHICLE_TYPES = ["Basic Life Support", "Advanced Life Support", "Patient Transport", "Neonatal Transport", "Mortuary Van"] as const;
export const TRIP_TYPES = ["Emergency", "Inter-facility Transfer", "Discharge Drop", "Scheduled Pickup", "Dead Body Transfer", "Event Standby"] as const;
export const AMB_EQUIPMENT = ["Oxygen", "Ventilator", "Defibrillator", "Cardiac Monitor", "Suction", "Infusion Pump", "Spine Board", "Stretcher", "Wheelchair", "Incubator", "Freezer Box"] as const;

export const MODULES: ModuleDef[] = [
  {
    key: "patients",
    label: "Patients",
    description: "Patient registration and records",
    icon: "users",
    custom: true,
    resources: [
      {
        key: "patients",
        label: "Patients",
        singular: "Patient",
        codePrefix: "MC",
        labelField: "fullName",
        lookup: true,
        lookupFields: ["mobile"],
        fields: [
          { name: "fullName", label: "Full name", type: "text", required: true, maxLength: 120, list: true, search: true },
          { name: "dateOfBirth", label: "Date of birth", type: "date", required: true, past: true },
          { name: "gender", label: "Gender", type: "select", options: GENDERS, required: true, list: true },
          { name: "mobile", label: "Mobile number", type: "tel", required: true, list: true, search: true },
          { name: "email", label: "Email address", type: "email", search: true },
          { name: "patientType", label: "Patient type", type: "select", options: PATIENT_TYPES, required: true, default: "OPD", list: true },
          { name: "bloodGroup", label: "Blood group", type: "select", options: BLOOD_GROUPS },
          { name: "address", label: "Residential address", type: "textarea", required: true, maxLength: 500, wide: true },
          { name: "emergencyContactName", label: "Emergency contact name", type: "text", maxLength: 120 },
          { name: "emergencyContactPhone", label: "Emergency contact phone", type: "tel" },
        ],
      },
    ],
  },
  {
    key: "opd_ipd",
    label: "OPD / IPD",
    description: "Outpatient visits and inpatient admissions",
    icon: "stethoscope",
    resources: [
      {
        key: "visits",
        label: "OPD Visits",
        singular: "OPD Visit",
        codePrefix: "OPD",
        labelField: "code",
        statusField: "status",
        fields: [
          { name: "patient", label: "Patient", type: "ref", ref: "patients.patients", required: true, list: true },
          { name: "visitDate", label: "Visit date", type: "date", required: true, list: true },
          { name: "department", label: "Department", type: "select", options: DEPARTMENTS, required: true, list: true },
          { name: "doctor", label: "Doctor", type: "ref", ref: "doctors.doctors", list: true },
          { name: "complaint", label: "Chief complaint", type: "textarea", maxLength: 1000, wide: true, search: true },
          { name: "status", label: "Status", type: "select", options: ["Waiting", "In Consultation", "Completed", "Cancelled"], required: true, default: "Waiting", list: true },
        ],
      },
      {
        key: "admissions",
        label: "IPD Admissions",
        singular: "IPD Admission",
        codePrefix: "IPD",
        labelField: "code",
        statusField: "status",
        check: notBefore("dischargeDate", "admissionDate", "Discharge date cannot be before admission date"),
        fields: [
          { name: "patient", label: "Patient", type: "ref", ref: "patients.patients", required: true, list: true },
          { name: "admissionDate", label: "Admission date", type: "date", required: true, list: true },
          { name: "ward", label: "Ward", type: "text", required: true, maxLength: 60, list: true, search: true },
          { name: "bedNumber", label: "Bed number", type: "text", required: true, maxLength: 20, list: true, search: true },
          { name: "doctor", label: "Attending doctor", type: "ref", ref: "doctors.doctors" },
          { name: "diagnosis", label: "Diagnosis", type: "textarea", maxLength: 1000, wide: true, search: true },
          { name: "dischargeDate", label: "Discharge date", type: "date" },
          { name: "status", label: "Status", type: "select", options: ["Admitted", "Discharged", "Transferred"], required: true, default: "Admitted", list: true },
        ],
      },
    ],
  },
  {
    key: "doctors",
    label: "Doctors",
    description: "Doctor profiles, working hours, leaves and appointments",
    icon: "user-round-check",
    resources: [
      {
        key: "doctors",
        label: "Doctors",
        singular: "Doctor",
        codePrefix: "DR",
        labelField: "fullName",
        statusField: "status",
        lookup: true,
        lookupFields: ["specialization"],
        // Inactive doctors cannot be picked for new visits, appointments or bills.
        lookupFilter: { status: "Active|On Leave" },
        fields: [
          { name: "photo", label: "Photo", type: "image", maxLength: 300_000, list: true, wide: true, section: "Personal & contact details", hint: "JPEG, PNG or WebP. Resized automatically." },
          { name: "fullName", label: "Full name", type: "text", required: true, maxLength: 120, list: true, search: true, placeholder: "e.g. Dr. Anita Sharma" },
          { name: "gender", label: "Gender", type: "select", options: GENDERS },
          { name: "dateOfBirth", label: "Date of birth", type: "date", past: true },
          { name: "phone", label: "Mobile", type: "tel", required: true, list: true, search: true },
          { name: "alternatePhone", label: "Alternate phone", type: "tel" },
          { name: "email", label: "Email", type: "email", search: true },
          { name: "address", label: "Residential address", type: "textarea", maxLength: 300, wide: true },

          { name: "qualification", label: "Qualification", type: "text", required: true, maxLength: 120, search: true, placeholder: "e.g. MBBS, MD (Medicine)", section: "Qualification & registration" },
          { name: "specialization", label: "Specialization", type: "select", options: DEPARTMENTS, required: true, list: true },
          { name: "experienceYears", label: "Experience (years)", type: "number", min: 0, max: 70 },
          { name: "registrationNo", label: "Medical registration no.", type: "text", required: true, maxLength: 40, list: true, search: true, hint: "Must be unique across doctors" },
          { name: "registrationCouncil", label: "Registration council", type: "text", maxLength: 120, placeholder: "e.g. Maharashtra Medical Council" },
          { name: "registrationValidUntil", label: "Registration valid until", type: "date" },

          { name: "hospitalName", label: "Hospital / clinic name", type: "text", maxLength: 150, placeholder: "e.g. MediCare Hospital – Main Block", section: "Clinic / hospital details" },
          { name: "cabinNo", label: "Cabin / room no.", type: "text", maxLength: 30 },
          { name: "clinicPhone", label: "Clinic phone", type: "tel" },
          { name: "clinicAddress", label: "Clinic address", type: "textarea", maxLength: 300, wide: true },

          { name: "consultationFee", label: "Consultation fee", type: "number", min: 0, required: true, list: true, section: "Consultation fees" },
          { name: "followUpFee", label: "Follow-up fee", type: "number", min: 0 },
          { name: "followUpValidityDays", label: "Follow-up valid for (days)", type: "number", min: 0, max: 365, hint: "Follow-up fee applies within this many days of a visit" },
          { name: "emergencyFee", label: "Emergency / after-hours fee", type: "number", min: 0 },
          { name: "ipdVisitFee", label: "IPD visit fee (per visit)", type: "number", min: 0 },
          { name: "revenueSharePct", label: "Doctor's share of fees (%)", type: "number", min: 0, max: 100, hint: "Used to work out doctor payouts in Billing → Doctor Fees" },

          { name: "workingDays", label: "Working days", type: "multiselect", options: WORK_WEEK, required: true, default: "Mon,Tue,Wed,Thu,Fri,Sat", wide: true, section: "Availability & working hours" },
          { name: "startTime", label: "Working hours from", type: "time", required: true, default: "09:00" },
          { name: "endTime", label: "Working hours to", type: "time", required: true, default: "17:00" },
          { name: "slotMinutes", label: "Appointment slot (minutes)", type: "number", min: 5, max: 240, default: 15 },
          { name: "maxPatientsPerDay", label: "Max appointments per day", type: "number", min: 1, max: 500, hint: "Leave blank for no limit" },
          { name: "availability", label: "Availability notes", type: "text", maxLength: 200, wide: true, placeholder: "e.g. Lunch 13:00–14:00; on call alternate Sundays" },
          { name: "status", label: "Status", type: "select", options: ["Active", "On Leave", "Inactive"], required: true, default: "Active", list: true, hint: "Inactive doctors are hidden from doctor pickers" },
        ],
        check: (v): Record<string, string> => (typeof v.startTime === "string" && typeof v.endTime === "string" && v.endTime <= v.startTime ? { endTime: "Must be after the start time" } : {}),
      },
      {
        key: "appointments",
        label: "Appointments",
        singular: "Appointment",
        codePrefix: "APT",
        labelField: "code",
        statusField: "status",
        fields: [
          { name: "patient", label: "Patient", type: "ref", ref: "patients.patients", required: true, list: true },
          { name: "doctor", label: "Doctor", type: "ref", ref: "doctors.doctors", required: true, list: true },
          { name: "date", label: "Date", type: "date", required: true, list: true },
          { name: "time", label: "Time", type: "time", required: true, list: true },
          { name: "reason", label: "Reason", type: "textarea", maxLength: 500, wide: true, search: true },
          { name: "status", label: "Status", type: "select", options: ["Scheduled", "Completed", "Cancelled", "No-show"], required: true, default: "Scheduled", list: true },
        ],
      },
      {
        key: "leaves",
        label: "Leaves",
        singular: "Leave",
        codePrefix: "DLV",
        labelField: "code",
        statusField: "status",
        fields: [
          { name: "doctor", label: "Doctor", type: "ref", ref: "doctors.doctors", required: true, list: true },
          { name: "leaveType", label: "Leave type", type: "select", options: ["Casual", "Sick", "Earned", "Conference / CME", "Emergency", "Other"], required: true, list: true },
          { name: "fromDate", label: "From", type: "date", required: true, list: true },
          { name: "toDate", label: "To", type: "date", required: true, list: true },
          { name: "days", label: "Days", type: "number", readOnly: true, list: true, hint: "Calculated from the dates" },
          { name: "substitute", label: "Covering doctor", type: "ref", ref: "doctors.doctors", list: true },
          { name: "reason", label: "Reason", type: "textarea", maxLength: 500, wide: true, search: true },
          { name: "status", label: "Status", type: "select", options: ["Pending", "Approved", "Rejected", "Cancelled"], required: true, default: "Pending", list: true, hint: "Approved leave blocks appointments in this period" },
        ],
        check: (v) => ({
          ...notBefore("toDate", "fromDate", "Cannot be before the start date")(v),
          ...(v.substitute && String(v.substitute) === String(v.doctor) ? { substitute: "Choose a different doctor" } : {}),
        }),
      },
    ],
  },
  {
    key: "nursing",
    label: "Nursing",
    description: "Duty roster and patient care notes",
    icon: "heart-pulse",
    resources: [
      {
        key: "roster",
        label: "Duty Roster",
        singular: "Duty Shift",
        labelField: "nurseName",
        statusField: "status",
        fields: [
          { name: "staff", label: "Nurse", type: "ref", ref: "hr.staff", refFilter: { staffCategory: "Nurse" }, required: true, list: true, hint: "From HR. Staff on approved leave cannot be rostered." },
          { name: "nurseName", label: "Nurse name", type: "text", required: true, readOnly: true, maxLength: 120, search: true },
          { name: "ward", label: "Ward", type: "text", required: true, maxLength: 60, list: true, search: true },
          { name: "date", label: "Date", type: "date", required: true, list: true },
          { name: "shift", label: "Shift", type: "select", options: ["Morning", "Evening", "Night"], required: true, list: true },
          { name: "status", label: "Status", type: "select", options: ["Scheduled", "On Duty", "Completed", "Absent"], required: true, default: "Scheduled", list: true },
        ],
      },
      {
        key: "care_notes",
        label: "Care Notes",
        singular: "Care Note",
        labelField: "nurseName",
        fields: [
          { name: "patient", label: "Patient", type: "ref", ref: "patients.patients", required: true, list: true },
          { name: "recordedAt", label: "Recorded at", type: "datetime", required: true, list: true },
          { name: "nurseName", label: "Nurse name", type: "text", required: true, maxLength: 120, list: true, search: true },
          { name: "temperature", label: "Temperature (°C)", type: "number", min: 30, max: 45 },
          { name: "bloodPressure", label: "Blood pressure", type: "text", maxLength: 20, placeholder: "e.g. 120/80", list: true },
          { name: "pulse", label: "Pulse (bpm)", type: "number", min: 20, max: 250 },
          { name: "notes", label: "Notes", type: "textarea", maxLength: 2000, wide: true, search: true },
        ],
      },
    ],
  },
  {
    key: "laboratory",
    label: "Laboratory",
    description: "Lab bookings, samples, results, reports, QC and lab stock",
    icon: "flask-conical",
    // Orders, samples and results live in the bespoke lab workflow (lib/laboratory.ts).
    collections: [{ name: "lab_orders", label: "Lab orders" }],
    sections: [
      { key: "orders", label: "Lab Orders", group: "Operations" },
      { key: "samples", label: "Sample Tracking", group: "Operations" },
      { key: "analytics", label: "Reports & Analytics", group: "Operations" },
    ],
    resources: [
      {
        key: "tests",
        group: "Setup",
        label: "Test Master",
        singular: "Lab Test",
        labelField: "testName",
        statusField: "status",
        lookup: true,
        lookupFields: ["testCode", "sampleType"],
        lookupFilter: { status: "Active" },
        unique: ["testCode"],
        fields: [
          { name: "testName", label: "Test name", type: "text", required: true, maxLength: 120, list: true, search: true, section: "Test details" },
          { name: "testCode", label: "Test code", type: "text", required: true, maxLength: 20, list: true, search: true, hint: "Short unique code printed on sample labels, e.g. CBC" },
          { name: "category", label: "Category", type: "ref", ref: "laboratory.categories", required: true, list: true },
          { name: "reportType", label: "Report type", type: "select", options: ["Parametric", "Descriptive"], required: true, default: "Parametric", hint: "Parametric tests use Parameters & Ranges; descriptive tests take a written report" },
          { name: "method", label: "Method", type: "text", maxLength: 120, placeholder: "e.g. Automated cell counter" },
          { name: "sampleType", label: "Sample type", type: "select", options: SAMPLE_TYPES, required: true, list: true, section: "Sample" },
          { name: "container", label: "Container", type: "select", options: CONTAINERS, required: true },
          { name: "sampleVolume", label: "Sample volume", type: "text", maxLength: 40, placeholder: "e.g. 2 ml" },
          { name: "patientPreparation", label: "Patient preparation", type: "textarea", maxLength: 300, wide: true, placeholder: "e.g. 10–12 hours fasting" },
          { name: "price", label: "Base rate", type: "number", min: 0, required: true, list: true, section: "Rate & turnaround", hint: "Used when no rate-plan price is set" },
          { name: "turnaroundHours", label: "Turnaround (hours)", type: "number", min: 0, max: 2000 },
          { name: "outsourceLab", label: "Outsourced to", type: "ref", ref: "laboratory.outsource_labs", hint: "Leave blank if done in-house" },
          { name: "outsourceCost", label: "Outsource cost", type: "number", min: 0 },
          { name: "status", label: "Status", type: "select", options: ACTIVE, required: true, default: "Active", list: true },
        ],
      },
      {
        key: "categories",
        group: "Setup",
        label: "Categories",
        singular: "Test Category",
        labelField: "name",
        statusField: "status",
        lookup: true,
        lookupFilter: { status: "Active" },
        unique: ["name"],
        fields: [
          { name: "name", label: "Category name", type: "text", required: true, maxLength: 80, list: true, search: true, placeholder: "e.g. Hematology" },
          { name: "code", label: "Short code", type: "text", maxLength: 10, list: true, search: true },
          { name: "sortOrder", label: "Report order", type: "number", min: 0, max: 999, default: 10, list: true, hint: "Lower numbers print first on reports" },
          { name: "description", label: "Description", type: "textarea", maxLength: 300, wide: true },
          { name: "status", label: "Status", type: "select", options: ACTIVE, required: true, default: "Active", list: true },
        ],
      },
      {
        key: "parameters",
        group: "Setup",
        label: "Parameters & Ranges",
        singular: "Parameter",
        labelField: "name",
        unique: ["test", "name"],
        check: (v) => {
          const errors: Record<string, string> = {};
          for (const [lo, hi] of [["low", "high"], ["maleLow", "maleHigh"], ["femaleLow", "femaleHigh"], ["childLow", "childHigh"], ["criticalLow", "criticalHigh"]]) {
            const a = v[lo];
            const b = v[hi];
            if (typeof a === "number" && typeof b === "number" && a > b) errors[hi] = "Must not be below the low value";
          }
          if (v.resultType === "Options" && !String(v.options ?? "").trim()) errors.options = "List the allowed results";
          return errors;
        },
        fields: [
          { name: "test", label: "Test", type: "ref", ref: "laboratory.tests", required: true, list: true },
          { name: "name", label: "Parameter", type: "text", required: true, maxLength: 80, list: true, search: true, placeholder: "e.g. Haemoglobin" },
          { name: "unit", label: "Unit", type: "text", maxLength: 30, list: true, placeholder: "e.g. g/dL" },
          { name: "resultType", label: "Result type", type: "select", options: ["Numeric", "Text", "Options"], required: true, default: "Numeric", list: true },
          { name: "options", label: "Allowed results", type: "text", maxLength: 200, hint: "For Options: comma-separated, e.g. Positive,Negative" },
          { name: "normalValue", label: "Normal result (text)", type: "text", maxLength: 60, hint: "Text/option results other than this are flagged abnormal" },
          { name: "decimals", label: "Decimal places", type: "number", min: 0, max: 4 },
          { name: "sortOrder", label: "Order on report", type: "number", min: 0, max: 999, default: 10 },
          { name: "low", label: "Normal low", type: "number", section: "Reference ranges (numeric)", hint: "Applies when no gender/child range is set" },
          { name: "high", label: "Normal high", type: "number" },
          { name: "maleLow", label: "Male low", type: "number" },
          { name: "maleHigh", label: "Male high", type: "number" },
          { name: "femaleLow", label: "Female low", type: "number" },
          { name: "femaleHigh", label: "Female high", type: "number" },
          { name: "childLow", label: "Child low", type: "number" },
          { name: "childHigh", label: "Child high", type: "number" },
          { name: "childAgeBelow", label: "Child range below age (years)", type: "number", min: 1, max: 18, default: 12 },
          { name: "criticalLow", label: "Critical low", type: "number", hint: "Results beyond critical limits are flagged LL / HH" },
          { name: "criticalHigh", label: "Critical high", type: "number" },
          { name: "rangeText", label: "Printed range (override)", type: "text", maxLength: 120, wide: true, placeholder: "e.g. Desirable < 200" },
        ],
      },
      {
        key: "profiles",
        group: "Setup",
        label: "Profiles / Packages",
        singular: "Profile",
        codePrefix: "PKG",
        labelField: "name",
        statusField: "status",
        lookup: true,
        lookupFilter: { status: "Active" },
        fields: [
          { name: "name", label: "Profile / package name", type: "text", required: true, maxLength: 120, list: true, search: true, placeholder: "e.g. Lipid Profile, Master Health Check" },
          { name: "tests", label: "Tests included", type: "multiref", ref: "laboratory.tests", required: true, list: true, wide: true },
          { name: "price", label: "Package rate", type: "number", min: 0, required: true, list: true, hint: "Split across the included tests on the bill" },
          { name: "description", label: "Description", type: "textarea", maxLength: 500, wide: true },
          { name: "status", label: "Status", type: "select", options: ACTIVE, required: true, default: "Active", list: true },
        ],
      },
      {
        key: "rates",
        group: "Setup",
        label: "Rate Plans",
        singular: "Test Rate",
        labelField: "ratePlan",
        statusField: "status",
        unique: ["test", "ratePlan"],
        fields: [
          { name: "test", label: "Test", type: "ref", ref: "laboratory.tests", required: true, list: true },
          { name: "ratePlan", label: "Rate plan", type: "select", options: RATE_PLANS, required: true, list: true },
          { name: "rate", label: "Rate", type: "number", min: 0, required: true, list: true },
          { name: "effectiveFrom", label: "Effective from", type: "date", list: true },
          { name: "status", label: "Status", type: "select", options: ACTIVE, required: true, default: "Active", list: true },
        ],
      },
      {
        key: "outsource_labs",
        group: "Setup",
        label: "Outsourced Labs",
        singular: "Outsourced Lab",
        labelField: "name",
        statusField: "status",
        lookup: true,
        lookupFields: ["phone"],
        lookupFilter: { status: "Active" },
        fields: [
          { name: "name", label: "Lab name", type: "text", required: true, maxLength: 120, list: true, search: true },
          { name: "contactPerson", label: "Contact person", type: "text", maxLength: 80, search: true },
          { name: "phone", label: "Phone", type: "tel", required: true, list: true, search: true },
          { name: "email", label: "Email", type: "email", list: true },
          { name: "address", label: "Address", type: "textarea", maxLength: 300, wide: true },
          { name: "accreditation", label: "Accreditation (e.g. NABL no.)", type: "text", maxLength: 60, list: true },
          { name: "turnaroundDays", label: "Typical turnaround (days)", type: "number", min: 0, max: 90 },
          { name: "paymentTerms", label: "Payment terms", type: "text", maxLength: 120 },
          { name: "status", label: "Status", type: "select", options: ACTIVE, required: true, default: "Active", list: true },
        ],
      },
      {
        key: "qc",
        group: "Quality & Stock",
        label: "Quality Control",
        singular: "QC Run",
        codePrefix: "QC",
        labelField: "code",
        statusField: "result",
        fields: [
          { name: "runDate", label: "Run date", type: "date", required: true, past: true, list: true },
          { name: "test", label: "Test", type: "ref", ref: "laboratory.tests", required: true, list: true },
          { name: "analyte", label: "Analyte", type: "text", required: true, maxLength: 80, list: true, search: true, placeholder: "e.g. Glucose" },
          { name: "equipment", label: "Analyser", type: "ref", ref: "laboratory.equipment", required: true, list: true },
          { name: "controlLevel", label: "Control level", type: "select", options: ["Level 1 (Low)", "Level 2 (Normal)", "Level 3 (High)"], required: true, list: true },
          { name: "lotNo", label: "Control lot no.", type: "text", required: true, maxLength: 40, search: true },
          { name: "lotExpiry", label: "Lot expiry", type: "date" },
          { name: "targetMean", label: "Target mean", type: "number", required: true },
          { name: "sd", label: "SD", type: "number", required: true, min: 0.0001 },
          { name: "observed", label: "Observed value", type: "number", required: true, list: true },
          { name: "zScore", label: "SD index", type: "number", readOnly: true, list: true, hint: "Calculated: (observed − mean) ÷ SD" },
          { name: "result", label: "Result", type: "select", options: ["Pass", "Warning", "Fail"], readOnly: true, list: true, hint: "Westgard rules: 1-2s warns; 1-3s and 2-2s reject the run" },
          { name: "ruleViolated", label: "Rule", type: "text", readOnly: true, list: true },
          { name: "performedBy", label: "Performed by", type: "text", maxLength: 80 },
          { name: "correctiveAction", label: "Corrective action", type: "textarea", maxLength: 500, wide: true },
        ],
      },
      {
        key: "equipment",
        group: "Quality & Stock",
        label: "Equipment",
        singular: "Equipment",
        codePrefix: "EQP",
        labelField: "name",
        statusField: "status",
        lookup: true,
        lookupFields: ["model"],
        check: (v) => ({
          ...notBefore("nextCalibrationDue", "lastCalibrationDate", "Must be after the last calibration")(v),
          ...notBefore("nextServiceDue", "lastServiceDate", "Must be after the last service")(v),
        }),
        fields: [
          { name: "name", label: "Equipment name", type: "text", required: true, maxLength: 120, list: true, search: true, placeholder: "e.g. 5-part Hematology Analyser" },
          { name: "model", label: "Model", type: "text", maxLength: 80, search: true },
          { name: "manufacturer", label: "Manufacturer", type: "text", maxLength: 80, search: true },
          { name: "serialNo", label: "Serial no.", type: "text", maxLength: 60, list: true, search: true },
          { name: "section", label: "Lab section", type: "ref", ref: "laboratory.categories" },
          { name: "installDate", label: "Installed on", type: "date", past: true },
          { name: "lastCalibrationDate", label: "Last calibration", type: "date", past: true, section: "Calibration & maintenance" },
          { name: "nextCalibrationDue", label: "Next calibration due", type: "date", list: true },
          { name: "lastServiceDate", label: "Last service", type: "date", past: true },
          { name: "nextServiceDue", label: "Next service due", type: "date", list: true },
          { name: "amcVendor", label: "AMC / service vendor", type: "text", maxLength: 120 },
          { name: "amcExpiry", label: "AMC expiry", type: "date" },
          { name: "status", label: "Status", type: "select", options: ["Working", "Under Maintenance", "Out of Order", "Retired"], required: true, default: "Working", list: true },
          { name: "notes", label: "Notes", type: "textarea", maxLength: 500, wide: true },
        ],
      },
      {
        key: "reagents",
        group: "Quality & Stock",
        label: "Reagents & Consumables",
        singular: "Reagent / Consumable",
        codePrefix: "RGT",
        labelField: "name",
        statusField: "status",
        lookup: true,
        lookupFields: ["lotNo", "unit"],
        fields: [
          { name: "name", label: "Name", type: "text", required: true, maxLength: 120, list: true, search: true },
          { name: "itemType", label: "Type", type: "select", options: ["Reagent", "Consumable", "Control", "Calibrator", "Stain", "Other"], required: true, list: true },
          { name: "manufacturer", label: "Manufacturer", type: "text", maxLength: 80 },
          { name: "lotNo", label: "Lot no.", type: "text", maxLength: 40, list: true, search: true },
          { name: "expiryDate", label: "Expiry", type: "date", list: true },
          { name: "unit", label: "Unit", type: "text", required: true, maxLength: 20, placeholder: "e.g. kit, ml, pcs" },
          { name: "quantity", label: "In stock", type: "number", readOnly: true, default: 0, list: true, hint: "Changes through Reagent Stock In/Out entries" },
          { name: "reorderLevel", label: "Reorder level", type: "number", min: 0 },
          { name: "storage", label: "Storage", type: "select", options: ["Room temperature", "2–8 °C", "-20 °C", "-80 °C"] },
          { name: "supplier", label: "Supplier", type: "ref", ref: "inventory.suppliers" },
          { name: "status", label: "Stock status", type: "select", options: ["In Stock", "Low Stock", "Out of Stock", "Expired"], readOnly: true, default: "Out of Stock", list: true },
        ],
      },
      {
        key: "reagent_stock",
        group: "Quality & Stock",
        label: "Reagent Stock In/Out",
        singular: "Stock Entry",
        codePrefix: "RST",
        labelField: "code",
        statusField: "txnType",
        fields: [
          { name: "reagent", label: "Reagent / consumable", type: "ref", ref: "laboratory.reagents", required: true, list: true },
          { name: "txnType", label: "Entry type", type: "select", options: ["Stock In", "Consumed", "Wasted / Expired", "Adjustment (+)", "Adjustment (-)"], required: true, list: true },
          { name: "quantity", label: "Quantity", type: "number", required: true, min: 0.01, list: true },
          { name: "txnDate", label: "Date", type: "date", required: true, past: true, list: true },
          { name: "reference", label: "Reference", type: "text", maxLength: 60, list: true, search: true, placeholder: "Invoice no., run no." },
          { name: "notes", label: "Notes", type: "textarea", maxLength: 300, wide: true },
        ],
      },
    ],
  },
  {
    key: "inventory",
    label: "Inventory",
    description: "Store-wise stock, purchasing, issues, transfers and stock control",
    icon: "package",
    // Stock documents (PO, GRN, issues, transfers…) and the stock ledger live in lib/inventory.ts.
    collections: [{ name: "inventory_docs", label: "Stock documents" }],
    groups: ["Stock", "Purchasing", "Movements", "Masters", "Reports"],
    sections: [
      { key: "stock", label: "Stock Overview", group: "Stock" },
      { key: "reorder", label: "Reorder Alerts", group: "Stock" },
      { key: "reservation", label: "Reservations", group: "Stock" },
      { key: "verification", label: "Physical Verification", group: "Stock" },
      { key: "requisition", label: "Purchase Requisitions", group: "Purchasing" },
      { key: "po", label: "Purchase Orders", group: "Purchasing" },
      { key: "grn", label: "Goods Receipt (GRN)", group: "Purchasing" },
      { key: "purchase_return", label: "Purchase Returns", group: "Purchasing" },
      { key: "dues", label: "Supplier Bills & Dues", group: "Purchasing" },
      { key: "opening", label: "Stock Entry", group: "Movements" },
      { key: "transfer", label: "Stock Transfers", group: "Movements" },
      { key: "issue", label: "Department Issues", group: "Movements" },
      { key: "patient_issue", label: "Patient Issues", group: "Movements" },
      { key: "return", label: "Stock Returns", group: "Movements" },
      { key: "write_off", label: "Damaged / Expired", group: "Movements" },
      { key: "adjustment", label: "Stock Adjustments", group: "Movements" },
      { key: "reports", label: "Inventory Reports", group: "Reports" },
    ],
    resources: [
      {
        key: "items",
        label: "Item Master",
        singular: "Item",
        group: "Masters",
        labelField: "name",
        statusField: "status",
        lookup: true,
        lookupFields: ["sku", "manufacturer"],
        unique: ["sku"],
        fields: [
          { name: "name", label: "Item name", type: "text", required: true, maxLength: 120, list: true, search: true, section: "Item details" },
          { name: "sku", label: "Item code / SKU", type: "text", maxLength: 40, list: true, search: true, hint: "Leave blank to generate from the category code, e.g. MED-00012" },
          { name: "barcode", label: "Barcode", type: "text", maxLength: 40, search: true, hint: "Manufacturer barcode; defaults to the SKU" },
          { name: "category", label: "Category", type: "ref", ref: "inventory.categories", required: true, list: true },
          { name: "subcategory", label: "Subcategory", type: "ref", ref: "inventory.subcategories" },
          { name: "manufacturer", label: "Manufacturer / brand", type: "text", maxLength: 120, search: true },
          { name: "hsnCode", label: "HSN code", type: "text", maxLength: 12 },
          { name: "gstRate", label: "GST %", type: "select", options: GST_RATES, required: true, default: "12" },
          { name: "mrp", label: "Default MRP per issue unit", type: "number", min: 0, hint: "Used when a batch has no MRP of its own" },
          { name: "issueUnit", label: "Issue / stock unit", type: "ref", ref: "inventory.units", required: true, section: "Units of measurement", hint: "Stock is counted in this unit, e.g. Tablet, Strip, Piece" },
          { name: "purchaseUnit", label: "Purchase unit", type: "ref", ref: "inventory.units", hint: "e.g. Box. Leave blank if bought in the issue unit" },
          { name: "conversion", label: "Issue units per purchase unit", type: "number", min: 1, default: 1, hint: "e.g. 10 strips in a box" },
          { name: "batchTracked", label: "Track batch & expiry", type: "select", options: ["Yes", "No"], required: true, default: "Yes", section: "Stock control" },
          { name: "minLevel", label: "Minimum stock", type: "number", min: 0 },
          { name: "maxLevel", label: "Maximum stock", type: "number", min: 0 },
          { name: "reorderLevel", label: "Reorder level", type: "number", min: 0, list: true, hint: "Alert when total stock falls to this level" },
          { name: "reorderQty", label: "Reorder quantity", type: "number", min: 0, hint: "Suggested order quantity (purchase units)" },
          { name: "storage", label: "Storage", type: "select", options: ["Room temperature", "2–8 °C", "Below 25 °C", "Frozen", "Controlled / Narcotic"] },
          { name: "supplier", label: "Preferred supplier", type: "ref", ref: "inventory.suppliers" },
          { name: "quantity", label: "Total stock", type: "number", min: 0, default: 0, list: true, readOnly: true, hint: "All stores; maintained by stock movements" },
          { name: "unitCost", label: "Last purchase rate (per issue unit)", type: "number", min: 0, readOnly: true },
          { name: "status", label: "Status", type: "select", options: ACTIVE, required: true, default: "Active", list: true },
        ],
        check: (v): Record<string, string> => (typeof v.minLevel === "number" && typeof v.maxLevel === "number" && v.maxLevel < v.minLevel ? { maxLevel: "Must not be below the minimum" } : {}),
      },
      {
        key: "categories",
        label: "Categories",
        singular: "Item Category",
        group: "Masters",
        labelField: "name",
        statusField: "status",
        lookup: true,
        lookupFields: ["code"],
        lookupFilter: { status: "Active" },
        unique: ["code"],
        fields: [
          { name: "name", label: "Category name", type: "text", required: true, maxLength: 80, list: true, search: true, placeholder: "e.g. Medicines, Surgical, Lab Consumables" },
          { name: "code", label: "Code (SKU prefix)", type: "text", required: true, maxLength: 5, list: true, search: true, hint: "2–5 letters, e.g. MED" },
          { name: "description", label: "Description", type: "textarea", maxLength: 300, wide: true },
          { name: "status", label: "Status", type: "select", options: ACTIVE, required: true, default: "Active", list: true },
        ],
      },
      {
        key: "subcategories",
        label: "Subcategories",
        singular: "Subcategory",
        group: "Masters",
        labelField: "name",
        statusField: "status",
        lookup: true,
        lookupFilter: { status: "Active" },
        unique: ["category", "name"],
        fields: [
          { name: "category", label: "Category", type: "ref", ref: "inventory.categories", required: true, list: true },
          { name: "name", label: "Subcategory", type: "text", required: true, maxLength: 80, list: true, search: true, placeholder: "e.g. Antibiotics, Sutures" },
          { name: "status", label: "Status", type: "select", options: ACTIVE, required: true, default: "Active", list: true },
        ],
      },
      {
        key: "units",
        label: "Units of Measure",
        singular: "Unit",
        group: "Masters",
        labelField: "name",
        lookup: true,
        lookupFields: ["symbol"],
        unique: ["name"],
        fields: [
          { name: "name", label: "Unit name", type: "text", required: true, maxLength: 40, list: true, search: true, placeholder: "e.g. Strip, Box, Vial, Piece, ml" },
          { name: "symbol", label: "Symbol", type: "text", required: true, maxLength: 10, list: true, search: true, placeholder: "e.g. STR" },
          { name: "description", label: "Description", type: "text", maxLength: 120, list: true },
        ],
      },
      {
        key: "stores",
        label: "Stores & Departments",
        singular: "Store",
        group: "Masters",
        labelField: "name",
        statusField: "status",
        lookup: true,
        lookupFields: ["storeType"],
        lookupFilter: { status: "Active" },
        unique: ["name"],
        fields: [
          { name: "name", label: "Store / department name", type: "text", required: true, maxLength: 80, list: true, search: true, placeholder: "e.g. Main Store, OT Complex, ICU, Ward 3" },
          { name: "storeType", label: "Type", type: "select", options: STORE_TYPES, required: true, list: true, hint: "Pharmacy sales use the Pharmacy store" },
          { name: "code", label: "Code", type: "text", maxLength: 10, list: true, search: true },
          { name: "inCharge", label: "In-charge", type: "text", maxLength: 80, list: true },
          { name: "location", label: "Location", type: "text", maxLength: 120 },
          { name: "status", label: "Status", type: "select", options: ACTIVE, required: true, default: "Active", list: true },
        ],
      },
      {
        key: "batches",
        label: "Batch Stock",
        singular: "Batch",
        group: "Stock",
        labelField: "batchNo",
        readOnly: true,
        lookup: true,
        lookupFields: ["expiryDate"],
        unique: ["item", "store", "batchNo"],
        fields: [
          { name: "item", label: "Item", type: "ref", ref: "inventory.items", required: true, list: true },
          { name: "store", label: "Store", type: "ref", ref: "inventory.stores", list: true },
          { name: "batchNo", label: "Batch no.", type: "text", required: true, maxLength: 40, list: true, search: true },
          { name: "expiryDate", label: "Expiry", type: "date", list: true },
          { name: "quantity", label: "Qty in stock", type: "number", min: 0, required: true, list: true },
          { name: "mrp", label: "MRP", type: "number", min: 0, list: true },
          { name: "purchaseRate", label: "Purchase rate", type: "number", min: 0, list: true },
          { name: "gstRate", label: "GST %", type: "select", options: GST_RATES },
          { name: "supplier", label: "Supplier", type: "ref", ref: "inventory.suppliers" },
        ],
      },
      {
        key: "suppliers",
        label: "Suppliers / Vendors",
        singular: "Supplier",
        group: "Purchasing",
        labelField: "name",
        statusField: "status",
        lookup: true,
        lookupFields: ["phone"],
        fields: [
          { name: "name", label: "Supplier name", type: "text", required: true, maxLength: 120, list: true, search: true },
          { name: "contactPerson", label: "Contact person", type: "text", maxLength: 120, list: true, search: true },
          { name: "phone", label: "Phone", type: "tel", required: true, list: true, search: true },
          { name: "email", label: "Email", type: "email", list: true, search: true },
          { name: "gstin", label: "GSTIN", type: "text", maxLength: 15, list: true, search: true },
          { name: "drugLicenseNo", label: "Drug licence no.", type: "text", maxLength: 40 },
          { name: "address", label: "Address", type: "textarea", maxLength: 500, wide: true },
          { name: "paymentTermsDays", label: "Credit period (days)", type: "number", min: 0, max: 365, default: 30, section: "Payment terms & bank", hint: "Bills are due this many days after the invoice date" },
          { name: "bankName", label: "Bank", type: "text", maxLength: 80 },
          { name: "accountNo", label: "Account no.", type: "text", maxLength: 30 },
          { name: "ifsc", label: "IFSC", type: "text", maxLength: 15 },
          { name: "status", label: "Status", type: "select", options: ACTIVE, required: true, default: "Active", list: true },
        ],
      },
      {
        key: "supplier_payments",
        label: "Vendor Payments",
        singular: "Vendor Payment",
        group: "Purchasing",
        codePrefix: "VPY",
        labelField: "code",
        statusField: "mode",
        fields: [
          { name: "supplier", label: "Supplier", type: "ref", ref: "inventory.suppliers", required: true, list: true },
          { name: "billRef", label: "Against bill (GRN / purchase no.)", type: "text", maxLength: 30, list: true, search: true, hint: "Leave blank for an on-account / advance payment" },
          { name: "paymentDate", label: "Payment date", type: "date", required: true, past: true, list: true },
          { name: "amount", label: "Amount", type: "number", required: true, min: 0.01, list: true },
          { name: "mode", label: "Mode", type: "select", options: ["Bank Transfer", "Cheque", "UPI", "Cash", "Card"], required: true, list: true },
          { name: "reference", label: "Cheque / UTR no.", type: "text", maxLength: 40, list: true, search: true },
          { name: "notes", label: "Notes", type: "textarea", maxLength: 300, wide: true },
        ],
      },
    ],
  },
  {
    key: "billing",
    label: "Billing & Payments",
    description: "OPD, IPD and emergency bills, collections, advances, refunds, cash counter and billing reports",
    icon: "receipt",
    // Bills, receipts and cashier shifts live in the bespoke billing workflow (lib/billing.ts).
    collections: [
      { name: "billing_bills", label: "Bills" },
      { name: "billing_shifts", label: "Cashier shifts" },
    ],
    groups: ["Billing", "Cash & Collections", "Reports", "Masters"],
    sections: [
      { key: "bills", label: "All Bills", group: "Billing" },
      { key: "ipd", label: "IPD & Discharge", group: "Billing" },
      { key: "payers", label: "Corporate & TPA", group: "Billing" },
      { key: "counter", label: "Cash Counter & Shifts", group: "Cash & Collections" },
      { key: "receipts", label: "Receipts & Advances", group: "Cash & Collections" },
      { key: "dues", label: "Outstanding Dues", group: "Cash & Collections" },
      { key: "refunds", label: "Refunds", group: "Cash & Collections" },
      { key: "reconciliation", label: "Reconciliation", group: "Cash & Collections" },
      { key: "closing", label: "Daily Cash Closing", group: "Cash & Collections" },
      { key: "reports", label: "Billing Reports", group: "Reports" },
      { key: "doctor_fees", label: "Doctor Fees", group: "Reports" },
    ],
    resources: [
      {
        key: "services",
        group: "Masters",
        label: "Service Master",
        singular: "Service",
        labelField: "name",
        statusField: "status",
        lookup: true,
        lookupFields: ["code", "category"],
        lookupFilter: { status: "Active" },
        unique: ["code"],
        fields: [
          { name: "name", label: "Service name", type: "text", required: true, maxLength: 120, list: true, search: true, placeholder: "e.g. General Ward Bed Charges", section: "Service details" },
          { name: "code", label: "Service code", type: "text", required: true, maxLength: 20, list: true, search: true, hint: "Short unique code, e.g. BED-GEN" },
          { name: "category", label: "Billing head", type: "select", options: SERVICE_CATEGORIES, required: true, list: true },
          { name: "department", label: "Department", type: "select", options: DEPARTMENTS },
          { name: "rate", label: "Base rate", type: "number", min: 0, required: true, list: true, section: "Rate & tax", hint: "Used when the Rate List has no price for the bill's rate plan" },
          { name: "unit", label: "Charged", type: "select", options: CHARGE_UNITS, required: true, default: "Per service", list: true, hint: "Per-day charges default to the length of stay on IPD bills" },
          { name: "rateEditable", label: "Rate can be changed while billing", type: "select", options: ["No", "Yes"], required: true, default: "No" },
          { name: "gstRate", label: "GST %", type: "select", options: GST_RATES, required: true, default: "0", hint: "Most healthcare services are exempt (0%). GST is added on top of the rate." },
          { name: "sacCode", label: "SAC / HSN code", type: "text", maxLength: 12 },
          { name: "status", label: "Status", type: "select", options: ACTIVE, required: true, default: "Active", list: true },
        ],
      },
      {
        key: "packages",
        group: "Masters",
        label: "Packages",
        singular: "Package",
        codePrefix: "HPK",
        labelField: "name",
        statusField: "status",
        lookup: true,
        lookupFields: ["billType"],
        lookupFilter: { status: "Active" },
        fields: [
          { name: "name", label: "Package name", type: "text", required: true, maxLength: 120, list: true, search: true, placeholder: "e.g. Normal Delivery Package" },
          { name: "billType", label: "For bill type", type: "select", options: BILL_TYPES, list: true, hint: "Leave blank to allow on any bill" },
          { name: "services", label: "Services included", type: "multiref", ref: "billing.services", required: true, list: true, wide: true },
          { name: "rate", label: "Package rate", type: "number", min: 0, required: true, list: true },
          { name: "stayDays", label: "Stay included (days)", type: "number", min: 0, max: 90 },
          { name: "gstRate", label: "GST %", type: "select", options: GST_RATES, required: true, default: "0" },
          { name: "inclusions", label: "Inclusions / exclusions", type: "textarea", maxLength: 1000, wide: true },
          { name: "status", label: "Status", type: "select", options: ACTIVE, required: true, default: "Active", list: true },
        ],
      },
      {
        key: "rates",
        group: "Masters",
        label: "Rate List",
        singular: "Service Rate",
        labelField: "ratePlan",
        statusField: "status",
        unique: ["service", "ratePlan"],
        fields: [
          { name: "service", label: "Service", type: "ref", ref: "billing.services", required: true, list: true },
          { name: "ratePlan", label: "Rate plan / tariff", type: "select", options: RATE_PLANS, required: true, list: true },
          { name: "rate", label: "Rate", type: "number", min: 0, required: true, list: true },
          { name: "effectiveFrom", label: "Effective from", type: "date", list: true },
          { name: "status", label: "Status", type: "select", options: ACTIVE, required: true, default: "Active", list: true },
        ],
      },
      {
        key: "corporates",
        group: "Masters",
        label: "Corporates & Credit Parties",
        singular: "Credit Party",
        codePrefix: "CRP",
        labelField: "name",
        statusField: "status",
        lookup: true,
        lookupFields: ["ratePlan"],
        lookupFilter: { status: "Active" },
        fields: [
          { name: "name", label: "Company / party name", type: "text", required: true, maxLength: 120, list: true, search: true },
          { name: "partyType", label: "Type", type: "select", options: ["Corporate", "Government / PSU", "Trust / NGO", "Other"], required: true, default: "Corporate", list: true },
          { name: "contactPerson", label: "Contact person", type: "text", maxLength: 80, search: true },
          { name: "phone", label: "Phone", type: "tel", required: true, list: true, search: true },
          { name: "email", label: "Email", type: "email" },
          { name: "gstin", label: "GSTIN", type: "text", maxLength: 15 },
          { name: "address", label: "Billing address", type: "textarea", maxLength: 300, wide: true },
          { name: "ratePlan", label: "Tariff", type: "select", options: RATE_PLANS, required: true, default: "Corporate", list: true, section: "Credit terms" },
          { name: "coveragePct", label: "Company pays (%)", type: "number", min: 0, max: 100, required: true, default: 100, hint: "The rest is collected from the patient as co-pay" },
          { name: "creditLimit", label: "Credit limit", type: "number", min: 0, hint: "Bills cannot be finalised on credit beyond this outstanding" },
          { name: "creditDays", label: "Credit period (days)", type: "number", min: 0, max: 365, default: 30 },
          { name: "agreementValidUntil", label: "Agreement valid until", type: "date", list: true },
          { name: "status", label: "Status", type: "select", options: ACTIVE, required: true, default: "Active", list: true },
        ],
      },
      {
        key: "doctor_payouts",
        group: "Reports",
        label: "Doctor Payouts",
        singular: "Doctor Payout",
        codePrefix: "DPO",
        labelField: "code",
        statusField: "mode",
        check: notBefore("periodTo", "periodFrom", "Cannot be before the start of the period"),
        fields: [
          { name: "doctor", label: "Doctor", type: "ref", ref: "doctors.doctors", required: true, list: true },
          { name: "periodFrom", label: "Fees from", type: "date", required: true, list: true },
          { name: "periodTo", label: "Fees to", type: "date", required: true, list: true },
          { name: "amount", label: "Amount paid", type: "number", min: 0.01, required: true, list: true },
          { name: "paymentDate", label: "Paid on", type: "date", required: true, past: true, list: true },
          { name: "mode", label: "Mode", type: "select", options: BILL_PAYMENT_MODES, required: true, list: true },
          { name: "reference", label: "Cheque / UTR no.", type: "text", maxLength: 40, search: true },
          { name: "notes", label: "Notes", type: "textarea", maxLength: 300, wide: true },
        ],
      },
    ],
  },
  {
    key: "hr",
    label: "Human Resources",
    description: "Employees, attendance, leave, payroll and statutory deductions",
    icon: "id-card",
    // Attendance and payroll live in the bespoke HR workflow (lib/hr.ts).
    collections: [
      { name: "hr_attendance", label: "Attendance entries" },
      { name: "hr_payroll_runs", label: "Payroll runs" },
    ],
    groups: ["Workforce", "Attendance & Leave", "Payroll", "Masters", "Reports"],
    sections: [
      { key: "attendance", label: "Daily Attendance", group: "Attendance & Leave" },
      { key: "leave_balance", label: "Leave Balances", group: "Attendance & Leave" },
      { key: "payroll", label: "Payroll Runs", group: "Payroll" },
      { key: "reports", label: "HR Reports", group: "Reports" },
    ],
    resources: [
      {
        key: "staff",
        group: "Workforce",
        label: "Employees",
        singular: "Employee",
        codePrefix: "EMP",
        labelField: "fullName",
        statusField: "status",
        lookup: true,
        lookupFields: ["designation", "department"],
        // Staff who have left cannot be rostered, dispatched or paid.
        lookupFilter: { status: "Active|On Leave|Notice Period" },
        check: (v) => {
          const errors: Record<string, string> = notBefore("exitDate", "joiningDate", "Cannot be before the joining date")(v);
          if ((v.status === "Resigned" || v.status === "Terminated") && !(v.exitDate instanceof Date)) errors.exitDate = "Enter the last working day";
          return errors;
        },
        fields: [
          { name: "photo", label: "Photo", type: "image", maxLength: 300_000, list: true, wide: true, section: "Personal & contact details", hint: "JPEG, PNG or WebP. Resized automatically." },
          { name: "fullName", label: "Full name", type: "text", required: true, maxLength: 120, list: true, search: true },
          { name: "gender", label: "Gender", type: "select", options: GENDERS },
          { name: "dateOfBirth", label: "Date of birth", type: "date", past: true },
          { name: "phone", label: "Mobile", type: "tel", required: true, list: true, search: true },
          { name: "email", label: "Email", type: "email", search: true },
          { name: "bloodGroup", label: "Blood group", type: "select", options: BLOOD_GROUPS },
          { name: "address", label: "Residential address", type: "textarea", maxLength: 300, wide: true },
          { name: "emergencyContactName", label: "Emergency contact name", type: "text", maxLength: 120 },
          { name: "emergencyContactPhone", label: "Emergency contact phone", type: "tel" },

          { name: "staffCategory", label: "Staff category", type: "select", options: STAFF_CATEGORIES, required: true, list: true, section: "Employment", hint: "Nurses are rostered in Nursing; drivers and paramedics crew ambulances" },
          { name: "department", label: "Department", type: "select", options: STAFF_DEPARTMENTS, required: true, list: true },
          { name: "designation", label: "Designation", type: "text", required: true, maxLength: 80, list: true, search: true, placeholder: "e.g. Staff Nurse, Lab Technician" },
          { name: "employmentType", label: "Employment type", type: "select", options: EMPLOYMENT_TYPES, required: true, default: "Permanent" },
          { name: "joiningDate", label: "Joining date", type: "date", required: true },
          { name: "contractEndDate", label: "Probation / contract ends", type: "date", hint: "Flagged in HR Reports 30 days ahead" },
          { name: "reportingTo", label: "Reports to", type: "ref", ref: "hr.staff" },
          { name: "shift", label: "Default shift", type: "ref", ref: "hr.shifts", hint: "Late arrivals are measured against this shift's start" },
          { name: "weeklyOff", label: "Weekly off", type: "select", options: [...WORK_WEEK, "Rotational"], required: true, default: "Sun", hint: "Rotational: mark week-offs in Daily Attendance" },
          { name: "doctor", label: "Doctor profile", type: "ref", ref: "doctors.doctors", hint: "Link salaried doctors to their Doctors master record" },

          { name: "registrationNo", label: "Council registration no.", type: "text", maxLength: 40, search: true, section: "Professional registration", hint: "Nursing / medical / pharmacy / paramedical council" },
          { name: "registrationValidUntil", label: "Registration valid until", type: "date", hint: "Flagged in HR Reports 60 days before expiry" },

          { name: "basicPay", label: "Basic pay (monthly)", type: "number", min: 0, required: true, section: "Salary structure", hint: "PF is calculated on basic pay (up to ₹15,000)" },
          { name: "da", label: "Dearness allowance", type: "number", min: 0 },
          { name: "hra", label: "House rent allowance", type: "number", min: 0 },
          { name: "specialAllowance", label: "Special allowance", type: "number", min: 0 },
          { name: "otherAllowance", label: "Other allowances", type: "number", min: 0 },
          { name: "salary", label: "Monthly gross", type: "number", readOnly: true, list: true, hint: "Sum of the components above" },
          { name: "pfApplicable", label: "Provident fund", type: "select", options: ["Yes", "No"], required: true, default: "Yes", hint: "Employee 12% of basic (capped at ₹15,000 basic)" },
          { name: "esiApplicable", label: "ESI", type: "select", options: ["Auto", "No"], required: true, default: "Auto", hint: "Auto: 0.75% when monthly gross is ₹21,000 or less" },
          { name: "ptApplicable", label: "Professional tax", type: "select", options: ["Yes", "No"], required: true, default: "Yes" },

          { name: "pan", label: "PAN", type: "text", maxLength: 10, section: "Statutory & bank details" },
          { name: "aadhaarLast4", label: "Aadhaar (last 4 digits)", type: "text", maxLength: 4, hint: "Only the last four digits are stored" },
          { name: "uan", label: "PF UAN", type: "text", maxLength: 12 },
          { name: "esiNumber", label: "ESI IP number", type: "text", maxLength: 17 },
          { name: "salaryMode", label: "Salary paid by", type: "select", options: ["Bank Transfer", "Cheque", "Cash"], required: true, default: "Bank Transfer" },
          { name: "bankName", label: "Bank", type: "text", maxLength: 80 },
          { name: "accountNo", label: "Account no.", type: "text", maxLength: 20 },
          { name: "ifsc", label: "IFSC", type: "text", maxLength: 11 },

          { name: "status", label: "Status", type: "select", options: ["Active", "On Leave", "Notice Period", "Resigned", "Terminated"], required: true, default: "Active", list: true, section: "Status", hint: "Use On Leave only for long absences; daily leave comes from Leave Applications" },
          { name: "exitDate", label: "Last working day", type: "date" },
          { name: "exitReason", label: "Exit reason", type: "text", maxLength: 200, wide: true },
        ],
      },
      {
        key: "leaves",
        group: "Attendance & Leave",
        label: "Leave Applications",
        singular: "Leave Application",
        codePrefix: "LVA",
        labelField: "leaveType",
        statusField: "status",
        check: (v) => {
          const errors: Record<string, string> = notBefore("toDate", "fromDate", "End date cannot be before start date")(v);
          if (v.session && v.session !== "Full day" && time(v.fromDate) !== time(v.toDate)) errors.session = "Half-day leave must start and end on the same day";
          if (v.reliever && String(v.reliever) === String(v.staff)) errors.reliever = "Choose a different employee";
          return errors;
        },
        fields: [
          { name: "staff", label: "Employee", type: "ref", ref: "hr.staff", required: true, list: true },
          { name: "leaveType", label: "Leave type", type: "select", options: LEAVE_TYPES, required: true, list: true },
          { name: "fromDate", label: "From", type: "date", required: true, list: true },
          { name: "toDate", label: "To", type: "date", required: true, list: true },
          { name: "session", label: "Duration", type: "select", options: ["Full day", "First half", "Second half"], required: true, default: "Full day" },
          { name: "days", label: "Days", type: "number", readOnly: true, list: true, hint: "Working days: holidays and the weekly off are not counted" },
          { name: "reliever", label: "Reliever / covering staff", type: "ref", ref: "hr.staff" },
          { name: "reason", label: "Reason", type: "textarea", maxLength: 500, wide: true, search: true },
          { name: "status", label: "Status", type: "select", options: ["Pending", "Approved", "Rejected", "Cancelled"], required: true, default: "Pending", list: true, hint: "Approval checks the leave balance and the nursing duty roster" },
          { name: "decisionNote", label: "Approver's note", type: "text", maxLength: 200, wide: true },
        ],
      },
      {
        key: "advances",
        group: "Payroll",
        label: "Advances & Loans",
        singular: "Advance / Loan",
        codePrefix: "ADV",
        labelField: "code",
        statusField: "status",
        check: (v): Record<string, string> => (num(v.monthlyDeduction) > num(v.amount) ? { monthlyDeduction: "Cannot exceed the amount given" } : {}),
        fields: [
          { name: "staff", label: "Employee", type: "ref", ref: "hr.staff", required: true, list: true },
          { name: "advanceType", label: "Type", type: "select", options: ["Salary Advance", "Loan"], required: true, default: "Salary Advance", list: true },
          { name: "amount", label: "Amount given", type: "number", min: 1, required: true, list: true },
          { name: "issueDate", label: "Given on", type: "date", required: true, past: true, list: true },
          { name: "monthlyDeduction", label: "Recover per month", type: "number", min: 1, required: true, hint: "Deducted in each finalised payroll until repaid" },
          { name: "mode", label: "Paid by", type: "select", options: ["Cash", "Bank Transfer", "Cheque", "UPI"], required: true, default: "Bank Transfer" },
          { name: "reference", label: "Cheque / UTR no.", type: "text", maxLength: 40 },
          { name: "recovered", label: "Recovered", type: "number", readOnly: true, default: 0, list: true },
          { name: "balance", label: "Balance", type: "number", readOnly: true, list: true },
          { name: "status", label: "Status", type: "select", options: ["Active", "Closed"], readOnly: true, default: "Active", list: true },
          { name: "notes", label: "Notes", type: "textarea", maxLength: 300, wide: true },
        ],
      },
      {
        key: "shifts",
        group: "Masters",
        label: "Shifts",
        singular: "Shift",
        labelField: "name",
        statusField: "status",
        lookup: true,
        lookupFields: ["code"],
        lookupFilter: { status: "Active" },
        unique: ["code"],
        fields: [
          { name: "name", label: "Shift name", type: "text", required: true, maxLength: 60, list: true, search: true, placeholder: "e.g. Morning, General, Night" },
          { name: "code", label: "Code", type: "text", required: true, maxLength: 6, list: true, search: true, placeholder: "e.g. M, G, N" },
          { name: "startTime", label: "Starts", type: "time", required: true, list: true },
          { name: "endTime", label: "Ends", type: "time", required: true, list: true, hint: "May be after midnight for night shifts" },
          { name: "graceMinutes", label: "Late after (minutes)", type: "number", min: 0, max: 120, default: 10 },
          { name: "status", label: "Status", type: "select", options: ACTIVE, required: true, default: "Active", list: true },
        ],
      },
      {
        key: "leave_policies",
        group: "Masters",
        label: "Leave Policy",
        singular: "Leave Policy",
        labelField: "leaveType",
        statusField: "status",
        unique: ["leaveType"],
        fields: [
          { name: "leaveType", label: "Leave type", type: "select", options: LEAVE_TYPES, required: true, list: true },
          { name: "annualQuota", label: "Days per year", type: "number", min: 0, max: 365, list: true, hint: "Leave blank for no limit (e.g. unpaid leave)" },
          { name: "paid", label: "Paid leave", type: "select", options: ["Yes", "No"], required: true, default: "Yes", list: true, hint: "Unpaid leave is deducted as loss of pay" },
          { name: "carryForwardMax", label: "Carry forward up to (days)", type: "number", min: 0, max: 365, list: true, hint: "Unused days carried into the next year" },
          { name: "halfDayAllowed", label: "Half days allowed", type: "select", options: ["Yes", "No"], required: true, default: "Yes" },
          { name: "appliesTo", label: "Applies to", type: "select", options: ["All", "Female", "Male"], required: true, default: "All", list: true },
          { name: "minServiceDays", label: "Eligible after service of (days)", type: "number", min: 0, max: 3650 },
          { name: "status", label: "Status", type: "select", options: ACTIVE, required: true, default: "Active", list: true },
        ],
      },
      {
        key: "holidays",
        group: "Masters",
        label: "Holidays",
        singular: "Holiday",
        labelField: "name",
        unique: ["date"],
        fields: [
          { name: "date", label: "Date", type: "date", required: true, list: true },
          { name: "name", label: "Holiday", type: "text", required: true, maxLength: 80, list: true, search: true, placeholder: "e.g. Independence Day" },
          { name: "holidayType", label: "Type", type: "select", options: ["National", "Festival", "Hospital"], required: true, default: "Festival", list: true, hint: "Paid holiday for everyone; staff on duty can be marked present" },
        ],
      },
    ],
  },
  {
    key: "insurance",
    label: "Insurance",
    description: "Cashless pre-authorisation, claims, settlements and insurer / TPA masters",
    icon: "shield-check",
    // Pre-authorisations and claims live in the bespoke workflow (lib/insurance.ts).
    collections: [
      { name: "insurance_claims", label: "Claims" },
      { name: "insurance_preauths", label: "Pre-auths" },
    ],
    groups: ["Cashless", "Claims", "Masters", "Reports"],
    sections: [
      { key: "preauth", label: "Pre-authorisations", group: "Cashless" },
      { key: "claims", label: "Claims & Settlement", group: "Claims" },
      { key: "reports", label: "Claim Reports", group: "Reports" },
    ],
    resources: [
      {
        key: "policies",
        group: "Cashless",
        label: "Patient Policies",
        singular: "Policy",
        labelField: "policyNumber",
        statusField: "status",
        lookup: true,
        lookupFields: ["memberId", "validTo"],
        lookupFilter: { status: "Active" },
        unique: ["patient", "insurer", "policyNumber"],
        check: notBefore("validTo", "validFrom", "Cannot be before the start date"),
        fields: [
          { name: "patient", label: "Patient", type: "ref", ref: "patients.patients", required: true, list: true },
          { name: "insurer", label: "Insurer", type: "ref", ref: "insurance.providers", refFilter: { payerType: "Insurance Company|Government Scheme" }, required: true, list: true },
          { name: "tpa", label: "TPA", type: "ref", ref: "insurance.providers", refFilter: { payerType: "TPA" }, list: true, hint: "Leave blank if the insurer settles directly" },
          { name: "policyNumber", label: "Policy number", type: "text", required: true, maxLength: 60, list: true, search: true },
          { name: "memberId", label: "Member / card ID", type: "text", maxLength: 40, search: true },
          { name: "policyType", label: "Policy type", type: "select", options: ["Individual", "Family Floater", "Group / Corporate", "Government Scheme"], required: true, default: "Individual" },
          { name: "policyHolder", label: "Primary insured / employee", type: "text", maxLength: 120, search: true },
          { name: "relation", label: "Patient is", type: "select", options: ["Self", "Spouse", "Son", "Daughter", "Father", "Mother", "Other"], required: true, default: "Self" },
          { name: "corporateName", label: "Employer (group policies)", type: "text", maxLength: 120 },
          { name: "sumInsured", label: "Sum insured", type: "number", min: 0, required: true, list: true, section: "Cover" },
          { name: "copayPct", label: "Co-pay (%)", type: "number", min: 0, max: 100, hint: "Patient's share of every claim" },
          { name: "roomRentLimit", label: "Room rent limit (per day)", type: "number", min: 0 },
          { name: "validFrom", label: "Valid from", type: "date", required: true },
          { name: "validTo", label: "Valid to", type: "date", required: true, list: true },
          { name: "status", label: "Status", type: "select", options: ["Active", "Expired", "Suspended"], required: true, default: "Active", list: true, hint: "Set to Expired automatically after the end date" },
          { name: "notes", label: "Notes / exclusions", type: "textarea", maxLength: 500, wide: true },
        ],
      },
      {
        key: "providers",
        group: "Masters",
        label: "Insurers & TPAs",
        singular: "Insurer / TPA",
        labelField: "name",
        statusField: "status",
        lookup: true,
        lookupFields: ["payerType"],
        lookupFilter: { status: "Active" },
        fields: [
          { name: "name", label: "Name", type: "text", required: true, maxLength: 120, list: true, search: true },
          { name: "payerType", label: "Type", type: "select", options: ["Insurance Company", "TPA", "Government Scheme", "Corporate (self-funded)"], required: true, default: "Insurance Company", list: true },
          { name: "shortCode", label: "Short code", type: "text", maxLength: 12, search: true },
          { name: "regNo", label: "IRDAI / registration no.", type: "text", maxLength: 40 },
          { name: "contactPerson", label: "Contact person", type: "text", maxLength: 80 },
          { name: "contactPhone", label: "Contact phone", type: "tel", list: true, search: true },
          { name: "email", label: "Email", type: "email", list: true, search: true },
          { name: "claimsEmail", label: "Claims / pre-auth email", type: "email" },
          { name: "portalUrl", label: "Provider portal", type: "text", maxLength: 200, placeholder: "https://…" },
          { name: "address", label: "Address", type: "textarea", maxLength: 500, wide: true },
          { name: "paymentTermsDays", label: "Settles within (days)", type: "number", min: 0, max: 365, default: 30, section: "Agreement", hint: "Claims older than this are flagged overdue" },
          { name: "agreementValidUntil", label: "Empanelment valid until", type: "date", list: true },
          { name: "status", label: "Status", type: "select", options: ACTIVE, required: true, default: "Active", list: true },
        ],
      },
    ],
  },
  {
    key: "ambulance",
    label: "Ambulance",
    description: "Dispatch, fleet, crew, trip billing, fuel and maintenance",
    icon: "ambulance",
    // Trips live in the bespoke dispatch workflow (lib/ambulance.ts).
    collections: [{ name: "ambulance_trips", label: "Trips" }],
    groups: ["Dispatch", "Fleet", "Masters", "Reports"],
    sections: [
      { key: "board", label: "Dispatch Board", group: "Dispatch" },
      { key: "trips", label: "Trip Register", group: "Dispatch" },
      { key: "reports", label: "Ambulance Reports", group: "Reports" },
    ],
    resources: [
      {
        key: "vehicles",
        group: "Fleet",
        label: "Vehicles",
        singular: "Vehicle",
        labelField: "vehicleNumber",
        statusField: "status",
        lookup: true,
        lookupFields: ["type", "status"],
        unique: ["vehicleNumber"],
        fields: [
          { name: "vehicleNumber", label: "Registration number", type: "text", required: true, maxLength: 20, list: true, search: true, placeholder: "e.g. MH12 AB 1234" },
          { name: "type", label: "Type", type: "select", options: VEHICLE_TYPES, required: true, list: true },
          { name: "make", label: "Make & model", type: "text", maxLength: 80, search: true },
          { name: "year", label: "Year", type: "number", min: 1990, max: 2100 },
          { name: "fuelType", label: "Fuel", type: "select", options: ["Diesel", "Petrol", "CNG", "Electric"] },
          { name: "equipment", label: "Equipment on board", type: "multiselect", options: AMB_EQUIPMENT, wide: true },
          { name: "defaultDriver", label: "Regular driver", type: "ref", ref: "hr.staff", refFilter: { staffCategory: "Driver" }, hint: "Pre-selected when dispatching this vehicle" },
          { name: "driverName", label: "Driver", type: "text", readOnly: true, list: true },
          { name: "driverPhone", label: "Driver phone", type: "tel", readOnly: true, list: true },
          { name: "baseLocation", label: "Stationed at", type: "text", maxLength: 80 },
          { name: "insuranceExpiry", label: "Insurance valid until", type: "date", list: true, section: "Compliance", hint: "Vehicles with expired insurance or fitness cannot be dispatched" },
          { name: "fitnessExpiry", label: "Fitness certificate valid until", type: "date" },
          { name: "pucExpiry", label: "PUC valid until", type: "date" },
          { name: "permitExpiry", label: "Permit valid until", type: "date" },
          { name: "nextServiceDue", label: "Next service due", type: "date", hint: "Updated from completed service records" },
          { name: "odometer", label: "Odometer (km)", type: "number", readOnly: true, default: 0, list: true, hint: "Updated by completed trips and fuel entries" },
          { name: "status", label: "Status", type: "select", options: ["Available", "On Trip", "Maintenance", "Out of Service"], required: true, default: "Available", list: true, hint: "On Trip is set automatically by dispatch" },
        ],
      },
      {
        key: "fuel",
        group: "Fleet",
        label: "Fuel Log",
        singular: "Fuel Entry",
        codePrefix: "FUL",
        labelField: "code",
        fields: [
          { name: "vehicle", label: "Vehicle", type: "ref", ref: "ambulance.vehicles", required: true, list: true },
          { name: "fillDate", label: "Date", type: "date", required: true, past: true, list: true },
          { name: "litres", label: "Litres / kWh", type: "number", min: 0.1, max: 500, required: true, list: true },
          { name: "rate", label: "Rate per litre", type: "number", min: 0, required: true },
          { name: "amount", label: "Amount", type: "number", readOnly: true, list: true },
          { name: "odometer", label: "Odometer (km)", type: "number", min: 0, required: true, list: true, hint: "Must not be below the vehicle's last reading" },
          { name: "station", label: "Fuel station", type: "text", maxLength: 80, search: true },
          { name: "paymentMode", label: "Paid by", type: "select", options: ["Cash", "Card", "UPI", "Fuel Card", "Credit"], required: true, default: "Fuel Card" },
          { name: "billNo", label: "Bill no.", type: "text", maxLength: 30, search: true },
          { name: "filledBy", label: "Filled by", type: "ref", ref: "hr.staff", refFilter: { staffCategory: "Driver" } },
        ],
      },
      {
        key: "maintenance",
        group: "Fleet",
        label: "Service & Repairs",
        singular: "Service Job",
        codePrefix: "VMT",
        labelField: "code",
        statusField: "status",
        check: notBefore("endDate", "startDate", "Cannot be before the start date"),
        fields: [
          { name: "vehicle", label: "Vehicle", type: "ref", ref: "ambulance.vehicles", required: true, list: true },
          { name: "jobType", label: "Job", type: "select", options: ["Scheduled Service", "Repair", "Breakdown", "Tyres", "Accident", "Medical Equipment"], required: true, list: true },
          { name: "startDate", label: "From", type: "date", required: true, list: true },
          { name: "endDate", label: "To", type: "date", list: true },
          { name: "vendor", label: "Workshop / vendor", type: "text", maxLength: 120, list: true, search: true },
          { name: "odometerAtService", label: "Odometer (km)", type: "number", min: 0 },
          { name: "cost", label: "Cost", type: "number", min: 0, list: true },
          { name: "nextServiceDue", label: "Next service due", type: "date", hint: "Copied to the vehicle when the job is completed" },
          { name: "description", label: "Work done / complaint", type: "textarea", maxLength: 1000, wide: true, search: true },
          { name: "status", label: "Status", type: "select", options: ["Scheduled", "In Workshop", "Completed", "Cancelled"], required: true, default: "Scheduled", list: true, hint: "In Workshop takes the vehicle off the road until Completed" },
        ],
      },
      {
        key: "tariffs",
        group: "Masters",
        label: "Tariffs",
        singular: "Tariff",
        labelField: "name",
        statusField: "status",
        unique: ["vehicleType", "tripType"],
        fields: [
          { name: "name", label: "Tariff name", type: "text", required: true, maxLength: 80, list: true, search: true, placeholder: "e.g. ALS – city" },
          { name: "vehicleType", label: "Vehicle type", type: "select", options: VEHICLE_TYPES, required: true, list: true },
          { name: "tripType", label: "Trip type", type: "select", options: TRIP_TYPES, list: true, hint: "Leave blank to apply to all trip types" },
          { name: "baseFare", label: "Base fare", type: "number", min: 0, required: true, list: true },
          { name: "includedKm", label: "Km included in base fare", type: "number", min: 0, default: 5 },
          { name: "perKmRate", label: "Rate per extra km", type: "number", min: 0, required: true, list: true },
          { name: "freeWaitingMinutes", label: "Free waiting (minutes)", type: "number", min: 0, default: 30 },
          { name: "waitingPerHour", label: "Waiting charge per hour", type: "number", min: 0 },
          { name: "nightSurchargePct", label: "Night surcharge (%)", type: "number", min: 0, max: 100, hint: "Trips dispatched 10 pm – 6 am" },
          { name: "oxygenCharge", label: "Oxygen charge", type: "number", min: 0 },
          { name: "ventilatorCharge", label: "Ventilator / monitor charge", type: "number", min: 0 },
          { name: "status", label: "Status", type: "select", options: ACTIVE, required: true, default: "Active", list: true },
        ],
      },
    ],
  },
  {
    key: "blood_bank",
    label: "Blood Bank",
    description: "Donors, blood stock, requests and issues",
    icon: "droplet",
    resources: [
      {
        key: "requests",
        label: "Blood Requests",
        singular: "Blood Request",
        codePrefix: "BRQ",
        labelField: "code",
        statusField: "status",
        lookup: true,
        lookupFields: ["bloodGroup", "component", "status"],
        lookupFilter: { status: "Pending|Partially Issued" },
        fields: [
          { name: "patient", label: "Patient", type: "ref", ref: "patients.patients", required: true, list: true },
          { name: "bloodGroup", label: "Patient blood group", type: "select", options: BLOOD_GROUPS, required: true, list: true },
          { name: "component", label: "Component", type: "select", options: BLOOD_COMPONENTS, required: true, default: "Packed RBC", list: true },
          { name: "unitsRequired", label: "Units required", type: "number", min: 1, max: 20, required: true, default: 1, list: true },
          { name: "requestedBy", label: "Requested by", type: "ref", ref: "doctors.doctors" },
          { name: "requiredBy", label: "Required by", type: "date", required: true },
          { name: "priority", label: "Priority", type: "select", options: ["Routine", "Urgent", "Emergency"], required: true, default: "Routine", list: true },
          { name: "status", label: "Status", type: "select", options: ["Pending", "Partially Issued", "Issued", "Cancelled"], required: true, default: "Pending", list: true, hint: "Moves to Partially Issued / Issued automatically as bags are issued" },
          { name: "remarks", label: "Clinical remarks", type: "textarea", maxLength: 1000, wide: true },
        ],
      },
      {
        key: "issues",
        label: "Blood Issues",
        singular: "Blood Issue",
        codePrefix: "BIS",
        labelField: "code",
        fields: [
          { name: "request", label: "Blood request", type: "ref", ref: "blood_bank.requests", required: true, list: true },
          { name: "unit", label: "Blood bag", type: "ref", ref: "blood_bank.units", required: true, list: true, hint: "Only screened, available bags are listed. Group and component compatibility is checked on save." },
          { name: "issuedAt", label: "Issued at", type: "datetime", required: true, list: true },
          { name: "crossMatch", label: "Cross-match result", type: "select", options: ["Compatible", "Not Done"], required: true, default: "Compatible", list: true },
          { name: "issuedTo", label: "Handed over to", type: "text", maxLength: 120, list: true, search: true },
          { name: "notes", label: "Notes", type: "textarea", maxLength: 500, wide: true },
        ],
      },
      {
        key: "units",
        label: "Blood Stock (Bags)",
        singular: "Blood Bag",
        codePrefix: "BAG",
        labelField: "code",
        statusField: "status",
        lookup: true,
        lookupFields: ["bloodGroup", "component", "expiryDate"],
        lookupFilter: { status: "Available", screening: "Passed" },
        fields: [
          { name: "bloodGroup", label: "Blood group", type: "select", options: BLOOD_GROUPS, required: true, list: true },
          { name: "component", label: "Component", type: "select", options: BLOOD_COMPONENTS, required: true, default: "Whole Blood", list: true },
          { name: "donor", label: "Donor", type: "ref", ref: "blood_bank.donors", hint: "Blood group must match the donor's group" },
          { name: "volumeMl", label: "Volume (ml)", type: "number", min: 20, max: 600, required: true, default: 350 },
          { name: "collectionDate", label: "Collection date", type: "date", required: true, past: true, list: true },
          { name: "expiryDate", label: "Expiry date", type: "date", required: true, list: true },
          { name: "screening", label: "Screening (HIV/HBV/HCV/Syphilis/Malaria)", type: "select", options: ["Pending", "Passed", "Failed"], required: true, default: "Pending", list: true },
          { name: "status", label: "Status", type: "select", options: ["Available", "Reserved", "Issued", "Expired", "Discarded"], required: true, default: "Available", list: true, hint: "Issued and Expired are set automatically" },
          { name: "storageLocation", label: "Storage location", type: "text", maxLength: 60, placeholder: "e.g. Fridge 2, Rack B" },
        ],
        check: notBefore("expiryDate", "collectionDate", "Expiry must be after the collection date"),
      },
      {
        key: "donors",
        label: "Donors",
        singular: "Donor",
        codePrefix: "DNR",
        labelField: "fullName",
        statusField: "status",
        lookup: true,
        lookupFields: ["bloodGroup", "phone"],
        fields: [
          { name: "fullName", label: "Full name", type: "text", required: true, maxLength: 120, list: true, search: true },
          { name: "bloodGroup", label: "Blood group", type: "select", options: BLOOD_GROUPS, required: true, list: true },
          { name: "gender", label: "Gender", type: "select", options: GENDERS, required: true },
          { name: "dateOfBirth", label: "Date of birth", type: "date", required: true, past: true },
          { name: "phone", label: "Phone", type: "tel", required: true, list: true, search: true },
          { name: "weightKg", label: "Weight (kg)", type: "number", min: 30, max: 250 },
          { name: "lastDonationDate", label: "Last donation", type: "date", past: true, list: true, hint: "Updated automatically when a bag is collected from this donor" },
          { name: "status", label: "Eligibility", type: "select", options: ["Eligible", "Temporarily Deferred", "Permanently Deferred"], required: true, default: "Eligible", list: true },
          { name: "address", label: "Address", type: "textarea", maxLength: 500, wide: true },
        ],
      },
    ],
  },
  {
    key: "pharmacy",
    label: "Pharmacy",
    description: "Marg-style sale bills and purchase entries with batch stock",
    icon: "pill",
    custom: true,
    resources: [],
    collections: [
      { name: "pharmacy_sales", label: "sale bills" },
      { name: "pharmacy_purchases", label: "purchase entries" },
    ],
  },
  {
    key: "reports",
    label: "Reports",
    description: "Day book, sales register, stock, expiry and outstanding",
    icon: "chart",
    custom: true,
    resources: [],
  },
];

export const MODULE_MAP = Object.fromEntries(MODULES.map((m) => [m.key, m])) as Record<ModuleKey, ModuleDef>;

export function isModuleKey(value: unknown): value is ModuleKey {
  return typeof value === "string" && (MODULE_KEYS as readonly string[]).includes(value);
}

export function getModule(key: string): ModuleDef | undefined {
  return isModuleKey(key) ? MODULE_MAP[key] : undefined;
}

/** Tabs of a module panel, in display order, for the panel and the sidebar. */
export function moduleSections(mod: ModuleDef): { key: string; label: string; group?: string }[] {
  if (mod.custom) return [];
  const all = [...(mod.sections ?? []), ...mod.resources.map((r) => ({ key: r.key, label: r.label, group: r.group }))];
  // Keep each group together: bespoke tabs first, then that group's resources.
  const order = [...(mod.groups ?? []), ...all.map((s) => s.group ?? "")].filter((g, i, a) => a.indexOf(g) === i);
  return order.flatMap((g) => all.filter((s) => (s.group ?? "") === g));
}

/** Each module has its own panel; some have bespoke pages. */
export function moduleHref(key: ModuleKey) {
  if (key === "patients" || key === "pharmacy" || key === "reports") return `/${key}`;
  return `/m/${key}`;
}

export function getResource(moduleKey: string, resourceKey: string): ResourceDef | undefined {
  return getModule(moduleKey)?.resources.find((r) => r.key === resourceKey);
}

/** Resolve a "module.resource" reference string. */
export function resolveRef(ref: string): { module: ModuleDef; resource: ResourceDef } | undefined {
  const [m, r] = ref.split(".");
  const mod = getModule(m);
  const resource = mod?.resources.find((x) => x.key === r);
  return mod && resource ? { module: mod, resource } : undefined;
}

/** Generic resources (everything except the bespoke Patients module) that reference patients. */
export function patientLinkedResources(): { module: ModuleDef; resource: ResourceDef; field: FieldDef }[] {
  const out: { module: ModuleDef; resource: ResourceDef; field: FieldDef }[] = [];
  for (const mod of MODULES) {
    if (mod.custom) continue;
    for (const resource of mod.resources) {
      const field = resource.fields.find((f) => f.type === "ref" && f.ref === "patients.patients");
      if (field) out.push({ module: mod, resource, field });
    }
  }
  return out;
}

export const ROLES = ["super_admin", "admin"] as const;
export type Role = (typeof ROLES)[number];
