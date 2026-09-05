import { blockfrostFetch } from './config'
import { ccColdBech32 } from './cip129'
import {
  applyScriptRequirements,
  buildUnsignedCbor,
  certificateRedeemer,
  changeAddressFromRequirement,
  createReadClient,
  parseWalletScript,
  scriptFromRequirements,
  scriptToColdCredential,
} from './cip141'
import type { HotWallet } from './hotWallet'
import { firstRequirement, type Cip141Api } from './keypact'

export type RegisterResult = {
  txHash: string
  coldId: string
  hotId: string
}

export async function registerHotKey(
  cip141: Cip141Api,
  hotWallet: HotWallet,
): Promise<RegisterResult> {
  // Keypact's companion forwards both calls over one BroPort. Run them
  // sequentially so getScript's [version, cbor] cannot land in requirements.
  const requirements = await cip141.getScriptRequirements()
  const requirement = firstRequirement(requirements)
  if (!requirement.collateral) {
    throw new Error(
      'Keypact returned no collateral UTxO. Set a collateral donor in the smart wallet, then reconnect.',
    )
  }
  // Prefer scriptRef from reference inputs (already on-chain encoding). Fall
  // back to getScript() with Lucid double-CBOR unwrapped in parseWalletScript.
  const script =
    scriptFromRequirements(requirement) ?? parseWalletScript(await cip141.getScript())
  const { credential: coldCredential } = scriptToColdCredential(script)
  // Fees + collateral must come from the collateral-donor payment key, not the
  // script address. Keypact's getChangeAddress() returns the script address.
  const changeAddress = changeAddressFromRequirement(requirement)

  const client = createReadClient(changeAddress)
  const built = await applyScriptRequirements(client.newTx(), requirement, script)
    .authCommitteeHot({
      coldCredential,
      hotCredential: hotWallet.keyHash,
      redeemer: certificateRedeemer(requirement),
      label: 'authCommitteeHot',
    })
    .build({
      changeAddress,
    })

  const unsigned = await buildUnsignedCbor(built)
  const txHash = await cip141.submitUnsignedTx(unsigned)

  return {
    txHash,
    coldId: ccColdBech32(coldCredential),
    hotId: hotWallet.ccHotId,
  }
}

export type CommitteeMember = {
  status?: string | null
  cc_hot_id?: string | null
  cc_cold_id?: string | null
  expiration_epoch?: number | null
}

type BlockfrostCommittee = {
  members?: CommitteeMember[]
}

export async function fetchCommitteeMembers(): Promise<CommitteeMember[]> {
  const committee = await blockfrostFetch<BlockfrostCommittee>('/governance/committee')
  return committee.members ?? []
}

export type AuthorizationCheck = {
  authorized: boolean
  member?: CommitteeMember
  /** Human-readable explanation when not authorized. */
  detail: string
}

/**
 * A successful authCommitteeHot tx is not enough: the cold credential must also
 * be on the current committee roster (NewCommittee / genesis), and its active
 * hot must match. Blockfrost /governance/committee is the source of truth.
 */
export function checkHotAuthorization(
  members: CommitteeMember[],
  hotId: string,
  coldId?: string,
): AuthorizationCheck {
  if (coldId) {
    const byCold = members.find((member) => member.cc_cold_id === coldId)
    if (!byCold) {
      return {
        authorized: false,
        detail:
          `Cold ${coldId} is not on the current constitutional committee. ` +
          `An authCommitteeHot transaction only links a hot key to that cold; ` +
          `it does not add the cold to the committee. Voting requires a cold seat ` +
          `from a NewCommittee action (or the genesis committee).`,
      }
    }
    const hotMatch = byCold.cc_hot_id === hotId
    const authorized = (byCold.status ?? '').toLowerCase() === 'authorized' && hotMatch
    if (authorized) {
      return { authorized: true, member: byCold, detail: 'Hot credential is authorized on the committee.' }
    }
    if ((byCold.status ?? '').toLowerCase() === 'resigned') {
      return {
        authorized: false,
        member: byCold,
        detail: `Cold ${coldId} is on the committee but has resigned.`,
      }
    }
    return {
      authorized: false,
      member: byCold,
      detail:
        `Cold ${coldId} is on the committee, but its active hot is ` +
        `${byCold.cc_hot_id ?? 'none'} (status: ${byCold.status ?? 'unknown'}), not ${hotId}. ` +
        `If you just submitted authCommitteeHot, wait for the indexer — or confirm the CIP-30 wallet matches.`,
    }
  }

  const byHot = members.find((member) => member.cc_hot_id === hotId)
  if (byHot && (byHot.status ?? '').toLowerCase() === 'authorized') {
    return { authorized: true, member: byHot, detail: 'Hot credential is authorized on the committee.' }
  }
  if (byHot) {
    return {
      authorized: false,
      member: byHot,
      detail: `Hot ${hotId} appears on the committee with status ${byHot.status ?? 'unknown'}.`,
    }
  }
  return {
    authorized: false,
    detail:
      `Hot ${hotId} is not the active hot for any current committee member. ` +
      `authCommitteeHot alone is not enough — the Keypact cold must already hold a committee seat, ` +
      `and Blockfrost must list this hot under that member.`,
  }
}

export function isHotAuthorized(
  members: CommitteeMember[],
  hotId: string,
  coldId?: string,
): boolean {
  return checkHotAuthorization(members, hotId, coldId).authorized
}
