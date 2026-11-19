// =============================================
// FLIPKART PDF EXTRACTOR - Smart Address Tool
// =============================================
import React, { useEffect, useState } from "react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.mjs?url";
import { Upload, Package, FileText } from "lucide-react";
import { motion } from "framer-motion";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import "./index.css";

GlobalWorkerOptions.workerSrc = workerSrc;

// India State Code → Full Name Map
const STATE_MAP = {
  AP: "Andhra Pradesh", AR: "Arunachal Pradesh", AS: "Assam",
  BR: "Bihar", CG: "Chhattisgarh", GA: "Goa", GJ: "Gujarat",
  HR: "Haryana", HP: "Himachal Pradesh", JH: "Jharkhand",
  KA: "Karnataka", KL: "Kerala", MP: "Madhya Pradesh",
  MH: "Maharashtra", MN: "Manipur", ML: "Meghalaya",
  MZ: "Mizoram", NL: "Nagaland", OR: "Odisha", PB: "Punjab",
  RJ: "Rajasthan", SK: "Sikkim", TN: "Tamil Nadu",
  TS: "Telangana", TR: "Tripura", UP: "Uttar Pradesh",
  UK: "Uttarakhand", WB: "West Bengal", DL: "Delhi",
  JK: "Jammu & Kashmir", LA: "Ladakh", PY: "Puducherry",
  CH: "Chandigarh", AN: "Andaman & Nicobar",
};

// Extract data from ONE page's text (Flipkart format)
function parseFlipkartPage(text) {
  // Order ID: OD123...
  const orderMatch = text.match(/\b(OD\d{18,})\b/);
  const orderId = orderMatch ? orderMatch[1] : "Unknown";

  // Payment Mode: COD or PREPAID at top
  const modeMatch = text.match(/\b(COD|PREPAID)\b/);
  const mode = modeMatch ? modeMatch[1] : "Unknown";

  // AWB Number (after "No." line)
  const awbMatch = text.match(/AWB\s*\n+No\.\s*\n+(\S+)/);
  const awb = awbMatch ? awbMatch[1] : "Unknown";

  // Customer Name
  const nameMatch = text.match(/Name:\s*([^\n,]+)/);
  const name = nameMatch
    ? nameMatch[1].trim().replace(/\b\w/g, (c) => c.toUpperCase())
    : "Unknown";

  // Full shipping address block: between "Name: ..." and "HBD:"
  const addrBlockMatch = text.match(
    /Shipping\/Customer address:\s*\nName:\s*[^\n]+\n([\s\S]*?)(?=HBD:|$)/
  );
  const addrLines = addrBlockMatch
    ? addrBlockMatch[1]
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
    : [];

  const address1 = addrLines.slice(0, Math.ceil(addrLines.length / 2)).join(", ") || "None";
  const address2 = addrLines.slice(Math.ceil(addrLines.length / 2)).join(", ") || "None";

  // Pincode: 6 digits before ", IN-"
  const pincodeMatch = text.match(/(\d{6}),\s*IN-[A-Z]{2}/);
  const pincode = pincodeMatch ? pincodeMatch[1] : "Unknown";

  // State: IN-XX code → full name
  const stateCodeMatch = text.match(/IN-([A-Z]{2})\b/);
  const stateCode = stateCodeMatch ? stateCodeMatch[1] : "";
  const state = STATE_MAP[stateCode] || stateCode || "Unknown";

  // City: word(s) right before "- 6digits, IN-"
  const cityMatch = text.match(/([A-Za-z][\w\s,]*?)\s*-\s*\d{6},\s*IN-/);
  let city = "Unknown";
  if (cityMatch) {
    // Take last word/phrase before the dash
    const raw = cityMatch[1].trim().split(/[\n,]/).pop() || "";
    city = raw.replace(/^\d+\s+/, "").trim();
  }

  // Size: standard clothing sizes
  const sizeMatch = text.match(
    /\|\s*(XXXL|XXL|XL|L|M|S|XS|4XL|5XL|6XL|7XL|8XL|Free Size)\b/i
  );
  const size = sizeMatch ? sizeMatch[1].toUpperCase() : "N/A";

  // Total Price
  const totalMatch = text.match(/TOTAL PRICE:\s*([\d.]+)/);
  const total = totalMatch ? `Rs.${totalMatch[1]}` : "Unknown";

  // Product Description (SKU line)
  const descMatch = text.match(/SKU ID \| Description\s+QTY\s*\n\d+\s+\S+\s+\|\s+(.+?)(?:\n|$)/);
  const product = descMatch ? descMatch[1].trim() : "Unknown";

  // Order Date
  const dateMatch = text.match(/Order Date:\s*([\d\-]+)/);
  const orderDate = dateMatch ? dateMatch[1] : "Unknown";

  // Invoice No
  const invoiceMatch = text.match(/Invoice No:\s*(\S+)/);
  const invoice = invoiceMatch ? invoiceMatch[1] : "Unknown";

  return {
    orderId,
    name,
    address1,
    address2,
    city,
    state,
    pincode,
    size,
    total,
    mode,
    awb,
    product,
    orderDate,
    invoice,
  };
}

