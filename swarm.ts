import {assert, log} from "./misc"
import * as types from "./dtypes_json"
import pieceFile from "./piece_file"
import Peer from "simple-peer"

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
    cancel(pieceNum: number) {
        if (!this.attempting.delete(pieceNum)) {
            log("Warning: attempted to cancel piece not being attempted " + pieceNum)
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

export default class swarm {
    ourID: string
    peers: Record<string, boostPeer> = {}
    swarmSize: number

    tracker: piecesTracker

    onsignalready: (forward: types.forward) => void
    onpiecepartrecieved: (piecePart: types.piecePart) => void
    onneedpiece: (pieceNum: number) => Uint8Array

    onsignaled(forward: types.forward) {
        if (!(forward.from in this.peers)) {
            this.addPeer(forward.from, false)
        }
        this.peers[forward.from].signal(forward.data)
    }

    onpiececompleted(pieceNum: number) {
        this.tracker.setCompleted(pieceNum)
        let h: types.have = {
            type: "have",
            pieceNums: [pieceNum]
        }
        for (let p of Object.values(this.peers)) {
            try {
                p.sendJSON(h)
            } catch (_) {
                log("Peer not stable, they will be notified when connection is stable")
            }
        }
    }

    constructor() {
        this.tracker = new piecesTracker()
    }

    setOurID(id: string) {
        this.ourID = id
    }

    setSwarmSize(s: number) {
        this.swarmSize = s
    }

    serverAttempting(pieceNum: number) {
        this.tracker.attempt(pieceNum)
    }

    addPeer(remotePeerID: string, initiator: boolean) {
        let p = new boostPeer({initiator: initiator})
        p.on("signal", function(data: Peer.SignalData) {
            let f: types.forward = {
                type: "forward",
                from: this.ourID,
                to: remotePeerID,
                data: JSON.stringify(data)
            }
            this.onsignalready(f)
        }.bind(this))

        // any time a peer connects it greets with the pieces it has
        p.on("connect", function() {
            ++this.swarmSize
            log("Peer with remote ID " + remotePeerID + " connected")
            let h: types.have = {
                type: "have",
                pieceNums: this.tracker.getCompleted()
            }
            p.sendJSON(h)
        }.bind(this))

        p.on("data", this.generatePeerDataHandler(p))

        p.on("close", function() {
            if (p.currentlySending != -1) {
                this.tracker.cancel(p.currentlySending)
            }
            delete this.peers[remotePeerID]
            --this.swarmSize
            log("Peer with remote ID " + remotePeerID + " disconnected")
        }.bind(this))
        this.peers[remotePeerID] = p
    }

    generatePeerDataHandler(remotePeer: boostPeer): (chunk: Peer.SimplePeerData) => void {
        return function(chunk: Peer.SimplePeerData) {
            this.handlePeerData(remotePeer, chunk)
        }.bind(this)
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
                let pn = remotePeer.requestFirstMutualPiece(this.tracker.getNeeded())
                if (pn != -1) {
                    this.tracker.attempt(pn)
                }
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

            case "piecePart": {
                let pp = msg as types.piecePart
                remotePeer.currentlySending = pp.pieceNum
                this.onpiecepartrecieved(pp)
                break
            }
            case "piecePartLast": {
                remotePeer.currentlySending = -1
                this.onpiecepartrecieved(msg as types.piecePart)
                let pn = remotePeer.requestFirstMutualPiece(this.tracker.getNeeded())
                if (pn != -1) {
                    this.tracker.attempt(pn)
                }
                break
            }

            default:
                log("Peer sent unknown data", chunk)
        }
    }
}

class boostPeer extends Peer {
    // safe default size
    partLen: number = 16000
    ownedPieces: Set<number> = new Set<number>()
    currentlySending: number = -1

    constructor(opts: Peer.Options) {
        super(opts)
    }

    requestFirstMutualPiece(needed: Set<number>): number {
        for (let pieceNum of needed) {
            if (this.ownedPieces.has(pieceNum)) {
                let n: types.need = {
                    type: "need",
                    pieceNums: [pieceNum],
                }
                this.sendJSON(n)
                return pieceNum
            }
        }
        return -1
    }

    addOwnedPiece(pieceNum: number) {
        this.ownedPieces.add(pieceNum)
    }

    // optimum part length is basically always 16kb
    sendPieceAsParts(pieceNum: number, piece: Uint8Array) {
        let pieceLen = piece.byteLength
        for (let offset = 0, part = 0; offset < pieceLen; offset += this.partLen, ++part) {
            this.send(types.encodePiecePart(pieceNum, part, offset, this.partLen, piece))
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