import { calculateTotal, getLowestItem, money, normalizeItem, specToString } from "./price.js";
import { clearState, loadState, saveState } from "./storage.js";
import { fetchMockPrices, fetchStatuses, getPlatforms, makeCollectingResults } from "./platforms.js";

const apiBase = window.TIRE_API_BASE || "";

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
  isManualModalOpen: false,
  notice: "기본 예시가 입력되어 있습니다. 로컬 자동화를 실행하면 이 PC의 Chrome/Edge 브라우저에서 가격 후보를 추출합니다."
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

async function fetchPrices(input) {
  const response = await fetch(`${apiBase}/api/fetch-prices`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(`가격 수집 API 오류: HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload.results)) {
    throw new Error("가격 수집 API 응답 형식이 올바르지 않습니다.");
  }

  return payload;
}

async function runLocalAutomation(input, onStatus) {
  const startResponse = await fetch(`${apiBase}/api/run-local-automation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });

  if (!startResponse.ok) {
    throw new Error(`로컬 자동화 실행 오류: HTTP ${startResponse.status}`);
  }

  const startPayload = await startResponse.json();
  if (!startPayload.jobId) {
    throw new Error("로컬 자동화 작업 ID를 받지 못했습니다.");
  }

  const status = await waitForAutomation(startPayload.jobId, onStatus);
  if (status.status === "failed") {
    throw new Error(status.message || "로컬 자동화가 실패했습니다.");
  }

  return loadLocalResults();
}

async function waitForAutomation(jobId, onStatus) {
  const startedAt = Date.now();
  let lastMessage = "";

  while (Date.now() - startedAt < 10 * 60 * 1000) {
    const response = await fetch(`${apiBase}/api/automation-status?jobId=${encodeURIComponent(jobId)}`);
    if (!response.ok) {
      throw new Error(`자동화 상태 확인 오류: HTTP ${response.status}`);
    }

    const status = await response.json();
    if (status.message && status.message !== lastMessage) {
      lastMessage = status.message;
      onStatus?.(status);
    }

    if (["completed", "failed"].includes(status.status)) {
      return status;
    }

    await sleep(1800);
  }

  throw new Error("로컬 자동화 상태 확인 시간이 초과되었습니다.");
}

