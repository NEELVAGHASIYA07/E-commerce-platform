const ordersList = document.getElementById("ordersList");
const totalOrdersCount = document.getElementById("totalOrdersCount");
const ordersRangeText = document.getElementById("ordersRangeText");
const ordersPrevBtn = document.getElementById("ordersPrevBtn");
const ordersNextBtn = document.getElementById("ordersNextBtn");
const ordersPaginationNumbers = document.getElementById("ordersPaginationNumbers");
const ordersFilterBtn = document.getElementById("ordersFilterBtn");
const ordersFilterBtnLabel = document.getElementById("ordersFilterBtnLabel");
const ordersFilterMenu = document.getElementById("ordersFilterMenu");
const orderTabButtons = Array.from(document.querySelectorAll(".order-tab-btn"));
const orderFilterOptions = Array.from(document.querySelectorAll(".order-filter-option"));

const PAGE_SIZE = 3;

let allOrders = [];
let currentFilter = "all";
let currentPage = 1;
let currentUserProfile = null;
let ordersRefreshTimer = null;
let myReviewLookup = new Map();
const REVIEW_EDIT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const REVIEW_REFRESH_DEFER_MS = 20000;
let reviewInteractionUntil = 0;
let reviewSubmitInFlight = false;

function buildReviewKey(orderId, itemName) {
  return `${String(orderId || "").trim()}::${String(itemName || "").trim().toLowerCase()}`;
}

function renderStarsFromNumber(rating) {
  const safeRating = Math.max(0, Math.min(5, Number(rating || 0)));
  let stars = "";
  for (let i = 1; i <= 5; i += 1) {
    stars += i <= safeRating ? "★" : "☆";
  }
  return stars;
}

function isReviewEditLocked(review) {
  if (!review?.createdAt) return false;
  const createdTime = new Date(review.createdAt).getTime();
  if (Number.isNaN(createdTime)) return false;
  return Date.now() - createdTime > REVIEW_EDIT_WINDOW_MS;
}

function markReviewInteraction(extraMs = REVIEW_REFRESH_DEFER_MS) {
  reviewInteractionUntil = Math.max(reviewInteractionUntil, Date.now() + extraMs);
}

function shouldDeferOrdersRefresh() {
  if (reviewSubmitInFlight || Date.now() < reviewInteractionUntil) {
    return true;
  }

  const activeEl = document.activeElement;
  if (activeEl instanceof HTMLElement && activeEl.closest(".review-box")) {
    return true;
  }

  return false;
}

function scheduleOrdersRefresh(delayMs = 10000) {
  if (ordersRefreshTimer) {
    clearTimeout(ordersRefreshTimer);
  }

  ordersRefreshTimer = setTimeout(() => {
    if (shouldDeferOrdersRefresh()) {
      scheduleOrdersRefresh(8000);
      return;
    }
    loadOrders();
  }, delayMs);
}