export default function FlipkartExtractor() {
  const [results, setResults] = useState([]);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSize, setSelectedSize] = useState("");
  const [selectedMode, setSelectedMode] = useState("");
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

    setResults([]);
    setProgress(1);
    let allResults = [];

    for (let fi = 0; fi < files.length; fi++) {
      const file = files[fi];
      setProgressLabel(`Reading: ${file.name}`);

      const pageResults = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          setTimeout(async () => {
            const typedArray = new Uint8Array(reader.result);
            const pdf = await getDocument({ data: typedArray }).promise;
            const parsed = [];

            for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
              const page = await pdf.getPage(pageNum);
              const textContent = await page.getTextContent();
              const text = textContent.items.map((item) => item.str).join("\n");
              const data = parseFlipkartPage(text);
              // Only keep pages with a valid Order ID
              if (data.orderId !== "Unknown") {
                parsed.push(data);
              }
              setProgress(
                Math.round(
                  ((fi / files.length) + (pageNum / pdf.numPages) / files.length) * 100
                )
              );
            }
            resolve(parsed);
          }, 0);
        };
        reader.readAsArrayBuffer(file);
      });

      allResults = [...allResults, ...pageResults];
    }

    setResults(allResults);
    setProgress(0);
    setProgressLabel("");
  };

  const handleExportExcel = () => {
    const exportData = filteredResults.map((item, idx) => ({
      "#": idx + 1,
      "Order ID": item.orderId,
      "Invoice No": item.invoice,
      "Order Date": item.orderDate,
      Name: item.name,
      "Address 1": item.address1,
      "Address 2": item.address2,
      City: item.city,
      State: item.state,
      Pincode: item.pincode,
      Size: item.size,
      Total: item.total,
      Mode: item.mode,
      AWB: item.awb,
      Product: item.product,
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    // Auto column widths
    const cols = Object.keys(exportData[0] || {}).map((k) => ({
      wch: Math.max(k.length, 15),
    }));
    worksheet["!cols"] = cols;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Flipkart Orders");
    const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const dataBlob = new Blob([excelBuffer], { type: "application/octet-stream" });
    saveAs(dataBlob, "flipkart_orders.xlsx");
  };

  // --- Filtering ---
  const filteredResults = results.filter((item) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      !q ||
      item.name.toLowerCase().includes(q) ||
      item.orderId.toLowerCase().includes(q) ||
      item.awb.toLowerCase().includes(q) ||
      item.address1.toLowerCase().includes(q) ||
      item.address2.toLowerCase().includes(q) ||
      item.city.toLowerCase().includes(q) ||
      item.state.toLowerCase().includes(q) ||
      item.pincode.includes(q) ||
      item.product.toLowerCase().includes(q);

    const matchesSize = selectedSize ? item.size === selectedSize : true;
    const matchesMode = selectedMode ? item.mode === selectedMode : true;

    const priceValue = parseFloat(item.total.replace("Rs.", "")) || 0;
    const matchesPrice =
      (!minPrice || priceValue >= parseFloat(minPrice)) &&
      (!maxPrice || priceValue <= parseFloat(maxPrice));

    return matchesSearch && matchesSize && matchesMode && matchesPrice;
  });

  // --- Stats ---
  const stats = (() => {
    const sizeMap = {};
    const stateMap = {};
    let grandTotal = 0;
    let cod = 0;
    let prepaid = 0;

    filteredResults.forEach(({ size, total, mode, state }) => {
      sizeMap[size] = (sizeMap[size] || 0) + 1;
      stateMap[state] = (stateMap[state] || 0) + 1;
      const val = parseFloat(total.replace("Rs.", "")) || 0;
      grandTotal += val;
      if (mode === "COD") cod++;
      if (mode === "PREPAID") prepaid++;
    });

    // Duplicate detection (same name + pincode + mode)
    const seen = new Set();
    let dupes = 0;
    filteredResults.forEach(({ name, pincode, mode }) => {
      const key = `${name.toLowerCase()}|${pincode}|${mode}`;
      if (seen.has(key)) dupes++;
      else seen.add(key);
    });

    return { total: filteredResults.length, grandTotal, cod, prepaid, dupes, sizeMap, stateMap };
  })();

  const topState = Object.entries(stats.stateMap).sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="container">
      <motion.div
        className="glass-card"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
      >
        {/* Header */}
        <div className="app-header">
          <div className="app-logo">
            <Package size={28} />
            <div>
              <h1 className="title">Flipkart Order Extractor</h1>
              <p className="subtitle">Upload Flipkart shipping label PDFs to extract & filter</p>
            </div>
          </div>
          <button className="glass-toggle" onClick={() => setDarkMode(!darkMode)}>
            {darkMode ? "☀ Light" : "🌙 Dark"}
          </button>
        </div>

        {/* Upload */}
        <div className="upload-zone">
          <label htmlFor="pdfUpload" className="upload-label">
            <Upload size={22} />
            <span>Upload Flipkart PDFs</span>
            <small>Multiple files supported</small>
          </label>
          <input
            type="file"
            accept="application/pdf"
            multiple
            onChange={handleFileUpload}
            className="hidden-input"
            id="pdfUpload"
          />
        </div>

        {/* Progress */}
        {progress > 0 && (
          <div className="progress-wrap">
            <div className="progress-container">
              <div className="progress-bar" style={{ width: `${progress}%` }} />
            </div>
            <p className="progress-text">{progressLabel || `${progress}% done`}</p>
          </div>
        )}

        {/* Results Section */}
        {results.length > 0 && (
          <>
            {/* Action Bar */}
            <div className="action-bar">
              <button className="glass-export" onClick={handleExportExcel}>
                <FileText size={16} /> Export to Excel ({filteredResults.length})
              </button>
              <button className="btn-clear" onClick={() => setResults([])}>
                🗑 Clear All
              </button>
            </div>

            {/* Stats Dashboard */}
            <div className="dashboard-glass">
              <div className="stat-card blue">
                <div className="stat-num">{stats.total}</div>
                <div className="stat-label">Total Orders</div>
              </div>
              <div className="stat-card green">
                <div className="stat-num">Rs.{stats.grandTotal.toFixed(0)}</div>
                <div className="stat-label">Grand Total</div>
              </div>
              <div className="stat-card orange">
                <div className="stat-num">{stats.cod}</div>
                <div className="stat-label">COD</div>
              </div>
              <div className="stat-card purple">
                <div className="stat-num">{stats.prepaid}</div>
                <div className="stat-label">Prepaid</div>
              </div>
              <div className="stat-card red">
                <div className="stat-num">{stats.dupes}</div>
                <div className="stat-label">Duplicates</div>
              </div>
              {topState && (
                <div className="stat-card teal">
                  <div className="stat-num">{topState[1]}</div>
                  <div className="stat-label">Top: {topState[0]}</div>
                </div>
              )}
            </div>

            {/* Size Breakdown */}
            <div className="size-row">
              {Object.entries(stats.sizeMap).map(([sz, cnt]) => (
                <span key={sz} className="size-chip">{sz}: {cnt}</span>
              ))}
            </div>

            {/* Search & Filters */}
            <input
              type="text"
              className="glass-search"
              placeholder="🔍 Search by name, order ID, AWB, city, state, pincode, product..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />

            <div className="filter-row">
              {/* Size filters */}
              <div className="filter-glass">
                {["XS","S","M","L","XL","XXL","XXXL","4XL","5XL","N/A"].map((sz) => (
                  <button
                    key={sz}
                    onClick={() => setSelectedSize(selectedSize === sz ? "" : sz)}
                    className={`filter-chip ${selectedSize === sz ? "active" : ""}`}
                  >
                    {sz}
                  </button>
                ))}
              </div>

              {/* Mode filters */}
              <div className="mode-filter">
                {["COD", "PREPAID"].map((m) => (
                  <button
                    key={m}
                    onClick={() => setSelectedMode(selectedMode === m ? "" : m)}
                    className={`mode-chip ${selectedMode === m ? "active-" + m.toLowerCase() : ""}`}
                  >
                    {m}
                  </button>
                ))}
              </div>

              {/* Price range */}
              <div className="price-filter">
                <input type="number" placeholder="Min ₹" value={minPrice}
                  onChange={(e) => setMinPrice(e.target.value)} className="price-input" />
                <span>—</span>
                <input type="number" placeholder="Max ₹" value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)} className="price-input" />
                <button className="btn-xs" onClick={() => { setMinPrice(""); setMaxPrice(""); setSelectedSize(""); setSelectedMode(""); setSearchQuery(""); }}>
                  Reset
                </button>
              </div>
            </div>

            {/* Cards Grid */}
            {filteredResults.length > 0 ? (
              <motion.div className="grid">
                {filteredResults.map((item, idx) => (
                  <motion.div
                    key={idx}
                    className="order-card"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: idx < 20 ? idx * 0.02 : 0 }}
                  >
                    <div className="card-top">
                      <span className="order-num">#{idx + 1}</span>
                      <span className={`mode-badge ${item.mode === "COD" ? "cod" : "prepaid"}`}>
                        {item.mode}
                      </span>
                    </div>

                    <div className="customer-name">{item.name}</div>

                    <div className="order-detail">
                      <span className="detail-label">Order ID</span>
                      <span className="detail-val order-id">{item.orderId}</span>
                    </div>
                    <div className="order-detail">
                      <span className="detail-label">AWB</span>
                      <span className="detail-val">{item.awb}</span>
                    </div>
                    <div className="order-detail">
                      <span className="detail-label">Product</span>
                      <span className="detail-val small-text">{item.product}</span>
                    </div>
                    <div className="order-detail">
                      <span className="detail-label">Address</span>
                      <span className="detail-val small-text">
                        {item.address1}{item.address2 !== "None" ? ", " + item.address2 : ""}
                      </span>
                    </div>
                    <div className="order-detail">
                      <span className="detail-label">Location</span>
                      <span className="detail-val">{item.city}, {item.state} - {item.pincode}</span>
                    </div>
                    <div className="order-detail">
                      <span className="detail-label">Date</span>
                      <span className="detail-val">{item.orderDate}</span>
                    </div>

                    <div className="card-badges">
                      <span className="badge">📦 {item.size}</span>
                      <span className="badge green">💰 {item.total}</span>
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            ) : (
              <div className="empty-message">No orders match your filters.</div>
            )}
          </>
        )}

        {results.length === 0 && progress === 0 && (
          <div className="empty-message">
            Upload a Flipkart shipping label PDF to get started.
          </div>
        )}
      </motion.div>
    </div>
  );
}