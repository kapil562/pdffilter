import React, { useEffect, useState } from "react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.mjs?url";
import { Upload } from "lucide-react";
import { motion } from "framer-motion";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import "./index.css";

GlobalWorkerOptions.workerSrc = workerSrc;

export default function AddressChecker() {
  const [results, setResults] = useState([]);
  const [progress, setProgress] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSize, setSelectedSize] = useState("");
  const [darkMode, setDarkMode] = useState(false);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");

  useEffect(() => {
    document.body.classList.toggle("dark", darkMode);
    localStorage.setItem("darkMode", darkMode);
  }, [darkMode]);

  useEffect(() => {
    const saved = localStorage.getItem("darkMode");
    if (saved === "true") setDarkMode(true);
  }, []);

  const handleFileUpload = async (event) => {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    setProgress(1);
    let allResults = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();

      const result = await new Promise((resolve) => {
        reader.onload = () => {
          setTimeout(async () => {
            const typedArray = new Uint8Array(reader.result);
            const pdf = await getDocument({ data: typedArray }).promise;

            let fullText = "";
            for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
              const page = await pdf.getPage(pageNum);
              const textContent = await page.getTextContent();
              const text = textContent.items.map((item) => item.str).join("\n");
              fullText += "\n" + text;
            }

            const blocks = fullText.split(/Customer Address/i).slice(1);
            const phoneRegex = /(?:\+91[\s-]?)?[6-9]\d{9}/;

            const parsed = blocks
              .map((section) => {
                const phoneMatch = section.match(phoneRegex);
                const phone = phoneMatch ? phoneMatch[0] : "None";

                const addressEnd = section.search(/If undelivered|COD|Prepaid|Pickup/i);
                const raw = addressEnd !== -1 ? section.substring(0, addressEnd).trim() : section.trim();
                const lines = raw.split("\n").map(line => line.trim()).filter(Boolean);

                const name = lines[0] ? lines[0].toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : "Unknown";

                let address1 = "None", address2 = "None";
                if (lines.length >= 4) {
                  const addressLines = lines.slice(1, -1);
                  const mid = Math.ceil(addressLines.length / 2);
                  address1 = addressLines.slice(0, mid).join(", ");
                  address2 = addressLines.slice(mid).join(", ");
                } else if (lines.length === 3) {
                  address1 = lines[1];
                  address2 = "None";
                } else if (lines.length === 2) {
                  address1 = lines[1];
                  address2 = "None";
                }

                const lastLine = lines[lines.length - 1] || "";
                const lastLineParts = lastLine.split(",").map(s => s.trim());
                const city = lastLineParts[lastLineParts.length - 3] || "Unknown";
                const state = lastLineParts[lastLineParts.length - 2] || "Unknown";
                const pincode = lastLineParts[lastLineParts.length - 1] || "Unknown";

                const sizeMatch = section.match(
                  /SKU\s+Size\s+Qty\s+Color\s+Order No\.\s+[^\n\r]*?\s+(\b(XXXL|XXL|XL|L|M|S|XS|4XL|5XL|6XL|7XL|8XL)\b)/i
                );
                const size = sizeMatch ? sizeMatch[1] : "Not found";

                const totalMatch = section.match(/Total\s+(Rs\.\d+\.\d{2})\s+(Rs\.\d+\.\d{2})/i);
                const finalTotal = totalMatch ? totalMatch[2] : "Not found";

                const modeMatch = section.match(/(COD|Prepaid)\s*:/i);
                const mode = modeMatch ? modeMatch[1].toUpperCase() : "Unknown";

                return {
                  name,
                  phone,
                  address1,
                  address2,
                  city,
                  state,
                  pincode,
                  size,
                  total: finalTotal,
                  mode,
                };
              })
              .filter((item) => item.phone !== "None");

            resolve(parsed);
          }, 0);
        };

        reader.readAsArrayBuffer(file);
      });

      allResults = [...allResults, ...result];
      setProgress(Math.round(((i + 1) / files.length) * 100));
    }

    setResults(allResults);
    setProgress(0);
  };

  const handleExportExcel = () => {
    const exportData = results.map((item, idx) => ({
      Index: idx + 1,
      Name: item.name,
      Phone: item.phone,
      "Address 1": item.address1,
      "Address 2": item.address2,
      City: item.city,
      State: item.state,
      Pincode: item.pincode,
      Size: item.size,
      Total: item.total,
      Mode: item.mode,
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Extracted Data");

    const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const dataBlob = new Blob([excelBuffer], { type: "application/octet-stream" });
    saveAs(dataBlob, "extracted_data.xlsx");
  };

  // ✅ Filtering logic
  const filteredResults = results.filter((item) => {
    const query = searchQuery.toLowerCase();
    const matchesSearch =
      item.name.toLowerCase().includes(query) ||
      item.phone.toLowerCase().includes(query) ||
      item.address1.toLowerCase().includes(query) ||
      item.address2.toLowerCase().includes(query) ||
      item.city.toLowerCase().includes(query) ||
      item.state.toLowerCase().includes(query) ||
      item.pincode.toLowerCase().includes(query) ||
      item.size.toLowerCase().includes(query) ||
      item.total.toLowerCase().includes(query) ||
      item.mode.toLowerCase().includes(query);

    const matchesSize = selectedSize ? item.size === selectedSize : true;

    const priceValue = parseFloat(item.total.replace("Rs.", "")) || 0;
    const matchesPrice =
      (!minPrice || priceValue >= parseFloat(minPrice)) &&
      (!maxPrice || priceValue <= parseFloat(maxPrice));

    return matchesSearch && matchesSize && matchesPrice;
  });

  // ✅ Dashboard calculation on filtered data
  const calculateStats = (data) => {
    const sizeMap = {};
    let grandTotal = 0;
    let codOrders = 0;
    let prepaidOrders = 0;

    data.forEach(({ size, total, mode }) => {
      sizeMap[size] = (sizeMap[size] || 0) + 1;
      if (total.startsWith("Rs.")) {
        grandTotal += parseFloat(total.replace("Rs.", ""));
      }
      if (mode === "COD") codOrders++;
      if (mode === "PREPAID") prepaidOrders++;
    });

    const uniqueOrders = new Set();
    let codDuplicateCount = 0;

    data.forEach(({ name, address1, address2, mode }) => {
      const key = `${name.toLowerCase()}|${address1.toLowerCase()}|${address2.toLowerCase()}|${mode}`;
      if (uniqueOrders.has(key)) {
        if (mode === "COD") codDuplicateCount++;
      } else {
        uniqueOrders.add(key);
      }
    });

    return {
      totalBlocks: data.length,
      sizeCount: sizeMap,
      totalPrice: grandTotal.toFixed(2),
      codCount: codOrders,
      prepaidCount: prepaidOrders,
      codDuplicateCount,
    };
  };

  const stats = calculateStats(filteredResults);

  return (
    <div className="container">
      <motion.div
        className="glass-card"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6 }}
      >
        <h1 className="title">Smart Address Extractor</h1>

        <div className="upload-section">
          <label htmlFor="pdfUpload" className="glass-button">
            <Upload size={18} /> Upload PDFs
          </label>
          <input
            type="file"
            accept="application/pdf"
            multiple
            onChange={handleFileUpload}
            className="hidden-input"
            id="pdfUpload"
          />
          <button className="glass-toggle" onClick={() => setDarkMode(!darkMode)}>
            {darkMode ? "☀️ Light Mode" : "🌙 Dark Mode"}
          </button>
        </div>

        {results.length > 0 && (
          <>
            <button className="glass-export" onClick={handleExportExcel}>
              Export to Excel
            </button>

            <div className="dashboard-glass">
              <div className="stat">Total Orders: <strong>{stats.totalBlocks}</strong></div>
              <div className="stat">Total: <strong>Rs.{stats.totalPrice}</strong></div>
              <div className="stat">COD Orders: <strong>{stats.codCount}</strong></div>
              <div className="stat">Prepaid Orders: <strong>{stats.prepaidCount}</strong></div>
              <div className="stat">COD Duplicates: <strong>{stats.codDuplicateCount}</strong></div>
              <div className="stat">COD Unique Orders: <strong>{stats.codCount - stats.codDuplicateCount}</strong></div>
              <div className="sizes">
                {Object.entries(stats.sizeCount).map(([size, count]) => (
                  <span key={size} className="size-chip">{size}: {count}</span>
                ))}
              </div>
            </div>

            <input
              type="text"
              className="glass-search"
              placeholder="Search anything..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />

            <div className="filter-glass">
              {["XS", "S", "M", "L", "XL", "XXL", "XXXL", "4XL", "5XL", "6XL"].map((size) => (
                <button
                  key={size}
                  onClick={() => setSelectedSize(selectedSize === size ? "" : size)}
                  className={`filter-chip ${selectedSize === size ? "active" : ""}`}
                >
                  {size}
                </button>
              ))}
            </div>

            {/* ✅ Price Range Filter */}
            <div className="price-filter">
              <input
                type="number"
                placeholder="Min Price"
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
              />
              <input
                type="number"
                placeholder="Max Price"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
              />
              <button
                className="glass-button"
                onClick={() => {
                  setMinPrice("");
                  setMaxPrice("");
                }}
              >
                Clear
              </button>
            </div>
          </>
        )}

        {progress > 0 ? (
          <>
            <div className="progress-container">
              <div className="progress-bar" style={{ width: `${progress}%` }} />
            </div>
            <p className="progress-text">{progress}% done</p>
          </>
        ) : filteredResults.length > 0 ? (
          <motion.div className="grid">
            {filteredResults.map((item, idx) => (
              <motion.div
                key={idx}
                className="glass-card-mini"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
              >
                <div className="label">Block #{idx + 1}</div>
                <div className="block-text formatted-text">
                  <div><strong>Name:</strong> {item.name}</div>
                  <div><strong>Phone:</strong> {item.phone}</div>
                  <div><strong>Address 1:</strong> {item.address1}</div>
                  <div><strong>Address 2:</strong> {item.address2}</div>
                  <div><strong>City:</strong> {item.city}, <strong>State:</strong> {item.state}, <strong>Pincode:</strong> {item.pincode}</div>
                </div>
                <div className="badge">Size: {item.size}</div>
                <div className="badge green">Price: {item.total}</div>
                <div className="badge yellow">Mode: {item.mode}</div>
              </motion.div>
            ))}
          </motion.div>
        ) : (
          <div className="empty-message">No results found.</div>
        )}
      </motion.div>
    </div>
  );
}
