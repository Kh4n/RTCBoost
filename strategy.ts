import boostPeer from "./boost_peer"
import * as types from "./dtypes_json"
import {assert, log} from "./misc"

export interface SwarmDownloadStrategy {
    generatePeerDataHandler: (remotePeer: boostPeer) => ((chunk: Uint8Array) => void)
    download: (addr: string, pieceNum: number) => void

    // called when the file callback has fired (onpiece)
    notifypiececompleted: (pieceNum: number) => void

    // called when peer has disconnected
    notifypeerdisconnect: (remotePeer: boostPeer) => void
    // called when swarm needs info on progress
    notifyneedinfo: () => Array<number>

    // callbacks that must be filled in by RTCbooster
    onpiecereceived: (pieceNum: number, piece: Uint8Array) => void
    onpiecepartreceived: (piecePart: types.piecePart) => void
    onneedpiece: (pieceNum: number) => Uint8Array
}

export class StreamStrategy implements SwarmDownloadStrategy {
    tracker: piecesTracker

    onpiecereceived: (pieceNum: number, piece: Uint8Array) => void
    onpiecepartreceived: (piecePart: types.piecePart) => void
    onneedpiece: (pieceNum: number) => Uint8Array

    notifypiececompleted(pieceNum: number) {
        this.tracker.setCompleted(pieceNum)
    }
    
    notifypeerdisconnect(remotePeer: boostPeer) {
        if (remotePeer.currentlyReceiving != -1) {
            this.tracker.cancelAttempt(remotePeer.currentlyReceiving)
        }
    }

    notifyneedinfo(): Array<number> {
        return this.tracker.getCompleted()
    }
    
    constructor() {
        this.tracker = new piecesTracker()
    }

    download(addr: string, pieceNum: number) {
        if (this.tracker.isCompleted(pieceNum)) {
            log("Skipping piece: " + pieceNum)
            return
        }

        var xhr = new XMLHttpRequest()
        xhr.open("get", addr)
        xhr.responseType = "arraybuffer"
        xhr.onload = function() {
            // bypass overwriting peer piece if possible
            if (!this.tracker.isCompleted(pieceNum)) {
                log("Piece downloaded from server", xhr.response)
                this.onpiecereceived(pieceNum, new Uint8Array(xhr.response))
            }
        }.bind(this)
        xhr.send()
        this.tracker.attempt(pieceNum)
    }

    generatePeerDataHandler(remotePeer: boostPeer): (chunk: Uint8Array) => void {
        return function(chunk: Uint8Array) {
            this.handlePeerData(remotePeer, chunk)
        }.bind(this)
    }

    serverAttempt(pieceNum: number) {
        this.tracker.attempt(pieceNum)
    }

    handlePeerData(remotePeer: boostPeer, chunk: Uint8Array) {
        let msg = types.decodePeerMsg(chunk)
        let t = msg.type as types.p2pMsgTypes
        log("Received peer message:", msg)

        switch (t) {
            // TODO: load balancing better 
            case "have": {
                let h = msg as types.have
                for (let n of h.pieceNums) {
                    this.tracker.addIfNeeded(n)
                    remotePeer.addOwnedPiece(n)
                }
                this.requestFirstMutualPiece(remotePeer)
                break
            }
            case "need": {
                let n = msg as types.need
                for (let pieceNum of n.pieceNums) {
                    if (this.tracker.isCompleted(pieceNum)) {
                        remotePeer.sendPieceAsParts(pieceNum, this.onneedpiece(pieceNum))
                        log("sent piece!")
                    }
                }
                break
            }
            // TODO: piece cancellation (may not be possible/necessary)
            case "cancel": {
                log("Cancel received: unimplemented")
            }

            case "piecePart": {
                let pp = msg as types.piecePart
                remotePeer.currentlyReceiving = pp.pieceNum
                this.onpiecepartreceived(pp)
                break
            }
            case "piecePartLast": {
                remotePeer.currentlyReceiving = -1
                this.onpiecepartreceived(msg as types.piecePart)
                this.requestFirstMutualPiece(remotePeer)
                break
            }

            default:
                log("Peer sent unknown data", chunk)
        }
    }

    requestFirstMutualPiece(remotePeer: boostPeer) {
        let needed = this.tracker.getNeeded()
        for (let pieceNum of needed) {
            if (remotePeer.ownedPieces.has(pieceNum)) {
                let n: types.need = {
                    type: "need",
                    pieceNums: [pieceNum],
                }
                remotePeer.sendJSON(n)
                this.tracker.attempt(pieceNum)
            }
        }
    }
    
}

class piecesTracker {
    needed: Set<number> = new Set<number>()
    attempting: Set<number> = new Set<number>()
    completed: Set<number> = new Set<number>()

    addIfNeeded(pieceNum: number) {
        if (!(this.isAttempting(pieceNum) || this.isCompleted(pieceNum))) {
            this.needed.add(pieceNum)
        }
    }

    setCompleted(pieceNum: number) {
        this.needed.delete(pieceNum)
        this.attempting.delete(pieceNum)
        if (!this.completed.has(pieceNum)) {
            this.completed.add(pieceNum)
        } else {
            log("Warning: attempted to set an already completed piece as completed")
        }
    }

    attempt(pieceNum: number) {
        if (!this.isAttempting(pieceNum)) {
            this.attempting.add(pieceNum)
            this.needed.delete(pieceNum)
        } else {
            log("Warning: cannot attempt piece twice")
        }
    }
    cancelAttempt(pieceNum: number) {
        if (!this.attempting.delete(pieceNum)) {
            log("Warning: attempted to cancel piece not being attempted: " + pieceNum)
        }
        if (!this.isCompleted(pieceNum)) {
            this.needed.add(pieceNum)
        }
    }

    isAttempting(pieceNum: number): boolean {
        return this.attempting.has(pieceNum)
    }
    isCompleted(pieceNum: number): boolean {
        return this.completed.has(pieceNum)
    }

    getNeeded(): Set<number> {
        return this.needed
    }
    getCompleted() {
        return Array.from(this.completed.values())
    }
}