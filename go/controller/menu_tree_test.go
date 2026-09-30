package controller

import (
	"testing"

	"tripREST/model"
)

func TestBuildMenuTree(t *testing.T) {
	p1 := int64(1)
	p2 := int64(2)
	flat := []model.WebMenuItem{
		{ID: 1, Title: "서울/경기", SortOrder: 1},
		{ID: 2, Title: "강원", SortOrder: 2},
		{ID: 10, ParentID: &p1, Title: "강남", Folder: strPtr("seoul/gangnam"), SortOrder: 1},
		{ID: 11, ParentID: &p1, Title: "인천", Folder: strPtr("seoul/incheon"), SortOrder: 2},
		{ID: 20, ParentID: &p2, Title: "속초", Folder: strPtr("gangwon/sokcho"), SortOrder: 1},
	}

	tree := buildMenuTree(flat)
	if len(tree) != 2 {
		t.Fatalf("roots=%d want 2", len(tree))
	}
	if tree[0].Title != "서울/경기" || len(tree[0].Children) != 2 {
		t.Fatalf("first root unexpected: %+v", tree[0])
	}
	if tree[1].Title != "강원" || len(tree[1].Children) != 1 {
		t.Fatalf("second root unexpected: %+v", tree[1])
	}
	if tree[0].Children[0].Title != "강남" {
		t.Fatalf("child order unexpected: %+v", tree[0].Children)
	}
}

func strPtr(s string) *string { return &s }
