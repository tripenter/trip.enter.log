package controller

import (
	"database/sql"
	"log"
	"net/http"

	"tripREST/model"

	"github.com/gin-gonic/gin"
)

var db *sql.DB

// SetDB stores the shared DB handle for controllers.
func SetDB(database *sql.DB) {
	db = database
}

// GetMenu loads active WebMenu rows and returns a parent/child tree.
// Route: POST /rest/get/menu
func GetMenu(c *gin.Context) {
	if db == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "database not initialized"})
		return
	}

	rows, err := db.Query(`
		SELECT WM_Id, WM_ParentId, WM_Title, WM_Folder, WM_SortOrder
		FROM WebMenu
		WHERE WM_IsActive = 1
		ORDER BY WM_SortOrder ASC, WM_Id ASC
	`)
	if err != nil {
		log.Printf("GetMenu query failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load menus"})
		return
	}
	defer rows.Close()

	flat := make([]model.WebMenuItem, 0)
	for rows.Next() {
		var item model.WebMenuItem
		var parentID sql.NullInt64
		var folder sql.NullString
		if err := rows.Scan(&item.ID, &parentID, &item.Title, &folder, &item.SortOrder); err != nil {
			log.Printf("GetMenu scan failed: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read menus"})
			return
		}
		if parentID.Valid {
			v := parentID.Int64
			item.ParentID = &v
		}
		if folder.Valid {
			v := folder.String
			item.Folder = &v
		}
		item.Children = []model.WebMenuItem{}
		flat = append(flat, item)
	}
	if err := rows.Err(); err != nil {
		log.Printf("GetMenu rows error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load menus"})
		return
	}

	c.JSON(http.StatusOK, model.GetMenuResponse{Menus: buildMenuTree(flat)})
}

func buildMenuTree(flat []model.WebMenuItem) []model.WebMenuItem {
	byID := make(map[int64]*model.WebMenuItem, len(flat))
	ordered := make([]*model.WebMenuItem, 0, len(flat))

	for i := range flat {
		node := new(model.WebMenuItem)
		*node = flat[i]
		node.Children = []model.WebMenuItem{}
		byID[node.ID] = node
		ordered = append(ordered, node)
	}

	out := make([]model.WebMenuItem, 0)
	for _, node := range ordered {
		if node.ParentID == nil {
			out = append(out, *node)
			continue
		}
		parent, ok := byID[*node.ParentID]
		if !ok {
			out = append(out, *node)
			continue
		}
		parent.Children = append(parent.Children, *node)
	}

	// Copy roots again from map so children attached via pointers are present.
	final := make([]model.WebMenuItem, 0, len(out))
	seen := make(map[int64]struct{}, len(out))
	for _, node := range ordered {
		isRoot := node.ParentID == nil
		if !isRoot {
			_, ok := byID[*node.ParentID]
			isRoot = !ok
		}
		if !isRoot {
			continue
		}
		if _, dup := seen[node.ID]; dup {
			continue
		}
		seen[node.ID] = struct{}{}
		final = append(final, *byID[node.ID])
	}
	return final
}
