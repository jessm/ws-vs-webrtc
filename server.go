package main

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"math/rand"
	"net/http"
	"time"

	"github.com/caddyserver/certmagic"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

var users = make(map[string]chan []byte)

func sendUpdate() {
	keys := make([]string, len(users))
	i := 0
	for k := range users {
		keys[i] = k
		i++
	}

	for id, c := range users {
		initMsg, _ := json.Marshal(struct {
			Type  string
			Uid   string
			Users []string
		}{"init", id, keys})
		c <- initMsg
	}
}

func handleConnect(w http.ResponseWriter, r *http.Request) {
	c, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		fmt.Println("upgrade problem:", err)
		return
	}

	letters := []byte("abcdefghjkmnopqrstuvwxyz")
	rand.Seed(time.Now().UnixNano())
	rand.Shuffle(len(letters), func(i, j int) {
		letters[i], letters[j] = letters[j], letters[i]
	})
	uid := string(letters[:4])

	endConn := make(chan bool)
	writeChan := make(chan []byte)
	go webReader(uid, c, endConn)
	go webWriter(uid, c, endConn, writeChan)
	users[uid] = writeChan
	sendUpdate()
}

func webReader(uid string, c *websocket.Conn, endConn chan bool) {
	defer c.Close()
	for {
		_, message, err := c.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				fmt.Println("web reader error:", err)
			}
			endConn <- true
			break
		}

		// Broadcast all messages to all other users
		for other_uid, writeChan := range users {
			if other_uid == uid {
				continue
			}
			writeChan <- message
		}
	}
}

func webWriter(uid string, c *websocket.Conn, endConn chan bool, writeChan chan []byte) {
	defer c.Close()
	for {
		select {
		case message := <-writeChan:
			w, err := c.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)
			if err := w.Close(); err != nil {
				fmt.Println("writer error:", err)
			}
		case <-endConn:
			delete(users, uid)
			sendUpdate()
			return
		}
	}
}

func writeFile(f string, w http.ResponseWriter) {
	fileBytes, err := ioutil.ReadFile(f)
	if err != nil {
		panic(err)
	}
	w.WriteHeader(http.StatusOK)
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Write(fileBytes)
}

func main() {
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		writeFile("client.html", w)
	})
	http.HandleFunc("/client.js", func(w http.ResponseWriter, r *http.Request) {
		writeFile("client.js", w)
	})
	http.HandleFunc("/connect", handleConnect)

	fmt.Println("WebSocket and WebRTC server now serving")
	// http.ListenAndServe(":8080", nil)
	// http.ListenAndServeTLS(":8080", "cert.pem", "key.pem", nil)

	// read and agree to your CA's legal documents
	certmagic.DefaultACME.Agreed = true

	// provide an email address
	certmagic.DefaultACME.Email = "e.jessmuir@gmail.com"

	// use the staging endpoint while we're developing
	// certmagic.DefaultACME.CA = certmagic.LetsEncryptStagingCA

	err := certmagic.HTTPS([]string{"test.jessmuir.com"}, http.DefaultServeMux)
	if err != nil {
		fmt.Println(err)
	}
}
