package controller

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

var supportedProviders = map[string]string{
	"kakao":  "카카오",
	"naver":  "네이버",
	"google": "구글",
	"apple":  "애플",
}

// StartSocialAuth begins a social login flow for the given provider.
// Route: GET /rest/auth/:provider
// OAuth 클라이언트 키가 아직 없으면 안내 페이지를 반환한다.
func StartSocialAuth(c *gin.Context) {
	provider := strings.ToLower(strings.TrimSpace(c.Param("provider")))
	label, ok := supportedProviders[provider]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "unsupported_provider",
			"message": "지원하지 않는 로그인 방식입니다.",
		})
		return
	}

	// TODO: config에 oauth client id/secret이 생기면 각 provider authorize URL로 리다이렉트한다.
	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>`+label+` 로그인 — 트립엔터</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:"Pretendard",sans-serif;background:#eef7fb;color:#1a2b33}
    .box{width:min(26rem,92vw);padding:1.75rem 1.5rem;border:1px solid rgba(26,43,51,.1);border-radius:12px;background:#fff}
    h1{margin:0 0 .75rem;font-size:1.25rem}
    p{margin:0 0 1.25rem;line-height:1.65;color:rgba(26,43,51,.72)}
    a{color:#2f6f5e}
  </style>
</head>
<body>
  <div class="box">
    <h1>`+label+` 로그인</h1>
    <p>`+label+` 로그인 연동을 준비 중입니다. OAuth 키가 등록되면 바로 연결됩니다.</p>
    <p><a href="/index.html">트립엔터로 돌아가기</a></p>
  </div>
</body>
</html>`))
}
