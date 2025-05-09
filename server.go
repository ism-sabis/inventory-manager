package main

import (
	"flag"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"os"
	"path/filepath"
)

var serveDir = flag.String("path", ".", "Directory to serve")
var allowRemote = flag.Bool("remote", false, "Allow remote connections")
var port = flag.Int("port", 1234, "Port to listen on")

// indexHandler serves the index.html file
type IndexData struct {
	Sku string
}

func indexHandler(w http.ResponseWriter, req *http.Request) {
	tmpl := template.Must(template.ParseFiles("web/Combined.html"))
	queryParams := req.URL.Query()
	sku := queryParams.Get("sku")
	w.Header().Set("Content-Type", "text/html")
	tmpl.Execute(w, IndexData{Sku: sku})
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
	http.Handle("/web", http.FileServer(http.Dir(serveAbsDir)))

	// Bind health check
	http.HandleFunc("/", indexHandler)

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
