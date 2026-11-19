package controller

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	sessionCookieName = "trip_session"
	oauthStateCookie  = "trip_oauth_state"
	sessionTTL        = 30 * 24 * time.Hour
	stateTTL          = 10 * time.Minute
)

type sessionPayload struct {
	Provider  string `json:"provider"`
	UserID    string `json:"user_id"`
	AccountID int64  `json:"account_id,omitempty"`
	Nickname  string `json:"nickname"`
	Exp       int64  `json:"exp"`
}

func sessionSecret() []byte {
	secret := "tripenter-session"
	if appConfig != nil {
		if s := strings.TrimSpace(appConfig.OAuth.Kakao.ClientSecret); s != "" {
			secret = s
		} else if s := strings.TrimSpace(appConfig.OAuth.Kakao.ClientID); s != "" {
			secret = s
		}
	}
	sum := sha256.Sum256([]byte(secret))
	return sum[:]
}

func signPayload(raw []byte) string {
	mac := hmac.New(sha256.New, sessionSecret())
	_, _ = mac.Write(raw)
	sig := mac.Sum(nil)
	return base64.RawURLEncoding.EncodeToString(raw) + "." + base64.RawURLEncoding.EncodeToString(sig)
}

func verifySigned(token string) ([]byte, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid token")
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, err
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, err
	}
	mac := hmac.New(sha256.New, sessionSecret())
	_, _ = mac.Write(raw)
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return nil, fmt.Errorf("bad signature")
	}
	return raw, nil
}

func encodeSession(s sessionPayload) (string, error) {
	raw, err := json.Marshal(s)
	if err != nil {
		return "", err
	}
	return signPayload(raw), nil
}

func decodeSession(token string) (*sessionPayload, error) {
	raw, err := verifySigned(token)
	if err != nil {
		return nil, err
	}
	var s sessionPayload
	if err := json.Unmarshal(raw, &s); err != nil {
		return nil, err
	}
	if s.Exp > 0 && time.Now().Unix() > s.Exp {
		return nil, fmt.Errorf("expired")
	}
	return &s, nil
}

func cookieSecure(c *gin.Context) bool {
	if c.Request.TLS != nil {
		return true
	}
	return strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https")
}

func setCookie(c *gin.Context, name, value string, maxAge int) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   cookieSecure(c),
	})
}

func clearCookie(c *gin.Context, name string) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     name,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   cookieSecure(c),
	})
}

func readSession(c *gin.Context) *sessionPayload {
	cookie, err := c.Request.Cookie(sessionCookieName)
	if err != nil || cookie.Value == "" {
		return nil
	}
	s, err := decodeSession(cookie.Value)
	if err != nil {
		return nil
	}
	return s
}

func randomState() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func setOAuthState(c *gin.Context, state string) {
	setCookie(c, oauthStateCookie, state, int(stateTTL.Seconds()))
}

func consumeOAuthState(c *gin.Context, state string) bool {
	cookie, err := c.Request.Cookie(oauthStateCookie)
	clearCookie(c, oauthStateCookie)
	if err != nil || cookie.Value == "" || state == "" {
		return false
	}
	return hmac.Equal([]byte(cookie.Value), []byte(state))
}

func setLoginSession(c *gin.Context, provider, userID, nickname string, accountID int64) error {
	token, err := encodeSession(sessionPayload{
		Provider:  provider,
		UserID:    userID,
		AccountID: accountID,
		Nickname:  nickname,
		Exp:       time.Now().Add(sessionTTL).Unix(),
	})
	if err != nil {
		return err
	}
	setCookie(c, sessionCookieName, token, int(sessionTTL.Seconds()))
	return nil
}
