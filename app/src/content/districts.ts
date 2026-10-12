/** Every district of the floating city. Copy is carried over verbatim from v1. */
export interface District {
  id: number;
  name: string;
  displayName?: string;
  url: string;
  language: string | null;
  stars: number;
  size: number;
  updatedAt: string;
  production?: boolean;
  research?: boolean;
  privateProject?: boolean;
  impact?: string;
  capabilities?: string[];
  color: string;
}

/** When the public repository snapshot below was taken. */
export const REPOSITORY_SNAPSHOT_AT = '2026-09-04T21:33:41.841Z';

const PALETTE = ['#ff9b69', '#83dcca', '#e9c674', '#8eabc4', '#acb980', '#de9e8b'];

const PROJECTS: Omit<District, 'color'>[] = [
  {
    id: -8,
    name: 'qabul.turin.uz',
    displayName: 'Admissions Platform',
    url: 'https://qabul.turin.uz',
    language: null,
    stars: 0,
    size: 8000,
    updatedAt: '2026-09-05T00:00:00Z',
    production: true,
    impact: '11,000 users',
  },
  {
    id: -7,
    name: 'lms.turin.uz',
    displayName: 'University LMS',
    url: 'https://lms.turin.uz',
    language: null,
    stars: 0,
    size: 8000,
    updatedAt: '2026-09-05T00:00:00Z',
    production: true,
    impact: 'Serving the entire university',
  },
  {
    id: -6,
    name: 'ar.turin.uz',
    displayName: 'Augmented Reality',
    url: 'https://ar.turin.uz',
    language: null,
    stars: 0,
    size: 4200,
    updatedAt: '2026-09-05T00:00:00Z',
    production: true,
    impact: 'AR for publishing · Presented to the President of Uzbekistan',
  },
  {
    id: -5,
    name: 'inventar.uz',
    displayName: 'Inventar',
    url: 'https://inventar.uz',
    language: null,
    stars: 0,
    size: 5200,
    updatedAt: '2026-09-05T00:00:00Z',
    production: true,
    impact: 'Inventory management · In production',
  },
  {
    id: -4,
    name: 'fotobudka.uz',
    displayName: 'Fotobudka',
    url: 'https://fotobudka.uz',
    language: null,
    stars: 0,
    size: 3200,
    updatedAt: '2026-09-05T00:00:00Z',
    production: true,
    impact: 'Photo booth platform · In production',
  },
  {
    id: -3,
    name: 'skud.turin.uz',
    displayName: 'SKUD / Access Control',
    url: 'https://skud.turin.uz',
    language: null,
    stars: 0,
    size: 5000,
    updatedAt: '2026-09-05T00:00:00Z',
    production: true,
    impact: 'Access-control systems used by multiple organizations',
  },
  {
    id: -2,
    name: 'pbx.turin.uz',
    displayName: 'PBX / Communications',
    url: 'https://pbx.turin.uz',
    language: null,
    stars: 0,
    size: 4800,
    updatedAt: '2026-09-05T00:00:00Z',
    production: true,
    impact: 'Telephony platforms used by multiple organizations',
  },
  {
    id: -1,
    name: 'eduwifi.uz',
    displayName: 'EDUWIFI',
    url: 'https://eduwifi.uz',
    language: null,
    stars: 0,
    size: 4000,
    updatedAt: '2026-09-05T00:00:00Z',
    production: true,
    impact: 'Original developer of the platform',
  },
  {
    id: 0,
    name: 'KIRA AI',
    displayName: 'KIRA AI / Speech Lab',
    url: 'https://t.me/polito_uz/5958',
    language: 'Python',
    stars: 0,
    size: 4800,
    updatedAt: '2026-09-05T00:00:00Z',
    research: true,
    impact: 'Uzbek speech intelligence · Public STT, unreleased TTS',
  },
  {
    id: 1,
    name: 'EDU AI / CAU',
    displayName: 'EDU AI / CAU University',
    url: 'https://t.me/umaraliev_ravshan',
    language: null,
    stars: 0,
    size: 5000,
    updatedAt: '2026-09-05T00:00:00Z',
    production: true,
    privateProject: true,
    impact: 'AI-powered assessments, fully integrated into the university LMS',
    capabilities: [
      'Turn course topics, documents, presentations and lecture recordings into assessments.',
      'Generate single-answer, multiple-answer, true/false and fill-in-the-blank questions.',
      'Check submitted answers, calculate scores and explain the correct answers.',
      'Transcribe audio and extract teaching material from uploaded files.',
      'Create and complete assessments in English or Russian, inside the existing LMS workflow.',
    ],
  },
];

const PUBLIC_REPOSITORIES: Omit<District, 'color'>[] = [
  {
    id: 1311777869,
    name: 'cinder',
    url: 'https://github.com/eukalpia/cinder',
    language: 'Dart',
    stars: 0,
    size: 1975,
    updatedAt: '2026-07-25T07:37:55Z',
  },
  {
    id: 1357601996,
    name: 'eukalpia',
    url: 'https://github.com/eukalpia/eukalpia',
    language: null,
    stars: 0,
    size: 0,
    updatedAt: '2026-09-04T21:19:19Z',
  },
  {
    id: 1338166228,
    name: 'Pixen',
    url: 'https://github.com/eukalpia/Pixen',
    language: null,
    stars: 0,
    size: 5,
    updatedAt: '2026-08-18T08:35:41Z',
  },
  {
    id: 1290344210,
    name: 'PodBus',
    url: 'https://github.com/eukalpia/PodBus',
    language: 'Dart',
    stars: 1,
    size: 2916,
    updatedAt: '2026-09-04T17:06:02Z',
  },
  {
    id: 1332270742,
    name: 'tensora',
    url: 'https://github.com/eukalpia/tensora',
    language: 'C++',
    stars: 1,
    size: 1411,
    updatedAt: '2026-08-30T19:39:57Z',
  },
  {
    id: 1335297789,
    name: 'veyra',
    url: 'https://github.com/eukalpia/veyra',
    language: null,
    stars: 0,
    size: 1028,
    updatedAt: '2026-08-18T20:57:13Z',
  },
];

export const DISTRICTS: readonly District[] = [...PROJECTS, ...PUBLIC_REPOSITORIES]
  .sort((a, b) => a.id - b.id)
  .map((d, i) => ({ ...d, color: PALETTE[i % PALETTE.length] }));
