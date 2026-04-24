package main

import (
	"database/sql"
	"encoding/csv"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
)

func loadProducts(db *sql.DB, dataDir string) error {
	path := filepath.Join(dataDir, "products.csv")
	f, err := os.Open(path)
	if os.IsNotExist(err) {
		log.Printf("No products.csv found at %s, skipping", path)
		return nil
	}
	if err != nil {
		return err
	}
	defer f.Close()

	reader := csv.NewReader(f)
	records, err := reader.ReadAll()
	if err != nil {
		return fmt.Errorf("parsing products.csv: %w", err)
	}
	if len(records) < 2 {
		return nil
	}

	for i, row := range records[1:] {
		if len(row) < 5 {
			log.Printf("products.csv line %d: skipping, expected 5 columns got %d", i+2, len(row))
			continue
		}
		barcode, sku, title, imageURL, productURL := row[0], row[1], row[2], row[3], row[4]
		if sku == "" {
			continue
		}
		if err := upsertProduct(db, sku, barcode, title, imageURL, productURL); err != nil {
			return fmt.Errorf("products.csv line %d: %w", i+2, err)
		}
	}
	log.Printf("Loaded %d products from %s", len(records)-1, path)
	return nil
}

func importData(db *sql.DB, dataDir string) error {
	if err := loadProducts(db, dataDir); err != nil {
		return err
	}

	// Import inventory.csv — sets stock levels
	invPath := filepath.Join(dataDir, "inventory.csv")
	if f, err := os.Open(invPath); err == nil {
		defer f.Close()
		reader := csv.NewReader(f)
		records, err := reader.ReadAll()
		if err != nil {
			return fmt.Errorf("parsing inventory.csv: %w", err)
		}
		count := 0
		for i, row := range records[1:] {
			if len(row) < 2 {
				continue
			}
			sku := row[0]
			qty, err := strconv.Atoi(row[1])
			if err != nil {
				log.Printf("inventory.csv line %d: invalid quantity %q", i+2, row[1])
				continue
			}
			// Set absolute quantity rather than adding
			_, err = db.Exec(`
				INSERT INTO items (sku, quantity) VALUES (?, ?)
				ON CONFLICT(sku) DO UPDATE SET quantity = excluded.quantity, updated_at = datetime('now')
			`, sku, qty)
			if err != nil {
				return fmt.Errorf("inventory.csv line %d: %w", i+2, err)
			}
			count++
		}
		log.Printf("Imported %d inventory records from %s", count, invPath)
	}

	// Import audit-log.csv — replay checkout history
	auditPath := filepath.Join(dataDir, "audit-log.csv")
	if f, err := os.Open(auditPath); err == nil {
		defer f.Close()
		reader := csv.NewReader(f)
		records, err := reader.ReadAll()
		if err != nil {
			return fmt.Errorf("parsing audit-log.csv: %w", err)
		}
		count := 0
		for i, row := range records[1:] {
			if len(row) < 4 {
				continue
			}
			sku, project, createdAt := row[0], row[2], row[3]
			qty, err := strconv.Atoi(row[1])
			if err != nil {
				log.Printf("audit-log.csv line %d: invalid quantity %q", i+2, row[1])
				continue
			}
			_, err = db.Exec("INSERT INTO checkouts (sku, quantity, project, created_at) VALUES (?, ?, ?, ?)",
				sku, qty, project, createdAt)
			if err != nil {
				return fmt.Errorf("audit-log.csv line %d: %w", i+2, err)
			}
			count++
		}
		log.Printf("Imported %d audit log records from %s", count, auditPath)
	}

	// Import orders.csv
	ordersPath := filepath.Join(dataDir, "orders.csv")
	if f, err := os.Open(ordersPath); err == nil {
		defer f.Close()
		reader := csv.NewReader(f)
		records, err := reader.ReadAll()
		if err != nil {
			return fmt.Errorf("parsing orders.csv: %w", err)
		}
		type orderLine struct {
			sku      string
			ordered  int
			received int
		}
		type orderData struct {
			name      string
			status    string
			createdAt string
			lines     []orderLine
		}
		orderMap := map[string]*orderData{}
		var orderKeys []string
		for i, row := range records[1:] {
			if len(row) < 7 {
				continue
			}
			orderID, orderName, status, sku := row[0], row[1], row[2], row[3]
			ordered, err := strconv.Atoi(row[4])
			if err != nil {
				log.Printf("orders.csv line %d: invalid quantity_ordered %q", i+2, row[4])
				continue
			}
			received, err := strconv.Atoi(row[5])
			if err != nil {
				log.Printf("orders.csv line %d: invalid quantity_received %q", i+2, row[5])
				continue
			}
			createdAt := row[6]
			key := orderID + ":" + orderName
			if _, ok := orderMap[key]; !ok {
				orderMap[key] = &orderData{name: orderName, status: status, createdAt: createdAt}
				orderKeys = append(orderKeys, key)
			}
			orderMap[key].lines = append(orderMap[key].lines, orderLine{sku, ordered, received})
		}
		count := 0
		for _, key := range orderKeys {
			od := orderMap[key]
			res, err := db.Exec("INSERT INTO purchase_orders (name, status, created_at, updated_at) VALUES (?, ?, ?, ?)",
				od.name, od.status, od.createdAt, od.createdAt)
			if err != nil {
				return fmt.Errorf("importing order %q: %w", od.name, err)
			}
			oid, _ := res.LastInsertId()
			for _, line := range od.lines {
				_, err := db.Exec("INSERT INTO purchase_order_lines (order_id, sku, quantity_ordered, quantity_received) VALUES (?, ?, ?, ?)",
					oid, line.sku, line.ordered, line.received)
				if err != nil {
					return fmt.Errorf("importing order line for %q: %w", od.name, err)
				}
			}
			count++
		}
		log.Printf("Imported %d orders from %s", count, ordersPath)
	}

	return nil
}

