package controller

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"tripREST/model"

	"github.com/gin-gonic/gin"
)

var uploadRoot string

// SetUploadRoot sets absolute directory for diary photo files (…/uploads).
func SetUploadRoot(root string) {
	uploadRoot = strings.TrimSpace(root)
}

func diaryUploadDir() string {
	if uploadRoot != "" {
		return uploadRoot
	}
	return filepath.Join(".", "uploads")
}

// ListMyDiaries returns summaries for map highlighting.
// Route: GET /rest/diary/mine
func ListMyDiaries(c *gin.Context) {
	s := requireAccountSession(c)
	if s == nil {
		return
	}
	list, err := model.ListTravelDiaries(db, s.AccountID)
	if err != nil {
		log.Printf("ListTravelDiaries: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "list_failed"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"diaries": list})
}

// GetDiaryByRegion returns one diary for a region code.
// Route: GET /rest/diary/by-region
func GetDiaryByRegion(c *gin.Context) {
	s := requireAccountSession(c)
	if s == nil {
		return
	}
	code := strings.TrimSpace(c.Query("code"))
	if code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "code_required"})
		return
	}
	diary, err := model.GetTravelDiaryByRegion(db, s.AccountID, code)
	if err != nil {
		log.Printf("GetTravelDiaryByRegion: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "load_failed"})
		return
	}
	if diary == nil {
		c.JSON(http.StatusOK, gin.H{"diary": nil})
		return
	}
	c.JSON(http.StatusOK, gin.H{"diary": diary})
}

// SaveDiary creates/updates a diary and accepts unlimited photo uploads.
// Route: POST /rest/diary
// multipart: region, region_code, title, body, keep_photo_ids (comma-separated), photos[]
func SaveDiary(c *gin.Context) {
	s := requireAccountSession(c)
	if s == nil {
		return
	}

	region := strings.TrimSpace(c.PostForm("region"))
	regionCode := strings.TrimSpace(c.PostForm("region_code"))
	title := strings.TrimSpace(c.PostForm("title"))
	body := c.PostForm("body")
	if regionCode == "" || title == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing_fields", "message": "지역과 제목은 필수입니다."})
		return
	}

	diaryID, err := model.UpsertTravelDiary(db, s.AccountID, region, regionCode, title, body)
	if err != nil {
		log.Printf("UpsertTravelDiary: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "save_failed"})
		return
	}

	keepIDs := parseIDList(c.PostForm("keep_photo_ids"))
	removedPaths, err := model.DeleteDiaryPhotosExcept(db, diaryID, keepIDs)
	if err != nil {
		log.Printf("DeleteDiaryPhotosExcept: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "photo_cleanup_failed"})
		return
	}
	for _, p := range removedPaths {
		removeUploadFile(p)
	}

	form, err := c.MultipartForm()
	if err == nil && form != nil {
		files := form.File["photos"]
		if len(files) == 0 {
			files = form.File["photos[]"]
		}
		sortBase, _ := model.MaxDiaryPhotoSort(db, diaryID)
		for i, fh := range files {
			webPath, saveErr := saveDiaryPhotoFile(s.AccountID, diaryID, fh)
			if saveErr != nil {
				log.Printf("save diary photo: %v", saveErr)
				continue
			}
			if _, addErr := model.AddDiaryPhoto(db, diaryID, webPath, sortBase+i+1); addErr != nil {
				log.Printf("AddDiaryPhoto: %v", addErr)
				removeUploadFile(webPath)
			}
		}
	}

	diary, err := model.GetTravelDiaryByRegion(db, s.AccountID, regionCode)
	if err != nil || diary == nil {
		c.JSON(http.StatusOK, gin.H{"ok": true, "id": diaryID})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "diary": diary})
}

func parseIDList(raw string) []int64 {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]int64, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		n, err := strconv.ParseInt(p, 10, 64)
		if err != nil || n <= 0 {
			continue
		}
		out = append(out, n)
	}
	return out
}

func saveDiaryPhotoFile(userID, diaryID int64, fh *multipart.FileHeader) (string, error) {
	ext := strings.ToLower(filepath.Ext(fh.Filename))
	switch ext {
	case ".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif":
	default:
		if ext == "" {
			ext = ".jpg"
		} else {
			return "", fmt.Errorf("unsupported image type: %s", ext)
		}
	}

	relDir := filepath.Join("diary", fmt.Sprintf("%d", userID), fmt.Sprintf("%d", diaryID))
	absDir := filepath.Join(diaryUploadDir(), relDir)
	if err := os.MkdirAll(absDir, 0o755); err != nil {
		return "", err
	}

	name := fmt.Sprintf("%d_%s%s", time.Now().UnixNano(), shortID(), ext)
	absPath := filepath.Join(absDir, name)

	src, err := fh.Open()
	if err != nil {
		return "", err
	}
	defer src.Close()

	dst, err := os.Create(absPath)
	if err != nil {
		return "", err
	}
	defer dst.Close()
	if _, err := io.Copy(dst, src); err != nil {
		return "", err
	}

	webPath := "/uploads/" + filepath.ToSlash(filepath.Join(relDir, name))
	return webPath, nil
}

func shortID() string {
	buf := make([]byte, 6)
	if _, err := rand.Read(buf); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	return hex.EncodeToString(buf)
}

func removeUploadFile(webPath string) {
	webPath = strings.TrimSpace(webPath)
	if !strings.HasPrefix(webPath, "/uploads/") {
		return
	}
	rel := strings.TrimPrefix(webPath, "/uploads/")
	abs := filepath.Join(diaryUploadDir(), filepath.FromSlash(rel))
	_ = os.Remove(abs)
}
