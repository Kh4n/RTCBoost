import * as types from "./dtypes_json"
import Peer from "simple-peer"

class pieceFile {
    data: Record<number, ArrayBuffer> = {}
    attempting: Set<number> = new Set<number>()
    nextPiece: number = 0
    piecesDownloaded: number = 0
    pieceLength: number
    totalPieces: number

    onfilecomplete: (file: Blob) => void = function(_) {}
    onpiece: (pieceNum: number, piece: ArrayBuffer) => void = function(_1, _2) {}
    onnextpiece: (piece: ArrayBuffer) => void = function(_) {}

    constructor(pieceLength: number, totalPieces: number) {
        this.pieceLength = pieceLength
        this.totalPieces = totalPieces
    }

    addPiecePart(pp: types.piecePart) {
        if (this.isCompleted(pp.pieceNum)) {
            return
        }
        if (!(pp.pieceNum in this.data)) {
            this.attempt(pp.pieceNum)
            this.data[pp.pieceNum] = new ArrayBuffer(this.pieceLength)
        }
        let offset = pp.partNum * pp.data.byteLength
        if (offset > this.pieceLength) {
            log("Critical: peer sent part outside of piece boundary")
            return
        }
        let byteView = new Uint8Array(this.data[pp.pieceNum])
        byteView.set(pp.data, offset)

        if (pp.type == "piecePartLast") {
            this.notifyPiece(pp.pieceNum, this.data[pp.pieceNum])
        }
    }

    addPiece(pieceNum: number, piece: ArrayBuffer) {
        this.data[pieceNum] = piece
        this.notifyPiece(pieceNum, piece)
    }

    notifyPiece(pieceNum: number, piece: ArrayBuffer) {
        this.onpiece(pieceNum, piece)
        ++this.piecesDownloaded
        this.attempting.delete(pieceNum)

        if (pieceNum == this.nextPiece) {
            this.onnextpiece(piece)
            while (this.nextPiece in this.data) {
                ++this.nextPiece
            }
        }
        if (this.piecesDownloaded == this.totalPieces) {
            // TODO:
            // this.onfilecomplete(TODO)
            log("File download complete")
        }
    }

    isCompleted(pieceNum: number): boolean {
        return (pieceNum in this.data) && !this.attempting.has(pieceNum)
    }

    isAttemptingOrCompleted(pieceNum: number): boolean {
        // lets be safe
        return this.attempting.has(pieceNum) || (pieceNum in this.data)
    }

    attempt(pieceNum: number) {
        this.attempting.add(pieceNum)
        setTimeout(function() {
            if (this.attempting.has(pieceNum)) {
                this.attempting.delete(pieceNum)
            }
        }.bind(this), 60 * 1000)
    }

    availPieces(): Array<number> {
        let pieces = []
        for (let num in this.data) {
            pieces.push(num)
        }
        return pieces
    }
}

export class RTCBooster {
    signalingServer: WebSocket

    peerID: string
    swarm: Record<string, Peer.Instance>

    file: pieceFile
    fileName: string

    requestedJoinSwarm: boolean = false

    onfilecomplete: (file: Blob) => void = function(f) { log("Downloaded file", f) }
    onpiece: (pieceNum: number, piece: ArrayBuffer) => void = function(n, p) { log("Downloaded piece " + n, p) }
    onnextpiece: (piece: ArrayBuffer) => void = function(p) { log("Downloaded next piece", p) }

    onsignalserverconnect: () => void = function() { log("Connected to signaling server") }

