// SPDX-License-Identifier: MIT
export interface SearchSource { url: string; title: string }
export interface SearchResult extends SearchSource { content: string }
export interface SearchCheck {
  id: string;
  kind: 'native' | 'tavily';
  model: string;
  status: 'running' | 'succeeded' | 'failed' | 'uncertain';
  sources: SearchSource[];
  error: string | null;
  createdAt: string;
}
export interface WebSearchSettings {
  provider: 'tavily';
  enabled: boolean;
  hasCredential: boolean;
  credentialStorageAvailable: boolean;
  version: number;
  lastCheck: SearchCheck | null;
}
export interface SearchAvailability { native: boolean; external: boolean }
export type SearchRoute = 'native' | 'tavily' | 'none';
export interface SearchRun {
  route: SearchRoute;
  status: 'disabled' | 'available' | 'running' | 'succeeded' | 'failed' | 'uncertain' | 'not_used' | 'unavailable';
  calls: number;
  sources: SearchSource[];
  error: string | null;
}
export function selectSearchRoute(available: SearchAvailability, preference: 'auto' | 'native' | 'external' = 'auto'): SearchRoute {
  if (preference !== 'external' && available.native) return 'native';
  if (preference !== 'native' && available.external) return 'tavily';
  return 'none';
}
