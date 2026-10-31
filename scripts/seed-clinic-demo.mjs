/**
 * Fills Clinic Management with demo records: four clinics run by the demo
 * doctors, a dozen extra walk-in patients, about two weeks of tokens,
 * consultations and fee receipts, and a live queue for today. Uses the doctors
 * and patients loaded by `npm run seed-demo`, so run that first.
 *
 *   npm run seed-clinic-demo               add the clinic demo data (once)
 *   npm run seed-clinic-demo -- --remove   delete everything this script added
 *
 * Remove this data before `npm run seed-demo -- --remove`, which deletes the
 * patients and doctors it refers to. Token numbers, follow-up visits, fees and
 * fee status follow the same rules as the app (lib/rules.ts). Accounts vouchers
 * for the receipts are posted by the app the next time Accounts is opened.
 * For demos and testing only.
 */
import mongoose from "mongoose";

const { MONGODB_URI } = process.env;
if (!MONGODB_URI) {
  console.error("Set MONGODB_URI in .env.local first.");
  process.exit(1);
}

await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
const { ObjectId } = mongoose.Types;
const db = mongoose.connection.db;
const col = (name) => db.collection(name);
/** Ids of every document this script inserted, per collection, so --remove can take them out again. */
const MARKER = col("demo_seed");
const MARKER_ID = "clinic";

if (process.argv.includes("--remove")) {
  const marker = await MARKER.findOne({ _id: MARKER_ID });
  if (!marker) {
    console.log("No clinic demo data found.");
  } else {
    const all = [];
    for (const [name, ids] of Object.entries(marker.ids ?? {})) {
      const res = await col(name).deleteMany({ _id: { $in: ids } });
      all.push(...ids);
      console.log(`removed ${String(res.deletedCount).padStart(4)}  ${name}`);
    }
    const vouchers = await col("accounts_vouchers").deleteMany({ auto: true, sourceId: { $in: all } });
    console.log(`removed ${String(vouchers.deletedCount).padStart(4)}  accounts_vouchers (automatic postings)`);
    for (const id of marker.ids?.clinic_clinics ?? []) await col("counters").deleteMany({ _id: new RegExp(`^clinic_token:${id}:`) });
    await MARKER.deleteOne({ _id: MARKER_ID });
    console.log("\nClinic demo data removed.");
  }
  await mongoose.disconnect();
  process.exit(0);
}

if (await MARKER.findOne({ _id: MARKER_ID })) {
  console.log("Clinic demo data is already loaded. Run `npm run seed-clinic-demo -- --remove` first to load it again.");
  await mongoose.disconnect();
  process.exit(0);
}

const admin = await col("users").findOne({ role: "super_admin" });
if (!admin) {
  console.error("No super admin found. Run `npm run create-super-admin` first.");
  process.exit(1);
}

const doctorList = await col("doctors").find({ fullName: { $in: ["Dr. Anita Sharma", "Dr. Vikram Patil", "Dr. Rajesh Kulkarni", "Dr. Priya Deshmukh"] } }).toArray();
// Only the demo patients, never real or test registrations.
const demoIds = (await MARKER.findOne({ _id: "main" }))?.ids?.patients ?? [];
const demoPatients = await col("patients").find({ _id: { $in: demoIds } }).toArray();
if (doctorList.length < 4 || demoPatients.length < 6) {
  console.error("The demo doctors and patients are missing. Run `npm run seed-demo` first.");
  process.exit(1);
}
const D = Object.fromEntries(doctorList.map((d) => [d.fullName, d]));

/* ======================= helpers ======================= */

const DAY = 86_400_000;
/** Hospital wall-clock times are IST. */
const IST = 330 * 60_000;
const today = new Date();
today.setUTCHours(0, 0, 0, 0);
const day = (n) => new Date(today.getTime() + n * DAY);
const at = (n, minutes) => new Date(day(n).getTime() + minutes * 60_000 - IST);
const iso = (d) => d.toISOString().slice(0, 10);
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const year = new Date().getFullYear();