    constructor(signalAddr: string, fname: string, pieceLength: number, totalPieces: number = -1) {
        this.swarm = {}
        this.file = new pieceFile(pieceLength, totalPieces)
        this.file.onfilecomplete = function(file: Blob) {
            this.onfilecomplete(file)
        }.bind(this)

        this.file.onpiece = function(pieceNum: number, piece: ArrayBuffer) {
            this.onpiece(pieceNum, piece)
            let availPieces = this.file.availPieces()
            for (let p of Object.values(this.swarm) as Peer.Instance[]) {
                let n: types.have = {
                    type: "have",
                    pieceNums: availPieces
                }
                p.send(types.encodePeerMsg(n))
            }
        }.bind(this)

        this.file.onnextpiece = function(piece: ArrayBuffer) {
            this.onnextpiece(piece)
        }.bind(this)

        this.fileName = fname

        this.onfilecomplete = function(_){ log("File " + fname + " has been downloaded") }

        this.signalingServer = new WebSocket(signalAddr)
        this.signalingServer.onopen = function(_evt) {
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
                let rsp: types.forward = msg
                if (!(rsp.from in this.swarm)) {
                    this.swarm[rsp.from] = this.makeNewPeer(rsp.from, false)
                }
                this.swarm[rsp.from].signal(rsp.data)
                break
            }

            case "joinResponse": {
                let rsp: types.joinResponse = msg
                this.peerID = rsp.peerID
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
        rsp.peerList.forEach(remotePeerID => {
            if (rsp.peerID != remotePeerID) {
                this.swarm[remotePeerID] = this.makeNewPeer(remotePeerID)
            }
        });
    }

    makeNewPeer(remotePeerID: string, initiator: boolean = true): Peer.Instance {
        let p = new Peer({initiator: initiator})
        p.on("signal", function(data: Peer.SignalData) {
            let f: types.forward = {
                type: "forward",
                from: this.peerID,
                to: remotePeerID,
                data: JSON.stringify(data)
            }
            this.signalToServer(f)
        }.bind(this))

        p.on("connect", function() {
            log("Peer with remote ID " + remotePeerID + " connected")
            let n: types.have = {
                type: "have",
                pieceNums: this.file.availPieces()
            }
            p.send(types.encodePeerMsg(n))
        }.bind(this))

        p.on("data", this.generatePeerDataHandler(p))
        
        p.on("close", function() {
            delete this.swarm[remotePeerID]
            log("Peer with remote ID " + remotePeerID + " disconnected")
        }.bind(this))

        log("Created peer with ID " + remotePeerID, p)

        return p
    }

    generatePeerDataHandler(remotePeer: Peer.Instance): (chunk: Peer.SimplePeerData) => void {
        return function(chunk: Peer.SimplePeerData) {
            this.handlePeerData(remotePeer, chunk)
        }.bind(this)
    }

    handlePeerData(remotePeer: Peer.Instance, chunk: Uint8Array) {
        let msg = types.decodePeerMsg(chunk)
        let t = msg.type as types.p2pMsgTypes
        log("Recieved peer message:", msg)

        switch (t) {
            case "have": {
                let h = msg as types.have
                let rsp: types.need = {
                    type: "need",
                    pieceNums: [],
                }
                for (let n of h.pieceNums) {
                    if (!this.file.isAttemptingOrCompleted(n)) {
                        rsp.pieceNums.push(n)
                    }
                }
                if (rsp.pieceNums.length > 0) {
                    remotePeer.send(types.encodePeerMsg(rsp))
                }
                break
            }
            case "need": {
                let n = msg as types.need
                for (let pieceNum of n.pieceNums) {
                    if (this.file.isCompleted(pieceNum)) {
                        this.sendPieceAsParts(remotePeer, pieceNum)
                    }
                }
                break
            }
            case "piecePart": case "piecePartLast": {
                let pp = msg as types.piecePart
                this.file.addPiecePart(pp)
                break
            }

            default:
                log("Peer sent unknown data", chunk)
        }
    }

    sendPieceAsParts(remotePeer: Peer.Instance, pieceNum: number, partLen: number = 16000) {
        let pieceLen = this.file.pieceLength
        let piece = this.file.data[pieceNum]
        for (let offset = 0, part = 0; offset < pieceLen; offset += partLen, ++part) {
            remotePeer.send(types.encodePiecePart(pieceNum, part, offset, partLen, piece))
        }
    }
 
    download(addr: string, pieceNum: number) {
        if (!this.requestedJoinSwarm) {
            let j: types.join = {
                type: "join",
                fileID: this.fileName
            }
            this.signalToServer(j)
            log("Trying to join swarm with fileID: " + j.fileID)
            this.requestedJoinSwarm = true
        }

        if (this.file.isCompleted(pieceNum)) {
            log("Skipping piece " + pieceNum)
            return
        }

        var xhr = new XMLHttpRequest()
        xhr.open("get", addr)
        xhr.responseType = "arraybuffer"
        xhr.onload = function() {
            // bypass expensive copy if possible
            if (!this.file.isCompleted(pieceNum)) {
                log("Piece downloaded from server", xhr.response)
                this.file.addPiece(pieceNum, xhr.response)
            }
        }.bind(this)
        xhr.send()
    }
}



function log(text: string, plainLog?: any) {
    let time = new Date()
    console.log("[" + time.toLocaleTimeString() + "] " + text)
    if (plainLog) {
        console.log(plainLog)
    }
}