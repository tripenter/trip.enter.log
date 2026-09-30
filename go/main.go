package main

import (
	"fmt"
	"log"
	"net/http"

	"tripREST/config"

	"github.com/gin-gonic/gin"
)

func main() {
	// 설정 파일 로드 (DB 비밀번호는 dev_secret/config.json에 원문으로 저장)
	cfg, err := config.LoadConfig("dev_secret/config.json")
	if err != nil {
		log.Fatalf("설정 파일 로드 실패: %v", err)
	}

	log.Printf("DB 설정 로드 완료 - 호스트: %s, 계정: %s, DB명: %s",
		cfg.Database.Host, cfg.Database.User, cfg.Database.Name)

	r := gin.Default()

	r.GET("/rest/ping", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"message": "pong",
			"db_user": cfg.Database.User,
			"db_name": cfg.Database.Name,
		})
	})

	// dev_secret/config.json의 server.port (기본값 10000) 설정 적용
	port := cfg.Server.Port
	if port == 0 {
		port = 10000
	}
	serverAddr := fmt.Sprintf(":%d", port)

	log.Printf("Gin 서버를 %s 포트에서 시작합니다.", serverAddr)
	r.Run(serverAddr)
}
