// utils/generateReference.js
//
// Returns something like "APV-A7K2M9".
// Alphabet excludes ambiguous chars (I, O, 0, 1) so it's easy to read aloud.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateReference() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return `APV-${code}`;
}

module.exports = { generateReference };