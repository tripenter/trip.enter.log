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
	Seq        int          `json:"seq"`
	TravelDate string       `json:"travel_date"`
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
	Seq        int       `json:"seq"`
	TravelDate string    `json:"travel_date"`
	Title      string    `json:"title"`
	PhotoCount int       `json:"photo_count"`
	CoverPath  string    `json:"cover_path,omitempty"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// parseTravelDate keeps calendar dates as YYYY-MM-DD strings so Local/UTC
// conversion cannot shift the day (e.g. KST midnight → previous UTC date).
func parseTravelDate(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", fmt.Errorf("travel date required")
	}
	if _, err := time.Parse("2006-01-02", raw); err != nil {
		return "", fmt.Errorf("invalid travel date")
	}
	return raw, nil
}

func scanTravelDate(v interface{}) string {
	switch t := v.(type) {
	case time.Time:
		// DATE from MySQL is UTC midnight; use UTC calendar day only.
		return t.UTC().Format("2006-01-02")
	case []byte:
		s := strings.TrimSpace(string(t))
		if len(s) >= 10 {
			return s[:10]
		}
		return s
	case string:
		s := strings.TrimSpace(t)
		if len(s) >= 10 {
			return s[:10]
		}
		return s
	default:
		return ""
	}
}

func ListTravelDiaries(db *sql.DB, userID int64) ([]TravelDiarySummary, error) {
	if db == nil {
		return nil, fmt.Errorf("database not initialized")
	}
	rows, err := db.Query(`
		SELECT d.TD_Id, d.TD_Region, d.TD_RegionCode, d.TD_Seq,
		       DATE_FORMAT(d.TD_TravelDate, '%Y-%m-%d') AS TD_TravelDate,
		       d.TD_Title, d.TD_UpdatedAt,
		       (SELECT COUNT(*) FROM TravelDiaryPhoto p WHERE p.TDP_DiaryId = d.TD_Id) AS photo_count,
		       (SELECT p.TDP_FilePath FROM TravelDiaryPhoto p
		         WHERE p.TDP_DiaryId = d.TD_Id
		         ORDER BY p.TDP_SortOrder ASC, p.TDP_Id ASC
		         LIMIT 1) AS cover_path
		FROM TravelDiary d
		WHERE d.TD_UserId = ?
		ORDER BY d.TD_TravelDate DESC, d.TD_UpdatedAt DESC, d.TD_Id DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]TravelDiarySummary, 0)
	for rows.Next() {
		var (
			item       TravelDiarySummary
			cover      sql.NullString
			travelDate sql.NullString
		)
		if err := rows.Scan(&item.ID, &item.Region, &item.RegionCode, &item.Seq, &travelDate, &item.Title, &item.UpdatedAt, &item.PhotoCount, &cover); err != nil {
			return nil, err
		}
		item.TravelDate = scanTravelDate(nullString(travelDate))
		item.CoverPath = nullString(cover)
		out = append(out, item)
	}
	return out, rows.Err()
}

func GetTravelDiaryByID(db *sql.DB, userID, diaryID int64) (*TravelDiary, error) {
	if db == nil {
		return nil, fmt.Errorf("database not initialized")
	}
	if userID <= 0 || diaryID <= 0 {
		return nil, fmt.Errorf("invalid args")
	}

	var (
		d          TravelDiary
		body       sql.NullString
		travelDate sql.NullString
	)
	err := db.QueryRow(`
		SELECT TD_Id, TD_UserId, TD_Region, TD_RegionCode, TD_Seq,
		       DATE_FORMAT(TD_TravelDate, '%Y-%m-%d') AS TD_TravelDate,
		       TD_Title, TD_Body, TD_CreatedAt, TD_UpdatedAt
		FROM TravelDiary
		WHERE TD_Id = ? AND TD_UserId = ?
	`, diaryID, userID).Scan(
		&d.ID, &d.UserID, &d.Region, &d.RegionCode, &d.Seq, &travelDate, &d.Title, &body, &d.CreatedAt, &d.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	d.TravelDate = scanTravelDate(nullString(travelDate))
	d.Body = nullString(body)
	photos, err := listDiaryPhotos(db, d.ID)
	if err != nil {
		return nil, err
	}
	d.Photos = photos
	return &d, nil
}

func ListTravelDiariesByRegion(db *sql.DB, userID int64, regionCode string) ([]TravelDiarySummary, error) {
	if db == nil {
		return nil, fmt.Errorf("database not initialized")
	}
	regionCode = strings.TrimSpace(regionCode)
	if userID <= 0 || regionCode == "" {
		return nil, fmt.Errorf("invalid args")
	}

	rows, err := db.Query(`
		SELECT d.TD_Id, d.TD_Region, d.TD_RegionCode, d.TD_Seq,
		       DATE_FORMAT(d.TD_TravelDate, '%Y-%m-%d') AS TD_TravelDate,
		       d.TD_Title, d.TD_UpdatedAt,
		       (SELECT COUNT(*) FROM TravelDiaryPhoto p WHERE p.TDP_DiaryId = d.TD_Id) AS photo_count,
		       (SELECT p.TDP_FilePath FROM TravelDiaryPhoto p
		         WHERE p.TDP_DiaryId = d.TD_Id
		         ORDER BY p.TDP_SortOrder ASC, p.TDP_Id ASC
		         LIMIT 1) AS cover_path
		FROM TravelDiary d
		WHERE d.TD_UserId = ? AND d.TD_RegionCode = ?
		ORDER BY d.TD_TravelDate DESC, d.TD_Seq ASC, d.TD_Id ASC
	`, userID, regionCode)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]TravelDiarySummary, 0)
	for rows.Next() {
		var (
			item       TravelDiarySummary
			cover      sql.NullString
			travelDate sql.NullString
		)
		if err := rows.Scan(&item.ID, &item.Region, &item.RegionCode, &item.Seq, &travelDate, &item.Title, &item.UpdatedAt, &item.PhotoCount, &cover); err != nil {
			return nil, err
		}
		item.TravelDate = scanTravelDate(nullString(travelDate))
		item.CoverPath = nullString(cover)
		out = append(out, item)
	}
	return out, rows.Err()
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

