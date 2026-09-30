package config

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	_ "github.com/go-sql-driver/mysql"
)

type ServerConfig struct {
	Port int `json:"port"`
}

type DatabaseConfig struct {
	Debug    bool   `json:"debug"`
	Driver   string `json:"driver"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	User     string `json:"user"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

type Config struct {
	Server   ServerConfig   `json:"server"`
	Database DatabaseConfig `json:"-"`
}

type configFile struct {
	Server     ServerConfig     `json:"server"`
	Databases  []DatabaseConfig `json:"databases"`
	Database   *DatabaseConfig  `json:"database"` // legacy single-object fallback
}

// WantDebugDB returns whether the debug database should be used.
// APP_DEBUG=false|0|no|off → production (debug:false).
// unset or any other value → debug:true (Cursor/local default).
func WantDebugDB() bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv("APP_DEBUG")))
	switch v {
	case "false", "0", "no", "off":
		return false
	default:
		return true
	}
}

// LoadConfig reads JSON and selects the database entry matching WantDebugDB().
func LoadConfig(configPath string) (*Config, error) {
	return LoadConfigWithDebug(configPath, WantDebugDB())
}

// LoadConfigWithDebug reads JSON and selects databases[].debug == debug.
func LoadConfigWithDebug(configPath string, debug bool) (*Config, error) {
	file, err := os.Open(configPath)
	if err != nil {
		return nil, fmt.Errorf("설정 파일을 열 수 없습니다: %w", err)
	}
	defer file.Close()

	var raw configFile
	if err := json.NewDecoder(file).Decode(&raw); err != nil {
		return nil, fmt.Errorf("설정 파일 파싱 실패: %w", err)
	}

	entries := raw.Databases
	if len(entries) == 0 && raw.Database != nil {
		entries = []DatabaseConfig{*raw.Database}
	}
	if len(entries) == 0 {
		return nil, fmt.Errorf("databases 항목이 없습니다")
	}

	var selected *DatabaseConfig
	for i := range entries {
		if entries[i].Debug == debug {
			selected = &entries[i]
			break
		}
	}
	if selected == nil {
		return nil, fmt.Errorf("debug=%v 인 데이터베이스 설정을 찾을 수 없습니다", debug)
	}

	return &Config{
		Server:   raw.Server,
		Database: *selected,
	}, nil
}

// ConnectDB 함수는 데이터베이스 커넥션 풀을 생성하여 반환합니다.
func ConnectDB(cfg *Config) (*sql.DB, error) {
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?parseTime=true",
		cfg.Database.User,
		cfg.Database.Password,
		cfg.Database.Host,
		cfg.Database.Port,
		cfg.Database.Name,
	)

	db, err := sql.Open(cfg.Database.Driver, dsn)
	if err != nil {
		return nil, err
	}

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("데이터베이스 연결 실패 (Ping 실패): %w", err)
	}

	return db, nil
}
