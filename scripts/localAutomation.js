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
    searchUrl: (query) => `https://abctire.co.kr/tire-search?keyword=${encodeURIComponent(query)}`
  },
  {
    platformName: "티스테이션",
    homeUrl: "https://www.tstation.com/",
    searchUrl: (_query, _input, target) => `https://www.tstation.com/tire/sizes?front=${specCompact(target.spec)}`
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

function selectedPlatforms() {
  const limit = String(process.env.TIRE_PLATFORM_LIMIT || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!limit.length) return platforms;
  return platforms.filter((platform) => limit.includes(platform.platformName));
}

function specCompact(spec) {
  return `${spec.width}${spec.aspectRatio}${spec.rim}`;
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
  const query = queryFor(input, target.spec);
  const targetUrl = platform.searchUrl(query, input, target);
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2500);
  await dismissPopups(page);
  return targetUrl;
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
    const escaped = currentSpec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`((?:품절\\s+|일시품절\\s+)?[가-힣A-Za-z0-9 .™'()*\\[\\]/_+-]{8,180}?)\\s+${escaped}\\s+([0-9]{1,3}(?:,[0-9]{3})+)원`, "g");
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

async function extractVisibleItems(page, platformName, input, target) {
  if (platformName === "타이어픽") {
    return extractTirepickItems(page, input, target);
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

    for (const platform of selectedPlatforms()) {
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
