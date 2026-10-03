// Voix de Kimia : voix neuronales de Microsoft Edge (gratuites, sans clé, très naturelles).
// Partagé entre le serveur (/api/tts) et l'interface (choix de la voix dans Paramètres).

export const VOICES = [
  { id: "fr-FR-VivienneMultilingualNeural", label: "Vivienne", accent: "France", note: "chaleureuse, la plus naturelle" },
  { id: "fr-FR-DeniseNeural", label: "Denise", accent: "France", note: "claire et posée" },
  { id: "fr-FR-EloiseNeural", label: "Éloïse", accent: "France", note: "jeune et dynamique" },
  { id: "fr-CA-SylvieNeural", label: "Sylvie", accent: "Québec", note: "accent québécois" },
  { id: "fr-BE-CharlineNeural", label: "Charline", accent: "Belgique", note: "accent belge" },
  { id: "fr-CH-ArianeNeural", label: "Ariane", accent: "Suisse", note: "accent suisse" },
] as const;

export type VoiceId = (typeof VOICES)[number]["id"];
export const DEFAULT_VOICE: VoiceId = "fr-FR-VivienneMultilingualNeural";
export const VOICE_KEY = "markova:voice";

export const isVoice = (v: unknown): v is VoiceId => VOICES.some((x) => x.id === v);
