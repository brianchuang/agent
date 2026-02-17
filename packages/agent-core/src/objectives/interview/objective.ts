import { MemoryItem } from "../../types";
import { ObjectiveEvent, ObjectiveExecutionContext, ObjectivePlugin, ObjectiveResult } from "../../core/objective";
import { Candidate, Interview } from "./model";
import { InterviewEventValidator } from "./validation";

interface CandidateRegisterPayload {
  name: string;
  role: string;
  email: string;
  priority: Candidate["priority"];
  stage: Candidate["stage"];
}

interface InterviewSchedulePayload {
  candidateId: string;
  interviewer: string;
  scheduledAt: string;
  durationMinutes: number;
}

interface InterviewCompletePayload {
  interviewId: string;
  feedback: string;
}

interface MessageDraftPayload {
  candidateId: string;
  templateTag: string;
  variables: Record<string, string>;
}

interface ActionsSuggestPayload {
  candidateId: string;
}

interface MessageTemplate {
  id: string;
  name: string;
  tags: string[];
  approved: boolean;
  body: string;
}

export class InterviewObjectivePlugin implements ObjectivePlugin {
  readonly id = "interview-management";
  readonly validator = new InterviewEventValidator();

  private readonly candidates = new Map<string, Candidate>();
  private readonly interviews = new Map<string, Interview>();
  private readonly templates: MessageTemplate[] = [
    {
      id: "tpl-schedule-confirmation",
      name: "Schedule Confirmation",
      tags: ["schedule-confirmation", "screen", "tech", "onsite"],
      approved: true,
      body: "Hi {{candidate_name}},\n\nYour {{stage}} interview for {{role}} is confirmed for {{date_time}}.\n\nBest,\nRecruiting Team"
    },
    {
      id: "tpl-next-steps",
      name: "Next Steps Update",
      tags: ["next-steps", "screen", "tech", "onsite", "offer"],
      approved: true,
      body: "Hi {{candidate_name}},\n\nThanks for interviewing for {{role}}. Next step: {{next_step}}.\n\nBest,\nRecruiting Team"
    }
  ];

  planRetrieval(event: ObjectiveEvent) {
    const payload = event.payload as Partial<ActionsSuggestPayload>;
    const candidateId = payload.candidateId;
    if (!candidateId || !this.candidates.has(candidateId)) {
      return undefined;
    }

    const candidate = this.candidates.get(candidateId) as Candidate;
    const defaultQuery =
      event.type === "actions.suggest"
        ? `suggest actions for ${candidate.stage} interview`
        : `interview communication for ${candidate.role} ${candidate.stage}`;

    return {
      queryText: defaultQuery,
      channel: "chat" as const,
      tags: [candidate.stage, candidate.role.toLowerCase()],
      accountTier: candidate.priority,
      language: "en",
      withinDays: 90,
      budget: {
        maxItems: 8,
        maxTokens: 1800,
        maxByCategory: {
          template: 3,
          incident: 4,
          faq: 1
        }
      }
    };
  }

  handle(context: ObjectiveExecutionContext): ObjectiveResult {
    switch (context.event.type) {
      case "candidate.register":
        return this.onCandidateRegister(context.event.payload as CandidateRegisterPayload);
      case "interview.schedule":
        return this.onInterviewSchedule(context.event.payload as InterviewSchedulePayload);
      case "interview.complete":
        return this.onInterviewComplete(context, context.event.payload as InterviewCompletePayload);
      case "message.draft":
        return this.onMessageDraft(context.event.payload as MessageDraftPayload);
      case "actions.suggest":
        return this.onSuggestActions(context.event.payload as ActionsSuggestPayload);
      default:
        throw new Error(`Unsupported interview objective event: ${context.event.type}`);
    }
  }

