export enum SamplingStrategy {
  UNCERTAINTY_SAMPLING,
  DIVERSITY_SAMPLING,
  EXPECTED_ERROR_REDUCTION,
  QUERY_BY_COMMITTEE,
  DENSITY_WEIGHTED,
  BALD,
  CORE_SET,
  HYBRID
}

export class ActiveLearningSystem {
  private currentStrategy: SamplingStrategy = SamplingStrategy.HYBRID;
  private totalSamplesSelected: number = 0;
  private learningEfficiency: number = 0.0;
  private averageUncertaintyReduction: number = 0.0;
  private computationalBudget: number = 1.0;

  private typeCounts: Map<string, number> = new Map();
  private totalExamplesSeen: number = 0;
  private strategyScores: Map<SamplingStrategy, number> = new Map();

  constructor() {
    for (const key of Object.keys(SamplingStrategy)) {
      if (isNaN(Number(key))) {
        this.strategyScores.set(SamplingStrategy[key as keyof typeof SamplingStrategy], 0.5);
      }
    }
  }

  public setStrategy(strategy: SamplingStrategy) {
    this.currentStrategy = strategy;
  }

  public getCurrentStrategy(): SamplingStrategy {
    return this.currentStrategy;
  }

  public getTotalSamplesSelected(): number {
    return this.totalSamplesSelected;
  }

  public getLearningEfficiency(): number {
    return this.learningEfficiency;
  }

  public getAverageUncertaintyReduction(): number {
    return this.averageUncertaintyReduction;
  }

  public setComputationalBudget(budget: number) {
    this.computationalBudget = Math.max(0, Math.min(1, budget));
  }

  public getComputationalBudget(): number {
    return this.computationalBudget;
  }

  public getTypeDistribution(): Record<string, number> {
    const dist: Record<string, number> = {};
    if (this.totalExamplesSeen === 0) return dist;
    this.typeCounts.forEach((val, key) => {
      dist[key] = val / this.totalExamplesSeen;
    });
    return dist;
  }

  public getStrategyScores(): Record<string, number> {
    const scores: Record<string, number> = {};
    this.strategyScores.forEach((val, key) => {
      scores[SamplingStrategy[key]] = val;
    });
    return scores;
  }

  public reset() {
    this.totalSamplesSelected = 0;
    this.averageUncertaintyReduction = 0;
    this.learningEfficiency = 0;
    this.totalExamplesSeen = 0;
    this.computationalBudget = 1.0;
    this.typeCounts.clear();
    this.currentStrategy = SamplingStrategy.HYBRID;
  }
}
