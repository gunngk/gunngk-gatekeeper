"use strict";
// Persistent seen-set of proof_tx references (PROOF_REUSED detection).
//
// Interface (swap the backing store without touching callers):
//   has(id)  -> boolean
//   add(id)  -> void (persists best-effort)
//   size()   -> number
//
// FileSeenStore keeps an in-memory Set mirrored to a JSON file. Writes are
// synchronous and best-effort: on read-only/ephemeral filesystems (Vercel)
// a failed write degrades to in-memory-only for the life of the process
// instead of crashing the request path. For production serverless use,
// implement the same interface over a KV store (e.g. Vercel KV / Upstash)
// and construct it in lib/handler.js instead — nothing else changes.

const fs = require("fs");
const path = require("path");

class MemorySeenStore {
  constructor() {
    this.set = new Set();
  }
  has(id) {
    return this.set.has(id);
  }
  add(id) {
    this.set.add(id);
  }
  size() {
    return this.set.size;
  }
}

class FileSeenStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.set = new Set();
    this.persistOk = true;
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      for (const id of JSON.parse(raw)) this.set.add(id);
    } catch (_) {
      /* missing/corrupt file -> start empty */
    }
  }
  has(id) {
    return this.set.has(id);
  }
  add(id) {
    if (this.set.has(id)) return;
    this.set.add(id);
    if (!this.persistOk) return;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify([...this.set]));
    } catch (_) {
      this.persistOk = false; // degrade to in-memory; never fail a task over this
    }
  }
  size() {
    return this.set.size;
  }
}

module.exports = { MemorySeenStore, FileSeenStore };
