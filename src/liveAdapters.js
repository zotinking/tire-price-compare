import { normalizeItem, specToString } from "./price.js";

const DEFAULT_TIMEOUT_MS = 12000;

const platformDefinitions = [
  {
    platformName: "다나와",
    baseUrl: "https://search.danawa.com/dsearch.php",
    query: "query"
  },
  {
    platformName: "타이어픽",
    baseUrl: "https://www.tire-pick.com/search",
    query: "keyword"
  },
  {
    platformName: "ABC타이어",
    baseUrl: "https://www.abctire.co.kr/search",
    query: "keyword"
  },
  {
    platformName: "티스테이션",
    baseUrl: "https://www.tstation.com/search",
    query: "keyword"
  },
  {
    platformName: "타이어프로",
    baseUrl: "https://www.tirepro.co.kr/search",
    query: "keyword"
  },
  {
    platformName: "넥센 넥스트레벨",
    baseUrl: "https://www.nexentire.com/kr/search",
    query: "q"
  },
  {
    platformName: "네이버 쇼핑",
    baseUrl: "https://search.shopping.naver.com/search/all",
    query: "query"
  },
  {
    platformName: "11번가",
    baseUrl: "https://search.11st.co.kr/Search.tmall",
    query: "kwd"
  },
  {
    platformName: "G마켓",
    baseUrl: "https://browse.gmarket.co.kr/search",
    query: "keyword"
  },
  {
    platformName: "옥션",
    baseUrl: "https://browse.auction.co.kr/search",
    query: "keyword"
  },
  {
    platformName: "쿠팡",
    baseUrl: "https://www.coupang.com/np/search",
    query: "q"
  }
];

function searchKeyword(input, spec) {
  return [input.brand, input.modelName || input.keyword, specToString(spec), input.region].filter(Boolean).join(" ");
}

function buildSearchUrl(platform, input, spec = input.frontSpec) {
  const url = new URL(platform.baseUrl);
  url.searchParams.set(platform.query, searchKeyword(input, spec));
  return url.toString();
}

