use aiken/hash.{Blake2b_224, Hash}
use aiken/transaction/credential.{VerificationKey}
use aiken/list
use aiken/transaction/value.{ PolicyId , AssetName  }
use aiken/transaction.{ ScriptContext, InlineDatum }
use aiken/option

type MultisigDescriptor {
  signers: List< Hash<Blake2b_224, VerificationKey>>,
  m: Int
}

validator( ){
 
  fn multisig( _ , __, ctx: ScriptContext) {
    let adminTokenPolicy : PolicyId  = #"a653490ca18233f06e7f69f4048f31ade4e3885750beae0170d7c8ae"
    let adminTokenName : AssetName  =  #"634e65746142726964676541646d696e"


    let adminUtxo = ctx.transaction.reference_inputs 
                     |> list.find(fn(x) { ( value.quantity_of(x.output.value  ,adminTokenPolicy ,adminTokenName) > 0 ) } ) 

    expect adminData: MultisigDescriptor  = option.or_else(option.map(adminUtxo, fn(utxo) {
                                                                  when (utxo.output.datum) is {
                                                                  InlineDatum(data) -> data
                                                                  _ -> fail}}), None)    
    

    list.count(adminData.signers, fn(signer) { list.has(ctx.transaction.extra_signatories, signer )}) == adminData.m
  }

}