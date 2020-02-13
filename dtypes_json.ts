export type msgTypes = "offer" | "answer" | "forward" | "info" | "infoResponse" | "action" | "need" | "needResponse"

interface all {
    type: msgTypes
}

export interface offerOrAnswer extends all {
	type: "offer" | "answer"
	from: string
    to: string
	pieceID: string
	sdp: string
}

export interface forward extends all {
	type: "forward"
	from: string
    to: string
	data: string
}

export interface info extends all {
    type: "info"
    name: string
}
export interface infoResponse extends all {
    type: "infoResponse"
    pieceList: Array<string>
}

export interface action extends all {
    type: "action"
	// peerID: string
	name: string
	pieceID: string
	action: "add" | "remove"
}

export interface need extends all {
    type: "need"
    pieceID: string
}
export interface needResponse extends all {
    type: "needResponse"
    pieceID: string
	peerList: Array<string>
}