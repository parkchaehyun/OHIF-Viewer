import { GoogleGenAI } from '@google/genai';
import { OpenAI } from 'openai';
import { OPENAI_KEY, GOOGLE_KEY } from './env';


const ai = new GoogleGenAI({
  apiKey: GOOGLE_KEY,
});

export const openai = new OpenAI({
  apiKey: OPENAI_KEY,
  dangerouslyAllowBrowser: true,
});

// Whisper STT
export async function transcribeAudio(file: Blob): Promise<string> {
  const form = new FormData();
  form.append('file', file, 'recording.webm');
  form.append('model', 'whisper-1');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}` },
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()).text;
}

// GPT 번역
export async function translateToEnglish(text: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'Translate the following text to English.' },
        { role: 'user', content: text },
      ],
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()).choices[0].message.content;
}

const WORKLIST_FEWSHOTS = `You are a helpful PACS assistant in a medical study list viewer. Convert user instructions into structured JSON commands. Supported commands include:

─── WorkList commands ───
- filter: Apply filters like patientName, description, modalities, or studyDateRange.
- go_to_page: Change the page number.
- sort: Sort the list by a column and direction.
- clear_filters: Remove all current filters.
- open_study: Open a specific study by StudyInstanceUID.
- show_version: Show app version info.
- open_upload: Open the DICOM file upload dialog.
- define_macro: Save a named sequence of steps (worklist or viewer) under a macro.
- perform_macro: Execute a previously defined macro.

If multiple patientName/UID pairs are provided in Context, choose the one most similar to the user’s input (spelling/pronunciation).
- If the user instruction includes a **filter** followed by a **numbered result** (e.g., "4th", "second"), you MUST:
   1. First apply the filter command.
   2. Then return: { "command": "open_study_index", "index": N }

- DO NOT return open_study with studyInstanceUid in these cases. Even if RAG gives matching patients, you must ignore them.

Respond ONLY in JSON format with the fields { "command": ..., other_fields... }

### WorkList Examples

Instruction: "Filter the list to only show brain MRI scans"
Thought: Brain MRI means modality is MR, and 'brain' is likely in description.
{
  "command": "filter",
  "modalities": ["MR"],
  "description": "brain"
}

Instruction: "Show me studies of Kim Minji"
Thought: Filter patientName field to "Kim Minji"
{
  "command": "filter",
  "patientName": "Kim Minji"
}

Instruction: "Only show CT scans from last week"
Thought: CT is the modality, and last week’s date range is needed.
{
  "command": "filter",
  "modalities": ["CT"],
  "studyDateRange": ["2025-04-08", "2025-04-15"]
}

Instruction: "Go to page 3"
Thought: This is a pagination request
{
  "command": "go_to_page",
  "pageNumber": 3
}

Instruction: "Next page please"
Thought: Increment the current page number
{
  "command": "go_to_page",
  "pageNumber": 2
}

Instruction: "Take me to the first page"
Thought: This means set page number to 1
{
  "command": "go_to_page",
  "pageNumber": 1
}

Instruction: "Sort by patient name in ascending order"
Thought: Sort column is patientName, direction is ascending
{
  "command": "sort",
  "sortBy": "patientName",
  "sortDirection": "ascending"
}

Instruction: "Sort from newest to oldest"
Thought: User wants most recent dates first → ascending order.
{
  "command": "sort",
  "sortBy": "studyDate",
  "sortDirection": "ascending"
}


Instruction: "Sort from oldest to newest"
Thought: User wants oldest dates first → descending order.
{
  "command": "sort",
  "sortBy": "studyDate",
  "sortDirection": "descending"
}


Instruction: "Sort the results by date descending"
Thought: Sort by studyDate in descending order
{
  "command": "sort",
  "sortBy": "studyDate",
  "sortDirection": "descending"
}

Instruction: "Go back to the main page"
Thought: Reset filters and go to page 1
{
  "command": "go_to_main_page"
}

Instruction: "Show me the default screen"
Thought: Clear filters and return to page 1
{
  "command": "go_to_main_page"
}


Instruction: "Open the second patient"
Thought: This refers to index 2 of currentPageStudies.
{
  "command": "open_study_index",
  "index": 2
}

{
  "command": "run_sequence",
  "steps": [
    {
      "command": "filter",
      "studyDateRange": [null, "1999-12-31"]
    },
    {
      "command": "open_study_index",
      "index": 3
    }
  ]
}

Instruction: "Show me CT scans and open the 4th one"
Thought: Filter by modality CT, then open index 4 on the resulting page.
{
  "command": "run_sequence",
  "steps": [
    {
      "command": "filter",
      "modalities": ["CT"]
    },
    {
      "command": "open_study_index",
      "index": 4
    }
  ]
}

Instruction: "Filter to CT and open the 4th result"
Thought: MUST apply the filter first. Then open the 4th item AFTER filtering. Do NOT use UID directly.
{
  "command": "run_sequence",
  "steps": [
    {
      "command": "filter",
      "modalities": ["CT"]
    },
    {
      "command": "open_study_index",
      "index": 4
    }
  ]
}

