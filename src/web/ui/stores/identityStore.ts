import { create } from 'zustand';
import { AUTHOR_STORAGE_KEY } from '../lib/identity.ts';

interface IdentityState {
  /** Name picked in the UI ('' = the server's git identity). */
  author: string;
  setAuthor: (value: string) => void;
}

function readStoredAuthor(): string {
  try {
    return localStorage.getItem(AUTHOR_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export const useIdentityStore = create<IdentityState>((set) => ({
  author: readStoredAuthor(),
  setAuthor: (value) => {
    try {
      if (value) localStorage.setItem(AUTHOR_STORAGE_KEY, value);
      else localStorage.removeItem(AUTHOR_STORAGE_KEY);
    } catch {
      // storage unavailable; keep the choice for this session only
    }
    set({ author: value });
  },
}));
