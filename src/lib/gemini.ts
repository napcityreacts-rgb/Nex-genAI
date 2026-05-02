import { GoogleGenAI, Type } from "@google/genai";

function getAI() {
  const apiKey = process.env.GEMINI_API_KEY || '';
  return new GoogleGenAI({ apiKey });
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export async function generateLearningContent(topic: string) {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
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

export async function chatWithAI(messages: ChatMessage[]): Promise<string> {
  const ai = getAI();

  const systemPrompt = `You are NexGenAI, an advanced AI assistant built into a next-generation learning platform. You are helpful, knowledgeable, and concise. You specialize in education, science, technology, and general knowledge. You communicate in a clear, professional tone. Use markdown formatting when helpful. Keep responses focused and actionable.`;

  const contents = [
    { role: 'user' as const, parts: [{ text: systemPrompt }] },
    { role: 'model' as const, parts: [{ text: 'Understood. I am NexGenAI, ready to assist with learning, research, and knowledge exploration. How can I help you today?' }] },
    ...messages.map(m => ({
      role: (m.role === 'user' ? 'user' : 'model') as 'user' | 'model',
      parts: [{ text: m.content }]
    }))
  ];

  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents,
  });

  return response.text || 'I apologize, but I was unable to generate a response. Please try again.';
}

export async function summarizeText(text: string) {
  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: `Summarize the following text concisely:\n\n${text}`,
  });
  return response.text;
}

export async function chatWithAI(history: { role: 'user' | 'model', parts: { text: string }[] }[], message: string) {
  const chat = ai.models.startChat({
    model: "gemini-3-flash-preview",
    history: history,
  });
  
  const result = await chat.sendMessage(message);
  return result.response.text();
}
