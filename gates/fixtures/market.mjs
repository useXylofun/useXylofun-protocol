// Deterministic stand-ins for the two market endpoints and the RPC, used by gates and the measure script.
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function fakeAddress(seed) {
  let s = seed * 2654435761 >>> 0;
  let out = '';
  for (let i = 0; i < 44; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out += B58[(s >>> 8) % 58];
  }
  return out;
}

export function marketFixtures() {
  const boosts = [];
  const pairs = [];
  for (let i = 1; i <= 14; i++) {
    const addr = fakeAddress(i);
    boosts.push({ chainId: i === 3 ? 'ethereum' : 'solana', tokenAddress: addr, icon: i % 4 === 0 ? 'https://cdn.example.test/i.png' : '' });
    pairs.push({
      chainId: i === 3 ? 'ethereum' : 'solana',
      pairAddress: fakeAddress(100 + i),
      baseToken: { address: addr, name: `Token ${i}`, symbol: `TK${i}` },
      priceUsd: String(i % 5 === 0 ? 0.00001234 * i : 0.5 * i),
      priceChange: { h24: i % 2 ? i * 1.5 : -i * 0.7 },
      volume: { h24: 1000000 - i * 50000 },
      liquidity: { usd: 200000 + i * 1000 },
      info: i % 6 === 0 ? {} : { imageUrl: `https://cdn.example.test/${i}.png` },
    });
  }
  return { boosts, pairs };
}

export function routeFixtures(url, fx = marketFixtures()) {
  if (url.includes('token-boosts/top')) return fx.boosts;
  if (url.includes('/tokens/v1/solana/')) return fx.pairs;
  return null;
}
