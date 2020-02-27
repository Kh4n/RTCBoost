export type msgTypes = "forward" | "join" | "joinResponse"

interface all {
    type: msgTypes
}

export interface forward extends all {
	type: "forward"
	from: string
    to: string
	data: string
}

export interface join extends all {
    type: "join"
    fileID: string
}
export interface joinResponse extends all {
    type: "joinResponse"
    peerID: string
    peerList: Array<string>
}

// peer to peer types
export type p2pMsgTypes = "have" | "need" | "cancel" | "piecePart" | "piecePartLast"

export interface have {
    type: "have"
    pieceNums: Array<number>
}

export interface need {
    type: "need"
    pieceNums: Array<number>
}

export interface cancel {
    type: "cancel"
    pieceNum: number
}

export interface piecePart {
    type: "piecePart" | "piecePartLast"
    pieceNum: number
    partNum: number
    data: Uint8Array
}

// this is admittedly a little confusing, not sure of alternative ways to convey this info
const peerJSONMsg = 0x0
const peerUint8Part = 0x1
const peerUint8LastPart = 0x2

type peerMsgByte = 0x0 | 0x1 | 0x2

// we cannot tell what is being sent over, so we just assume everything is Uint8Array
// we use a type byte to distinguish between JSON and actual Uint8 data
export function encodePeerMsg(msg: have | need): Uint8Array {
    let s = JSON.stringify(msg)
    let ret = new Uint8Array(s.length + 1)
    // safe because there is no way for these types to contain non ASCII chars
    let arr = stringToUintList(s)
    arr.push(peerJSONMsg)
    ret.set(arr)
    return ret
}

// structure: data:pieceNum:partNum:0x1||0x0
// encoding at the end because it will be faster when array.transfer is available (realloc for JS basically)
export function encodePiecePart(num: number, part: number, offset: number, length: number, piece: Uint8Array): Uint8Array {
    if (piece.length == 0) {
        throw "cannot encode empty piece part"
    }
    let data = piece.subarray(offset, offset + length)
    let toSend = new Uint8Array(data.byteLength + 5)

    toSend.set(data)

    // encode piece num
    toSend[toSend.length - 5] = (num >> 8) & 0xFF
    toSend[toSend.length - 4] = num & 0xFF

    toSend[toSend.length - 3] = (part >> 8) & 0xFF
    toSend[toSend.length - 2] = part & 0xFF

    toSend[toSend.length - 1] = offset + length >= piece.byteLength ? peerUint8LastPart : peerUint8Part
    return toSend
}

// read a part sent over from a remote peer, and also decide if it was the last part of the transmission
function readPiecePart(chunk: Uint8Array, isLast: boolean): piecePart {
    let pieceNum = chunk[chunk.length - 4] + (chunk[chunk.length - 5] << 8)
    let partNum = chunk[chunk.length - 2] + (chunk[chunk.length - 3] << 8)
    return {
        type: isLast ? "piecePartLast" : "piecePart",
        pieceNum: pieceNum,
        partNum: partNum,
        data: chunk.subarray(0, chunk.length - 5)
    }
}

// THIS IS UNSAFE FOR UTF strings!! only for ASCII
function stringToUintList(string: string) {
    let charList = string.split(''),
        uintArray = []
    for (let i = 0; i < charList.length; i++) {
        uintArray.push(charList[i].charCodeAt(0))
    }
    return uintArray
}

export function decodePeerMsg(uintArray: Uint8Array): have | need | cancel | piecePart | {type:"none"} {
    let len = uintArray.length
    let p = uintArray[len - 1] as peerMsgByte
    switch (p) {
        case peerJSONMsg: {
            let msg = JSON.parse(String.fromCharCode.apply(null, uintArray.subarray(0, len - 1)))
            let t = msg.type as p2pMsgTypes
            switch (t) {
                case "have":
                    return msg as have
                case "need":
                    return msg as need
                case "cancel":
                    return msg as cancel
                case "piecePart":
                    console.log("Peer sent JSON marked as piece")
                    return {type:"none"}

                default:
                    console.log("Peer sent unknown JSON data: " + msg)
                    return {type:"none"}
            }
        }
        case peerUint8Part: case peerUint8LastPart:
            return readPiecePart(uintArray, p == peerUint8LastPart)
        
        default:
            console.log("Peer sent unknown data: " + uintArray)
            return {type:"none"}
    }
}