export interface Flashcard {
  id: string;
  question: string;
  answer: string;
  // SRS data
  interval: number; // in days
  repetition: number;
  efactor: number;
  nextReview: number; // timestamp
}

export interface LearningModule {
  id: string;
  title: string;
  content: string; // Markdown content
  summary: string;
  flashcards: Flashcard[];
  createdAt: number;
  updatedAt: number;
}

export interface SRSStats {
  new: number;
  learning: number;
  review: number;
}
