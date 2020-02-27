import * as types from "./dtypes_json"
import Peer from "simple-peer"
import {assert, log} from "./misc"

export default class boostPeer extends Peer {
    partLen: number = 1<<14 // 16,384
    ownedPieces: Set<number> = new Set<number>()
    currentlyReceiving: number = -1
    cancel: boolean = false

    constructor(opts: Peer.Options) {
        super(opts)
    }

    addOwnedPiece(pieceNum: number) {
        this.ownedPieces.add(pieceNum)
    }

    // optimum part length is basically always 16kb
    sendPieceAsParts(pieceNum: number, piece: Uint8Array) {
        let pieceLen = piece.byteLength
        for (let offset = 0, part = 0; offset < pieceLen; offset += this.partLen, ++part) {
            if (!this.cancel) {
                this.send(types.encodePiecePart(pieceNum, part, offset, this.partLen, piece))
            } else {
                this.cancel = false
                log("Canceled sending piece to remote peer")
                break
            }
        }
    }

    // just in case sending bigger messages is better in the future
    signal(data: string) {
        super.signal(data)
        let sdpMaybe = JSON.parse(data) as RTCSessionDescription
        if (sdpMaybe.sdp) {
            const match = sdpMaybe.sdp.match(/a=max-message-size:\s*(\d+)/);
            if (match !== null && match.length >= 2) {
                log("Largest part size (not using it): " + parseInt(match[1]) )
            }
        }
    }

    sendJSON(data: types.have | types.need) {
        this.send(types.encodePeerMsg(data))
    }
}