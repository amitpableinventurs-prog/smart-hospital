/**
 * Fills every module with a connected set of demo records: doctors, patients,
 * OPD / IPD, nursing, HR, laboratory, inventory, pharmacy, billing, insurance,
 * ambulance, blood bank, marketing and a few manual accounts vouchers.
 *
 *   npm run seed-demo               add the demo data (once)
 *   npm run seed-demo -- --remove   delete everything this script added
 *
 * Only new records are added; existing data is not touched. Stock, bill
 * totals and dues are worked out with the app's own math (lib/billing-math.ts,
 * lib/ambulance-math.ts). Accounts vouchers for the bills, sales and purchases
 * are posted by the app itself the next time Accounts is opened.
 * For demos and testing only.
 */
import mongoose from "mongoose";
import { hospitalBill, payerSplit, purchaseLine, purchaseTotals, r2, saleLine, saleTotals } from "../src/lib/billing-math.ts";
import { chargeLines, tripCharges } from "../src/lib/ambulance-math.ts";

const { MONGODB_URI } = process.env;
if (!MONGODB_URI) {
  console.error("Set MONGODB_URI in .env.local first.");
  process.exit(1);
}

const { ObjectId } = mongoose.Types;
await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
const db = mongoose.connection.db;
const col = (name) => db.collection(name);
/** Ids of every document this script inserted, per collection, so --remove can take them out again. */
const MARKER = col("demo_seed");

if (process.argv.includes("--remove")) {
  const marker = await MARKER.findOne({ _id: "main" });
  if (!marker) {
    console.log("No demo data found.");
  } else {
    const all = [];
    for (const [name, ids] of Object.entries(marker.ids ?? {})) {
      const res = await col(name).deleteMany({ _id: { $in: ids } });
      all.push(...ids);
      console.log(`removed ${String(res.deletedCount).padStart(4)}  ${name}`);
    }
    const vouchers = await col("accounts_vouchers").deleteMany({ auto: true, sourceId: { $in: all } });
    console.log(`removed ${String(vouchers.deletedCount).padStart(4)}  accounts_vouchers (automatic postings)`);
    await MARKER.deleteOne({ _id: "main" });
    console.log("\nDemo data removed.");
  }
  await mongoose.disconnect();
  process.exit(0);
}

if (await MARKER.findOne({ _id: "main" })) {
  console.log("Demo data is already loaded. Run `npm run seed-demo -- --remove` first to load it again.");
  await mongoose.disconnect();
  process.exit(0);
}

const admin = await col("users").findOne({ role: "super_admin" });
if (!admin) {
  console.error("No super admin found. Run `npm run create-super-admin` first.");
  process.exit(1);
}
const BY = admin.name;

/* ======================= helpers ======================= */

const DAY = 86_400_000;
/** Hospital wall-clock times are IST. */
const IST = 330 * 60_000;
const today = new Date();
today.setUTCHours(0, 0, 0, 0);
const day = (n) => new Date(today.getTime() + n * DAY);
const at = (n, hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(day(n).getTime() + (h * 60 + m) * 60_000 - IST);
};
const minutesAgo = (m) => new Date(Date.now() - m * 60_000);
const date = (s) => new Date(`${s}T00:00:00Z`);
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekday = (d) => WEEKDAYS[d.getUTCDay()];
const year = new Date().getFullYear();