function getExistingReview(orderId, itemName) {
  const direct = myReviewLookup.get(buildReviewKey(orderId, itemName));
  if (direct) return direct;

  for (const [key, value] of myReviewLookup.entries()) {
    if (key.endsWith(`::${String(itemName || "").trim().toLowerCase()}`)) {
      return value;
    }
  }
  return null;
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatAmount(amount) {
  const numeric = toNumericAmount(amount);
  return `₹${numeric.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function toNumericAmount(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const cleaned = String(value ?? "")
    .replaceAll(",", "")
    .replace(/[^0-9.-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatAmountPdf(amount) {
  const numeric = toNumericAmount(amount);
  return `INR ${numeric.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatDate(dateValue) {
  if (!dateValue) {
    return "-";
  }
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric"
  });
}

function formatLabel(value, fallback = "N/A") {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return fallback;
  }

  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getImageSrc(rawImage) {
  if (!rawImage) {
    return "https://via.placeholder.com/200x200/272b30/8b93a5?text=Product";
  }
  if (/^https?:\/\//i.test(rawImage)) {
    return rawImage;
  }
  return `imgs/${rawImage}`;
}

function getStatusMeta(statusText) {
  const normalized = (statusText || "pending").toLowerCase();
  if (normalized === "confirmed") {
    return {
      key: "confirmed",
      label: "Confirmed",
      badgeClass: "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20",
      dotClass: "bg-emerald-500"
    };
  }
  if (normalized === "rejected") {
    return {
      key: "rejected",
      label: "Rejected",
      badgeClass: "bg-rose-500/10 text-rose-400 border border-rose-500/20",
      dotClass: "bg-rose-400"
    };
  }
  if (normalized === "delivered") {
    return {
      key: "delivered",
      label: "Delivered",
      badgeClass: "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20",
      dotClass: "bg-emerald-500"
    };
  }
  if (normalized === "shipped") {
    return {
      key: "shipped",
      label: "Shipped",
      badgeClass: "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20",
      dotClass: "bg-indigo-400"
    };
  }
  if (normalized === "processing") {
    return {
      key: "pending",
      label: "Pending",
      badgeClass: "bg-primary/10 text-primary border border-primary/20",
      dotClass: "bg-primary"
    };
  }
  if (normalized === "cancelled") {
    return {
      key: "rejected",
      label: "Rejected",
      badgeClass: "bg-rose-500/10 text-rose-400 border border-rose-500/20",
      dotClass: "bg-rose-400"
    };
  }
  return {
    key: "pending",
    label: "Pending",
    badgeClass: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
    dotClass: "bg-amber-400"
  };
}

function renderEmptyState(message) {
  ordersList.innerHTML = `
    <div class="bg-card-dark border border-white/5 rounded-xl p-8 text-center">
      <p class="text-gray-300 text-sm">${escapeHTML(message)}</p>
    </div>
  `;
  totalOrdersCount.textContent = "0";
  ordersRangeText.textContent = "Showing 0 to 0 of 0 orders";
  ordersPaginationNumbers.innerHTML = "";
  ordersPrevBtn.disabled = true;
  ordersNextBtn.disabled = true;
  ordersPrevBtn.classList.add("opacity-50", "cursor-not-allowed");
  ordersNextBtn.classList.add("opacity-50", "cursor-not-allowed");
}

function normalizeOrder(order) {
  let resolvedStatus = order.status;
  const paymentState = String(order.paymentStatus || "").toLowerCase();

  if (paymentState === "paid") {
    resolvedStatus = "Confirmed";
  } else if (paymentState === "failed") {
    resolvedStatus = "Rejected";
  }

  const status = getStatusMeta(resolvedStatus);
  return {
    id: order._id || "-",
    createdAt: order.createdAt || order.date || null,
    totalAmount: order.totalAmount || 0,
    paymentMethod: order.paymentMethod || "N/A",
    billingAddress: order.billingAddress || {},
    items: Array.isArray(order.items) ? order.items : [],
    status,
    paymentStatus: paymentState || "pending"
  };
}

function parseAddress(addressValue, fallbackBilling = {}) {
  const fallback = {
    shippingAddress: fallbackBilling.address || "N/A",
    city: fallbackBilling.city || "N/A",
    postalCode: fallbackBilling.zip || "N/A",
    country: fallbackBilling.country || "N/A"
  };

  if (!addressValue || typeof addressValue !== "string") {
    return fallback;
  }

  const parts = addressValue
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return fallback;
  }

  const shippingAddress = parts[0] || fallback.shippingAddress;
  const city = parts[1] || fallback.city;
  const postalCode = parts[2] || fallback.postalCode;
  const country = parts[3] || fallback.country;

  return {
    shippingAddress,
    city,
    postalCode,
    country
  };
}

function getInvoiceNumber(order) {
  const date = new Date(order.createdAt || Date.now());
  const y = String(date.getFullYear());
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const idTail = String(order.id || "000000").slice(-6).toUpperCase();
  return `INV-${y}${m}${d}-${idTail}`;
}

function getOrderById(orderId) {
  return allOrders.find((order) => order.id === orderId) || null;
}

function addInvoiceFooter(doc) {
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setDrawColor(224, 228, 236);
  doc.line(14, pageHeight - 22, 196, pageHeight - 22);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(31, 41, 55);
  doc.text("ROMUYKS", 14, pageHeight - 15);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(107, 114, 128);
  doc.text("Premium order invoice • support@romuyks.com", 14, pageHeight - 10);
  doc.text("System-generated invoice", 196, pageHeight - 10, { align: "right" });
}

function getInvoiceStatusStyle(statusLabel) {
  const normalized = String(statusLabel ?? "pending").trim().toLowerCase();

  if (normalized === "confirmed" || normalized === "paid" || normalized === "delivered") {
    return {
      fill: [220, 252, 231],
      text: [22, 101, 52]
    };
  }

  if (normalized === "rejected" || normalized === "cancelled") {
    return {
      fill: [254, 226, 226],
      text: [153, 27, 27]
    };
  }

  return {
    fill: [254, 249, 195],
    text: [146, 64, 14]
  };
}

