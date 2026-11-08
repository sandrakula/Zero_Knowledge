'use client'
import React from 'react'
import { Send, Loader2, Paperclip, FolderOpen, X, Image as ImageIcon, Link as LinkIcon, FileText, Video, Search, Globe } from 'lucide-react'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import type { CoursePlanningMessage, Attachment, CourseProgress } from '@services/ai/courseplanning'
import lrnaiIcon from 'public/lrnai_icon.png'
import { safeImageSrc } from '@services/security/url'

interface AICourseChatProps {
  messages: CoursePlanningMessage[]
  iterationCount: number
  maxIterations: number
  isLoading: boolean
  onSendMessage: (message: string, attachments?: Attachment[]) => void
  hasVideoAttachment?: boolean
  isCourseCreated?: boolean
  progress?: CourseProgress | null
}

const STAGE_LABELS: Record<string, string> = {
  youtube: 'Ищу видео на YouTube',
  transcripts: 'Читаю транскрипты',
  slides: 'Анализирую слайды видео',
  articles: 'Разбираю статьи',
  summaries: 'Сжимаю в конспекты',
  planning: 'Пишу план курса',
}

const SUGGESTION_CHIPS = [
  { label: 'Web Development', prompt: 'Create a comprehensive web development course covering HTML, CSS, and JavaScript from basics to advanced topics' },
  { label: 'Data Science', prompt: 'Create a data science course covering Python, statistics, machine learning, and data visualization' },
  { label: 'Marketing', prompt: 'Create a digital marketing course covering SEO, social media marketing, content strategy, and analytics' },
  { label: 'Language', prompt: 'Create a language learning course with vocabulary, grammar, conversation practice, and cultural insights' },
  { label: 'Business', prompt: 'Create a business fundamentals course covering entrepreneurship, finance, marketing, and management' },
  { label: 'Design', prompt: 'Create a UI/UX design course covering design principles, Figma, user research, and prototyping' },
]

const MAX_ATTACHMENTS = 100
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024

