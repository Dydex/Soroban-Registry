"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { api, SearchSuggestion } from "@/lib/api";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  onCommit?: (value: string) => void;
  placeholder?: string;
}

type MenuItem = {
  id: string;
  text: string;
  kind: string;
  group: "contracts" | "categories" | "authors" | "recent";
  source: "recent" | "suggestion";
  score: number;
};

const RECENT_SEARCH_KEY = "contract-search-recent";
const MAX_RECENT_SEARCHES = 5;
const MAX_SUGGESTIONS_PER_GROUP = 10;
const SUGGESTION_DEBOUNCE_MS = 300;
const LOADING_INDICATOR_DELAY_MS = 160;
const SUGGESTION_FETCH_LIMIT = 50;
const SEARCH_HINTS = [
  "Search by contract name, category, creator, or tag.",
  'Try "DeFi", "NFT", "token", or a publisher address.',
  "Advanced: use tag:yield and OR (e.g. token OR bridge).",
  "Use the keyboard arrows to navigate suggestions.",
];

const GROUP_TITLES: Record<MenuItem["group"], string> = {
  contracts: "Contracts",
  categories: "Categories",
  authors: "Authors",
  recent: "Recent Searches",
};

const SUGGESTION_LABELS: Record<string, string> = {
  contract: "Name",
  category: "Category",
  publisher: "Creator",
  creator: "Creator",
  tag: "Tag",
  recent: "Recent search",
  default: "Suggestion",
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function kindToGroup(kind: string): MenuItem["group"] {
  const normalized = kind.toLowerCase();
  if (normalized === "contract") return "contracts";
  if (normalized === "category" || normalized === "tag") return "categories";
  if (
    normalized === "publisher" ||
    normalized === "creator" ||
    normalized === "author"
  ) {
    return "authors";
  }
  return "contracts";
}

function loadRecentSearches(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCH_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      return parsed
        .filter((value) => typeof value === "string" && value.trim())
        .slice(0, MAX_RECENT_SEARCHES);
    }
  } catch {
    // ignore malformed local storage data
  }

  return [];
}

function saveRecentSearch(query: string): string[] {
  if (typeof window === "undefined") return [];
  const trimmed = query.trim();
  if (!trimmed) return [];

  const existing = loadRecentSearches();
  const deduped = [
    trimmed,
    ...existing.filter((item) => item.toLowerCase() !== trimmed.toLowerCase()),
  ];
  const next = deduped.slice(0, MAX_RECENT_SEARCHES);

  try {
    window.localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(next));
  } catch {
    // ignore storage failures
  }

  return next;
}

function highlightMatch(text: string, query: string) {
  if (!query) return text;
  const regex = new RegExp(`(${escapeRegExp(query)})`, "ig");
  const lowerQuery = query.toLowerCase();

  return text
    .split(regex)
    .filter((fragment) => fragment.length > 0)
    .map((fragment, index) =>
      fragment.toLowerCase() === lowerQuery ? (
        <span key={index} className="font-semibold text-foreground">
          {fragment}
        </span>
      ) : (
        <span key={index}>{fragment}</span>
      ),
    );
}

