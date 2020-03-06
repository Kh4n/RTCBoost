import {assert, log} from "./misc"
import * as types from "./dtypes_json"
import Peer from "simple-peer"
import BoostPeer from "./boost_peer"
import PieceFile from "./piece_file"

export default class Swarm {
    ourID: string
    peers: Record<string, BoostPeer> = {}
    currentPiece: number = 0

    file: PieceFile

    signalingServer: WebSocket

    onsignalserverconnect: () => void

    constructor(file: PieceFile) {
        this.file = file
    }

    connect(signalAddr: string) {
        this.signalingServer = new WebSocket(signalAddr)
        this.signalingServer.onopen = function(_evt) {
            let j: types.join = {
                type: "join",
                fileID: this.file.fileName
            }
            this.signalToServer(j)
            log("Trying to join swarm with fileID: " + j.fileID)
            this.onsignalserverconnect()
        }.bind(this)
        this.signalingServer.onclose = function(_evt) {
            log("Disconnected from signaling server")
        }
        this.signalingServer.onmessage = this.handleSignalMessage.bind(this)
        this.signalingServer.onerror = function(evt: Event) {
            log("Error connecting to signaling server: " + evt)
        }
    }

    download(addr: string, pieceNum: number) {
        this.currentPiece = pieceNum
        for (let p in this.peers) {
            let peer = this.peers[p]
            if (peer.currentlyReceiving == -1) {
                this.requestFirstNeededPiece(peer, 6)
            }
        }
        
        if (this.file.isCompleted(pieceNum)) {
            log("Skipping piece: " + pieceNum)
            return
        }
        this.requestFromServer(addr, pieceNum)
        this.file.attempt(pieceNum)
    }

    requestFromServer(addr: string, pieceNum: number) {
        var xhr = new XMLHttpRequest()
        xhr.open("get", addr)
        xhr.responseType = "arraybuffer"
        xhr.onload = function() {
            // bypass overwriting peer piece if possible
            if (!this.file.isCompleted(pieceNum)) {
                log("Piece downloaded from server", xhr.response)
                this.file.addPiece(pieceNum, new Uint8Array(xhr.response))
                this.notifyPeers(pieceNum)
            }
        }.bind(this)
        xhr.send()
    }

    signalToServer(msg: any) {
        this.signalingServer.send(JSON.stringify(msg))
    }

    handleSignalMessage(evt: MessageEvent) {
        let msg = JSON.parse(evt.data)
        log("Response from signaling server:")
        console.log(msg)
        let t: types.msgTypes = msg.type
        switch(t) {
            case "forward": {
                this.notifySignaled(msg as types.forward)
                break
            }
            case "joinResponse": {
                let rsp: types.joinResponse = msg
                this.handleJoinResponse(rsp)
                break
            }
            default:
                log("Server sent unknown data:")
                console.log(msg)
                break
        }
    }

    handleJoinResponse(rsp: types.joinResponse) {
        this.ourID = rsp.peerID
        rsp.peerList.forEach(remotePeerID => {
            // don't connect to ourselves
            if (rsp.peerID != remotePeerID) {
                this.addPeer(remotePeerID, true)
            }
        });
    }

    notifySignaled(forward: types.forward) {
        if (!(forward.from in this.peers)) {
            this.addPeer(forward.from, false)
        }
        this.peers[forward.from].signal(forward.data)
    }

    notifyPeers(pieceNum: number) {
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

    addPeer(remotePeerID: string, initiator: boolean) {
        let p = new BoostPeer({initiator: initiator})
        p.on("signal", function(data: Peer.SignalData) {
            let f: types.forward = {
                type: "forward",
                from: this.ourID,
                to: remotePeerID,
                data: JSON.stringify(data)
            }
            this.signalToServer(f)
        }.bind(this))

        // any time a peer connects it greets with the pieces it has
        p.on("connect", function() {
            log("Peer with remote ID " + remotePeerID + " connected")
            let h: types.have = {
                type: "have",
                pieceNums: this.file.completed,
            }
            p.sendJSON(h)
        }.bind(this))

        p.on("data", this.generatePeerDataHandler(p))

        p.on("close", function() {
            delete this.peers[remotePeerID]
            log("Peer with remote ID " + remotePeerID + " disconnected")
        }.bind(this))
        this.peers[remotePeerID] = p
    }

    generatePeerDataHandler(remotePeer: BoostPeer): (chunk: Uint8Array) => void {
        return function(chunk: Uint8Array) {
            this.handlePeerData(remotePeer, chunk)
        }.bind(this)
    }

    requestFirstNeededPiece(remotePeer: BoostPeer, lookahead: number) {
        for (let pieceNum = this.currentPiece; pieceNum < this.currentPiece + lookahead; ++pieceNum) {
            if (remotePeer.ownedPieces.has(pieceNum) && !this.file.isAttemptingOrCompleted(pieceNum)) {
                let n: types.need = {
                    type: "need",
                    pieceNums: [pieceNum]
                }
                remotePeer.sendJSON(n)
                this.file.attempt(pieceNum)
                return
            }
        }
    }

    handlePeerData(remotePeer: BoostPeer, chunk: Uint8Array) {
        let msg = types.decodePeerMsg(chunk)
        let t = msg.type as types.p2pMsgTypes
        log("Received peer message:", msg)

        switch (t) {
            // TODO: load balancing better 
            case "have": {
                let h = msg as types.have
                for (let n of h.pieceNums) {
                    remotePeer.addOwnedPiece(n)
                }
                this.requestFirstNeededPiece(remotePeer, 6)
                break
            }
            case "need": {
                let n = msg as types.need
                for (let pieceNum of n.pieceNums) {
                    if (this.file.isCompleted(pieceNum)) {
                        remotePeer.sendPieceAsParts(pieceNum, this.file.data[pieceNum].buf)
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
                this.file.addPiecePart(pp)
                break
            }
            case "piecePartLast": {
                let pp = msg as types.piecePart
                remotePeer.currentlyReceiving = -1
                this.file.addPiecePart(pp)
                this.notifyPeers(pp.pieceNum)
                this.requestFirstNeededPiece(remotePeer, 6)
                break
            }

            default:
                log("Peer sent unknown data", chunk)
        }
    }
}

class PieceTracker {
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