/** Deterministic pseudo-random numbers, so every run produces the same data. */
let seed = 20261030;
function rand() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = (list) => list[Math.floor(rand() * list.length)];
const shuffle = (list) => list.map((x) => [rand(), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x);

async function counter(key) {
  const doc = await col("counters").findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
  return doc.seq;
}
/** Same numbering as models/Counter.ts, e.g. "TKN-2026-000042". */
async function nextCode(prefix) {
  return `${prefix}-${year}-${String(await counter(`${prefix}-${year}`)).padStart(6, "0")}`;
}

const summary = new Map();
async function save(name, docs) {
  const list = Array.isArray(docs) ? docs : [docs];
  if (!list.length) return docs;
  const now = new Date();
  for (const d of list) {
    d._id ??= new ObjectId();
    d.createdBy ??= admin._id;
    d.updatedBy ??= admin._id;
    d.createdAt ??= now;
    // Accounts posts whatever changed since its last run, so new records must look freshly updated.
    d.updatedAt = now;
    d.__v ??= 0;
  }
  await col(name).insertMany(list, { ignoreUndefined: true });
  await MARKER.updateOne({ _id: MARKER_ID }, { $push: { [`ids.${name}`]: { $each: list.map((d) => d._id) } }, $setOnInsert: { at: now } }, { upsert: true });
  summary.set(name, (summary.get(name) ?? 0) + list.length);
  return docs;
}

function ageYears(dob) {
  if (!(dob instanceof Date)) return 30;
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  const m = today.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

/* ======================= clinic patients ======================= */

// The main demo has one child and few adults; clinics need a wider walk-in crowd.
const patientRows = [
  ["Ishaan Kulkarni", "2020-02-11", "Male", "9822301101", "B+", "Flat 4, Erandwane, Pune 411004", "Anil Kulkarni (father)", "9822301102"],
  ["Myra Shah", "2017-09-03", "Female", "9822301103", "O+", "C-12, Bavdhan, Pune 411021", "Krupa Shah (mother)", "9822301104"],
  ["Advait Jadhav", "2022-05-19", "Male", "9822301105", "A+", "Row House 9, Pashan, Pune 411008", "Swati Jadhav (mother)", "9822301106"],
  ["Anaya Bhosale", "2014-12-28", "Female", "9822301107", "AB+", "Survey 22, Warje, Pune 411058", "Prakash Bhosale (father)", "9822301108"],
  ["Kabir Sayyed", "2019-07-07", "Male", "9822301109", "O-", "Lane 3, Kondhwa, Pune 411048", "Rehana Sayyed (mother)", "9822301110"],
  ["Meera Iyer", "1987-03-21", "Female", "9822301111", "A+", "B-602, Balewadi, Pune 411045", "Suresh Iyer (husband)", "9822301112"],
  ["Pooja Chavan", "1995-11-14", "Female", "9822301113", "B+", "Dhankawadi, Pune 411043", null, null],
  ["Sneha Patwardhan", "1991-06-30", "Female", "9822301114", "O+", "Deccan Gymkhana, Pune 411004", "Amit Patwardhan (husband)", "9822301115"],
  ["Dattatray More", "1956-01-09", "Male", "9822301116", "B-", "Hadapsar Gaon, Pune 411028", "Ganesh More (son)", "9822301117"],
  ["Suresh Naik", "1963-08-25", "Male", "9822301118", "A+", "Bibwewadi, Pune 411037", "Vandana Naik (wife)", "9822301119"],
  ["Rahul Deshmukh", "1983-04-02", "Male", "9822301120", "O+", "Kharadi, Pune 411014", null, null],
  ["Anjali Rao", "1969-10-17", "Female", "9822301121", "AB-", "Model Colony, Pune 411016", "Venkat Rao (husband)", "9822301122"],
];
const newPatients = [];
for (const [fullName, dob, gender, mobile, bloodGroup, address, emergencyContactName, emergencyContactPhone] of patientRows) {
  newPatients.push({
    code: await nextCode("MC"), fullName, dateOfBirth: new Date(`${dob}T00:00:00Z`), gender, mobile, email: null, patientType: "OPD", bloodGroup, address,
    emergencyContactName, emergencyContactPhone, createdAt: at(-between(16, 30), 600),
  });
}
await save("patients", newPatients);
const patients = [...demoPatients, ...newPatients];

/* ======================= clinics ======================= */

const CLINICS = [
  {
    name: "General OPD – Dr. Anita Sharma", doctor: D["Dr. Anita Sharma"], department: "General Medicine", roomNo: "12", phone: "02025531012",
    workingDays: "Mon,Tue,Wed,Thu,Fri,Sat", startTime: "09:00", endTime: "13:00", maxTokensPerDay: 40, consultationFee: 400, followUpFee: 0, followUpValidityDays: 7,
    perDay: [3, 6], who: () => true,
    cases: [
      { complaints: "Fever with body ache and sore throat for 2 days", examination: "Throat congested, no lymphadenopathy, chest clear", diagnosis: "Acute viral pharyngitis", prescription: "1. Tab Paracetamol 650 mg — 1-1-1 × 3 days, after food\n2. Tab Cetirizine 10 mg — 0-0-1 × 5 days\n3. Betadine gargles — 3 times a day", investigations: "CBC if fever persists beyond 3 days", advice: "Warm fluids, rest. Return if fever > 102 °F or breathing difficulty.", temp: [99.5, 101.8] },
      { complaints: "Burning micturition and increased frequency for 3 days", examination: "Mild suprapubic tenderness, afebrile", diagnosis: "Uncomplicated urinary tract infection", prescription: "1. Tab Nitrofurantoin 100 mg — 1-0-1 × 5 days\n2. Syp Alkasol 10 ml — 1-1-1 × 5 days", investigations: "Urine routine and microscopy, urine culture", advice: "Drink 3 litres of water a day.", temp: [98.4, 99.6] },
      { complaints: "Follow-up of type 2 diabetes, occasional tingling in feet", examination: "Peripheral pulses felt, monofilament sensation reduced at toes", diagnosis: "Type 2 diabetes mellitus — fair control", prescription: "1. Tab Metformin 500 mg — 1-0-1, continue\n2. Tab Glimepiride 1 mg — 1-0-0 before breakfast\n3. Cap Methylcobalamin 1500 mcg — 0-0-1 × 1 month", investigations: "FBS, PPBS, HbA1c, serum creatinine", advice: "Diabetic diet, 30 min brisk walk daily, foot care.", temp: [98.0, 98.8] },
      { complaints: "Acidity and upper abdominal discomfort after meals", examination: "Epigastric tenderness, no guarding", diagnosis: "Acid peptic disease", prescription: "1. Tab Pantoprazole 40 mg — 1-0-0 before breakfast × 14 days\n2. Syp Sucralfate 10 ml — 1-1-1 × 7 days", investigations: "", advice: "Avoid spicy food, late dinners and tea on an empty stomach.", temp: [98.0, 98.8] },
    ],
  },
  {
    name: "Child Clinic – Dr. Vikram Patil", doctor: D["Dr. Vikram Patil"], department: "Pediatrics", roomNo: "7", phone: "02025531007",
    workingDays: "Mon,Wed,Fri,Sat", startTime: "10:00", endTime: "14:00", maxTokensPerDay: 25, consultationFee: 500, followUpFee: 200, followUpValidityDays: 10,
    perDay: [2, 4], who: (p) => ageYears(p.dateOfBirth) < 18,
    cases: [
      { complaints: "Cough and running nose for 4 days, mild fever", examination: "Chest clear, ears normal", diagnosis: "Upper respiratory tract infection", prescription: "1. Syp Paracetamol 250 mg/5 ml — 7 ml SOS for fever (max 4 doses a day)\n2. Syp Levocetirizine 2.5 mg/5 ml — 5 ml at night × 5 days\n3. Saline nasal drops — 2 drops each nostril 4 times a day", investigations: "", advice: "Plenty of fluids. Return if fast breathing or poor feeding.", temp: [99.0, 100.8] },
      { complaints: "Loose stools 5–6 times a day since yesterday", examination: "Mildly dehydrated, abdomen soft", diagnosis: "Acute gastroenteritis with some dehydration", prescription: "1. ORS — 100 ml after every loose stool\n2. Syp Zinc 20 mg — 5 ml once daily × 14 days\n3. Sachet Probiotic — 1 sachet twice a day × 5 days", investigations: "Stool routine if blood in stool", advice: "Continue feeding. Watch for reduced urine output.", temp: [98.6, 99.8] },
      { complaints: "Routine growth check and vaccination advice", examination: "Growth normal for age, systemic examination normal", diagnosis: "Healthy child — well-child visit", prescription: "1. Syp Multivitamin — 5 ml once daily × 1 month", investigations: "", advice: "Next vaccines as per IAP schedule.", temp: [98.2, 98.8] },
    ],
  },
  {
    name: "Heart Clinic – Dr. Rajesh Kulkarni", doctor: D["Dr. Rajesh Kulkarni"], department: "Cardiology", roomNo: "21", phone: "02025531021",
    workingDays: "Tue,Thu,Sat", startTime: "16:00", endTime: "19:00", maxTokensPerDay: 20, consultationFee: 800, followUpFee: 300, followUpValidityDays: 15,
    perDay: [2, 4], who: (p) => ageYears(p.dateOfBirth) >= 35,
    cases: [
      { complaints: "Headache and giddiness, BP high at home", examination: "Heart sounds normal, no pedal oedema", diagnosis: "Essential hypertension — stage 1", prescription: "1. Tab Telmisartan 40 mg — 1-0-0 × 1 month\n2. Tab Amlodipine 5 mg — 0-0-1 × 1 month", investigations: "ECG, lipid profile, serum creatinine, urine albumin", advice: "Salt under 5 g a day, home BP log twice daily.", bp: ["150/96", "156/98", "148/94"] },
      { complaints: "Chest discomfort on climbing stairs for 2 weeks", examination: "S1 S2 normal, no murmur", diagnosis: "Stable angina — evaluate for coronary artery disease", prescription: "1. Tab Aspirin 75 mg — 0-1-0 after lunch\n2. Tab Atorvastatin 40 mg — 0-0-1\n3. Tab Metoprolol 25 mg — 1-0-1\n4. Tab Sorbitrate 5 mg — under the tongue SOS for chest pain", investigations: "ECG, 2D Echo, TMT, lipid profile", advice: "Avoid heavy exertion until TMT. Go to Emergency if pain lasts over 10 minutes.", bp: ["138/88", "142/90"] },
      { complaints: "Review after starting BP medicines, feeling better", examination: "No pedal oedema", diagnosis: "Hypertension — controlled", prescription: "1. Tab Telmisartan 40 mg — 1-0-0, continue", investigations: "", advice: "Continue home BP monitoring.", bp: ["128/82", "132/84"] },
    ],
  },
  {
    name: "Women's Clinic – Dr. Priya Deshmukh", doctor: D["Dr. Priya Deshmukh"], department: "Gynecology", roomNo: "15", phone: "02025531015",
    workingDays: "Mon,Tue,Wed,Thu,Fri", startTime: "11:00", endTime: "15:00", maxTokensPerDay: 25, consultationFee: 600, followUpFee: 0, followUpValidityDays: 7,
    perDay: [1, 3], who: (p) => p.gender === "Female" && ageYears(p.dateOfBirth) >= 16,
    cases: [
      { complaints: "Irregular periods for 4 months, weight gain", examination: "BMI 28, mild acne", diagnosis: "Suspected polycystic ovary syndrome", prescription: "1. Tab Metformin 500 mg — 0-1-0 after lunch × 1 month\n2. Tab Folic acid 5 mg — 1-0-0", investigations: "USG pelvis, TSH, prolactin, fasting insulin", advice: "Regular exercise and a low-sugar diet.", temp: [98.2, 98.8] },
      { complaints: "Tiredness and weakness, heavy periods", examination: "Pallor present", diagnosis: "Iron deficiency anaemia with menorrhagia", prescription: "1. Tab Ferrous ascorbate 100 mg — 0-1-0 after lunch × 3 months\n2. Tab Tranexamic acid 500 mg — 1-1-1 during periods (first 3 days)", investigations: "CBC, serum ferritin, USG pelvis", advice: "Iron-rich diet: green leafy vegetables, dates, jaggery.", temp: [98.2, 98.8] },
    ],
  },
];

const clinicDocs = [];
for (const c of CLINICS) {
  const fields = Object.fromEntries(Object.entries(c).filter(([k]) => !["perDay", "who", "cases"].includes(k)));
  clinicDocs.push({ ...fields, doctor: c.doctor._id, status: "Active", createdAt: at(-16, 600) });
}
await save("clinic_clinics", clinicDocs);

/* ======================= tokens, consultations, receipts ======================= */

const leaves = await col("doctors_leaves").find({ status: "Approved" }).toArray();
const onLeave = (doctorId, d) => leaves.some((l) => String(l.doctor) === String(doctorId) && l.fromDate <= d && l.toDate >= d);

const tokens = [];
const consultations = [];
const receipts = [];
/** Last completed "New" visit of a patient in a clinic, for follow-up pricing. */
const lastNew = new Map();
const MODES = ["Cash", "Cash", "UPI", "UPI", "UPI", "Card"];

for (let n = -14; n <= 1; n++) {
  const date = day(n);
  for (const [ci, c] of CLINICS.entries()) {
    const clinic = clinicDocs[ci];
    if (!c.workingDays.split(",").includes(WEEKDAYS[date.getUTCDay()]) || onLeave(c.doctor._id, date)) continue;
    // Today is a busy day half done; tomorrow only has a few advance bookings.
    const count = n === 1 ? 2 : n === 0 ? c.perDay[1] + 2 : between(c.perDay[0], c.perDay[1]);
    const pool = shuffle(patients.filter(c.who));
    const startMin = Number(c.startTime.slice(0, 2)) * 60 + Number(c.startTime.slice(3));
    for (let i = 0; i < Math.min(count, pool.length); i++) {
      const p = pool[i];
      const key = `${clinic._id}:${p._id}`;
      const prev = lastNew.get(key);
      const followUp = prev && date > prev && date.getTime() - prev.getTime() <= c.followUpValidityDays * DAY;
      const fee = followUp ? c.followUpFee : c.consultationFee;

      let status;
      if (n < 0) status = rand() < 0.08 ? "No-show" : rand() < 0.04 ? "Cancelled" : "Completed";
      else if (n === 0) status = i < count - 3 ? "Completed" : i === count - 3 ? "In Consultation" : "Waiting";
      else status = "Waiting";

      const issued = at(n, startMin - 30 + i * between(8, 15));
      const token = {
        _id: new ObjectId(), code: await nextCode("TKN"), visitDate: date, clinic: clinic._id, tokenNo: await counter(`clinic_token:${clinic._id}:${iso(date)}`),
        patient: p._id, doctor: c.doctor._id, visitType: followUp ? "Follow-up" : "New", fee, feeStatus: fee > 0 ? "Due" : "Free",
        complaint: null, status, patientName: p.fullName, clinicName: c.name, createdAt: n === 1 ? at(0, 600 + i * 20) : issued,
      };
      const kase = followUp && c.cases.length > 2 ? c.cases[c.cases.length - 1] : pick(c.cases);
      token.complaint = kase.complaints.split(",")[0];
      tokens.push(token);

      if (status === "Completed") {
        if (!followUp) lastNew.set(key, date);
        const seenAt = new Date(issued.getTime() + between(20, 50) * 60_000);
        consultations.push({
          code: await nextCode("CON"), token: token._id, visitDate: date, patient: p._id, doctor: c.doctor._id, patientName: p.fullName,
          bp: kase.bp ? pick(kase.bp) : `${between(110, 134)}/${between(70, 86)}`, pulse: between(68, 96),
          temperature: Math.round((kase.temp ? kase.temp[0] + rand() * (kase.temp[1] - kase.temp[0]) : 98.4) * 10) / 10,
          spo2: between(96, 99), weight: c.department === "Pediatrics" ? between(12, 40) : between(48, 86),
          complaints: kase.complaints, examination: kase.examination, diagnosis: kase.diagnosis, prescription: kase.prescription,
          investigations: kase.investigations || null, advice: kase.advice, followUpDate: rand() < 0.6 ? day(n + between(5, c.followUpValidityDays + 3)) : null,
          createdAt: seenAt,
        });
      }

      // Most patients pay at the desk before seeing the doctor; a few past visits are left unpaid.
      const pays = fee > 0 && (status === "Completed" || status === "In Consultation" || (n === 0 && i % 2 === 0 && status === "Waiting")) && !(n < -2 && rand() < 0.06);
      if (pays) {
        const discount = ageYears(p.dateOfBirth) >= 60 ? Math.round(fee * 0.1) : 0;
        const mode = pick(MODES);
        receipts.push({
          code: await nextCode("CFR"), receiptDate: date, token: token._id, patient: p._id, patientName: p.fullName, fee, discount, amount: fee - discount, mode,
          reference: mode === "UPI" ? `UPI ${between(400000, 999999)}${between(100000, 999999)}` : mode === "Card" ? `POS ${between(100000, 999999)}` : null,
          remarks: discount ? "Senior citizen discount 10%" : null, status: "Paid", createdAt: new Date(issued.getTime() + 2 * 60_000),
        });
        token.feeStatus = "Paid";
      }
    }
  }
}

// One receipt cancelled and re-issued after the wrong payment mode was entered.
const redo = receipts.find((r) => r.mode === "Cash" && r.receiptDate < day(-3));
if (redo) {
  receipts.push({ ...redo, _id: undefined, code: await nextCode("CFR"), mode: "UPI", reference: `UPI ${between(400000, 999999)}${between(100000, 999999)}`, remarks: "Re-issued: paid by UPI, not cash" });
  Object.assign(redo, { status: "Cancelled", remarks: "Wrong payment mode — re-issued" });
}

await save("clinic_tokens", tokens);
await save("clinic_consultations", consultations);
await save("clinic_receipts", receipts);

await col("activitylogs").insertOne({
  actor: admin._id, actorName: "Setup script", actorRole: "super_admin", action: "create", module: "clinic", resource: "demo_data",
  summary: `Loaded clinic demo data: ${clinicDocs.length} clinics, ${newPatients.length} patients, ${tokens.length} tokens, ${consultations.length} consultations, ${receipts.length} fee receipts`, changedFields: [], ip: "local", createdAt: new Date(),
});

for (const [name, n] of [...summary].sort()) console.log(`added ${String(n).padStart(4)}  ${name}`);
const todays = tokens.filter((t) => t.visitDate.getTime() === today.getTime());
console.log(`\nToday: ${todays.length} tokens (${todays.filter((t) => t.status === "Waiting").length} waiting, ${todays.filter((t) => t.status === "In Consultation").length} with the doctor).`);
console.log("Clinic demo data loaded. Open Accounts once to post the fee receipts.");
console.log("To remove it again: npm run seed-clinic-demo -- --remove");
await mongoose.disconnect();
