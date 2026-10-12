package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"tripREST/config"
	"tripREST/controller"

	"github.com/gin-gonic/gin"
)

func resolveWebRoot() string {
	candidates := []string{".", "../web", "web"}
	for _, c := range candidates {
		index := filepath.Join(c, "index.html")
		if st, err := os.Stat(index); err == nil && !st.IsDir() {
			abs, err := filepath.Abs(c)
			if err == nil {
				return abs
			}
			return c
		}
	}
	return ""
}

func main() {
	// 설정 파일 로드 (APP_DEBUG 미설정/true → debug DB, APP_DEBUG=false → 배포 DB)
	cfg, err := config.LoadConfig("dev_secret/config.json")
	if err != nil {
		log.Fatalf("설정 파일 로드 실패: %v", err)
	}

	log.Printf("DB 설정 로드 완료 - debug=%v, 호스트: %s, 계정: %s, DB명: %s",
		cfg.Database.Debug, cfg.Database.Host, cfg.Database.User, cfg.Database.Name)

	db, err := config.ConnectDB(cfg)
	if err != nil {
		log.Fatalf("데이터베이스 연결 실패: %v", err)
	}
	defer db.Close()
	controller.SetDB(db)

	r := gin.Default()

	r.GET("/rest/ping", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"message": "pong",
			"db_user": cfg.Database.User,
			"db_name": cfg.Database.Name,
		})
	})

	r.POST("/rest/get/menu", controller.GetMenu)

	// 로컬·배포 공통: web 정적 파일 (배포 시 cwd에 index.html, 로컬은 ../web)
	if webRoot := resolveWebRoot(); webRoot != "" {
		log.Printf("정적 웹 루트: %s", webRoot)
		fileServer := http.FileServer(http.Dir(webRoot))
		r.NoRoute(func(c *gin.Context) {
			if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
				c.Status(http.StatusNotFound)
				return
			}
			if strings.HasPrefix(c.Request.URL.Path, "/rest/") {
				c.Status(http.StatusNotFound)
				return
			}
			fileServer.ServeHTTP(c.Writer, c.Request)
		})
	} else {
		log.Printf("정적 웹 루트를 찾지 못했습니다 (index.html 없음)")
	}

	// dev_secret/config.json의 server.port (기본값 10000) 설정 적용
	port := cfg.Server.Port
	if port == 0 {
		port = 10000
	}
	serverAddr := fmt.Sprintf(":%d", port)

	log.Printf("Gin 서버를 %s 포트에서 시작합니다.", serverAddr)
	if err := r.Run(serverAddr); err != nil {
		log.Fatalf("서버 시작 실패: %v", err)
	}
}
