import "server-only";
import mongoose, { Schema, type Model, type SchemaDefinition } from "mongoose";
import { MODULES, getResource, resolveRef, type FieldDef, type ResourceDef } from "@/lib/modules";

/**
 * Builds one Mongoose model (and collection) per resource declared in the
 * module registry, e.g. `opd_ipd.visits` -> collection `opd_ipd_visits`.
 */

export function modelName(moduleKey: string, resourceKey: string) {
  return moduleKey === resourceKey ? moduleKey : `${moduleKey}_${resourceKey}`;
}

function fieldSchema(field: FieldDef) {
  switch (field.type) {
    case "number":
      return { type: Number, min: field.min, max: field.max };
    case "date":
    case "datetime":
      return { type: Date };
    case "ref": {
      const target = field.ref ? resolveRef(field.ref) : undefined;
      if (!target) throw new Error(`Unknown ref "${field.ref}" on field ${field.name}`);
      return { type: Schema.Types.ObjectId, ref: modelName(target.module.key, target.resource.key) };
    }
    case "select":
      return { type: String, enum: [...(field.options ?? []), null] };
    default:
      return { type: String, trim: true, maxlength: field.maxLength };
  }
}

function buildSchema(resource: ResourceDef) {
  const def: SchemaDefinition = {};
  for (const field of resource.fields) {
    const base: Record<string, unknown> = { ...fieldSchema(field), required: field.required ?? false };
    if (field.readOnly && field.default !== undefined) base.default = field.type === "number" ? Number(field.default) : field.default;
    def[field.name] = base;
  }
  if (resource.codePrefix) def.code = { type: String, unique: true, sparse: true };
  def.createdBy = { type: Schema.Types.ObjectId, ref: "User" };
  def.updatedBy = { type: Schema.Types.ObjectId, ref: "User" };

  const schema = new Schema(def, { timestamps: true });
  schema.index({ createdAt: -1 });
  if (resource.statusField) schema.index({ [resource.statusField]: 1 });
  if (resource.unique) schema.index(Object.fromEntries(resource.unique.map((f) => [f, 1])), { unique: true });
  for (const field of resource.fields) {
    if (field.type === "ref") schema.index({ [field.name]: 1, createdAt: -1 });
  }
  return schema;
}

// Register every resource up front so `populate()` can resolve cross-module refs.
let registered = false;
function registerAll() {
  if (registered) return;
  registered = true;
  for (const m of MODULES) {
    for (const r of m.resources) {
      const name = modelName(m.key, r.key);
      if (!mongoose.models[name]) mongoose.model(name, buildSchema(r), name);
    }
  }
}

export function getRecordModel(moduleKey: string, resourceKey: string): Model<Record<string, unknown>> | null {
  if (!getResource(moduleKey, resourceKey)) return null;
  registerAll();
  return mongoose.models[modelName(moduleKey, resourceKey)] as Model<Record<string, unknown>>;
}
