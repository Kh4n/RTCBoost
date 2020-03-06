import PieceFile from "./piece_file"
import Swarm from "./swarm"
import {assert, log} from "./misc"

export default class RTCBooster {
    swarm: Swarm
    file: PieceFile

    requestedJoinSwarm: boolean = false

    onfilecomplete: (file: File) => void = function(f) { log("Downloaded file", f) }
    onpiece: (pieceNum: number, piece: Uint8Array, fromServer: boolean) => void = function(n, p, _f) { log("Downloaded piece " + n, p) }
    onnextpiece: (piece: Uint8Array, fromServer: boolean) => void = function(p, _f) { log("Downloaded next piece", p) }

    // client should hook their download call to this, or they can call download immediately and it will connect ASAP
    onsignalserverconnect: () => void = function() { log("Connected to signaling server") }

    constructor(signalAddr: string, fname: string, pieceLength: number, totalPieces: number = -1) {
        this.file = new PieceFile(fname, pieceLength, totalPieces)
        this.swarm = new Swarm(this.file)

        this.file.onfilecomplete = function(file: File) {
            this.onfilecomplete(file)
        }.bind(this)
        this.file.onpiece = function(pieceNum: number, piece: Uint8Array, fromServer: boolean) {
            this.onpiece(pieceNum, piece, fromServer)
        }.bind(this)
        this.file.onnextpiece = function(piece: Uint8Array, fromServer: boolean) {
            this.onnextpiece(piece, fromServer)
        }.bind(this)

        this.swarm.onsignalserverconnect = function() {
            this.onsignalserverconnect()
        }.bind(this)


        this.swarm.connect(signalAddr)
    }
    
    download(addr: string, pieceNum: number) {
        this.swarm.download(addr, pieceNum)
    }
}