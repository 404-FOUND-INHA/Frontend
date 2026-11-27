export const evaluationKeys = {
  settings: () => ['evaluation', 'settings'] as const,
  previewScores: () => ['evaluation', 'previewScores'] as const,
  updateSettings: () => ['evaluation', 'settings', 'update'] as const,
}
