/** The languages the transcription model knows, by the code it takes and the name a speaker of it reads. */
export const VOICE_LANGUAGES: { code: string; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'de', name: 'Deutsch' },
  { code: 'fr', name: 'Français' },
  { code: 'es', name: 'Español' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português' },
  { code: 'pl', name: 'Polski' },
  { code: 'el', name: 'Ελληνικά' },
  { code: 'ar', name: 'العربية' },
  { code: 'zh', name: '中文' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'vi', name: 'Tiếng Việt' },
];

// The model cannot tell which language it hears: told the wrong one, it writes invented words in that language.
export function voiceLanguage(chosen: string | undefined, preferred: readonly string[] = browserLanguages()): string {
  if (chosen && VOICE_LANGUAGES.some((language) => language.code === chosen)) return chosen;
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0];
    if (VOICE_LANGUAGES.some((language) => language.code === base)) return base!;
  }
  return 'en';
}

function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : [];
}