function ageYears(dob, when = new Date()) {
  let age = when.getUTCFullYear() - dob.getUTCFullYear();
  const m = when.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && when.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

/** Deterministic pseudo-random numbers, so every run produces the same data. */
let seed = 20261024;
function rand() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

async function counter(key) {
  const doc = await col("counters").findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
  return doc.seq;
}
/** Same numbering as models/Counter.ts, e.g. "BILL-2026-000042". */
async function nextCode(prefix) {
  return `${prefix}-${year}-${String(await counter(`${prefix}-${year}`)).padStart(6, "0")}`;
}
async function nextAccession() {
  return `${String(year).slice(2)}${String(await counter(`ACC-${year}`)).padStart(8, "0")}`;
}

const summary = new Map();
async function save(name, docs, { stamps = true } = {}) {
  const list = Array.isArray(docs) ? docs : [docs];
  if (!list.length) return docs;
  const now = new Date();
  for (const d of list) {
    d._id ??= new ObjectId();
    if (stamps) {
      d.createdAt ??= now;
      // Accounts posts whatever changed since its last run, so new records must look freshly updated.
      d.updatedAt = now;
      d.__v ??= 0;
    }
  }
  await col(name).insertMany(list, { ignoreUndefined: true });
  await MARKER.updateOne({ _id: "main" }, { $push: { [`ids.${name}`]: { $each: list.map((d) => d._id) } }, $setOnInsert: { at: now } }, { upsert: true });
  summary.set(name, (summary.get(name) ?? 0) + list.length);
  return docs;
}

/** A record of a registry resource (lib/modules.ts), as the generic panel saves it. */
async function rec(name, prefix, values, when) {
  const doc = { ...values, createdBy: admin._id, updatedBy: admin._id, createdAt: when ?? new Date() };
  if (prefix) doc.code = await nextCode(prefix);
  return save(name, doc);
}
async function recs(name, prefix, rows, when) {
  const out = [];
  for (const r of rows) out.push(await rec(name, prefix, r, typeof when === "function" ? when(r) : when));
  return out;
}
const byName = (list, field = "fullName") => Object.fromEntries(list.map((d) => [d[field], d]));

/* ======================= HR masters ======================= */

const shifts = byName(
  await recs("hr_shifts", null, [
    { name: "Morning", code: "MOR", startTime: "07:00", endTime: "15:00", graceMinutes: 10, status: "Active" },
    { name: "General", code: "GEN", startTime: "09:00", endTime: "17:00", graceMinutes: 10, status: "Active" },
    { name: "Evening", code: "EVE", startTime: "15:00", endTime: "23:00", graceMinutes: 10, status: "Active" },
    { name: "Night", code: "NGT", startTime: "23:00", endTime: "07:00", graceMinutes: 10, status: "Active" },
  ], day(-120)),
  "code"
);

await recs("hr_leave_policies", null, [
  { leaveType: "Casual", annualQuota: 12, paid: "Yes", carryForwardMax: 0, halfDayAllowed: "Yes", appliesTo: "All", minServiceDays: 0, status: "Active" },
  { leaveType: "Sick", annualQuota: 10, paid: "Yes", carryForwardMax: 5, halfDayAllowed: "Yes", appliesTo: "All", minServiceDays: 0, status: "Active" },
  { leaveType: "Earned", annualQuota: 15, paid: "Yes", carryForwardMax: 30, halfDayAllowed: "No", appliesTo: "All", minServiceDays: 240, status: "Active" },
  { leaveType: "Maternity", annualQuota: 182, paid: "Yes", carryForwardMax: 0, halfDayAllowed: "No", appliesTo: "Female", minServiceDays: 80, status: "Active" },
  { leaveType: "Paternity", annualQuota: 5, paid: "Yes", carryForwardMax: 0, halfDayAllowed: "No", appliesTo: "Male", minServiceDays: 0, status: "Active" },
  { leaveType: "Compensatory Off", annualQuota: null, paid: "Yes", carryForwardMax: 0, halfDayAllowed: "Yes", appliesTo: "All", minServiceDays: 0, status: "Active" },
  { leaveType: "Unpaid", annualQuota: null, paid: "No", carryForwardMax: 0, halfDayAllowed: "Yes", appliesTo: "All", minServiceDays: 0, status: "Active" },
], day(-120));

const holidayRows = [
  [`${year}-01-26`, "Republic Day", "National"],
  [`${year}-05-01`, "Maharashtra Day", "National"],
  [`${year}-07-01`, "Hospital Foundation Day", "Hospital"],
  [`${year}-08-15`, "Independence Day", "National"],
  [`${year}-10-02`, "Gandhi Jayanti", "National"],
  [`${year}-12-25`, "Christmas", "Festival"],
  ...(year === 2026 ? [["2026-03-04", "Holi", "Festival"], ["2026-11-08", "Diwali (Lakshmi Puja)", "Festival"]] : []),
];
const existingHolidays = new Set((await col("hr_holidays").find().project({ date: 1 }).toArray()).map((h) => h.date.getTime()));
const holidays = holidayRows.map(([d, name, holidayType]) => ({ date: date(d), name, holidayType })).filter((h) => !existingHolidays.has(h.date.getTime()));
await recs("hr_holidays", null, holidays, day(-120));
const holidaySet = new Set([...existingHolidays, ...holidays.map((h) => h.date.getTime())]);

/* ======================= doctors ======================= */

const WEEK = "Mon,Tue,Wed,Thu,Fri,Sat";
const doctors = byName(
  await recs("doctors", "DR", [
    {
      fullName: "Dr. Anita Sharma", gender: "Female", dateOfBirth: date("1978-04-12"), phone: "9822100101", email: "anita.sharma@medicare.local",
      qualification: "MBBS, MD (General Medicine)", specialization: "General Medicine", experienceYears: 20, registrationNo: "MMC-2003-04512", registrationCouncil: "Maharashtra Medical Council", registrationValidUntil: date(`${year + 3}-03-31`),
      hospitalName: "MediCare Hospital – Main Block", cabinNo: "OPD-101", clinicPhone: "02024561001",
      consultationFee: 500, followUpFee: 300, followUpValidityDays: 7, emergencyFee: 1000, ipdVisitFee: 800, revenueSharePct: 70,
      workingDays: WEEK, startTime: "09:00", endTime: "17:00", slotMinutes: 15, maxPatientsPerDay: 40, availability: "Lunch 13:00–14:00", status: "Active",
    },
    {
      fullName: "Dr. Rajesh Kulkarni", gender: "Male", dateOfBirth: date("1972-09-03"), phone: "9822100102", email: "rajesh.kulkarni@medicare.local",
      qualification: "MBBS, MD (Medicine), DM (Cardiology)", specialization: "Cardiology", experienceYears: 24, registrationNo: "MMC-1999-11873", registrationCouncil: "Maharashtra Medical Council", registrationValidUntil: date(`${year + 2}-12-31`),
      hospitalName: "MediCare Hospital – Heart Centre", cabinNo: "HC-02", clinicPhone: "02024561002",
      consultationFee: 1000, followUpFee: 600, followUpValidityDays: 10, emergencyFee: 2000, ipdVisitFee: 1200, revenueSharePct: 75,
      workingDays: "Mon,Wed,Fri,Sat", startTime: "10:00", endTime: "16:00", slotMinutes: 20, maxPatientsPerDay: 18, availability: "Cath lab on Tuesdays and Thursdays", status: "Active",
    },
    {
      fullName: "Dr. Sameer Joshi", gender: "Male", dateOfBirth: date("1981-01-22"), phone: "9822100103", email: "sameer.joshi@medicare.local",
      qualification: "MBBS, MS (Orthopaedics)", specialization: "Orthopedics", experienceYears: 15, registrationNo: "MMC-2008-20981", registrationCouncil: "Maharashtra Medical Council", registrationValidUntil: date(`${year + 1}-06-30`),
      hospitalName: "MediCare Hospital – Main Block", cabinNo: "OPD-108",
      consultationFee: 800, followUpFee: 400, followUpValidityDays: 7, emergencyFee: 1500, ipdVisitFee: 1000, revenueSharePct: 70,
      workingDays: WEEK, startTime: "11:00", endTime: "19:00", slotMinutes: 15, status: "Active",
    },
    {
      fullName: "Dr. Priya Deshmukh", gender: "Female", dateOfBirth: date("1984-07-15"), phone: "9822100104", email: "priya.deshmukh@medicare.local",
      qualification: "MBBS, MS (Obstetrics & Gynaecology)", specialization: "Gynecology", experienceYears: 12, registrationNo: "MMC-2011-33410", registrationCouncil: "Maharashtra Medical Council", registrationValidUntil: date(`${year + 2}-09-30`),
      hospitalName: "MediCare Hospital – Mother & Child Wing", cabinNo: "MC-05",
      consultationFee: 700, followUpFee: 400, followUpValidityDays: 7, emergencyFee: 1500, ipdVisitFee: 900, revenueSharePct: 70,
      workingDays: WEEK, startTime: "09:30", endTime: "15:30", slotMinutes: 15, status: "Active",
    },
    {
      fullName: "Dr. Vikram Patil", gender: "Male", dateOfBirth: date("1986-11-30"), phone: "9822100105", email: "vikram.patil@medicare.local",
      qualification: "MBBS, MD (Paediatrics)", specialization: "Pediatrics", experienceYears: 10, registrationNo: "MMC-2013-41256", registrationCouncil: "Maharashtra Medical Council", registrationValidUntil: date(`${year + 1}-12-31`),
      hospitalName: "MediCare Hospital – Mother & Child Wing", cabinNo: "MC-02",
      consultationFee: 600, followUpFee: 300, followUpValidityDays: 5, emergencyFee: 1200, ipdVisitFee: 800, revenueSharePct: 65,
      workingDays: WEEK, startTime: "10:00", endTime: "18:00", slotMinutes: 15, status: "Active",
    },
    {
      fullName: "Dr. Neha Gupta", gender: "Female", dateOfBirth: date("1983-05-09"), phone: "9822100106", email: "neha.gupta@medicare.local",
      qualification: "MBBS, MD (Pathology)", specialization: "Pathology", experienceYears: 13, registrationNo: "MMC-2010-30877", registrationCouncil: "Maharashtra Medical Council", registrationValidUntil: date(`${year + 2}-03-31`),
      hospitalName: "MediCare Hospital – Laboratory", cabinNo: "LAB-01",
      consultationFee: 500, revenueSharePct: 0,
      workingDays: WEEK, startTime: "09:00", endTime: "17:00", slotMinutes: 30, status: "Active",
    },
  ], day(-150))
);
const D = {
  anita: doctors["Dr. Anita Sharma"], rajesh: doctors["Dr. Rajesh Kulkarni"], sameer: doctors["Dr. Sameer Joshi"],
  priya: doctors["Dr. Priya Deshmukh"], vikram: doctors["Dr. Vikram Patil"], neha: doctors["Dr. Neha Gupta"],
};

/* ======================= patients ======================= */

const patientRows = [
  ["Ramesh Patil", "1968-03-14", "Male", "9822011201", "ramesh.patil@example.com", "IPD", "B+", "Flat 12, Shivneri Apartments, Kothrud, Pune 411038", "Sunita Patil (wife)", "9822011202"],
  ["Sunita Kulkarni", "1975-07-22", "Female", "9823012345", null, "OPD", "O+", "Plot 7, Karve Nagar, Pune 411052", "Anil Kulkarni", "9823012346"],
  ["Arjun Mehta", "1990-11-05", "Male", "9890123456", "arjun.mehta@example.com", "OPD", "A+", "B-304, Magarpatta City, Hadapsar, Pune 411028", null, null],
  ["Priya Nair", "1994-02-18", "Female", "9767012233", "priya.nair@example.com", "IPD", "AB+", "22, Lane 5, Viman Nagar, Pune 411014", "Rahul Nair (husband)", "9767012234"],
  ["Mohammed Shaikh", "1958-09-30", "Male", "9850223344", null, "IPD", "O-", "House 5, Kondhwa Khurd, Pune 411048", "Salim Shaikh (son)", "9850223345"],
  ["Kavita Joshi", "1982-12-12", "Female", "9881334455", "kavita.joshi@example.com", "OPD", "B+", "1450, Sadashiv Peth, Pune 411030", "Mandar Joshi", "9881334456"],
  ["Aarav Deshpande", "2018-06-25", "Male", "9921445566", null, "OPD", "A-", "Flat 8, Baner Road, Aundh, Pune 411007", "Rohit Deshpande (father)", "9921445566"],
  ["Lata Gaikwad", "1950-04-08", "Female", "9763556677", null, "IPD", "B-", "Row House 3, Pimple Saudagar, Pune 411027", "Sachin Gaikwad (son)", "9763556678"],
  ["Sanjay Verma", "1979-08-19", "Male", "9970667788", "sanjay.verma@example.com", "OPD", "O+", "C-702, Wakad, Pune 411057", null, null],
  ["Neha Kapoor", "1997-01-27", "Female", "9545778899", "neha.kapoor@example.com", "OPD", "A+", "Kalyani Nagar, Pune 411006", null, null],
  ["Vijay Pawar", "1985-05-03", "Male", "9604889900", null, "OPD", "AB-", "Hinjewadi Phase 1, Pune 411057", "Asha Pawar (wife)", "9604889901"],
  ["Fatima Khan", "1988-10-15", "Female", "9673990011", null, "OPD", "O+", "Moledina Road, Camp, Pune 411001", null, null],
];
const patients = byName(
  await recs("patients", "MC", patientRows.map(([fullName, dob, gender, mobile, email, patientType, bloodGroup, address, emergencyContactName, emergencyContactPhone]) => ({
    fullName, dateOfBirth: date(dob), gender, mobile, email, patientType, bloodGroup, address, emergencyContactName, emergencyContactPhone,
  })), () => day(-between(15, 40)))
);
const P = Object.fromEntries(Object.entries(patients).map(([n, p]) => [n.split(" ")[0].toLowerCase(), p]));
const snap = (p, when = new Date()) => ({ patient: p._id, patientName: p.fullName, patientCode: p.code, patientAge: ageYears(p.dateOfBirth, when), patientGender: p.gender, patientMobile: p.mobile });

/* ======================= HR employees ======================= */

const staffRows = [
  // name, gender, dob, phone, category, department, designation, shift, weekly off, basic, hra, special, salary mode, extra
  ["Sunita Waghmare", "Female", "1985-02-11", "9890011001", "Nurse", "Nursing", "Senior Staff Nurse (Ward In-charge)", "MOR", "Sun", 24000, 7000, 3000, "Bank Transfer", { registrationNo: "MNC-2007-11452", registrationValidUntil: day(45) }],
  ["Rekha Salunkhe", "Female", "1992-06-30", "9890011002", "Nurse", "Nursing", "Staff Nurse", "EVE", "Mon", 18000, 4500, 1500, "Bank Transfer", { registrationNo: "MNC-2014-30981", registrationValidUntil: date(`${year + 2}-06-30`) }],
  ["Anjali Thomas", "Female", "1994-09-18", "9890011003", "Nurse", "Nursing", "Staff Nurse", "NGT", "Wed", 18000, 4500, 1500, "Bank Transfer", { registrationNo: "MNC-2016-41234", registrationValidUntil: date(`${year + 3}-01-31`) }],
  ["Pooja Bhosale", "Female", "1990-12-05", "9890011004", "Nurse", "Nursing", "ICU Nurse", "MOR", "Thu", 21000, 5000, 2000, "Bank Transfer", { registrationNo: "MNC-2012-22187", registrationValidUntil: date(`${year + 1}-08-31`) }],
  ["Santosh Jadhav", "Male", "1983-03-21", "9890011005", "Driver", "Ambulance", "Ambulance Driver", "GEN", "Tue", 13000, 2000, 1000, "Cash", {}],
  ["Ganesh More", "Male", "1988-08-09", "9890011006", "Driver", "Ambulance", "Ambulance Driver", "GEN", "Fri", 13000, 2000, 1000, "Cash", {}],
  ["Amit Shinde", "Male", "1993-01-14", "9890011007", "Paramedic / EMT", "Ambulance", "Emergency Medical Technician", "GEN", "Sun", 16000, 3000, 1000, "Bank Transfer", { registrationNo: "MPC-EMT-2018-0891" }],
  ["Rahul Pawar", "Male", "1995-04-27", "9890011008", "Technician", "Laboratory", "Lab Technician", "GEN", "Sun", 17000, 3500, 1500, "Bank Transfer", { registrationNo: "MSBTE-DMLT-15-4421" }],
  ["Snehal Kadam", "Female", "1989-10-02", "9890011009", "Technician", "Laboratory", "Senior Lab Technician", "MOR", "Sun", 21000, 5000, 2000, "Bank Transfer", { registrationNo: "MSBTE-DMLT-09-1187" }],
  ["Kiran Bhagat", "Male", "1987-07-19", "9890011010", "Pharmacist", "Pharmacy", "Pharmacist", "GEN", "Sun", 19000, 4500, 1500, "Bank Transfer", { registrationNo: "MSPC-B.Pharm-2010-7765", registrationValidUntil: day(25) }],
  ["Meera Iyer", "Female", "1996-03-08", "9890011011", "Administration", "Front Office", "Front Office Executive", "GEN", "Sun", 15000, 3000, 1000, "Bank Transfer", {}],
  ["Deepak Chavan", "Male", "1980-11-25", "9890011012", "Accounts", "Accounts", "Accountant", "GEN", "Sun", 26000, 8000, 4000, "Bank Transfer", {}],
  ["Shalini Rao", "Female", "1991-05-16", "9890011013", "Administration", "Administration", "Marketing Executive", "GEN", "Sun", 20000, 5000, 3000, "Bank Transfer", {}],
  ["Lakshmi Bai", "Female", "1979-09-01", "9890011014", "Housekeeping", "Housekeeping", "Housekeeping Staff", "MOR", "Sat", 11000, 1500, 500, "Cash", {}],
  ["Dr. Neha Gupta", "Female", "1983-05-09", "9822100106", "Doctor", "Pathology", "Consultant Pathologist", "GEN", "Sun", 85000, 25000, 15000, "Bank Transfer", { doctor: D.neha._id, registrationNo: "MMC-2010-30877", registrationValidUntil: date(`${year + 2}-03-31`) }],
];
const banks = [["HDFC Bank", "HDFC0001234"], ["State Bank of India", "SBIN0004567"], ["ICICI Bank", "ICIC0002211"], ["Bank of Maharashtra", "MAHB0000890"]];
const staffList = [];
for (const [i, [fullName, gender, dob, phone, staffCategory, department, designation, shift, weeklyOff, basicPay, hra, specialAllowance, salaryMode, extra]] of staffRows.entries()) {
  const [bankName, ifsc] = banks[i % banks.length];
  const bank = salaryMode === "Bank Transfer" ? { bankName, ifsc, accountNo: `5010${String(31245870 + i * 7919).padStart(8, "0")}` } : {};
  staffList.push(
    await rec("hr_staff", "EMP", {
      fullName, gender, dateOfBirth: date(dob), phone, email: `${fullName.toLowerCase().replace(/^dr\. /, "").replace(/\s+/g, ".")}@medicare.local`,
      bloodGroup: ["O+", "B+", "A+", "AB+"][i % 4], address: "Pune, Maharashtra",
      staffCategory, department, designation, employmentType: i === 10 ? "Probation" : "Permanent",
      joiningDate: day(-between(200, 2400)), contractEndDate: i === 10 ? day(40) : null,
      shift: shifts[shift]._id, weeklyOff, biometricId: String(101 + i),
      basicPay, da: 0, hra, specialAllowance, otherAllowance: 0, salary: basicPay + hra + specialAllowance,
      pfApplicable: "Yes", esiApplicable: "Auto", ptApplicable: "Yes",
      pan: `${"ABCDEFGHJK"[i % 10]}${"PQRST"[i % 5]}${"LMN"[i % 3]}P${String.fromCharCode(65 + i)}${String(4100 + i * 37).slice(0, 4)}${"KFRZ"[i % 4]}`,
      aadhaarLast4: String(2100 + i * 13).slice(-4), uan: String(100912345600 + i), salaryMode, ...bank,
      status: "Active", ...extra,
    }, day(-200))
  );
}
const S = byName(staffList);
for (const n of ["Rekha Salunkhe", "Anjali Thomas", "Pooja Bhosale"]) await col("hr_staff").updateOne({ _id: S[n]._id }, { $set: { reportingTo: S["Sunita Waghmare"]._id } });
const nurses = ["Sunita Waghmare", "Rekha Salunkhe", "Anjali Thomas", "Pooja Bhosale"].map((n) => S[n]);

/* ======================= OPD visits & IPD admissions ======================= */

const visitRows = [
  [P.sunita, -6, "General Medicine", D.anita, "Fever with body ache for 3 days", "Completed"],
  [P.arjun, -5, "Cardiology", D.rajesh, "Chest discomfort on exertion, palpitations", "Completed"],
  [P.kavita, -4, "Gynecology", D.priya, "Heavy menstrual bleeding, lower abdominal pain", "Completed"],
  [P.sanjay, -2, "Orthopedics", D.sameer, "Right knee pain while climbing stairs", "Completed"],
  [P.fatima, -2, "Dermatology", null, "Itchy skin rash on both forearms", "Cancelled"],
  [P.aarav, -1, "Pediatrics", D.vikram, "Cough and wheezing since last night", "Completed"],
  [P.vijay, -1, "Emergency", D.anita, "Road traffic accident — abrasions on left arm and leg (brought by ambulance)", "Completed"],
  [P.neha, 0, "General Medicine", D.anita, "Headache and acidity for a week", "In Consultation"],
  [P.fatima, 0, "General Medicine", D.anita, "Follow-up for skin rash and itching", "Waiting"],
  [P.arjun, 0, "Cardiology", D.rajesh, "Review with ECG and echo reports", "Waiting"],
];
const visits = [];
for (const [p, n, department, doctor, complaint, status] of visitRows) {
  visits.push(await rec("opd_ipd_visits", "OPD", { patient: p._id, visitDate: day(n), department, doctor: doctor?._id ?? null, complaint, status }, at(n, `${between(9, 12)}:${between(10, 55)}`)));
}
const visitOf = (p, n) => visits.find((v) => String(v.patient) === String(p._id) && v.visitDate.getTime() === day(n).getTime());

const admissions = {
  ramesh: await rec("opd_ipd_admissions", "IPD", { patient: P.ramesh._id, admissionDate: day(-3), ward: "General Ward", bedNumber: "GW-04", doctor: D.rajesh._id, diagnosis: "Unstable angina — admitted for observation, serial ECG and troponin", dischargeDate: null, status: "Admitted" }, at(-3, "11:20")),
  mohammed: await rec("opd_ipd_admissions", "IPD", { patient: P.mohammed._id, admissionDate: day(-2), ward: "ICU", bedNumber: "ICU-02", doctor: D.anita._id, diagnosis: "Community-acquired pneumonia with type 2 diabetes mellitus", dischargeDate: null, status: "Admitted" }, at(-2, "16:45")),
  lata: await rec("opd_ipd_admissions", "IPD", { patient: P.lata._id, admissionDate: day(-9), ward: "Semi-Private", bedNumber: "SP-11", doctor: D.sameer._id, diagnosis: "Fracture neck of femur (right) — bipolar hemiarthroplasty done", dischargeDate: day(-5), status: "Discharged" }, at(-9, "09:10")),
  priya: await rec("opd_ipd_admissions", "IPD", { patient: P.priya._id, admissionDate: day(-6), ward: "Maternity Ward", bedNumber: "MW-03", doctor: D.priya._id, diagnosis: "Full-term pregnancy — normal vaginal delivery, healthy male baby", dischargeDate: day(-4), status: "Discharged" }, at(-6, "06:30")),
};

/* ======================= doctor appointments & leaves ======================= */

function workingDay(doctor, from, step = 1) {
  let n = from;
  while (!doctor.workingDays.split(",").includes(weekday(day(n)))) n += step;
  return n;
}
const appointmentRows = [
  [P.sunita, D.anita, workingDay(D.anita, -6, -1), "10:00", "Fever and body ache", "Completed"],
  [P.arjun, D.rajesh, workingDay(D.rajesh, -5, -1), "11:00", "Chest discomfort", "Completed"],
  [P.fatima, D.anita, workingDay(D.anita, -3, -1), "12:15", "Skin rash", "No-show"],
  [P.kavita, D.priya, workingDay(D.priya, 1), "10:30", "Discuss USG findings and surgery plan", "Scheduled"],
  [P.sanjay, D.sameer, workingDay(D.sameer, 2), "11:30", "Knee pain review after physiotherapy", "Scheduled"],
  [P.aarav, D.vikram, workingDay(D.vikram, 3), "10:15", "Follow-up for wheezing", "Scheduled"],
  [P.ramesh, D.rajesh, workingDay(D.rajesh, 8), "11:20", "Post-discharge cardiology review", "Scheduled"],
  [P.neha, D.anita, workingDay(D.anita, 2), "16:00", "Review with blood reports", "Scheduled"],
  [P.lata, D.sameer, workingDay(D.sameer, 4), "12:00", "Suture removal and wound check", "Scheduled"],
  [P.priya, D.priya, workingDay(D.priya, 3), "11:00", "Post-natal check-up", "Cancelled"],
];
for (const [p, d, n, time, reason, status] of appointmentRows) {
  await rec("doctors_appointments", "APT", { patient: p._id, doctor: d._id, date: day(n), time, reason, status }, at(Math.min(n, 0) - 2, "10:00"));
}
const sameerLeaveFrom = workingDay(D.sameer, 10);
await rec("doctors_leaves", "DLV", { doctor: D.sameer._id, leaveType: "Conference / CME", fromDate: day(sameerLeaveFrom), toDate: day(sameerLeaveFrom + 2), days: 3, substitute: D.anita._id, reason: "National orthopaedic conference, Hyderabad", status: "Approved" }, day(-6));
await rec("doctors_leaves", "DLV", { doctor: D.vikram._id, leaveType: "Casual", fromDate: day(18), toDate: day(18), days: 1, substitute: null, reason: "Family function", status: "Pending" }, day(-1));
await rec("doctors_leaves", "DLV", { doctor: D.priya._id, leaveType: "Sick", fromDate: day(-20), toDate: day(-19), days: 2, substitute: D.anita._id, reason: "Viral fever", status: "Approved" }, day(-21));

/* ======================= nursing ======================= */

const wardOf = { "Sunita Waghmare": "General Ward", "Rekha Salunkhe": "Maternity Ward", "Anjali Thomas": "ICU", "Pooja Bhosale": "ICU" };
const shiftName = { MOR: "Morning", EVE: "Evening", NGT: "Night", GEN: "Morning" };
for (const nurse of nurses) {
  const code = Object.values(shifts).find((s) => String(s._id) === String(nurse.shift)).code;
  for (let n = -2; n <= 3; n++) {
    if (weekday(day(n)) === nurse.weeklyOff) continue;
    const status = n < 0 ? "Completed" : n === 0 ? (code === "MOR" ? "On Duty" : "Scheduled") : "Scheduled";
    await rec("nursing_roster", null, { staff: nurse._id, nurseName: nurse.fullName, ward: wardOf[nurse.fullName], date: day(n), shift: shiftName[code], status }, day(-4));
  }
}
const careNotes = [
  [P.ramesh, -3, "13:00", "Sunita Waghmare", 37.1, "150/94", 96, "Admitted with chest pain. ECG done, on monitor. Aspirin and statin given as advised."],
  [P.ramesh, -2, "09:30", "Sunita Waghmare", 36.9, "138/88", 84, "Pain free overnight. Repeat troponin sample sent to lab."],
  [P.ramesh, -1, "09:15", "Sunita Waghmare", 36.8, "130/84", 78, "Comfortable, ambulating in ward. Diet tolerated."],
  [P.ramesh, 0, "08:45", "Sunita Waghmare", 36.7, "128/82", 76, "Stable. Awaiting cardiologist round for discharge plan."],
  [P.mohammed, -2, "18:00", "Pooja Bhosale", 38.9, "110/70", 112, "SpO2 89% on room air — started O2 at 4 L/min. IV ceftriaxone started. GRBS 286 mg/dL, insulin as per sliding scale."],
  [P.mohammed, -1, "06:00", "Anjali Thomas", 38.2, "116/74", 104, "Febrile overnight, tepid sponging done. SpO2 94% on O2. Nebulisation given."],
  [P.mohammed, -1, "14:00", "Pooja Bhosale", 37.6, "120/76", 96, "Improving. Cough with sputum, sample sent for culture. GRBS 198 mg/dL."],
  [P.mohammed, 0, "08:30", "Pooja Bhosale", 37.2, "122/78", 90, "Afebrile since 12 hours. SpO2 96% on 2 L/min O2. Plan to wean oxygen."],
];
for (const [p, n, t, nurseName, temperature, bloodPressure, pulse, notes] of careNotes) {
  await rec("nursing_care_notes", null, { patient: p._id, recordedAt: at(n, t), nurseName, temperature, bloodPressure, pulse, notes }, at(n, t));
}

/* ======================= HR attendance, leave, advances ======================= */

const shiftById = new Map(Object.values(shifts).map((s) => [String(s._id), s]));
const hm = (mins) => `${String(Math.floor(((mins % 1440) + 1440) % 1440 / 60)).padStart(2, "0")}:${String(((mins % 60) + 60) % 60).padStart(2, "0")}`;
const toMins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const specialMarks = {
  "Ganesh More|-3": { status: "Absent", remarks: "Did not report; leave was rejected" },
  "Meera Iyer|-2": { status: "Half Day", remarks: "Left after lunch — personal work" },
  "Shalini Rao|-1": { status: "On Duty", remarks: "Field visits to referral partners" },
  "Sunita Waghmare|-5": { overtimeHours: 2, remarks: "Stayed back for ward audit" },
};
const attendance = [];
for (const s of staffList) {
  const shift = shiftById.get(String(s.shift));
  for (let n = -7; n <= 0; n++) {
    const d = day(n);
    if (holidaySet.has(d.getTime())) continue;
    if (n === 0 && !["MOR", "GEN"].includes(shift.code)) continue;
    const special = specialMarks[`${s.fullName}|${n}`] ?? {};
    const mark = { _id: new ObjectId(), staff: s._id, date: d, source: "Manual", markedBy: admin._id, markedByName: BY, lateMinutes: 0, overtimeHours: 0, createdAt: at(n, "19:00") };
    if (weekday(d) === s.weeklyOff) Object.assign(mark, { status: "Week Off" });
    else if (special.status === "Absent") Object.assign(mark, special);
    else {
      const late = rand() < 0.12 ? between(12, 35) : between(-12, 5);
      const start = toMins(shift.startTime);
      const inTime = hm(start + late);
      const length = special.status === "Half Day" ? 240 : (toMins(shift.endTime) - start + 1440) % 1440 || 480;
      Object.assign(mark, { status: "Present", inTime, outTime: n === 0 ? null : hm(start + length + between(0, 20) + (special.overtimeHours ?? 0) * 60), lateMinutes: late > shift.graceMinutes ? late : 0, punches: n === 0 ? 1 : 2 }, special);
    }
    attendance.push(mark);
  }
}
await save("hr_attendance", attendance);

function leaveDays(staff, from, to, session = "Full day") {
  if (session !== "Full day") return 0.5;
  let days = 0;
  for (let t = from.getTime(); t <= to.getTime(); t += DAY) if (!holidaySet.has(t) && WEEKDAYS[new Date(t).getUTCDay()] !== staff.weeklyOff) days++;
  return days;
}
const leaveRows = [
  [S["Rahul Pawar"], "Sick", -12, -11, "Full day", null, "Fever and throat infection — medical certificate attached", "Approved", "Approved. Get well soon."],
  [S["Rekha Salunkhe"], "Casual", 5, 6, "Full day", S["Anjali Thomas"], "Sister's wedding in Satara", "Pending", null],
  [S["Deepak Chavan"], "Earned", 9, 13, "Full day", null, "Family trip to Kerala", "Approved", "Approved — hand over GST filing to the auditor before leaving"],
  [S["Ganesh More"], "Casual", -3, -3, "Full day", null, "Personal work", "Rejected", "Short-staffed on ambulance duty that day"],
  [S["Meera Iyer"], "Casual", 2, 2, "First half", null, "Bank work", "Pending", null],
  [S["Pooja Bhosale"], "Sick", -16, -15, "Full day", S["Anjali Thomas"], "Migraine", "Approved", null],
];
for (const [s, leaveType, from, to, session, reliever, reason, status, decisionNote] of leaveRows) {
  await rec("hr_leaves", "LVA", { staff: s._id, leaveType, fromDate: day(from), toDate: day(to), session, days: leaveDays(s, day(from), day(to), session), reliever: reliever?._id ?? null, reason, status, decisionNote }, day(Math.min(from, 0) - 3));
}
await rec("hr_advances", "ADV", { staff: S["Santosh Jadhav"]._id, advanceType: "Salary Advance", amount: 6000, issueDate: day(-15), monthlyDeduction: 3000, mode: "Cash", reference: null, recovered: 0, balance: 6000, status: "Active", notes: "Child's school admission fees" }, day(-15));
await rec("hr_advances", "ADV", { staff: S["Pooja Bhosale"]._id, advanceType: "Loan", amount: 30000, issueDate: day(-40), monthlyDeduction: 2500, mode: "Bank Transfer", reference: "UTR HDFCN52026781203", recovered: 0, balance: 30000, status: "Active", notes: "Two-wheeler purchase loan, 12 instalments" }, day(-40));

/* ======================= laboratory masters ======================= */

const labCats = byName(
  await recs("laboratory_categories", null, [
    { name: "Hematology", code: "HEM", sortOrder: 10, description: "Blood counts, ESR, smears", status: "Active" },
    { name: "Biochemistry", code: "BIO", sortOrder: 20, description: "Sugar, liver, kidney and lipid tests", status: "Active" },
    { name: "Clinical Pathology", code: "CP", sortOrder: 30, description: "Urine and stool examination", status: "Active" },
    { name: "Serology & Immunology", code: "SER", sortOrder: 40, description: "Infection markers and hormones", status: "Active" },
    { name: "Microbiology", code: "MIC", sortOrder: 50, description: "Cultures and sensitivity", status: "Active" },
  ], day(-150)),
  "name"
);
const outLab = await rec("laboratory_outsource_labs", null, { name: "Pune Reference Laboratory", contactPerson: "Mr. Ajay Sathe", phone: "02025651234", email: "samples@punereflab.example", address: "Deccan Gymkhana, Pune 411004", accreditation: "NABL MC-4410", turnaroundDays: 3, paymentTerms: "Monthly bill, 30 days credit", status: "Active" }, day(-150));

const LAB_TESTS = [
  { testCode: "CBC", testName: "Complete Blood Count (CBC)", cat: "Hematology", method: "Automated 5-part cell counter", sampleType: "Blood", container: "EDTA (Lavender)", sampleVolume: "2 ml", price: 350, turnaroundHours: 4, params: [
    { name: "Haemoglobin", unit: "g/dL", decimals: 1, maleLow: 13, maleHigh: 17, femaleLow: 12, femaleHigh: 15, childLow: 11, childHigh: 14, criticalLow: 7, criticalHigh: 20 },
    { name: "Total Leucocyte Count", unit: "cells/cumm", decimals: 0, low: 4000, high: 11000, criticalLow: 2000, criticalHigh: 30000 },
    { name: "Neutrophils", unit: "%", decimals: 0, low: 40, high: 75 },
    { name: "Lymphocytes", unit: "%", decimals: 0, low: 20, high: 45 },
    { name: "RBC Count", unit: "million/cumm", decimals: 2, maleLow: 4.5, maleHigh: 5.5, femaleLow: 3.8, femaleHigh: 4.8 },
    { name: "Platelet Count", unit: "lakhs/cumm", decimals: 2, low: 1.5, high: 4.5, criticalLow: 0.5 },
  ] },
  { testCode: "ESR", testName: "Erythrocyte Sedimentation Rate", cat: "Hematology", method: "Westergren", sampleType: "Blood", container: "EDTA (Lavender)", price: 150, turnaroundHours: 2, params: [
    { name: "ESR (1st hour)", unit: "mm/hr", decimals: 0, maleLow: 0, maleHigh: 15, femaleLow: 0, femaleHigh: 20 },
  ] },
  { testCode: "PS", testName: "Peripheral Blood Smear", cat: "Hematology", method: "Leishman stain, microscopy", sampleType: "Blood", container: "EDTA (Lavender)", price: 300, turnaroundHours: 24, reportType: "Descriptive", params: [] },
  { testCode: "FBS", testName: "Blood Sugar – Fasting", cat: "Biochemistry", method: "GOD-POD", sampleType: "Plasma", container: "Fluoride (Grey)", price: 100, turnaroundHours: 2, patientPreparation: "10–12 hours fasting", params: [
    { name: "Glucose (Fasting)", unit: "mg/dL", decimals: 0, low: 70, high: 100, criticalLow: 40, criticalHigh: 400 },
  ] },
  { testCode: "PPBS", testName: "Blood Sugar – Post Prandial", cat: "Biochemistry", method: "GOD-POD", sampleType: "Plasma", container: "Fluoride (Grey)", price: 100, turnaroundHours: 2, patientPreparation: "Sample 2 hours after a meal", params: [
    { name: "Glucose (PP)", unit: "mg/dL", decimals: 0, low: 70, high: 140, criticalLow: 40, criticalHigh: 450 },
  ] },
  { testCode: "HBA1C", testName: "Glycated Haemoglobin (HbA1c)", cat: "Biochemistry", method: "HPLC", sampleType: "Blood", container: "EDTA (Lavender)", price: 550, turnaroundHours: 6, params: [
    { name: "HbA1c", unit: "%", decimals: 1, low: 4, high: 5.6, rangeText: "Normal < 5.7 · Prediabetes 5.7–6.4 · Diabetes ≥ 6.5" },
  ] },
  { testCode: "LFT", testName: "Liver Function Test", cat: "Biochemistry", method: "Fully automated analyser", sampleType: "Serum", container: "SST (Gold)", price: 700, turnaroundHours: 6, params: [
    { name: "Bilirubin – Total", unit: "mg/dL", decimals: 2, low: 0.2, high: 1.2 },
    { name: "SGOT (AST)", unit: "U/L", decimals: 0, low: 5, high: 40 },
    { name: "SGPT (ALT)", unit: "U/L", decimals: 0, low: 7, high: 56 },
    { name: "Alkaline Phosphatase", unit: "U/L", decimals: 0, low: 44, high: 147 },
    { name: "Albumin", unit: "g/dL", decimals: 1, low: 3.5, high: 5 },
  ] },
  { testCode: "KFT", testName: "Kidney Function Test", cat: "Biochemistry", method: "Fully automated analyser", sampleType: "Serum", container: "SST (Gold)", price: 650, turnaroundHours: 6, params: [
    { name: "Blood Urea", unit: "mg/dL", decimals: 0, low: 15, high: 40 },
    { name: "Serum Creatinine", unit: "mg/dL", decimals: 2, maleLow: 0.7, maleHigh: 1.3, femaleLow: 0.6, femaleHigh: 1.1, criticalHigh: 6 },
    { name: "Uric Acid", unit: "mg/dL", decimals: 1, maleLow: 3.5, maleHigh: 7.2, femaleLow: 2.6, femaleHigh: 6 },
    { name: "Sodium", unit: "mmol/L", decimals: 0, low: 135, high: 145, criticalLow: 120, criticalHigh: 160 },
    { name: "Potassium", unit: "mmol/L", decimals: 1, low: 3.5, high: 5.1, criticalLow: 2.5, criticalHigh: 6.5 },
  ] },
  { testCode: "LIPID", testName: "Lipid Profile", cat: "Biochemistry", method: "Enzymatic", sampleType: "Serum", container: "SST (Gold)", price: 600, turnaroundHours: 6, patientPreparation: "12 hours fasting", params: [
    { name: "Total Cholesterol", unit: "mg/dL", decimals: 0, high: 200, rangeText: "Desirable < 200" },
    { name: "Triglycerides", unit: "mg/dL", decimals: 0, high: 150, rangeText: "Normal < 150" },
    { name: "HDL Cholesterol", unit: "mg/dL", decimals: 0, low: 40, high: 60, rangeText: "40 – 60" },
    { name: "LDL Cholesterol", unit: "mg/dL", decimals: 0, high: 100, rangeText: "Optimal < 100" },
  ] },
  { testCode: "TSH", testName: "Thyroid Stimulating Hormone", cat: "Serology & Immunology", method: "CLIA", sampleType: "Serum", container: "SST (Gold)", price: 400, turnaroundHours: 8, params: [
    { name: "TSH", unit: "µIU/mL", decimals: 2, low: 0.4, high: 4.5 },
  ] },
  { testCode: "TROP", testName: "Troponin I (Quantitative)", cat: "Serology & Immunology", method: "CLIA", sampleType: "Serum", container: "SST (Gold)", price: 1200, turnaroundHours: 2, params: [
    { name: "Troponin I", unit: "ng/mL", decimals: 3, high: 0.04, criticalHigh: 0.5, rangeText: "< 0.04" },
  ] },
  { testCode: "NS1", testName: "Dengue NS1 Antigen", cat: "Serology & Immunology", method: "ELISA", sampleType: "Serum", container: "SST (Gold)", price: 800, turnaroundHours: 6, params: [
    { name: "Dengue NS1 Antigen", resultType: "Options", options: "Negative,Positive,Equivocal", normalValue: "Negative" },
  ] },
  { testCode: "WIDAL", testName: "Widal Test (Slide)", cat: "Serology & Immunology", method: "Slide agglutination", sampleType: "Serum", container: "Plain (Red)", price: 250, turnaroundHours: 4, params: [
    { name: "S. Typhi O", resultType: "Options", options: "Non-reactive,1:80,1:160,1:320", normalValue: "Non-reactive" },
    { name: "S. Typhi H", resultType: "Options", options: "Non-reactive,1:80,1:160,1:320", normalValue: "Non-reactive" },
  ] },
  { testCode: "URINE", testName: "Urine Routine & Microscopy", cat: "Clinical Pathology", method: "Dipstick and microscopy", sampleType: "Urine", container: "Sterile Container", price: 150, turnaroundHours: 2, params: [
    { name: "Colour", resultType: "Text", normalValue: "Pale yellow" },
    { name: "Protein", resultType: "Options", options: "Nil,Trace,+,++,+++", normalValue: "Nil" },
    { name: "Sugar", resultType: "Options", options: "Nil,Trace,+,++,+++", normalValue: "Nil" },
    { name: "Pus Cells", unit: "/hpf", decimals: 0, low: 0, high: 5 },
  ] },
  { testCode: "UCS", testName: "Urine Culture & Sensitivity", cat: "Microbiology", method: "Conventional culture", sampleType: "Urine", container: "Sterile Container", price: 900, turnaroundHours: 72, reportType: "Descriptive", outsource: true, outsourceCost: 500, params: [] },
  { testCode: "SPCS", testName: "Sputum Culture & Sensitivity", cat: "Microbiology", method: "Conventional culture", sampleType: "Sputum", container: "Sterile Container", price: 950, turnaroundHours: 72, reportType: "Descriptive", outsource: true, outsourceCost: 550, params: [] },
];
const tests = {};
const params = {};
for (const t of LAB_TESTS) {
  const doc = await rec("laboratory_tests", null, {
    testName: t.testName, testCode: t.testCode, category: labCats[t.cat]._id, reportType: t.reportType ?? "Parametric", method: t.method,
    sampleType: t.sampleType, container: t.container, sampleVolume: t.sampleVolume ?? null, patientPreparation: t.patientPreparation ?? null,
    price: t.price, turnaroundHours: t.turnaroundHours, outsourceLab: t.outsource ? outLab._id : null, outsourceCost: t.outsourceCost ?? null, status: "Active",
  }, day(-150));
  tests[t.testCode] = doc;
  params[t.testCode] = [];
  for (const [i, p] of t.params.entries()) {
    params[t.testCode].push(await rec("laboratory_parameters", null, {
      test: doc._id, name: p.name, unit: p.unit ?? null, resultType: p.resultType ?? "Numeric", options: p.options ?? null, normalValue: p.normalValue ?? null,
      decimals: p.decimals ?? null, sortOrder: (i + 1) * 10, low: p.low ?? null, high: p.high ?? null, maleLow: p.maleLow ?? null, maleHigh: p.maleHigh ?? null,
      femaleLow: p.femaleLow ?? null, femaleHigh: p.femaleHigh ?? null, childLow: p.childLow ?? null, childHigh: p.childHigh ?? null, childAgeBelow: 12,
      criticalLow: p.criticalLow ?? null, criticalHigh: p.criticalHigh ?? null, rangeText: p.rangeText ?? null,
    }, day(-150)));
  }
}
const profiles = byName(
  await recs("laboratory_profiles", "PKG", [
    { name: "Master Health Check-up", tests: ["CBC", "FBS", "LIPID", "LFT", "KFT", "TSH", "URINE"].map((c) => tests[c]._id), price: 2499, description: "Annual full-body check-up with doctor consultation", status: "Active" },
    { name: "Diabetes Profile", tests: ["FBS", "PPBS", "HBA1C"].map((c) => tests[c]._id), price: 650, description: "Fasting and post-meal sugar with HbA1c", status: "Active" },
    { name: "Fever Profile", tests: ["CBC", "NS1", "WIDAL"].map((c) => tests[c]._id), price: 1200, description: "CBC, dengue NS1 and Widal", status: "Active" },
  ], day(-140)),
  "name"
);
await recs("laboratory_rates", null, [
  { test: tests.CBC._id, ratePlan: "Senior Citizen", rate: 280, effectiveFrom: day(-120), status: "Active" },
  { test: tests.LIPID._id, ratePlan: "Senior Citizen", rate: 480, effectiveFrom: day(-120), status: "Active" },
  { test: tests.CBC._id, ratePlan: "Corporate", rate: 300, effectiveFrom: day(-120), status: "Active" },
  { test: tests.LFT._id, ratePlan: "Corporate", rate: 600, effectiveFrom: day(-120), status: "Active" },
  { test: tests.HBA1C._id, ratePlan: "Staff", rate: 300, effectiveFrom: day(-120), status: "Active" },
], day(-120));

const equipment = byName(
  await recs("laboratory_equipment", "EQP", [
    { name: "5-part Hematology Analyser", model: "XN-550", manufacturer: "Sysmex", serialNo: "XN55-21873", section: labCats.Hematology._id, installDate: day(-900), lastCalibrationDate: day(-60), nextCalibrationDue: day(120), lastServiceDate: day(-45), nextServiceDue: day(135), amcVendor: "Transasia Bio-Medicals", amcExpiry: day(220), status: "Working", notes: "Daily start-up QC with 3 control levels" },
    { name: "Fully Automated Biochemistry Analyser", model: "EM 200", manufacturer: "Erba", serialNo: "EM2-77812", section: labCats.Biochemistry._id, installDate: day(-700), lastCalibrationDate: day(-20), nextCalibrationDue: day(10), lastServiceDate: day(-90), nextServiceDue: day(5), amcVendor: "Erba Service Centre, Pune", amcExpiry: day(90), status: "Working", notes: null },
    { name: "Laboratory Centrifuge", model: "R-8C", manufacturer: "Remi", serialNo: "R8C-2291", section: labCats["Clinical Pathology"]._id, installDate: day(-1500), lastServiceDate: day(-200), nextServiceDue: day(-20), status: "Under Maintenance", notes: "Imbalance noise — technician visit booked" },
  ], day(-150)),
  "name"
);

// QC runs: SD index and Westgard result exactly as the app derives them (lib/rules.ts).
const qcPrev = new Map();
const qcRows = [
  ...[-6, -5, -4, -3, -2, -1, 0].map((n, i) => [n, "FBS", "Glucose", "Fully Automated Biochemistry Analyser", "Level 2 (Normal)", "BC-L2-2611", 100, 3, [100.8, 98.9, 101.5, 106.4, 99.2, 107.1, 100.3][i]]),
  ...[-6, -4, -2, 0].map((n, i) => [n, "CBC", "Haemoglobin", "5-part Hematology Analyser", "Level 2 (Normal)", "HC-N-4410", 13.2, 0.25, [13.25, 13.1, 13.98, 13.3][i]]),
];
for (const [n, testCode, analyte, eq, controlLevel, lotNo, targetMean, sd, observed] of qcRows) {
  const key = `${testCode}|${analyte}|${eq}|${controlLevel}`;
  const z = Math.round(((observed - targetMean) / sd) * 100) / 100;
  const pz = qcPrev.get(key) ?? 0;
  const [result, ruleViolated] = Math.abs(z) > 3 ? ["Fail", "1-3s"] : Math.abs(z) > 2 && Math.abs(pz) > 2 && Math.sign(z) === Math.sign(pz) ? ["Fail", "2-2s"] : Math.abs(z) > 2 ? ["Warning", "1-2s"] : ["Pass", "—"];
  qcPrev.set(key, z);
  await rec("laboratory_qc", "QC", {
    runDate: day(n), test: tests[testCode]._id, analyte, equipment: equipment[eq]._id, controlLevel, lotNo, lotExpiry: day(150), targetMean, sd, observed, zScore: z, result, ruleViolated,
    performedBy: n % 2 ? "Rahul Pawar" : "Snehal Kadam", correctiveAction: result === "Pass" ? null : "Recalibrated the channel and repeated the control — within range",
  }, at(n, "08:15"));
}

/* ======================= inventory masters ======================= */

const units = byName(
  await recs("inventory_units", null, [
    { name: "Tablet", symbol: "TAB", description: "Single tablet / capsule" },
    { name: "Strip", symbol: "STR", description: "Strip of tablets" },
    { name: "Box", symbol: "BOX", description: "Box / carton" },
    { name: "Bottle", symbol: "BTL", description: "Bottle / can" },
    { name: "Vial", symbol: "VL", description: "Injection vial" },
    { name: "Piece", symbol: "PCS", description: "Single piece" },
    { name: "Pair", symbol: "PR", description: "Pair (gloves)" },
    { name: "Pack", symbol: "PCK", description: "Pack / sachet" },
  ], day(-200)),
  "name"
);
const invCats = byName(
  await recs("inventory_categories", null, [
    { name: "Medicines", code: "MED", description: "Tablets, syrups, injections and IV fluids", status: "Active" },
    { name: "Surgical", code: "SUR", description: "Gloves, syringes, cannulas, sutures", status: "Active" },
    { name: "Consumables & Dressings", code: "CON", description: "Gauze, masks, dressing material", status: "Active" },
    { name: "Housekeeping", code: "HKP", description: "Cleaning and hygiene supplies", status: "Active" },
  ], day(-200)),
  "code"
);
const subcats = {};
for (const [cat, names] of Object.entries({ MED: ["Analgesics & Antipyretics", "Antibiotics", "Antidiabetic", "Cardiac", "Gastro", "Antihistamines", "Cough & Cold", "IV Fluids", "ORS & Supplements"], SUR: ["Gloves", "Syringes & Needles", "IV Cannula", "Sutures"], CON: ["Dressings", "Masks"], HKP: ["Cleaning Agents"] })) {
  for (const name of names) subcats[name] = await rec("inventory_subcategories", null, { category: invCats[cat]._id, name, status: "Active" }, day(-200));
}
const existingStores = await col("inventory_stores").find({ status: "Active" }).toArray();
async function store(name, storeType, extra = {}) {
  const found = existingStores.find((s) => s.storeType === storeType && (storeType === "Main Store" || storeType === "Pharmacy" || s.name === name));
  return found ?? rec("inventory_stores", null, { name, storeType, status: "Active", ...extra }, day(-200));
}
const stores = {
  main: await store("Main Store", "Main Store"),
  pharmacy: await store("Pharmacy", "Pharmacy"),
  icu: await store("ICU Sub-store", "ICU", { code: "ICU", inCharge: "Pooja Bhosale", location: "2nd floor, ICU" }),
  ot: await store("OT Complex", "OT", { code: "OT", inCharge: "OT Sister", location: "3rd floor" }),
  ward: await store("Ward 3 – General", "Ward", { code: "W3", inCharge: "Sunita Waghmare", location: "1st floor" }),
};
const suppliers = byName(
  await recs("inventory_suppliers", null, [
    { name: "Shree Ganesh Pharma Distributors", contactPerson: "Mr. Nilesh Shah", phone: "9822450011", email: "orders@shreeganeshpharma.example", gstin: "27AAFFS4521K1ZQ", drugLicenseNo: "MH-PZ3-113452", address: "Shop 4, Raviwar Peth, Pune 411002", paymentTermsDays: 30, bankName: "HDFC Bank", accountNo: "50200012457810", ifsc: "HDFC0000145", status: "Active" },
    { name: "MediSurge Healthcare Supplies", contactPerson: "Ms. Ritu Agarwal", phone: "9822450022", email: "sales@medisurge.example", gstin: "27AAKCM7781L1Z5", drugLicenseNo: "MH-PZ3-208811", address: "Plot 18, Bhosari MIDC, Pune 411026", paymentTermsDays: 45, bankName: "ICICI Bank", accountNo: "002105004512", ifsc: "ICIC0000021", status: "Active" },
    { name: "Lifeline Surgicals", contactPerson: "Mr. Prakash Rane", phone: "9822450033", email: "lifeline.surgicals@example.com", gstin: "27ABJPR2290M1Z8", drugLicenseNo: null, address: "Narayan Peth, Pune 411030", paymentTermsDays: 30, status: "Active" },
    { name: "Om Sai Hygiene Solutions", contactPerson: "Mr. Sai Pradhan", phone: "9822450044", email: null, gstin: "27AHGPP6612Q1ZB", drugLicenseNo: null, address: "Hadapsar Industrial Estate, Pune 411013", paymentTermsDays: 15, status: "Active" },
  ], day(-200)),
  "name"
);
const SUP = { sg: suppliers["Shree Ganesh Pharma Distributors"], ms: suppliers["MediSurge Healthcare Supplies"], ll: suppliers["Lifeline Surgicals"], os: suppliers["Om Sai Hygiene Solutions"] };

// key, name, category, subcategory, manufacturer, HSN, GST, MRP per issue unit, issue unit, purchase unit, conversion, batch tracked, reorder level, reorder qty, storage, supplier
const ITEM_ROWS = [
  ["pcm", "Paracetamol 650 mg Tablet (15s)", "MED", "Analgesics & Antipyretics", "Sunrise Lifesciences", "3004", 12, 32, "Strip", null, 1, "Yes", 50, 200, "Room temperature", "sg"],
  ["amox", "Amoxicillin 500 mg Capsule (10s)", "MED", "Antibiotics", "Zenith Remedies", "3004", 12, 98, "Strip", null, 1, "Yes", 30, 100, "Below 25 °C", "sg"],
  ["azi", "Azithromycin 500 mg Tablet (3s)", "MED", "Antibiotics", "Zenith Remedies", "3004", 12, 119, "Strip", null, 1, "Yes", 25, 80, "Below 25 °C", "sg"],
  ["pan", "Pantoprazole 40 mg Tablet (15s)", "MED", "Gastro", "Medilux Pharma", "3004", 12, 155, "Strip", null, 1, "Yes", 30, 100, "Room temperature", "sg"],
  ["met", "Metformin 500 mg Tablet (20s)", "MED", "Antidiabetic", "Medilux Pharma", "3004", 12, 44, "Strip", null, 1, "Yes", 40, 150, "Room temperature", "sg"],
  ["aml", "Amlodipine 5 mg Tablet (15s)", "MED", "Cardiac", "Cardiocare Labs", "3004", 12, 52, "Strip", null, 1, "Yes", 30, 100, "Room temperature", "sg"],
  ["cet", "Cetirizine 10 mg Tablet (10s)", "MED", "Antihistamines", "Sunrise Lifesciences", "3004", 12, 22, "Strip", null, 1, "Yes", 40, 150, "Room temperature", "sg"],
  ["atv", "Atorvastatin 10 mg Tablet (15s)", "MED", "Cardiac", "Cardiocare Labs", "3004", 12, 96, "Strip", null, 1, "Yes", 20, 60, "Room temperature", "sg"],
  ["syp", "Dextromethorphan Cough Syrup 100 ml", "MED", "Cough & Cold", "Medilux Pharma", "3004", 12, 115, "Bottle", null, 1, "Yes", 15, 40, "Room temperature", "sg"],
  ["ors", "ORS Powder Sachet 21 g", "MED", "ORS & Supplements", "Sunrise Lifesciences", "3004", 12, 22, "Pack", null, 1, "Yes", 30, 100, "Room temperature", "sg"],
  ["cef", "Ceftriaxone 1 g Injection", "MED", "Antibiotics", "Zenith Remedies", "3004", 12, 68, "Vial", null, 1, "Yes", 20, 60, "Below 25 °C", "sg"],
  ["ns", "Normal Saline 0.9% 500 ml", "MED", "IV Fluids", "Aqua Infusions", "3004", 12, 42, "Bottle", null, 1, "Yes", 30, 80, "Room temperature", "sg"],
  ["ins", "Human Insulin 40 IU/ml 10 ml Vial", "MED", "Antidiabetic", "Cardiocare Labs", "3004", 5, 165, "Vial", null, 1, "Yes", 10, 20, "2–8 °C", "sg"],
  ["glv", "Sterile Surgical Gloves 7.5", "SUR", "Gloves", "SafeHands", "4015", 12, 25, "Pair", "Box", 50, "Yes", 100, 10, "Room temperature", "ms"],
  ["syr", "Disposable Syringe 5 ml with Needle", "SUR", "Syringes & Needles", "Medisafe", "9018", 12, 9, "Piece", "Box", 100, "Yes", 150, 5, "Room temperature", "ms"],
  ["can", "IV Cannula 20G", "SUR", "IV Cannula", "Medisafe", "9018", 12, 120, "Piece", "Box", 50, "Yes", 40, 4, "Room temperature", "ms"],
  ["sut", "Absorbable Suture 2-0 (Polyglactin)", "SUR", "Sutures", "SutureTech", "3006", 12, 650, "Piece", "Box", 12, "Yes", 12, 3, "Below 25 °C", "ms"],
  ["gz", "Gauze Swab 10 x 10 cm (Pack of 10)", "CON", "Dressings", "CottonCare", "3005", 12, 45, "Pack", "Box", 20, "Yes", 40, 5, "Room temperature", "ll"],
  ["n95", "N95 Respirator Mask", "CON", "Masks", "SafeHands", "6307", 5, 60, "Piece", "Box", 20, "Yes", 60, 10, "Room temperature", "ll"],
  ["dis", "Floor Disinfectant 5 L", "HKP", "Cleaning Agents", "CleanPro", "3808", 18, 950, "Bottle", null, 1, "No", 5, 20, "Room temperature", "os"],
  ["hr", "Alcohol Hand Rub 500 ml", "HKP", "Cleaning Agents", "CleanPro", "3808", 18, 280, "Bottle", null, 1, "No", 10, 40, "Room temperature", "os"],
];
const items = {};
for (const [key, name, cat, sub, manufacturer, hsnCode, gst, mrp, issueUnit, purchaseUnit, conversion, batchTracked, reorderLevel, reorderQty, storage, sup] of ITEM_ROWS) {
  const sku = `${cat}-${String(await counter(`SKU-${cat}`)).padStart(5, "0")}`;
  items[key] = {
    _id: new ObjectId(), name, sku, barcode: sku, category: invCats[cat]._id, subcategory: subcats[sub]._id, manufacturer, hsnCode, gstRate: String(gst), mrp,
    issueUnit: units[issueUnit]._id, purchaseUnit: purchaseUnit ? units[purchaseUnit]._id : null, conversion, batchTracked, minLevel: reorderLevel, maxLevel: reorderLevel * 6,
    reorderLevel, reorderQty, storage, supplier: SUP[sup]._id, quantity: 0, unitCost: null, status: "Active",
    createdBy: admin._id, updatedBy: admin._id, createdAt: day(-200),
    // Stock document lines carry the unit symbol.
    $unit: units[issueUnit].symbol, $purchaseUnit: purchaseUnit ? units[purchaseUnit].symbol : null,
  };
}

/* ---------- stock engine (in memory, saved at the end) ---------- */

const batches = [];
const ledger = [];
const stockDocs = [];
function batchFor(item, st, batchNo, info = {}) {
  let b = batches.find((x) => x.item === item._id && x.store === st._id && x.batchNo === batchNo);
  if (!b) {
    b = { _id: new ObjectId(), item: item._id, store: st._id, batchNo, quantity: 0, createdBy: admin._id, updatedBy: admin._id, createdAt: info.at ?? new Date() };
    batches.push(b);
  }
  Object.assign(b, info.set);
  return b;
}
function move(item, st, b, qty, rate, meta) {
  b.quantity = r2(b.quantity + qty);
  item.quantity = r2(item.quantity + qty);
  if (b.quantity < 0) throw new Error(`Stock of ${item.name} in ${st.name} went negative`);
  ledger.push({ _id: new ObjectId(), at: meta.at, store: st._id, storeName: st.name, item: item._id, itemName: item.name, batch: b._id, batchNo: b.batchNo, qty: r2(qty), rate: r2(rate), value: r2(qty * rate), txn: meta.txn, docType: meta.docType, docId: meta.docId, docCode: meta.docCode, party: meta.party, department: meta.department, byName: BY });
}
const expiryIn = (months) => {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + months + 1, 0));
  return d;
};
const docBase = (type, code, n, extra) => ({ _id: new ObjectId(), type, code, docDate: day(n), createdBy: admin._id, createdByName: BY, createdAt: at(n, "11:00"), taxableTotal: 0, gstTotal: 0, discountTotal: 0, roundOff: 0, netAmount: 0, costValue: 0, ...extra });
const baseLine = (it) => ({ _id: new ObjectId(), item: it._id, itemName: it.name, sku: it.sku, unit: it.$unit, purchaseUnit: it.$purchaseUnit ?? undefined, freeQty: 0, receivedQty: 0, returnedQty: 0, discountPct: 0 });

