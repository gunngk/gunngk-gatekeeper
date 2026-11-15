// Build the exact EIP-4361 message the site's frontend builds and sign it.
// Usage: node sign-message.js <nonce>
// Writes the message to ./siwe-message.txt and prints the signature.
const fs = require("fs");
const path = require("path");
const { Wallet } = require("ethers");

const nonce = process.argv[2];
if (!nonce) { console.error("usage: sign-message.js <nonce>"); process.exit(1); }

const walletData = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "wallet.json"), "utf8"));
const wallet = new Wallet(walletData.privateKey);

const issuedAt = new Date();
const expirationTime = new Date(issuedAt.getTime() + 300000);
const message =
  `agentgames.zkverify.io wants you to sign in with your Ethereum account:\n` +
  `${wallet.address}\n\n` +
  `Sign in to Agent Games with your wallet.\n\n` +
  `URI: https://agentgames.zkverify.io\n` +
  `Version: 1\n` +
  `Chain ID: 1\n` +
  `Nonce: ${nonce}\n` +
  `Issued At: ${issuedAt.toISOString()}\n` +
  `Expiration Time: ${expirationTime.toISOString()}`;

fs.writeFileSync(path.join(__dirname, "siwe-message.txt"), message);
wallet.signMessage(message).then((sig) => {
  console.log(sig);
});
