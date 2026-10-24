'use strict';

// Local regression/interop fixtures only. No network or device connection is made.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const provenance = require('./node-forge-security-provenance.json');
const rootRequire = createRequire(path.join(process.cwd(), 'package.json'));
let adbRequire;
let forgeRoot = process.env.FORGE_PATH;
if (!forgeRoot) {
  const webExtRequire = createRequire(rootRequire.resolve('web-ext'));
  adbRequire = createRequire(webExtRequire.resolve('@devicefarmer/adbkit'));
  forgeRoot = path.dirname(adbRequire.resolve('node-forge/package.json'));
}
const forge = require(forgeRoot);
const asn1 = forge.asn1;
const message = 'node-forge security backport synthetic fixture';
const pairs = new Map([3, 65537].map(exponent => {
  const native = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: exponent });
  return [exponent, {
    native,
    privateKey: forge.pki.privateKeyFromPem(native.privateKey.export({ type: 'pkcs8', format: 'pem' })),
    publicKey: forge.pki.publicKeyFromPem(native.publicKey.export({ type: 'spki', format: 'pem' })),
  }];
}));
function digest(algorithm, value = message) {
  return crypto.createHash(algorithm).update(value).digest().toString('binary');
}
function md(algorithm) {
  const value = forge.md[algorithm].create();
  value.update(message, 'utf8');
  return value;
}
function sequence(value) {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, value);
}
function parameter(value = '') {
  return asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, value);
}
function info(algorithm, parameters = [parameter()], oidBytes) {
  return sequence([
    sequence([asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false,
      oidBytes ?? asn1.oidToDer(forge.pki.oids[algorithm]).getBytes()), ...parameters]),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, digest(algorithm)),
  ]);
}
function der(value) { return asn1.toDer(value).getBytes(); }
function rawSignature(encoded, exponent = 65537) {
  return pairs.get(exponent).privateKey.sign(encoded, 'NONE');
}
function verifyEncoded(encoded, exponent = 65537) {
  return pairs.get(exponent).publicKey.verify(digest('sha256'), rawSignature(encoded, exponent));
}

