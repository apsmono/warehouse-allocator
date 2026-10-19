import {
  buildAllocationCurl,
  computeCostBreakdown,
  computeShippableStock,
  describeStockCell,
  findDuplicateMerges,
  formatExclusions,
  formatOrderSummary,
  formatProductDisplay,
  formatShortDecisionId,
  formatStatusHint,
  getWarehouseDecisionRole,
  splitWhyNot,
} from "./format.js";

const MAX_LINES = 20;
const DETAIL_STORAGE_KEY = "wa_detail_level";
const ORIENTATION_STORAGE_KEY = "wa_stock_orientation";
const VALID_DETAIL_LEVELS = new Set(["simple", "full", "debug"]);
const VALID_ORIENTATIONS = new Set(["products-rows", "warehouses-rows"]);

const EXAMPLE_ORDERS = {
  "example-g03": [{ productId: "P002", quantity: 10 }],
  "example-g09": [{ productId: "P005", quantity: 350 }],
  "example-g05": [{ productId: "P002", quantity: 120 }],
};

const state = {
  products: [],
  productsById: new Map(),
  warehouses: [],
  warehousesById: new Map(),
  lineRows: [],
  submitting: false,
  detailLevel: "full",
  stockOrientation: "products-rows",
  lastRequest: null,
  lastResponse: null,
  lastHttpStatus: null,
  modalOpeners: new WeakMap(),
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = String(text);
  }
  return node;
}

function readStoredPreference(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStoredPreference(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore when localStorage is blocked or unavailable
  }
}

function syncBodyModalLock() {
  const anyOpen = Boolean(document.querySelector("dialog[open]"));
  document.body.classList.toggle("modal-open", anyOpen);
}

function openModalDialog(dialogId, openerEl) {
  const dialog = document.getElementById(dialogId);
  if (!dialog || typeof dialog.showModal !== "function") {
    return;
  }
  const trigger =
    openerEl instanceof HTMLElement
      ? openerEl
      : document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  if (trigger) {
    state.modalOpeners.set(dialog, trigger);
  }
  if (!dialog.open) {
    dialog.showModal();
  }
  syncBodyModalLock();
}

function setupModalDialogs() {
  const dialogs = document.querySelectorAll("dialog.app-modal");
  for (const dialog of dialogs) {
    dialog.addEventListener("close", () => {
      syncBodyModalLock();
      const opener = state.modalOpeners.get(dialog);
      if (opener && opener.isConnected && typeof opener.focus === "function") {
        opener.focus();
      }
    });

    const closeButtons = dialog.querySelectorAll("[data-close-modal]");
    for (const btn of closeButtons) {
      btn.addEventListener("click", () => {
        dialog.close();
      });
    }

    // Light-dismiss backdrop click handler (covers browsers without <dialog closedby="any">
    // as well as direct clicks on the <dialog> backdrop outside .modal-surface)
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) {
        return;
      }
      const surface = dialog.querySelector(".modal-surface");
      if (surface && event.clientX !== 0 && event.clientY !== 0) {
        const rect = surface.getBoundingClientRect();
        const isInsideSurface =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width;
        if (isInsideSurface) {
          return;
        }
      }
      dialog.close();
    });
  }
}

function createWarehouseButton(warehouseId, extraClass = "") {
  const cls = extraClass ? `wh-link-btn ${extraClass}` : "wh-link-btn";
  const btn = el("button", cls, warehouseId);
  btn.type = "button";
  btn.setAttribute("data-warehouse-modal", warehouseId);
  btn.setAttribute("aria-label", `Inspect warehouse ${warehouseId}`);
  btn.addEventListener("click", () => {
    openWarehouseModal(warehouseId, btn);
  });
  return btn;
}

function openWarehouseModal(warehouseId, openerEl) {
  const warehouse = state.warehousesById.get(warehouseId);
  const titleEl = document.getElementById("warehouse-modal-title");
  const bodyEl = document.getElementById("warehouse-modal-body");
  if (!warehouse || !titleEl || !bodyEl) {
    return;
  }

  titleEl.textContent = `${warehouse.id} · ${warehouse.city} · ${warehouse.distanceKm} km`;

  const frag = document.createDocumentFragment();

  const capsRow = el("div", "wh-modal-caps");
  const storageSpan = el(
    "span",
    warehouse.hasColdStorage ? "cap-pill cap-yes" : "cap-pill cap-no",
    `Cold storage ${warehouse.hasColdStorage ? "✓" : "✗"}`,
  );
  const fleetSpan = el(
    "span",
    warehouse.hasColdFleet ? "cap-pill cap-yes" : "cap-pill cap-no",
    `Refrigerated vans ${warehouse.hasColdFleet ? "✓" : "✗"}`,
  );
  capsRow.append(storageSpan, fleetSpan);
  frag.appendChild(capsRow);

  const roleBox = el("div", "wh-modal-role-box");
  roleBox.appendChild(el("h3", "modal-sub-heading", "In this decision"));
  const roleInfo = getWarehouseDecisionRole(
    warehouse.id,
    state.lastResponse?.decision ?? null,
    state.warehouses,
  );
  const roleText = el("p", `wh-role-text wh-role-${roleInfo.role}`, roleInfo.summary);
  roleBox.appendChild(roleText);
  frag.appendChild(roleBox);

  frag.appendChild(el("h3", "modal-sub-heading", "Stock"));
  const { allocatedByKey } = getDecisionHighlightContext();
  const stockTable = el("table", "modal-stock-table");
  const thead = document.createElement("thead");
  const hRow = document.createElement("tr");
  const pTh = el("th", undefined, "Product");
  pTh.scope = "col";
  const qTh = el("th", "num-cell", "Quantity");
  qTh.scope = "col";
  hRow.append(pTh, qTh);
  thead.appendChild(hRow);

  const tbody = document.createElement("tbody");
  for (const product of state.products) {
    const tr = document.createElement("tr");
    const prodTh = el("th", undefined);
    prodTh.scope = "row";
    prodTh.appendChild(el("span", undefined, formatProductDisplay(product, product.id)));
    if (product.requiresColdChain) {
      prodTh.appendChild(document.createTextNode(" "));
      prodTh.appendChild(el("span", "cold-chain-badge", "❄ Cold"));
    }

    const alloc = allocatedByKey.get(`${warehouse.id}:${product.id}`) ?? 0;
    const cellDesc = describeStockCell(warehouse, product, alloc);
    const qtyTd = el("td", "num-cell");
    if (cellDesc.state === "zero") {
      qtyTd.appendChild(el("span", "stock-zero-dash", "—"));
    } else if (cellDesc.state === "ineligible-cold") {
      const strike = el("s", "stock-qty-ineligible", cellDesc.primaryText);
      const note = el("span", "stock-note-ineligible", ` ${cellDesc.secondaryText}`);
      qtyTd.append(strike, note);
    } else if (cellDesc.state === "allocated") {
      qtyTd.append(
        el("span", undefined, `${cellDesc.quantity} → `),
        el("strong", "stock-ships-badge", cellDesc.secondaryText),
      );
    } else {
      qtyTd.textContent = cellDesc.primaryText;
    }

    tr.append(prodTh, qtyTd);
    tbody.appendChild(tr);
  }
  stockTable.append(thead, tbody);
  frag.appendChild(stockTable);

  frag.appendChild(el("p", "modal-note", "Distances are from the customer location."));

  bodyEl.replaceChildren(frag);
  openModalDialog("warehouse-modal", openerEl);
}

