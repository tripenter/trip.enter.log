package controller

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"tripREST/config"
	"tripREST/model"

	"github.com/gin-gonic/gin"
)

var appConfig *config.Config

var supportedProviders = map[string]string{
	"kakao":  "카카오",
	"naver":  "네이버",
	"google": "구글",
	"apple":  "애플",
}

// SetAppConfig stores runtime config for OAuth handlers.
func SetAppConfig(cfg *config.Config) {
	appConfig = cfg
}

// StartSocialAuth begins a social login flow for the given provider.
// Route: GET /rest/auth/:provider
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

	switch provider {
	case "kakao":
		startKakaoAuth(c)
		return
	case "naver":
		startNaverAuth(c)
		return
	}

	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(authPendingHTML(label)))
}

func startKakaoAuth(c *gin.Context) {
	if appConfig == nil || !appConfig.KakaoConfigured() {
		c.Data(http.StatusServiceUnavailable, "text/html; charset=utf-8", []byte(authPendingHTML("카카오")))
		return
	}
	redirectURI := strings.TrimSpace(appConfig.KakaoRedirectURI)
	if redirectURI == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "kakao_redirect_missing"})
		return
	}

	state, err := randomState()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "state_failed"})
		return
	}
	setOAuthState(c, state)

	q := url.Values{}
	q.Set("client_id", appConfig.OAuth.Kakao.ClientID)
	q.Set("redirect_uri", redirectURI)
	q.Set("response_type", "code")
	q.Set("state", state)
	// Nickname-only consent in Kakao console → request matching scope.
	q.Set("scope", "profile_nickname")

	c.Redirect(http.StatusFound, "https://kauth.kakao.com/oauth/authorize?"+q.Encode())
}

// KakaoCallback handles Kakao OAuth redirect.
// Route: GET /rest/auth/kakao/callback
func KakaoCallback(c *gin.Context) {
	if appConfig == nil || !appConfig.KakaoConfigured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "kakao_not_configured"})
		return
	}

	if errMsg := strings.TrimSpace(c.Query("error")); errMsg != "" {
		log.Printf("kakao oauth error: %s desc=%s", errMsg, c.Query("error_description"))
		c.Redirect(http.StatusFound, "/?auth=error")
		return
	}

	code := strings.TrimSpace(c.Query("code"))
	state := strings.TrimSpace(c.Query("state"))
	if code == "" || !consumeOAuthState(c, state) {
		c.Redirect(http.StatusFound, "/?auth=invalid_state")
		return
	}

	token, err := exchangeKakaoToken(code, appConfig.KakaoRedirectURI)
	if err != nil {
		log.Printf("kakao token exchange failed: %v", err)
		c.Redirect(http.StatusFound, "/?auth=token_failed")
		return
	}

	userID, nickname, err := fetchKakaoProfile(token)
	if err != nil {
		log.Printf("kakao profile failed: %v", err)
		c.Redirect(http.StatusFound, "/?auth=profile_failed")
		return
	}
	if nickname == "" {
		log.Printf("kakao nickname empty for user=%s; using fallback", userID)
		nickname = "카카오사용자"
	}

	accountID, err := model.UpsertSocialUser(db, "kakao", userID, nickname)
	if err != nil {
		log.Printf("UserAccount upsert failed: %v", err)
		c.Redirect(http.StatusFound, "/?auth=db_failed")
		return
	}

	if err := setLoginSession(c, "kakao", userID, nickname, accountID); err != nil {
		log.Printf("session encode failed: %v", err)
		c.Redirect(http.StatusFound, "/?auth=session_failed")
		return
	}

	c.Redirect(http.StatusFound, "/?auth=ok")
}

func startNaverAuth(c *gin.Context) {
	if appConfig == nil || !appConfig.NaverConfigured() {
		c.Data(http.StatusServiceUnavailable, "text/html; charset=utf-8", []byte(authPendingHTML("네이버")))
		return
	}
	redirectURI := strings.TrimSpace(appConfig.NaverRedirectURI)
	if redirectURI == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "naver_redirect_missing"})
		return
	}

	state, err := randomState()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "state_failed"})
		return
	}
	setOAuthState(c, state)

	q := url.Values{}
	q.Set("response_type", "code")
	q.Set("client_id", appConfig.OAuth.Naver.ClientID)
	q.Set("redirect_uri", redirectURI)
	q.Set("state", state)

	c.Redirect(http.StatusFound, "https://nid.naver.com/oauth2.0/authorize?"+q.Encode())
}

