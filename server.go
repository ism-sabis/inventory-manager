package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
)

var serveDir = flag.String("path", "web", "Directory to serve")
var allowRemote = flag.Bool("remote", true, "Allow remote connections")
var port = flag.Int("port", 8000, "Port to listen on")
var dbPath = flag.String("db", "inventory.db", "Path to SQLite database file")
var dataDir = flag.String("data", "data", "Directory for CSV data files")
var doExport = flag.Bool("export", false, "Export database to CSV files and exit")
var doImport = flag.Bool("import", false, "Import CSV files into database and exit")

func healthCheckHandler(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-Type", "text/plain")
	w.Write([]byte("Let's go Huskies!"))
}

func main() {
	flag.Parse()

	var dbErr error
	db, dbErr = openDB(*dbPath)
	if dbErr != nil {
		log.Fatal("Error opening database: ", dbErr)
	}
	defer db.Close()

	if *doImport {
		if err := importData(db, *dataDir); err != nil {
			log.Fatal("Import failed: ", err)
		}
		return
	}

	// Always load products.csv on server startup
	if err := loadProducts(db, *dataDir); err != nil {
		log.Fatal("Error loading products: ", err)
	}

	if *doExport {
		if err := exportData(db, *dataDir); err != nil {
			log.Fatal("Export failed: ", err)
		}
		return
	}

	var bindAddr = fmt.Sprintf("127.0.0.1:%d", *port)
	if *allowRemote {
		bindAddr = fmt.Sprintf(":%d", *port)
	}

	var serveAbsDir, err = filepath.Abs(*serveDir)
	if err != nil {
		log.Fatal("Error resolving absolute path", err)
	}
	serveAbsDir = filepath.Clean(serveAbsDir)

	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/items/{sku}", handleGetItem)
	mux.HandleFunc("GET /api/items", handleSearchItems)
	mux.HandleFunc("POST /api/items", handleAddStock)
	mux.HandleFunc("POST /api/checkout", handleCheckout)
	mux.HandleFunc("GET /api/checkouts", handleGetCheckouts)
	mux.HandleFunc("POST /api/orders", handleCreateOrder)
	mux.HandleFunc("GET /api/orders", handleListOrders)
	mux.HandleFunc("GET /api/orders/{id}", handleGetOrder)
	mux.HandleFunc("POST /api/orders/receive", handleReceiveLine)
	mux.HandleFunc("GET /ping", healthCheckHandler)
	mux.Handle("/", http.FileServer(http.Dir(serveAbsDir)))

	var hostname = "localhost"
	if *allowRemote {
		hostname, err = os.Hostname()
		if err != nil {
			log.Fatal("Error determining hostname", err)
		}
	}

	log.Print("binding http://", hostname, ":", *port, " to directory ", serveAbsDir)
	log.Fatal(http.ListenAndServe(bindAddr, mux))
}
