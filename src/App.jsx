import { useEffect, useState } from "react";
import { BrowserProvider, Contract } from "ethers";

const BALANCE_ACCESS_ADDRESS = import.meta.env.VITE_BALANCE_ACCESS_ADDRESS;
const EXPECTED_CHAIN_ID = BigInt(import.meta.env.VITE_CHAIN_ID || "1"); // Mainnet by default

// Pick the right Etherscan base URL depending on chainId
const ETHERSCAN_BASE =
  EXPECTED_CHAIN_ID === 1n
    ? "https://etherscan.io"
    : EXPECTED_CHAIN_ID === 11155111n
    ? "https://sepolia.etherscan.io"
    : "https://etherscan.io";

// Minimal ABI for BalanceAccessPass
const BALANCE_ACCESS_ABI = [
  "function currentRoot() view returns (uint256)",
  "function requiredThreshold() view returns (uint256)",
  "function proveAndConsume(uint256[2] _pA, uint256[2][2] _pB, uint256[2] _pC, uint256[2] _pubSignals) external",
  "event AccessGranted(address indexed caller, bytes32 nullifier, uint256 root)",
];

function App() {
  const [account, setAccount] = useState(null);
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [networkOk, setNetworkOk] = useState(false);

  const [currentRoot, setCurrentRoot] = useState(null);
  const [threshold, setThreshold] = useState(null);

  const [status, setStatus] = useState("");
  const [txHash, setTxHash] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  // Recent AccessGranted events
  const [accessEvents, setAccessEvents] = useState([]);

  // Helper: get the real Ethereum provider (MetaMask if possible)
  const getEthereumProvider = () => {
    if (typeof window === "undefined") return null;
    const eth = window.ethereum;
    if (!eth) return null;

    // Multi-provider case: try to locate MetaMask
    const candidates = new Set();
    candidates.add(eth);

    if (Array.isArray(eth.providers)) {
      eth.providers.forEach((p) => {
        if (p) candidates.add(p);
        if (Array.isArray(p.providers)) {
          p.providers.forEach((pp) => pp && candidates.add(pp));
        }
        if (p.providerMap && typeof p.providerMap.values === "function") {
          for (const v of p.providerMap.values()) {
            if (v) candidates.add(v);
          }
        }
      });
    }

    const all = Array.from(candidates);
    console.log("ethereum provider candidates:", all);

    const metamask = all.find((p) => p.isMetaMask);
    if (metamask) {
      console.log("→ Using MetaMask provider");
      return metamask;
    }

    console.log("→ No isMetaMask provider found, fallback to window.ethereum");
    return eth;
  };

  // Connect wallet
  const connectWallet = async () => {
    try {
      setError(null);
      setStatus("");

      const eth = getEthereumProvider();
      if (!eth) {
        alert("No Ethereum provider detected. Please install MetaMask.");
        return;
      }

      console.log("Provider used for connection:", eth);

      const accounts = await eth.request({ method: "eth_requestAccounts" });
      if (!accounts || accounts.length === 0) {
        throw new Error("No account returned by wallet");
      }

      const addr = accounts[0];

      const chainIdHex = await eth.request({ method: "eth_chainId" });
      const chainIdBig = BigInt(chainIdHex);

      console.log("✅ Accounts:", accounts);
      console.log("✅ chainId (hex):", chainIdHex, "=>", chainIdBig.toString());

      const prov = new BrowserProvider(eth);
      const s = await prov.getSigner();

      setProvider(prov);
      setSigner(s);
      setAccount(addr);
      setChainId(chainIdBig);

      if (chainIdBig === EXPECTED_CHAIN_ID) {
        setNetworkOk(true);
        setStatus("");
      } else {
        setNetworkOk(false);
        setStatus(
          `Wrong network: current chainId = ${chainIdBig}, expected = ${EXPECTED_CHAIN_ID}`
        );
      }
    } catch (e) {
      console.error("❌ connectWallet error:", e);
      setError(e.message || String(e));
    }
  };

  // Load root + threshold once we have a signer
  useEffect(() => {
    const loadContractState = async () => {
      if (!signer || !BALANCE_ACCESS_ADDRESS) return;
      try {
        const contract = new Contract(
          BALANCE_ACCESS_ADDRESS,
          BALANCE_ACCESS_ABI,
          signer
        );
        const root = await contract.currentRoot();
        const thr = await contract.requiredThreshold();
        setCurrentRoot(root);
        setThreshold(thr);
      } catch (e) {
        console.error(e);
        setError(e.message || String(e));
      }
    };
    loadContractState();
  }, [signer]);

  // Listen to AccessGranted events in real time
  useEffect(() => {
    if (!signer || !BALANCE_ACCESS_ADDRESS) return;

    const contract = new Contract(
      BALANCE_ACCESS_ADDRESS,
      BALANCE_ACCESS_ABI,
      signer
    );

    const handler = (caller, nullifier, root, event) => {
      const txHash = event.log?.transactionHash;
      const blockNumber = event.log?.blockNumber;

      setAccessEvents((prev) => {
        const next = [
          {
            caller,
            nullifier,
            root,
            txHash,
            blockNumber,
          },
          ...prev,
        ];
        // keep only latest 5 events
        return next.slice(0, 5);
      });
    };

    console.log("📡 Subscribing to AccessGranted events...");
    contract.on("AccessGranted", handler);

    return () => {
      console.log("🧹 Removing AccessGranted listeners");
      contract.removeAllListeners("AccessGranted");
    };
  }, [signer]);

  // Submit ZK proof
  const handleProveAndConsume = async () => {
    try {
      setError(null);
      setTxHash(null);
      setStatus("");
      setLoading(true);

      if (!signer || !provider) {
        throw new Error("Wallet not connected");
      }
      if (!networkOk) {
        throw new Error("Wrong network (must be Ethereum mainnet for now).");
      }
      if (!BALANCE_ACCESS_ADDRESS) {
        throw new Error("VITE_BALANCE_ACCESS_ADDRESS is not defined in .env");
      }

      const proofRes = await fetch("/balance_proof.json");
      const pubRes = await fetch("/balance_public.json");
      if (!proofRes.ok || !pubRes.ok) {
        throw new Error(
          "Unable to load balance_proof.json / balance_public.json"
        );
      }
      const proof = await proofRes.json();
      const pub = await pubRes.json();

      if (!Array.isArray(pub) || pub.length !== 2) {
        throw new Error(
          `balance_public.json must contain 2 values [root, nullifierHash], got ${pub.length}`
        );
      }

      const toBig = (x) => BigInt(x);

      const a = [toBig(proof.pi_a[0]), toBig(proof.pi_a[1])];
      const b = [
        [toBig(proof.pi_b[0][1]), toBig(proof.pi_b[0][0])],
        [toBig(proof.pi_b[1][1]), toBig(proof.pi_b[1][0])],
      ];
      const c = [toBig(proof.pi_c[0]), toBig(proof.pi_c[1])];
      const input = pub.map(toBig);
      const pubSignals = [input[0], input[1]];

      console.log("Proof inputs:", { a, b, c, pubSignals });

      const contract = new Contract(
        BALANCE_ACCESS_ADDRESS,
        BALANCE_ACCESS_ABI,
        signer
      );

      setStatus("Sending transaction...");
      const tx = await contract.proveAndConsume(a, b, c, pubSignals);
      setTxHash(tx.hash);
      setStatus("Transaction sent, waiting for confirmation...");

      const receipt = await tx.wait();
      setStatus(`Access granted! Block #${receipt.blockNumber}`);
    } catch (e) {
      console.error(e);

      // Friendly error mapping
      let friendly = e?.reason || e?.shortMessage || e?.message || String(e);

      if (
        friendly.includes("Nullifier already used") ||
        String(e).includes("Nullifier already used")
      ) {
        friendly =
          "This ZK pass has already been used. Each proof can only be consumed once.";
      }

      setError(friendly);
      setStatus("Proof / transaction failed.");
    } finally {
      setLoading(false);
    }
  };

  const shortAddr = (addr) =>
    addr ? addr.slice(0, 6) + "..." + addr.slice(-4) : "";

  const shortHex = (value) => {
    if (!value) return "";
    const hex =
      typeof value === "bigint"
        ? "0x" + value.toString(16)
        : value.toString();
    if (hex.length <= 14) return hex;
    return hex.slice(0, 8) + "..." + hex.slice(-6);
  };

  const networkLabel =
    chainId === null
      ? "Network not detected"
      : chainId === 1n
      ? "Ethereum Mainnet"
      : chainId === 11155111n
      ? "Sepolia Testnet"
      : `ChainId ${chainId}`;

  // --- UI tokens (aligned with PXP-102) ---
  const ui = {
    pageRadial:
      "radial-gradient(circle at top, rgba(75,239,160,0.10), transparent 55%), #101010",
    textPrimary: "#e2e8f0", // slate-200
    textSecondary: "rgba(148,163,184,0.85)", // slate-400-ish
    textMuted: "rgba(100,116,139,0.9)", // slate-500-ish

    cardBg: "rgba(0,0,0,0.40)", // PXP-102 style
    cardBgStrong: "rgba(0,0,0,0.55)",
    borderSubtle: "1px solid rgba(148,163,184,0.18)",
    borderStrong: "1px solid rgba(148,163,184,0.26)",
    shadow: "0 24px 80px rgba(0,0,0,0.60)",

    radiusLg: "16px",
    radiusXl: "20px",
    radius2xl: "24px",

    privacyx: "#4befa0",
    privacyxDark: "#020617",
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100vw",
        boxSizing: "border-box",
        background: ui.pageRadial,
        color: ui.textPrimary,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "24px 16px",
      }}
    >
      <div
        style={{
          maxWidth: "1152px",
          width: "100%",
          borderRadius: ui.radius2xl,
          padding: "20px",
          background: ui.cardBg,
          border: ui.borderSubtle,
          boxShadow: ui.shadow,
          backdropFilter: "blur(6px)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "16px",
            marginBottom: "22px",
            alignItems: "flex-start",
            flexWrap: "wrap",
          }}
        >
          {/* Logo + title */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "12px",
            }}
          >
            <div
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "14px",
                background: ui.cardBgStrong,
                border: ui.borderSubtle,
                boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                marginTop: "2px",
              }}
            >
              <img
                src="/logo-PRVX-copy.png"
                alt="PrivacyX Logo"
                style={{
                  maxWidth: "26px",
                  maxHeight: "26px",
                  display: "block",
                }}
              />
            </div>

            <div>
              <h1
                style={{
                  fontSize: "18px",
                  fontWeight: 600,
                  margin: 0,
                  lineHeight: "1.15",
                  letterSpacing: "-0.01em",
                }}
              >
                PXP-101 : Privacyx Balance Pass (ZK Access)
              </h1>
              <p
                style={{
                  fontSize: "12px",
                  color: ui.textSecondary,
                  marginTop: "6px",
                  maxWidth: "680px",
                }}
              >
                Prove that you meet the balance requirement without revealing your
                address or exact holdings.
              </p>

              <div
                style={{
                  marginTop: "10px",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "11px",
                  color: networkOk ? ui.privacyx : "rgba(248,113,113,0.95)",
                }}
              >
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "999px",
                    backgroundColor: networkOk ? ui.privacyx : "rgba(248,113,113,0.95)",
                  }}
                />
                <span>{networkLabel}</span>
              </div>
            </div>
          </div>

          {/* Wallet + links */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: "6px",
              flexShrink: 0,
              width: "100%",
              maxWidth: "420px",
            }}
          >
            {/* Row 1: Connect + Etherscan */}
            <div
              style={{
                display: "flex",
                gap: "8px",
                justifyContent: "flex-end",
                flexWrap: "wrap",
                width: "100%",
              }}
            >
              <button
                onClick={connectWallet}
                style={{
                  padding: "6px 12px",
                  borderRadius: "999px",
                  border: account
                    ? "1px solid rgba(75,239,160,0.35)"
                    : ui.borderSubtle,
                  background: account ? "rgba(75,239,160,0.10)" : ui.privacyx,
                  color: account ? ui.privacyx : ui.privacyxDark,
                  fontSize: "11px",
                  fontWeight: 600,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  boxShadow: account
                    ? "none"
                    : "0 10px 30px rgba(75,239,160,0.18)",
                }}
              >
                {account ? shortAddr(account) : "Connect Wallet"}
              </button>

              {BALANCE_ACCESS_ADDRESS && (
                <a
                  href={`${ETHERSCAN_BASE}/address/${BALANCE_ACCESS_ADDRESS}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    fontSize: "11px",
                    padding: "6px 10px",
                    borderRadius: "999px",
                    border: ui.borderSubtle,
                    color: ui.textPrimary,
                    textDecoration: "none",
                    background: ui.cardBgStrong,
                    whiteSpace: "nowrap",
                  }}
                >
                  View contract on Etherscan
                </a>
              )}
            </div>

            {/* Row 2: Spec + Integrate */}
            <div
              style={{
                display: "flex",
                gap: "8px",
                justifyContent: "flex-end",
                flexWrap: "wrap",
                width: "100%",
              }}
            >
              <a
                href="https://github.com/Privacyx-org/privacyx-balance-pass/blob/main/PXP-101.md"
                target="_blank"
                rel="noreferrer"
                style={{
                  fontSize: "11px",
                  padding: "6px 10px",
                  borderRadius: "999px",
                  border: ui.borderSubtle,
                  color: ui.textPrimary,
                  textDecoration: "none",
                  background: ui.cardBgStrong,
                  whiteSpace: "nowrap",
                }}
              >
                View PXP-101 spec
              </a>

              <a
                href="#integrate"
                style={{
                  fontSize: "11px",
                  padding: "6px 10px",
                  borderRadius: "999px",
                  border: "none",
                  color: ui.privacyxDark,
                  textDecoration: "none",
                  background: ui.privacyx,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  boxShadow: "0 10px 30px rgba(75,239,160,0.16)",
                }}
              >
                Integrate in your dApp
              </a>
            </div>
          </div>
        </div>

        {/* Contract info */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "16px",
            marginBottom: "22px",
          }}
        >
          <div
            style={{
              padding: "16px",
              borderRadius: ui.radiusLg,
              background: ui.cardBg,
              border: ui.borderSubtle,
            }}
          >
            <div style={{ fontSize: "12px", color: ui.textSecondary }}>
              Merkle Root (on-chain)
            </div>
            <div
              style={{
                fontSize: "11px",
                marginTop: "8px",
                wordBreak: "break-all",
                color: ui.textPrimary,
              }}
            >
              {currentRoot ? currentRoot.toString() : "—"}
            </div>
          </div>

          <div
            style={{
              padding: "16px",
              borderRadius: ui.radiusLg,
              background: ui.cardBg,
              border: ui.borderSubtle,
            }}
          >
            <div style={{ fontSize: "12px", color: ui.textSecondary }}>
              Required threshold
            </div>
            <div
              style={{
                fontSize: "20px",
                fontWeight: 700,
                marginTop: "8px",
                color: ui.privacyx,
                letterSpacing: "-0.01em",
              }}
            >
              {threshold ? threshold.toString() : "—"}
            </div>
            <div
              style={{
                fontSize: "11px",
                color: ui.textSecondary,
                marginTop: "4px",
              }}
            >
              (minimum off-chain balance required to qualify)
            </div>
          </div>
        </div>

        {/* Action + recent events */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 3fr) minmax(0, 2fr)",
            gap: "16px",
            marginBottom: "22px",
          }}
        >
          {/* Action zone */}
          <div
            style={{
              padding: "16px",
              borderRadius: ui.radiusLg,
              background: ui.cardBg,
              border: ui.borderSubtle,
            }}
          >
            <h2
              style={{
                fontSize: "15px",
                fontWeight: 600,
                marginBottom: "8px",
                letterSpacing: "-0.01em",
              }}
            >
              1. Submit your ZK proof
            </h2>
            <p
              style={{
                fontSize: "13px",
                color: ui.textSecondary,
                marginBottom: "12px",
                lineHeight: "1.6",
              }}
            >
              This demo loads a pre-computed proof from{" "}
              <code style={{ color: ui.textPrimary, opacity: 0.9 }}>
                /balance_proof.json
              </code>{" "}
              and{" "}
              <code style={{ color: ui.textPrimary, opacity: 0.9 }}>
                /balance_public.json
              </code>
              , then calls{" "}
              <code style={{ color: ui.textPrimary, opacity: 0.9 }}>
                proveAndConsume
              </code>{" "}
              on the BalanceAccessPass contract.
            </p>

            <button
              onClick={handleProveAndConsume}
              disabled={loading || !account}
              style={{
                padding: "10px 18px",
                borderRadius: "999px",
                border: "none",
                background:
                  loading || !account
                    ? "rgba(148,163,184,0.30)"
                    : ui.privacyx,
                color: ui.privacyxDark,
                fontSize: "13px",
                fontWeight: 800,
                cursor: loading || !account ? "not-allowed" : "pointer",
                marginTop: "6px",
                boxShadow:
                  loading || !account
                    ? "none"
                    : "0 12px 30px rgba(75,239,160,0.14)",
              }}
            >
              {loading
                ? "Submitting proof..."
                : account
                ? "Submit ZK Access Proof"
                : "Connect your wallet first"}
            </button>

            {status && (
              <div
                style={{
                  marginTop: "12px",
                  fontSize: "13px",
                  color: status.startsWith("Access") ? ui.privacyx : ui.textPrimary,
                }}
              >
                {status}
              </div>
            )}

            {txHash && (
              <div
                style={{
                  marginTop: "8px",
                  fontSize: "11px",
                  color: ui.textSecondary,
                  wordBreak: "break-all",
                }}
              >
                Tx hash:{" "}
                <a
                  href={`${ETHERSCAN_BASE}/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: ui.textSecondary, textDecoration: "underline" }}
                >
                  {txHash}
                </a>
              </div>
            )}

            {error && (
              <div
                style={{
                  marginTop: "12px",
                  fontSize: "12px",
                  color: "rgba(248,113,113,0.95)",
                }}
              >
                ⚠️ {error}
              </div>
            )}
          </div>

          {/* Recent AccessGranted events */}
          <div
            style={{
              padding: "16px",
              borderRadius: ui.radiusLg,
              background: ui.cardBg,
              border: ui.borderSubtle,
            }}
          >
            <h2
              style={{
                fontSize: "14px",
                fontWeight: 600,
                marginBottom: "8px",
                letterSpacing: "-0.01em",
              }}
            >
              2. Recent ZK access (on-chain)
            </h2>
            <p
              style={{
                fontSize: "12px",
                color: ui.textSecondary,
                marginBottom: "10px",
                lineHeight: "1.6",
              }}
            >
              Live view of <code style={{ color: ui.textPrimary, opacity: 0.9 }}>
                AccessGranted
              </code>{" "}
              events emitted by the BalanceAccessPass contract.
            </p>

            {accessEvents.length === 0 && (
              <div
                style={{
                  fontSize: "12px",
                  color: ui.textMuted,
                  fontStyle: "italic",
                }}
              >
                No access events recorded yet in this session.
              </div>
            )}

            {accessEvents.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  maxHeight: "180px",
                  overflowY: "auto",
                }}
              >
                {accessEvents.map((ev, idx) => (
                  <div
                    key={`${ev.txHash || "local"}-${idx}`}
                    style={{
                      padding: "8px 10px",
                      borderRadius: "12px",
                      background: ui.cardBgStrong,
                      border: ui.borderSubtle,
                      fontSize: "11px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: "4px",
                      }}
                    >
                      <span style={{ color: ui.privacyx, fontWeight: 700 }}>
                        Access granted
                      </span>
                      {ev.blockNumber && (
                        <span style={{ color: ui.textSecondary }}>
                          Block #{ev.blockNumber}
                        </span>
                      )}
                    </div>
                    <div style={{ color: ui.textSecondary }}>
                      Caller: {shortAddr(ev.caller)}
                    </div>
                    <div style={{ color: ui.textSecondary }}>
                      Nullifier: {shortHex(ev.nullifier)}
                    </div>
                    <div style={{ color: ui.textSecondary }}>
                      Root: {shortHex(ev.root)}
                    </div>
                    {ev.txHash && (
                      <div style={{ marginTop: "2px" }}>
                        <a
                          href={`${ETHERSCAN_BASE}/tx/${ev.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            color: ui.textSecondary,
                            textDecoration: "underline",
                          }}
                        >
                          View tx on Etherscan
                        </a>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Integration section */}
        <div
          id="integrate"
          style={{
            marginTop: "8px",
            padding: "16px",
            borderRadius: ui.radiusLg,
            background: ui.cardBg,
            border: ui.borderStrong,
          }}
        >
          <h2
            style={{
              fontSize: "15px",
              fontWeight: 600,
              marginBottom: "8px",
              letterSpacing: "-0.01em",
            }}
          >
            3. Integration guide (PXP-101)
          </h2>
          <p
            style={{
              fontSize: "13px",
              color: ui.textSecondary,
              marginBottom: "10px",
              lineHeight: "1.6",
            }}
          >
            Use PXP-101 as a plug-and-play balance-based privacy gate in your dApp or
            protocol. You can start with event-based integration, direct on-chain
            checks, or via the official Privacyx SDK.
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "14px",
              marginTop: "4px",
            }}
          >
            {/* Off-chain */}
            <div>
              <h3
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  marginBottom: "6px",
                }}
              >
                Option A: Off-chain / backend
              </h3>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: "16px",
                  fontSize: "12px",
                  color: ui.textSecondary,
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                  lineHeight: "1.6",
                }}
              >
                <li>
                  Let users complete the ZK flow via{" "}
                  <a
                    href="https://pass.privacyx.tech"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: ui.textPrimary, textDecoration: "underline" }}
                  >
                    pass.privacyx.tech
                  </a>
                  .
                </li>
                <li>
                  Monitor <code style={{ color: ui.textPrimary, opacity: 0.9 }}>
                    AccessGranted
                  </code>{" "}
                  events on{" "}
                  <code style={{ color: ui.textPrimary, opacity: 0.9 }}>
                    0x8333b589ad3A8A5fCe735631e8EDf693C6AE0472
                  </code>
                  .
                </li>
                <li>
                  Use <code style={{ color: ui.textPrimary, opacity: 0.9 }}>
                    caller
                  </code>
                  ,{" "}
                  <code style={{ color: ui.textPrimary, opacity: 0.9 }}>
                    nullifier
                  </code>
                  , and{" "}
                  <code style={{ color: ui.textPrimary, opacity: 0.9 }}>
                    root
                  </code>{" "}
                  as inputs to your private access logic.
                </li>
              </ul>
            </div>

            {/* On-chain */}
            <div>
              <h3
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  marginBottom: "6px",
                }}
              >
                Option B: On-chain / contracts
              </h3>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: "16px",
                  fontSize: "12px",
                  color: ui.textSecondary,
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                  lineHeight: "1.6",
                }}
              >
                <li>
                  Consume <code style={{ color: ui.textPrimary, opacity: 0.9 }}>
                    AccessGranted
                  </code>{" "}
                  events or nullifiers as one-time tickets.
                </li>
                <li>
                  Gate features based on “has a valid PXP-101 pass” without
                  revealing balances.
                </li>
                <li>
                  Combine PXP-101 with your own on-chain logic or off-chain
                  checks (rate limits, allowlists, etc.).
                </li>
              </ul>
            </div>

            {/* SDK */}
            <div>
              <h3
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  marginBottom: "6px",
                }}
              >
                Option C: Via Privacyx SDK
              </h3>
              <p
                style={{
                  fontSize: "12px",
                  color: ui.textSecondary,
                  marginBottom: "6px",
                  lineHeight: "1.6",
                }}
              >
                Install the official SDK to read PXP-101 state and submit proofs
                with a simple API:
              </p>
              <pre
                style={{
                  fontSize: "11px",
                  background: ui.cardBgStrong,
                  borderRadius: "14px",
                  padding: "10px",
                  overflowX: "auto",
                  border: ui.borderSubtle,
                  margin: 0,
                }}
              >
                <code>npm install privacyx-sdk ethers</code>
              </pre>
              <p
                style={{
                  fontSize: "12px",
                  color: ui.textSecondary,
                  marginTop: "8px",
                  marginBottom: "6px",
                }}
              >
                Basic usage (Node / dApp):
              </p>
              <pre
                style={{
                  fontSize: "11px",
                  background: ui.cardBgStrong,
                  borderRadius: "14px",
                  padding: "10px",
                  overflowX: "auto",
                  border: ui.borderSubtle,
                  margin: 0,
                }}
              >
                <code>{`import { PrivacyX } from "privacyx-sdk";
import { JsonRpcProvider } from "ethers";

const provider = new JsonRpcProvider(MAINNET_RPC_URL);
const px = PrivacyX({
  chainId: 1,
  provider,
  balancePassAddress:
    "0x8333b589ad3a8a5fce735631e8edf693c6ae0472",
});

const root = await px.balancePass.getRoot();
const thr = await px.balancePass.getThreshold();`}</code>
              </pre>
            </div>
          </div>

          <div
            style={{
              marginTop: "12px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "8px",
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontSize: "11px",
                color: ui.textMuted,
              }}
            >
              Full specification: PXP-101 · Privacyx Balance Pass.
            </span>
            <div
              style={{
                display: "flex",
                gap: "8px",
                flexWrap: "wrap",
              }}
            >
              <a
                href="https://github.com/Privacyx-org/privacyx-balance-pass"
                target="_blank"
                rel="noreferrer"
                style={{
                  fontSize: "11px",
                  padding: "6px 10px",
                  borderRadius: "999px",
                  border: ui.borderSubtle,
                  color: ui.textPrimary,
                  textDecoration: "none",
                  background: ui.cardBgStrong,
                }}
              >
                View PXP-101 repo
              </a>
              <a
                href="https://www.npmjs.com/package/privacyx-sdk"
                target="_blank"
                rel="noreferrer"
                style={{
                  fontSize: "11px",
                  padding: "6px 10px",
                  borderRadius: "999px",
                  border: "none",
                  color: ui.privacyxDark,
                  textDecoration: "none",
                  background: ui.privacyx,
                  fontWeight: 700,
                  boxShadow: "0 10px 30px rgba(75,239,160,0.16)",
                }}
              >
                Open privacyx-sdk on npm
              </a>
            </div>
          </div>
        </div>

        {/* Small footer (visual parity with PXP-102) */}
        <div
          style={{
            marginTop: "18px",
            paddingTop: "12px",
            borderTop: ui.borderSubtle,
            display: "flex",
            flexWrap: "wrap",
            gap: "8px",
            justifyContent: "space-between",
            fontSize: "11px",
            color: ui.textMuted,
          }}
        >
          <span>Privacyx · Identity layer for Web3 anonymity.</span>
          <span style={{ opacity: 0.9 }}>PXP-101 · Balance pass · mainnet primitive</span>
        </div>
      </div>
    </div>
  );
}

export default App;

