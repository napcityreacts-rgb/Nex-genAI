import { useState, useEffect, useMemo, useRef } from 'react';
import { getAllModules, saveModule, deleteModule } from './lib/storage';
import { LearningModule, Flashcard } from './types';
import { updateSRS, getInitialFlashcard } from './lib/srs';
import { generateLearningContent, chatWithAI, type ChatMessage } from './lib/gemini';
import { generatePDF } from './lib/pdf';
import { webStudyEngine } from './lib/ai/WebStudyEngine';
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
  Send,
  MessageSquare,
  User,
  Bot
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';

type Tab = 'library' | 'generate' | 'evaluate' | 'chat';

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
  const [activeTab, setActiveTab] = useState<Tab>('chat');

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    loadModules();
  }, []);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

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

  async function handleGenerate() {
    if (!newTopic.trim()) return;
    setIsGenerating(true);
    setError(null);
    setGenerationStatus('Initializing engine...');
    try {
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

  async function handleSendChat() {
    if (!chatInput.trim() || isChatLoading) return;
    const userMessage: ChatMessage = {
      role: 'user',
      content: chatInput.trim(),
      timestamp: Date.now(),
    };
    const updatedMessages = [...chatMessages, userMessage];
    setChatMessages(updatedMessages);
    setChatInput('');
    setIsChatLoading(true);

    try {
      const response = await chatWithAI(updatedMessages);
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: response,
        timestamp: Date.now(),
      };
      setChatMessages(prev => [...prev, assistantMessage]);
    } catch (err: any) {
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: `Error: ${err.message || 'Failed to get response. Please try again.'}`,
        timestamp: Date.now(),
      };
      setChatMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsChatLoading(false);
      chatInputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendChat();
    }
  }

  function clearChat() {
    setChatMessages([]);
  }

  const getHeaderTitle = () => {
    switch (activeTab) {
      case 'library': return selectedModule ? selectedModule.title : 'ARCHIVE';
      case 'generate': return 'INIT_SEQ';
      case 'evaluate': return 'EVALUATE';
      case 'chat': return 'NEXUS_AI';
      default: return 'NEXGENAI';
    }
  };

  return (
    <div className="h-screen w-full bg-background text-foreground font-sans flex flex-col selection:bg-primary/30 selection:text-primary relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none opacity-5 bg-[repeating-linear-gradient(45deg,var(--color-primary),var(--color-primary)_10px,transparent_10px,transparent_20px)] animate-[pulse_4s_ease-in-out_infinite]" />
      
      {/* Top App Bar */}
      <header className="h-16 border-b border-primary/20 bg-background/90 backdrop-blur-md z-50 flex items-center justify-between px-4 shrink-0 shadow-[0_4px_20px_rgba(255,0,0,0.05)]">
        <div className="flex items-center gap-2">
          {selectedModule && activeTab === 'library' && (
            <Button variant="ghost" size="icon" onClick={() => setSelectedModule(null)} className="mr-2 text-primary hover:bg-primary/10 rounded-none">
              <ChevronLeft size={24} />
            </Button>
          )}
          <div className="w-8 h-8 bg-primary rounded-none flex items-center justify-center text-primary-foreground shadow-[0_0_10px_rgba(255,0,0,0.6)]">
            <Sparkles size={18} />
          </div>
          <span className="font-bold text-lg tracking-widest uppercase text-primary drop-shadow-[0_0_5px_rgba(255,0,0,0.5)] truncate glitch-slight">
            {getHeaderTitle()}
          </span>
        </div>
        {activeTab === 'chat' && chatMessages.length > 0 && (
          <Button variant="ghost" size="icon" onClick={clearChat} className="text-muted-foreground hover:text-destructive rounded-none">
            <Trash2 size={18} />
          </Button>
        )}
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
        {/* LIBRARY TAB */}
        {activeTab === 'library' && !selectedModule && (
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="flex-1 flex flex-col h-full"
          >
            <div className="p-4 border-b border-primary/20 bg-background/50 backdrop-blur-sm">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-primary/50" size={16} />
                <Input 
                  placeholder="QUERY RECORDS..." 
                  className="w-full bg-secondary border border-primary/20 pl-10 h-12 rounded-none focus-visible:ring-primary/50 font-mono text-sm uppercase"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
            
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-3 pb-20">
                <AnimatePresence mode="popLayout">
                  {filteredModules.map((module) => (
                    <motion.div
                      key={module.id}
                      layout
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="group"
                    >
                      <div 
                        className="p-4 bg-secondary/50 border border-primary/20 rounded-none transition-all cursor-pointer flex flex-col gap-2 hover:border-primary/50 hover:bg-secondary relative overflow-hidden"
                        onClick={() => setSelectedModule(module)}
                      >
                        <div className="absolute top-0 right-0 w-8 h-8 bg-[repeating-linear-gradient(45deg,var(--color-primary),var(--color-primary)_2px,transparent_2px,transparent_4px)] opacity-20 -mr-4 -mt-4 rotate-45" />
                        
                        <div className="flex justify-between items-start pr-4">
                          <span className="font-bold text-base truncate uppercase tracking-widest text-primary drop-shadow-[0_0_5px_rgba(255,0,0,0.2)]">
                            {module.title}
                          </span>
                          <button 
                            onClick={(e) => { e.stopPropagation(); handleDelete(module.id); }}
                            className="text-muted-foreground hover:text-destructive flex-shrink-0 p-2 -my-2 -mr-2"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-primary/60 font-mono uppercase">
                          <span className="flex items-center gap-1.5"><BookOpen size={12} /> {module.flashcards.length} NODES</span>
                          <span className="flex items-center gap-1.5"><Clock size={12} /> {new Date(module.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
                {filteredModules.length === 0 && (
                  <div className="py-20 px-4 text-center flex flex-col items-center">
                    <Database size={48} className="text-secondary-foreground opacity-20 mb-4" />
                    <p className="text-sm font-mono text-muted-foreground uppercase tracking-widest">DATA ARCHIVE EMPTY</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </motion.div>
        )}

        {/* LIBRARY - Module Detail */}
        {activeTab === 'library' && selectedModule && (
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="flex-1 flex flex-col h-full bg-background"
          >
            <ScrollArea className="flex-1">
              <div className="p-4 md:p-8 max-w-4xl mx-auto pb-24">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-6 border-b border-primary/20">
                  <div className="space-y-2">
                    <h1 className="text-3xl sm:text-4xl font-black uppercase tracking-widest text-primary drop-shadow-[0_0_8px_rgba(255,0,0,0.4)]">{selectedModule.title}</h1>
                    <div className="flex items-center gap-3 text-xs sm:text-sm text-primary/70 font-mono">
                      <span className="flex items-center gap-1"><History size={14} /> T-{new Date(selectedModule.updatedAt).getTime().toString().substr(-6)}</span>
                      <span className="w-1.5 h-1.5 bg-primary/50 rotate-45" />
                      <span className="flex items-center gap-1"><Layout size={14} /> {selectedModule.flashcards.length} NODES</span>
                    </div>
                  </div>
                  <Button 
                    variant="outline"
                    onClick={() => generatePDF(selectedModule)}
                    className="rounded-none shadow-sm border-primary/40 hover:bg-primary/10 text-primary font-bold uppercase tracking-wider w-full sm:w-auto"
                  >
                    <Download size={16} className="mr-2" />
                    EXPORT
                  </Button>
                </div>

                <Tabs defaultValue="content" className="space-y-6">
                  <ScrollArea className="w-full pb-2">
                    <TabsList className="bg-secondary border border-primary/20 p-1 w-full justify-start rounded-none min-w-max">
                      <TabsTrigger value="content" className="rounded-none px-6 py-2 uppercase font-bold tracking-widest text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground min-w-[100px]">PATH</TabsTrigger>
                      <TabsTrigger value="flashcards" className="rounded-none px-6 py-2 uppercase font-bold tracking-widest text-xs data-[state=active]:text-primary-foreground min-w-[120px]">NODES</TabsTrigger>
                      <TabsTrigger value="summary" className="rounded-none px-6 py-2 uppercase font-bold tracking-widest text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground min-w-[120px]">SUMMARY</TabsTrigger>
                    </TabsList>
                    <ScrollBar orientation="horizontal" />
                  </ScrollArea>
                  
                  <TabsContent value="content" className="mt-4 focus-visible:outline-none">
                    <Card className="border-none shadow-none bg-transparent">
                      <CardContent className="p-0">
                        <div className="prose prose-invert prose-neutral max-w-none text-sm sm:text-base">
                          <ReactMarkdown>{selectedModule.content}</ReactMarkdown>
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="flashcards" className="mt-4 focus-visible:outline-none">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {selectedModule.flashcards.map((card, i) => (
                        <Card key={card.id} className="border border-primary/20 bg-secondary/80 shadow-[0_0_10px_rgba(0,0,0,0.5)] rounded-none relative overflow-hidden">
                          <div className="absolute top-0 right-0 w-12 h-12 bg-[repeating-linear-gradient(45deg,var(--color-primary),var(--color-primary)_2px,transparent_2px,transparent_4px)] opacity-20 -mr-6 -mt-6 rotate-45" />
                          <CardHeader className="p-4 pb-2">
                            <div className="flex justify-between items-center mb-2">
                              <Badge variant="secondary" className="rounded-none border border-primary/30 bg-primary/10 text-[10px] font-bold uppercase tracking-widest text-primary">NODE_{i + 1}</Badge>
                              <span className="text-[10px] text-primary/60 font-mono">
                                {card.repetition > 0 ? `LVL ${card.repetition}` : 'NEW'}
                              </span>
                            </div>
                            <CardTitle className="text-sm uppercase tracking-wide leading-snug text-foreground/90 font-mono">{card.question}</CardTitle>
                          </CardHeader>
                          <CardContent className="p-4 pt-2">
                            <p className="text-xs sm:text-sm text-primary/70 leading-relaxed font-mono">{card.answer}</p>
                          </CardContent>
                          <CardFooter className="p-4 pt-2 border-t border-primary/10 text-[10px] text-primary/50 flex justify-between font-mono bg-background/50 mt-auto">
                            <span>NEXT_REV: {new Date(card.nextReview).getTime().toString().substr(-6)}</span>
                            <span className="text-primary font-bold tracking-widest shadow-[0_0_5px_rgba(255,0,0,0.2)]">[ACTIVE]</span>
                          </CardFooter>
                        </Card>
                      ))}
                    </div>
                  </TabsContent>

                  <TabsContent value="summary" className="mt-4 focus-visible:outline-none">
                    <Card className="border border-primary/20 shadow-sm bg-primary/5 rounded-none">
                      <CardHeader className="p-4 border-b border-primary/10 bg-primary/10">
                        <CardTitle className="flex items-center gap-2 text-primary font-mono text-sm uppercase tracking-widest">
                          <TerminalSquare size={16} />
                          EXEC_SUMMARY
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 sm:p-6">
                        <p className="text-sm sm:text-base leading-relaxed text-foreground/80 font-mono">
                          &gt; {selectedModule.summary}
                          <span className="inline-block w-2 h-4 bg-primary ml-1 animate-pulse" />
                        </p>
                      </CardContent>
                    </Card>
                  </TabsContent>
                </Tabs>
              </div>
            </ScrollArea>
          </motion.div>
        )}

        {/* GENERATE TAB */}
        {activeTab === 'generate' && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="flex-1 flex flex-col p-4 md:p-8 h-full max-w-2xl mx-auto w-full justify-center pb-24"
          >
            <div className="w-24 h-24 bg-primary/5 border border-primary/40 rounded-none shadow-[0_0_20px_rgba(255,0,0,0.15)] flex items-center justify-center mb-8 mx-auto text-primary relative">
              <div className="absolute inset-0 bg-[repeating-linear-gradient(45deg,transparent,transparent_8px,rgba(255,0,0,0.1)_8px,rgba(255,0,0,0.1)_16px)]" />
              <TerminalSquare size={48} className="drop-shadow-[0_0_10px_rgba(255,0,0,0.8)] relative z-10" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-black uppercase tracking-widest mb-3 text-center text-primary drop-shadow-md">Init Sequence</h2>
            <p className="text-primary/70 mb-8 leading-relaxed font-mono text-sm text-center">
              INPUT TARGET PARAMETERS FOR DATA EXTRACTION
            </p>
            
            <div className="space-y-6 bg-secondary/30 p-6 border border-primary/20 backdrop-blur-sm">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-widest text-primary font-mono block">Target Identity</label>
                <Input 
                  placeholder="e.g. Immunology, Cybernetics..." 
                  value={newTopic}
                  onChange={(e) => setNewTopic(e.target.value)}
                  className="h-14 text-lg bg-background border-primary/30 rounded-none focus-visible:ring-primary font-mono uppercase"
                />
              </div>
              <Button 
                onClick={handleGenerate} 
                disabled={isGenerating || !newTopic.trim()} 
                className="w-full h-14 bg-primary text-primary-foreground font-black uppercase tracking-widest text-lg rounded-none shadow-[0_0_15px_rgba(255,0,0,0.3)] hover:bg-primary/90"
              >
                {isGenerating ? (
                  <span className="flex items-center">
                    <Loader2 className="mr-3 animate-spin" size={24} />
                    {generationStatus || 'EXTRACTING...'}
                  </span>
                ) : (
                  "EXECUTE"
                )}
              </Button>
            </div>
          </motion.div>
        )}

        {/* EVALUATE TAB */}
        {activeTab === 'evaluate' && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="flex-1 flex flex-col items-center justify-center p-4 h-full pb-24 text-center"
          >
            <div className="w-32 h-32 bg-primary/5 border-2 border-primary/40 rounded-none flex items-center justify-center mb-8 mx-auto text-primary relative shadow-[0_0_30px_rgba(255,0,0,0.15)] pulse-glow">
              <Brain size={64} className="drop-shadow-[0_0_15px_rgba(255,0,0,0.8)]" />
              {dueCardsCount > 0 && (
                <div className="absolute -top-4 -right-4 w-12 h-12 bg-destructive border-2 border-background flex items-center justify-center text-destructive-foreground font-black text-xl shadow-lg">
                  {dueCardsCount}
                </div>
              )}
            </div>
            
            <h2 className="text-3xl font-black uppercase tracking-widest mb-4 text-primary">System Evaluation</h2>
            
            {dueCardsCount > 0 ? (
              <>
                <p className="text-lg text-primary/80 font-mono mb-8 max-w-md uppercase">
                  {dueCardsCount} DATA NODES REQUIRE RE-VERIFICATION
                </p>
                <Button 
                  onClick={startReview}
                  className="h-16 px-12 bg-primary text-primary-foreground font-black uppercase tracking-widest text-xl rounded-none shadow-[0_0_20px_rgba(255,0,0,0.4)] hover:bg-primary/90 transition-all hover:scale-105"
                >
                  START DIAGNOSTIC
                </Button>
              </>
            ) : (
              <div className="bg-primary/10 border border-primary/20 p-6 max-w-md w-full">
                <p className="text-primary font-mono uppercase tracking-widest">ALL SYSTEMS NOMINAL.</p>
                <p className="text-sm text-primary/60 font-mono mt-2">NO DATA REQUIRES EVALUATION AT THIS TIME.</p>
              </div>
            )}
          </motion.div>
        )}

        {/* CHAT TAB - AI Assistant */}
        {activeTab === 'chat' && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="flex-1 flex flex-col h-full"
          >
            {/* Chat Messages */}
            <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-4 pt-4 pb-4">
              {chatMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-4">
                  <div className="w-20 h-20 bg-primary/5 border-2 border-primary/30 rounded-none flex items-center justify-center mb-6 text-primary relative shadow-[0_0_20px_rgba(255,0,0,0.1)]">
                    <MessageSquare size={40} className="drop-shadow-[0_0_10px_rgba(255,0,0,0.6)]" />
                  </div>
                  <h2 className="text-xl font-black uppercase tracking-widest mb-2 text-primary">NexGenAI Assistant</h2>
                  <p className="text-xs font-mono text-primary/50 uppercase tracking-wider max-w-xs leading-relaxed">
                    AI-POWERED CONVERSATIONAL INTERFACE READY. ASK ANYTHING.
                  </p>
                  <div className="mt-6 grid grid-cols-1 gap-2 w-full max-w-sm">
                    {['Explain quantum computing', 'Help me study biology', 'Write a study plan for CS'].map((suggestion) => (
                      <button
                        key={suggestion}
                        onClick={() => { setChatInput(suggestion); chatInputRef.current?.focus(); }}
                        className="text-left text-xs font-mono text-primary/60 border border-primary/15 bg-secondary/30 px-4 py-3 hover:border-primary/40 hover:text-primary/80 transition-all rounded-none"
                      >
                        &gt; {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-4 max-w-2xl mx-auto">
                  <AnimatePresence>
                    {chatMessages.map((msg, i) => (
                      <motion.div
                        key={msg.timestamp}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2 }}
                        className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                      >
                        <div className={`w-8 h-8 flex-shrink-0 flex items-center justify-center border ${
                          msg.role === 'user' 
                            ? 'bg-primary/10 border-primary/30 text-primary' 
                            : 'bg-secondary border-primary/20 text-primary'
                        }`}>
                          {msg.role === 'user' ? <User size={14} /> : <Bot size={14} />}
                        </div>
                        <div className={`max-w-[80%] ${msg.role === 'user' ? 'text-right' : ''}`}>
                          <div className={`text-[9px] font-mono uppercase tracking-widest mb-1 ${
                            msg.role === 'user' ? 'text-primary/50 text-right' : 'text-primary/40'
                          }`}>
                            {msg.role === 'user' ? 'YOU' : 'NEXGENAI'} &middot; {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                          </div>
                          <div className={`inline-block text-left px-4 py-3 border ${
                            msg.role === 'user'
                              ? 'bg-primary/10 border-primary/30 text-foreground'
                              : 'bg-secondary/50 border-primary/15 text-foreground/90'
                          }`}>
                            {msg.role === 'assistant' ? (
                              <div className="prose prose-invert prose-neutral max-w-none text-sm prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-2 prose-code:text-primary/80">
                                <ReactMarkdown>{msg.content}</ReactMarkdown>
                              </div>
                            ) : (
                              <p className="text-sm font-mono leading-relaxed">{msg.content}</p>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  
                  {isChatLoading && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex gap-3"
                    >
                      <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center border bg-secondary border-primary/20 text-primary">
                        <Bot size={14} />
                      </div>
                      <div className="bg-secondary/50 border border-primary/15 px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Loader2 size={14} className="animate-spin text-primary" />
                          <span className="text-xs font-mono text-primary/60 uppercase tracking-wider">Processing...</span>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </div>
              )}
            </div>

            {/* Chat Input */}
            <div className="border-t border-primary/20 bg-background/95 backdrop-blur-md p-3 shrink-0 pb-5">
              <div className="max-w-2xl mx-auto flex gap-2 items-end">
                <Textarea
                  ref={chatInputRef}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Message NexGenAI..."
                  className="flex-1 min-h-[44px] max-h-[120px] bg-secondary/50 border-primary/20 rounded-none focus-visible:ring-primary/50 focus-visible:border-primary/50 font-mono text-sm resize-none px-4 py-3"
                  rows={1}
                  disabled={isChatLoading}
                />
                <Button
                  onClick={handleSendChat}
                  disabled={!chatInput.trim() || isChatLoading}
                  className="h-[44px] w-[44px] p-0 bg-primary text-primary-foreground rounded-none shadow-[0_0_10px_rgba(255,0,0,0.3)] hover:bg-primary/90 shrink-0 disabled:opacity-30"
                >
                  <Send size={18} />
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </main>

      {/* Bottom Navigation */}
      <div className="bg-background/95 border-t border-primary/20 backdrop-blur-md z-50 fixed bottom-0 left-0 right-0 h-16 flex items-center justify-around pb-safe safe-area-bottom">
        <button 
          onClick={() => setActiveTab('library')}
          className={`flex flex-col items-center justify-center flex-1 h-full gap-1 transition-all ${activeTab === 'library' ? 'text-primary drop-shadow-[0_0_5px_rgba(255,0,0,0.5)]' : 'text-primary/40 hover:text-primary/70'}`}
        >
          <Database size={20} className={activeTab === 'library' ? 'animate-pulse' : ''} />
          <span className="text-[9px] font-bold uppercase tracking-widest">Archive</span>
        </button>

        <button 
          onClick={() => setActiveTab('chat')}
          className={`flex flex-col items-center justify-center flex-1 h-full gap-1 transition-all ${activeTab === 'chat' ? 'text-primary drop-shadow-[0_0_5px_rgba(255,0,0,0.5)]' : 'text-primary/40 hover:text-primary/70'}`}
        >
          <MessageSquare size={20} className={activeTab === 'chat' ? 'animate-pulse' : ''} />
          <span className="text-[9px] font-bold uppercase tracking-widest">Chat</span>
        </button>
        
        <button 
          onClick={() => setActiveTab('generate')}
          className="flex flex-col items-center justify-center px-4 -mt-6 z-10"
        >
          <div className={`w-14 h-14 border-2 flex items-center justify-center bg-background transform rotate-45 transition-all shadow-lg ${activeTab === 'generate' ? 'border-primary shadow-[0_0_15px_rgba(255,0,0,0.5)] text-primary' : 'border-primary/40 text-primary/60 hover:text-primary/80'}`}>
            <Plus size={28} className="-rotate-45" />
          </div>
        </button>
        
        <button 
          onClick={() => setActiveTab('evaluate')}
          className={`flex flex-col items-center justify-center flex-1 h-full gap-1 transition-all relative ${activeTab === 'evaluate' ? 'text-primary drop-shadow-[0_0_5px_rgba(255,0,0,0.5)]' : 'text-primary/40 hover:text-primary/70'}`}
        >
          <div className="relative">
             <Brain size={20} className={activeTab === 'evaluate' ? 'animate-pulse' : ''} />
             {dueCardsCount > 0 && (
               <span className="absolute -top-1 -right-2 w-4 h-4 bg-destructive text-destructive-foreground text-[8px] font-black rounded-none flex items-center justify-center">
                 {dueCardsCount}
               </span>
             )}
          </div>
          <span className="text-[9px] font-bold uppercase tracking-widest">Evaluate</span>
        </button>
      </div>

      {/* Full-screen Review Overlay */}
      <AnimatePresence>
        {isReviewing && (
          <motion.div 
            initial={{ opacity: 0, y: "100%" }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed inset-0 z-[100] bg-background flex flex-col"
          >
            <div className="absolute inset-0 pointer-events-none opacity-[0.03] bg-[repeating-linear-gradient(45deg,var(--color-primary),var(--color-primary)_20px,transparent_20px,transparent_40px)]" />
            <div className="h-16 flex items-center justify-between px-4 border-b border-primary/30 bg-background/90 backdrop-blur-md z-10 shrink-0 shadow-[0_4px_20px_rgba(255,0,0,0.05)]">
               <button 
                onClick={() => setIsReviewing(false)} 
                className="p-2 text-destructive hover:bg-destructive/10 -ml-2"
              >
                <XCircle size={24} />
              </button>
              
              <div className="flex-1 flex justify-center items-center px-4 max-w-[200px]">
                <div className="h-1.5 w-full bg-secondary border border-primary/20 overflow-hidden relative">
                  <div 
                    className="h-full bg-primary transition-all duration-300 ease-out" 
                    style={{ width: `${((currentReviewIndex + 1) / reviewCards.length) * 100}%` }}
                  />
                </div>
              </div>
              
              <div className="text-xs font-mono text-primary font-bold tracking-widest whitespace-nowrap">
                {currentReviewIndex + 1}/{reviewCards.length}
              </div>
            </div>

            <div className="flex-1 overflow-auto flex flex-col items-center p-4 sm:p-6 bg-transparent relative z-10 pb-6">
              <AnimatePresence mode="wait">
                <motion.div
                  key={reviewCards[currentReviewIndex].id + (showAnswer ? '-ans' : '-q')}
                  initial={{ opacity: 0, scale: 0.95, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 1.05, y: -20 }}
                  className="w-full max-w-2xl flex-1 flex flex-col"
                >
                  <Card className="border border-primary/40 shadow-[0_0_30px_rgba(255,0,0,0.1)] bg-card flex-1 flex flex-col rounded-none overflow-hidden relative">
                    <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-primary to-transparent opacity-50" />
                    
                    <CardHeader className="p-6 md:p-12 flex-1 flex flex-col items-center justify-center text-center">
                      <Badge variant="outline" className="mb-6 rounded-none px-4 py-1 text-[10px] font-bold uppercase tracking-widest text-primary border-primary/40 bg-primary/5">
                        {showAnswer ? "[ DECRYPTED ANSWER ]" : "[ TARGET QUERY ]"}
                      </Badge>
                      <h3 className="text-2xl sm:text-3xl font-black uppercase tracking-wide leading-tight text-foreground drop-shadow-md">
                        {showAnswer ? reviewCards[currentReviewIndex].answer : reviewCards[currentReviewIndex].question}
                      </h3>
                    </CardHeader>
                    
                    <div className="mt-auto p-4 md:p-6 pb-6 md:pb-12 bg-background/30 border-t border-primary/10">
                      {!showAnswer ? (
                        <Button 
                          className="w-full h-16 text-lg font-bold uppercase tracking-widest rounded-none bg-primary text-primary-foreground shadow-[0_0_20px_rgba(255,0,0,0.3)] hover:bg-primary/90"
                          onClick={() => setShowAnswer(true)}
                        >
                          Execute Decryption
                          <ArrowRight size={20} className="ml-2" />
                        </Button>
                      ) : (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 w-full">
                          {[
                            { q: 1, label: 'Fail', color: 'bg-destructive text-destructive-foreground border-destructive', desc: 'DATA CORRUPT' },
                            { q: 3, label: 'Hard', color: 'bg-orange-500 text-white border-orange-500', desc: 'PARTIAL REC' },
                            { q: 4, label: 'Good', color: 'bg-primary/80 text-primary-foreground border-primary', desc: 'SECTOR CLEAR' },
                            { q: 5, label: 'Perfect', color: 'bg-primary text-primary-foreground shadow-[0_0_15px_rgba(255,0,0,0.5)] border-primary', desc: 'FLAWLESS EXEC' }
                          ].map((btn) => (
                            <Button
                              key={btn.q}
                              onClick={() => handleReviewScore(btn.q)}
                              className={`${btn.color} border-2 hover:opacity-90 h-16 sm:h-20 flex flex-col items-center justify-center gap-0.5 md:gap-1 rounded-none transition-all hover:scale-[1.02] uppercase tracking-widest`}
                            >
                              <span className="text-xs sm:text-sm font-black">{btn.label}</span>
                              <span className="text-[8px] sm:text-[9px] opacity-80 font-mono truncate max-w-full px-1">{btn.desc}</span>
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  </Card>
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
