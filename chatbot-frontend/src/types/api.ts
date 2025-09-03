export type ChatHit = { score: number; data_type: string; title: string; keywords: string };
export type ChatResponse = {
  company: string; query: string; top_k: number;
  answer: string;
  citations: { data_type: string; title: string }[];
  hits: ChatHit[];
};
