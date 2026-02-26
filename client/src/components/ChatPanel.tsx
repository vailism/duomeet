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
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length, typingText])

  useEffect(() => {
    const t = setTimeout(() => onTyping(text.trim().length > 0), 200)
    return () => clearTimeout(t)
  }, [text, onTyping])

  return (
    <div className="glass hover-lift interactive-card flex h-full flex-col gap-3 rounded-2xl p-4">
      <div className="flex items-center gap-2">
        <svg className="h-4 w-4 text-[rgb(var(--muted))]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
        </svg>
        <span className="text-sm font-semibold">Chat</span>
      </div>

      <div
        ref={listRef}
        className="flex-1 overflow-auto rounded-xl border border-[rgb(var(--border))]/40 bg-[rgb(var(--bg))]/30 p-3 text-sm"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-[rgb(var(--muted))]">
            <svg className="h-8 w-8 opacity-40" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 0 1-.923 1.785A5.969 5.969 0 0 0 6 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337Z" />
            </svg>
            <span className="text-xs">No messages yet</span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {messages.map((m) => {
              const isMe = m.from.userId === meUserId
              return (
                <div key={`${m.ts}-${m.from.userId}-${m.message.slice(0, 12)}`} className="leading-snug">
                  <span className={isMe ? 'font-semibold grad-text' : 'font-semibold'}>
                    {isMe ? 'You' : m.from.displayName}
                  </span>
                  <span className="text-[rgb(var(--muted))]">: </span>
                  <span>{m.message}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="min-h-[1.25rem] text-xs text-[rgb(var(--muted))]">{typingText}</div>

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
          className="input-field"
        />
        <button className="btn-primary flex-shrink-0" type="submit">
          <span>Send</span>
        </button>
      </form>
    </div>
  )
}
