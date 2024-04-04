import { UTxO } from "lucid-cardano";

export function requestId(request: UTxO): string{
    return request.txHash + request.outputIndex.toString();
}