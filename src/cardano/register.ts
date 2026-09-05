import { CommitteeColdCredential } from '@evolution-sdk/evolution'
import { blockfrostFetch } from './config'
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
    coldId: CommitteeColdCredential.toBech32(coldCredential),
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

export function isHotAuthorized(
  members: CommitteeMember[],
  hotId: string,
  coldId?: string,
): boolean {
  return members.some((member) => {
    const hotMatch = member.cc_hot_id === hotId
    const coldMatch = !coldId || member.cc_cold_id === coldId
    const authorized = (member.status ?? '').toLowerCase() === 'authorized'
    return hotMatch && coldMatch && authorized
  })
}
