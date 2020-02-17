import * as types from "./dtypes_json"
import Peer from "simple-peer"

// data structure to keep track of a file made up of separate pieces
class pieceFile {
    // no need for Map, as we dont need ordering on iteration
    data: Record<number, ArrayBuffer> = {}
    // need to distinguish between what is being attempted and what is being done, as a piece in data is
    // fully allocated when the first part arrives, which means it is in data before it is available
    attempting: Set<number> = new Set<number>()

    // keep track of ordering
    nextPiece: number = 0
    piecesDownloaded: number = 0
    pieceLength: number
    totalPieces: number

    // fires when file is completely downloaded. also assembles file into a blob
    onfilecomplete: (file: Blob) => void = function(_) {}

    // when any piece is downloaded
    onpiece: (pieceNum: number, piece: ArrayBuffer) => void = function(_1, _2) {}

    // when the next piece in order is downloaded
    // can fire repeatedly in certain circumstances: 
    // eg piece 3, 2, 1 downloaded, it wont fire, and the once 0 is downloaded it fires 4 times for 0, 1, 2, 3
    onnextpiece: (piece: ArrayBuffer) => void = function(_) {}

    // if totalPieces is negative, we dont know how many pieces there are, and onfilecomplete will never fire
    constructor(pieceLength: number, totalPieces: number) {
        this.pieceLength = pieceLength
        this.totalPieces = totalPieces
    }

    // add part of a piece
    addPiecePart(pp: types.piecePart) {
        // server beat us to it
        if (this.isCompleted(pp.pieceNum)) {
            return
        }
        // allocate entire piece
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

        // transmission is done in order, so when we recieve the last part, we know that the download is finished
        // if that becomes an issue, we can always just keep track of each download separately 
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
            while (this.isCompleted(this.nextPiece)) {
                this.onnextpiece(this.data[this.nextPiece])
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

    // only 60 seconds to download any piece, after that maybe try from another peer
    // probably need to make a better way to do this
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

    // client should hook their download call to this, or they can call download immediately and it will connect ASAP
    onsignalserverconnect: () => void = function() { log("Connected to signaling server") }

    constructor(signalAddr: string, fname: string, pieceLength: number, totalPieces: number = -1) {
        this.swarm = {}
        this.file = new pieceFile(pieceLength, totalPieces)
        this.file.onfilecomplete = function(file: Blob) {
            this.onfilecomplete(file)
        }.bind(this)

        // alert swarm if we have a new piece
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
                // make a new remote peer if it does not exist already
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
            // dont connect to ourselves
            if (rsp.peerID != remotePeerID) {
                this.swarm[remotePeerID] = this.makeNewPeer(remotePeerID)
            }
        });
    }

    // initiator specifies if we call createOffer vs createAnswer basically
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

        // any time a peer connects it greets with the pieces it has
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
            // TODO: load balancing
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

    // TODO: get the optimum partLength
    sendPieceAsParts(remotePeer: Peer.Instance, pieceNum: number, partLen: number = 16000) {
        let pieceLen = this.file.pieceLength
        let piece = this.file.data[pieceNum]
        for (let offset = 0, part = 0; offset < pieceLen; offset += partLen, ++part) {
            remotePeer.send(types.encodePiecePart(pieceNum, part, offset, partLen, piece))
        }
    }
 
    download(addr: string, pieceNum: number) {
        if (!this.requestedJoinSwarm && this.signalingServer.readyState === WebSocket.OPEN) {
            let j: types.join = {
                type: "join",
                fileID: this.fileName
            }
            this.signalToServer(j)
            log("Trying to join swarm with fileID: " + j.fileID)
            this.requestedJoinSwarm = true
        } else if (this.signalingServer.readyState !== WebSocket.OPEN) {
            log("Warning: download called before connection to signaling server established")
            // don't exit, still try to download (subject to change in future versions maybe?)
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


// logging function, courtesy Mozilla
function log(text: string, plainLog?: any) {
    let time = new Date()
    console.log("[" + time.toLocaleTimeString() + "] " + text)
    if (plainLog) {
        console.log(plainLog)
    }
}