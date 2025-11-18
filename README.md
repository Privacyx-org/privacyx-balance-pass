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

PXP-101.md

---

## Frontend: Privacyx Balance Pass dApp

This repo hosts the frontend used at https://pass.privacyx.tech

It provides:

- A wallet connection via MetaMask (mainnet by default).
- Display of current Merkle root and required threshold.
- A "Submit ZK Access Proof" button that:
  - Loads a pre-computed Groth16 proof from /public/balance_proof.json,
  - Calls proveAndConsume(...) on the mainnet BalanceAccessPass contract,
  - Shows transaction status, hash, and confirmation block.
- A live feed of recent AccessGranted events on the contract.

---

## Getting started (local development)

### 1. Clone the repository

git clone https://github.com/Privacyx-org/privacyx-balance-pass.git
cd privacyx-balance-pass

### 2. Install dependencies

npm install

### 3. Configure environment

Create a .env file:

cat > .env << 'EOF2'
VITE_BALANCE_ACCESS_ADDRESS=0x8333b589ad3a8a5fce735631e8edf693c6ae0472
VITE_CHAIN_ID=1
EOF2

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
  uint256[2] calldata _pubSignals
) external;

---

## Integration guide

### Option A — off-chain

Monitor AccessGranted events on the contract:
0x8333b589ad3A8A5fCe735631e8EDf693C6AE0472

Use caller, nullifier, root for your access logic.

### Option B — on-chain

Require that the caller has successfully proved via PXP-101.

---

## Future: PrivacyX SDK

import { createPrivacyxClient } from "@privacyx/sdk";

const px = createPrivacyxClient({
  chainId: 1,
  balancePassAddress: "0x8333b5...0472",
});

---

## Related documents

PXP-101.md  
https://pass.privacyx.tech  
https://www.privacyx.tech  

---

## License

TBD — provided “as is”.

