# Phase 1 — Local Feasibility: Proof Gatekeeper proving

Run 2026-11-15 (WIB), fully local. No registration, no Kurier sign-up, no
wallet, nothing submitted anywhere. Verdict: **local proving is feasible
with huge margin — 0.89 s of the 60 s window.**

## Environment

- Node v24.22.1, npm 10.9.4
- snarkjs **0.7.6** (installed locally in this project: `npm install snarkjs@0.7.6`)
- Machine: AMD EPYC 9D25, 4 vCPU visible (shared host, ~1.5 CPU quota),
  ~8 GB RAM — a modest shared VM, slower than a typical VPS, so these
  timings are a conservative bound.

## Artifacts (step 2)

Downloaded from the official URLs in `/api/circuit-info`:

| File | Size |
|---|---|
| `circuits/gatekeeper.wasm` | 1,755,820 bytes |
| `circuits/gatekeeper_final.zkey` | 309,750 bytes |
| `circuit-info.json` (saved at project root) | 519 bytes |
| `build/verification_key.json` (exported from zkey) | 5,117 bytes |

`GET /api/circuit-info` confirms network `mainnet` and the gatekeeper
vkHash **matches exactly**:
`0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0` ✅

## Circuit shape (from the artifacts themselves)

- `getInputSize()` = **13** input scalars; `getWitnessSize()` = **647** vars
  (a small circuit — proving is cheap).
- Exported VK has IC length 14 ⇒ **13 public signals = 1 circuit output +
  12 public inputs**. The 13th input, `salt`, is the only private input.

## Input signals — exact names & encodings (step 3 discovery)

Signal names are **not** stored as strings in the wasm, and no `.r1cs` is
published, so `r1cs info` is not an option. They were discovered through
the wasm's own witness-calculator interface: FNV-1a-64 hash of each
candidate name → `getInputSignalSize(hMSB, hLSB)` (script:
`build/discover.js`). All 13 competitor-reported camelCase names returned
size **1** (every signal is a scalar — no arrays); all snake_case variants
returned 0.

| Signal | Encoding used (verified in the witness) |
|---|---|
| `registeredVkHash` | 256-bit hash as hex string; stored as **hash mod BN254 p** (see surprises) |
| `proofVkHash` | same as above |
| `minimum` | integer (decimal string ok) |
| `publicBalance` | integer |
| `expiryBlock` | integer |
| `currentBlock` | integer |
| `recipient` | EVM address as an integer (hex string parsed); 160-bit, fits the field |
| `conditionRecipient` | same as above |
| `amount` | integer |
| `maxTransfer` | integer |
| `decision` | `1` = approve, `0` = reject |
| `taskId` | plain field element — a number in this test (see surprises) |
| `salt` | arbitrary field element, **private** (never appears in public signals) |

### Public-signals order (13 entries, mapped empirically)

`[0]` circuit output (commitment — see surprises) · `[1]` registeredVkHash ·
`[2]` proofVkHash · `[3]` minimum · `[4]` publicBalance · `[5]` expiryBlock ·
`[6]` currentBlock · `[7]` recipient · `[8]` conditionRecipient ·
`[9]` amount · `[10]` maxTransfer · `[11]` decision · `[12]` taskId

(Order of [1] vs [2] was pinned by a variant run with distinct values
111111 / 222222.)

## Proof generation (step 3) — the known-valid scenario

Inputs: registeredVkHash = proofVkHash = the circuit-info vkHash,
minimum 1000, publicBalance 1460, amount 500, maxTransfer 1000,
recipient = conditionRecipient = `0x742d35Cc6634C0532925a3b844Bc454e4438f44e`,
expiryBlock 8430000, currentBlock 8420000, decision 1, taskId 24901,
salt 98765432123456789. (Full input in `build/input.json`, driver in
`build/prove.js` using the snarkjs JS API — the production-relevant path.)

- **`groth16.fullProve` time: 893.1 ms (0.893 s)** — witness + proof, in-process.
- Proof size: **724 bytes** as compact JSON (856 bytes pretty-printed in
  `build/proof.json`; the competitor's 804-byte figure is the same object
  under different formatting/values).

## Verification (step 4)

- JS API `groth16.verify(vk, publicSignals, proof)` → **true** (87.4 ms).
- CLI cross-check: `npx snarkjs groth16 verify build/verification_key.json
  build/public.json build/proof.json` → **`[INFO] snarkJS: OK!`** ✅

## Extra spot-checks

- **Trap provability:** a VK_SUBSTITUTION-style witness (registeredVkHash
  111111 ≠ proofVkHash 222222, decision 0) also proves and verifies — the
  circuit does not force approve-only witnesses, so rejection proofs for
  trap tasks are generatable the same way.
- **Output commitment behaviour:** `publicSignals[0]` changes when `salt`
  or `taskId` changes, and does **not** change when the VK hashes,
  `decision`, or `amount` change — consistent with a task-binding
  commitment/hash over (taskId, salt). It is an output, not an input;
  phase 2 does not need to compute it, only to pass the proof through.

## Surprises

1. **The 256-bit vkHash does not fit in one BN254 field element** — yet the
  signal is a single scalar. The tooling silently reduces it mod p:
  `0x6b79…d77b0 mod p = 4836144126773920907502496244340012141761656471453348073975163706578152814510`,
  which is exactly what landed in the witness (verified numerically).
   Phase 2 must apply the identical reduction when comparing/submitting
   public signals (pass the hex string to snarkjs and it happens
   automatically; hand-rolled code must mod by
   p = 21888242871839275222246405745257275088548364400416034343698204186575808495617).
2. **`salt` is the only private input**, and there is a 13th public signal
   (the output commitment) that the competitor's "13 input signals" list
   doesn't mention — their 13 were inputs; the public-signals array is
   output + 12 public inputs.
3. **`taskId` is a bare field element in the circuit**, while platform task
   envelopes carry string ids like `"gk_24_9d1"`. How the platform maps
   its string task_id to this field element (numeric suffix? hash?) is
   **not determinable locally** — a phase-2/practice-mode question, same
   category as the HMAC-encoding gap in SPEC.md §7.
4. `recipient` needs no special packing — a plain address integer works.

## Feasibility conclusion

Local proving ≈ **0.9 s** worst-case on this shared VM, leaving ~59 s of
the 60 s response window for the Kurier submit + status polling round-trip.
**Proving is not the bottleneck.** The remaining timing risk is exactly the
one flagged in SPEC.md §7.4 — zkVerify mainnet finalization latency via
Kurier — which phase 1 was not permitted to test (no Kurier sign-up).
Recommendation for phase 2: measure Kurier submit→Finalized latency in
practice mode before the first scored round we contest (Round 03, 15 Nov,
17:30 WIB).

## Files

- `circuits/gatekeeper.wasm`, `circuits/gatekeeper_final.zkey` — official artifacts
- `circuit-info.json` — raw `/api/circuit-info` response
- `build/discover.js` — signal-name discovery via the wasm FNV interface
- `build/input.json` — the known-valid scenario inputs
- `build/prove.js` — timed fullProve + verify driver
- `build/proof.json`, `build/public.json`, `build/verification_key.json` — outputs