function stripTags(html) {
  return decodeHtml(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function numberFromPrice(value) {
  const cleaned = String(value || "").replace(/[^\d]/g, "");
  return cleaned ? Number(cleaned) : undefined;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.6,en;q=0.4",
        "user-agent": "Mozilla/5.0 (compatible; TirePriceCompareMVP/0.2; +https://github.com/zotinking/tire-price-compare)"
      }
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "accept": "application/json, text/plain, */*",
        "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.6,en;q=0.4",
        "origin": "https://www.tire-pick.com",
        "referer": "https://www.tire-pick.com/",
        "user-agent": "Mozilla/5.0 (compatible; TirePriceCompareMVP/0.2; +https://github.com/zotinking/tire-price-compare)"
      }
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { ok: response.ok, status: response.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

function parseDanawaItems(html, input, spec, quantity, searchUrl) {
  const chunks = html.split(/<li[^>]+class="[^"]*prod_item[^"]*"[^>]*>/i).slice(1);

  return chunks
    .map((chunk, index) => {
      const minPrice = numberFromPrice(chunk.match(/id="min_price_\d+"\s+value="(\d+)"/i)?.[1]);
      const price = minPrice || numberFromPrice(chunk.match(/<p class="price_sect"[\s\S]*?<strong>([\d,]+)<\/strong>\s*원/i)?.[1]);
      const nameHtml = chunk.match(/<p class="prod_name"[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1] || "";
      const productName = stripTags(nameHtml);
      const productUrl = decodeHtml(chunk.match(/<p class="prod_name"[\s\S]*?<a\b[^>]*href="([^"]+)"/i)?.[1] || "");
      const specText = specToString(spec);
      const normalizedName = productName.toLowerCase();
      const modelTokens = String(input.modelName || input.keyword || "")
        .toLowerCase()
        .split(/\s+/)
        .filter((token) => token.length >= 2);
      const specMatch = productName.includes(specText);
      const modelMatchCount = modelTokens.filter((token) => normalizedName.includes(token)).length;
      const confidence = specMatch && modelMatchCount >= Math.min(2, modelTokens.length) ? "medium" : "low";

      if (!price || !productName) return null;

      return normalizeItem({
        id: `danawa-live-${specText}-${index}`,
        platformName: "다나와",
        productName,
        brand: input.brand,
        modelName: input.modelName || input.keyword,
        spec: specText,
        unitPrice: price,
        quantity,
        shippingFee: 0,
        installationFee: 0,
        discount: 0,
        installIncluded: undefined,
        shopName: "다나와 검색 결과",
        shopAddress: input.region || "",
        availableDate: "확인 필요",
        productUrl: productUrl || searchUrl,
        collectedAt: new Date().toISOString(),
        confidence,
        memo: "다나와 공개 검색 HTML에서 추출한 후보 가격입니다. 상세 페이지에서 장착비/배송비를 확인하세요."
      });
    })
    .filter(Boolean)
    .slice(0, 2);
}

async function fetchDanawa(input) {
  const platform = platformDefinitions.find((item) => item.platformName === "다나와");
  const specs = [
    { spec: input.frontSpec, quantity: input.frontQuantity || 2, label: "앞" },
    input.rearSpec ? { spec: input.rearSpec, quantity: input.rearQuantity || 2, label: "뒤" } : null
  ].filter(Boolean);

  const items = [];
  const errors = [];
  let searchUrl = buildSearchUrl(platform, input, input.frontSpec);

  for (const target of specs) {
    const targetUrl = buildSearchUrl(platform, input, target.spec);
    searchUrl = targetUrl;
    try {
      const response = await fetchText(targetUrl);
      if (!response.ok) {
        errors.push(`${target.label} 규격 HTTP ${response.status}`);
        continue;
      }
      const parsed = parseDanawaItems(response.text, input, target.spec, target.quantity, targetUrl);
      if (!parsed.length) {
        errors.push(`${target.label} 규격 가격 후보 없음`);
      }
      items.push(...parsed);
    } catch (error) {
      errors.push(`${target.label} 규격 ${error.name === "AbortError" ? "시간 초과" : error.message}`);
    }
  }

  if (items.length) {
    return {
      platformName: "다나와",
      searchUrl,
      status: errors.length ? "partial" : "success",
      items,
      errorMessage: errors.length ? errors.join(" / ") : undefined
    };
  }

  return {
    platformName: "다나와",
    searchUrl,
    status: "failed",
    items: [],
    errorMessage: errors.join(" / ") || "공개 검색 페이지에서 가격 후보를 찾지 못했습니다."
  };
}

function scoreTirepickRow(row, input, spec) {
  const haystack = [
    row.productName,
    row.productModelNo,
    row.productCompany,
    row.productBrand?.productBrandName,
    row.productIntroduction,
    row.productSpecTireSize
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const specMatch = row.productSpecTireSize === specToString(spec);
  const brand = String(input.brand || "").trim().toLowerCase();
  const brandMatch = brand ? haystack.includes(brand) || haystack.includes(translateBrand(brand)) : true;
  const modelTokens = String(input.modelName || input.keyword || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length >= 2);
  const modelMatchCount = modelTokens.filter((token) => haystack.includes(token)).length;
  const modelMatch = !modelTokens.length || modelMatchCount >= Math.min(2, modelTokens.length);

  if (specMatch && brandMatch && modelMatch) return { score: 3, confidence: "high" };
  if (specMatch && modelMatch) return { score: 2, confidence: "medium" };
  if (specMatch && brandMatch && !modelTokens.length) return { score: 2, confidence: "medium" };
  if (specMatch) return { score: 1, confidence: "low" };
  return { score: 0, confidence: "low" };
}

function translateBrand(brand) {
  const map = {
    michelin: "미쉐린",
    hankook: "한국타이어",
    kumho: "금호",
    nexen: "넥센",
    pirelli: "피렐리",
    continental: "콘티넨탈",
    bridgestone: "브리지스톤",
    goodyear: "굿이어"
  };
  return map[brand] || brand;
}

function buildTirepickApiUrl(spec) {
  const url = new URL("https://apiprod.tire-pick.com/v3/products");
  url.searchParams.set("productCategoryName", "타이어");
  url.searchParams.set("width", spec.width);
  url.searchParams.set("aspectRatio", spec.aspectRatio);
  url.searchParams.set("inch", spec.rim);
  return url.toString();
}

function buildTirepickSearchUrl(input, spec) {
  const url = new URL("https://www.tire-pick.com/search");
  url.searchParams.set("keyword", searchKeyword(input, spec));
  return url.toString();
}

function parseTirepickRows(rows, input, spec, quantity) {
  const scored = rows
    .map((row) => ({ row, ...scoreTirepickRow(row, input, spec) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (Number(a.row.isSoldOut) !== Number(b.row.isSoldOut)) return Number(a.row.isSoldOut) - Number(b.row.isSoldOut);
      return Number(a.row.exposurePrice || a.row.salePrice || 0) - Number(b.row.exposurePrice || b.row.salePrice || 0);
    });

  const hasModelMatch = scored.some((item) => item.score >= 2);
  const candidates = (hasModelMatch ? scored.filter((item) => item.score >= 2) : scored).slice(0, 3);

  return candidates
    .map(({ row, confidence }, index) => {
      const unitPrice = numberFromPrice(row.exposurePrice || row.salePrice);
      if (!unitPrice) return null;
      const productUrl = `https://www.tire-pick.com/tire/${row.id}`;
      const availability = row.isSoldOut ? "품절" : "구매 가능";
      const matchNote =
        confidence === "low"
          ? "입력한 브랜드/모델과 직접 일치하지 않는 같은 규격 후보입니다."
          : "입력한 규격과 브랜드/모델 단서를 기준으로 매칭한 후보입니다.";

      return normalizeItem({
        id: `tirepick-live-${row.id}-${index}`,
        platformName: "타이어픽",
        productName: row.productName || row.productModelNo || "타이어픽 상품",
        brand: row.productBrand?.productBrandName || row.productCompany || input.brand,
        modelName: row.productModelNo || input.modelName || input.keyword,
        spec: row.productSpecTireSize || specToString(spec),
        unitPrice,
        quantity,
        shippingFee: 0,
        installationFee: 0,
        discount: 0,
        installIncluded: undefined,
        shopName: "타이어픽",
        shopAddress: input.region || "",
        availableDate: availability,
        productUrl,
        collectedAt: new Date().toISOString(),
        confidence,
        memo: `타이어픽 공개 API에서 추출한 후보 가격입니다. ${matchNote} 장착비/옵션 비용은 상세 페이지에서 확인하세요.`
      });
    })
    .filter(Boolean);
}

async function fetchTirepick(input) {
  const specs = [
    { spec: input.frontSpec, quantity: input.frontQuantity || 2, label: "앞" },
    input.rearSpec ? { spec: input.rearSpec, quantity: input.rearQuantity || 2, label: "뒤" } : null
  ].filter(Boolean);

  const items = [];
  const errors = [];
  let searchUrl = buildTirepickSearchUrl(input, input.frontSpec);

  for (const target of specs) {
    const apiUrl = buildTirepickApiUrl(target.spec);
    searchUrl = buildTirepickSearchUrl(input, target.spec);
    try {
      const response = await fetchJson(apiUrl);
      if (!response.ok) {
        errors.push(`${target.label} 규격 HTTP ${response.status}`);
        continue;
      }
      const rows = Array.isArray(response.json?.rows) ? response.json.rows : [];
      if (!rows.length) {
        errors.push(`${target.label} 규격 가격 후보 없음`);
        continue;
      }
      const parsed = parseTirepickRows(rows, input, target.spec, target.quantity);
      if (!parsed.length) {
        errors.push(`${target.label} 규격 매칭 후보 없음`);
      }
      items.push(...parsed);
    } catch (error) {
      errors.push(`${target.label} 규격 ${error.name === "AbortError" ? "시간 초과" : error.message}`);
    }
  }

  if (items.length) {
    const hasOnlyLowConfidence = items.every((item) => item.confidence === "low");
    return {
      platformName: "타이어픽",
      searchUrl,
      status: errors.length || hasOnlyLowConfidence ? "partial" : "success",
      items,
      errorMessage: errors.length
        ? errors.join(" / ")
        : hasOnlyLowConfidence
          ? "같은 규격 후보는 찾았지만 입력한 브랜드/모델과 직접 일치하지 않습니다."
          : undefined
    };
  }

  return {
    platformName: "타이어픽",
    searchUrl,
    status: "failed",
    items: [],
    errorMessage: errors.join(" / ") || "타이어픽 공개 API에서 가격 후보를 찾지 못했습니다."
  };
}

async function probeBlockedPlatform(platformName, input) {
  const platform = platformDefinitions.find((item) => item.platformName === platformName);
  const searchUrl = buildSearchUrl(platform, input);

  try {
    const response = await fetchText(searchUrl);
    if ([401, 403, 418, 429].includes(response.status)) {
      return {
        platformName,
        searchUrl,
        status: "blocked",
        items: [],
        errorMessage: `공개 서버 요청이 HTTP ${response.status}로 차단되었습니다.`
      };
    }
  } catch (error) {
    return {
      platformName,
      searchUrl,
      status: error.name === "AbortError" ? "failed" : "blocked",
      items: [],
      errorMessage: error.name === "AbortError" ? "공개 페이지 응답 시간이 초과되었습니다." : error.message
    };
  }

  return {
    platformName,
    searchUrl,
    status: "manual_required",
    items: [],
    errorMessage: "현재 adapter는 가격 파싱을 지원하지 않습니다. 링크에서 직접 확인하세요."
  };
}

function unsupportedResult(platform, input, message = "아직 실제 수집 adapter가 없습니다. 검색 링크에서 직접 확인하세요.") {
  return {
    platformName: platform.platformName,
    searchUrl: buildSearchUrl(platform, input),
    status: "unsupported",
    items: [],
    errorMessage: message
  };
}

export async function fetchLivePrices(input) {
  const results = [];
  results.push(await fetchDanawa(input));
  results.push(await fetchTirepick(input));
  results.push(await probeBlockedPlatform("네이버 쇼핑", input));

  const handled = new Set(["다나와", "타이어픽", "네이버 쇼핑"]);
  for (const platform of platformDefinitions) {
    if (handled.has(platform.platformName)) continue;
    results.push(unsupportedResult(platform, input));
  }

  return results;
}