/* ---------- pharmacy purchases (stock in to the Pharmacy store) ---------- */

const pharmacyPurchases = [];
async function pharmacyPurchase(n, supplier, invoiceNo, rows) {
  const lines = rows.map(([key, batchNo, months, qty, freeQty, purchaseRate, discountPct = 0]) => {
    const it = items[key];
    return { item: it._id, itemName: it.name, batchNo, expiryDate: expiryIn(months), qty, freeQty, purchaseRate, mrp: it.mrp, discountPct, gstRate: Number(it.gstRate), ...purchaseLine({ qty, purchaseRate, discountPct, gstRate: Number(it.gstRate) }) };
  });
  const doc = { _id: new ObjectId(), code: await nextCode("PUR"), supplier: supplier._id, supplierName: supplier.name, supplierInvoiceNo: invoiceNo, invoiceDate: day(n), items: lines, ...purchaseTotals(lines), status: "Received", notes: null, createdBy: admin._id, createdByName: BY, createdAt: at(n, "12:30") };
  for (const l of lines) {
    const it = items[Object.keys(items).find((k) => items[k]._id === l.item)];
    const unitsIn = l.qty + l.freeQty;
    const b = batchFor(it, stores.pharmacy, l.batchNo, { at: doc.createdAt, set: { expiryDate: l.expiryDate, mrp: l.mrp, purchaseRate: l.purchaseRate, gstRate: String(l.gstRate), supplier: supplier._id } });
    l.batch = b._id;
    it.unitCost = l.purchaseRate;
    move(it, stores.pharmacy, b, unitsIn, r2(l.taxable / unitsIn), { at: doc.createdAt, txn: "Pharmacy purchase", docType: "pharmacy_purchase", docId: doc._id, docCode: doc.code, party: supplier.name });
  }
  pharmacyPurchases.push(doc);
  return doc;
}
await pharmacyPurchase(-20, SUP.sg, "SGP/2627/1182", [
  ["pcm", "PCM2611", 20, 200, 20, 19.5], ["amox", "AMX6021", 18, 100, 10, 61], ["azi", "AZT3310", 22, 80, 0, 74.5, 2], ["pan", "PNZ8842", 24, 120, 12, 91],
  ["met", "MTF1290", 24, 150, 0, 25.8], ["aml", "AML4410", 21, 100, 10, 30.2], ["cet", "CTZ0771", 18, 150, 0, 11.6],
]);
await pharmacyPurchase(-10, SUP.sg, "SGP/2627/1305", [
  ["syp", "DXS5521", 15, 40, 4, 69], ["ors", "ORS2290", 12, 100, 0, 13.5], ["cef", "CFX7781", 20, 60, 0, 37.5], ["ns", "NS260918", 24, 80, 0, 25.6],
  ["ins", "HIN4410", 8, 6, 0, 120], ["atv", "ATV6650", 22, 10, 0, 55],
]);

