import {assert, log} from "./misc"
import * as types from "./dtypes_json"

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
export default class pieceFile {
    // no need for Map, as we don't need ordering on iteration
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

    // if totalPieces is negative, we don't know how many pieces there are, and onfilecomplete will never fire
    constructor(fname: string, pieceLength: number, totalPieces: number = -1) {
        this.fileName = fname + Date.now()
        this.pieceLength = pieceLength
        this.totalPieces = totalPieces
    }

    // add part of a piece
    addPiecePart(pp: types.piecePart) {
        if (this.complete) {
            log("Warning: addPiecePart called when file is already downloaded")
            return 
        }
        // server beat us to it
        if (this.isCompleted(pp.pieceNum)) {
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
            log("Error occurred in onpiece handler:", e as Error)
        }
        ++this.piecesDownloaded

        if (pieceNum == this.nextPiece) {
            while (this.isCompleted(this.nextPiece)) {
                try {
                    this.onnextpiece(this.data[this.nextPiece].buf, fromServer)
                } catch (e) {
                    log("Error occurred in onnextpiece handler:", e as Error)
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
            let pieceLen = p.buf.byteLength
            p.swap(this.fileBuffer.subarray(offset, offset + pieceLen))
            offset += pieceLen
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
}