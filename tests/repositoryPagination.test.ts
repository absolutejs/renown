import { describe, expect, test } from "bun:test";
import { paginationWindow } from "../web/src/frontend/react/pages/RenownRepos.tsx";

describe("repository pagination controls", () => {
  test("shows every page when the result set is compact", () => {
    expect(paginationWindow(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  test("keeps the current page and both edges in a large result set", () => {
    expect(paginationWindow(8, 20)).toEqual([1, "gap", 7, 8, 9, "gap", 20]);
  });

  test("expands the window near either edge", () => {
    expect(paginationWindow(2, 20)).toEqual([1, 2, 3, 4, 5, "gap", 20]);
    expect(paginationWindow(19, 20)).toEqual([1, "gap", 16, 17, 18, 19, 20]);
  });
});
