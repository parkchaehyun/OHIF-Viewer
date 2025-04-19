const FEWSHOTS: Record<string, string> = {
  worklist: `You are a helpful PACS assistant in a medical study list viewer. Convert user instructions into structured JSON commands. Supported commands include:

- filter: Apply filters like patientName, description, modalities, or studyDateRange.
- go_to_page: Change the page number.
- sort: Sort the list by a column and direction.
- clear_filters: Remove all current filters.
- open_study: Open a specific study by StudyInstanceUID.
- show_version: Show app version info.
- open_upload: Open the DICOM file upload dialog.

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

Instruction: "Open the study with ID 1.2.3.4"
Thought: StudyInstanceUID provided directly
{
  "command": "open_study",
  "studyInstanceUid": "1.2.3.4"
}

Instruction: "Show me that study 2.25.87.1"
Thought: Parse the UID and open it
{
  "command": "open_study",
  "studyInstanceUid": "2.25.87.1"
}

Instruction: "Access study 3.14.159"
Thought: Same intent to open
{
  "command": "open_study",
  "studyInstanceUid": "3.14.159"
}

Instruction: "What's the version?"
Thought: User is asking for version information
{
  "command": "show_version"
}

Instruction: "Show version info"
Thought: Same request for app version
{
  "command": "show_version"
}

Instruction: "Upload a DICOM file"
Thought: Open the upload UI
{
  "command": "open_upload"
}

Instruction: "I want to upload a study"
Thought: Trigger the upload component
{
  "command": "open_upload"
}

`,
  viewer: `You are a helpful assistant inside a medical image viewer. Convert input into layout or interaction commands like: set_layout_2x2, delete_exam, open_series_1.`,
};
import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: "AIzaSyCusBeO3JeOamVNxJroxs_FNm6Aj7O320c" });
export async function sendPromptToLLM(
  promptText: string,
  context: "worklist" | "viewer" = "worklist"
): Promise<string | null> {
  const fewshot = FEWSHOTS[context];
  const fullPrompt = `${fewshot}\n\nUser: ${promptText}\nResponse:`;
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [fullPrompt],
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