async function openSavedDecisionModal(decisionId, openerEl) {
  const titleEl = document.getElementById("saved-decision-modal-title");
  const bodyEl = document.getElementById("saved-decision-modal-body");
  if (!decisionId || !titleEl || !bodyEl) {
    return;
  }

  const shortId = formatShortDecisionId(decisionId);
  titleEl.textContent = `Saved decision ${shortId}`;
  const jsonUrl = `/api/v1/allocations/${encodeURIComponent(decisionId)}`;

  const loadingP = el("p", "muted-text", "Loading stored decision…");
  bodyEl.replaceChildren(loadingP);
  openModalDialog("saved-decision-modal", openerEl);

  try {
    const res = await fetch(jsonUrl);
    const data = await res.json().catch(() => null);
    const frag = document.createDocumentFragment();

    if (res.ok && data) {
      if (data.createdAt) {
        frag.appendChild(el("p", "modal-meta-line", `Created ${data.createdAt}`));
      }
      frag.appendChild(el("pre", "raw-json-pre", JSON.stringify(data, null, 2)));
    } else if (state.lastResponse) {
      frag.appendChild(el("pre", "raw-json-pre", JSON.stringify(state.lastResponse, null, 2)));
    } else {
      frag.appendChild(el("p", "alert alert-error", "Could not load stored decision."));
    }

    const linkRow = el("p", "modal-link-row");
    const plainLink = el("a", "open-json-link", "Open as JSON ↗");
    plainLink.href = jsonUrl;
    plainLink.target = "_blank";
    plainLink.rel = "noopener";
    linkRow.appendChild(plainLink);
    frag.appendChild(linkRow);

    bodyEl.replaceChildren(frag);
  } catch {
    const frag = document.createDocumentFragment();
    frag.appendChild(el("p", "alert alert-error", "Could not reach the server."));
    const linkRow = el("p", "modal-link-row");
    const plainLink = el("a", "open-json-link", "Open as JSON ↗");
    plainLink.href = jsonUrl;
    linkRow.appendChild(plainLink);
    frag.appendChild(linkRow);
    bodyEl.replaceChildren(frag);
  }
}

function openApiCallModal(openerEl) {
  const bodyEl = document.getElementById("api-call-modal-body");
  if (!bodyEl) {
    return;
  }

  const reqPayload = state.lastRequest ?? { lines: [], options: { allowSplit: true } };
  const resPayload = state.lastResponse ?? {};
  const status = state.lastHttpStatus ?? 201;
  const curlCmd = buildAllocationCurl(window.location.origin, reqPayload);

  const frag = document.createDocumentFragment();
  frag.appendChild(el("p", "modal-endpoint-line", "POST /api/v1/allocations"));

  frag.appendChild(el("p", "sub-label", "Request"));
  const reqPre = el("pre", "raw-json-pre", JSON.stringify(reqPayload, null, 2));
  frag.appendChild(reqPre);

  frag.appendChild(el("p", "sub-label", `Response (${status})`));
  const resPre = el("pre", "raw-json-pre", JSON.stringify(resPayload, null, 2));
  frag.appendChild(resPre);

  const actionsRow = el("div", "debug-actions-row");
  const copyBtn = el("button", "btn btn-primary btn-sm", "Copy as curl");
  copyBtn.type = "button";
  const copyFeedback = el("span", "copy-feedback", "");
  copyFeedback.setAttribute("aria-live", "polite");

  copyBtn.addEventListener("click", () => {
    void copyTextToClipboard(curlCmd, reqPre).then((ok) => {
      copyFeedback.textContent = ok ? "Copied" : "Select and copy above";
    });
  });

  actionsRow.append(copyBtn, copyFeedback);
  frag.appendChild(actionsRow);

  bodyEl.replaceChildren(frag);
  openModalDialog("api-call-modal", openerEl);
}

function applyDetailLevel(level, persist = true) {
  const normalized = VALID_DETAIL_LEVELS.has(level) ? level : "full";
  state.detailLevel = normalized;

  const region = document.getElementById("result-region");
  if (region) {
    region.setAttribute("data-detail", normalized);
  }

  const buttons = document.querySelectorAll("[data-detail-level]");
  for (const btn of buttons) {
    const isMatch = btn.getAttribute("data-detail-level") === normalized;
    btn.classList.toggle("is-active", isMatch);
    btn.setAttribute("aria-pressed", String(isMatch));
  }

  if (persist) {
    writeStoredPreference(DETAIL_STORAGE_KEY, normalized);
  }
}