async function loadLocalResults() {
  const response = await fetch(`${apiBase}/api/local-results`);
  if (!response.ok) {
    throw new Error(`로컬 결과 JSON 읽기 오류: HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload.results)) {
    throw new Error("로컬 결과 JSON 형식이 올바르지 않습니다.");
  }
  return payload;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    const aTotal = Number(a.totalPrice || 0) > 0 ? Number(a.totalPrice) : Number.POSITIVE_INFINITY;
    const bTotal = Number(b.totalPrice || 0) > 0 ? Number(b.totalPrice) : Number.POSITIVE_INFINITY;
    return aTotal - bTotal;
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
        <p>로컬 브라우저 자동화 결과와 수동 보정값을 한 화면에서 비교합니다.</p>
      </div>
      <div class="topbar-actions">
        <button class="ghost-button" data-action="clear-storage" title="저장 데이터 초기화">${icon("trash")}초기화</button>
        <button class="secondary-button" data-action="load-local-results" title="저장된 JSON 결과 불러오기">${icon("refresh")}JSON 불러오기</button>
        <button class="primary-button" data-action="auto-search" title="로컬 자동화 실행">${icon("search")}로컬 자동화 실행</button>
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
    </main>
    ${renderManualModal()}
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
          <p>입력값은 로컬 Playwright 자동화가 브라우저에서 검색할 조건으로 사용됩니다.</p>
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
      <div><span>예시/수집</span><strong>${data.success || 0}</strong></div>
      <div><span>수동 확인</span><strong>${data.manual || 0}</strong></div>
      <div><span>비교 상품</span><strong>${data.items || 0}</strong></div>
      <div class="lowest-metric"><span>후보 최저가</span><strong>${data.lowest ? money(data.lowest.totalPrice) : "-"}</strong></div>
    </section>
  `;
}

function renderStatusCards() {
  const results = state.results.length ? state.results : makeCollectingResults(state.input).map((result) => ({ ...result, status: "unsupported" }));

  return `
    <section class="status-section" aria-label="수집 진행 상태">
      <div class="section-title-row">
        <h2>수집 진행 상태</h2>
        <button class="text-button" data-action="retry-failed">${icon("refresh")}로컬 자동화 다시 실행</button>
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
      <div class="status-actions">
        <a href="${result.searchUrl}" target="_blank" rel="noreferrer">검색 링크 열기</a>
        <button class="mini-button" data-action="open-manual" data-platform="${escapeHtml(result.platformName)}">보정</button>
      </div>
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
          <p>사용자 PC의 브라우저 화면에서 읽은 후보 가격입니다. 상세 조건은 열린 탭에서 확인하세요.</p>
        </div>
        <div class="table-controls">
          <label>
            <span>정렬</span>
            <select data-control="sortKey">
              ${option("totalPrice", "최종 총액", state.sortKey)}
              ${option("unitPrice", "평균 단가", state.sortKey)}
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
              <th>앞 후보</th>
              <th>앞 단가</th>
              <th>뒤 후보</th>
              <th>뒤 단가</th>
              <th>배송/장착</th>
              <th>4본 합계</th>
              <th>장착비 포함</th>
              <th>수집 상태</th>
              <th>신뢰도</th>
              <th>가격 확인</th>
              <th>메모</th>
            </tr>
          </thead>
          <tbody>
            ${
              items.length
                ? items.map((item, index) => renderTableRow(item, index, lowest)).join("")
                : `<tr><td colspan="13" class="empty-cell">자동 검색을 실행하거나 수동 보정에서 가격을 추가하세요.</td></tr>`
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
  const isSet = item.frontUnitPrice || item.rearUnitPrice || item.incompleteSet;
  const frontLabel = isSet
    ? `${escapeHtml(item.frontSpec || "-")} x ${item.frontQuantity || "-"}<br><span>${escapeHtml(item.frontProductName || "-")}</span>`
    : `${escapeHtml(item.spec || "-")}<br><span>${escapeHtml(item.productName || "-")}</span>`;
  const rearLabel = isSet
    ? `${escapeHtml(item.rearSpec || "-")} x ${item.rearQuantity || "-"}<br><span>${escapeHtml(item.rearProductName || "-")}</span>`
    : "-";
  const frontPrice = isSet ? `${money(item.frontUnitPrice)}<br><small>${money(item.frontTotal)}</small>` : money(item.unitPrice);
  const rearPrice = isSet ? `${money(item.rearUnitPrice)}<br><small>${money(item.rearTotal)}</small>` : "-";
  const extraFees = `${money(item.shippingFee)} / ${money(item.installationFee)}`;
  const totalLabel = item.incompleteSet ? "확인 필요" : money(item.totalPrice);
  return `
    <tr class="${isLowest ? "lowest-row" : ""}">
      <td>${isLowest ? "최저가" : index + 1}</td>
      <td><strong>${escapeHtml(item.platformName)}</strong>${item.manual ? `<span class="manual-dot">수동</span>` : ""}</td>
      <td class="candidate-cell">${frontLabel}</td>
      <td>${frontPrice}</td>
      <td class="candidate-cell">${rearLabel}</td>
      <td>${rearPrice}</td>
      <td>${extraFees}</td>
      <td class="price-cell">${totalLabel}</td>
      <td><span class="tag install-${item.installIncluded === true ? "yes" : item.installIncluded === false ? "no" : "unknown"}">${installLabel}</span></td>
      <td><span class="status-pill ${item.fetchStatus}">${labelForStatus(item.fetchStatus)}</span></td>
      <td><span class="confidence ${item.confidence}">${item.confidence}</span></td>
      <td>${renderPriceLinks(item)}</td>
      <td class="memo-cell">
        <span>${escapeHtml(item.memo || "")}</span>
        <button class="icon-button" data-action="edit-item" data-id="${escapeHtml(item.id)}" title="수동 수정">${icon("edit")}</button>
      </td>
    </tr>
  `;
}

function renderPriceLinks(item) {
  if (item.frontProductUrl || item.rearProductUrl) {
    return `
      <div class="price-links">
        ${item.frontProductUrl ? `<a class="link-button" href="${item.frontProductUrl}" target="_blank" rel="noreferrer" title="앞 타이어 가격 확인">${icon("link")}앞</a>` : ""}
        ${item.rearProductUrl ? `<a class="link-button" href="${item.rearProductUrl}" target="_blank" rel="noreferrer" title="뒤 타이어 가격 확인">${icon("link")}뒤</a>` : ""}
      </div>
    `;
  }
  return `<a class="link-button" href="${item.productUrl || item.searchUrl}" target="_blank" rel="noreferrer" title="가격 확인 링크">${icon("link")}현재가</a>`;
}

function renderManualModal() {
  if (!state.isManualModalOpen) return "";
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
    <div class="modal-backdrop" role="presentation">
      <section class="modal manual-panel" role="dialog" aria-modal="true" aria-label="수동 보정">
        <div class="panel-heading">
        <div>
          <h2>수동 보정</h2>
          <p>${escapeHtml(values.platformName)}의 현재 가격을 확인한 뒤 직접 입력합니다.</p>
        </div>
        <button class="icon-button" data-action="close-manual" title="닫기">×</button>
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
          ${selected ? `<button class="secondary-button" type="button" data-action="cancel-edit">새 입력</button>` : ""}
          <button class="ghost-button" type="button" data-action="close-manual">닫기</button>
          <button class="primary-button" type="submit">${selected ? "수정 저장" : "수동 결과 추가"}</button>
        </div>
        </form>
      </section>
    </div>
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
    startLocalAutomationSearch();
    return;
  }

  if (action === "load-local-results") {
    loadLocalResults()
      .then((payload) => {
        state.results = payload.results;
        state.notice = `저장된 로컬 자동화 JSON을 불러왔습니다. 수집 시각: ${formatDate(payload.collectedAt)}`;
        persist();
        render();
      })
      .catch((error) => {
        state.notice = `${error.message}. 먼저 로컬 자동화를 실행해 JSON 파일을 생성하세요.`;
        render();
      });
    return;
  }

  if (action === "demo-search") {
    state.results = fetchMockPrices(state.input);
    state.notice = "예시 가격이 표시되었습니다. 실제 현재가는 가격 확인 링크에서 확인해 수동 보정하세요.";
    persist();
    render();
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
    state.isManualModalOpen = false;
    state.notice = "저장 데이터를 초기화했습니다. 기본 예시로 돌아왔습니다.";
    render();
    return;
  }

  if (action === "retry-failed") {
    startLocalAutomationSearch();
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
    const selected = findItemById(state.selectedItemId);
    if (selected?.platformName) state.manualPlatform = selected.platformName;
    state.isManualModalOpen = true;
    state.notice = "선택한 항목을 수동 보정 패널에서 수정할 수 있습니다.";
    render();
    return;
  }

  if (action === "open-manual") {
    state.selectedItemId = null;
    state.manualPlatform = platform || state.manualPlatform;
    state.isManualModalOpen = true;
    render();
    return;
  }

  if (action === "close-manual") {
    state.selectedItemId = null;
    state.isManualModalOpen = false;
    render();
    return;
  }

  if (action === "cancel-edit") {
    state.selectedItemId = null;
    render();
  }
}

function startLocalAutomationSearch() {
  state.results = makeCollectingResults(state.input);
  state.notice = "로컬 브라우저 자동화를 시작합니다. Chrome 또는 Edge 창이 뜨면 닫지 말고 기다려주세요.";
  persist();
  render();

  runLocalAutomation(state.input, (status) => {
    state.notice = status.message || "로컬 브라우저 자동화가 진행 중입니다.";
    render();
  })
    .then((payload) => {
      state.results = payload.results;
      state.notice = "로컬 자동화가 완료되었습니다. 자동 추출 실패 사이트는 열린 브라우저 탭에서 직접 확인해 수동 보정하세요.";
      persist();
      render();
    })
    .catch((error) => {
      state.results = [];
      state.notice = `${error.message}. 이 기능은 로컬 Node 서버와 Chrome/Edge가 설치된 PC에서 실행해야 합니다.`;
      persist();
      render();
    });
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
  state.isManualModalOpen = false;
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
