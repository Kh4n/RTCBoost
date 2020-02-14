package main

import (
	"errors"
	"fmt"
	"sync"
)

type peersToPieces struct {
	peerToPieces sync.Map
	pieceToPeers sync.Map
}

func (p *peersToPieces) peerAdd(peer string, piece string) error {
	tmp, _ := p.peerToPieces.LoadOrStore(peer, make(map[string]struct{}))
	pieces, ok := tmp.(map[string]struct{})
	if !ok {
		return errors.New("unknown data type in peer->pieces relational map")
	}
	pieces[piece] = struct{}{}

	tmp, _ = p.pieceToPeers.LoadOrStore(piece, make(map[string]struct{}))
	peers, ok := tmp.(map[string]struct{})
	if !ok {
		return errors.New("unknown data type in piece->peers relational map")
	}
	peers[peer] = struct{}{}
	return nil
}

func (p *peersToPieces) peerRemove(peer string, piece string) error {
	tmp, ok := p.peerToPieces.Load(peer)
	if !ok {
		e := fmt.Sprint("peer does not exist:", peer)
		return errors.New(e)
	}
	pieces, ok := tmp.(map[string]struct{})
	if !ok {
		return errors.New("unknown data type in peer->pieces relational map")
	}
	delete(pieces, piece)

	tmp, ok = p.pieceToPeers.Load(piece)
	if !ok {
		e := fmt.Sprint("piece does not exist:", piece)
		return errors.New(e)
	}
	peers, ok := tmp.(map[string]struct{})
	if !ok {
		return errors.New("unknown data type in piece->peers relational map")
	}
	delete(peers, peer)
	return nil
}

func (p *peersToPieces) peerRemoveAll(peer string) error {
	tmp, ok := p.peerToPieces.Load(peer)
	if !ok {
		e := fmt.Sprint("peer does not exist:", peer)
		return errors.New(e)
	}
	pieces, ok := tmp.(map[string]struct{})
	if !ok {
		return errors.New("unknown data type in peer->pieces relational map")
	}
	p.peerToPieces.Delete(peer)

	for piece := range pieces {
		tmp, ok = p.pieceToPeers.Load(piece)
		if !ok {
			e := fmt.Sprint("piece does not exist:", piece)
			return errors.New(e)
		}
		peers, ok := tmp.(map[string]struct{})
		if !ok {
			return errors.New("unknown data type in piece->peers relational map")
		}
		delete(peers, peer)
	}
	return nil
}

func (p *peersToPieces) getPeersForPiece(piece string, peerID string) []string {
	tmp, _ := p.pieceToPeers.LoadOrStore(piece, make(map[string]struct{}))
	peers, _ := tmp.(map[string]struct{})

	ret := make([]string, 0, len(peers))
	for peer := range peers {
		if peer == peerID {
			continue
		}
		ret = append(ret, peer)
	}
	return ret
}
