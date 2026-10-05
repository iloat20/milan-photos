import { create } from "zustand"; export const useGallery = create((set) => ({ photos: [], add: (p) => set((s) => ({ photos: [...s.photos, p] })) }));