Instruction: "Clear all filters"
Thought: Reset all filtering values
{
  "command": "clear_filters"
}

Instruction: "Remove the filters"
Thought: Again, user wants to clear filters
{
  "command": "clear_filters"
}

Instruction: "Open the study for Neptune"
Thought: Patient name is 'Neptune'. Use RAG context to find the UID.
{
  "command": "open_study",
  "studyInstanceUid": "1.3.6.1.4.1.25403.345050719074.3824.20170125095438.5"
}

Instruction: "Open the study for Horse"
Thought: Patient name is 'Horse'. Use context to find the correct UID.
{
  "command": "open_study",
  "studyInstanceUid": "2.25.96975534054447904995905761963464388233"
}

Instruction: "Show me the scan of M1"
Thought: Patient name is 'M1'. Use RAG context to locate UID.
{
  "command": "open_study",
  "studyInstanceUid": "2.25.232704420736447710317909004159492840763"
}

Instruction: "What's the version?"
Thought: User is asking for version information
{
  "command": "show_version"
}

Instruction: "Upload a DICOM file"
Thought: Open the upload UI
{
  "command": "open_upload"
}

Instruction: "Run these together: go to page 3, then filter by patient 'Kim', then sort by date descending"
Thought: We want to execute three steps in sequence without saving a macro.
{
  "command": "run_sequence",
  "steps": [
    {
      "command": "go_to_page",
      "pageNumber": 3
    },
    {
      "command": "filter",
      "patientName": "Kim"
    },
    {
      "command": "sort",
      "sortBy": "studyDate",
      "sortDirection": "descending"
    }
  ]
}

Instruction: "Define a macro named A that opens the latest study"
Thought: We store the two‐step sequence under macro "A".
{
  "command": "define_macro",
  "macroName": "A",
  "steps": [
    {
      "command": "sort",
      "sortBy": "studyDate",
      "sortDirection": "descending"
    },
    {
      "command": "open_study",
      "studyInstanceUid": "{{studies[0].studyInstanceUid}}"
    }
  ]
}

Instruction: "Perform macro A"
Thought: We want to run the previously defined macro "A".
{
  "command": "perform_macro",
  "macroName": "A"
}

Instruction: "Define a macro named B that goes to page 1, clears filters, and sorts by patientName ascending"
Thought: Store a three‐step sequence under macro "B".
{
  "command": "define_macro",
  "macroName": "B",
  "steps": [
    {
      "command": "go_to_page",
      "pageNumber": 1
    },
    {
      "command": "clear_filters"
    },
    {
      "command": "sort",
      "sortBy": "patientName",
      "sortDirection": "ascending"
    }
  ]
}

Instruction: "Run macro B"
Thought: Execute macro "B" (page 1 → clear → sort).
{
  "command": "perform_macro",
  "macroName": "B"
}

Instruction: "Go to the second page and open the first study"
Thought: Change to page 2, then open the top study on that page.
{
  "command": "run_sequence",
  "steps": [
    {
      "command": "go_to_page",
      "pageNumber": 2
    },
    {
      "command": "open_study",
      "studyInstanceUid": "{{studies[0].studyInstanceUid}}"
    }
  ]
}
`;

const VIEWER_FEWSHOTS = `You are a helpful assistant inside a medical image viewer. Convert input into layout or interaction commands. Supported commands include:

- change_layout: Change the layout. Supported layouts include "1x1", "2x2", "2x1", "3x1".
- rotate_view: Rotate the image. Use direction (left/right) and angle.
- pan_view: Move the image in screen space. Use dx and dy.
- zoom_view: Zoom in/out with direction, intensity, and optional dx/dy.
- play_cine / stop_cine: Start/stop playback.
- download_image: Download the current view.
- reset_view: Reset pan/zoom.

Respond ONLY in JSON format with fields like { "command": ..., other_fields... }

### Viewer Examples

Instruction: "Switch to a 2 by 2 layout"
Thought: Set layout to 2×2.
{
  "command": "change_layout",
  "layout": "2x2"
}

Instruction: "Rotate the image right 90 degrees"
Thought: Issue a rotate right 90 command
{
  "command": "rotate_view",
  "direction": "right",
  "angle": 90
}

Instruction: "Zoom in 3 times toward the upper left"
Thought: Direction is in, intensity 3, upper-left corresponds to dx -1 and dy 1
{
  "command": "zoom_view",
  "direction": "in",
  "intensity": 3,
  "dx": -1,
  "dy": 1
}

Instruction: "Play the series"
Thought: Enable cine playback
{
  "command": "play_cine"
}

Instruction: "Stop playing"
Thought: Stop cine playback
{
  "command": "stop_cine"
}

Instruction: "Download the image"
Thought: Trigger download without modal
{
  "command": "download_image"
}

Instruction: "Move the image up"
Thought: Pan the image up
{
  "command": "pan_view",
  "dx": 0,
  "dy": 50
}

