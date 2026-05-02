import { AdvancedLearningEngine } from './AdvancedLearningEngine';

export enum StudyStatus {
    PENDING, RESEARCHING, EXTRACTING, LEARNING, COMPLETE, FAILED, PAUSED
}

export type StudyPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface StudyTask {
    id: number;
    topic: string;
    searchQueries: string[];
    depth: number;
    pagesFetched: number;
    factsExtracted: number;
    priority: StudyPriority;
    status: StudyStatus;
    createdAt: number;
    startedAt: number;
    completedAt: number;
    studyTimeMs: number;
    visitedUrls: string[];
    discoveredUrls: string[];
    lastError?: string;
}

export interface KnowledgeFact {
    subject: string;
    predicate: string;
    object: string;
    confidence: number;
    sourceUrl: string;
    extractedAt: number;
    relevanceScore: number;
}

export class WebStudyEngine {
    private static nextId = 1;
    public tasks: Map<number, StudyTask> = new Map();
    public knowledgeFacts: KnowledgeFact[] = [];
    public active: boolean = false;
    
    public ale: AdvancedLearningEngine;

    constructor() {
        this.ale = new AdvancedLearningEngine();
    }

    public addStudyTask(topic: string, depth: number = 3): number {
        const task: StudyTask = {
            id: WebStudyEngine.nextId++,
            topic,
            searchQueries: [topic],
            depth,
            pagesFetched: 0,
            factsExtracted: 0,
            priority: 'MEDIUM',
            status: StudyStatus.PENDING,
            createdAt: Date.now(),
            startedAt: 0,
            completedAt: 0,
            studyTimeMs: 0,
            visitedUrls: [],
            discoveredUrls: []
        };
        this.tasks.set(task.id, task);
        return task.id;
    }

    public async processTask(taskId: number, callback?: (status: string) => void): Promise<void> {
        const task = this.tasks.get(taskId);
        if (!task) return;

        task.status = StudyStatus.RESEARCHING;
        task.startedAt = Date.now();
        callback?.(`Researching ${task.topic}...`);

        await new Promise(r => setTimeout(r, 1000));
        
        task.status = StudyStatus.EXTRACTING;
        callback?.(`Extracting facts from web pages...`);
        const simulatedUrls = [
            `https://en.wikipedia.org/wiki/${encodeURIComponent(task.topic)}`,
            `https://duckduckgo.com/html/?q=${encodeURIComponent(task.topic)}`
        ];
        task.visitedUrls.push(...simulatedUrls);
        task.pagesFetched = simulatedUrls.length;

        await new Promise(r => setTimeout(r, 1500));

        task.status = StudyStatus.LEARNING;
        callback?.(`Learning engine analyzing semantic embeddings...`);

        this.ale.startLearning();

        // Simulate forcing a learning cycle
        this.ale.forceLearningCycle({
            onLearningComplete: (concept, improvement) => {
                const stats = this.ale.getLearningStatistics();
                callback?.(`Ultra Learning: ${stats.precision.toFixed(2)} acc, PPO: ${stats.ppo_advantage.toFixed(2)}`);
            },
            onModelUpdated: () => {},
            onKnowledgeGained: () => {},
            onError: () => {}
        });

        // Compute features using our transformer
        const featureVec = this.ale.Transformer.extractFeatures(task.topic);

        this.ale.stopLearning();

        task.status = StudyStatus.COMPLETE;
        task.completedAt = Date.now();
        task.studyTimeMs = task.completedAt - task.startedAt;
        
        callback?.(`Completed ${task.topic} in ${task.studyTimeMs}ms`);
    }

    public getStudyStatistics() {
        return {
            totalTasks: this.tasks.size,
            completedTasks: Array.from(this.tasks.values()).filter(t => t.status === StudyStatus.COMPLETE).length,
            totalPagesFetched: Array.from(this.tasks.values()).reduce((a, b) => a + b.pagesFetched, 0),
            totalStudyTimeMs: Array.from(this.tasks.values()).reduce((a, b) => a + b.studyTimeMs, 0),
            vocabSize: this.ale.Transformer.vocabSize,
            metrics: this.ale.getLearningStatistics()
        };
    }
}

export const webStudyEngine = new WebStudyEngine();
