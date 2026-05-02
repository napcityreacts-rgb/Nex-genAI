import { webStudyEngine } from './WebStudyEngine';

export enum AssistantState {
  IDLE,
  THINKING,
  WORKING,
  COMPLETED,
  FAILED
}

export interface AssistantGoal {
  id: string;
  title: string;
  description: string;
  state: AssistantState;
  progress: number;
  subtasks: AssistantSubtask[];
  createdAt: number;
}

export interface AssistantSubtask {
  id: string;
  title: string;
  state: AssistantState;
  result?: string;
}

export class AutonomousAssistant {
  private goals: AssistantGoal[] = [];
  private activeGoalId: string | null = null;
  private listeners: ((goals: AssistantGoal[]) => void)[] = [];

  constructor() {}

  public subscribe(listener: (goals: AssistantGoal[]) => void) {
    this.listeners.push(listener);
    listener(this.goals);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify() {
    this.listeners.forEach(l => l([...this.goals]));
  }

  public async setGoal(title: string, description: string) {
    const goal: AssistantGoal = {
      id: crypto.randomUUID(),
      title,
      description,
      state: AssistantState.THINKING,
      progress: 0,
      subtasks: [],
      createdAt: Date.now()
    };

    this.goals.unshift(goal);
    this.activeGoalId = goal.id;
    this.notify();

    // Auto-decompose goal into subtasks (Simulated intelligence)
    await new Promise(r => setTimeout(r, 1500));
    
    goal.subtasks = [
      { id: crypto.randomUUID(), title: `Researching market trends for ${title}`, state: AssistantState.IDLE },
      { id: crypto.randomUUID(), title: `Synthesizing neural knowledge base`, state: AssistantState.IDLE },
      { id: crypto.randomUUID(), title: `Optimizing learning pathways`, state: AssistantState.IDLE }
    ];
    goal.state = AssistantState.WORKING;
    this.notify();

    // Execute subtasks
    for (let i = 0; i < goal.subtasks.length; i++) {
        const subtask = goal.subtasks[i];
        subtask.state = AssistantState.WORKING;
        this.notify();

        if (i === 0) {
            const taskId = webStudyEngine.addStudyTask(title + " " + description);
            await webStudyEngine.processTask(taskId);
        } else {
            await new Promise(r => setTimeout(r, 2000));
        }

        subtask.state = AssistantState.COMPLETED;
        goal.progress = ((i + 1) / goal.subtasks.length) * 100;
        this.notify();
    }

    goal.state = AssistantState.COMPLETED;
    this.notify();
  }

  public getGoals() {
    return this.goals;
  }
}

export const assistant = new AutonomousAssistant();