// NaverCallback handles Naver OAuth redirect.
// Route: GET /rest/auth/naver/callback
func NaverCallback(c *gin.Context) {
	if appConfig == nil || !appConfig.NaverConfigured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "naver_not_configured"})
		return
	}

	if errMsg := strings.TrimSpace(c.Query("error")); errMsg != "" {
		log.Printf("naver oauth error: %s desc=%s", errMsg, c.Query("error_description"))
		c.Redirect(http.StatusFound, "/?auth=error")
		return
	}

	code := strings.TrimSpace(c.Query("code"))
	state := strings.TrimSpace(c.Query("state"))
	if code == "" || !consumeOAuthState(c, state) {
		c.Redirect(http.StatusFound, "/?auth=invalid_state")
		return
	}

	token, err := exchangeNaverToken(code, state, appConfig.NaverRedirectURI)
	if err != nil {
		log.Printf("naver token exchange failed: %v", err)
		c.Redirect(http.StatusFound, "/?auth=token_failed")
		return
	}

	userID, nickname, err := fetchNaverProfile(token)
	if err != nil {
		log.Printf("naver profile failed: %v", err)
		c.Redirect(http.StatusFound, "/?auth=profile_failed")
		return
	}
	if nickname == "" {
		log.Printf("naver nickname empty for user=%s; using fallback", userID)
		nickname = "네이버사용자"
	}

	accountID, err := model.UpsertSocialUser(db, "naver", userID, nickname)
	if err != nil {
		log.Printf("UserAccount upsert failed: %v", err)
		c.Redirect(http.StatusFound, "/?auth=db_failed")
		return
	}

	if err := setLoginSession(c, "naver", userID, nickname, accountID); err != nil {
		log.Printf("session encode failed: %v", err)
		c.Redirect(http.StatusFound, "/?auth=session_failed")
		return
	}

	c.Redirect(http.StatusFound, "/?auth=ok")
}

// AuthMe returns the current login session.
// Route: GET /rest/auth/me
func AuthMe(c *gin.Context) {
	s := readSession(c)
	if s == nil {
		c.JSON(http.StatusOK, gin.H{"logged_in": false})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"logged_in":  true,
		"provider":   s.Provider,
		"nickname":   s.Nickname,
		"account_id": s.AccountID,
	})
}

// AuthLogout clears the login session.
// Route: POST /rest/auth/logout
func AuthLogout(c *gin.Context) {
	clearCookie(c, sessionCookieName)
	clearCookie(c, oauthStateCookie)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type profileUpdateRequest struct {
	Email         string `json:"email"`
	Phone         string `json:"phone"`
	Address       string `json:"address"`
	AddressDetail string `json:"address_detail"`
	Zonecode      string `json:"zonecode"`
	Intro         string `json:"intro"`
}

func requireAccountSession(c *gin.Context) *sessionPayload {
	s := readSession(c)
	if s == nil || s.AccountID <= 0 {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error":   "unauthorized",
			"message": "로그인이 필요합니다.",
		})
		return nil
	}
	return s
}

// AuthProfileGet returns the logged-in user's editable profile.
// Route: GET /rest/auth/profile
func AuthProfileGet(c *gin.Context) {
	s := requireAccountSession(c)
	if s == nil {
		return
	}
	profile, err := model.GetUserProfile(db, s.AccountID)
	if err != nil {
		log.Printf("GetUserProfile failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "profile_load_failed"})
		return
	}
	if profile == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "profile_not_found"})
		return
	}
	c.JSON(http.StatusOK, profile)
}

// AuthProfileUpdate saves editable profile fields.
// Route: POST /rest/auth/profile
func AuthProfileUpdate(c *gin.Context) {
	s := requireAccountSession(c)
	if s == nil {
		return
	}

	var req profileUpdateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
		return
	}

	if err := model.UpdateUserProfile(
		db,
		s.AccountID,
		req.Email,
		req.Phone,
		req.Address,
		req.AddressDetail,
		req.Zonecode,
		req.Intro,
	); err != nil {
		log.Printf("UpdateUserProfile failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "profile_save_failed"})
		return
	}

	profile, err := model.GetUserProfile(db, s.AccountID)
	if err != nil || profile == nil {
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "profile": profile})
}

type kakaoTokenResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	Error       string `json:"error"`
	ErrorDesc   string `json:"error_description"`
}

type kakaoUserResponse struct {
	ID         int64 `json:"id"`
	Properties struct {
		Nickname string `json:"nickname"`
	} `json:"properties"`
	KakaoAccount struct {
		Profile struct {
			Nickname string `json:"nickname"`
		} `json:"profile"`
	} `json:"kakao_account"`
}

