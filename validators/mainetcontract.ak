use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use aiken/option
use cardano/assets.{AssetName, PolicyId, quantity_of}
use cardano/script_context.{ScriptContext}
use cardano/transaction.{InlineDatum, Transaction}

pub type MultisigDescriptor {
  signers: List<VerificationKeyHash>,
  m: Int,
}

validator configHost {
  spend(
    datum: Option<MultisigDescriptor>,
    _redeemer,
    _utxo,
    transaction: Transaction,
  ) {
    when datum is {
      Some(adminData) ->
        list.count(
          adminData.signers,
          fn(signer) { list.has(transaction.extra_signatories, signer) },
        ) == adminData.m
      None -> fail
    }
  }

  else(_) {
    fail
  }
}

validator multisig {
  else(ctx: ScriptContext) {
    let adminTokenPolicy: PolicyId =
      #"1f1ec82e83cf152527117c8dddff549ea09e4befb4f4ae792bf8e695"
    let adminTokenName: AssetName = #"416e65746156322d61646d696e"

    let adminUtxo =
      ctx.transaction.reference_inputs
        |> list.find(
            fn(x) {
              quantity_of(x.output.value, adminTokenPolicy, adminTokenName) > 0
            },
          )

    expect adminData: MultisigDescriptor =
      option.or_else(
        option.map(
          adminUtxo,
          fn(utxo) {
            when utxo.output.datum is {
              InlineDatum(data) -> data
              _ -> fail
            }
          },
        ),
        None,
      )

    list.count(
      adminData.signers,
      fn(signer) { list.has(ctx.transaction.extra_signatories, signer) },
    ) == adminData.m
  }
}
