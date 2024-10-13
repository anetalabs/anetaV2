import { redemptionRequest, mintRequest} from "./types.js";

export function requestId(request : redemptionRequest | mintRequest): string{
    return request.txHash + request.outputIndex.toString();
}

export function toHexString(byteArray: Uint8Array): string {
    return Array.from(byteArray, (byte) => ('0' + (byte & 0xFF).toString(16)).slice(-2)).join('')
}

export async function hash(s: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(s);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return toHexString(new Uint8Array(hash));
}

export function stringToHex(str) {
    let hex = '';
    for(let i = 0; i < str.length; i++) {
        let hexChar = str.charCodeAt(i).toString(16);
        hex += hexChar.padStart(2, '0');
    }
    return hex;
}


export function hexToString(hex) {
    let string = '';
    for(let i = 0; i < hex.length; i += 2) {
        string += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    }
    return string;
}

export function txId(txHash : string, index: Number): string{
    return txHash + index.toString();
}