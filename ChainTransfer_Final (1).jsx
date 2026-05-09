import { useState, useEffect, useRef, useCallback } from "react";

// ═══════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════
const fmtBytes = (n) => {
  if (!n && n !== 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
};
const fmtTime = (ts) =>
  new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const uid = () => Math.random().toString(36).slice(2, 10);
const rndHex = (n = 40) =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");

const sha256sim = (str) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (Math.imul(h, 0x01000193) >>> 0);
  }
  return (h >>> 0).toString(16).padStart(8, "0").repeat(8).slice(0, 64);
};

// ═══════════════════════════════════════════════
// MOCK BLOCKCHAIN  (Proof-of-Work)
// ═══════════════════════════════════════════════
function mkBlockchain() {
  const mine = (idx, ts, data, prev) => {
    let nonce = 0, hash;
    do {
      const raw = `${idx}|${ts}|${JSON.stringify(data)}|${prev}|${nonce++}`;
      hash = sha256sim(raw) + sha256sim(raw.split("").reverse().join(""));
      hash = hash.slice(0, 64);
    } while (!hash.startsWith("0"));
    return { hash, nonce: nonce - 1 };
  };
  const genesis = (() => {
    const ts = Date.now() - 200000;
    const { hash, nonce } = mine(0, ts, "Genesis", "0000000000000000");
    return { index: 0, timestamp: ts, data: "Genesis Block", prevHash: "0000000000000000", hash, nonce, btype: "GENESIS" };
  })();
  const chain = [genesis];
  return {
    getChain: () => [...chain],
    isValid() {
      for (let i = 1; i < chain.length; i++)
        if (chain[i].prevHash !== chain[i - 1].hash) return false;
      return true;
    },
    addBlock(data, btype = "DATA") {
      const prev = chain[chain.length - 1];
      const ts = Date.now();
      const { hash, nonce } = mine(prev.index + 1, ts, data, prev.hash);
      const blk = { index: prev.index + 1, timestamp: ts, data, prevHash: prev.hash, hash, nonce, btype };
      chain.push(blk);
      return blk;
    },
    addIdentity: function(username, address, pubkey) {
      return this.addBlock({ type: "IDENTITY", username, address, pubkey, ts: Date.now() }, "IDENTITY");
    },
    addFileHash: function(fileId, hash, filename, size, uploader, aesKey, iv) {
      return this.addBlock({ type: "FILE_HASH", fileId, hash, filename, size, uploader, aesKey, iv, ts: Date.now() }, "FILE_HASH");
    },
    deployContract: function(name, addr, owner) {
      return this.addBlock({ type: "CONTRACT", name, addr, owner, abi: ["storeHash(bytes32)", "verifyHash(bytes32,bytes32)", "getOwner()"], ts: Date.now() }, "CONTRACT");
    },
    verify(fileId, hash) {
      const b = chain.find(b => b.data?.type === "FILE_HASH" && b.data.fileId === fileId);
      if (!b) return { ok: false, reason: "No record found on chain." };
      if (b.data.hash !== hash) return { ok: false, reason: "Hash mismatch — file may be tampered." };
      return { ok: true, block: b };
    },
  };
}

// ═══════════════════════════════════════════════
// MOCK IPFS
// ═══════════════════════════════════════════════
function mkIPFS() {
  const pins = new Map();
  return {
    pin(filename, size, hash) {
      const cid = "Qm" + rndHex(44).slice(0, 44);
      pins.set(cid, { filename, size, hash, cid, ts: Date.now() });
      return cid;
    },
    list: () => [...pins.values()],
  };
}

// ═══════════════════════════════════════════════
// MOCK IDENTITY REGISTRY (Smart Contract)
// ═══════════════════════════════════════════════
function mkRegistry(bc) {
  const CONTRACT = "0x" + rndHex(40);
  const users = new Map();
  const seed = (u, p) => {
    const addr = "0x" + rndHex(40);
    const pk = rndHex(64);
    users.set(u, { password: p, address: addr, pubkey: pk, createdAt: Date.now() - 60000 });
    bc.addIdentity(u, addr, pk);
  };
  seed("demo", "demo123");
  seed("alice", "alice123");
  seed("bob", "bob123");
  return {
    CONTRACT,
    register(u, p) {
      if (users.has(u)) return { success: false, error: "Username already registered on-chain." };
      const addr = "0x" + rndHex(40);
      const pk = rndHex(64);
      users.set(u, { password: p, address: addr, pubkey: pk, createdAt: Date.now() });
      bc.addIdentity(u, addr, pk);
      return { success: true, address: addr, pubkey: pk };
    },
    login(u, p) {
      const acc = users.get(u);
      if (!acc) return { success: false, error: "Account not found in contract registry." };
      if (acc.password !== p) return { success: false, error: "Invalid credentials." };
      return { success: true, address: acc.address, pubkey: acc.pubkey };
    },
    getAll: () => [...users.entries()].map(([u, v]) => ({ username: u, address: v.address, pubkey: v.pubkey, createdAt: v.createdAt })),
  };
}

// ─── Singletons ───────────────────────────────
const BC = mkBlockchain();
const IPFS = mkIPFS();
const CONTRACT_ADDR = "0x" + rndHex(40);
BC.deployContract("FileIntegrityVerifier", CONTRACT_ADDR, "0xDEPLOYER0000");
const REG = mkRegistry(BC);

// ═══════════════════════════════════════════════
// STATUS MAP
// ═══════════════════════════════════════════════
const ST = {
  hashing:         { label: "Hashing",        color: "#a78bfa", icon: "⟳" },
  encrypting:      { label: "Encrypting",      color: "#c084fc", icon: "🔒" },
  storing_chain:   { label: "On-chain",        color: "#818cf8", icon: "⛓" },
  ipfs_pin:        { label: "IPFS Pin",        color: "#a78bfa", icon: "📌" },
  awaiting:        { label: "Awaiting",        color: "#fbbf24", icon: "⏳" },
  connecting:      { label: "Connecting",      color: "#fbbf24", icon: "⊙" },
  sending:         { label: "Sending",         color: "#38bdf8", icon: "↑" },
  receiving:       { label: "Receiving",       color: "#38bdf8", icon: "↓" },
  decrypting:      { label: "Decrypting",      color: "#c084fc", icon: "🔓" },
  verifying:       { label: "Verifying",       color: "#818cf8", icon: "⬡" },
  verified:        { label: "Verified ✓",      color: "#34d399", icon: "✓" },
  tampered:        { label: "TAMPERED",        color: "#f87171", icon: "✗" },
  rejected:        { label: "Rejected",        color: "#f87171", icon: "✕" },
  pending:         { label: "Pending",         color: "#64748b", icon: "…" },
};

// ═══════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Syne+Mono&family=Syne:wght@400;500;600;700;800&display=swap');

*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

:root{
  --bg0:#060810;--bg1:#0a0d16;--bg2:#0f1421;--bg3:#151c2e;--bg4:#1a2338;
  --b1:rgba(99,179,237,0.12);--b2:rgba(99,179,237,0.07);
  --c:#63b3ed;--cd:rgba(99,179,237,0.15);
  --g:#34d399;--gd:rgba(52,211,153,0.12);
  --r:#f87171;--rd:rgba(248,113,113,0.12);
  --y:#fbbf24;--yd:rgba(251,191,36,0.1);
  --p:#a78bfa;--pd:rgba(167,139,250,0.12);
  --t:#e2e8f0;--t2:#94a3b8;--t3:#475569;
  --mono:'Syne Mono',monospace;--sans:'Syne',sans-serif;
  --r6:6px;--r10:10px;--r14:14px;
}

body{background:var(--bg0);color:var(--t);font-family:var(--sans);font-size:13px;line-height:1.5;overflow:hidden}
::-webkit-scrollbar{width:3px;height:3px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--bg4);border-radius:2px}

/* ── SCANLINE EFFECT ── */
body::after{
  content:'';position:fixed;inset:0;pointer-events:none;z-index:9999;
  background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.03) 2px,rgba(0,0,0,0.03) 4px);
}

