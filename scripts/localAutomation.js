import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright-core";
import { normalizeItem, specToString } from "../src/price.js";

const DEFAULT_KEEP_OPEN_MS = 10 * 60 * 1000;

const platforms = [
  {
    platformName: "다나와",
    homeUrl: "https://www.danawa.com/",
    searchUrl: (query) => `https://search.danawa.com/dsearch.php?query=${encodeURIComponent(query)}`
  },
  {
    platformName: "타이어픽",
    homeUrl: "https://www.tire-pick.com/",
    searchUrl: (_query, _input, target) =>
      `https://www.tire-pick.com/store/tire?width=${target.spec.width}&aspectRatio=${target.spec.aspectRatio}&inch=${target.spec.rim}`
  },
  {
    platformName: "ABC타이어",
    homeUrl: "https://abctire.co.kr/",
    searchUrl: () => "https://abctire.co.kr/"
  },
  {
    platformName: "티스테이션",
    homeUrl: "https://www.tstation.com/",
    searchUrl: () => "https://www.tstation.com/tire/sizes"
  },
  {
    platformName: "타이어프로",
    homeUrl: "https://www.tirepro.co.kr/",
    searchUrl: (_query, _input, target) =>
      `https://www.tirepro.co.kr/product/list.html?cate_no=42&width=${target.spec.width}&aspect=${target.spec.aspectRatio}&inch=${target.spec.rim}`
  },
  {
    platformName: "넥센 넥스트레벨",
    homeUrl: "https://www.nexen-nextlevel.com/",
    searchUrl: (_query) => "https://www.nexen-nextlevel.com/product/prdList?viewGbn=H"
  },
  {
    platformName: "네이버 쇼핑",
    homeUrl: "https://shopping.naver.com/home",
    searchUrl: (query) => `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(query)}`
  },
  {
    platformName: "11번가",
    homeUrl: "https://www.11st.co.kr/",
    searchUrl: (query) => `https://search.11st.co.kr/Search.tmall?kwd=${encodeURIComponent(query)}`
  },
  {
    platformName: "G마켓",
    homeUrl: "https://www.gmarket.co.kr/",
    searchUrl: (query) => `https://browse.gmarket.co.kr/search?keyword=${encodeURIComponent(query)}`
  },
  {
    platformName: "옥션",
    homeUrl: "https://www.auction.co.kr/",
    searchUrl: (query) => `https://browse.auction.co.kr/search?keyword=${encodeURIComponent(query)}`
  },
  {
    platformName: "쿠팡",
    homeUrl: "https://www.coupang.com/",
    searchUrl: (query) => `https://www.coupang.com/np/search?q=${encodeURIComponent(query)}`
  }
];

function selectedPlatforms(input = {}) {
  const limit = String(process.env.TIRE_PLATFORM_LIMIT || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const excluded = new Set(Array.isArray(input.excludedPlatforms) ? input.excludedPlatforms : []);
  return platforms.filter((platform) => {
    if (excluded.has(platform.platformName)) return false;
    if (limit.length && !limit.includes(platform.platformName)) return false;
    return true;
  });
}

function specCompact(spec) {
  return `${spec.width}${spec.aspectRatio}${spec.rim}`;
}

function abcTireSizeUrl(spec) {
  return `https://abctire.co.kr/tire?tireSize=${encodeURIComponent(specToString(spec))}`;
}

function sameSpec(a, b) {
  return specToString(a) === specToString(b);
}

function specTargets(input) {
  const frontQuantity = Number(input.frontQuantity || 0);
  const rearQuantity = Number(input.rearQuantity || 0);
  const targets = [];
  if (frontQuantity > 0 && input.frontSpec) {
    targets.push({ side: "front", label: "앞", spec: input.frontSpec, quantity: frontQuantity });
  }
  if (rearQuantity > 0 && input.rearSpec) {
    targets.push({ side: "rear", label: "뒤", spec: input.rearSpec, quantity: rearQuantity });
  }
  return targets;
}

function queryFor(input, spec = input.frontSpec) {
  return [input.brand, input.modelName || input.keyword, specToString(spec), input.region].filter(Boolean).join(" ");
}

function cleanProductName(value) {
  return String(value || "")
    .replace(/\s*(등록\s*관심상품|관심상품|상품분류|리뷰|상품의견).*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

function cleanDanawaProductName(value, specText) {
  const name = cleanProductName(value);
  const specIndex = name.lastIndexOf(specText);
  if (specIndex < 0) return name;
  const throughSpec = name.slice(0, specIndex + specText.length);
  const markers = ["미쉐린타이어", "미쉐린", "한국타이어", "금호", "넥센", "브리지스톤", "콘티넨탈", "피렐리", "굿이어", "MICHELIN"];
  const markerIndex = markers.reduce((latest, marker) => {
    const index = throughSpec.lastIndexOf(marker);
    return index > latest ? index : latest;
  }, -1);
  return (markerIndex >= 0 ? throughSpec.slice(markerIndex) : throughSpec).trim();
}

function parseArgs() {
  const [, , inputPath, outputPath, jobPath] = process.argv;
  if (!inputPath || !outputPath || !jobPath) {
    throw new Error("Usage: node scripts/localAutomation.js <input.json> <output.json> <job.json>");
  }
  return {
    inputPath: resolve(inputPath),
    outputPath: resolve(outputPath),
    jobPath: resolve(jobPath)
  };
}

async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function writeJob(jobPath, patch) {
  await writeJson(jobPath, {
    jobId: process.env.TIRE_AUTOMATION_JOB_ID || "",
    updatedAt: new Date().toISOString(),
    ...patch
  });
}

async function launchContext() {
  const userDataDir = resolve(process.env.TIRE_BROWSER_USER_DATA_DIR || ".browser-profile");
  const channel = process.env.TIRE_BROWSER_CHANNEL || "chrome";
  const baseOptions = {
    headless: false,
    viewport: { width: 1440, height: 920 },
    locale: "ko-KR",
    args: ["--disable-blink-features=AutomationControlled"]
  };

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      ...baseOptions,
      channel
    });
    return { context, channel, userDataDir };
  } catch (edgeError) {
    const fallbackChannel = channel === "chrome" ? "msedge" : "chrome";
    try {
      const context = await chromium.launchPersistentContext(userDataDir, {
        ...baseOptions,
        channel: fallbackChannel
      });
      return { context, channel: fallbackChannel, userDataDir };
    } catch {
      throw edgeError;
    }
  }
}

