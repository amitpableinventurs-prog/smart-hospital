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
  | "ref";

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
  /** For `ref` fields: the "module.resource" key of the referenced resource. */
  ref?: string;
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
}

/** Normalised record values as produced by validation (dates are Date objects). */
export type RecordValues = Record<string, string | number | Date | null | undefined>;

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
  "Other",
] as const;

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
    description: "Doctor profiles and appointments",
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
        fields: [
          { name: "fullName", label: "Full name", type: "text", required: true, maxLength: 120, list: true, search: true },
          { name: "specialization", label: "Specialization", type: "select", options: DEPARTMENTS, required: true, list: true },
          { name: "qualification", label: "Qualification", type: "text", maxLength: 120, search: true },
          { name: "phone", label: "Phone", type: "tel", required: true, list: true, search: true },
          { name: "email", label: "Email", type: "email", search: true },
          { name: "consultationFee", label: "Consultation fee", type: "number", min: 0 },
          { name: "availability", label: "Availability", type: "text", maxLength: 200, placeholder: "e.g. Mon–Fri, 10:00–14:00" },
          { name: "status", label: "Status", type: "select", options: ["Active", "On Leave", "Inactive"], required: true, default: "Active", list: true },
        ],
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
          { name: "nurseName", label: "Nurse name", type: "text", required: true, maxLength: 120, list: true, search: true },
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
    description: "Test catalog, orders and results",
    icon: "flask-conical",
    resources: [
      {
        key: "orders",
        label: "Lab Orders",
        singular: "Lab Order",
        codePrefix: "LAB",
        labelField: "code",
        statusField: "status",
        fields: [
          { name: "patient", label: "Patient", type: "ref", ref: "patients.patients", required: true, list: true },
          { name: "test", label: "Test", type: "ref", ref: "laboratory.tests", required: true, list: true },
          { name: "orderDate", label: "Order date", type: "date", required: true, list: true },
          { name: "referredBy", label: "Referred by", type: "ref", ref: "doctors.doctors" },
          { name: "priority", label: "Priority", type: "select", options: ["Routine", "Urgent", "STAT"], required: true, default: "Routine", list: true },
          { name: "status", label: "Status", type: "select", options: ["Ordered", "Sample Collected", "In Progress", "Completed", "Cancelled"], required: true, default: "Ordered", list: true },
          { name: "result", label: "Result / findings", type: "textarea", maxLength: 4000, wide: true },
        ],
      },
      {
        key: "tests",
        label: "Test Catalog",
        singular: "Lab Test",
        labelField: "testName",
        lookup: true,
        fields: [
          { name: "testName", label: "Test name", type: "text", required: true, maxLength: 120, list: true, search: true },
          { name: "testCode", label: "Test code", type: "text", maxLength: 20, list: true, search: true },
          { name: "category", label: "Category", type: "select", options: ["Hematology", "Biochemistry", "Microbiology", "Pathology", "Radiology", "Immunology", "Other"], required: true, list: true },
          { name: "price", label: "Price", type: "number", min: 0, required: true, list: true },
          { name: "turnaroundHours", label: "Turnaround (hours)", type: "number", min: 0 },
        ],
      },
    ],
  },
  {
    key: "inventory",
    label: "Inventory",
    description: "Item master, batch-wise stock and suppliers",
    icon: "package",
    resources: [
      {
        key: "items",
        label: "Item Master",
        singular: "Item",
        labelField: "name",
        lookup: true,
        lookupFields: ["sku", "category"],
        fields: [
          { name: "name", label: "Item name", type: "text", required: true, maxLength: 120, list: true, search: true },
          { name: "sku", label: "Item code / SKU", type: "text", maxLength: 40, list: true, search: true },
          { name: "category", label: "Category", type: "select", options: ["Medicine", "Consumable", "Equipment", "Surgical", "Other"], required: true, list: true },
          { name: "manufacturer", label: "Manufacturer", type: "text", maxLength: 120, search: true },
          { name: "unit", label: "Unit", type: "text", maxLength: 20, placeholder: "e.g. strip, box, piece" },
          { name: "hsnCode", label: "HSN code", type: "text", maxLength: 12 },
          { name: "gstRate", label: "GST %", type: "select", options: GST_RATES, required: true, default: "12", list: true },
          { name: "mrp", label: "Default MRP (incl. GST)", type: "number", min: 0, list: true, hint: "Used when a batch has no MRP of its own" },
          { name: "quantity", label: "Stock in hand", type: "number", min: 0, default: 0, list: true, readOnly: true, hint: "Maintained by purchase entries and sale bills" },
          { name: "reorderLevel", label: "Reorder level", type: "number", min: 0, list: true },
          { name: "unitCost", label: "Last purchase rate", type: "number", min: 0, readOnly: true, hint: "Updated by purchase entries" },
          { name: "supplier", label: "Preferred supplier", type: "ref", ref: "inventory.suppliers" },
        ],
      },
      {
        key: "batches",
        label: "Batch Stock",
        singular: "Batch",
        labelField: "batchNo",
        readOnly: true,
        unique: ["item", "batchNo"],
        fields: [
          { name: "item", label: "Item", type: "ref", ref: "inventory.items", required: true, list: true },
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
        label: "Suppliers",
        singular: "Supplier",
        labelField: "name",
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
        ],
      },
    ],
  },
  {
    key: "billing",
    label: "Billing & Payments",
    description: "Invoices and payment collection",
    icon: "receipt",
    resources: [
      {
        key: "invoices",
        label: "Invoices",
        singular: "Invoice",
        codePrefix: "INV",
        labelField: "code",
        statusField: "status",
        check: (v) => {
          const errors: Record<string, string> = {};
          if (num(v.discount) > num(v.amount)) errors.discount = "Discount cannot exceed the amount";
          if (num(v.paidAmount) > num(v.amount) - num(v.discount)) errors.paidAmount = "Paid amount cannot exceed the payable amount";
          return errors;
        },
        fields: [
          { name: "patient", label: "Patient", type: "ref", ref: "patients.patients", required: true, list: true },
          { name: "invoiceDate", label: "Invoice date", type: "date", required: true, list: true },
          { name: "description", label: "Description", type: "textarea", required: true, maxLength: 1000, wide: true, search: true },
          { name: "amount", label: "Amount", type: "number", min: 0, required: true, list: true },
          { name: "discount", label: "Discount", type: "number", min: 0, default: 0 },
          { name: "paidAmount", label: "Paid amount", type: "number", min: 0, default: 0, list: true },
          { name: "paymentMethod", label: "Payment method", type: "select", options: ["Cash", "Card", "UPI", "Bank Transfer", "Insurance"] },
          { name: "status", label: "Status", type: "select", options: ["Unpaid", "Partially Paid", "Paid", "Cancelled"], required: true, default: "Unpaid", list: true },
        ],
      },
    ],
  },
  {
    key: "hr",
    label: "Human Resources",
    description: "Staff records and leave management",
    icon: "id-card",
    resources: [
      {
        key: "staff",
        label: "Staff",
        singular: "Staff Member",
        codePrefix: "EMP",
        labelField: "fullName",
        statusField: "status",
        lookup: true,
        fields: [
          { name: "fullName", label: "Full name", type: "text", required: true, maxLength: 120, list: true, search: true },
          { name: "department", label: "Department", type: "select", options: [...DEPARTMENTS, "Nursing", "Laboratory", "Pharmacy", "Administration", "Housekeeping", "Security"], required: true, list: true },
          { name: "designation", label: "Designation", type: "text", required: true, maxLength: 80, list: true, search: true },
          { name: "phone", label: "Phone", type: "tel", required: true, list: true, search: true },
          { name: "email", label: "Email", type: "email", search: true },
          { name: "joiningDate", label: "Joining date", type: "date", required: true },
          { name: "salary", label: "Monthly salary", type: "number", min: 0 },
          { name: "status", label: "Status", type: "select", options: ["Active", "On Leave", "Resigned"], required: true, default: "Active", list: true },
        ],
      },
      {
        key: "leaves",
        label: "Leave Requests",
        singular: "Leave Request",
        labelField: "leaveType",
        statusField: "status",
        check: notBefore("toDate", "fromDate", "End date cannot be before start date"),
        fields: [
          { name: "staff", label: "Staff member", type: "ref", ref: "hr.staff", required: true, list: true },
          { name: "leaveType", label: "Leave type", type: "select", options: ["Casual", "Sick", "Earned", "Unpaid"], required: true, list: true },
          { name: "fromDate", label: "From", type: "date", required: true, list: true },
          { name: "toDate", label: "To", type: "date", required: true, list: true },
          { name: "reason", label: "Reason", type: "textarea", maxLength: 500, wide: true, search: true },
          { name: "status", label: "Status", type: "select", options: ["Pending", "Approved", "Rejected"], required: true, default: "Pending", list: true },
        ],
      },
    ],
  },
  {
    key: "insurance",
    label: "Insurance",
    description: "Insurance providers and claims",
    icon: "shield-check",
    resources: [
      {
        key: "claims",
        label: "Claims",
        singular: "Claim",
        codePrefix: "CLM",
        labelField: "code",
        statusField: "status",
        check: (v): Record<string, string> =>
          v.approvedAmount != null && num(v.approvedAmount) > num(v.claimAmount)
            ? { approvedAmount: "Approved amount cannot exceed the claim amount" }
            : {},
        fields: [
          { name: "patient", label: "Patient", type: "ref", ref: "patients.patients", required: true, list: true },
          { name: "provider", label: "Provider", type: "ref", ref: "insurance.providers", required: true, list: true },
          { name: "policyNumber", label: "Policy number", type: "text", required: true, maxLength: 60, list: true, search: true },
          { name: "claimAmount", label: "Claim amount", type: "number", min: 0, required: true, list: true },
          { name: "approvedAmount", label: "Approved amount", type: "number", min: 0 },
          { name: "submittedDate", label: "Submitted date", type: "date", required: true },
          { name: "status", label: "Status", type: "select", options: ["Submitted", "Under Review", "Approved", "Rejected", "Settled"], required: true, default: "Submitted", list: true },
          { name: "remarks", label: "Remarks", type: "textarea", maxLength: 1000, wide: true },
        ],
      },
      {
        key: "providers",
        label: "Providers",
        singular: "Provider",
        labelField: "name",
        lookup: true,
        fields: [
          { name: "name", label: "Provider name", type: "text", required: true, maxLength: 120, list: true, search: true },
          { name: "contactPhone", label: "Contact phone", type: "tel", list: true, search: true },
          { name: "email", label: "Email", type: "email", list: true, search: true },
          { name: "address", label: "Address", type: "textarea", maxLength: 500, wide: true },
        ],
      },
    ],
  },
  {
    key: "ambulance",
    label: "Ambulance",
    description: "Fleet and emergency trip dispatch",
    icon: "ambulance",
    resources: [
      {
        key: "trips",
        label: "Trips",
        singular: "Trip",
        codePrefix: "AMB",
        labelField: "code",
        statusField: "status",
        fields: [
          { name: "vehicle", label: "Vehicle", type: "ref", ref: "ambulance.vehicles", required: true, list: true },
          { name: "patient", label: "Patient", type: "ref", ref: "patients.patients" },
          { name: "callerPhone", label: "Caller phone", type: "tel", required: true, search: true },
          { name: "requestedAt", label: "Requested at", type: "datetime", required: true, list: true },
          { name: "pickupLocation", label: "Pickup location", type: "text", required: true, maxLength: 200, list: true, search: true },
          { name: "dropLocation", label: "Drop location", type: "text", maxLength: 200, search: true },
          { name: "status", label: "Status", type: "select", options: ["Requested", "Dispatched", "Completed", "Cancelled"], required: true, default: "Requested", list: true },
        ],
      },
      {
        key: "vehicles",
        label: "Vehicles",
        singular: "Vehicle",
        labelField: "vehicleNumber",
        statusField: "status",
        lookup: true,
        fields: [
          { name: "vehicleNumber", label: "Vehicle number", type: "text", required: true, maxLength: 20, list: true, search: true },
          { name: "type", label: "Type", type: "select", options: ["Basic Life Support", "Advanced Life Support", "Patient Transport"], required: true, list: true },
          { name: "driverName", label: "Driver name", type: "text", maxLength: 120, list: true, search: true },
          { name: "driverPhone", label: "Driver phone", type: "tel", list: true },
          { name: "status", label: "Status", type: "select", options: ["Available", "On Trip", "Maintenance"], required: true, default: "Available", list: true },
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
