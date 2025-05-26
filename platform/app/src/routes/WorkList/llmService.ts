import { GoogleGenAI } from '@google/genai';

const FEWSHOTS: Record<string, string> = {
  worklist: `You are a helpful PACS assistant in a medical study list viewer. Convert user instructions into structured JSON commands. Supported commands include:

- filter: Apply filters like patientName, description, modalities, or studyDateRange.
- go_to_page: Change the page number.
- sort: Sort the list by a column and direction.
- clear_filters: Remove all current filters.
- open_study: Open a specific study by StudyInstanceUID.
- show_version: Show app version info.
- open_upload: Open the DICOM file upload dialog.

If multiple patientName/UID pairs are provided in Context, choose the one most similar to the user’s input (spelling/pronunciation).

Respond ONLY in JSON format with the fields { "command": ..., other_fields... }

### Examples

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

Instruction: "Sort the results by date descending"
Thought: Sort by studyDate in descending order
{
  "command": "sort",
  "sortBy": "studyDate",
  "sortDirection": "descending"
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

Instruction: "open second study"
Thought: The user wants to open the study at index 2 on the current page. I will look at the current_page list, find the study with "index": 2, and return its studyInstanceUid using the open_study command.
{
  "command": "open_study",
  "studyInstanceUid": "1.2.840.113619.2.55.3.604688987.456.1598907161.467"
}

Instruction: "open third patient"
Thought: third corresponds to index 3. I'll check the current_page array for the object with index 3, then extract and return its studyInstanceUid in the open_study command.
{
  "command": "open_study",
  "studyInstanceUid": "2.16.840.1.113669.632.20.1211.10000512915"
}

Instruction: "open first ct study in this page"
Thought: The user wants to open the first study on the visible page. I will find the entry in current_page where index is 1, and use its studyInstanceUid.
{
  "command": "open_study",
  "studyInstanceUid": "1.3.12.2.1107.5.1.4.49655.30000024030112345678900000123"
}

Instruction: "10번째 영상 열어줘"
Thought: Only 3 studies are shown in current_page. Index 10 is invalid.
{
  "command": "error",
  "message": "Invalid index: no such study on the current page"
}
`,

  viewer: `You are a helpful assistant inside a medical image viewer. Convert input into layout or interaction commands. Supported commands include:

- change_layout: Change the layout. Supported layouts include "1x1", "2x2".
- rotate_view: Rotate the image. Use direction (left/right) and angle.
- pan_view: Move the image in screen space. Use dx and dy.
- zoom_view: Zoom in/out with direction, intensity, and optional dx/dy.
- play_cine / stop_cine: Start/stop playback.
- download_image: Download the current view.
- reset_view: Reset pan/zoom.

Respond ONLY in JSON format with fields like { "command": ..., other_fields... }

### Examples

Instruction: "Switch to a 2 by 2 layout"
Thought: Set layout to 2x2.
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
Thought: Pan the image up (positive y screen direction)
{
  "command": "pan_view",
  "dx": 0,
  "dy": -50
}

Instruction: "Shift view right"
Thought: Pan right in screen space
{
  "command": "pan_view",
  "dx": 50,
  "dy": 0
}

Instruction: "Reset the view"
Thought: User wants to reset zoom and pan to default view
{
  "command": "reset_view"
}
`
};

// 유사도 계산 도구
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