func exportData(db *sql.DB, dataDir string) error {
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return err
	}

	if err := exportInventory(db, dataDir); err != nil {
		return err
	}
	if err := exportAuditLog(db, dataDir); err != nil {
		return err
	}
	if err := exportOrders(db, dataDir); err != nil {
		return err
	}
	return nil
}

func exportInventory(db *sql.DB, dataDir string) error {
	items, err := allItems(db)
	if err != nil {
		return err
	}

	path := filepath.Join(dataDir, "inventory.csv")
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()

	w := csv.NewWriter(f)
	w.Write([]string{"SKU", "Quantity", "Barcode", "Title", "UpdatedAt"})
	for _, item := range items {
		w.Write([]string{
			item.SKU,
			strconv.Itoa(item.Quantity),
			item.Barcode,
			item.Title,
			item.UpdatedAt,
		})
	}
	w.Flush()
	log.Printf("Exported %d items to %s", len(items), path)
	return w.Error()
}

func exportOrders(db *sql.DB, dataDir string) error {
	orders, err := allOrders(db)
	if err != nil {
		return err
	}

	path := filepath.Join(dataDir, "orders.csv")
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()

	w := csv.NewWriter(f)
	w.Write([]string{"OrderID", "OrderName", "Status", "SKU", "QuantityOrdered", "QuantityReceived", "CreatedAt"})
	for _, order := range orders {
		for _, line := range order.Lines {
			w.Write([]string{
				strconv.Itoa(order.ID),
				order.Name,
				order.Status,
				line.SKU,
				strconv.Itoa(line.QuantityOrdered),
				strconv.Itoa(line.QuantityReceived),
				order.CreatedAt,
			})
		}
	}
	w.Flush()
	log.Printf("Exported %d orders to %s", len(orders), path)
	return w.Error()
}

func exportAuditLog(db *sql.DB, dataDir string) error {
	checkouts, err := allCheckouts(db)
	if err != nil {
		return err
	}

	path := filepath.Join(dataDir, "audit-log.csv")
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()

	w := csv.NewWriter(f)
	w.Write([]string{"SKU", "Quantity", "Project", "Timestamp"})
	for _, c := range checkouts {
		w.Write([]string{
			c.SKU,
			strconv.Itoa(c.Quantity),
			c.Project,
			c.CreatedAt,
		})
	}
	w.Flush()
	log.Printf("Exported %d checkout records to %s", len(checkouts), path)
	return w.Error()
}
