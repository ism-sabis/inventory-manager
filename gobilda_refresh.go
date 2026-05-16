package main

import (
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type gobildaCatalogRow struct {
	SKU        string
	Barcode    string
	Title      string
	ImageURL   string
	ProductURL string
}

type gobildaUpcRow struct {
	SKU        string
	Barcode    string
	Title      string
	ProductURL string
	MissingUPC bool
	UPCSource  string
}

var gobildaRefreshMu sync.Mutex

func initGobildaRefreshLoop(dataDir, resultsDir, scraperDir, scraperCommand, scraperArgs string, interval time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for range ticker.C {
			if err := refreshGobildaCatalog(dataDir, resultsDir, scraperDir, scraperCommand, scraperArgs); err != nil {
				log.Printf("goBILDA refresh error: %v", err)
				continue
			}
			// Preserve custom products before reloading
			customProducts, err := getCustomProducts(db)
			if err != nil {
				log.Printf("goBILDA refresh: failed to preserve custom products: %v", err)
			}
			if err := loadProducts(db, dataDir); err != nil {
				log.Printf("goBILDA reload error: %v", err)
				continue
			}
			// Restore custom products after reload
			if customProducts != nil {
				if err := restoreCustomProducts(db, customProducts); err != nil {
					log.Printf("goBILDA refresh: failed to restore custom products: %v", err)
				}
			}
		}
	}()
}

func refreshGobildaCatalog(dataDir, resultsDir, scraperDir, scraperCommand, scraperArgs string) error {
	gobildaRefreshMu.Lock()
	defer gobildaRefreshMu.Unlock()

	if err := runGobildaScraper(scraperDir, scraperCommand, scraperArgs); err != nil {
		return err
	}

	xmlPath, csvPath, err := locateGobildaArtifacts(dataDir, resultsDir)
	if err != nil {
		return err
	}

	rows, err := buildGobildaCatalogRows(xmlPath, csvPath)
	if err != nil {
		return err
	}

	if err := writeGobildaCatalogArtifacts(dataDir, xmlPath, csvPath, rows); err != nil {
		return err
	}

	log.Printf("Refreshed goBILDA catalog from %s and %s (%d products)", xmlPath, csvPath, len(rows))
	return nil
}

func runGobildaScraper(scraperDir, scraperCommand, scraperArgs string) error {
	// Ensure we have a scraper directory; default to bundled `scraper`.
	if strings.TrimSpace(scraperDir) == "" {
		scraperDir = "scraper"
	}
	// Default command to npm run gobilda:run if none provided.
	if strings.TrimSpace(scraperCommand) == "" {
		scraperCommand = "npm"
		scraperArgs = "run gobilda:run"
	}

	args := []string{}
	if strings.TrimSpace(scraperArgs) != "" {
		args = strings.Fields(scraperArgs)
	}

	cmd := exec.Command(scraperCommand, args...)
	cmd.Dir = scraperDir
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	log.Printf("Running goBILDA scraper: %s %s", scraperCommand, strings.Join(args, " "))
	return cmd.Run()
}

func locateGobildaArtifacts(dataDir, resultsDir string) (string, string, error) {
	candidates := []string{}
	if trimmed := strings.TrimSpace(resultsDir); trimmed != "" {
		candidates = append(candidates, trimmed)
	}
	candidates = append(candidates, dataDir)

	for _, dir := range candidates {
		xmlPath, csvPath, ok := latestGobildaArtifactPair(dir)
		if ok {
			return xmlPath, csvPath, nil
		}
	}

	return "", "", fmt.Errorf("could not find goBILDA inventory XML and UPC chart in %v", candidates)
}

func latestGobildaArtifactPair(dir string) (string, string, bool) {
	xmlCandidates, _ := filepath.Glob(filepath.Join(dir, "*_gobilda_inventory.xml"))
	csvCandidates, _ := filepath.Glob(filepath.Join(dir, "*_gobilda_upc_sku_chart.csv"))
	if len(xmlCandidates) == 0 || len(csvCandidates) == 0 {
		return "", "", false
	}

	latestByModTime := func(paths []string) string {
		sort.Slice(paths, func(i, j int) bool {
			iInfo, iErr := os.Stat(paths[i])
			jInfo, jErr := os.Stat(paths[j])
			if iErr != nil || jErr != nil {
				return paths[i] < paths[j]
			}
			return iInfo.ModTime().Before(jInfo.ModTime())
		})
		return paths[len(paths)-1]
	}

	return latestByModTime(xmlCandidates), latestByModTime(csvCandidates), true
}