/* ---------- pharmacy sale bills (stock out of the Pharmacy store) ---------- */

const pharmacySales = [];
async function pharmacySale(n, time, { patient, customerName, customerPhone, doctor, paymentMode, paid, later = [], notes }, rows) {
  const lines = rows.map(([key, qty, discountPct = 0]) => {
    const it = items[key];
    const b = batches.find((x) => x.item === it._id && x.store === stores.pharmacy._id);
    return { item: it._id, itemName: it.name, hsnCode: it.hsnCode, batch: b._id, batchNo: b.batchNo, expiryDate: b.expiryDate, qty, mrp: b.mrp, discountPct, gstRate: Number(b.gstRate), ...saleLine({ qty, mrp: b.mrp, discountPct, gstRate: Number(b.gstRate) }), $it: it, $b: b };
  });
  const totals = saleTotals(lines);
  const paidAmount = paid ?? (paymentMode === "Credit" ? 0 : totals.netAmount);
  const payments = later.map(([amount, mode, m, reference]) => ({ amount, mode, reference, at: at(m, "17:00"), byName: BY }));
  const totalPaid = r2(paidAmount + payments.reduce((s, p) => s + p.amount, 0));
  const doc = {
    _id: new ObjectId(), code: await nextCode("PH"), billDate: day(n), patient: patient?._id ?? null, customerName: customerName ?? patient.fullName, customerPhone: customerPhone ?? patient?.mobile ?? null,
    doctor: doctor?._id ?? null, doctorName: doctor?.fullName ?? null, paymentMode, ...totals, paidAmount: totalPaid, payments,
    status: totalPaid >= totals.netAmount ? "Paid" : totalPaid > 0 ? "Partially Paid" : "Unpaid", notes: notes ?? null, createdBy: admin._id, createdByName: BY, createdAt: at(n, time),
  };
  for (const l of lines) {
    move(l.$it, stores.pharmacy, l.$b, -l.qty, l.$b.purchaseRate, { at: doc.createdAt, txn: "Pharmacy sale", docType: "pharmacy_sale", docId: doc._id, docCode: doc.code, party: doc.customerName });
    delete l.$it;
    delete l.$b;
  }
  doc.items = lines;
  pharmacySales.push(doc);
  return doc;
}
await pharmacySale(-14, "10:20", { customerName: "Walk-in customer", customerPhone: null, paymentMode: "Cash" }, [["pcm", 2], ["cet", 1]]);
await pharmacySale(-6, "12:05", { patient: P.sunita, doctor: D.anita, paymentMode: "Cash" }, [["pcm", 2], ["pan", 1], ["cet", 1]]);
await pharmacySale(-5, "13:10", { patient: P.arjun, doctor: D.rajesh, paymentMode: "UPI" }, [["aml", 2], ["atv", 2]]);
await pharmacySale(-4, "12:40", { patient: P.kavita, doctor: D.priya, paymentMode: "Card" }, [["pan", 1], ["pcm", 1]]);
await pharmacySale(-2, "11:30", { patient: P.sanjay, doctor: D.sameer, paymentMode: "Cash" }, [["pcm", 3, 5], ["pan", 1, 5]]);
await pharmacySale(-1, "11:00", { patient: P.aarav, doctor: D.vikram, paymentMode: "UPI" }, [["syp", 1], ["cet", 1], ["ors", 4]]);
await pharmacySale(-1, "19:45", { customerName: "Mr. Dilip Shirke", customerPhone: "9850112233", paymentMode: "Credit", paid: 0, later: [[300, "Cash", 0, null]], notes: "Regular customer — monthly credit" }, [["met", 4], ["aml", 2], ["ins", 2]]);
await pharmacySale(0, "10:15", { patient: P.neha, doctor: D.anita, paymentMode: "Cash" }, [["pan", 1], ["amox", 1]]);
await pharmacySale(0, "11:50", { patient: P.mohammed, doctor: D.anita, paymentMode: "Credit", paid: 0, notes: "IPD — ICU-02, to be settled at discharge" }, [["cef", 6], ["ns", 4], ["ins", 2]]);

/* ---------- main store: stock entry, requisition → PO → GRN, movements ---------- */

{
  const doc = docBase("opening", await nextCode("OST"), -25, { status: "Posted", store: stores.main._id, storeName: stores.main.name, reason: "Opening balance", postedAt: at(-25, "11:00"), postedByName: BY });
  const rows = [["dis", "NA", null, 20, 620], ["hr", "NA", null, 40, 165], ["n95", "N95-2604", 30, 200, 26], ["gz", "GZ-26071", 36, 100, 25]];
  doc.lines = rows.map(([key, batchNo, months, qty, rate]) => {
    const it = items[key];
    const l = { ...baseLine(it), conversion: 1, batchNo, expiryDate: months ? expiryIn(months) : undefined, qty, rate, mrp: it.mrp, gstRate: Number(it.gstRate), taxable: r2(qty * rate), gst: 0, amount: r2(qty * rate) };
    const b = batchFor(it, stores.main, batchNo, { at: doc.createdAt, set: { expiryDate: l.expiryDate ?? null, mrp: it.mrp, purchaseRate: rate, gstRate: it.gstRate } });
    it.unitCost = rate;
    move(it, stores.main, b, qty, rate, { at: doc.createdAt, txn: "Stock entry: Opening balance", docType: "opening", docId: doc._id, docCode: doc.code });
    return l;
  });
  doc.costValue = r2(doc.lines.reduce((s, l) => s + l.amount, 0));
  stockDocs.push(doc);
}

const otOrder = [["glv", 10, 600], ["syr", 5, 380], ["can", 4, 2400], ["sut", 3, 4200]];
const requisition = docBase("requisition", await nextCode("PR"), -12, {
  status: "Ordered", store: stores.main._id, storeName: stores.main.name, department: "OT", priority: "Urgent", requiredBy: day(-8), notes: "Stock needed for the coming week's elective surgeries",
  approvedAt: at(-12, "15:00"), approvedByName: BY,
  lines: otOrder.map(([key, qty]) => ({ ...baseLine(items[key]), conversion: items[key].conversion, qty })),
});
const po = docBase("po", await nextCode("PO"), -11, {
  status: "Approved", supplier: SUP.ms._id, supplierName: SUP.ms.name, store: stores.main._id, storeName: stores.main.name, requisition: requisition._id, requisitionCode: requisition.code,
  expectedDate: day(-9), terms: "Delivery within 2 days. Payment 45 days from invoice.", approvedAt: at(-11, "16:00"), approvedByName: BY,
  lines: otOrder.map(([key, qty, rate]) => ({ ...baseLine(items[key]), conversion: items[key].conversion, qty, rate, gstRate: Number(items[key].gstRate), ...purchaseLine({ qty, purchaseRate: rate, discountPct: 0, gstRate: Number(items[key].gstRate) }) })),
});
Object.assign(po, purchaseTotals(po.lines));
const grn = docBase("grn", await nextCode("GRN"), -9, {
  status: "Posted", supplier: SUP.ms._id, supplierName: SUP.ms.name, store: stores.main._id, storeName: stores.main.name, po: po._id, poCode: po.code,
  invoiceNo: "MS/2627/4471", invoiceDate: day(-9), dueDate: day(-9 + SUP.ms.paymentTermsDays), postedAt: at(-9, "14:30"), postedByName: BY,
});
grn.lines = [["glv", 10, "GLV-2609A", 30], ["syr", 5, "SYR-2608", 48], ["can", 4, "CAN-2610", 36], ["sut", 2, "SUT-2605", 30]].map(([key, qty, batchNo, months]) => {
  const it = items[key];
  const rate = otOrder.find(([k]) => k === key)[2];
  const l = { ...baseLine(it), conversion: it.conversion, batchNo, expiryDate: expiryIn(months), qty, rate, mrp: it.mrp, gstRate: Number(it.gstRate), ...purchaseLine({ qty, purchaseRate: rate, discountPct: 0, gstRate: Number(it.gstRate) }) };
  const unitsIn = qty * it.conversion;
  const unitCost = r2(l.taxable / unitsIn);
  const b = batchFor(it, stores.main, batchNo, { at: grn.createdAt, set: { expiryDate: l.expiryDate, mrp: it.mrp, purchaseRate: unitCost, gstRate: it.gstRate, supplier: SUP.ms._id } });
  it.unitCost = unitCost;
  move(it, stores.main, b, unitsIn, unitCost, { at: grn.createdAt, txn: "Goods receipt", docType: "grn", docId: grn._id, docCode: grn.code, party: SUP.ms.name });
  po.lines.find((pl) => pl.item === it._id).receivedQty = qty;
  return l;
});
Object.assign(grn, purchaseTotals(grn.lines));
po.status = po.lines.every((l) => l.receivedQty >= l.qty) ? "Received" : "Partially Received";
stockDocs.push(requisition, po, grn);

const po2 = docBase("po", await nextCode("PO"), -1, {
  status: "Pending Approval", supplier: SUP.ll._id, supplierName: SUP.ll.name, store: stores.main._id, storeName: stores.main.name, expectedDate: day(3), terms: "Payment 30 days from invoice.",
  lines: [["n95", 10, 500], ["gz", 8, 500]].map(([key, qty, rate]) => ({ ...baseLine(items[key]), conversion: items[key].conversion, qty, rate, gstRate: Number(items[key].gstRate), ...purchaseLine({ qty, purchaseRate: rate, discountPct: 0, gstRate: Number(items[key].gstRate) }) })),
});
Object.assign(po2, purchaseTotals(po2.lines));
stockDocs.push(po2);

/** Outflow from one store (FEFO is trivial here: one batch per item and store). */
function pick(type, n, code, { from, to, department, patient, admission, reason }, rows) {
  const doc = docBase(type, code, n, { status: "Posted", store: from._id, storeName: from.name, postedAt: at(n, "12:00"), postedByName: BY });
  if (to) Object.assign(doc, { toStore: to._id, toStoreName: to.name });
  if (department) doc.department = department;
  if (patient) Object.assign(doc, { patient: patient._id, patientName: patient.fullName, patientCode: patient.code, admission: admission?._id, admissionCode: admission?.code });
  if (reason) doc.reason = reason;
  const party = patient ? patient.fullName : department ?? to?.name;
  doc.lines = rows.map(([key, qty]) => {
    const it = items[key];
    const b = batches.find((x) => x.item === it._id && x.store === from._id);
    const rate = b.purchaseRate;
    const l = { ...baseLine(it), conversion: 1, batch: b._id, batchNo: b.batchNo, expiryDate: b.expiryDate ?? undefined, qty, rate, mrp: b.mrp, gstRate: Number(b.gstRate), amount: r2(qty * (type === "patient_issue" ? b.mrp : rate)) };
    const txn = type === "transfer" ? `Transfer to ${to.name}` : type === "issue" ? `Issue to ${department}` : type === "patient_issue" ? "Issue to patient" : `Write-off: ${reason}`;
    move(it, from, b, -qty, rate, { at: doc.createdAt, txn, docType: type, docId: doc._id, docCode: doc.code, party, department });
    if (type === "transfer") {
      const tb = batchFor(it, to, b.batchNo, { at: doc.createdAt, set: { expiryDate: b.expiryDate ?? null, mrp: b.mrp, purchaseRate: rate, gstRate: b.gstRate, supplier: b.supplier ?? null } });
      move(it, to, tb, qty, rate, { at: doc.createdAt, txn: `Transfer from ${from.name}`, docType: type, docId: doc._id, docCode: doc.code, party: from.name });
    }
    return l;
  });
  doc.costValue = r2(doc.lines.reduce((s, l) => s + l.qty * l.rate, 0));
  if (type === "patient_issue") doc.netAmount = r2(doc.lines.reduce((s, l) => s + l.amount, 0));
  stockDocs.push(doc);
  return doc;
}
pick("transfer", -7, await nextCode("TRF"), { from: stores.main, to: stores.icu }, [["glv", 100], ["syr", 200], ["can", 30], ["n95", 40]]);
pick("issue", -6, await nextCode("ISS"), { from: stores.main, department: "OT" }, [["glv", 150], ["sut", 12], ["gz", 30]]);
pick("issue", -4, await nextCode("ISS"), { from: stores.main, department: "Housekeeping" }, [["dis", 6], ["hr", 10]]);
pick("transfer", -3, await nextCode("TRF"), { from: stores.main, to: stores.ward }, [["syr", 100], ["gz", 20], ["hr", 6]]);
pick("write_off", -3, await nextCode("WOF"), { from: stores.main, reason: "Damaged / broken" }, [["hr", 2]]);
const rameshIssue = pick("patient_issue", -2, await nextCode("PIS"), { from: stores.main, patient: P.ramesh, admission: admissions.ramesh }, [["can", 2], ["syr", 6], ["gz", 4]]);
rameshIssue.chargeToPatient = true;
stockDocs.push(docBase("reservation", await nextCode("RSV"), -1, {
  status: "Active", store: stores.main._id, storeName: stores.main.name, patient: P.kavita._id, patientName: P.kavita.fullName, patientCode: P.kavita.code,
  purpose: "Planned laparoscopic hysterectomy", requiredBy: day(6), lines: [["sut", 4], ["glv", 20]].map(([key, qty]) => ({ ...baseLine(items[key]), conversion: 1, qty })),
}));

/* ======================= billing masters ======================= */

const SERVICES = [
  ["REG", "Registration Fee", "Registration", null, 100, "Per service", "No"],
  ["BED-GEN", "General Ward Bed Charges", "Room / Bed", null, 1500, "Per day", "No"],
  ["BED-SP", "Semi-Private Room Charges", "Room / Bed", null, 2500, "Per day", "No"],
  ["BED-PVT", "Private Room Charges", "Room / Bed", null, 4000, "Per day", "No"],
  ["BED-MAT", "Maternity Ward Bed Charges", "Room / Bed", "Gynecology", 1800, "Per day", "No"],
  ["ICU-BED", "ICU Bed Charges", "ICU", null, 6000, "Per day", "No"],
  ["NUR-GEN", "Nursing Charges (Ward)", "Nursing", null, 500, "Per day", "No"],
  ["NUR-ICU", "ICU Nursing Charges", "Nursing", null, 1200, "Per day", "No"],
  ["EMR", "Emergency Charges", "Emergency", "Emergency", 500, "Per service", "No"],
  ["ECG", "ECG (12-lead)", "Procedure", "Cardiology", 300, "Per service", "No"],
  ["ECHO", "2D Echocardiography", "Radiology", "Cardiology", 2200, "Per service", "No"],
  ["XR-CHEST", "X-Ray Chest PA View", "Radiology", "Radiology", 450, "Per service", "No"],
  ["XR-KNEE", "X-Ray Knee AP & Lateral", "Radiology", "Radiology", 550, "Per service", "No"],
  ["XR-HIP", "X-Ray Pelvis with Both Hips", "Radiology", "Radiology", 600, "Per service", "No"],
  ["USG-ABD", "USG Abdomen & Pelvis", "Radiology", "Radiology", 1200, "Per service", "No"],
  ["DRS", "Dressing (Small)", "Procedure", null, 200, "Per service", "Yes"],
  ["INJ", "Injection Charges", "Procedure", null, 50, "Per service", "No"],
  ["NEB", "Nebulization", "Procedure", null, 150, "Per service", "No"],
  ["O2", "Oxygen Charges", "Equipment", null, 100, "Per hour", "No"],
  ["OT-MIN", "OT Charges – Minor", "Surgery / OT", "Surgery", 5000, "Per service", "Yes"],
  ["OT-MAJ", "OT Charges – Major", "Surgery / OT", "Surgery", 25000, "Per service", "Yes"],
  ["PHYSIO", "Physiotherapy Session", "Procedure", "Orthopedics", 400, "Per visit", "No"],
  ["MRC", "Medical Certificate / Records", "Other", null, 200, "Per service", "No"],
];
const SVC = {};
for (const [code, name, category, department, rate, unit, rateEditable] of SERVICES) {
  SVC[code] = await rec("billing_services", null, { name, code, category, department, rate, unit, rateEditable, gstRate: "0", sacCode: "999311", status: "Active" }, day(-180));
}
const packages = byName(await recs("billing_packages", "HPK", [
  { name: "Normal Delivery Package", billType: "IPD", services: [SVC.REG._id, SVC["BED-MAT"]._id, SVC["NUR-GEN"]._id], rate: 25000, stayDays: 3, gstRate: "0", inclusions: "Includes 3 days maternity ward stay, nursing, labour room and routine medicines. Excludes NICU, blood and special investigations.", status: "Active" },
  { name: "Caesarean Section (LSCS) Package", billType: "IPD", services: [SVC.REG._id, SVC["BED-MAT"]._id, SVC["NUR-GEN"]._id, SVC["OT-MAJ"]._id], rate: 55000, stayDays: 4, gstRate: "0", inclusions: "Includes OT, surgeon and anaesthetist fees, 4 days stay. Excludes NICU and blood.", status: "Active" },
  { name: "Executive Health Check-up", billType: "OPD", services: [SVC.REG._id, SVC.ECG._id, SVC["XR-CHEST"]._id, SVC["USG-ABD"]._id], rate: 3500, stayDays: 0, gstRate: "0", inclusions: "Physician consultation, ECG, chest X-ray, USG abdomen. Lab tests billed by the laboratory.", status: "Active" },
], day(-170)), "name");
const deliveryPackage = packages["Normal Delivery Package"];
await recs("billing_rates", null, [
  { service: SVC["BED-GEN"]._id, ratePlan: "Corporate", rate: 1400, effectiveFrom: day(-180), status: "Active" },
  { service: SVC["BED-SP"]._id, ratePlan: "Corporate", rate: 2300, effectiveFrom: day(-180), status: "Active" },
  { service: SVC["ICU-BED"]._id, ratePlan: "Corporate", rate: 5500, effectiveFrom: day(-180), status: "Active" },
  { service: SVC.ECG._id, ratePlan: "Corporate", rate: 270, effectiveFrom: day(-180), status: "Active" },
  { service: SVC.REG._id, ratePlan: "Senior Citizen", rate: 50, effectiveFrom: day(-180), status: "Active" },
  { service: SVC.REG._id, ratePlan: "Staff", rate: 0, effectiveFrom: day(-180), status: "Active" },
  { service: SVC["XR-CHEST"]._id, ratePlan: "Senior Citizen", rate: 380, effectiveFrom: day(-180), status: "Active" },
], day(-180));
const corporates = byName(
  await recs("billing_corporates", "CRP", [
    { name: "Deccan Infotech Solutions Pvt. Ltd.", partyType: "Corporate", contactPerson: "Ms. Swati Bendre (HR)", phone: "02066123400", email: "hr.benefits@deccaninfotech.example", gstin: "27AADCD4521K1Z3", address: "Tower B, Hinjewadi Phase 2, Pune 411057", ratePlan: "Corporate", coveragePct: 80, creditLimit: 300000, creditDays: 45, agreementValidUntil: day(240), status: "Active" },
    { name: "Sahyadri Auto Components Pvt. Ltd.", partyType: "Corporate", contactPerson: "Mr. Vinod Mane", phone: "02027123456", email: "admin@sahyadriauto.example", gstin: "27AAECS7781F1ZK", address: "Chakan MIDC, Pune 410501", ratePlan: "Corporate", coveragePct: 100, creditLimit: 200000, creditDays: 30, agreementValidUntil: day(60), status: "Active" },
    { name: "Shri Sai Charitable Trust", partyType: "Trust / NGO", contactPerson: "Mr. Sudhir Kale", phone: "02024450987", email: null, gstin: null, address: "Shivajinagar, Pune 411005", ratePlan: "Concession", coveragePct: 50, creditLimit: 50000, creditDays: 60, agreementValidUntil: day(300), status: "Active" },
  ], day(-170)),
  "name"
);

