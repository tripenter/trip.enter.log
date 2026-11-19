package model

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// UserProfile is the editable profile slice of UserAccount.
type UserProfile struct {
	ID            int64  `json:"account_id"`
	Provider      string `json:"provider"`
	Nickname      string `json:"nickname"`
	Email         string `json:"email"`
	Phone         string `json:"phone"`
	Address       string `json:"address"`
	AddressDetail string `json:"address_detail"`
	Zonecode      string `json:"zonecode"`
	Intro         string `json:"intro"`
}

func nullString(ns sql.NullString) string {
	if ns.Valid {
		return ns.String
	}
	return ""
}

func nullable(s string) interface{} {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	return s
}

// GetUserProfile loads profile fields by UA_Id.
func GetUserProfile(db *sql.DB, accountID int64) (*UserProfile, error) {
	if db == nil {
		return nil, fmt.Errorf("database not initialized")
	}
	if accountID <= 0 {
		return nil, fmt.Errorf("invalid account id")
	}

	var (
		p             UserProfile
		email         sql.NullString
		phone         sql.NullString
		address       sql.NullString
		addressDetail sql.NullString
		zonecode      sql.NullString
		intro         sql.NullString
	)
	err := db.QueryRow(`
		SELECT UA_Id, UA_Provider, UA_Nickname,
		       UA_Email, UA_Phone, UA_Address, UA_AddressDetail, UA_Zonecode, UA_Intro
		FROM UserAccount
		WHERE UA_Id = ?
	`, accountID).Scan(
		&p.ID, &p.Provider, &p.Nickname,
		&email, &phone, &address, &addressDetail, &zonecode, &intro,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("select UserAccount profile: %w", err)
	}
	p.Email = nullString(email)
	p.Phone = nullString(phone)
	p.Address = nullString(address)
	p.AddressDetail = nullString(addressDetail)
	p.Zonecode = nullString(zonecode)
	p.Intro = nullString(intro)
	return &p, nil
}

// UpdateUserProfile updates editable profile fields for UA_Id.
func UpdateUserProfile(db *sql.DB, accountID int64, email, phone, address, addressDetail, zonecode, intro string) error {
	if db == nil {
		return fmt.Errorf("database not initialized")
	}
	if accountID <= 0 {
		return fmt.Errorf("invalid account id")
	}

	res, err := db.Exec(`
		UPDATE UserAccount
		SET UA_Email = ?,
		    UA_Phone = ?,
		    UA_Address = ?,
		    UA_AddressDetail = ?,
		    UA_Zonecode = ?,
		    UA_Intro = ?,
		    UA_UpdatedAt = ?
		WHERE UA_Id = ?
	`, nullable(email), nullable(phone), nullable(address), nullable(addressDetail), nullable(zonecode), nullable(intro), time.Now(), accountID)
	if err != nil {
		return fmt.Errorf("update UserAccount profile: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return fmt.Errorf("account not found")
	}
	return nil
}

// UpsertSocialUser inserts or updates a UserAccount row for a social login.
// On insert: provider, provider user id, nickname, timestamps.
// On update: nickname + UA_UpdatedAt (profile fields are left as-is).
func UpsertSocialUser(db *sql.DB, provider, providerUserID, nickname string) (int64, error) {
	if db == nil {
		return 0, fmt.Errorf("database not initialized")
	}
	provider = strings.TrimSpace(provider)
	providerUserID = strings.TrimSpace(providerUserID)
	nickname = strings.TrimSpace(nickname)
	if provider == "" || providerUserID == "" {
		return 0, fmt.Errorf("provider and provider user id are required")
	}
	if nickname == "" {
		nickname = "사용자"
	}

	var id int64
	err := db.QueryRow(`
		SELECT UA_Id
		FROM UserAccount
		WHERE UA_Provider = ? AND UA_ProviderUserId = ?
	`, provider, providerUserID).Scan(&id)

	now := time.Now()
	if err == sql.ErrNoRows {
		res, err := db.Exec(`
			INSERT INTO UserAccount (
				UA_Provider, UA_ProviderUserId, UA_Nickname, UA_CreatedAt, UA_UpdatedAt
			) VALUES (?, ?, ?, ?, ?)
		`, provider, providerUserID, nickname, now, now)
		if err != nil {
			return 0, fmt.Errorf("insert UserAccount: %w", err)
		}
		newID, err := res.LastInsertId()
		if err != nil {
			return 0, fmt.Errorf("UserAccount last insert id: %w", err)
		}
		return newID, nil
	}
	if err != nil {
		return 0, fmt.Errorf("select UserAccount: %w", err)
	}

	_, err = db.Exec(`
		UPDATE UserAccount
		SET UA_Nickname = ?, UA_UpdatedAt = ?
		WHERE UA_Id = ?
	`, nickname, now, id)
	if err != nil {
		return 0, fmt.Errorf("update UserAccount: %w", err)
	}
	return id, nil
}
