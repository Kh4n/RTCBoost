import * as types from "./dtypes_json"
import Peer from "simple-peer"

class boostPeer extends Peer {
    // safe default size
    partLen: number = 16000

    constructor(opts: Peer.Options) {
        super(opts)
    }

    // optimum part length is basically always 16kb
    sendPieceAsParts(file: pieceFile, pieceNum: number) {
        let pieceLen = file.pieceLength
        let piece = file.data[pieceNum].buf
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

type pieceStatus = "pending" | "started" | "completed"

// represents a piece of a file
class filePiece {
    buf: Uint8Array
    buflenActual: number = 0
    // need to distinguish between what is being attempted and what is done, as a piece in data is
    // fully allocated when the first part arrives, which means it is in data before it is available
    status: pieceStatus = "pending"

    constructor(from: Uint8Array | number, status: pieceStatus = "pending") {
        if (typeof from == "number") {
            this.buf = new Uint8Array(from as number)
        } else {
            this.buf = from as Uint8Array
            this.buflenActual = from.byteLength
        }
        this.status = status
    }

    copyPart(from: Uint8Array, isLast: boolean) {
        if (this.buflenActual + from.byteLength > this.buf.byteLength) {
            log("Critical: peer sent part outside of piece boundary")
            this.status = "pending"
            throw "peer sent part outside of piece boundary"
        }
        this.buf.set(from, this.buflenActual)
        this.buflenActual += from.byteLength

        this.status = "started"
        if (isLast) {
            this.buf = this.buf.subarray(0, this.buflenActual)
            this.status = "completed"
        }
    }

    swap(newBuf: Uint8Array) {
        this.buf = newBuf
    }

    reset() {
        this.status = "pending"
    }
}

// data structure to keep track of a file made up of separate pieces
class pieceFile {
    // no need for Map, as we dont need ordering on iteration
    data: Record<number, filePiece> = {}

    // need to store buffer because accessing it from file is just not practical
    fileBuffer: Uint8Array = null
    complete: boolean = false
    fileName: string

    // keep track of ordering
    nextPiece: number = 0
    piecesDownloaded: number = 0
    pieceLength: number
    totalPieces: number

    // fires when file is completely downloaded. also assembles file into a blob (unimplemented)
    onfilecomplete: (file: File) => void = function(_) {}

    // when any piece is downloaded
    onpiece: (pieceNum: number, piece: Uint8Array, fromServer: boolean) => void = function(_1, _2, _3) {}

    // when the next piece in order is downloaded
    // can fire repeatedly in certain circumstances: 
    // eg piece 3, 2, 1 downloaded, it wont fire, and then once 0 is downloaded it fires 4 times for 0, 1, 2, 3
    onnextpiece: (piece: Uint8Array, fromServer: boolean) => void = function(_) {}

    // if totalPieces is negative, we dont know how many pieces there are, and onfilecomplete will never fire
    constructor(fname: string, pieceLength: number, totalPieces: number) {
        this.fileName = fname + Date.now()
        this.pieceLength = pieceLength
        this.totalPieces = totalPieces
    }

    // add part of a piece
    addPiecePart(pp: types.piecePart) {
        // server beat us to it
        if (this.isCompleted(pp.pieceNum)) {
            return
        }
        if (this.complete) {
            log("Warning: addPiecePart called when file is already downloaded")
            return 
        }
        // allocate entire piece
        if (!(pp.pieceNum in this.data)) {
            this.data[pp.pieceNum] = new filePiece(this.pieceLength)
        }
        
        this.data[pp.pieceNum].copyPart(pp.data, pp.type == "piecePartLast")

        // transmission is done in order, so when we receive the last part, we know that the download is finished
        // if that becomes an issue, we can always just keep track of each download separately 
        if (pp.type == "piecePartLast") {
            this.notifyPiece(pp.pieceNum)
        }
    }

    addPiece(pieceNum: number, piece: Uint8Array) {
        if (this.complete) {
            log("Warning: addPiece called when file is already downloaded")
            return
        }
        this.data[pieceNum] = new filePiece(piece, "completed")
        this.notifyPiece(pieceNum, true)
    }

    notifyPiece(pieceNum: number, fromServer: boolean = false) {
        let piece = this.data[pieceNum].buf
        try {
            this.onpiece(pieceNum, piece, fromServer)
        } catch(e) {
            log("Error occured in onpiece handler:", e as Error)
        }
        ++this.piecesDownloaded

        if (pieceNum == this.nextPiece) {
            while (this.isCompleted(this.nextPiece)) {
                try {
                    this.onnextpiece(this.data[this.nextPiece].buf, fromServer)
                } catch (e) {
                    log("Error occured in onnextpiece handler:", e as Error)
                }
                ++this.nextPiece
            }
        }
        if (this.piecesDownloaded == this.totalPieces) {
            this.generateFile()
            this.onfilecomplete(new File([this.fileBuffer] as Array<BlobPart>, this.fileName))
        }
    }

    generateFile() {
        let pieces = Object.values(this.data) as Array<filePiece>
        let size = 0
        for (let p of pieces) {
            if (p.status == "completed") {
                size += p.buf.byteLength
            } else {
                throw "generateFile called before file is complete"
            }
        }
        this.fileBuffer = new Uint8Array(size)
        let offset = 0
        for (let p of pieces) {
            this.fileBuffer.set(p.buf, offset)
            let plen = p.buf.byteLength
            p.swap(this.fileBuffer.subarray(offset, offset + plen))
            offset += plen
        }
        this.complete = true
    }

    isCompleted(pieceNum: number): boolean {
        let d = this.data
        return pieceNum in d && d[pieceNum].status == "completed"
    }

    isAttemptingOrCompleted(pieceNum: number): boolean {
        let d = this.data
        return pieceNum in d && d[pieceNum].status != "pending"
    }

    // only 60 seconds to download any piece, after that maybe try from another peer
    // probably need to make a better way to do this
    attempt(pieceNum: number) {
        if (pieceNum in this.data) {
            this.data[pieceNum].status = "started"
        }
        setTimeout(function() {
            if (!this.isCompleted(pieceNum)) {
                this.data[pieceNum].reset()
            }
        }.bind(this), 60 * 1000)
    }

    availPieces(): Array<number> {
        let pieces = []
        for (let num in this.data) {
            if (this.isCompleted(parseInt(num))) {
                pieces.push(num)
            }
        }
        return pieces
    }
}

export class RTCBooster {
    signalingServer: WebSocket

    peerID: string
    swarm: Record<string, boostPeer>

    file: pieceFile
    fileName: string

    requestedJoinSwarm: boolean = false

    onfilecomplete: (file: File) => void = function(f) { log("Downloaded file", f) }
    onpiece: (pieceNum: number, piece: Uint8Array, fromServer: boolean) => void = function(n, p, _f) { log("Downloaded piece " + n, p) }
    onnextpiece: (piece: Uint8Array, fromServer: boolean) => void = function(p, _f) { log("Downloaded next piece", p) }

    // client should hook their download call to this, or they can call download immediately and it will connect ASAP
    onsignalserverconnect: () => void = function() { log("Connected to signaling server") }

    constructor(signalAddr: string, fname: string, pieceLength: number, totalPieces: number = -1) {
        this.swarm = {}
        this.file = new pieceFile(fname, pieceLength, totalPieces)
        this.file.onfilecomplete = function(file: File) {
            this.onfilecomplete(file)
        }.bind(this)

        // alert swarm if we have a new piece
        this.file.onpiece = function(pieceNum: number, piece: Uint8Array, fromServer: boolean) {
            this.onpiece(pieceNum, piece, fromServer)
            for (let p of Object.values(this.swarm) as boostPeer[]) {
                let n: types.have = {
                    type: "have",
                    pieceNums: [pieceNum]
                }
                try {
                    p.sendJSON(n)
                } catch (_) {
                    log("peer not stable, they will be notified when connection is stable")
                }
            }
        }.bind(this)

        this.file.onnextpiece = function(piece: Uint8Array, fromServer: boolean) {
            this.onnextpiece(piece, fromServer)
        }.bind(this)

        this.fileName = fname

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
    makeNewPeer(remotePeerID: string, initiator: boolean = true): boostPeer {
        let p = new boostPeer({initiator: initiator})
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
            p.sendJSON(n)
        }.bind(this))

        p.on("data", this.generatePeerDataHandler(p))
        
        p.on("close", function() {
            delete this.swarm[remotePeerID]
            log("Peer with remote ID " + remotePeerID + " disconnected")
        }.bind(this))

        log("Created peer with ID " + remotePeerID, p)

        return p
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
                    remotePeer.sendJSON(rsp)
                }
                break
            }
            case "need": {
                let n = msg as types.need
                for (let pieceNum of n.pieceNums) {
                    if (this.file.isCompleted(pieceNum)) {
                        remotePeer.sendPieceAsParts(this.file, pieceNum)
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
                this.file.addPiece(pieceNum, new Uint8Array(xhr.response))
            }
        }.bind(this)
        xhr.send()
        this.file.attempt(pieceNum)
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