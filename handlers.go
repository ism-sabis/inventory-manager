package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
)

var db *sql.DB

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func handleGetItem(w http.ResponseWriter, r *http.Request) {
	code := r.PathValue("sku")
	item, err := lookupItem(db, code)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "item not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func handleSearchItems(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	items, err := searchItems(db, q)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if items == nil {
		items = []Item{}
	}
	writeJSON(w, http.StatusOK, items)
}

func handleAddStock(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SKU      string `json:"sku"`
		Quantity int    `json:"quantity"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.SKU == "" {
		writeError(w, http.StatusBadRequest, "sku is required")
		return
	}

	// Resolve: the "sku" field may actually be a barcode
	sku := req.SKU
	if item, err := lookupItem(db, sku); err == nil {
		sku = item.SKU
	}

	if req.Quantity < 1 {
		req.Quantity = 1
	}
	item, err := addStock(db, sku, req.Quantity)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	notifyExport()
	writeJSON(w, http.StatusOK, item)
}

func handleCheckout(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SKU      string `json:"sku"`
		Quantity int    `json:"quantity"`
		Project  string `json:"project"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.SKU == "" {
		writeError(w, http.StatusBadRequest, "sku is required")
		return
	}

	// Resolve: the "sku" field may actually be a barcode
	sku := req.SKU
	if item, err := lookupItem(db, sku); err == nil {
		sku = item.SKU
	}
	if req.Project == "" {
		writeError(w, http.StatusBadRequest, "project is required")
		return
	}
	if req.Quantity < 1 {
		req.Quantity = 1
	}

	item, err := checkoutStock(db, sku, req.Quantity, req.Project)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "item not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	notifyExport()
	writeJSON(w, http.StatusOK, item)
}

func handleCreateOrder(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name  string `json:"name"`
		Lines []struct {
			SKU      string `json:"sku"`
			Quantity int    `json:"quantity"`
		} `json:"lines"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if len(req.Lines) == 0 {
		writeError(w, http.StatusBadRequest, "at least one line is required")
		return
	}

	// Resolve barcodes to SKUs
	for i := range req.Lines {
		if item, err := lookupItem(db, req.Lines[i].SKU); err == nil {
			req.Lines[i].SKU = item.SKU
		}
	}

	order, err := createOrder(db, req.Name, req.Lines)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	notifyExport()
	writeJSON(w, http.StatusCreated, order)
}

func handleListOrders(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	orders, err := listOrders(db, status)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if orders == nil {
		orders = []PurchaseOrder{}
	}
	writeJSON(w, http.StatusOK, orders)
}

func handleGetOrder(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid order id")
		return
	}
	order, err := getOrder(db, id)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "order not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, order)
}

func handleReceiveLine(w http.ResponseWriter, r *http.Request) {
	var req struct {
		LineID   int `json:"line_id"`
		Quantity int `json:"quantity"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.LineID == 0 {
		writeError(w, http.StatusBadRequest, "line_id is required")
		return
	}
	if req.Quantity < 1 {
		req.Quantity = 1
	}
	order, err := receiveOrderLine(db, req.LineID, req.Quantity)
	if err == sql.ErrNoRows {
		writeError(w, http.StatusNotFound, "order line not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	notifyExport()
	writeJSON(w, http.StatusOK, order)
}

func handleGetCheckouts(w http.ResponseWriter, r *http.Request) {
	sku := r.URL.Query().Get("sku")
	project := r.URL.Query().Get("project")
	checkouts, err := getCheckouts(db, sku, project)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if checkouts == nil {
		checkouts = []Checkout{}
	}
	writeJSON(w, http.StatusOK, checkouts)
}

// Administrative: trigger a manual goBILDA refresh (runs async)
func handleAdminRefresh(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		writeError(w, http.StatusMethodNotAllowed, "POST required")
		return
	}

	go func() {
		log.Printf("Manual goBILDA refresh triggered via web UI")
		if err := refreshGobildaCatalog(*dataDir, *gobildaResultsDir, *gobildaScraperDir, *gobildaScraperCommand, *gobildaScraperArgs); err != nil {
			log.Printf("goBILDA refresh failed: %v", err)
			return
		}
		// Preserve custom products before reloading
		customProducts, err := getCustomProducts(db)
		if err != nil {
			log.Printf("goBILDA refresh: failed to preserve custom products: %v", err)
		}
		if err := loadProducts(db, *dataDir); err != nil {
			log.Printf("goBILDA reload failed: %v", err)
			return
		}
		// Restore custom products after reload
		if customProducts != nil {
			if err := restoreCustomProducts(db, customProducts); err != nil {
				log.Printf("goBILDA refresh: failed to restore custom products: %v", err)
			}
		}
		log.Printf("goBILDA refresh completed successfully")
	}()

	writeJSON(w, http.StatusAccepted, map[string]string{"status": "started"})
}
// Create a custom product with full metadata (not from scraper).
func handleCreateCustomProduct(w http.ResponseWriter, r *http.Request) {
    if r.Method != "POST" {
        writeError(w, http.StatusMethodNotAllowed, "POST required")
        return
    }

    var req struct {
        SKU        string   `json:"sku"`
        Barcode    string   `json:"barcode"`
        Title      string   `json:"title"`
        Images     []string `json:"images"`
        ProductURL string   `json:"product_url"`
		Quantity   int      `json:"quantity"`
		PackSize   int      `json:"pack_size"`
    }
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        writeError(w, http.StatusBadRequest, "invalid JSON")
        return
    }
    if req.SKU == "" {
        writeError(w, http.StatusBadRequest, "sku is required")
        return
    }

    // Normalize SKU to uppercase
    req.SKU = strings.ToUpper(strings.TrimSpace(req.SKU))

    // Use first image as primary image_url
    imageURL := ""
    if len(req.Images) > 0 && req.Images[0] != "" {
        imageURL = req.Images[0]
    }
	imagesJSON := ""
	if len(req.Images) > 0 {
		if b, err := json.Marshal(req.Images); err == nil {
			imagesJSON = string(b)
		}
	}

    // Upsert product as custom: create or update if already exists, mark as custom
	if err := upsertCustomProduct(db, req.SKU, req.Barcode, req.Title, imageURL, imagesJSON, req.ProductURL, req.PackSize); err != nil {
        writeError(w, http.StatusInternalServerError, err.Error())
        return
    }

    // If quantity is provided, add stock
    var item *Item
    var err error
    if req.Quantity > 0 {
        item, err = addStock(db, req.SKU, req.Quantity)
    } else {
        item, err = lookupItem(db, req.SKU)
    }
    if err != nil {
        writeError(w, http.StatusInternalServerError, err.Error())
        return
    }

    notifyExport()
    writeJSON(w, http.StatusCreated, item)
}