export type CandidatePriority = "standard" | "priority";
export type CandidateStage = "screen" | "tech" | "onsite" | "offer";

export interface Candidate {
  id: string;
  name: string;
  role: string;
  email: string;
  priority: CandidatePriority;
  stage: CandidateStage;
}

export type InterviewStatus = "scheduled" | "completed" | "cancelled";

export interface Interview {
  id: string;
  candidateId: string;
  interviewer: string;
  scheduledAt: Date;
  durationMinutes: number;
  status: InterviewStatus;
  feedback?: string;
}