/* ======================= insurance masters ======================= */

const providers = byName(
  await recs("insurance_providers", null, [
    { name: "Sahyog General Insurance Co. Ltd.", payerType: "Insurance Company", shortCode: "SGI", regNo: "IRDAI-GI-112", contactPerson: "Ms. Anagha Rao", contactPhone: "18002091122", email: "network@sahyoginsurance.example", claimsEmail: "claims@sahyoginsurance.example", portalUrl: "https://providers.sahyoginsurance.example", address: "Bund Garden Road, Pune 411001", paymentTermsDays: 30, agreementValidUntil: day(400), status: "Active" },
    { name: "Navjeevan Health Insurance Ltd.", payerType: "Insurance Company", shortCode: "NHI", regNo: "IRDAI-HI-148", contactPerson: "Mr. Kunal Sethi", contactPhone: "18002668800", email: "provider@navjeevanhealth.example", claimsEmail: "preauth@navjeevanhealth.example", address: "Andheri East, Mumbai 400069", paymentTermsDays: 21, agreementValidUntil: day(200), status: "Active" },
    { name: "CarePlus TPA Services Pvt. Ltd.", payerType: "TPA", shortCode: "CPT", regNo: "IRDAI-TPA-031", contactPerson: "Mr. Rohan Desai", contactPhone: "02066789900", email: "hospitals@careplustpa.example", claimsEmail: "cashless@careplustpa.example", address: "Baner, Pune 411045", paymentTermsDays: 30, agreementValidUntil: day(330), status: "Active" },
    { name: "MedLink Health TPA Pvt. Ltd.", payerType: "TPA", shortCode: "MLT", regNo: "IRDAI-TPA-057", contactPerson: "Ms. Farah Mistry", contactPhone: "02240015500", email: "network@medlinktpa.example", claimsEmail: "cashless@medlinktpa.example", address: "Lower Parel, Mumbai 400013", paymentTermsDays: 30, agreementValidUntil: day(120), status: "Active" },
  ], day(-300)),
  "name"
);
const INS = { sgi: providers["Sahyog General Insurance Co. Ltd."], nhi: providers["Navjeevan Health Insurance Ltd."], cpt: providers["CarePlus TPA Services Pvt. Ltd."], mlt: providers["MedLink Health TPA Pvt. Ltd."] };
const policies = {
  lata: await rec("insurance_policies", null, { patient: P.lata._id, insurer: INS.sgi._id, tpa: INS.cpt._id, policyNumber: "SGI/HL/2025/0045821", memberId: "CPT-4482190-01", policyType: "Individual", policyHolder: "Lata Gaikwad", relation: "Self", sumInsured: 300000, copayPct: 0, roomRentLimit: 3000, validFrom: day(-200), validTo: day(165), status: "Active", notes: "Senior citizen plan. Cataract capped at ₹40,000." }, day(-100)),
  mohammed: await rec("insurance_policies", null, { patient: P.mohammed._id, insurer: INS.nhi._id, tpa: INS.mlt._id, policyNumber: "NHI-IND-7781203", memberId: "MLT-99812-00", policyType: "Individual", policyHolder: "Mohammed Shaikh", relation: "Self", sumInsured: 500000, copayPct: 0, roomRentLimit: 8000, validFrom: day(-90), validTo: day(275), status: "Active" }, day(-60)),
  priya: await rec("insurance_policies", null, { patient: P.priya._id, insurer: INS.sgi._id, tpa: INS.cpt._id, policyNumber: "SGI/GMC/DIT/2026/118", memberId: "CPT-DIT-0118-03", policyType: "Group / Corporate", policyHolder: "Rahul Nair", relation: "Spouse", corporateName: "Deccan Infotech Solutions Pvt. Ltd.", sumInsured: 300000, copayPct: 0, roomRentLimit: 5000, validFrom: day(-250), validTo: day(115), status: "Active", notes: "Maternity cover capped at ₹25,000 (normal) / ₹50,000 (LSCS)." }, day(-30)),
  kavita: await rec("insurance_policies", null, { patient: P.kavita._id, insurer: INS.nhi._id, tpa: null, policyNumber: "NHI-FF-5523019", memberId: "NHI-5523019-02", policyType: "Family Floater", policyHolder: "Mandar Joshi", relation: "Spouse", sumInsured: 500000, copayPct: 10, roomRentLimit: 5000, validFrom: day(-150), validTo: day(215), status: "Active" }, day(-20)),
};

/* ======================= ambulance ======================= */

const tariffs = {
  als: await rec("ambulance_tariffs", null, { name: "ALS – city", vehicleType: "Advanced Life Support", tripType: null, baseFare: 1500, includedKm: 5, perKmRate: 30, freeWaitingMinutes: 30, waitingPerHour: 300, nightSurchargePct: 20, oxygenCharge: 500, ventilatorCharge: 1500, status: "Active" }, day(-300)),
  bls: await rec("ambulance_tariffs", null, { name: "BLS – city", vehicleType: "Basic Life Support", tripType: null, baseFare: 800, includedKm: 5, perKmRate: 20, freeWaitingMinutes: 30, waitingPerHour: 200, nightSurchargePct: 15, oxygenCharge: 300, ventilatorCharge: 0, status: "Active" }, day(-300)),
  pt: await rec("ambulance_tariffs", null, { name: "Patient transport", vehicleType: "Patient Transport", tripType: null, baseFare: 500, includedKm: 5, perKmRate: 15, freeWaitingMinutes: 30, waitingPerHour: 150, nightSurchargePct: 10, oxygenCharge: 0, ventilatorCharge: 0, status: "Active" }, day(-300)),
};
const driverInfo = (s) => ({ driverName: s.fullName, driverPhone: s.phone });
const vehicles = {
  als: await rec("ambulance_vehicles", null, { vehicleNumber: "MH12 AB 1023", type: "Advanced Life Support", make: "Force Traveller 26", year: 2022, fuelType: "Diesel", equipment: "Oxygen,Ventilator,Defibrillator,Cardiac Monitor,Suction,Infusion Pump,Spine Board,Stretcher", defaultDriver: S["Santosh Jadhav"]._id, ...driverInfo(S["Santosh Jadhav"]), baseLocation: "Main gate bay 1", insuranceExpiry: day(210), fitnessExpiry: day(400), pucExpiry: day(80), permitExpiry: day(500), nextServiceDue: day(70), odometer: 48254, status: "Available" }, day(-600)),
  bls: await rec("ambulance_vehicles", null, { vehicleNumber: "MH12 CD 4587", type: "Basic Life Support", make: "Maruti Suzuki Eeco Ambulance", year: 2021, fuelType: "CNG", equipment: "Oxygen,Suction,Stretcher,Wheelchair", defaultDriver: S["Ganesh More"]._id, ...driverInfo(S["Ganesh More"]), baseLocation: "Main gate bay 2", insuranceExpiry: day(95), fitnessExpiry: day(18), pucExpiry: day(40), permitExpiry: day(300), nextServiceDue: day(25), odometer: 30560, status: "On Trip" }, day(-700)),
  pt: await rec("ambulance_vehicles", null, { vehicleNumber: "MH14 EF 7790", type: "Patient Transport", make: "Tata Winger", year: 2019, fuelType: "Diesel", equipment: "Stretcher,Wheelchair", defaultDriver: null, driverName: null, driverPhone: null, baseLocation: "Rear parking", insuranceExpiry: day(140), fitnessExpiry: day(220), pucExpiry: day(12), permitExpiry: day(260), nextServiceDue: day(-2), odometer: 61209, status: "Maintenance" }, day(-900)),
};
await recs("ambulance_fuel", "FUL", [
  { vehicle: vehicles.als._id, fillDate: day(-12), litres: 42, rate: 94.6, amount: r2(42 * 94.6), odometer: 47980, station: "Indian Oil, Paud Road", paymentMode: "Fuel Card", billNo: "IO-778120", filledBy: S["Santosh Jadhav"]._id },
  { vehicle: vehicles.pt._id, fillDate: day(-9), litres: 35, rate: 94.6, amount: r2(35 * 94.6), odometer: 61150, station: "HP Petrol Pump, Karve Road", paymentMode: "Fuel Card", billNo: "HP-55102", filledBy: S["Ganesh More"]._id },
  { vehicle: vehicles.bls._id, fillDate: day(-5), litres: 9.5, rate: 89.5, amount: r2(9.5 * 89.5), odometer: 30530, station: "MNGL CNG Station, Kothrud", paymentMode: "Cash", billNo: "MNGL-23311", filledBy: S["Ganesh More"]._id },
  { vehicle: vehicles.als._id, fillDate: day(-2), litres: 38, rate: 94.6, amount: r2(38 * 94.6), odometer: 48230, station: "Indian Oil, Paud Road", paymentMode: "Fuel Card", billNo: "IO-779004", filledBy: S["Santosh Jadhav"]._id },
], (r) => r.fillDate);
await recs("ambulance_maintenance", "VMT", [
  { vehicle: vehicles.als._id, jobType: "Scheduled Service", startDate: day(-20), endDate: day(-20), vendor: "Force Motors Authorised Service, Pimpri", odometerAtService: 47900, cost: 6500, nextServiceDue: day(70), description: "10,000 km service: engine oil, filters, brake pads checked", status: "Completed" },
  { vehicle: vehicles.pt._id, jobType: "Repair", startDate: day(-1), endDate: null, vendor: "Shree Auto Works, Kothrud", odometerAtService: 61209, cost: 14500, nextServiceDue: null, description: "AC compressor not cooling; rear suspension noise", status: "In Workshop" },
  { vehicle: vehicles.bls._id, jobType: "Tyres", startDate: day(7), endDate: null, vendor: "Apollo Tyres Point, Karve Road", odometerAtService: null, cost: 9200, nextServiceDue: null, description: "Replace front tyres (worn below 2 mm)", status: "Scheduled" },
], (r) => (r.startDate < today ? r.startDate : day(-1)));

const trips = {};
async function trip(key, t) {
  const tariff = t.tariff;
  const charges = t.distanceKm != null ? tripCharges(tariff, { distanceKm: t.distanceKm, waitingMinutes: t.waitingMinutes ?? 0, night: t.night ?? false, oxygen: !!t.oxygenUsed, ventilator: false, discount: t.discount ?? 0 }) : undefined;
  const payments = (t.payments ?? []).map(([mode, amount, reference]) => ({ mode, amount, reference, at: t.completedAt, byName: BY }));
  const paidAmount = r2(payments.reduce((s, p) => s + p.amount, 0));
  const paymentStatus = t.billingMode === "Hospital Bill" ? "On Hospital Bill" : t.billingMode === "No Charge" ? "No Charge" : !charges ? "Not Billed" : paidAmount >= charges.total ? "Paid" : paidAmount > 0 ? "Partially Paid" : "Unpaid";
  const p = t.patient;
  const doc = {
    _id: new ObjectId(), tripType: t.tripType, priority: t.priority, callerName: t.callerName, callerPhone: t.callerPhone, requestedAt: t.requestedAt,
    patient: p?._id, patientName: p?.fullName ?? t.patientName, patientCode: p?.code, patientAge: p ? ageYears(p.dateOfBirth) : t.patientAge, patientGender: p?.gender ?? t.patientGender, condition: t.condition,
    pickupLocation: t.pickupLocation, pickupLandmark: t.pickupLandmark, dropLocation: t.dropLocation ?? "MediCare Hospital, Emergency", toHospital: t.toHospital ?? true,
    ...(t.vehicle ? { vehicle: t.vehicle._id, vehicleNumber: t.vehicle.vehicleNumber, vehicleType: t.vehicle.type } : {}),
    ...(t.driver ? { driver: t.driver._id, driverName: t.driver.fullName, driverPhone: t.driver.phone } : {}),
    crew: (t.crew ?? []).map((s) => ({ staff: s._id, name: s.fullName, role: s.staffCategory, phone: s.phone })),
    dispatchedAt: t.dispatchedAt, onSceneAt: t.onSceneAt, departedAt: t.departedAt, arrivedAt: t.arrivedAt, completedAt: t.completedAt, cancelledAt: t.cancelledAt, cancelReason: t.cancelReason,
    odometerStart: t.odometerStart, odometerEnd: t.odometerEnd, distanceKm: t.distanceKm, waitingMinutes: t.waitingMinutes, oxygenUsed: t.oxygenUsed, ventilatorUsed: false,
    ...(charges ? { tariff: tariff._id, tariffName: tariff.name, charges, billingMode: t.billingMode } : {}),
    payments, paidAmount, paymentStatus, status: t.status, ...(t.visit ? { visit: t.visit._id, visitCode: t.visit.code } : {}),
    events: [["Requested", t.requestedAt], ["Dispatched", t.dispatchedAt], ["On Scene", t.onSceneAt], ["Transporting", t.departedAt], ["Arrived", t.arrivedAt], ["Completed", t.completedAt], ["Cancelled", t.cancelledAt]]
      .filter(([, when]) => when).map(([status, when]) => ({ at: when, status, byName: BY, note: status === "Cancelled" ? t.cancelReason : undefined })),
    notes: t.notes, createdBy: admin._id, createdByName: BY, createdAt: t.requestedAt,
  };
  trips[key] = doc;
  return doc;
}
await trip("vijay", {
  tripType: "Emergency", priority: "Critical", callerName: "Traffic police (Hinjewadi chowky)", callerPhone: "02022934011", requestedAt: at(-1, "08:40"), patient: P.vijay,
  condition: "Two-wheeler skid — conscious, bleeding from left forearm, suspected wrist fracture", pickupLocation: "Hinjewadi Phase 1, near Shivaji Chowk", pickupLandmark: "Opposite the bus depot",
  visit: visitOf(P.vijay, -1), vehicle: vehicles.als, driver: S["Santosh Jadhav"], crew: [S["Amit Shinde"]], dispatchedAt: at(-1, "08:43"), onSceneAt: at(-1, "08:58"), departedAt: at(-1, "09:10"), arrivedAt: at(-1, "09:32"), completedAt: at(-1, "09:50"),
  odometerStart: 48240, odometerEnd: 48254, distanceKm: 14, waitingMinutes: 0, oxygenUsed: true, tariff: tariffs.als, billingMode: "Hospital Bill",
});
await trip("night", {
  tripType: "Emergency", priority: "Urgent", callerName: "Mrs. Kalpana Jagtap", callerPhone: "9881203344", requestedAt: at(-3, "23:15"), patientName: "Sunil Jagtap", patientAge: 61, patientGender: "Male",
  condition: "Breathlessness at night, known COPD", pickupLocation: "Erandwane, near Mhatre Bridge", vehicle: vehicles.als, driver: S["Santosh Jadhav"], crew: [S["Amit Shinde"]],
  dispatchedAt: at(-3, "23:18"), onSceneAt: at(-3, "23:31"), departedAt: at(-3, "23:40"), arrivedAt: at(-3, "23:52"), completedAt: at(-2, "00:05"),
  odometerStart: 48210, odometerEnd: 48218, distanceKm: 8, waitingMinutes: 0, oxygenUsed: true, night: true, tariff: tariffs.als, billingMode: "Collect", payments: [["Cash", 1500, null]], notes: "Balance to be collected from family at discharge",
});
await trip("discharge", {
  tripType: "Discharge Drop", priority: "Routine", callerName: "Rahul Nair", callerPhone: "9767012234", requestedAt: at(-4, "12:30"), patient: P.priya, condition: "Post-delivery discharge with newborn",
  pickupLocation: "MediCare Hospital, Maternity Ward", dropLocation: "22, Lane 5, Viman Nagar, Pune 411014", toHospital: false, vehicle: vehicles.pt, driver: S["Ganesh More"],
  dispatchedAt: at(-4, "13:00"), onSceneAt: at(-4, "13:05"), departedAt: at(-4, "13:15"), arrivedAt: at(-4, "13:42"), completedAt: at(-4, "13:50"),
  odometerStart: 61200, odometerEnd: 61209, distanceKm: 9, waitingMinutes: 10, tariff: tariffs.pt, billingMode: "Collect", payments: [["UPI", 560, "UPI 4410223318"]],
});
await trip("dialysis", {
  tripType: "Scheduled Pickup", priority: "Routine", callerName: "Mr. Bhaskar Rao", callerPhone: "9422011122", requestedAt: at(-7, "18:00"), patientName: "Bhaskar Rao", patientAge: 67, patientGender: "Male",
  condition: "Dialysis patient, wheelchair bound", pickupLocation: "Bavdhan, Pune 411021", vehicle: vehicles.bls, driver: S["Ganesh More"],
  dispatchedAt: at(-6, "07:30"), onSceneAt: at(-6, "07:52"), departedAt: at(-6, "08:42"), arrivedAt: at(-6, "09:05"), completedAt: at(-6, "09:10"),
  odometerStart: 30500, odometerEnd: 30518, distanceKm: 18, waitingMinutes: 50, oxygenUsed: false, tariff: tariffs.bls, billingMode: "Collect", payments: [["Cash", 1160, null]],
});
await trip("active", {
  tripType: "Emergency", priority: "Critical", callerName: "Ms. Sneha Patil", callerPhone: "9890544332", requestedAt: minutesAgo(22), patientName: "Male, about 70 years", patientGender: "Male",
  condition: "Chest pain with sweating for 30 minutes", pickupLocation: "Shivajinagar, near the bus stand", pickupLandmark: "Hotel Shreyas gate", vehicle: vehicles.bls, driver: S["Ganesh More"], crew: [S["Amit Shinde"]],
  dispatchedAt: minutesAgo(19), odometerStart: 30560, status: "Dispatched",
});
await trip("waiting", {
  tripType: "Emergency", priority: "Urgent", callerName: "Kothrud police chowky", callerPhone: "02025380000", requestedAt: minutesAgo(4), patientName: "Unknown", condition: "Person found unconscious at the roadside",
  pickupLocation: "Paud Road, near Vanaz metro station", status: "Requested",
});
await trip("cancelled", {
  tripType: "Inter-facility Transfer", priority: "Routine", callerName: "Dr. Mehta Clinic", callerPhone: "9822334455", requestedAt: at(-2, "18:20"), patientName: "Mrs. Usha Mehta", patientAge: 72, patientGender: "Female",
  condition: "Transfer for CT scan", pickupLocation: "Karve Nagar", cancelledAt: at(-2, "18:35"), cancelReason: "Caller arranged a private vehicle", status: "Cancelled",
});
// Numbered in the order the calls came in.
for (const t of Object.values(trips).sort((a, b) => a.requestedAt - b.requestedAt)) {
  t.status ??= "Completed";
  t.code = await nextCode("AMB");
}

/* ======================= hospital bills ======================= */

const bills = [];
const L = {
  svc: (code, qty = 1, extra = {}) => {
    const s = SVC[code];
    return { kind: "Service", category: s.category, service: s._id, name: s.name, code: s.code, unit: s.unit, rate: extra.rate ?? s.rate, gstRate: Number(s.gstRate), rateEditable: s.rateEditable === "Yes", qty, ...extra };
  },
  fee: (d, feeType, qty = 1, extra = {}) => {
    const fixed = { Consultation: d.consultationFee, "Follow-up": d.followUpFee ?? d.consultationFee, Emergency: d.emergencyFee ?? d.consultationFee, "IPD Visit": d.ipdVisitFee ?? d.consultationFee }[feeType];
    const category = feeType === "Emergency" ? "Emergency" : ["Surgeon", "Assistant Surgeon", "Anaesthetist"].includes(feeType) ? "Surgery / OT" : feeType === "Procedure" ? "Procedure" : "Consultation";
    return { kind: "Doctor Fee", category, doctor: d._id, doctorName: d.fullName, feeType, name: `${feeType} fee — ${d.fullName}`, code: d.code, unit: feeType === "IPD Visit" ? "Per visit" : "Per service", rate: extra.rate ?? fixed, gstRate: 0, rateEditable: fixed == null, doctorSharePct: d.revenueSharePct ?? 0, qty, ...extra };
  },
  manual: (category, name, rate, qty = 1, extra = {}) => ({ kind: "Manual", category, name, unit: "Per service", rate, gstRate: 0, rateEditable: true, qty, ...extra }),
};

