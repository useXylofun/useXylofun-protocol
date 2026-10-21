import { loadRegister, applyRegister, stated, isAddress } from './register.js';
import { startMarket } from './market.js';
import { initReveal, initProgress, initParallax, initSpotlight, initTabs, initCopy } from './ui.js';

const reg = loadRegister();
applyRegister(reg);

// On-chain check of the mint through the stated RPC. Only runs when the address record is stated.
async function verifyMint() {
  const el = document.querySelector('[data-verify]');
  const ca = reg.ca;
  if (!el || !stated(ca) || !isAddress(ca.value) || !stated(reg.chain) || !reg.chain.rpc) return;
  el.textContent = 'Checking the mint on-chain…';
  try {
    const res = await fetch(reg.chain.rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTokenSupply', params: [ca.value] }),
    });
    const j = await res.json();
    el.textContent = j.result && j.result.value
      ? `Mint found on-chain. Supply: ${Number(j.result.value.uiAmountString).toLocaleString('en-US')}.`
      : 'No token mint was found at this address.';
  } catch {
    el.textContent = 'The Solana RPC could not be reached, so the mint is unchecked.';
  }
}

initReveal();
initProgress();
initParallax();
initSpotlight();
initTabs();
initCopy();
startMarket(reg.market);
verifyMint();
document.documentElement.dataset.ready = '1';
