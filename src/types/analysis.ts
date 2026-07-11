export type AnalysisResult = {
  examKeyPoints: string[];
  /** 舊版批改結果才有的欄位，保留以相容既有資料 */
  answerFeedback?: string;
  /** 舊版批改結果才有的欄位，保留以相容既有資料 */
  improvementSuggestions?: string;
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