function focusAndScrollResultHeading() {
  if (document.querySelector("dialog[open]")) {
    return;
  }
  const heading = document.getElementById("result-heading");
  if (!heading) {
    return;
  }

  const prefersReducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  heading.focus({ preventScroll: true });
  if (typeof heading.scrollIntoView === "function") {
    heading.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "nearest",
    });
  }
}

function formatProductLabel(product) {
  return formatProductDisplay(product, product.id);
}

function getProductDisplay(productId) {
  const product = state.productsById.get(productId);
  return formatProductDisplay(product, productId);
}

function getDraftOrderLines() {
  return state.lineRows.map((row) => {
    const rawQty = row.qtyInput.value.trim();
    const parsed = rawQty === "" ? 0 : Number(rawQty);
    return {
      productId: row.select.value,
      quantity: Number.isNaN(parsed) ? 0 : parsed,
    };
  });
}

function updateRowProductMeta(row) {
  const productId = row.select.value;
  const stockInfo = computeShippableStock(productId, state.products, state.warehouses);
  row.coldBadge.hidden = !stockInfo.requiresColdChain;
  row.stockHint.textContent = stockInfo.text;
}

function updateOrderBuilderDerivedState() {
  const draftLines = getDraftOrderLines();

  const dupContainer = document.getElementById("duplicate-merge-hints");
  if (dupContainer) {
    const merges = findDuplicateMerges(draftLines);
    if (merges.length > 0) {
      const frag = document.createDocumentFragment();
      for (const m of merges) {
        frag.appendChild(el("p", "duplicate-hint-item", `ⓘ ${m.text}`));
      }
      dupContainer.replaceChildren(frag);
      dupContainer.hidden = false;
    } else {
      dupContainer.replaceChildren();
      dupContainer.hidden = true;
    }
  }

  const summaryEl = document.getElementById("order-running-summary");
  if (summaryEl) {
    const summary = formatOrderSummary(draftLines, state.products);
    summaryEl.textContent = summary.text;
  }
}

function updateLineControls() {
  const count = state.lineRows.length;
  const addBtn = document.getElementById("add-line-btn");
  const hint = document.getElementById("line-count-hint");

  if (addBtn) {
    addBtn.disabled = count >= MAX_LINES || state.submitting;
  }
  if (hint) {
    hint.textContent = `${count} of ${MAX_LINES} lines`;
  }

  for (let i = 0; i < count; i++) {
    const lineNum = i + 1;
    const row = state.lineRows[i];
    const productIdAttr = `line-product-${lineNum}`;
    const qtyIdAttr = `line-qty-${lineNum}`;
    const stockHintIdAttr = `line-stock-hint-${lineNum}`;

    row.productLabel.setAttribute("for", productIdAttr);
    row.productLabel.textContent = `Product, line ${lineNum}`;
    row.select.id = productIdAttr;
    row.select.name = `product-${lineNum}`;
    row.select.setAttribute("aria-label", `Product, line ${lineNum}`);

    row.qtyLabel.setAttribute("for", qtyIdAttr);
    row.qtyLabel.textContent = `Quantity, line ${lineNum}`;
    row.qtyInput.id = qtyIdAttr;
    row.qtyInput.name = `quantity-${lineNum}`;
    row.qtyInput.setAttribute("aria-label", `Quantity, line ${lineNum}`);
    row.qtyInput.setAttribute("aria-describedby", stockHintIdAttr);

    row.stockHint.id = stockHintIdAttr;

    row.removeBtn.setAttribute("aria-label", `Remove line ${lineNum}`);
    row.removeBtn.disabled = count <= 1 || state.submitting;

    updateRowProductMeta(row);
  }

  updateOrderBuilderDerivedState();
}

function addOrderLine(initialProductId, initialQuantity) {
  if (state.lineRows.length >= MAX_LINES) {
    return;
  }

  const container = document.getElementById("order-lines");
  if (!container) {
    return;
  }

  const rowEl = el("div", "order-line-row");

  const productGroup = el("div", "field-group product-field-group");
  const productHeader = el("div", "field-label-row");
  const productLabel = el("label");
  const coldBadge = el("span", "cold-chain-badge", "❄ Cold chain");
  coldBadge.hidden = true;
  productHeader.append(productLabel, coldBadge);

  const select = document.createElement("select");
  for (const product of state.products) {
    const option = document.createElement("option");
    option.value = product.id;
    option.textContent = formatProductLabel(product);
    select.appendChild(option);
  }

  if (initialProductId && state.productsById.has(initialProductId)) {
    select.value = initialProductId;
  } else if (state.products.length > 0) {
    select.value = state.products[0].id;
  }

  const stockHint = el("span", "line-stock-hint");
  productGroup.append(productHeader, select);

  const bottomRow = el("div", "line-bottom-row");
  const qtyGroup = el("div", "field-group qty-field-group");
  const qtyLabel = el("label");
  const qtyInput = document.createElement("input");
  qtyInput.type = "number";
  qtyInput.min = "1";
  qtyInput.max = "100000";
  qtyInput.step = "1";
  qtyInput.value = String(initialQuantity ?? 10);
  qtyGroup.append(qtyLabel, qtyInput);

  const removeBtn = el("button", "btn btn-remove", "Remove");
  removeBtn.type = "button";

  bottomRow.append(qtyGroup, stockHint, removeBtn);

  const rowRecord = {
    rowEl,
    productLabel,
    coldBadge,
    select,
    stockHint,
    qtyLabel,
    qtyInput,
    removeBtn,
  };

  select.addEventListener("change", () => {
    updateRowProductMeta(rowRecord);
    updateOrderBuilderDerivedState();
  });

  qtyInput.addEventListener("input", () => {
    updateOrderBuilderDerivedState();
  });

  removeBtn.addEventListener("click", () => {
    if (state.lineRows.length <= 1) {
      return;
    }
    const idx = state.lineRows.indexOf(rowRecord);
    if (idx !== -1) {
      state.lineRows.splice(idx, 1);
      rowEl.remove();
      updateLineControls();
    }
  });

  rowEl.append(productGroup, bottomRow);
  container.appendChild(rowEl);
  state.lineRows.push(rowRecord);
  updateLineControls();
}

