import React from "react";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { SearchBar } from "../../components/contracts/SearchBar";
import { api } from "@/lib/api";

jest.mock("@/lib/api", () => ({
  api: {
    getContractSearchSuggestions: jest.fn(),
  },
}));

describe("SearchBar autocomplete", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    jest.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    window.localStorage.clear();
    (api.getContractSearchSuggestions as jest.Mock).mockReset();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    jest.useRealTimers();
  });

  test("debounces input for 300ms and renders grouped suggestions capped at 10", async () => {
    const manyCategories = Array.from({ length: 12 }).map((_, idx) => ({
      text: `Category ${idx + 1}`,
      kind: "category",
      score: 0.6 - idx * 0.01,
    }));

    (api.getContractSearchSuggestions as jest.Mock).mockResolvedValue({
      items: [
        { text: "Token Factory", kind: "contract", score: 0.95 },
        { text: "Token Vault", kind: "contract", score: 0.9 },
        ...manyCategories,
        { text: "Alice Labs", kind: "publisher", score: 0.8 },
      ],
    });

    act(() => {
      root.render(
        <SearchBar
          value="tok"
          onChange={jest.fn()}
          onClear={jest.fn()}
          onCommit={jest.fn()}
        />,
      );
    });

    act(() => {
      jest.advanceTimersByTime(299);
    });
    expect(api.getContractSearchSuggestions).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1);
      await Promise.resolve();
    });

    expect(api.getContractSearchSuggestions).toHaveBeenCalledWith("tok", 50);
    expect(container.textContent).toContain("Contracts");
    expect(container.textContent).toContain("Categories");
    expect(container.textContent).toContain("Authors");

    const sections = Array.from(container.querySelectorAll("section"));
    const categoriesSection = sections.find((section) =>
      section.textContent?.includes("Categories"),
    );
    expect(categoriesSection).toBeTruthy();
    expect(categoriesSection?.querySelectorAll("li").length).toBe(10);

    const highlightedSpans = Array.from(
      container.querySelectorAll("span"),
    ).filter(
      (span) =>
        span.className.includes("font-semibold") &&
        span.textContent?.toLowerCase() === "tok",
    );
    expect(highlightedSpans.length).toBeGreaterThan(0);
  });

  test("supports keyboard navigation with enter to commit highlighted suggestion", async () => {
    const onCommit = jest.fn();
    const onChange = jest.fn();
    (api.getContractSearchSuggestions as jest.Mock).mockResolvedValue({
      items: [
        { text: "Token Factory", kind: "contract", score: 1 },
        { text: "Token Bridge", kind: "contract", score: 0.9 },
      ],
    });

    act(() => {
      root.render(
        <SearchBar
          value="tok"
          onChange={onChange}
          onClear={jest.fn()}
          onCommit={onCommit}
        />,
      );
    });

    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });

    const input = container.querySelector("input") as HTMLInputElement;
    expect(container.textContent).toContain("Token Factory");

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });

    expect(input.getAttribute("aria-activedescendant")).toContain(
      "search-suggestion-",
    );

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(onCommit).toHaveBeenCalledWith("Token Factory");
    expect(onChange).toHaveBeenCalledWith("Token Factory");
  });

  test("shows and uses recent searches from localStorage", () => {
    window.localStorage.setItem(
      "contract-search-recent",
      JSON.stringify(["Soroswap", "Blend"]),
    );
    const onCommit = jest.fn();

    act(() => {
      root.render(
        <SearchBar
          value=""
          onChange={jest.fn()}
          onClear={jest.fn()}
          onCommit={onCommit}
        />,
      );
    });

    const input = container.querySelector("input") as HTMLInputElement;

    act(() => {
      input.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
    });

    expect(container.textContent).toContain("Recent Searches");
    expect(container.textContent).toContain("Soroswap");

    const recentItem = Array.from(container.querySelectorAll("li")).find((li) =>
      li.textContent?.includes("Soroswap"),
    );

    act(() => {
      recentItem?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(onCommit).toHaveBeenCalledWith("Soroswap");
  });
});
