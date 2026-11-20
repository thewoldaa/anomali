export type IntentSeed = {
  slug: string;
  label: string;
  priority?: number;
  guess?: string;
  triggers: string[];
  responses: Record<string, string[]>;
  responses_no_memory?: Record<string, string[]>;
};

/**
 * Patch intent. File dengan entri seperti ini akan DIGABUNG ke intent yang
 * slug-nya sama — dipakai untuk menambah nada/kalimat tanpa mengubah file seed
 * aslinya.
 */
export type IntentPatch = {
  slug: string;
  triggers?: string[];
  guess?: string;
  responses?: Record<string, string[]>;
  responses_no_memory?: Record<string, string[]>;
};
