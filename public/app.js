const MAX_LINES = 20;

const EXAMPLE_ORDERS = {
  "example-g03": [{ productId: "P002", quantity: 10 }],
  "example-g09": [{ productId: "P005", quantity: 350 }],
  "example-g05": [{ productId: "P002", quantity: 120 }],
};

const state = {
  products: [],
  productsById: new Map(),
  warehouses: [],
  lineRows: [],
  submitting: false,
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

function formatProductLabel(product) {
  return product.requiresColdChain
    ? `${product.id} — ${product.name} [Cold]`
    : `${product.id} — ${product.name}`;
}

function getProductName(productId) {
  const product = state.productsById.get(productId);
  return product ? product.name : productId;
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

    row.removeBtn.setAttribute("aria-label", `Remove line ${lineNum}`);
    row.removeBtn.disabled = count <= 1 || state.submitting;
  }
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

  const productGroup = el("div", "field-group");
  const productLabel = el("label");
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

  productGroup.append(productLabel, select);

  const qtyGroup = el("div", "field-group");
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

  const rowRecord = {
    rowEl,
    productLabel,
    select,
    qtyLabel,
    qtyInput,
    removeBtn,
  };

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

  rowEl.append(productGroup, qtyGroup, removeBtn);
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

function renderStockTable(products, warehouses) {
  const wrapper = document.getElementById("stock-table-wrapper");
  if (!wrapper) {
    return;
  }

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  const fixedHeaders = ["Warehouse", "City", "Distance", "Cold storage", "Cold fleet"];
  for (const title of fixedHeaders) {
    const th = el("th", undefined, title);
    th.scope = "col";
    headerRow.appendChild(th);
  }

  for (const product of products) {
    const label = product.requiresColdChain
      ? `${product.id} (${product.name}) [Cold]`
      : `${product.id} (${product.name})`;
    const th = el("th", "num-cell", label);
    th.scope = "col";
    headerRow.appendChild(th);
  }

  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const warehouse of warehouses) {
    const tr = document.createElement("tr");

    const idTh = el("th", undefined, warehouse.id);
    idTh.scope = "row";
    tr.appendChild(idTh);

    tr.appendChild(el("td", undefined, warehouse.city));
    tr.appendChild(el("td", "num-cell", `${warehouse.distanceKm} km`));
    tr.appendChild(el("td", undefined, warehouse.hasColdStorage ? "Yes" : "No"));
    tr.appendChild(el("td", undefined, warehouse.hasColdFleet ? "Yes" : "No"));

    const stockMap = new Map();
    if (Array.isArray(warehouse.stock)) {
      for (const item of warehouse.stock) {
        stockMap.set(item.productId, item.quantity);
      }
    }

    for (const product of products) {
      const qty = stockMap.get(product.id) ?? 0;
      tr.appendChild(el("td", "num-cell", String(qty)));
    }

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
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
}

function renderErrorMessage(message) {
  const container = document.getElementById("result-content");
  if (!container) {
    return;
  }
  const alertBox = el("div", "alert alert-error", message);
  container.replaceChildren(alertBox);
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
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  for (const col of ["Warehouse", "City", "Distance (km)", "Items"]) {
    const th = el("th", undefined, col);
    th.scope = "col";
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const shipment of shipments) {
    const tr = document.createElement("tr");
    const whTh = el("th", undefined, shipment.warehouseId);
    whTh.scope = "row";
    tr.appendChild(whTh);

    tr.appendChild(el("td", undefined, shipment.city));
    tr.appendChild(el("td", "num-cell", `${shipment.distanceKm} km`));

    const itemsText = (shipment.items || [])
      .map((item) => `${getProductName(item.productId)} × ${item.quantity}`)
      .join(", ");
    tr.appendChild(el("td", undefined, itemsText));

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  return createTableScrollWrapper(table, "Allocated shipments");
}

function buildShortfallsTable(shortfalls) {
  const table = document.createElement("table");
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
    const prodTh = el("th", undefined, `${getProductName(sf.productId)} (${sf.productId})`);
    prodTh.scope = "row";
    tr.appendChild(prodTh);

    tr.appendChild(el("td", "num-cell", String(sf.requested)));
    tr.appendChild(el("td", "num-cell", String(sf.allocated)));
    tr.appendChild(el("td", "num-cell", String(sf.missing)));
    tr.appendChild(el("td", undefined, sf.reason));

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  return createTableScrollWrapper(table, "Order shortfalls");
}

function buildAlternativesTable(alternatives, costUnit) {
  const table = document.createElement("table");
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
    const whTh = el("th", undefined, (alt.warehouses || []).join(" + "));
    whTh.scope = "row";
    tr.appendChild(whTh);

    tr.appendChild(el("td", "num-cell", String(alt.unitsFilled)));
    tr.appendChild(el("td", "num-cell", `${alt.totalCost} ${costUnit}`));
    const sign = alt.delta >= 0 ? "+" : "";
    tr.appendChild(el("td", "num-cell", `${sign}${alt.delta} ${costUnit}`));
    tr.appendChild(el("td", undefined, alt.whyNot));

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  return createTableScrollWrapper(table, "Alternative warehouse combinations");
}

function renderDecisionResponse(payload) {
  const container = document.getElementById("result-content");
  if (!container) {
    return;
  }

  const decision = payload.decision;
  const fragment = document.createDocumentFragment();

  const banner = el("div", "decision-banner");
  const badge = el("span", `status-badge status-${decision.status}`, decision.status);
  const summary = el("p", "decision-summary", decision.summary);
  banner.append(badge, summary);
  fragment.appendChild(banner);

  const costLine = el(
    "p",
    "decision-cost",
    `Total cost: ${decision.totalCost} ${decision.costUnit} · Evaluated combinations: ${decision.meta.evaluatedCombinations} · Shipment overhead: ${decision.meta.shipmentOverhead} ${decision.costUnit}`,
  );
  fragment.appendChild(costLine);

  fragment.appendChild(el("h3", undefined, "Shipments"));
  if (Array.isArray(decision.shipments) && decision.shipments.length > 0) {
    fragment.appendChild(buildShipmentsTable(decision.shipments));
  } else {
    fragment.appendChild(el("p", "muted-text", "No shipments allocated."));
  }

  if (Array.isArray(decision.shortfalls) && decision.shortfalls.length > 0) {
    fragment.appendChild(el("h3", undefined, "Shortfalls"));
    fragment.appendChild(buildShortfallsTable(decision.shortfalls));
  }

  fragment.appendChild(el("h3", undefined, "Reasons"));
  if (Array.isArray(decision.reasons) && decision.reasons.length > 0) {
    const reasonsList = el("ul", "reasons-list");
    for (const reason of decision.reasons) {
      reasonsList.appendChild(el("li", undefined, reason));
    }
    fragment.appendChild(reasonsList);
  } else {
    fragment.appendChild(el("p", "muted-text", "No additional reasons recorded."));
  }

  fragment.appendChild(el("h3", undefined, "Why not…"));
  if (Array.isArray(decision.excluded) && decision.excluded.length > 0) {
    const excludedList = el("ul", "excluded-list");
    for (const ex of decision.excluded) {
      excludedList.appendChild(el("li", undefined, `${ex.detail} (${ex.code})`));
    }
    fragment.appendChild(excludedList);
  } else {
    fragment.appendChild(
      el("p", "muted-text", "No stocked warehouses were excluded by cold-chain rules."),
    );
  }

  if (Array.isArray(decision.alternatives) && decision.alternatives.length > 0) {
    fragment.appendChild(buildAlternativesTable(decision.alternatives, decision.costUnit));
  } else {
    fragment.appendChild(el("p", "muted-text", "No alternative warehouse combinations available."));
  }

  const metaLine = el("p", "decision-meta-line");
  if (payload.id) {
    metaLine.appendChild(document.createTextNode("Decision ID: "));
    const link = el("a", undefined, payload.id);
    link.href = `/api/v1/allocations/${encodeURIComponent(payload.id)}`;
    metaLine.appendChild(link);
  } else {
    metaLine.textContent = "Decision ID: Not saved (database unavailable)";
  }
  fragment.appendChild(metaLine);

  const detailsEl = el("details", "raw-json-details");
  const summaryEl = el("summary", undefined, "Raw JSON response");
  const preEl = el("pre", "raw-json-pre", JSON.stringify(payload, null, 2));
  detailsEl.append(summaryEl, preEl);
  fragment.appendChild(detailsEl);

  container.replaceChildren(fragment);
}

function setSubmittingState(isSubmitting) {
  state.submitting = isSubmitting;
  const submitBtn = document.getElementById("submit-btn");
  if (submitBtn) {
    submitBtn.disabled = isSubmitting;
    submitBtn.textContent = isSubmitting ? "Allocating..." : "Allocate order";
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

  setSubmittingState(true);
  try {
    const res = await fetch("/api/v1/allocations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        lines,
        options: { allowSplit },
      }),
    });

    const body = await res.json().catch(() => null);

    if (res.status === 200 || res.status === 201) {
      if (body && body.decision) {
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
  const footer = document.getElementById("health-footer");
  if (!footer) {
    return;
  }

  try {
    const res = await fetch("/api/v1/health");
    const body = await res.json().catch(() => null);

    if (body && body.version && body.engineVersion && body.commit) {
      const baseText = `App v${body.version} · Engine v${body.engineVersion} · Commit ${body.commit}`;
      if (res.status === 503 || body.db !== "ok") {
        footer.textContent = `${baseText} · database unreachable`;
      } else {
        footer.textContent = baseText;
      }
      return;
    }

    footer.textContent =
      res.status === 503 ? "Service degraded · database unreachable" : "Health status unavailable";
  } catch {
    footer.textContent = "Could not reach the server · database unreachable";
  }
}

function init() {
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
