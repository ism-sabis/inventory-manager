package main

import (
	"database/sql"
	"strings"

	_ "modernc.org/sqlite"
)

type Item struct {
	SKU        string `json:"sku"`
	Barcode    string `json:"barcode"`
	Title      string `json:"title"`
	ImageURL   string `json:"image_url"`
	ProductURL string `json:"product_url"`
	Quantity   int    `json:"quantity"`
	OnOrder    int    `json:"on_order"`
	CreatedAt  string `json:"created_at"`
	UpdatedAt  string `json:"updated_at"`
}

type Checkout struct {
	ID        int    `json:"id"`
	SKU       string `json:"sku"`
	Quantity  int    `json:"quantity"`
	Project   string `json:"project"`
	CreatedAt string `json:"created_at"`
}

type PurchaseOrder struct {
	ID        int               `json:"id"`
	Name      string            `json:"name"`
	Status    string            `json:"status"`
	CreatedAt string            `json:"created_at"`
	UpdatedAt string            `json:"updated_at"`
	Lines     []PurchaseOrderLine `json:"lines,omitempty"`
}

type PurchaseOrderLine struct {
	ID               int    `json:"id"`
	OrderID          int    `json:"order_id"`
	SKU              string `json:"sku"`
	Title            string `json:"title"`
	QuantityOrdered  int    `json:"quantity_ordered"`
	QuantityReceived int    `json:"quantity_received"`
}

const itemColumns = "sku, barcode, title, image_url, product_url, quantity, created_at, updated_at"

