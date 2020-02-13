interface offerOrAnswer {
	type: string
	from: string
	to: string
	sdp: string
	PieceID: string
}

interface forward {
	type: string
	from: string
	to: string
	data: string
}

interface info {
    type: string
    name: string
}
interface infoResponse {
    type: string
    piece_list: Array<String>
}

interface action {
    type: string
	peerID: string
	name: string
	pieceID: string
	action: string
}

interface need {
    type: string
    peerID: string
    pieceID: string
}
interface needResponse {
	type: string
	peer_list: Array<string>
}