function AICourseChat({
  messages,
  iterationCount,
  maxIterations,
  isLoading,
  onSendMessage,
  hasVideoAttachment = false,
  isCourseCreated = false,
  progress = null,
}: AICourseChatProps) {
  const { t } = useTranslation()
  const [inputValue, setInputValue] = React.useState('')
  const [attachments, setAttachments] = React.useState<Attachment[]>([])
  const [attachError, setAttachError] = React.useState('')
  const [isDragging, setIsDragging] = React.useState(false)
  const [youtubeUrl, setYoutubeUrl] = React.useState('')
  const [showYoutubeInput, setShowYoutubeInput] = React.useState(false)
  const [articleUrl, setArticleUrl] = React.useState('')
  const [showArticleInput, setShowArticleInput] = React.useState(false)
  const [loadingDuration, setLoadingDuration] = React.useState(0)
  const messagesEndRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLTextAreaElement>(null)
  const loadingTimerRef = React.useRef<NodeJS.Timeout | null>(null)

  const canSendMessage = !isLoading && !isCourseCreated && iterationCount < maxIterations && (inputValue.trim() || attachments.length > 0)
  const isExhausted = iterationCount >= maxIterations
  const currentHasVideo = attachments.some(a => a.type === 'youtube' || a.type === 'youtube_search' || a.type === 'article') || hasVideoAttachment

  const progressTotal = progress && typeof progress.total === 'number' && progress.total > 0 ? progress.total : 0
  const progressDone = progress && typeof progress.done === 'number' ? progress.done : 0
  const progressLabel = progress
    ? `${STAGE_LABELS[progress.stage] ?? progress.stage}${progressTotal > 0 ? ` ${progressDone}/${progressTotal}` : ''}`
    : ''
  const progressPercent = progressTotal > 0
    ? Math.max(0, Math.min(100, (progressDone / progressTotal) * 100))
    : 0

  React.useEffect(() => {
    if (isLoading) {
      setLoadingDuration(0)
      loadingTimerRef.current = setInterval(() => setLoadingDuration(prev => prev + 1), 1000)
    } else {
      if (loadingTimerRef.current) { clearInterval(loadingTimerRef.current); loadingTimerRef.current = null }
      setLoadingDuration(0)
    }
    return () => { if (loadingTimerRef.current) clearInterval(loadingTimerRef.current) }
  }, [isLoading])

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  React.useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (canSendMessage) {
      onSendMessage(inputValue.trim(), attachments.length > 0 ? attachments : undefined)
      setInputValue('')
      setAttachments([])
      setAttachError('')
      setShowYoutubeInput(false)
      setShowArticleInput(false)
    }
  }

  const handleSuggestionClick = (prompt: string) => {
    if (!isLoading && !isCourseCreated && iterationCount < maxIterations) {
      onSendMessage(prompt)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const addFiles = (files: File[]) => {
    if (files.length === 0) return

    let skippedCount = 0
    let skippedSize = false
    const usedBytes = attachments.reduce((total, attachment) => total + (attachment.file?.size || 0), 0)
    let totalBytes = usedBytes
    const nextAttachments = [...attachments]

    for (const file of files) {
      if (nextAttachments.length >= MAX_ATTACHMENTS) {
        skippedCount += 1
        continue
      }
      if (totalBytes + file.size > MAX_ATTACHMENT_BYTES) {
        skippedSize = true
        skippedCount += 1
        continue
      }

      const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      const type: Attachment['type'] = file.type.startsWith('image/')
        ? 'image'
        : file.type.startsWith('video/')
          ? 'video'
          : 'file'
      const name = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
      nextAttachments.push({ id, type, name, file })
      totalBytes += file.size

      if (type === 'image' || type === 'video') {
        const reader = new FileReader()
        reader.onload = (event) => {
          setAttachments((prev) => prev.map((attachment) =>
            attachment.id === id ? { ...attachment, preview: event.target?.result as string } : attachment
          ))
        }
        reader.readAsDataURL(file)
      }
    }

    if (skippedCount > 0) {
      setAttachError(
        skippedSize
          ? t('courses.create.ai.attach_limit_size') || 'Attachments must be 15 MB or smaller in total; extra files were skipped.'
          : t('courses.create.ai.attach_limit_count', { max: MAX_ATTACHMENTS }) || `You can attach up to ${MAX_ATTACHMENTS} files; extra files were skipped.`
      )
    } else {
      setAttachError('')
    }

    setAttachments(nextAttachments)
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files || []))
    e.target.value = ''
  }

  const openFilePicker = (directory: boolean) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    if (directory) {
      input.setAttribute('webkitdirectory', '')
      input.setAttribute('directory', '')
    }
    input.onchange = (event) => handleFileSelect(event as unknown as React.ChangeEvent<HTMLInputElement>)
    input.click()
  }

  const collectDroppedFiles = async (dataTransfer: DataTransfer): Promise<File[]> => {
    const items = Array.from(dataTransfer.items || [])
    const entries = items
      .map((item) => (item as DataTransferItem & { webkitGetAsEntry?: () => unknown }).webkitGetAsEntry?.())
      .filter(Boolean)

    if (entries.length === 0) return Array.from(dataTransfer.files || [])

    const files: File[] = []
    const readBatch = (reader: any) => new Promise<any[]>((resolve, reject) => reader.readEntries(resolve, reject))

    const walk = async (entry: any): Promise<void> => {
      if (files.length >= MAX_ATTACHMENTS) return
      if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject))
        files.push(file)
        return
      }
      if (entry.isDirectory) {
        const reader = entry.createReader()
        let batch = await readBatch(reader)
        while (batch.length > 0 && files.length < MAX_ATTACHMENTS) {
          for (const child of batch) await walk(child)
          batch = await readBatch(reader)
        }
      }
    }

    for (const entry of entries) await walk(entry)
    return files
  }

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const files = await collectDroppedFiles(e.dataTransfer)
    addFiles(files)
  }

  const handleYoutubeAdd = () => {
    if (!youtubeUrl.trim()) return
    if (attachments.length >= MAX_ATTACHMENTS) {
      setAttachError(
        t('courses.create.ai.attach_limit_count', { max: MAX_ATTACHMENTS }) || `You can attach up to ${MAX_ATTACHMENTS} files.`
      )
      return
    }
    const youtubeRegex = /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/i
    const match = youtubeUrl.match(youtubeRegex)

    if (match && match[1]) {
      const videoId = match[1]
      setAttachments((prev) => [...prev, {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'youtube',
        name: `YouTube: ${videoId}`,
        url: youtubeUrl.trim(),
        preview: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
      }])
    } else {
      const searchTerm = youtubeUrl.trim()
      setAttachments((prev) => [...prev, {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'youtube_search',
        name: searchTerm,
        url: undefined,
        preview: undefined,
      }])
    }
    setYoutubeUrl('')
    setShowYoutubeInput(false)
    setAttachError('')
  }

  const handleArticleAdd = () => {
    const trimmed = articleUrl.trim()
    if (!trimmed) return
    if (attachments.length >= MAX_ATTACHMENTS) {
      setAttachError(
        t('courses.create.ai.attach_limit_count', { max: MAX_ATTACHMENTS }) || `You can attach up to ${MAX_ATTACHMENTS} files.`
      )
      return
    }
    if (!/^https?:\/\//i.test(trimmed)) {
      setAttachError(
        t('courses.create.ai.attach_article_invalid') || 'Please enter a valid article URL (starting with http:// or https://).'
      )
      return
    }
    let name = trimmed
    try {
      name = new URL(trimmed).hostname
    } catch {
      name = trimmed
    }
    setAttachments((prev) => [...prev, {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'article',
      name,
      url: trimmed,
    }])
    setArticleUrl('')
    setShowArticleInput(false)
    setAttachError('')
  }

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
    setAttachError('')
  }

  const getAttachmentIcon = (type: Attachment['type']) => {
    switch (type) {
      case 'image': return <ImageIcon className="w-3 h-3" />
      case 'youtube': return <LinkIcon className="w-3 h-3 text-red-400" />
      case 'youtube_search': return <Search className="w-3 h-3 text-purple-400" />
      case 'article': return <Globe className="w-3 h-3 text-teal-400" />
      default: return <FileText className="w-3 h-3" />
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <style>{`
        @keyframes ai-progress-stripe {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
      `}</style>
      {/* Messages area */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 scrollbar-hide">
        {/* Empty state with suggestions */}
        {messages.length === 0 && !isLoading && (
          <div className="space-y-4 pt-8">
            <div className="flex justify-center">
              <Image
                className="outline outline-1 outline-neutral-200/20 rounded-lg"
                width={28}
                src={lrnaiIcon}
                alt="AI"
              />
            </div>
            <p className="text-sm text-white/50 text-center">
              {t('courses.create.ai.chat_description')}
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {SUGGESTION_CHIPS.map((chip) => (
                <button
                  key={chip.label}
                  onClick={() => handleSuggestionClick(chip.prompt)}
                  className="px-4 py-1.5 text-xs font-semibold bg-white/5 text-white/40 rounded-xl hover:text-white/60 hover:bg-white/10 transition-all outline outline-1 outline-neutral-100/10 hover:outline-neutral-200/40 delay-75 ease-linear"
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Message bubbles */}
        {messages.map((message, index) => (
          <div
            key={index}
            className={cn("flex", message.role === 'user' ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm",
                message.role === 'user'
                  ? "bg-purple-600/80 text-white rounded-ee-md"
                  : "bg-white/5 text-white/80 rounded-es-md ring-1 ring-inset ring-white/10"
              )}
            >
              {message.role === 'user' ? (
                <p className="whitespace-pre-wrap">{message.content}</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-white/50 font-medium">
                    {t('courses.create.ai.plan_generated')}
                  </p>
                  <p className="text-white/60 text-xs">
                    {t('courses.create.ai.plan_generated_hint')}
                  </p>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white/5 rounded-2xl rounded-es-md px-4 py-3 ring-1 ring-inset ring-white/10 max-w-[85%] w-full min-w-0">
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 animate-spin text-purple-400 shrink-0" />
                <div className="flex flex-col gap-1 min-w-0">
                  <span className="text-sm text-white/70 font-medium">
                    {progress
                      ? progressLabel
                      : currentHasVideo && loadingDuration < 10
                        ? t('courses.create.ai.processing_video')
                        : t('courses.create.ai.generating')}
                  </span>
                  {!progress && loadingDuration >= 5 && (
                    <span className="text-xs text-white/40">
                      {currentHasVideo
                        ? t('courses.create.ai.video_processing_hint')
                        : t('courses.create.ai.still_working')}
                    </span>
                  )}
                  {!progress && loadingDuration >= 15 && currentHasVideo && (
                    <span className="text-xs text-amber-400/70">
                      {t('courses.create.ai.video_takes_time')}
                    </span>
                  )}
                </div>
              </div>
              {progress ? (
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-1.5 flex-1 bg-white/10 rounded-full overflow-hidden">
                    {progressTotal > 0 ? (
                      <div
                        className="h-full bg-purple-500/80 rounded-full"
                        style={{ width: `${progressPercent}%`, transition: 'width 0.3s ease-out' }}
                      />
                    ) : (
                      <div className="relative h-full w-full overflow-hidden">
                        <div
                          className="absolute inset-y-0 w-1/3 rounded-full bg-gradient-to-r from-transparent via-purple-500/80 to-transparent"
                          style={{ animation: 'ai-progress-stripe 1.2s linear infinite' }}
                        />
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-white/30 tabular-nums">{loadingDuration}s</span>
                </div>
              ) : (
                loadingDuration >= 3 && (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1 flex-1 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple-500/50 rounded-full animate-pulse"
                        style={{ width: `${Math.min(loadingDuration * 2, 95)}%`, transition: 'width 1s ease-out' }}
                      />
                    </div>
                    <span className="text-xs text-white/30 tabular-nums">
                      {loadingDuration}s
                    </span>
                  </div>
                )
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-white/5 p-4">
        {isExhausted ? (
          <div className="text-center text-sm text-white/50 py-2">
            {t('courses.create.ai.max_iterations_reached')}
          </div>
        ) : isCourseCreated ? (
          <div className="text-center text-sm text-white/40 py-2">
            {t('courses.create.ai.content_step_info')}
          </div>
        ) : (
          <div className="space-y-3">
            {/* Attachments preview */}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 p-2 max-h-28 overflow-y-auto bg-white/5 rounded-xl ring-1 ring-inset ring-white/10">
                {attachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    className="relative group flex items-center gap-2 px-2.5 py-2 bg-white/5 rounded-lg ring-1 ring-inset ring-white/10 hover:ring-white/20 transition-all"
                  >
                    {safeImageSrc(attachment.preview) ? (
                      <div className="w-10 h-10 rounded-md overflow-hidden bg-black/20 ring-1 ring-inset ring-white/10">
                        <img src={safeImageSrc(attachment.preview)} alt={attachment.name} className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="w-10 h-10 rounded-md bg-white/5 flex items-center justify-center text-white/40 ring-1 ring-inset ring-white/10">
                        {getAttachmentIcon(attachment.type)}
                      </div>
                    )}
                    <div className="flex flex-col">
                      <span className="text-xs text-white/70 font-medium max-w-[100px] truncate">{attachment.name}</span>
                      {attachment.type === 'youtube' && (
                        <span className="text-[10px] text-red-400/70 flex items-center gap-1">
                          <Video className="w-3 h-3" /> YouTube
                        </span>
                      )}
                      {attachment.type === 'youtube_search' && (
                        <span className="text-[10px] text-purple-400/70 flex items-center gap-1">
                          <Search className="w-3 h-3" /> YouTube search
                        </span>
                      )}
                      {attachment.type === 'article' && (
                        <span className="text-[10px] text-teal-400/70 flex items-center gap-1">
                          <Globe className="w-3 h-3" /> Article
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeAttachment(attachment.id)}
                      className="p-1 rounded-full bg-white/10 hover:bg-red-500/30 text-white/60 hover:text-red-300 transition-colors ms-1"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Input container */}
            <div
              className={cn(
                "relative bg-white/[0.03] rounded-2xl ring-1 ring-inset transition-all",
                isDragging
                  ? "ring-purple-500/60 bg-purple-500/[0.06]"
                  : "ring-white/10 focus-within:ring-purple-500/30"
              )}
              onDragEnter={(e) => { e.preventDefault(); setIsDragging(true) }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false)
              }}
              onDrop={handleDrop}
            >
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  messages.length === 0
                    ? t('courses.create.ai.input_placeholder_initial')
                    : t('courses.create.ai.input_placeholder_iterate')
                }
                disabled={isLoading}
                rows={3}
                className={cn(
                  "w-full resize-none bg-transparent px-4 pt-4 pb-14",
                  "text-sm text-white placeholder:text-white/30",
                  "focus:outline-none",
                  isLoading ? "opacity-30" : ""
                )}
                style={{ minHeight: '100px', maxHeight: '200px' }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement
                  target.style.height = 'auto'
                  target.style.height = Math.min(target.scrollHeight, 200) + 'px'
                }}
              />

              {isDragging && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-gray-950/40">
                  <span className="text-xs font-medium text-purple-200">
                    {t('courses.create.ai.drop_files') || 'Drop files or a folder here'}
                  </span>
                </div>
              )}

              {/* Bottom toolbar */}
              <div className="absolute bottom-0 start-0 end-0 flex items-center justify-between gap-2 p-3 border-t border-white/5">
                <div className="flex min-w-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => openFilePicker(false)}
                    disabled={isLoading}
                    title={t('courses.create.ai.attach_files') || 'Attach files'}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all text-xs font-medium",
                      !isLoading
                        ? "bg-white/5 text-white/50 hover:text-white/70 hover:bg-white/10 ring-1 ring-inset ring-white/10"
                        : "bg-white/5 text-white/20 cursor-not-allowed"
                    )}
                  >
                    <Paperclip className="w-4 h-4" />
                    <span className="hidden sm:inline">{t('courses.create.ai.attach_files') || 'Files'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => openFilePicker(true)}
                    disabled={isLoading}
                    title={t('courses.create.ai.attach_folder') || 'Attach a folder'}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all text-xs font-medium",
                      !isLoading
                        ? "bg-white/5 text-white/50 hover:text-white/70 hover:bg-white/10 ring-1 ring-inset ring-white/10"
                        : "bg-white/5 text-white/20 cursor-not-allowed"
                    )}
                  >
                    <FolderOpen className="w-4 h-4" />
                    <span className="hidden sm:inline">{t('courses.create.ai.attach_folder') || 'Folder'}</span>
                  </button>

                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowYoutubeInput((prev) => !prev)}
                      disabled={isLoading}
                      title={t('courses.create.ai.attach_youtube') || 'YouTube video or topic'}
                      className={cn(
                        "flex items-center justify-center w-8 h-8 rounded-lg transition-all",
                        !isLoading
                          ? "bg-white/5 text-white/50 hover:text-red-300 hover:bg-white/10 ring-1 ring-inset ring-white/10"
                          : "bg-white/5 text-white/20 cursor-not-allowed"
                      )}
                    >
                      <LinkIcon className="w-4 h-4" />
                    </button>

                    {showYoutubeInput && (
                      <div className="absolute bottom-full start-0 mb-2 w-72 max-w-[calc(100vw-2rem)] bg-gray-900 rounded-xl ring-1 ring-white/10 shadow-2xl p-3 space-y-2 z-50">
                        <input
                          type="text"
                          value={youtubeUrl}
                          onChange={(e) => setYoutubeUrl(e.target.value)}
                          placeholder="Paste a YouTube URL or a topic (e.g. decision trees)..."
                          className="w-full px-3 py-2.5 text-sm bg-white/5 rounded-lg text-white placeholder:text-white/30 ring-1 ring-inset ring-white/10 focus:outline-none focus:ring-purple-500/30"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); handleYoutubeAdd() }
                          }}
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setShowYoutubeInput(false)}
                            className="flex-1 px-3 py-2 text-xs font-medium text-white/50 hover:text-white/70 bg-white/5 rounded-lg transition-colors"
                          >
                            {t('common.cancel') || 'Cancel'}
                          </button>
                          <button
                            type="button"
                            onClick={handleYoutubeAdd}
                            className="flex-1 px-3 py-2 text-xs font-medium text-white bg-purple-500/50 hover:bg-purple-500/70 rounded-lg transition-colors"
                          >
                            {t('common.add') || 'Add'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowArticleInput((prev) => !prev)}
                      disabled={isLoading}
                      title={t('courses.create.ai.attach_article') || 'Article URL'}
                      className={cn(
                        "flex items-center justify-center w-8 h-8 rounded-lg transition-all",
                        !isLoading
                          ? "bg-white/5 text-white/50 hover:text-teal-300 hover:bg-white/10 ring-1 ring-inset ring-white/10"
                          : "bg-white/5 text-white/20 cursor-not-allowed"
                      )}
                    >
                      <Globe className="w-4 h-4" />
                    </button>

                    {showArticleInput && (
                      <div className="absolute bottom-full start-0 mb-2 w-72 max-w-[calc(100vw-2rem)] bg-gray-900 rounded-xl ring-1 ring-white/10 shadow-2xl p-3 space-y-2 z-50">
                        <input
                          type="text"
                          value={articleUrl}
                          onChange={(e) => setArticleUrl(e.target.value)}
                          placeholder="Paste an article URL (https://...)"
                          className="w-full px-3 py-2.5 text-sm bg-white/5 rounded-lg text-white placeholder:text-white/30 ring-1 ring-inset ring-white/10 focus:outline-none focus:ring-purple-500/30"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); handleArticleAdd() }
                          }}
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setShowArticleInput(false)}
                            className="flex-1 px-3 py-2 text-xs font-medium text-white/50 hover:text-white/70 bg-white/5 rounded-lg transition-colors"
                          >
                            {t('common.cancel') || 'Cancel'}
                          </button>
                          <button
                            type="button"
                            onClick={handleArticleAdd}
                            className="flex-1 px-3 py-2 text-xs font-medium text-white bg-teal-500/50 hover:bg-teal-500/70 rounded-lg transition-colors"
                          >
                            {t('common.add') || 'Add'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Send button */}
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canSendMessage}
                  className={cn(
                    "flex shrink-0 items-center gap-2 px-4 py-1.5 rounded-lg transition-all text-xs font-medium",
                    canSendMessage
                      ? "bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 ring-1 ring-inset ring-purple-500/30"
                      : "bg-white/5 text-white/30 cursor-not-allowed ring-1 ring-inset ring-white/10"
                  )}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{t('courses.create.ai.generating_short') || 'Generating...'}</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      <span>{t('courses.create.ai.send') || 'Send'}</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {attachError && (
              <p className="text-xs text-amber-400/70 text-center">{attachError}</p>
            )}

            {attachments.some(a => a.type === 'youtube' || a.type === 'youtube_search' || a.type === 'article') && (
              <p className="text-xs text-amber-400/60 text-center">
                {t('courses.create.ai.video_hint') || 'Videos may take 1-2 minutes to process'}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default AICourseChat
