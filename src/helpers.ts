import { UTxO } from "lucid-cardano";

export function requestId(request: UTxO): string{
    return request.txHash + request.outputIndex.toString();
}

export function toHexString(byteArray: Uint8Array): string {
    return Array.from(byteArray, (byte) => ('0' + (byte & 0xFF).toString(16)).slice(-2)).join('')
}

export function txId(txHash : string, index: Number): string{
    return txHash + index.toString();
}