function setOrderLines(lines) {
  const container = document.getElementById("order-lines");
  if (!container) {
    return;
  }
  container.replaceChildren();
  state.lineRows = [];

  for (const line of lines) {
    addOrderLine(line.productId, line.quantity);
  }
}

function applyStockOrientation(orientation, persist = true) {
  const normalized = VALID_ORIENTATIONS.has(orientation) ? orientation : "products-rows";
  state.stockOrientation = normalized;

  const toggleBtn = document.getElementById("stock-orientation-btn");
  if (toggleBtn) {
    toggleBtn.textContent =
      normalized === "products-rows" ? "Products × Warehouses ⇄" : "Warehouses × Products ⇄";
  }

  if (persist) {
    writeStoredPreference(ORIENTATION_STORAGE_KEY, normalized);
  }

  if (state.products.length > 0 && state.warehouses.length > 0) {
    renderStockTable(state.products, state.warehouses);
  }
}

function getDecisionHighlightContext() {
  const orderedProductIds = new Set();
  const chosenWarehouseIds = new Set();
  const allocatedByKey = new Map();

  const decision = state.lastResponse?.decision;
  if (decision && state.lastRequest && Array.isArray(state.lastRequest.lines)) {
    for (const line of state.lastRequest.lines) {
      if (line && line.productId) {
        orderedProductIds.add(line.productId);
      }
    }
  }

  if (decision && Array.isArray(decision.shipments)) {
    for (const shipment of decision.shipments) {
      chosenWarehouseIds.add(shipment.warehouseId);
      for (const item of shipment.items || []) {
        orderedProductIds.add(item.productId);
        const key = `${shipment.warehouseId}:${item.productId}`;
        allocatedByKey.set(key, (allocatedByKey.get(key) ?? 0) + item.quantity);
      }
    }
  }

  return { orderedProductIds, chosenWarehouseIds, allocatedByKey };
}

function renderStockDataCell(warehouse, product, allocatedQty, isOrderedProd, isChosenWh) {
  const desc = describeStockCell(warehouse, product, allocatedQty);
  const classes = ["num-cell", "stock-data-cell"];
  if (isOrderedProd) {
    classes.push("is-ordered-product");
  }
  if (isChosenWh) {
    classes.push("is-chosen-warehouse");
  }
  if (desc.state === "allocated") {
    classes.push("is-allocated-cell");
  } else if (desc.state === "zero") {
    classes.push("is-zero-cell");
  } else if (desc.state === "ineligible-cold") {
    classes.push("is-ineligible-cell");
  }

  const td = el("td", classes.join(" "));
  td.setAttribute("data-warehouse-id", warehouse.id);
  td.setAttribute("data-product-id", product.id);
  td.setAttribute("data-cell-state", desc.state);

  if (desc.state === "zero") {
    td.appendChild(el("span", "stock-zero-dash", "—"));
  } else if (desc.state === "ineligible-cold") {
    const cellStack = el("div", "stock-cell-stack");
    const strikeEl = el("s", "stock-qty-ineligible", desc.primaryText);
    const noteEl = el("span", "stock-note-ineligible", desc.secondaryText);
    cellStack.append(strikeEl, document.createTextNode(" "), noteEl);
    td.appendChild(cellStack);
  } else if (desc.state === "allocated") {
    const cellStack = el("div", "stock-cell-stack");
    const qtySpan = el("span", "stock-qty-allocated", `${desc.quantity} → `);
    const shipsBadge = el("strong", "stock-ships-badge", desc.secondaryText);
    cellStack.append(qtySpan, shipsBadge);
    td.appendChild(cellStack);
  } else {
    td.textContent = desc.primaryText;
  }

  return td;
}

