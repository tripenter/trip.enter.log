# Project Concept And Available Services

이 규칙은 프로젝트의 제품 컨셉과 사용 가능한 서버 환경을 고정한다. 웹·API·배포 관련 작업 시 이 내용을 우선 반영한다.

## 1. Brand And Channel

- 채널/브랜드명: **트립엔터**
- 중의적 의미:
  - `trip` + 엔터키
  - `trip and place(터)`
- YouTube 채널을 만들 예정이며, 웹 경험은 채널 컨셉과 맞춘다.

## 2. Web Concept (`./web/<폴더명>/`)

- **`./web/<폴더명>/`**: 여행 경험·지역 특색 프로그램/게임형 반응형 감성 미디어 아트 웹페이지 컨셉
- 여행을 다니며 여행지에서 있었던 일, 또는 그 지역의 특색에 맞는 프로그램·게임에 가까운 **반응형 감성 미디어 아트** 웹페이지를 만든다.
- 하위 메뉴가 추가될 때 `./web/<폴더명>/` 형태로 폴더를 추가한다.

## 3. Travel Style Mix

- 호텔 숙박 여행: **20%**
- 스텔스 차박: **80%**

웹 콘텐츠·톤·소재를 고를 때 위 비율을 기본 전제로 한다.

## 4. Available Server Services

이미 구축되어 있거나 사용할 수 있는 서비스:

- **nginx 웹서버**
  - Host: `https://trip-enter.duckdns.org`
- **Go + Gin REST 서버**
  - Cursor로 구축 예정 / 구축 중 (`./go/`)
- **서버에서 동작하는 Python 3**
- **MariaDB 서버**
  - 접속 정보는 `go/dev_secret/config.json`의 `databases`를 따른다.
  - Cursor 작업 시 `debug: true`, 배포(`deploy.sh`) 시 `debug: false`

위 목록에 없는 소프트웨어가 필요하면 추가 설치할 수 있다.

## 5. Guidance For Agents

- 새 웹 페이지/메뉴를 만들 때는 트립엔터 브랜드와 감성 미디어 아트 컨셉을 유지한다.
- 차박·호텔 소재의 비중은 3절 비율을 참고한다.
- API는 Go Gin + `/rest/` 접두사 규칙을 따른다.
- 정적/웹 노출은 nginx(`trip-enter.duckdns.org`)를 전제로 설계한다.
