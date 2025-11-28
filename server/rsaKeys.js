// rsaKeys.js
const forge = require('node-forge');

function generateRSAKeys(bits = 2048) {
  const rsa = forge.pki.rsa;
  const keypair = rsa.generateKeyPair({ bits, e: 0x10001 });
  const publicKeyPem = forge.pki.publicKeyToPem(keypair.publicKey);
  const privateKeyPem = forge.pki.privateKeyToPem(keypair.privateKey);
  return { publicKeyPem, privateKeyPem };
}

module.exports = generateRSAKeys;
