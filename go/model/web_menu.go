package model

// WebMenuItem is a WebMenu row exposed to the client.
type WebMenuItem struct {
	ID        int64         `json:"id"`
	ParentID  *int64        `json:"parentId"`
	Title     string        `json:"title"`
	Folder    *string       `json:"folder"`
	SortOrder int           `json:"sortOrder"`
	Children  []WebMenuItem `json:"children,omitempty"`
}

// GetMenuResponse is the POST /rest/get/menu response body.
type GetMenuResponse struct {
	Menus []WebMenuItem `json:"menus"`
}
