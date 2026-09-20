import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "./supabase.js";

type AnyRecord = Record<string, any>;
type Filter = AnyRecord;

function getPath(value: AnyRecord, path: string): any {
  return path.split(".").reduce((current, key) => current == null ? undefined : current[key], value);
}
function matches(row: AnyRecord, filter: Filter = {}): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === "$or") return expected.some((item: Filter) => matches(row, item));
    const actual = getPath(row, key);
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      return Object.entries(expected).every(([op, value]) => {
        if (op === "$gte") return actual >= value;
        if (op === "$gt") return actual > value;
        if (op === "$lte") return actual <= value;
        if (op === "$lt") return actual < value;
        if (op === "$ne") return actual !== value;
        if (op === "$in") return value.includes(actual);
        if (op === "$exists") return value ? actual !== undefined : actual === undefined;
        return actual === expected;
      });
    }
    return actual === expected;
  });
}
function mergeUpdate(row: AnyRecord, update: AnyRecord): AnyRecord {
  const result = structuredClone(row);
  const set = update.$set ?? update;
  for (const [key, value] of Object.entries(set)) {
    const parts = key.split("."); let target = result;
    parts.slice(0, -1).forEach((part) => { target[part] ??= {}; target = target[part]; });
    target[parts.at(-1)!] = value;
  }
  for (const [key, value] of Object.entries(update.$inc ?? {})) result[key] = (result[key] ?? 0) + Number(value);
  for (const [key, value] of Object.entries(update.$push ?? {})) (result[key] ??= []).push(value);
  return result;
}

class Query<T extends AnyRecord> {
  constructor(private promise: Promise<T[]>) {}
  sort(spec: AnyRecord) { this.promise = this.promise.then((rows) => rows.sort((a, b) => { const [key, direction] = Object.entries(spec)[0]; return (getPath(a, key) > getPath(b, key) ? 1 : -1) * Number(direction); })); return this; }
  skip(n: number) { this.promise = this.promise.then((rows) => rows.slice(n)); return this; }
  limit(n: number) { this.promise = this.promise.then((rows) => rows.slice(0, n)); return this; }
  select(selection: string) { if (selection.startsWith("-")) { const key = selection.slice(1); this.promise = this.promise.then((rows) => rows.map((row) => { const copy = { ...row }; delete copy[key]; return copy; })); } return this; }
  lean() { return this; }
  then<TResult1 = T[], TResult2 = never>(onfulfilled?: ((value: T[]) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null) { return this.promise.then(onfulfilled, onrejected); }
  catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null) { return this.promise.catch(onrejected); }
}

export function createSupabaseModel<T extends AnyRecord>(table: string) {
  const read = async (filter: Filter = {}) => {
    const { data, error } = await getSupabaseAdmin().from("bot_documents").select("id, collection, document, created_at, updated_at").eq("collection", table);
    if (error) throw error;
    return (data ?? []).map((row: any) => ({ ...row.document, _id: row.id, createdAt: row.created_at, updatedAt: row.updated_at })).filter((row) => matches(row, filter)) as T[];
  };
  const write = async (document: AnyRecord, existingId?: string) => {
    const payload = { collection: table, document, updated_at: new Date().toISOString() };
    const result = existingId ? await getSupabaseAdmin().from("bot_documents").update(payload).eq("id", existingId).select("id").single() : await getSupabaseAdmin().from("bot_documents").insert({ ...payload, id: randomUUID() }).select("id").single();
    if (result.error) throw result.error;
    return { ...document, _id: result.data.id, createdAt: document.createdAt ?? new Date(), updatedAt: new Date() } as T;
  };
  const model: any = class {
    [key: string]: any;
    constructor(values: AnyRecord = {}) { Object.assign(this, values); }
    async save() { const saved = await write(this, this._id); Object.assign(this, saved); return this; }
  };
  model.find = (filter: Filter = {}) => new Query(read(filter));
  model.findOne = async (filter: Filter = {}) => (await read(filter))[0] ?? null;
  model.findById = async (id: string) => (await read({ _id: id }))[0] ?? null;
  model.countDocuments = async (filter: Filter = {}) => (await read(filter)).length;
  model.findOneAndUpdate = async (filter: Filter, update: AnyRecord, options: AnyRecord = {}) => { const row = (await read(filter))[0]; if (!row) return null; const saved = await write(mergeUpdate(row, update), row._id); return options.new === false ? row : saved; };
  model.updateOne = async (filter: Filter, update: AnyRecord) => { const row = (await read(filter))[0]; if (!row) return { matchedCount: 0 }; await write(mergeUpdate(row, update), row._id); return { matchedCount: 1 }; };
  model.findByIdAndUpdate = (id: string, update: AnyRecord) => model.findOneAndUpdate({ _id: id }, update, { new: true });
  model.findByIdAndDelete = (id: string) => model.deleteOne({ _id: id });
  model.deleteOne = async (filter: Filter) => { const row = (await read(filter))[0]; if (!row) return { deletedCount: 0 }; const { error } = await getSupabaseAdmin().from("bot_documents").delete().eq("id", row._id); if (error) throw error; return { deletedCount: 1 }; };
  model.deleteMany = async (filter: Filter) => { const rows = await read(filter); for (const row of rows) await model.deleteOne({ _id: row._id }); return { deletedCount: rows.length }; };
  return model as { new(values?: AnyRecord): T } & AnyRecord;
}

export type { Query };
