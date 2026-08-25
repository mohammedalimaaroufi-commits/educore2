import { useEffect, useRef, useState } from 'react';
import api, { getLocalFirst } from '../api/client';
import Icon from './Icon.jsx';
import { useConfirmDialog } from './ConfirmDialog.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useLocale } from '../context/LocaleContext.jsx';
import { connectSocket, releaseSocket } from '../api/socket';
import { getTeacherId, readAuthToken } from '../utils/localCache.js';
import { readSettingsCache, writeSettingsCache } from '../utils/settingsCache.js';
import { queueMutation } from '../utils/snapshotSync.js';

const PENDING_CACHE_SECTION = 'teacher-space-pending';
const RESOURCE_TYPES = ['link', 'file', 'test', 'activity', 'game'];
const EMPTY_FORM = { resource_type: 'link', title: '', description: '', resource_url: '', file_name: '' };

function makeClientPostId() {
  return `space-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function pendingPostsFor(teacherId) {
  const value = readSettingsCache(teacherId, PENDING_CACHE_SECTION, []);
  return Array.isArray(value) ? value : [];
}

function persistPendingPosts(teacherId, posts) {
  writeSettingsCache(teacherId, PENDING_CACHE_SECTION, posts.slice(0, 20));
}

function mergePosts(remotePosts, pendingPosts) {
  const remote = Array.isArray(remotePosts) ? remotePosts : [];
  const remoteKeys = new Set(remote.flatMap((post) => [post.id, post.client_post_id].filter(Boolean)));
  const pending = pendingPosts.filter((post) => !remoteKeys.has(post.id) && !remoteKeys.has(post.client_post_id));
  return [...pending, ...remote].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

function displayDate(value, locale) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(locale === 'ar' ? 'ar' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function TeacherSpace() {
  const { teacher } = useAuth();
  const { t, locale, direction } = useLocale();
  const { confirm, confirmDialog } = useConfirmDialog();
  const teacherId = getTeacherId();
  const [posts, setPosts] = useState(() => pendingPostsFor(teacherId));
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [composerOpen, setComposerOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState('');
  const requestIdRef = useRef(0);

  const applyPosts = (remotePosts) => {
    const remote = Array.isArray(remotePosts) ? remotePosts : [];
    const remoteKeys = new Set(remote.flatMap((post) => [post.id, post.client_post_id].filter(Boolean)));
    const pending = pendingPostsFor(teacherId).filter((post) => !remoteKeys.has(post.id) && !remoteKeys.has(post.client_post_id));
    persistPendingPosts(teacherId, pending);
    setPosts(mergePosts(remote, pending));
  };

  const load = async ({ force = false } = {}) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setRefreshing(true);
    try {
      const response = force
        ? await api.get('/teacher-space', { params: { search, type: typeFilter === 'all' ? undefined : typeFilter, language: 'all' } })
        : await getLocalFirst('/teacher-space', { params: { search, type: typeFilter === 'all' ? undefined : typeFilter, language: 'all' } });
      if (requestId !== requestIdRef.current) return;
      applyPosts(response.data?.posts || []);
      if (response.fromLocalCache) {
        void response.revalidatePromise?.then((freshResponse) => {
          if (requestId === requestIdRef.current) applyPosts(freshResponse?.data?.posts || []);
        });
      }
      setError('');
    } catch {
      if (requestId === requestIdRef.current) setError(t('teacherSpaceLoadError'));
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, search.trim() ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [search, typeFilter, locale]);

  useEffect(() => {
    const token = readAuthToken();
    if (!token) return undefined;
    const onSpaceUpdate = ({ action, post } = {}) => {
      if (action === 'deleted' && post?.id) {
        setPosts((current) => current.filter((item) => item.id !== post.id));
        return;
      }
      if (action === 'created' && post?.id) {
        setPosts((current) => mergePosts([post, ...current.filter((item) => item.id !== post.id && item.client_post_id !== post.client_post_id)], pendingPostsFor(teacherId)));
      }
    };
    const socket = connectSocket(token);
    socket?.on('teacher_space_updated', onSpaceUpdate);
    return () => {
      socket?.off('teacher_space_updated', onSpaceUpdate);
      releaseSocket(socket);
    };
  }, [teacherId]);

  const visiblePosts = posts;

  const submitPost = async (event) => {
    event.preventDefault();
    const title = form.title.trim();
    const resourceUrl = form.resource_url.trim();
    if (title.length < 3 || !/^https?:\/\//i.test(resourceUrl)) {
      setFeedback(t('teacherSpaceInvalidPost'));
      return;
    }
    const clientPostId = makeClientPostId();
    const payload = {
      resource_type: form.resource_type,
      language: locale,
      title,
      description: form.description.trim(),
      resource_url: resourceUrl,
      file_name: form.resource_type === 'file' ? form.file_name.trim() : '',
      client_post_id: clientPostId,
    };
    const optimistic = {
      id: `local-${clientPostId}`,
      ...payload,
      author_name: teacher?.full_name || t('teacherFallback'),
      created_at: new Date().toISOString(),
      pending: true,
    };
    setPosts((current) => [optimistic, ...current]);
    persistPendingPosts(teacherId, [...pendingPostsFor(teacherId), optimistic]);
    setSubmitting(true);
    setFeedback('');
    try {
      const { data } = await api.post('/teacher-space', payload);
      const saved = data?.post;
      if (saved) {
        setPosts((current) => current.map((item) => item.client_post_id === clientPostId ? saved : item));
        persistPendingPosts(teacherId, pendingPostsFor(teacherId).filter((item) => item.client_post_id !== clientPostId));
      }
      setForm(EMPTY_FORM);
      setComposerOpen(false);
      setFeedback(t('teacherSpacePublished'));
    } catch (error) {
      const status = Number(error?.response?.status || 0);
      if (status >= 400 && status < 500) {
        setPosts((current) => current.filter((item) => item.client_post_id !== clientPostId));
        persistPendingPosts(teacherId, pendingPostsFor(teacherId).filter((item) => item.client_post_id !== clientPostId));
        setFeedback(t('teacherSpacePublishError'));
      } else {
        await queueMutation(teacherId, { method: 'POST', url: '/teacher-space', data: payload });
        setFeedback(t('teacherSpaceSavedLocally'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const deletePost = async (post) => {
    if (post.pending || String(post.id).startsWith('local-')) return;
    const accepted = await confirm({ title: t('teacherSpaceDeleteTitle'), message: t('teacherSpaceDeleteMessage'), confirmLabel: t('delete'), cancelLabel: t('cancel'), danger: true });
    if (!accepted) return;
    setPosts((current) => current.filter((item) => item.id !== post.id));
    try {
      await api.delete(`/teacher-space/${post.id}`);
      setFeedback(t('teacherSpaceDeleted'));
    } catch (error) {
      const status = Number(error?.response?.status || 0);
      if (status >= 400 && status < 500) {
        setPosts((current) => [post, ...current]);
        setFeedback(t('teacherSpaceDeleteError'));
      } else {
        await queueMutation(teacherId, { method: 'DELETE', url: `/teacher-space/${post.id}` });
        setFeedback(t('teacherSpaceDeleteQueued'));
      }
    }
  };

  return (
    <section className="teacher-space" dir={direction} aria-labelledby="teacher-space-title">
      {confirmDialog}
      <div className="teacher-space__header">
        <div className="teacher-space__identity">
          <span className="teacher-space__mark"><Icon name="users" className="w-5 h-5" /></span>
          <div><span className="eyebrow">{t('teacherSpaceEyebrow')}</span><h2 id="teacher-space-title">{t('teacherSpaceTitle')}</h2><p>{t('teacherSpaceDescription')}</p></div>
        </div>
        <button type="button" className="btn-primary teacher-space__share" onClick={() => setComposerOpen((open) => !open)}><Icon name="plus" className="w-4 h-4" />{composerOpen ? t('close') : t('teacherSpaceShare')}</button>
      </div>

      {composerOpen && <form className="teacher-space__composer" onSubmit={submitPost}>
        <div className="teacher-space__composer-head"><div><strong>{t('teacherSpaceShareTitle')}</strong><span>{t('teacherSpaceShareHint')}</span></div><button type="button" className="utility-icon" onClick={() => setComposerOpen(false)} aria-label={t('close')}>×</button></div>
        <div className="teacher-space__form-grid">
          <label><span>{t('teacherSpaceType')}</span><select value={form.resource_type} onChange={(event) => setForm((current) => ({ ...current, resource_type: event.target.value }))}>{RESOURCE_TYPES.map((type) => <option key={type} value={type}>{t(`teacherSpaceType_${type}`)}</option>)}</select></label>
          <label><span>{t('teacherSpaceResourceTitle')}</span><input required maxLength={120} value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder={t('teacherSpaceTitlePlaceholder')} /></label>
          <label className="teacher-space__form-wide"><span>{t('teacherSpaceUrl')}</span><input required type="url" value={form.resource_url} onChange={(event) => setForm((current) => ({ ...current, resource_url: event.target.value }))} placeholder="https://" /></label>
          {form.resource_type === 'file' && <label><span>{t('teacherSpaceFileName')}</span><input maxLength={180} value={form.file_name} onChange={(event) => setForm((current) => ({ ...current, file_name: event.target.value }))} placeholder={t('teacherSpaceFileNamePlaceholder')} /></label>}
          <label className="teacher-space__form-wide"><span>{t('teacherSpaceDescriptionLabel')}</span><textarea maxLength={800} rows={2} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder={t('teacherSpaceDescriptionPlaceholder')} /></label>
        </div>
        <div className="teacher-space__composer-actions"><span className="teacher-space__privacy"><Icon name="secure" className="w-3.5 h-3.5" />{t('teacherSpacePrivacyNote')}</span><button className="btn-primary" type="submit" disabled={submitting}>{submitting ? t('saving') : t('teacherSpacePublish')}</button></div>
        {feedback && <p className="teacher-space__feedback" role="status">{feedback}</p>}
      </form>}

      <div className="teacher-space__toolbar">
        <label className="teacher-space__search"><Icon name="search" className="w-4 h-4" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('teacherSpaceSearch')} /></label>
        <label className="teacher-space__filter"><Icon name="filter" className="w-4 h-4" /><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">{t('teacherSpaceAllTypes')}</option>{RESOURCE_TYPES.map((type) => <option key={type} value={type}>{t(`teacherSpaceType_${type}`)}</option>)}</select></label>
        <button type="button" className="teacher-space__refresh" onClick={() => load({ force: true })} disabled={refreshing} aria-label={t('teacherSpaceRefresh')} title={t('teacherSpaceRefresh')}><Icon name="refresh" className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /></button>
        <span className="teacher-space__count">{t('teacherSpaceCount', '', { count: visiblePosts.length })}</span>
      </div>

      {feedback && !composerOpen && <p className="teacher-space__feedback" role="status">{feedback}</p>}
      {error && <div className="teacher-space__error" role="alert">{error}<button type="button" onClick={() => load({ force: true })}>{t('retry')}</button></div>}
      {loading && visiblePosts.length === 0 ? <div className="teacher-space__empty teacher-space__empty--loading">{t('teacherSpaceLoading')}</div> : visiblePosts.length === 0 ? <div className="teacher-space__empty"><Icon name="users" className="w-7 h-7" /><strong>{t('teacherSpaceEmpty')}</strong><span>{t('teacherSpaceEmptyHint')}</span></div> : <div className="teacher-space__grid">{visiblePosts.map((post) => <article key={post.id} className={`teacher-space__card ${post.pending ? 'is-pending' : ''}`}>
        <div className="teacher-space__card-top"><span className={`teacher-space__type teacher-space__type--${post.resource_type}`}><Icon name={post.resource_type === 'link' || post.resource_type === 'game' ? 'externalLink' : post.resource_type === 'file' || post.resource_type === 'test' ? 'fileCheck' : 'reports'} className="w-3.5 h-3.5" />{t(`teacherSpaceType_${post.resource_type}`)}</span><time>{displayDate(post.created_at, locale)}</time></div>
        <h3>{post.title}</h3>
        {post.description && <p className="teacher-space__card-description">{post.description}</p>}
        <div className="teacher-space__card-meta"><span>{post.file_name || post.author_name}</span>{post.pending && <em>{t('teacherSpacePending')}</em>}</div>
        <div className="teacher-space__card-actions"><a href={post.resource_url} target="_blank" rel="noreferrer noopener" className="teacher-space__open"><Icon name="externalLink" className="w-4 h-4" />{t('teacherSpaceOpen')}</a>{post.teacher_id === teacherId && !post.pending && <button type="button" className="teacher-space__delete" onClick={() => deletePost(post)} aria-label={t('teacherSpaceDelete')} title={t('teacherSpaceDelete')}><Icon name="trash" className="w-4 h-4" /></button>}</div>
      </article>)}</div>}
    </section>
  );
}
