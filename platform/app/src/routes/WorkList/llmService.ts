export async function sendPromptToLLM(promptText: string): Promise<string | null> {
  const NGROK_URL = "https://5ae7-34-83-16-166.ngrok-free.app"; // Colab에서 받은 ngrok URL을 넣으세요.
  try {
    const response = await fetch(`${NGROK_URL}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: promptText })
    });
    const data = await response.json();
    return data.response; // 예: "delete_exam" 또는 LLM의 응답 텍스트
  } catch (error) {
    console.error("LLM 요청 실패:", error);
    return null;
  }
}