function renderStockTable(products, warehouses) {
  const wrapper = document.getElementById("stock-table-wrapper");
  if (!wrapper) {
    return;
  }

  const { orderedProductIds, chosenWarehouseIds, allocatedByKey } = getDecisionHighlightContext();
  const table = el("table", "stock-reference-table");
  table.setAttribute("data-orientation", state.stockOrientation);

  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");

  if (state.stockOrientation === "products-rows") {
    const headerRow = document.createElement("tr");
    const cornerTh = el("th", "sticky-col", "Product");
    cornerTh.scope = "col";
    headerRow.appendChild(cornerTh);

    for (const warehouse of warehouses) {
      const isChosen = chosenWarehouseIds.has(warehouse.id);
      const thClass = isChosen ? "wh-col-header is-chosen-warehouse" : "wh-col-header";
      const th = el("th", thClass);
      th.scope = "col";
      th.setAttribute("data-warehouse-id", warehouse.id);
      if (isChosen) {
        th.setAttribute("data-chosen", "true");
      }

      const idLine = el("div", "wh-header-id");
      idLine.appendChild(createWarehouseButton(warehouse.id, "wh-header-btn"));
      const metaLine = el(
        "div",
        "wh-header-meta",
        `${warehouse.city} · ${warehouse.distanceKm} km`,
      );
      const capsLine = el(
        "div",
        "wh-header-caps",
        `${warehouse.hasColdStorage ? "✓cold" : "✗cold"} ${warehouse.hasColdFleet ? "✓van" : "✗van"}`,
      );
      capsLine.title = `Cold storage: ${warehouse.hasColdStorage ? "Yes" : "No"}, Refrigerated vans: ${warehouse.hasColdFleet ? "Yes" : "No"}`;

      th.append(idLine, metaLine, capsLine);
      headerRow.appendChild(th);
    }

    thead.appendChild(headerRow);

    for (const product of products) {
      const isOrdered = orderedProductIds.has(product.id);
      const tr = el("tr", isOrdered ? "is-ordered-product" : undefined);
      tr.setAttribute("data-product-id", product.id);
      if (isOrdered) {
        tr.setAttribute("data-ordered", "true");
      }

      const prodTh = el("th", "sticky-col prod-row-header");
      prodTh.scope = "row";
      const prodHeaderInner = el("div", "prod-row-header-inner");
      prodHeaderInner.appendChild(
        el("span", "prod-row-title", formatProductDisplay(product, product.id)),
      );
      if (product.requiresColdChain) {
        prodHeaderInner.appendChild(el("span", "cold-chain-badge", "❄ Cold"));
      }
      prodTh.appendChild(prodHeaderInner);
      tr.appendChild(prodTh);

      for (const warehouse of warehouses) {
        const isChosen = chosenWarehouseIds.has(warehouse.id);
        const alloc = allocatedByKey.get(`${warehouse.id}:${product.id}`) ?? 0;
        tr.appendChild(renderStockDataCell(warehouse, product, alloc, isOrdered, isChosen));
      }

      tbody.appendChild(tr);
    }
  } else {
    const headerRow = document.createElement("tr");
    const fixedHeaders = ["Warehouse", "City", "Distance", "Cold chain"];
    for (let i = 0; i < fixedHeaders.length; i++) {
      const th = el("th", i === 0 ? "sticky-col" : undefined, fixedHeaders[i]);
      th.scope = "col";
      headerRow.appendChild(th);
    }

    for (const product of products) {
      const isOrdered = orderedProductIds.has(product.id);
      const thClass = isOrdered ? "num-cell is-ordered-product" : "num-cell";
      const th = el("th", thClass);
      th.scope = "col";
      th.setAttribute("data-product-id", product.id);
      const titleDiv = el("div", "prod-col-title", formatProductDisplay(product, product.id));
      th.appendChild(titleDiv);
      if (product.requiresColdChain) {
        th.appendChild(el("span", "cold-chain-badge", "❄ Cold"));
      }
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);

    for (const warehouse of warehouses) {
      const isChosen = chosenWarehouseIds.has(warehouse.id);
      const tr = el("tr", isChosen ? "is-chosen-warehouse" : undefined);
      tr.setAttribute("data-warehouse-id", warehouse.id);
      if (isChosen) {
        tr.setAttribute("data-chosen", "true");
      }

      const idTh = el("th", "sticky-col");
      idTh.scope = "row";
      idTh.appendChild(createWarehouseButton(warehouse.id, "wh-header-btn"));
      tr.appendChild(idTh);

      tr.appendChild(el("td", undefined, warehouse.city));
      tr.appendChild(el("td", "num-cell", `${warehouse.distanceKm} km`));
      tr.appendChild(
        el(
          "td",
          "wh-header-caps",
          `${warehouse.hasColdStorage ? "✓cold" : "✗cold"} ${warehouse.hasColdFleet ? "✓van" : "✗van"}`,
        ),
      );

      for (const product of products) {
        const isOrdered = orderedProductIds.has(product.id);
        const alloc = allocatedByKey.get(`${warehouse.id}:${product.id}`) ?? 0;
        tr.appendChild(renderStockDataCell(warehouse, product, alloc, isOrdered, isChosen));
      }

      tbody.appendChild(tr);
    }
  }

  table.append(thead, tbody);
  wrapper.replaceChildren(table);
}

function renderValidationError(details, fallbackMessage) {
  const container = document.getElementById("result-content");
  if (!container) {
    return;
  }

  const alertBox = el("div", "alert alert-error");
  const title = el("strong", undefined, fallbackMessage || "Order is invalid");
  alertBox.appendChild(title);

  if (Array.isArray(details) && details.length > 0) {
    const list = el("ul", "error-list");
    for (const item of details) {
      const pathText = item.path ? `${item.path}: ${item.message}` : String(item.message);
      list.appendChild(el("li", undefined, pathText));
    }
    alertBox.appendChild(list);
  }

  container.replaceChildren(alertBox);
  focusAndScrollResultHeading();
}

function renderErrorMessage(message) {
  const container = document.getElementById("result-content");
  if (!container) {
    return;
  }
  const alertBox = el("div", "alert alert-error", message);
  container.replaceChildren(alertBox);
  focusAndScrollResultHeading();
}

function createTableScrollWrapper(table, ariaLabel) {
  const wrapper = el("div", "table-scroll");
  wrapper.tabIndex = 0;
  wrapper.setAttribute("role", "region");
  wrapper.setAttribute("aria-label", ariaLabel);
  wrapper.appendChild(table);
  return wrapper;
}

