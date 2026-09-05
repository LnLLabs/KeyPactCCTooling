#!/usr/bin/env node
/**
 * Evolution 0.5.13 patches for Keypact CC registration:
 * 1) Certificate redeemer indexing only handled stake/drep credentials — AuthCommitteeHot
 *    never entered the witness set (empty Blockfrost evaluate results).
 * 2) Witness redeemers used RedeemerMap; Keypact/Lucid re-encode as RedeemerArray on
 *    assemble/submit, causing ConwayUtxowFailure ScriptIntegrityHashMismatch.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const patches = [
  {
    files: [
      'node_modules/@evolution-sdk/evolution/dist/sdk/builders/internal/txBuilder.js',
      'node_modules/@evolution-sdk/evolution/src/sdk/builders/internal/txBuilder.ts',
    ],
    skipIf: (text) => text.includes('Check committeeColdCredential (AuthCommitteeHot'),
    replacements: [
      {
        fileEndsWith: 'txBuilder.js',
        from: `        if ("drepCredential" in cert && cert.drepCredential) {
          const certCredHex = Bytes.toHex(cert.drepCredential.hash);
          if (certCredHex === credentialHex) {
            redeemerIndex = i;
            break;
          }
        }
      }
      if (redeemerIndex === undefined) {
        yield* Effect.logWarning(\`[Assembly] Could not find cert index for key: \${key}\`);`,
        to: `        if ("drepCredential" in cert && cert.drepCredential) {
          const certCredHex = Bytes.toHex(cert.drepCredential.hash);
          if (certCredHex === credentialHex) {
            redeemerIndex = i;
            break;
          }
        }
        // Check committeeColdCredential (AuthCommitteeHotCert, ResignCommitteeColdCert)
        if ("committeeColdCredential" in cert && cert.committeeColdCredential) {
          const certCredHex = Bytes.toHex(cert.committeeColdCredential.hash);
          if (certCredHex === credentialHex) {
            redeemerIndex = i;
            break;
          }
        }
      }
      if (redeemerIndex === undefined) {
        yield* Effect.logWarning(\`[Assembly] Could not find cert index for key: \${key}\`);`,
      },
      {
        fileEndsWith: 'txBuilder.ts',
        from: `          if ("drepCredential" in cert && cert.drepCredential) {
            const certCredHex = Bytes.toHex((cert.drepCredential as { hash: Uint8Array }).hash)
            if (certCredHex === credentialHex) {
              redeemerIndex = i
              break
            }
          }
        }
        if (redeemerIndex === undefined) {
          yield* Effect.logWarning(\`[Assembly] Could not find cert index for key: \${key}\`)`,
        to: `          if ("drepCredential" in cert && cert.drepCredential) {
            const certCredHex = Bytes.toHex((cert.drepCredential as { hash: Uint8Array }).hash)
            if (certCredHex === credentialHex) {
              redeemerIndex = i
              break
            }
          }
          // Check committeeColdCredential (AuthCommitteeHotCert, ResignCommitteeColdCert)
          if ("committeeColdCredential" in cert && cert.committeeColdCredential) {
            const certCredHex = Bytes.toHex((cert.committeeColdCredential as { hash: Uint8Array }).hash)
            if (certCredHex === credentialHex) {
              redeemerIndex = i
              break
            }
          }
        }
        if (redeemerIndex === undefined) {
          yield* Effect.logWarning(\`[Assembly] Could not find cert index for key: \${key}\`)`,
      },
    ],
  },
  {
    files: [
      'node_modules/@evolution-sdk/evolution/dist/sdk/builders/phases/Evaluation.js',
      'node_modules/@evolution-sdk/evolution/src/sdk/builders/phases/Evaluation.ts',
    ],
    skipIf: (text) => text.includes('maps to committee cold credential'),
    replacements: [
      {
        fileEndsWith: 'Evaluation.js',
        from: `    else if ("drepCredential" in cert && cert.drepCredential) {
      const credHex = Bytes.toHex(cert.drepCredential.hash);
      const key = \`cert:\${credHex}\`;
      certIndexMapping.set(i, key);
      yield* Effect.logDebug(\`[Evaluation] Cert \${i} maps to drep credential: \${key}\`);
    }
  }`,
        to: `    else if ("drepCredential" in cert && cert.drepCredential) {
      const credHex = Bytes.toHex(cert.drepCredential.hash);
      const key = \`cert:\${credHex}\`;
      certIndexMapping.set(i, key);
      yield* Effect.logDebug(\`[Evaluation] Cert \${i} maps to drep credential: \${key}\`);
    }
    // Handle committee cold certificates: AuthCommitteeHotCert, ResignCommitteeColdCert
    else if ("committeeColdCredential" in cert && cert.committeeColdCredential) {
      const credHex = Bytes.toHex(cert.committeeColdCredential.hash);
      const key = \`cert:\${credHex}\`;
      certIndexMapping.set(i, key);
      yield* Effect.logDebug(\`[Evaluation] Cert \${i} maps to committee cold credential: \${key}\`);
    }
  }`,
      },
      {
        fileEndsWith: 'Evaluation.ts',
        from: `      else if ("drepCredential" in cert && cert.drepCredential) {
        const credHex = Bytes.toHex(cert.drepCredential.hash)
        const key = \`cert:\${credHex}\`
        certIndexMapping.set(i, key)
        yield* Effect.logDebug(\`[Evaluation] Cert \${i} maps to drep credential: \${key}\`)
      }
    }`,
        to: `      else if ("drepCredential" in cert && cert.drepCredential) {
        const credHex = Bytes.toHex(cert.drepCredential.hash)
        const key = \`cert:\${credHex}\`
        certIndexMapping.set(i, key)
        yield* Effect.logDebug(\`[Evaluation] Cert \${i} maps to drep credential: \${key}\`)
      }
      // Handle committee cold certificates: AuthCommitteeHotCert, ResignCommitteeColdCert
      else if ("committeeColdCredential" in cert && cert.committeeColdCredential) {
        const credHex = Bytes.toHex(cert.committeeColdCredential.hash)
        const key = \`cert:\${credHex}\`
        certIndexMapping.set(i, key)
        yield* Effect.logDebug(\`[Evaluation] Cert \${i} maps to committee cold credential: \${key}\`)
      }
    }`,
      },
    ],
  },
  {
    files: [
      'node_modules/@evolution-sdk/evolution/dist/sdk/builders/internal/txBuilder.js',
      'node_modules/@evolution-sdk/evolution/src/sdk/builders/internal/txBuilder.ts',
    ],
    skipIf: (text) =>
      text.includes('new Redeemers.RedeemerArray({ value: redeemers })') &&
      !text.includes('Redeemers.makeRedeemerMap(redeemers)'),
    replacements: [
      {
        fileEndsWith: 'txBuilder.js',
        from: 'redeemersConcrete = Redeemers.makeRedeemerMap(redeemers);',
        to: 'redeemersConcrete = new Redeemers.RedeemerArray({ value: redeemers });',
      },
      {
        fileEndsWith: 'txBuilder.js',
        from: 'redeemers: fakeRedeemers.length > 0 ? Redeemers.makeRedeemerMap(fakeRedeemers) : undefined,',
        to: 'redeemers: fakeRedeemers.length > 0 ? new Redeemers.RedeemerArray({ value: fakeRedeemers }) : undefined,',
      },
      {
        fileEndsWith: 'txBuilder.ts',
        from: 'let redeemersConcrete: Redeemers.RedeemerMap | undefined',
        to: 'let redeemersConcrete: Redeemers.RedeemerArray | undefined',
      },
      {
        fileEndsWith: 'txBuilder.ts',
        from: 'redeemersConcrete = Redeemers.makeRedeemerMap(redeemers)',
        to: 'redeemersConcrete = new Redeemers.RedeemerArray({ value: redeemers })',
      },
      {
        fileEndsWith: 'txBuilder.ts',
        from: 'redeemers: fakeRedeemers.length > 0 ? Redeemers.makeRedeemerMap(fakeRedeemers) : undefined,',
        to: 'redeemers: fakeRedeemers.length > 0 ? new Redeemers.RedeemerArray({ value: fakeRedeemers }) : undefined,',
      },
    ],
  },
]

let changed = 0
for (const patch of patches) {
  for (const rel of patch.files) {
    const path = join(root, rel)
    if (!existsSync(path)) {
      console.warn(`[patch-evolution] missing ${rel}`)
      continue
    }
    let text = readFileSync(path, 'utf8')
    if (patch.skipIf(text)) continue
    const before = text
    for (const rep of patch.replacements) {
      if (!rel.endsWith(rep.fileEndsWith)) continue
      if (!text.includes(rep.from)) {
        console.warn(`[patch-evolution] pattern not found in ${rel}: ${rep.from.slice(0, 60)}…`)
        continue
      }
      text = text.replace(rep.from, rep.to)
    }
    if (text === before) continue
    writeFileSync(path, text)
    changed += 1
    console.log(`[patch-evolution] patched ${rel}`)
  }
}

if (changed === 0) console.log('[patch-evolution] already applied or nothing to do')
