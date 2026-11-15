// Create a fresh throwaway EVM wallet for the Agent Games competition.
// Saves key material to ../wallet.json (mode 600). Prints ONLY the address.
const fs = require("fs");
const path = require("path");
const { Wallet } = require("ethers");

const out = path.join(__dirname, "..", "wallet.json");
if (fs.existsSync(out)) {
  const existing = JSON.parse(fs.readFileSync(out, "utf8"));
  console.log("wallet.json already exists, address:", existing.address);
  process.exit(0);
}

const w = Wallet.createRandom();
const data = {
  address: w.address,
  privateKey: w.privateKey,
  mnemonic: w.mnemonic ? w.mnemonic.phrase : null,
  createdAt: new Date().toISOString(),
  purpose: "zkVerify Agent Games competitor account (throwaway, no funds)",
};
fs.writeFileSync(out, JSON.stringify(data, null, 2), { mode: 0o600 });
fs.chmodSync(out, 0o600);
console.log("created wallet, address:", w.address);