/* ── AUTH ── */
.auth{
  min-height:100vh;display:flex;align-items:center;justify-content:center;
  background:
    radial-gradient(ellipse 70% 50% at 15% 50%,rgba(99,179,237,0.06) 0%,transparent 70%),
    radial-gradient(ellipse 50% 70% at 85% 30%,rgba(167,139,250,0.07) 0%,transparent 60%),
    var(--bg0);
}
.auth-card{
  width:400px;background:var(--bg1);
  border:1px solid var(--b1);border-radius:var(--r14);padding:44px 40px;
  box-shadow:0 0 80px rgba(99,179,237,0.05),0 32px 64px rgba(0,0,0,0.7);
  animation:up .5s cubic-bezier(.22,1,.36,1);
}
@keyframes up{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:none}}
.auth-logo{display:flex;flex-direction:column;align-items:center;gap:12px;margin-bottom:28px}
.auth-h{font-size:1.75rem;font-weight:800;letter-spacing:-.03em}
.auth-h span{color:var(--c)}
.auth-sub{color:var(--t3);font-size:.7rem;letter-spacing:.1em;text-align:center}
.tabs{display:flex;background:var(--bg2);border-radius:var(--r6);padding:3px;gap:3px;margin-bottom:22px;border:1px solid var(--b2)}
.tab{flex:1;padding:8px;border:none;background:none;color:var(--t3);font-family:var(--sans);font-size:.8rem;font-weight:600;border-radius:4px;cursor:pointer;transition:all .15s}
.tab.on{background:var(--bg3);color:var(--t);box-shadow:0 2px 8px rgba(0,0,0,0.3)}
.field{margin-bottom:13px}
.flabel{display:block;font-size:.65rem;text-transform:uppercase;letter-spacing:.1em;color:var(--t3);margin-bottom:5px}
.finput{width:100%;padding:10px 13px;background:var(--bg2);border:1px solid var(--b1);border-radius:var(--r6);color:var(--t);font-family:var(--sans);font-size:.85rem;outline:none;transition:border-color .15s}
.finput:focus{border-color:var(--c);box-shadow:0 0 0 3px rgba(99,179,237,0.08)}
.auth-btn{width:100%;margin-top:8px;padding:12px;border:none;border-radius:var(--r6);background:linear-gradient(135deg,var(--c),#2b7ab5);color:#000;font-family:var(--sans);font-weight:800;font-size:.88rem;cursor:pointer;transition:opacity .15s,transform .1s;letter-spacing:.02em}
.auth-btn:hover{opacity:.88}
.auth-btn:active{transform:scale(.98)}
.alert{margin-top:11px;padding:9px 13px;border-radius:var(--r6);font-size:.78rem;text-align:center}
.alert.err{background:var(--rd);color:var(--r);border:1px solid rgba(248,113,113,.2)}
.alert.info{background:var(--cd);color:var(--c);border:1px solid rgba(99,179,237,.18)}
.auth-hint{text-align:center;color:var(--t3);font-size:.7rem;margin-top:18px}
.auth-hint code{color:var(--c);font-family:var(--mono);background:var(--cd);padding:1px 6px;border-radius:3px}

/* ── SHELL ── */
.shell{display:flex;flex-direction:column;height:100vh;overflow:hidden}

/* ── HEADER ── */
.hdr{
  height:50px;flex-shrink:0;display:flex;align-items:center;gap:10px;
  padding:0 16px;background:var(--bg1);border-bottom:1px solid var(--b1);z-index:50;
}
.hdr-logo{display:flex;align-items:center;gap:8px}
.hdr-name{font-size:.95rem;font-weight:800;letter-spacing:-.02em}
.hdr-name span{color:var(--c)}
.vsep{width:1px;height:20px;background:var(--b1);margin:0 4px}
.chip{display:flex;align-items:center;gap:5px;background:var(--bg2);border:1px solid var(--b2);border-radius:20px;padding:3px 10px;font-family:var(--mono);font-size:.62rem;color:var(--t3)}
.dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
.dot.g{background:var(--g);box-shadow:0 0 5px var(--g);animation:pulse 2s ease infinite}
.dot.c{background:var(--c);box-shadow:0 0 5px var(--c);animation:pulse 2s ease infinite}
.dot.p{background:var(--p);box-shadow:0 0 5px var(--p)}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.hdr-r{margin-left:auto;display:flex;align-items:center;gap:8px}
.user-chip{display:flex;align-items:center;gap:7px;background:var(--bg2);border:1px solid var(--b1);border-radius:var(--r6);padding:4px 11px}
.uav{width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,var(--p),var(--c));display:flex;align-items:center;justify-content:center;font-size:.65rem;font-weight:800;color:#fff;flex-shrink:0}
.uname{font-size:.8rem;font-weight:600}
.uaddr{font-family:var(--mono);font-size:.6rem;color:var(--t3)}
.lout-btn{padding:5px 11px;border-radius:var(--r6);border:1px solid var(--b1);background:none;color:var(--t3);font-family:var(--sans);font-size:.72rem;cursor:pointer;transition:all .15s}
.lout-btn:hover{border-color:var(--r);color:var(--r)}

/* ── NAV ── */
.nav{display:flex;padding:0 16px;background:var(--bg1);border-bottom:1px solid var(--b1);flex-shrink:0}
.nbtn{padding:9px 14px;border:none;background:none;color:var(--t3);font-family:var(--sans);font-size:.75rem;font-weight:600;cursor:pointer;border-bottom:2px solid transparent;transition:all .15s;display:flex;align-items:center;gap:5px;letter-spacing:.02em}
.nbtn.on{color:var(--c);border-bottom-color:var(--c)}
.nbtn:hover:not(.on){color:var(--t)}
.ndot{width:5px;height:5px;border-radius:50%;background:var(--r);animation:pulse 1.2s ease infinite}

/* ── BODY / PAGE ── */
.body{flex:1;overflow:hidden}
.page{height:100%;overflow-y:auto;padding:14px}

/* ── DASHBOARD GRID ── */
.dgrid{display:grid;grid-template-columns:240px 1fr 1fr;grid-template-rows:1fr 1fr;gap:12px;height:100%}
.rspan{grid-row:span 2}

/* ── PANEL ── */
.panel{background:var(--bg1);border:1px solid var(--b1);border-radius:var(--r10);display:flex;flex-direction:column;overflow:hidden;min-height:0}
.phd{display:flex;align-items:center;gap:7px;padding:10px 13px 9px;border-bottom:1px solid var(--b2);flex-shrink:0}
.phd h3{font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--t3);flex:1}
.pbadge{font-family:var(--mono);font-size:.6rem;padding:2px 6px;border-radius:20px;background:var(--bg3);color:var(--t3)}
.pbadge.g{background:var(--gd);color:var(--g)}
.pbadge.c{background:var(--cd);color:var(--c)}
.pbadge.p{background:var(--pd);color:var(--p)}
.pbadge.r{background:var(--rd);color:var(--r)}
.pico{font-size:.8rem}
.pbody{flex:1;overflow-y:auto;padding:10px}

/* ── EMPTY ── */
.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;padding:32px 16px;text-align:center}
.eico{font-size:1.8rem;opacity:.18}
.ep{font-size:.78rem;color:var(--t3)}
.es{font-size:.68rem;color:var(--t3);opacity:.6}