/** Same derivation as recompute() in lib/billing.ts. */
function recompute(bill) {
  const live = bill.lines.filter((l) => l.status !== "Cancelled");
  const calc = hospitalBill(live.map((l) => ({ qty: l.qty, rate: l.rate, discountPct: l.discountPct ?? 0, gstRate: l.gstRate ?? 0 })), bill.billDiscount ?? 0);
  live.forEach((l, i) => Object.assign(l, calc.lines[i]));
  Object.assign(bill, calc.totals);
  Object.assign(bill, payerSplit({ net: bill.netAmount, payerType: bill.payerType, coveragePct: bill.coveragePct, payerLimit: bill.payerLimit, movedToPatient: bill.movedToPatient }));
  const counted = (r) => r2(r.splits.filter((s) => s.recon !== "Bounced").reduce((s, x) => s + x.amount, 0));
  const sumOf = (kinds) => r2(bill.receipts.filter((r) => kinds.includes(r.kind)).reduce((s, r) => s + counted(r), 0));
  bill.patientPaid = r2(sumOf(["Advance", "Payment"]) - sumOf(["Refund"]));
  bill.payerPaid = sumOf(["Settlement"]);
  bill.payerWriteOff = r2(bill.receipts.filter((r) => r.kind === "Settlement").reduce((s, r) => s + (r.writeOff ?? 0), 0));
  const credit = r2(Math.max(0, bill.patientPaid - bill.patientShare));
  bill.patientDue = r2(Math.max(0, bill.patientShare - bill.patientPaid));
  bill.refundDue = bill.status === "Provisional" ? 0 : credit;
  bill.payerDue = bill.payerType === "Self" ? 0 : r2(Math.max(0, bill.payerShare - bill.payerPaid - bill.payerWriteOff));
  if (bill.refundDue > 0) bill.paymentStatus = "Refund Due";
  else if (bill.status === "Provisional" && credit > 0) bill.paymentStatus = "Advance";
  else if (bill.patientDue <= 0) bill.paymentStatus = bill.netAmount === 0 && bill.patientPaid === 0 ? "Unpaid" : "Paid";
  else bill.paymentStatus = bill.patientPaid > 0 ? "Partially Paid" : "Unpaid";
  if (bill.status === "Final" || bill.status === "Closed") bill.status = bill.patientDue === 0 && bill.payerDue === 0 && bill.refundDue === 0 ? "Closed" : "Final";
}

/**
 * receipts: [kind, at, [[mode, amount, reference?, recon?], ...], extra?]
 * An amount of "due" takes whatever the patient still owes after the receipt's other splits.
 */
function bill(b) {
  const p = b.patient;
  const doc = {
    _id: b._id ?? new ObjectId(), billDate: b.billDate, billType: b.billType, ...snap(p, b.billDate),
    ...(b.visit ? { visit: b.visit._id, visitCode: b.visit.code } : {}),
    ...(b.admission ? { admission: b.admission._id, admissionCode: b.admission.code, admissionDate: b.admission.admissionDate, wardBed: `${b.admission.ward} / ${b.admission.bedNumber}`, dischargeDate: b.admission.dischargeDate ?? undefined } : {}),
    doctor: b.doctor?._id, doctorName: b.doctor?.fullName, department: b.department, ratePlan: b.ratePlan ?? "General", payerType: b.payerType ?? "Self", ...b.payer,
    lines: b.lines.map((l) => ({ _id: new ObjectId(), discountPct: 0, status: "Active", addedAt: b.addedAt ?? at(Math.round((b.billDate - today) / DAY), "11:00"), addedByName: BY, serviceDate: b.billDate, ...l })),
    billDiscount: b.billDiscount ?? 0, discountReason: b.discountReason, discountApprovedBy: b.discountApprovedBy, movedToPatient: 0,
    receipts: [], status: b.status, notes: b.notes, createdBy: admin._id, createdByName: BY, createdAt: b.createdAt ?? at(Math.round((b.billDate - today) / DAY), "10:30"),
    ...(b.status !== "Provisional" ? { finalizedAt: b.finalizedAt, finalizedByName: BY } : {}),
  };
  recompute(doc);
  for (const [kind, when, splits, extra = {}] of b.receipts ?? []) {
    const fixed = r2(splits.reduce((s, [, amount]) => s + (amount === "due" ? 0 : amount), 0));
    const due = r2(doc.patientDue - fixed);
    const parts = splits.map(([mode, amount, reference, recon]) => ({ _id: new ObjectId(), mode, amount: amount === "due" ? due : amount, reference, recon: recon ?? (mode === "Cash" ? "Not Required" : "Pending") }));
    doc.receipts.push({ _id: new ObjectId(), kind, amount: r2(parts.reduce((s, x) => s + x.amount, 0)), writeOff: 0, toPatient: 0, at: when, by: admin._id, byName: BY, ...extra, splits: parts });
    recompute(doc);
  }
  bills.push(doc);
  return doc;
}

bill({ patient: P.sunita, billDate: day(-6), billType: "OPD", visit: visitOf(P.sunita, -6), doctor: D.anita, department: "General Medicine", status: "Final", finalizedAt: at(-6, "10:40"),
  lines: [L.svc("REG"), L.fee(D.anita, "Consultation")], receipts: [["Payment", at(-6, "10:41"), [["Cash", "due"]]]] });
bill({ patient: P.arjun, billDate: day(-5), billType: "OPD", visit: visitOf(P.arjun, -5), doctor: D.rajesh, department: "Cardiology", status: "Final", finalizedAt: at(-5, "12:30"),
  lines: [L.svc("REG"), L.fee(D.rajesh, "Consultation"), L.svc("ECG"), L.svc("ECHO")], receipts: [["Payment", at(-5, "12:31"), [["UPI", 2000, "UPI 6611098812", "Reconciled"], ["Cash", "due"]]]] });
bill({ patient: P.kavita, billDate: day(-4), billType: "OPD", visit: visitOf(P.kavita, -4), doctor: D.priya, department: "Gynecology", status: "Final", finalizedAt: at(-4, "11:45"),
  lines: [L.svc("REG"), L.fee(D.priya, "Consultation"), L.svc("USG-ABD")], receipts: [["Payment", at(-4, "11:46"), [["Card", 1000, "Card xx4521 auth 228190", "Pending"]]]], notes: "Balance to be paid at the next visit" });
bill({ patient: P.sanjay, billDate: day(-2), billType: "OPD", visit: visitOf(P.sanjay, -2), doctor: D.sameer, department: "Orthopedics", ratePlan: "Corporate", status: "Final", finalizedAt: at(-2, "13:20"),
  payerType: "Corporate", payer: { corporate: corporates["Deccan Infotech Solutions Pvt. Ltd."]._id, payerName: "Deccan Infotech Solutions Pvt. Ltd.", coveragePct: 80, creditDays: 45, authNo: "DIT/EMP/20457" },
  lines: [L.svc("REG"), L.fee(D.sameer, "Consultation"), L.svc("XR-KNEE"), L.svc("PHYSIO", 2)], receipts: [["Payment", at(-2, "13:21"), [["Cash", "due"]]]] });
bill({ patient: P.aarav, billDate: day(-1), billType: "OPD", visit: visitOf(P.aarav, -1), doctor: D.vikram, department: "Pediatrics", status: "Final", finalizedAt: at(-1, "10:50"),
  lines: [L.svc("REG"), L.fee(D.vikram, "Consultation"), L.svc("NEB", 2)], receipts: [["Payment", at(-1, "10:51"), [["Card", "due", "Card xx9910 auth 552301", "Pending"]]]] });
const ambLines = chargeLines(trips.vijay.charges, { name: trips.vijay.tariffName, distanceKm: trips.vijay.distanceKm }).map((l) => ({ kind: "Ambulance", category: "Ambulance", name: l.name, detail: l.detail || undefined, unit: "Per service", rate: l.amount, gstRate: 0, qty: 1, sourceId: trips.vijay._id, sourceCode: trips.vijay.code }));
const vijayBill = bill({ patient: P.vijay, billDate: day(-1), billType: "Emergency", visit: visitOf(P.vijay, -1), doctor: D.anita, department: "Emergency", status: "Final", finalizedAt: at(-1, "12:10"),
  lines: [L.svc("EMR"), L.fee(D.anita, "Emergency"), L.svc("DRS", 2), L.svc("INJ", 2), L.svc("XR-CHEST"), L.manual("Radiology", "X-Ray Left Wrist AP & Lateral", 500), ...ambLines],
  receipts: [["Payment", at(-1, "12:12"), [["Cash", 3000], ["UPI", "due", "UPI 7790312245", "Reconciled"]]]] });
Object.assign(trips.vijay, { bill: vijayBill._id });
bill({ patient: P.neha, billDate: day(0), billType: "OPD", visit: visitOf(P.neha, 0), doctor: D.anita, department: "General Medicine", status: "Final", finalizedAt: at(0, "10:05"),
  lines: [L.svc("REG"), L.fee(D.anita, "Consultation")], receipts: [["Payment", at(0, "10:06"), [["Cash", "due"]]]] });

// IPD: Ramesh (self, provisional, advance + inventory issue charges)
const rameshBillId = new ObjectId();
bill({ _id: rameshBillId, patient: P.ramesh, billDate: day(-3), billType: "IPD", admission: admissions.ramesh, doctor: D.rajesh, department: "Cardiology", status: "Provisional",
  lines: [
    L.svc("REG"), L.svc("BED-GEN", 3), L.svc("NUR-GEN", 3), L.fee(D.rajesh, "IPD Visit", 3), L.svc("ECG", 3), L.svc("XR-CHEST"), L.svc("INJ", 4),
    ...rameshIssue.lines.map((l) => ({ kind: "Inventory", category: "Pharmacy / Consumables", name: l.itemName, detail: `Batch ${l.batchNo} · ${rameshIssue.code}`, unit: "Per service", rate: l.mrp, gstRate: 0, qty: l.qty, sourceId: rameshIssue._id, sourceLine: l._id, sourceCode: rameshIssue.code, addedAt: rameshIssue.createdAt })),
  ],
  receipts: [["Advance", at(-3, "11:40"), [["Cash", 10000]]], ["Advance", at(-1, "17:30"), [["UPI", 5000, "UPI 8812300456", "Pending"]]]] });
Object.assign(rameshIssue, { billingInvoice: rameshBillId });

// IPD: Mohammed (cashless insurance, provisional)
const mohammedBillId = new ObjectId();
bill({ _id: mohammedBillId, patient: P.mohammed, billDate: day(-2), billType: "IPD", admission: admissions.mohammed, doctor: D.anita, department: "General Medicine", status: "Provisional",
  payerType: "Insurance", payer: { insuranceProvider: INS.nhi._id, payerName: INS.nhi.name, tpaName: INS.mlt.name, policyNo: policies.mohammed.policyNumber, authNo: "MLT/PA/45120", payerLimit: 80000 },
  lines: [L.svc("REG"), L.svc("ICU-BED", 2), L.svc("NUR-ICU", 2), L.fee(D.anita, "IPD Visit", 4), L.svc("O2", 36), L.svc("NEB", 6), L.svc("INJ", 8), L.svc("XR-CHEST", 2), L.svc("ECG")],
  receipts: [["Advance", at(-2, "17:10"), [["Cash", 5000]]]], notes: "Cashless. Deposit taken for non-payable items." });

// IPD: Lata (insurance, settled, closed)
const lataBillId = new ObjectId();
const lataBill = bill({ _id: lataBillId, patient: P.lata, billDate: day(-9), billType: "IPD", admission: admissions.lata, doctor: D.sameer, department: "Orthopedics", ratePlan: "Insurance", status: "Final", finalizedAt: at(-5, "12:00"),
  payerType: "Insurance", payer: { insuranceProvider: INS.sgi._id, payerName: INS.sgi.name, tpaName: INS.cpt.name, policyNo: policies.lata.policyNumber, authNo: "CPT/AUTH/88213", payerLimit: 95000, creditDays: 30 },
  lines: [
    L.svc("REG"), L.svc("BED-SP", 4), L.svc("NUR-GEN", 4), L.svc("OT-MAJ"), L.fee(D.sameer, "Surgeon", 1, { rate: 30000, rateEditable: true }),
    L.manual("Surgery / OT", "Anaesthetist fee — Dr. M. Rao (visiting)", 8000), L.manual("Pharmacy / Consumables", "Bipolar hemiarthroplasty implant (with sticker)", 22000),
    L.svc("XR-HIP", 2), L.svc("PHYSIO", 3), L.fee(D.sameer, "IPD Visit", 4),
  ],
  receipts: [["Payment", at(-5, "12:20"), [["Cash", "due"]]]] });
lataBill.receipts.push({ _id: new ObjectId(), kind: "Settlement", amount: 90000, writeOff: 5000, toPatient: 0, reason: "Non-payable consumables and room rent difference deducted by TPA", approvedBy: BY, at: at(-1, "15:00"), by: admin._id, byName: BY,
  splits: [{ _id: new ObjectId(), mode: "Bank Transfer", amount: 90000, reference: "NEFT SGIN26101488213", recon: "Reconciled", reconAt: at(0, "10:00"), reconByName: BY }] });
recompute(lataBill);

// IPD: Priya (group insurance for the package, claim under review)
const priyaBillId = new ObjectId();
bill({ _id: priyaBillId, patient: P.priya, billDate: day(-6), billType: "IPD", admission: admissions.priya, doctor: D.priya, department: "Gynecology", ratePlan: "Insurance", status: "Final", finalizedAt: at(-4, "11:30"),
  payerType: "Insurance", payer: { insuranceProvider: INS.sgi._id, payerName: INS.sgi.name, tpaName: INS.cpt.name, policyNo: policies.priya.policyNumber, authNo: "CPT/AUTH/90457", payerLimit: 25000, creditDays: 30 },
  lines: [
    { kind: "Package", category: "Package", package: deliveryPackage._id, name: deliveryPackage.name, code: deliveryPackage.code, unit: "Per package", rate: 25000, gstRate: 0, qty: 1, detail: "Includes: Registration Fee, Maternity Ward Bed Charges, Nursing Charges (Ward)" },
    L.fee(D.vikram, "IPD Visit", 2, { detail: "Newborn examination" }), L.manual("Pharmacy / Consumables", "Labour room consumables (extra)", 1800), L.svc("MRC"),
  ],
  receipts: [["Payment", at(-4, "11:40"), [["Card", "due", "Card xx7781 auth 901244", "Reconciled"]]]] });

// Codes in date order, then receipts and cashier shifts.
bills.sort((a, b) => a.createdAt - b.createdAt);
for (const b of bills) b.code = await nextCode("BILL");
rameshIssue.billingInvoiceCode = bills.find((b) => b._id === rameshBillId).code;
trips.vijay.billCode = vijayBill.code;
const allReceipts = bills.flatMap((b) => b.receipts.map((r) => ({ r, b }))).sort((x, y) => x.r.at - y.r.at);
for (const { r } of allReceipts) r.code = await nextCode(r.kind === "Refund" ? "RFD" : r.kind === "Settlement" ? "STL" : "RCP");

const counterReceipts = allReceipts.filter(({ r }) => r.kind !== "Settlement");
// Only one open shift per user: if the super admin already has one, today's demo shift is closed too.
const alreadyOpen = await col("billing_shifts").findOne({ user: admin._id, status: "Open" });
const shiftDays = [...new Set(counterReceipts.map(({ r }) => Math.floor((r.at.getTime() + IST) / DAY) * DAY - today.getTime()))].map((ms) => Math.round(ms / DAY)).sort((a, b) => a - b);
const billingShifts = [];
for (const n of shiftDays) {
  const open = n === 0 && !alreadyOpen;
  const doc = { _id: new ObjectId(), code: await nextCode("SHF"), user: admin._id, userName: BY, counter: "Main Counter", openedAt: at(n, "08:00"), openingCash: 2000, status: open ? "Open" : "Closed", createdAt: at(n, "08:00") };
  const mine = counterReceipts.filter(({ r }) => r.at >= at(n, "00:00") && r.at < at(n + 1, "00:00"));
  for (const { r } of mine) Object.assign(r, { shift: doc._id, shiftCode: doc.code });
  if (!open) {
    const byMode = ["Cash", "Card", "UPI", "Bank Transfer", "Cheque"].map((mode) => {
      const of = (kinds) => r2(mine.filter(({ r }) => kinds.includes(r.kind)).flatMap(({ r }) => r.splits).filter((s) => s.mode === mode).reduce((s, x) => s + x.amount, 0));
      const collected = of(["Advance", "Payment", "Settlement"]);
      const refunded = of(["Refund"]);
      return { mode, collected, refunded, net: r2(collected - refunded) };
    });
    const cash = byMode.find((m) => m.mode === "Cash").net;
    Object.assign(doc, {
      closedAt: n === 0 ? new Date() : at(n, "20:30"), closedByName: BY, expectedCash: r2(doc.openingCash + cash), countedCash: r2(doc.openingCash + cash), difference: 0, handoverTo: "Night counter",
      summary: { byMode, collected: r2(byMode.reduce((s, m) => s + m.collected, 0)), refunded: r2(byMode.reduce((s, m) => s + m.refunded, 0)), net: r2(byMode.reduce((s, m) => s + m.net, 0)), receipts: mine.filter(({ r }) => r.kind !== "Refund").length, refunds: mine.filter(({ r }) => r.kind === "Refund").length },
    });
  }
  billingShifts.push(doc);
}

await recs("billing_doctor_payouts", "DPO", [
  { doctor: D.anita._id, periodFrom: day(-60), periodTo: day(-31), amount: 18500, paymentDate: day(-25), mode: "Bank Transfer", reference: "UTR HDFC26092200981", notes: "OPD & IPD visit share for last month" },
  { doctor: D.sameer._id, periodFrom: day(-30), periodTo: day(-5), amount: 21000, paymentDate: day(-3), mode: "Cheque", reference: "000457", notes: "Surgeon fee share — hemiarthroplasty" },
], (r) => r.paymentDate);

/* ======================= insurance pre-auths & claims ======================= */

const event = (when, action, note) => ({ at: when, action, byName: BY, note });
const preauthBase = (p, policy, insurer, tpa) => ({
  patient: p._id, patientName: p.fullName, patientCode: p.code, patientAge: ageYears(p.dateOfBirth), patientGender: p.gender, patientMobile: p.mobile,
  policy: policy._id, insurer: insurer._id, insurerName: insurer.name, tpa: tpa?._id, tpaName: tpa?.name, policyNumber: policy.policyNumber, memberId: policy.memberId, sumInsured: policy.sumInsured, copayPct: policy.copayPct,
});
const claimLata = { _id: new ObjectId(), code: await nextCode("CLM") };
const claimPriya = { _id: new ObjectId(), code: await nextCode("CLM") };
const preauths = [
  { ...preauthBase(P.lata, policies.lata, INS.sgi, INS.cpt), admission: admissions.lata._id, admissionCode: admissions.lata.code, admissionDate: day(-9), doctor: D.sameer._id, doctorName: D.sameer.fullName, department: "Orthopedics",
    diagnosis: "Fracture neck of femur (right)", icdCode: "S72.0", treatmentType: "Surgical", procedure: "Bipolar hemiarthroplasty (right hip)", expectedStayDays: 5, roomCategory: "Semi-Private", estimatedAmount: 110000, requestedAmount: 100000,
    approvedAmount: 95000, authNo: "CPT/AUTH/88213", submittedAt: at(-9, "12:00"), approvedAt: at(-9, "17:30"), decisionAt: at(-9, "17:30"), bill: lataBillId, claim: claimLata._id, claimCode: claimLata.code, status: "Claimed",
    events: [event(at(-9, "12:00"), "Submitted"), event(at(-9, "17:30"), "Approved", "₹95,000 sanctioned"), event(at(-5, "13:00"), "Claimed", claimLata.code)], createdAt: at(-9, "11:45") },
  { ...preauthBase(P.mohammed, policies.mohammed, INS.nhi, INS.mlt), admission: admissions.mohammed._id, admissionCode: admissions.mohammed.code, admissionDate: day(-2), doctor: D.anita._id, doctorName: D.anita.fullName, department: "General Medicine",
    diagnosis: "Community-acquired pneumonia with uncontrolled type 2 diabetes", icdCode: "J18.9", treatmentType: "ICU / Critical Care", expectedStayDays: 6, roomCategory: "ICU", estimatedAmount: 95000, requestedAmount: 90000,
    approvedAmount: 80000, authNo: "MLT/PA/45120", submittedAt: at(-2, "18:30"), approvedAt: at(-1, "11:15"), decisionAt: at(-1, "11:15"), bill: mohammedBillId, billSyncedAt: at(-1, "11:20"), status: "Approved",
    events: [event(at(-2, "18:30"), "Submitted"), event(at(-1, "11:15"), "Approved", "Initial approval ₹80,000; enhancement on request")], createdAt: at(-2, "18:10") },
  { ...preauthBase(P.priya, policies.priya, INS.sgi, INS.cpt), admission: admissions.priya._id, admissionCode: admissions.priya.code, admissionDate: day(-6), doctor: D.priya._id, doctorName: D.priya.fullName, department: "Gynecology",
    diagnosis: "Full-term pregnancy in labour", icdCode: "O80", treatmentType: "Maternity", procedure: "Normal vaginal delivery", expectedStayDays: 3, roomCategory: "General Ward", estimatedAmount: 28000, requestedAmount: 25000,
    approvedAmount: 25000, authNo: "CPT/AUTH/90457", submittedAt: at(-6, "08:00"), approvedAt: at(-6, "13:00"), decisionAt: at(-6, "13:00"), bill: priyaBillId, claim: claimPriya._id, claimCode: claimPriya.code, status: "Claimed",
    events: [event(at(-6, "08:00"), "Submitted"), event(at(-6, "13:00"), "Approved", "Maternity limit ₹25,000"), event(at(-3, "12:00"), "Claimed", claimPriya.code)], createdAt: at(-6, "07:45") },
  { ...preauthBase(P.kavita, policies.kavita, INS.nhi, null), plannedAdmissionDate: day(6), doctor: D.priya._id, doctorName: D.priya.fullName, department: "Gynecology",
    diagnosis: "Multiple uterine fibroids with menorrhagia", icdCode: "D25.9", treatmentType: "Surgical", procedure: "Total laparoscopic hysterectomy", expectedStayDays: 3, roomCategory: "Semi-Private", estimatedAmount: 120000, requestedAmount: 110000,
    submittedAt: at(-1, "11:00"), status: "Query Raised",
    queries: [{ _id: new ObjectId(), raisedAt: at(0, "10:30"), query: "Please share the USG report and the gynaecologist's notes on fibroid size and failed medical management.", raisedByName: "Navjeevan Health claims desk" }],
    events: [event(at(-1, "11:00"), "Submitted"), event(at(0, "10:30"), "Query raised", "USG report and clinical notes requested")], createdAt: at(-1, "10:40") },
];
// Raw inserts skip the schema defaults the app relies on (e.g. reports read enhancements.length).
for (const pa of preauths) Object.assign(pa, { approvedAmount: 0, queries: [], enhancements: [], ...pa, _id: new ObjectId(), code: await nextCode("PA"), createdBy: admin._id, createdByName: BY });