  private onCandidateRegister(payload: CandidateRegisterPayload): ObjectiveResult {
    const candidate: Candidate = {
      id: `cand-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: payload.name,
      role: payload.role,
      email: payload.email,
      priority: payload.priority,
      stage: payload.stage
    };
    this.candidates.set(candidate.id, candidate);

    return {
      output: { candidate },
      workingMemoryLines: [`Registered candidate ${candidate.name} for ${candidate.role}.`]
    };
  }

  private onInterviewSchedule(payload: InterviewSchedulePayload): ObjectiveResult {
    const candidate = this.candidates.get(payload.candidateId);
    if (!candidate) throw new Error(`Candidate not found: ${payload.candidateId}`);

    const interview: Interview = {
      id: `int-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      candidateId: payload.candidateId,
      interviewer: payload.interviewer,
      scheduledAt: new Date(payload.scheduledAt),
      durationMinutes: payload.durationMinutes,
      status: "scheduled"
    };
    this.interviews.set(interview.id, interview);

    return {
      output: { interview },
      workingMemoryLines: [
        `Scheduled ${candidate.stage} interview with ${interview.interviewer} on ${interview.scheduledAt.toISOString()}.`
      ]
    };
  }

  private onInterviewComplete(
    context: ObjectiveExecutionContext,
    payload: InterviewCompletePayload
  ): ObjectiveResult {
    const interview = this.interviews.get(payload.interviewId);
    if (!interview) throw new Error(`Interview not found: ${payload.interviewId}`);

    interview.status = "completed";
    interview.feedback = payload.feedback;

    const candidate = this.candidates.get(interview.candidateId);
    if (!candidate) throw new Error(`Candidate not found: ${interview.candidateId}`);

    const memory: MemoryItem = {
      id: `mem-${interview.id}`,
      tier: "raw",
      category: "incident",
      content: payload.feedback,
      summary: `Interview feedback for ${candidate.role}: ${payload.feedback.slice(0, 100)}`,
      metadata: {
        workspace: context.workspace,
        objective: context.objectiveId,
        channel: "chat",
        tags: ["interview-feedback", candidate.stage, candidate.role.toLowerCase()],
        accountTier: candidate.priority,
        language: "en"
      },
      approvedByHuman: false,
      useCount: 0,
      successCount: 0,
      effectiveFrom: new Date(),
      createdAt: new Date()
    };

    return {
      output: { interviewId: interview.id, status: interview.status },
      memoryWrites: [memory],
      workingMemoryLines: [`Interview ${interview.id} completed. Feedback recorded.`]
    };
  }

  private onMessageDraft(payload: MessageDraftPayload): ObjectiveResult {
    const candidate = this.candidates.get(payload.candidateId);
    if (!candidate) throw new Error(`Candidate not found: ${payload.candidateId}`);

    const template = this.templates.find((x) => x.approved && x.tags.includes(payload.templateTag));
    if (!template) throw new Error(`No approved template for tag: ${payload.templateTag}`);

    let message = template.body;
    const variables = {
      candidate_name: candidate.name,
      role: candidate.role,
      stage: candidate.stage,
      ...payload.variables
    };

    for (const [k, v] of Object.entries(variables)) {
      message = message.replaceAll(`{{${k}}}`, v);
    }

    return {
      output: { message },
      workingMemoryLines: [`Drafted ${template.name} message for ${candidate.name}.`]
    };
  }

  private onSuggestActions(payload: ActionsSuggestPayload): ObjectiveResult {
    const candidate = this.candidates.get(payload.candidateId);
    if (!candidate) throw new Error(`Candidate not found: ${payload.candidateId}`);

    const candidateInterviews = Array.from(this.interviews.values())
      .filter((x) => x.candidateId === payload.candidateId)
      .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

    const actions: string[] = [];
    if (candidateInterviews.length === 0) {
      actions.push("Schedule a screening interview.");
      return { output: { actions } };
    }

    const latest = candidateInterviews[candidateInterviews.length - 1] as Interview;
    if (latest.status === "scheduled") {
      actions.push(`Send reminder for interview on ${latest.scheduledAt.toISOString()}.`);
    }

    if (latest.status === "completed") {
      if (candidate.stage === "screen") actions.push("Decide whether to advance to technical interview.");
      if (candidate.stage === "tech") actions.push("Collect panel feedback and decide onsite progression.");
      if (candidate.stage === "onsite") actions.push("Prepare hiring decision package.");
      if (candidate.stage === "offer") actions.push("Draft offer communication and compensation summary.");
    }

    return { output: { actions } };
  }
}
