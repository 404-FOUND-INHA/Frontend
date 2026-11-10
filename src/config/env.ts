export const env = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
  apiTimeout: Number(import.meta.env.VITE_API_TIMEOUT ?? 10000),
} as const
