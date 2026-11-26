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

// GetDiary returns one diary by id.
// Route: GET /rest/diary?id=
func GetDiary(c *gin.Context) {
	s := requireAccountSession(c)
	if s == nil {
		return
	}
	id, err := strconv.ParseInt(strings.TrimSpace(c.Query("id")), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id_required"})
		return
	}
	diary, err := model.GetTravelDiaryByID(db, s.AccountID, id)
	if err != nil {
		log.Printf("GetTravelDiaryByID: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "load_failed"})
		return
	}
	if diary == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"diary": diary})
}

// GetDiariesByRegion returns diaries for a region code (multiple allowed).
// Route: GET /rest/diary/by-region
func GetDiariesByRegion(c *gin.Context) {
	s := requireAccountSession(c)
	if s == nil {
		return
	}
	code := strings.TrimSpace(c.Query("code"))
	if code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "code_required"})
		return
	}
	list, err := model.ListTravelDiariesByRegion(db, s.AccountID, code)
	if err != nil {
		log.Printf("ListTravelDiariesByRegion: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "load_failed"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"diaries": list})
}

// DeleteDiary removes a diary and its photos.
// Route: DELETE /rest/diary?id=
func DeleteDiary(c *gin.Context) {
	s := requireAccountSession(c)
	if s == nil {
		return
	}
	id, err := strconv.ParseInt(strings.TrimSpace(c.Query("id")), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id_required"})
		return
	}
	paths, err := model.DeleteTravelDiary(db, s.AccountID, id)
	if err != nil {
		log.Printf("DeleteTravelDiary: %v", err)
		if strings.Contains(err.Error(), "not found") {
			c.JSON(http.StatusNotFound, gin.H{"error": "not_found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "delete_failed"})
		return
	}
	for _, p := range paths {
		removeUploadFile(p)
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// SaveDiary creates or updates a diary and accepts unlimited photo uploads.
// Route: POST /rest/diary
// multipart: region, region_code, travel_date, title, body, diary_id (optional), keep_photo_ids, photos[]
func SaveDiary(c *gin.Context) {
	s := requireAccountSession(c)
	if s == nil {
		return
	}

	region := strings.TrimSpace(c.PostForm("region"))
	regionCode := strings.TrimSpace(c.PostForm("region_code"))
	travelDate := strings.TrimSpace(c.PostForm("travel_date"))
	title := strings.TrimSpace(c.PostForm("title"))
	body := c.PostForm("body")
	if regionCode == "" || title == "" || travelDate == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing_fields", "message": "지역·여행일·제목은 필수입니다."})
		return
	}

	diaryID, _ := strconv.ParseInt(strings.TrimSpace(c.PostForm("diary_id")), 10, 64)
	var err error
	if diaryID > 0 {
		err = model.UpdateTravelDiary(db, s.AccountID, diaryID, region, regionCode, title, body, travelDate)
		if err != nil {
			log.Printf("UpdateTravelDiary: %v", err)
			if strings.Contains(err.Error(), "not found") {
				c.JSON(http.StatusNotFound, gin.H{"error": "not_found"})
				return
			}
			if strings.Contains(err.Error(), "travel date") {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_travel_date", "message": "여행일 형식이 올바르지 않습니다."})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "save_failed"})
			return
		}
	} else {
		diaryID, err = model.CreateTravelDiary(db, s.AccountID, region, regionCode, title, body, travelDate)
		if err != nil {
			log.Printf("CreateTravelDiary: %v", err)
			if strings.Contains(err.Error(), "travel date") {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_travel_date", "message": "여행일 형식이 올바르지 않습니다."})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "save_failed"})
			return
		}
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

	diary, err := model.GetTravelDiaryByID(db, s.AccountID, diaryID)
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
