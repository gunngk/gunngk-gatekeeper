// Discover the gatekeeper circuit's input signals from the wasm itself.
// Uses the circom witness-calculator interface: FNV-1a-64 hash of each
// candidate signal name -> getInputSignalSize(hMSB, hLSB).
const fs = require("fs");

function fnvHash(str) {
  const uint64_max = BigInt(2) ** BigInt(64);
  let hash = BigInt("0xCBF29CE484222325");
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash *= BigInt(0x100000001B3);
    hash %= uint64_max;
  }
  return hash;
}

async function main() {
  const wasmBuffer = fs.readFileSync(__dirname + "/../circuits/gatekeeper.wasm");
  const runtime = {
    exceptionHandler: (code) => { throw new Error("wasm exceptionHandler code=" + code); },
    printErrorMessage: () => {},
    writeBufferMessage: () => {},
    showSharedRWMemory: () => {},
  };
  const { instance } = await WebAssembly.instantiate(wasmBuffer, { runtime });
  const e = instance.exports;
  e.init(0);
  console.log("getInputSize (total input scalars):", e.getInputSize());
  console.log("getWitnessSize (total vars):", e.getWitnessSize());
  console.log("getFieldNumLen32:", e.getFieldNumLen32());

  const candidates = [
    // competitor-reported names (SPEC.md section 3.2)
    "registeredVkHash", "proofVkHash", "minimum", "publicBalance",
    "expiryBlock", "currentBlock", "recipient", "conditionRecipient",
    "amount", "maxTransfer", "decision", "taskId", "salt",
    // snake_case variants matching the task envelope field names
    "registered_vk", "proof_vk", "public_balance", "expiry_block",
    "current_block", "condition_recipient", "max_transfer", "task_id",
    // other plausible variants
    "registeredVKHash", "proofVKHash", "vkHash", "registeredVk", "proofVk",
    "balance", "min", "expiry", "current", " Salt", "salt ".trim(),
  ];
  const seen = new Set();
  for (const name of candidates) {
    if (seen.has(name)) continue;
    seen.add(name);
    const h = fnvHash(name);
    const msb = Number(h >> BigInt(32));
    const lsb = Number(h & BigInt(0xFFFFFFFF));
    let size;
    try { size = e.getInputSignalSize(msb, lsb); } catch (err) { size = "ERR:" + err.message; }
    console.log(JSON.stringify(name), "-> getInputSignalSize =", size);
  }
}
main().catch((err) => { console.error("FATAL", err); process.exit(1); });
