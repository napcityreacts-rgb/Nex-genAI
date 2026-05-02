import { Flashcard } from '../types';

/**
 * SM-2 Algorithm implementation
 * quality: 0-5 (0: total blackout, 5: perfect response)
 */
export function updateSRS(card: Flashcard, quality: number): Flashcard {
  let { interval, repetition, efactor } = card;

  if (quality >= 3) {
    if (repetition === 0) {
      interval = 1;
    } else if (repetition === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * efactor);
    }
    repetition++;
  } else {
    repetition = 0;
    interval = 1;
  }

  efactor = efactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (efactor < 1.3) efactor = 1.3;

  const nextReview = Date.now() + interval * 24 * 60 * 60 * 1000;

  return {
    ...card,
    interval,
    repetition,
    efactor,
    nextReview,
  };
}

export function getInitialFlashcard(question: string, answer: string): Flashcard {
  return {
    id: crypto.randomUUID(),
    question,
    answer,
    interval: 0,
    repetition: 0,
    efactor: 2.5,
    nextReview: Date.now(),
  };
}
