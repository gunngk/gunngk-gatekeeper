// Phase-1 feasibility: local Groth16 proof for the known-valid Gatekeeper
// scenario, timed precisely, then verified against the exported VK.
const fs = require("fs");
const snarkjs = require("snarkjs");

const VK_HASH = "0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0";
const RECIPIENT = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e"; // fixed example EVM address

const input = {
  registeredVkHash: VK_HASH,
  proofVkHash: VK_HASH,
  minimum: "1000",
  publicBalance: "1460",
  expiryBlock: 8430000,
  currentBlock: 8420000,
  recipient: RECIPIENT,
  conditionRecipient: RECIPIENT,
  amount: "500",
  maxTransfer: "1000",
  decision: 1,
  taskId: 24901,
  salt: "98765432123456789",
};

async function main() {
  fs.writeFileSync(__dirname + "/input.json", JSON.stringify(input, null, 2));

  const t0 = process.hrtime.bigint();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    __dirname + "/../circuits/gatekeeper.wasm",
    __dirname + "/../circuits/gatekeeper_final.zkey"
  );
  const t1 = process.hrtime.bigint();
  const proveMs = Number(t1 - t0) / 1e6;
  console.log("fullProve time: " + proveMs.toFixed(1) + " ms (" + (proveMs / 1000).toFixed(3) + " s)");
  console.log("publicSignals (" + publicSignals.length + "):", JSON.stringify(publicSignals));

  fs.writeFileSync(__dirname + "/proof.json", JSON.stringify(proof, null, 2));
  fs.writeFileSync(__dirname + "/public.json", JSON.stringify(publicSignals, null, 2));
  const proofStr = JSON.stringify(proof);
  console.log("proof JSON size (compact): " + Buffer.byteLength(proofStr) + " bytes");

  const vk = JSON.parse(fs.readFileSync(__dirname + "/verification_key.json", "utf8"));
  const t2 = process.hrtime.bigint();
  const ok = await snarkjs.groth16.verify(vk, publicSignals, proof);
  const t3 = process.hrtime.bigint();
  console.log("verify time: " + (Number(t3 - t2) / 1e6).toFixed(1) + " ms");
  console.log("verify result:", ok ? "OK (true)" : "FAILED (false)");
  process.exit(ok ? 0 : 2);
}
main().catch((err) => { console.error("FATAL", err); process.exit(1); });
