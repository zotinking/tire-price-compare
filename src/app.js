import { calculateTotal, getLowestItem, money, normalizeItem, specToString } from "./price.js";
import { clearState, loadState, saveState } from "./storage.js";
import { fetchMockPrices, fetchStatuses, getPlatforms, makeCollectingResults } from "./platforms.js";

const defaultInput = {
  vehicleName: "Volvo C40 Recharge",
  frontSpec: { width: "235", aspectRatio: "45", rim: "20" },
  rearSpec: { width: "255", aspectRatio: "40", rim: "20" },
  keyword: "CrossClimate 2 SUV",
  brand: "Michelin",
  modelName: "CrossClimate 2 SUV",
  region: "수원",
  frontQuantity: 2,
  rearQuantity: 2,
  preferInstallIncluded: true
};

const state = {
  input: structuredClone(defaultInput),
  results: [],
  sortKey: "totalPrice",
  statusFilter: "all",
  installIncludedOnly: false,
  collapsedPlatforms: new Set(),
  excludedPlatforms: new Set(),
  selectedItemId: null,
  manualPlatform: "ABC타이어",
  notice: "기본 예시가 입력되어 있습니다. 자동 검색을 누르면 MVP 수집 결과가 생성됩니다."
};

const saved = loadState();
if (saved) {
  state.input = saved.input || state.input;
  state.results = saved.results || [];
  state.sortKey = saved.sortKey || state.sortKey;
  state.statusFilter = saved.statusFilter || state.statusFilter;
  state.installIncludedOnly = Boolean(saved.installIncludedOnly);
  state.collapsedPlatforms = new Set(saved.collapsedPlatforms || []);
  state.excludedPlatforms = new Set(saved.excludedPlatforms || []);
  state.notice = saved.savedAt ? `저장된 비교 결과를 불러왔습니다. 마지막 저장: ${formatDate(saved.savedAt)}` : state.notice;
}

const app = document.querySelector("#app");

app.addEventListener("click", (event) => {
  const actionTarget = event.target.closest("[data-action]");
  if (!actionTarget || !app.contains(actionTarget)) return;
  event.preventDefault();
  handleAction({ currentTarget: actionTarget });
});

function persist() {
  saveState({
    input: state.input,
    results: state.results,
    sortKey: state.sortKey,
    statusFilter: state.statusFilter,
    installIncludedOnly: state.installIncludedOnly,
    collapsedPlatforms: [...state.collapsedPlatforms],
    excludedPlatforms: [...state.excludedPlatforms]
  });
}

function icon(name) {
  const icons = {
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m16.5 16.5 4 4"></path></svg>',
    save: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h12l2 2v14H5z"></path><path d="M8 4v6h8V4"></path><path d="M8 20v-6h8v6"></path></svg>',
    refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66"></path><path d="M20 4v6h-6"></path></svg>',
    link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L11 4.93"></path><path d="M14 11a5 5 0 0 0-7.07 0L4.81 13.12a5 5 0 1 0 7.07 7.07L13 19.07"></path></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11-4-4L4 16z"></path><path d="m13 7 4 4"></path></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"></path><path d="M9 7V4h6v3"></path><path d="M7 7l1 13h8l1-13"></path></svg>',
    chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4"></path></svg>'
  };
  return icons[name] || "";
}

