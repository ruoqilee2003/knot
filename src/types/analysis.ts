export type AnalysisResult = {
  examKeyPoints: string[];
  answerFeedback: string;
  improvementSuggestions: string;
  flashcards: Array<{
    front: string;
    back: string;
  }>;
};

export type QuestionDoc = {
  id: string;
  subject: string;
  year: number;
  questionText: string;
  imageUrl: string | null;
};
