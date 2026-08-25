import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
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

function normalizeSubject(value) {
  return String(value || '').normalize('NFKC').replace(/[\u064B-\u065F\u0670]/g, '').trim().toLocaleLowerCase('en-US').replace(/^ال/u, '').replace(/\s+/g, ' ');
}

function pendingPostsFor(teacherId) {
  const value = readSettingsCache(teacherId, PENDING_CACHE_SECTION, []);
  return Array.isArray(value) ? value : [];
}

function persistPendingPosts(teacherId, posts) {
  writeSettingsCache(teacherId, PENDING_CACHE_SECTION, posts.slice(0, 20));
}

function sortPosts(items) {
  return [...items].sort((a, b) => {
    const likesDifference = Number(b.like_count || 0) - Number(a.like_count || 0);
    if (likesDifference) return likesDifference;
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  });
}

function mergePosts(remotePosts, pendingPosts) {
  const remote = Array.isArray(remotePosts) ? remotePosts : [];
  const remoteKeys = new Set(remote.flatMap((post) => [post.id, post.client_post_id].filter(Boolean)));
  const pending = pendingPosts.filter((post) => !remoteKeys.has(post.id) && !remoteKeys.has(post.client_post_id));
  return sortPosts([...pending, ...remote]);
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
  const currentSubjectKey = normalizeSubject(teacher?.subject);
  const [posts, setPosts] = useState(() => pendingPostsFor(teacherId).filter((post) => normalizeSubject(post.subject || post.subject_key) === currentSubjectKey));
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [composerOpen, setComposerOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [subjectRequired, setSubjectRequired] = useState(false);
  const [commentsByPost, setCommentsByPost] = useState({});
  const [commentsOpen, setCommentsOpen] = useState({});
  const [commentDrafts, setCommentDrafts] = useState({});
  const [commentLoading, setCommentLoading] = useState({});
  const [commentSubmitting, setCommentSubmitting] = useState({});
  const [interactionBusy, setInteractionBusy] = useState({});
  const requestIdRef = useRef(0);

  const applyPosts = (remotePosts) => {
    const remote = Array.isArray(remotePosts) ? remotePosts : [];
    const remoteKeys = new Set(remote.flatMap((post) => [post.id, post.client_post_id].filter(Boolean)));
    const allPending = pendingPostsFor(teacherId).filter((post) => !remoteKeys.has(post.id) && !remoteKeys.has(post.client_post_id));
    const pending = allPending.filter((post) => normalizeSubject(post.subject || post.subject_key) === currentSubjectKey);
    persistPendingPosts(teacherId, allPending);
    setPosts(mergePosts(remote, pending));
  };

  const applyResponse = (data) => {
    setSubjectRequired(Boolean(data?.subject_required));
    applyPosts(data?.posts || []);
  };

  const load = async ({ force = false } = {}) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setRefreshing(true);
    try {
      const response = force
        ? await api.get('/teacher-space', { params: { search, type: typeFilter === 'all' ? undefined : typeFilter, language: 'all', subject_key: currentSubjectKey } })
        : await getLocalFirst('/teacher-space', { params: { search, type: typeFilter === 'all' ? undefined : typeFilter, language: 'all', subject_key: currentSubjectKey } });
      if (requestId !== requestIdRef.current) return;
      applyResponse(response.data);
      if (response.fromLocalCache) {
        void response.revalidatePromise?.then((freshResponse) => {
          if (requestId === requestIdRef.current) applyResponse(freshResponse?.data || {});
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
  }, [search, typeFilter, locale, teacher?.subject]);

  useEffect(() => {
    const token = readAuthToken();
    if (!token) return undefined;
    const onSpaceUpdate = ({ action, post, comment, comment_id: commentId } = {}) => {
      if (action === 'deleted' && post?.id) {
        setPosts((current) => current.filter((item) => item.id !== post.id));
        return;
      }
      if (['created', 'liked', 'unliked', 'commented', 'comment_deleted'].includes(action) && post?.id) {
        setPosts((current) => sortPosts(current.some((item) => item.id === post.id) ? current.map((item) => item.id === post.id ? { ...item, ...post } : item) : [post, ...current]));
        if (action === 'commented' && post?.id && comment?.id) setCommentsByPost((current) => ({ ...current, [post.id]: [...(current[post.id] || []).filter((item) => item.id !== comment.id), comment] }));
        if (action === 'comment_deleted' && post?.id && commentId) setCommentsByPost((current) => ({ ...current, [post.id]: (current[post.id] || []).filter((item) => item.id !== commentId) }));
      }
    };
    const socket = connectSocket(token);
    socket?.on('teacher_space_updated', onSpaceUpdate);
    return () => {
      socket?.off('teacher_space_updated', onSpaceUpdate);
      releaseSocket(socket);
    };
  }, [teacherId]);

  const visiblePosts = sortPosts(posts);

  const updatePostFromInteraction = (updatedPost) => {
    if (!updatedPost?.id) return;
    setPosts((current) => sortPosts(current.map((item) => item.id === updatedPost.id ? { ...item, ...updatedPost } : item)));
  };

  const toggleLike = async (post) => {
    if (post.pending || interactionBusy[post.id]) return;
    const nextLiked = !post.liked_by_me;
    setInteractionBusy((current) => ({ ...current, [post.id]: true }));
    setPosts((current) => sortPosts(current.map((item) => item.id === post.id ? { ...item, liked_by_me: nextLiked, like_count: Math.max(0, Number(item.like_count || 0) + (nextLiked ? 1 : -1)) } : item)));
    try {
      const response = nextLiked ? await api.put(`/teacher-space/${post.id}/like`) : await api.delete(`/teacher-space/${post.id}/like`);
      updatePostFromInteraction({ ...post, ...response.data, id: post.id });
    } catch (error) {
      const status = Number(error?.response?.status || 0);
      if (status >= 400 && status < 500) {
        setPosts((current) => sortPosts(current.map((item) => item.id === post.id ? { ...item, liked_by_me: post.liked_by_me, like_count: post.like_count || 0 } : item)));
        setFeedback(t('teacherSpaceLikeError'));
      } else {
        await queueMutation(teacherId, { method: nextLiked ? 'PUT' : 'DELETE', url: `/teacher-space/${post.id}/like` });
        setFeedback(t('teacherSpaceLikeSavedLocally'));
      }
    } finally {
      setInteractionBusy((current) => ({ ...current, [post.id]: false }));
    }
  };

  const loadComments = async (postId) => {
    setCommentsOpen((current) => ({ ...current, [postId]: !current[postId] }));
    if (commentsByPost[postId]) return;
    setCommentLoading((current) => ({ ...current, [postId]: true }));
    try {
      const { data } = await getLocalFirst(`/teacher-space/${postId}/comments`);
      setCommentsByPost((current) => ({ ...current, [postId]: Array.isArray(data?.comments) ? data.comments : [] }));
    } catch {
      setFeedback(t('teacherSpaceCommentsLoadError'));
    } finally {
      setCommentLoading((current) => ({ ...current, [postId]: false }));
    }
  };

  const submitComment = async (event, post) => {
    event.preventDefault();
    const body = String(commentDrafts[post.id] || '').trim();
    if (!body || post.pending || commentSubmitting[post.id]) return;
    const clientCommentId = `comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic = { id: `local-${clientCommentId}`, client_comment_id: clientCommentId, teacher_id: teacherId, author_name: teacher?.full_name || t('teacherFallback'), body, created_at: new Date().toISOString(), can_delete: true, pending: true };
    setCommentsOpen((current) => ({ ...current, [post.id]: true }));
    setCommentsByPost((current) => ({ ...current, [post.id]: [...(current[post.id] || []), optimistic] }));
    setCommentDrafts((current) => ({ ...current, [post.id]: '' }));
    setCommentSubmitting((current) => ({ ...current, [post.id]: true }));
    try {
      const { data } = await api.post(`/teacher-space/${post.id}/comments`, { body, client_comment_id: clientCommentId });
      if (data?.comment) setCommentsByPost((current) => ({ ...current, [post.id]: (current[post.id] || []).map((item) => item.client_comment_id === clientCommentId ? data.comment : item) }));
      updatePostFromInteraction(data?.post);
    } catch (error) {
      const status = Number(error?.response?.status || 0);
      if (status >= 400 && status < 500) {
        setCommentsByPost((current) => ({ ...current, [post.id]: (current[post.id] || []).filter((item) => item.client_comment_id !== clientCommentId) }));
        setFeedback(t('teacherSpaceCommentError'));
      } else {
        await queueMutation(teacherId, { method: 'POST', url: `/teacher-space/${post.id}/comments`, data: { body, client_comment_id: clientCommentId } });
        setFeedback(t('teacherSpaceCommentSavedLocally'));
      }
    } finally {
      setCommentSubmitting((current) => ({ ...current, [post.id]: false }));
    }
  };

  const deleteComment = async (post, comment) => {
    if (!comment.can_delete || comment.pending) return;
    const accepted = await confirm({ title: t('teacherSpaceDeleteCommentTitle'), message: t('teacherSpaceDeleteCommentMessage'), confirmLabel: t('delete'), cancelLabel: t('cancel'), danger: true });
    if (!accepted) return;
    setCommentsByPost((current) => ({ ...current, [post.id]: (current[post.id] || []).filter((item) => item.id !== comment.id) }));
    updatePostFromInteraction({ ...post, comment_count: Math.max(0, Number(post.comment_count || 0) - 1) });
    try {
      const { data } = await api.delete(`/teacher-space/${post.id}/comments/${comment.id}`);
      updatePostFromInteraction(data?.post);
    } catch (error) {
      const status = Number(error?.response?.status || 0);
      if (status >= 400 && status < 500) {
        setCommentsByPost((current) => ({ ...current, [post.id]: [...(current[post.id] || []), comment] }));
        updatePostFromInteraction(post);
        setFeedback(t('teacherSpaceCommentDeleteError'));
      } else {
        await queueMutation(teacherId, { method: 'DELETE', url: `/teacher-space/${post.id}/comments/${comment.id}` });
        setFeedback(t('teacherSpaceCommentDeleteQueued'));
      }
    }
  };

  const submitPost = async (event) => {
    event.preventDefault();
    const title = form.title.trim();
    const resourceUrl = form.resource_url.trim();
    if (title.length < 3 || !/^https?:\/\//i.test(resourceUrl)) {
      setFeedback(t('teacherSpaceInvalidPost'));
      return;
    }
    const clientPostId = makeClientPostId();
    if (!currentSubjectKey) {
      setFeedback(t('teacherSpaceSubjectRequired'));
      return;
    }
    const payload = {
      resource_type: form.resource_type,
      language: locale,
      subject: teacher?.subject || '',
      subject_key: currentSubjectKey,
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
          <div><span className="eyebrow">{t('teacherSpaceEyebrow')}</span><h2 id="teacher-space-title">{t('teacherSpaceTitle')}</h2><p>{t('teacherSpaceDescription')}</p>{teacher?.subject && <span className="teacher-space__subject"><Icon name="fileCheck" className="w-3.5 h-3.5" />{teacher.subject}</span>}</div>
        </div>
        <button type="button" className="btn-primary teacher-space__share" onClick={() => setComposerOpen((open) => !open)} disabled={!currentSubjectKey} title={!currentSubjectKey ? t('teacherSpaceSubjectRequired') : undefined}><Icon name="plus" className="w-4 h-4" />{composerOpen ? t('close') : t('teacherSpaceShare')}</button>
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
      {subjectRequired && <div className="teacher-space__subject-required" role="status"><strong>{t('teacherSpaceSubjectRequired')}</strong><span>{t('teacherSpaceNoSubjectHint')}</span><Link to="/settings">{t('teacherSpaceOpenSettings')}</Link></div>}
      {loading && visiblePosts.length === 0 ? <div className="teacher-space__empty teacher-space__empty--loading">{t('teacherSpaceLoading')}</div> : visiblePosts.length === 0 ? <div className="teacher-space__empty"><Icon name="users" className="w-7 h-7" /><strong>{t('teacherSpaceEmpty')}</strong><span>{t('teacherSpaceEmptyHint')}</span></div> : <div className="teacher-space__grid">{visiblePosts.map((post) => <article key={post.id} className={`teacher-space__card ${post.pending ? 'is-pending' : ''}`}>
        <div className="teacher-space__card-top"><span className={`teacher-space__type teacher-space__type--${post.resource_type}`}><Icon name={post.resource_type === 'link' || post.resource_type === 'game' ? 'externalLink' : post.resource_type === 'file' || post.resource_type === 'test' ? 'fileCheck' : 'reports'} className="w-3.5 h-3.5" />{t(`teacherSpaceType_${post.resource_type}`)}</span><time>{displayDate(post.created_at, locale)}</time></div>
        <h3>{post.title}</h3>
        {post.description && <p className="teacher-space__card-description">{post.description}</p>}
        <div className="teacher-space__card-meta"><span>{post.file_name || post.author_name}</span>{post.pending && <em>{t('teacherSpacePending')}</em>}</div>
        <div className="teacher-space__card-social" aria-label={t('teacherSpaceInteractions')}>
          <button type="button" className={`teacher-space__reaction ${post.liked_by_me ? 'is-liked' : ''}`} onClick={() => toggleLike(post)} disabled={post.pending || Boolean(interactionBusy[post.id])} aria-pressed={Boolean(post.liked_by_me)}><Icon name="heart" className="w-4 h-4" /><span>{post.like_count || 0}</span><small>{t('teacherSpaceLike')}</small></button>
          <button type="button" className={`teacher-space__reaction ${commentsOpen[post.id] ? 'is-open' : ''}`} onClick={() => loadComments(post.id)} disabled={post.pending}><Icon name="messageCircle" className="w-4 h-4" /><span>{post.comment_count || 0}</span><small>{t('teacherSpaceComment')}</small></button>
          <span className="teacher-space__sort-note">{Number(post.like_count || 0) > 0 ? t('teacherSpaceSortedByLikes') : ''}</span>
        </div>
        <div className="teacher-space__card-actions"><a href={post.resource_url} target="_blank" rel="noreferrer noopener" className="teacher-space__open"><Icon name="externalLink" className="w-4 h-4" />{t('teacherSpaceOpen')}</a>{post.teacher_id === teacherId && !post.pending && <button type="button" className="teacher-space__delete" onClick={() => deletePost(post)} aria-label={t('teacherSpaceDelete')} title={t('teacherSpaceDelete')}><Icon name="trash" className="w-4 h-4" /> </button>}</div>
        {commentsOpen[post.id] && <div className="teacher-space__comments"><div className="teacher-space__comments-heading"><strong>{t('teacherSpaceComments')}</strong>{commentLoading[post.id] && <span>{t('loading')}</span>}</div>{(commentsByPost[post.id] || []).map((comment) => <div key={comment.id} className={`teacher-space__comment ${comment.pending ? 'is-pending' : ''}`}><div><strong>{comment.author_name}</strong><time>{displayDate(comment.created_at, locale)}</time></div><p>{comment.body}</p>{comment.can_delete && !comment.pending && <button type="button" className="teacher-space__comment-delete" onClick={() => deleteComment(post, comment)} aria-label={t('teacherSpaceDeleteComment')} title={t('teacherSpaceDeleteComment')}>×</button>}</div>)}<form className="teacher-space__comment-form" onSubmit={(event) => submitComment(event, post)}><input maxLength={500} value={commentDrafts[post.id] || ''} onChange={(event) => setCommentDrafts((current) => ({ ...current, [post.id]: event.target.value }))} placeholder={t('teacherSpaceCommentPlaceholder')} /><button type="submit" disabled={commentSubmitting[post.id] || !String(commentDrafts[post.id] || '').trim()} aria-label={t('teacherSpacePostComment')} title={t('teacherSpacePostComment')}><Icon name="send" className="w-4 h-4" /></button></form></div>}
      </article>)}</div>}
    </section>
  );
}
