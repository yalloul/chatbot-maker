"use client";


import { useEffect, useMemo, useRef, useState } from "react";
import { ingestCSV, chat } from "@/lib/api";
import type { ChatResponse, ChatHit } from "@/types/api";

import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";
import Waves from "@/components/Waves";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: ChatResponse["citations"];
  hits?: ChatHit[];
};

export default function Home() {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";
  const [company, setCompany] = useState("instagram");
  const [file, setFile] = useState<File | null>(null);
  const [reset, setReset] = useState(true);
  const [ingestStatus, setIngestStatus] = useState<null | string>(null);

  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(3);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const disabledChat = useMemo(() => loading || !company.trim(), [loading, company]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setIngestStatus("Please choose a CSV file first.");
      return;
    }
    setIngestStatus("Uploading & indexing…");
    try {
      const res = await ingestCSV(company.trim(), file, reset);
      setIngestStatus(`✅ Ingested ${res.records} rows for "${res.company}".`);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Upload failed";
      setIngestStatus(`❌ ${errorMessage}`);
    }
  }

  async function handleSend() {
    const q = query.trim();
    if (!q) return;

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: q };
    setMessages((m) => [...m, userMsg]);
    setQuery("");
    setLoading(true);

    try {
      const res: ChatResponse = await chat(company.trim(), q, topK);
      const content = res.answer || "(no answer)";

      const asstMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content,
        citations: res.citations,
        hits: res.hits,
      };
      setMessages((m) => [...m, asstMsg]);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "request failed";
      const asstMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `❌ Error: ${errorMessage}`,
      };
      setMessages((m) => [...m, asstMsg]);
    } finally {
      setLoading(false);
    }
  }

  function MessageBubble({ msg }: { msg: Message }) {
    const mine = msg.role === "user";
    const [showCitations, setShowCitations] = useState(false);
    const [showHits, setShowHits] = useState(false);
    
    return (
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.95 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className={`flex ${mine ? "justify-end" : "justify-start"} mb-6`}
      >
        <div className={`max-w-[85%] ${mine ? "order-2" : "order-1"}`}>
          {!mine && (
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 via-purple-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <span className="text-sm text-slate-500 dark:text-slate-400 font-semibold">AI Assistant</span>
            </div>
          )}
          
          <Card className={`${
            mine 
              ? "bg-gradient-to-br from-blue-600 via-purple-600 to-blue-700 dark:from-blue-500 dark:via-purple-500 dark:to-blue-600 text-white border-none shadow-xl" 
              : "bg-gradient-to-br from-white to-slate-50 dark:from-slate-800 dark:to-slate-900 border-slate-200/60 dark:border-slate-600/60 shadow-xl backdrop-blur-sm"
          } transition-all duration-300 hover:shadow-2xl transform hover:-translate-y-1`}>
            <CardContent className="p-5 max-h-80 overflow-y-auto scrollbar-hide">
              {/* Main message content */}
              <div className={`text-sm leading-relaxed text-center ${
                mine ? "text-white" : "text-slate-800 dark:text-slate-200"
              }`}>
                {msg.content}
              </div>
              
              {/* Action buttons for citations and hits */}
              {(msg.citations?.length || msg.hits?.length) && (
                <div className="flex justify-center gap-2 mt-4">
                  {msg.citations && msg.citations.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowCitations(!showCitations)}
                      className={`h-8 px-3 text-xs font-medium transition-all ${
                        mine 
                          ? "text-white/80 hover:text-white hover:bg-white/10" 
                          : "text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                      }`}
                    >
                      <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                      </svg>
                      Sources ({msg.citations.length})
                      <svg className={`w-3 h-3 ml-1 transition-transform ${showCitations ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </Button>
                  )}
                  
                  {msg.hits && msg.hits.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowHits(!showHits)}
                      className={`h-8 px-3 text-xs font-medium transition-all ${
                        mine 
                          ? "text-white/80 hover:text-white hover:bg-white/10" 
                          : "text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                      }`}
                    >
                      <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                      Results ({msg.hits.length})
                      <svg className={`w-3 h-3 ml-1 transition-transform ${showHits ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
          
          {/* Expandable Citations Panel */}
          <AnimatePresence>
            {showCitations && msg.citations && msg.citations.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0, y: -10 }}
                animate={{ opacity: 1, height: "auto", y: 0 }}
                exit={{ opacity: 0, height: 0, y: -10 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="mt-3 overflow-hidden"
              >
                <Card className={`${
                  mine 
                    ? "bg-white/10 border-white/20 backdrop-blur-sm" 
                    : "bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 border-blue-200 dark:border-blue-800"
                } shadow-lg`}>
                  <CardContent className="p-4 text-center">
                    <div className={`text-xs font-semibold mb-3 flex items-center justify-center gap-2 ${
                      mine ? "text-white/90" : "text-slate-700 dark:text-slate-300"
                    }`}>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                      </svg>
                      Source References
                    </div>
                    <div className="grid gap-2">
                      {msg.citations.map((c, i) => (
                        <div
                          key={i}
                          className={`p-3 rounded-xl text-xs text-center ${
                            mine 
                              ? "bg-white/20 text-white/90 backdrop-blur-sm" 
                              : "bg-white dark:bg-slate-800/50 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600"
                          }`}
                        >
                          <div className="font-semibold mb-1 flex items-center justify-center gap-2">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            {c.title}
                          </div>
                          <div className="opacity-75">
                            Type: {c.data_type}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
          
          {/* Expandable Hits Panel */}
          <AnimatePresence>
            {showHits && msg.hits && msg.hits.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0, y: -10 }}
                animate={{ opacity: 1, height: "auto", y: 0 }}
                exit={{ opacity: 0, height: 0, y: -10 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="mt-3 overflow-hidden"
              >
                <Card className={`${
                  mine 
                    ? "bg-white/10 border-white/20 backdrop-blur-sm" 
                    : "bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-800/50 dark:to-slate-700/50 border-slate-200 dark:border-slate-600"
                } shadow-lg`}>
                  <CardContent className="p-4 text-center">
                    <div className={`text-xs font-semibold mb-3 flex items-center justify-center gap-2 ${
                      mine ? "text-white/90" : "text-slate-700 dark:text-slate-300"
                    }`}>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                      Ranked Search Results
                    </div>
                    <div className="grid gap-2 max-h-64 overflow-y-auto scrollbar-hide">
                      {msg.hits.map((h, i) => (
                        <div
                          key={i}
                          className={`p-3 rounded-xl text-xs text-center ${
                            mine 
                              ? "bg-white/20 text-white/90 backdrop-blur-sm" 
                              : "bg-white dark:bg-slate-800/50 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600"
                          }`}
                        >
                          <div className="font-semibold mb-1">{h.title}</div>
                          <div className="opacity-75 flex items-center justify-center gap-2">
                            <span>{h.data_type}</span>
                            <span className="font-mono bg-gradient-to-r from-blue-100 to-purple-100 dark:from-blue-900/30 dark:to-purple-900/30 px-2 py-1 rounded-full">
                              {h.score.toFixed(3)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
          
          {mine && (
            <div className="flex items-center justify-end gap-3 mt-3">
              <span className="text-sm text-slate-500 dark:text-slate-400 font-semibold">You</span>
              <div className="w-8 h-8 bg-gradient-to-br from-green-500 via-blue-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 relative overflow-hidden">
     
      
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-200 dark:bg-blue-900 rounded-full mix-blend-multiply dark:mix-blend-screen opacity-20 animate-pulse"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-purple-200 dark:bg-purple-900 rounded-full mix-blend-multiply dark:mix-blend-screen opacity-20 animate-pulse" style={{ animationDelay: '2s' }}></div>
        <div className="absolute top-40 left-1/2 w-60 h-60 bg-green-200 dark:bg-green-900 rounded-full mix-blend-multiply dark:mix-blend-screen opacity-20 animate-pulse" style={{ animationDelay: '4s' }}></div>
      </div>

      <header className="relative z-10 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-b border-slate-200/50 dark:border-slate-700/50 px-6 py-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              variant="outline"
              size="sm"
              className="lg:hidden hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </Button>
            <Button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              variant="outline"
              size="sm"
              className="hidden lg:flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 border-slate-300 dark:border-slate-600"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              Data Upload
            </Button>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-blue-800 dark:from-blue-400 dark:via-purple-400 dark:to-blue-600 bg-clip-text text-transparent">
                Chatbot Factory
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                Intelligent document chat powered by AI ✨
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-xs text-slate-500 dark:text-slate-400 font-mono bg-slate-100/80 dark:bg-slate-800/80 px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-700">
              {apiBase}
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Sidebar Overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.aside
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 120 }}
            className="fixed left-0 top-0 h-full w-96 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border-r border-slate-200/50 dark:border-slate-700/50 z-50 overflow-y-auto scrollbar-hide shadow-2xl"
          >
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-400 dark:to-purple-400 bg-clip-text text-transparent">Data Upload</h2>
                <Button
                  onClick={() => setSidebarOpen(false)}
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </Button>
              </div>

              <Card className="shadow-xl border-slate-200/60 dark:border-slate-700/60 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800 backdrop-blur-sm">
                <CardHeader className="pb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Upload Documents</h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Process your CSV data with AI</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  <form onSubmit={handleUpload} className="space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="company" className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                        Company Identifier
                      </Label>
                      <Input
                        id="company"
                        value={company}
                        onChange={(e) => setCompany(e.target.value)}
                        placeholder="e.g., instagram, tesla, apple"
                        className="bg-white/80 dark:bg-slate-800/80 border-slate-300 dark:border-slate-600 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:focus:ring-blue-400/20 transition-all"
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="csv" className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        CSV Document
                      </Label>
                      <Input
                        id="csv"
                        type="file"
                        accept=".csv"
                        onChange={(e) => setFile(e.target.files?.[0] || null)}
                        className="bg-white/80 dark:bg-slate-800/80 border-slate-300 dark:border-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-gradient-to-r file:from-blue-50 file:to-purple-50 file:text-blue-700 dark:file:from-blue-900/20 dark:file:to-purple-900/20 dark:file:text-blue-300 hover:file:from-blue-100 hover:file:to-purple-100 dark:hover:file:from-blue-900/40 dark:hover:file:to-purple-900/40 transition-all"
                      />
                    </div>
                    
                    <div className="flex items-center gap-3 p-4 bg-gradient-to-r from-slate-50 to-blue-50 dark:from-slate-800/50 dark:to-slate-700/50 rounded-xl border border-slate-200 dark:border-slate-700">
                      <Checkbox
                        checked={reset}
                        onCheckedChange={(checked) => setReset(checked === true)}
                        id="reset"
                        className="border-slate-400 dark:border-slate-500 data-[state=checked]:bg-blue-600 dark:data-[state=checked]:bg-blue-500"
                      />
                      <Label htmlFor="reset" className="text-sm text-slate-600 dark:text-slate-400 cursor-pointer flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Reset existing index before upload
                      </Label>
                    </div>
                    
                    <Button 
                      type="submit" 
                      className="w-full bg-gradient-to-r from-blue-600 via-purple-600 to-blue-700 hover:from-blue-700 hover:via-purple-700 hover:to-blue-800 dark:from-blue-500 dark:via-purple-500 dark:to-blue-600 dark:hover:from-blue-600 dark:hover:via-purple-600 dark:hover:to-blue-700 text-white font-semibold py-3 shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-0.5"
                    >
                      <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      Upload & Process
                    </Button>
                  </form>
                  
                  {ingestStatus && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`p-3 rounded-lg text-sm ${
                        ingestStatus.includes('✅') 
                          ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800' 
                          : ingestStatus.includes('❌')
                          ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
                          : 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800'
                      }`}
                    >
                      {ingestStatus}
                    </motion.div>
                  )}
                  
                  <Separator className="my-6 bg-slate-200 dark:bg-slate-700" />
                  
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 bg-slate-200 dark:bg-slate-700 rounded-md flex items-center justify-center">
                        <svg className="w-3 h-3 text-slate-600 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      </div>
                      <h4 className="font-medium text-slate-700 dark:text-slate-300">Configuration</h4>
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1 pl-8">
                      <div className="flex justify-between">
                        <span>Chat Endpoint:</span>
                        <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">/v1/chat</code>
                      </div>
                      <div className="flex justify-between">
                        <span>Ingest Endpoint:</span>
                        <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">/v1/ingest</code>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
      <main className="relative z-10 h-[calc(100vh-80px)]">
        {/* Chat panel - Full width */}
        <Card className="h-full shadow-2xl border-slate-200/60 dark:border-slate-700/60 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl overflow-hidden m-4 rounded-2xl">
           {/* Animated wave background */}

      <Waves
        lineColor="rgba(100, 99, 99, 0.18)"
        backgroundColor="transparent"
        waveSpeedX={0.015}
        waveSpeedY={0.008}
        waveAmpX={35}
        waveAmpY={18}
        friction={0.92}
        tension={0.008}
        maxCursorMove={100}
        xGap={14}
        yGap={38}
        className=""
      />
          <div className="grid grid-rows-[auto_1fr_auto] h-full">
            {/* Chat Header */}
            <div className="px-6 py-5 bg-gradient-to-r from-slate-50/80 via-blue-50/50 to-slate-100/80 dark:from-slate-800/80 dark:via-slate-700/50 dark:to-slate-800/80 border-b border-slate-200/60 dark:border-slate-600/60 backdrop-blur-sm">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-gradient-to-br from-green-500 via-blue-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h2 className="text-xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 dark:from-slate-200 dark:to-slate-400 bg-clip-text text-transparent">AI Assistant</h2>
                  <p className="text-sm text-slate-600 dark:text-slate-400 flex items-center gap-2">
                    {company ? (
                      <>
                        <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                        Chatting about <span className="font-semibold text-blue-600 dark:text-blue-400">{company}</span>
                      </>
                    ) : (
                      <>
                        <span className="w-2 h-2 bg-amber-500 rounded-full"></span>
                        Ready to help with your documents
                      </>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {messages.length > 0 && (
                    <div className="text-xs text-slate-500 dark:text-slate-400 bg-gradient-to-r from-slate-100 to-blue-100 dark:from-slate-800 dark:to-slate-700 px-3 py-2 rounded-full border border-slate-200 dark:border-slate-600 font-medium">
                      {messages.length} message{messages.length !== 1 ? 's' : ''}
                    </div>
                  )}
                  <Button
                    onClick={() => setSidebarOpen(true)}
                    variant="outline"
                    size="sm"
                    className="flex items-center gap-2 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 border-blue-200 dark:border-blue-800 hover:from-blue-100 hover:to-purple-100 dark:hover:from-blue-900/40 dark:hover:to-purple-900/40 transition-all duration-200"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <span className="hidden sm:inline font-medium">Upload Data</span>
                  </Button>
                </div>
              </div>
            </div>

            {/* Messages Area */}
            <CardContent className="overflow-y-auto p-6 space-y-4 bg-gradient-to-b from-transparent to-slate-50/30 dark:to-slate-900/30 scrollbar-hide" ref={listRef}>
              {messages.length === 0 && (
                <div className="text-center py-20">
                  <div className="w-24 h-24 bg-gradient-to-br from-blue-100 via-purple-100 to-blue-200 dark:from-blue-900/30 dark:via-purple-900/30 dark:to-blue-800/30 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-lg">
                    <svg className="w-12 h-12 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <h3 className="text-2xl font-bold text-slate-700 dark:text-slate-300 mb-4">
                    Welcome to your AI Assistant
                  </h3>
                  <p className="text-slate-500 dark:text-slate-400 max-w-lg mx-auto mb-8 leading-relaxed">
                    Upload a CSV document using the &apos;Upload Data&apos; button above, then start asking questions about your data. I&apos;ll help you discover insights and provide intelligent answers. ✨
                  </p>
                  <Button
                    onClick={() => setSidebarOpen(true)}
                    className="bg-gradient-to-r from-blue-600 via-purple-600 to-blue-700 hover:from-blue-700 hover:via-purple-700 hover:to-blue-800 dark:from-blue-500 dark:via-purple-500 dark:to-blue-600 text-white font-semibold px-8 py-3 shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1"
                  >
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    Get Started - Upload Data
                  </Button>
                </div>
              )}
              <AnimatePresence>
                {messages.map((m) => (
                  <MessageBubble key={m.id} msg={m} />
                ))}
              </AnimatePresence>
              {loading && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex items-center gap-3 text-slate-500 dark:text-slate-400 bg-white/60 dark:bg-slate-800/60 p-4 rounded-2xl backdrop-blur-sm border border-slate-200 dark:border-slate-700"
                >
                  <div className="flex space-x-1">
                    <div className="w-3 h-3 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full animate-bounce"></div>
                    <div className="w-3 h-3 bg-gradient-to-r from-purple-500 to-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                    <div className="w-3 h-3 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  </div>
                  <span className="text-sm font-medium">AI is thinking...</span>
                </motion.div>
              )}
            </CardContent>

            {/* Input Area */}
            <div className="p-6 bg-gradient-to-r from-slate-50/50 via-white/80 to-slate-50/50 dark:from-slate-800/50 dark:via-slate-900/80 dark:to-slate-800/50 border-t border-slate-200/60 dark:border-slate-600/60 backdrop-blur-sm">
              <div className="flex gap-4 items-end max-w-5xl mx-auto">
                <div className="flex-1">
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey ? (e.preventDefault(), handleSend()) : undefined}
                    placeholder="Ask a question about your documents..."
                    disabled={disabledChat}
                    className="bg-white/90 dark:bg-slate-900/90 border-slate-300 dark:border-slate-600 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-4 focus:ring-blue-500/10 dark:focus:ring-blue-400/10 resize-none h-14 text-base rounded-2xl shadow-lg backdrop-blur-sm transition-all duration-200"
                  />
                </div>
                <div className="flex gap-3">
                  <div className="relative">
                    <Input
                      type="number"
                      min={1}
                      max={20}
                      value={topK}
                      onChange={(e) => setTopK(parseInt(e.target.value || "3", 10))}
                      title="Number of results to retrieve"
                      className="w-20 bg-white/90 dark:bg-slate-900/90 border-slate-300 dark:border-slate-600 text-center h-14 rounded-2xl shadow-lg font-semibold"
                    />
                    <div className="absolute -top-7 left-1/2 transform -translate-x-1/2 text-xs text-slate-500 dark:text-slate-400 font-medium bg-white/80 dark:bg-slate-800/80 px-2 py-1 rounded-full">
                      Top K
                    </div>
                  </div>
                  <Button
                    onClick={handleSend}
                    disabled={disabledChat}
                    className="bg-gradient-to-r from-green-600 via-blue-600 to-purple-600 hover:from-green-700 hover:via-blue-700 hover:to-purple-700 dark:from-green-500 dark:via-blue-500 dark:to-purple-500 text-white font-semibold px-8 h-14 shadow-lg hover:shadow-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed rounded-2xl transform hover:-translate-y-0.5"
                  >
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                    Send
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </main>
    </div>
  );
}