async function openSearchPage(page, platform, input, target) {
  if (platform.platformName === "ABC타이어") {
    return openAbcSearchPage(page, platform, input, target);
  }

  if (platform.platformName === "티스테이션") {
    return openTstationSearchPage(page, platform, input, target);
  }

  const query = queryFor(input, target.spec);
  const targetUrl = platform.searchUrl(query, input, target);
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2500);
  await dismissPopups(page);
  return targetUrl;
}

async function clickFirstVisible(page, locator, options = {}) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    try {
      if (await item.isVisible({ timeout: 500 })) {
        await item.click({ timeout: 3000, ...options });
        return true;
      }
    } catch {
      // Keep trying alternate matches. Sites often render duplicate hidden controls.
    }
  }
  return false;
}

async function selectAbcSizeOption(page, selectIndex, value) {
  const boxes = page.locator('div[class*="sizeSelectWrap"] div[class*="selectBox__"]');
  await boxes.nth(selectIndex).click({ force: true, timeout: 5000 });
  await page.waitForTimeout(400);

  const exact = new RegExp(`^\\s*${escapeRegex(value)}\\s*$`);
  const option = page.locator('div[class*="selectItem"]').filter({ hasText: exact }).first();
  try {
    await option.scrollIntoViewIfNeeded({ timeout: 1500 });
    await option.click({ force: true, timeout: 3000 });
  } catch {
    const clicked = await page.evaluate((optionText) => {
      const candidates = Array.from(document.querySelectorAll('div[class*="selectItem"]'));
      const item = candidates.find((element) => element.textContent?.trim() === optionText);
      if (!item) return false;
      item.scrollIntoView({ block: "center" });
      item.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return true;
    }, String(value));
    if (!clicked) throw new Error(`ABC타이어 ${value} 옵션을 찾지 못했습니다.`);
  }
  await page.waitForTimeout(500);
}

