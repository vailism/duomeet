import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatMessage, ChatTyping } from '../lib/socket'

export function ChatPanel(props: {
  meUserId: string
  messages: ChatMessage[]
  typing: ChatTyping | null
  onSend: (text: string) => void
  onTyping: (isTyping: boolean) => void
}) {
  const { meUserId, messages, typing, onSend, onTyping } = props
  const [text, setText] = useState('')
  const listRef = useRef<HTMLDivElement | null>(null)

  const typingText = useMemo(() => {
    if (!typing?.isTyping) return ''
    return `${typing.from.displayName} is typing…`
  }, [typing])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages.length, typingText])

  useEffect(() => {
    const t = setTimeout(() => onTyping(text.trim().length > 0), 200)
    return () => clearTimeout(t)
  }, [text, onTyping])

  return (
    <div className="glass flex h-full flex-col gap-3 rounded-2xl p-4">
      <div className="text-sm font-semibold">Chat</div>

      <div ref={listRef} className="flex-1 overflow-auto rounded-xl border border-slate-200/60 p-3 text-sm dark:border-slate-700/60">
        {messages.length === 0 ? (
          <div className="text-slate-500">No messages yet.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {messages.map((m) => (
              <div key={`${m.ts}-${m.from.userId}-${m.message.slice(0, 12)}`} className="leading-snug">
                <span className={m.from.userId === meUserId ? 'font-semibold text-pink-600 dark:text-pink-300' : 'font-semibold'}>
                  {m.from.userId === meUserId ? 'You' : m.from.displayName}
                </span>
                <span className="text-slate-500">: </span>
                <span>{m.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-[1.25rem] text-xs text-slate-500">{typingText}</div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const msg = text.trim()
          if (!msg) return
          onSend(msg)
          setText('')
          onTyping(false)
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message…"
          className="w-full rounded-xl border border-slate-200/60 bg-white/70 px-3 py-2 text-sm outline-none backdrop-blur focus:border-pink-400 dark:border-slate-700/60 dark:bg-slate-900/40"
        />
        <button className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100">
          Send
        </button>
      </form>
    </div>
  )
}
