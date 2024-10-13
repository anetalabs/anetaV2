use aiken/crypto.{ VerificationKeyHash}
use aiken/collection/list
use cardano/assets.{ PolicyId , AssetName , quantity_of }
use cardano/script_context.{ ScriptContext }
use cardano/transaction.{InlineDatum}
use aiken/option

type MultisigDescriptor {
  signers: List<VerificationKeyHash>,
  m: Int
}

validator multisig{
  else(ctx: ScriptContext) {
    let adminTokenPolicy : PolicyId  = #"a653490ca18233f06e7f69f4048f31ade4e3885750beae0170d7c8ae"
    let adminTokenName : AssetName  =  #"634e65746142726964676541646d696e"


    let adminUtxo = ctx.transaction.reference_inputs 
                     |> list.find(fn(x) { ( quantity_of(x.output.value  ,adminTokenPolicy ,adminTokenName) > 0 ) } ) 

    expect adminData: MultisigDescriptor  = option.or_else(option.map(adminUtxo, fn(utxo) {
                                                                  when (utxo.output.datum) is {
                                                                  InlineDatum(data) -> data
                                                                  _ -> fail}}), None)    
    

    list.count(adminData.signers, fn(signer) { list.has(ctx.transaction.extra_signatories, signer )}) == adminData.m
  }

}