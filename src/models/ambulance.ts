import "server-only";
import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { TRIP_TYPES } from "@/lib/modules";
import { modelName } from "./records";

/**
 * One ambulance call from request to completion: crew, timeline, distance,
 * charges and payment live on the trip so every step is a single atomic write.
 */

/** Earlier trips (before the dispatch workflow) used Requested / Dispatched / Completed / Cancelled, which are kept. */
export const TRIP_STATUSES = ["Requested", "Dispatched", "On Scene", "Transporting", "Arrived", "Completed", "Cancelled"] as const;
export const ACTIVE_TRIP_STATUSES = ["Dispatched", "On Scene", "Transporting", "Arrived"] as const;
export const TRIP_PRIORITIES = ["Critical", "Urgent", "Routine"] as const;
export const BILLING_MODES = ["Hospital Bill", "Collect", "No Charge"] as const;
export const TRIP_PAYMENT_STATUSES = ["Not Billed", "Unpaid", "Partially Paid", "Paid", "On Hospital Bill", "No Charge"] as const;
export const CREW_ROLES = ["Paramedic / EMT", "Nurse", "Doctor", "Attendant"] as const;

const CrewSchema = new Schema({ staff: { type: Schema.Types.ObjectId, ref: modelName("hr", "staff") }, name: String, role: String, phone: String }, { _id: false });
const EventSchema = new Schema({ at: { type: Date, default: () => new Date() }, status: String, byName: String, note: String }, { _id: false });
const PaymentSchema = new Schema({ mode: String, amount: { type: Number, min: 0.01 }, reference: String, at: { type: Date, default: () => new Date() }, byName: String }, { _id: false });
const ChargesSchema = new Schema(
  { base: Number, distance: Number, waiting: Number, night: Number, equipment: Number, discount: Number, total: Number },
  { _id: false }
);

const TripSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    tripType: { type: String, enum: TRIP_TYPES, default: "Emergency" },
    priority: { type: String, enum: TRIP_PRIORITIES, default: "Urgent" },
    callerName: String,
    callerPhone: { type: String, required: true },
    requestedAt: { type: Date, required: true },

    patient: { type: Schema.Types.ObjectId, ref: modelName("patients", "patients") },
    patientName: String,
    patientCode: String,
    patientAge: Number,
    patientGender: String,
    condition: String,
    pickupLocation: { type: String, required: true },
    pickupLandmark: String,
    dropLocation: String,
    /** Patient is being brought to this hospital (an emergency visit can be opened on arrival). */
    toHospital: { type: Boolean, default: true },

    vehicle: { type: Schema.Types.ObjectId, ref: modelName("ambulance", "vehicles") },
    vehicleNumber: String,
    vehicleType: String,
    driver: { type: Schema.Types.ObjectId, ref: modelName("hr", "staff") },
    driverName: String,
    driverPhone: String,
    crew: { type: [CrewSchema], default: [] },

    dispatchedAt: Date,
    onSceneAt: Date,
    departedAt: Date,
    arrivedAt: Date,
    completedAt: Date,
    cancelledAt: Date,
    cancelReason: String,

    odometerStart: Number,
    odometerEnd: Number,
    distanceKm: Number,
    waitingMinutes: Number,
    oxygenUsed: Boolean,
    ventilatorUsed: Boolean,

    tariff: { type: Schema.Types.ObjectId, ref: modelName("ambulance", "tariffs") },
    tariffName: String,
    charges: ChargesSchema,
    discountReason: String,
    billingMode: { type: String, enum: BILLING_MODES },
    payments: { type: [PaymentSchema], default: [] },
    paidAmount: { type: Number, default: 0 },
    paymentStatus: { type: String, enum: TRIP_PAYMENT_STATUSES, default: "Not Billed" },
    bill: { type: Schema.Types.ObjectId, ref: "HospitalBill" },
    billCode: String,
    visit: { type: Schema.Types.ObjectId, ref: modelName("opd_ipd", "visits") },
    visitCode: String,

    status: { type: String, enum: TRIP_STATUSES, default: "Requested" },
    events: { type: [EventSchema], default: [] },
    notes: String,
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    createdByName: String,
  },
  { timestamps: true, collection: "ambulance_trips", optimisticConcurrency: true }
);
TripSchema.index({ requestedAt: -1 });
TripSchema.index({ status: 1, requestedAt: -1 });
TripSchema.index({ patient: 1, requestedAt: -1 });
TripSchema.index({ vehicle: 1, status: 1 });
TripSchema.index({ driver: 1, status: 1 });
TripSchema.index({ "crew.staff": 1, status: 1 });

export type TripDoc = InferSchemaType<typeof TripSchema> & { _id: mongoose.Types.ObjectId };
// Registered under the registry's old model name so earlier trips keep resolving.
export const Trip: Model<InferSchemaType<typeof TripSchema>> = mongoose.models[modelName("ambulance", "trips")] ?? mongoose.model(modelName("ambulance", "trips"), TripSchema);
