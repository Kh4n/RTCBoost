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
export type p2pMsgTypes = "have" | "need" | "piecePart" | "piecePartLast"

export interface have {
    type: "have"
    pieceNums: Array<number>
}

export interface need {
    type: "need"
    pieceNums: Array<number>
}

export interface piecePart {
    type: "piecePart" | "piecePartLast"
    pieceNum: number
    partNum: number
    data: Uint8Array
}

const peerJSONMsg = 0x0
const peerUint8Part = 0x1
const peerUint8LastPart = 0x2

type peerMsgByte = 0x0 | 0x1 | 0x2

export function encodePeerMsg(msg: have | need): ArrayBuffer {
    let s = JSON.stringify(msg)
    let ret = new Uint8Array(s.length + 1)
    // safe because there is no way for these types to conatin non ASCII chars
    let arr = stringToUintList(s)
    arr.push(peerJSONMsg)
    ret.set(arr)
    return ret
}

export function encodePiecePart(num: number, part: number, offset: number, length: number, piece: ArrayBuffer): ArrayBuffer {
    let data = (new Uint8Array(piece)).subarray(offset, offset + length)
    let tosend = new Uint8Array(data.byteLength + 5)

    tosend.set(data)
    tosend[tosend.length - 5] = (num >> 8) & 0xFF
    tosend[tosend.length - 4] = num & 0xFF

    tosend[tosend.length - 3] = (part >> 8) & 0xFF
    tosend[tosend.length - 2] = part & 0xFF

    tosend[tosend.length - 1] = offset + length >= piece.byteLength ? peerUint8LastPart : peerUint8Part
    return tosend.buffer
}

function readPiecePart(chunk: ArrayBuffer, isLast: boolean): piecePart {
    let v = new Uint8Array(chunk)
    let pieceNum = v[v.length - 4] + (v[v.length - 5] << 8)
    let partNum = v[v.length - 2] + (v[v.length - 3] << 8)
    return {
        type: isLast ? "piecePartLast" : "piecePart",
        pieceNum: pieceNum,
        partNum: partNum,
        data: v.subarray(0, v.length - 5)
    }
}

function stringToUintList(string: string) {
    let charList = string.split(''),
        uintArray = []
    for (let i = 0; i < charList.length; i++) {
        uintArray.push(charList[i].charCodeAt(0))
    }
    return uintArray
}

export function decodePeerMsg(uintArray: Uint8Array): have | need | piecePart | {type:"none"} {
    let len = uintArray.length
    let p = uintArray[len - 1] as peerMsgByte
    switch (p) {
        case 0x0: {
            let msg = JSON.parse(String.fromCharCode.apply(null, uintArray.subarray(0, len - 1)))
            let t = msg.type as p2pMsgTypes
            switch (t) {
                case "have":
                    return msg as have
                case "need":
                    return msg as need
                case "piecePart":
                    console.log("Peer sent JSON marked as piece")
                    return {type:"none"}

                default:
                    console.log("Peer sent unknown data: " + msg)
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