function buildShipmentsTable(shipments) {
  const table = el("table", "responsive-table shipments-table");
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  for (const col of ["Warehouse", "City", "Distance", "Items"]) {
    const th = el("th", undefined, col);
    th.scope = "col";
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const shipment of shipments) {
    const tr = document.createElement("tr");
    const whTh = el("th", undefined);
    whTh.scope = "row";
    whTh.setAttribute("data-label", "Warehouse");
    whTh.appendChild(createWarehouseButton(shipment.warehouseId));
    tr.appendChild(whTh);

    const cityTd = el("td", undefined, shipment.city);
    cityTd.setAttribute("data-label", "City");
    tr.appendChild(cityTd);

    const distTd = el("td", "num-cell", `${shipment.distanceKm} km`);
    distTd.setAttribute("data-label", "Distance");
    tr.appendChild(distTd);

    const itemsText = (shipment.items || [])
      .map((item) => `${getProductDisplay(item.productId)} × ${item.quantity}`)
      .join(", ");
    const itemsTd = el("td", undefined, itemsText);
    itemsTd.setAttribute("data-label", "Items");
    tr.appendChild(itemsTd);

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  return createTableScrollWrapper(table, "Allocated shipments");
}

function buildShortfallsTable(shortfalls) {
  const table = el("table", "responsive-table shortfalls-table");
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  for (const col of ["Product", "Requested", "Allocated", "Missing", "Reason"]) {
    const th = el("th", undefined, col);
    th.scope = "col";
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const sf of shortfalls) {
    const tr = document.createElement("tr");
    const prodTh = el("th", undefined, getProductDisplay(sf.productId));
    prodTh.scope = "row";
    prodTh.setAttribute("data-label", "Product");
    tr.appendChild(prodTh);

    const reqTd = el("td", "num-cell", String(sf.requested));
    reqTd.setAttribute("data-label", "Requested");
    tr.appendChild(reqTd);

    const allocTd = el("td", "num-cell", String(sf.allocated));
    allocTd.setAttribute("data-label", "Allocated");
    tr.appendChild(allocTd);

    const missTd = el("td", "num-cell", String(sf.missing));
    missTd.setAttribute("data-label", "Missing");
    tr.appendChild(missTd);

    const reasonTd = el("td", undefined, sf.reason);
    reasonTd.setAttribute("data-label", "Reason");
    tr.appendChild(reasonTd);

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  return createTableScrollWrapper(table, "Order shortfalls");
}

function buildExclusionsTable(excluded) {
  const rows = formatExclusions(excluded, state.warehouses);
  const table = el("table", "responsive-table exclusions-table");
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  for (const col of ["Warehouse", "Holds", "Why it can't ship"]) {
    const th = el("th", undefined, col);
    th.scope = "col";
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");

    const whTh = el("th", undefined);
    whTh.scope = "row";
    whTh.setAttribute("data-label", "Warehouse");
    whTh.appendChild(createWarehouseButton(row.warehouseId));
    tr.appendChild(whTh);

    const holdsTd = el("td", undefined, `${row.holdsText} (${row.productId})`);
    holdsTd.setAttribute("data-label", "Holds");
    tr.appendChild(holdsTd);

    const whyTd = el("td", undefined);
    whyTd.setAttribute("data-label", "Why it can't ship");
    const badge = el("span", "exclusion-badge", row.reasonLabel);
    badge.title = row.code;
    whyTd.appendChild(badge);
    tr.appendChild(whyTd);

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  return createTableScrollWrapper(table, "Excluded warehouses");
}

function buildAlternativesTable(alternatives, costUnit) {
  const table = el("table", "responsive-table alternatives-table");
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  for (const col of ["Warehouses", "Units filled", "Total cost", "Delta", "Why not"]) {
    const th = el("th", undefined, col);
    th.scope = "col";
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const alt of alternatives) {
    const tr = document.createElement("tr");
    const whTh = el("th", undefined);
    whTh.scope = "row";
    whTh.setAttribute("data-label", "Warehouses");
    const whIds = alt.warehouses || [];
    for (let i = 0; i < whIds.length; i++) {
      if (i > 0) {
        whTh.appendChild(document.createTextNode(" + "));
      }
      whTh.appendChild(createWarehouseButton(whIds[i]));
    }
    tr.appendChild(whTh);

    const unitsTd = el("td", "num-cell", String(alt.unitsFilled));
    unitsTd.setAttribute("data-label", "Units filled");
    tr.appendChild(unitsTd);

    const costTd = el("td", "num-cell", `${alt.totalCost} ${costUnit}`);
    costTd.setAttribute("data-label", "Total cost");
    tr.appendChild(costTd);

    const sign = alt.delta >= 0 ? "+" : "";
    const deltaTd = el("td", "num-cell", `${sign}${alt.delta} ${costUnit}`);
    deltaTd.setAttribute("data-label", "Delta");
    tr.appendChild(deltaTd);

    const whyNotTd = el("td", undefined, splitWhyNot(alt.whyNot));
    whyNotTd.setAttribute("data-label", "Why not");
    tr.appendChild(whyNotTd);

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  return createTableScrollWrapper(table, "Alternative warehouse combinations");
}

async function copyTextToClipboard(text, fallbackPre) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to selection fallback
    }
  }
  if (fallbackPre && typeof window.getSelection === "function") {
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(fallbackPre);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    }
  }
  return false;
}