Instruction: "Shift view right"
Thought: Pan right in screen space
{
  "command": "pan_view",
  "dx": 50,
  "dy": 0
}

Instruction: "Reset the view"
Thought: Reset zoom and pan to default
{
  "command": "reset_view"
}

Instruction: "Run these together: switch to 2×2, then zoom in twice, then download"
Thought: We want three viewer commands in one shot without saving a macro.
{
  "command": "run_sequence",
  "steps": [
    {
      "command": "change_layout",
      "layout": "2x2"
    },
    {
      "command": "zoom_view",
      "direction": "in",
      "intensity": 1,
      "dx": 0,
      "dy": 0
    },
    {
      "command": "zoom_view",
      "direction": "in",
      "intensity": 1,
      "dx": 0,
      "dy": 0
    },
    {
      "command": "download_image"
    }
  ]
}

Instruction: "Define a macro named V1 that resets view and stops cine"
Thought: Save a two‐step macro called "V1".
{
  "command": "define_macro",
  "macroName": "V1",
  "steps": [
    {
      "command": "reset_view"
    },
    {
      "command": "stop_cine"
    }
  ]
}

Instruction: "Perform macro V1"
Thought: Execute the named macro "V1" (reset + stop).
{
  "command": "perform_macro",
  "macroName": "V1"
}

Instruction: "Define macro V2 to pan up 50, pan right 50, and zoom out once"
Thought: Store three viewer steps under macro "V2".
{
  "command": "define_macro",
  "macroName": "V2",
  "steps": [
    {
      "command": "pan_view",
      "dx": 0,
      "dy": -50
    },
    {
      "command": "pan_view",
      "dx": 50,
      "dy": 0
    },
    {
      "command": "zoom_view",
      "direction": "out",
      "intensity": 1,
      "dx": 0,
      "dy": 0
    }
  ]
}

Instruction: "Run macro V2"
Thought: Execute macro V2 (pan up → pan right → zoom out).
{
  "command": "perform_macro",
  "macroName": "V2"
}
`;

const FEWSHOTS: Record<string, string> = {
  worklist: `${WORKLIST_FEWSHOTS}

${VIEWER_FEWSHOTS}`,
  viewer: VIEWER_FEWSHOTS,
};

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 },
    () => Array(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[a.length][b.length];
}

function similarity(a: string, b: string): number {
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}

function buildRAGContextFromStudies(
  studies: Study[],
  promptText: string
): string {
  const query = promptText.trim().toLowerCase();
  if (/\b(first|second|third|fourth|fifth|\d+ ?(st|nd|rd|th|번째))\b/.test(query)) {
    return '';
  }

  const scored = studies.map(s => {
    const name = s.patientName?.toLowerCase() ?? '';
    return {
      study: s,
      score: similarity(query, name),
    };
  });

  const candidates = scored
    .filter(x => x.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(x => x.study);

  if (candidates.length === 0) return '';

  const listJson = candidates
    .map(s =>
      `  { "patientName": "${s.patientName}", "studyInstanceUid": "${s.studyInstanceUid}" }`
    )
    .join(',\n');

  return `
### Context:
Here are possible matching studies.
Pick the one whose patientName best matches the user’s instruction (spelling/pronunciation).

[
${listJson}
]
`;
}

function buildCurrentPageContext(currentPageStudies: Study[]): string {
  if (!currentPageStudies.length) return '';

  const items = currentPageStudies.map((s, idx) => {
    return `  { "index": ${idx + 1}, "patientName": "${s.patientName}", "studyInstanceUid": "${s.studyInstanceUid}" }`;
  });

  return `
### current_page:
These are the studies currently visible on screen (1-based index):
[
${items.join(',\n')}
]

Instructions:
- Only return the UID of a study if the user's requested index exists in this list.
- If the user requests an index not listed here (e.g., "10th study" but only 3 are shown), do NOT return any studyInstanceUid. Instead, respond with:
{
  "command": "error",
  "message": "Invalid index: no such study on the current page"
}
`;
}

export async function sendPromptToLLM(
  promptText: string,
  context: 'worklist' | 'viewer' = 'worklist',
  studies: Study[] = [],
  currentPageStudies: Study[] = []
): Promise<any | null> {
  const fewshot = FEWSHOTS[context];
  const ragContext = buildRAGContextFromStudies(studies, promptText);
  const currentPageContext = buildCurrentPageContext(currentPageStudies);

  const fullPrompt = `${fewshot}\n${ragContext}\n${currentPageContext}\nUser: ${promptText}\nResponse:`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [
        {
          role: "user",
          parts: [{ text: fullPrompt }]
        }
      ]
    });

    let raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
    if (raw?.startsWith("```json") || raw?.startsWith("```")) {
      raw = raw.replace(/```json|```/g, "").trim();
    }
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.error("JSON 파싱 실패:", raw);
      return null;
    }
  } catch (error) {
    console.error("Gemini API 요청 실패:", error);
    return null;
  }
}