export function SearchBar({
  value,
  onChange,
  onClear,
  onCommit,
  placeholder = "Search contracts by name, category, or tag...",
}: SearchBarProps) {
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const latestQueryRef = useRef(value);

  useEffect(() => {
    setRecentSearches(loadRecentSearches());
  }, []);

  useEffect(() => {
    latestQueryRef.current = value;

    if (!value.trim()) {
      setSuggestions([]);
      setIsLoading(false);
      setHasError(false);
      setIsOpen(recentSearches.length > 0);
      setHighlightedIndex(-1);
      return;
    }

    setHasError(false);

    const delay = window.setTimeout(async () => {
      let isCurrent = true;
      const loadingTimer = window.setTimeout(() => {
        if (isCurrent) {
          setIsLoading(true);
        }
      }, LOADING_INDICATOR_DELAY_MS);

      try {
        const result = await api.getContractSearchSuggestions(
          value,
          SUGGESTION_FETCH_LIMIT,
        );
        if (latestQueryRef.current !== value) return;

        const sorted = [...result.items].sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return a.text.localeCompare(b.text);
        });

        setSuggestions(sorted);
        setIsOpen(true);
        setHighlightedIndex(-1);
      } catch {
        if (latestQueryRef.current === value) {
          setHasError(true);
          setSuggestions([]);
          setIsOpen(true);
        }
      } finally {
        isCurrent = false;
        window.clearTimeout(loadingTimer);
        if (latestQueryRef.current === value) {
          setIsLoading(false);
        }
      }
    }, SUGGESTION_DEBOUNCE_MS);

    return () => window.clearTimeout(delay);
  }, [value, recentSearches.length]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setHighlightedIndex(-1);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const menuItems = useMemo<MenuItem[]>(() => {
    if (value.trim()) {
      const grouped: Record<
        "contracts" | "categories" | "authors",
        MenuItem[]
      > = {
        contracts: [],
        categories: [],
        authors: [],
      };
      const seen = {
        contracts: new Set<string>(),
        categories: new Set<string>(),
        authors: new Set<string>(),
      };

      for (const suggestion of suggestions) {
        const group = kindToGroup(suggestion.kind);
        if (group === "recent") continue;
        if (grouped[group].length >= MAX_SUGGESTIONS_PER_GROUP) continue;
        const dedupeKey = `${suggestion.kind.toLowerCase()}::${suggestion.text.toLowerCase()}`;
        if (seen[group].has(dedupeKey)) continue;
        seen[group].add(dedupeKey);

        grouped[group].push({
          id: `search-suggestion-${group}-${grouped[group].length}`,
          text: suggestion.text,
          kind: suggestion.kind,
          group,
          source: "suggestion",
          score: suggestion.score,
        });
      }

      return [...grouped.contracts, ...grouped.categories, ...grouped.authors];
    }

    return recentSearches.map((text, index) => ({
      id: `search-suggestion-recent-${index}`,
      text,
      kind: "recent",
      group: "recent",
      source: "recent",
      score: 1,
    }));
  }, [recentSearches, suggestions, value]);

  const groupedMenuItems = useMemo(() => {
    const grouped: Record<MenuItem["group"], MenuItem[]> = {
      contracts: [],
      categories: [],
      authors: [],
      recent: [],
    };

    for (const item of menuItems) {
      grouped[item.group].push(item);
    }

    if (value.trim()) {
      return [grouped.contracts, grouped.categories, grouped.authors].filter(
        (group) => group.length > 0,
      );
    }

    return [grouped.recent].filter((group) => group.length > 0);
  }, [menuItems, value]);

  const commitSearch = (text: string) => {
    onChange(text);
    setIsOpen(false);
    setHighlightedIndex(-1);
    if (text.trim()) {
      setRecentSearches(saveRecentSearch(text));
      onCommit?.(text);
    }
  };

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (menuItems.length === 0) return;
      setIsOpen(true);
      setHighlightedIndex((current) =>
        current < menuItems.length - 1 ? current + 1 : 0,
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (menuItems.length === 0) return;
      setIsOpen(true);
      setHighlightedIndex((current) =>
        current > 0 ? current - 1 : menuItems.length - 1,
      );
      return;
    }

    if (event.key === "Enter") {
      if (isOpen && highlightedIndex >= 0 && menuItems[highlightedIndex]) {
        event.preventDefault();
        commitSearch(menuItems[highlightedIndex].text);
        return;
      }
      if (value.trim()) {
        commitSearch(value);
      }
      return;
    }

    if (event.key === "Escape") {
      setIsOpen(false);
      setHighlightedIndex(-1);
    }
  };

  const hintText = value.trim()
    ? "Matching terms are highlighted and suggestions update as you type."
    : "Type a contract name, category, creator, or tag to get instant results.";

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setIsOpen(true);
            setHighlightedIndex(-1);
          }}
          onFocus={() => {
            if (value.trim() || recentSearches.length > 0) {
              setIsOpen(true);
            }
          }}
          onKeyDown={onInputKeyDown}
          placeholder={placeholder}
          aria-label="Search contracts"
          aria-keyshortcuts="/"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-activedescendant={
            highlightedIndex >= 0 ? menuItems[highlightedIndex]?.id : undefined
          }
          className="w-full pl-12 pr-12 py-4 rounded-xl border border-border bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary shadow-lg"
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              onClear();
              setIsOpen(false);
              setHighlightedIndex(-1);
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Clear search"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
        {SEARCH_HINTS.map((hint) => (
          <span
            key={hint}
            className="rounded-full border border-border bg-card px-3 py-1"
          >
            {hint}
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{hintText}</p>

      {isOpen && (
        <div className="absolute z-20 w-full mt-3 overflow-hidden rounded-3xl border border-border bg-card shadow-2xl">
          {isLoading ? (
            <div className="px-4 py-4 flex items-center justify-between gap-3 text-sm text-muted-foreground">
              <span>Loading suggestions...</span>
            </div>
          ) : menuItems.length > 0 ? (
            <div role="listbox" className="max-h-[65vh] overflow-y-auto">
              {groupedMenuItems.map((group) => (
                <section
                  key={group[0].group}
                  className="border-b border-border last:border-b-0"
                >
                  <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {GROUP_TITLES[group[0].group]}
                  </div>
                  <ul>
                    {group.map((item) => {
                      const index = menuItems.findIndex(
                        (candidate) => candidate.id === item.id,
                      );
                      return (
                        <li
                          key={item.id}
                          id={item.id}
                          role="option"
                          aria-selected={highlightedIndex === index}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            commitSearch(item.text);
                          }}
                          onMouseEnter={() => setHighlightedIndex(index)}
                          className={`cursor-pointer px-4 py-3 hover:bg-primary/10 transition-colors active:bg-primary/15 ${
                            highlightedIndex === index ? "bg-primary/10" : ""
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm text-foreground">
                              {highlightMatch(item.text, value.trim())}
                            </span>
                            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                              {SUGGESTION_LABELS[item.kind] ??
                                SUGGESTION_LABELS.default}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <div className="px-4 py-4 text-sm text-muted-foreground">
              {hasError
                ? "Unable to load suggestions. Try again or press Enter to search."
                : "No suggestions found. Press Enter to search with your current query."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