function renderDecisionResponse(payload) {
  const container = document.getElementById("result-content");
  if (!container) {
    return;
  }

  const decision = payload.decision;
  const fragment = document.createDocumentFragment();

  // 1. Core decision block (shown at Simple, Full, Debug)
  const coreBlock = el("div", "decision-core");

  const banner = el("div", "decision-banner");
  const badge = el("span", `status-badge status-${decision.status}`, decision.status);
  const statusHint = el("span", "status-hint", formatStatusHint(decision));
  banner.append(badge, statusHint);
  coreBlock.appendChild(banner);

  const summary = el("p", "decision-summary", decision.summary);
  coreBlock.appendChild(summary);

  const breakdown = computeCostBreakdown(decision);
  const costLine = el("p", "decision-cost");
  costLine.appendChild(document.createTextNode("Cost "));
  const totalStrong = el("strong", undefined, `${breakdown.computedTotal} ${breakdown.costUnit}`);
  costLine.appendChild(totalStrong);
  if (breakdown.shipmentCount > 0) {
    costLine.appendChild(document.createTextNode(` = ${breakdown.formulaRightSide}`));
  }
  coreBlock.appendChild(costLine);

  coreBlock.appendChild(el("h3", undefined, "Shipments"));
  if (Array.isArray(decision.shipments) && decision.shipments.length > 0) {
    coreBlock.appendChild(buildShipmentsTable(decision.shipments));
  } else {
    coreBlock.appendChild(el("p", "muted-text", "No shipments allocated."));
  }

  if (Array.isArray(decision.shortfalls) && decision.shortfalls.length > 0) {
    coreBlock.appendChild(el("h3", undefined, "Shortfalls"));
    coreBlock.appendChild(buildShortfallsTable(decision.shortfalls));
  }

  fragment.appendChild(coreBlock);

  // 2. Explanation block ("Why", shown at Full and Debug)
  const whyBlock = el("div", "decision-why detail-full-only");

  whyBlock.appendChild(el("h3", undefined, "Why this choice"));
  if (Array.isArray(decision.reasons) && decision.reasons.length > 0) {
    const reasonsList = el("ul", "reasons-list");
    for (const reason of decision.reasons) {
      reasonsList.appendChild(el("li", undefined, reason));
    }
    whyBlock.appendChild(reasonsList);
  } else {
    whyBlock.appendChild(el("p", "muted-text", "No additional reasons recorded."));
  }

  whyBlock.appendChild(el("h3", undefined, "Why not the others"));
  if (Array.isArray(decision.excluded) && decision.excluded.length > 0) {
    const cantShipLabel = el("p", "sub-label", "Can't ship:");
    whyBlock.append(cantShipLabel, buildExclusionsTable(decision.excluded));
  } else {
    whyBlock.appendChild(
      el("p", "muted-text", "No stocked warehouses were excluded by cold-chain rules."),
    );
  }

  if (Array.isArray(decision.alternatives) && decision.alternatives.length > 0) {
    const altLabel = el("p", "sub-label", "Alternatives:");
    whyBlock.append(altLabel, buildAlternativesTable(decision.alternatives, decision.costUnit));
  } else {
    whyBlock.appendChild(el("p", "muted-text", "No alternative warehouse combinations available."));
  }

  fragment.appendChild(whyBlock);

  // 3. Meta + Debug footer block
  const metaBlock = el("div", "decision-meta-block");

  const savedLine = el("p", "decision-meta-line detail-full-only");
  if (payload.id) {
    const shortId = formatShortDecisionId(payload.id);
    savedLine.appendChild(document.createTextNode("Saved as decision "));
    const codeEl = el("code", "decision-short-id", shortId);
    savedLine.appendChild(codeEl);
    savedLine.appendChild(document.createTextNode(" · "));
    const viewBtn = el("button", "link-btn view-json-btn", "view JSON");
    viewBtn.type = "button";
    viewBtn.id = "view-saved-json-btn";
    viewBtn.addEventListener("click", () => {
      void openSavedDecisionModal(payload.id, viewBtn);
    });
    savedLine.appendChild(viewBtn);
  } else {
    savedLine.textContent = "Saved as decision: not persisted (database unavailable)";
  }
  metaBlock.appendChild(savedLine);

  const debugPanel = el("div", "debug-panel detail-debug-only");
  const debugMeta = el(
    "p",
    "debug-meta-line",
    `Evaluated combinations ${decision.meta.evaluatedCombinations} · overhead ${decision.meta.shipmentOverhead} ${decision.costUnit} · engine ${decision.meta.engineVersion}`,
  );
  debugPanel.appendChild(debugMeta);

  const reqPayload = state.lastRequest ?? { lines: [], options: { allowSplit: true } };
  const curlCmd = buildAllocationCurl(window.location.origin, reqPayload);

  const debugActionsRow = el("div", "debug-actions-row");
  const apiCallBtn = el("button", "btn btn-outline btn-sm", "API call");
  apiCallBtn.type = "button";
  apiCallBtn.id = "open-api-call-btn";
  apiCallBtn.addEventListener("click", () => {
    openApiCallModal(apiCallBtn);
  });

  const inlineCopyBtn = el("button", "btn btn-outline btn-sm", "Copy as curl");
  inlineCopyBtn.type = "button";
  const inlineCopyStatus = el("span", "copy-feedback", "");
  inlineCopyStatus.setAttribute("aria-live", "polite");

  const inlineJsonDetails = el("details", "raw-json-details");
  const inlineJsonSummary = el("summary", undefined, "Request & response JSON");
  const inlineReqPre = el("pre", "raw-json-pre", JSON.stringify(reqPayload, null, 2));
  const inlineResPre = el("pre", "raw-json-pre", JSON.stringify(payload, null, 2));
  inlineJsonDetails.append(
    inlineJsonSummary,
    el("p", "sub-label", "Request JSON"),
    inlineReqPre,
    el("p", "sub-label", "Response JSON"),
    inlineResPre,
  );

  inlineCopyBtn.addEventListener("click", () => {
    void copyTextToClipboard(curlCmd, inlineReqPre).then((ok) => {
      inlineCopyStatus.textContent = ok ? "Copied" : "Open API call to copy";
    });
  });

  debugActionsRow.append(apiCallBtn, inlineCopyBtn, inlineCopyStatus);
  debugPanel.append(debugActionsRow, inlineJsonDetails);

  metaBlock.appendChild(debugPanel);
  fragment.appendChild(metaBlock);

  container.replaceChildren(fragment);
  if (state.products.length > 0 && state.warehouses.length > 0) {
    renderStockTable(state.products, state.warehouses);
  }
  focusAndScrollResultHeading();
}

function setSubmittingState(isSubmitting) {
  state.submitting = isSubmitting;
  const form = document.getElementById("order-form");
  if (form) {
    form.setAttribute("aria-busy", String(isSubmitting));
  }
  const submitBtn = document.getElementById("submit-btn");
  if (submitBtn) {
    submitBtn.disabled = isSubmitting;
    submitBtn.setAttribute("aria-busy", String(isSubmitting));
    submitBtn.textContent = isSubmitting ? "Allocating…" : "Allocate order";
  }

  for (const btnId of Object.keys(EXAMPLE_ORDERS)) {
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.disabled = isSubmitting || state.products.length === 0;
    }
  }

  updateLineControls();
}