/* ── PEERS ── */
.pi{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:var(--r6);border:1px solid transparent;margin-bottom:4px;transition:all .15s}
.pi:hover{background:var(--bg2);border-color:var(--b2)}
.pi.drag{border-color:var(--c);background:var(--cd)}
.pav{width:32px;height:32px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.8rem;color:#fff;background:linear-gradient(135deg,var(--p) 0%,#7c3aed 100%)}
.pname{font-size:.82rem;font-weight:600;display:block}
.ppid{font-family:var(--mono);font-size:.6rem;color:var(--t3);display:block}
.odot{width:5px;height:5px;border-radius:50%;background:var(--g);box-shadow:0 0 4px var(--g);flex-shrink:0}
.sndbtn{padding:3px 9px;border-radius:4px;border:1px solid var(--b1);background:none;color:var(--c);font-family:var(--mono);font-size:.65rem;cursor:pointer;transition:all .15s;white-space:nowrap}
.sndbtn:hover{background:var(--cd);border-color:var(--c)}
.drophint{font-size:.65rem;color:var(--t3);text-align:center;padding:7px;border-top:1px solid var(--b2);opacity:.55;flex-shrink:0}

/* ── UPLOADER ── */
.dz{border:2px dashed var(--b1);border-radius:var(--r10);padding:24px 14px;text-align:center;cursor:pointer;transition:all .15s;margin-bottom:11px}
.dz:hover,.dz.ov{border-color:var(--c);background:rgba(99,179,237,0.04)}
.dz.has{border-style:solid;border-color:rgba(99,179,237,.25)}
.dzico{font-size:2rem;margin-bottom:6px;opacity:.4}
.dztxt{font-size:.8rem;color:var(--t3)}
.dzsub{font-size:.68rem;color:var(--t3);opacity:.55;margin-top:2px}
.staged{display:flex;align-items:center;gap:9px}
.stagico{font-size:1.6rem}
.stagname{font-size:.8rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.stagmeta{font-size:.68rem;color:var(--t3);margin-top:1px}
.xbtn{margin-left:auto;width:20px;height:20px;border-radius:50%;border:1px solid var(--b1);background:none;color:var(--t3);cursor:pointer;font-size:.65rem;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s}
.xbtn:hover{border-color:var(--r);color:var(--r)}
.psel{width:100%;padding:8px 11px;border-radius:var(--r6);background:var(--bg2);border:1px solid var(--b1);color:var(--t);font-family:var(--sans);font-size:.82rem;outline:none;margin-bottom:8px}
.psel:focus{border-color:var(--c)}
.psel option{background:var(--bg2)}

/* toggle */
.toggle-row{display:flex;align-items:center;gap:8px;margin-bottom:9px}
.tog{position:relative;width:32px;height:17px;flex-shrink:0}
.tog input{opacity:0;width:0;height:0;position:absolute}
.togsl{position:absolute;inset:0;background:var(--bg3);border-radius:9px;cursor:pointer;transition:background .2s;border:1px solid var(--b1)}
.tog input:checked+.togsl{background:var(--g);border-color:var(--g)}
.togsl::after{content:'';position:absolute;width:11px;height:11px;left:2px;top:2px;background:#fff;border-radius:50%;transition:transform .2s}
.tog input:checked+.togsl::after{transform:translateX(15px)}
.toglab{font-size:.73rem;color:var(--t3)}
.toglab strong{color:var(--g)}

.bigbtn{width:100%;padding:11px;border-radius:var(--r6);border:none;background:linear-gradient(135deg,var(--c),#1a6a99);color:#000;font-family:var(--sans);font-weight:800;font-size:.85rem;cursor:pointer;transition:opacity .15s;display:flex;align-items:center;justify-content:center;gap:6px}
.bigbtn:disabled{opacity:.3;cursor:not-allowed}
.bigbtn:not(:disabled):hover{opacity:.88}
.secnote{font-size:.65rem;color:var(--t3);text-align:center;margin-top:6px}

/* chunk viz */
.cviz{margin-top:10px}
.clbl{font-family:var(--mono);font-size:.62rem;color:var(--t3);margin-bottom:5px}
.cgrid{display:flex;flex-wrap:wrap;gap:2px}
.ck{width:11px;height:11px;border-radius:2px;border:1px solid var(--b2);background:var(--bg3);transition:background .25s}
.ck.s{background:var(--c);border-color:var(--c)}
.ck.e{background:var(--p);border-color:var(--p)}
.ck.r{background:var(--g);border-color:var(--g)}

/* ── TRANSFERS ── */
.ti{display:flex;align-items:flex-start;gap:9px;padding:10px;border-radius:var(--r6);background:var(--bg2);border:1px solid var(--b2);margin-bottom:6px;transition:border-color .15s}
.ti.verified{border-color:rgba(52,211,153,.3)}
.ti.tampered{border-color:rgba(248,113,113,.5);background:rgba(248,113,113,.03)}
.dirbadge{width:28px;height:28px;border-radius:5px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:.8rem;font-weight:700}
.dirbadge.up{background:var(--cd);color:var(--c)}
.dirbadge.dn{background:var(--gd);color:var(--g)}
.tbody{flex:1;min-width:0}
.tname{font-size:.82rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:1px}
.tpeer{font-size:.67rem;color:var(--t3);margin-bottom:4px}
.tenc{font-size:.62rem;font-family:var(--mono);color:var(--p);background:var(--pd);border:1px solid rgba(167,139,250,.15);border-radius:3px;padding:1px 5px;display:inline-block;margin-bottom:4px}
.pbar{height:2px;background:var(--bg3);border-radius:1px;overflow:hidden;margin:4px 0}
.pfill{height:100%;background:linear-gradient(90deg,var(--c),var(--p));transition:width .25s}
.plbl{font-family:var(--mono);font-size:.6rem;color:var(--t3)}
.bchip{display:inline-flex;align-items:center;gap:4px;margin-top:4px;font-family:var(--mono);font-size:.6rem;color:var(--c);background:var(--cd);border:1px solid rgba(99,179,237,.15);padding:1px 6px;border-radius:3px}
.ichip{display:inline-flex;align-items:center;gap:4px;margin-top:3px;margin-left:4px;font-family:var(--mono);font-size:.6rem;color:var(--p);background:var(--pd);border:1px solid rgba(167,139,250,.15);padding:1px 6px;border-radius:3px}
.twarn{font-size:.68rem;color:var(--r);margin-top:4px;display:flex;align-items:center;gap:3px}
.tright{flex-shrink:0;text-align:right;min-width:60px}
.sico{font-size:.9rem;display:block;margin-bottom:1px}
.slbl{font-size:.6rem;font-family:var(--mono);white-space:nowrap}

/* ── BLOCKCHAIN PAGE ── */
.bcstats{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid var(--b2)}
.bcs{padding:11px 10px;text-align:center;border-right:1px solid var(--b2)}
.bcs:last-child{border-right:none}
.bcsn{font-size:1.15rem;font-weight:800;font-family:var(--mono);display:block}
.bcsl{font-size:.6rem;color:var(--t3);text-transform:uppercase;letter-spacing:.07em;margin-top:1px}
.chainwrap{flex:1;overflow-y:auto;padding:10px}
.blk{background:var(--bg2);border:1px solid var(--b2);border-radius:var(--r6);margin-bottom:3px;cursor:pointer;transition:border-color .15s;overflow:hidden}
.blk:hover{border-color:rgba(99,179,237,.25)}
.blk.GENESIS{border-color:rgba(167,139,250,.3)}
.blk.FILE_HASH{border-color:rgba(99,179,237,.22)}
.blk.IDENTITY{border-color:rgba(52,211,153,.22)}
.blk.CONTRACT{border-color:rgba(167,139,250,.3)}
.blktop{display:flex;align-items:center;gap:8px;padding:8px 11px}
.blkn{font-family:var(--mono);font-size:.65rem;color:var(--t3);width:24px;flex-shrink:0}
.blktag{font-size:.6rem;font-weight:700;letter-spacing:.06em;padding:2px 6px;border-radius:3px;flex-shrink:0;text-transform:uppercase}
.blktag.GENESIS{background:var(--pd);color:var(--p)}
.blktag.FILE_HASH{background:var(--cd);color:var(--c)}
.blktag.IDENTITY{background:var(--gd);color:var(--g)}
.blktag.CONTRACT{background:var(--pd);color:var(--p)}
.blktag.DATA{background:var(--bg3);color:var(--t3)}
.blkh{font-family:var(--mono);font-size:.63rem;color:var(--t3);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.blkt{font-size:.6rem;color:var(--t3);flex-shrink:0}
.blkdet{border-top:1px solid var(--b2);padding:9px 11px;animation:fi .15s ease}
@keyframes fi{from{opacity:0}to{opacity:1}}
.bdr{display:flex;gap:7px;margin-bottom:4px;font-family:var(--mono);font-size:.65rem}
.bdk{color:var(--t3);width:76px;flex-shrink:0}
.bdv{word-break:break-all}
.bdv.c{color:var(--c)}.bdv.g{color:var(--g)}.bdv.p{color:var(--p)}
.blklink{text-align:center;color:var(--b1);padding:1px;font-size:.65rem}
.vcbar{display:flex;align-items:center;gap:8px;padding:7px 13px;border-bottom:1px solid var(--b2);font-size:.72rem}
.refbtn{margin-left:auto;padding:3px 9px;border-radius:4px;border:1px solid var(--b1);background:none;color:var(--t3);font-family:var(--mono);font-size:.65rem;cursor:pointer;transition:all .15s}
.refbtn:hover{border-color:var(--c);color:var(--c)}

/* ── SMART CONTRACT PAGE ── */
.sc2col{display:grid;grid-template-columns:1fr 1fr;gap:13px;margin-bottom:13px}
.sccard{background:var(--bg1);border:1px solid var(--b1);border-radius:var(--r10);padding:14px}
.sch4{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:11px;display:flex;align-items:center;gap:6px}
.sck{font-size:.62rem;text-transform:uppercase;letter-spacing:.08em;color:var(--t3);margin-bottom:3px}
.scv{font-family:var(--mono);font-size:.68rem;margin-bottom:9px;word-break:break-all}
.abi-fn{display:flex;align-items:center;gap:7px;padding:6px 9px;background:var(--bg2);border-radius:5px;border:1px solid var(--b2);margin-bottom:4px}
.fnname{font-family:var(--mono);font-size:.68rem;color:var(--c)}
.fnargs{font-family:var(--mono);font-size:.62rem;color:var(--t3);flex:1}
.callbtn{padding:3px 8px;border-radius:4px;border:1px solid var(--b1);background:none;color:var(--c);font-family:var(--mono);font-size:.62rem;cursor:pointer;transition:all .15s}
.callbtn:hover{background:var(--cd);border-color:var(--c)}
.fnres{padding:5px 9px;background:var(--bg2);border-radius:4px;font-family:var(--mono);font-size:.63rem;color:var(--g);margin-bottom:4px;word-break:break-all}
.idtable{width:100%;border-collapse:collapse;font-size:.72rem}
.idtable th{text-align:left;padding:6px 9px;color:var(--t3);font-size:.62rem;text-transform:uppercase;letter-spacing:.07em;font-weight:600;border-bottom:1px solid var(--b2)}
.idtable td{padding:7px 9px;border-bottom:1px solid var(--b2)}
.idtable tr:last-child td{border-bottom:none}
.idaddr{font-family:var(--mono);font-size:.63rem;color:var(--c)}

/* IPFS nodes */
.ipfs3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:11px}
.inode{background:var(--bg2);border:1px solid var(--b2);border-radius:var(--r6);padding:11px}
.inh{display:flex;align-items:center;gap:6px;margin-bottom:8px;font-size:.73rem;font-weight:600}
.ifile{display:flex;align-items:center;gap:7px;padding:5px 8px;background:var(--bg3);border-radius:5px;margin-bottom:3px;font-size:.7rem}
.icid{font-family:var(--mono);font-size:.58rem;color:var(--p)}

/* ── CONNECTION STATUS PAGE ── */
.conn2{display:grid;grid-template-columns:1fr 1fr;gap:13px;margin-bottom:13px}
.conncard{background:var(--bg1);border:1px solid var(--b1);border-radius:var(--r10);padding:14px}
.connh{font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:var(--t3);margin-bottom:10px}
.connrow{display:flex;align-items:center;gap:7px;padding:5px 0;border-bottom:1px solid var(--b2);font-size:.74rem}
.connrow:last-child{border-bottom:none}
.connk{color:var(--t3);font-size:.68rem;flex:1}
.connv{font-family:var(--mono);font-size:.68rem}
.phase{display:flex;align-items:center;gap:9px;padding:7px 10px;border-radius:var(--r6);margin-bottom:5px;background:var(--bg2);border:1px solid var(--b2)}
.phase.active{border-color:var(--c);background:var(--cd)}
.phase.done{border-color:rgba(52,211,153,.2)}
.phase.pend{opacity:.38}
.phico{font-size:.9rem;flex-shrink:0}
.phname{font-size:.78rem;font-weight:600;flex:1}
.phstat{font-size:.65rem;font-family:var(--mono)}
.phdesc{font-size:.63rem;color:var(--t3)}

/* ── MODAL ── */
.overlay{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,0.75);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;animation:fi .2s}
.modal{width:370px;background:var(--bg1);border:1px solid var(--b1);border-radius:var(--r14);padding:26px;box-shadow:0 0 60px rgba(99,179,237,0.08);animation:pop .22s cubic-bezier(.34,1.56,.64,1)}
@keyframes pop{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:none}}
.modal h3{font-size:1rem;font-weight:800;margin-bottom:5px}
.msub{color:var(--t3);font-size:.78rem;margin-bottom:14px}
.mfile{background:var(--bg2);border-radius:var(--r6);padding:11px;margin-bottom:16px;border:1px solid var(--b2)}
.mfn{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:3px}
.mfm{font-family:var(--mono);font-size:.68rem;color:var(--t3)}
.mfh{font-family:var(--mono);font-size:.6rem;color:var(--c);margin-top:4px;word-break:break-all}
.mfe{font-family:var(--mono);font-size:.6rem;color:var(--p);margin-top:3px}
.mfv{font-size:.65rem;color:var(--g);margin-top:5px}
.macts{display:flex;gap:9px}
.macc{flex:1;padding:10px;border-radius:var(--r6);border:none;background:var(--g);color:#000;font-weight:800;font-family:var(--sans);cursor:pointer;transition:opacity .15s}
.macc:hover{opacity:.88}
.mrej{flex:1;padding:10px;border-radius:var(--r6);border:1px solid var(--b1);background:none;color:var(--t3);font-family:var(--sans);cursor:pointer;transition:all .15s}
.mrej:hover{border-color:var(--r);color:var(--r)}

/* ── TOAST ── */
.toast{position:fixed;bottom:20px;right:20px;z-index:300;background:var(--bg2);border:1px solid var(--b1);border-radius:var(--r10);padding:11px 15px;font-size:.78rem;max-width:300px;box-shadow:0 8px 28px rgba(0,0,0,.5);animation:toastIn .28s cubic-bezier(.22,1,.36,1)}
@keyframes toastIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
.toast.success{border-color:rgba(52,211,153,.4)}
.toast.error{border-color:rgba(248,113,113,.4)}
.toast.info{border-color:rgba(99,179,237,.3)}
`;

// ═══════════════════════════════════════════════
// LOGO
// ═══════════════════════════════════════════════
function Logo({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 60 60" fill="none">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#63b3ed" />
          <stop offset="100%" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      <path d="M30 3L55 17V43L30 57L5 43V17L30 3Z" stroke="url(#lg)" strokeWidth="1.5" fill="none" />
      <path d="M30 13L46 22V40L30 49L14 40V22L30 13Z" fill="rgba(99,179,237,0.06)" stroke="rgba(99,179,237,0.25)" strokeWidth="1" />
      <circle cx="30" cy="31" r="4.5" fill="url(#lg)" />
      {[[30,13,30,26.5],[30,35.5,30,49],[14,22,25,28],[35,34,46,40],[46,22,35,28],[25,34,14,40]].map(([x1,y1,x2,y2],i)=>(
        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="url(#lg)" strokeWidth="1.2" opacity=".55"/>
      ))}
    </svg>
  );
}

// ═══════════════════════════════════════════════
// AUTH SCREEN
// ═══════════════════════════════════════════════
function AuthScreen({ onLogin, onReg }) {
  const [mode, setMode] = useState("login");
  const [u, setU] = useState(""); const [p, setP] = useState("");
  const [alert, setAlert] = useState(null);

  const go = () => {
    if (!u.trim() || !p.trim()) return setAlert({ t:"err", m:"Fill in all fields." });
    if (mode === "register") {
      const r = onReg(u.trim(), p);
      if (!r.success) return setAlert({ t:"err", m: r.error });
      setAlert({ t:"info", m:"Registered on-chain! Signing in…" });
      setTimeout(()=>onLogin(u.trim(), p), 500);
    } else {
      const r = onLogin(u.trim(), p);
      if (!r.success) setAlert({ t:"err", m: r.error });
      else setAlert({ t:"info", m:"Authenticating via smart contract…" });
    }
  };

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="auth-logo">
          <Logo size={52} />
          <h1 className="auth-h">Chain<span>Transfer</span></h1>
          <p className="auth-sub">BLOCKCHAIN · P2P · END-TO-END ENCRYPTION</p>
        </div>
        <div className="tabs">
          {[["login","Sign In"],["register","Register"]].map(([k,l])=>(
            <button key={k} className={`tab ${mode===k?"on":""}`} onClick={()=>{setMode(k);setAlert(null)}}>{l}</button>
          ))}
        </div>
        <div className="field">
          <label className="flabel">Username</label>
          <input className="finput" type="text" placeholder="your_username" value={u} onChange={e=>setU(e.target.value)} onKeyDown={e=>e.key==="Enter"&&go()} />
        </div>
        <div className="field">
          <label className="flabel">Password</label>
          <input className="finput" type="password" placeholder="••••••••" value={p} onChange={e=>setP(e.target.value)} onKeyDown={e=>e.key==="Enter"&&go()} />
        </div>
        {alert && <div className={`alert ${alert.t}`}>{alert.m}</div>}
        <button className="auth-btn" onClick={go}>
          {mode==="login" ? "🔐 Connect to P2P Network" : "⛓ Register on Blockchain"}
        </button>
        <p className="auth-hint">Try: <code>demo / demo123</code> · <code>alice / alice123</code> · <code>bob / bob123</code></p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// PEER LIST
// ═══════════════════════════════════════════════
function PeerList({ peers, onSend }) {
  const [drag, setDrag] = useState(null);
  const pick = pid => {
    const inp = document.createElement("input"); inp.type="file";
    inp.onchange = e => { if(e.target.files[0]) onSend(e.target.files[0], pid); };
    inp.click();
  };
  return (
    <div className="panel rspan">
      <div className="phd"><span className="pico">⬡</span><h3>Network Peers</h3>
        <span className={`pbadge ${peers.length?"g":""}`}>{peers.length} online</span>
      </div>
      <div className="pbody">
        {peers.length===0
          ? <div className="empty"><div className="eico">◎</div><p className="ep">No peers online</p><span className="es">Open another tab to simulate peers</span></div>
          : peers.map(peer=>(
            <div key={peer.pid} className={`pi ${drag===peer.pid?"drag":""}`}
              onDragOver={e=>{e.preventDefault();setDrag(peer.pid)}}
              onDragLeave={()=>setDrag(null)}
              onDrop={e=>{e.preventDefault();setDrag(null);const f=e.dataTransfer.files[0];if(f)onSend(f,peer.pid)}}
            >
              <div className="pav">{peer.username[0].toUpperCase()}</div>
              <div style={{flex:1,minWidth:0}}>
                <span className="pname">{peer.username}</span>
                <span className="ppid">{peer.pid.slice(0,16)}…</span>
              </div>
              <div className="odot"/>
              <button className="sndbtn" onClick={()=>pick(peer.pid)}>↑ Send</button>
            </div>
          ))
        }
      </div>
      <div className="drophint">⊕ Drag &amp; drop a file onto a peer to send</div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// UPLOADER
// ═══════════════════════════════════════════════
function Uploader({ peers, onSend, activeT }) {
  const [ov, setOv] = useState(false);
  const [file, setFile] = useState(null);
  const [peer, setPeer] = useState("");
  const [enc, setEnc] = useState(true);
  const ref = useRef();
  const ICONS={PDF:"📄",PNG:"🖼",JPG:"🖼",JPEG:"🖼",MP4:"🎬",MP3:"🎵",ZIP:"📦",PY:"🐍",JS:"📜",TS:"📜",TXT:"📝",DOCX:"📝",XLSX:"📊"};
  const ext = file?.name.split(".").pop().toUpperCase()||"";
  const icon = ICONS[ext]||"📁";
  const chunks = file ? Math.max(1, Math.ceil(file.size / (64*1024))) : 0;
  const sent = activeT ? Math.floor((activeT.progress/100)*chunks) : 0;
  const showChunks = file && chunks <= 56;

  return (
    <div className="panel">
      <div className="phd">
        <span className="pico">⇧</span><h3>Send File</h3>
        {enc && <span className="pbadge p">AES-256-GCM</span>}
        <span className="pbadge c">WebRTC P2P</span>
      </div>
      <div className="pbody">
        <div className={`dz ${ov?"ov":""} ${file?"has":""}`}
          onDragOver={e=>{e.preventDefault();setOv(true)}}
          onDragLeave={()=>setOv(false)}
          onDrop={e=>{e.preventDefault();setOv(false);const f=e.dataTransfer.files[0];if(f)setFile(f)}}
          onClick={()=>!file&&ref.current.click()}
        >
          <input ref={ref} type="file" style={{display:"none"}} onChange={e=>setFile(e.target.files[0])}/>
          {file ? (
            <div className="staged">
              <span className="stagico">{icon}</span>
              <div style={{flex:1,minWidth:0}}>
                <div className="stagname">{file.name}</div>
                <div className="stagmeta">{fmtBytes(file.size)} · {ext} · {chunks} chunks</div>
              </div>
              <button className="xbtn" onClick={e=>{e.stopPropagation();setFile(null)}}>✕</button>
            </div>
          ) : (
            <><div className="dzico">⊕</div><div className="dztxt">Drop file here</div><div className="dzsub">or click to browse</div></>
          )}
        </div>
        {file && (<>
          <div className="toggle-row">
            <label className="tog"><input type="checkbox" checked={enc} onChange={e=>setEnc(e.target.checked)}/><span className="togsl"/></label>
            <span className="toglab">{enc?<><strong>AES-256-GCM ON</strong> — End-to-end encrypted</>:"Encryption OFF — plaintext"}</span>
          </div>
          <select className="psel" value={peer} onChange={e=>setPeer(e.target.value)}>
            <option value="">— Select recipient peer —</option>
            {peers.map(p=><option key={p.pid} value={p.pid}>{p.username}</option>)}
          </select>
          <button className="bigbtn" disabled={!peer} onClick={()=>{if(file&&peer){onSend(file,peer,enc);setFile(null);setPeer("")}}}>
            🔐 Send Securely via WebRTC
          </button>
          <p className="secnote">SHA-256 hash stored on blockchain · IPFS CID generated before transfer</p>
          {showChunks && (
            <div className="cviz">
              <div className="clbl">CHUNK MAP ({chunks} × 64KB blocks)</div>
              <div className="cgrid">
                {Array.from({length:chunks},(_,i)=>(
                  <div key={i} className={`ck ${activeT&&i<sent?(enc?"e":"s"):""}`} title={`Chunk ${i+1}`}/>
                ))}
              </div>
            </div>
          )}
        </>)}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// TRANSFER HISTORY
// ═══════════════════════════════════════════════
function Transfers({ transfers }) {
  return (
    <div className="panel">
      <div className="phd">
        <span className="pico">⇄</span><h3>Transfer History</h3>
        <span className="pbadge">{transfers.length}</span>
        {transfers.some(t=>t.status==="tampered") && <span className="pbadge r">⚠ Tamper</span>}
        {transfers.some(t=>t.status==="verified") && <span className="pbadge g">✓ Verified</span>}
      </div>
      <div className="pbody">
        {transfers.length===0
          ? <div className="empty"><div className="eico">⇄</div><p className="ep">No transfers yet</p><span className="es">Send a file to get started</span></div>
          : transfers.map(t => {
            const s = ST[t.status]||ST.pending;
            const active = ["sending","receiving","hashing","encrypting","decrypting","verifying","storing_chain","ipfs_pin"].includes(t.status);
            return (
              <div key={t.fid} className={`ti ${t.status}`}>
                <div className={`dirbadge ${t.dir==="send"?"up":"dn"}`}>{t.dir==="send"?"↑":"↓"}</div>
                <div className="tbody">
                  <div className="tname">{t.filename}</div>
                  <div className="tpeer">{t.dir==="send"?`→ ${t.to}`:`← ${t.from}`} · {fmtBytes(t.size)}</div>
                  {t.encrypted && <span className="tenc">🔒 AES-256-GCM</span>}
                  {active && <><div className="pbar"><div className="pfill" style={{width:`${t.prog||0}%`}}/></div><div className="plbl">{t.prog||0}%</div></>}
                  {t.blockHash && <div className="bchip">⛓ #{t.blockIdx} · {t.blockHash.slice(0,12)}…</div>}
                  {t.ipfsCid && <span className="ichip">📌 {t.ipfsCid.slice(0,14)}…</span>}
                  {t.status==="tampered" && <div className="twarn">⚠ Hash mismatch — file may be tampered or corrupted!</div>}
                </div>
                <div className="tright">
                  <span className="sico" style={{color:s.color}}>{s.icon}</span>
                  <span className="slbl" style={{color:s.color}}>{s.label}</span>
                </div>
              </div>
            );
          })
        }
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// BLOCKCHAIN PAGE
// ═══════════════════════════════════════════════
function BlockchainPage({ chain, onRefresh }) {
  const [open, setOpen] = useState(null);
  const files = chain.filter(b=>b.btype==="FILE_HASH").length;
  const ids = chain.filter(b=>b.btype==="IDENTITY").length;
  const contracts = chain.filter(b=>b.btype==="CONTRACT").length;
  const valid = BC.isValid();

  return (
    <div className="panel" style={{height:"calc(100vh - 112px)"}}>
      <div className="vcbar">
        <span style={{color:valid?"var(--g)":"var(--r)",fontWeight:700,fontSize:".78rem"}}>
          {valid?"✓ Chain valid — all hashes linked":"✗ Chain integrity compromised!"}
        </span>
        <span style={{fontSize:".65rem",color:"var(--t3)",marginLeft:8}}>
          {chain.length} blocks · SHA-256 Proof-of-Work (difficulty=1)
        </span>
        <button className="refbtn" onClick={onRefresh}>↺ Refresh</button>
      </div>
      <div className="bcstats">
        {[["⬡",chain.length,"Blocks"],["📄",files,"File Hashes"],["👤",ids,"Identities"],["📜",contracts,"Contracts"]].map(([ico,n,l])=>(
          <div key={l} className="bcs"><span className="bcsn">{n}</span><span className="bcsl">{ico} {l}</span></div>
        ))}
      </div>
      <div className="chainwrap">
        {[...chain].reverse().map((b, i, arr)=>{
          const type = b.btype||"DATA";
          const isOpen = open===b.index;
          const rows = [
            ["Hash", b.hash, "c"],
            ["PrevHash", b.prevHash, ""],
            ["Nonce", String(b.nonce), ""],
            ["Time", fmtTime(b.timestamp), ""],
            ...(b.data?.filename ? [["Filename", b.data.filename, ""]] : []),
            ...(b.data?.uploader ? [["Uploader", b.data.uploader, "g"]] : []),
            ...(b.data?.hash ? [["SHA-256", b.data.hash, "c"]] : []),
            ...(b.data?.aesKey ? [["AES Key", b.data.aesKey.slice(0,32)+"…", "p"]] : []),
            ...(b.data?.iv ? [["AES IV", b.data.iv.slice(0,32), "p"]] : []),
            ...(b.data?.size ? [["Size", fmtBytes(b.data.size), ""]] : []),
            ...(b.data?.username ? [["Username", b.data.username, "g"]] : []),
            ...(b.data?.address ? [["Address", b.data.address, "c"]] : []),
            ...(b.data?.pubkey ? [["PublicKey", b.data.pubkey.slice(0,32)+"…", "p"]] : []),
            ...(b.data?.name ? [["Contract", b.data.name, "p"]] : []),
            ...(b.data?.abi ? [["ABI", b.data.abi.join(" · "), "c"]] : []),
          ];
          return (
            <div key={b.index}>
              <div className={`blk ${type}`} onClick={()=>setOpen(isOpen?null:b.index)}>
                <div className="blktop">
                  <span className="blkn">#{b.index}</span>
                  <span className={`blktag ${type}`}>{type.replace("_"," ")}</span>
                  <span className="blkh">{b.hash}</span>
                  <span className="blkt">{fmtTime(b.timestamp)}</span>
                  <span style={{color:"var(--t3)",fontSize:".65rem",marginLeft:4}}>{isOpen?"▲":"▼"}</span>
                </div>
                {isOpen && (
                  <div className="blkdet">
                    {rows.map(([k,v,c],j)=>(
                      <div key={j} className="bdr">
                        <span className="bdk">{k}</span>
                        <span className={`bdv ${c}`}>{v}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {i < arr.length-1 && <div className="blklink">↕</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// SMART CONTRACT PAGE
// ═══════════════════════════════════════════════
function ContractPage({ chain }) {
  const [fnResults, setFnResults] = useState({});
  const callFn = (fn) => {
    const res =
      fn==="getOwner()" ? `"0xDEPLOYER0000" (address)` :
      fn.startsWith("storeHash") ? `tx: 0x${rndHex(12)} · Gas used: 21432 · Block #${chain.length}` :
      `bool: true — "Hash record verified on-chain"`;
    setFnResults(r=>({...r,[fn]:res}));
  };
  const contract = chain.find(b=>b.btype==="CONTRACT");
  const ids = REG.getAll();
  const ipfsFiles = IPFS.list();

  return (
    <div style={{display:"flex",flexDirection:"column",gap:13}}>
      <div className="sc2col">
        {/* Contract Info */}
        <div className="sccard">
          <div className="sch4" style={{color:"var(--p)"}}>📜 Smart Contract</div>
          {[
            ["Name", contract?.data?.name||"FileIntegrityVerifier"],
            ["Address", CONTRACT_ADDR],
            ["Network", "Mock PoW Blockchain"],
            ["Block", `#${contract?.index??0}`],
            ["Owner", "0xDEPLOYER0000"],
            ["Status", "✓ Active & Deployed"],
          ].map(([k,v])=>(
            <div key={k}><div className="sck">{k}</div><div className="scv">{v}</div></div>
          ))}
          <div className="sck" style={{marginTop:8}}>ABI Methods</div>
          {["storeHash(bytes32)","verifyHash(bytes32,bytes32)","getOwner()"].map(fn=>(
            <div key={fn}>
              <div className="abi-fn">
                <span className="fnname">{fn.split("(")[0]}</span>
                <span className="fnargs">({fn.split("(")[1].replace(")","")}) →</span>
                <button className="callbtn" onClick={()=>callFn(fn)}>call →</button>
              </div>
              {fnResults[fn] && <div className="fnres">↳ {fnResults[fn]}</div>}
            </div>
          ))}
        </div>

        {/* Identity Registry */}
        <div className="sccard">
          <div className="sch4" style={{color:"var(--g)"}}>👤 IPFS Identity Registry</div>
          <div className="sck">Contract Address</div>
          <div className="scv">{REG.CONTRACT}</div>
          <div className="sck" style={{marginTop:8}}>Registered Identities</div>
          <table className="idtable">
            <thead><tr><th>User</th><th>Address</th><th>Registered</th></tr></thead>
            <tbody>
              {ids.map(id=>(
                <tr key={id.username}>
                  <td style={{fontWeight:700}}>{id.username}</td>
                  <td><span className="idaddr">{id.address.slice(0,14)}…</span></td>
                  <td style={{color:"var(--t3)",fontSize:".62rem"}}>{fmtTime(id.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* IPFS Nodes */}
      <div className="sccard">
        <div className="sch4" style={{color:"var(--c)"}}>📦 IPFS Decentralized Storage — {ipfsFiles.length} files pinned</div>
        <div style={{fontSize:".7rem",color:"var(--t3)",marginBottom:8}}>
          Files are split into chunks, content-addressed by SHA-256 CID, and distributed across mock IPFS nodes for decentralized storage.
        </div>
        <div className="ipfs3">
          {[
            {name:"Node 1 · Local",col:"var(--g)"},
            {name:"Node 2 · Gateway",col:"var(--g)"},
            {name:"Node 3 · Pinning",col:"var(--y)"},
          ].map((node,ni)=>(
            <div key={ni} className="inode">
              <div className="inh">
                <div className="dot" style={{background:node.col,boxShadow:`0 0 4px ${node.col}`}}/>
                <span style={{fontSize:".72rem",fontWeight:600}}>{node.name}</span>
              </div>
              {ipfsFiles.length===0
                ? <span style={{fontSize:".65rem",color:"var(--t3)"}}>No files pinned</span>
                : ipfsFiles.slice(0,3).map(f=>(
                  <div key={f.cid} className="ifile">
                    <span>📄</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:".72rem"}}>{f.filename}</div>
                      <div className="icid">{f.cid.slice(0,22)}…</div>
                    </div>
                    <span style={{fontSize:".62rem",color:"var(--t3)"}}>{fmtBytes(f.size)}</span>
                  </div>
                ))
              }
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// CONNECTION STATUS PAGE
// ═══════════════════════════════════════════════
function ConnPage({ user, peers, transfers }) {
  const done = transfers.filter(t=>["verified"].includes(t.status));
  const active = transfers.filter(t=>["sending","receiving","connecting"].includes(t.status));
  const totalBytes = done.reduce((a,t)=>a+(t.size||0),0);
  const hasActive = active.length>0;
  const hasDone = done.length>0;

  const phases = [
    {ico:"🔐",name:"IPFS Identity Auth",st:"done",desc:"Authenticated via on-chain identity registry"},
    {ico:"🤝",name:"WebRTC Signaling",st:"done",desc:"ICE candidates exchanged · STUN servers resolved"},
    {ico:"🔒",name:"DTLS Handshake",st:"done",desc:"TLS 1.3 · Certificate fingerprints matched"},
    {ico:"⛓", name:"Blockchain Hash Commit",st:hasActive?"active":"done",desc:hasActive?"Mining new block…":"SHA-256 hashes committed on-chain"},
    {ico:"📡",name:"P2P Data Channel",st:hasActive?"active":hasDone?"done":"pend",desc:"RTCDataChannel · ordered=true · 64KB chunks · AES-GCM"},
    {ico:"✓", name:"Integrity Verification",st:hasDone?"done":"pend",desc:`${done.length} file(s) SHA-256 verified against blockchain`},
  ];

  return (
    <div style={{display:"flex",flexDirection:"column",gap:13}}>
      <div className="conn2">
        <div className="conncard">
          <div className="connh">My Connection Info</div>
          {[
            ["Username", user.username],
            ["Wallet Address", user.address.slice(0,20)+"…"],
            ["Public Key", user.pubkey.slice(0,20)+"…"],
            ["Peer ID", user.pid],
            ["Protocol", "WebRTC + Mock Signaling"],
            ["Encryption", "AES-256-GCM"],
            ["Integrity", "SHA-256 + Blockchain"],
            ["Peers Online", String(peers.length)],
          ].map(([k,v])=>(
            <div key={k} className="connrow">
              <span className="connk">{k}</span>
              <span className="connv">{v}</span>
            </div>
          ))}
        </div>
        <div className="conncard">
          <div className="connh">Transfer Statistics</div>
          {[
            ["Total Transfers", String(transfers.length)],
            ["Verified ✓", String(done.length)],
            ["Active", String(active.length)],
            ["Tampered ✗", String(transfers.filter(t=>t.status==="tampered").length)],
            ["Rejected", String(transfers.filter(t=>t.status==="rejected").length)],
            ["Data Transferred", fmtBytes(totalBytes)],
            ["IPFS Files Pinned", String(IPFS.list().length)],
            ["Blockchain Blocks", String(BC.getChain().length)],
          ].map(([k,v])=>(
            <div key={k} className="connrow">
              <span className="connk">{k}</span>
              <span className="connv">{v}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="conncard">
        <div className="connh">Connection &amp; Transfer Pipeline</div>
        {phases.map((ph,i)=>(
          <div key={i} className={`phase ${ph.st}`}>
            <span className="phico">{ph.ico}</span>
            <span className="phname">{ph.name}</span>
            <span className="phstat" style={{color:ph.st==="done"?"var(--g)":ph.st==="active"?"var(--c)":"var(--t3)"}}>
              {ph.st==="done"?"✓ Done":ph.st==="active"?"⟳ Active":"○ Pending"}
            </span>
            <span className="phdesc">{ph.desc}</span>
          </div>
        ))}
      </div>

      <div className="conncard">
        <div className="connh">Connected Peers</div>
        {peers.length===0
          ? <div className="empty" style={{padding:"20px"}}><p className="ep">No peers</p></div>
          : <table className="idtable">
            <thead><tr><th>User</th><th>Peer ID</th><th>Status</th><th>Transfers</th></tr></thead>
            <tbody>
              {peers.map(p=>(
                <tr key={p.pid}>
                  <td style={{display:"flex",alignItems:"center",gap:6}}>
                    <div className="pav" style={{width:20,height:20,fontSize:".62rem"}}>{p.username[0].toUpperCase()}</div>
                    <span style={{fontWeight:600}}>{p.username}</span>
                  </td>
                  <td><span className="idaddr">{p.pid.slice(0,18)}…</span></td>
                  <td><span style={{color:"var(--g)",fontSize:".68rem"}}>● Online</span></td>
                  <td style={{color:"var(--t3)",fontSize:".68rem"}}>{transfers.filter(t=>t.to===p.username||t.from===p.username).length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        }
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// INCOMING MODAL
// ═══════════════════════════════════════════════
function InModal({ offer, onAccept, onReject }) {
  return (
    <div className="overlay">
      <div className="modal">
        <h3>📥 Incoming File Transfer</h3>
        <p className="msub"><strong style={{color:"var(--c)"}}>{offer.from}</strong> wants to send you a file</p>
        <div className="mfile">
          <div className="mfn">{offer.filename}</div>
          <div className="mfm">{fmtBytes(offer.size)} · {offer.filename.split(".").pop().toUpperCase()}</div>
          <div className="mfh">SHA-256: {offer.hash}</div>
          {offer.encrypted && <div className="mfe">🔒 AES-256-GCM encrypted · key stored on blockchain</div>}
          <div className="mfv">⛓ Hash pre-verified on chain — Block #{offer.blockIdx}</div>
        </div>
        <div className="macts">
          <button className="macc" onClick={onAccept}>✓ Accept &amp; Download</button>
          <button className="mrej" onClick={onReject}>✕ Reject</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// ROOT APP
// ═══════════════════════════════════════════════
export default function App() {
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [chain, setChain] = useState(BC.getChain());
  const [transfers, setTransfers] = useState([]);
  const [offer, setOffer] = useState(null);
  const [toast, setToast] = useState(null);
  const [activeT, setActiveT] = useState(null);
  const toastRef = useRef(null);

  const PEERS = [
    { pid:"peer-alice-7f3a", username:"alice" },
    { pid:"peer-bob-2c9e",   username:"bob"   },
    { pid:"peer-carol-5a1d", username:"carol" },
  ];

  const showToast = useCallback((text, type="info") => {
    setToast({text,type});
    clearTimeout(toastRef.current);
    toastRef.current = setTimeout(()=>setToast(null), 3500);
  }, []);

  const refresh = useCallback(()=>setChain(BC.getChain()), []);
  const addT = useCallback(t=>setTransfers(p=>[t,...p]), []);
  const updT = useCallback((fid, u)=>setTransfers(p=>p.map(t=>t.fid===fid?{...t,...u}:t)), []);

  // ── Auth ──────────────────────────────────
  const handleLogin = (u, p) => {
    const r = REG.login(u, p);
    if (r.success) {
      setUser({ username:u, address:r.address, pubkey:r.pubkey, pid:"me-"+uid() });
      showToast(`Welcome, ${u}!`, "success");
    }
    return r;
  };
  const handleReg = (u, p) => {
    const r = REG.register(u, p);
    if (r.success) refresh();
    return r;
  };
  const handleLogout = () => { setUser(null); setTransfers([]); setOffer(null); };

  // ── Send File ─────────────────────────────
  const handleSend = useCallback(async (file, receiverPid, encrypted=true) => {
    const fid = uid();
    const rx = PEERS.find(p=>p.pid===receiverPid);
    if (!rx) return;

    addT({ fid, filename:file.name, size:file.size, to:rx.username, toId:receiverPid, dir:"send", status:"hashing", prog:0, encrypted });
    showToast(`Hashing ${file.name}…`, "info");
    await new Promise(r=>setTimeout(r,300));

    // Simulate hash
    const hash = sha256sim(file.name + file.size + Date.now());
    updT(fid, { status:"encrypting" });
    showToast("Encrypting with AES-256-GCM…", "info");
    await new Promise(r=>setTimeout(r,350));

    const aesKey = encrypted ? rndHex(64) : "";
    const iv = encrypted ? rndHex(24) : "";

    // Blockchain
    updT(fid, { status:"storing_chain" });
    await new Promise(r=>setTimeout(r,400));
    const block = BC.addFileHash(fid, hash, file.name, file.size, user.username, aesKey, iv);
    refresh();
    showToast(`⛓ Hash stored on Block #${block.index}`, "info");

    // IPFS
    updT(fid, { status:"ipfs_pin", blockHash:block.hash, blockIdx:block.index });
    await new Promise(r=>setTimeout(r,300));
    const cid = IPFS.pin(file.name, file.size, hash);
    updT(fid, { status:"awaiting", ipfsCid:cid });
    showToast(`📌 IPFS CID: ${cid.slice(0,20)}…`, "info");

    // Simulate incoming modal on receiver's side
    const rxFid = uid();
    addT({ fid:rxFid, filename:file.name, size:file.size, from:rx.username, fromId:receiverPid, dir:"receive", status:"pending", prog:0, encrypted });
    setTimeout(()=>{
      setOffer({ fid:rxFid, sendFid:fid, filename:file.name, size:file.size, from:rx.username, hash, encrypted, blockIdx:block.index });
    }, 700);
  }, [user, addT, updT, refresh, showToast]);

  // ── Accept ────────────────────────────────
  const handleAccept = useCallback(() => {
    if (!offer) return;
    const { fid:rxFid, sendFid, filename, hash, encrypted } = offer;
    setOffer(null);
    updT(sendFid, { status:"connecting" });
    updT(rxFid,   { status:"connecting" });
    showToast("WebRTC P2P channel opening…", "info");

    setTimeout(()=>{
      updT(sendFid, { status:"sending", prog:0 });
      updT(rxFid,   { status:"receiving", prog:0 });
      setActiveT({ fid:sendFid });
      showToast("Transferring chunks over P2P…", "info");
      let prog = 0;
      const iv = setInterval(()=>{
        prog = Math.min(100, prog + Math.random()*13+5);
        updT(sendFid, { prog:Math.round(prog) });
        updT(rxFid,   { prog:Math.round(prog) });
        if (prog >= 100) {
          clearInterval(iv);
          setActiveT(null);
          if (encrypted) {
            updT(rxFid, { status:"decrypting" });
            setTimeout(()=>{
              updT(sendFid, { status:"verifying" });
              updT(rxFid,   { status:"verifying" });
              showToast("Verifying SHA-256 hash on blockchain…", "info");
              setTimeout(()=>{
                const v = BC.verify(sendFid, hash);
                updT(sendFid, { status:v.ok?"verified":"tampered" });
                updT(rxFid,   { status:v.ok?"verified":"tampered" });
                refresh();
                showToast(v.ok?`✓ ${filename} integrity verified on blockchain!`:"⚠ Hash mismatch — possible tampering!", v.ok?"success":"error");
              }, 600);
            }, 450);
          } else {
            updT(sendFid, { status:"verifying" });
            updT(rxFid,   { status:"verifying" });
            setTimeout(()=>{
              const v = BC.verify(sendFid, hash);
              updT(sendFid, { status:v.ok?"verified":"tampered" });
              updT(rxFid,   { status:v.ok?"verified":"tampered" });
              refresh();
              showToast(v.ok?`✓ ${filename} verified!`:"⚠ Tamper detected!", v.ok?"success":"error");
            }, 600);
          }
        }
      }, 140);
    }, 900);
  }, [offer, updT, refresh, showToast]);

  const handleReject = useCallback(()=>{
    if(!offer) return;
    updT(offer.fid,    { status:"rejected" });
    updT(offer.sendFid,{ status:"rejected" });
    setOffer(null);
    showToast("Transfer rejected.", "error");
  }, [offer, updT, showToast]);

  const visPeers = PEERS.filter(p=>!user || p.username!==user.username);

  if (!user) return <><style>{CSS}</style><AuthScreen onLogin={handleLogin} onReg={handleReg}/></>;

  const hasTamper = transfers.some(t=>t.status==="tampered");

  return (
    <>
      <style>{CSS}</style>
      <div className="shell">

        {/* ── HEADER ── */}
        <header className="hdr">
          <div className="hdr-logo"><Logo size={26}/></div>
          <span className="hdr-name">Chain<span>Transfer</span></span>
          <div className="vsep"/>
          <div className="chip"><div className="dot g"/>Contract: {CONTRACT_ADDR.slice(0,14)}…</div>
          <div className="chip"><div className="dot p"/>IPFS: {IPFS.list().length} pinned</div>
          <div className="chip"><div className="dot c"/>⛓ {chain.length} blocks</div>
          <div className="hdr-r">
            <div className="chip"><div className="dot g"/>WebRTC Ready · {visPeers.length} peers</div>
            <div className="user-chip">
              <div className="uav">{user.username[0].toUpperCase()}</div>
              <div>
                <div className="uname">{user.username}</div>
                <div className="uaddr">{user.address.slice(0,18)}…</div>
              </div>
            </div>
            <button className="lout-btn" onClick={handleLogout}>⏻ Logout</button>
          </div>
        </header>

        {/* ── NAV ── */}
        <nav className="nav">
          {[
            ["dashboard","📡 Dashboard"],
            ["blockchain","⛓ Blockchain Explorer"],
            ["contract","📜 Smart Contract & IPFS"],
            ["connection","◎ Connection Status"],
          ].map(([k,l])=>(
            <button key={k} className={`nbtn ${tab===k?"on":""}`}
              onClick={()=>{setTab(k);if(k==="blockchain"||k==="contract")refresh()}}
            >
              {l}
              {k==="connection"&&hasTamper&&<span className="ndot"/>}
            </button>
          ))}
        </nav>

        {/* ── PAGES ── */}
        <div className="body">
          <div className="page">
            {tab==="dashboard" && (
              <div className="dgrid">
                <PeerList peers={visPeers} onSend={handleSend}/>
                <Uploader peers={visPeers} onSend={handleSend} activeT={transfers.find(t=>t.fid===activeT?.fid)}/>
                <Transfers transfers={transfers}/>
              </div>
            )}
            {tab==="blockchain" && <BlockchainPage chain={chain} onRefresh={refresh}/>}
            {tab==="contract"   && <ContractPage chain={chain}/>}
            {tab==="connection" && <ConnPage user={user} peers={visPeers} transfers={transfers}/>}
          </div>
        </div>
      </div>

      {offer && <InModal offer={offer} onAccept={handleAccept} onReject={handleReject}/>}
      {toast && <div className={`toast ${toast.type}`}>{toast.text}</div>}
    </>
  );
}