const CLAIM_DOCS = ["Claim form (signed)", "Pre-authorisation approval letter", "Final bill with break-up", "Discharge summary", "Investigation reports", "Patient ID & policy / e-card copy", "Doctor's prescription / case papers"];
const REQUIRED_DOCS = new Set(["Claim form (signed)", "Final bill with break-up", "Discharge summary", "Investigation reports", "Patient ID & policy / e-card copy"]);
const claimDocs = (names, missing, when) => names.map((name) => ({ name, required: REQUIRED_DOCS.has(name), ...(missing.includes(name) ? { received: false } : { received: true, receivedAt: when, byName: BY }) }));
const claims = [
  { ...claimLata, claimType: "Cashless", patient: P.lata._id, patientName: P.lata.fullName, patientCode: P.lata.code, provider: INS.sgi._id, providerName: INS.sgi.name, tpa: INS.cpt._id, tpaName: INS.cpt.name, policy: policies.lata._id, policyNumber: policies.lata.policyNumber, memberId: policies.lata.memberId,
    preauth: preauths[0]._id, preauthCode: preauths[0].code, authNo: "CPT/AUTH/88213", bill: lataBillId, billCode: lataBill.code, billDate: day(-9), admissionCode: admissions.lata.code, admissionDate: day(-9), dischargeDate: day(-5), diagnosis: "Fracture neck of femur (right) — bipolar hemiarthroplasty",
    claimAmount: 95000, approvedAmount: 95000, settledAmount: 90000, tdsAmount: 0, deductionAmount: 5000, patientAmount: 0, outstanding: 0, submittedDate: day(-5), dueDate: day(25), settledDate: day(-1),
    documents: claimDocs([...CLAIM_DOCS, "Implant stickers & invoice"], [], at(-5, "13:00")), settlements: [{ _id: new ObjectId(), at: at(-1, "15:00"), amount: 90000, tds: 0, deduction: 5000, toPatient: 0, mode: "Bank Transfer", utr: "NEFT SGIN26101488213", reason: "Non-payable consumables and room rent difference", receiptCode: lataBill.receipts.find((r) => r.kind === "Settlement").code, byName: BY }],
    status: "Settled", remarks: "Settled within 4 days", events: [event(at(-5, "13:00"), "Submitted"), event(at(-3, "16:00"), "Approved", "₹95,000"), event(at(-1, "15:00"), "Settled", "₹90,000 received, ₹5,000 deducted")], createdAt: at(-5, "13:00") },
  { ...claimPriya, claimType: "Cashless", patient: P.priya._id, patientName: P.priya.fullName, patientCode: P.priya.code, provider: INS.sgi._id, providerName: INS.sgi.name, tpa: INS.cpt._id, tpaName: INS.cpt.name, policy: policies.priya._id, policyNumber: policies.priya.policyNumber, memberId: policies.priya.memberId,
    preauth: preauths[2]._id, preauthCode: preauths[2].code, authNo: "CPT/AUTH/90457", bill: priyaBillId, billCode: bills.find((b) => b._id === priyaBillId).code, billDate: day(-6), admissionCode: admissions.priya.code, admissionDate: day(-6), dischargeDate: day(-4), diagnosis: "Normal vaginal delivery",
    claimAmount: 25000, approvedAmount: 25000, settledAmount: 0, tdsAmount: 0, deductionAmount: 0, patientAmount: 0, outstanding: 25000, submittedDate: day(-3), dueDate: day(27),
    documents: claimDocs(CLAIM_DOCS, ["Doctor's prescription / case papers"], at(-3, "12:00")),
    status: "Under Review", events: [event(at(-3, "12:00"), "Submitted"), event(at(-1, "10:00"), "Under review", "Acknowledged by CarePlus TPA")], createdAt: at(-3, "12:00") },
];
for (const c of claims) Object.assign(c, { queries: [], settlements: [], ...c, createdBy: admin._id, createdByName: BY });
for (const b of bills) {
  if (b._id === lataBillId) Object.assign(b, { claim: claimLata._id, claimCode: claimLata.code });
  if (b._id === priyaBillId) Object.assign(b, { claim: claimPriya._id, claimCode: claimPriya.code });
}

/* ======================= lab orders ======================= */

function rangeOf(p, gender, age) {
  if (age < (p.childAgeBelow ?? 12) && p.childLow != null) return [p.childLow, p.childHigh];
  if (gender === "Male" && p.maleLow != null) return [p.maleLow, p.maleHigh];
  if (gender === "Female" && p.femaleLow != null) return [p.femaleLow, p.femaleHigh];
  return [p.low, p.high];
}
function resultRow(p, gender, age, given) {
  const row = { parameter: p._id, name: p.name, unit: p.unit ?? undefined, resultType: p.resultType, options: p.options ?? undefined, normalValue: p.normalValue ?? undefined, decimals: p.decimals ?? undefined, sortOrder: p.sortOrder, criticalLow: p.criticalLow ?? undefined, criticalHigh: p.criticalHigh ?? undefined, flag: "" };
  if (p.resultType !== "Numeric") {
    row.value = String(given ?? p.normalValue);
    row.rangeText = p.normalValue ?? undefined;
    if (p.normalValue && row.value !== p.normalValue) row.flag = "A";
    return row;
  }
  const [low, high] = rangeOf(p, gender, age);
  const mid = low != null && high != null ? (low + high) / 2 : high != null ? high * 0.75 : low * 1.2;
  const v = Number((given ?? mid).toFixed(p.decimals ?? 0));
  Object.assign(row, { value: String(v), numeric: v, low: low ?? undefined, high: high ?? undefined, rangeText: p.rangeText ?? (low != null && high != null ? `${low} – ${high}` : high != null ? `< ${high}` : `> ${low}`) });
  if (p.criticalLow != null && v < p.criticalLow) row.flag = "LL";
  else if (p.criticalHigh != null && v > p.criticalHigh) row.flag = "HH";
  else if (low != null && v < low) row.flag = "L";
  else if (high != null && v > high) row.flag = "H";
  return row;
}

const labOrders = [];
const ITEM_STAGE = { Registered: ["Ordered", "Pending"], Collected: ["Sample Collected", "Collected"], Received: ["Sample Received", "Received"], Processing: ["In Process", "Received"], "Sent Out": ["Sent Out", "Received"], Reported: ["Approved", "Received"] };
async function labOrder(o) {
  const p = o.patient;
  const when = o.when;
  const age = ageYears(p.dateOfBirth, when);
  const items = [];
  const addItem = (t, price, profile) => {
    const cat = Object.values(labCats).find((c) => String(c._id) === String(t.category));
    items.push({
      _id: new ObjectId(), test: t._id, testName: t.testName, testCode: t.testCode, category: t.category, categoryName: cat.name, categoryOrder: cat.sortOrder, method: t.method, sampleType: t.sampleType, container: t.container,
      reportType: t.reportType, profile: profile?._id, profileName: profile?.name, price: r2(price), results: [], abnormal: false, critical: false, status: "Ordered",
      ...(t.outsourceLab ? { outsourceLab: outLab._id, outsourceLabName: outLab.name } : {}),
    });
  };
  for (const name of o.profiles ?? []) {
    const pr = profiles[name];
    const members = pr.tests.map((id) => Object.values(tests).find((t) => String(t._id) === String(id)));
    const total = members.reduce((s, t) => s + t.price, 0);
    let allocated = 0;
    members.forEach((t, i) => {
      const share = i === members.length - 1 ? r2(pr.price - allocated) : r2((pr.price * t.price) / total);
      allocated = r2(allocated + share);
      addItem(t, share, pr);
    });
  }
  for (const code of o.tests ?? []) addItem(tests[code], tests[code].price);

  const samples = [];
  const byKey = new Map();
  for (const it of items) {
    const key = `${it.sampleType}|${it.container}`;
    if (!byKey.has(key)) {
      // Accession numbers are given once all orders exist, in date order.
      const s = { _id: new ObjectId(), sampleType: it.sampleType, container: it.container, status: "Pending" };
      byKey.set(key, s);
      samples.push(s);
    }
    it.$sample = byKey.get(key);
  }
  const t0 = when.getTime();
  const mins = (m) => new Date(t0 + m * 60_000);
  for (const it of items) {
    const stage = o.stages?.[it.testCode] ?? o.stage;
    const [status, sampleStatus] = ITEM_STAGE[stage];
    it.status = status;
    const s = byKey.get(`${it.sampleType}|${it.container}`);
    const rank = ["Pending", "Collected", "Received"];
    if (rank.indexOf(sampleStatus) > rank.indexOf(s.status)) s.status = sampleStatus;
    if (["In Process", "Sent Out", "Approved"].includes(status)) Object.assign(it, { processingAt: mins(60), processingByName: "Rahul Pawar" });
    if (status === "Sent Out") Object.assign(it, { sentOutAt: mins(70), outsourceRef: `PRL/${String(between(10000, 99999))}` });
    if (status === "Approved") {
      if (it.reportType === "Descriptive") {
        it.reportText = o.reports?.[it.testCode] ?? "Within normal limits.";
      } else {
        it.results = params[it.testCode].map((prm) => resultRow(prm, p.gender, age, o.results?.[it.testCode]?.[prm.name]));
      }
      it.abnormal = it.results.some((r) => r.flag);
      it.critical = it.results.some((r) => r.flag === "LL" || r.flag === "HH");
      Object.assign(it, {
        remarks: o.remarks?.[it.testCode], enteredAt: mins(180), enteredBy: admin._id, enteredByName: "Snehal Kadam", verifiedAt: mins(200), verifiedBy: admin._id, verifiedByName: "Snehal Kadam",
        approvedAt: mins(240), approvedBy: admin._id, approvedByName: D.neha.fullName, pathologist: D.neha._id, pathologistName: D.neha.fullName, pathologistQualification: "MD (Pathology)", pathologistRegNo: D.neha.registrationNo,
      });
    }
  }
  for (const s of samples) {
    if (s.status !== "Pending") Object.assign(s, { collectedAt: mins(10), collectedByName: o.source === "IPD" ? "Pooja Bhosale" : "Rahul Pawar" });
    if (s.status === "Received") Object.assign(s, { receivedAt: mins(30), receivedByName: "Snehal Kadam" });
  }
  const gross = r2(items.reduce((s, i) => s + i.price, 0));
  const discount = o.discount ?? 0;
  const net = r2(gross - discount);
  const payments = (o.payments ?? []).map(([mode, amount, reference]) => ({ kind: "Payment", amount: amount === "all" ? net : amount, mode, reference, at: when, byName: BY }));
  const paid = r2(payments.reduce((s, x) => s + x.amount, 0));
  const approved = items.filter((i) => i.status === "Approved").length;
  const status = approved === items.length ? "Reported" : approved > 0 ? "Partially Reported" : items.some((i) => ["In Process", "Sent Out", "Result Entered", "Verified"].includes(i.status)) ? "In Process" : items.every((i) => i.status !== "Ordered") ? "Sample Collected" : "Registered";
  const doc = {
    _id: new ObjectId(), orderDate: when, patient: p._id, patientName: p.fullName, patientCode: p.code, patientGender: p.gender, patientAge: age, patientDob: p.dateOfBirth, patientMobile: p.mobile,
    source: o.source, ...(o.visit ? { visit: o.visit._id, visitCode: o.visit.code } : {}), ...(o.admission ? { admission: o.admission._id, admissionCode: o.admission.code, wardBed: `${o.admission.ward} / ${o.admission.bedNumber}` } : {}),
    doctor: o.doctor._id, doctorName: o.doctor.fullName, doctorPhone: o.doctor.phone, doctorEmail: o.doctor.email, priority: o.priority ?? "Routine", ratePlan: "General", clinicalNotes: o.notes,
    items, samples, grossAmount: gross, discount, netAmount: net, paidAmount: paid, payments, paymentStatus: paid > net ? "Refund Due" : paid >= net ? "Paid" : paid > 0 ? "Partially Paid" : "Unpaid",
    status, reportedAt: status === "Reported" ? mins(240) : undefined, shares: status === "Reported" && o.shared ? [{ to: "Patient", channel: "WhatsApp", recipient: p.mobile, at: mins(250), byName: BY }] : [],
    createdBy: admin._id, createdByName: BY, createdAt: when,
  };
  labOrders.push(doc);
  return doc;
}
await labOrder({ patient: P.sunita, doctor: D.anita, source: "OPD", visit: visitOf(P.sunita, -6), when: at(-6, "10:50"), profiles: ["Fever Profile"], stage: "Reported", payments: [["Cash", "all"]], shared: true,
  results: { CBC: { Haemoglobin: 11.6, "Total Leucocyte Count": 3600, "Platelet Count": 1.1, Lymphocytes: 48 }, NS1: { "Dengue NS1 Antigen": "Positive" } }, notes: "Fever 3 days, myalgia" });
await labOrder({ patient: P.arjun, doctor: D.rajesh, source: "OPD", visit: visitOf(P.arjun, -5), when: at(-5, "11:30"), tests: ["LIPID", "FBS", "TSH"], stage: "Reported", payments: [["UPI", "all", "UPI 6611098855"]], shared: true,
  results: { LIPID: { "Total Cholesterol": 236, Triglycerides: 182, "HDL Cholesterol": 36, "LDL Cholesterol": 152 }, FBS: { "Glucose (Fasting)": 104 } } });
await labOrder({ patient: P.lata, doctor: D.sameer, source: "IPD", admission: admissions.lata, when: at(-9, "10:00"), tests: ["CBC", "KFT", "PS"], stage: "Reported", priority: "Urgent", payments: [["Cash", "all"]],
  results: { CBC: { Haemoglobin: 10.2 }, KFT: { "Serum Creatinine": 1.2 } }, reports: { PS: "RBCs: normocytic normochromic with mild anisocytosis. WBCs: normal in number and morphology. Platelets: adequate. No haemoparasites seen." }, notes: "Pre-operative work-up" });
await labOrder({ patient: P.ramesh, doctor: D.rajesh, source: "IPD", admission: admissions.ramesh, when: at(-3, "11:40"), tests: ["TROP", "CBC", "KFT", "LIPID"], stages: { TROP: "Reported", CBC: "Reported", KFT: "Processing", LIPID: "Processing" }, priority: "STAT",
  results: { TROP: { "Troponin I": 0.09 }, CBC: { "Total Leucocyte Count": 9800 } }, remarks: { TROP: "Value informed to Dr. Rajesh Kulkarni at 15:45" }, notes: "Chest pain, rule out MI" });
await labOrder({ patient: P.mohammed, doctor: D.anita, source: "IPD", admission: admissions.mohammed, when: at(-1, "07:30"), tests: ["CBC", "HBA1C", "SPCS"], stages: { CBC: "Reported", HBA1C: "Reported", SPCS: "Sent Out" }, priority: "Urgent",
  results: { CBC: { "Total Leucocyte Count": 16800, Neutrophils: 86, Lymphocytes: 10 }, HBA1C: { HbA1c: 9.4 } }, notes: "Pneumonia, uncontrolled DM" });
await labOrder({ patient: P.kavita, doctor: D.priya, source: "OPD", visit: visitOf(P.kavita, -4), when: at(-4, "12:00"), tests: ["CBC", "TSH", "URINE"], stage: "Reported", payments: [["Card", "all", "Card xx4521 auth 228201"]],
  results: { CBC: { Haemoglobin: 9.1 }, URINE: { "Pus Cells": 3 } } });
await labOrder({ patient: P.neha, doctor: D.anita, source: "OPD", visit: visitOf(P.neha, 0), when: at(0, "10:20"), tests: ["CBC", "URINE"], profiles: ["Diabetes Profile"], stage: "Collected", payments: [["Cash", 500]] });
await labOrder({ patient: P.fatima, doctor: D.anita, source: "Walk-in", when: at(0, "09:40"), profiles: ["Master Health Check-up"], stage: "Registered", discount: 250, notes: "Corporate wellness voucher — 10% off" });
await labOrder({ patient: P.aarav, doctor: D.vikram, source: "OPD", visit: visitOf(P.aarav, -1), when: at(-1, "11:10"), tests: ["CBC"], stage: "Reported", payments: [["UPI", "all", "UPI 4410098812"]],
  results: { CBC: { Haemoglobin: 12.1, "Total Leucocyte Count": 12400, Neutrophils: 38, Lymphocytes: 52 } } });
labOrders.sort((a, b) => a.orderDate - b.orderDate);
for (const o of labOrders) {
  o.code = await nextCode("LAB");
  for (const s of o.samples) s.accessionNo = await nextAccession();
  for (const it of o.items) {
    it.sampleNo = it.$sample.accessionNo;
    delete it.$sample;
  }
}

/* ======================= lab reagents ======================= */

const reagents = [];
const REAGENT_SIGN = { "Stock In": 1, Consumed: -1, "Wasted / Expired": -1, "Adjustment (+)": 1, "Adjustment (-)": -1 };
const reagentRows = [
  ["CBC Diluent & Lyse Reagent Pack", "Reagent", "Sysmex", "DL-26044", 10, "kit", 2, "Room temperature", SUP.ms, [["Stock In", 6, -30, "INV MS/2627/3310"], ["Consumed", 2, -15, "Weekly use"], ["Consumed", 2, -3, "Weekly use"]]],
  ["Glucose GOD-POD Kit (5 x 100 ml)", "Reagent", "Erba", "GL-77812", 8, "kit", 3, "2–8 °C", SUP.ms, [["Stock In", 4, -25, "INV MS/2627/3402"], ["Consumed", 2, -10, "Biochemistry runs"]]],
  ["EDTA Vacutainer 2 ml (Lavender)", "Consumable", "BD", "ED-2609", 14, "pcs", 200, "Room temperature", SUP.ll, [["Stock In", 500, -28, "INV LS/1182"], ["Consumed", 260, -7, "Sample collection"], ["Wasted / Expired", 10, -6, "Cracked tubes"]]],
  ["Serum Separator Tube 5 ml (Gold)", "Consumable", "BD", "SS-2611", 16, "pcs", 150, "Room temperature", SUP.ll, [["Stock In", 400, -28, "INV LS/1182"], ["Consumed", 180, -7, "Sample collection"]]],
  ["Leishman Stain 500 ml", "Stain", "Himedia", "LS-25881", 6, "bottle", 1, "Room temperature", SUP.ms, [["Stock In", 2, -40, "INV MS/2627/2981"], ["Consumed", 1, -12, "Smears"]]],
  ["Hematology Control (3 levels)", "Control", "Sysmex", "HC-N-4410", 2, "set", 1, "2–8 °C", SUP.ms, [["Stock In", 2, -20, "INV MS/2627/3388"], ["Consumed", 1, -2, "Daily QC"]]],
];
for (const [name, itemType, manufacturer, lotNo, months, unit, reorderLevel, storage, supplier, moves] of reagentRows) {
  const quantity = moves.reduce((s, [t, q]) => s + REAGENT_SIGN[t] * q, 0);
  const status = quantity <= 0 ? "Out of Stock" : quantity <= reorderLevel ? "Low Stock" : "In Stock";
  const r = await rec("laboratory_reagents", "RGT", { name, itemType, manufacturer, lotNo, expiryDate: expiryIn(months), unit, quantity, reorderLevel, storage, supplier: supplier._id, status }, day(-45));
  reagents.push(r);
  for (const [txnType, q, n, reference] of moves) await rec("laboratory_reagent_stock", "RST", { reagent: r._id, txnType, quantity: q, txnDate: day(n), reference, notes: null }, at(n, "16:00"));
}

