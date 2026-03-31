import { useState, useRef, useEffect, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { MessageSquare, Send, Loader2, RotateCcw } from "lucide-react";
import { invokeWithAuth } from "@/lib/invokeWithAuth";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function AiAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  // Focus input when sheet opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const userMessage: Message = { role: "user", content: trimmed };
    const updatedMessages = [...messages, userMessage];

    setMessages(updatedMessages);
    setInput("");
    setLoading(true);

    try {
      const data = await invokeWithAuth<{ reply: string }>("ai-assistant", {
        messages: updatedMessages,
      });

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply || "No response." },
      ]);
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : "Something went wrong.";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${errMsg}` },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleReset = () => {
    setMessages([]);
    setInput("");
  };

  return (
    <>
      {/* Floating trigger button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 lg:bottom-6 lg:right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500 text-zinc-900 shadow-lg transition-colors hover:bg-amber-400"
        aria-label="Open AI Assistant"
      >
        <MessageSquare className="h-5 w-5" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex w-full flex-col bg-white p-0 sm:max-w-md">
          {/* Header */}
          <SheetHeader className="border-b border-zinc-200 px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <SheetTitle className="text-[15px] font-bold text-zinc-900">
                  Kuso AI
                </SheetTitle>
                <SheetDescription className="text-[12px] text-zinc-500">
                  Ask about inventory, orders, and financials
                </SheetDescription>
              </div>
              {messages.length > 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleReset}
                  className="h-7 w-7 text-zinc-400 hover:text-zinc-600"
                  title="Reset conversation"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </SheetHeader>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
          >
            {messages.length === 0 && !loading && (
              <div className="flex h-full items-center justify-center">
                <div className="text-center text-zinc-400">
                  <MessageSquare className="mx-auto mb-2 h-8 w-8 opacity-40" />
                  <p className="text-[13px]">
                    Ask me anything about your stock,
                    <br />
                    orders, or financials.
                  </p>
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-[13px] leading-relaxed ${
                    msg.role === "user"
                      ? "bg-amber-50 text-zinc-900 border border-amber-200"
                      : "bg-zinc-100 text-zinc-800 border border-zinc-200"
                  }`}
                >
                  <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-2 text-[13px] text-zinc-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Thinking…
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-zinc-200 px-4 py-3">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="e.g. What orders need shipping?"
                disabled={loading}
                className="flex-1 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-[13px] text-zinc-900 placeholder:text-zinc-400 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400 disabled:opacity-50"
              />
              <Button
                onClick={handleSend}
                disabled={loading || !input.trim()}
                size="icon"
                className="h-9 w-9 bg-amber-500 text-zinc-900 hover:bg-amber-400 disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