func buildGobildaCatalogRows(xmlPath, csvPath string) ([]gobildaCatalogRow, error) {
	imagesBySKU, err := parseGobildaImages(xmlPath)
	if err != nil {
		return nil, err
	}

	chartRows, err := parseGobildaUPCChart(csvPath)
	if err != nil {
		return nil, err
	}

	rows := make([]gobildaCatalogRow, 0, len(chartRows))
	seen := make(map[string]struct{})
	for _, row := range chartRows {
		sku := strings.ToUpper(strings.TrimSpace(row.SKU))
		if sku == "" {
			continue
		}
		if _, exists := seen[sku]; exists {
			continue
		}
		seen[sku] = struct{}{}

		rows = append(rows, gobildaCatalogRow{
			SKU:        sku,
			Barcode:    strings.TrimSpace(row.Barcode),
			Title:      strings.TrimSpace(row.Title),
			ImageURL:   imagesBySKU[sku],
			ProductURL: strings.TrimSpace(row.ProductURL),
		})
	}

	return rows, nil
}

func parseGobildaUPCChart(csvPath string) ([]gobildaUpcRow, error) {
	f, err := os.Open(csvPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	reader := csv.NewReader(f)
	records, err := reader.ReadAll()
	if err != nil {
		return nil, err
	}
	if len(records) < 2 {
		return nil, fmt.Errorf("goBILDA UPC chart %s does not contain any product rows", csvPath)
	}

	rows := make([]gobildaUpcRow, 0, len(records)-1)
	for _, record := range records[1:] {
		if len(record) < 6 {
			continue
		}
		rows = append(rows, gobildaUpcRow{
			SKU:        strings.TrimSpace(record[0]),
			Barcode:    strings.TrimSpace(record[1]),
			UPCSource:  strings.TrimSpace(record[2]),
			MissingUPC:  strings.EqualFold(strings.TrimSpace(record[3]), "true"),
			ProductURL: strings.TrimSpace(record[4]),
			Title:      strings.TrimSpace(record[5]),
		})
	}

	return rows, nil
}

func parseGobildaImages(xmlPath string) (map[string]string, error) {
	f, err := os.Open(xmlPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	decoder := xml.NewDecoder(f)
	imagesBySKU := make(map[string]string)

	var currentSKU string
	var inProduct bool
	var inFirstEntry bool
	var entryIndex int
	var imageCaptured bool

	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("parsing goBILDA inventory XML %s: %w", xmlPath, err)
		}

		switch element := token.(type) {
		case xml.StartElement:
			switch element.Name.Local {
			case "product":
				inProduct = true
				inFirstEntry = false
				entryIndex = 0
				imageCaptured = false
				currentSKU = ""
				for _, attr := range element.Attr {
					if strings.EqualFold(attr.Name.Local, "sku") {
						currentSKU = strings.ToUpper(strings.TrimSpace(attr.Value))
					}
				}
			case "entry":
				if inProduct && entryIndex == 0 {
					inFirstEntry = true
				}
				if inProduct {
					entryIndex++
				}
			case "image":
				if inProduct && inFirstEntry && !imageCaptured && currentSKU != "" {
					var imageURL string
					if err := decoder.DecodeElement(&imageURL, &element); err != nil {
						return nil, fmt.Errorf("parsing goBILDA image for %s: %w", currentSKU, err)
					}
					imageURL = strings.TrimSpace(imageURL)
					if looksLikeGobildaImageURL(imageURL) {
						imagesBySKU[currentSKU] = imageURL
						imageCaptured = true
					}
				}
			}
		case xml.EndElement:
			switch element.Name.Local {
			case "entry":
				inFirstEntry = false
			case "product":
				inProduct = false
				currentSKU = ""
			}
		}
	}

	return imagesBySKU, nil
}