async function submitCurrentOrder() {
  if (state.submitting) {
    return;
  }

  const allowSplitInput = document.getElementById("allow-split-input");
  const allowSplit = allowSplitInput ? Boolean(allowSplitInput.checked) : true;

  const lines = state.lineRows.map((row) => {
    const rawQty = row.qtyInput.value.trim();
    const parsed = rawQty === "" ? 0 : Number(rawQty);
    return {
      productId: row.select.value,
      quantity: Number.isNaN(parsed) ? rawQty : parsed,
    };
  });

  const requestBody = {
    lines,
    options: { allowSplit },
  };
  state.lastRequest = requestBody;

  setSubmittingState(true);
  try {
    const res = await fetch("/api/v1/allocations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    state.lastHttpStatus = res.status;
    const body = await res.json().catch(() => null);

    if (res.status === 200 || res.status === 201) {
      if (body && body.decision) {
        state.lastResponse = body;
        renderDecisionResponse(body);
      } else {
        renderErrorMessage("Received an unexpected response from the server.");
      }
      return;
    }

    if (res.status === 422) {
      const details = body && body.error ? body.error.details : [];
      const msg = body && body.error ? body.error.message : "Order is invalid";
      renderValidationError(details, msg);
      return;
    }

    const apiMessage =
      body && body.error && body.error.message
        ? body.error.message
        : `Request failed (${res.status})`;
    renderErrorMessage(apiMessage);
  } catch {
    renderErrorMessage("Could not reach the server");
  } finally {
    setSubmittingState(false);
  }
}

async function loadCatalog() {
  const errorBanner = document.getElementById("catalog-error");
  const form = document.getElementById("order-form");
  const stockWrapper = document.getElementById("stock-table-wrapper");

  try {
    const res = await fetch("/api/v1/catalog");
    const body = await res.json().catch(() => null);

    if (!res.ok || !body || !Array.isArray(body.products) || !Array.isArray(body.warehouses)) {
      const errMsg =
        body && body.error && body.error.message
          ? body.error.message
          : "Could not load the product and warehouse catalogue.";
      throw new Error(errMsg);
    }

    state.products = body.products;
    state.productsById = new Map(body.products.map((p) => [p.id, p]));
    state.warehouses = body.warehouses;
    state.warehousesById = new Map(body.warehouses.map((w) => [w.id, w]));

    if (errorBanner) {
      errorBanner.hidden = true;
    }
    if (form) {
      form.hidden = false;
    }

    setOrderLines([{ productId: body.products[0]?.id ?? "P001", quantity: 10 }]);
    renderStockTable(body.products, body.warehouses);
    setSubmittingState(false);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Catalogue unavailable";
    if (errorBanner) {
      errorBanner.textContent = `Catalogue unavailable: ${detail}`;
      errorBanner.hidden = false;
    }
    if (form) {
      form.hidden = true;
    }
    if (stockWrapper) {
      stockWrapper.replaceChildren(
        el("p", "muted-text", `Stock reference unavailable (${detail}).`),
      );
    }
    for (const btnId of Object.keys(EXAMPLE_ORDERS)) {
      const btn = document.getElementById(btnId);
      if (btn) {
        btn.disabled = true;
      }
    }
  }
}

async function loadHealth() {
  const statusSpan =
    document.getElementById("health-status-text") ?? document.getElementById("health-footer");
  if (!statusSpan) {
    return;
  }

  try {
    const res = await fetch("/api/v1/health");
    const body = await res.json().catch(() => null);

    if (body && body.version && body.engineVersion && body.commit) {
      const baseText = `App v${body.version} · Engine v${body.engineVersion} · Commit ${body.commit}`;
      if (res.status === 503 || body.db !== "ok") {
        statusSpan.textContent = `${baseText} · database unreachable`;
      } else {
        statusSpan.textContent = baseText;
      }
      return;
    }

    statusSpan.textContent =
      res.status === 503 ? "Service degraded · database unreachable" : "Health status unavailable";
  } catch {
    statusSpan.textContent = "Could not reach the server · database unreachable";
  }
}

function init() {
  setupModalDialogs();

  const howBtn = document.getElementById("how-it-decides-btn");
  if (howBtn) {
    howBtn.addEventListener("click", () => {
      openModalDialog("rules-modal", howBtn);
    });
  }

  const storedDetail = readStoredPreference(DETAIL_STORAGE_KEY, "full");
  applyDetailLevel(storedDetail, false);

  const storedOrientation = readStoredPreference(ORIENTATION_STORAGE_KEY, "products-rows");
  applyStockOrientation(storedOrientation, false);

  const detailButtons = document.querySelectorAll("[data-detail-level]");
  for (const btn of detailButtons) {
    btn.addEventListener("click", () => {
      const targetLevel = btn.getAttribute("data-detail-level") || "full";
      applyDetailLevel(targetLevel, true);
    });
  }

  const orientationBtn = document.getElementById("stock-orientation-btn");
  if (orientationBtn) {
    orientationBtn.addEventListener("click", () => {
      const next = state.stockOrientation === "products-rows" ? "warehouses-rows" : "products-rows";
      applyStockOrientation(next, true);
    });
  }

  const form = document.getElementById("order-form");
  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void submitCurrentOrder();
    });
  }

  const addLineBtn = document.getElementById("add-line-btn");
  if (addLineBtn) {
    addLineBtn.addEventListener("click", () => {
      const defaultProd = state.products[0]?.id ?? "P001";
      addOrderLine(defaultProd, 10);
    });
  }

  for (const [btnId, lines] of Object.entries(EXAMPLE_ORDERS)) {
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.addEventListener("click", () => {
        if (state.products.length === 0 || state.submitting) {
          return;
        }
        const allowSplitInput = document.getElementById("allow-split-input");
        if (allowSplitInput) {
          allowSplitInput.checked = true;
        }
        setOrderLines(lines);
        void submitCurrentOrder();
      });
    }
  }

  void loadCatalog();
  void loadHealth();
}

init();
