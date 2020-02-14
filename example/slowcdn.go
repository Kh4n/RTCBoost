package main

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"strconv"
)

func handleBigfile(w http.ResponseWriter, r *http.Request) {
	pieceNum := r.URL.Query().Get("part")
	if pieceNum == "" {
		log.Println("Invalid query:", pieceNum)
		return
	}
	f, err := os.Open("bigfile.txt")
	if err != nil {
		log.Println("Error occurred opening file:", err)
		return
	}
	piece, err := strconv.ParseInt(pieceNum, 10, 64)
	if err != nil || piece >= 10 {
		log.Println("Invalid part number:", pieceNum)
		return
	}
	s, err := f.Stat()
	if err != nil {
		log.Println("Unable to stat file")
		return
	}
	_, err = f.Seek(s.Size()/10*piece, os.SEEK_SET)
	if err != nil {
		log.Println("Invalid part number:", piece)
		return
	}

	b := make([]byte, s.Size()/10)
	n, err := f.Read(b)
	if err != nil && !errors.Is(err, io.EOF) {
		log.Println("Error occurred while reading:", err)
		return
	}
	rs := bytes.NewReader(b[:n])
	http.ServeContent(w, r, "bigfile.txt.part", s.ModTime(), rs)
}

func main() {
	length := 10000000
	contents := make([]byte, 0, length)
	i := 0
	for len(contents) < length {
		s := fmt.Sprintf("%d\n", i)
		contents = append(contents, []byte(s)...)
		i++
	}
	err := ioutil.WriteFile("bigfile.txt", []byte(contents), 0644)
	if err != nil {
		log.Fatal(err)
	}

	log.Println("Generated test file, launching server at port 8080")
	http.HandleFunc("/bigfile", handleBigfile)
	http.Handle("/", http.FileServer(http.Dir(".")))
	log.Fatal(http.ListenAndServe(":8080", nil))
}