/* ======================= blood bank ======================= */

const donors = byName(
  await recs("blood_bank_donors", "DNR", [
    { fullName: "Rohan Kale", bloodGroup: "O+", gender: "Male", dateOfBirth: date("1992-02-14"), phone: "9881001001", weightKg: 72, status: "Eligible", address: "Kothrud, Pune" },
    { fullName: "Sachin Gore", bloodGroup: "B+", gender: "Male", dateOfBirth: date("1988-06-09"), phone: "9881001002", weightKg: 80, status: "Eligible", address: "Warje, Pune" },
    { fullName: "Ashwini Patil", bloodGroup: "A+", gender: "Female", dateOfBirth: date("1995-11-20"), phone: "9881001003", weightKg: 58, status: "Eligible", address: "Aundh, Pune" },
    { fullName: "Imran Sayyed", bloodGroup: "AB+", gender: "Male", dateOfBirth: date("1990-03-03"), phone: "9881001004", weightKg: 76, status: "Eligible", address: "Kondhwa, Pune" },
    { fullName: "Prakash Naik", bloodGroup: "O-", gender: "Male", dateOfBirth: date("1985-08-27"), phone: "9881001005", weightKg: 69, status: "Eligible", address: "Bibwewadi, Pune" },
    { fullName: "Swati Mane", bloodGroup: "B-", gender: "Female", dateOfBirth: date("1993-01-17"), phone: "9881001006", weightKg: 61, status: "Eligible", address: "Hadapsar, Pune" },
    { fullName: "Nitin Kamble", bloodGroup: "A-", gender: "Male", dateOfBirth: date("1987-12-01"), phone: "9881001007", weightKg: 74, status: "Eligible", address: "Yerawada, Pune" },
    { fullName: "Farhan Ali", bloodGroup: "O+", gender: "Male", dateOfBirth: date("1998-07-07"), phone: "9881001008", weightKg: 64, status: "Temporarily Deferred", address: "Camp, Pune" },
  ], day(-60))
);
const LIFE = { "Whole Blood": 35, "Packed RBC": 42, Platelets: 5, "Fresh Frozen Plasma": 365, Cryoprecipitate: 365 };
const VOL = { "Whole Blood": 350, "Packed RBC": 250, Platelets: 60, "Fresh Frozen Plasma": 200, Cryoprecipitate: 20 };
const bagRows = [
  ["Prakash Naik", "Packed RBC", -18, "Passed"], ["Prakash Naik", "Fresh Frozen Plasma", -18, "Passed"], ["Prakash Naik", "Packed RBC", -6, "Passed"],
  ["Swati Mane", "Packed RBC", -20, "Passed"], ["Rohan Kale", "Whole Blood", -10, "Passed"], ["Rohan Kale", "Platelets", -2, "Passed"],
  ["Sachin Gore", "Fresh Frozen Plasma", -14, "Passed"], ["Sachin Gore", "Packed RBC", -14, "Passed"], ["Ashwini Patil", "Whole Blood", -4, "Passed"],
  ["Imran Sayyed", "Platelets", -10, "Passed"], ["Nitin Kamble", "Packed RBC", -1, "Pending"], ["Ashwini Patil", "Platelets", -1, "Pending"],
];
const bags = [];
for (const [i, [donorName, component, n, screening]] of bagRows.entries()) {
  const dn = donors[donorName];
  const expiryDate = day(n + LIFE[component]);
  bags.push(await rec("blood_bank_units", "BAG", {
    bloodGroup: dn.bloodGroup, component, donor: dn._id, volumeMl: VOL[component], collectionDate: day(n), expiryDate, screening,
    status: expiryDate < today ? "Expired" : "Available", storageLocation: component === "Platelets" ? "Platelet agitator" : component.includes("Plasma") ? "Deep freezer -30 °C" : `Blood bank fridge ${1 + (i % 2)}, rack ${"ABC"[i % 3]}`,
  }, day(n)));
}
for (const dn of Object.values(donors)) {
  const last = bags.filter((b) => String(b.donor) === String(dn._id)).map((b) => b.collectionDate).sort((a, b) => b - a)[0];
  if (last) await col("blood_bank_donors").updateOne({ _id: dn._id }, { $set: { lastDonationDate: last } });
}
const requestLata = await rec("blood_bank_requests", "BRQ", { patient: P.lata._id, bloodGroup: "B-", component: "Packed RBC", unitsRequired: 1, requestedBy: D.sameer._id, requiredBy: day(-8), priority: "Urgent", status: "Issued", remarks: "Pre-operative Hb 10.2; hemiarthroplasty" }, at(-9, "12:30"));
const requestMohammed = await rec("blood_bank_requests", "BRQ", { patient: P.mohammed._id, bloodGroup: "O-", component: "Packed RBC", unitsRequired: 2, requestedBy: D.anita._id, requiredBy: day(1), priority: "Urgent", status: "Partially Issued", remarks: "Anaemia with sepsis" }, at(-1, "09:00"));
await rec("blood_bank_requests", "BRQ", { patient: P.ramesh._id, bloodGroup: "B+", component: "Fresh Frozen Plasma", unitsRequired: 1, requestedBy: D.rajesh._id, requiredBy: day(2), priority: "Routine", status: "Pending", remarks: "Keep reserved in case of procedure" }, at(0, "09:30"));
const issueBag = async (request, bag, when, issuedTo) => {
  await rec("blood_bank_issues", "BIS", { request: request._id, unit: bag._id, issuedAt: when, crossMatch: "Compatible", issuedTo, notes: null }, when);
  await col("blood_bank_units").updateOne({ _id: bag._id }, { $set: { status: "Issued" } });
};
await issueBag(requestLata, bags[3], at(-8, "08:30"), "OT Sister — OT Complex");
await issueBag(requestMohammed, bags[0], at(-1, "13:00"), "Pooja Bhosale (ICU)");

/* ======================= marketing ======================= */

const referrers = byName(
  await recs("marketing_referrers", "RFP", [
    { name: "Dr. Kulkarni Family Clinic", partnerType: "Doctor / GP", contactPerson: "Dr. Mahesh Kulkarni", mobile: "9822077001", email: "drkulkarni.clinic@example.com", speciality: "General practice", area: "Karve Nagar", address: "Near Karve Nagar bus stop, Pune", tieUp: "Empanelled", agreementValidUntil: day(200), relationshipManager: S["Shalini Rao"]._id, status: "Active", notes: "Refers 8–10 patients a month, mostly medicine and paediatrics" },
    { name: "Lifecare Diagnostic Centre", partnerType: "Diagnostic centre", contactPerson: "Mr. Ajit Bapat", mobile: "9822077002", area: "Kothrud", address: "Paud Road, Kothrud, Pune", tieUp: "MoU", agreementValidUntil: day(120), relationshipManager: S["Shalini Rao"]._id, status: "Active" },
    { name: "Green Valley Housing Society", partnerType: "Housing society", contactPerson: "Mr. Ramesh Iyer (Secretary)", mobile: "9822077003", area: "Wakad", address: "Green Valley, Wakad, Pune", tieUp: "None", relationshipManager: S["Shalini Rao"]._id, status: "Active", notes: "520 flats; hosts our health camps" },
    { name: "Deccan Infotech Solutions Pvt. Ltd.", partnerType: "Corporate", contactPerson: "Ms. Swati Bendre (HR)", mobile: "9822077004", email: "hr.benefits@deccaninfotech.example", area: "Hinjewadi", tieUp: "Corporate agreement", agreementValidUntil: day(240), relationshipManager: S["Shalini Rao"]._id, status: "Active" },
  ], day(-120)),
  "name"
);
const campaigns = byName(
  await recs("marketing_campaigns", "CMP", [
    { name: "Monsoon Fever Awareness", channel: "WhatsApp", focus: "General Medicine", startDate: day(-45), endDate: day(-15), budget: 15000, spent: 12500, targetLeads: 40, owner: S["Shalini Rao"]._id, status: "Completed", notes: "Dengue and malaria awareness messages to society groups" },
    { name: "Heart Health Month", channel: "Facebook / Instagram", focus: "Cardiology", startDate: day(-20), endDate: day(10), budget: 50000, spent: 28000, targetLeads: 60, owner: S["Shalini Rao"]._id, status: "Active", notes: "Free ECG with cardiology consultation" },
    { name: "Free Diabetes Screening Week", channel: "Health camp", focus: "General Medicine", startDate: day(5), endDate: day(12), budget: 20000, spent: 0, targetLeads: 50, owner: S["Shalini Rao"]._id, status: "Planned" },
  ], day(-50)),
  "name"
);
await recs("marketing_camps", "CAMP", [
  { name: "Diabetes & BP Camp — Green Valley", campType: "Diabetes", campDate: day(-8), venue: "Green Valley Society clubhouse, Wakad", campaign: campaigns["Monsoon Fever Awareness"]._id, partner: referrers["Green Valley Housing Society"]._id, doctors: [D.anita._id], expectedFootfall: 150, screened: 142, leadsGenerated: 18, cost: 9000, status: "Completed", notes: "32 people with high sugar referred for HbA1c" },
  { name: "Women's Health Check-up Camp", campType: "Women's health", campDate: day(12), venue: "Deccan Infotech campus, Hinjewadi", partner: referrers["Deccan Infotech Solutions Pvt. Ltd."]._id, doctors: [D.priya._id], expectedFootfall: 120, cost: 12000, status: "Planned" },
], day(-15));
const leadRows = [
  ["Arjun Mehta", "9890123456", "Male", 35, "Hadapsar", -8, "Cardiology", "Chest discomfort, saw the Heart Health Month ad", "Facebook / Instagram", "Heart Health Month", null, "Converted", -5, P.arjun],
  ["Sanjay Verma", "9970667788", "Male", 47, "Wakad", -6, "Orthopedics", "Knee pain — corporate cashless", "Corporate tie-up", null, "Deccan Infotech Solutions Pvt. Ltd.", "Converted", null, P.sanjay],
  ["Mrs. Asha Kulkarni", "9765010101", "Female", 58, "Karve Nagar", -3, "Health check-up", "Full body check-up for herself and husband", "Referral partner", null, "Dr. Kulkarni Family Clinic", "Appointment booked", 2, null],
  ["Mr. Rohit Sinha", "9765010102", "Male", 41, "Baner", -2, "Cardiology", "Wants cost of angiography", "Facebook / Instagram", "Heart Health Month", null, "Follow-up", 1, null],
  ["Ms. Pallavi Deo", "9765010103", "Female", 29, "Wakad", -8, "Gynecology", "Pregnancy care packages", "Health camp", "Monsoon Fever Awareness", null, "Contacted", 3, null],
  ["Mr. Ganesh Lokhande", "9765010104", "Male", 63, "Wakad", -8, "General Medicine", "High sugar found at the camp", "Health camp", "Monsoon Fever Awareness", null, "New", 0, null],
  ["Mr. Faisal Qureshi", "9765010105", "Male", 52, "Kondhwa", -12, "Surgery / procedure", "Hernia surgery cost", "Google", null, null, "Lost", null, null],
  ["Mrs. Meena Shah", "9765010106", "Female", 66, "Kothrud", -10, "Orthopedics", "Knee replacement enquiry", "Phone call", null, null, "Not interested", null, null],
  ["Mr. Arvind Rao", "9765010107", "Male", 38, "Aundh", 0, "Diagnostics", "Home sample collection for thyroid test", "Website", null, null, "New", 1, null],
];
const leads = [];
for (const [fullName, mobile, gender, age, area, n, interestedIn, requirement, source, campaign, referrer, status, next, patient] of leadRows) {
  leads.push(await rec("marketing_leads", "LEAD", {
    fullName, mobile, email: null, gender, age, area, enquiryDate: day(n), interestedIn, requirement, source, campaign: campaign ? campaigns[campaign]._id : null, referrer: referrer ? referrers[referrer]._id : null,
    status, assignedTo: S[n % 2 ? "Meera Iyer" : "Shalini Rao"]._id, nextFollowUp: next == null ? null : day(next), patient: patient?._id ?? null,
    lostReason: status === "Lost" ? "Chose a hospital closer to home" : status === "Not interested" ? "Wants to try physiotherapy first" : null, notes: null,
  }, at(n, "12:00")));
}
const leadBy = byName(leads);
await recs("marketing_followups", null, [
  { lead: leadBy["Arjun Mehta"]._id, followedUpAt: at(-7, "11:00"), mode: "Call", outcome: "Appointment booked", nextFollowUp: day(-5), byStaff: S["Shalini Rao"]._id, notes: "Booked with Dr. Rajesh Kulkarni" },
  { lead: leadBy["Mrs. Asha Kulkarni"]._id, followedUpAt: at(-2, "16:30"), mode: "WhatsApp", outcome: "Appointment booked", nextFollowUp: day(2), byStaff: S["Meera Iyer"]._id, notes: "Executive Health Check-up for two, Saturday morning" },
  { lead: leadBy["Mr. Rohit Sinha"]._id, followedUpAt: at(-1, "12:15"), mode: "Call", outcome: "Call back later", nextFollowUp: day(1), byStaff: S["Shalini Rao"]._id, notes: "Shared approximate package cost; discussing with family" },
  { lead: leadBy["Ms. Pallavi Deo"]._id, followedUpAt: at(-6, "17:00"), mode: "Call", outcome: "Interested", nextFollowUp: day(3), byStaff: S["Shalini Rao"]._id, notes: "Sent maternity package brochure" },
  { lead: leadBy["Mr. Faisal Qureshi"]._id, followedUpAt: at(-9, "11:30"), mode: "Call", outcome: "Not interested", nextFollowUp: null, byStaff: S["Meera Iyer"]._id, notes: "Already booked elsewhere" },
  { lead: leadBy["Mrs. Meena Shah"]._id, followedUpAt: at(-8, "15:00"), mode: "Visit", outcome: "Not interested", nextFollowUp: null, byStaff: S["Shalini Rao"]._id, notes: "Will review after 3 months of physiotherapy" },
], (r) => r.followedUpAt);
await recs("marketing_visits", null, [
  { referrer: referrers["Dr. Kulkarni Family Clinic"]._id, visitDate: day(-1), staff: S["Shalini Rao"]._id, purpose: "Relationship visit", outcome: "Thanked for referrals; shared the new cardiology OPD timings", nextVisit: day(30) },
  { referrer: referrers["Lifecare Diagnostic Centre"]._id, visitDate: day(-1), staff: S["Shalini Rao"]._id, purpose: "New service briefing", outcome: "Briefed about the 24×7 ICU and ambulance numbers", nextVisit: day(45) },
  { referrer: referrers["Green Valley Housing Society"]._id, visitDate: day(-15), staff: S["Shalini Rao"]._id, purpose: "Camp planning", outcome: "Fixed the diabetes camp date and clubhouse booking", nextVisit: null },
], (r) => r.visitDate);
await recs("marketing_feedback", "FB", [
  { patient: P.sunita._id, name: "Sunita Kulkarni", mobile: P.sunita.mobile, receivedOn: day(-5), channel: "OPD form", department: "General Medicine", rating: 5, recommend: 9, aboutArea: "Doctor,Front desk", comments: "Dr. Sharma explained everything patiently.", status: "Closed", actionTaken: null },
  { patient: P.priya._id, name: "Priya Nair", mobile: P.priya.mobile, receivedOn: day(-4), channel: "Ward / discharge form", department: "Gynecology", rating: 5, recommend: 10, aboutArea: "Doctor,Nursing,Cleanliness", comments: "Wonderful labour room staff. Thank you Sister Rekha!", status: "Acknowledged", actionTaken: null },
  { patient: P.lata._id, name: "Sachin Gaikwad (son of Lata Gaikwad)", mobile: "9763556678", receivedOn: day(-5), channel: "Phone", department: "Front Office", rating: 2, recommend: 5, aboutArea: "Billing,Waiting time", comments: "Discharge billing took more than 4 hours.", status: "Resolved", actionTaken: "TPA desk now starts the final bill at 9 am on the discharge day; apologised to the family." },
  { name: "Anonymous", receivedOn: day(-3), channel: "Google review", department: "Front Office", rating: 3, recommend: 6, aboutArea: "Waiting time,Facilities", comments: "Good doctors but parking is a problem.", status: "New", actionTaken: null },
  { patient: P.aarav._id, name: "Rohit Deshpande", mobile: P.aarav.mobile, receivedOn: day(-1), channel: "WhatsApp", department: "Pediatrics", rating: 4, recommend: 8, aboutArea: "Doctor,Nursing", comments: "Child was comfortable during nebulisation.", status: "New", actionTaken: null },
  { patient: P.vijay._id, name: "Vijay Pawar", mobile: P.vijay.mobile, receivedOn: day(0), channel: "Phone", department: "Emergency", rating: 5, recommend: 10, aboutArea: "Doctor,Nursing", comments: "Ambulance reached within 15 minutes of the call.", status: "New", actionTaken: null },
], (r) => r.receivedOn);

/* ======================= accounts: expense ledgers & manual vouchers ======================= */

const expenseGroup = await col("accounts_groups").findOne({ name: "Indirect Expenses" });
const cash = await col("accounts_ledgers").findOne({ systemKey: "cash" });
const bank = await col("accounts_ledgers").findOne({ systemKey: "bank" });
if (expenseGroup && cash && bank) {
  const ledgers = {};
  for (const name of ["Electricity Charges", "Rent", "Telephone & Internet", "Repairs & Maintenance"]) {
    ledgers[name] = (await col("accounts_ledgers").findOne({ name })) ?? (await rec("accounts_ledgers", null, { name, group: expenseGroup._id, groupName: expenseGroup.name, openingBalance: 0, openingType: "Dr", status: "Active" }, day(-30)));
  }
  const PREFIX = { Payment: "PV", Contra: "CV" };
  const fy = (d) => (d.getUTCMonth() >= 3 ? `${d.getUTCFullYear()}-${String((d.getUTCFullYear() + 1) % 100).padStart(2, "0")}` : `${d.getUTCFullYear() - 1}-${String(d.getUTCFullYear() % 100).padStart(2, "0")}`);
  const vouchers = [
    ["Payment", -20, ledgers.Rent, bank, 75000, "Rent for the hospital premises — this month", "NEFT HDFC26100412"],
    ["Payment", -8, ledgers["Electricity Charges"], bank, 18450, "Electricity bill — last month", "MSEDCL consumer 170010245566"],
    ["Payment", -6, ledgers["Telephone & Internet"], bank, 2360, "Leased line and landline rental", "Inv TL/8812"],
    ["Payment", -4, ledgers["Repairs & Maintenance"], cash, 1850, "Plumbing repair in Ward 3 washrooms", "Cash memo 221"],
    ["Contra", -2, bank, cash, 25000, "Cash deposited in bank", "Deposit slip 004512"],
  ];
  for (const [type, n, dr, cr, amount, narration, refNo] of vouchers) {
    const d = day(n);
    const code = `${PREFIX[type]}/${fy(d)}/${String(await counter(`VCH-${PREFIX[type]}-${fy(d)}`)).padStart(5, "0")}`;
    await save("accounts_vouchers", {
      code, type, date: d, entries: [{ ledger: dr._id, ledgerName: dr.name, dr: amount, cr: 0 }, { ledger: cr._id, ledgerName: cr.name, dr: 0, cr: amount }], amount, narration, refNo, auto: false, status: "Active",
      createdBy: admin._id, createdByName: BY, createdAt: at(n, "16:00"),
    });
  }
} else {
  console.log("skip    manual vouchers (open Accounts once so its chart of accounts is created, then run again)");
}

/* ======================= save the workflow documents ======================= */

const itemDocs = Object.values(items).map(({ $unit, $purchaseUnit, ...it }) => (void $unit, void $purchaseUnit, it));
await save("inventory_items", itemDocs);
await save("inventory_batches", batches);
await save("inventory_docs", stockDocs);
await save("inventory_ledger", ledger, { stamps: false });
await save("pharmacy_purchases", pharmacyPurchases);
await save("pharmacy_sales", pharmacySales);
await rec("inventory_supplier_payments", "VPY", { supplier: SUP.ms._id, billRef: grn.code, paymentDate: day(-2), amount: 15000, mode: "Bank Transfer", reference: "UTR ICIC26102255801", notes: "Part payment against invoice MS/2627/4471" }, day(-2));
await rec("inventory_supplier_payments", "VPY", { supplier: SUP.sg._id, billRef: pharmacyPurchases[0].code, paymentDate: day(-5), amount: pharmacyPurchases[0].netAmount, mode: "Cheque", reference: "Chq 000981", notes: "Full payment" }, day(-5));
await save("billing_shifts", billingShifts);
await save("billing_bills", bills);
await save("lab_orders", labOrders);
await save("insurance_preauths", preauths);
await save("insurance_claims", claims);
await save("ambulance_trips", Object.values(trips).sort((a, b) => a.requestedAt - b.requestedAt));

await save("activitylogs", {
  actor: admin._id, actorName: "Setup script", actorRole: "super_admin", action: "create", module: "system", resource: "demo_data",
  summary: `Loaded demo data: ${[...summary.values()].reduce((s, n) => s + n, 0)} records across ${summary.size} collections`, changedFields: [], ip: "local", createdAt: new Date(),
}, { stamps: false });

for (const [name, n] of [...summary].sort()) console.log(`added ${String(n).padStart(4)}  ${name}`);
console.log("\nDemo data loaded. Open Accounts once to post the vouchers for the new bills, sales and purchases.");
console.log("Payroll is not generated: use HR → Payroll Runs → Generate to see it with this data.");
console.log("To remove it again: npm run seed-demo -- --remove");
await mongoose.disconnect();
