package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
)

var serveDir = flag.String("path", ".", "Directory to serve")
var allowRemote = flag.Bool("remote", true, "Allow remote connections")
var port = flag.Int("port", 8000, "Port to listen on")

// health check handler
func healthCheckHandler(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-Type", "text/plain")
	w.Write([]byte("Let's go Huskies!"))
}

func main() {
	// Process flags
	flag.Parse()

	// Bind to loop
	var bindAddr = fmt.Sprintf("127.0.0.1:%d", *port)
	if *allowRemote {
		bindAddr = fmt.Sprintf(":%d", *port)
	}

	var serveAbsDir, err = filepath.Abs(*serveDir)
	if err != nil {
		log.Fatal("Error resolving absolute path", err)
	}
	serveAbsDir = filepath.Clean(serveAbsDir)

	// Bind file server
	http.Handle("/", http.FileServer(http.Dir(serveAbsDir)))

	// Bind health check
	http.HandleFunc("/ping", healthCheckHandler)

	// Get hostname
	var hostname = "localhost"
	if *allowRemote {
		hostname, err = os.Hostname()
		if err != nil {
			log.Fatal("Error determining hostname", err)
		}
	}

	// Bind webserver
	log.Print("binding http://", hostname, ":", *port, " to directory ", serveAbsDir)
	log.Fatal(http.ListenAndServe(bindAddr, nil))
}
