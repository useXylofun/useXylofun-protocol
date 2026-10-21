// Turns a reference text file into hashed word and 2-gram sets, so the repo never stores the reference copy.
// Usage: node scripts/make-ref-fixtures.mjs <reference-text-file>
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { grams, words } from './copy-tokens.mjs';

const h = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);
const text = readFileSync(process.argv[2], 'utf8');
const out = { words: [...new Set(words(text))].map(h).sort(), grams: [...new Set(grams(text))].map(h).sort() };
writeFileSync(new URL('../gates/fixtures/ref-hashes.json', import.meta.url), JSON.stringify(out));
console.log(`words ${out.words.length}, 2-grams ${out.grams.length}`);
