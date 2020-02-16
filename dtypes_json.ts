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
export type p2pMsgTypes = "have" | "need" | "piece"

export interface have {
    type: "have"
    pieceNums: Array<number>
}

export interface need {
    type: "need"
    pieceNums: Array<number>
}

export interface piece {
    type: "piece"
    pieceNum: number
    data: ArrayBuffer
}

export function makePiece(piece: ArrayBuffer, num: number): ArrayBuffer {
    let data = new Uint8Array(piece)
    let tosend = new Uint8Array(piece.byteLength + 2)

    tosend.set(data)
    tosend[tosend.length - 2] = num >> 4
    tosend[tosend.length - 1] = num & 0x0F
    return tosend.buffer
}

export function readPiece(chunk: ArrayBuffer): piece {
    let v = new Uint8Array(chunk)
    let pieceNum = v[v.length - 1] + (v[v.length - 2] << 4)
    return {
        type: "piece",
        pieceNum: pieceNum,
        data: v.slice(0, v.length - 1).buffer
    }
}