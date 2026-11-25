'use client'

import React, { useCallback, useEffect, useState } from 'react'
import {
  Check,
  CircleCheck,
  CircleX,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-hot-toast'

import { useLHSession } from '@components/Contexts/LHSessionContext'
import { Input } from '@components/ui/input'
import { Button } from '@components/ui/button'
import {
  getInformaticsLink,
  getInformaticsMe,
  getInformaticsResults,
  linkInformaticsAccount,
  linkInformaticsSession,
  unlinkInformaticsServer,
  updateInformaticsUsername,
  verifyInformaticsLink,
  type InformaticsLinkState,
  type InformaticsMe,
  type InformaticsResult,
} from '@services/informatics/informatics'

function formatDate(value: string): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export default function AccountInformatics() {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token

  const [me, setMe] = useState<InformaticsMe | null>(null)
  const [username, setUsername] = useState('')
  const [userId, setUserId] = useState('')
  const [results, setResults] = useState<InformaticsResult[]>([])
  const [serverLink, setServerLink] = useState<InformaticsLinkState | null>(null)
  const [linkUsername, setLinkUsername] = useState('')
  const [linkPassword, setLinkPassword] = useState('')
  const [linkEmail, setLinkEmail] = useState('')
  const [sessionCookie, setSessionCookie] = useState('')
  const [showRelink, setShowRelink] = useState(false)
  const [linkBusy, setLinkBusy] = useState<'link' | 'verify' | 'unlink' | null>(null)
  const [sessionBusy, setSessionBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async (silent = false) => {
    if (!accessToken) return
    if (!silent) setLoading(true)
    try {
      const [profile, rows, linkState] = await Promise.all([
        getInformaticsMe(accessToken),
        silent
          ? Promise.resolve<InformaticsResult[] | null>(null)
          : getInformaticsResults(accessToken, 20).catch(() => []),
        getInformaticsLink(accessToken).catch(() => null),
      ])
      setMe(profile)
      setUsername(profile.username || '')
      setUserId(profile.informatics_user_id ? String(profile.informatics_user_id) : '')
      if (linkState) {
        setServerLink(linkState)
        if (!silent) {
          setLinkUsername(linkState.informatics_username || profile.username || '')
          setLinkEmail(linkState.email || '')
        }
      }
      if (rows) setResults(rows)
    } catch (error: any) {
      if (!silent) {
        toast.error(
          error?.message ||
            t('informatics.load_failed', { defaultValue: 'Не удалось загрузить данные' })
        )
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [accessToken, t])

  useEffect(() => {
    void load()
  }, [load])

  const serverActive = !!serverLink?.linked && serverLink.status === 'ACTIVE'
  const serverInvalid = serverLink?.status === 'INVALID'

  const submitServerLink = async () => {
    if (!accessToken) return
    if (!linkUsername.trim() || !linkPassword) {
      toast.error(
        t('informatics.link_credentials_required', {
          defaultValue: 'Введите логин и пароль informatics.msk.ru',
        })
      )
      return
    }
    setLinkBusy('link')
    try {
      const next = await linkInformaticsAccount(
        {
          username: linkUsername.trim(),
          password: linkPassword,
          email: linkEmail.trim(),
        },
        accessToken
      )
      setServerLink(next)
      setLinkPassword('')
      setLinkUsername(next.informatics_username || linkUsername)
      setLinkEmail(next.email || linkEmail)
      setShowRelink(false)
      await load()
      toast.success(
        t('informatics.link_saved', {
          defaultValue: 'Аккаунт Informatics подключён',
        })
      )
    } catch (error: any) {
      toast.error(
        error?.message ||
          t('informatics.link_failed', {
            defaultValue: 'Не удалось подключить аккаунт',
          })
      )
      await load(true)
    } finally {
      setLinkBusy(null)
    }
  }

  const submitSessionLink = async () => {
    if (!accessToken) return
    if (!sessionCookie.trim()) {
      toast.error(
        t('informatics.session_cookie_required', {
          defaultValue: 'Вставьте значение cookie MoodleSession',
        })
      )
      return
    }
    setSessionBusy(true)
    try {
      const next = await linkInformaticsSession(
        {
          moodle_session: sessionCookie.trim(),
          email: linkEmail.trim(),
        },
        accessToken
      )
      setServerLink(next)
      setSessionCookie('')
      setShowRelink(false)
      await load()
      toast.success(
        t('informatics.session_linked', {
          defaultValue: 'Сессия Informatics подключена',
        })
      )
    } catch (error: any) {
      toast.error(
        error?.message ||
          t('informatics.session_link_failed', {
            defaultValue: 'Сессия не принята. Проверьте cookie и попробуйте снова.',
          })
      )
    } finally {
      setSessionBusy(false)
    }
  }

  const verifyServerLink = async () => {
    if (!accessToken) return
    setLinkBusy('verify')
    try {
      const next = await verifyInformaticsLink(accessToken)
      setServerLink(next)
      await load()
      toast.success(
        t('informatics.link_verified', {
          defaultValue: 'Соединение с Informatics проверено',
        })
      )
    } catch (error: any) {
      toast.error(
        error?.message ||
          t('informatics.link_verify_failed', {
            defaultValue: 'Не удалось проверить соединение',
          })
      )
      await load(true)
    } finally {
      setLinkBusy(null)
    }
  }

  const disconnectServer = async () => {
    if (!accessToken) return
    if (
      !window.confirm(
        t('informatics.server_disconnect_confirm', {
          defaultValue:
            'Удалить сохранённый пароль Informatics? Автоматическая сдача кода перестанет работать.',
        })
      )
    ) {
      return
    }
    setLinkBusy('unlink')
    try {
      const next = await unlinkInformaticsServer(accessToken)
      setServerLink(next)
      setLinkPassword('')
      setShowRelink(true)
      await load()
      toast.success(
        t('informatics.server_disconnected', {
          defaultValue: 'Серверная авторизация отключена',
        })
      )
    } catch (error: any) {
      toast.error(
        error?.message ||
          t('informatics.server_disconnect_failed', {
            defaultValue: 'Не удалось отключить серверную авторизацию',
          })
      )
    } finally {
      setLinkBusy(null)
    }
  }

  const saveUsername = async () => {
    if (!accessToken) return
    setSaving(true)
    try {
      const next = await updateInformaticsUsername(
        username,
        Number(userId) || 0,
        accessToken
      )
      setMe(next)
      toast.success(t('informatics.saved', { defaultValue: 'Сохранено' }))
    } catch (error: any) {
      toast.error(
        error?.message ||
          t('informatics.save_failed', { defaultValue: 'Не удалось сохранить' })
      )
    } finally {
      setSaving(false)
    }
  }

  if (loading && !me && !serverLink) {
    return (
      <div className="flex min-h-[320px] items-center justify-center rounded-2xl border border-neutral-200 bg-white p-10">
        <div className="flex items-center gap-2.5 text-sm font-semibold text-black/60">
          <Loader2 size={18} className="animate-spin" />
          <span>{t('common.loading_page', { defaultValue: 'Загрузка…' })}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-10">
      {/* Primary authorization: login/password automation. */}
      <section className="rounded-2xl border border-neutral-200 bg-white p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-neutral-900 text-white">
                <ShieldCheck size={17} />
              </span>
              <div>
                <h2 className="text-base font-bold text-black">
                  {t('informatics.auth_title', {
                    defaultValue: 'Автоматическая сдача в Informatics',
                  })}
                </h2>
                <p className="text-xs text-black/40">
                  {t('informatics.auth_subtitle', {
                    defaultValue:
                      'Войдите по логину и паролю informatics.msk.ru — LMS отправит код и заберёт вердикт сам.',
                  })}
                </p>
              </div>
            </div>
          </div>
          <span
            className={`inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${
              serverActive
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : serverInvalid
                  ? 'border-rose-200 bg-rose-50 text-rose-700'
                  : 'border-neutral-200 bg-neutral-50 text-neutral-500'
            }`}
          >
            {serverActive ? (
              <>
                <CircleCheck size={12} />
                {t('informatics.server_connected', { defaultValue: 'Подключено' })}
              </>
            ) : serverInvalid ? (
              <>
                <CircleX size={12} />
                {t('informatics.server_invalid', { defaultValue: 'Ошибка входа' })}
              </>
            ) : (
              t('informatics.server_not_connected', { defaultValue: 'Не подключено' })
            )}
          </span>
        </div>

        {serverInvalid && serverLink?.last_error && (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {serverLink.last_error}
          </div>
        )}

        {serverActive && !showRelink ? (
          <div className="mt-4">
            <div className="rounded-xl border border-neutral-200 bg-neutral-50/60 p-4">
              <p className="text-sm font-semibold text-black">
                {t('informatics.auth_connected_as', {
                  defaultValue: 'Подключено как {{username}}',
                  username: serverLink?.informatics_username || linkUsername || '—',
                })}
              </p>
              <p className="mt-1 text-xs text-black/45">
                {t('informatics.server_last_verified', {
                  defaultValue: 'Последняя проверка',
                })}
                : {formatDate(serverLink?.last_verified_at || '')}
                {serverLink?.informatics_user_id
                  ? ` · ID ${serverLink.informatics_user_id}`
                  : ''}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-black/40">
                {t('informatics.auth_enabled_hint', {
                  defaultValue:
                    'Код из задач Informatics уходит на проверку автоматически, вердикт и зачёт приходят сюда. Данные входа хранятся в зашифрованном виде.',
                })}
              </p>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={verifyServerLink}
                disabled={linkBusy !== null}
              >
                {linkBusy === 'verify' ? (
                  <Loader2 size={14} className="me-1.5 animate-spin" />
                ) : (
                  <RefreshCw size={14} className="me-1.5" />
                )}
                {t('informatics.server_verify', { defaultValue: 'Проверить сессию' })}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowRelink(true)}
                disabled={linkBusy !== null}
              >
                <KeyRound size={14} className="me-1.5" />
                {t('informatics.server_relink', { defaultValue: 'Переподключить' })}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={disconnectServer}
                disabled={linkBusy !== null}
                className="text-red-600 hover:text-red-700"
              >
                {linkBusy === 'unlink' ? (
                  <Loader2 size={14} className="me-1.5 animate-spin" />
                ) : (
                  <Unplug size={14} className="me-1.5" />
                )}
                {t('informatics.server_disconnect', { defaultValue: 'Отключить' })}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-black/40">
                  {t('informatics.server_login', {
                    defaultValue: 'Email или логин',
                  })}
                </label>
                <Input
                  value={linkUsername}
                  onChange={(event) => setLinkUsername(event.target.value)}
                  placeholder="you@example.com"
                  autoComplete="username"
                  maxLength={200}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-black/40">
                  {t('informatics.server_password', { defaultValue: 'Пароль' })}
                </label>
                <Input
                  type="password"
                  value={linkPassword}
                  onChange={(event) => setLinkPassword(event.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  maxLength={500}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-black/40">
                  {t('informatics.server_email', {
                    defaultValue: 'Email (необязательно)',
                  })}
                </label>
                <Input
                  value={linkEmail}
                  onChange={(event) => setLinkEmail(event.target.value)}
                  placeholder="you@example.com"
                  type="email"
                  autoComplete="email"
                  maxLength={320}
                />
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                onClick={submitServerLink}
                disabled={linkBusy !== null || !accessToken}
              >
                {linkBusy === 'link' ? (
                  <Loader2 size={14} className="me-1.5 animate-spin" />
                ) : (
                  <KeyRound size={14} className="me-1.5" />
                )}
                {t('informatics.auth_login_button', {
                  defaultValue: 'Войти и подключить',
                })}
              </Button>
              {showRelink && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowRelink(false)
                    setLinkPassword('')
                  }}
                  disabled={linkBusy !== null}
                >
                  {t('common.cancel', { defaultValue: 'Отмена' })}
                </Button>
              )}
            </div>

            <p className="mt-3 text-xs leading-relaxed text-black/40">
              {t('informatics.auth_security_note', {
                defaultValue:
                  'Пароль шифруется перед сохранением и никогда не возвращается через API. Он нужен, чтобы отправлять код и забирать вердикт без вашего участия. Куки не сохраняются в базе.',
              })}
            </p>

            <details className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
              <summary className="cursor-pointer list-none text-xs font-bold text-amber-900">
                {t('informatics.google_title', {
                  defaultValue: 'Вход через Google (у аккаунта нет пароля)',
                })}
              </summary>
              <div className="mt-2 space-y-2 text-xs leading-relaxed text-amber-900/80">
                <p>
                  {t('informatics.google_steps', {
                    defaultValue:
                      '1. Откройте informatics.msk.ru и войдите через Google. 2. В браузере откройте DevTools → Application → Cookies → informatics.msk.ru. 3. Скопируйте значение cookie MoodleSession и вставьте сюда.',
                  })}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    type="password"
                    value={sessionCookie}
                    onChange={(event) => setSessionCookie(event.target.value)}
                    placeholder="MoodleSession"
                    autoComplete="off"
                    maxLength={4096}
                    className="bg-white"
                  />
                  <Button
                    type="button"
                    onClick={submitSessionLink}
                    disabled={sessionBusy || !accessToken}
                  >
                    {sessionBusy ? (
                      <Loader2 size={14} className="me-1.5 animate-spin" />
                    ) : (
                      <KeyRound size={14} className="me-1.5" />
                    )}
                    {t('informatics.google_connect', {
                      defaultValue: 'Подключить сессию',
                    })}
                  </Button>
                </div>
                <p className="text-[11px] text-amber-800/70">
                  {t('informatics.google_note', {
                    defaultValue:
                      'Cookie шифруется и используется только для отправки кода. Сессия истекает — тогда просто повторите эти шаги.',
                  })}
                </p>
              </div>
            </details>
          </div>
        )}
      </section>

      {/* What the connection enables. */}
      <section className="rounded-2xl border border-neutral-200 bg-white p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Feature
            icon={<Check size={15} />}
            title={t('informatics.feature_submit_title', {
              defaultValue: 'Сдача из LMS',
            })}
            body={t('informatics.feature_submit_body', {
              defaultValue:
                'Отправляйте решение задачи прямо из курса — код уйдёт в Informatics автоматически.',
            })}
          />
          <Feature
            icon={<RefreshCw size={15} />}
            title={t('informatics.feature_verdict_title', {
              defaultValue: 'Вердикт без ручной проверки',
            })}
            body={t('informatics.feature_verdict_body', {
              defaultValue:
                'Фоновый воркер дождётся проверки, сохранит тесты, время и память.',
            })}
          />
          <Feature
            icon={<CircleCheck size={15} />}
            title={t('informatics.feature_credit_title', {
              defaultValue: 'Зачёт ровно один раз',
            })}
            body={t('informatics.feature_credit_body', {
              defaultValue:
                'Принятая посылка закрывает задачу в курсе, история попыток сохраняется.',
            })}
          />
        </div>
      </section>


      {/* Optional teacher identity fields. */}
      <details className="group rounded-2xl border border-neutral-200 bg-white p-5">
        <summary className="cursor-pointer list-none">
          <p className="text-sm font-bold text-black">
            {t('informatics.teacher_title', {
              defaultValue: 'Профиль Informatics (необязательно)',
            })}
          </p>
          <p className="mt-0.5 text-xs text-black/40">
            {t('informatics.teacher_hint', {
              defaultValue:
                'Логин и ID помогают сверить посылки. На авторизацию и автоматическую сдачу они не влияют.',
            })}
          </p>
        </summary>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[1fr_160px]">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wide text-black/50">
              {t('informatics.username', {
                defaultValue: 'Логин на informatics.msk.ru',
              })}
            </label>
            <Input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="username"
              className="mt-2"
              maxLength={200}
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wide text-black/50">
              {t('informatics.user_id', { defaultValue: 'ID пользователя' })}
            </label>
            <Input
              value={userId}
              onChange={(event) => setUserId(event.target.value.replace(/\D/g, ''))}
              placeholder="12345"
              className="mt-2"
              inputMode="numeric"
            />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button type="button" onClick={saveUsername} disabled={saving || !accessToken}>
            {saving && <Loader2 size={14} className="me-1.5 animate-spin" />}
            {t('informatics.save', { defaultValue: 'Сохранить' })}
          </Button>
          {serverLink?.linked && serverLink.last_verified_at && (
            <span className="text-xs text-black/35">
              {t('informatics.server_last_verified', {
                defaultValue: 'Последняя проверка',
              })}
              : {formatDate(serverLink.last_verified_at)}
            </span>
          )}
        </div>
      </details>

      {/* Recent verdicts. */}
      <section className="rounded-2xl border border-neutral-200 bg-white p-6">
        <div className="flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-sm font-bold text-black">
            <CircleCheck size={16} className="text-black/45" />
            {t('informatics.recent_title', { defaultValue: 'Последние вердикты' })}
          </h3>
          <span className="text-xs font-semibold text-black/40">
            {t('informatics.solved_count', { defaultValue: 'Решено' })}:{' '}
            {me?.solved_count ?? 0}
          </span>
        </div>

        {loading ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-black/35">
            <Loader2 size={15} className="animate-spin" />
            {t('common.loading', { defaultValue: 'Загрузка' })}
          </div>
        ) : results.length === 0 ? (
          <p className="mt-4 text-sm text-black/40">
            {t('informatics.recent_empty', {
              defaultValue:
                'Пока пусто. Решите задачу на informatics — результат появится здесь автоматически.',
            })}
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-neutral-100">
            {results.map((row) => (
              <li
                key={`${row.problem_id}-${row.run_id}`}
                className="flex items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-black">
                    №{row.problem_id}
                    <span className="ms-2 text-xs font-normal text-black/35">
                      run {row.run_id}
                    </span>
                  </p>
                  <p className="text-xs text-black/35">
                    {formatDate(row.updated_at || row.created_at)}
                    {row.tests ? ` · ${row.tests} tests` : ''}
                  </p>
                </div>
                <span
                  className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold ${
                    row.solved
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-neutral-200 bg-neutral-50 text-neutral-500'
                  }`}
                >
                  {row.solved ? <Check size={12} /> : <CircleX size={12} />}
                  {row.solved
                    ? t('informatics.status_solved', { defaultValue: 'Зачтено' })
                    : t('informatics.status_failed', { defaultValue: 'Не зачтено' })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode
  title: string
  body: string
}) {
  return (
    <div className="rounded-xl border border-neutral-100 bg-neutral-50/60 p-3.5">
      <div className="flex items-center gap-2 text-black/70">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-white text-black/60">
          {icon}
        </span>
        <p className="text-xs font-bold">{title}</p>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-black/45">{body}</p>
    </div>
  )
}