func looksLikeGobildaImageURL(value string) bool {
	if value == "" {
		return false
	}
	lower := strings.ToLower(value)
	if strings.Contains(lower, "gobilda.com") && !strings.Contains(lower, "cdn11.bigcommerce.com") {
		return false
	}
	return strings.Contains(lower, "cdn11.bigcommerce.com") && (strings.Contains(lower, ".jpg") || strings.Contains(lower, ".jpeg") || strings.Contains(lower, ".png") || strings.Contains(lower, ".webp"))
}

func writeGobildaCatalogArtifacts(dataDir, xmlPath, csvPath string, rows []gobildaCatalogRow) error {
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return err
	}

	if err := copyGobildaArtifact(xmlPath, filepath.Join(dataDir, "gobilda_inventory.xml")); err != nil {
		return err
	}
	if err := copyGobildaArtifact(csvPath, filepath.Join(dataDir, "gobilda_upc_sku_chart.csv")); err != nil {
		return err
	}

	productsCSVPath := filepath.Join(dataDir, "products.csv")
	f, err := os.Create(productsCSVPath)
	if err != nil {
		return err
	}
	defer f.Close()

	writer := csv.NewWriter(f)
	if err := writer.Write([]string{"Barcode", "SKU", "Title", "ImageURL", "ProductURL"}); err != nil {
		return err
	}

	seenBarcodes := make(map[string]struct{})
	for _, row := range rows {
		if row.SKU == "" {
			continue
		}
		barcode := strings.TrimSpace(row.Barcode)
		if barcode != "" {
			if _, exists := seenBarcodes[barcode]; exists {
				barcode = ""
			} else {
				seenBarcodes[barcode] = struct{}{}
			}
		}
		if err := writer.Write([]string{barcode, row.SKU, row.Title, row.ImageURL, row.ProductURL}); err != nil {
			return err
		}
	}

	writer.Flush()
	return writer.Error()
}

func copyGobildaArtifact(sourcePath, targetPath string) error {
	input, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer input.Close()

	output, err := os.Create(targetPath)
	if err != nil {
		return err
	}
	defer output.Close()

	if _, err := io.Copy(output, input); err != nil {
		return err
	}
	return output.Sync()
}

// getCustomProducts retrieves all products marked as custom
type customProduct struct {
	SKU        string
	Barcode    string
	Title      string
	ImageURL   string
	ProductURL string
	Quantity   int
	Images     []string
	PackSize   int
}

func getCustomProducts(db *sql.DB) ([]customProduct, error) {
	if db == nil {
		return nil, nil
	}
	rows, err := db.Query("SELECT sku, barcode, title, image_url, images, product_url, quantity, pack_size FROM items WHERE custom = 1")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var products []customProduct
	for rows.Next() {
		var p customProduct
		var imagesJSON string
		if err := rows.Scan(&p.SKU, &p.Barcode, &p.Title, &p.ImageURL, &imagesJSON, &p.ProductURL, &p.Quantity, &p.PackSize); err != nil {
			return nil, err
		}
		if imagesJSON != "" {
			var imgs []string
			if err := json.Unmarshal([]byte(imagesJSON), &imgs); err == nil {
				p.Images = imgs
			}
		}
		products = append(products, p)
	}
	return products, rows.Err()
}

// restoreCustomProducts reinserts custom products after a refresh, preserving quantities
func restoreCustomProducts(db *sql.DB, products []customProduct) error {
	if db == nil || len(products) == 0 {
		return nil
	}
	for _, p := range products {
		imagesJSON := ""
		if len(p.Images) > 0 {
			if b, err := json.Marshal(p.Images); err == nil {
				imagesJSON = string(b)
			}
		}
		if err := upsertCustomProduct(db, p.SKU, p.Barcode, p.Title, p.ImageURL, imagesJSON, p.ProductURL, p.PackSize); err != nil {
			return err
		}
		// Restore quantity: set to stored quantity (upsert doesn't change quantity unless specified)
		if _, err := db.Exec(`UPDATE items SET quantity = ? WHERE sku = ?`, p.Quantity, p.SKU); err != nil {
			return err
		}
	}
	return nil
}