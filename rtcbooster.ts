import * as types from "./dtypes_json"
import Peer from "simple-peer"

// TODO: figure out how to send array buffers over reliably
class pieceFile {
    data: Record<number, ArrayBuffer> = {}
    onserverdownloadedfile: (pieceNum: number) => void = function(_){}

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

    constructor(signalAddr: string, fname: string) {
        this.swarm = {}
        this.file = new pieceFile()
        this.fileName = fname

        this.signalingServer = new WebSocket(signalAddr)
        this.signalingServer.onopen = function(_evt) {
            log("Connected to signaling server")
        }
        this.signalingServer.onclose = function(_evt) {
            log("Disconnected from signaling server")
        }
        this.signalingServer.onmessage = this.handleSignalMessage.bind(this)
        this.signalingServer.onerror = function(evt: Event) {
            log("Error connecting to signaling server: " + evt)
        }

        let j: types.join = {
            type: "join",
            fileID: fname
        }
        this.signalToServer(j)
        log("Trying to join swarm with fileID:", j)
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
            this.swarm[remotePeerID] = this.makeNewPeer(remotePeerID)
        });
    }

    makeNewPeer(remotePeerID: string, initiator: boolean = true): Peer.Instance {
        let p = new Peer({initiator: initiator})
        if (initiator) {
            p.on("signal", function(data: Peer.SignalData) {
                let f: types.forward = {
                    type: "forward",
                    from: this.peerID,
                    to: remotePeerID,
                    data: JSON.stringify(data)
                }
                this.signalToServer(f)
            }.bind(this))
        }

        p.on("connect", function() {
            let n: types.have = {
                type: "have",
                pieceNums: this.file.availPieces()
            }
            p.send(JSON.stringify(n))
        }.bind(this))

        p.on("data", function(chunk: ArrayBuffer) {

        }.bind(this))
        
        p.on("close", function() {
            log("Peer with remote ID " + remotePeerID + " disconnected")
        })

        return p
    }

    generatePeerDataHandler(remotePeer: Peer.Instance): (chunk: Peer.SimplePeerData) => void {
        return function(chunk: Peer.SimplePeerData) {
            switch (typeof chunk) {
                case "string": {
                    this.handleStringPeerData(remotePeer, chunk as string)
                }
                case "object": {
                    let piece = types.readPiece(chunk as ArrayBuffer)
                    this.file.data[piece.pieceNum] = piece.data
                }

                default:
                    log("Peer sent unknown data", remotePeer)
            }
        }.bind(this)
    }

    handleStringPeerData(remotePeer: Peer.Instance, chunk: string) {
        let msg = JSON.parse(chunk)
        let t = msg.type as types.p2pMsgTypes

        switch (t) {
            case "have": {
                TODO
                break
            }
            case "need": {
                let n = msg as types.need
                for (let pieceNum of n.pieceNums) {
                    remotePeer.send(types.makePiece(this.file.data[pieceNum], pieceNum))
                }
                break
            }

            default:
                log("Peer sent unknown data", remotePeer)
        }
    }
 
    download(addr: string, pieceNum: number) {
        if (pieceNum in this.file.data) {
            log("Skipping piece " + pieceNum)
            return
        }

        var xhr = new XMLHttpRequest()
        xhr.open("get", addr)
        xhr.responseType = "arraybuffer"
        xhr.onload = function() {
            this.file.data[pieceNum] = xhr.response
            this.file.onserverdownloadedfile(pieceNum)
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