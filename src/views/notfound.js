import { el, html, raw, $ } from '../lib/dom.js';
import { icon } from '../ui/icons.js';
import { mountAvatar, setAvatarState } from '../avatar/index.js';

export function renderNotFound(root, path = location.hash) {
  const view = el(html`<div class="view nf">
    <div class="avatar-slot" id="nf-avatar" data-framing="full"></div>
    <div class="code grad-text">404</div>
    <h2>This page wandered off</h2>
    <p class="muted" style="max-width:44ch">We couldn't find <code>${path || '/'}</code>. It may have moved, or the link may be mistyped.</p>
    <div class="row" style="flex-wrap:wrap;justify-content:center">
      <a class="btn btn-primary" href="#/">${raw(icon('home'))}Back to scanner</a>
      <a class="btn" href="#/library">${raw(icon('library'))}Open library</a>
    </div>
  </div>`);
  root.replaceChildren(view);
  mountAvatar($('#nf-avatar', view));
  setAvatarState('notfound');
  return () => mountAvatar(null);
}
