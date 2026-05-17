package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

var serveDir = flag.String("path", "web", "Directory to serve")
var allowRemote = flag.Bool("remote", false, "Allow remote connections")
var port = flag.Int("port", 8000, "Port to listen on")
var dbPath = flag.String("db", "inventory.db", "Path to SQLite database file")
var dataDir = flag.String("data", "data", "Directory for CSV data files")
var doExport = flag.Bool("export", false, "Export database to CSV files and exit")
var doImport = flag.Bool("import", false, "Import CSV files into database and exit")
var gobildaRefreshOnly = flag.Bool("gobilda-refresh-only", false, "Refresh the goBILDA product catalog and exit")
var gobildaRefreshOnStart = flag.Bool("gobilda-refresh", false, "Refresh the goBILDA product catalog before starting the server")
var gobildaRefreshInterval = flag.Duration("gobilda-refresh-interval", 0, "How often to refresh the goBILDA product catalog")
var gobildaScraperDir = flag.String("gobilda-scraper-dir", "scraper", "Directory containing the goBILDA scraper workspace")
var gobildaScraperCommand = flag.String("gobilda-scraper-command", "", "Command to run in the scraper workspace before refreshing")
var gobildaScraperArgs = flag.String("gobilda-scraper-args", "", "Arguments for the scraper command, separated by spaces")
var gobildaResultsDir = flag.String("gobilda-results-dir", filepath.Join("scraper", "Results", "robotics", "GoBilda"), "Directory containing the latest goBILDA scraper result files")

var exportChan chan struct{}

func initAutoExport(dataDir string) {
	exportChan = make(chan struct{}, 1)
	go func() {
		for range exportChan {
			time.Sleep(5 * time.Second)
			if err := exportData(db, dataDir); err != nil {
				log.Printf("Auto-export error: %v", err)
			}
			// Drain any signals that arrived during the export
			select {
			case <-exportChan:
			default:
			}
		}
	}()
}

func notifyExport() {
	select {
	case exportChan <- struct{}{}:
	default:
	}
}

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

	if *gobildaRefreshOnly || *gobildaRefreshOnStart || *gobildaRefreshInterval > 0 {
		if err := refreshGobildaCatalog(*dataDir, *gobildaResultsDir, *gobildaScraperDir, *gobildaScraperCommand, *gobildaScraperArgs); err != nil {
			log.Fatal("goBILDA refresh failed: ", err)
		}
	}

	// Always load products.csv on server startup
	if err := loadProducts(db, *dataDir); err != nil {
		log.Fatal("Error loading products: ", err)
	}

	if *gobildaRefreshOnly {
		return
	}

	if *doExport {
		if err := exportData(db, *dataDir); err != nil {
			log.Fatal("Export failed: ", err)
		}
		return
	}

	initAutoExport(*dataDir)
	if *gobildaRefreshInterval > 0 {
		initGobildaRefreshLoop(*dataDir, *gobildaResultsDir, *gobildaScraperDir, *gobildaScraperCommand, *gobildaScraperArgs, *gobildaRefreshInterval)
	}

	var bindAddr = fmt.Sprintf("127.0.0.1:%d", *port)
	if *allowRemote {
		bindAddr = fmt.Sprintf(":%d", *port)
	}

	// Prefer built frontend in web/dist when present so the Go server can serve the React app's build output.
	finalServe := *serveDir
	if *serveDir == "web" {
		if _, statErr := os.Stat(filepath.Join("web", "dist")); statErr == nil {
			finalServe = filepath.Join("web", "dist")
		}
	}
	var serveAbsDir, err = filepath.Abs(finalServe)
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
	mux.HandleFunc("POST /api/admin/refresh", handleAdminRefresh)
	mux.HandleFunc("POST /api/items/custom", handleCreateCustomProduct)
	mux.Handle("/", http.FileServer(http.Dir(serveAbsDir)))

	var hostname = "localhost"
	if *allowRemote {
		hostname, err = os.Hostname()
		if err != nil {
			log.Fatal("Error determining hostname", err)
		}
	}

	log.Print("binding http://", hostname, ":", *port, " to directory ", serveAbsDir)
	authHandler := basicAuth(mux)
	log.Fatal(http.ListenAndServe(bindAddr, authHandler))
}

// basicAuth wraps a handler and requires HTTP Basic Auth for all requests.
// Any username is accepted so long as the password matches the configured secret.
func basicAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, pass, ok := r.BasicAuth()
		if !ok || pass != "20037" {
			w.Header().Set("WWW-Authenticate", `Basic realm="Inventory Manager"`)
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte("Unauthorized"))
			return
		}
		next.ServeHTTP(w, r)
	})
}
