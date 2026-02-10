/**
 * Intent Recognition Patterns
 *
 * Regular expression patterns for detecting user intents in natural language.
 * Supports both Spanish and English.
 */

import type { IntentType } from "./types.js";

/**
 * Confidence levels
 */
export const CONFIDENCE: Record<string, number> = {
  HIGH: 0.9,
  MEDIUM: 0.75,
  LOW: 0.6,
  MINIMUM: 0.5,
};

/**
 * Intent patterns for recognition
 */
export const INTENT_PATTERNS: Record<IntentType, RegExp[]> = {
  // Plan / Architecture
  plan: [
    // Spanish
    /^(haz|crea|genera|necesito)\s+(un\s+)?plan/i,
    /^(diseña|arquitectura|planifica)/i,
    /^(genera\s+(la\s+)?arquitectura)/i,
    /plan\s+(de\s+)?arquitectura/i,
    /quiero\s+(un\s+)?plan\s+para/i,
    // English
    /^(create|make|generate)\s+(a\s+)?plan/i,
    /^(design|architect)\s+(the\s+)?(architecture|system)/i,
    /plan\s+(the\s+)?(architecture|design)/i,
    /i\s+need\s+(a\s+)?plan/i,
    /let'?s\s+(plan|design)/i,
  ],

  // Build / Complete
  build: [
    // Spanish
    /^(construye|compila|genera\s+(el\s+)?c[oó]digo)/i,
    /^(implementa|desarrolla)\s+(el\s+)?(proyecto|sprint)/i,
    /^(ejecuta|run)\s+(la\s+)?(fase\s+)?(complete|build)/i,
    /empieza\s+a\s+(construir|programar)/i,
    /construye\s+(el\s+)?(proyecto|sprint)/i,
    // English
    /^(build|compile|implement)\s+(the\s+)?(project|sprint)/i,
    /^(code|develop)\s+(the\s+)?(project|features)/i,
    /start\s+(building|coding|implementing)/i,
    /let'?s\s+build/i,
    /run\s+(the\s+)?(complete|build)\s+phase/i,
  ],

  // Task
  task: [
    // Spanish
    /^(haz|implementa|crea)\s+(la\s+)?tarea/i,
    /^(trabaja\s+en|work\s+on)/i,
    /^(ejecuta|execute)\s+(la\s+)?tarea/i,
    /completa\s+(la\s+)?tarea/i,
    /marcar\s+tarea\s+como\s+(hecha|completada)/i,
    // English
    /^(do|complete|finish)\s+(the\s+)?task/i,
    /work\s+on\s+(the\s+)?task/i,
    /mark\s+task\s+as\s+(done|complete)/i,
    /start\s+(the\s+)?task/i,
  ],

  // Init
  init: [
    // Spanish
    /^(inicializa|init|empieza|comienza)\s+(un\s+)?(nuevo\s+)?proyecto/i,
    /^(crea|create)\s+(una\s+)?(nueva\s+)?(api|app|cli|aplicaci[oó]n)/i,
    /nuevo\s+proyecto/i,
    /inicializar\s+(corbat[-\s]?coco|coco)/i,
    // English
    /^(init|initialize|start)\s+(a\s+)?(new\s+)?project/i,
    /create\s+(a\s+)?(new\s+)?(api|app|cli|application)/i,
    /new\s+project/i,
    /let'?s\s+(start|begin)/i,
  ],

  // Output
  output: [
    // Spanish
    /^(genera|crea)\s+(la\s+)?(documentaci[oó]n|docs)/i,
    /^(configura|setup)\s+(el\s+)?ci\/cd/i,
    /^(genera|create)\s+(los\s+)?workflows/i,
    /fase\s+output/i,
    // English
    /^(generate|create)\s+(the\s+)?(documentation|docs)/i,
    /setup\s+(the\s+)?ci\/cd/i,
    /generate\s+(the\s+)?workflows/i,
    /output\s+phase/i,
    /deploy(ment)?\s+config/i,
  ],

  // Status
  status: [
    // Spanish
    /^(estado|status|s)\s*(de\s+)?(proyecto)?$/i,
    /^(c[oó]mo\s+va|c[oó]mo\s+vamos)/i,
    /^(qu[eé]\s+tal|qu[eé]\s+pas[oó])/i,
    /muestra\s+(el\s+)?estado/i,
    // English
    /^status\s*(check)?$/i,
    /^(how\s+are\s+we|what'?s\s+the\s+status)/i,
    /show\s+(me\s+)?(the\s+)?status/i,
    /project\s+status/i,
  ],

  // Trust
  trust: [
    // Spanish
    /^(trust|confianza|permisos)/i,
    /^(nivel\s+de\s+)?(trust|acceso)/i,
    /configurar\s+permisos/i,
    // English
    /^trust\s+(level|status)?$/i,
    /^(check|show)\s+trust/i,
    /permissions?/i,
  ],

  // Help
  help: [
    // Spanish
    /^(ayuda|help|\?)$/i,
    /^(c[oó]mo|c[oó]mo\s+funciona)/i,
    /^(qu[eé]|cu[aá]les)\s+(son\s+)?(los\s+)?comandos/i,
    /no\s+s[eé]\s+qu[eé]\s+hacer/i,
    // English
    /^(help|\?|h)$/i,
    /^how\s+(do|does|to|can)/i,
    /what\s+(are|is)\s+(the\s+)?commands?/i,
    /i\s+don'?t\s+know\s+what\s+to\s+do/i,
  ],

  // Exit
  exit: [
    // Spanish
    /^(exit|quit|salir|adi[oó]s|bye)/i,
    /^(terminar|cerrar|finalizar)/i,
    /hasta\s+luego/i,
    // English
    /^(exit|quit|q|bye)$/i,
    /^(good)?bye$/i,
    /see\s+you/i,
    /i'?m\s+done/i,
  ],

  // Ship / Release
  ship: [
    // Spanish
    /^(publica|lanza|env[ií]a|sube)\s*(los\s+cambios)?/i,
    /listo\s+para\s+(publicar|lanzar|subir)/i,
    /^(crea|abre)\s+(un\s+)?(pr|pull\s*request)/i,
    /quiero\s+(publicar|lanzar|hacer\s+release)/i,
    /^(haz|genera)\s+(un\s+)?release/i,
    // English
    /^(ship|release|publish|deploy)\s*(it|this|changes)?$/i,
    /let'?s\s+(ship|release|publish)/i,
    /ready\s+to\s+(ship|release|merge)/i,
    /^(create|make|open)\s+(a\s+)?(pr|pull\s*request)/i,
    /push\s+(to|and)\s+(main|production|release)/i,
  ],

  // Open / Execute files
  open: [
    // Spanish
    /^(abre|abrir|muestra|mostrar)\s+(el\s+)?(archivo|fichero)/i,
    /^(ejecuta|ejecutar|corre|correr|lanza)\s+(el\s+)?(archivo|script|programa)/i,
    /^(puedes?\s+)?(abrir|ejecutar|correr|mostrar|visualizar)\s+/i,
    /^(abre|ejecuta|corre)\s+\S+/i,
    // English
    /^(open|show|view|display)\s+(the\s+)?(file|image|page|document)/i,
    /^(run|execute|launch)\s+(the\s+)?(file|script|program|binary)/i,
    /^(can\s+you\s+)?(open|run|execute|launch)\s+/i,
    /^(open|run|exec)\s+\S+\.\w+/i,
  ],

  // Chat (default - no specific patterns, matches everything with low confidence)
  chat: [
    /.*/, // Matches anything as fallback
  ],
};

/**
 * Entity extraction patterns
 */
export const ENTITY_PATTERNS = {
  /** Extract sprint number */
  sprint: /(?:sprint|s)\s*(?:number|num|n)?\s*[:#]?\s*(\d+)/i,

  /** Extract task ID */
  taskId: /(?:task|tarea)\s*(?:id)?\s*[:#]?\s*([a-zA-Z0-9_-]+)/i,

  /** Extract project name */
  projectName: /(?:project|proyecto)\s*(?:name|nombre)?\s*[:\s]+([a-zA-Z0-9_-]+)/i,

  /** Extract flags like --dry-run, --yes */
  flags: /--([a-zA-Z-]+)/g,

  /** Tech stack keywords */
  techStack:
    /(node\.?js|typescript|python|go|golang|rust|java|react|vue|angular|docker|kubernetes|aws|gcp|azure|postgres|mysql|mongo|redis)\b/gi,
};

/**
 * Get patterns for a specific intent type
 */
export function getPatternsForIntent(type: IntentType): RegExp[] {
  return INTENT_PATTERNS[type] || [];
}

/**
 * Calculate confidence boost based on input characteristics
 */
export function calculateConfidenceBoost(input: string): number {
  let boost = 0;

  // Shorter inputs are more likely to be commands
  if (input.length < 20) {
    boost += 0.1;
  }

  // Input starting with action verbs
  if (
    /^(haz|crea|genera|construye|implementa|ejecuta|inicializa|abre|create|make|build|run|start|open|exec)/i.test(
      input,
    )
  ) {
    boost += 0.15;
  }

  // Input with explicit phase names
  if (
    /(converge|orchestrate|complete|output|plan|build|init|ship|release|publish|open|exec)/i.test(
      input,
    )
  ) {
    boost += 0.1;
  }

  // Questions are less likely to be commands
  if (input.endsWith("?")) {
    boost -= 0.15;
  }

  return Math.max(0, boost);
}
