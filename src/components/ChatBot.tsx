"use client";

import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function ChatBot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Hey! 🐸 I'm your ads strategist. Ask me which ads to pause, where you're wasting budget, or what creative to test next. I can see all your live data." },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const sendMessage = async (overrideMsg?: string) => {
    const userMsg = (overrideMsg ?? input).trim();
    if (!userMsg || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg,
          history: messages.slice(-10), // last 10 messages for context
        }),
      });
      const data = await res.json();
      setMessages((prev) => [...prev, { role: "assistant", content: data.response || "Sorry, something went wrong. Try again." }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Couldn't reach the AI. Check your connection and try again." }]);
    }
    setLoading(false);
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(!open)}
        className={`fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-br from-[#4ADE80] to-[#22C55E] text-white shadow-xl shadow-green-300/40 hover:shadow-2xl hover:shadow-green-300/50 transition-all duration-300 hover:scale-110 flex items-center justify-center ${!open ? 'animate-gentle-bounce' : ''}`}
      >
        {open ? (
          <svg className="w-6 h-6 transition-transform duration-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-8 h-8" viewBox="0 0 40 40" fill="none">
            {/* Frog body */}
            <ellipse cx="20" cy="24" rx="14" ry="11" fill="#86EFAC" />
            {/* Frog head */}
            <circle cx="20" cy="17" r="12" fill="#4ADE80" />
            {/* Left eye bump */}
            <circle cx="13" cy="10" r="5" fill="#4ADE80" />
            <circle cx="27" cy="10" r="5" fill="#4ADE80" />
            {/* Left eye white */}
            <circle cx="13" cy="10" r="3.5" fill="white" />
            <circle cx="27" cy="10" r="3.5" fill="white" />
            {/* Left eye pupil */}
            <circle cx="14" cy="10" r="2" fill="#1a1a2e" />
            <circle cx="28" cy="10" r="2" fill="#1a1a2e" />
            {/* Eye shine */}
            <circle cx="14.8" cy="9.2" r="0.7" fill="white" />
            <circle cx="28.8" cy="9.2" r="0.7" fill="white" />
            {/* Smile */}
            <path d="M14 20 Q20 25 26 20" stroke="#15803d" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            {/* Cheek blush */}
            <ellipse cx="12" cy="19" rx="2.5" ry="1.5" fill="#FCA5A5" opacity="0.5" />
            <ellipse cx="28" cy="19" rx="2.5" ry="1.5" fill="#FCA5A5" opacity="0.5" />
          </svg>
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-[380px] max-h-[520px] rounded-3xl bg-white shadow-2xl shadow-green-200/30 border border-green-100 flex flex-col overflow-hidden animate-slide-up">
          {/* Header */}
          <div className="px-5 py-4 bg-gradient-to-r from-[#22C55E] to-[#15803d] text-white">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-lg">
                🐸
              </div>
              <div>
                <div className="text-[14px] font-semibold">Froggy</div>
                <div className="text-[11px] text-white/70">Your ads strategist</div>
              </div>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-[300px] max-h-[340px]">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-[13px] leading-relaxed ${
                    msg.role === "user"
                      ? "bg-gradient-to-r from-[#EC4899] to-[#8B5CF6] text-white rounded-br-md"
                      : "bg-[#F0FDF4] text-foreground rounded-bl-md"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <div className="space-y-1.5">
                      {msg.content.split('\n').filter(Boolean).map((line, j) => (
                        <p key={j} className={line.startsWith('🔴') || line.startsWith('🟠') || line.startsWith('🟢') || line.startsWith('⚠️') ? 'pl-1' : ''}>
                          {line}
                        </p>
                      ))}
                    </div>
                  ) : msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="px-4 py-3 rounded-2xl bg-[#F0FDF4] rounded-bl-md">
                  <div className="flex gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-green-300 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <div className="w-2 h-2 rounded-full bg-green-300 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <div className="w-2 h-2 rounded-full bg-green-300 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="px-4 py-3 border-t border-green-50">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                placeholder="Ask about your ads..."
                className="flex-1 px-4 py-2.5 rounded-xl bg-[#F0FDF4] border border-green-100 text-[13px] text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-green-200 focus:border-green-300 transition-all"
              />
              <button
                onClick={() => sendMessage()}
                disabled={loading || !input.trim()}
                className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#22C55E] to-[#15803d] text-white text-[13px] font-medium disabled:opacity-40 hover:shadow-md transition-all btn-hover-scale"
              >
                Send
              </button>
            </div>
            <div className="mt-2 flex gap-1.5 flex-wrap">
              {["Which ads should I pause?", "What's my best performer?", "Give me an action plan", "Where am I wasting spend?"].map((q) => (
                <button
                  key={q}
                  onClick={() => { sendMessage(q); }}
                  className="text-[10px] px-2.5 py-1 rounded-full bg-[#DCFCE7] text-[#15803d] hover:bg-green-200 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
