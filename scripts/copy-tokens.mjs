// Shared tokenizing for the copy-overlap check.
// Stopwords are function words that no copy can avoid. The allowlist holds interface and protocol terms
// that the page must use (chain name, copy button, address slot, market columns) and is reported by the gate.
export const STOP = new Set('a an and are as at be but by can do does for from has have how i if in into is it its of on or our so than that the their them then there these they this to up us was we what when where which who why will with you your not no yes any all each every more most only own same such too very just also over out about after before until under again here one two three'.split(' '));
export const ALLOW = new Set(['solana', 'usdc', 'copy', 'address', 'token', 'market', 'price', 'live', 'open', 'app', 'week', 'cylo', 'xylo', 'questions', 'answers', 'dexscreener', 'solscan', 'fun']);

const norm = (s) => s.toLowerCase().replace(/[’']s\b/g, '').replace(/[’']/g, '');
// Segments end at sentence punctuation, so a 2-gram never spans two sentences.
const segments = (text) => norm(text).split(/[.?!:;,()\n|·—–]+/).map((seg) => seg.split(/[^a-z]+/).filter((w) => w.length > 1));

export function words(text) {
  return segments(text).flat().filter((w) => !STOP.has(w) && !ALLOW.has(w) && w.length > 2);
}
export function grams(text) {
  const out = [];
  for (const seg of segments(text)) for (let i = 0; i + 1 < seg.length; i++) out.push(`${seg[i]} ${seg[i + 1]}`);
  return out;
}