function labelForStatus(status) {
  return fetchStatuses[status] || status;
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function inputValue(path) {
  return path.split(".").reduce((current, key) => current?.[key], state.input) ?? "";
}

function setInputValue(path, value) {
  const keys = path.split(".");
  let current = state.input;
  keys.slice(0, -1).forEach((key) => {
    current = current[key];
  });
  const last = keys.at(-1);
  current[last] = ["frontQuantity", "rearQuantity"].includes(last) ? Number(value) : value;
}

function allItems() {
  return state.results.flatMap((result) => {
    if (state.excludedPlatforms.has(result.platformName) || state.collapsedPlatforms.has(result.platformName)) return [];
    return (result.items || []).map((item) => ({
      ...item,
      fetchStatus: result.status,
      errorMessage: result.errorMessage,
      searchUrl: result.searchUrl
    }));
  });
}

function filteredItems() {
  const items = allItems().filter((item) => {
    if (state.statusFilter !== "all" && item.fetchStatus !== state.statusFilter) return false;
    if (state.installIncludedOnly && item.installIncluded !== true) return false;
    return true;
  });

  const sorted = [...items].sort((a, b) => {
    if (state.sortKey === "platformName") return a.platformName.localeCompare(b.platformName, "ko-KR");
    if (state.sortKey === "unitPrice") return Number(a.unitPrice || 0) - Number(b.unitPrice || 0);
    if (state.sortKey === "shippingFee") return Number(a.shippingFee || 0) - Number(b.shippingFee || 0);
    if (state.sortKey === "installIncluded") return Number(b.installIncluded === true) - Number(a.installIncluded === true);
    if (state.sortKey === "status") return a.fetchStatus.localeCompare(b.fetchStatus);
    if (state.sortKey === "availableDate") return String(a.availableDate || "").localeCompare(String(b.availableDate || ""), "ko-KR");
    return Number(a.totalPrice || 0) - Number(b.totalPrice || 0);
  });

  return sorted;
}

function summary() {
  const results = state.results.filter((result) => !state.excludedPlatforms.has(result.platformName));
  const items = allItems();
  const lowest = getLowestItem(items);
  return {
    platforms: results.length,
    success: results.filter((result) => ["success", "partial"].includes(result.status)).length,
    manual: results.filter((result) => ["manual_required", "failed", "blocked", "unsupported"].includes(result.status)).length,
    items: items.length,
    lowest
  };
}

function render() {
  const data = summary();
  app.innerHTML = `
    <header class="topbar">
      <div>
        <h1>타이어 가격 비교</h1>
        <p>플랫폼별 가격, 배송비, 장착비, 장착 가능 여부를 한 화면에서 비교합니다.</p>
      </div>
      <div class="topbar-actions">
        <button class="ghost-button" data-action="clear-storage" title="저장 데이터 초기화">${icon("trash")}초기화</button>
        <button class="primary-button" data-action="auto-search" title="자동 검색 실행">${icon("search")}자동 검색</button>
      </div>
    </header>

    <main class="app-shell">
      <section class="workspace">
        ${renderNotice()}
        ${renderSearchPanel()}
        ${renderMetrics(data)}
        ${renderStatusCards()}
        ${renderComparePanel()}
      </section>
      <aside class="side-panel">
        ${renderManualPanel()}
        ${renderHistoryPanel()}
      </aside>
    </main>
  `;
  bindEvents();
}

function renderNotice() {
  return `<div class="notice">${state.notice}</div>`;
}

function field(label, path, type = "text", attrs = "", className = "") {
  return `
    <label class="field ${className}">
      <span>${label}</span>
      <input type="${type}" value="${escapeHtml(inputValue(path))}" data-input="${path}" ${attrs} />
    </label>
  `;
}

function renderSearchPanel() {
  return `
    <section class="panel search-panel" aria-label="검색 조건">
      <div class="panel-heading">
        <div>
          <h2>검색 조건</h2>
          <p>앞/뒤 규격이 다른 차량을 기준으로 총액을 따로 계산합니다.</p>
        </div>
        <button class="secondary-button" data-action="save-search" title="현재 조건과 결과 저장">${icon("save")}검색 조건 저장</button>
      </div>

      <div class="form-grid">
        ${field("차량명", "vehicleName", "text", "", "wide-field")}
        ${field("브랜드", "brand")}
        ${field("모델명", "modelName", "text", "", "wide-field")}
        ${field("장착 지역", "region")}
        ${field("앞 폭", "frontSpec.width", "number", "min=\"100\" max=\"400\"")}
        ${field("앞 편평비", "frontSpec.aspectRatio", "number", "min=\"20\" max=\"90\"")}
        ${field("앞 휠 인치", "frontSpec.rim", "number", "min=\"10\" max=\"30\"")}
        ${field("앞 수량", "frontQuantity", "number", "min=\"1\" max=\"4\"")}
        ${field("뒤 폭", "rearSpec.width", "number", "min=\"100\" max=\"400\"")}
        ${field("뒤 편평비", "rearSpec.aspectRatio", "number", "min=\"20\" max=\"90\"")}
        ${field("뒤 휠 인치", "rearSpec.rim", "number", "min=\"10\" max=\"30\"")}
        ${field("뒤 수량", "rearQuantity", "number", "min=\"0\" max=\"4\"")}
      </div>

      <div class="form-footer">
        <label class="toggle">
          <input type="checkbox" data-input="preferInstallIncluded" ${state.input.preferInstallIncluded ? "checked" : ""} />
          <span>장착비 포함 상품 우선</span>
        </label>
        <span class="spec-preview">앞 ${specToString(state.input.frontSpec)} · 뒤 ${specToString(state.input.rearSpec)}</span>
      </div>
    </section>
  `;
}

function renderMetrics(data) {
  return `
    <section class="metric-strip" aria-label="요약">
      <div><span>플랫폼</span><strong>${data.platforms || 0}</strong></div>
      <div><span>수집 성공</span><strong>${data.success || 0}</strong></div>
      <div><span>수동 확인</span><strong>${data.manual || 0}</strong></div>
      <div><span>비교 상품</span><strong>${data.items || 0}</strong></div>
      <div class="lowest-metric"><span>현재 최저가</span><strong>${data.lowest ? money(data.lowest.totalPrice) : "-"}</strong></div>
    </section>
  `;
}

function renderStatusCards() {
  const results = state.results.length ? state.results : makeCollectingResults(state.input).map((result) => ({ ...result, status: "unsupported" }));

  return `
    <section class="status-section" aria-label="수집 진행 상태">
      <div class="section-title-row">
        <h2>수집 진행 상태</h2>
        <button class="text-button" data-action="retry-failed">${icon("refresh")}실패 플랫폼 다시 시도</button>
      </div>
      <div class="status-grid">
        ${results.map(renderStatusCard).join("")}
      </div>
    </section>
  `;
}

function renderStatusCard(result) {
  const excluded = state.excludedPlatforms.has(result.platformName);
  const collapsed = state.collapsedPlatforms.has(result.platformName);
  const count = (result.items || []).length;
  return `
    <article class="status-card ${result.status} ${excluded ? "excluded" : ""}">
      <div>
        <div class="status-name">${result.platformName}</div>
        <div class="status-label">${excluded ? "비교 제외" : labelForStatus(result.status)}</div>
      </div>
      <div class="status-meta">
        <span>${count}개</span>
        <button class="icon-button" data-action="toggle-platform" data-platform="${escapeHtml(result.platformName)}" title="플랫폼별 접기/펼치기">${icon("chevron")}</button>
        <button class="mini-button" data-action="exclude-platform" data-platform="${escapeHtml(result.platformName)}">${excluded ? "복원" : "제외"}</button>
      </div>
      <a href="${result.searchUrl}" target="_blank" rel="noreferrer">검색 링크 열기</a>
      ${result.errorMessage ? `<p>${escapeHtml(result.errorMessage)}</p>` : ""}
      ${collapsed ? `<div class="collapsed-label">표에서 접힘</div>` : ""}
    </article>
  `;
}

function renderComparePanel() {
  const items = filteredItems();
  const lowest = getLowestItem(allItems());

  return `
    <section class="panel compare-panel" aria-label="가격 비교">
      <div class="panel-heading table-heading">
        <div>
          <h2>가격 비교</h2>
          <p>기본 정렬은 최종 예상 총액 오름차순입니다.</p>
        </div>
        <div class="table-controls">
          <label>
            <span>정렬</span>
            <select data-control="sortKey">
              ${option("totalPrice", "최종 총액", state.sortKey)}
              ${option("unitPrice", "타이어 단가", state.sortKey)}
              ${option("installIncluded", "장착비 포함", state.sortKey)}
              ${option("shippingFee", "배송비", state.sortKey)}
              ${option("availableDate", "장착 가능일", state.sortKey)}
              ${option("platformName", "플랫폼명", state.sortKey)}
              ${option("status", "수집 성공 여부", state.sortKey)}
            </select>
          </label>
          <label>
            <span>상태</span>
            <select data-control="statusFilter">
              ${option("all", "전체", state.statusFilter)}
              ${Object.keys(fetchStatuses).filter((key) => key !== "collecting").map((key) => option(key, labelForStatus(key), state.statusFilter)).join("")}
            </select>
          </label>
          <label>
            <span>장착비</span>
            <select data-control="installIncludedOnly">
              ${option("false", "전체", String(state.installIncludedOnly))}
              ${option("true", "포함만", String(state.installIncludedOnly))}
            </select>
          </label>
        </div>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>순위</th>
              <th>플랫폼</th>
              <th>상품명</th>
              <th>규격</th>
              <th>단가</th>
              <th>수량</th>
              <th>배송비</th>
              <th>장착비</th>
              <th>할인</th>
              <th>최종 총액</th>
              <th>장착비 포함</th>
              <th>장착점</th>
              <th>수집 상태</th>
              <th>신뢰도</th>
              <th>상품 링크</th>
              <th>메모</th>
            </tr>
          </thead>
          <tbody>
            ${
              items.length
                ? items.map((item, index) => renderTableRow(item, index, lowest)).join("")
                : `<tr><td colspan="16" class="empty-cell">자동 검색을 실행하거나 수동 보정에서 가격을 추가하세요.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderTableRow(item, index, lowest) {
  const isLowest = lowest && item.id === lowest.id;
  const installLabel = item.installIncluded === true ? "포함" : item.installIncluded === false ? "별도" : "확인 필요";
  return `
    <tr class="${isLowest ? "lowest-row" : ""}">
      <td>${isLowest ? "최저가" : index + 1}</td>
      <td><strong>${escapeHtml(item.platformName)}</strong>${item.manual ? `<span class="manual-dot">수동</span>` : ""}</td>
      <td>${escapeHtml(item.productName || "-")}</td>
      <td>${escapeHtml(item.spec || "-")}</td>
      <td>${money(item.unitPrice)}</td>
      <td>${item.quantity || "-"}</td>
      <td>${money(item.shippingFee)}</td>
      <td>${money(item.installationFee)}</td>
      <td>${money(item.discount)}</td>
      <td class="price-cell">${money(item.totalPrice)}</td>
      <td><span class="tag install-${item.installIncluded === true ? "yes" : item.installIncluded === false ? "no" : "unknown"}">${installLabel}</span></td>
      <td>${escapeHtml(item.shopName || "-")}</td>
      <td><span class="status-pill ${item.fetchStatus}">${labelForStatus(item.fetchStatus)}</span></td>
      <td><span class="confidence ${item.confidence}">${item.confidence}</span></td>
      <td><a class="link-button" href="${item.productUrl || item.searchUrl}" target="_blank" rel="noreferrer" title="상품 링크">${icon("link")}열기</a></td>
      <td class="memo-cell">
        <span>${escapeHtml(item.memo || "")}</span>
        <button class="icon-button" data-action="edit-item" data-id="${escapeHtml(item.id)}" title="수동 수정">${icon("edit")}</button>
      </td>
    </tr>
  `;
}

function renderManualPanel() {
  const selected = findItemById(state.selectedItemId);
  const values = selected || {
    platformName: state.manualPlatform,
    productName: `${state.input.brand} ${state.input.modelName}`,
    spec: `${specToString(state.input.frontSpec)} / ${specToString(state.input.rearSpec)}`,
    unitPrice: "",
    quantity: state.input.frontQuantity + state.input.rearQuantity,
    shippingFee: 0,
    installationFee: 0,
    discount: 0,
    installIncluded: "",
    shopName: "",
    productUrl: "",
    memo: ""
  };

  return `
    <section class="panel manual-panel" aria-label="수동 보정">
      <div class="panel-heading">
        <div>
          <h2>수동 보정</h2>
          <p>실패한 플랫폼은 검색 링크를 확인한 뒤 직접 입력합니다.</p>
        </div>
      </div>

      <form class="manual-form" data-manual-form>
        <label class="field">
          <span>플랫폼</span>
          <select name="platformName">
            ${getPlatforms().map((platform) => option(platform.platformName, platform.platformName, values.platformName)).join("")}
          </select>
        </label>
        ${manualField("상품명", "productName", values.productName)}
        ${manualField("규격", "spec", values.spec)}
        ${manualField("단가", "unitPrice", values.unitPrice, "number")}
        ${manualField("수량", "quantity", values.quantity, "number")}
        ${manualField("배송비", "shippingFee", values.shippingFee, "number")}
        ${manualField("장착비", "installationFee", values.installationFee, "number")}
        ${manualField("할인", "discount", values.discount, "number")}
        <label class="field">
          <span>장착비 포함</span>
          <select name="installIncluded">
            ${option("", "확인 필요", values.installIncluded === undefined ? "" : values.installIncluded)}
            ${option("true", "포함", String(values.installIncluded))}
            ${option("false", "별도", String(values.installIncluded))}
          </select>
        </label>
        ${manualField("장착점", "shopName", values.shopName)}
        ${manualField("상품 URL", "productUrl", values.productUrl, "url")}
        <label class="field span-2">
          <span>메모</span>
          <textarea name="memo">${escapeHtml(values.memo || "")}</textarea>
        </label>
        <div class="manual-actions">
          <button class="secondary-button" type="button" data-action="cancel-edit">새 입력</button>
          <button class="primary-button" type="submit">${selected ? "수정 저장" : "수동 결과 추가"}</button>
        </div>
      </form>
    </section>
  `;
}

function renderHistoryPanel() {
  const failed = state.results.filter((result) => ["failed", "manual_required", "blocked", "unsupported"].includes(result.status));
  return `
    <section class="panel history-panel" aria-label="수동 확인 대상">
      <h2>수동 확인 대상</h2>
      ${
        failed.length
          ? failed
              .map(
                (result) => `
                  <div class="manual-target">
                    <div>
                      <strong>${result.platformName}</strong>
                      <span>${labelForStatus(result.status)}</span>
                    </div>
                    <a href="${result.searchUrl}" target="_blank" rel="noreferrer">${icon("link")}검색</a>
                  </div>
                `
              )
              .join("")
          : `<p class="muted">자동 검색 후 확인 대상이 여기에 표시됩니다.</p>`
      }
    </section>
  `;
}

function option(value, label, selected) {
  return `<option value="${escapeHtml(String(value))}" ${String(value) === String(selected) ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function manualField(label, name, value, type = "text") {
  return `
    <label class="field">
      <span>${label}</span>
      <input type="${type}" name="${name}" value="${escapeHtml(value ?? "")}" />
    </label>
  `;
}

function bindEvents() {
  app.querySelectorAll("[data-input]").forEach((el) => {
    el.addEventListener("input", (event) => {
      const target = event.currentTarget;
      if (target.type === "checkbox") {
        setInputValue(target.dataset.input, target.checked);
      } else {
        setInputValue(target.dataset.input, target.value);
      }
      persist();
      render();
    });
  });

  app.querySelectorAll("[data-control]").forEach((el) => {
    el.addEventListener("change", (event) => {
      const target = event.currentTarget;
      if (target.dataset.control === "installIncludedOnly") {
        state.installIncludedOnly = target.value === "true";
      } else {
        state[target.dataset.control] = target.value;
      }
      persist();
      render();
    });
  });

  const manualForm = app.querySelector("[data-manual-form]");
  if (manualForm) {
    manualForm.addEventListener("submit", handleManualSubmit);
  }
}

function handleAction(event) {
  const button = event.currentTarget;
  const action = button.dataset.action;
  const platform = button.dataset.platform;

  if (action === "auto-search") {
    state.results = makeCollectingResults(state.input);
    state.notice = "플랫폼별 수집을 시작했습니다. MVP에서는 mock 수집 결과와 검색 URL을 함께 제공합니다.";
    persist();
    render();
    window.setTimeout(() => {
      state.results = fetchMockPrices(state.input);
      state.notice = "수집이 완료되었습니다. 실패한 플랫폼은 수동 보정에서 직접 입력할 수 있습니다.";
      persist();
      render();
    }, 550);
    return;
  }

  if (action === "save-search") {
    persist();
    state.notice = "검색 조건과 현재 비교 결과를 LocalStorage에 저장했습니다.";
    render();
    return;
  }

  if (action === "clear-storage") {
    clearState();
    state.input = structuredClone(defaultInput);
    state.results = [];
    state.sortKey = "totalPrice";
    state.statusFilter = "all";
    state.installIncludedOnly = false;
    state.collapsedPlatforms.clear();
    state.excludedPlatforms.clear();
    state.selectedItemId = null;
    state.notice = "저장 데이터를 초기화했습니다. 기본 예시로 돌아왔습니다.";
    render();
    return;
  }

  if (action === "retry-failed") {
    const fetched = fetchMockPrices(state.input);
    state.results = state.results.length
      ? state.results.map((result) => {
          if (["failed", "manual_required", "blocked", "unsupported"].includes(result.status)) {
            return fetched.find((next) => next.platformName === result.platformName) || result;
          }
          return result;
        })
      : fetched;
    state.notice = "실패 플랫폼을 다시 시도했습니다. 자동화 제한이 있는 곳은 상태와 검색 링크를 유지합니다.";
    persist();
    render();
    return;
  }

  if (action === "toggle-install-filter") {
    state.installIncludedOnly = !state.installIncludedOnly;
    persist();
    render();
    return;
  }

  if (action === "toggle-platform" && platform) {
    if (state.collapsedPlatforms.has(platform)) state.collapsedPlatforms.delete(platform);
    else state.collapsedPlatforms.add(platform);
    persist();
    render();
    return;
  }

  if (action === "exclude-platform" && platform) {
    if (state.excludedPlatforms.has(platform)) state.excludedPlatforms.delete(platform);
    else state.excludedPlatforms.add(platform);
    persist();
    render();
    return;
  }

  if (action === "edit-item") {
    state.selectedItemId = button.dataset.id;
    state.notice = "선택한 항목을 수동 보정 패널에서 수정할 수 있습니다.";
    render();
    return;
  }

  if (action === "cancel-edit") {
    state.selectedItemId = null;
    render();
  }
}

function handleManualSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const platformName = String(form.get("platformName"));
  const installValue = String(form.get("installIncluded"));
  const manualItem = normalizeItem({
    id: state.selectedItemId || `manual-${platformName}-${Date.now()}`,
    platformName,
    productName: String(form.get("productName") || ""),
    spec: String(form.get("spec") || ""),
    unitPrice: Number(form.get("unitPrice") || 0),
    quantity: Number(form.get("quantity") || 0),
    shippingFee: Number(form.get("shippingFee") || 0),
    installationFee: Number(form.get("installationFee") || 0),
    discount: Number(form.get("discount") || 0),
    totalPrice: 0,
    installIncluded: installValue === "" ? undefined : installValue === "true",
    shopName: String(form.get("shopName") || ""),
    productUrl: String(form.get("productUrl") || ""),
    memo: String(form.get("memo") || "수동 입력값"),
    collectedAt: new Date().toISOString(),
    confidence: installValue === "" ? "low" : "medium",
    manual: true
  });
  manualItem.totalPrice = calculateTotal(manualItem);

  const result = state.results.find((entry) => entry.platformName === platformName);
  if (result) {
    result.status = "manual_required";
    result.items = result.items || [];
    const index = result.items.findIndex((item) => item.id === manualItem.id);
    if (index >= 0) result.items[index] = manualItem;
    else result.items.push(manualItem);
    result.errorMessage = "사용자가 직접 보정한 값입니다.";
  } else {
    state.results.push({
      platformName,
      searchUrl: "#",
      status: "manual_required",
      items: [manualItem],
      errorMessage: "사용자가 직접 추가한 플랫폼입니다."
    });
  }

  state.selectedItemId = null;
  state.notice = `${platformName} 수동 보정값을 비교표에 반영했습니다.`;
  persist();
  render();
}

function findItemById(id) {
  if (!id) return null;
  return state.results.flatMap((result) => result.items || []).find((item) => item.id === id) || null;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

render();