func exchangeKakaoToken(code, redirectURI string) (string, error) {
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("client_id", appConfig.OAuth.Kakao.ClientID)
	form.Set("redirect_uri", redirectURI)
	form.Set("code", code)
	if secret := strings.TrimSpace(appConfig.OAuth.Kakao.ClientSecret); secret != "" {
		form.Set("client_secret", secret)
	}

	req, err := http.NewRequest(http.MethodPost, "https://kauth.kakao.com/oauth/token", strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var parsed kakaoTokenResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", fmt.Errorf("token json: %w body=%s", err, truncate(body, 200))
	}
	if parsed.AccessToken == "" {
		return "", fmt.Errorf("token empty: %s %s", parsed.Error, parsed.ErrorDesc)
	}
	return parsed.AccessToken, nil
}

func fetchKakaoProfile(accessToken string) (userID, nickname string, err error) {
	form := url.Values{}
	// Ask Kakao explicitly for nickname fields (required when consent is nickname-only).
	form.Set("property_keys", `["kakao_account.profile","properties.nickname"]`)

	req, err := http.NewRequest(http.MethodPost, "https://kapi.kakao.com/v2/user/me", strings.NewReader(form.Encode()))
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var user kakaoUserResponse
	if err := json.Unmarshal(body, &user); err != nil {
		return "", "", fmt.Errorf("profile json: %w body=%s", err, truncate(body, 300))
	}
	if user.ID == 0 {
		return "", "", fmt.Errorf("profile missing id: %s", truncate(body, 300))
	}

	nickname = strings.TrimSpace(user.KakaoAccount.Profile.Nickname)
	if nickname == "" {
		nickname = strings.TrimSpace(user.Properties.Nickname)
	}
	if nickname == "" {
		log.Printf("kakao profile without nickname: %s", truncate(body, 400))
	}
	return strconv.FormatInt(user.ID, 10), nickname, nil
}

type naverTokenResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	Error       string `json:"error"`
	ErrorDesc   string `json:"error_description"`
}

type naverUserResponse struct {
	ResultCode string `json:"resultcode"`
	Message    string `json:"message"`
	Response   struct {
		ID       string `json:"id"`
		Nickname string `json:"nickname"`
		Name     string `json:"name"`
	} `json:"response"`
}

func exchangeNaverToken(code, state, redirectURI string) (string, error) {
	q := url.Values{}
	q.Set("grant_type", "authorization_code")
	q.Set("client_id", appConfig.OAuth.Naver.ClientID)
	q.Set("client_secret", appConfig.OAuth.Naver.ClientSecret)
	q.Set("code", code)
	q.Set("state", state)
	if redirectURI != "" {
		q.Set("redirect_uri", redirectURI)
	}

	req, err := http.NewRequest(http.MethodGet, "https://nid.naver.com/oauth2.0/token?"+q.Encode(), nil)
	if err != nil {
		return "", err
	}

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var parsed naverTokenResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", fmt.Errorf("token json: %w body=%s", err, truncate(body, 200))
	}
	if parsed.AccessToken == "" {
		return "", fmt.Errorf("token empty: %s %s", parsed.Error, parsed.ErrorDesc)
	}
	return parsed.AccessToken, nil
}

func fetchNaverProfile(accessToken string) (userID, nickname string, err error) {
	req, err := http.NewRequest(http.MethodGet, "https://openapi.naver.com/v1/nid/me", nil)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var user naverUserResponse
	if err := json.Unmarshal(body, &user); err != nil {
		return "", "", fmt.Errorf("profile json: %w body=%s", err, truncate(body, 300))
	}
	userID = strings.TrimSpace(user.Response.ID)
	if userID == "" {
		return "", "", fmt.Errorf("profile missing id: %s", truncate(body, 300))
	}
	nickname = strings.TrimSpace(user.Response.Nickname)
	if nickname == "" {
		nickname = strings.TrimSpace(user.Response.Name)
	}
	if nickname == "" {
		log.Printf("naver profile without nickname: %s", truncate(body, 400))
	}
	return userID, nickname, nil
}

func truncate(b []byte, n int) string {
	if len(b) <= n {
		return string(b)
	}
	return string(b[:n]) + "…"
}

func authPendingHTML(label string) string {
	return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>` + label + ` 로그인 — 트립엔터</title>
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
    <h1>` + label + ` 로그인</h1>
    <p>` + label + ` 로그인 연동을 준비 중입니다.</p>
    <p><a href="/index.html">트립엔터로 돌아가기</a></p>
  </div>
</body>
</html>`
}
