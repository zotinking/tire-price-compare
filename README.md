# 타이어 가격 비교

국내 타이어 판매/장착 플랫폼별 가격, 배송비, 장착비, 수집 상태를 한 화면에서 비교하는 MVP 웹페이지입니다.

가격 수집은 서버 크롤링이 아니라 사용자의 로컬 PC에서 Playwright가 Chrome 또는 Edge 브라우저를 직접 조작하는 방식입니다.

## 실행

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:4173`을 엽니다.

## 로컬 자동화 수집

웹앱에서 `로컬 자동화 실행`을 누르면 로컬 Node 서버가 `scripts/localAutomation.js`를 실행합니다.

자동화 흐름:

1. 입력한 브랜드, 모델명, 규격, 지역으로 검색어를 만듭니다.
2. Playwright가 설치된 Chrome 또는 Edge를 실행합니다.
3. 각 플랫폼 검색 화면을 엽니다.
4. 화면에 보이는 상품명, 가격, 배송비, 장착비, 장착 가능 여부, 상품 URL 후보를 추출합니다.
5. 결과를 `data/latest-results.json`에 저장합니다.
6. 웹앱은 `GET /api/local-results`로 JSON을 읽어 비교표를 만듭니다.
7. 자동 추출이 실패한 사이트는 브라우저 탭을 잠시 열린 상태로 두고 사용자 확인 대상으로 표시합니다.

사용자 로그인 세션은 자동화 전용 브라우저 프로필인 `.browser-profile`에 보존됩니다. 처음 열린 브라우저에서 직접 로그인하면 이후 실행에도 같은 프로필을 재사용합니다.

환경 변수:

- `TIRE_BROWSER_CHANNEL`: `msedge` 또는 `chrome`을 지정합니다. 기본값은 `msedge`입니다.
- `TIRE_BROWSER_USER_DATA_DIR`: 자동화용 브라우저 프로필 경로를 지정합니다. 기본값은 `.browser-profile`입니다.
- `TIRE_KEEP_BROWSER_OPEN_MS`: 실패 탭을 열린 상태로 유지할 시간입니다. 기본값은 10분입니다.

캡차 우회, 비공개 API 호출, 강제 로그인 자동화는 구현하지 않습니다.

## API

- `POST /api/run-local-automation`: 로컬 Playwright 자동화를 백그라운드 작업으로 시작합니다.
- `GET /api/automation-status?jobId=...`: 자동화 작업 상태를 확인합니다.
- `GET /api/local-results`: 마지막으로 저장된 `data/latest-results.json`을 읽습니다.
- `POST /api/fetch-prices`: 이전 서버 공개 페이지 수집 API입니다. 현재 앱의 기본 흐름은 로컬 자동화입니다.

## GitHub Pages

GitHub Pages는 정적 호스팅이므로 로컬 Playwright 자동화를 실행할 수 없습니다. 이 기능은 사용자의 PC에서 `npm run dev`로 로컬 Node 서버를 실행해야 동작합니다.

## Render 배포

이 저장소에는 Render Blueprint 설정인 `render.yaml`이 포함되어 있습니다.

Render에서 이 GitHub 저장소를 Blueprint로 연결하면 다음 설정으로 배포됩니다.

- Runtime: Node
- Plan: Free
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check: `/api/health`

Render 배포본은 앱 화면과 저장 JSON 조회 API를 제공할 수 있지만, Render 서버에서 사용자의 로컬 Chrome/Edge 세션을 조작할 수는 없습니다. 실제 자동화 수집은 로컬 PC에서 실행하세요.
