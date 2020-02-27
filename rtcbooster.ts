import * as types from "./dtypes_json"
import Peer from "simple-peer"
import pieceFile from "./piece_file"
import swarm from "./swarm"
import {assert, log} from "./misc"
import { SwarmDownloadStrategy, StreamStrategy } from "./strategy"

export default class RTCBooster {
    signalingServer: WebSocket
    strategy: SwarmDownloadStrategy

    peerID: string
    swarm: swarm

    file: pieceFile
    fileName: string

    requestedJoinSwarm: boolean = false

    onfilecomplete: (file: File) => void = function(f) { log("Downloaded file", f) }
    onpiece: (pieceNum: number, piece: Uint8Array, fromServer: boolean) => void = function(n, p, _f) { log("Downloaded piece " + n, p) }
    onnextpiece: (piece: Uint8Array, fromServer: boolean) => void = function(p, _f) { log("Downloaded next piece", p) }

    // client should hook their download call to this, or they can call download immediately and it will connect ASAP
    onsignalserverconnect: () => void = function() { log("Connected to signaling server") }

    constructor(signalAddr: string, fname: string, pieceLength: number, totalPieces: number = -1) {
        this.file = new pieceFile(fname, pieceLength, totalPieces)
        this.file.onfilecomplete = function(file: File) {
            this.onfilecomplete(file)
        }.bind(this)
        // alert swarm if we have a new piece
        this.file.onpiece = function(pieceNum: number, piece: Uint8Array, fromServer: boolean) {
            this.onpiece(pieceNum, piece, fromServer)
            this.swarm.notifypiececompleted(pieceNum)
        }.bind(this)
        this.file.onnextpiece = function(piece: Uint8Array, fromServer: boolean) {
            this.onnextpiece(piece, fromServer)
        }.bind(this)
        

        this.strategy = new StreamStrategy()
        this.strategy.onneedpiece = function(pieceNum: number): Uint8Array {
            return this.file.data[pieceNum].buf
        }.bind(this)
        this.strategy.onpiecepartreceived = function(pp: types.piecePart) {
            this.file.addPiecePart(pp)
        }.bind(this)
        this.strategy.onpiecereceived = function(pieceNum: number, piece: Uint8Array) {
            this.file.addPiece(pieceNum, piece)
        }.bind(this)


        this.swarm = new swarm(this.strategy)
        this.swarm.onsignalready = function(forward: types.forward) {
            this.signalToServer(forward)
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
                this.swarm.notifysignaled(msg as types.forward)
                break
            }

            case "joinResponse": {
                let rsp: types.joinResponse = msg
                this.swarm.setOurID(rsp.peerID)
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
            // don't connect to ourselves
            if (rsp.peerID != remotePeerID) {
                this.swarm.addPeer(remotePeerID, true)
            }
        });
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

        this.strategy.download(addr, pieceNum)
    }
}