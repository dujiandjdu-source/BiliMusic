import { Song } from "../types";
import { BilibiliVideoInfo } from "../types";
import { NeteaseTrackInfo } from "../services/lyricsService";

export type SearchResultItem = Song | NeteaseTrackInfo | BilibiliVideoInfo;

export interface SearchProvider {
  // Unique identifier for this provider
  id: string;
  // Display name for the tab
  label: string;
  // Whether this provider requires explicit search action (e.g., pressing Enter)
  requiresExplicitSearch: boolean;
  // Search function - returns results based on query
  search: (query: string, options?: any) => Promise<SearchResultItem[]>;
  // Load more results (for pagination)
  loadMore?: (query: string, offset: number, limit: number) => Promise<SearchResultItem[]>;
  // Whether there are more results to load
  hasMore?: boolean;
  // Loading state
  isLoading?: boolean;
}

export interface UseSearchProviderResult {
  providers: SearchProvider[];
  activeProvider: SearchProvider;
  setActiveProviderId: (id: string) => void;
}