async function openAbcSearchPage(page, platform, _input, target) {
  await page.goto(platform.homeUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1500);
  await dismissPopups(page);

  const opened = await clickFirstVisible(page, page.getByText("사이즈", { exact: true }), { force: true });
  if (!opened) {
    throw new Error("ABC타이어 사이즈 검색 탭을 열지 못했습니다.");
  }
  await page.waitForTimeout(800);

  await selectAbcSizeOption(page, 0, String(target.spec.width));
  await selectAbcSizeOption(page, 1, String(target.spec.aspectRatio));
  await selectAbcSizeOption(page, 2, String(target.spec.rim));

  const resultUrl = abcTireSizeUrl(target.spec);
  try {
    const productButton = page.getByRole("button", { name: /제품 보러가기/ }).first();
    await productButton.click({ force: true, timeout: 5000 });
    await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
  } catch {
    await page.goto(resultUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  }
  await page.waitForTimeout(3500);
  await dismissPopups(page);
  return page.url() || resultUrl;
}

async function openTstationSearchPage(page, platform, _input, target) {
  await page.goto(platform.searchUrl("", _input, target), { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1800);
  await dismissPopups(page);

  const compact = specCompact(target.spec);
  const searchTerms = [
    specToString(target.spec),
    `${target.spec.width}/${target.spec.aspectRatio}R${target.spec.rim}`,
    compact
  ];

  const openedGlobalSearch = await openTstationGlobalSearch(page);

  for (const term of searchTerms) {
    const searched = await fillAndSubmitTstationGlobalSearch(page, term);
    if (searched) break;
  }

  if (await isTstationSearchPopupOpen(page)) {
    await submitTstationPopupSizeSearch(page, compact);
  }

  await page.evaluate((value) => {
    for (const selector of ["#tireSizeFr", "#tireSizeRe"]) {
      const input = document.querySelector(selector);
      if (input) {
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  }, compact);

  if (!openedGlobalSearch) {
    await openTstationSizeTabSearch(page, compact);
  }

  await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await dismissPopups(page);
  return page.url();
}

async function fillAndSubmitTstationGlobalSearch(page, term) {
  const inputs = page.locator('input#searchInput, input[type="search"], input[placeholder*="차량번호"], input[placeholder*="사이즈"]');
  const count = await inputs.count();

  for (let index = 0; index < count; index += 1) {
    const input = inputs.nth(index);
    try {
      if (!(await input.isVisible({ timeout: 500 }))) continue;
      await input.fill(term, { timeout: 3000 });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1800);

      const stillVisible = await input.isVisible({ timeout: 500 }).catch(() => false);
      if (stillVisible) {
        await clickFirstVisible(page, page.locator('button:has(.search), a:has(.search), button:has-text("검색")'), { force: true });
        await page.waitForTimeout(1800);
      }
      return true;
    } catch {
      // Try the next visible search input.
    }
  }

  return false;
}

async function isTstationSearchPopupOpen(page) {
  return page.evaluate(() => {
    const popup = document.querySelector("#searchPopup");
    const input = document.querySelector("#searchPopup #searchInput");
    const rect = input?.getBoundingClientRect();
    return Boolean(
      popup?.classList.contains("on") &&
        rect &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth
    );
  });
}

async function openTstationGlobalSearch(page) {
  const triggers = [
    page.locator(".search-products"),
    page.locator("a:has(.search-products)"),
    page.locator('button:has(.search-products)'),
    page.locator("#utilSearchCar")
  ];

  for (const trigger of triggers) {
    await clickFirstVisible(page, trigger, { force: true });
    await page.waitForTimeout(800);
    if (await isTstationSearchPopupOpen(page)) return true;
  }

  return false;
}

async function submitTstationPopupSizeSearch(page, compact) {
  await clickFirstVisible(page, page.getByText("타이어 사이즈로 찾기", { exact: true }), { force: true });
  await page.waitForTimeout(700);

  const searched = await fillAndSubmitTstationGlobalSearch(page, compact);
  if (searched) return;

  await page.evaluate((value) => {
    const inputs = [
      document.querySelector("#searchPopup #searchInput"),
      document.querySelector("#searchPopup #tireSizeFrSearchInput"),
      document.querySelector("#searchPopup #tireSizeReSearchInput"),
      document.querySelector("#tireSizeFrSearchInput"),
      document.querySelector("#tireSizeReSearchInput")
    ].filter(Boolean);

    for (const input of inputs) {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    const tireShopButton = Array.from(document.querySelectorAll("button"))
      .find((button) => /타이어\s*쇼핑하기|결과\s*보기|조회하기|검색/.test(button.innerText || ""));
    tireShopButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  }, compact);
}

async function openTstationSizeTabSearch(page, compact) {
  await clickFirstVisible(page, page.locator("button.searchCarCall-newVersion"), { force: true });
  await page.waitForTimeout(1200);

  const sizeTabClicked =
    (await clickFirstVisible(page, page.getByText("사이즈로 찾기", { exact: true }), { force: true })) ||
    (await clickFirstVisible(page, page.getByText("타이어 사이즈로 찾기", { exact: true }), { force: true }));
  await page.waitForTimeout(sizeTabClicked ? 800 : 300);

  await page.evaluate((value) => {
    const inputs = [
      document.querySelector("#searchInput"),
      document.querySelector("#tireSizeFrSearchInput"),
      document.querySelector("#tireSizeReSearchInput")
    ].filter(Boolean);
    for (const input of inputs) {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    const functionNames = [
      "searchEngineCar",
      "searchCarHeader",
      "searchCarHeaderNewVersion",
      "searchTireSize",
      "searchTireList",
      "getTireList"
    ];
    for (const name of functionNames) {
      try {
        if (typeof window[name] === "function") window[name]();
      } catch {
        // Best-effort only. The visible browser remains open when extraction fails.
      }
    }
  }, compact);
}

async function dismissPopups(page) {
  const labels = ["닫기", "오늘 하루 보지 않기", "확인", "동의"];
  for (const label of labels) {
    const button = page.getByText(label, { exact: true }).first();
    try {
      if (await button.isVisible({ timeout: 700 })) {
        await button.click({ timeout: 700 });
      }
    } catch {
      // Popup labels vary by site. Best-effort only.
    }
  }
}

function siteResult(platformName, searchUrl, status, items, errorMessage) {
  return {
    platformName,
    searchUrl,
    status,
    items,
    errorMessage
  };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function extractTirepickItems(page, input, target) {
  const specText = specToString(target.spec);
  const rawItems = await page.evaluate((currentSpec) => {
    function numberFrom(value) {
      const cleaned = String(value || "").replace(/[^\d]/g, "");
      return cleaned ? Number(cleaned) : undefined;
    }

    function cleanName(value) {
      return String(value || "")
        .replace(/^.*?(?:판매순|추천순|낮은가격순)\s+/i, "")
        .replace(/^.*\s(?:품절|일시품절)\s+/, "")
        .replace(/^(품절|일시품절)\s+/, "")
        .replace(/^([가-힣A-Za-z]+(?:타이어)?)\s+\d(?:\.\d)?\s+\([0-9,]+\)\s+/, "$1 ")
        .replace(/\s+/g, " ")
        .trim();
    }

    const text = document.body.innerText.replace(/\s+/g, " ");
    const [sizePrefix, rim] = currentSpec.split("R");
    const escapedPrefix = sizePrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedRim = rim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const specPattern = `${escapedPrefix}(?:ZR|R)${escapedRim}`;
    const pattern = new RegExp(`((?:품절\\s+|일시품절\\s+)?[가-힣A-Za-z0-9 .™'()*\\[\\]/_+-]{8,180}?)\\s+${specPattern}\\s+(?:[0-9]{1,2}%\\s+)?([0-9]{1,3}(?:,[0-9]{3})+)원`, "g");
    const items = [];
    const seen = new Set();
    let match;

    while ((match = pattern.exec(text)) && items.length < 5) {
      const name = cleanName(match[1]);
      const unitPrice = numberFrom(match[2]);
      if (!name || !unitPrice || unitPrice < 50000) continue;
      const key = `${name}-${unitPrice}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        productName: name,
        unitPrice,
        spec: currentSpec,
        shippingFee: 0,
        installationFee: 0,
        installIncluded: undefined,
        availableDate: /^품절|일시품절/.test(match[1]) ? "품절" : "확인 필요",
        productUrl: location.href,
        rawText: match[0]
      });
    }

    return {
      blocked: /captcha|캡차|로봇|비정상|접근이 제한|access denied|403|보안문자/i.test(text),
      items
    };
  }, specText);

  if (rawItems.blocked) {
    return { blocked: true, items: [] };
  }

  const modelTokens = String(input.modelName || input.keyword || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length >= 2);

  const items = rawItems.items.map((item, index) => {
    const text = [item.productName, item.spec, item.rawText].filter(Boolean).join(" ").toLowerCase();
    const brand = String(input.brand || "").toLowerCase();
    const brandKo = brand === "michelin" ? "미쉐린" : brand;
    const brandMatch = brand ? text.includes(brand) || text.includes(brandKo) : true;
    const modelMatchCount = modelTokens.filter((token) => text.includes(token)).length;
    const modelMatch = !modelTokens.length || modelMatchCount >= Math.min(2, modelTokens.length);
    const confidence = brandMatch && modelMatch ? "high" : brandMatch || modelMatch ? "medium" : "low";

    return normalizeItem({
      id: `local-타이어픽-${target.side}-${Date.now()}-${index}`,
      platformName: "타이어픽",
      side: target.side,
      sideLabel: target.label,
      productName: cleanProductName(item.productName) || "타이어픽 상품",
      brand: input.brand,
      modelName: input.modelName || input.keyword,
      spec: item.spec || specText,
      unitPrice: item.unitPrice,
      quantity: target.quantity,
      shippingFee: item.shippingFee || 0,
      installationFee: item.installationFee || 0,
      discount: 0,
      installIncluded: item.installIncluded,
      shopName: "타이어픽",
      shopAddress: input.region || "",
      availableDate: item.availableDate || "확인 필요",
      productUrl: item.productUrl,
      collectedAt: new Date().toISOString(),
      confidence,
      memo: "타이어픽 규격 필터 화면에서 추출한 후보입니다. 검색어가 아니라 규격 URL로 앞/뒤를 각각 조회합니다."
    });
  });

  return { blocked: false, items };
}

async function extractDanawaItems(page, input, target) {
  const specText = specToString(target.spec);
  const rawItems = await page.evaluate((currentSpec) => {
    function numberFrom(value) {
      const cleaned = String(value || "").replace(/[^\d]/g, "");
      return cleaned ? Number(cleaned) : undefined;
    }

    function cleanName(value) {
      return String(value || "")
        .replace(/^.*?(?:배송비포함|상세옵션펼침|인기상품순)\s+/i, "")
        .replace(/\s*(?:26\\.\\d{2}|25\\.\\d{2}|24\\.\\d{2}|22\\.\\d{2})\\.?\s*등록.*$/i, "")
        .replace(/\s+/g, " ")
        .trim();
    }

    const text = document.body.innerText.replace(/\s+/g, " ");
    const escaped = currentSpec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`([^\\n]{0,180}?${escaped}[^\\n]{0,260}?)([0-9]{1,3}(?:,[0-9]{3})+)\\s*원`, "gi");
    const items = [];
    const seen = new Set();
    let match;

    while ((match = pattern.exec(text)) && items.length < 12) {
      const rawName = match[1];
      const unitPrice = numberFrom(match[2]);
      if (!unitPrice || unitPrice < 50000) continue;
      if (/검색결과|재검색|검색 상품목록|파워링크|광고 신청/.test(rawName)) continue;
      const productName = cleanName(rawName);
      if (!productName || !productName.includes(currentSpec)) continue;
      const key = `${productName}-${unitPrice}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        productName,
        unitPrice,
        spec: currentSpec,
        shippingFee: /무료배송/.test(match[0]) ? 0 : 0,
        installationFee: /무료장착|전국무료장착|지정점무료장착|출장무료장착/.test(match[0]) ? 0 : 0,
        installIncluded: /무료장착|전국무료장착|지정점무료장착|출장무료장착/.test(match[0]) ? true : undefined,
        availableDate: "확인 필요",
        productUrl: location.href,
        rawText: match[0]
      });
    }

    return {
      blocked: /captcha|캡차|로봇|비정상|접근이 제한|access denied|403|보안문자/i.test(text),
      items
    };
  }, specText);

  if (rawItems.blocked) {
    return { blocked: true, items: [] };
  }

  const modelTokens = String(input.modelName || input.keyword || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length >= 2);

  const items = rawItems.items.map((item, index) => {
    const text = [item.productName, item.spec, item.rawText].filter(Boolean).join(" ").toLowerCase();
    const brand = String(input.brand || "").toLowerCase();
    const brandKo = brand === "michelin" ? "미쉐린" : brand;
    const brandMatch = brand ? text.includes(brand) || text.includes(brandKo) : true;
    const modelMatchCount = modelTokens.filter((token) => text.includes(token)).length;
    const modelMatch = !modelTokens.length || modelMatchCount >= Math.min(2, modelTokens.length);
    const confidence = brandMatch && modelMatch ? "high" : brandMatch || modelMatch ? "medium" : "low";

    return normalizeItem({
      id: `local-다나와-${target.side}-${Date.now()}-${index}`,
      platformName: "다나와",
      side: target.side,
      sideLabel: target.label,
      productName: cleanDanawaProductName(item.productName, specText) || "다나와 상품",
      brand: input.brand,
      modelName: input.modelName || input.keyword,
      spec: item.spec || specText,
      unitPrice: item.unitPrice,
      quantity: target.quantity,
      shippingFee: item.shippingFee || 0,
      installationFee: item.installationFee || 0,
      discount: 0,
      installIncluded: item.installIncluded,
      shopName: "다나와",
      shopAddress: input.region || "",
      availableDate: item.availableDate || "확인 필요",
      productUrl: item.productUrl,
      collectedAt: new Date().toISOString(),
      confidence,
      memo: "다나와 검색 결과 텍스트에서 현재 규격과 가격을 함께 포함한 후보를 추출했습니다."
    });
  });

  return { blocked: false, items };
}

async function extractAbcItems(page, input, target) {
  const specText = specToString(target.spec);
  const compact = specCompact(target.spec);
  const rawItems = await page.evaluate(
    ({ currentSpec, compactSpec }) => {
      function textOf(node) {
        return (node?.innerText || node?.textContent || "").replace(/\s+/g, " ").trim();
      }

      function numberFrom(value) {
        const cleaned = String(value || "").replace(/[^\d]/g, "");
        return cleaned ? Number(cleaned) : undefined;
      }

      function cleanName(value) {
        return String(value || "")
          .replace(/ABC타이어는.*?무료\s*장착/i, "")
          .replace(/\s*(?:장바구니|바로구매|구매하기|상세보기).*$/i, "")
          .replace(/\s+/g, " ")
          .trim();
      }

      const bodyText = textOf(document.body);
      if (/captcha|캡차|로봇|비정상|접근이 제한|access denied|403|보안문자/i.test(bodyText)) {
        return { blocked: true, items: [] };
      }

      const pricePattern = /([0-9]{1,3}(?:,[0-9]{3})+)\s*원/g;
      const hasPricePattern = /[0-9]{1,3}(?:,[0-9]{3})+\s*원/;
      const nodes = Array.from(document.querySelectorAll("a, article, li, section, div"))
        .map((node) => ({ node, text: textOf(node) }))
        .filter(({ text }) => text.length >= 30 && text.length <= 1600)
        .filter(({ text }) => hasPricePattern.test(text));

      const candidates = [];
      const seen = new Set();

      for (const { node, text } of nodes) {
        pricePattern.lastIndex = 0;
        const prices = Array.from(text.matchAll(pricePattern))
          .map((match) => numberFrom(match[1]))
          .filter((price) => price && price >= 50000);
        if (!prices.length) continue;

        const compactText = text.replace(/[^\d]/g, "");
        const specMatch =
          text.includes(currentSpec) ||
          compactText.includes(compactSpec) ||
          bodyText.replace(/[^\d]/g, "").includes(compactSpec);
        if (!specMatch) continue;

        const link = node.querySelector?.("a[href]") || node.closest?.("a[href]");
        const href = link ? new URL(link.getAttribute("href"), location.href).toString() : location.href;
        const nameCandidate = Array.from(node.querySelectorAll?.("h1, h2, h3, strong, a, [class*=name], [class*=title], [class*=product], [class*=goods]") || [])
          .map((candidate) => cleanName(textOf(candidate)))
          .filter((candidate) => candidate.length >= 6)
          .filter((candidate) => !/[0-9]{1,3}(?:,[0-9]{3})+\s*원|배송|장착|후기|리뷰/.test(candidate))
          .sort((a, b) => b.length - a.length)[0];
        const productName = cleanName(nameCandidate || text.slice(0, 120)).slice(0, 140);
        const unitPrice = Math.min(...prices);
        const key = `${productName}-${unitPrice}-${href}`;
        if (seen.has(key)) continue;
        seen.add(key);

        candidates.push({
          productName,
          unitPrice,
          spec: currentSpec,
          shippingFee: /무료\s*배송/.test(text) || /무료\s*배송/.test(bodyText) ? 0 : undefined,
          installationFee: /무료\s*장착/.test(text) || /무료\s*장착/.test(bodyText) ? 0 : undefined,
          installIncluded: /무료\s*장착/.test(text) || /무료\s*장착/.test(bodyText) ? true : undefined,
          availableDate: /품절|일시품절/.test(text) ? "품절" : "확인 필요",
          productUrl: href,
          rawText: text.slice(0, 500)
        });
        if (candidates.length >= 8) break;
      }

      return { blocked: false, items: candidates };
    },
    { currentSpec: specText, compactSpec: compact }
  );

  if (rawItems.blocked) {
    return { blocked: true, items: [] };
  }

  const modelTokens = String(input.modelName || input.keyword || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length >= 2);

  const items = rawItems.items.slice(0, 5).map((item, index) => {
    const text = [item.productName, item.rawText].filter(Boolean).join(" ").toLowerCase();
    const brand = String(input.brand || "").toLowerCase();
    const brandKo = brand === "michelin" ? "미쉐린" : brand;
    const brandMatch = brand ? text.includes(brand) || text.includes(brandKo) : true;
    const modelMatchCount = modelTokens.filter((token) => text.includes(token)).length;
    const modelMatch = !modelTokens.length || modelMatchCount >= Math.min(2, modelTokens.length);
    const confidence = brandMatch && modelMatch ? "high" : brandMatch || modelMatch ? "medium" : "low";

    return normalizeItem({
      id: `local-ABC타이어-${target.side}-${Date.now()}-${index}`,
      platformName: "ABC타이어",
      side: target.side,
      sideLabel: target.label,
      productName: cleanProductName(item.productName) || "ABC타이어 상품",
      brand: input.brand,
      modelName: input.modelName || input.keyword,
      spec: item.spec || specText,
      unitPrice: item.unitPrice,
      quantity: target.quantity,
      shippingFee: item.shippingFee || 0,
      installationFee: item.installationFee || 0,
      discount: 0,
      installIncluded: item.installIncluded,
      shopName: "ABC타이어",
      shopAddress: input.region || "",
      availableDate: item.availableDate || "확인 필요",
      productUrl: item.productUrl,
      collectedAt: new Date().toISOString(),
      confidence,
      memo: "ABC타이어 사이즈 검색 드로어에서 규격을 선택한 뒤 결과 화면의 가격 후보를 추출했습니다."
    });
  }).filter((item) => item.confidence !== "low");

  return { blocked: false, items };
}

async function extractTstationItems(page, input, target) {
  const specText = specToString(target.spec);
  const compact = specCompact(target.spec);
  const rawItems = await page.evaluate(
    ({ currentSpec, compactSpec }) => {
      function textOf(node) {
        return (node?.innerText || node?.textContent || "").replace(/\s+/g, " ").trim();
      }

      function numberFrom(value) {
        const cleaned = String(value || "").replace(/[^\d]/g, "");
        return cleaned ? Number(cleaned) : undefined;
      }

      const bodyText = textOf(document.body);
      if (/captcha|캡차|로봇|비정상|접근이 제한|access denied|403|보안문자/i.test(bodyText)) {
        return { blocked: true, items: [] };
      }

      const pricePattern = /([0-9]{1,3}(?:,[0-9]{3})+)\s*원/g;
      const hasPricePattern = /[0-9]{1,3}(?:,[0-9]{3})+\s*원/;
      const cards = Array.from(document.querySelectorAll(".tire-list-item, [class*=product], [class*=goods], article, li, a, section, div"))
        .map((node) => ({ node, text: textOf(node) }))
        .filter(({ text }) => text.length >= 30 && text.length <= 1800)
        .filter(({ text }) => hasPricePattern.test(text));

      const items = [];
      const seen = new Set();

      for (const { node, text } of cards) {
        pricePattern.lastIndex = 0;
        const prices = Array.from(text.matchAll(pricePattern))
          .map((match) => numberFrom(match[1]))
          .filter((price) => price && price >= 50000);
        if (!prices.length) continue;

        const compactText = text.replace(/[^\d]/g, "");
        const specMatch =
          text.includes(currentSpec) ||
          compactText.includes(compactSpec) ||
          document.querySelector("#tireSizeFr")?.value === compactSpec ||
          document.querySelector("#tireSizeRe")?.value === compactSpec;
        if (!specMatch) continue;

        const link = node.querySelector?.("a[href]") || node.closest?.("a[href]");
        const href = link ? new URL(link.getAttribute("href"), location.href).toString() : location.href;
        const nameCandidates = Array.from(node.querySelectorAll?.("h1, h2, h3, strong, a, [class*=name], [class*=title], [class*=ptrn]") || [])
          .map((candidate) => textOf(candidate))
          .filter((candidate) => candidate.length >= 4)
          .filter((candidate) => !/[0-9]{1,3}(?:,[0-9]{3})+\s*원|주유권|평점|리뷰|브랜드/.test(candidate))
          .sort((a, b) => b.length - a.length);
        const productName = (nameCandidates[0] || text.slice(0, 120)).replace(/\s+/g, " ").trim().slice(0, 140);
        const unitPrice = Math.min(...prices);
        const key = `${productName}-${unitPrice}-${href}`;
        if (seen.has(key)) continue;
        seen.add(key);

        items.push({
          productName,
          unitPrice,
          spec: currentSpec,
          shippingFee: 0,
          installationFee: /장착비\s*별도|장착\s*별도/.test(text) ? undefined : 0,
          installIncluded: /장착비\s*별도|장착\s*별도/.test(text) ? false : undefined,
          availableDate: /품절|일시품절/.test(text) ? "품절" : "확인 필요",
          productUrl: href,
          rawText: text.slice(0, 500)
        });
        if (items.length >= 8) break;
      }

      return { blocked: false, items };
    },
    { currentSpec: specText, compactSpec: compact }
  );

  if (rawItems.blocked) {
    return { blocked: true, items: [] };
  }

  const modelTokens = String(input.modelName || input.keyword || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length >= 2);

  const items = rawItems.items.slice(0, 5).map((item, index) => {
    const text = [item.productName, item.rawText].filter(Boolean).join(" ").toLowerCase();
    const brand = String(input.brand || "").toLowerCase();
    const brandKo = brand === "michelin" ? "미쉐린" : brand;
    const brandMatch = brand ? text.includes(brand) || text.includes(brandKo) : true;
    const modelMatchCount = modelTokens.filter((token) => text.includes(token)).length;
    const modelMatch = !modelTokens.length || modelMatchCount >= Math.min(2, modelTokens.length);
    const confidence = brandMatch && modelMatch ? "high" : brandMatch || modelMatch ? "medium" : "low";

    return normalizeItem({
      id: `local-티스테이션-${target.side}-${Date.now()}-${index}`,
      platformName: "티스테이션",
      side: target.side,
      sideLabel: target.label,
      productName: cleanProductName(item.productName) || "티스테이션 상품",
      brand: input.brand,
      modelName: input.modelName || input.keyword,
      spec: item.spec || specText,
      unitPrice: item.unitPrice,
      quantity: target.quantity,
      shippingFee: item.shippingFee || 0,
      installationFee: item.installationFee || 0,
      discount: 0,
      installIncluded: item.installIncluded,
      shopName: "티스테이션",
      shopAddress: input.region || "",
      availableDate: item.availableDate || "확인 필요",
      productUrl: item.productUrl,
      collectedAt: new Date().toISOString(),
      confidence,
      memo: "티스테이션 사이즈 검색 상태에서 가격이 노출된 경우 추출합니다. 가격 미노출 시 열린 브라우저에서 매장/차량 확인이 필요합니다."
    });
  }).filter((item) => item.confidence !== "low");

  return { blocked: false, items };
}

async function extractVisibleItems(page, platformName, input, target) {
  if (platformName === "다나와") {
    return extractDanawaItems(page, input, target);
  }

  if (platformName === "타이어픽") {
    return extractTirepickItems(page, input, target);
  }

  if (platformName === "ABC타이어") {
    return extractAbcItems(page, input, target);
  }

  if (platformName === "티스테이션") {
    return extractTstationItems(page, input, target);
  }

  const rawItems = await page.evaluate(() => {
    const pricePattern = /(?:판매가|혜택가|최저가|가격)?\s*([0-9]{1,3}(?:,[0-9]{3})+)\s*원/;
    const blockedPattern = /captcha|캡차|로봇|비정상|접근이 제한|access denied|403|보안문자/i;

    function textOf(node) {
      return (node?.innerText || node?.textContent || "").replace(/\s+/g, " ").trim();
    }

    function numberFrom(value) {
      const cleaned = String(value || "").replace(/[^\d]/g, "");
      return cleaned ? Number(cleaned) : undefined;
    }

    function bestAncestor(node) {
      let current = node;
      for (let depth = 0; current && depth < 7; depth += 1) {
        const text = textOf(current);
        const link = current.querySelector?.("a[href]");
        if (link && text.length > 35 && text.length < 1800) return current;
        current = current.parentElement;
      }
      return node.parentElement || node;
    }

    const bodyText = textOf(document.body);
    if (blockedPattern.test(bodyText)) {
      return { blocked: true, items: [] };
    }

    const candidates = [];
    const seen = new Set();
    const textNodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (pricePattern.test(node.nodeValue || "")) textNodes.push(node.parentElement);
      if (textNodes.length > 120) break;
    }

    for (const priceNode of textNodes) {
      const card = bestAncestor(priceNode);
      const text = textOf(card);
      const price = numberFrom(text.match(pricePattern)?.[1]);
      if (!price || price < 50000) continue;

      const link = card.querySelector("a[href]");
      const href = link ? new URL(link.getAttribute("href"), location.href).toString() : location.href;
      const nameCandidates = Array.from(card.querySelectorAll("a, h2, h3, strong, [class*=name], [class*=title], [class*=goods], [class*=prod]"))
        .map((candidate) => textOf(candidate).replace(pricePattern, "").trim())
        .filter((candidate) => candidate.length >= 10)
        .filter((candidate) => !/무이자|카드|쿠폰|배송비|할인|혜택|렌탈|타이어\s*교체/.test(candidate))
        .sort((a, b) => b.length - a.length);
      const productName = (nameCandidates[0] || text.slice(0, 120)).slice(0, 140);
      const key = `${productName}-${price}-${href}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const shippingFree = /무료배송|배송비\s*무료/.test(text);
      const shippingFee = shippingFree ? 0 : numberFrom(text.match(/배송비\s*([0-9,]+)\s*원/)?.[1]);
      const installIncluded = /무료장착|장착비\s*포함|전국장착|장착\s*포함/.test(text)
        ? true
        : /장착비\s*별도|장착\s*별도/.test(text)
          ? false
          : undefined;
      const installationFee = installIncluded === true ? 0 : numberFrom(text.match(/장착비\s*([0-9,]+)\s*원/)?.[1]);
      const availableDate = /품절|일시품절/.test(text) ? "품절" : /오늘|내일|예약|장착가능/.test(text) ? "확인 가능" : "확인 필요";
      const spec = text.match(/\d{3}\s*\/\s*\d{2}\s*(?:ZR|R)?\s*\d{2}/i)?.[0]?.replace(/\s+/g, "") || "";

      candidates.push({
        productName,
        unitPrice: price,
        shippingFee,
        installationFee,
        installIncluded,
        availableDate,
        productUrl: href,
        spec,
        rawText: text.slice(0, 500)
      });
      if (candidates.length >= 8) break;
    }

    return { blocked: false, items: candidates };
  });

  if (rawItems.blocked) {
    return { blocked: true, items: [] };
  }

  const specText = specToString(target.spec);
  const items = rawItems.items.slice(0, 5).map((item, index) => {
    const text = [item.productName, item.spec, item.rawText].filter(Boolean).join(" ").toLowerCase();
    const brand = String(input.brand || "").toLowerCase();
    const modelTokens = String(input.modelName || input.keyword || "")
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token.length >= 2);
    const specMatch =
      text.includes(specText.toLowerCase()) ||
      text.replace(/[^\d]/g, "").includes(specCompact(target.spec));
    const brandMatch = brand ? text.includes(brand) : true;
    const modelMatchCount = modelTokens.filter((token) => text.includes(token)).length;
    const modelMatch = !modelTokens.length || modelMatchCount >= Math.min(2, modelTokens.length);
    const confidence = specMatch && brandMatch && modelMatch ? "high" : specMatch || modelMatch ? "medium" : "low";

    if (item.unitPrice < 50000) return null;
    const compactSpec = specCompact(target.spec);
    const hasSpecOrModel = text.replace(/[^\d]/g, "").includes(compactSpec) || modelMatch;
    if (!hasSpecOrModel) return null;
    if (/무이자|카드|렌탈|타이어\s*교체/.test(item.productName) && !modelMatch) return null;

    return normalizeItem({
      id: `local-${platformName}-${Date.now()}-${index}`,
      platformName,
      side: target.side,
      sideLabel: target.label,
      productName: cleanProductName(item.productName) || `${platformName} 상품`,
      brand: input.brand,
      modelName: input.modelName || input.keyword,
      spec: item.spec || specText,
      unitPrice: item.unitPrice,
      quantity: target.quantity,
      shippingFee: item.shippingFee || 0,
      installationFee: item.installationFee || 0,
      discount: 0,
      installIncluded: item.installIncluded,
      shopName: platformName,
      shopAddress: input.region || "",
      availableDate: item.availableDate || "확인 필요",
      productUrl: item.productUrl,
      collectedAt: new Date().toISOString(),
      confidence,
      memo: "로컬 Playwright 브라우저 화면에서 보이는 텍스트를 추출한 후보입니다. 상세 조건은 열린 브라우저에서 확인하세요."
    });
  }).filter(Boolean);

  return { blocked: false, items };
}

function lowestByTotal(items) {
  const priced = items.filter((item) => Number(item.unitPrice) > 0);
  if (!priced.length) return null;
  const candidates = priced.some((item) => item.availableDate !== "품절")
    ? priced.filter((item) => item.availableDate !== "품절")
    : priced;
  return candidates.reduce((lowest, item) => {
    const currentTotal = Number(item.unitPrice || 0) * Number(item.quantity || 0) + Number(item.shippingFee || 0) + Number(item.installationFee || 0);
    const lowestTotal = Number(lowest.unitPrice || 0) * Number(lowest.quantity || 0) + Number(lowest.shippingFee || 0) + Number(lowest.installationFee || 0);
    return currentTotal < lowestTotal ? item : lowest;
  }, candidates[0]);
}

function combinedInstallIncluded(front, rear) {
  if (front?.installIncluded === false || rear?.installIncluded === false) return false;
  if (front?.installIncluded === true && (!rear || rear.installIncluded === true)) return true;
  return undefined;
}

function combinedConfidence(front, rear) {
  const values = [front?.confidence, rear?.confidence].filter(Boolean);
  if (values.includes("low")) return "low";
  if (values.includes("medium")) return "medium";
  return "high";
}

function combinePlatformItems(platformName, input, collected, searchUrls) {
  const frontTarget = collected.front;
  const rearTarget = collected.rear;
  const front = lowestByTotal(frontTarget?.items || []);
  const rear = rearTarget ? lowestByTotal(rearTarget.items || []) : null;

  if (!front || (rearTarget && !rear)) {
    const missing = [
      !front ? "앞 규격 후보 없음" : "",
      rearTarget && !rear ? "뒤 규격 후보 없음" : ""
    ]
      .filter(Boolean)
      .join(" / ");
    const available = front || rear;
    if (available) {
      const frontQuantity = Number(input.frontQuantity || 0);
      const rearQuantity = Number(input.rearQuantity || 0);
      return {
        items: [
          {
            id: `local-partial-set-${platformName}-${Date.now()}`,
            platformName,
            productName: [
              front ? `앞 ${cleanProductName(front.productName)}` : "앞 후보 없음",
              rear ? `뒤 ${cleanProductName(rear.productName)}` : "뒤 후보 없음"
            ].join(" / "),
            brand: input.brand,
            modelName: input.modelName || input.keyword,
            spec: `앞 ${specToString(input.frontSpec)} x ${frontQuantity} / 뒤 ${specToString(input.rearSpec)} x ${rearQuantity}`,
            unitPrice: available.unitPrice,
            quantity: frontQuantity + rearQuantity,
            shippingFee: Number(front?.shippingFee || 0) + Number(rear?.shippingFee || 0),
            installationFee: Number(front?.installationFee || 0) + Number(rear?.installationFee || 0),
            discount: 0,
            totalPrice: undefined,
            installIncluded: combinedInstallIncluded(front, rear),
            shopName: platformName,
            shopAddress: input.region || "",
            availableDate: [front?.availableDate, rear?.availableDate].filter(Boolean).join(" / ") || "확인 필요",
            productUrl: front?.productUrl || rear?.productUrl,
            frontUnitPrice: front?.unitPrice,
            rearUnitPrice: rear?.unitPrice,
            frontQuantity,
            rearQuantity,
            frontSpec: specToString(input.frontSpec),
            rearSpec: specToString(input.rearSpec),
            frontProductName: front?.productName || "후보 없음",
            rearProductName: rear?.productName || "후보 없음",
            frontProductUrl: front?.productUrl,
            rearProductUrl: rear?.productUrl,
            frontTotal: front ? Number(front.unitPrice || 0) * frontQuantity : undefined,
            rearTotal: rear ? Number(rear.unitPrice || 0) * rearQuantity : undefined,
            incompleteSet: true,
            missingSide: !front ? "front" : "rear",
            collectedAt: new Date().toISOString(),
            confidence: "low",
            memo: `${missing}. 가능한 규격만 표시했습니다. 누락된 규격은 열린 브라우저에서 직접 확인해 수동 보정하세요.`
          }
        ],
        errorMessage: missing || "4본 조합에 필요한 후보가 부족합니다."
      };
    }
    return {
      items: [],
      errorMessage: missing || "4본 조합에 필요한 후보가 부족합니다."
    };
  }

  const effectiveRear = rear || front;
  const frontQuantity = Number(front.quantity || input.frontQuantity || 0);
  const rearQuantity = Number(effectiveRear.quantity || input.rearQuantity || 0);
  const frontSubtotal = Number(front.unitPrice || 0) * frontQuantity;
  const rearSubtotal = Number(effectiveRear.unitPrice || 0) * rearQuantity;
  const shippingFee = Number(front.shippingFee || 0) + Number(effectiveRear.shippingFee || 0);
  const installationFee = Number(front.installationFee || 0) + Number(effectiveRear.installationFee || 0);
  const totalQuantity = frontQuantity + rearQuantity;
  const totalPrice = frontSubtotal + rearSubtotal + shippingFee + installationFee;
  const same = sameSpec(input.frontSpec, input.rearSpec);

  return {
    items: [
      {
        id: `local-set-${platformName}-${Date.now()}`,
        platformName,
        productName: same
          ? `${cleanProductName(front.productName)} ${totalQuantity}본`
          : `앞 ${cleanProductName(front.productName)} / 뒤 ${cleanProductName(effectiveRear.productName)}`,
        brand: input.brand,
        modelName: input.modelName || input.keyword,
        spec: same
          ? `${specToString(input.frontSpec)} x ${totalQuantity}본`
          : `앞 ${specToString(input.frontSpec)} x ${frontQuantity} / 뒤 ${specToString(input.rearSpec)} x ${rearQuantity}`,
        unitPrice: totalQuantity ? Math.round(totalPrice / totalQuantity) : 0,
        quantity: totalQuantity,
        shippingFee,
        installationFee,
        discount: 0,
        totalPrice,
        installIncluded: combinedInstallIncluded(front, effectiveRear),
        shopName: platformName,
        shopAddress: input.region || "",
        availableDate: [front.availableDate, effectiveRear.availableDate].filter(Boolean).join(" / ") || "확인 필요",
        productUrl: front.productUrl,
        frontUnitPrice: front.unitPrice,
        rearUnitPrice: effectiveRear.unitPrice,
        frontQuantity,
        rearQuantity,
        frontSpec: specToString(input.frontSpec),
        rearSpec: specToString(input.rearSpec),
        frontProductName: front.productName,
        rearProductName: effectiveRear.productName,
        frontProductUrl: front.productUrl,
        rearProductUrl: effectiveRear.productUrl,
        frontTotal: frontSubtotal,
        rearTotal: rearSubtotal,
        collectedAt: new Date().toISOString(),
        confidence: combinedConfidence(front, effectiveRear),
        memo: `앞/뒤 규격을 각각 검색한 뒤 최저 후보를 조합한 4본 합계입니다. 앞 검색: ${searchUrls.front || "-"} / 뒤 검색: ${searchUrls.rear || "-"}`
      }
    ]
  };
}

async function collectSpecTarget(context, platform, input, target) {
  const page = await context.newPage();
  let searchUrl = platform.homeUrl;

  try {
    searchUrl = await openSearchPage(page, platform, input, target);
    const extracted = await extractVisibleItems(page, platform.platformName, input, target);

    if (extracted.blocked) {
      return {
        searchUrl,
        items: [],
        errorMessage: `${target.label} 규격 캡차/접근 제한 화면이 감지되었습니다. 열린 브라우저에서 직접 확인하세요.`,
        keepOpen: true
      };
    }

    if (!extracted.items.length) {
      return {
        searchUrl,
        items: [],
        errorMessage: `${target.label} 규격 자동 추출 후보가 없습니다. 열린 브라우저에서 결과 화면을 직접 확인하세요.`,
        keepOpen: true
      };
    }

    await page.close();
    return {
      searchUrl,
      items: extracted.items,
      keepOpen: false
    };
  } catch (error) {
    return {
      searchUrl,
      items: [],
      errorMessage: `${target.label} 규격 ${error.name === "TimeoutError" ? "브라우저 응답 시간 초과" : error.message}. 열린 브라우저에서 직접 확인하세요.`,
      keepOpen: true
    };
  }
}

async function collectPlatform(context, platform, input) {
  const collected = {};
  const searchUrls = {};
  const errors = [];
  let keepOpen = false;
  const targets = specTargets(input);

  for (const target of targets) {
    const result = await collectSpecTarget(context, platform, input, target);
    collected[target.side] = result;
    searchUrls[target.side] = result.searchUrl;
    keepOpen = keepOpen || result.keepOpen;
    if (result.errorMessage) errors.push(result.errorMessage);
  }

  const combined = combinePlatformItems(platform.platformName, input, collected, searchUrls);
  const items = combined.items || [];
  const status = items.length ? (errors.length ? "partial" : "success") : "manual_required";
  const errorMessage = [combined.errorMessage, ...errors].filter(Boolean).join(" / ") || undefined;

  return {
    result: siteResult(platform.platformName, searchUrls.front || searchUrls.rear || platform.homeUrl, status, items, errorMessage),
    keepOpen: keepOpen || !items.length
  };
}

async function main() {
  const { inputPath, outputPath, jobPath } = parseArgs();
  const input = JSON.parse(await readFile(inputPath, "utf8"));

  await writeJob(jobPath, {
    status: "running",
    message: "로컬 브라우저 자동화를 시작했습니다.",
    outputPath
  });

  let context;
  let channel = "";
  let userDataDir = "";
  const results = [];
  let hasManualPages = false;

  try {
    const launched = await launchContext();
    context = launched.context;
    channel = launched.channel;
    userDataDir = launched.userDataDir;

    const targetPlatforms = selectedPlatforms(input);
    for (const platform of targetPlatforms) {
      await writeJob(jobPath, {
        status: "running",
        message: `${platform.platformName} 수집 중`,
        outputPath,
        partialResults: results
      });
      const { result, keepOpen } = await collectPlatform(context, platform, input);
      results.push(result);
      hasManualPages = hasManualPages || keepOpen;
    }

    const payload = {
      collectedAt: new Date().toISOString(),
      mode: "local-playwright",
      input,
      browser: {
        channel,
        userDataDir,
        keepOpenOnFailureMs: hasManualPages ? Number(process.env.TIRE_KEEP_BROWSER_OPEN_MS || DEFAULT_KEEP_OPEN_MS) : 0
      },
      results
    };

    await writeJson(outputPath, payload);
    await writeJob(jobPath, {
      status: "completed",
      message: hasManualPages ? "수집 완료. 확인이 필요한 사이트 탭은 잠시 열린 상태로 유지됩니다." : "수집 완료.",
      outputPath,
      results
    });

    if (hasManualPages) {
      await new Promise((resolveWait) => setTimeout(resolveWait, Number(process.env.TIRE_KEEP_BROWSER_OPEN_MS || DEFAULT_KEEP_OPEN_MS)));
    }
  } catch (error) {
    await writeJob(jobPath, {
      status: "failed",
      message: error.message,
      outputPath,
      results
    });
    throw error;
  } finally {
    await context?.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
