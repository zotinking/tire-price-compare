import { normalizeItem, specToString } from "./price.js";

export const fetchStatuses = {
  success: "자동 수집 성공",
  partial: "부분 수집",
  failed: "수집 실패",
  manual_required: "사용자 확인 필요",
  blocked: "접근 제한 의심",
  unsupported: "미구현",
  collecting: "수집 중"
};

const platforms = [
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
    baseUrl: "https://abctire.co.kr/tire-search",
    query: "keyword"
  },
  {
    platformName: "티스테이션",
    baseUrl: "https://www.tstation.com/tire/sizes",
    query: "search"
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
    baseUrl: "https://www.gmarket.co.kr/",
    query: "keyword"
  },
  {
    platformName: "옥션",
    baseUrl: "https://browse.auction.co.kr/search",
    query: "keyword"
  }
];

function searchKeyword(input) {
  return [input.brand, input.modelName || input.keyword, specToString(input.frontSpec)]
    .filter(Boolean)
    .join(" ");
}

function platformByName(platformName) {
  return platforms.find((platform) => platform.platformName === platformName);
}

export function buildSearchUrl(platform, input) {
  if (platform.platformName === "G마켓") {
    return platform.baseUrl;
  }
  const url = new URL(platform.baseUrl);
  url.searchParams.set(platform.query, searchKeyword(input));
  return url.toString();
}

function item(id, platformName, input, values) {
  return normalizeItem({
    id,
    platformName,
    productName: `${input.brand || "Michelin"} ${input.modelName || input.keyword}`,
    brand: input.brand,
    modelName: input.modelName || input.keyword,
    spec: values.spec || specToString(input.frontSpec),
    quantity: values.quantity || input.frontQuantity,
    collectedAt: new Date().toISOString(),
    ...values
  });
}

function mockFor(platformName, input) {
  const front = specToString(input.frontSpec);
  const rear = specToString(input.rearSpec);

  const map = {
    "다나와": {
      status: "partial",
      items: [
        item("danawa-front", platformName, input, {
          spec: front,
          unitPrice: 278000,
          shippingFee: 0,
          installationFee: 52000,
          discount: 18000,
          installIncluded: false,
          shopName: "수원 타이어 장착센터",
          shopAddress: "경기 수원시 권선구",
          availableDate: "내일",
          productUrl: buildSearchUrl(platforms[0], input),
          confidence: "low",
          memo: "MVP 예시 가격입니다. 링크에서 현재가를 확인해 수동 보정하세요."
        }),
        item("danawa-rear", platformName, input, {
          spec: rear,
          quantity: input.rearQuantity,
          unitPrice: 304000,
          shippingFee: 0,
          installationFee: 56000,
          discount: 18000,
          installIncluded: false,
          shopName: "수원 타이어 장착센터",
          shopAddress: "경기 수원시 권선구",
          availableDate: "내일",
          productUrl: buildSearchUrl(platforms[0], input),
          confidence: "low",
          memo: "MVP 예시 가격입니다. 실제 상세가와 다를 수 있습니다."
        })
      ]
    },
    "타이어픽": {
      status: "partial",
      items: [
        item("tirepick-set", platformName, input, {
          spec: `${front} / ${rear}`,
          quantity: input.frontQuantity + input.rearQuantity,
          unitPrice: 292500,
          shippingFee: 0,
          installationFee: 0,
          discount: 24000,
          installIncluded: true,
          shopName: "타이어픽 제휴점 수원영통",
          shopAddress: "경기 수원시 영통구",
          availableDate: "2일 후",
          productUrl: buildSearchUrl(platforms[1], input),
          confidence: "medium",
          memo: "MVP 예시 가격입니다. 장착 가능일과 현재가는 링크 확인 필요"
        })
      ],
      errorMessage: "장착 가능일 일부만 확인되었습니다."
    },
    "ABC타이어": {
      status: "manual_required",
      items: [],
      errorMessage: "동적 페이지라 사용자가 검색 결과를 확인해야 합니다."
    },
    "티스테이션": {
      status: "partial",
      items: [
        item("tstation-set", platformName, input, {
          spec: `${front} / ${rear}`,
          quantity: input.frontQuantity + input.rearQuantity,
          unitPrice: 315000,
          shippingFee: 0,
          installationFee: 0,
          discount: 35000,
          installIncluded: true,
          shopName: "티스테이션 수원시청점",
          shopAddress: "경기 수원시 팔달구",
          availableDate: "오늘",
          productUrl: buildSearchUrl(platforms[3], input),
          confidence: "low",
          memo: "MVP 예시 가격입니다. 장착비 포함 여부와 현재가를 확인하세요."
        })
      ]
    },
    "네이버 쇼핑": {
      status: "partial",
      items: [
        item("naver-front", platformName, input, {
          spec: front,
          unitPrice: 268900,
          shippingFee: 12000,
          installationFee: 64000,
          discount: 9000,
          installIncluded: false,
          shopName: "제휴 장착점 선택",
          shopAddress: input.region || "지역 미지정",
          availableDate: "확인 필요",
          productUrl: buildSearchUrl(platformByName("네이버 쇼핑"), input),
          confidence: "medium",
          memo: "MVP 예시 가격입니다. 검색 결과에서 현재가와 장착비를 확인하세요."
        }),
        item("naver-rear", platformName, input, {
          spec: rear,
          quantity: input.rearQuantity,
          unitPrice: 298400,
          shippingFee: 12000,
          installationFee: 68000,
          discount: 9000,
          installIncluded: false,
          shopName: "제휴 장착점 선택",
          shopAddress: input.region || "지역 미지정",
          availableDate: "확인 필요",
          productUrl: buildSearchUrl(platformByName("네이버 쇼핑"), input),
          confidence: "medium",
          memo: "MVP 예시 가격입니다. 배송비와 장착비는 실제 링크 기준으로 보정하세요."
        })
      ]
    },
    "11번가": {
      status: "failed",
      items: [],
      errorMessage: "상품 규격 매칭 실패"
    },
    "G마켓": {
      status: "partial",
      items: [
        item("gmarket-set", platformName, input, {
          spec: `${front} / ${rear}`,
          quantity: input.frontQuantity + input.rearQuantity,
          unitPrice: 286000,
          shippingFee: 18000,
          installationFee: 76000,
          discount: 12000,
          installIncluded: undefined,
          shopName: "판매자 지정 장착점",
          shopAddress: input.region || "지역 미지정",
          availableDate: "확인 필요",
          productUrl: buildSearchUrl(platformByName("G마켓"), input),
          confidence: "low",
          memo: "상품명 유사도 낮음. 확인 필요"
        })
      ],
      errorMessage: "정확한 모델명 매칭이 필요합니다."
    },
    "옥션": {
      status: "blocked",
      items: [],
      errorMessage: "자동화 접근 제한이 의심됩니다."
    }
  };

  return map[platformName];
}

export function makeCollectingResults(input) {
  return platforms.map((platform) => ({
    platformName: platform.platformName,
    searchUrl: buildSearchUrl(platform, input),
    status: "collecting",
    items: []
  }));
}

export function fetchMockPrices(input) {
  return platforms.map((platform) => ({
    platformName: platform.platformName,
    searchUrl: buildSearchUrl(platform, input),
    ...mockFor(platform.platformName, input)
  }));
}

export function getPlatforms() {
  return platforms.slice();
}
