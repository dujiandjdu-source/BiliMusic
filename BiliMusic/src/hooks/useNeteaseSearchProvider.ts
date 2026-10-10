import type { SearchProvider } from "./useSearchProvider";
import { useI18n } from "./useI18n";
import { searchNetEase, type NeteaseTrackInfo } from "../services/lyricsService";
import { usePaginatedSearch } from "./usePaginatedSearch";

const fetchPage = (query: string, offset: number, limit: number) => searchNetEase(query, { limit, offset });
const keyOf = (track: NeteaseTrackInfo) => track.neteaseId || track.id;

export interface NeteaseSearchProviderExtended extends SearchProvider {
  performSearch: (query: string) => Promise<void>;
  hasSearched: boolean;
  results: NeteaseTrackInfo[];
}

export const useNeteaseSearchProvider = (): NeteaseSearchProviderExtended => {
  const { dict } = useI18n();
  const search = usePaginatedSearch({ limit: 30, fetchPage, keyOf });
  return { ...search, id: "netease", label: dict.search.cloudLabel,
    requiresExplicitSearch: true, search: async () => search.results };
};
