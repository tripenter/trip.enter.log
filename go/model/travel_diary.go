package model

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

type DiaryPhoto struct {
	ID        int64  `json:"id"`
	FilePath  string `json:"file_path"`
	SortOrder int    `json:"sort_order"`
}

type TravelDiary struct {
	ID         int64        `json:"id"`
	UserID     int64        `json:"user_id"`
	Region     string       `json:"region"`
	RegionCode string       `json:"region_code"`
	Title      string       `json:"title"`
	Body       string       `json:"body"`
	Photos     []DiaryPhoto `json:"photos,omitempty"`
	CreatedAt  time.Time    `json:"created_at"`
	UpdatedAt  time.Time    `json:"updated_at"`
}

type TravelDiarySummary struct {
	ID         int64     `json:"id"`
	Region     string    `json:"region"`
	RegionCode string    `json:"region_code"`
	Title      string    `json:"title"`
	PhotoCount int       `json:"photo_count"`
	CoverPath  string    `json:"cover_path,omitempty"`
	UpdatedAt  time.Time `json:"updated_at"`
}

func ListTravelDiaries(db *sql.DB, userID int64) ([]TravelDiarySummary, error) {
	if db == nil {
		return nil, fmt.Errorf("database not initialized")
	}
	rows, err := db.Query(`
		SELECT d.TD_Id, d.TD_Region, d.TD_RegionCode, d.TD_Title, d.TD_UpdatedAt,
		       (SELECT COUNT(*) FROM TravelDiaryPhoto p WHERE p.TDP_DiaryId = d.TD_Id) AS photo_count,
		       (SELECT p.TDP_FilePath FROM TravelDiaryPhoto p
		         WHERE p.TDP_DiaryId = d.TD_Id
		         ORDER BY p.TDP_SortOrder ASC, p.TDP_Id ASC
		         LIMIT 1) AS cover_path
		FROM TravelDiary d
		WHERE d.TD_UserId = ?
		ORDER BY d.TD_UpdatedAt DESC, d.TD_Id DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]TravelDiarySummary, 0)
	for rows.Next() {
		var (
			item  TravelDiarySummary
			cover sql.NullString
		)
		if err := rows.Scan(&item.ID, &item.Region, &item.RegionCode, &item.Title, &item.UpdatedAt, &item.PhotoCount, &cover); err != nil {
			return nil, err
		}
		item.CoverPath = nullString(cover)
		out = append(out, item)
	}
	return out, rows.Err()
}

func GetTravelDiaryByRegion(db *sql.DB, userID int64, regionCode string) (*TravelDiary, error) {
	if db == nil {
		return nil, fmt.Errorf("database not initialized")
	}
	regionCode = strings.TrimSpace(regionCode)
	if userID <= 0 || regionCode == "" {
		return nil, fmt.Errorf("invalid args")
	}

	var (
		d    TravelDiary
		body sql.NullString
	)
	err := db.QueryRow(`
		SELECT TD_Id, TD_UserId, TD_Region, TD_RegionCode, TD_Title, TD_Body, TD_CreatedAt, TD_UpdatedAt
		FROM TravelDiary
		WHERE TD_UserId = ? AND TD_RegionCode = ?
	`, userID, regionCode).Scan(
		&d.ID, &d.UserID, &d.Region, &d.RegionCode, &d.Title, &body, &d.CreatedAt, &d.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	d.Body = nullString(body)
	photos, err := listDiaryPhotos(db, d.ID)
	if err != nil {
		return nil, err
	}
	d.Photos = photos
	return &d, nil
}

func listDiaryPhotos(db *sql.DB, diaryID int64) ([]DiaryPhoto, error) {
	rows, err := db.Query(`
		SELECT TDP_Id, TDP_FilePath, TDP_SortOrder
		FROM TravelDiaryPhoto
		WHERE TDP_DiaryId = ?
		ORDER BY TDP_SortOrder ASC, TDP_Id ASC
	`, diaryID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]DiaryPhoto, 0)
	for rows.Next() {
		var p DiaryPhoto
		if err := rows.Scan(&p.ID, &p.FilePath, &p.SortOrder); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func UpsertTravelDiary(db *sql.DB, userID int64, region, regionCode, title, body string) (int64, error) {
	if db == nil {
		return 0, fmt.Errorf("database not initialized")
	}
	region = strings.TrimSpace(region)
	regionCode = strings.TrimSpace(regionCode)
	title = strings.TrimSpace(title)
	if userID <= 0 || regionCode == "" || title == "" {
		return 0, fmt.Errorf("invalid diary fields")
	}
	if region == "" {
		region = regionCode
	}
	now := time.Now()

	var id int64
	err := db.QueryRow(`
		SELECT TD_Id FROM TravelDiary WHERE TD_UserId = ? AND TD_RegionCode = ?
	`, userID, regionCode).Scan(&id)
	if err == sql.ErrNoRows {
		res, err := db.Exec(`
			INSERT INTO TravelDiary (TD_UserId, TD_Region, TD_RegionCode, TD_Title, TD_Body, TD_CreatedAt, TD_UpdatedAt)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`, userID, region, regionCode, title, nullable(body), now, now)
		if err != nil {
			return 0, err
		}
		return res.LastInsertId()
	}
	if err != nil {
		return 0, err
	}
	_, err = db.Exec(`
		UPDATE TravelDiary
		SET TD_Region = ?, TD_Title = ?, TD_Body = ?, TD_UpdatedAt = ?
		WHERE TD_Id = ? AND TD_UserId = ?
	`, region, title, nullable(body), now, id, userID)
	return id, err
}

func AddDiaryPhoto(db *sql.DB, diaryID int64, filePath string, sortOrder int) (int64, error) {
	res, err := db.Exec(`
		INSERT INTO TravelDiaryPhoto (TDP_DiaryId, TDP_FilePath, TDP_SortOrder, TDP_CreatedAt)
		VALUES (?, ?, ?, ?)
	`, diaryID, filePath, sortOrder, time.Now())
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func MaxDiaryPhotoSort(db *sql.DB, diaryID int64) (int, error) {
	var max sql.NullInt64
	err := db.QueryRow(`SELECT MAX(TDP_SortOrder) FROM TravelDiaryPhoto WHERE TDP_DiaryId = ?`, diaryID).Scan(&max)
	if err != nil {
		return 0, err
	}
	if !max.Valid {
		return 0, nil
	}
	return int(max.Int64), nil
}

func DeleteDiaryPhotosExcept(db *sql.DB, diaryID int64, keepIDs []int64) ([]string, error) {
	paths := make([]string, 0)
	if len(keepIDs) == 0 {
		rows, err := db.Query(`SELECT TDP_FilePath FROM TravelDiaryPhoto WHERE TDP_DiaryId = ?`, diaryID)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var p string
			if err := rows.Scan(&p); err != nil {
				return nil, err
			}
			paths = append(paths, p)
		}
		_, err = db.Exec(`DELETE FROM TravelDiaryPhoto WHERE TDP_DiaryId = ?`, diaryID)
		return paths, err
	}

	args := make([]interface{}, 0, len(keepIDs)+1)
	args = append(args, diaryID)
	placeholders := make([]string, 0, len(keepIDs))
	for _, id := range keepIDs {
		placeholders = append(placeholders, "?")
		args = append(args, id)
	}
	q := fmt.Sprintf(`
		SELECT TDP_FilePath FROM TravelDiaryPhoto
		WHERE TDP_DiaryId = ? AND TDP_Id NOT IN (%s)
	`, strings.Join(placeholders, ","))
	rows, err := db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			return nil, err
		}
		paths = append(paths, p)
	}
	del := fmt.Sprintf(`DELETE FROM TravelDiaryPhoto WHERE TDP_DiaryId = ? AND TDP_Id NOT IN (%s)`, strings.Join(placeholders, ","))
	_, err = db.Exec(del, args...)
	return paths, err
}
