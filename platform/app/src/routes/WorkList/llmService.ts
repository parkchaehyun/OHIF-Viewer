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

WorkList commands
- filter: Apply filters like patientName, description, modalities, or studyDateRange.
- go_to_page: Change the page number.
- sort: Sort the list by a column and direction.
- clear_filters: Remove all current filters.
- open_study: Open a specific study by StudyInstanceUID.
- show_version: Show app version info.
- open_upload: Open the DICOM file upload dialog.
- define_macro: Save a named sequence of steps (worklist or viewer) under a macro.
- perform_macro: Execute a previously defined macro.

Guidelines
- If the instruction includes a filter(e.g. by date, modality, name) followed by a numbered study (e.g. "2nd", "first", "open number 3"), then:
   1. First generate a filter command.
   2. Then generate: { "command": "open_study_index", "index": N }
- For study date filtering, always use the format: "studyDateRange": ["YYYY-MM-DD", "YYYY-MM-DD"] with identical start and end values.
- Output must be a valid **single JSON object** (no extra text, no markdown, no explanation).
- Respond ONLY with structured JSON in the format: { "command": ..., ... } – no text, no comments.
- Do not split filter and open into a run_sequence; just return two top-level commands in sequence.
- If the input mentions a proper noun (like a person's name, e.g., "Kim Minji", etc.), assume it refers to the patientName field unless explicitly stated otherwise.
- Do NOT use the "description" field unless the user clearly refers to modality type, body part, or scan purpose.
- Always distinguish between "search" and "open" intentions:
    - If the user says to search, find, show, or display studies or patients, always respond with a "filter" command only.
    - If the user explicitly requests to open a study (e.g., "open the 1st one", "show me the 2nd scan"), use "open_study_index" after filtering.


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

Instruction: "Show me the most recent patient study"
Thought: "Most recent" implies the latest study by date.
So we need to sort by studyDate in ascending order, then open the first study.
This requires a run_sequence with sort + open_study_index(index=1).
{
  "command": "run_sequence",
  "steps": [
    { "command": "sort", "sortBy": "studyDate", "sortDirection": "ascending" },
    { "command": "open_study_index", "index": 1 }
  ]
}

Instruction: "Show me the oldest study"
Thought: "Oldest" means the earliest study by date.
We sort by studyDate in descending order, then open the first study.
{
  "command": "run_sequence",
  "steps": [
    { "command": "sort", "sortBy": "studyDate", "sortDirection": "descending" },
    { "command": "open_study_index", "index": 1 }
  ]
}

Instruction: "Show me the recently taken patient scan"
Thought: "Recently taken" is interpreted the same as "most recent".
Sort by studyDate ascending, then open index 1.
{
  "command": "run_sequence",
  "steps": [
    { "command": "sort", "sortBy": "studyDate", "sortDirection": "ascending" },
    { "command": "open_study_index", "index": 1 }
  ]
}

Instruction: "Open the earliest recorded study"
Thought: "Earliest" implies a past-dated study.
Sort by studyDate descending and open the first one.
{
  "command": "run_sequence",
  "steps": [
    { "command": "sort", "sortBy": "studyDate", "sortDirection": "descending" },
    { "command": "open_study_index", "index": 1 }
  ]
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
Thought: user wants to clear filters
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

Instruction: Run these together: go to page 3, then filter by patient Kim, then sort by date descending
Thought:
- Step 1: Navigate to page 3 → use go_to_page
- Step 2: Apply patient name filter for Kim → use filter with patientName
- Step 3: Sort by study date in descending order → use sort with studyDate and descending
- Since steps must run in order, wrap with run_sequence
{
  "command": "run_sequence",
  "steps": [
    { "command": "go_to_page", "pageNumber": 3 },
    { "command": "filter", "patientName": "Kim" },
    { "command": "sort", "sortBy": "studyDate", "sortDirection": "descending" }
  ]
}

Instruction: Define a macro named A that opens the latest study
Thought:
- Step 1: Sort studies by studyDate descending → most recent first
- Step 2: Open the top study → use open_study_index with index 1
- Wrap as define_macro with name A
{
  "command": "define_macro",
  "macroName": "A",
  "steps": [
    { "command": "sort", "sortBy": "studyDate", "sortDirection": "descending" },
    { "command": "open_study_index", "index": 1 }
  ]
}

Instruction: Perform macro A
Thought:
- Execute macro named A → use perform_macro with macroName A
{
  "command": "perform_macro",
  "macroName": "A"
}

Instruction: Define a macro named B that goes to page 1, clears filters, and sorts by patientName ascending
Thought:
- Step 1: Navigate to page 1 → go_to_page
- Step 2: Clear filters → clear_filters
- Step 3: Sort by patientName ascending → sort with patientName and ascending
- Wrap steps into define_macro with name B
{
  "command": "define_macro",
  "macroName": "B",
  "steps": [
    { "command": "go_to_page", "pageNumber": 1 },
    { "command": "clear_filters" },
    { "command": "sort", "sortBy": "patientName", "sortDirection": "ascending" }
  ]
}

Instruction: Go to the second page and open the first study
Thought:
- Step 1: Go to page 2 → go_to_page
- Step 2: Open top study → open_study_index with index 1
- Run both steps in sequence using run_sequence
{
  "command": "run_sequence",
  "steps": [
    { "command": "go_to_page", "pageNumber": 2 },
    { "command": "open_study_index", "index": 1 }
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

Guidelines:
- Do NOT use repeated zoom commands. Use a single zoom_view with appropriate "intensity" (e.g., intensity: 3).
- Inside a define_macro step list, do NOT use run_sequence — just use flat command arrays.
- When referring to a study result, always use "open_study_index", not "open_study".
- For date filtering, use "studyDateRange": ["YYYY-MM-DD", "YYYY-MM-DD"] with identical start and end.
- Avoid fields not listed above.
- Ensure output is a valid single JSON object — no extra text, markdown, or formatting
- For pan_view, dx and dy follow screen coordinates: positive dx moves right, positive dy moves up. Therefore, moving "down" means dy should be negative, and "left" means dx should be negative.
- When multiple filter conditions (e.g., modalities + studyDateRange) are mentioned, combine them into a single filter command object. Do not split them into multiple commands.

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
Thought:
- The user requests three actions in sequence: layout change, zooming in twice, and downloading the image.
- Step 1: Change the viewer layout to 2×2 using the change_layout command.
- Step 2: Zoom in two levels using zoom_view with intensity: 2. Keep dx and dy as 0 (centered).
- Step 3: Trigger image download using the download_image command.
- These should be grouped in order using run_sequence.
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
      "intensity": 2,
      "dx": 0,
      "dy": 0
    },
    {
      "command": "download_image"
    }
  ]
}

Instruction: "Define a macro named V1 that resets view and stops cine"
Thought:
- The user wants to store a reusable action sequence called "V1".
- Step 1: Use reset_view to return the viewport to its default state.
- Step 2: Use stop_cine to stop cine playback if it’s running.
- Group these steps and save them using define_macro under the name "V1".
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
Thought:
- The user is asking to execute the previously defined macro "V1".
- This macro includes reset and stop operations.
- Use the perform_macro command and specify the macro name.
{
  "command": "perform_macro",
  "macroName": "V1"
}

Instruction: "Define macro V2 to pan up 50, pan right 50, and zoom out once"
Thought:
- The user wants to define a macro named "V2" with camera movement and zoom actions.
- Step 1: Pan upward by setting dy = 50 (positive Y-direction) using pan_view.
- Step 2: Pan rightward by setting dx = 50 (positive X-direction).
- Step 3: Zoom out one level using zoom_view with direction: "out" and intensity: 1.
- Store all three actions under macro name "V2" using define_macro.
{
  "command": "define_macro",
  "macroName": "V2",
  "steps": [
    {
      "command": "pan_view",
      "dx": 0,
      "dy": 50
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
Thought:
- The user wants to execute macro "V2" that performs a pan up, pan right, and zoom out sequence.
- Use perform_macro with the macro name to run the stored command list.
{
  "command": "perform_macro",
  "macroName": "V2"
}

Instruction: "Define macro 5 that rotates 90 degrees to the right and zooms in once"
Thought:
- Rotation is done using rotate_view with direction "right" and angle 90
- Zooming in once is zoom_view with intensity 1
- The macro name is the digit "5", not a description
{
  "command": "define_macro",
  "macroName": "5",
  "steps": [
    {
      "command": "rotate_view",
      "direction": "right",
      "angle": 90
    },
    {
      "command": "zoom_view",
      "direction": "in",
      "intensity": 1,
      "dx": 0,
      "dy": 0
    }
  ]
}

Instruction: "Create macro 7 that zooms in three times"
Thought:
- Zooming three times should be done using zoom_view with intensity: 3
- Avoid repeating three separate zoom_view commands
- Macro name is simply "7"
{
  "command": "define_macro",
  "macroName": "7",
  "steps": [
    {
      "command": "zoom_view",
      "direction": "in",
      "intensity": 3,
      "dx": 0,
      "dy": 0
    }
  ]
}

Instruction: "Define macro 9 that filters for CR modality and opens the first result"
Thought:
- First filter by modalities = ["CR"]
- Then open the first study using open_study_index with index 1
- Do not use open_study, use open_study_index instead
{
  "command": "define_macro",
  "macroName": "9",
  "steps": [
    {
      "command": "filter",
      "modalities": ["CR"]
    },
    {
      "command": "open_study_index",
      "index": 1
    }
  ]
}

Instruction: "Make macro 12 that filters to US and opens the first study, then pans diagonally"
Thought:
- Just sequence steps in macro, don’t wrap them in another run_sequence
- Pan diagonally using dx: 10, dy: 10
{
  "command": "define_macro",
  "macroName": "12",
  "steps": [
    {
      "command": "filter",
      "modalities": ["US"]
    },
    {
      "command": "open_study_index",
      "index": 1
    },
    {
      "command": "pan_view",
      "dx": 10,
      "dy": 10
    }
  ]
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

  const exactMatch = studies.find(
    s => s.patientName?.toLowerCase().trim() === query
  );
  if (exactMatch) {
    return `
### Context:
Use this study only. It matches the patientName in the user instruction exactly.

[
  ${JSON.stringify(exactMatch, null, 2)}
]
`;
  }

  const scored = studies.map(s => {
    const name = s.patientName?.toLowerCase() ?? '';
    return {
      study: s,
      score: similarity(query, name),
    };
  });

  const candidates = scored
    .filter(x => x.score >= 0.4)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(x => x.study);

  if (candidates.length === 0) return '';

  const listJson = JSON.stringify(candidates, null, 2);

  return `
### Context:
No exact match found. Here are studies with similar patientNames.
Pick the one that best matches the user’s instruction (spelling/pronunciation).

${listJson}
`;
}

export async function sendPromptToLLM(
  promptText: string,
  context: 'worklist' | 'viewer' = 'worklist',
  studies: Study[] = [],
  variant: PromptVariant = 'fewshot_with_cot'
): Promise<any | null> {

  const fullPrompt = buildPromptVariant(variant, promptText, context, studies);

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


type PromptVariant = 'no_fewshot' | 'fewshot_no_cot' | 'fewshot_with_cot';

function buildPromptVariant(
  variant: PromptVariant,
  promptText: string,
  context: 'worklist' | 'viewer',
  studies: Study[]
): string {
  const ragContext = buildRAGContextFromStudies(studies, promptText);

  if (variant === 'no_fewshot') {
    const guide = `
  You are a helpful PACS assistant in a medical image viewing system. Your task is to convert user instructions into structured JSON commands for either the study list viewer (WorkList) or image viewer (Viewer), depending on the context.

  ───────────── WorkList Commands ─────────────
  - filter: Apply filters like patientName, description, modalities, or studyDateRange.
  - go_to_page: Change the page number.
  - sort: Sort the list by a column and direction.
  - clear_filters: Remove all current filters.
  - open_study: Open a specific study by StudyInstanceUID.
  - open_study_index: Open the N-th study in the list (0-based index).
  - show_version: Show app version info.
  - open_upload: Open the DICOM file upload dialog.
  - define_macro: Save a named sequence of steps (worklist or viewer) under a macro.
  - perform_macro: Execute a previously defined macro.

  ───────────── Viewer Commands ─────────────
  - change_layout: Change the layout. Supported layouts include "1x1", "2x2", "2x1", "3x1".
  - rotate_view: Rotate the image. Use direction ("left" or "right") and angle.
  - pan_view: Move the image. Use dx and dy (pixels).
  - zoom_view: Zoom in/out. Use direction ("in"/"out"), intensity (>=1), and optional dx/dy.
  - play_cine / stop_cine: Start or stop image playback.
  - download_image: Download the currently visible image.
  - reset_view: Reset pan and zoom to default.

  ───────────── Guidelines ─────────────
  - Always respond with a **single valid JSON object** — no markdown, comments, or extra text.
  - For multiple commands (e.g., "go to page then filter"), use:
    {
      "command": "run_sequence",
      "steps": [ {command1}, {command2}, ... ]
    }
  - Do not use run_sequence inside a define_macro. Macros should use flat steps array.
  - For zooming multiple steps, use one zoom_view with appropriate "intensity".
  - When referring to numbered study results (e.g., "third study"), return:
      1. A filter command (if needed)
      2. Then { "command": "open_study_index", "index": N }
  - Never return open_study in these cases, even if patient UID is known.
  - For date filtering, use:
      "studyDateRange": ["YYYY-MM-DD", "YYYY-MM-DD"] with identical values for single-day
  - For define_macro, macro names may be strings or numbers, passed as "macroName": "3"
  - Always distinguish between "search" and "open" intentions:
    - If the user says to search, find, show, or display studies or patients, always respond with a "filter" command only.
    - If the user explicitly requests to open a study (e.g., "open the 1st one", "show me the 2nd scan"), use "open_study_index" after filtering.
  ───────────── Return Format Reference ─────────────
  - change_layout:         { "command": "change_layout", "layout": "2x2" }
  - rotate_view:           { "command": "rotate_view", "direction": "right", "angle": 90 }
  - pan_view:              { "command": "pan_view", "dx": 50, "dy": -30 }
  - zoom_view:             { "command": "zoom_view", "direction": "in", "intensity": 2, "dx": 0, "dy": 0 }
  - play_cine:             { "command": "play_cine" }
  - stop_cine:             { "command": "stop_cine" }
  - download_image:        { "command": "download_image" }
  - reset_view:            { "command": "reset_view" }
  - go_to_page:            { "command": "go_to_page", "pageNumber": 2 }
  - sort:                  { "command": "sort", "sortBy": "studyDate", "sortDirection": "descending" }
  - filter:                { "command": "filter", "patientName": "Kim" }
                          { "command": "filter", "modalities": ["CT"], "studyDateRange": ["2025-06-20", "2025-06-20"] }
  - clear_filters:         { "command": "clear_filters" }
  - open_study:            { "command": "open_study", "studyInstanceUid": "1.2.3.4.5.6" }
  - open_study_index:      { "command": "open_study_index", "index": 3 }
  - show_version:          { "command": "show_version" }
  - open_upload:           { "command": "open_upload" }
  - define_macro:          {
                              "command": "define_macro",
                              "macroName": "A",
                              "steps": [
                                { "command": "zoom_view", ... },
                                { "command": "pan_view", ... }
                              ]
                          }
  - perform_macro:         { "command": "perform_macro", "macroName": "A" }
  - run_sequence:          {
                              "command": "run_sequence",
                              "steps": [
                                { "command": "go_to_page", "pageNumber": 1 },
                                { "command": "filter", "patientName": "Lee" }
                              ]
                          }

  `;

    return `${ragContext}\n${guide}\nInstruction: "${promptText}"\nJSON:`;
  }

  const fewshotRaw = FEWSHOTS[context];

  const fewshot =
    variant === 'fewshot_no_cot'
      ? fewshotRaw.replace(/^Instruction:.*?\nThought:.*?\n/mg, match =>
        match.replace(/Thought:.*?\n/, '')
      )
      : fewshotRaw;

  return `${fewshot}\n${ragContext}\nUser: ${promptText}\nResponse:`;
}
