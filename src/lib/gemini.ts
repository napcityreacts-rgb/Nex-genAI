import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export async function generateLearningContent(topic: string) {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Generate a comprehensive learning module for the topic: "${topic}". 
    The output should be a JSON object with:
    - title: A clear title.
    - content: Detailed educational content in Markdown format, structured for AI readability (clear headings, bullet points).
    - summary: A concise summary of the content.
    - flashcards: An array of objects with { question, answer } for spaced repetition.
    
    Make the content high-quality and educational.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          content: { type: Type.STRING },
          summary: { type: Type.STRING },
          flashcards: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                question: { type: Type.STRING },
                answer: { type: Type.STRING },
              },
              required: ["question", "answer"],
            },
          },
        },
        required: ["title", "content", "summary", "flashcards"],
      },
    },
  });

  return JSON.parse(response.text);
}

export async function summarizeText(text: string) {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Summarize the following text concisely:\n\n${text}`,
  });
  return response.text;
}

export async function chatWithAI(history: { role: 'user' | 'model', parts: { text: string }[] }[], message: string) {
  const contents = [...history, { role: 'user', parts: [{ text: message }] }];
  
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: contents,
  });
  
  return response.text;
}
