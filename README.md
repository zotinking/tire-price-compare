# 타이어 가격 비교

국내 타이어 판매/장착 플랫폼별 가격, 배송비, 장착비, 수집 상태를 한 화면에서 비교하는 MVP 웹페이지입니다.

## 실행

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:4173`을 엽니다.

## 실제 가격 수집

로컬 Node 서버는 `POST /api/fetch-prices`를 제공합니다. 현재 구현은 공개 검색 페이지에서 접근 가능한 범위만 수집합니다.

- 다나와: 공개 검색 HTML에서 상품명/가격 후보 추출
- 네이버 쇼핑: 서버 요청 차단 시 `blocked` 처리
- 그 외 플랫폼: 검색 링크와 수동 보정 fallback

캡차 우회, 로그인 자동화, 비공개 API 호출은 구현하지 않습니다.

## GitHub Pages

GitHub Pages는 정적 호스팅이므로 자체적으로 크롤링 API를 실행할 수 없습니다. Pages에서 실제 수집을 쓰려면 별도 Node 백엔드를 배포한 뒤 페이지에서 `window.TIRE_API_BASE`로 백엔드 주소를 지정해야 합니다.

## Render 배포

이 저장소에는 Render Blueprint 설정인 `render.yaml`이 포함되어 있습니다.

Render에서 이 GitHub 저장소를 Blueprint로 연결하면 다음 설정으로 배포됩니다.

- Runtime: Node
- Plan: Free
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check: `/api/health`

배포된 Render URL은 프론트와 `/api/fetch-prices` 백엔드를 함께 제공합니다.
