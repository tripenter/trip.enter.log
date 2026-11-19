package model

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

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