func scanItem(row interface{ Scan(...any) error }) (*Item, error) {
	var item Item
	err := row.Scan(&item.SKU, &item.Barcode, &item.Title, &item.ImageURL, &item.ProductURL, &item.Quantity, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func fillOnOrder(db *sql.DB, items ...*Item) {
	for _, item := range items {
		qty, err := onOrderQuantity(db, item.SKU)
		if err == nil {
			item.OnOrder = qty
		}
	}
}

func openDB(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec("PRAGMA foreign_keys = ON"); err != nil {
		db.Close()
		return nil, err
	}
	if _, err := db.Exec("PRAGMA journal_mode = WAL"); err != nil {
		db.Close()
		return nil, err
	}
	if err := migrate(db); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func migrate(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS items (
			sku         TEXT PRIMARY KEY,
			barcode     TEXT NOT NULL DEFAULT '',
			title       TEXT NOT NULL DEFAULT '',
			image_url   TEXT NOT NULL DEFAULT '',
			product_url TEXT NOT NULL DEFAULT '',
			quantity    INTEGER NOT NULL DEFAULT 0,
			created_at  TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
		);

		CREATE UNIQUE INDEX IF NOT EXISTS idx_items_barcode ON items(barcode) WHERE barcode != '';

		CREATE TABLE IF NOT EXISTS checkouts (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			sku         TEXT NOT NULL REFERENCES items(sku),
			quantity    INTEGER NOT NULL,
			project     TEXT NOT NULL,
			created_at  TEXT NOT NULL DEFAULT (datetime('now'))
		);

		CREATE INDEX IF NOT EXISTS idx_checkouts_sku ON checkouts(sku);
		CREATE INDEX IF NOT EXISTS idx_checkouts_project ON checkouts(project);

		CREATE TABLE IF NOT EXISTS purchase_orders (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			name        TEXT NOT NULL,
			status      TEXT NOT NULL DEFAULT 'open',
			created_at  TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
		);

		CREATE TABLE IF NOT EXISTS purchase_order_lines (
			id                INTEGER PRIMARY KEY AUTOINCREMENT,
			order_id          INTEGER NOT NULL REFERENCES purchase_orders(id),
			sku               TEXT NOT NULL REFERENCES items(sku),
			quantity_ordered  INTEGER NOT NULL DEFAULT 0,
			quantity_received INTEGER NOT NULL DEFAULT 0
		);

		CREATE INDEX IF NOT EXISTS idx_po_lines_order ON purchase_order_lines(order_id);
		CREATE INDEX IF NOT EXISTS idx_po_lines_sku ON purchase_order_lines(sku);
	`)
	return err
}

// lookupItem finds an item by barcode first, then by SKU.
func lookupItem(db *sql.DB, code string) (*Item, error) {
	code = strings.ToUpper(strings.TrimSpace(code))
	item, err := scanItem(db.QueryRow("SELECT "+itemColumns+" FROM items WHERE barcode = ?", code))
	if err == nil {
		fillOnOrder(db, item)
		return item, nil
	}
	item, err = scanItem(db.QueryRow("SELECT "+itemColumns+" FROM items WHERE sku = ?", code))
	if err != nil {
		return nil, err
	}
	fillOnOrder(db, item)
	return item, nil
}

func getItem(db *sql.DB, sku string) (*Item, error) {
	sku = strings.ToUpper(strings.TrimSpace(sku))
	item, err := scanItem(db.QueryRow("SELECT "+itemColumns+" FROM items WHERE sku = ?", sku))
	if err != nil {
		return nil, err
	}
	fillOnOrder(db, item)
	return item, nil
}

func searchItems(db *sql.DB, query string) ([]Item, error) {
	query = strings.ToUpper(strings.TrimSpace(query))
	var rows *sql.Rows
	var err error
	if query == "" {
		rows, err = db.Query("SELECT " + itemColumns + " FROM items ORDER BY sku")
	} else {
		rows, err = db.Query("SELECT "+itemColumns+" FROM items WHERE sku LIKE ? OR barcode LIKE ? OR title LIKE ? ORDER BY sku",
			"%"+query+"%", "%"+query+"%", "%"+query+"%")
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []Item
	for rows.Next() {
		item, err := scanItem(rows)
		if err != nil {
			return nil, err
		}
		fillOnOrder(db, item)
		items = append(items, *item)
	}
	return items, rows.Err()
}

func upsertProduct(db *sql.DB, sku, barcode, title, imageURL, productURL string) error {
	sku = strings.ToUpper(strings.TrimSpace(sku))
	barcode = strings.ToUpper(strings.TrimSpace(barcode))
	_, err := db.Exec(`
		INSERT INTO items (sku, barcode, title, image_url, product_url)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(sku) DO UPDATE SET
			barcode = CASE WHEN excluded.barcode = '' THEN items.barcode ELSE excluded.barcode END,
			title = CASE WHEN excluded.title = '' THEN items.title ELSE excluded.title END,
			image_url = CASE WHEN excluded.image_url = '' THEN items.image_url ELSE excluded.image_url END,
			product_url = CASE WHEN excluded.product_url = '' THEN items.product_url ELSE excluded.product_url END,
			updated_at = datetime('now')
	`, sku, barcode, title, imageURL, productURL)
	return err
}

func addStock(db *sql.DB, sku string, quantity int) (*Item, error) {
	sku = strings.ToUpper(strings.TrimSpace(sku))
	_, err := db.Exec(`
		INSERT INTO items (sku, quantity)
		VALUES (?, ?)
		ON CONFLICT(sku) DO UPDATE SET
			quantity = quantity + excluded.quantity,
			updated_at = datetime('now')
	`, sku, quantity)
	if err != nil {
		return nil, err
	}
	return getItem(db, sku)
}

func checkoutStock(db *sql.DB, sku string, quantity int, project string) (*Item, error) {
	sku = strings.ToUpper(strings.TrimSpace(sku))
	tx, err := db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var exists int
	err = tx.QueryRow("SELECT 1 FROM items WHERE sku = ?", sku).Scan(&exists)
	if err != nil {
		return nil, err
	}

	_, err = tx.Exec("UPDATE items SET quantity = quantity - ?, updated_at = datetime('now') WHERE sku = ?", quantity, sku)
	if err != nil {
		return nil, err
	}

	_, err = tx.Exec("INSERT INTO checkouts (sku, quantity, project) VALUES (?, ?, ?)", sku, quantity, project)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return getItem(db, sku)
}

func getCheckouts(db *sql.DB, sku, project string) ([]Checkout, error) {
	sku = strings.ToUpper(strings.TrimSpace(sku))
	query := "SELECT id, sku, quantity, project, created_at FROM checkouts WHERE 1=1"
	var args []any
	if sku != "" {
		query += " AND sku = ?"
		args = append(args, sku)
	}
	if project != "" {
		query += " AND project = ?"
		args = append(args, project)
	}
	query += " ORDER BY created_at DESC"

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var checkouts []Checkout
	for rows.Next() {
		var c Checkout
		if err := rows.Scan(&c.ID, &c.SKU, &c.Quantity, &c.Project, &c.CreatedAt); err != nil {
			return nil, err
		}
		checkouts = append(checkouts, c)
	}
	return checkouts, rows.Err()
}

func allItems(db *sql.DB) ([]Item, error) {
	rows, err := db.Query("SELECT " + itemColumns + " FROM items ORDER BY sku")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []Item
	for rows.Next() {
		item, err := scanItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, *item)
	}
	return items, rows.Err()
}

func createOrder(db *sql.DB, name string, lines []struct {
	SKU      string `json:"sku"`
	Quantity int    `json:"quantity"`
}) (*PurchaseOrder, error) {
	tx, err := db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	res, err := tx.Exec("INSERT INTO purchase_orders (name) VALUES (?)", name)
	if err != nil {
		return nil, err
	}
	orderID, _ := res.LastInsertId()

	for _, line := range lines {
		sku := strings.ToUpper(strings.TrimSpace(line.SKU))
		qty := line.Quantity
		if qty < 1 {
			qty = 1
		}
		_, err := tx.Exec("INSERT INTO purchase_order_lines (order_id, sku, quantity_ordered) VALUES (?, ?, ?)",
			orderID, sku, qty)
		if err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return getOrder(db, int(orderID))
}

func getOrder(db *sql.DB, id int) (*PurchaseOrder, error) {
	var po PurchaseOrder
	err := db.QueryRow("SELECT id, name, status, created_at, updated_at FROM purchase_orders WHERE id = ?", id).
		Scan(&po.ID, &po.Name, &po.Status, &po.CreatedAt, &po.UpdatedAt)
	if err != nil {
		return nil, err
	}

	rows, err := db.Query(`
		SELECT pol.id, pol.order_id, pol.sku, COALESCE(i.title, ''), pol.quantity_ordered, pol.quantity_received
		FROM purchase_order_lines pol
		LEFT JOIN items i ON i.sku = pol.sku
		WHERE pol.order_id = ?
		ORDER BY pol.id`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var line PurchaseOrderLine
		if err := rows.Scan(&line.ID, &line.OrderID, &line.SKU, &line.Title, &line.QuantityOrdered, &line.QuantityReceived); err != nil {
			return nil, err
		}
		po.Lines = append(po.Lines, line)
	}
	return &po, rows.Err()
}

func listOrders(db *sql.DB, status string) ([]PurchaseOrder, error) {
	query := "SELECT id, name, status, created_at, updated_at FROM purchase_orders"
	var args []any
	if status != "" {
		query += " WHERE status = ?"
		args = append(args, status)
	}
	query += " ORDER BY created_at DESC"

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var orders []PurchaseOrder
	for rows.Next() {
		var po PurchaseOrder
		if err := rows.Scan(&po.ID, &po.Name, &po.Status, &po.CreatedAt, &po.UpdatedAt); err != nil {
			return nil, err
		}
		orders = append(orders, po)
	}
	return orders, rows.Err()
}

func receiveOrderLine(db *sql.DB, lineID int, quantity int) (*PurchaseOrder, error) {
	tx, err := db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var orderID int
	var sku string
	var qtyOrdered, qtyReceived int
	err = tx.QueryRow("SELECT order_id, sku, quantity_ordered, quantity_received FROM purchase_order_lines WHERE id = ?", lineID).
		Scan(&orderID, &sku, &qtyOrdered, &qtyReceived)
	if err != nil {
		return nil, err
	}

	if quantity < 1 {
		quantity = 1
	}

	_, err = tx.Exec("UPDATE purchase_order_lines SET quantity_received = quantity_received + ? WHERE id = ?",
		quantity, lineID)
	if err != nil {
		return nil, err
	}

	// Add received quantity to inventory
	_, err = tx.Exec(`
		INSERT INTO items (sku, quantity) VALUES (?, ?)
		ON CONFLICT(sku) DO UPDATE SET quantity = quantity + excluded.quantity, updated_at = datetime('now')
	`, sku, quantity)
	if err != nil {
		return nil, err
	}

	// Auto-close order if all lines fully received
	var remaining int
	err = tx.QueryRow(`
		SELECT COUNT(*) FROM purchase_order_lines
		WHERE order_id = ? AND quantity_received < quantity_ordered
	`, orderID).Scan(&remaining)
	if err != nil {
		return nil, err
	}
	if remaining == 0 {
		_, err = tx.Exec("UPDATE purchase_orders SET status = 'closed', updated_at = datetime('now') WHERE id = ?", orderID)
		if err != nil {
			return nil, err
		}
	} else {
		_, err = tx.Exec("UPDATE purchase_orders SET updated_at = datetime('now') WHERE id = ?", orderID)
		if err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return getOrder(db, orderID)
}

func onOrderQuantity(db *sql.DB, sku string) (int, error) {
	sku = strings.ToUpper(strings.TrimSpace(sku))
	var qty int
	err := db.QueryRow(`
		SELECT COALESCE(SUM(pol.quantity_ordered - pol.quantity_received), 0)
		FROM purchase_order_lines pol
		JOIN purchase_orders po ON po.id = pol.order_id
		WHERE pol.sku = ? AND po.status = 'open'
	`, sku).Scan(&qty)
	return qty, err
}

func allOrders(db *sql.DB) ([]PurchaseOrder, error) {
	orders, err := listOrders(db, "")
	if err != nil {
		return nil, err
	}
	for i := range orders {
		full, err := getOrder(db, orders[i].ID)
		if err != nil {
			return nil, err
		}
		orders[i] = *full
	}
	return orders, nil
}

func allCheckouts(db *sql.DB) ([]Checkout, error) {
	rows, err := db.Query("SELECT id, sku, quantity, project, created_at FROM checkouts ORDER BY created_at")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var checkouts []Checkout
	for rows.Next() {
		var c Checkout
		if err := rows.Scan(&c.ID, &c.SKU, &c.Quantity, &c.Project, &c.CreatedAt); err != nil {
			return nil, err
		}
		checkouts = append(checkouts, c)
	}
	return checkouts, rows.Err()
}
