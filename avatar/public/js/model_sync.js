// Rendering windows keep textures in GPU memory after a file changes. A model
// revision travels with view messages so an already open OBS/live window reads
// the new model as well, even when its model folder name has not changed.
export const validRevision = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);

export function textureUrl(base, file, revision) {
  const url = `${base}/${file}`;
  return validRevision(revision) ? `${url}${url.includes('?') ? '&' : '?'}v=${revision}` : url;
}

export function modelReloadUrl(currentUrl, loadedModel, loadedRevision, view) {
  const model = view?.model;
  if (typeof model !== 'string' || !/^[a-z0-9_]+$/i.test(model)) return null;
  const revision = validRevision(view.modelRevision) ? view.modelRevision : null;
  if (model === loadedModel && (!revision || revision === loadedRevision)) return null;
  const u = new URL(currentUrl);
  if (model === 'model') u.searchParams.delete('model');
  else u.searchParams.set('model', model);
  if (revision) u.searchParams.set('rev', revision);
  else u.searchParams.delete('rev');
  return u.href;
}
