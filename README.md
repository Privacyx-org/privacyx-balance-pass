# PXP-101: Privacyx Balance Pass

**Privacyx Balance Pass (PXP-101)** is a zero-knowledge access module that lets users prove
they meet an **off-chain balance threshold** without revealing their address or exact holdings.

This repository contains the **production frontend** for the PXP-101 reference implementation,
available live at:

👉 **https://pass.privacyx.tech**

---

## Overview

- **Standard**: PXP-101 — Privacyx Balance Pass  
- **Network**: Ethereum mainnet  
- **Contract (BalanceAccessPass)**: `0x8333b589ad3A8A5fCe735631e8EDf693C6AE0472`  
- **Verifier contract**: `0x34448D78DC8eA25AA6D8eeA46A61e963C1D3C982`  

PXP-101 allows:

- Users to obtain a **one-time zero-knowledge access pass** based on a balance threshold.
- Integrators to gate features based on **eligibility**, without doxxing users' balances or addresses.
- Protocols to consume **AccessGranted events** or nullifiers as **private access tickets**.

The on-chain standard is specified in detail in:

- [`PXP-101.md`](./PXP-101.md)

---

## Frontend: Privacyx Balance Pass dApp

This repo hosts the frontend used at https://pass.privacyx.tech

It provides:

- Wallet connection via MetaMask (mainnet by default).
- Display of current Merkle root and required threshold.
- A **"Submit ZK Access Proof"** button that:
  - Loads a pre-computed Groth16 proof from `/public/balance_proof.json`,
  - Calls `proveAndConsume(...)` on the mainnet `BalanceAccessPass` contract,
  - Shows transaction status, hash, and confirmation block.
- A live feed of recent `AccessGranted` events on the contract.
- An **integration section** describing how to plug PXP-101 into your backend or contracts.

---

## Getting started (local development)

### 1. Clone the repository

git clone https://github.com/Privacyx-org/privacyx-balance-pass.git
cd privacyx-balance-pass

### 2. Install dependencies

npm install

### 3. Configure environment

Create a .env file:

cat > .env << 'EOF'
VITE_BALANCE_ACCESS_ADDRESS=0x8333b589ad3a8a5fce735631e8edf693c6ae0472
VITE_CHAIN_ID=1
EOF

### 4. Run dev server

npm run dev

---

## On-chain interface (PXP-101)

The BalanceAccessPass exposes:

event AccessGranted(address indexed caller, bytes32 nullifier, uint256 root);

function currentRoot() external view returns (uint256);
function requiredThreshold() external view returns (uint256);

function proveAndConsume(
  uint256[2] calldata _pA,
  uint256[2][2] calldata _pB,
  uint256[2] calldata _pC,
  uint256[2] calldata _pubSignals // [root, nullifierHash]
) external;

---

## Integration options

### Option A — off-chain / backend (listen to events)

Monitor AccessGranted events on:
BalanceAccessPass (PXP-101): 0x8333b589ad3a8a5fce735631e8edf693c6ae0472

Use caller, nullifier, root as inputs to your access logic.

### Option B — On-chain / contracts

Consume AccessGranted events or the nullifier as a one-time ticket.
Gate features based on “has a valid PXP-101 pass” without revealing balances.

### Option C — Integrate via Privacyx SDK

The easiest way to integrate PXP-101 programmatically is via the Privacyx SDK:
npm: privacyx-sdk
repo: https://github.com/Privacyx-org/privacyx-sdk
   
---

## Install

npm install privacyx-sdk ethers
   
---

## Basic usage (Node / frontend with ethers v6)

import { PrivacyX } from "privacyx-sdk";
import { JsonRpcProvider } from "ethers";

const provider = new JsonRpcProvider(process.env.MAINNET_RPC_URL);

const px = PrivacyX({
  chainId: 1,
  provider,
  balancePassAddress: "0x8333b589ad3a8a5fce735631e8edf693c6ae0472",
});

// Read values
const root = await px.balancePass.getRoot();
const threshold = await px.balancePass.getThreshold();

// Submit proof (example: server-side or in a dApp with a signer)
const receipt = await px.balancePass.submitProof(signer, proof, [
  rootValue,
  nullifierHash,
]);

// Listen to events
px.balancePass.onAccessGranted((ev) => {
  console.log("ZK Access:", ev);
});

PXP-101 is the first module in the Privacyx standard family:
PXP-101 — Balance Pass (implemented)
PXP-102 — Identity Pass (planned)
PXP-103 — Reputation Pass (planned)

---

## Related documents

PXP-101.md  
https://pass.privacyx.tech  
https://www.privacyx.tech  

---

## License

MIT