test('effective package retains its real version and exact reviewed patch bytes', () => {
  assert.equal(require(path.join(forgeRoot, 'package.json')).version, '1.4.0');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(forgeRoot, 'lib/rsa.js'))).digest('hex'), provenance.patched_rsa_sha256);
});
for (const exponent of [3, 65537]) {
  for (const algorithm of ['sha1', 'sha256', 'sha384', 'sha512']) {
    test(`OpenSSL and Forge interoperate: ${algorithm}, e=${exponent}`, () => {
      const keys = pairs.get(exponent);
      const nativeSignature = crypto.sign(algorithm, Buffer.from(message), keys.native.privateKey);
      assert.equal(keys.publicKey.verify(digest(algorithm), nativeSignature.toString('binary')), true);
      assert.equal(crypto.verify(algorithm, Buffer.from(message), keys.native.publicKey,
        Buffer.from(keys.privateKey.sign(md(algorithm)), 'binary')), true);
      assert.equal(keys.publicKey.verify(digest(algorithm, 'different message'), nativeSignature.toString('binary')), false);
    });
    for (const omitted of [false, true]) {
      test(`canonical ${algorithm} accepts ${omitted ? 'absent' : 'empty NULL'} parameters, e=${exponent}`, () => {
        const keys = pairs.get(exponent);
        assert.equal(keys.publicKey.verify(digest(algorithm), rawSignature(der(info(algorithm, omitted ? [] : [parameter()])), exponent)), true);
      });
    }
  }
  test(`rejects extra nested fields and nonempty NULL, e=${exponent}`, () => {
    for (const parameters of [
      [parameter(), asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, 'garbage')],
      [parameter('x'.repeat(100))],
      [asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, '\x01')],
    ]) assert.throws(() => verifyEncoded(der(info('sha256', parameters)), exponent));
  });
}
test('MD5 keeps its required NULL parameter profile', () => {
  const key = pairs.get(65537).publicKey;
  assert.equal(key.verify(digest('md5'), rawSignature(der(info('md5')))), true);
  assert.throws(() => key.verify(digest('md5'), rawSignature(der(info('md5', [])))));
});
test('rejects non-minimal outer DER length', () => {
  const encoded = der(info('sha256'));
  assert.ok(encoded.charCodeAt(1) < 128);
  assert.throws(() => verifyEncoded(encoded[0] + '\x81' + encoded.slice(1)));
});
test('rejects non-minimal OID primitive length', () => {
  const oid = der(asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false,
    asn1.oidToDer(forge.pki.oids.sha256).getBytes()));
  const encoded = der(info('sha256'));
  const offset = encoded.indexOf(oid);
  assert.equal(offset, 4);
  const malformed = encoded.slice(0, offset) + oid[0] + '\x81' + oid.slice(1) + encoded.slice(offset + oid.length);
  const bytes = Buffer.from(malformed, 'binary');
  bytes[1] += 1;
  bytes[3] += 1;
  assert.throws(() => verifyEncoded(bytes.toString('binary')));
});
test('rejects overlong base128 OID arc despite identical parsed algorithm', () => {
  const oid = asn1.oidToDer(forge.pki.oids.sha256).getBytes();
  const noncanonical = oid[0] + '\x80' + oid.slice(1);
  assert.equal(asn1.derToOid(noncanonical), forge.pki.oids.sha256);
  assert.throws(() => verifyEncoded(der(info('sha256', [parameter()], noncanonical))));
});
test('rejects extra outer elements and trailing bytes with default verification flags', () => {
  const outer = info('sha256');
  outer.value.push(parameter());
  assert.throws(() => verifyEncoded(der(outer)));
  assert.throws(() => verifyEncoded(der(info('sha256')) + '\x00\x00'));
});
test('canonical hardening explicitly rejects legacy BER indefinite-length DigestInfo', () => {
  const encoded = der(info('sha256'));
  assert.throws(() => verifyEncoded('\x30\x80' + encoded.slice(2) + '\x00\x00'));
});
test('preserves PSS interoperability and NONE verification', () => {
  const keys = pairs.get(65537);
  const pss = forge.pss.create({ md: forge.md.sha256.create(), mgf: forge.mgf.mgf1.create(forge.md.sha256.create()), saltLength: 20 });
  const native = crypto.sign('sha256', Buffer.from(message), {
    key: keys.native.privateKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 20,
  });
  assert.equal(keys.publicKey.verify(digest('sha256'), native.toString('binary'), pss), true);
  assert.equal(crypto.verify('sha256', Buffer.from(message), {
    key: keys.native.publicKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 20,
  }, Buffer.from(keys.privateKey.sign(md('sha256'), pss), 'binary')), true);
  const raw = keys.privateKey.sign(digest('sha256'), 'NONE');
  assert.equal(keys.publicKey.verify(digest('sha256'), raw, 'NONE'), true);
  assert.equal(keys.publicKey.verify(digest('sha256', 'other'), raw, 'NONE'), false);
});
if (adbRequire) {
  const Auth = require(path.join(path.dirname(adbRequire.resolve('@devicefarmer/adbkit/package.json')), 'dist/src/adb/auth.js')).default;
  for (const exponent of [3, 65537]) test(`actual ADB public-key parser and SHA1 authentication remain compatible, e=${exponent}`, async () => {
    const keys = pairs.get(exponent);
    const structure = Buffer.alloc(524);
    structure.writeUInt32LE(64, 0);
    Buffer.from(keys.publicKey.n.toString(16).padStart(512, '0'), 'hex').reverse().copy(structure, 8);
    structure.writeUInt32LE(exponent, 520);
    const parsed = await Auth.parsePublicKey(structure.toString('base64') + ' synthetic-security-fixture');
    const signature = crypto.sign('sha1', Buffer.from(message), keys.native.privateKey).toString('binary');
    assert.equal(parsed.verify(digest('sha1'), signature), true);
    assert.equal(parsed.verify(digest('sha1', 'other'), signature), false);
    assert.match(parsed.fingerprint, /^(?:[0-9a-f]{2}:){15}[0-9a-f]{2}$/);
    assert.equal(parsed.comment, 'synthetic-security-fixture');
  });
}