function drawInvoiceBrandMark(doc, x, y) {
  doc.setFillColor(43, 17, 212);
  doc.roundedRect(x, y, 14, 14, 3, 3, "F");
  doc.setFillColor(255, 255, 255);
  doc.circle(x + 7, y + 7, 2.2, "F");
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(0.9);
  doc.line(x + 4, y + 10, x + 10, y + 4);
}

function drawInvoiceSectionTitle(doc, x, y, title) {
  doc.setFillColor(43, 17, 212);
  doc.roundedRect(x, y - 3.5, 2.5, 7, 1.2, 1.2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(title, x + 6, y + 1.2);
}

function drawMetaCard(doc, x, y, w, h, label, value) {
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(x, y, w, h, 3, 3, "FD");
  doc.setFillColor(43, 17, 212);
  doc.roundedRect(x, y, w, 2.2, 3, 3, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(label, x + 4, y + 7.5);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text(value, x + 4, y + 13.5);
}

function drawInfoBlock(doc, x, y, w, title, lines) {
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(x, y, w, 36, 3, 3, "FD");
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(x + 3, y + 3, 22, 7, 2, 2, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(title, x + 6, y + 7.7);

  let lineY = y + 15;
  lines.filter(Boolean).slice(0, 4).forEach((line, index) => {
    doc.setFont("helvetica", index === 0 ? "bold" : "normal");
    doc.setFontSize(index === 0 ? 10.5 : 9.5);
    doc.setTextColor(index === 0 ? 15 : 71, index === 0 ? 23 : 85, index === 0 ? 42 : 105);
    doc.text(String(line), x + 4, lineY, { maxWidth: w - 8 });
    lineY += 6;
  });
}

function downloadInvoiceForOrder(order) {
  const jsPDFGlobal = window.jspdf;
  if (!jsPDFGlobal || !jsPDFGlobal.jsPDF) {
    alert("Invoice service is unavailable right now. Please try again.");
    return;
  }

  const doc = new jsPDFGlobal.jsPDF({ unit: "mm", format: "a4" });
  const billing = order.billingAddress || {};
  const customerNameFromBilling = `${billing.firstName || ""} ${billing.lastName || ""}`.trim();
  const customerName = customerNameFromBilling || currentUserProfile?.name || "Customer";
  const customerEmail = billing.email || currentUserProfile?.email || "N/A";
  const addressParts = parseAddress(currentUserProfile?.address || "", billing);
  const customerPhone = billing.phone || "N/A";
  const invoiceNo = getInvoiceNumber(order);
  const orderDate = formatDate(order.createdAt);
  const invoiceDate = formatDate(new Date().toISOString());
  const paymentMethodLabel = formatLabel(order.paymentMethod, "Not specified");
  const orderStatusLabel = formatLabel(order.status?.label || order.status, "Pending");
  const itemCount = Array.isArray(order.items) ? order.items.length : 0;

  const calculatedSubtotal = (order.items || []).reduce((sum, item) => {
    const qty = toNumericAmount(item.quantity || 0);
    const price = toNumericAmount(item.price || 0);
    return sum + (qty * price);
  }, 0);
  const orderTotal = toNumericAmount(order.totalAmount || 0);
  const subtotal = calculatedSubtotal;
  const shippingAmount = 0;
  const total = orderTotal > 0 ? orderTotal : calculatedSubtotal;
  const statusStyle = getInvoiceStatusStyle(orderStatusLabel);

  doc.setFillColor(245, 247, 251);
  doc.rect(0, 0, 210, 297, "F");
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 210, 48, "F");
  doc.setFillColor(43, 17, 212);
  doc.rect(0, 44, 210, 4, "F");
  doc.setFillColor(255, 255, 255);
  if (typeof doc.setGState === "function" && typeof doc.GState === "function") {
    doc.setGState(new doc.GState({ opacity: 0.04 }));
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(48);
  doc.text("ROMUYKS", 196, 24, { align: "right" });
  if (typeof doc.setGState === "function" && typeof doc.GState === "function") {
    doc.setGState(new doc.GState({ opacity: 1 }));
  }

  drawInvoiceBrandMark(doc, 14, 9);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(191, 219, 254);
  doc.text("ROMUYKS", 32, 13);

  doc.setFontSize(24);
  doc.setTextColor(255, 255, 255);
  doc.text("Invoice", 32, 26);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(203, 213, 225);
  doc.text("Professional order receipt and payment summary", 32, 33);

  doc.setFillColor(...statusStyle.fill);
  doc.roundedRect(150, 11, 46, 12, 3, 3, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(...statusStyle.text);
  doc.text(orderStatusLabel.toUpperCase(), 173, 18.5, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225);
  doc.text(`Invoice No. ${invoiceNo}`, 196, 31, { align: "right" });
  doc.text(`Issued ${invoiceDate}`, 196, 36.5, { align: "right" });

  drawInvoiceSectionTitle(doc, 14, 52, "Order Summary");
  drawMetaCard(doc, 14, 56, 42, 16, "ORDER DATE", orderDate);
  drawMetaCard(doc, 60, 56, 42, 16, "PAYMENT", paymentMethodLabel);
  drawMetaCard(doc, 106, 56, 42, 16, "ITEMS", String(itemCount));
  drawMetaCard(doc, 152, 56, 44, 16, "AMOUNT", formatAmountPdf(total));

  drawInvoiceSectionTitle(doc, 14, 76, "Addresses");
  drawInfoBlock(doc, 14, 80, 88, "BILL TO", [
    customerName,
    customerEmail,
    customerPhone,
    `${addressParts.shippingAddress}, ${addressParts.city}`
  ]);
  drawInfoBlock(doc, 108, 80, 88, "SHIP TO", [
    customerName,
    addressParts.shippingAddress,
    `${addressParts.city}, ${addressParts.postalCode}`,
    addressParts.country
  ]);

  drawInfoBlock(doc, 14, 122, 88, "FROM", [
    "Romuyks",
    "Premium E-commerce Store",
    "support@romuyks.com",
    "India"
  ]);
  drawInfoBlock(doc, 108, 122, 88, "ORDER DETAILS", [
    `Order ID: #${String(order.id).slice(-8).toUpperCase()}`,
    `Status: ${orderStatusLabel}`,
    `Payment: ${paymentMethodLabel}`,
    `Generated: ${invoiceDate}`
  ]);

  const bodyRows = (order.items || []).map((item) => {
    const qty = toNumericAmount(item.quantity || 0);
    const price = toNumericAmount(item.price || 0);
    const lineAmount = qty * price;
    const productLabel = item.description
      ? `${item.name || "Product"}\n${item.description}`
      : (item.name || "Product");
    return [
      productLabel,
      String(qty),
      formatAmountPdf(price),
      formatAmountPdf(lineAmount)
    ];
  });

  drawInvoiceSectionTitle(doc, 14, 164, "Line Items");

  doc.autoTable({
    startY: 168,
    head: [["Item", "Qty", "Unit Price", "Line Total"]],
    body: bodyRows.length > 0 ? bodyRows : [["No items", "0", formatAmountPdf(0), formatAmountPdf(0)]],
    theme: "plain",
    margin: { left: 14, right: 14, bottom: 38 },
    styles: {
      font: "helvetica",
      fontSize: 9.5,
      textColor: [31, 41, 55],
      cellPadding: { top: 4, right: 4, bottom: 4, left: 4 },
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
      valign: "middle"
    },
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 9,
      cellPadding: 4
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252]
    },
    columnStyles: {
      0: { cellWidth: 92 },
      1: { halign: "right", cellWidth: 25 },
      2: { halign: "right", cellWidth: 31 },
      3: { halign: "right", cellWidth: 34 }
    },
    bodyStyles: {
      minCellHeight: 14
    },
    didParseCell: (hookData) => {
      if (hookData.section === "head") {
        hookData.cell.styles.lineWidth = { top: 0, right: 0, bottom: 0, left: 0 };
      }
      if (hookData.section === "body" && hookData.column.index === 0) {
        hookData.cell.styles.fontStyle = "bold";
      }
    },
    didDrawPage: () => {
      addInvoiceFooter(doc);
    }
  });

  const tableEndY = doc.lastAutoTable ? doc.lastAutoTable.finalY : 110;
  const pageHeight = doc.internal.pageSize.getHeight();

  let summaryY = tableEndY + 12;
  let movedSummaryToNewPage = false;
  if (summaryY > pageHeight - 58) {
    doc.addPage();
    summaryY = 28;
    movedSummaryToNewPage = true;
  }

  drawInvoiceSectionTitle(doc, 14, summaryY - 12, "Closing Summary");
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(14, summaryY - 8, 112, 28, 3, 3, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text("Notes", 18, summaryY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(71, 85, 105);
  doc.text("This invoice confirms your order and payment summary.", 18, summaryY + 7);
  doc.text("For support, contact support@romuyks.com with your invoice number.", 18, summaryY + 13);

  doc.setFillColor(15, 23, 42);
  doc.roundedRect(132, summaryY - 8, 64, 34, 3, 3, "F");
  doc.setFillColor(43, 17, 212);
  doc.roundedRect(132, summaryY - 8, 64, 4, 3, 3, "F");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(191, 219, 254);
  doc.text("Subtotal", 136, summaryY);
  doc.text(formatAmountPdf(subtotal), 192, summaryY, { align: "right" });
  doc.text("Shipping", 136, summaryY + 7);
  doc.text(formatAmountPdf(shippingAmount), 192, summaryY + 7, { align: "right" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text("Grand Total", 136, summaryY + 17);
  doc.text(formatAmountPdf(total), 192, summaryY + 17, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text("All amounts shown in INR", 136, summaryY + 24);

  if (movedSummaryToNewPage) {
    addInvoiceFooter(doc);
  }

  doc.save(`invoice-order-${order.id}.pdf`);
}

function getFilteredOrders() {
  if (currentFilter === "all") {
    return allOrders;
  }
  return allOrders.filter((order) => order.status.key === currentFilter);
}

function getFilterLabel(filterKey) {
  if (filterKey === "pending") {
    return "Pending";
  }
  if (filterKey === "confirmed") {
    return "Confirmed";
  }
  if (filterKey === "rejected") {
    return "Rejected";
  }
  return "All Orders";
}

function closeFilterMenu() {
  if (!ordersFilterMenu || !ordersFilterBtn) {
    return;
  }

  ordersFilterMenu.classList.add("hidden");
  ordersFilterBtn.setAttribute("aria-expanded", "false");
}

function openFilterMenu() {
  if (!ordersFilterMenu || !ordersFilterBtn) {
    return;
  }

  ordersFilterMenu.classList.remove("hidden");
  ordersFilterBtn.setAttribute("aria-expanded", "true");
}

function syncFilterUI() {
  orderTabButtons.forEach((tab) => {
    const isActive = (tab.dataset.status || "all") === currentFilter;
    tab.classList.toggle("font-bold", isActive);
    tab.classList.toggle("border-b-2", isActive);
    tab.classList.toggle("border-primary", isActive);
    tab.classList.toggle("text-white", isActive);
    tab.classList.toggle("font-medium", !isActive);
    tab.classList.toggle("text-gray-500", !isActive);
  });

  orderFilterOptions.forEach((option) => {
    const isActive = (option.dataset.status || "all") === currentFilter;
    option.classList.toggle("bg-primary/15", isActive);
    option.classList.toggle("border", isActive);
    option.classList.toggle("border-primary/30", isActive);
    option.classList.toggle("text-primary", isActive);
  });

  if (ordersFilterBtnLabel) {
    ordersFilterBtnLabel.textContent = getFilterLabel(currentFilter);
  }
}

function applyFilter(nextFilter) {
  currentFilter = nextFilter || "all";
  currentPage = 1;
  syncFilterUI();
  closeFilterMenu();
  renderOrders();
}

function renderPagination(totalPages) {
  ordersPaginationNumbers.innerHTML = "";

  for (let page = 1; page <= totalPages; page += 1) {
    const pageBtn = document.createElement("button");
    const isActive = page === currentPage;
    pageBtn.type = "button";
    pageBtn.className = isActive
      ? "h-10 w-10 flex items-center justify-center bg-primary rounded-lg text-white font-bold border border-primary transition-all"
      : "h-10 w-10 flex items-center justify-center bg-accent-dark rounded-lg text-gray-400 hover:text-white border border-white/5 transition-all";
    pageBtn.textContent = String(page);
    pageBtn.addEventListener("click", () => {
      currentPage = page;
      renderOrders();
    });
    ordersPaginationNumbers.appendChild(pageBtn);
  }

  const canGoPrev = currentPage > 1;
  const canGoNext = currentPage < totalPages;
  ordersPrevBtn.disabled = !canGoPrev;
  ordersNextBtn.disabled = !canGoNext;
  ordersPrevBtn.classList.toggle("opacity-50", !canGoPrev);
  ordersPrevBtn.classList.toggle("cursor-not-allowed", !canGoPrev);
  ordersNextBtn.classList.toggle("opacity-50", !canGoNext);
  ordersNextBtn.classList.toggle("cursor-not-allowed", !canGoNext);
}

function createOrderCard(order) {
  const allThumbnails = order.items
    .map((item) => {
      const imageSrc = getImageSrc(item.image);
      return `
        <div class="h-16 w-16 rounded-lg bg-accent-dark border border-white/10 overflow-hidden shrink-0">
          <img src="${escapeHTML(imageSrc)}" alt="${escapeHTML(item.name || "Product")}" class="h-full w-full object-cover" />
        </div>
      `;
    })
    .join("");

  const itemsDetails = order.items
    .map((item) => {
      const imageSrc = getImageSrc(item.image);
      const quantity = Number(item.quantity || 0);
      const price = Number(item.price || 0);
      const existingReview = getExistingReview(order.id, item.name);
      const existingRating = Number(existingReview?.rating || 0);
      const existingComment = String(existingReview?.comment || "");
      const canReview = order.status.key === "confirmed" || order.status.key === "delivered";
      const isLocked = existingRating > 0 && isReviewEditLocked(existingReview);

      const starButtons = [1, 2, 3, 4, 5]
        .map((starValue) => `
          <button
            type="button"
            class="review-star-btn text-lg leading-none ${starValue <= existingRating ? "text-yellow-400" : "text-gray-500"}"
            data-value="${starValue}"
            aria-label="Rate ${starValue} star${starValue === 1 ? "" : "s"}">
            ★
          </button>
        `)
        .join("");

      const reviewControls = canReview
        ? `
          <div class="mt-2 rounded-lg border border-white/10 bg-[#111827]/60 p-2 review-box" data-order-id="${escapeHTML(order.id)}" data-item-name="${escapeHTML(item.name || "")}" data-selected-rating="${existingRating}">
            <p class="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Rate this product</p>
            <div class="flex items-center gap-1 mb-2 review-stars">${starButtons}</div>
            <textarea class="review-comment w-full rounded-md border border-white/10 bg-[#0b0a0f] text-gray-200 text-xs p-2" rows="2" placeholder="Write a short review (optional)" ${isLocked ? "disabled" : ""}>${escapeHTML(existingComment)}</textarea>
            <div class="mt-2 flex items-center gap-2">
              <button type="button" class="review-submit-btn px-3 py-1.5 rounded-md bg-primary text-white text-xs font-bold ${isLocked ? "opacity-50 cursor-not-allowed" : ""}" ${isLocked ? "disabled" : ""}>
                ${existingRating > 0 ? (isLocked ? "Review Locked" : "Update Review") : "Submit Review"}
              </button>
              <span class="review-feedback text-xs ${isLocked ? "text-gray-500" : "text-gray-400"}">${isLocked ? "Editing allowed only within 7 days" : ""}</span>
            </div>
          </div>
        `
        : `
          <p class="mt-2 text-[11px] text-gray-500">Review can be submitted after payment confirmation.</p>
        `;

      return `
        <div class="flex items-center gap-3 rounded-lg border border-white/5 bg-accent-dark/60 p-3">
          <div class="h-14 w-14 rounded-md bg-card-dark border border-white/10 overflow-hidden shrink-0">
            <img src="${escapeHTML(imageSrc)}" alt="${escapeHTML(item.name || "Product")}" class="h-full w-full object-cover" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm text-white font-semibold truncate">${escapeHTML(item.name || "Product")}</p>
            <p class="text-xs text-gray-400">Qty: ${quantity} x ${escapeHTML(formatAmount(price))}</p>
            ${reviewControls}
          </div>
          <p class="text-xs sm:text-sm text-gray-200 font-semibold">${escapeHTML(formatAmount(price * quantity))}</p>
        </div>
      `;
    })
    .join("");

  const reorderDisabled = order.status.key === "pending" || order.status.key === "rejected";

  return `
    <div class="bg-card-dark border border-white/5 rounded-xl overflow-hidden hover:border-primary/30 transition-all group">
      <div class="p-5 md:p-6 flex flex-col lg:flex-row lg:items-center gap-6">
        <div class="flex flex-wrap gap-2 shrink-0 lg:max-w-[220px]">${allThumbnails}</div>

        <div class="flex-grow grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-8">
          <div>
            <p class="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1">Order Number</p>
            <p class="text-sm font-bold text-white">#${escapeHTML(order.id.slice(-8).toUpperCase())}</p>
          </div>
          <div>
            <p class="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1">Date Placed</p>
            <p class="text-sm font-medium">${escapeHTML(formatDate(order.createdAt))}</p>
          </div>
          <div>
            <p class="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1">Total Amount</p>
            <p class="text-sm font-bold text-white">${escapeHTML(formatAmount(order.totalAmount))}</p>
          </div>
          <div>
            <p class="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1">Status</p>
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide ${order.status.badgeClass}">
              <span class="h-1.5 w-1.5 rounded-full ${order.status.dotClass}"></span>
              ${escapeHTML(order.status.label)}
            </span>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-3 lg:border-l lg:border-white/5 lg:pl-6">
          <button class="flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-primary hover:bg-primary/90 rounded-lg transition-all ${reorderDisabled ? "opacity-50 cursor-not-allowed" : ""}" ${reorderDisabled ? "disabled" : ""}>
            <span class="material-symbols-outlined text-sm">refresh</span>
            Reorder
          </button>
          <button class="flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-accent-dark hover:bg-white/10 rounded-lg transition-all border border-white/5 invoice-download-btn" title="Download Invoice" type="button" data-order-id="${escapeHTML(order.id)}">
            <span class="material-symbols-outlined text-sm">download</span>
            Download Invoice
          </button>
          <span class="text-xs text-gray-400 font-medium">${escapeHTML(order.paymentMethod)}</span>
        </div>
      </div>

      <div class="px-5 md:px-6 pb-6">
        <div class="border-t border-white/5 pt-4">
          <p class="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-3">Items in this order (${order.items.length})</p>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            ${itemsDetails || '<p class="text-sm text-gray-400">No items available.</p>'}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderOrders() {
  const filteredOrders = getFilteredOrders();
  totalOrdersCount.textContent = String(allOrders.length);

  if (filteredOrders.length === 0) {
    renderEmptyState("No orders found for this filter.");
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  if (currentPage > totalPages) {
    currentPage = totalPages;
  }

  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, filteredOrders.length);
  const visibleOrders = filteredOrders.slice(startIndex, endIndex);

  ordersList.innerHTML = visibleOrders.map(createOrderCard).join("");
  ordersRangeText.textContent = `Showing ${startIndex + 1} to ${endIndex} of ${filteredOrders.length} orders`;
  renderPagination(totalPages);
}

function setupInteractions() {
  orderTabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      applyFilter(button.dataset.status || "all");
    });
  });

  orderFilterOptions.forEach((button) => {
    button.addEventListener("click", () => {
      applyFilter(button.dataset.status || "all");
    });
  });

  if (ordersFilterBtn) {
    ordersFilterBtn.setAttribute("aria-expanded", "false");
    ordersFilterBtn.addEventListener("click", () => {
      if (!ordersFilterMenu) {
        return;
      }

      if (ordersFilterMenu.classList.contains("hidden")) {
        openFilterMenu();
      } else {
        closeFilterMenu();
      }
    });
  }

  ordersPrevBtn.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage -= 1;
      renderOrders();
    }
  });

  ordersNextBtn.addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(getFilteredOrders().length / PAGE_SIZE));
    if (currentPage < totalPages) {
      currentPage += 1;
      renderOrders();
    }
  });

  ordersList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.closest(".review-box")) {
      markReviewInteraction();
    }

    const starButton = target.closest(".review-star-btn");
    if (starButton instanceof HTMLElement) {
      const reviewBox = starButton.closest(".review-box");
      if (!(reviewBox instanceof HTMLElement)) {
        return;
      }

      const selectedRating = Number(starButton.dataset.value || 0);
      reviewBox.dataset.selectedRating = String(selectedRating);
      reviewBox.querySelectorAll(".review-star-btn").forEach((button) => {
        const value = Number(button.getAttribute("data-value") || 0);
        button.classList.toggle("text-yellow-400", value <= selectedRating);
        button.classList.toggle("text-gray-500", value > selectedRating);
      });
      return;
    }

    const submitButton = target.closest(".review-submit-btn");
    if (submitButton instanceof HTMLElement) {
      const reviewBox = submitButton.closest(".review-box");
      if (!(reviewBox instanceof HTMLElement)) {
        return;
      }

      submitReviewFromBox(reviewBox);
      return;
    }

    const invoiceBtn = target.closest(".invoice-download-btn");
    if (!(invoiceBtn instanceof HTMLElement)) {
      return;
    }

    const orderId = invoiceBtn.dataset.orderId;
    if (!orderId) {
      return;
    }

    const order = getOrderById(orderId);
    if (!order) {
      alert("Order not found for invoice generation.");
      return;
    }

    downloadInvoiceForOrder(order);
  });

  ordersList.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.closest(".review-box")) {
      markReviewInteraction();
    }
  });

  ordersList.addEventListener("focusin", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.closest(".review-box")) {
      markReviewInteraction();
    }
  });

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLElement) || !ordersFilterMenu || !ordersFilterBtn) {
      return;
    }

    if (ordersFilterMenu.contains(event.target) || ordersFilterBtn.contains(event.target)) {
      return;
    }

    closeFilterMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeFilterMenu();
    }
  });

  syncFilterUI();
}

async function loadMyReviews(token) {
  try {
    const response = await fetch("http://localhost:5000/api/products/my-reviews", {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) {
      myReviewLookup = new Map();
      return;
    }

    const reviews = await response.json();
    const lookup = new Map();

    if (Array.isArray(reviews)) {
      reviews.forEach((review) => {
        lookup.set(
          buildReviewKey(review.orderId, review.productName),
          {
            rating: Number(review.rating || 0),
            comment: String(review.comment || ""),
            createdAt: review.createdAt
          }
        );
      });
    }

    myReviewLookup = lookup;
  } catch (error) {
    myReviewLookup = new Map();
  }
}

async function submitReviewFromBox(reviewBox) {
  const token = localStorage.getItem("token");
  if (!token) {
    return;
  }

  const feedbackEl = reviewBox.querySelector(".review-feedback");
  const submitBtn = reviewBox.querySelector(".review-submit-btn");
  const commentEl = reviewBox.querySelector(".review-comment");

  const orderId = String(reviewBox.dataset.orderId || "").trim();
  const itemName = String(reviewBox.dataset.itemName || "").trim();
  const rating = Number(reviewBox.dataset.selectedRating || 0);
  const comment = String(commentEl?.value || "").trim();

  if (!orderId || !itemName) {
    if (feedbackEl) feedbackEl.textContent = "Unable to identify product.";
    return;
  }

  if (!rating || rating < 1 || rating > 5) {
    if (feedbackEl) feedbackEl.textContent = "Select 1 to 5 stars first.";
    return;
  }

  if (submitBtn instanceof HTMLButtonElement) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Saving...";
  }
  reviewSubmitInFlight = true;
  markReviewInteraction(30000);
  if (feedbackEl) {
    feedbackEl.textContent = "";
  }

  try {
    const response = await fetch("http://localhost:5000/api/products/review", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        productName: itemName,
        orderId,
        rating,
        comment
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.message || "Failed to save review");
    }

    myReviewLookup.set(buildReviewKey(orderId, itemName), { rating, comment, createdAt: new Date().toISOString() });
    if (feedbackEl) {
      feedbackEl.classList.remove("text-red-400");
      feedbackEl.classList.add("text-green-400");
      feedbackEl.textContent = "Review saved";
    }
  } catch (error) {
    if (feedbackEl) {
      feedbackEl.classList.remove("text-green-400");
      feedbackEl.classList.add("text-red-400");
      feedbackEl.textContent = error?.message || "Could not save review";
    }
  } finally {
    reviewSubmitInFlight = false;
    markReviewInteraction(5000);
    if (submitBtn instanceof HTMLButtonElement) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Update Review";
    }
  }
}

async function loadOrders() {
  try {
    const token = localStorage.getItem("token");
    if (!token) {
      renderEmptyState("Please log in to view your orders.");
      return;
    }

    const res = await fetch("http://localhost:5000/api/orders", {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (res.status === 401) {
      renderEmptyState("Please log in to view your orders.");
      return;
    }

    const orders = await res.json();
    if (!Array.isArray(orders) || orders.length === 0) {
      renderEmptyState("No orders found.");
      return;
    }

    await loadMyReviews(token);

    allOrders = orders.map(normalizeOrder);
    renderOrders();

    const hasPendingPayment = allOrders.some((order) => order.paymentStatus === "pending");
    if (hasPendingPayment) {
      // Auto-refresh so webhook-updated payments reflect in order history without manual reload.
      scheduleOrdersRefresh(10000);
    } else if (ordersRefreshTimer) {
      clearTimeout(ordersRefreshTimer);
      ordersRefreshTimer = null;
    }
  } catch (error) {
    console.error("Error loading orders:", error);
    renderEmptyState("Error loading orders.");
  }
}

async function loadCurrentUserProfile() {
  try {
    const token = localStorage.getItem("token");
    if (!token) {
      return;
    }

    const res = await fetch("http://localhost:5000/api/auth/profile", {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      return;
    }

    const data = await res.json();
    currentUserProfile = data?.user || null;
  } catch (error) {
    console.error("Error loading profile for invoice:", error);
  }
}

setupInteractions();
loadCurrentUserProfile();
loadOrders();
