package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
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
