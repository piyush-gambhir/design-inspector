# Local node-forge security backport

The Firefox development runner uses `web-ext -> @devicefarmer/adbkit -> node-forge`. Its RSA verifier is reachable when authenticating ADB keys. Keep this functionality available.

`patches/node-forge@1.4.0.patch` backports only `lib/rsa.js` from [upstream contributor PR 1160](https://github.com/digitalbazaar/forge/pull/1160), exact head `9842c3d3cf6f560270b4f42ab3c0c28c68e6f78e`. That proposal is unmerged and has no maintainer-approved release. We maintain this small backport locally. It reconstructs canonical DER DigestInfo with existing ASN.1 primitives before accepting RSA PKCS#1 v1.5 signatures. No new cryptographic algorithm is introduced.

The fix covers the Node `lib/index.js` entry used by this tooling, including ADB authentication. Prebuilt `dist/forge*.min.js` browser deep imports remain upstream and are outside this fix's scope. Forge is a development-only dependency and is not shipped in the extension output.

Verification now intentionally rejects legacy BER/noncanonical DigestInfo encodings. Standard DER signatures with valid NULL or absent-NULL parameters, OpenSSL interoperability, RSA exponents 3 and 65537, SHA-1/256/384/512, PSS and NONE remain covered by regression tests.

Run `pnpm test:security`. Its 36 tests resolve the actual installed consumer, verify the patched source hash and exercise malformed OID/length/NULL/structure cases and real adbkit key parsing/authentication. CI runs this command after frozen installation. pnpm also verifies the patch integrity recorded in the lockfile.

Package version stays 1.4.0. Registry audit still reports GHSA-86w9-cpqp-85rv by version; no audit exception or version spoofing is added. This is a scoped source backport, not a claim that npm has published a patched release. Replace the local patch with a supported upstream release once it includes equivalent hardening, then rerun the regression suite and review compatibility.

Provenance and SHA-256 values are recorded in `node-forge-security-provenance.json`. `LICENSE.node-forge` preserves upstream licensing. Independent validation before adoption ran the upstream Node suite: 834 passed and four pre-existing pending tests. The same new regression cases fail against the original 1.4.0 source.
