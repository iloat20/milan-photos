export const pad = (n: number): string => String(n).padStart(2, "0");
export const uid = (): string => `u${Date.now().toString(36)}${Math.random().toString(36).slice(2,7)}`;
