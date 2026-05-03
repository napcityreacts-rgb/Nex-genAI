import { useState, useEffect, useMemo } from 'react';
import { getAllModules, saveModule, deleteModule } from './lib/storage';
import { LearningModule, Flashcard } from './types';
import { updateSRS, getInitialFlashcard } from './lib/srs';
import { generateLearningContent, chatWithAI } from './lib/gemini';
import { generatePDF } from './lib/pdf';
import { webStudyEngine } from './lib/ai/WebStudyEngine';
import { assistant, AssistantGoal, AssistantState } from './lib/ai/AutonomousAssistant';
import { 
  Plus, 
  Search, 
  BookOpen, 
  Brain, 
  Download, 
  Trash2, 
  Loader2,
  Clock,
  XCircle,
  Sparkles,
  ArrowRight,
  History,
  Layout,
  AlertCircle,
  Database,
  TerminalSquare,
  ChevronLeft,
  Cpu,
  Zap,
  Target,
  MessageSquare,
  Send
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';

type Tab = 'library' | 'generate' | 'evaluate' | 'ai_console' | 'assistant' | 'chat';

export default function App() {
  const [modules, setModules] = useState<LearningModule[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [newTopic, setNewTopic] = useState('');
  const [selectedModule, setSelectedModule] = useState<LearningModule | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewCards, setReviewCards] = useState<Flashcard[]>([]);
  const [currentReviewIndex, setCurrentReviewIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('library');

  useEffect(() => {
    loadModules();
  }, []);

  async function loadModules() {
    try {
      const data = await getAllModules();
      setModules(data.sort((a, b) => b.createdAt - a.createdAt));
    } catch (err) {
      setError("Failed to load modules from storage.");
    }
  }

  const filteredModules = useMemo(() => {
    return modules.filter(m => 
      m.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.content.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [modules, searchQuery]);

  const dueCardsCount = useMemo(() => {
    const now = Date.now();
    return modules.reduce((acc, m) => {
      return acc + m.flashcards.filter(c => c.nextReview <= now).length;
    }, 0);
  }, [modules]);

  const [generationStatus, setGenerationStatus] = useState<string | null>(null);
  const [assistantGoals, setAssistantGoals] = useState<AssistantGoal[]>([]);
  const [newGoal, setNewGoal] = useState('');
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'model', content: string }[]>([]);
  const [currentMessage, setCurrentMessage] = useState('');
  const [isChatting, setIsChatting] = useState(false);

  useEffect(() => {
    return assistant.subscribe(setAssistantGoals);
  }, []);

  async function handleCreateGoal() {
    if (!newGoal.trim()) return;
    const goalTitle = newGoal;
    setNewGoal('');
    await assistant.setGoal(goalTitle, "Autonomous research and knowledge synthesis initiated by User.");
  }

  async function handleSendMessage() {
    if (!currentMessage.trim() || isChatting) return;
    
    const userMessage = currentMessage;
    setCurrentMessage('');
    setChatMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsChatting(true);
    
    try {
      const history = chatMessages.map(m => ({
        role: m.role,
        parts: [{ text: m.content }]
      }));
      
      const response = await chatWithAI(history, userMessage);
      setChatMessages(prev => [...prev, { role: 'model', content: response }]);
    } catch (err) {
      console.error("Chat failed", err);
      setError("Failed to link with AI neural link.");
    } finally {
      setIsChatting(false);
    }
  }

  async function handleGenerate() {
    if (!newTopic.trim()) return;
    setIsGenerating(true);
    setError(null);
    setGenerationStatus('Initializing engine...');
    try {
      // Integrate AI WebStudyEngine first
      const taskId = webStudyEngine.addStudyTask(newTopic);
      await webStudyEngine.processTask(taskId, (status) => setGenerationStatus(status));
      
      setGenerationStatus('Generating final content...');
      const data = await generateLearningContent(newTopic);
      const newModule: LearningModule = {
        id: crypto.randomUUID(),
        title: data.title,
        content: data.content,
        summary: data.summary,
        flashcards: data.flashcards.map((f: any) => getInitialFlashcard(f.question, f.answer)),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await saveModule(newModule);
      await loadModules();
      setNewTopic('');
      setSelectedModule(newModule);
      setActiveTab('library');
    } catch (err) {
      console.error("Generation failed", err);
      setError("Failed to generate content. Please check your API key and try again.");
    } finally {
      setIsGenerating(false);
      setGenerationStatus(null);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteModule(id);
      await loadModules();
      if (selectedModule?.id === id) setSelectedModule(null);
    } catch (err) {
      setError("Failed to delete module.");
    }
  }

  function startReview() {
    const now = Date.now();
    const allDueCards: { card: Flashcard, moduleId: string }[] = [];
    modules.forEach(m => {
      m.flashcards.forEach(c => {
        if (c.nextReview <= now) {
          allDueCards.push({ card: c, moduleId: m.id });
        }
      });
    });
    
    if (allDueCards.length > 0) {
      const shuffled = allDueCards.sort(() => Math.random() - 0.5);
      setReviewCards(shuffled.map(item => item.card));
      setIsReviewing(true);
      setCurrentReviewIndex(0);
      setShowAnswer(false);
    }
  }

  async function handleReviewScore(quality: number) {
    const card = reviewCards[currentReviewIndex];
    const updatedCard = updateSRS(card, quality);
    
    const module = modules.find(m => m.flashcards.some(c => c.id === card.id));
    if (module) {
      const updatedModule = {
        ...module,
        flashcards: module.flashcards.map(c => c.id === card.id ? updatedCard : c),
        updatedAt: Date.now()
      };
      await saveModule(updatedModule);
      await loadModules();
    }

    if (currentReviewIndex < reviewCards.length - 1) {
      setCurrentReviewIndex(prev => prev + 1);
      setShowAnswer(false);
    } else {
      setIsReviewing(false);
    }
  }

  return (
    <div className="h-screen w-full bg-transparent text-foreground font-sans flex flex-col selection:bg-primary/30 selection:text-primary relative overflow-hidden">
      {/* Background elements moved to index.css for global application */}
      
      {/* Top App Bar */}
      <header className="h-16 border-b border-white/10 bg-black/40 backdrop-blur-3xl z-50 flex items-center justify-between px-6 shrink-0 glass-shelf-glow">
        <div className="flex items-center gap-4">
          {selectedModule && activeTab === 'library' && (
            <button onClick={() => setSelectedModule(null)} className="text-primary hover:text-primary/70 transition-colors">
              <ChevronLeft size={20} />
            </button>
          )}
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 bg-primary animate-pulse shadow-[0_0_8px_rgba(255,0,0,0.8)]" />
            <span className="font-medium text-sm tracking-[0.3em] uppercase text-primary drop-shadow-[0_0_8px_rgba(255,0,0,0.3)] glitch-slight">
              {activeTab === 'library' ? (selectedModule ? selectedModule.title : 'ARCHIVE') : activeTab === 'generate' ? 'INIT_SEQ' : activeTab === 'evaluate' ? 'EVALUATE' : activeTab === 'assistant' ? 'AUTONOMOUS_ENTITY' : activeTab === 'chat' ? 'NEURAL_LINK' : 'AI_SYSTEM_CORE'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4">
           <div className="text-[10px] font-mono text-primary/30 tracking-widest hidden sm:block">SYS_CLK: {new Date().toLocaleTimeString()}</div>
        </div>
      </header>

      {/* Error Toast */}
      <AnimatePresence>
        {error && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-20 left-4 right-4 z-[200] bg-destructive text-destructive-foreground px-4 py-3 border-2 border-destructive/50 shadow-[0_0_20px_rgba(255,0,0,0.3)] flex items-center gap-3"
          >
            <AlertCircle size={18} />
            <span className="text-sm font-medium uppercase font-mono tracking-wider">{error}</span>
            <button onClick={() => setError(null)} className="ml-auto hover:opacity-70">
              <XCircle size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="flex-1 overflow-hidden relative z-10 flex flex-col">
        {activeTab === 'library' && !selectedModule && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex-1 flex flex-col h-full"
          >
            <div className="px-8 py-10">
               <h2 className="text-4xl font-extralight uppercase tracking-[0.3em] text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.1)] mb-10">Knowledge Archive</h2>
               <div className="relative group max-w-xl">
                 <Search className="absolute left-0 top-1/2 -translate-y-1/2 text-primary/40 group-focus-within:text-primary transition-colors" size={16} />
                 <input 
                   placeholder="SEARCH RECORDS..." 
                   className="w-full bg-transparent border-b border-white/20 pl-8 pb-3 pt-2 rounded-none focus:outline-none focus:border-primary transition-all font-mono text-xs uppercase tracking-widest text-white/90"
                   value={searchQuery}
                   onChange={(e) => setSearchQuery(e.target.value)}
                 />
               </div>
            </div>
            
            <ScrollArea className="flex-1 px-8 pb-32">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <AnimatePresence mode="popLayout">
                  {filteredModules.map((module) => (
                    <motion.div
                      key={module.id}
                      layout
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="group relative"
                    >
                      <div 
                        className="p-6 bg-white/[0.03] border border-white/10 rounded-none transition-all cursor-pointer flex flex-col gap-4 hover:bg-white/[0.08] hover:border-primary/30 glass-shelf-glow group"
                        onClick={() => setSelectedModule(module)}
                      >
                        <div className="flex justify-between items-start">
                          <span className="font-semibold text-sm uppercase tracking-[0.15em] text-white/90 group-hover:text-primary transition-colors">
                            {module.title}
                          </span>
                          <button 
                            onClick={(e) => { e.stopPropagation(); handleDelete(module.id); }}
                            className="text-white/10 hover:text-destructive transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        <div className="flex items-center gap-6 text-[9px] font-mono uppercase tracking-widest text-white/30">
                          <span className="flex items-center gap-2"><div className="w-1 h-1 bg-primary/40 rounded-full" /> {module.flashcards.length} NODES</span>
                          <span className="flex items-center gap-2 underline decoration-primary/20 underline-offset-4">{new Date(module.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
              {filteredModules.length === 0 && (
                <div className="py-20 text-center opacity-20">
                  <Database size={40} className="mx-auto mb-4" />
                  <p className="text-[10px] font-mono tracking-[0.4em]">ARCHIVE_NULL</p>
                </div>
              )}
            </ScrollArea>
          </motion.div>
        )}

        {activeTab === 'library' && selectedModule && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex-1 flex flex-col h-full"
          >
            <ScrollArea className="flex-1">
              <div className="p-8 max-w-5xl mx-auto pb-32">
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-12 pb-12 border-b border-white/5">
                  <div className="space-y-4">
                    <h1 className="text-5xl font-extralight uppercase tracking-[0.2em] text-primary/90 leading-tight">{selectedModule.title}</h1>
                    <div className="flex items-center gap-8 text-[9px] text-white/30 font-mono tracking-[0.3em] uppercase">
                      <span className="flex items-center gap-2 underline decoration-primary/20 underline-offset-4 pointer-events-none">ID_{selectedModule.id.substr(0, 8)}</span>
                      <span className="flex items-center gap-2"><div className="w-1 h-1 bg-primary/40 rounded-full" /> {selectedModule.flashcards.length} DATA NODES</span>
                    </div>
                  </div>
                  <button 
                    onClick={() => generatePDF(selectedModule)}
                    className="group relative px-8 py-3 overflow-hidden border border-white/10 transition-all hover:border-primary/50 self-start md:self-auto"
                  >
                    <div className="absolute inset-0 bg-primary/5 translate-y-full group-hover:translate-y-0 transition-transform" />
                    <span className="relative z-10 text-[10px] font-bold uppercase tracking-[0.3em] text-white/60 group-hover:text-primary transition-colors flex items-center gap-2">
                       <Download size={12} /> EXPORT_DATA
                    </span>
                  </button>
                </div>

                <Tabs defaultValue="content" className="space-y-12">
                  <TabsList className="bg-transparent border-b border-white/5 p-0 w-full justify-start rounded-none h-auto gap-12">
                    <TabsTrigger value="content" className="rounded-none px-0 pb-4 uppercase font-bold tracking-[0.3em] text-[9px] data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary border-transparent border-b-2 transition-all">Research Path</TabsTrigger>
                    <TabsTrigger value="flashcards" className="rounded-none px-0 pb-4 uppercase font-bold tracking-[0.3em] text-[9px] data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary border-transparent border-b-2 transition-all">Knowledge Nodes</TabsTrigger>
                    <TabsTrigger value="summary" className="rounded-none px-0 pb-4 uppercase font-bold tracking-[0.3em] text-[9px] data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:border-b-2 data-[state=active]:border-primary border-transparent border-b-2 transition-all">Executive Summary</TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="content" className="mt-0 focus-visible:outline-none">
                    <div className="prose prose-invert prose-neutral max-w-4xl mx-auto">
                      <ReactMarkdown>{selectedModule.content}</ReactMarkdown>
                    </div>
                  </TabsContent>

                  <TabsContent value="flashcards" className="mt-0 focus-visible:outline-none">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      {selectedModule.flashcards.map((card, i) => (
                        <div key={card.id} className="group p-8 bg-white/[0.03] border border-white/10 hover:border-primary/40 transition-all flex flex-col gap-6 glass-shelf-glow">
                          <div className="flex justify-between items-center text-[8px] font-mono tracking-[0.4em] uppercase text-white/40 group-hover:text-primary transition-colors">
                            <span>NODE_DATA_{i + 1}</span>
                            <span>{card.repetition > 0 ? `VERIFIED_L${card.repetition}` : 'UNVERIFIED'}</span>
                          </div>
                          <div className="space-y-4">
                            <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-white leading-relaxed font-mono drop-shadow-[0_0_8px_rgba(255,255,255,0.2)]">{card.question}</h3>
                            <div className="h-px bg-white/10 group-hover:bg-primary/20 transition-colors" />
                            <p className="text-sm text-white/70 leading-relaxed font-normal">{card.answer}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </TabsContent>

                  <TabsContent value="summary" className="mt-0 focus-visible:outline-none">
                    <div className="max-w-3xl mx-auto p-12 bg-white/[0.03] border border-white/10 relative overflow-hidden group glass-shelf-glow">
                      <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                         <TerminalSquare size={40} className="text-white" />
                      </div>
                      <p className="text-xl leading-loose text-white font-normal italic drop-shadow-[0_0_8px_rgba(255,255,255,0.1)]">
                        "{selectedModule.summary}"
                      </p>
                      <div className="mt-8 flex items-center gap-4">
                         <div className="w-8 h-px bg-primary" />
                         <span className="text-[10px] font-mono tracking-[0.5em] uppercase text-primary font-bold">Final Synthesis</span>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            </ScrollArea>
          </motion.div>
        )}

        {activeTab === 'generate' && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex-1 flex flex-col px-8 py-20 h-full max-w-2xl mx-auto w-full justify-center pb-32"
          >
            <div className="mb-16">
               <h2 className="text-5xl font-extralight uppercase tracking-[0.4em] mb-4 text-white drop-shadow-[0_0_20px_rgba(255,255,255,0.2)]">Initialize</h2>
               <p className="text-white/40 font-mono text-[10px] uppercase tracking-[0.5em]">Input target parameters for data synthesis</p>
            </div>
            
            <div className="glass-shelf-glow bg-white/[0.03] border border-white/10 p-12 space-y-12">
              <div className="space-y-4 group">
                <Input 
                  placeholder="RESEARCH TOPIC..." 
                  value={newTopic}
                  onChange={(e) => setNewTopic(e.target.value)}
                  className="h-16 text-xl bg-transparent border-0 border-b border-white/20 rounded-none focus-visible:ring-0 focus:border-primary transition-all font-light uppercase tracking-widest !p-0 text-white"
                />
              </div>
              <button 
                onClick={handleGenerate} 
                disabled={isGenerating || !newTopic.trim()} 
                className="group relative h-16 w-full flex items-center justify-center overflow-hidden border border-primary text-primary hover:text-black transition-all disabled:opacity-30 disabled:pointer-events-none"
              >
                <div className="absolute inset-0 bg-primary translate-y-full group-hover:translate-y-0 transition-transform" />
                <span className="relative z-10 font-bold uppercase tracking-[0.4em] text-sm flex items-center gap-3">
                  {isGenerating ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      {generationStatus || 'SYNTHESIZING...'}
                    </>
                  ) : (
                    "Execute Extraction"
                  )}
                </span>
              </button>
            </div>
          </motion.div>
        )}

        {activeTab === 'evaluate' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex-1 flex flex-col items-center justify-center px-8 h-full pb-32 text-center"
          >
            <div className="relative mb-16">
               <div className="absolute inset-0 blur-3xl bg-primary/10 rounded-full scale-150 animate-pulse" />
               <Brain size={80} className="text-primary relative z-10 filter drop-shadow-[0_0_20px_rgba(255,0,0,0.6)]" />
               {dueCardsCount > 0 && (
                 <div className="absolute -top-6 -right-6 font-light text-6xl text-primary/20 select-none">
                    {dueCardsCount.toString().padStart(2, '0')}
                 </div>
               )}
            </div>
            
            <h2 className="text-4xl font-extralight uppercase tracking-[0.3em] mb-4 text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.2)]">Diagnostic</h2>
            
            {dueCardsCount > 0 ? (
              <div className="space-y-12">
                <p className="text-[10px] text-white/60 font-mono max-w-xs mx-auto leading-relaxed uppercase tracking-[0.4em]">
                  Relational inconsistency detected in {dueCardsCount} nodes. Re-verification required.
                </p>
                <button 
                  onClick={startReview}
                  className="relative px-12 py-4 group overflow-hidden border border-primary text-primary hover:text-black transition-all"
                >
                  <div className="absolute inset-0 bg-primary translate-y-full group-hover:translate-y-0 transition-transform" />
                  <span className="relative z-10 font-bold uppercase tracking-[0.5em] text-xs">Start Diagnostic</span>
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-[10px] text-white/40 font-mono uppercase tracking-[0.5em]">Systems Operational</p>
                <div className="w-1.5 h-1.5 bg-primary/80 mx-auto rotate-45 animate-pulse" />
              </div>
            )}
          </motion.div>
        )}

        {activeTab === 'assistant' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex-1 flex flex-col p-8 max-w-4xl mx-auto w-full pb-32 font-sans"
          >
            <div className="flex items-center gap-6 mb-16 border-b border-white/10 pb-8">
              <div className="p-3 border border-primary/30 bg-primary/10 relative overflow-hidden">
                <div className="absolute inset-0 bg-primary/5 animate-pulse" />
                <Cpu size={32} className="text-primary relative z-10 shadow-[0_0_15px_rgba(255,0,0,0.5)]" />
              </div>
              <div>
                <h2 className="text-2xl font-extralight uppercase tracking-[0.3em] text-white">Autonomous Entity</h2>
                <p className="text-[9px] font-mono text-white/40 tracking-[0.4em] uppercase mt-1">Goal-Driven Knowledge Acquisition Subsystem</p>
              </div>
            </div>

            <div className="mb-16 max-w-xl glass-shelf-glow bg-white/[0.03] border border-white/10 p-6">
              <div className="relative group">
                <input 
                  placeholder="NEW OBJECTIVE_DATA..." 
                  className="w-full bg-transparent border-b border-white/20 pb-4 pt-2 rounded-none focus:outline-none focus:border-primary transition-all font-light uppercase tracking-[0.2em] text-sm text-white placeholder:text-white/20"
                  value={newGoal}
                  onChange={(e) => setNewGoal(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateGoal()}
                />
                <button 
                  onClick={handleCreateGoal}
                  className="absolute right-0 top-1/2 -translate-y-1/2 text-primary/60 hover:text-primary transition-colors"
                >
                  <Zap size={18} />
                </button>
              </div>
              <p className="text-[8px] font-mono text-white/20 mt-3 uppercase tracking-[0.3em]">Deploy agent for autonomous research synthesis</p>
            </div>

            <ScrollArea className="flex-1">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pr-4">
                {assistantGoals.map((goal) => (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    key={goal.id} 
                    className="p-8 bg-white/[0.03] border border-white/10 hover:border-primary/40 transition-all space-y-8 glass-shelf-glow"
                  >
                    <div className="flex justify-between items-start">
                      <div className="space-y-1">
                        <div className="text-[8px] font-mono tracking-[0.4em] uppercase text-white/40">{goal.state === AssistantState.COMPLETED ? 'TASK_CLOSED' : 'TASK_ACTIVE'}</div>
                        <h3 className="text-sm font-semibold uppercase tracking-wider text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.1)]">{goal.title}</h3>
                      </div>
                      <div className="text-[9px] font-mono text-white/20">{new Date(goal.createdAt).toLocaleTimeString()}</div>
                    </div>

                    <div className="space-y-2">
                       <div className="flex justify-between text-[9px] font-mono text-white/40 uppercase tracking-widest">
                          <span>Progress</span>
                          <span className="text-white">{goal.progress}%</span>
                       </div>
                       <div className="w-full h-1 bg-white/5 overflow-hidden">
                          <motion.div 
                            className="h-full bg-primary shadow-[0_0_10px_rgba(255,0,0,0.6)]"
                            initial={{ width: 0 }}
                            animate={{ width: `${goal.progress}%` }}
                          />
                       </div>
                    </div>

                    <ul className="space-y-4">
                      {goal.subtasks.map((task) => (
                        <li key={task.id} className="flex items-center gap-4 text-[10px] font-mono tracking-wide uppercase text-white/60">
                          {task.state === AssistantState.COMPLETED ? (
                            <div className="w-1.5 h-1.5 bg-green-500/60 rounded-full shadow-[0_0_5px_rgba(34,197,94,0.4)]" />
                          ) : task.state === AssistantState.WORKING ? (
                            <div className="w-1.5 h-1.5 bg-primary rounded-full animate-ping" />
                          ) : (
                            <div className="w-1.5 h-1.5 border border-white/40 rounded-full" />
                          )}
                          <span className={task.state === AssistantState.COMPLETED ? 'text-white/20' : ''}>
                            {task.title}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </motion.div>
                ))}
              </div>
            </ScrollArea>
          </motion.div>
        )}
        {activeTab === 'chat' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex-1 flex flex-col p-8 max-w-5xl mx-auto w-full pb-32 overflow-hidden"
          >
            <div className="flex items-center justify-between mb-12 border-b border-white/10 pb-8 shrink-0">
              <div className="flex items-center gap-6">
                <div className="w-10 h-10 border border-primary text-primary flex items-center justify-center relative overflow-hidden">
                   <div className="absolute inset-0 bg-primary/10 animate-pulse" />
                   <MessageSquare size={20} className="z-10 shadow-[0_0_10px_rgba(255,0,0,0.3)]" />
                </div>
                <div>
                  <h2 className="text-lg font-extralight uppercase tracking-[0.3em] text-white">Neural Link</h2>
                  <p className="text-[8px] font-mono text-white/30 tracking-[0.4em] uppercase mt-1">Status: Operational // Synchronized</p>
                </div>
              </div>
              <div className="flex gap-2">
                 <div className="w-1 h-1 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                 <div className="w-1 h-1 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: '200ms' }} />
                 <div className="w-1 h-1 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: '400ms' }} />
              </div>
            </div>

            <ScrollArea className="flex-1 pr-6 mb-8">
              <div className="space-y-10">
                {chatMessages.length === 0 && (
                  <div className="h-64 flex flex-col items-center justify-center text-center opacity-10 select-none grayscale">
                    <Database size={48} className="mb-6 text-primary" />
                    <p className="text-[10px] font-mono uppercase tracking-[0.5em] text-white">Cognitive buffer clear.</p>
                  </div>
                )}
                {chatMessages.map((msg, i) => (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    key={i} 
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`max-w-[75%] space-y-2 ${msg.role === 'user' ? 'items-end' : 'items-start'} flex flex-col`}>
                      <div className="text-[8px] font-mono uppercase tracking-[0.3em] opacity-40 mb-1 text-white">
                        {msg.role === 'user' ? 'ID_AUTH_USER' : 'ID_NEURAL_SYS'}
                      </div>
                      <div className={`p-6 rounded-none border glass-shelf-glow ${msg.role === 'user' ? 'bg-primary text-black font-semibold border-primary/50' : 'bg-white/[0.05] border-white/10 text-white/90 shadow-2xl'}`}>
                        <div className="text-sm prose prose-neutral prose-invert max-w-none prose-p:my-0 font-normal leading-relaxed">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
                {isChatting && (
                  <div className="flex justify-start">
                    <div className="flex items-center gap-4 px-6 py-4 bg-white/[0.03] border border-white/10 glass-shelf-glow">
                      <div className="flex gap-1">
                        <span className="w-1 h-1 bg-primary rounded-full animate-pulse" />
                        <span className="w-1 h-1 bg-primary rounded-full animate-pulse delay-75" />
                        <span className="w-1 h-1 bg-primary rounded-full animate-pulse delay-150" />
                      </div>
                      <span className="text-[9px] font-mono uppercase tracking-[0.4em] text-white/40">Synthesizing response...</span>
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>

            <div className="relative group max-w-3xl mx-auto w-full glass-shelf-glow bg-white/[0.03] border border-white/10">
              <input 
                placeholder="TRANSMIT_THOUGHT..." 
                className="w-full bg-transparent border-0 p-6 rounded-none focus:outline-none focus:bg-white/[0.05] transition-all font-light uppercase tracking-[0.2em] text-xs placeholder:text-white/20 text-white"
                value={currentMessage}
                onChange={(e) => setCurrentMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
              />
              <button 
                onClick={handleSendMessage} 
                disabled={isChatting || !currentMessage.trim()}
                className="absolute right-6 top-1/2 -translate-y-1/2 text-primary/60 hover:text-primary transition-colors disabled:opacity-0"
              >
                <Send size={18} />
              </button>
            </div>
          </motion.div>
        )}
        {activeTab === 'ai_console' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex-1 overflow-y-auto p-8 pb-32 max-w-5xl mx-auto w-full font-mono scale-[0.98]"
          >
            <div className="flex items-center gap-6 mb-16 border-b border-white/10 pb-12">
              <div className="relative">
                <div className="absolute inset-0 blur-2xl bg-primary/20 rounded-full animate-pulse" />
                <Brain size={48} className="text-primary relative z-10 drop-shadow-[0_0_10px_rgba(255,0,0,0.5)]" />
              </div>
              <div>
                <h2 className="text-2xl font-light uppercase tracking-[0.4em] text-white">Core Interface</h2>
                <p className="text-[10px] text-white/40 tracking-[0.3em] uppercase mt-2">Advanced Learning Subsystem // v3.1_Exclusive</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
              <div className="lg:col-span-4 space-y-10">
                <div className="space-y-6">
                   <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-primary border-l-2 border-primary pl-4 py-1">System Metrics</h3>
                   <div className="space-y-6">
                      {Object.entries(webStudyEngine.ale.getLearningStatistics()).map(([k, v]) => (
                        <div key={k} className="flex flex-col gap-2">
                          <span className="text-[9px] text-white/40 uppercase tracking-widest">{k.replace(/([A-Z])/g, '_$1').toUpperCase()}</span>
                          <span className="text-lg font-light text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.1)]">{typeof v === 'number' ? v.toFixed(4) : v}</span>
                        </div>
                      ))}
                   </div>
                </div>
              </div>

              <div className="lg:col-span-8 space-y-12">
                <div className="p-8 bg-white/[0.03] border border-white/10 glass-shelf-glow space-y-8">
                   <div className="flex justify-between items-center">
                      <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/40">Relational Fusion Weights</h3>
                      <div className="text-[8px] font-mono text-primary animate-pulse">LIVE_SYNC</div>
                   </div>
                   <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                      {Object.entries(webStudyEngine.ale.TransferManager.getDomainFusionWeights()).map(([k, weight]) => (
                        <div key={k} className="space-y-3">
                          <div className="text-[9px] text-white/30 truncate uppercase tracking-widest">{k.replace('_', ' ')}</div>
                          <div className="text-xl font-light text-primary drop-shadow-[0_0_5px_rgba(255,0,0,0.3)]">{(weight * 100).toFixed(1)}%</div>
                          <div className="w-full h-1 bg-white/5">
                             <div className="h-full bg-primary/60 shadow-[0_0_8px_rgba(255,0,0,0.4)]" style={{ width: `${weight * 100}%` }} />
                          </div>
                        </div>
                      ))}
                   </div>
                </div>

                <div className="p-8 border border-white/10 bg-white/[0.02] hover:border-primary/40 transition-all group glass-shelf-glow">
                   <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
                      <div className="space-y-2">
                         <h3 className="text-sm font-light uppercase tracking-[0.2em] text-white group-hover:text-primary transition-colors">Neural Recalibration</h3>
                         <p className="text-[9px] text-white/40 uppercase tracking-[0.3em]">Force immediate kernel weight updates</p>
                      </div>
                      <button 
                        onClick={() => {
                          webStudyEngine.ale.startLearning();
                          webStudyEngine.ale.forceLearningCycle();
                        }}
                        className="px-8 py-3 bg-primary text-black text-[10px] font-bold uppercase tracking-[0.4em] hover:bg-primary/90 transition-all shadow-[0_0_15px_rgba(255,0,0,0.3)]"
                      >
                         Execute_Cycle
                      </button>
                   </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </main>

      {/* Bottom Navigation */}
      <div className="bg-white/[0.03] border-t border-white/10 backdrop-blur-3xl z-50 fixed bottom-0 left-0 right-0 h-20 flex items-center justify-around px-2 pb-safe glass-shelf-glow">
        <nav className="flex items-center justify-around w-full max-w-lg mx-auto">
          <button 
            onClick={() => setActiveTab('library')}
            className={`flex flex-col items-center gap-1.5 transition-all px-4 py-2 ${activeTab === 'library' ? 'text-primary drop-shadow-[0_0_8px_rgba(255,0,0,0.3)]' : 'text-primary/30 hover:text-primary/50'}`}
          >
            <Database size={18} className={activeTab === 'library' ? 'shadow-[0_0_10px_rgba(255,0,0,0.5)]' : ''} />
            <span className="text-[8px] font-bold uppercase tracking-[0.2em]">Archive</span>
          </button>

          <button 
            onClick={() => setActiveTab('chat')}
            className={`flex flex-col items-center gap-1.5 transition-all px-4 py-2 ${activeTab === 'chat' ? 'text-primary drop-shadow-[0_0_8px_rgba(255,0,0,0.3)]' : 'text-primary/30 hover:text-primary/50'}`}
          >
            <MessageSquare size={18} />
            <span className="text-[8px] font-bold uppercase tracking-[0.2em]">Link</span>
          </button>

          <button 
            onClick={() => setActiveTab('generate')}
            className={`relative flex items-center justify-center w-12 h-12 rotate-45 border transition-all ${activeTab === 'generate' ? 'border-primary bg-primary/10 shadow-[0_0_15px_rgba(255,0,0,0.3)] text-primary' : 'border-white/10 text-primary/30 hover:border-primary/40'}`}
          >
            <Plus size={24} className="-rotate-45" />
          </button>

          <button 
            onClick={() => setActiveTab('assistant')}
            className={`flex flex-col items-center gap-1.5 transition-all px-4 py-2 ${activeTab === 'assistant' ? 'text-primary drop-shadow-[0_0_8px_rgba(255,0,0,0.3)]' : 'text-primary/30 hover:text-primary/50'}`}
          >
            <Zap size={18} />
            <span className="text-[8px] font-bold uppercase tracking-[0.2em]">Agent</span>
          </button>

          <button 
            onClick={() => {
                if (activeTab === 'evaluate') {
                    setActiveTab('ai_console');
                } else if (activeTab === 'ai_console') {
                    setActiveTab('evaluate');
                } else {
                    setActiveTab('evaluate');
                }
            }}
            className={`flex flex-col items-center gap-1.5 transition-all px-4 py-2 relative ${activeTab === 'evaluate' || activeTab === 'ai_console' ? 'text-primary drop-shadow-[0_0_8px_rgba(255,0,0,0.3)]' : 'text-primary/30 hover:text-primary/50'}`}
          >
            <div className="relative">
               {activeTab === 'ai_console' ? <Cpu size={18} /> : <Brain size={18} />}
               {dueCardsCount > 0 && (
                 <span className="absolute -top-1 -right-1 w-1.5 h-1.5 bg-primary shadow-[0_0_5px_rgba(255,0,0,0.8)] rounded-full animate-pulse" />
               )}
            </div>
            <span className="text-[8px] font-bold uppercase tracking-[0.2em]">{activeTab === 'ai_console' ? 'Core' : 'Test'}</span>
          </button>
        </nav>
      </div>

      {/* Full-screen Review Overlay */}
      <AnimatePresence>
        {isReviewing && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-3xl flex flex-col font-sans"
          >
            <div className="absolute inset-0 pointer-events-none opacity-[0.02] bg-[radial-gradient(circle_at_center,var(--color-primary),transparent)]" />
            <div className="h-24 flex items-center justify-between px-12 z-10 shrink-0">
               <button 
                onClick={() => setIsReviewing(false)} 
                className="text-white/20 hover:text-primary transition-colors flex items-center gap-4 text-[10px] font-mono uppercase tracking-[0.3em]"
              >
                <XCircle size={16} /> [Abort_Sequence]
              </button>
              
              <div className="flex-1 flex justify-center items-center px-12 max-w-sm">
                <div className="h-[2px] w-full bg-white/5 overflow-hidden relative">
                  <motion.div 
                    className="h-full bg-primary shadow-[0_0_10px_rgba(255,0,0,0.5)]" 
                    initial={{ width: 0 }}
                    animate={{ width: `${((currentReviewIndex + 1) / reviewCards.length) * 100}%` }}
                  />
                </div>
              </div>
              
              <div className="text-[10px] font-mono text-primary/40 font-bold tracking-[0.4em] uppercase">
                Node {currentReviewIndex + 1} of {reviewCards.length}
              </div>
            </div>

            <div className="flex-1 flex flex-col items-center justify-center p-8 bg-transparent relative z-10 max-w-5xl mx-auto w-full">
              <AnimatePresence mode="wait">
                <motion.div
                  key={reviewCards[currentReviewIndex].id + (showAnswer ? '-ans' : '-q')}
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.02 }}
                  className="w-full h-full flex flex-col items-center justify-center text-center space-y-16"
                >
                  <div className="space-y-6">
                    <div className="text-[9px] font-mono tracking-[0.5em] uppercase text-primary/30">
                      {showAnswer ? "Decrypted_Knowledge" : "Target_Query"}
                    </div>
                    <h3 className="text-4xl md:text-6xl font-extralight uppercase tracking-[0.1em] text-foreground/90 leading-tight">
                      {showAnswer ? reviewCards[currentReviewIndex].answer : reviewCards[currentReviewIndex].question}
                    </h3>
                  </div>
                  
                  <div className="w-full max-w-2xl pt-12">
                    {!showAnswer ? (
                      <button 
                        className="group relative px-16 py-5 overflow-hidden border border-primary/40 transition-all hover:border-primary"
                        onClick={() => setShowAnswer(true)}
                      >
                        <div className="absolute inset-0 bg-primary/5 translate-y-full group-hover:translate-y-0 transition-transform" />
                        <span className="relative z-10 text-primary font-bold uppercase tracking-[0.5em] text-xs">Execute Decryption</span>
                      </button>
                    ) : (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 w-full">
                        {[
                          { q: 1, label: 'Abort', desc: 'DATA_INVALID' },
                          { q: 3, label: 'Diff', desc: 'PARTIAL_SYNC' },
                          { q: 4, label: 'Normal', desc: 'SYNCED' },
                          { q: 5, label: 'Stable', desc: 'PERFECT' },
                        ].map((btn) => (
                          <button 
                            key={btn.q}
                            onClick={() => handleReviewScore(btn.q)}
                            className="group p-6 border border-white/5 hover:border-primary/40 transition-all text-left bg-white/[0.01] hover:bg-primary/[0.03]"
                          >
                            <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/40 group-hover:text-primary transition-colors mb-2">{btn.label}</div>
                            <div className="text-[8px] font-mono tracking-[0.2em] text-white/10 uppercase group-hover:text-primary/40 transition-colors">{btn.desc}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

