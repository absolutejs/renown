// Shared by the Node CLI and Bun engine. A failed read must never become a new save.
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const localDirectory = () => join(homedir(), ".renown");
const context = new AsyncLocalStorage<string>();

export function readJson<T extends object>(path: string): T | undefined {
  let raw: string;
  try { raw = readFileSync(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && !existsSync(`${path}.bak`)) return undefined;
    throw new Error(`Renown cannot read ${path}; refusing to reset progress.`, { cause: error });
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected an object");
    return value as T;
  } catch (error) { throw new Error(`Renown save is invalid: ${path}. Original and backup were left untouched.`, { cause: error }); }
}

function atomicWrite(path: string, contents: string, exclusive = false) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(tmp, "wx", 0o600);
    try { writeFileSync(fd, contents); fsyncSync(fd); } finally { closeSync(fd); }
    if (exclusive) { linkSync(tmp, path); unlinkSync(tmp); }
    else renameSync(tmp, path);
    // Persist the rename too, so a reboot cannot leave an empty/missing save.
    const dir = openSync(dirname(path), "r");
    try { fsyncSync(dir); } finally { closeSync(dir); }
  } finally { if (existsSync(tmp)) unlinkSync(tmp); }
}

export const createJson = (path: string, value: object) => atomicWrite(path, JSON.stringify(value), true);

export function readProgress<T extends object>(path: string): T | undefined {
  const s = readJson<Record<string, unknown>>(path);
  if (!s) return undefined;
  if (s.v !== 2 && s.v !== 3) throw new Error(`Unsupported Renown save version in ${path}; refusing to reset progress.`);
  for (const key of ["skillXp", "achievements", "agentUses", "agentLastUsedAt"] as const) {
    if (!(key in s)) continue;
    const record = s[key];
    if (!record || typeof record !== "object" || Array.isArray(record) || Object.values(record).some(v => typeof v !== "number" || !Number.isFinite(v) || v < 0))
      throw new Error(`Invalid Renown ${key} in ${path}; refusing to discard progress.`);
  }
  for (const key of ["xp", "lifetimeXp"] as const) {
    if (key in s && (typeof s[key] !== "number" || !Number.isFinite(s[key]) || s[key] < 0))
      throw new Error(`Invalid Renown ${key} in ${path}; refusing to discard progress.`);
  }
  return s as T;
}

export function writeJson(path: string, value: object) {
  const previous = readJson<Record<string, unknown>>(path);
  if (previous) {
    atomicWrite(`${path}.bak`, JSON.stringify(previous));
    // Keep the first healthy save of each UTC day, as well as the previous write.
    const archive = join(dirname(path), "save-history", `${path.split("/").pop()}.${new Date().toISOString().slice(0, 10)}.json`);
    if (!existsSync(archive)) atomicWrite(archive, JSON.stringify(previous));
  }
  atomicWrite(path, JSON.stringify(value));
}

// Serializes entire read/modify/write operations, including asynchronous commit scoring.
// Readers need no lock: every published file is a complete, fsynced JSON document.
export async function withLocalLock<T>(fn: () => T | Promise<T>, directory = localDirectory()): Promise<T> {
  if (context.getStore() === directory) return fn();
  mkdirSync(directory, { recursive: true });
  const lock = join(directory, ".progress-lock");
  const token = randomUUID();
  const deadline = Date.now() + 120_000;
  while (true) {
    try { mkdirSync(lock); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // A crashed process cannot refresh its lease. Never use PID alone: hooks may
      // run in separate PID namespaces which reuse the same process numbers.
      try {
        if (Date.now() - statSync(lock).mtimeMs > 600_000) {
          const abandoned = `${lock}.abandoned.${token}`;
          renameSync(lock, abandoned);
          rmSync(abandoned, { recursive: true });
          continue;
        }
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      if (Date.now() >= deadline) throw new Error("Renown progress is busy; no save was changed. Retry the command.");
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  const owner = join(lock, "owner");
  writeFileSync(owner, token);
  const { utimesSync } = await import("node:fs");
  const heartbeat = setInterval(() => { const now = new Date(); try { utimesSync(lock, now, now); } catch {} }, 5_000);
  heartbeat.unref();
  try { return await context.run(directory, fn); }
  finally {
    clearInterval(heartbeat);
    if (existsSync(owner) && readFileSync(owner, "utf8") === token) rmSync(lock, { recursive: true });
  }
}