func CreateTravelDiary(db *sql.DB, userID int64, region, regionCode, title, body, travelDateRaw string) (int64, error) {
	if db == nil {
		return 0, fmt.Errorf("database not initialized")
	}
	region = strings.TrimSpace(region)
	regionCode = strings.TrimSpace(regionCode)
	title = strings.TrimSpace(title)
	travelDate, err := parseTravelDate(travelDateRaw)
	if err != nil {
		return 0, err
	}
	if userID <= 0 || regionCode == "" || title == "" {
		return 0, fmt.Errorf("invalid diary fields")
	}
	if region == "" {
		region = regionCode
	}
	var nextSeq int
	if err := db.QueryRow(`
		SELECT COALESCE(MAX(TD_Seq), 0) + 1
		FROM TravelDiary
		WHERE TD_UserId = ? AND TD_RegionCode = ?
	`, userID, regionCode).Scan(&nextSeq); err != nil {
		return 0, err
	}
	now := time.Now()
	res, err := db.Exec(`
		INSERT INTO TravelDiary (TD_UserId, TD_Region, TD_RegionCode, TD_Seq, TD_TravelDate, TD_Title, TD_Body, TD_CreatedAt, TD_UpdatedAt)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, userID, region, regionCode, nextSeq, travelDate, title, nullable(body), now, now)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func UpdateTravelDiary(db *sql.DB, userID, diaryID int64, region, regionCode, title, body, travelDateRaw string) error {
	if db == nil {
		return fmt.Errorf("database not initialized")
	}
	region = strings.TrimSpace(region)
	regionCode = strings.TrimSpace(regionCode)
	title = strings.TrimSpace(title)
	travelDate, err := parseTravelDate(travelDateRaw)
	if err != nil {
		return err
	}
	if userID <= 0 || diaryID <= 0 || regionCode == "" || title == "" {
		return fmt.Errorf("invalid diary fields")
	}
	if region == "" {
		region = regionCode
	}
	res, err := db.Exec(`
		UPDATE TravelDiary
		SET TD_Region = ?, TD_RegionCode = ?, TD_TravelDate = ?, TD_Title = ?, TD_Body = ?, TD_UpdatedAt = ?
		WHERE TD_Id = ? AND TD_UserId = ?
	`, region, regionCode, travelDate, title, nullable(body), time.Now(), diaryID, userID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return fmt.Errorf("diary not found")
	}
	return nil
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

func DeleteTravelDiary(db *sql.DB, userID, diaryID int64) ([]string, error) {
	if db == nil {
		return nil, fmt.Errorf("database not initialized")
	}
	if userID <= 0 || diaryID <= 0 {
		return nil, fmt.Errorf("invalid args")
	}
	var owner int64
	err := db.QueryRow(`SELECT TD_UserId FROM TravelDiary WHERE TD_Id = ?`, diaryID).Scan(&owner)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("diary not found")
	}
	if err != nil {
		return nil, err
	}
	if owner != userID {
		return nil, fmt.Errorf("diary not found")
	}
	paths, err := DeleteDiaryPhotosExcept(db, diaryID, nil)
	if err != nil {
		return nil, err
	}
	res, err := db.Exec(`DELETE FROM TravelDiary WHERE TD_Id = ? AND TD_UserId = ?`, diaryID, userID)
	if err != nil {
		return paths, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return paths, err
	}
	if n == 0 {
		return paths, fmt.Errorf("diary not found")
	}
	return paths, nil
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
